import { api } from '../api.js';
import { escapeHtml, formatDate, formatMinutes, showToast } from '../utils.js';

export async function renderDashboardView(container, app) {
  const data = await api.dashboard();
  const { summary, upcoming_tasks, weekly_chart, today_schedule, subjects } = data;

  const avgSyllabus = subjects.length
    ? Math.round(subjects.reduce((acc, s) => acc + s.syllabus_percent, 0) / subjects.length)
    : 0;
  const maxBarMins = Math.max(60, ...weekly_chart.map((d) => d.minutes));

  container.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:0.75rem; margin-bottom:1.1rem;">
      <div>
        <h2 style="margin:0; font-size:1.35rem;">Welcome back, ${escapeHtml(app.user.full_name.split(' ')[0])}</h2>
        <p style="margin:0.15rem 0 0; color:var(--text-muted); font-size:0.9rem;">
          ${app.user.institution ? `${escapeHtml(app.user.institution)} · ` : ''}${formatDate(summary.today_date)}
        </p>
      </div>
      <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
        ${subjects.length === 0 ? `<button id="dash-seed-btn" class="btn">Load Sample Semester</button>` : ''}
        <button id="dash-open-ai" class="btn">✦ AI Study Assistant</button>
        <button id="dash-start-timer" class="btn btn-primary">Start Study Timer</button>
      </div>
    </div>

    <div class="card ai-banner" style="margin-bottom:1.1rem;">
      <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:0.75rem;">
        <div>
          <strong style="font-size:1rem;">✦ Gemini AI Study Assistant</strong>
          <div style="font-size:0.86rem; color:var(--text-muted); margin-top:0.15rem;">
            Ask academic questions, generate quizzes, summarize uploaded notes, or build a personalised study plan.
          </div>
        </div>
        <div style="display:flex; gap:0.45rem; flex-wrap:wrap;">
          <button class="btn btn-sm" data-ai-tab="chat">Ask AI Tutor</button>
          <button class="btn btn-sm" data-ai-tab="planner">AI Study Plan</button>
          <button class="btn btn-sm btn-primary" data-ai-tab="quiz">Generate Quiz</button>
        </div>
      </div>
    </div>

    <div class="grid grid-4" style="margin-bottom:1.1rem;">
      <div class="card stat-card">
        <span class="stat-label">Pending Tasks</span>
        <span class="stat-value tabular">${summary.pending_tasks}</span>
        <span class="stat-sub">${summary.completed_tasks} completed overall</span>
      </div>
      <div class="card stat-card">
        <span class="stat-label">Overdue Deadlines</span>
        <span class="stat-value tabular" style="color:${summary.overdue_tasks > 0 ? 'var(--danger)' : 'var(--success)'};">${summary.overdue_tasks}</span>
        <span class="stat-sub">${summary.overdue_tasks > 0 ? 'Needs attention' : 'All caught up'}</span>
      </div>
      <div class="card stat-card">
        <span class="stat-label">Weekly Study Hours</span>
        <span class="stat-value tabular">${summary.weekly_study_hours}h</span>
        <span class="stat-sub">${formatMinutes(summary.weekly_study_minutes)} logged this week</span>
      </div>
      <div class="card stat-card">
        <span class="stat-label">Avg Syllabus Progress</span>
        <span class="stat-value tabular">${avgSyllabus}%</span>
        <span class="stat-sub">Across ${subjects.length} subject${subjects.length === 1 ? '' : 's'}</span>
      </div>
    </div>

    <div class="grid grid-dashboard" style="margin-bottom:1.1rem;">
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">Upcoming Deadlines</h3>
          <button class="btn btn-sm" data-nav="tasks">View All Tasks</button>
        </div>
        ${
          upcoming_tasks.length === 0
            ? `<div class="empty-state">No pending tasks! Click <strong>+ New Task</strong> above to add one.</div>`
            : `<div style="display:flex; flex-direction:column; gap:0.55rem;">
                ${upcoming_tasks
                  .map((t) => {
                    const isOverdue = t.due_date.slice(0, 10) < summary.today_date;
                    return `
                      <div style="display:flex; align-items:center; justify-content:space-between; gap:0.75rem; padding:0.65rem 0.75rem; border:1px solid var(--border); border-radius:var(--radius-sm);">
                        <div style="display:flex; align-items:center; gap:0.6rem; min-width:0;">
                          <input type="checkbox" class="quick-complete-task" data-id="${t.id}" title="Mark complete" />
                          <div style="min-width:0;">
                            <div style="font-weight:600; font-size:0.93rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(t.title)}</div>
                            <div style="font-size:0.78rem; color:var(--text-muted); display:flex; align-items:center; gap:0.45rem; flex-wrap:wrap;">
                              ${t.subject_name ? `<span><span class="subject-dot" style="background:${escapeHtml(t.subject_color || '#4f46e5')}"></span> ${escapeHtml(t.subject_name)}</span>` : '<span>General</span>'}
                              <span>· Due ${formatDate(t.due_date)}</span>
                            </div>
                          </div>
                        </div>
                        <span class="badge ${isOverdue ? 'badge-danger' : `badge-${t.priority}`}">
                          ${isOverdue ? 'Overdue' : t.priority}
                        </span>
                      </div>
                    `;
                  })
                  .join('')}
              </div>`
        }
      </div>

      <div class="card">
        <div class="card-header">
          <h3 class="card-title">Weekly Study Hours (Mon–Sun)</h3>
          <button class="btn btn-sm" data-nav="reports">Full Report</button>
        </div>
        <div class="bar-chart">
          ${weekly_chart
            .map((d) => {
              const pct = Math.max(4, Math.round((d.minutes / maxBarMins) * 100));
              return `
                <div class="bar-col" title="${d.label}: ${formatMinutes(d.minutes)}">
                  <span class="bar-value tabular">${d.minutes > 0 ? `${d.hours}h` : '0'}</span>
                  <div class="bar-rect" style="height:${d.minutes > 0 ? pct : 4}%; opacity:${d.minutes > 0 ? 1 : 0.25};"></div>
                  <span class="bar-label">${d.label}</span>
                </div>
              `;
            })
            .join('')}
        </div>
      </div>
    </div>

    <div class="grid grid-2">
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">Today's Schedule</h3>
          <button class="btn btn-sm" data-nav="timetable">Weekly Calendar</button>
        </div>
        ${
          today_schedule.length === 0
            ? `<div class="empty-state">No classes or study blocks scheduled for today.</div>`
            : `<div style="display:flex; flex-direction:column; gap:0.55rem;">
                ${today_schedule
                  .map(
                    (s) => `
                  <div class="slot-card" style="border-left-color:${escapeHtml(s.subject_color || '#4f46e5')};">
                    <div style="display:flex; justify-content:space-between; gap:0.5rem;">
                      <strong>${escapeHtml(s.title)}</strong>
                      <span class="badge">${escapeHtml(s.slot_type)}</span>
                    </div>
                    <div style="color:var(--text-muted); font-size:0.82rem;">
                      <span class="tabular">${escapeHtml(s.start_time)} – ${escapeHtml(s.end_time)}</span>
                      ${s.location ? ` · ${escapeHtml(s.location)}` : ''}
                    </div>
                  </div>
                `
                  )
                  .join('')}
              </div>`
        }
      </div>

      <div class="card">
        <div class="card-header">
          <h3 class="card-title">Subject Syllabus Progress</h3>
          <button class="btn btn-sm" data-nav="subjects">Manage Subjects</button>
        </div>
        ${
          subjects.length === 0
            ? `<div class="empty-state">Add your subjects to track syllabus completion.</div>`
            : `<div style="display:flex; flex-direction:column; gap:0.85rem;">
                ${subjects
                  .map(
                    (subj) => `
                  <div>
                    <div style="display:flex; justify-content:space-between; font-size:0.88rem; margin-bottom:0.3rem;">
                      <span style="font-weight:600; display:flex; align-items:center; gap:0.45rem;">
                        <span class="subject-dot" style="background:${escapeHtml(subj.color)}"></span>
                        ${escapeHtml(subj.name)}
                      </span>
                      <span class="tabular" style="font-weight:700;">${subj.syllabus_percent}%</span>
                    </div>
                    <div class="progress-track">
                      <div class="progress-fill" style="width:${subj.syllabus_percent}%; background:${escapeHtml(subj.color)};"></div>
                    </div>
                    <div style="font-size:0.76rem; color:var(--text-muted); margin-top:0.2rem;">
                      ${subj.syllabus_completed}/${subj.syllabus_total} syllabus topics · ${subj.weekly_hours}h / ${subj.target_hours_weekly}h weekly target
                    </div>
                  </div>
                `
                  )
                  .join('')}
              </div>`
        }
      </div>
    </div>
  `;

  container.querySelectorAll('[data-nav]').forEach((btn) => {
    btn.addEventListener('click', () => app.navigate(btn.dataset.nav));
  });

  container.querySelector('#dash-start-timer')?.addEventListener('click', () => app.navigate('timer'));
  container.querySelector('#dash-open-ai')?.addEventListener('click', () => app.navigate('ai'));
  container.querySelectorAll('[data-ai-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      app.aiInitialTab = btn.dataset.aiTab;
      app.navigate('ai');
    });
  });

  container.querySelector('#dash-seed-btn')?.addEventListener('click', async () => {
    try {
      await api.seedSample();
      showToast('Sample semester data loaded!', 'success');
      app.refresh();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  container.querySelectorAll('.quick-complete-task').forEach((chk) => {
    chk.addEventListener('change', async () => {
      try {
        await api.updateTask(Number(chk.dataset.id), { status: 'completed' });
        showToast('Task marked as completed!', 'success');
        app.refresh();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });
}
