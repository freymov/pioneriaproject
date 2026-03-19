const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));
app.use(express.json());

// ========== ПУТИ К ФАЙЛАМ ==========
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');

// Создаём папку data, если нет
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
    console.log('📁 Создана папка data');
}

// ========== ФУНКЦИИ ДЛЯ ПОЛЬЗОВАТЕЛЕЙ ==========
function getUsers() {
    try {
        if (!fs.existsSync(USERS_FILE)) {
            return [];
        }
        const data = fs.readFileSync(USERS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        return [];
    }
}

function saveUser(user) {
    const users = getUsers();
    users.push(user);
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function userExists(email) {
    const users = getUsers();
    return users.some(user => user.email === email);
}

// ========== API ==========
app.post('/api/register', (req, res) => {
    const { name, email, password, accessKey } = req.body;
    
    const CORRECT_ACCESS_KEY = 'ПИОНЕРИЯ2026';
    
    if (accessKey !== CORRECT_ACCESS_KEY) {
        return res.json({ success: false, error: 'Неверный ключ доступа' });
    }
    
    if (userExists(email)) {
        return res.json({ success: false, error: 'Пользователь с таким email уже существует' });
    }
    
    const newUser = {
        id: Date.now().toString(),
        name,
        email,
        password
    };
    
    saveUser(newUser);
    res.json({ success: true });
});

app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    const users = getUsers();
    
    const user = users.find(u => u.email === email && u.password === password);
    
    if (user) {
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
});

// ========== ЧАТ ==========
let onlineUsers = {};

// Функции для сообщений
function saveMessage(message) {
    try {
        let messages = [];
        if (fs.existsSync(MESSAGES_FILE)) {
            messages = JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8'));
        }
        
        messages.push(message);
        
        if (messages.length > 100) {
            messages = messages.slice(-100);
        }
        
        fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));
        console.log('✅ Сообщение сохранено');
    } catch (err) {
        console.log('❌ Ошибка сохранения:', err.message);
    }
}

function loadMessages() {
    try {
        if (!fs.existsSync(MESSAGES_FILE)) {
            return [];
        }
        return JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8'));
    } catch (err) {
        return [];
    }
}

io.on('connection', (socket) => {
    console.log('🔵 Подключился:', socket.id);

    // Отправляем историю сообщений
    const history = loadMessages();
    socket.emit('message history', history);
    console.log('📤 Отправлено сообщений:', history.length);

    socket.on('user joined', (name) => {
        onlineUsers[socket.id] = name;
        console.log('👤 Вошёл:', name);
    });

    socket.on('chat message', (msg) => {
        const userName = onlineUsers[socket.id] || 'Аноним';
        console.log('💬 Сообщение от', userName, ':', msg);
        
        const messageData = {
            name: userName,
            text: msg,
            timestamp: new Date().toISOString()
        };
        
        // Сохраняем
        saveMessage(messageData);
        
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
    console.log(`📁 Папка data: ${DATA_DIR}\n`);
});