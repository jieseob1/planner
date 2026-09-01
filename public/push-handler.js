self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'Goals to Today', body: event.data.text(), url: '/today', tag: 'nowline' };
  }
  event.waitUntil(self.registration.showNotification(payload.title || 'Goals to Today', {
    body: payload.body || '',
    icon: '/planner-mark.svg',
    badge: '/planner-mark.svg',
    tag: payload.tag || 'nowline',
    data: { url: payload.url || '/today' }
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/today', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    const existing = clients.find((client) => client.url === target);
    return existing ? existing.focus() : self.clients.openWindow(target);
  }));
});
