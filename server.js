const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));
app.use(express.json());

// ========== ПОДКЛЮЧЕНИЕ К БАЗЕ ДАННЫХ ==========
// ВСТАВЬ СЮДА ТВОЮ ССЫЛКУ ИЗ RENDER!
const DATABASE_URL = process.env.DATABASE_URL;

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// Создаём таблицы, если их нет
async function initDatabase() {
    try {
        // Таблица пользователей
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
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
        
        console.log('✅ База данных и таблицы готовы');
    } catch (err) {
        console.error('❌ Ошибка инициализации базы:', err);
    }
}

initDatabase();

// ========== API ==========
app.post('/api/register', async (req, res) => {
    const { name, email, password, accessKey } = req.body;
    
    const CORRECT_ACCESS_KEY = 'ПИОНЕРИЯ2026';
    
    if (accessKey !== CORRECT_ACCESS_KEY) {
        return res.json({ success: false, error: 'Неверный ключ доступа' });
    }
    
    try {
        // Проверяем, существует ли пользователь
        const existingUser = await pool.query(
            'SELECT * FROM users WHERE email = $1',
            [email]
        );
        
        if (existingUser.rows.length > 0) {
            return res.json({ success: false, error: 'Пользователь с таким email уже существует' });
        }
        
        // Сохраняем пользователя
        await pool.query(
            'INSERT INTO users (name, email, password) VALUES ($1, $2, $3)',
            [name, email, password]
        );
        
        res.json({ success: true });
    } catch (err) {
        console.error('Ошибка регистрации:', err);
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    
    try {
        const result = await pool.query(
            'SELECT * FROM users WHERE email = $1 AND password = $2',
            [email, password]
        );
        
        if (result.rows.length > 0) {
            const user = result.rows[0];
            res.json({ 
                success: true, 
                user: { 
                    name: user.name, 
                    email: user.email,
                    id: user.id 
                }
            });
        } else {
            res.json({ success: false, error: 'Неверный email или пароль' });
        }
    } catch (err) {
        console.error('Ошибка входа:', err);
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

// ========== ЧАТ ==========
let onlineUsers = {};

// Загрузка истории сообщений
async function getMessageHistory() {
    try {
        const result = await pool.query(
            'SELECT user_name as name, text, timestamp FROM messages ORDER BY timestamp DESC LIMIT 100'
        );
        // Возвращаем в хронологическом порядке (от старых к новым)
        return result.rows.reverse();
    } catch (err) {
        console.error('Ошибка загрузки истории:', err);
        return [];
    }
}

// Сохранение сообщения
async function saveMessage(userName, text) {
    try {
        await pool.query(
            'INSERT INTO messages (user_name, text) VALUES ($1, $2)',
            [userName, text]
        );
        console.log('✅ Сообщение сохранено в БД');
    } catch (err) {
        console.error('❌ Ошибка сохранения сообщения:', err);
    }
}

io.on('connection', async (socket) => {
    console.log('🔵 Подключился:', socket.id);

    // Отправляем историю сообщений
    const history = await getMessageHistory();
    socket.emit('message history', history);
    console.log('📤 Отправлено сообщений:', history.length);

    socket.on('user joined', (name) => {
        onlineUsers[socket.id] = name;
        console.log('👤 Вошёл:', name);
    });

    socket.on('chat message', async (msg) => {
        const userName = onlineUsers[socket.id] || 'Аноним';
        console.log('💬 Сообщение от', userName, ':', msg);
        
        const messageData = {
            name: userName,
            text: msg,
            timestamp: new Date().toISOString()
        };
        
        // Сохраняем в базу данных
        await saveMessage(userName, msg);
        
        // Отправляем всем
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
