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
        
        await pool.query(`
            CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY,
                user_name VARCHAR(100) NOT NULL,
                text TEXT NOT NULL,
                user_id INTEGER REFERENCES users(id),
                image_url TEXT,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
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

// ========== API ==========

app.post('/api/register', async (req, res) => {
    const { name, email, password, accessKey } = req.body;
    
    console.log('🔑 Попытка регистрации с ключом:', accessKey);
    
    try {
        const keyResult = await pool.query(
            'SELECT * FROM invite_keys WHERE key_code = $1 AND used_by IS NULL',
            [accessKey]
        );
        
        if (keyResult.rows.length === 0) {
            return res.json({ success: false, error: 'Неверный или уже использованный ключ' });
        }
        
        const key = keyResult.rows[0];
        
        const userExists = await pool.query(
            'SELECT * FROM users WHERE email = $1',
            [email]
        );
        
        if (userExists.rows.length > 0) {
            return res.json({ success: false, error: 'Пользователь с таким email уже существует' });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        
        const result = await pool.query(
            'INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, $4) RETURNING id',
            [name, email, hashedPassword, key.role]
        );
        
        await pool.query(
            'UPDATE invite_keys SET used_by = $1, used_at = NOW() WHERE key_code = $2',
            [email, accessKey]
        );
        
        console.log('✅ Пользователь зарегистрирован:', name, 'id:', result.rows[0].id);
        res.json({ success: true });
    } catch (err) {
        console.error('❌ Ошибка регистрации:', err);
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

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

// ========== УДАЛЕНИЕ СООБЩЕНИЙ ==========
app.post('/api/delete-message', async (req, res) => {
    const { messageId, userId, userRole, imageUrl } = req.body;
    
    console.log('📥 Удаление сообщения:', { messageId, userId, userRole });
    
    try {
        const msg = await pool.query(
            'SELECT * FROM messages WHERE id = $1',
            [messageId]
        );
        
        if (msg.rows.length === 0) {
            return res.json({ success: false, error: 'Сообщение не найдено' });
        }
        
        const message = msg.rows[0];
        const isAuthor = message.user_id === userId;
        const isAdmin = userRole === 'admin';
        
        if (!isAuthor && !isAdmin) {
            return res.json({ success: false, error: 'Нет прав на удаление' });
        }
        
        if (imageUrl && imageUrl.includes('cloudinary.com')) {
            try {
                const publicId = imageUrl.split('/').pop().split('.')[0];
                await cloudinary.uploader.destroy(`pioneria_chat/${publicId}`);
            } catch (err) {
                console.error('Ошибка удаления фото:', err);
            }
        }
        
        await pool.query('DELETE FROM messages WHERE id = $1', [messageId]);
        io.emit('message deleted', messageId);
        
        res.json({ success: true });
    } catch (err) {
        console.error('❌ Ошибка удаления:', err);
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});


// ========== СМЕНА ИМЕНИ ==========
app.post('/api/update-name', async (req, res) => {
    const { userId, newName, oldName } = req.body;
    
    if (!userId || !newName) {
        return res.json({ success: false, error: 'Не все данные' });
    }
    
    try {
        // Обновляем имя в таблице users
        await pool.query(
            'UPDATE users SET name = $1 WHERE id = $2',
            [newName, userId]
        );
        
        // Обновляем имя во всех сообщениях пользователя
        await pool.query(
            'UPDATE messages SET user_name = $1 WHERE user_id = $2',
            [newName, userId]
        );
        
        console.log(`✅ Имя пользователя ${userId} изменено с ${oldName} на ${newName}`);
        
        res.json({ success: true });
    } catch (err) {
        console.error('❌ Ошибка смены имени:', err);
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});








// ========== ЧАТ ==========
let onlineUsers = {};

async function getMessageHistory() {
    try {
        const result = await pool.query(
            'SELECT id, user_name as name, text, user_id, image_url, timestamp FROM messages ORDER BY timestamp ASC LIMIT 100'
        );
        return result.rows;
    } catch (err) {
        console.error('❌ Ошибка загрузки истории:', err);
        return [];
    }
}

async function saveMessage(userName, text, userId, imageUrl = null) {
    try {
        const validUserId = (userId && typeof userId === 'number') ? userId : null;
        
        const result = await pool.query(
            'INSERT INTO messages (user_name, text, user_id, image_url) VALUES ($1, $2, $3, $4) RETURNING id',
            [userName, text, validUserId, imageUrl]
        );
        console.log('✅ Сообщение сохранено, id:', result.rows[0].id, 'user_id:', validUserId);
        return result.rows[0].id;
    } catch (err) {
        console.error('❌ Ошибка сохранения сообщения:', err);
        return null;
    }
}

io.on('connection', async (socket) => {
    console.log('🔵 Подключился:', socket.id);
    
    let currentUser = null;

    const history = await getMessageHistory();
    socket.emit('message history', history);
    console.log('📤 Отправлено сообщений:', history.length);

    socket.on('user joined', (userData) => {
        currentUser = userData;
        onlineUsers[socket.id] = userData.name;
        console.log('👤 Вошёл:', userData.name, 'id:', userData.id);
    });

    socket.on('chat message', async (msg) => {
        const userName = currentUser?.name || onlineUsers[socket.id] || 'Аноним';
        const userId = currentUser?.id ? parseInt(currentUser.id) : null;
        
        let imageUrl = null;
        if (msg.startsWith('📷')) {
            imageUrl = msg.replace('📷 ', '');
        }
        
        const messageId = await saveMessage(userName, msg, userId, imageUrl);
        
        const messageData = {
            id: messageId,
            name: userName,
            text: msg,
            user_id: userId,
            timestamp: new Date().toISOString(),
            image_url: imageUrl
        };
        
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
