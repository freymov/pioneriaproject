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

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const resend = new Resend(process.env.RESEND_API_KEY);
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
                email_verified BOOLEAN DEFAULT FALSE,
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

        // Таблица для групп
        await pool.query(`
            CREATE TABLE IF NOT EXISTS groups (
                id SERIAL PRIMARY KEY,
                chat_id INTEGER REFERENCES chats(id) ON DELETE CASCADE,
                name VARCHAR(255) NOT NULL,
                created_by INTEGER REFERENCES users(id),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Таблица для закрепленных сообщений
        await pool.query(`
            CREATE TABLE IF NOT EXISTS pinned_messages (
                id SERIAL PRIMARY KEY,
                message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
                chat_id INTEGER REFERENCES chats(id) ON DELETE CASCADE,
                pinned_by INTEGER REFERENCES users(id),
                pinned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Добавляем поле edited в messages
        await pool.query(`
            ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited BOOLEAN DEFAULT FALSE
        `);
        
        const existing = await pool.query(
            "SELECT * FROM invite_keys WHERE key_code = 'ADMIN-PIONERIA-2025'"
        );
        
        if (existing.rows.length === 0) {
            await pool.query(
                "INSERT INTO invite_keys (key_code, role) VALUES ('ADMIN-PIONERIA-2025', 'admin')"
            );
            console.log('✅ Создан админ-ключ: ADMIN-PIONERIA-2025');
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

// ========== ВЕРИФИКАЦИЯ ПОЧТЫ ==========

app.post('/api/send-verification', async (req, res) => {
    const { email } = req.body;
    
    try {
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
        
        await pool.query(
            'INSERT INTO email_verifications (email, code, expires_at) VALUES ($1, $2, $3)',
            [email, code, expiresAt]
        );
        
        await resend.emails.send({
            from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
            to: email,
            subject: 'Подтверждение email | Pioneria Project',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto;">
                    <h2 style="color: #667eea;">Добро пожаловать в Pioneria Project!</h2>
                    <p>Ваш код подтверждения:</p>
                    <div style="font-size: 32px; font-weight: bold; background: #f0f0f0; padding: 20px; text-align: center; letter-spacing: 5px;">${code}</div>
                    <p>Код действителен 10 минут.</p>
                    <p>Если вы не регистрировались, проигнорируйте это письмо.</p>
                </div>
            `
        });
        
        res.json({ success: true });
    } catch (err) {
        console.error('❌ Ошибка отправки кода:', err);
        res.json({ success: false, error: 'Ошибка отправки письма' });
    }
});

app.post('/api/verify-email', async (req, res) => {
    const { email, code } = req.body;
    
    try {
        const result = await pool.query(
            'SELECT * FROM email_verifications WHERE email = $1 AND code = $2 AND expires_at > NOW()',
            [email, code]
        );
        
        if (result.rows.length === 0) {
            return res.json({ success: false, error: 'Неверный или просроченный код' });
        }
        
        await pool.query(
            'UPDATE users SET email_verified = true WHERE email = $1',
            [email]
        );
        
        await pool.query(
            'DELETE FROM email_verifications WHERE email = $1',
            [email]
        );
        
        res.json({ success: true });
    } catch (err) {
        console.error('❌ Ошибка верификации:', err);
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
        
        if (!user.email_verified) {
            return res.json({ success: false, error: 'Подтвердите email. Проверьте почту' });
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

app.post('/api/admin/delete-user', async (req, res) => {
    const { adminEmail, userId } = req.body;
    
    try {
        const admin = await pool.query(
            'SELECT * FROM users WHERE email = $1 AND role = $2',
            [adminEmail, 'admin']
        );
        
        if (admin.rows.length === 0) {
            return res.json({ success: false, error: 'Нет прав' });
        }
        
        if (admin.rows[0].id === userId) {
            return res.json({ success: false, error: 'Нельзя удалить свой аккаунт' });
        }
        
        await pool.query('DELETE FROM users WHERE id = $1', [userId]);
        
        res.json({ success: true });
    } catch (err) {
        console.error('❌ Ошибка удаления пользователя:', err);
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

app.get('/api/users', async (req, res) => {
    try {
        const users = await pool.query(
            'SELECT id, name, email, role FROM users ORDER BY name'
        );
        res.json({ success: true, users: users.rows });
    } catch (err) {
        console.error('❌ Ошибка получения пользователей:', err);
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

// ========== ЛИЧНЫЕ СООБЩЕНИЯ ==========

app.post('/api/get-or-create-chat', async (req, res) => {
    const { userId, otherUserId } = req.body;
    
    try {
        const existing = await pool.query(`
            SELECT c.id FROM chats c
            JOIN chat_participants p1 ON c.id = p1.chat_id
            JOIN chat_participants p2 ON c.id = p2.chat_id
            WHERE p1.user_id = $1 AND p2.user_id = $2
            AND (SELECT COUNT(*) FROM chat_participants WHERE chat_id = c.id) = 2
        `, [userId, otherUserId]);
        
        if (existing.rows.length > 0) {
            return res.json({ success: true, chatId: existing.rows[0].id });
        }
        
        const newChat = await pool.query(
            'INSERT INTO chats DEFAULT VALUES RETURNING id'
        );
        const chatId = newChat.rows[0].id;
        
        await pool.query(
            'INSERT INTO chat_participants (chat_id, user_id) VALUES ($1, $2), ($1, $3)',
            [chatId, userId, otherUserId]
        );
        
        res.json({ success: true, chatId });
    } catch (err) {
        console.error('❌ Ошибка создания диалога:', err);
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

// ========== ЛИЧНЫЕ СООБЩЕНИЯ И ГРУППЫ ==========
app.get('/api/chats', async (req, res) => {
    const { userId } = req.query;
    
    try {
        // Личные чаты
        const privateChats = await pool.query(`
            SELECT 
                c.id,
                u.id as other_user_id,
                u.name as other_user_name,
                u.role as other_user_role,
                'private' as type,
                (SELECT text FROM messages WHERE chat_id = c.id ORDER BY timestamp DESC LIMIT 1) as last_message,
                (SELECT timestamp FROM messages WHERE chat_id = c.id ORDER BY timestamp DESC LIMIT 1) as last_message_time,
                (SELECT COUNT(*) FROM messages WHERE chat_id = c.id AND user_id != $1 AND is_read = false) as unread_count
            FROM chats c
            JOIN chat_participants cp ON c.id = cp.chat_id
            JOIN users u ON cp.user_id = u.id
            WHERE c.id IN (
                SELECT chat_id FROM chat_participants WHERE user_id = $1
            ) AND cp.user_id != $1
            AND c.id NOT IN (SELECT chat_id FROM groups)
            ORDER BY last_message_time DESC NULLS LAST
        `, [userId]);
        
        // Группы
        const groups = await pool.query(`
            SELECT 
                g.chat_id as id,
                g.name as other_user_name,
                'group' as type,
                (SELECT text FROM messages WHERE chat_id = g.chat_id ORDER BY timestamp DESC LIMIT 1) as last_message,
                (SELECT timestamp FROM messages WHERE chat_id = g.chat_id ORDER BY timestamp DESC LIMIT 1) as last_message_time,
                (SELECT COUNT(*) FROM messages WHERE chat_id = g.chat_id AND user_id != $1 AND is_read = false) as unread_count
            FROM groups g
            JOIN chat_participants cp ON g.chat_id = cp.chat_id
            WHERE cp.user_id = $1
            ORDER BY last_message_time DESC NULLS LAST
        `, [userId]);
        
        const chats = [...privateChats.rows, ...groups.rows];
        res.json({ success: true, chats });
    } catch (err) {
        console.error('❌ Ошибка загрузки диалогов:', err);
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

app.post('/api/mark-read', async (req, res) => {
    const { chatId, userId } = req.body;
    
    try {
        await pool.query(
            'UPDATE messages SET is_read = true WHERE chat_id = $1 AND user_id != $2 AND is_read = false',
            [chatId, userId]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('❌ Ошибка отметки прочитанных:', err);
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

// ========== НОВОСТИ ==========

app.get('/api/news', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM news ORDER BY created_at DESC LIMIT 10'
        );
        res.json({ success: true, news: result.rows });
    } catch (err) {
        console.error('❌ Ошибка загрузки новостей:', err);
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

app.post('/api/admin/news', async (req, res) => {
    const { adminEmail, title, content } = req.body;
    
    if (!title || !content) {
        return res.json({ success: false, error: 'Заполните заголовок и текст' });
    }
    
    try {
        const admin = await pool.query(
            'SELECT * FROM users WHERE email = $1 AND role = $2',
            [adminEmail, 'admin']
        );
        
        if (admin.rows.length === 0) {
            return res.json({ success: false, error: 'Нет прав' });
        }
        
        await pool.query(
            'INSERT INTO news (title, content) VALUES ($1, $2)',
            [title, content]
        );
        
        res.json({ success: true });
    } catch (err) {
        console.error('❌ Ошибка создания новости:', err);
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

app.delete('/api/admin/news/:id', async (req, res) => {
    const { adminEmail } = req.body;
    const newsId = req.params.id;
    
    try {
        const admin = await pool.query(
            'SELECT * FROM users WHERE email = $1 AND role = $2',
            [adminEmail, 'admin']
        );
        
        if (admin.rows.length === 0) {
            return res.json({ success: false, error: 'Нет прав' });
        }
        
        await pool.query('DELETE FROM news WHERE id = $1', [newsId]);
        
        res.json({ success: true });
    } catch (err) {
        console.error('❌ Ошибка удаления новости:', err);
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

// ========== УДАЛЕНИЕ СООБЩЕНИЙ ==========
app.post('/api/delete-message', async (req, res) => {
    const { messageId, userId, userRole, imageUrl } = req.body;
    
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
        await pool.query(
            'UPDATE users SET name = $1 WHERE id = $2',
            [newName, userId]
        );
        
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

// ========== ПОСЛЕДНЕЕ СООБЩЕНИЕ ОБЩЕГО ЧАТА ==========
app.get('/api/general-last-message', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, user_name as name, text, user_id, image_url, timestamp 
             FROM messages 
             WHERE chat_id IS NULL 
             ORDER BY timestamp DESC 
             LIMIT 1`
        );
        
        if (result.rows.length > 0) {
            res.json({ success: true, message: result.rows[0] });
        } else {
            res.json({ success: true, message: null });
        }
    } catch (err) {
        console.error('❌ Ошибка загрузки последнего сообщения общего чата:', err);
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});


// ========== РЕДАКТИРОВАНИЕ СООБЩЕНИЯ ==========
app.post('/api/edit-message', async (req, res) => {
    const { messageId, newText, userId, userRole } = req.body;
    
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
            return res.json({ success: false, error: 'Нет прав на редактирование' });
        }
        
        await pool.query(
            'UPDATE messages SET text = $1, edited = true WHERE id = $2',
            [newText, messageId]
        );
        
        io.emit('message edited', { messageId, newText });
        
        res.json({ success: true });
    } catch (err) {
        console.error('❌ Ошибка редактирования:', err);
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

// ========== ЗАКРЕПЛЕНИЕ СООБЩЕНИЯ ==========
app.post('/api/pin-message', async (req, res) => {
    const { messageId, chatId, userId, userRole } = req.body;
    
    try {
        const isAdmin = userRole === 'admin';
        
        if (!isAdmin && chatId !== null) {
            const groupCreator = await pool.query(
                'SELECT created_by FROM groups WHERE chat_id = $1',
                [chatId]
            );
            if (groupCreator.rows.length > 0 && groupCreator.rows[0].created_by !== userId) {
                return res.json({ success: false, error: 'Только создатель группы может закреплять сообщения' });
            }
        }
        
        const existing = await pool.query(
            'SELECT * FROM pinned_messages WHERE message_id = $1',
            [messageId]
        );
        
        if (existing.rows.length > 0) {
            await pool.query('DELETE FROM pinned_messages WHERE message_id = $1', [messageId]);
            io.emit('message pinned', { messageId, pinned: false });
            res.json({ success: true, pinned: false });
        } else {
            await pool.query(
                'INSERT INTO pinned_messages (message_id, chat_id, pinned_by) VALUES ($1, $2, $3)',
                [messageId, chatId, userId]
            );
            io.emit('message pinned', { messageId, pinned: true });
            res.json({ success: true, pinned: true });
        }
    } catch (err) {
        console.error('❌ Ошибка закрепления:', err);
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

// ========== ПОЛУЧИТЬ ЗАКРЕПЛЕННЫЕ СООБЩЕНИЯ ==========
app.get('/api/get-pinned', async (req, res) => {
    const { chatId } = req.query;
    
    try {
        const result = await pool.query(
            `SELECT pm.*, m.text, m.user_name 
             FROM pinned_messages pm
             JOIN messages m ON pm.message_id = m.id
             WHERE pm.chat_id = $1
             ORDER BY pm.pinned_at DESC`,
            [chatId]
        );
        res.json({ success: true, pinned: result.rows });
    } catch (err) {
        console.error('❌ Ошибка получения закрепленных:', err);
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

// ========== СОЗДАНИЕ ГРУППЫ ==========
app.post('/api/create-group', async (req, res) => {
    const { name, creatorId, members } = req.body;
    
    try {
        const chatResult = await pool.query(
            'INSERT INTO chats DEFAULT VALUES RETURNING id'
        );
        const chatId = chatResult.rows[0].id;
        
        await pool.query(
            'INSERT INTO groups (chat_id, name, created_by, created_at) VALUES ($1, $2, $3, NOW())',
            [chatId, name, creatorId]
        );
        
        const allMembers = [creatorId, ...members];
        for (const userId of allMembers) {
            await pool.query(
                'INSERT INTO chat_participants (chat_id, user_id) VALUES ($1, $2)',
                [chatId, userId]
            );
        }
        
        res.json({ success: true, chatId });
    } catch (err) {
        console.error('❌ Ошибка создания группы:', err);
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

// ========== ПЕРЕИМЕНОВАНИЕ ГРУППЫ ==========
app.post('/api/rename-group', async (req, res) => {
    const { chatId, newName, userId, userRole } = req.body;
    
    try {
        const isAdmin = userRole === 'admin';
        
        const group = await pool.query(
            'SELECT * FROM groups WHERE chat_id = $1',
            [chatId]
        );
        
        if (group.rows.length === 0) {
            return res.json({ success: false, error: 'Группа не найдена' });
        }
        
        if (!isAdmin && group.rows[0].created_by !== userId) {
            return res.json({ success: false, error: 'Только создатель группы может переименовывать' });
        }
        
        await pool.query(
            'UPDATE groups SET name = $1 WHERE chat_id = $2',
            [newName, chatId]
        );
        
        res.json({ success: true });
    } catch (err) {
        console.error('❌ Ошибка переименования группы:', err);
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

// ========== ПОЛУЧИТЬ СПИСОК ГРУПП ПОЛЬЗОВАТЕЛЯ ==========
app.get('/api/user-groups', async (req, res) => {
    const { userId } = req.query;
    
    try {
        const result = await pool.query(
            `SELECT g.chat_id, g.name, g.created_by, 
                    (SELECT text FROM messages WHERE chat_id = g.chat_id ORDER BY timestamp DESC LIMIT 1) as last_message,
                    (SELECT COUNT(*) FROM messages WHERE chat_id = g.chat_id AND user_id != $1 AND is_read = false) as unread_count
             FROM groups g
             JOIN chat_participants cp ON g.chat_id = cp.chat_id
             WHERE cp.user_id = $1
             ORDER BY g.created_at DESC`,
            [userId]
        );
        
        res.json({ success: true, groups: result.rows });
    } catch (err) {
        console.error('❌ Ошибка получения групп:', err);
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

// ========== ЧАТ ==========
let onlineUsers = {};

async function getMessageHistory(chatId = null) {
    try {
        let query, params;
        if (chatId) {
            query = 'SELECT id, user_name as name, text, user_id, image_url, timestamp FROM messages WHERE chat_id = $1 ORDER BY timestamp ASC LIMIT 100';
            params = [chatId];
        } else {
            query = 'SELECT id, user_name as name, text, user_id, image_url, timestamp FROM messages WHERE chat_id IS NULL ORDER BY timestamp ASC LIMIT 100';
            params = [];
        }
        const result = await pool.query(query, params);
        return result.rows;
    } catch (err) {
        console.error('❌ Ошибка загрузки истории:', err);
        return [];
    }
}

async function saveMessage(userName, text, userId, imageUrl = null, chatId = null) {
    try {
        const validUserId = (userId && typeof userId === 'number') ? userId : null;
        const validChatId = (chatId && typeof chatId === 'number') ? chatId : null;
        
        const result = await pool.query(
            'INSERT INTO messages (user_name, text, user_id, image_url, chat_id, is_read) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
            [userName, text, validUserId, imageUrl, validChatId, false]
        );
        console.log('✅ Сообщение сохранено, id:', result.rows[0].id);
        return result.rows[0].id;
    } catch (err) {
        console.error('❌ Ошибка сохранения сообщения:', err);
        return null;
    }
}

io.on('connection', async (socket) => {
    console.log('🔵 Подключился:', socket.id);
    
    const chatId = socket.handshake.query.chatId ? Number(socket.handshake.query.chatId) : null;
    let currentUser = null;

    const history = await getMessageHistory(chatId);
    socket.emit('message history', history);
    console.log('📤 Отправлено сообщений:', history.length);

    socket.on('user joined', (userData) => {
        currentUser = userData;
        onlineUsers[socket.id] = userData.name;
        socket.join(`user_${userData.id}`);
        console.log('👤 Вошёл:', userData.name, 'id:', userData.id);
    });

    socket.on('chat message', async (data) => {
        let text, messageChatId;
        if (typeof data === 'string') {
            text = data;
            messageChatId = chatId;
        } else {
            text = data.text;
            messageChatId = data.chatId ? Number(data.chatId) : chatId;
        }
        
        const userName = currentUser?.name || onlineUsers[socket.id] || 'Аноним';
        const userId = currentUser?.id ? Number(currentUser.id) : null;
        
        let imageUrl = null;
        if (text && text.startsWith('📷')) {
            imageUrl = text.replace('📷 ', '');
        }
        
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
            const participants = await pool.query(
                'SELECT user_id FROM chat_participants WHERE chat_id = $1',
                [finalChatId]
            );
            participants.rows.forEach(p => {
                io.to(`user_${p.user_id}`).emit('message', messageData);
            });
        } else {
            io.emit('message', messageData);
        }
    });

    socket.on('disconnect', () => {
        const userName = onlineUsers[socket.id];
        if (userName) {
            console.log('🔴 Отключился:', userName);
            delete onlineUsers[socket.id];
        }
    });
});
app.get('/test-email', async (req, res) => {
    try {
        const { data, error } = await resend.emails.send({
            from: 'hello@pioneriaproject.site',
            to: 'твой_личный_email@gmail.com',
            subject: 'Тест',
            html: '<p>Письмо идёт!</p>'
        });
        res.json({ success: true, data, error });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});
app.get('/fix-email-verified', async (req, res) => {
    try {
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE`);
        res.send('✅ Поле email_verified добавлено в users');
    } catch (err) {
        res.send('❌ Ошибка: ' + err.message);
    }
});


const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 Сервер запущен на порту ${PORT}`);
    console.log(`📁 База данных PostgreSQL подключена\n`);
});
