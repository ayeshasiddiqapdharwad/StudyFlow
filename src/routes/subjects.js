import { readJsonBody, sendJson, HttpError } from '../utils/http.js';
import { toLocalDateString } from '../utils/dates.js';

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function getStartOfWeekIso() {
  const now = new Date();
  const day = (now.getDay() + 6) % 7; // Monday = 0
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day);
  return toLocalDateString(monday);
}

/**
 * Fetch enriched subjects with syllabus completion percentage (FR5), task stats, and weekly study hours.
 */
export function listSubjectsWithProgress(db, userId) {
  const weekStart = getStartOfWeekIso();
  const subjects = db.prepare(`
    SELECT id, name, code, color, target_hours_weekly, created_at
    FROM subjects
    WHERE user_id = ?
    ORDER BY name ASC
  `).all(userId);

  const topicsStmt = db.prepare(`
    SELECT id, subject_id, title, is_completed, sort_order, completed_at
    FROM syllabus_topics
    WHERE subject_id = ? AND user_id = ?
    ORDER BY sort_order ASC, id ASC
  `);

  const taskStatsStmt = db.prepare(`
    SELECT
      COUNT(*) AS total_tasks,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_tasks
    FROM tasks
    WHERE subject_id = ? AND user_id = ?
  `);

  const hoursStmt = db.prepare(`
    SELECT COALESCE(SUM(duration_minutes), 0) AS total_minutes
    FROM study_sessions
    WHERE subject_id = ? AND user_id = ? AND session_date >= ?
  `);

  return subjects.map((subject) => {
    const topics = topicsStmt.all(subject.id, userId).map((t) => ({
      ...t,
      is_completed: Boolean(t.is_completed),
    }));
    const totalTopics = topics.length;
    const completedTopics = topics.filter((t) => t.is_completed).length;
    const syllabusPercent = totalTopics > 0 ? Math.round((completedTopics / totalTopics) * 100) : 0;

    const tStats = taskStatsStmt.get(subject.id, userId);
    const mins = hoursStmt.get(subject.id, userId).total_minutes || 0;

    return {
      ...subject,
      topics,
      syllabus_total: totalTopics,
      syllabus_completed: completedTopics,
      syllabus_percent: syllabusPercent,
      total_tasks: tStats.total_tasks || 0,
      completed_tasks: tStats.completed_tasks || 0,
      weekly_minutes: mins,
      weekly_hours: Number((mins / 60).toFixed(2)),
    };
  });
}

