require('dotenv').config();
console.log('🔍 Проверка .env:');
console.log('CLOUDINARY_CLOUD_NAME:', process.env.CLOUDINARY_CLOUD_NAME);
console.log('CLOUDINARY_API_KEY:', process.env.CLOUDINARY_API_KEY ? '✅ есть' : '❌ нет');
console.log('CLOUDINARY_API_SECRET:', process.env.CLOUDINARY_API_SECRET ? '✅ есть' : '❌ нет');
console.log('DATABASE_URL:', process.env.DATABASE_URL ? '✅ есть' : '❌ нет');
console.log('RESEND_API_KEY:', process.env.RESEND_API_KEY ? '✅ есть' : '❌ нет');

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const stream = require('stream');
const path = require('path');
const fs = require('fs');
const { Resend } = require('resend');
const webpush = require('web-push');

// ========== CLOUDINARY (только для фото чата) ==========
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// ========== VAPID ==========
const vapidKeys = {
    publicKey: process.env.VAPID_PUBLIC_KEY,
    privateKey: process.env.VAPID_PRIVATE_KEY
};
if (!vapidKeys.publicKey || !vapidKeys.privateKey) {
    console.error('❌ VAPID ключи не найдены!');
    process.exit(1);
}
webpush.setVapidDetails(
    'mailto:' + (process.env.RESEND_FROM_EMAIL || 'admin@pioneriaproject.site'),
    vapidKeys.publicKey,
    vapidKeys.privateKey
);

const resend = new Resend(process.env.RESEND_API_KEY);

// ========== ХРАНИЛИЩЕ НА ДИСКЕ ==========
const storagePath = path.join(__dirname, 'public', 'storage');
if (!fs.existsSync(storagePath)) {
    fs.mkdirSync(storagePath, { recursive: true });
}
console.log('📁 Хранилище:', storagePath);

const storageUpload = multer({
    storage: multer.diskStorage({
        destination: storagePath,
        filename: (req, file, cb) => {
            const uniqueName = Date.now() + '_' + file.originalname.replace(/[^a-zA-Zа-яА-Я0-9_.-]/g, '_');
            cb(null, uniqueName);
        }
    }),
    limits: { fileSize: 100 * 1024 * 1024 } // 100 MB
});

// ========== ЗАГРУЗКА ФОТО В ЧАТ (Cloudinary) ==========
const chatUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));
app.use(express.json());

// ========== БАЗА ДАННЫХ ==========
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// ========== PUSH ==========
async function sendPushNotification(userId, title, body) {
    try {
        const r = await pool.query('SELECT subscription FROM push_subscriptions WHERE user_id=$1', [userId]);
        if (r.rows.length === 0) return;
        await webpush.sendNotification(r.rows[0].subscription, JSON.stringify({ title, body, icon: '/favicon.jpg' }));
    } catch (err) {
        if (err.statusCode === 410) await pool.query('DELETE FROM push_subscriptions WHERE user_id=$1', [userId]);
    }
}

