import { api } from '../api.js';
import { escapeHtml, formatBytes, formatDate, showToast } from '../utils.js';

export async function renderNotesView(container) {
  const [{ notes }, { subjects }] = await Promise.all([api.getNotes(), api.getSubjects()]);
  let noteList = notes;
  let selectedSubject = '';
  let search = '';

  function filteredNotes() {
    const q = search.trim().toLowerCase();
    return noteList.filter((n) => {
      if (selectedSubject && String(n.subject_id || '') !== selectedSubject) return false;
      if (
        q &&
        !n.title.toLowerCase().includes(q) &&
        !(n.content || '').toLowerCase().includes(q) &&
        !(n.tags || '').toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }

  function openNoteModal() {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal-card">
        <div class="card-header">
          <h3 class="card-title">Upload Study Material or Add Note</h3>
          <button type="button" class="btn btn-sm" id="close-note-modal">Close</button>
        </div>
        <form id="note-modal-form">
          <div class="field">
            <label for="nm-title">Title *</label>
            <input id="nm-title" class="input" placeholder="e.g. Week 4 Lecture Slides or Formula Sheet" />
          </div>
          <div class="form-row">
            <div class="field">
              <label for="nm-subject">Subject</label>
              <select id="nm-subject">
                <option value="">General</option>
                ${subjects.map((s) => `<option value="${s.id}" ${selectedSubject === String(s.id) ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label for="nm-tags">Tags (comma separated)</label>
              <input id="nm-tags" class="input" placeholder="midterm, slides, summary" />
            </div>
          </div>
          <div class="field">
            <label for="nm-file">Attach Study File (PDF, image, text, slides — max 10MB)</label>
            <input id="nm-file" class="input" type="file" />
          </div>
          <div class="field">
            <label for="nm-content">Written Notes / Key Takeaways</label>
            <textarea id="nm-content" rows="4" placeholder="Write quick notes, definitions, or links..."></textarea>
          </div>
          <div style="display:flex; justify-content:flex-end; gap:0.5rem;">
            <button type="button" class="btn" id="cancel-note-modal">Cancel</button>
            <button type="submit" class="btn btn-primary">Save Note</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(backdrop);

    const close = () => backdrop.remove();
    backdrop.querySelector('#close-note-modal').addEventListener('click', close);
    backdrop.querySelector('#cancel-note-modal').addEventListener('click', close);

    backdrop.querySelector('#note-modal-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fileInput = backdrop.querySelector('#nm-file');
      const file = fileInput.files[0];
      const title = backdrop.querySelector('#nm-title').value.trim();

      if (!title && !file) {
        showToast('Please provide a note title or select a file to upload.', 'error');
        return;
      }

      const formData = new FormData();
      formData.append('title', title || file.name);
      formData.append('subject_id', backdrop.querySelector('#nm-subject').value);
      formData.append('tags', backdrop.querySelector('#nm-tags').value.trim());
      formData.append('content', backdrop.querySelector('#nm-content').value.trim());
      if (file) formData.append('file', file);

      try {
        const res = await api.createNote(formData);
        noteList = [res.note, ...noteList];
        showToast('Study material saved!', 'success');
        close();
        draw();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  function draw() {
    const items = filteredNotes();
    container.innerHTML = `
      <div class="card" style="margin-bottom:1rem;">
        <div style="display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:0.65rem;">
          <div style="display:flex; flex-wrap:wrap; gap:0.55rem; flex:1;">
            <input id="notes-search" class="input" style="max-width:240px;" placeholder="Search notes or tags..." value="${escapeHtml(search)}" />
            <select id="notes-subject-filter" style="max-width:210px;">
              <option value="">All Subjects</option>
              ${subjects.map((s) => `<option value="${s.id}" ${selectedSubject === String(s.id) ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
            </select>
          </div>
          <button id="add-note-btn" class="btn btn-primary">+ Upload / New Note</button>
        </div>
      </div>

      ${
        items.length === 0
          ? `<div class="empty-state">No notes or study files here yet. Click <strong>+ Upload / New Note</strong> to add materials.</div>`
          : `<div class="grid grid-2">
              ${items
                .map(
                  (n) => `
                <div class="card" style="display:flex; flex-direction:column; justify-content:space-between; gap:0.75rem;">
                  <div>
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:0.5rem;">
                      <div>
                        <h4 style="margin:0 0 0.25rem; font-size:1rem;">${escapeHtml(n.title)}</h4>
                        <div style="font-size:0.78rem; color:var(--text-muted); display:flex; align-items:center; gap:0.45rem; flex-wrap:wrap;">
                          ${
                            n.subject_name
                              ? `<span><span class="subject-dot" style="background:${escapeHtml(n.subject_color || '#4f46e5')}"></span> ${escapeHtml(n.subject_name)}</span>`
                              : '<span>General</span>'
                          }
                          <span>· ${formatDate(n.created_at)}</span>
                        </div>
                      </div>
                      <button class="btn btn-sm btn-danger delete-note-btn" data-id="${n.id}">Delete</button>
                    </div>

                    ${n.content ? `<p style="margin:0.75rem 0 0; font-size:0.88rem; white-space:pre-wrap; color:var(--text);">${escapeHtml(n.content)}</p>` : ''}

                    ${
                      n.tags
                        ? `<div style="display:flex; gap:0.35rem; flex-wrap:wrap; margin-top:0.65rem;">
                            ${n.tags
                              .split(',')
                              .map((t) => t.trim())
                              .filter(Boolean)
                              .map((t) => `<span class="badge">#${escapeHtml(t)}</span>`)
                              .join('')}
                          </div>`
                        : ''
                    }
                  </div>

                  ${
                    n.file_name
                      ? `<div style="display:flex; align-items:center; justify-content:space-between; gap:0.5rem; padding:0.6rem 0.75rem; background:var(--surface-alt); border:1px solid var(--border); border-radius:var(--radius-sm);">
                          <div style="min-width:0;">
                            <div style="font-size:0.84rem; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(n.file_name)}</div>
                            <div style="font-size:0.74rem; color:var(--text-muted);">${formatBytes(n.file_size)}</div>
                          </div>
                          <div style="display:flex; gap:0.35rem;">
                            <a class="btn btn-sm" href="/api/notes/${n.id}/download?inline=1" target="_blank" rel="noopener">Preview</a>
                            <a class="btn btn-sm btn-primary" href="/api/notes/${n.id}/download">Download</a>
                          </div>
                        </div>`
                      : ''
                  }
                </div>
              `
                )
                .join('')}
            </div>`
      }
    `;

    container.querySelector('#add-note-btn').addEventListener('click', openNoteModal);
    container.querySelector('#notes-search').addEventListener('input', (e) => {
      const pos = e.target.selectionStart ?? e.target.value.length;
      search = e.target.value;
      draw();
      const inputEl = container.querySelector('#notes-search');
      if (inputEl) {
        inputEl.focus();
        inputEl.setSelectionRange(pos, pos);
      }
    });
    container.querySelector('#notes-subject-filter').addEventListener('change', (e) => {
      selectedSubject = e.target.value;
      draw();
    });

    container.querySelectorAll('.delete-note-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await api.deleteNote(Number(btn.dataset.id));
          noteList = noteList.filter((n) => n.id !== Number(btn.dataset.id));
          showToast('Note deleted', 'info');
          draw();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });
  }

  draw();
}
