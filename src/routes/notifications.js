import { sendJson, HttpError } from '../utils/http.js';
import { syncNotificationsForUser } from '../services/notifications.js';

export async function handleNotificationRoutes(req, res, ctx) {
  const { db, pathname, user } = ctx;

  if (pathname === '/api/notifications' && req.method === 'GET') {
    syncNotificationsForUser(db, user.id);

    const notifications = db.prepare(`
      SELECT id, source_type, source_id, title, message, trigger_at, is_read, created_at
      FROM notifications
      WHERE user_id = ? AND is_dismissed = 0
      ORDER BY is_read ASC, id DESC
      LIMIT 40
    `).all(user.id).map((n) => ({
      ...n,
      is_read: Boolean(n.is_read),
    }));

    const unreadCount = notifications.filter((n) => !n.is_read).length;
    sendJson(res, 200, { notifications, unread_count: unreadCount });
    return true;
  }

  if (pathname === '/api/notifications/read-all' && req.method === 'POST') {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(user.id);
    sendJson(res, 200, { ok: true });
    return true;
  }

  const readMatch = pathname.match(/^\/api\/notifications\/(\d+)\/read$/);
  if (readMatch && req.method === 'PATCH') {
    const id = Number(readMatch[1]);
    const existing = db.prepare('SELECT id FROM notifications WHERE id = ? AND user_id = ?').get(id, user.id);
    if (!existing) throw new HttpError(404, 'Notification not found.');
    db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(id, user.id);
    sendJson(res, 200, { ok: true });
    return true;
  }

  const delMatch = pathname.match(/^\/api\/notifications\/(\d+)$/);
  if (delMatch && req.method === 'DELETE') {
    const id = Number(delMatch[1]);
    db.prepare('UPDATE notifications SET is_dismissed = 1 WHERE id = ? AND user_id = ?').run(id, user.id);
    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
}
