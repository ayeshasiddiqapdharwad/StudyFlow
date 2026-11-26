import { api } from '../api.js';
import { escapeHtml, showToast } from '../utils.js';

const PRESET_COLORS = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#ef4444'];

export async function renderSubjectsView(container) {
  let { subjects } = await api.getSubjects();

  function openSubjectModal(existing = null) {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal-card">
        <div class="card-header">
          <h3 class="card-title">${existing ? 'Edit Subject' : 'Add Subject'}</h3>
          <button type="button" class="btn btn-sm" id="close-subj-modal">Close</button>
        </div>
        <form id="subj-modal-form">
          <div class="field">
            <label for="sb-name">Subject Name *</label>
            <input id="sb-name" class="input" required value="${escapeHtml(existing?.name || '')}" placeholder="e.g. Operating Systems" />
          </div>
          <div class="form-row">
            <div class="field">
              <label for="sb-code">Course Code</label>
              <input id="sb-code" class="input" value="${escapeHtml(existing?.code || '')}" placeholder="e.g. CS302" />
            </div>
            <div class="field">
              <label for="sb-hours">Weekly Study Target (Hours)</label>
              <input id="sb-hours" class="input" type="number" step="0.5" min="0.5" max="60" value="${existing?.target_hours_weekly || 5}" />
            </div>
          </div>
          <div class="field">
            <label for="sb-color">Theme Color</label>
            <div style="display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap;">
              <input id="sb-color" type="color" value="${escapeHtml(existing?.color || PRESET_COLORS[0])}" style="width:46px; height:36px; border:none; background:none;" />
              ${PRESET_COLORS.map(
                (c) => `<button type="button" class="btn btn-sm color-swatch" data-color="${c}" style="background:${c}; width:28px; height:28px; padding:0; border-radius:999px;"></button>`
              ).join('')}
            </div>
          </div>
          ${
            !existing
              ? `<div class="field">
                  <label for="sb-topics">Initial Syllabus Topics (one per line, optional)</label>
                  <textarea id="sb-topics" rows="4" placeholder="Module 1: Process Management&#10;Module 2: CPU Scheduling&#10;Module 3: Memory & Virtual Memory"></textarea>
                </div>`
              : ''
          }
          <div style="display:flex; justify-content:flex-end; gap:0.5rem;">
            <button type="button" class="btn" id="cancel-subj-modal">Cancel</button>
            <button type="submit" class="btn btn-primary">${existing ? 'Save Subject' : 'Create Subject'}</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(backdrop);

    const close = () => backdrop.remove();
    backdrop.querySelector('#close-subj-modal').addEventListener('click', close);
    backdrop.querySelector('#cancel-subj-modal').addEventListener('click', close);
    backdrop.querySelectorAll('.color-swatch').forEach((btn) => {
      btn.addEventListener('click', () => {
        backdrop.querySelector('#sb-color').value = btn.dataset.color;
      });
    });

    backdrop.querySelector('#subj-modal-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        name: backdrop.querySelector('#sb-name').value.trim(),
        code: backdrop.querySelector('#sb-code').value.trim(),
        target_hours_weekly: Number(backdrop.querySelector('#sb-hours').value),
        color: backdrop.querySelector('#sb-color').value,
      };
      if (!existing) {
        payload.topics = backdrop.querySelector('#sb-topics').value.split('\n').map((s) => s.trim()).filter(Boolean);
      }

      try {
        if (existing) {
          const res = await api.updateSubject(existing.id, payload);
          subjects = subjects.map((s) => (s.id === existing.id ? res.subject : s));
          showToast('Subject updated!', 'success');
        } else {
          const res = await api.createSubject(payload);
          subjects = [...subjects, res.subject];
          showToast('Subject created!', 'success');
        }
        close();
        draw();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  function draw() {
    container.innerHTML = `
      <div class="card" style="margin-bottom:1rem; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:0.75rem;">
        <div>
          <h3 class="card-title" style="margin-bottom:0.2rem;">Subjects & Syllabus Progress</h3>
          <span style="font-size:0.86rem; color:var(--text-muted);">Check off syllabus modules to update your subject completion percentage.</span>
        </div>
        <button id="add-subject-btn" class="btn btn-primary">+ Add Subject</button>
      </div>

      ${
        subjects.length === 0
          ? `<div class="empty-state">No subjects yet. Click <strong>+ Add Subject</strong> to organize your courses.</div>`
          : `<div class="grid grid-2">
              ${subjects
                .map(
                  (subj) => `
                <div class="card" style="border-top:4px solid ${escapeHtml(subj.color)};">
                  <div class="card-header" style="margin-bottom:0.65rem;">
                    <div>
                      <h4 style="margin:0; font-size:1.05rem;">
                        ${escapeHtml(subj.name)}
                        ${subj.code ? `<span class="badge" style="margin-left:0.35rem;">${escapeHtml(subj.code)}</span>` : ''}
                      </h4>
                      <span style="font-size:0.8rem; color:var(--text-muted);">
                        ${subj.weekly_hours}h / ${subj.target_hours_weekly}h studied this week · ${subj.completed_tasks}/${subj.total_tasks} tasks done
                      </span>
                    </div>
                    <div style="display:flex; gap:0.35rem;">
                      <button class="btn btn-sm edit-subj-btn" data-id="${subj.id}">Edit</button>
                      <button class="btn btn-sm btn-danger delete-subj-btn" data-id="${subj.id}">Delete</button>
                    </div>
                  </div>

                  <div style="margin-bottom:0.8rem;">
                    <div style="display:flex; justify-content:space-between; font-size:0.85rem; margin-bottom:0.25rem;">
                      <span>Syllabus Completion</span>
                      <strong class="tabular">${subj.syllabus_percent}% (${subj.syllabus_completed}/${subj.syllabus_total})</strong>
                    </div>
                    <div class="progress-track">
                      <div class="progress-fill" style="width:${subj.syllabus_percent}%; background:${escapeHtml(subj.color)};"></div>
                    </div>
                  </div>

                  <div style="display:flex; flex-direction:column; gap:0.4rem; margin-bottom:0.75rem;">
                    ${
                      subj.topics.length === 0
                        ? `<span style="font-size:0.82rem; color:var(--text-muted);">No syllabus topics added yet.</span>`
                        : subj.topics
                            .map(
                              (t) => `
                          <div class="subtask-row ${t.is_completed ? 'done' : ''}">
                            <label>
                              <input type="checkbox" class="toggle-topic" data-topic-id="${t.id}" ${t.is_completed ? 'checked' : ''} />
                              <span>${escapeHtml(t.title)}</span>
                            </label>
                            <button class="btn btn-sm delete-topic" data-topic-id="${t.id}" title="Delete topic">×</button>
                          </div>
                        `
                            )
                            .join('')
                    }
                  </div>

                  <form class="add-topic-form" data-subject-id="${subj.id}" style="display:flex; gap:0.45rem;">
                    <input class="input" style="padding:0.4rem 0.65rem; font-size:0.85rem;" placeholder="Add syllabus topic or chapter..." required />
                    <button type="submit" class="btn btn-sm">+ Add Topic</button>
                  </form>
                </div>
              `
                )
                .join('')}
            </div>`
      }
    `;

    container.querySelector('#add-subject-btn').addEventListener('click', () => openSubjectModal(null));
    container.querySelectorAll('.edit-subj-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const found = subjects.find((s) => s.id === Number(btn.dataset.id));
        if (found) openSubjectModal(found);
      });
    });
    container.querySelectorAll('.delete-subj-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await api.deleteSubject(Number(btn.dataset.id));
          subjects = subjects.filter((s) => s.id !== Number(btn.dataset.id));
          showToast('Subject deleted', 'info');
          draw();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    container.querySelectorAll('.add-topic-form').forEach((form) => {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = form.querySelector('input');
        const title = input.value.trim();
        if (!title) return;
        try {
          const res = await api.addSyllabusTopic(Number(form.dataset.subjectId), title);
          subjects = subjects.map((s) => (s.id === res.subject.id ? res.subject : s));
          draw();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    container.querySelectorAll('.toggle-topic').forEach((chk) => {
      chk.addEventListener('change', async () => {
        try {
          const res = await api.toggleSyllabusTopic(Number(chk.dataset.topicId), chk.checked);
          subjects = subjects.map((s) => (s.id === res.subject.id ? res.subject : s));
          draw();
        } catch (err) {
          showToast(err.message, 'error');
          draw();
        }
      });
    });

    container.querySelectorAll('.delete-topic').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          const res = await api.deleteSyllabusTopic(Number(btn.dataset.topicId));
          subjects = subjects.map((s) => (s.id === res.subject.id ? res.subject : s));
          draw();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });
  }

  draw();
}
