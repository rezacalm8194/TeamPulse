const CACHE = 'teampulse-v3';
self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => { self.clients.claim(); });
self.addEventListener('fetch', e => { if (!e.request.url.startsWith(self.location.origin)||e.request.url.includes('/api/')) return; e.respondWith(fetch(e.request).catch(()=>caches.match(e.request))); });
const _t = new Map();
self.addEventListener('message', e => {
  if (!e.data) return;
  if (e.data.type === 'SHOW_NOTIFICATION') {
    self.registration.showNotification(e.data.title, {body:e.data.body||'',icon:'/logo.png',tag:e.data.tag||'tp',requireInteraction:true,dir:'rtl',vibrate:[200,100,200]});
  }
  if (e.data.type === 'SCHEDULE_NOTIFICATIONS') {
    _t.forEach(t=>clearTimeout(t)); _t.clear();
    (e.data.notifications||[]).forEach(n => {
      if (n.delayMs>0&&n.delayMs<86400000) {
        _t.set(n.id,setTimeout(()=>{self.registration.showNotification(n.title,{body:n.body||'',icon:'/logo.png',tag:n.tag,requireInteraction:true,dir:'rtl',vibrate:[300,100,300],actions:[{action:'done',title:'✅ انجام شد'},{action:'snooze',title:'⏰ ۱۰ دقیقه دیگه'}]});_t.delete(n.id);},n.delayMs));
      }
    });
    console.log('[SW] Scheduled',e.data.notifications.length,'notifs');
  }
});

// ── Web Push از سرور ─────────────────────────────────────────
self.addEventListener('push', e => {
  if (!e.data) return;
  let data;
  try { data = e.data.json(); } catch { data = { title: '⏰ یادآور', body: e.data.text() }; }
  e.waitUntil(
    self.registration.showNotification(data.title || '⏰ یادآور TeamPulse', {
      body: data.body || '',
      icon: data.icon || '/logo.png',
      tag: data.tag || 'push-' + Date.now(),
      requireInteraction: true,
      dir: 'rtl',
      vibrate: [300, 100, 300],
      actions: [
        { action: 'open', title: '📋 مشاهده' },
        { action: 'dismiss', title: '✅ فهمیدم' }
      ]
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action==='snooze'){const n=e.notification;setTimeout(()=>self.registration.showNotification(n.title,{body:n.body,icon:'/logo.png',tag:n.tag+'-s',requireInteraction:true,dir:'rtl'}),600000);return;}
  e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(cl=>{for(const c of cl){if(c.url.includes('/app')&&'focus'in c)return c.focus();}return clients.openWindow('/app');}));
});
