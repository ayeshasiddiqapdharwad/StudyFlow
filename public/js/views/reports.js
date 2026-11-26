import { api } from '../api.js';
import { downloadCsv, escapeHtml, formatDate, formatMinutes, offsetLocalDate, todayIso, showToast } from '../utils.js';

export async function renderReportsView(container) {
  let from = offsetLocalDate(-6);
  let to = todayIso();
  let report = await api.getReport(from, to);

  async function loadReport(nextFrom, nextTo) {
    try {
      report = await api.getReport(nextFrom, nextTo);
      from = nextFrom;
      to = nextTo;
      draw();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function draw() {
    const maxMins = Math.max(60, ...report.by_subject.map((b) => b.study_minutes));

    container.innerHTML = `
      <div class="card no-print" style="margin-bottom:1rem;">
        <div style="display:flex; flex-wrap:wrap; align-items:end; justify-content:space-between; gap:0.75rem;">
          <form id="report-range-form" style="display:flex; flex-wrap:wrap; align-items:end; gap:0.65rem;">
            <div class="field" style="margin:0;">
              <label for="rep-from">From</label>
              <input id="rep-from" class="input" type="date" value="${escapeHtml(from)}" required />
            </div>
            <div class="field" style="margin:0;">
              <label for="rep-to">To</label>
              <input id="rep-to" class="input" type="date" value="${escapeHtml(to)}" required />
            </div>
            <button type="submit" class="btn btn-primary">Generate Report</button>
            <button type="button" class="btn preset-btn" data-days="6">Last 7 Days</button>
            <button type="button" class="btn preset-btn" data-days="29">Last 30 Days</button>
          </form>
          <div style="display:flex; gap:0.5rem;">
            <button id="export-csv-btn" class="btn">Export CSV</button>
            <button id="print-report-btn" class="btn">Print / Save PDF</button>
          </div>
        </div>
      </div>

      <div class="grid grid-4" style="margin-bottom:1rem;">
        <div class="card stat-card">
          <span class="stat-label">Total Study Hours</span>
          <span class="stat-value tabular">${report.totals.study_hours}h</span>
          <span class="stat-sub">${formatMinutes(report.totals.study_minutes)} total</span>
        </div>
        <div class="card stat-card">
          <span class="stat-label">Study Sessions</span>
          <span class="stat-value tabular">${report.totals.session_count}</span>
          <span class="stat-sub">${formatDate(report.period.from)} – ${formatDate(report.period.to)}</span>
        </div>
        <div class="card stat-card">
          <span class="stat-label">Tasks Completed</span>
          <span class="stat-value tabular">${report.totals.completed_tasks}</span>
          <span class="stat-sub">${report.totals.tasks_due_in_period} due in period</span>
        </div>
        <div class="card stat-card">
          <span class="stat-label">Avg per Session</span>
          <span class="stat-value tabular">${report.totals.session_count ? Math.round(report.totals.study_minutes / report.totals.session_count) : 0}m</span>
          <span class="stat-sub">Focused duration</span>
        </div>
      </div>

      <div class="card" style="margin-bottom:1rem;">
        <div class="card-header">
          <h3 class="card-title">Breakdown by Subject</h3>
        </div>
        ${
          report.by_subject.length === 0
            ? `<div class="empty-state">No activity recorded in this date range.</div>`
            : `<div style="overflow-x:auto;">
                <table>
                  <thead>
                    <tr>
                      <th>Subject</th>
                      <th>Sessions</th>
                      <th>Study Time</th>
                      <th>Tasks Completed</th>
                      <th style="width:35%;">Time Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${report.by_subject
                      .map((b) => {
                        const pct = Math.round((b.study_minutes / maxMins) * 100);
                        return `
                          <tr>
                            <td>
                              <span style="display:inline-flex; align-items:center; gap:0.45rem; font-weight:600;">
                                <span class="subject-dot" style="background:${escapeHtml(b.subject_color)}"></span>
                                ${escapeHtml(b.subject_name)}
                              </span>
                            </td>
                            <td class="tabular">${b.session_count}</td>
                            <td class="tabular"><strong>${b.study_hours}h</strong> (${formatMinutes(b.study_minutes)})</td>
                            <td class="tabular">${b.completed_tasks}</td>
                            <td>
                              <div class="progress-track">
                                <div class="progress-fill" style="width:${pct}%; background:${escapeHtml(b.subject_color)};"></div>
                              </div>
                            </td>
                          </tr>
                        `;
                      })
                      .join('')}
                  </tbody>
                </table>
              </div>`
        }
      </div>

      <div class="grid grid-2">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Completed Tasks (${report.completed_tasks.length})</h3>
          </div>
          ${
            report.completed_tasks.length === 0
              ? `<div class="empty-state">No tasks completed in this range.</div>`
              : `<div style="display:flex; flex-direction:column; gap:0.5rem;">
                  ${report.completed_tasks
                    .map(
                      (t) => `
                    <div style="display:flex; justify-content:space-between; align-items:center; padding:0.5rem 0.65rem; border:1px solid var(--border); border-radius:var(--radius-sm);">
                      <div>
                        <strong style="font-size:0.9rem;">${escapeHtml(t.title)}</strong>
                        <div style="font-size:0.78rem; color:var(--text-muted);">${escapeHtml(t.subject_name || 'General')} · Completed ${formatDate(t.completed_at)}</div>
                      </div>
                      <span class="badge badge-success">Done</span>
                    </div>
                  `
                    )
                    .join('')}
                </div>`
          }
        </div>

        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Study Sessions (${report.sessions.length})</h3>
          </div>
          ${
            report.sessions.length === 0
              ? `<div class="empty-state">No study sessions logged in this range.</div>`
              : `<div style="display:flex; flex-direction:column; gap:0.5rem;">
                  ${report.sessions
                    .map(
                      (s) => `
                    <div style="display:flex; justify-content:space-between; align-items:center; padding:0.5rem 0.65rem; border:1px solid var(--border); border-radius:var(--radius-sm);">
                      <div>
                        <strong style="font-size:0.9rem;">${escapeHtml(s.subject_name || 'General')} (${formatMinutes(s.duration_minutes)})</strong>
                        <div style="font-size:0.78rem; color:var(--text-muted);">${formatDate(s.session_date)}${s.notes ? ` · ${escapeHtml(s.notes)}` : ''}</div>
                      </div>
                      <span class="badge">${escapeHtml(s.mode)}</span>
                    </div>
                  `
                    )
                    .join('')}
                </div>`
          }
        </div>
      </div>
    `;

    container.querySelector('#report-range-form').addEventListener('submit', (e) => {
      e.preventDefault();
      loadReport(
        container.querySelector('#rep-from').value,
        container.querySelector('#rep-to').value
      );
    });

    container.querySelectorAll('.preset-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const days = Number(btn.dataset.days);
        loadReport(offsetLocalDate(-days), todayIso());
      });
    });

    container.querySelector('#export-csv-btn').addEventListener('click', () => {
      const rows = [
        ['StudyFlow Report', `${report.period.from} to ${report.period.to}`],
        ['Total Study Hours', report.totals.study_hours, 'Completed Tasks', report.totals.completed_tasks],
        [],
        ['Subject', 'Sessions', 'Study Minutes', 'Study Hours', 'Completed Tasks'],
        ...report.by_subject.map((b) => [
          b.subject_name,
          b.session_count,
          b.study_minutes,
          b.study_hours,
          b.completed_tasks,
        ]),
      ];
      downloadCsv(`studyflow-report-${from}-to-${to}.csv`, rows);
      showToast('CSV report downloaded!', 'success');
    });

    container.querySelector('#print-report-btn').addEventListener('click', () => window.print());
  }

  draw();
}
