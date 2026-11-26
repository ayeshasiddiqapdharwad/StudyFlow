import { sendJson } from '../utils/http.js';
import { toLocalDateString } from '../utils/dates.js';
import { listSubjectsWithProgress } from './subjects.js';
import { syncNotificationsForUser } from '../services/notifications.js';

function getWeekBounds() {
  const now = new Date();
  const mondayOffset = (now.getDay() + 6) % 7;
  const days = [];
  const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  for (let i = 0; i < 7; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayOffset + i);
    days.push({
      date: toLocalDateString(d),
      label: labels[i],
    });
  }
  return {
    weekStart: days[0].date,
    weekEnd: days[6].date,
    days,
    todayDayOfWeek: mondayOffset,
    todayDate: toLocalDateString(now),
  };
}

export async function handleDashboardRoutes(req, res, ctx) {
  const { db, pathname, user } = ctx;

  if (pathname === '/api/dashboard' && req.method === 'GET') {
    syncNotificationsForUser(db, user.id);

    const { weekStart, weekEnd, days, todayDayOfWeek, todayDate } = getWeekBounds();

    const taskCounts = db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status != 'completed' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN status != 'completed' AND substr(due_date, 1, 10) < ? THEN 1 ELSE 0 END) AS overdue
      FROM tasks
      WHERE user_id = ?
    `).get(todayDate, user.id);

    const upcomingTasks = db.prepare(`
      SELECT t.*, s.name AS subject_name, s.code AS subject_code, s.color AS subject_color
      FROM tasks t
      LEFT JOIN subjects s ON s.id = t.subject_id
      WHERE t.user_id = ? AND t.status != 'completed'
      ORDER BY t.due_date ASC
      LIMIT 6
    `).all(user.id);

    const weeklyRows = db.prepare(`
      SELECT session_date, COALESCE(SUM(duration_minutes), 0) AS minutes
      FROM study_sessions
      WHERE user_id = ? AND session_date BETWEEN ? AND ?
      GROUP BY session_date
    `).all(user.id, weekStart, weekEnd);

    const minutesByDate = new Map(weeklyRows.map((r) => [r.session_date, r.minutes]));
    const weeklyChart = days.map((d) => ({
      date: d.date,
      label: d.label,
      minutes: minutesByDate.get(d.date) || 0,
      hours: Number(((minutesByDate.get(d.date) || 0) / 60).toFixed(2)),
    }));

    const weeklyTotalMinutes = weeklyChart.reduce((acc, d) => acc + d.minutes, 0);

    const todaySlots = db.prepare(`
      SELECT ts.*, s.name AS subject_name, s.code AS subject_code, s.color AS subject_color
      FROM timetable_slots ts
      LEFT JOIN subjects s ON s.id = ts.subject_id
      WHERE ts.user_id = ? AND ts.day_of_week = ?
      ORDER BY ts.start_time ASC
    `).all(user.id, todayDayOfWeek);

    const subjects = listSubjectsWithProgress(db, user.id);
    const unreadNotifications = db.prepare(`
      SELECT COUNT(*) AS count
      FROM notifications
      WHERE user_id = ? AND is_dismissed = 0 AND is_read = 0
    `).get(user.id).count;

    sendJson(res, 200, {
      summary: {
        pending_tasks: taskCounts.pending || 0,
        completed_tasks: taskCounts.completed || 0,
        overdue_tasks: taskCounts.overdue || 0,
        total_tasks: taskCounts.total || 0,
        weekly_study_minutes: weeklyTotalMinutes,
        weekly_study_hours: Number((weeklyTotalMinutes / 60).toFixed(2)),
        unread_notifications: unreadNotifications,
        today_date: todayDate,
      },
      upcoming_tasks: upcomingTasks,
      weekly_chart: weeklyChart,
      today_schedule: todaySlots,
      subjects,
    });
    return true;
  }

  return false;
}
