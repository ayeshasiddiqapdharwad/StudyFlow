import { sendJson, HttpError } from '../utils/http.js';
import { toLocalDateString, offsetLocalDateString } from '../utils/dates.js';

export async function handleReportRoutes(req, res, ctx) {
  const { db, pathname, query, user } = ctx;

  if (pathname === '/api/reports' && req.method === 'GET') {
    const today = new Date();
    const defaultTo = toLocalDateString(today);
    const defaultFrom = offsetLocalDateString(-6, today);

    const from = String(query.from || defaultFrom).slice(0, 10);
    const to = String(query.to || defaultTo).slice(0, 10);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
      throw new HttpError(400, 'Please provide a valid date range (from <= to in YYYY-MM-DD).');
    }

    const sessions = db.prepare(`
      SELECT ss.id, ss.subject_id, ss.mode, ss.duration_minutes, ss.session_date, ss.notes,
             s.name AS subject_name, s.code AS subject_code, s.color AS subject_color
      FROM study_sessions ss
      LEFT JOIN subjects s ON s.id = ss.subject_id
      WHERE ss.user_id = ? AND ss.session_date BETWEEN ? AND ?
      ORDER BY ss.session_date DESC, ss.id DESC
    `).all(user.id, from, to);

    const completedTasks = db.prepare(`
      SELECT t.id, t.subject_id, t.title, t.due_date, t.priority, t.completed_at,
             s.name AS subject_name, s.code AS subject_code, s.color AS subject_color
      FROM tasks t
      LEFT JOIN subjects s ON s.id = t.subject_id
      WHERE t.user_id = ? AND t.status = 'completed'
        AND substr(COALESCE(t.completed_at, t.updated_at), 1, 10) BETWEEN ? AND ?
      ORDER BY t.completed_at DESC
    `).all(user.id, from, to);

    const dueInPeriod = db.prepare(`
      SELECT COUNT(*) AS count
      FROM tasks
      WHERE user_id = ? AND substr(due_date, 1, 10) BETWEEN ? AND ?
    `).get(user.id, from, to).count;

    const totalMinutes = sessions.reduce((sum, s) => sum + s.duration_minutes, 0);

    // Build subject-wise breakdown
    const subjectMap = new Map();
    const subjects = db.prepare('SELECT id, name, code, color FROM subjects WHERE user_id = ?').all(user.id);
    for (const subj of subjects) {
      subjectMap.set(subj.id, {
        subject_id: subj.id,
        subject_name: subj.name,
        subject_code: subj.code,
        subject_color: subj.color,
        study_minutes: 0,
        study_hours: 0,
        session_count: 0,
        completed_tasks: 0,
      });
    }
    const generalBucket = {
      subject_id: null,
      subject_name: 'General / Unassigned',
      subject_code: '',
      subject_color: '#64748b',
      study_minutes: 0,
      study_hours: 0,
      session_count: 0,
      completed_tasks: 0,
    };

    for (const s of sessions) {
      const bucket = s.subject_id && subjectMap.has(s.subject_id) ? subjectMap.get(s.subject_id) : generalBucket;
      bucket.study_minutes += s.duration_minutes;
      bucket.session_count += 1;
    }
    for (const t of completedTasks) {
      const bucket = t.subject_id && subjectMap.has(t.subject_id) ? subjectMap.get(t.subject_id) : generalBucket;
      bucket.completed_tasks += 1;
    }

    const bySubject = [...subjectMap.values(), generalBucket]
      .filter((b) => b.study_minutes > 0 || b.completed_tasks > 0 || b.subject_id !== null)
      .map((b) => ({
        ...b,
        study_hours: Number((b.study_minutes / 60).toFixed(2)),
      }))
      .sort((a, b) => b.study_minutes - a.study_minutes || b.completed_tasks - a.completed_tasks);

    // Daily trend
    const dailyMap = new Map();
    for (const s of sessions) {
      dailyMap.set(s.session_date, (dailyMap.get(s.session_date) || 0) + s.duration_minutes);
    }
    const dailyTrend = [...dailyMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, minutes]) => ({
        date,
        minutes,
        hours: Number((minutes / 60).toFixed(2)),
      }));

    sendJson(res, 200, {
      period: { from, to },
      totals: {
        study_minutes: totalMinutes,
        study_hours: Number((totalMinutes / 60).toFixed(2)),
        session_count: sessions.length,
        completed_tasks: completedTasks.length,
        tasks_due_in_period: dueInPeriod,
      },
      by_subject: bySubject,
      daily_trend: dailyTrend,
      sessions,
      completed_tasks: completedTasks,
    });
    return true;
  }

  return false;
}
