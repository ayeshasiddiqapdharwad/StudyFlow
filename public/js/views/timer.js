import { api } from '../api.js';
import { escapeHtml, formatDate, formatMinutes, formatTimerClock, todayIso, showToast } from '../utils.js';

export async function renderTimerView(container, app) {
  const [{ sessions }, { subjects }, { tasks }] = await Promise.all([
    api.getSessions(),
    api.getSubjects(),
    api.getTasks(),
  ]);

  let sessionList = sessions;

  function draw() {
    const timerState = app.timer;
    const elapsedSec = app.getTimerElapsedSeconds();
    const pendingTasks = tasks.filter((t) => t.status !== 'completed');

    container.innerHTML = `
      <div class="grid grid-2" style="margin-bottom:1.1rem;">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Live Study Timer</h3>
            <span class="badge ${timerState.running ? 'badge-success' : 'badge-primary'}">
              ${timerState.running ? 'Running' : elapsedSec > 0 ? 'Paused' : 'Ready'}
            </span>
          </div>

          <div class="timer-display tabular" id="timer-clock">${formatTimerClock(elapsedSec)}</div>

          <div class="form-row">
            <div class="field">
              <label for="timer-subject">Subject</label>
              <select id="timer-subject">
                <option value="">General Study</option>
                ${subjects
                  .map(
                    (s) =>
                      `<option value="${s.id}" ${String(timerState.subjectId || '') === String(s.id) ? 'selected' : ''}>${escapeHtml(s.name)}</option>`
                  )
                  .join('')}
              </select>
            </div>
            <div class="field">
              <label for="timer-task">Linked Task (Optional)</label>
              <select id="timer-task">
                <option value="">None</option>
                ${pendingTasks
                  .map(
                    (t) =>
                      `<option value="${t.id}" ${String(timerState.taskId || '') === String(t.id) ? 'selected' : ''}>${escapeHtml(t.title)}</option>`
                  )
                  .join('')}
              </select>
            </div>
          </div>

          <div class="field">
            <label for="timer-notes">Session Focus Note</label>
            <input id="timer-notes" class="input" value="${escapeHtml(timerState.notes || '')}" placeholder="What are you working on?" />
          </div>

          <div style="display:flex; gap:0.55rem; justify-content:center; flex-wrap:wrap; margin-top:0.5rem;">
            ${
              !timerState.running
                ? `<button id="timer-start-btn" class="btn btn-primary">${elapsedSec > 0 ? 'Resume Timer' : 'Start Timer'}</button>`
                : `<button id="timer-pause-btn" class="btn">Pause</button>`
            }
            ${
              elapsedSec > 0
                ? `<button id="timer-save-btn" class="btn btn-success">Stop & Log Session</button>
                   <button id="timer-reset-btn" class="btn btn-danger">Discard</button>`
                : ''
            }
          </div>
          <p style="text-align:center; font-size:0.78rem; color:var(--text-muted); margin:0.75rem 0 0;">
            Timer progress auto-saves locally so navigating pages or refreshing won't lose your session.
          </p>
        </div>

        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Log Study Time Manually</h3>
          </div>
          <form id="manual-session-form">
            <div class="form-row">
              <div class="field">
                <label for="ms-subject">Subject</label>
                <select id="ms-subject">
                  <option value="">General Study</option>
                  ${subjects.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('')}
                </select>
              </div>
              <div class="field">
                <label for="ms-date">Date *</label>
                <input id="ms-date" class="input" type="date" required value="${todayIso()}" />
              </div>
            </div>
            <div class="field">
              <label for="ms-minutes">Duration (Minutes) *</label>
              <input id="ms-minutes" class="input" type="number" min="1" max="1440" required value="45" />
            </div>
            <div class="field">
              <label for="ms-notes">What did you study?</label>
              <textarea id="ms-notes" rows="3" placeholder="e.g. Solved Chapter 6 practice exercises"></textarea>
            </div>
            <button type="submit" class="btn btn-primary" style="width:100%;">Log Study Session</button>
          </form>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3 class="card-title">Recent Study Sessions</h3>
          <span style="font-size:0.84rem; color:var(--text-muted);">${sessionList.length} logged session${sessionList.length === 1 ? '' : 's'}</span>
        </div>
        ${
          sessionList.length === 0
            ? `<div class="empty-state">No study sessions logged yet. Start the timer or enter a manual log above!</div>`
            : `<div style="overflow-x:auto;">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Subject</th>
                      <th>Mode</th>
                      <th>Duration</th>
                      <th>Notes</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    ${sessionList
                      .map(
                        (ss) => `
                      <tr>
                        <td class="tabular">${formatDate(ss.session_date)}</td>
                        <td>
                          ${
                            ss.subject_name
                              ? `<span style="display:inline-flex; align-items:center; gap:0.4rem;"><span class="subject-dot" style="background:${escapeHtml(ss.subject_color || '#4f46e5')}"></span>${escapeHtml(ss.subject_name)}</span>`
                              : 'General'
                          }
                        </td>
                        <td><span class="badge">${escapeHtml(ss.mode)}</span></td>
                        <td class="tabular"><strong>${formatMinutes(ss.duration_minutes)}</strong></td>
                        <td style="color:var(--text-muted);">${escapeHtml(ss.notes || '—')}</td>
                        <td style="text-align:right;">
                          <button class="btn btn-sm btn-danger delete-session-btn" data-id="${ss.id}">Delete</button>
                        </td>
                      </tr>
                    `
                      )
                      .join('')}
                  </tbody>
                </table>
              </div>`
        }
      </div>
    `;

    container.querySelector('#timer-subject').addEventListener('change', (e) => {
      app.updateTimerMeta({ subjectId: e.target.value || '' });
    });
    container.querySelector('#timer-task').addEventListener('change', (e) => {
      app.updateTimerMeta({ taskId: e.target.value || '' });
    });
    container.querySelector('#timer-notes').addEventListener('input', (e) => {
      app.updateTimerMeta({ notes: e.target.value });
    });

    container.querySelector('#timer-start-btn')?.addEventListener('click', () => {
      app.startTimer();
      draw();
    });
    container.querySelector('#timer-pause-btn')?.addEventListener('click', () => {
      app.pauseTimer();
      draw();
    });
    container.querySelector('#timer-reset-btn')?.addEventListener('click', () => {
      app.resetTimer();
      draw();
    });
    container.querySelector('#timer-save-btn')?.addEventListener('click', async () => {
      const secs = app.getTimerElapsedSeconds();
      const minutes = Math.max(1, Math.round(secs / 60));
      try {
        const res = await api.createSession({
          subject_id: app.timer.subjectId ? Number(app.timer.subjectId) : null,
          task_id: app.timer.taskId ? Number(app.timer.taskId) : null,
          mode: 'timer',
          duration_minutes: minutes,
          session_date: todayIso(),
          notes: app.timer.notes || '',
        });
        sessionList = [res.session, ...sessionList];
        app.resetTimer();
        showToast(`Logged ${formatMinutes(minutes)} study session!`, 'success');
        draw();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    container.querySelector('#manual-session-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const res = await api.createSession({
          subject_id: container.querySelector('#ms-subject').value ? Number(container.querySelector('#ms-subject').value) : null,
          mode: 'manual',
          duration_minutes: Number(container.querySelector('#ms-minutes').value),
          session_date: container.querySelector('#ms-date').value,
          notes: container.querySelector('#ms-notes').value.trim(),
        });
        sessionList = [res.session, ...sessionList];
        showToast('Study session logged!', 'success');
        draw();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    container.querySelectorAll('.delete-session-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await api.deleteSession(Number(btn.dataset.id));
          sessionList = sessionList.filter((s) => s.id !== Number(btn.dataset.id));
          showToast('Session deleted', 'info');
          draw();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });
  }

  draw();
}
