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
const https = require('https');
const { Resend } = require('resend');
const webpush = require('web-push');

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const vapidKeys = {
    publicKey: process.env.VAPID_PUBLIC_KEY,
    privateKey: process.env.VAPID_PRIVATE_KEY
};

if (!vapidKeys.publicKey || !vapidKeys.privateKey) {
    console.error('❌ ОШИБКА: VAPID ключи не найдены!');
    process.exit(1);
}

webpush.setVapidDetails(
    'mailto:' + (process.env.RESEND_FROM_EMAIL || 'admin@pioneriaproject.site'),
    vapidKeys.publicKey,
    vapidKeys.privateKey
);

const resend = new Resend(process.env.RESEND_API_KEY);
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 }
});

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));
app.use(express.json());

// ========== ЗАГРУЗКА В CLOUDINARY (БЕЗ FORMAT ДЛЯ RAW) ==========
function uploadToCloudinary(buffer, folder, resourceType) {
    return new Promise((resolve, reject) => {
        const bufferStream = new stream.PassThrough();
        bufferStream.end(buffer);
        const uploadStream = cloudinary.uploader.upload_stream(
            { folder, resource_type: resourceType },
            (error, result) => {
                if (error) reject(error);
                else resolve(result);
            }
        );
        bufferStream.pipe(uploadStream);
    });
}

// ========== ТЕСТ CLOUDINARY ==========
app.get('/test-cloudinary', async (req, res) => {
    try {
        const result = await cloudinary.api.ping();
        res.json({ success: true, result });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

// ========== ЗАГРУЗКА ФОТО В ЧАТ ==========
app.post('/api/upload', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.json({ success: false, error: 'Файл не найден' });
        const result = await uploadToCloudinary(req.file.buffer, 'pioneria_chat', 'image');
        res.json({ success: true, url: result.secure_url });
    } catch (err) {
        console.error('Ошибка загрузки фото:', err);
        res.json({ success: false, error: 'Ошибка загрузки' });
    }
});

// ========== БАЗА ДАННЫХ ==========
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
    console.error('❌ DATABASE_URL не найдена');
    process.exit(1);
}

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// ========== PUSH ==========
async function sendPushNotification(userId, title, body, data = {}) {
    try {
        const result = await pool.query('SELECT subscription FROM push_subscriptions WHERE user_id = $1', [userId]);
        if (result.rows.length === 0) return false;
        const subscription = result.rows[0].subscription;
        const payload = JSON.stringify({
            title: title || 'Pioneria Messenger',
            body: body || 'Новое сообщение',
            icon: '/favicon.jpg',
            badge: '/favicon.jpg',
            ...data
        });
        await webpush.sendNotification(subscription, payload);
        console.log(`✅ Push отправлен user ${userId}`);
        return true;
    } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
            await pool.query('DELETE FROM push_subscriptions WHERE user_id = $1', [userId]);
        } else {
            console.error('❌ Ошибка push:', err.message);
        }
        return false;
    }
}

