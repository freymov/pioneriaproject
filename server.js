const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Раздаём статические файлы из папки public
app.use(express.static('public'));
// Для обработки JSON в запросах
app.use(express.json());

// ========== РАБОТА С ФАЙЛОМ ПОЛЬЗОВАТЕЛЕЙ ==========
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

// Создаём папку data, если её нет
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
}

// Создаём файл users.json, если его нет
if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, '[]');
}

// Функция для чтения пользователей
function getUsers() {
    try {
        const data = fs.readFileSync(USERS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        return [];
    }
}

// Функция для сохранения пользователя
function saveUser(user) {
    const users = getUsers();
    users.push(user);
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// Проверка, существует ли пользователь с таким email
function userExists(email) {
    const users = getUsers();
    return users.some(user => user.email === email);
}

// ========== API ДЛЯ РЕГИСТРАЦИИ И ВХОДА ==========

// Регистрация
app.post('/api/register', (req, res) => {
    const { name, email, password, accessKey } = req.body;
    
    // 🔑 КЛЮЧ ДОСТУПА - поменяй на своё слово!
    const CORRECT_ACCESS_KEY = 'ПИОНЕРИЯ2024';
    
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
        password // пока без шифрования
    };
    
    saveUser(newUser);
    res.json({ success: true });
});

// Вход
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

// ========== ЧАТ (SOCKET.IO) ==========

let onlineUsers = {}; // кто в чате сейчас

io.on('connection', (socket) => {
    console.log('Пользователь подключился:', socket.id);

    socket.on('user joined', (name) => {
        onlineUsers[socket.id] = name;
        socket.broadcast.emit('message', {
            name: 'Система',
            text: `Пользователь ${name} присоединился к чату.`
        });
    });

    socket.on('chat message', (msg) => {
        const userName = onlineUsers[socket.id] || 'Аноним';
        io.emit('message', {
            name: userName,
            text: msg
        });
    });

    socket.on('disconnect', () => {
        const userName = onlineUsers[socket.id];
        if (userName) {
            io.emit('message', {
                name: 'Система',
                text: `Пользователь ${userName} покинул чат.`
            });
            delete onlineUsers[socket.id];
        }
        console.log('Пользователь отключился:', socket.id);
    });
});

// ========== ЗАПУСК СЕРВЕРА ==========
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});