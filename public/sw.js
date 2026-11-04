// Crosswalk's service worker: it makes the page installable as an app (its
// own window, taskbar icon and Start menu entry). It keeps nothing: the city
// always comes live from the server on this machine.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', () => {})
