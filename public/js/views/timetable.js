import { api } from '../api.js';
import { DAY_NAMES, escapeHtml, showToast } from '../utils.js';

export async function renderTimetableView(container, app) {
  const [{ slots }, { subjects }] = await Promise.all([api.getTimetable(), api.getSubjects()]);
  let slotList = slots;
  const todayDow = (new Date().getDay() + 6) % 7;

  function openSlotModal(existing = null, defaultDay = 0) {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal-card">
        <div class="card-header">
          <h3 class="card-title">${existing ? 'Edit Timetable Slot' : 'Add Timetable Slot'}</h3>
          <button type="button" class="btn btn-sm" id="close-slot-modal">Close</button>
        </div>
        <form id="slot-modal-form">
          <div class="field">
            <label for="sm-title">Session Title *</label>
            <input id="sm-title" class="input" required value="${escapeHtml(existing?.title || '')}" placeholder="e.g. CS201 Lecture or Evening Revision" />
          </div>
          <div class="form-row">
            <div class="field">
              <label for="sm-subject">Subject</label>
              <select id="sm-subject">
                <option value="">General</option>
                ${subjects
                  .map(
                    (s) =>
                      `<option value="${s.id}" ${Number(existing?.subject_id) === s.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`
                  )
                  .join('')}
              </select>
            </div>
            <div class="field">
              <label for="sm-type">Session Type</label>
              <select id="sm-type">
                <option value="class" ${existing?.slot_type === 'class' ? 'selected' : ''}>Class / Lecture</option>
                <option value="study" ${!existing || existing.slot_type === 'study' ? 'selected' : ''}>Self Study</option>
                <option value="lab" ${existing?.slot_type === 'lab' ? 'selected' : ''}>Lab / Tutorial</option>
                <option value="exam" ${existing?.slot_type === 'exam' ? 'selected' : ''}>Exam / Quiz Prep</option>
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="field">
              <label for="sm-day">Day of Week</label>
              <select id="sm-day">
                ${DAY_NAMES.map(
                  (d, idx) =>
                    `<option value="${idx}" ${(existing ? existing.day_of_week : defaultDay) === idx ? 'selected' : ''}>${d}</option>`
                ).join('')}
              </select>
            </div>
            <div class="field">
              <label for="sm-location">Location / Link</label>
              <input id="sm-location" class="input" value="${escapeHtml(existing?.location || '')}" placeholder="Room A-204 / Library" />
            </div>
          </div>
          <div class="form-row">
            <div class="field">
              <label for="sm-start">Start Time *</label>
              <input id="sm-start" class="input" type="time" required value="${escapeHtml(existing?.start_time || '09:00')}" />
            </div>
            <div class="field">
              <label for="sm-end">End Time *</label>
              <input id="sm-end" class="input" type="time" required value="${escapeHtml(existing?.end_time || '10:30')}" />
            </div>
          </div>
          <div class="field">
            <label for="sm-reminder">Reminder Before Session</label>
            <select id="sm-reminder">
              <option value="15" ${Number(existing?.reminder_minutes_before) === 15 ? 'selected' : ''}>15 minutes before</option>
              <option value="30" ${!existing || Number(existing?.reminder_minutes_before) === 30 ? 'selected' : ''}>30 minutes before</option>
              <option value="60" ${Number(existing?.reminder_minutes_before) === 60 ? 'selected' : ''}>1 hour before</option>
            </select>
          </div>
          <div style="display:flex; justify-content:flex-end; gap:0.5rem;">
            <button type="button" class="btn" id="cancel-slot-modal">Cancel</button>
            <button type="submit" class="btn btn-primary">${existing ? 'Save Slot' : 'Add to Timetable'}</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(backdrop);
    const close = () => backdrop.remove();
    backdrop.querySelector('#close-slot-modal').addEventListener('click', close);
    backdrop.querySelector('#cancel-slot-modal').addEventListener('click', close);

    backdrop.querySelector('#slot-modal-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        title: backdrop.querySelector('#sm-title').value.trim(),
        subject_id: backdrop.querySelector('#sm-subject').value ? Number(backdrop.querySelector('#sm-subject').value) : null,
        slot_type: backdrop.querySelector('#sm-type').value,
        day_of_week: Number(backdrop.querySelector('#sm-day').value),
        location: backdrop.querySelector('#sm-location').value.trim(),
        start_time: backdrop.querySelector('#sm-start').value,
        end_time: backdrop.querySelector('#sm-end').value,
        reminder_minutes_before: Number(backdrop.querySelector('#sm-reminder').value),
      };

      try {
        if (existing) {
          const res = await api.updateSlot(existing.id, payload);
          slotList = slotList.map((s) => (s.id === existing.id ? res.slot : s));
          showToast('Timetable slot updated!', 'success');
        } else {
          const res = await api.createSlot(payload);
          slotList = [...slotList, res.slot];
          showToast('Timetable slot added!', 'success');
        }
        close();
        draw();
        app.refreshNotifications();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  function draw() {
    container.innerHTML = `
      <div class="card" style="margin-bottom:1rem; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:0.75rem;">
        <div>
          <h3 class="card-title" style="margin-bottom:0.2rem;">Weekly Class & Study Calendar</h3>
          <span style="font-size:0.86rem; color:var(--text-muted);">${slotList.length} scheduled weekly block${slotList.length === 1 ? '' : 's'}</span>
        </div>
        <button id="add-slot-btn" class="btn btn-primary">+ Add Time Slot</button>
      </div>

      <div class="timetable-grid">
        ${DAY_NAMES.map((dayName, dayIdx) => {
          const daySlots = slotList
            .filter((s) => s.day_of_week === dayIdx)
            .sort((a, b) => a.start_time.localeCompare(b.start_time));
          return `
            <div class="day-column ${dayIdx === todayDow ? 'today' : ''}">
              <div class="day-header">
                <span>${dayName} ${dayIdx === todayDow ? '<span class="badge badge-primary">Today</span>' : ''}</span>
                <button class="btn btn-sm quick-add-day" data-day="${dayIdx}" title="Add slot on ${dayName}">+</button>
              </div>
              ${
                daySlots.length === 0
                  ? `<div style="font-size:0.8rem; color:var(--text-muted); text-align:center; padding:1.5rem 0.25rem;">Free day</div>`
                  : daySlots
                      .map(
                        (slot) => `
                    <div class="slot-card" style="border-left-color:${escapeHtml(slot.subject_color || '#4f46e5')};">
                      <div style="display:flex; justify-content:space-between; gap:0.25rem; align-items:flex-start;">
                        <strong>${escapeHtml(slot.title)}</strong>
                        <span class="badge">${escapeHtml(slot.slot_type)}</span>
                      </div>
                      <div class="tabular" style="font-weight:600; color:var(--primary); font-size:0.78rem;">
                        ${escapeHtml(slot.start_time)} – ${escapeHtml(slot.end_time)}
                      </div>
                      ${slot.subject_name ? `<div style="font-size:0.76rem; color:var(--text-muted);">${escapeHtml(slot.subject_name)}</div>` : ''}
                      ${slot.location ? `<div style="font-size:0.76rem; color:var(--text-muted);">${escapeHtml(slot.location)}</div>` : ''}
                      <div style="display:flex; gap:0.3rem; margin-top:0.45rem;">
                        <button class="btn btn-sm edit-slot-btn" data-id="${slot.id}" style="padding:0.2rem 0.45rem; font-size:0.74rem;">Edit</button>
                        <button class="btn btn-sm btn-danger delete-slot-btn" data-id="${slot.id}" style="padding:0.2rem 0.45rem; font-size:0.74rem;">Del</button>
                      </div>
                    </div>
                  `
                      )
                      .join('')
              }
            </div>
          `;
        }).join('')}
      </div>
    `;

    container.querySelector('#add-slot-btn').addEventListener('click', () => openSlotModal(null, todayDow));
    container.querySelectorAll('.quick-add-day').forEach((btn) => {
      btn.addEventListener('click', () => openSlotModal(null, Number(btn.dataset.day)));
    });
    container.querySelectorAll('.edit-slot-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const found = slotList.find((s) => s.id === Number(btn.dataset.id));
        if (found) openSlotModal(found);
      });
    });
    container.querySelectorAll('.delete-slot-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await api.deleteSlot(Number(btn.dataset.id));
          slotList = slotList.filter((s) => s.id !== Number(btn.dataset.id));
          showToast('Slot removed from timetable', 'info');
          draw();
          app.refreshNotifications();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });
  }

  draw();
}
