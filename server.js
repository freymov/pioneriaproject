require('dotenv').config();
console.log('🔍 Проверка .env:');
console.log('CLOUDINARY_CLOUD_NAME:', process.env.CLOUDINARY_CLOUD_NAME);
console.log('CLOUDINARY_API_KEY:', process.env.CLOUDINARY_API_KEY ? '✅ есть' : '❌ нет');
console.log('CLOUDINARY_API_SECRET:', process.env.CLOUDINARY_API_SECRET ? '✅ есть' : '❌ нет');
console.log('DATABASE_URL:', process.env.DATABASE_URL ? '✅ есть' : '❌ нет');

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const stream = require('stream');

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const upload = multer({ storage: multer.memoryStorage() });

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));
app.use(express.json());

// ========== ТЕСТ CLOUDINARY ==========
app.get('/test-cloudinary', async (req, res) => {
    try {
        const result = await cloudinary.api.ping();
        res.json({ success: true, result });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

// ========== API ЗАГРУЗКИ ФОТО ==========
app.post('/api/upload', upload.single('image'), async (req, res) => {
    try {
        const bufferStream = new stream.PassThrough();
        bufferStream.end(req.file.buffer);
        
        const result = await new Promise((resolve, reject) => {
            const uploadStream = cloudinary.uploader.upload_stream(
                { folder: 'pioneria_chat' },
                (error, result) => {
                    if (error) reject(error);
                    else resolve(result);
                }
            );
            bufferStream.pipe(uploadStream);
        });
        
        res.json({ success: true, url: result.secure_url });
    } catch (err) {
        console.error('Ошибка загрузки фото:', err);
        res.json({ success: false, error: 'Ошибка загрузки' });
    }
});

// ========== ПОДКЛЮЧЕНИЕ К БАЗЕ ==========
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
    console.error('❌ ОШИБКА: DATABASE_URL не найдена в переменных окружения');
    process.exit(1);
}

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// ========== ИНИЦИАЛИЗАЦИЯ БАЗЫ ==========
async function initDatabase() {
    try {
        // Таблица users с полем role
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                role VARCHAR(50) DEFAULT 'user',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Таблица сообщений
        await pool.query(`
            CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY,
                user_name VARCHAR(100) NOT NULL,
                text TEXT NOT NULL,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Таблица ключей
        await pool.query(`
            CREATE TABLE IF NOT EXISTS invite_keys (
                id SERIAL PRIMARY KEY,
                key_code VARCHAR(100) UNIQUE NOT NULL,
                role VARCHAR(50) NOT NULL DEFAULT 'user',
                used_by VARCHAR(255),
                used_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Добавляем админ-ключ, если его нет
        const existing = await pool.query(
            "SELECT * FROM invite_keys WHERE key_code = 'ADMIN-PIONERIA-2026'"
        );
        
        if (existing.rows.length === 0) {
            await pool.query(
                "INSERT INTO invite_keys (key_code, role) VALUES ('ADMIN-PIONERIA-2026', 'admin')"
            );
            console.log('✅ Создан админ-ключ: ADMIN-PIONERIA-2026');
        } else {
            console.log('✅ Админ-ключ уже существует');
        }
        
        console.log('✅ База данных и таблицы готовы');
    } catch (err) {
        console.error('❌ Ошибка инициализации базы:', err);
    }
}

initDatabase();

app.get('/fix-role', async (req, res) => {
    try {
        await pool.query("UPDATE users SET role = 'admin' WHERE email = 'fsdgf@gmail.com'");
        res.send('✅ Роль обновлена! Теперь пользователь fsdgf@gmail.com - админ');
    } catch (err) {
        res.send('❌ Ошибка: ' + err.message);
    }
});

// ========== API ==========

// Регистрация с ключом
app.post('/api/register', async (req, res) => {
    const { name, email, password, accessKey } = req.body;
    
    console.log('🔑 Попытка регистрации с ключом:', accessKey);
    
    try {
        // 1. Проверяем ключ
        const keyResult = await pool.query(
            'SELECT * FROM invite_keys WHERE key_code = $1 AND used_by IS NULL',
            [accessKey]
        );
        
        console.log('🔍 Результат проверки ключа:', keyResult.rows.length);
        
        if (keyResult.rows.length === 0) {
            return res.json({ success: false, error: 'Неверный или уже использованный ключ' });
        }
        
        const key = keyResult.rows[0];
        
        // 2. Проверяем email
        const userExists = await pool.query(
            'SELECT * FROM users WHERE email = $1',
            [email]
        );
        
        if (userExists.rows.length > 0) {
            return res.json({ success: false, error: 'Пользователь с таким email уже существует' });
        }
        
        // 3. Хешируем пароль
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // 4. Создаём пользователя
        await pool.query(
            'INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, $4)',
            [name, email, hashedPassword, key.role]
        );
        
        // 5. Помечаем ключ как использованный
        await pool.query(
            'UPDATE invite_keys SET used_by = $1, used_at = NOW() WHERE key_code = $2',
            [email, accessKey]
        );
        
        console.log('✅ Пользователь зарегистрирован:', name, 'роль:', key.role);
        res.json({ success: true });
    } catch (err) {
        console.error('❌ Ошибка регистрации:', err);
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

// Вход
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    
    try {
        const result = await pool.query(
            'SELECT * FROM users WHERE email = $1',
            [email]
        );
        
        if (result.rows.length === 0) {
            return res.json({ success: false, error: 'Неверный email или пароль' });
        }
        
        const user = result.rows[0];
        const valid = await bcrypt.compare(password, user.password);
        
        if (!valid) {
            return res.json({ success: false, error: 'Неверный email или пароль' });
        }
        
        res.json({
            success: true,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role
            }
        });
    } catch (err) {
        console.error('❌ Ошибка входа:', err);
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

// ========== АДМИН-API ==========

// Создание ключей
app.post('/api/admin/generate-keys', async (req, res) => {
    const { adminEmail, count, role } = req.body;
    
    try {
        const admin = await pool.query(
            'SELECT * FROM users WHERE email = $1 AND role = $2',
            [adminEmail, 'admin']
        );
        
        if (admin.rows.length === 0) {
            return res.json({ success: false, error: 'Нет прав' });
        }
        
        const keys = [];
        for (let i = 0; i < count; i++) {
            const keyCode = `PIONERIA-${Date.now()}-${i}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
            await pool.query(
                'INSERT INTO invite_keys (key_code, role) VALUES ($1, $2)',
                [keyCode, role || 'user']
            );
            keys.push(keyCode);
        }
        
        res.json({ success: true, keys });
    } catch (err) {
        console.error('❌ Ошибка создания ключей:', err);
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

// Список пользователей
app.get('/api/admin/users', async (req, res) => {
    const { adminEmail } = req.query;
    
    try {
        const admin = await pool.query(
            'SELECT * FROM users WHERE email = $1 AND role = $2',
            [adminEmail, 'admin']
        );
        
        if (admin.rows.length === 0) {
            return res.json({ success: false, error: 'Нет прав' });
        }
        
        const users = await pool.query(
            'SELECT id, name, email, role, created_at FROM users ORDER BY created_at DESC'
        );
        
        res.json({ success: true, users: users.rows });
    } catch (err) {
        console.error('❌ Ошибка получения пользователей:', err);
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

// ========== ЧАТ ==========
let onlineUsers = {};

async function getMessageHistory() {
    try {
        const result = await pool.query(
            'SELECT user_name as name, text, timestamp FROM messages ORDER BY timestamp ASC LIMIT 100'
        );
        return result.rows;
    } catch (err) {
        console.error('❌ Ошибка загрузки истории:', err);
        return [];
    }
}

async function saveMessage(userName, text) {
    try {
        await pool.query(
            'INSERT INTO messages (user_name, text) VALUES ($1, $2)',
            [userName, text]
        );
        console.log('✅ Сообщение сохранено');
    } catch (err) {
        console.error('❌ Ошибка сохранения сообщения:', err);
    }
}

io.on('connection', async (socket) => {
    console.log('🔵 Подключился:', socket.id);

    const history = await getMessageHistory();
    socket.emit('message history', history);
    console.log('📤 Отправлено сообщений:', history.length);

    socket.on('user joined', (name) => {
        onlineUsers[socket.id] = name;
        console.log('👤 Вошёл:', name);
    });

    socket.on('chat message', async (msg) => {
        const userName = onlineUsers[socket.id] || 'Аноним';
        const messageData = {
            name: userName,
            text: msg,
            timestamp: new Date().toISOString()
        };
        
        await saveMessage(userName, msg);
        io.emit('message', messageData);
    });

    socket.on('disconnect', () => {
        const userName = onlineUsers[socket.id];
        if (userName) {
            console.log('🔴 Отключился:', userName);
            delete onlineUsers[socket.id];
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 Сервер запущен на порту ${PORT}`);
    console.log(`📁 База данных PostgreSQL подключена\n`);
});
