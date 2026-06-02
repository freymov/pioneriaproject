require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const stream = require('stream');
const { Resend } = require('resend');
const webpush = require('web-push');

// Cloudinary только для фото чата
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const vapidKeys = {
    publicKey: process.env.VAPID_PUBLIC_KEY,
    privateKey: process.env.VAPID_PRIVATE_KEY
};
webpush.setVapidDetails('mailto:admin@pioneriaproject.site', vapidKeys.publicKey, vapidKeys.privateKey);

const resend = new Resend(process.env.RESEND_API_KEY);
const chatUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const storageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));
app.use(express.json());

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// ========== БАЗА ДАННЫХ ==========
async function init() {
    await pool.query(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, name VARCHAR(100), email VARCHAR(255) UNIQUE, password VARCHAR(255), role VARCHAR(50) DEFAULT 'user', email_verified BOOLEAN DEFAULT FALSE, avatar_url TEXT, username VARCHAR(50), created_at TIMESTAMP DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS messages (id SERIAL PRIMARY KEY, user_name VARCHAR(100), text TEXT, user_id INTEGER, image_url TEXT, chat_id INTEGER, timestamp TIMESTAMP DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS invite_keys (id SERIAL PRIMARY KEY, key_code VARCHAR(100) UNIQUE, role VARCHAR(50) DEFAULT 'user', used_by VARCHAR(255), created_at TIMESTAMP DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS news (id SERIAL PRIMARY KEY, title VARCHAR(255), content TEXT, created_at TIMESTAMP DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS schedule_groups (id SERIAL PRIMARY KEY, name VARCHAR(100), color VARCHAR(7))`);
    await pool.query(`CREATE TABLE IF NOT EXISTS schedule_lessons (id SERIAL PRIMARY KEY, group_id INTEGER, day_of_week INTEGER, start_time TIME, end_time TIME, title VARCHAR(255), event_type VARCHAR(20), lesson_date DATE)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS storage_items (id SERIAL PRIMARY KEY, title VARCHAR(255), pdf_data BYTEA, pdf_name VARCHAR(255), mp3_data BYTEA, mp3_name VARCHAR(255), mp4_data BYTEA, mp4_name VARCHAR(255), created_at TIMESTAMP DEFAULT NOW())`);
    
    const g = await pool.query('SELECT COUNT(*) FROM schedule_groups');
    if (parseInt(g.rows[0].count) === 0) {
        await pool.query(`INSERT INTO schedule_groups (name, color) VALUES ('Утренняя','#f59e0b'),('16:00','#667eea'),('17:30','#8b5cf6')`);
    }
    console.log('✅ БД готова');
}
init();

// ========== ХРАНИЛИЩЕ (файлы в БД) ==========

// Получить список (без самих файлов, только названия)
app.get('/api/storage', async (req, res) => {
    try {
        const r = await pool.query('SELECT id, title, pdf_name, mp3_name, mp4_name, created_at FROM storage_items ORDER BY created_at DESC');
        const items = r.rows.map(item => ({
            id: item.id,
            title: item.title,
            has_pdf: !!item.pdf_name,
            has_mp3: !!item.mp3_name,
            has_mp4: !!item.mp4_name,
            pdf_name: item.pdf_name,
            mp3_name: item.mp3_name,
            mp4_name: item.mp4_name,
            created_at: item.created_at
        }));
        res.json({ success: true, items });
    } catch (e) {
        res.json({ success: false });
    }
});

// Скачать/посмотреть файл
app.get('/api/storage/file/:id/:type', async (req, res) => {
    const { id, type } = req.params;
    try {
        const col = type === 'pdf' ? 'pdf_data' : type === 'mp3' ? 'mp3_data' : 'mp4_data';
        const nameCol = type === 'pdf' ? 'pdf_name' : type === 'mp3' ? 'mp3_name' : 'mp4_name';
        
        const r = await pool.query(`SELECT ${col} as data, ${nameCol} as name FROM storage_items WHERE id=$1`, [id]);
        if (r.rows.length === 0 || !r.rows[0].data) return res.status(404).send('Файл не найден');
        
        const mime = { pdf: 'application/pdf', mp3: 'audio/mpeg', mp4: 'video/mp4' };
        res.setHeader('Content-Type', mime[type]);
        res.setHeader('Content-Disposition', `inline; filename="${r.rows[0].name}"`);
        res.send(r.rows[0].data);
    } catch (e) {
        res.status(500).send('Ошибка');
    }
});

// Загрузить файл (админ)
app.post('/api/admin/storage', storageUpload.fields([
    { name: 'pdf', maxCount: 1 }, { name: 'mp3', maxCount: 1 }, { name: 'mp4', maxCount: 1 }
]), async (req, res) => {
    const { title } = req.body;
    if (!title?.trim()) return res.json({ success: false, error: 'Введите название' });
    
    try {
        const pdf = req.files?.pdf?.[0];
        const mp3 = req.files?.mp3?.[0];
        const mp4 = req.files?.mp4?.[0];
        
        if (!pdf && !mp3 && !mp4) return res.json({ success: false, error: 'Загрузите файл' });
        
        await pool.query(
            'INSERT INTO storage_items (title, pdf_data, pdf_name, mp3_data, mp3_name, mp4_data, mp4_name) VALUES ($1,$2,$3,$4,$5,$6,$7)',
            [title.trim(), pdf?.buffer || null, pdf?.originalname || null, mp3?.buffer || null, mp3?.originalname || null, mp4?.buffer || null, mp4?.originalname || null]
        );
        res.json({ success: true });
    } catch (e) {
        console.error(e);
        res.json({ success: false, error: 'Ошибка' });
    }
});

// Удалить
app.delete('/api/admin/storage/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM storage_items WHERE id=$1', [req.params.id]);
        res.json({ success: true });
    } catch (e) { res.json({ success: false }); }
});

// ========== ОСТАЛЬНОЕ API (без изменений) ==========
app.get('/api/push/public-key', (req, res) => res.json({ publicKey: vapidKeys.publicKey }));
app.post('/api/register', async (req, res) => {
    const { name, email, password, accessKey } = req.body;
    try {
        const key = await pool.query('SELECT * FROM invite_keys WHERE key_code=$1 AND used_by IS NULL', [accessKey]);
        if (key.rows.length === 0) return res.json({ success: false, error: 'Неверный ключ' });
        const hash = await bcrypt.hash(password, 10);
        await pool.query('INSERT INTO users (name, email, password, role) VALUES ($1,$2,$3,$4)', [name, email, hash, key.rows[0].role]);
        await pool.query('UPDATE invite_keys SET used_by=$1, used_at=NOW() WHERE key_code=$2', [email, accessKey]);
        res.json({ success: true });
    } catch (e) { res.json({ success: false }); }
});
app.post('/api/login', async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM users WHERE email=$1', [req.body.email]);
        if (r.rows.length === 0 || !await bcrypt.compare(req.body.password, r.rows[0].password)) return res.json({ success: false });
        if (!r.rows[0].email_verified) return res.json({ success: false, error: 'Подтвердите email' });
        res.json({ success: true, user: { id: r.rows[0].id, name: r.rows[0].name, email: r.rows[0].email, role: r.rows[0].role, username: r.rows[0].username } });
    } catch (e) { res.json({ success: false }); }
});
app.get('/api/users', async (req, res) => {
    try { const r = await pool.query('SELECT id, name, email, role, username FROM users'); res.json({ success: true, users: r.rows }); } catch (e) { res.json({ success: false }); }
});
app.get('/api/news', async (req, res) => {
    try { const r = await pool.query('SELECT * FROM news ORDER BY created_at DESC LIMIT 10'); res.json({ success: true, news: r.rows }); } catch (e) { res.json({ success: false }); }
});
app.get('/api/schedule', async (req, res) => {
    try { const r = await pool.query('SELECT sl.*, sg.name as group_name FROM schedule_lessons sl LEFT JOIN schedule_groups sg ON sl.group_id=sg.id ORDER BY sl.lesson_date, sl.day_of_week, sl.start_time'); res.json({ success: true, lessons: r.rows }); } catch (e) { res.json({ success: false }); }
});
app.get('/api/schedule/groups', async (req, res) => {
    try { const r = await pool.query('SELECT * FROM schedule_groups'); res.json({ success: true, groups: r.rows }); } catch (e) { res.json({ success: false }); }
});
app.post('/api/upload', chatUpload.single('image'), async (req, res) => {
    try {
        const result = await new Promise((resolve, reject) => {
            cloudinary.uploader.upload_stream({ folder: 'pioneria_chat', resource_type: 'image' }, (e, r) => e ? reject(e) : resolve(r)).end(req.file.buffer);
        });
        res.json({ success: true, url: result.secure_url });
    } catch (e) { res.json({ success: false }); }
});
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
    try { const r = await pool.query('SELECT id, name, email, role, username, created_at FROM users ORDER BY created_at DESC'); res.json({ success: true, users: r.rows }); } catch (e) { res.json({ success: false }); }
});
app.post('/api/admin/news', async (req, res) => {
    try { await pool.query('INSERT INTO news (title, content) VALUES ($1,$2)', [req.body.title, req.body.content]); res.json({ success: true }); } catch (e) { res.json({ success: false }); }
});
app.post('/api/admin/schedule', async (req, res) => {
    const { groupId, days, startTime, endTime, title, eventType, lessonDate } = req.body;
    try {
        if (lessonDate) {
            await pool.query('INSERT INTO schedule_lessons (group_id, start_time, end_time, title, event_type, lesson_date) VALUES ($1,$2,$3,$4,$5,$6)', [groupId, startTime, endTime, title, eventType, lessonDate]);
        } else if (days) {
            for (const d of days) await pool.query('INSERT INTO schedule_lessons (group_id, day_of_week, start_time, end_time, title, event_type) VALUES ($1,$2,$3,$4,$5,$6)', [groupId, d, startTime, endTime, title, eventType]);
        }
        res.json({ success: true });
    } catch (e) { res.json({ success: false }); }
});

// Чат
io.on('connection', async (socket) => {
    const history = (await pool.query('SELECT * FROM messages WHERE chat_id IS NULL ORDER BY timestamp ASC LIMIT 100')).rows;
    socket.emit('message history', history);
    socket.on('chat message', async (data) => {
        const text = typeof data === 'string' ? data : data.text;
        const r = await pool.query('INSERT INTO messages (user_name, text, image_url) VALUES ($1,$2,$3) RETURNING id', ['Аноним', text, null]);
        io.emit('message', { id: r.rows[0].id, name: 'Аноним', text, timestamp: new Date().toISOString() });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`🚀 Сервер на порту ${PORT}`));
