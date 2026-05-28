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
const upload = multer({ storage: multer.memoryStorage() });

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));
app.use(express.json());

app.get('/test-cloudinary', async (req, res) => {
    try {
        const result = await cloudinary.api.ping();
        res.json({ success: true, result });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

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

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
    console.error('❌ DATABASE_URL не найдена');
    process.exit(1);
}

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

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

async function initDatabase() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                role VARCHAR(50) DEFAULT 'user',
                email_verified BOOLEAN DEFAULT FALSE,
                avatar_url TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS email_verifications (
                id SERIAL PRIMARY KEY,
                email VARCHAR(255) NOT NULL,
                code VARCHAR(6) NOT NULL,
                expires_at TIMESTAMP NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS chats (
                id SERIAL PRIMARY KEY,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS chat_participants (
                chat_id INTEGER REFERENCES chats(id) ON DELETE CASCADE,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                PRIMARY KEY (chat_id, user_id)
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY,
                user_name VARCHAR(100) NOT NULL,
                text TEXT NOT NULL,
                user_id INTEGER REFERENCES users(id),
                image_url TEXT,
                chat_id INTEGER REFERENCES chats(id),
                is_read BOOLEAN DEFAULT FALSE,
                edited BOOLEAN DEFAULT FALSE,
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
        await pool.query(`
            CREATE TABLE IF NOT EXISTS news (
                id SERIAL PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                content TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS settings (
                key VARCHAR(100) PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS groups (
                id SERIAL PRIMARY KEY,
                chat_id INTEGER REFERENCES chats(id) ON DELETE CASCADE,
                name VARCHAR(255) NOT NULL,
                created_by INTEGER REFERENCES users(id),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS pinned_messages (
                id SERIAL PRIMARY KEY,
                message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
                chat_id INTEGER REFERENCES chats(id) ON DELETE CASCADE,
                pinned_by INTEGER REFERENCES users(id),
                pinned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS push_subscriptions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                subscription JSONB NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id)
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS user_settings (
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                setting_key VARCHAR(100) NOT NULL,
                setting_value TEXT NOT NULL,
                PRIMARY KEY (user_id, setting_key)
            )
        `);

        // Расписание
        await pool.query(`
            CREATE TABLE IF NOT EXISTS schedule_groups (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                color VARCHAR(7) DEFAULT '#667eea',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        try {
            await pool.query(`ALTER TABLE schedule_lessons DROP CONSTRAINT IF EXISTS schedule_lessons_day_of_week_check`);
        } catch(e) {}

        await pool.query(`
            CREATE TABLE IF NOT EXISTS schedule_lessons (
                id SERIAL PRIMARY KEY,
                group_id INTEGER REFERENCES schedule_groups(id) ON DELETE CASCADE,
                day_of_week INTEGER CHECK (day_of_week IS NULL OR (day_of_week BETWEEN 0 AND 6)),
                start_time TIME NOT NULL,
                end_time TIME,
                title VARCHAR(255) NOT NULL DEFAULT 'Репетиция',
                description TEXT,
                is_common BOOLEAN DEFAULT FALSE,
                status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
                event_type VARCHAR(20) DEFAULT 'rehearsal',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        try {
            await pool.query(`ALTER TABLE schedule_lessons ALTER COLUMN day_of_week DROP NOT NULL`);
        } catch(e) {}

        await pool.query(`ALTER TABLE schedule_lessons ADD COLUMN IF NOT EXISTS lesson_date DATE`);

        // Хранилище
        await pool.query(`
            CREATE TABLE IF NOT EXISTS storage_items (
                id SERIAL PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                pdf_url TEXT,
                mp3_url TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT`);
        
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(50) UNIQUE`);
        try {
            await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username) WHERE username IS NOT NULL`);
        } catch(e) {}

        const groupsExist = await pool.query('SELECT COUNT(*) FROM schedule_groups');
        if (parseInt(groupsExist.rows[0].count) === 0) {
            await pool.query(`
                INSERT INTO schedule_groups (name, color) VALUES 
                ('Утренняя группа', '#f59e0b'),
                ('Группа 16:00', '#667eea'),
                ('Группа 17:30', '#8b5cf6')
            `);
            console.log('✅ Созданы группы расписания');
        }

        const existing = await pool.query("SELECT * FROM invite_keys WHERE key_code = 'ADMIN-PIONERIA-2025'");
        if (existing.rows.length === 0) {
            await pool.query("INSERT INTO invite_keys (key_code, role) VALUES ('ADMIN-PIONERIA-2025', 'admin')");
            console.log('✅ Админ-ключ создан');
        }

        console.log('✅ База данных готова');
    } catch (err) {
        console.error('❌ Ошибка инициализации базы:', err);
    }
}

initDatabase();

// ========== API ==========

app.get('/api/push/public-key', (req, res) => {
    res.json({ publicKey: vapidKeys.publicKey });
});

app.post('/api/push/subscribe', async (req, res) => {
    const { userId, subscription } = req.body;
    if (!userId || !subscription) return res.json({ success: false, error: 'Нет данных' });
    try {
        await pool.query(
            `INSERT INTO push_subscriptions (user_id, subscription) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET subscription = $2`,
            [userId, JSON.stringify(subscription)]
        );
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, error: 'Ошибка сервера' });
    }
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
        await pool.query('INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, $4) RETURNING id', [name, email, hashedPassword, key.role]);
        await pool.query('UPDATE invite_keys SET used_by = $1, used_at = NOW() WHERE key_code = $2', [email, accessKey]);
        res.json({ success: true });
    } catch (err) {
        console.error('❌ Ошибка регистрации:', err);
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

app.post('/api/send-verification', async (req, res) => {
    const { email } = req.body;
    try {
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
        await pool.query('INSERT INTO email_verifications (email, code, expires_at) VALUES ($1, $2, $3)', [email, code, expiresAt]);
        await resend.emails.send({
            from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
            to: email,
            subject: 'Подтверждение email | Pioneria Project',
            html: `<div style="font-family:Arial;max-width:500px;margin:0 auto;"><h2 style="color:#667eea;">Добро пожаловать!</h2><p>Код:</p><div style="font-size:32px;font-weight:bold;background:#f0f0f0;padding:20px;text-align:center;letter-spacing:5px;">${code}</div><p>Действителен 10 минут.</p></div>`
        });
        res.json({ success: true });
    } catch (err) {
        console.error('❌ Ошибка отправки кода:', err);
        res.json({ success: false, error: 'Ошибка' });
    }
});

app.post('/api/verify-email', async (req, res) => {
    const { email, code } = req.body;
    try {
        const result = await pool.query('SELECT * FROM email_verifications WHERE email = $1 AND code = $2 AND expires_at > NOW()', [email, code]);
        if (result.rows.length === 0) return res.json({ success: false, error: 'Неверный или просроченный код' });
        await pool.query('UPDATE users SET email_verified = true WHERE email = $1', [email]);
        await pool.query('DELETE FROM email_verifications WHERE email = $1', [email]);
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (result.rows.length === 0) return res.json({ success: false, error: 'Неверный email или пароль' });
        const user = result.rows[0];
        const valid = await bcrypt.compare(password, user.password);
        if (!valid) return res.json({ success: false, error: 'Неверный email или пароль' });
        if (!user.email_verified) return res.json({ success: false, error: 'Подтвердите email' });
        res.json({ success: true, user: { 
            id: user.id, name: user.name, email: user.email, 
            role: user.role, avatar: user.avatar_url || null,
            username: user.username || null 
        }});
    } catch (err) {
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

app.post('/api/set-username', async (req, res) => {
    const { userId, username } = req.body;
    if (!userId || !username) return res.json({ success: false, error: 'Нет данных' });
    const valid = /^[a-zA-Z0-9_]{3,30}$/.test(username);
    if (!valid) return res.json({ success: false, error: 'Юзернейм: 3-30 символов (буквы, цифры, _)' });
    try {
        const exists = await pool.query('SELECT id FROM users WHERE username = $1 AND id != $2', [username, userId]);
        if (exists.rows.length > 0) return res.json({ success: false, error: 'Юзернейм занят' });
        await pool.query('UPDATE users SET username = $1 WHERE id = $2', [username, userId]);
        res.json({ success: true, username });
    } catch (err) {
        if (err.code === '23505') {
            res.json({ success: false, error: 'Юзернейм уже занят' });
        } else {
            console.error('❌ Ошибка set-username:', err);
            res.json({ success: false, error: 'Ошибка сервера' });
        }
    }
});

app.get('/api/search-users', async (req, res) => {
    const { q, userId } = req.query;
    if (!q || q.length < 1) return res.json({ success: true, users: [] });
    try {
        const result = await pool.query(
            `SELECT id, name, username, avatar_url, role 
             FROM users 
             WHERE id != $1 
               AND (username ILIKE $2 OR name ILIKE $2) 
             ORDER BY 
               CASE WHEN username ILIKE $2 THEN 0 ELSE 1 END,
               name 
             LIMIT 20`,
            [userId, `%${q}%`]
        );
        res.json({ success: true, users: result.rows });
    } catch (err) {
        console.error('❌ Ошибка search-users:', err);
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

app.get('/api/user/settings', async (req, res) => {
    const { userId, key } = req.query;
    try {
        const result = await pool.query('SELECT setting_value FROM user_settings WHERE user_id = $1 AND setting_key = $2', [userId, key]);
        res.json({ success: true, value: result.rows[0]?.setting_value || null });
    } catch (err) {
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

app.get('/api/user/:id', async (req, res) => {
    const userId = parseInt(req.params.id);
    if (isNaN(userId)) return res.json({ success: false, error: 'Неверный ID' });
    try {
        const result = await pool.query(
            'SELECT id, name, username, avatar_url, role, created_at FROM users WHERE id = $1',
            [userId]
        );
        if (result.rows.length === 0) return res.json({ success: false, error: 'Пользователь не найден' });
        res.json({ success: true, user: result.rows[0] });
    } catch (err) {
        console.error('❌ Ошибка user-profile:', err);
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

app.post('/api/admin/generate-keys', async (req, res) => {
    const { adminEmail, count, role } = req.body;
    try {
        const admin = await pool.query('SELECT * FROM users WHERE email = $1 AND role = $2', [adminEmail, 'admin']);
        if (admin.rows.length === 0) return res.json({ success: false, error: 'Нет прав' });
        const keys = [];
        for (let i = 0; i < count; i++) {
            const keyCode = `PIONERIA-${Date.now()}-${i}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
            await pool.query('INSERT INTO invite_keys (key_code, role) VALUES ($1, $2)', [keyCode, role || 'user']);
            keys.push(keyCode);
        }
        res.json({ success: true, keys });
    } catch (err) {
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

app.get('/api/admin/users', async (req, res) => {
    const { adminEmail } = req.query;
    try {
        const admin = await pool.query('SELECT * FROM users WHERE email = $1 AND role = $2', [adminEmail, 'admin']);
        if (admin.rows.length === 0) return res.json({ success: false, error: 'Нет прав' });
        const users = await pool.query('SELECT id, name, email, role, avatar_url, username, created_at FROM users ORDER BY created_at DESC');
        res.json({ success: true, users: users.rows });
    } catch (err) {
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

app.post('/api/admin/delete-user', async (req, res) => {
    const { adminEmail, userId } = req.body;
    try {
        const admin = await pool.query('SELECT * FROM users WHERE email = $1 AND role = $2', [adminEmail, 'admin']);
        if (admin.rows.length === 0) return res.json({ success: false, error: 'Нет прав' });
        if (admin.rows[0].id === userId) return res.json({ success: false, error: 'Нельзя удалить себя' });
        await pool.query('DELETE FROM users WHERE id = $1', [userId]);
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

app.get('/api/users', async (req, res) => {
    try {
        const users = await pool.query('SELECT id, name, email, role, avatar_url, username FROM users ORDER BY name');
        res.json({ success: true, users: users.rows });
    } catch (err) {
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

app.post('/api/get-or-create-chat', async (req, res) => {
    const { userId, otherUserId } = req.body;
    try {
        const existing = await pool.query(`SELECT c.id FROM chats c JOIN chat_participants p1 ON c.id = p1.chat_id JOIN chat_participants p2 ON c.id = p2.chat_id WHERE p1.user_id = $1 AND p2.user_id = $2 AND (SELECT COUNT(*) FROM chat_participants WHERE chat_id = c.id) = 2`, [userId, otherUserId]);
        if (existing.rows.length > 0) return res.json({ success: true, chatId: existing.rows[0].id });
        const newChat = await pool.query('INSERT INTO chats DEFAULT VALUES RETURNING id');
        const chatId = newChat.rows[0].id;
        await pool.query('INSERT INTO chat_participants (chat_id, user_id) VALUES ($1, $2), ($1, $3)', [chatId, userId, otherUserId]);
        res.json({ success: true, chatId });
    } catch (err) {
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

app.get('/api/chats', async (req, res) => {
    const { userId } = req.query;
    try {
        const privateChats = await pool.query(`SELECT c.id, u.id as other_user_id, u.name as other_user_name, u.username as other_user_username, u.role as other_user_role, u.avatar_url as other_user_avatar, 'private' as type, (SELECT text FROM messages WHERE chat_id = c.id ORDER BY timestamp DESC LIMIT 1) as last_message, (SELECT timestamp FROM messages WHERE chat_id = c.id ORDER BY timestamp DESC LIMIT 1) as last_message_time, (SELECT COUNT(*) FROM messages WHERE chat_id = c.id AND user_id != $1 AND is_read = false) as unread_count FROM chats c JOIN chat_participants cp ON c.id = cp.chat_id JOIN users u ON cp.user_id = u.id WHERE c.id IN (SELECT chat_id FROM chat_participants WHERE user_id = $1) AND cp.user_id != $1 AND c.id NOT IN (SELECT chat_id FROM groups) ORDER BY last_message_time DESC NULLS LAST`, [userId]);
        const groups = await pool.query(`SELECT g.chat_id as id, g.name as other_user_name, 'group' as type, (SELECT text FROM messages WHERE chat_id = g.chat_id ORDER BY timestamp DESC LIMIT 1) as last_message, (SELECT timestamp FROM messages WHERE chat_id = g.chat_id ORDER BY timestamp DESC LIMIT 1) as last_message_time, (SELECT COUNT(*) FROM messages WHERE chat_id = g.chat_id AND user_id != $1 AND is_read = false) as unread_count FROM groups g JOIN chat_participants cp ON g.chat_id = cp.chat_id WHERE cp.user_id = $1 ORDER BY last_message_time DESC NULLS LAST`, [userId]);
        res.json({ success: true, chats: [...privateChats.rows, ...groups.rows] });
    } catch (err) {
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

app.post('/api/mark-read', async (req, res) => {
    const { chatId, userId } = req.body;
    try {
        await pool.query('UPDATE messages SET is_read = true WHERE chat_id = $1 AND user_id != $2 AND is_read = false', [chatId, userId]);
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

app.get('/api/news', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM news ORDER BY created_at DESC LIMIT 10');
        res.json({ success: true, news: result.rows });
    } catch (err) {
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

app.post('/api/admin/news', async (req, res) => {
    const { adminEmail, title, content } = req.body;
    if (!title || !content) return res.json({ success: false, error: 'Заполните поля' });
    try {
        const admin = await pool.query('SELECT * FROM users WHERE email = $1 AND role = $2', [adminEmail, 'admin']);
        if (admin.rows.length === 0) return res.json({ success: false, error: 'Нет прав' });
        await pool.query('INSERT INTO news (title, content) VALUES ($1, $2)', [title, content]);
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

app.delete('/api/admin/news/:id', async (req, res) => {
    const { adminEmail } = req.body;
    const newsId = req.params.id;
    try {
        const admin = await pool.query('SELECT * FROM users WHERE email = $1 AND role = $2', [adminEmail, 'admin']);
        if (admin.rows.length === 0) return res.json({ success: false, error: 'Нет прав' });
        await pool.query('DELETE FROM news WHERE id = $1', [newsId]);
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

app.post('/api/delete-message', async (req, res) => {
    const { messageId, userId, userRole, imageUrl } = req.body;
    try {
        const msg = await pool.query('SELECT * FROM messages WHERE id = $1', [messageId]);
        if (msg.rows.length === 0) return res.json({ success: false, error: 'Не найдено' });
        const message = msg.rows[0];
        if (message.user_id !== userId && userRole !== 'admin') return res.json({ success: false, error: 'Нет прав' });
        if (imageUrl && imageUrl.includes('cloudinary.com')) {
            try {
                const publicId = imageUrl.split('/').pop().split('.')[0];
                await cloudinary.uploader.destroy(`pioneria_chat/${publicId}`);
            } catch (err) {}
        }
        await pool.query('DELETE FROM messages WHERE id = $1', [messageId]);
        io.emit('message deleted', messageId);
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

app.post('/api/update-name', async (req, res) => {
    const { userId, newName } = req.body;
    if (!userId || !newName) return res.json({ success: false, error: 'Нет данных' });
    try {
        await pool.query('UPDATE users SET name = $1 WHERE id = $2', [newName, userId]);
        await pool.query('UPDATE messages SET user_name = $1 WHERE user_id = $2', [newName, userId]);
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

app.post('/api/update-avatar', async (req, res) => {
    const { userId, avatarUrl } = req.body;
    if (!userId || !avatarUrl) return res.json({ success: false, error: 'Нет данных' });
    try {
        await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT');
        await pool.query('UPDATE users SET avatar_url = $1 WHERE id = $2', [avatarUrl, userId]);
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

app.get('/api/general-last-message', async (req, res) => {
    try {
        const result = await pool.query(`SELECT id, user_name as name, text, user_id, image_url, timestamp FROM messages WHERE chat_id IS NULL ORDER BY timestamp DESC LIMIT 1`);
        res.json({ success: true, message: result.rows[0] || null });
    } catch (err) {
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

app.post('/api/edit-message', async (req, res) => {
    const { messageId, newText, userId, userRole } = req.body;
    try {
        const msg = await pool.query('SELECT * FROM messages WHERE id = $1', [messageId]);
        if (msg.rows.length === 0) return res.json({ success: false, error: 'Не найдено' });
        if (msg.rows[0].user_id !== userId && userRole !== 'admin') return res.json({ success: false, error: 'Нет прав' });
        await pool.query('UPDATE messages SET text = $1, edited = true WHERE id = $2', [newText, messageId]);
        io.emit('message edited', { messageId, newText });
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

app.post('/api/pin-message', async (req, res) => {
    const { messageId, chatId, userId, userRole } = req.body;
    try {
        const msg = await pool.query('SELECT * FROM messages WHERE id = $1', [messageId]);
        if (msg.rows.length === 0) return res.json({ success: false, error: 'Сообщение не найдено' });
        if ((!chatId || chatId === 'null') && userRole !== 'admin') return res.json({ success: false, error: 'Только админ может закреплять в общем чате' });
        const dbChatId = (!chatId || chatId === 'null' || chatId === 'general') ? null : parseInt(chatId);
        const existing = await pool.query('SELECT * FROM pinned_messages WHERE message_id = $1', [messageId]);
        if (existing.rows.length > 0) {
            await pool.query('DELETE FROM pinned_messages WHERE message_id = $1', [messageId]);
            io.emit('message pinned', { messageId, pinned: false, chatId: dbChatId });
            return res.json({ success: true, pinned: false });
        } else {
            await pool.query('INSERT INTO pinned_messages (message_id, chat_id, pinned_by) VALUES ($1, $2, $3)', [messageId, dbChatId, userId]);
            io.emit('message pinned', { messageId, pinned: true, chatId: dbChatId });
            return res.json({ success: true, pinned: true });
        }
    } catch (err) {
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

app.get('/api/get-pinned', async (req, res) => {
    const { chatId } = req.query;
    try {
        let result;
        if (!chatId || chatId === 'general' || chatId === 'null') {
            result = await pool.query(`SELECT pm.*, m.text, m.user_name, m.user_id FROM pinned_messages pm JOIN messages m ON pm.message_id = m.id WHERE pm.chat_id IS NULL ORDER BY pm.pinned_at DESC`);
        } else {
            const numericChatId = parseInt(chatId);
            if (isNaN(numericChatId)) return res.json({ success: true, pinned: [] });
            result = await pool.query(`SELECT pm.*, m.text, m.user_name, m.user_id FROM pinned_messages pm JOIN messages m ON pm.message_id = m.id WHERE pm.chat_id = $1 ORDER BY pm.pinned_at DESC`, [numericChatId]);
        }
        res.json({ success: true, pinned: result.rows });
    } catch (err) {
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

app.post('/api/create-group', async (req, res) => {
    const { name, creatorId, members } = req.body;
    try {
        const chatResult = await pool.query('INSERT INTO chats DEFAULT VALUES RETURNING id');
        const chatId = chatResult.rows[0].id;
        await pool.query('INSERT INTO groups (chat_id, name, created_by) VALUES ($1, $2, $3)', [chatId, name, creatorId]);
        for (const userId of [creatorId, ...members]) {
            await pool.query('INSERT INTO chat_participants (chat_id, user_id) VALUES ($1, $2)', [chatId, userId]);
        }
        res.json({ success: true, chatId });
    } catch (err) {
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

app.post('/api/rename-group', async (req, res) => {
    const { chatId, newName, userId, userRole } = req.body;
    try {
        const group = await pool.query('SELECT * FROM groups WHERE chat_id = $1', [chatId]);
        if (group.rows.length === 0) return res.json({ success: false, error: 'Не найдена' });
        if (userRole !== 'admin' && group.rows[0].created_by !== userId) return res.json({ success: false, error: 'Нет прав' });
        await pool.query('UPDATE groups SET name = $1 WHERE chat_id = $2', [newName, chatId]);
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

app.get('/api/user-groups', async (req, res) => {
    const { userId } = req.query;
    try {
        const result = await pool.query(`SELECT g.chat_id, g.name, g.created_by, (SELECT text FROM messages WHERE chat_id = g.chat_id ORDER BY timestamp DESC LIMIT 1) as last_message, (SELECT COUNT(*) FROM messages WHERE chat_id = g.chat_id AND user_id != $1 AND is_read = false) as unread_count FROM groups g JOIN chat_participants cp ON g.chat_id = cp.chat_id WHERE cp.user_id = $1 ORDER BY g.created_at DESC`, [userId]);
        res.json({ success: true, groups: result.rows });
    } catch (err) {
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

app.get('/api/general-settings', async (req, res) => {
    try {
        const result = await pool.query("SELECT value FROM settings WHERE key = 'general_chat_name'");
        res.json({ success: true, name: result.rows[0]?.value || 'Общий чат' });
    } catch (err) {
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

app.post('/api/admin/update-general-chat', async (req, res) => {
    const { adminEmail, newName } = req.body;
    try {
        const admin = await pool.query('SELECT * FROM users WHERE email = $1 AND role = $2', [adminEmail, 'admin']);
        if (admin.rows.length === 0) return res.json({ success: false, error: 'Нет прав' });
        await pool.query(`INSERT INTO settings (key, value) VALUES ('general_chat_name', $1) ON CONFLICT (key) DO UPDATE SET value = $1`, [newName]);
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

app.post('/api/user/settings/save', async (req, res) => {
    const { userId, key, value } = req.body;
    try {
        await pool.query(`INSERT INTO user_settings (user_id, setting_key, setting_value) VALUES ($1, $2, $3) ON CONFLICT (user_id, setting_key) DO UPDATE SET setting_value = $3`, [userId, key, value]);
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

// ========== API РАСПИСАНИЯ ==========

app.get('/api/schedule/groups', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM schedule_groups ORDER BY id');
        res.json({ success: true, groups: result.rows });
    } catch (err) {
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

app.get('/api/schedule', async (req, res) => {
    const { groupId } = req.query;
    try {
        let lessons;
        if (groupId) {
            lessons = await pool.query(`
                SELECT sl.*, sg.name as group_name, sg.color as group_color
                FROM schedule_lessons sl
                LEFT JOIN schedule_groups sg ON sl.group_id = sg.id
                WHERE (sl.group_id = $1 OR sl.is_common = true OR sl.group_id IS NULL)
                ORDER BY sl.lesson_date ASC, sl.day_of_week ASC, sl.start_time ASC
            `, [groupId]);
        } else {
            lessons = await pool.query(`
                SELECT sl.*, sg.name as group_name, sg.color as group_color
                FROM schedule_lessons sl
                LEFT JOIN schedule_groups sg ON sl.group_id = sg.id
                ORDER BY sl.lesson_date ASC, sl.day_of_week ASC, sl.start_time ASC
            `);
        }
        res.json({ success: true, lessons: lessons.rows });
    } catch (err) {
        console.error('Ошибка загрузки расписания:', err);
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

app.post('/api/admin/schedule', async (req, res) => {
    const { adminEmail, groupId, days, startTime, endTime, title, description, isCommon, eventType, lessonDate } = req.body;
    try {
        const admin = await pool.query('SELECT * FROM users WHERE email = $1 AND role = $2', [adminEmail, 'admin']);
        if (admin.rows.length === 0) return res.json({ success: false, error: 'Нет прав' });

        const results = [];

        if (lessonDate) {
            const result = await pool.query(`
                INSERT INTO schedule_lessons (group_id, day_of_week, start_time, end_time, title, description, is_common, event_type, lesson_date)
                VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8) RETURNING id
            `, [groupId || null, startTime, endTime || null, title || 'Репетиция', description || '', isCommon || false, eventType || 'rehearsal', lessonDate]);
            results.push(result.rows[0].id);
        } else if (days && Array.isArray(days) && days.length > 0) {
            for (const dayOfWeek of days) {
                const result = await pool.query(`
                    INSERT INTO schedule_lessons (group_id, day_of_week, start_time, end_time, title, description, is_common, event_type)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id
                `, [groupId || null, dayOfWeek, startTime, endTime || null, title || 'Репетиция', description || '', isCommon || false, eventType || 'rehearsal']);
                results.push(result.rows[0].id);
            }
        } else {
            return res.json({ success: false, error: 'Укажите дни или конкретную дату' });
        }

        res.json({ success: true, ids: results });
    } catch (err) {
        console.error('Ошибка добавления:', err);
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

app.delete('/api/admin/schedule/:id', async (req, res) => {
    const { adminEmail } = req.body;
    try {
        const admin = await pool.query('SELECT * FROM users WHERE email = $1 AND role = $2', [adminEmail, 'admin']);
        if (admin.rows.length === 0) return res.json({ success: false, error: 'Нет прав' });
        await pool.query('DELETE FROM schedule_lessons WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

app.post('/api/admin/schedule/:id/status', async (req, res) => {
    const { adminEmail, status } = req.body;
    try {
        const admin = await pool.query('SELECT * FROM users WHERE email = $1 AND role = $2', [adminEmail, 'admin']);
        if (admin.rows.length === 0) return res.json({ success: false, error: 'Нет прав' });
        await pool.query('UPDATE schedule_lessons SET status = $1 WHERE id = $2', [status, req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

// ========== API ХРАНИЛИЩА ==========

app.get('/api/storage', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM storage_items ORDER BY created_at DESC');
        res.json({ success: true, items: result.rows });
    } catch (err) {
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

app.post('/api/admin/storage', upload.fields([{ name: 'pdf', maxCount: 1 }, { name: 'mp3', maxCount: 1 }]), async (req, res) => {
    const { adminEmail, title } = req.body;
    try {
        const admin = await pool.query('SELECT * FROM users WHERE email = $1 AND role = $2', [adminEmail, 'admin']);
        if (admin.rows.length === 0) return res.json({ success: false, error: 'Нет прав' });

        if (!title || !title.trim()) return res.json({ success: false, error: 'Введите название' });

        let pdf_url = null;
        let mp3_url = null;

        if (req.files && req.files.pdf) {
            const bufferStream = new stream.PassThrough();
            bufferStream.end(req.files.pdf[0].buffer);
            const result = await new Promise((resolve, reject) => {
                const uploadStream = cloudinary.uploader.upload_stream(
                    { folder: 'pioneria_storage', resource_type: 'auto' },
                    (error, result) => { if (error) reject(error); else resolve(result); }
                );
                bufferStream.pipe(uploadStream);
            });
            pdf_url = result.secure_url;
        }

        if (req.files && req.files.mp3) {
            const bufferStream = new stream.PassThrough();
            bufferStream.end(req.files.mp3[0].buffer);
            const result = await new Promise((resolve, reject) => {
                const uploadStream = cloudinary.uploader.upload_stream(
                    { folder: 'pioneria_storage', resource_type: 'auto' },
                    (error, result) => { if (error) reject(error); else resolve(result); }
                );
                bufferStream.pipe(uploadStream);
            });
            mp3_url = result.secure_url;
        }

        if (!pdf_url && !mp3_url) return res.json({ success: false, error: 'Загрузите хотя бы один файл' });

        const result = await pool.query(
            'INSERT INTO storage_items (title, pdf_url, mp3_url) VALUES ($1, $2, $3) RETURNING id',
            [title.trim(), pdf_url, mp3_url]
        );

        res.json({ success: true, id: result.rows[0].id });
    } catch (err) {
        console.error('Ошибка загрузки в хранилище:', err);
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

app.delete('/api/admin/storage/:id', async (req, res) => {
    const { adminEmail } = req.body;
    try {
        const admin = await pool.query('SELECT * FROM users WHERE email = $1 AND role = $2', [adminEmail, 'admin']);
        if (admin.rows.length === 0) return res.json({ success: false, error: 'Нет прав' });
        await pool.query('DELETE FROM storage_items WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

// ========== ЧАТ ==========
let onlineUsers = {};

async function getMessageHistory(chatId = null) {
    try {
        let query, params;
        if (chatId) {
            query = 'SELECT id, user_name as name, text, user_id, image_url, timestamp, edited FROM messages WHERE chat_id = $1 ORDER BY timestamp ASC LIMIT 100';
            params = [chatId];
        } else {
            query = 'SELECT id, user_name as name, text, user_id, image_url, timestamp, edited FROM messages WHERE chat_id IS NULL ORDER BY timestamp ASC LIMIT 100';
            params = [];
        }
        const result = await pool.query(query, params);
        return result.rows;
    } catch (err) {
        return [];
    }
}

async function saveMessage(userName, text, userId, imageUrl = null, chatId = null) {
    try {
        const result = await pool.query(
            'INSERT INTO messages (user_name, text, user_id, image_url, chat_id, is_read) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
            [userName, text, userId, imageUrl, chatId, false]
        );
        return result.rows[0].id;
    } catch (err) {
        return null;
    }
}

io.on('connection', async (socket) => {
    console.log('🔵 Подключился:', socket.id);
    const chatId = socket.handshake.query.chatId ? Number(socket.handshake.query.chatId) : null;
    let currentUser = null;

    const history = await getMessageHistory(chatId);
    socket.emit('message history', history);

    socket.on('user joined', (userData) => {
        currentUser = userData;
        onlineUsers[socket.id] = userData.name;
        socket.join(`user_${userData.id}`);
    });

    socket.on('chat message', async (data) => {
        let text = typeof data === 'string' ? data : data.text;
        let messageChatId = typeof data === 'string' ? chatId : (data.chatId ? Number(data.chatId) : chatId);
        const userName = currentUser?.name || onlineUsers[socket.id] || 'Аноним';
        const userId = currentUser?.id || null;
        let imageUrl = text?.startsWith('📷') ? text.replace('📷 ', '') : null;
        const finalChatId = messageChatId || null;
        const messageId = await saveMessage(userName, text, userId, imageUrl, finalChatId);

        const messageData = {
            id: messageId,
            name: userName,
            text: text,
            user_id: userId,
            timestamp: new Date().toISOString(),
            image_url: imageUrl,
            chat_id: finalChatId
        };

        if (finalChatId) {
            const participants = await pool.query('SELECT user_id FROM chat_participants WHERE chat_id = $1', [finalChatId]);
            for (const p of participants.rows) {
                io.to(`user_${p.user_id}`).emit('message', messageData);
                if (p.user_id !== userId) {
                    sendPushNotification(p.user_id, `💬 Чат · ${userName}`, text?.substring(0, 100) || 'Новое сообщение');
                }
            }
        } else {
            io.emit('message', messageData);
            const allUsers = await pool.query('SELECT id FROM users WHERE id != $1', [userId]);
            for (const u of allUsers.rows) {
                sendPushNotification(u.id, `🌐 Общий чат · ${userName}`, text?.substring(0, 100) || 'Новое сообщение');
            }
        }
    });

    socket.on('disconnect', () => {
        delete onlineUsers[socket.id];
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 Сервер запущен на порту ${PORT}`);
});