// ========== ИНИЦИАЛИЗАЦИЯ БД ==========
async function initDatabase() {
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL, email VARCHAR(255) UNIQUE NOT NULL, password VARCHAR(255) NOT NULL, role VARCHAR(50) DEFAULT 'user', email_verified BOOLEAN DEFAULT FALSE, avatar_url TEXT, username VARCHAR(50) UNIQUE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS email_verifications (id SERIAL PRIMARY KEY, email VARCHAR(255) NOT NULL, code VARCHAR(6) NOT NULL, expires_at TIMESTAMP NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS chats (id SERIAL PRIMARY KEY, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS chat_participants (chat_id INTEGER REFERENCES chats(id) ON DELETE CASCADE, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY (chat_id, user_id))`);
        await pool.query(`CREATE TABLE IF NOT EXISTS messages (id SERIAL PRIMARY KEY, user_name VARCHAR(100) NOT NULL, text TEXT NOT NULL, user_id INTEGER REFERENCES users(id), image_url TEXT, chat_id INTEGER REFERENCES chats(id), is_read BOOLEAN DEFAULT FALSE, edited BOOLEAN DEFAULT FALSE, timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS invite_keys (id SERIAL PRIMARY KEY, key_code VARCHAR(100) UNIQUE NOT NULL, role VARCHAR(50) NOT NULL DEFAULT 'user', used_by VARCHAR(255), used_at TIMESTAMP, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS news (id SERIAL PRIMARY KEY, title VARCHAR(255) NOT NULL, content TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS settings (key VARCHAR(100) PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS groups (id SERIAL PRIMARY KEY, chat_id INTEGER REFERENCES chats(id) ON DELETE CASCADE, name VARCHAR(255) NOT NULL, created_by INTEGER REFERENCES users(id), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS pinned_messages (id SERIAL PRIMARY KEY, message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE, chat_id INTEGER REFERENCES chats(id) ON DELETE CASCADE, pinned_by INTEGER REFERENCES users(id), pinned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS push_subscriptions (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, subscription JSONB NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id))`);
        await pool.query(`CREATE TABLE IF NOT EXISTS user_settings (user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, setting_key VARCHAR(100) NOT NULL, setting_value TEXT NOT NULL, PRIMARY KEY (user_id, setting_key))`);
        await pool.query(`CREATE TABLE IF NOT EXISTS schedule_groups (id SERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL, color VARCHAR(7) DEFAULT '#667eea', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        try { await pool.query(`ALTER TABLE schedule_lessons DROP CONSTRAINT IF EXISTS schedule_lessons_day_of_week_check`); } catch(e) {}
        await pool.query(`CREATE TABLE IF NOT EXISTS schedule_lessons (id SERIAL PRIMARY KEY, group_id INTEGER REFERENCES schedule_groups(id) ON DELETE CASCADE, day_of_week INTEGER, start_time TIME NOT NULL, end_time TIME, title VARCHAR(255) NOT NULL DEFAULT 'Репетиция', description TEXT, is_common BOOLEAN DEFAULT FALSE, status VARCHAR(20) DEFAULT 'active', event_type VARCHAR(20) DEFAULT 'rehearsal', lesson_date DATE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS storage_items (id SERIAL PRIMARY KEY, title VARCHAR(255) NOT NULL, pdf_url TEXT, mp3_url TEXT, mp4_url TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT`);
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(50) UNIQUE`);
        await pool.query(`ALTER TABLE storage_items ADD COLUMN IF NOT EXISTS mp4_url TEXT`);
        try { await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username) WHERE username IS NOT NULL`); } catch(e) {}

        const groupsExist = await pool.query('SELECT COUNT(*) FROM schedule_groups');
        if (parseInt(groupsExist.rows[0].count) === 0) {
            await pool.query(`INSERT INTO schedule_groups (name, color) VALUES ('Утренняя группа','#f59e0b'),('Группа 16:00','#667eea'),('Группа 17:30','#8b5cf6')`);
        }
        const existing = await pool.query("SELECT * FROM invite_keys WHERE key_code = 'ADMIN-PIONERIA-2025'");
        if (existing.rows.length === 0) {
            await pool.query("INSERT INTO invite_keys (key_code, role) VALUES ('ADMIN-PIONERIA-2025','admin')");
        }
        console.log('✅ База данных готова');
    } catch (err) {
        console.error('❌ Ошибка БД:', err);
    }
}
initDatabase();

// ========== ВСЕ API (без изменений) ==========
app.get('/api/push/public-key', (req, res) => res.json({ publicKey: vapidKeys.publicKey }));

app.post('/api/push/subscribe', async (req, res) => {
    const { userId, subscription } = req.body;
    if (!userId || !subscription) return res.json({ success: false, error: 'Нет данных' });
    try {
        await pool.query(`INSERT INTO push_subscriptions (user_id, subscription) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET subscription = $2`, [userId, JSON.stringify(subscription)]);
        res.json({ success: true });
    } catch (err) { res.json({ success: false, error: 'Ошибка сервера' }); }
});

app.post('/api/register', async (req, res) => {
    const { name, email, password, accessKey } = req.body;
    try {
        const keyResult = await pool.query('SELECT * FROM invite_keys WHERE key_code = $1 AND used_by IS NULL', [accessKey]);
        if (keyResult.rows.length === 0) return res.json({ success: false, error: 'Неверный или использованный ключ' });
        const key = keyResult.rows[0];
        const userExists = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (userExists.rows.length > 0) return res.json({ success: false, error: 'Email уже существует' });
        const hashedPassword = await bcrypt.hash(password, 10);
        await pool.query('INSERT INTO users (name, email, password, role) VALUES ($1,$2,$3,$4)', [name, email, hashedPassword, key.role]);
        await pool.query('UPDATE invite_keys SET used_by=$1, used_at=NOW() WHERE key_code=$2', [email, accessKey]);
        res.json({ success: true });
    } catch (err) { res.json({ success: false, error: 'Ошибка сервера' }); }
});

app.post('/api/send-verification', async (req, res) => {
    const { email } = req.body;
    try {
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        await pool.query('INSERT INTO email_verifications (email, code, expires_at) VALUES ($1,$2,$3)', [email, code, new Date(Date.now() + 10*60*1000)]);
        await resend.emails.send({
            from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
            to: email,
            subject: 'Подтверждение email | Pioneria',
            html: `<h2>Код: ${code}</h2><p>10 минут</p>`
        });
        res.json({ success: true });
    } catch (err) { res.json({ success: false, error: 'Ошибка' }); }
});

app.post('/api/verify-email', async (req, res) => {
    const { email, code } = req.body;
    try {
        const r = await pool.query('SELECT * FROM email_verifications WHERE email=$1 AND code=$2 AND expires_at > NOW()', [email, code]);
        if (r.rows.length === 0) return res.json({ success: false, error: 'Неверный код' });
        await pool.query('UPDATE users SET email_verified=true WHERE email=$1', [email]);
        await pool.query('DELETE FROM email_verifications WHERE email=$1', [email]);
        res.json({ success: true });
    } catch (err) { res.json({ success: false, error: 'Ошибка сервера' }); }
});

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const r = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
        if (r.rows.length === 0) return res.json({ success: false, error: 'Неверный email или пароль' });
        const user = r.rows[0];
        if (!await bcrypt.compare(password, user.password)) return res.json({ success: false, error: 'Неверный email или пароль' });
        if (!user.email_verified) return res.json({ success: false, error: 'Подтвердите email' });
        res.json({ success: true, user: { id: user.id, name: user.name, email: user.email, role: user.role, avatar: user.avatar_url, username: user.username } });
    } catch (err) { res.json({ success: false, error: 'Ошибка сервера' }); }
});

app.post('/api/set-username', async (req, res) => {
    const { userId, username } = req.body;
    if (!userId || !username) return res.json({ success: false, error: 'Нет данных' });
    if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) return res.json({ success: false, error: '3-30 символов (буквы, цифры, _)' });
    try {
        const exists = await pool.query('SELECT id FROM users WHERE username=$1 AND id!=$2', [username, userId]);
        if (exists.rows.length > 0) return res.json({ success: false, error: 'Занят' });
        await pool.query('UPDATE users SET username=$1 WHERE id=$2', [username, userId]);
        res.json({ success: true, username });
    } catch (err) { res.json({ success: false, error: 'Ошибка' }); }
});

app.get('/api/search-users', async (req, res) => {
    const { q, userId } = req.query;
    if (!q) return res.json({ success: true, users: [] });
    try {
        const r = await pool.query(`SELECT id, name, username, avatar_url, role FROM users WHERE id!=$1 AND (username ILIKE $2 OR name ILIKE $2) LIMIT 20`, [userId, `%${q}%`]);
        res.json({ success: true, users: r.rows });
    } catch (err) { res.json({ success: false }); }
});

app.get('/api/users', async (req, res) => {
    try { const r = await pool.query('SELECT id, name, email, role, avatar_url, username FROM users ORDER BY name'); res.json({ success: true, users: r.rows }); } 
    catch (err) { res.json({ success: false }); }
});

app.get('/api/user/:id', async (req, res) => {
    try { 
        const r = await pool.query('SELECT id, name, username, avatar_url, role FROM users WHERE id=$1', [req.params.id]);
        if (r.rows.length === 0) return res.json({ success: false });
        res.json({ success: true, user: r.rows[0] });
    } catch (err) { res.json({ success: false }); }
});

app.post('/api/admin/generate-keys', async (req, res) => {
    const { adminEmail, count, role } = req.body;
    try {
        const admin = await pool.query('SELECT * FROM users WHERE email=$1 AND role=$2', [adminEmail, 'admin']);
        if (admin.rows.length === 0) return res.json({ success: false, error: 'Нет прав' });
        const keys = [];
        for (let i = 0; i < count; i++) {
            const code = `PIONERIA-${Date.now()}-${i}-${Math.random().toString(36).substring(2,8).toUpperCase()}`;
            await pool.query('INSERT INTO invite_keys (key_code, role) VALUES ($1,$2)', [code, role || 'user']);
            keys.push(code);
        }
        res.json({ success: true, keys });
    } catch (err) { res.json({ success: false }); }
});

app.get('/api/admin/users', async (req, res) => {
    try {
        const admin = await pool.query('SELECT * FROM users WHERE email=$1 AND role=$2', [req.query.adminEmail, 'admin']);
        if (admin.rows.length === 0) return res.json({ success: false });
        const users = await pool.query('SELECT id, name, email, role, avatar_url, username, created_at FROM users ORDER BY created_at DESC');
        res.json({ success: true, users: users.rows });
    } catch (err) { res.json({ success: false }); }
});

app.post('/api/admin/delete-user', async (req, res) => {
    const { adminEmail, userId } = req.body;
    try {
        const admin = await pool.query('SELECT * FROM users WHERE email=$1 AND role=$2', [adminEmail, 'admin']);
        if (admin.rows.length === 0 || admin.rows[0].id === userId) return res.json({ success: false });
        await pool.query('DELETE FROM users WHERE id=$1', [userId]);
        res.json({ success: true });
    } catch (err) { res.json({ success: false }); }
});

app.post('/api/get-or-create-chat', async (req, res) => { /* без изменений */
    const { userId, otherUserId } = req.body;
    try {
        const existing = await pool.query(`SELECT c.id FROM chats c JOIN chat_participants p1 ON c.id=p1.chat_id JOIN chat_participants p2 ON c.id=p2.chat_id WHERE p1.user_id=$1 AND p2.user_id=$2 AND (SELECT COUNT(*) FROM chat_participants WHERE chat_id=c.id)=2`, [userId, otherUserId]);
        if (existing.rows.length > 0) return res.json({ success: true, chatId: existing.rows[0].id });
        const nc = await pool.query('INSERT INTO chats DEFAULT VALUES RETURNING id');
        await pool.query('INSERT INTO chat_participants (chat_id, user_id) VALUES ($1,$2),($1,$3)', [nc.rows[0].id, userId, otherUserId]);
        res.json({ success: true, chatId: nc.rows[0].id });
    } catch (err) { res.json({ success: false }); }
});

app.get('/api/chats', async (req, res) => { /* без изменений */
    const { userId } = req.query;
    try {
        const pc = await pool.query(`SELECT c.id, u.id as other_user_id, u.name as other_user_name, u.avatar_url as other_user_avatar, 'private' as type, (SELECT text FROM messages WHERE chat_id=c.id ORDER BY timestamp DESC LIMIT 1) as last_message, (SELECT COUNT(*) FROM messages WHERE chat_id=c.id AND user_id!=$1 AND is_read=false) as unread FROM chats c JOIN chat_participants cp ON c.id=cp.chat_id JOIN users u ON cp.user_id=u.id WHERE c.id IN (SELECT chat_id FROM chat_participants WHERE user_id=$1) AND cp.user_id!=$1 AND c.id NOT IN (SELECT chat_id FROM groups) ORDER BY (SELECT timestamp FROM messages WHERE chat_id=c.id ORDER BY timestamp DESC LIMIT 1) DESC NULLS LAST`, [userId]);
        const gr = await pool.query(`SELECT g.chat_id as id, g.name as other_user_name, 'group' as type, (SELECT text FROM messages WHERE chat_id=g.chat_id ORDER BY timestamp DESC LIMIT 1) as last_message, (SELECT COUNT(*) FROM messages WHERE chat_id=g.chat_id AND user_id!=$1 AND is_read=false) as unread FROM groups g JOIN chat_participants cp ON g.chat_id=cp.chat_id WHERE cp.user_id=$1`, [userId]);
        res.json({ success: true, chats: [...pc.rows, ...gr.rows] });
    } catch (err) { res.json({ success: false }); }
});

app.post('/api/mark-read', async (req, res) => {
    try { await pool.query('UPDATE messages SET is_read=true WHERE chat_id=$1 AND user_id!=$2', [req.body.chatId, req.body.userId]); res.json({ success: true }); } 
    catch (err) { res.json({ success: false }); }
});

app.get('/api/news', async (req, res) => {
    try { const r = await pool.query('SELECT * FROM news ORDER BY created_at DESC LIMIT 10'); res.json({ success: true, news: r.rows }); } 
    catch (err) { res.json({ success: false }); }
});

app.post('/api/admin/news', async (req, res) => {
    const { adminEmail, title, content } = req.body;
    try { await pool.query('INSERT INTO news (title, content) VALUES ($1,$2)', [title, content]); res.json({ success: true }); } 
    catch (err) { res.json({ success: false }); }
});

app.delete('/api/admin/news/:id', async (req, res) => {
    try { await pool.query('DELETE FROM news WHERE id=$1', [req.params.id]); res.json({ success: true }); } 
    catch (err) { res.json({ success: false }); }
});

app.delete('/api/admin/schedule/:id', async (req, res) => {
    try { await pool.query('DELETE FROM schedule_lessons WHERE id=$1', [req.params.id]); res.json({ success: true }); } 
    catch (err) { res.json({ success: false }); }
});

app.get('/api/schedule/groups', async (req, res) => {
    try { const r = await pool.query('SELECT * FROM schedule_groups ORDER BY id'); res.json({ success: true, groups: r.rows }); } 
    catch (err) { res.json({ success: false }); }
});

app.get('/api/schedule', async (req, res) => { /* без изменений */
    try {
        const { groupId } = req.query;
        const query = groupId 
            ? `SELECT sl.*, sg.name as group_name FROM schedule_lessons sl LEFT JOIN schedule_groups sg ON sl.group_id=sg.id WHERE (sl.group_id=$1 OR sl.is_common=true) ORDER BY sl.lesson_date, sl.day_of_week, sl.start_time`
            : `SELECT sl.*, sg.name as group_name FROM schedule_lessons sl LEFT JOIN schedule_groups sg ON sl.group_id=sg.id ORDER BY sl.lesson_date, sl.day_of_week, sl.start_time`;
        const r = await pool.query(query, groupId ? [groupId] : []);
        res.json({ success: true, lessons: r.rows });
    } catch (err) { res.json({ success: false }); }
});

app.post('/api/admin/schedule', async (req, res) => { /* без изменений */
    const { groupId, days, startTime, endTime, title, eventType, lessonDate } = req.body;
    try {
        if (lessonDate) {
            await pool.query(`INSERT INTO schedule_lessons (group_id, start_time, end_time, title, event_type, lesson_date) VALUES ($1,$2,$3,$4,$5,$6)`, [groupId, startTime, endTime, title, eventType, lessonDate]);
        } else if (days) {
            for (const d of days) {
                await pool.query(`INSERT INTO schedule_lessons (group_id, day_of_week, start_time, end_time, title, event_type) VALUES ($1,$2,$3,$4,$5,$6)`, [groupId, d, startTime, endTime, title, eventType]);
            }
        }
        res.json({ success: true });
    } catch (err) { res.json({ success: false }); }
});

// ========== ХРАНИЛИЩЕ (ПРОСТОЙ РЕДИРЕКТ) ==========

app.get('/api/storage/file/:id/:type', async (req, res) => {
    const { id, type } = req.params;
    if (!['pdf', 'mp3', 'mp4'].includes(type)) return res.status(400).send('Неверный тип');
    try {
        const r = await pool.query(`SELECT ${type}_url as url FROM storage_items WHERE id=$1`, [id]);
        if (r.rows.length === 0 || !r.rows[0].url) return res.status(404).send('Нет файла');
        // Просто редиректим на Cloudinary
        res.redirect(r.rows[0].url);
    } catch (err) {
        res.status(500).send('Ошибка');
    }
});

app.get('/api/storage', async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM storage_items ORDER BY created_at DESC');
        res.json({ success: true, items: r.rows });
    } catch (err) { res.json({ success: false }); }
});

