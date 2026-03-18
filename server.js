const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let users = {};

io.on('connection', (socket) => {
    console.log('Пользователь подключился:', socket.id);

    socket.on('user joined', (name) => {
        users[socket.id] = name;
        socket.broadcast.emit('message', {
            name: 'Система',
            text: `Пользователь ${name} присоединился к чату.`
        });
    });

    socket.on('chat message', (msg) => {
        const userName = users[socket.id] || 'Аноним';
        io.emit('message', {
            name: userName,
            text: msg
        });
    });

    socket.on('disconnect', () => {
        const userName = users[socket.id];
        if (userName) {
            io.emit('message', {
                name: 'Система',
                text: `Пользователь ${userName} покинул чат.`
            });
            delete users[socket.id];
        }
        console.log('Пользователь отключился:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});