// ========== ИНИЦИАЛИЗАЦИЯ БД ==========
async function initDatabase() {
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, name VARCHAR(100), email VARCHAR(255) UNIQUE, password VARCHAR(255), role VARCHAR(50) DEFAULT 'user', email_verified BOOLEAN DEFAULT FALSE, avatar_url TEXT, username VARCHAR(50) UNIQUE, created_at TIMESTAMP DEFAULT NOW())`);
        await pool.query(`CREATE TABLE IF NOT EXISTS email_verifications (id SERIAL PRIMARY KEY, email VARCHAR(255), code VARCHAR(6), expires_at TIMESTAMP, created_at TIMESTAMP DEFAULT NOW())`);
        await pool.query(`CREATE TABLE IF NOT EXISTS chats (id SERIAL PRIMARY KEY, created_at TIMESTAMP DEFAULT NOW())`);
        await pool.query(`CREATE TABLE IF NOT EXISTS chat_participants (chat_id INTEGER REFERENCES chats(id) ON DELETE CASCADE, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY(chat_id, user_id))`);
        await pool.query(`CREATE TABLE IF NOT EXISTS messages (id SERIAL PRIMARY KEY, user_name VARCHAR(100), text TEXT, user_id INTEGER, image_url TEXT, chat_id INTEGER, is_read BOOLEAN DEFAULT FALSE, edited BOOLEAN DEFAULT FALSE, timestamp TIMESTAMP DEFAULT NOW())`);
        await pool.query(`CREATE TABLE IF NOT EXISTS invite_keys (id SERIAL PRIMARY KEY, key_code VARCHAR(100) UNIQUE, role VARCHAR(50) DEFAULT 'user', used_by VARCHAR(255), used_at TIMESTAMP, created_at TIMESTAMP DEFAULT NOW())`);
        await pool.query(`CREATE TABLE IF NOT EXISTS news (id SERIAL PRIMARY KEY, title VARCHAR(255), content TEXT, created_at TIMESTAMP DEFAULT NOW())`);
        await pool.query(`CREATE TABLE IF NOT EXISTS settings (key VARCHAR(100) PRIMARY KEY, value TEXT, updated_at TIMESTAMP DEFAULT NOW())`);
        await pool.query(`CREATE TABLE IF NOT EXISTS groups (id SERIAL PRIMARY KEY, chat_id INTEGER, name VARCHAR(255), created_by INTEGER, created_at TIMESTAMP DEFAULT NOW())`);
        await pool.query(`CREATE TABLE IF NOT EXISTS push_subscriptions (id SERIAL PRIMARY KEY, user_id INTEGER UNIQUE, subscription JSONB, created_at TIMESTAMP DEFAULT NOW())`);
        await pool.query(`CREATE TABLE IF NOT EXISTS schedule_groups (id SERIAL PRIMARY KEY, name VARCHAR(100), color VARCHAR(7), created_at TIMESTAMP DEFAULT NOW())`);
        await pool.query(`CREATE TABLE IF NOT EXISTS schedule_lessons (id SERIAL PRIMARY KEY, group_id INTEGER, day_of_week INTEGER, start_time TIME, end_time TIME, title VARCHAR(255) DEFAULT 'Репетиция', description TEXT, is_common BOOLEAN DEFAULT FALSE, status VARCHAR(20) DEFAULT 'active', event_type VARCHAR(20) DEFAULT 'rehearsal', lesson_date DATE, created_at TIMESTAMP DEFAULT NOW())`);
        
        // Новая таблица хранилища — храним только названия файлов
        await pool.query(`CREATE TABLE IF NOT EXISTS storage_items (id SERIAL PRIMARY KEY, title VARCHAR(255), pdf_file VARCHAR(255), mp3_file VARCHAR(255), mp4_file VARCHAR(255), created_at TIMESTAMP DEFAULT NOW())`);
        
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(50)`);
        await pool.query(`ALTER TABLE storage_items ADD COLUMN IF NOT EXISTS mp4_file VARCHAR(255)`);
        await pool.query(`ALTER TABLE storage_items ADD COLUMN IF NOT EXISTS pdf_file VARCHAR(255)`);
        await pool.query(`ALTER TABLE storage_items ADD COLUMN IF NOT EXISTS mp3_file VARCHAR(255)`);

        const g = await pool.query('SELECT COUNT(*) FROM schedule_groups');
        if (parseInt(g.rows[0].count) === 0) {
            await pool.query(`INSERT INTO schedule_groups (name, color) VALUES ('Утренняя','#f59e0b'),('16:00','#667eea'),('17:30','#8b5cf6')`);
        }
        const k = await pool.query("SELECT * FROM invite_keys WHERE key_code='ADMIN-PIONERIA-2025'");
        if (k.rows.length === 0) {
            await pool.query("INSERT INTO invite_keys (key_code, role) VALUES ('ADMIN-PIONERIA-2025','admin')");
        }
        console.log('✅ БД готова');
    } catch (err) {
        console.error('❌ БД:', err.message);
    }
}
initDatabase();

// ========== API (сокращённое, всё работает как раньше) ==========

app.get('/api/push/public-key', (req, res) => res.json({ publicKey: vapidKeys.publicKey }));

app.post('/api/push/subscribe', async (req, res) => {
    try {
        await pool.query('INSERT INTO push_subscriptions (user_id, subscription) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET subscription=$2', [req.body.userId, JSON.stringify(req.body.subscription)]);
        res.json({ success: true });
    } catch (e) { res.json({ success: false }); }
});

app.post('/api/register', async (req, res) => {
    const { name, email, password, accessKey } = req.body;
    try {
        const key = await pool.query('SELECT * FROM invite_keys WHERE key_code=$1 AND used_by IS NULL', [accessKey]);
        if (key.rows.length === 0) return res.json({ success: false, error: 'Неверный ключ' });
        const exists = await pool.query('SELECT id FROM users WHERE email=$1', [email]);
        if (exists.rows.length > 0) return res.json({ success: false, error: 'Email занят' });
        const hash = await bcrypt.hash(password, 10);
        await pool.query('INSERT INTO users (name, email, password, role) VALUES ($1,$2,$3,$4)', [name, email, hash, key.rows[0].role]);
        await pool.query('UPDATE invite_keys SET used_by=$1, used_at=NOW() WHERE key_code=$2', [email, accessKey]);
        res.json({ success: true });
    } catch (e) { res.json({ success: false }); }
});

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const r = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
        if (r.rows.length === 0) return res.json({ success: false, error: 'Неверно' });
        const user = r.rows[0];
        if (!await bcrypt.compare(password, user.password)) return res.json({ success: false, error: 'Неверно' });
        if (!user.email_verified) return res.json({ success: false, error: 'Подтвердите email' });
        res.json({ success: true, user: { id: user.id, name: user.name, email: user.email, role: user.role, username: user.username } });
    } catch (e) { res.json({ success: false }); }
});

