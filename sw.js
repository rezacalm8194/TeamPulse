const CACHE = 'team-pulse-static-v167';
// Keep install tiny. Versioned JS/CSS are cached on first fetch via cacheFirst.
const CORE_ASSETS = [
  '/app',
  '/manifest.json',
  '/favicon.png',
  '/app-icon-192-v3.png',
  '/notification-badge.png',
  '/logo.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(CORE_ASSETS))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    clients.forEach(client => {
      if (client.postMessage) client.postMessage({ type: 'TP_SW_ACTIVATED', cache: CACHE });
    });
  })());
});

function isSameOrigin(request) {
  return new URL(request.url).origin === self.location.origin;
}

function isAppShellPath(pathname) {
  return pathname === '/app' || pathname.startsWith('/app/');
}

function shouldSkip(request) {
  const url = new URL(request.url);
  return request.method !== 'GET' ||
    !isSameOrigin(request) ||
    url.pathname === '/sw.js' ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/share/') ||
    url.pathname.startsWith('/blog');
}

function cacheableResponse(response) {
  return response && response.ok && response.type === 'basic';
}

async function networkFirstAppShell(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (cacheableResponse(response)) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    return cached || new Response('', {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (cacheableResponse(response)) cache.put(request, response.clone());
    return response;
  } catch {
    return new Response('', {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const fresh = fetch(request)
    .then(response => {
      if (cacheableResponse(response)) cache.put(request, response.clone());
      return response;
    })
    // event.respondWith() must always resolve to an actual Response. When the
    // browser is offline and this asset has never been cached, `cached` is
    // undefined; returning it makes Chrome report:
    // "Failed to convert value to 'Response'".
    .catch(() => cached || new Response('', {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    }));
  return cached || fresh;
}

function isVersionedAppBundle(url) {
  return url.pathname === '/app.js' || url.pathname === '/app-extra.js' || url.pathname === '/app.css' || url.pathname === '/tp-inline-bind.js';
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (shouldSkip(request)) return;
  const url = new URL(request.url);
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    // صفحه معرفی و بلاگ را از کش اپ جدا نگه دار؛ وگرنه HTML بدون استایل می‌آید.
    if (!isAppShellPath(url.pathname)) return;
    event.respondWith(networkFirstAppShell(request));
    return;
  }
  if (isVersionedAppBundle(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }
  event.respondWith(staleWhileRevalidate(request));
});

const _t = new Map();
const NOTIFICATION_ICON = new URL('/app-icon-192-v3.png', self.location.origin).href;
const NOTIFICATION_BADGE = new URL('/notification-badge.png', self.location.origin).href;
function notificationActionsFor(data) {
  return data?.kind === 'todo' && data?.todoId
    ? [
        { action: 'done', title: 'انجام شد' },
        { action: 'open', title: 'مشاهده' },
      ]
    : [
        { action: 'open', title: 'مشاهده' },
      ];
}

function assetUrl(value, fallback) {
  const raw = String(value || '').trim();
  if (!raw || raw.endsWith('.svg')) return fallback;
  try { return new URL(raw, self.location.origin).href; } catch { return fallback; }
}

async function displayAppNotification(title, options = {}) {
  const data = options.data || {};
  const attempts = [
    {
      body: options.body || '',
      icon: assetUrl(options.icon, NOTIFICATION_ICON),
      badge: NOTIFICATION_BADGE,
      tag: options.tag || 'tp',
      data,
      requireInteraction: true,
      renotify: true,
      silent: false,
      dir: 'rtl',
      lang: 'fa',
      vibrate: options.vibrate || [300, 100, 300],
      actions: options.actions || notificationActionsFor(data),
    },
    {
      body: options.body || '',
      icon: NOTIFICATION_ICON,
      badge: NOTIFICATION_BADGE,
      tag: options.tag || 'tp',
      data,
      requireInteraction: true,
      renotify: true,
    },
    {
      body: options.body || '',
      icon: NOTIFICATION_ICON,
      tag: options.tag || 'tp',
      data,
    },
  ];
  let lastError = null;
  for (const opts of attempts) {
    try {
      await self.registration.showNotification(title, opts);
      return;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('showNotification failed');
}

async function listWindowClients() {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true });
}

function hasFocusedAppWindow(clientList) {
  return clientList.some(client => client.focused && client.visibilityState === 'visible');
}

async function notifyOpenClients(payload, clientList) {
  const clients = clientList || await listWindowClients();
  clients.forEach(client => {
    if (client.postMessage) client.postMessage(payload);
  });
  return clients;
}

self.addEventListener('message', event => {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (event.data.type === 'SHOW_NOTIFICATION') {
    const data = event.data.data || {};
    event.waitUntil(displayAppNotification(event.data.title, {
      body: event.data.body || '',
      tag: event.data.tag || 'tp',
      data,
      vibrate: [200, 100, 200],
      actions: notificationActionsFor(data),
    }));
  }
  if (event.data.type === 'SCHEDULE_NOTIFICATIONS') {
    _t.forEach(timer => clearTimeout(timer));
    _t.clear();
    (event.data.notifications || []).forEach(notification => {
      if (notification.delayMs > 0 && notification.delayMs < 86400000) {
        _t.set(notification.id, setTimeout(() => {
          const data = notification.data || { todoId: notification.id, kind: 'todo' };
          displayAppNotification(notification.title, {
            body: notification.body || '',
            tag: notification.tag,
            data,
            actions: notificationActionsFor(data),
          }).catch(() => {});
          _t.delete(notification.id);
        }, notification.delayMs));
      }
    });
  }
});

self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let data = { title: 'یادآور TeamPulse', body: '' };
    try {
      if (event.data) data = event.data.json();
    } catch {
      data = { title: 'یادآور TeamPulse', body: event.data ? event.data.text() : '' };
    }
    const notificationData = {
      todoId: data.todoId || null,
      kind: data.kind || '',
      url: data.url || '/app#todolist',
    };
    const title = data.title || 'یادآور TeamPulse';
    const body = data.body || '';
    const tag = data.tag || 'push-' + Date.now();
    const clientList = await listWindowClients();
    const appInForeground = hasFocusedAppWindow(clientList);

    // Chrome requires a user-visible notification in every push event.
    // Always show the OS toast first; a focused tab may still hide it, and the
    // page then paints the in-app card. A background/closed window keeps the toast.
    await displayAppNotification(title, {
      body,
      icon: data.icon,
      badge: data.badge,
      tag,
      data: notificationData,
      actions: notificationActionsFor(notificationData),
    });

    await notifyOpenClients({
      type: 'PUSH_RECEIVED',
      title,
      body,
      tag,
      icon: data.icon,
      data: notificationData,
      appInForeground,
    }, clientList);
  })());
});

