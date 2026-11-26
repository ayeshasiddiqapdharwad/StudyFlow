import { readJsonBody, sendJson, HttpError } from '../utils/http.js';
import { toLocalDateString } from '../utils/dates.js';

export async function handleSessionRoutes(req, res, ctx) {
  const { db, pathname, query, user } = ctx;

  if (pathname === '/api/sessions' && req.method === 'GET') {
    const conditions = ['ss.user_id = ?'];
    const params = [user.id];

    if (query.subject_id) {
      conditions.push('ss.subject_id = ?');
      params.push(Number(query.subject_id));
    }

    const sessions = db.prepare(`
      SELECT ss.*, s.name AS subject_name, s.code AS subject_code, s.color AS subject_color,
             t.title AS task_title
      FROM study_sessions ss
      LEFT JOIN subjects s ON s.id = ss.subject_id
      LEFT JOIN tasks t ON t.id = ss.task_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY ss.session_date DESC, ss.id DESC
      LIMIT 100
    `).all(...params);

    sendJson(res, 200, { sessions });
    return true;
  }

  if (pathname === '/api/sessions' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const subjectId = body.subject_id ? Number(body.subject_id) : null;
    const taskId = body.task_id ? Number(body.task_id) : null;
    const mode = body.mode === 'manual' ? 'manual' : 'timer';
    const durationMinutes = Math.round(Number(body.duration_minutes));
    const sessionDate = String(body.session_date || toLocalDateString()).slice(0, 10);
    const notes = String(body.notes || '').trim();

    if (!Number.isFinite(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440) {
      throw new HttpError(400, 'Duration must be between 1 and 1440 minutes.');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) {
      throw new HttpError(400, 'Session date must be in YYYY-MM-DD format.');
    }

    if (subjectId) {
      const ownsSubject = db.prepare('SELECT id FROM subjects WHERE id = ? AND user_id = ?').get(subjectId, user.id);
      if (!ownsSubject) throw new HttpError(400, 'Selected subject does not exist.');
    }
    if (taskId) {
      const ownsTask = db.prepare('SELECT id FROM tasks WHERE id = ? AND user_id = ?').get(taskId, user.id);
      if (!ownsTask) throw new HttpError(400, 'Selected task does not exist.');
    }

    const result = db.prepare(`
      INSERT INTO study_sessions (user_id, subject_id, task_id, mode, duration_minutes, session_date, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(user.id, subjectId, taskId, mode, durationMinutes, sessionDate, notes);

    const session = db.prepare(`
      SELECT ss.*, s.name AS subject_name, s.code AS subject_code, s.color AS subject_color,
             t.title AS task_title
      FROM study_sessions ss
      LEFT JOIN subjects s ON s.id = ss.subject_id
      LEFT JOIN tasks t ON t.id = ss.task_id
      WHERE ss.id = ?
    `).get(Number(result.lastInsertRowid));

    sendJson(res, 201, { session });
    return true;
  }

  const sessionMatch = pathname.match(/^\/api\/sessions\/(\d+)$/);
  if (sessionMatch && req.method === 'DELETE') {
    const sessionId = Number(sessionMatch[1]);
    const existing = db.prepare('SELECT id FROM study_sessions WHERE id = ? AND user_id = ?').get(sessionId, user.id);
    if (!existing) throw new HttpError(404, 'Study session not found.');
    db.prepare('DELETE FROM study_sessions WHERE id = ? AND user_id = ?').run(sessionId, user.id);
    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
}