app.get('/api/users', async (req, res) => {
    try { const r = await pool.query('SELECT id, name, email, role, username FROM users ORDER BY name'); res.json({ success: true, users: r.rows }); } 
    catch (e) { res.json({ success: false }); }
});

app.get('/api/news', async (req, res) => {
    try { const r = await pool.query('SELECT * FROM news ORDER BY created_at DESC LIMIT 10'); res.json({ success: true, news: r.rows }); } 
    catch (e) { res.json({ success: false }); }
});

app.get('/api/schedule', async (req, res) => {
    try {
        const r = await pool.query('SELECT sl.*, sg.name as group_name FROM schedule_lessons sl LEFT JOIN schedule_groups sg ON sl.group_id=sg.id ORDER BY sl.lesson_date, sl.day_of_week, sl.start_time');
        res.json({ success: true, lessons: r.rows });
    } catch (e) { res.json({ success: false }); }
});

app.get('/api/schedule/groups', async (req, res) => {
    try { const r = await pool.query('SELECT * FROM schedule_groups ORDER BY id'); res.json({ success: true, groups: r.rows }); } 
    catch (e) { res.json({ success: false }); }
});

// Загрузка фото в чат (Cloudinary)
app.post('/api/upload', chatUpload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.json({ success: false });
        const bufferStream = new stream.PassThrough();
        bufferStream.end(req.file.buffer);
        const result = await new Promise((resolve, reject) => {
            cloudinary.uploader.upload_stream({ folder: 'pioneria_chat', resource_type: 'image' }, (e, r) => e ? reject(e) : resolve(r)).end(req.file.buffer);
        });
        res.json({ success: true, url: result.secure_url });
    } catch (e) { res.json({ success: false }); }
});

// ========== НОВОЕ ХРАНИЛИЩЕ (ФАЙЛЫ НА ДИСКЕ) ==========

// Получить список
app.get('/api/storage', async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM storage_items ORDER BY created_at DESC');
        const items = r.rows.map(item => ({
            ...item,
            pdf_url: item.pdf_file ? '/storage/' + item.pdf_file : null,
            mp3_url: item.mp3_file ? '/storage/' + item.mp3_file : null,
            mp4_url: item.mp4_file ? '/storage/' + item.mp4_file : null
        }));
        res.json({ success: true, items });
    } catch (e) { res.json({ success: false }); }
});