self.addEventListener('pushsubscriptionchange', event => {
  event.waitUntil(notifyOpenClients({ type: 'PUSH_SUBSCRIPTION_CHANGED' }));
});

async function focusOrOpenApp(targetUrl = '/app', navigateExisting = true) {
  const absoluteUrl = new URL(targetUrl, self.location.origin).href;
  const clientList = await clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clientList) {
    if (client.url.includes('/app') && 'focus' in client) {
      if (navigateExisting && 'navigate' in client && client.url !== absoluteUrl) await client.navigate(absoluteUrl);
      await client.focus();
      return client;
    }
  }
  return clients.openWindow(absoluteUrl);
}

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const data = event.notification.data || {};
  const tag = event.notification.tag || '';
  const todoId = data.todoId || (tag.startsWith('todo-') ? tag.slice(5) : null);
  const targetUrl = data.url || (data.kind === 'todo' ? '/app#todolist' : '/app');
  event.waitUntil(
    focusOrOpenApp(targetUrl, data.kind !== 'todo').then(client => {
      if (!client || !client.postMessage) return;
      if (data.kind === 'todo' && event.action === 'done' && todoId) {
        client.postMessage({ type: 'TODO_NOTIFICATION_DONE', todoId });
        return;
      }
      if (data.kind === 'todo') client.postMessage({ type: 'TODO_NOTIFICATION_VIEW', todoId });
    })
  );
});
