// public/service-worker.js
const CACHE_NAME = 'pioneria-v2';

self.addEventListener('install', (event) => {
    console.log('✅ Service Worker установлен');
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    console.log('✅ Service Worker активирован');
    event.waitUntil(clients.claim());
});

// 🔔 Получение push-уведомления
self.addEventListener('push', (event) => {
    console.log('📨 Push получен');
    
    let data = {
        title: 'Pioneria Messenger',
        body: 'Новое сообщение',
        icon: '/favicon.jpg',
        badge: '/favicon.jpg'
    };
    
    if (event.data) {
        try {
            const pushData = event.data.json();
            data.title = pushData.title || data.title;
            data.body = pushData.body || data.body;
            data.icon = pushData.icon || data.icon;
            data.badge = pushData.badge || data.badge;
            if (pushData.chatId) {
                data.data = { chatId: pushData.chatId };
            }
        } catch (e) {
            data.body = event.data.text();
        }
    }
    
    const options = {
        body: data.body,
        icon: data.icon,
        badge: data.badge,
        vibrate: [200, 100, 200],
        data: data.data || {},
        actions: [
            { action: 'open', title: 'Открыть' },
            { action: 'close', title: 'Закрыть' }
        ],
        requireInteraction: true,
        tag: 'pioneria-message'
    };
    
    event.waitUntil(
        self.registration.showNotification(data.title, options)
    );
});

// 🔔 Клик по уведомлению
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then((windowClients) => {
                // Ищем уже открытую вкладку
                for (let client of windowClients) {
                    if ('focus' in client) {
                        return client.focus();
                    }
                }
                // Открываем новую вкладку
                if (clients.openWindow) {
                    return clients.openWindow('/');
                }
            })
    );
});
