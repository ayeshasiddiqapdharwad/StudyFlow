import { api } from '../api.js';
import { escapeHtml, formatDate, todayIso, showToast } from '../utils.js';

export async function renderTasksView(container, app) {
  const [{ tasks }, { subjects }] = await Promise.all([api.getTasks(), api.getSubjects()]);

  let filters = {
    subject_id: '',
    status: '',
    priority: '',
    search: '',
  };
  let taskList = tasks;

  function filteredTasks() {
    const q = filters.search.trim().toLowerCase();
    return taskList.filter((t) => {
      if (filters.subject_id && String(t.subject_id || '') !== filters.subject_id) return false;
      if (filters.status && t.status !== filters.status) return false;
      if (filters.priority && t.priority !== filters.priority) return false;
      if (q && !t.title.toLowerCase().includes(q) && !(t.description || '').toLowerCase().includes(q)) return false;
      return true;
    });
  }

  function openTaskModal(existing = null) {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal-card">
        <div class="card-header">
          <h3 class="card-title">${existing ? 'Edit Study Task' : 'Add Study Task'}</h3>
          <button type="button" class="btn btn-sm" id="close-task-modal">Close</button>
        </div>
        <form id="task-modal-form">
          <div class="field">
            <label for="tm-title">Task Title *</label>
            <input id="tm-title" class="input" required value="${escapeHtml(existing?.title || '')}" placeholder="e.g. Complete Binary Trees Assignment" />
          </div>
          <div class="form-row">
            <div class="field">
              <label for="tm-subject">Subject</label>
              <select id="tm-subject">
                <option value="">General / No Subject</option>
                ${subjects
                  .map(
                    (s) =>
                      `<option value="${s.id}" ${Number(existing?.subject_id) === s.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`
                  )
                  .join('')}
              </select>
            </div>
            <div class="field">
              <label for="tm-due">Due Date *</label>
              <input id="tm-due" class="input" type="date" required value="${escapeHtml((existing?.due_date || todayIso()).slice(0, 10))}" />
            </div>
          </div>
          <div class="form-row">
            <div class="field">
              <label for="tm-priority">Priority</label>
              <select id="tm-priority">
                <option value="low" ${existing?.priority === 'low' ? 'selected' : ''}>Low</option>
                <option value="medium" ${!existing || existing.priority === 'medium' ? 'selected' : ''}>Medium</option>
                <option value="high" ${existing?.priority === 'high' ? 'selected' : ''}>High</option>
              </select>
            </div>
            <div class="field">
              <label for="tm-reminder">Reminder Lead Time</label>
              <select id="tm-reminder">
                <option value="60" ${Number(existing?.reminder_minutes_before) === 60 ? 'selected' : ''}>1 hour before</option>
                <option value="360" ${Number(existing?.reminder_minutes_before) === 360 ? 'selected' : ''}>6 hours before</option>
                <option value="1440" ${!existing || Number(existing?.reminder_minutes_before) === 1440 ? 'selected' : ''}>1 day before</option>
                <option value="2880" ${Number(existing?.reminder_minutes_before) === 2880 ? 'selected' : ''}>2 days before</option>
              </select>
            </div>
          </div>
          <div class="field">
            <label for="tm-desc">Notes / Details</label>
            <textarea id="tm-desc" rows="3" placeholder="Optional instructions or checklist notes">${escapeHtml(existing?.description || '')}</textarea>
          </div>
          ${
            !existing
              ? `<div class="field">
                  <label for="tm-subtasks">Initial Subtasks (one per line, optional)</label>
                  <textarea id="tm-subtasks" rows="3" placeholder="Read Chapter 4&#10;Implement algorithm&#10;Write test cases"></textarea>
                </div>`
              : ''
          }
          <div style="display:flex; justify-content:flex-end; gap:0.5rem;">
            <button type="button" class="btn" id="cancel-task-modal">Cancel</button>
            <button type="submit" class="btn btn-primary">${existing ? 'Save Changes' : 'Create Task'}</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(backdrop);

    const close = () => backdrop.remove();
    backdrop.querySelector('#close-task-modal').addEventListener('click', close);
    backdrop.querySelector('#cancel-task-modal').addEventListener('click', close);

    backdrop.querySelector('#task-modal-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        title: backdrop.querySelector('#tm-title').value.trim(),
        subject_id: backdrop.querySelector('#tm-subject').value ? Number(backdrop.querySelector('#tm-subject').value) : null,
        due_date: backdrop.querySelector('#tm-due').value,
        priority: backdrop.querySelector('#tm-priority').value,
        reminder_minutes_before: Number(backdrop.querySelector('#tm-reminder').value),
        description: backdrop.querySelector('#tm-desc').value.trim(),
      };
      if (!existing) {
        const rawSubs = backdrop.querySelector('#tm-subtasks').value;
        payload.subtasks = rawSubs.split('\n').map((s) => s.trim()).filter(Boolean);
      }

      try {
        if (existing) {
          await api.updateTask(existing.id, payload);
          showToast('Task updated!', 'success');
        } else {
          await api.createTask(payload);
          showToast('Task created!', 'success');
        }
        close();
        const refreshed = await api.getTasks();
        taskList = refreshed.tasks;
        draw();
        app.refreshNotifications();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  function draw() {
    const items = filteredTasks();
    const today = todayIso();

    container.innerHTML = `
      <div class="card" style="margin-bottom:1rem;">
        <div style="display:flex; flex-wrap:wrap; gap:0.65rem; align-items:center; justify-content:space-between;">
          <div style="display:flex; flex-wrap:wrap; gap:0.55rem; flex:1;">
            <input id="filter-search" class="input" style="max-width:220px;" placeholder="Search tasks..." value="${escapeHtml(filters.search)}" />
            <select id="filter-subject" style="max-width:190px;">
              <option value="">All Subjects</option>
              ${subjects.map((s) => `<option value="${s.id}" ${filters.subject_id === String(s.id) ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
            </select>
            <select id="filter-status" style="max-width:155px;">
              <option value="">All Statuses</option>
              <option value="pending" ${filters.status === 'pending' ? 'selected' : ''}>Pending</option>
              <option value="in_progress" ${filters.status === 'in_progress' ? 'selected' : ''}>In Progress</option>
              <option value="completed" ${filters.status === 'completed' ? 'selected' : ''}>Completed</option>
            </select>
            <select id="filter-priority" style="max-width:145px;">
              <option value="">All Priorities</option>
              <option value="high" ${filters.priority === 'high' ? 'selected' : ''}>High</option>
              <option value="medium" ${filters.priority === 'medium' ? 'selected' : ''}>Medium</option>
              <option value="low" ${filters.priority === 'low' ? 'selected' : ''}>Low</option>
            </select>
          </div>
          <button id="add-task-btn" class="btn btn-primary">+ Add Task</button>
        </div>
      </div>

      ${
        items.length === 0
          ? `<div class="empty-state">No study tasks match your filters. Click <strong>+ Add Task</strong> to create one.</div>`
          : `<div style="display:flex; flex-direction:column; gap:0.8rem;">
              ${items
                .map((task) => {
                  const isDone = task.status === 'completed';
                  const isOverdue = !isDone && task.due_date.slice(0, 10) < today;
                  return `
                    <div class="task-item ${isDone ? 'completed' : ''}" data-task-id="${task.id}">
                      <div class="task-top">
                        <div class="task-title-row">
                          <input type="checkbox" class="toggle-task-status" data-id="${task.id}" ${isDone ? 'checked' : ''} />
                          <div>
                            <h4 class="task-title">${escapeHtml(task.title)}</h4>
                            <div style="font-size:0.82rem; color:var(--text-muted); display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap; margin-top:0.15rem;">
                              ${
                                task.subject_name
                                  ? `<span><span class="subject-dot" style="background:${escapeHtml(task.subject_color || '#4f46e5')}"></span> ${escapeHtml(task.subject_name)}</span>`
                                  : '<span>General</span>'
                              }
                              <span>· Due ${formatDate(task.due_date)}</span>
                              ${task.subtask_total > 0 ? `<span class="tabular">· ${task.subtask_completed}/${task.subtask_total} subtasks (${task.subtask_percent}%)</span>` : ''}
                            </div>
                          </div>
                        </div>
                        <div style="display:flex; align-items:center; gap:0.4rem; flex-wrap:wrap;">
                          ${isOverdue ? '<span class="badge badge-danger">Overdue</span>' : ''}
                          <span class="badge badge-${task.priority}">${task.priority}</span>
                          <span class="badge badge-primary">${task.status.replace('_', ' ')}</span>
                          <button class="btn btn-sm edit-task-btn" data-id="${task.id}">Edit</button>
                          <button class="btn btn-sm btn-danger delete-task-btn" data-id="${task.id}">Delete</button>
                        </div>
                      </div>

                      ${task.description ? `<p style="margin:0.5rem 0 0 1.65rem; font-size:0.88rem; color:var(--text-muted);">${escapeHtml(task.description)}</p>` : ''}

                      ${
                        task.subtask_total > 0
                          ? `<div class="progress-track" style="margin:0.65rem 0 0 1.65rem; width:calc(100% - 1.65rem); height:6px;">
                               <div class="progress-fill" style="width:${task.subtask_percent}%;"></div>
                             </div>`
                          : ''
                      }

                      <div class="subtask-list" style="margin-left:1.65rem;">
                        ${task.subtasks
                          .map(
                            (st) => `
                          <div class="subtask-row ${st.is_completed ? 'done' : ''}">
                            <label>
                              <input type="checkbox" class="toggle-subtask" data-sub-id="${st.id}" ${st.is_completed ? 'checked' : ''} />
                              <span>${escapeHtml(st.title)}</span>
                            </label>
                            <button type="button" class="btn btn-sm delete-subtask" data-sub-id="${st.id}" title="Remove subtask">×</button>
                          </div>
                        `
                          )
                          .join('')}
                        <form class="add-subtask-form" data-task-id="${task.id}" style="display:flex; gap:0.45rem; margin-top:0.25rem;">
                          <input class="input" style="padding:0.35rem 0.6rem; font-size:0.84rem;" placeholder="Add a subtask..." required />
                          <button type="submit" class="btn btn-sm">+ Subtask</button>
                        </form>
                      </div>
                    </div>
                  `;
                })
                .join('')}
            </div>`
      }
    `;

    container.querySelector('#add-task-btn').addEventListener('click', () => openTaskModal(null));
    container.querySelector('#filter-search').addEventListener('input', (e) => {
      const pos = e.target.selectionStart ?? e.target.value.length;
      filters.search = e.target.value;
      draw();
      const inputEl = container.querySelector('#filter-search');
      if (inputEl) {
        inputEl.focus();
        inputEl.setSelectionRange(pos, pos);
      }
    });
    container.querySelector('#filter-subject').addEventListener('change', (e) => {
      filters.subject_id = e.target.value;
      draw();
    });
    container.querySelector('#filter-status').addEventListener('change', (e) => {
      filters.status = e.target.value;
      draw();
    });
    container.querySelector('#filter-priority').addEventListener('change', (e) => {
      filters.priority = e.target.value;
      draw();
    });

    container.querySelectorAll('.toggle-task-status').forEach((chk) => {
      chk.addEventListener('change', async () => {
        try {
          const nextStatus = chk.checked ? 'completed' : 'pending';
          const res = await api.updateTask(Number(chk.dataset.id), { status: nextStatus });
          taskList = taskList.map((t) => (t.id === res.task.id ? res.task : t));
          draw();
          app.refreshNotifications();
        } catch (err) {
          showToast(err.message, 'error');
          draw();
        }
      });
    });

    container.querySelectorAll('.edit-task-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const found = taskList.find((t) => t.id === Number(btn.dataset.id));
        if (found) openTaskModal(found);
      });
    });

    container.querySelectorAll('.delete-task-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await api.deleteTask(Number(btn.dataset.id));
          taskList = taskList.filter((t) => t.id !== Number(btn.dataset.id));
          showToast('Task deleted', 'info');
          draw();
          app.refreshNotifications();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    container.querySelectorAll('.add-subtask-form').forEach((form) => {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = form.querySelector('input');
        const title = input.value.trim();
        if (!title) return;
        try {
          const res = await api.addSubtask(Number(form.dataset.taskId), title);
          taskList = taskList.map((t) => (t.id === res.task.id ? res.task : t));
          draw();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    container.querySelectorAll('.toggle-subtask').forEach((chk) => {
      chk.addEventListener('change', async () => {
        try {
          const res = await api.toggleSubtask(Number(chk.dataset.subId), chk.checked);
          taskList = taskList.map((t) => (t.id === res.task.id ? res.task : t));
          draw();
        } catch (err) {
          showToast(err.message, 'error');
          draw();
        }
      });
    });

    container.querySelectorAll('.delete-subtask').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          const res = await api.deleteSubtask(Number(btn.dataset.subId));
          taskList = taskList.map((t) => (t.id === res.task.id ? res.task : t));
          draw();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });
  }

  draw();
}
