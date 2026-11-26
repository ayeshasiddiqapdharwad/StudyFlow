import { readJsonBody, sendJson, HttpError } from '../utils/http.js';

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function timeToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export async function handleTimetableRoutes(req, res, ctx) {
  const { db, pathname, user } = ctx;

  if (pathname === '/api/timetable' && req.method === 'GET') {
    const slots = db.prepare(`
      SELECT ts.*, s.name AS subject_name, s.code AS subject_code, s.color AS subject_color
      FROM timetable_slots ts
      LEFT JOIN subjects s ON s.id = ts.subject_id
      WHERE ts.user_id = ?
      ORDER BY ts.day_of_week ASC, ts.start_time ASC
    `).all(user.id);

    sendJson(res, 200, { slots });
    return true;
  }

  if (pathname === '/api/timetable' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const title = String(body.title || '').trim();
    const slotType = ['class', 'study', 'lab', 'exam'].includes(body.slot_type) ? body.slot_type : 'study';
    const dayOfWeek = Number(body.day_of_week);
    const startTime = String(body.start_time || '').trim();
    const endTime = String(body.end_time || '').trim();
    const location = String(body.location || '').trim();
    const subjectId = body.subject_id ? Number(body.subject_id) : null;
    const reminderMins = Number(body.reminder_minutes_before ?? 30);

    if (!title) throw new HttpError(400, 'Slot title is required.');
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
      throw new HttpError(400, 'Day of week must be between 0 (Monday) and 6 (Sunday).');
    }
    if (!TIME_RE.test(startTime) || !TIME_RE.test(endTime)) {
      throw new HttpError(400, 'Start and end time must be in HH:MM (24h) format.');
    }
    if (timeToMinutes(endTime) <= timeToMinutes(startTime)) {
      throw new HttpError(400, 'End time must be after start time.');
    }

    if (subjectId) {
      const ownsSubject = db.prepare('SELECT id FROM subjects WHERE id = ? AND user_id = ?').get(subjectId, user.id);
      if (!ownsSubject) throw new HttpError(400, 'Selected subject does not exist.');
    }

    const result = db.prepare(`
      INSERT INTO timetable_slots (user_id, subject_id, title, slot_type, day_of_week, start_time, end_time, location, reminder_minutes_before)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(user.id, subjectId, title, slotType, dayOfWeek, startTime, endTime, location, reminderMins);

    const slot = db.prepare(`
      SELECT ts.*, s.name AS subject_name, s.code AS subject_code, s.color AS subject_color
      FROM timetable_slots ts
      LEFT JOIN subjects s ON s.id = ts.subject_id
      WHERE ts.id = ?
    `).get(Number(result.lastInsertRowid));

    sendJson(res, 201, { slot });
    return true;
  }

  const slotMatch = pathname.match(/^\/api\/timetable\/(\d+)$/);
  if (slotMatch) {
    const slotId = Number(slotMatch[1]);
    const existing = db.prepare('SELECT * FROM timetable_slots WHERE id = ? AND user_id = ?').get(slotId, user.id);
    if (!existing) throw new HttpError(404, 'Timetable slot not found.');

    if (req.method === 'PUT') {
      const body = await readJsonBody(req);
      const title = String(body.title ?? existing.title).trim();
      const slotType = ['class', 'study', 'lab', 'exam'].includes(body.slot_type) ? body.slot_type : existing.slot_type;
      const dayOfWeek = body.day_of_week !== undefined ? Number(body.day_of_week) : existing.day_of_week;
      const startTime = String(body.start_time ?? existing.start_time).trim();
      const endTime = String(body.end_time ?? existing.end_time).trim();
      const location = String(body.location ?? existing.location).trim();
      const subjectId = body.subject_id !== undefined ? (body.subject_id ? Number(body.subject_id) : null) : existing.subject_id;
      const reminderMins = body.reminder_minutes_before !== undefined ? Number(body.reminder_minutes_before) : existing.reminder_minutes_before;

      if (!title) throw new HttpError(400, 'Slot title is required.');
      if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
        throw new HttpError(400, 'Invalid day of week.');
      }
      if (!TIME_RE.test(startTime) || !TIME_RE.test(endTime) || timeToMinutes(endTime) <= timeToMinutes(startTime)) {
        throw new HttpError(400, 'Invalid start/end time range.');
      }
      if (!Number.isFinite(reminderMins) || reminderMins < 0 || reminderMins > 10080) {
        throw new HttpError(400, 'Reminder lead time must be between 0 and 10080 minutes.');
      }
      if (subjectId) {
        const ownsSubject = db.prepare('SELECT id FROM subjects WHERE id = ? AND user_id = ?').get(subjectId, user.id);
        if (!ownsSubject) throw new HttpError(400, 'Selected subject does not exist.');
      }

      db.prepare(`
        UPDATE timetable_slots
        SET subject_id = ?, title = ?, slot_type = ?, day_of_week = ?, start_time = ?, end_time = ?, location = ?, reminder_minutes_before = ?
        WHERE id = ? AND user_id = ?
      `).run(subjectId, title, slotType, dayOfWeek, startTime, endTime, location, reminderMins, slotId, user.id);

      const slot = db.prepare(`
        SELECT ts.*, s.name AS subject_name, s.code AS subject_code, s.color AS subject_color
        FROM timetable_slots ts
        LEFT JOIN subjects s ON s.id = ts.subject_id
        WHERE ts.id = ?
      `).get(slotId);

      sendJson(res, 200, { slot });
      return true;
    }

    if (req.method === 'DELETE') {
      db.prepare('DELETE FROM timetable_slots WHERE id = ? AND user_id = ?').run(slotId, user.id);
      sendJson(res, 200, { ok: true });
      return true;
    }
  }

  return false;
}