app.post('/api/admin/storage', upload.fields([
    { name: 'pdf', maxCount: 1 }, 
    { name: 'mp3', maxCount: 1 },
    { name: 'mp4', maxCount: 1 }
]), async (req, res) => {
    const { adminEmail, title } = req.body;
    try {
        const admin = await pool.query('SELECT * FROM users WHERE email=$1 AND role=$2', [adminEmail, 'admin']);
        if (admin.rows.length === 0) return res.json({ success: false, error: 'Нет прав' });
        if (!title || !title.trim()) return res.json({ success: false, error: 'Введите название' });

        let pdf_url = null, mp3_url = null, mp4_url = null;

        if (req.files?.pdf?.[0]) {
            try {
                const result = await uploadToCloudinary(req.files.pdf[0].buffer, 'pioneria_storage', 'image');
                pdf_url = result.secure_url;
                console.log('✅ PDF:', pdf_url);
            } catch (e) { return res.json({ success: false, error: 'Ошибка PDF: ' + e.message }); }
        }
        if (req.files?.mp3?.[0]) {
            try {
                const result = await uploadToCloudinary(req.files.mp3[0].buffer, 'pioneria_storage', 'video');
                mp3_url = result.secure_url;
            } catch (e) { return res.json({ success: false, error: 'Ошибка MP3' }); }
        }
        if (req.files?.mp4?.[0]) {
            try {
                const result = await uploadToCloudinary(req.files.mp4[0].buffer, 'pioneria_storage', 'video');
                mp4_url = result.secure_url;
            } catch (e) { return res.json({ success: false, error: 'Ошибка MP4' }); }
        }

        if (!pdf_url && !mp3_url && !mp4_url) return res.json({ success: false, error: 'Загрузите файл' });

        const r = await pool.query('INSERT INTO storage_items (title, pdf_url, mp3_url, mp4_url) VALUES ($1,$2,$3,$4) RETURNING id', [title.trim(), pdf_url, mp3_url, mp4_url]);
        res.json({ success: true, id: r.rows[0].id });
    } catch (err) {
        console.error('Ошибка хранилища:', err);
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

app.delete('/api/admin/storage/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM storage_items WHERE id=$1', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.json({ success: false }); }
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
        const finalChatId = msgChatId || null;

        const r = await pool.query('INSERT INTO messages (user_name, text, user_id, image_url, chat_id) VALUES ($1,$2,$3,$4,$5) RETURNING id', [userName, text, userId, imageUrl, finalChatId]);
        const msg = { id: r.rows[0].id, name: userName, text, user_id: userId, timestamp: new Date().toISOString(), image_url: imageUrl, chat_id: finalChatId };

        if (finalChatId) {
            const p = await pool.query('SELECT user_id FROM chat_participants WHERE chat_id=$1', [finalChatId]);
            p.rows.forEach(u => io.to(`user_${u.user_id}`).emit('message', msg));
        } else {
            io.emit('message', msg);
        }
    });

    socket.on('disconnect', () => { delete onlineUsers[socket.id]; });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`\n🚀 Сервер на порту ${PORT}`));