export async function handleSubjectRoutes(req, res, ctx) {
  const { db, pathname, user } = ctx;

  if (pathname === '/api/subjects' && req.method === 'GET') {
    sendJson(res, 200, { subjects: listSubjectsWithProgress(db, user.id) });
    return true;
  }

  if (pathname === '/api/subjects' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const name = String(body.name || '').trim();
    const code = String(body.code || '').trim();
    const color = String(body.color || '#4f46e5').trim();
    const targetHours = Number(body.target_hours_weekly ?? 5);

    if (!name) throw new HttpError(400, 'Subject name is required.');
    if (!HEX_COLOR_RE.test(color)) throw new HttpError(400, 'Subject color must be a valid hex code.');
    if (!Number.isFinite(targetHours) || targetHours < 0.5 || targetHours > 80) {
      throw new HttpError(400, 'Weekly target hours must be between 0.5 and 80.');
    }

    const result = db.prepare(`
      INSERT INTO subjects (user_id, name, code, color, target_hours_weekly)
      VALUES (?, ?, ?, ?, ?)
    `).run(user.id, name, code, color, targetHours);

    const subjectId = Number(result.lastInsertRowid);
    if (Array.isArray(body.topics)) {
      const insertTopic = db.prepare(`
        INSERT INTO syllabus_topics (subject_id, user_id, title, sort_order)
        VALUES (?, ?, ?, ?)
      `);
      body.topics.forEach((title, idx) => {
        const clean = String(title || '').trim();
        if (clean) insertTopic.run(subjectId, user.id, clean, idx);
      });
    }

    const subjects = listSubjectsWithProgress(db, user.id);
    const created = subjects.find((s) => s.id === subjectId);
    sendJson(res, 201, { subject: created });
    return true;
  }

  const subjectMatch = pathname.match(/^\/api\/subjects\/(\d+)$/);
  if (subjectMatch) {
    const subjectId = Number(subjectMatch[1]);
    const existing = db.prepare('SELECT id FROM subjects WHERE id = ? AND user_id = ?').get(subjectId, user.id);
    if (!existing) throw new HttpError(404, 'Subject not found.');

    if (req.method === 'PUT') {
      const body = await readJsonBody(req);
      const name = String(body.name || '').trim();
      const code = String(body.code ?? '').trim();
      const color = String(body.color || '#4f46e5').trim();
      const targetHours = Number(body.target_hours_weekly ?? 5);
      if (!name) throw new HttpError(400, 'Subject name is required.');
      if (!HEX_COLOR_RE.test(color)) throw new HttpError(400, 'Subject color must be a valid hex code.');
      if (!Number.isFinite(targetHours) || targetHours < 0.5 || targetHours > 80) {
        throw new HttpError(400, 'Weekly target hours must be between 0.5 and 80.');
      }

      db.prepare(`
        UPDATE subjects SET name = ?, code = ?, color = ?, target_hours_weekly = ?
        WHERE id = ? AND user_id = ?
      `).run(name, code, color, targetHours, subjectId, user.id);

      const updated = listSubjectsWithProgress(db, user.id).find((s) => s.id === subjectId);
      sendJson(res, 200, { subject: updated });
      return true;
    }

    if (req.method === 'DELETE') {
      db.prepare('DELETE FROM subjects WHERE id = ? AND user_id = ?').run(subjectId, user.id);
      sendJson(res, 200, { ok: true });
      return true;
    }
  }

  const addTopicMatch = pathname.match(/^\/api\/subjects\/(\d+)\/topics$/);
  if (addTopicMatch && req.method === 'POST') {
    const subjectId = Number(addTopicMatch[1]);
    const existing = db.prepare('SELECT id FROM subjects WHERE id = ? AND user_id = ?').get(subjectId, user.id);
    if (!existing) throw new HttpError(404, 'Subject not found.');

    const body = await readJsonBody(req);
    const title = String(body.title || '').trim();
    if (!title) throw new HttpError(400, 'Syllabus topic title is required.');

    const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM syllabus_topics WHERE subject_id = ?').get(subjectId).m;
    db.prepare(`
      INSERT INTO syllabus_topics (subject_id, user_id, title, sort_order)
      VALUES (?, ?, ?, ?)
    `).run(subjectId, user.id, title, maxOrder + 1);

    const updated = listSubjectsWithProgress(db, user.id).find((s) => s.id === subjectId);
    sendJson(res, 201, { subject: updated });
    return true;
  }

  const topicMatch = pathname.match(/^\/api\/syllabus-topics\/(\d+)$/);
  if (topicMatch) {
    const topicId = Number(topicMatch[1]);
    const topic = db.prepare('SELECT * FROM syllabus_topics WHERE id = ? AND user_id = ?').get(topicId, user.id);
    if (!topic) throw new HttpError(404, 'Syllabus topic not found.');

    if (req.method === 'PATCH') {
      const body = await readJsonBody(req);
      const isCompleted = body.is_completed !== undefined ? (body.is_completed ? 1 : 0) : (topic.is_completed ? 0 : 1);
      const title = body.title !== undefined ? String(body.title).trim() : topic.title;
      if (!title) throw new HttpError(400, 'Topic title cannot be empty.');

      db.prepare(`
        UPDATE syllabus_topics
        SET title = ?, is_completed = ?, completed_at = ?
        WHERE id = ? AND user_id = ?
      `).run(title, isCompleted, isCompleted ? new Date().toISOString() : null, topicId, user.id);

      const updatedSubject = listSubjectsWithProgress(db, user.id).find((s) => s.id === topic.subject_id);
      sendJson(res, 200, { subject: updatedSubject });
      return true;
    }

    if (req.method === 'DELETE') {
      db.prepare('DELETE FROM syllabus_topics WHERE id = ? AND user_id = ?').run(topicId, user.id);
      const updatedSubject = listSubjectsWithProgress(db, user.id).find((s) => s.id === topic.subject_id);
      sendJson(res, 200, { subject: updatedSubject });
      return true;
    }
  }

  return false;
}