// Загрузить файл (админ)
app.post('/api/admin/storage', storageUpload.fields([
    { name: 'pdf', maxCount: 1 },
    { name: 'mp3', maxCount: 1 },
    { name: 'mp4', maxCount: 1 }
]), async (req, res) => {
    const { adminEmail, title } = req.body;
    try {
        const admin = await pool.query('SELECT * FROM users WHERE email=$1 AND role=$2', [adminEmail, 'admin']);
        if (admin.rows.length === 0) return res.json({ success: false, error: 'Нет прав' });
        if (!title?.trim()) return res.json({ success: false, error: 'Введите название' });

        const pdf_file = req.files?.pdf?.[0]?.filename || null;
        const mp3_file = req.files?.mp3?.[0]?.filename || null;
        const mp4_file = req.files?.mp4?.[0]?.filename || null;

        if (!pdf_file && !mp3_file && !mp4_file) {
            return res.json({ success: false, error: 'Загрузите хотя бы один файл' });
        }

        const r = await pool.query(
            'INSERT INTO storage_items (title, pdf_file, mp3_file, mp4_file) VALUES ($1,$2,$3,$4) RETURNING id',
            [title.trim(), pdf_file, mp3_file, mp4_file]
        );
        res.json({ success: true, id: r.rows[0].id });
    } catch (e) {
        console.error('Ошибка загрузки:', e);
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

// Удалить (админ)
app.delete('/api/admin/storage/:id', async (req, res) => {
    try {
        // Получаем имена файлов
        const item = await pool.query('SELECT pdf_file, mp3_file, mp4_file FROM storage_items WHERE id=$1', [req.params.id]);
        if (item.rows.length > 0) {
            const files = [item.rows[0].pdf_file, item.rows[0].mp3_file, item.rows[0].mp4_file].filter(Boolean);
            files.forEach(f => {
                const filePath = path.join(storagePath, f);
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            });
        }
        await pool.query('DELETE FROM storage_items WHERE id=$1', [req.params.id]);
        res.json({ success: true });
    } catch (e) { res.json({ success: false }); }
});

// ========== АДМИН API (сокращённое) ==========
app.post('/api/admin/generate-keys', async (req, res) => {
    try {
        const keys = [];
        for (let i = 0; i < (req.body.count || 1); i++) {
            const code = `PIONERIA-${Date.now()}-${i}-${Math.random().toString(36).substring(2,8).toUpperCase()}`;
            await pool.query('INSERT INTO invite_keys (key_code, role) VALUES ($1,$2)', [code, req.body.role || 'user']);
            keys.push(code);
        }
        res.json({ success: true, keys });
    } catch (e) { res.json({ success: false }); }
});

app.get('/api/admin/users', async (req, res) => {
    try { const r = await pool.query('SELECT id, name, email, role, username, created_at FROM users ORDER BY created_at DESC'); res.json({ success: true, users: r.rows }); } 
    catch (e) { res.json({ success: false }); }
});

app.post('/api/admin/news', async (req, res) => {
    try { await pool.query('INSERT INTO news (title, content) VALUES ($1,$2)', [req.body.title, req.body.content]); res.json({ success: true }); } 
    catch (e) { res.json({ success: false }); }
});

app.post('/api/admin/schedule', async (req, res) => {
    const { groupId, days, startTime, endTime, title, eventType, lessonDate } = req.body;
    try {
        if (lessonDate) {
            await pool.query('INSERT INTO schedule_lessons (group_id, start_time, end_time, title, event_type, lesson_date) VALUES ($1,$2,$3,$4,$5,$6)', [groupId, startTime, endTime, title, eventType, lessonDate]);
        } else if (days) {
            for (const d of days) {
                await pool.query('INSERT INTO schedule_lessons (group_id, day_of_week, start_time, end_time, title, event_type) VALUES ($1,$2,$3,$4,$5,$6)', [groupId, d, startTime, endTime, title, eventType]);
            }
        }
        res.json({ success: true });
    } catch (e) { res.json({ success: false }); }
});

app.delete('/api/admin/news/:id', async (req, res) => {
    try { await pool.query('DELETE FROM news WHERE id=$1', [req.params.id]); res.json({ success: true }); } 
    catch (e) { res.json({ success: false }); }
});

app.delete('/api/admin/schedule/:id', async (req, res) => {
    try { await pool.query('DELETE FROM schedule_lessons WHERE id=$1', [req.params.id]); res.json({ success: true }); } 
    catch (e) { res.json({ success: false }); }
});

// ========== ЧАТ ==========
let onlineUsers = {};

io.on('connection', async (socket) => {
    const chatId = socket.handshake.query.chatId ? Number(socket.handshake.query.chatId) : null;
    let currentUser = null;

    const history = chatId 
        ? (await pool.query('SELECT * FROM messages WHERE chat_id=$1 ORDER BY timestamp ASC LIMIT 100', [chatId])).rows
        : (await pool.query('SELECT * FROM messages WHERE chat_id IS NULL ORDER BY timestamp ASC LIMIT 100')).rows;
    socket.emit('message history', history);

    socket.on('user joined', (userData) => {
        currentUser = userData;
        onlineUsers[socket.id] = userData.name;
        socket.join(`user_${userData.id}`);
    });

    socket.on('chat message', async (data) => {
        const text = typeof data === 'string' ? data : data.text;
        const msgChatId = typeof data === 'string' ? chatId : (data.chatId ? Number(data.chatId) : chatId);
        const userName = currentUser?.name || onlineUsers[socket.id] || 'Аноним';
        const userId = currentUser?.id || null;
        const imageUrl = text?.startsWith('📷') ? text.replace('📷 ', '') : null;

        const r = await pool.query('INSERT INTO messages (user_name, text, user_id, image_url, chat_id) VALUES ($1,$2,$3,$4,$5) RETURNING id', [userName, text, userId, imageUrl, msgChatId || null]);
        const msg = { id: r.rows[0].id, name: userName, text, user_id: userId, timestamp: new Date().toISOString(), image_url: imageUrl, chat_id: msgChatId || null };

        if (msgChatId) {
            const p = await pool.query('SELECT user_id FROM chat_participants WHERE chat_id=$1', [msgChatId]);
            p.rows.forEach(u => io.to(`user_${u.user_id}`).emit('message', msg));
        } else {
            io.emit('message', msg);
        }
    });

    socket.on('disconnect', () => { delete onlineUsers[socket.id]; });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`\n🚀 Сервер на порту ${PORT}`));
