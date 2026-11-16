// Минимальный service worker: нужен, чтобы сайт ставился на телефон как приложение. Ничего не кэширует.
self.addEventListener("install", e => self.skipWaiting());
self.addEventListener("activate", e => self.clients.claim());
self.addEventListener("fetch", () => {});
