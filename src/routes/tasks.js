import { readJsonBody, sendJson, HttpError } from '../utils/http.js';
import { toLocalDateString } from '../utils/dates.js';

const DATE_PREFIX_RE = /^\d{4}-\d{2}-\d{2}/;

function localCompletedTimestamp() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${toLocalDateString(now)}T${hh}:${mm}:${ss}`;
}

function attachSubtasks(db, userId, tasks) {
  const subStmt = db.prepare(`
    SELECT id, task_id, title, is_completed, sort_order
    FROM subtasks
    WHERE task_id = ? AND user_id = ?
    ORDER BY sort_order ASC, id ASC
  `);

  return tasks.map((t) => {
    const subtasks = subStmt.all(t.id, userId).map((s) => ({
      ...s,
      is_completed: Boolean(s.is_completed),
    }));
    const totalSubtasks = subtasks.length;
    const completedSubtasks = subtasks.filter((s) => s.is_completed).length;
    return {
      ...t,
      subtasks,
      subtask_total: totalSubtasks,
      subtask_completed: completedSubtasks,
      subtask_percent: totalSubtasks > 0 ? Math.round((completedSubtasks / totalSubtasks) * 100) : (t.status === 'completed' ? 100 : 0),
    };
  });
}

function getTaskById(db, userId, taskId) {
  const row = db.prepare(`
    SELECT t.*, s.name AS subject_name, s.code AS subject_code, s.color AS subject_color
    FROM tasks t
    LEFT JOIN subjects s ON s.id = t.subject_id
    WHERE t.id = ? AND t.user_id = ?
  `).get(taskId, userId);
  if (!row) return null;
  return attachSubtasks(db, userId, [row])[0];
}

/**
 * Recalculate parent task completion status when subtasks change (FR7).
 */
function syncParentTaskFromSubtasks(db, userId, taskId) {
  const stats = db.prepare(`
    SELECT COUNT(*) AS total, SUM(CASE WHEN is_completed = 1 THEN 1 ELSE 0 END) AS done
    FROM subtasks
    WHERE task_id = ? AND user_id = ?
  `).get(taskId, userId);

  if (!stats || stats.total === 0) return;

  let nextStatus = 'pending';
  let completedAt = null;
  if (stats.done === stats.total) {
    nextStatus = 'completed';
    completedAt = localCompletedTimestamp();
  } else if (stats.done > 0) {
    nextStatus = 'in_progress';
  }

  db.prepare(`
    UPDATE tasks
    SET status = ?, completed_at = ?, updated_at = datetime('now')
    WHERE id = ? AND user_id = ?
  `).run(nextStatus, completedAt, taskId, userId);
}

export async function handleTaskRoutes(req, res, ctx) {
  const { db, pathname, query, user } = ctx;

  if (pathname === '/api/tasks' && req.method === 'GET') {
    const conditions = ['t.user_id = ?'];
    const params = [user.id];

    if (query.subject_id) {
      conditions.push('t.subject_id = ?');
      params.push(Number(query.subject_id));
    }
    if (query.status && ['pending', 'in_progress', 'completed'].includes(query.status)) {
      conditions.push('t.status = ?');
      params.push(query.status);
    }
    if (query.priority && ['low', 'medium', 'high'].includes(query.priority)) {
      conditions.push('t.priority = ?');
      params.push(query.priority);
    }

    const rows = db.prepare(`
      SELECT t.*, s.name AS subject_name, s.code AS subject_code, s.color AS subject_color
      FROM tasks t
      LEFT JOIN subjects s ON s.id = t.subject_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY
        CASE t.status WHEN 'completed' THEN 1 ELSE 0 END ASC,
        t.due_date ASC,
        CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END ASC
    `).all(...params);

    sendJson(res, 200, { tasks: attachSubtasks(db, user.id, rows) });
    return true;
  }

  if (pathname === '/api/tasks' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const title = String(body.title || '').trim();
    const description = String(body.description || '').trim();
    const dueDate = String(body.due_date || '').trim();
    const priority = ['low', 'medium', 'high'].includes(body.priority) ? body.priority : 'medium';
    const status = ['pending', 'in_progress', 'completed'].includes(body.status) ? body.status : 'pending';
    const subjectId = body.subject_id ? Number(body.subject_id) : null;
    const reminderMins = Number(body.reminder_minutes_before ?? 1440);

    if (!title) throw new HttpError(400, 'Task title is required.');
    if (!dueDate || !DATE_PREFIX_RE.test(dueDate)) throw new HttpError(400, 'Due date must start with YYYY-MM-DD.');
    if (!Number.isFinite(reminderMins) || reminderMins < 0 || reminderMins > 43200) {
      throw new HttpError(400, 'Reminder lead time must be between 0 and 43200 minutes.');
    }

    if (subjectId) {
      const ownsSubject = db.prepare('SELECT id FROM subjects WHERE id = ? AND user_id = ?').get(subjectId, user.id);
      if (!ownsSubject) throw new HttpError(400, 'Selected subject does not exist.');
    }

    const completedAt = status === 'completed' ? localCompletedTimestamp() : null;
    const result = db.prepare(`
      INSERT INTO tasks (user_id, subject_id, title, description, due_date, priority, status, reminder_minutes_before, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(user.id, subjectId, title, description, dueDate, priority, status, reminderMins, completedAt);

    const taskId = Number(result.lastInsertRowid);
    if (Array.isArray(body.subtasks)) {
      const insertSub = db.prepare(`
        INSERT INTO subtasks (task_id, user_id, title, sort_order)
        VALUES (?, ?, ?, ?)
      `);
      body.subtasks.forEach((st, idx) => {
        const subTitle = String(typeof st === 'string' ? st : st?.title || '').trim();
        if (subTitle) insertSub.run(taskId, user.id, subTitle, idx);
      });
    }

    sendJson(res, 201, { task: getTaskById(db, user.id, taskId) });
    return true;
  }

  const taskMatch = pathname.match(/^\/api\/tasks\/(\d+)$/);
  if (taskMatch) {
    const taskId = Number(taskMatch[1]);
    const existing = db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(taskId, user.id);
    if (!existing) throw new HttpError(404, 'Task not found.');

    if (req.method === 'PUT' || req.method === 'PATCH') {
      const body = await readJsonBody(req);
      const title = body.title !== undefined ? String(body.title).trim() : existing.title;
      const description = body.description !== undefined ? String(body.description).trim() : existing.description;
      const dueDate = body.due_date !== undefined ? String(body.due_date).trim() : existing.due_date;
      const priority = body.priority && ['low', 'medium', 'high'].includes(body.priority) ? body.priority : existing.priority;
      const status = body.status && ['pending', 'in_progress', 'completed'].includes(body.status) ? body.status : existing.status;
      const subjectId = body.subject_id !== undefined ? (body.subject_id ? Number(body.subject_id) : null) : existing.subject_id;
      const reminderMins = body.reminder_minutes_before !== undefined ? Number(body.reminder_minutes_before) : existing.reminder_minutes_before;

      if (!title) throw new HttpError(400, 'Task title cannot be empty.');
      if (!dueDate || !DATE_PREFIX_RE.test(dueDate)) throw new HttpError(400, 'Due date must start with YYYY-MM-DD.');
      if (!Number.isFinite(reminderMins) || reminderMins < 0 || reminderMins > 43200) {
        throw new HttpError(400, 'Reminder lead time must be between 0 and 43200 minutes.');
      }

      if (subjectId) {
        const ownsSubject = db.prepare('SELECT id FROM subjects WHERE id = ? AND user_id = ?').get(subjectId, user.id);
        if (!ownsSubject) throw new HttpError(400, 'Selected subject does not exist.');
      }

      const completedAt = status === 'completed'
        ? (existing.completed_at || localCompletedTimestamp())
        : null;

      db.prepare(`
        UPDATE tasks
        SET subject_id = ?, title = ?, description = ?, due_date = ?, priority = ?, status = ?,
            reminder_minutes_before = ?, completed_at = ?, updated_at = datetime('now')
        WHERE id = ? AND user_id = ?
      `).run(subjectId, title, description, dueDate, priority, status, reminderMins, completedAt, taskId, user.id);

      sendJson(res, 200, { task: getTaskById(db, user.id, taskId) });
      return true;
    }

    if (req.method === 'DELETE') {
      db.prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?').run(taskId, user.id);
      sendJson(res, 200, { ok: true });
      return true;
    }
  }

  const addSubMatch = pathname.match(/^\/api\/tasks\/(\d+)\/subtasks$/);
  if (addSubMatch && req.method === 'POST') {
    const taskId = Number(addSubMatch[1]);
    const existing = db.prepare('SELECT id FROM tasks WHERE id = ? AND user_id = ?').get(taskId, user.id);
    if (!existing) throw new HttpError(404, 'Task not found.');

    const body = await readJsonBody(req);
    const title = String(body.title || '').trim();
    if (!title) throw new HttpError(400, 'Subtask title is required.');

    const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM subtasks WHERE task_id = ?').get(taskId).m;
    db.prepare(`
      INSERT INTO subtasks (task_id, user_id, title, sort_order)
      VALUES (?, ?, ?, ?)
    `).run(taskId, user.id, title, maxOrder + 1);

    syncParentTaskFromSubtasks(db, user.id, taskId);
    sendJson(res, 201, { task: getTaskById(db, user.id, taskId) });
    return true;
  }

  const subMatch = pathname.match(/^\/api\/subtasks\/(\d+)$/);
  if (subMatch) {
    const subtaskId = Number(subMatch[1]);
    const sub = db.prepare('SELECT * FROM subtasks WHERE id = ? AND user_id = ?').get(subtaskId, user.id);
    if (!sub) throw new HttpError(404, 'Subtask not found.');

    if (req.method === 'PATCH') {
      const body = await readJsonBody(req);
      const isCompleted = body.is_completed !== undefined ? (body.is_completed ? 1 : 0) : (sub.is_completed ? 0 : 1);
      const title = body.title !== undefined ? String(body.title).trim() : sub.title;
      if (!title) throw new HttpError(400, 'Subtask title cannot be empty.');

      db.prepare('UPDATE subtasks SET title = ?, is_completed = ? WHERE id = ? AND user_id = ?')
        .run(title, isCompleted, subtaskId, user.id);

      syncParentTaskFromSubtasks(db, user.id, sub.task_id);
      sendJson(res, 200, { task: getTaskById(db, user.id, sub.task_id) });
      return true;
    }

    if (req.method === 'DELETE') {
      db.prepare('DELETE FROM subtasks WHERE id = ? AND user_id = ?').run(subtaskId, user.id);
      syncParentTaskFromSubtasks(db, user.id, sub.task_id);
      sendJson(res, 200, { task: getTaskById(db, user.id, sub.task_id) });
      return true;
    }
  }

  return false;
}
