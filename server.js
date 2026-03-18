const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));
app.use(express.json());

let users = []; // Временное хранилище пользователей
let onlineUsers = {};

app.get('/', (req, res) => {
    res.redirect('/login');
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    
    if (users.find(u => u.username === username)) {
        return res.json({ success: false, message: 'Пользователь уже существует' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    
    users.push({
        username: username,
        password: hashedPassword
    });
    
    console.log('Зарегистрирован пользователь:', username);
    res.json({ success: true, message: 'Регистрация успешна' });
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    
    const user = users.find(u => u.username === username);
    
    if (!user) {
        return res.json({ success: false, message: 'Пользователь не найден' });
    }
    
    const validPassword = await bcrypt.compare(password, user.password);
    
    if (!validPassword) {
        return res.json({ success: false, message: 'Неверный пароль' });
    }
    
    console.log('Вошёл пользователь:', username);
    res.json({ success: true, message: 'Вход выполнен', username });
});

io.on('connection', (socket) => {
    console.log('Пользователь подключился:', socket.id);

    socket.on('user joined', (username) => {
        onlineUsers[socket.id] = username;
        socket.broadcast.emit('message', {
            name: 'Система',
            text: `Пользователь ${username} присоединился к чату.`
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});