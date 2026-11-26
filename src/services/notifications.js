import { toLocalDateString } from '../utils/dates.js';

/**
 * Evaluate upcoming task deadlines and scheduled timetable sessions to generate
 * deduplicated reminder notifications (FR4).
 */
export function syncNotificationsForUser(db, userId, now = new Date()) {
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO notifications (user_id, source_type, source_id, dedup_key, title, message, trigger_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const tasks = db.prepare(`
    SELECT t.id, t.title, t.due_date, t.reminder_minutes_before, s.name AS subject_name
    FROM tasks t
    LEFT JOIN subjects s ON s.id = t.subject_id
    WHERE t.user_id = ? AND t.status != 'completed'
  `).all(userId);

  const nowMs = now.getTime();
  for (const task of tasks) {
    // Support YYYY-MM-DD (treated as 23:59 local) or full ISO datetime
    const dueMs = task.due_date.includes('T')
      ? new Date(task.due_date).getTime()
      : new Date(`${task.due_date}T23:59:00`).getTime();

    if (Number.isNaN(dueMs)) continue;

    const leadMs = (task.reminder_minutes_before ?? 1440) * 60 * 1000;
    const diffMs = dueMs - nowMs;

    if (diffMs < 0 && diffMs > -7 * 24 * 60 * 60 * 1000) {
      const subjectLabel = task.subject_name ? ` (${task.subject_name})` : '';
      insertStmt.run(
        userId,
        'task',
        task.id,
        `task-overdue-${task.id}-${task.due_date}`,
        `Overdue Task: ${task.title}`,
        `"${task.title}"${subjectLabel} was due on ${task.due_date.slice(0, 10)}.`,
        now.toISOString()
      );
    } else if (diffMs >= 0 && diffMs <= leadMs) {
      const hoursLeft = Math.max(1, Math.round(diffMs / (60 * 60 * 1000)));
      const timeText = diffMs < 60 * 60 * 1000
        ? `${Math.max(1, Math.round(diffMs / 60000))} min`
        : `${hoursLeft} hr${hoursLeft === 1 ? '' : 's'}`;
      const subjectLabel = task.subject_name ? ` (${task.subject_name})` : '';
      insertStmt.run(
        userId,
        'task',
        task.id,
        `task-due-${task.id}-${task.due_date}`,
        `Upcoming Deadline: ${task.title}`,
        `"${task.title}"${subjectLabel} is due in ${timeText}.`,
        now.toISOString()
      );
    }
  }

  // JS getDay(): 0=Sun..6=Sat -> map to 0=Mon..6=Sun
  const dayOfWeek = (now.getDay() + 6) % 7;
  const dateKey = toLocalDateString(now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const slots = db.prepare(`
    SELECT ts.id, ts.title, ts.slot_type, ts.start_time, ts.end_time, ts.location,
           ts.reminder_minutes_before, s.name AS subject_name
    FROM timetable_slots ts
    LEFT JOIN subjects s ON s.id = ts.subject_id
    WHERE ts.user_id = ? AND ts.day_of_week = ?
  `).all(userId, dayOfWeek);

  for (const slot of slots) {
    const [sh, sm] = slot.start_time.split(':').map(Number);
    const [eh, em] = slot.end_time.split(':').map(Number);
    if (Number.isNaN(sh) || Number.isNaN(sm)) continue;

    const startMin = sh * 60 + sm;
    const endMin = Number.isNaN(eh) ? startMin + 60 : eh * 60 + em;
    const leadMin = slot.reminder_minutes_before ?? 30;
    const minUntilStart = startMin - nowMinutes;

    if (minUntilStart <= leadMin && nowMinutes < endMin) {
      const whenText = minUntilStart > 0
        ? `starts in ${minUntilStart} min (${slot.start_time})`
        : `is in progress (${slot.start_time}–${slot.end_time})`;
      const locText = slot.location ? ` at ${slot.location}` : '';
      insertStmt.run(
        userId,
        'timetable',
        slot.id,
        `slot-${slot.id}-${dateKey}`,
        `Scheduled ${slot.slot_type}: ${slot.title}`,
        `${slot.title} ${whenText}${locText}.`,
        now.toISOString()
      );
    }
  }
}
