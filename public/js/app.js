import { api, setUnauthorizedHandler } from './api.js';
import { escapeHtml, formatTimerClock, showToast } from './utils.js';
import { renderAuthView } from './views/auth.js';
import { renderDashboardView } from './views/dashboard.js';
import { renderTasksView } from './views/tasks.js';
import { renderTimetableView } from './views/timetable.js';
import { renderSubjectsView } from './views/subjects.js';
import { renderNotesView } from './views/notes.js';
import { renderTimerView } from './views/timer.js';
import { renderReportsView } from './views/reports.js';
import { renderAiView } from './views/ai.js';

const TIMER_STORAGE_KEY = 'studyflow_timer_v1';

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', short: 'Home', icon: '⌂' },
  { id: 'ai', label: 'AI Study Assistant', short: 'AI', icon: '✦' },
  { id: 'tasks', label: 'Tasks & Subtasks', short: 'Tasks', icon: '✓' },
  { id: 'timetable', label: 'Timetable', short: 'Schedule', icon: '◫' },
  { id: 'subjects', label: 'Subjects & Syllabus', short: 'Subjects', icon: '◈' },
  { id: 'notes', label: 'Notes & Files', short: 'Notes', icon: '▤' },
  { id: 'timer', label: 'Focus Timer', short: 'Timer', icon: '⏱' },
  { id: 'reports', label: 'Reports', short: 'Reports', icon: '◔' },
];

const VIEW_RENDERERS = {
  dashboard: renderDashboardView,
  ai: renderAiView,
  tasks: renderTasksView,
  timetable: renderTimetableView,
  subjects: renderSubjectsView,
  notes: renderNotesView,
  timer: renderTimerView,
  reports: renderReportsView,
};

function loadTimerState() {
  try {
    const raw = localStorage.getItem(TIMER_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore corrupted storage
  }
  return { running: false, startedAt: null, accumulatedSec: 0, subjectId: '', taskId: '', notes: '' };
}

class StudyFlowApp {
  constructor() {
    this.root = document.getElementById('app');
    this.user = null;
    this.currentView = 'dashboard';
    this.notifications = [];
    this.unreadCount = 0;
    this.notifOpen = false;
    this.mobileMenuOpen = false;
    this.timer = loadTimerState();
    this.tickInterval = null;
    this.notifPollInterval = null;

    setUnauthorizedHandler((msg) => {
      this.user = null;
      this.stopLoops();
      this.renderAuth(msg);
    });

    document.addEventListener('click', (e) => {
      if (!this.notifOpen) return;
      const pop = document.getElementById('notif-popover');
      const toggle = document.getElementById('notif-toggle-btn');
      if (pop && !pop.contains(e.target) && toggle && !toggle.contains(e.target)) {
        this.notifOpen = false;
        this.renderNotifPopover();
      }
    });
  }

  saveTimer() {
    try {
      localStorage.setItem(TIMER_STORAGE_KEY, JSON.stringify(this.timer));
    } catch {
      // ignore
    }
  }

  getTimerElapsedSeconds() {
    if (!this.timer.running || !this.timer.startedAt) {
      return this.timer.accumulatedSec || 0;
    }
    return (this.timer.accumulatedSec || 0) + Math.floor((Date.now() - this.timer.startedAt) / 1000);
  }

  startTimer() {
    if (this.timer.running) return;
    this.timer.running = true;
    this.timer.startedAt = Date.now();
    this.saveTimer();
    this.updateTimerPills();
  }

  pauseTimer() {
    if (!this.timer.running) return;
    this.timer.accumulatedSec = this.getTimerElapsedSeconds();
    this.timer.running = false;
    this.timer.startedAt = null;
    this.saveTimer();
    this.updateTimerPills();
  }

  resetTimer() {
    this.timer = { running: false, startedAt: null, accumulatedSec: 0, subjectId: '', taskId: '', notes: '' };
    this.saveTimer();
    this.updateTimerPills();
  }

  updateTimerMeta(patch) {
    this.timer = { ...this.timer, ...patch };
    this.saveTimer();
  }

  updateTimerPills() {
    const clockEl = document.getElementById('timer-clock');
    const pillEl = document.getElementById('topbar-timer-pill');
    const secs = this.getTimerElapsedSeconds();
    if (clockEl) clockEl.textContent = formatTimerClock(secs);
    if (pillEl) {
      if (this.timer.running || secs > 0) {
        pillEl.style.display = 'inline-flex';
        pillEl.textContent = `${this.timer.running ? '●' : '❚❚'} ${formatTimerClock(secs)}`;
      } else {
        pillEl.style.display = 'none';
      }
    }
  }

  async init() {
    try {
      const res = await api.me();
      this.user = res.user;
      this.startLoops();
      await this.renderShell();
    } catch {
      this.renderAuth('');
    }
  }

  renderAuth(notice = '') {
    renderAuthView(this.root, {
      notice,
      onAuthenticated: async (user) => {
        this.user = user;
        this.currentView = 'dashboard';
        this.startLoops();
        await this.renderShell();
      },
    });
  }

  startLoops() {
    this.stopLoops();
    this.tickInterval = setInterval(() => this.updateTimerPills(), 1000);
    this.notifPollInterval = setInterval(() => this.refreshNotifications(), 60000);
  }

  stopLoops() {
    if (this.tickInterval) clearInterval(this.tickInterval);
    if (this.notifPollInterval) clearInterval(this.notifPollInterval);
  }

  async refreshNotifications() {
    if (!this.user) return;
    try {
      const res = await api.getNotifications();
      this.notifications = res.notifications;
      this.unreadCount = res.unread_count;
      const badge = document.getElementById('notif-badge');
      if (badge) {
        badge.textContent = String(this.unreadCount);
        badge.style.display = this.unreadCount > 0 ? 'grid' : 'none';
      }
      if (this.notifOpen) {
        this.renderNotifPopover();
      }
    } catch {
      // handled by unauthorized handler if 401
    }
  }

  renderNotifPopover() {
    const pop = document.getElementById('notif-popover');
    if (!pop) return;
    if (!this.notifOpen) {
      pop.style.display = 'none';
      return;
    }
    pop.style.display = 'block';
    pop.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.65rem;">
        <strong>Reminders & Alerts</strong>
        ${this.unreadCount > 0 ? `<button id="mark-all-read-btn" class="btn btn-sm">Mark all read</button>` : ''}
      </div>
      ${
        this.notifications.length === 0
          ? `<div style="text-align:center; color:var(--text-muted); padding:1rem; font-size:0.86rem;">No upcoming reminders right now.</div>`
          : this.notifications
              .map(
                (n) => `
              <div class="notif-item ${n.is_read ? '' : 'unread'}">
                <div style="display:flex; justify-content:space-between; gap:0.5rem;">
                  <strong style="font-size:0.86rem;">${escapeHtml(n.title)}</strong>
                  <button class="btn btn-sm dismiss-notif-btn" data-id="${n.id}" style="padding:0.1rem 0.4rem;">×</button>
                </div>
                <p style="margin:0.2rem 0 0; font-size:0.8rem; color:var(--text-muted);">${escapeHtml(n.message)}</p>
                ${
                  !n.is_read
                    ? `<button class="btn btn-sm read-notif-btn" data-id="${n.id}" style="margin-top:0.4rem; padding:0.15rem 0.45rem; font-size:0.74rem;">Mark read</button>`
                    : ''
                }
              </div>
            `
              )
              .join('')
      }
    `;

    pop.querySelector('#mark-all-read-btn')?.addEventListener('click', async () => {
      try {
        await api.markAllNotificationsRead();
        await this.refreshNotifications();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
    pop.querySelectorAll('.read-notif-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await api.markNotificationRead(Number(btn.dataset.id));
          await this.refreshNotifications();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });
    pop.querySelectorAll('.dismiss-notif-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await api.dismissNotification(Number(btn.dataset.id));
          await this.refreshNotifications();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });
  }

  async navigate(viewId) {
    if (!VIEW_RENDERERS[viewId]) return;
    this.currentView = viewId;
    this.mobileMenuOpen = false;
    this.notifOpen = false;
    await this.renderShell();
  }

  async refresh() {
    await this.renderCurrentView();
    await this.refreshNotifications();
  }

  async renderShell() {
    const activeItem = NAV_ITEMS.find((n) => n.id === this.currentView) || NAV_ITEMS[0];
    const initials = (this.user.full_name || 'S')
      .split(' ')
      .map((w) => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();

    this.root.innerHTML = `
      <div class="app-layout">
        <aside class="sidebar ${this.mobileMenuOpen ? 'open' : ''}" id="sidebar">
          <div class="sidebar-brand">
            <span class="brand-badge">SF</span>
            <span>StudyFlow</span>
          </div>
          <nav class="nav-list" aria-label="Main navigation">
            ${NAV_ITEMS.map(
              (item) => `
              <button class="nav-btn ${item.id === this.currentView ? 'active' : ''}" data-view="${item.id}">
                <span>${item.icon}</span>
                <span>${item.label}</span>
              </button>
            `
            ).join('')}
          </nav>
          <div class="sidebar-footer">
            <div class="user-chip">
              <div class="avatar">${escapeHtml(initials)}</div>
              <div class="user-meta">
                <strong>${escapeHtml(this.user.full_name)}</strong>
                <span>${escapeHtml(this.user.email)}</span>
              </div>
            </div>
            <button id="logout-btn" class="btn btn-sm" style="width:100%;">Sign Out</button>
          </div>
        </aside>

        <div class="main-area">
          <header class="topbar">
            <div class="topbar-left">
              <button id="mobile-menu-toggle" class="btn btn-icon mobile-menu-btn" aria-label="Toggle menu">☰</button>
              <h1 class="topbar-title">${escapeHtml(activeItem.label)}</h1>
            </div>
            <div class="topbar-actions">
              <button id="topbar-timer-pill" class="btn btn-sm badge-primary tabular" style="display:none;" title="Open Focus Timer"></button>
              <button id="quick-tasks-btn" class="btn btn-primary btn-sm">+ Tasks</button>
              <button id="notif-toggle-btn" class="btn btn-icon" style="position:relative;" aria-label="Notifications">
                🔔
                <span id="notif-badge" class="notif-badge" style="display:none;">0</span>
              </button>
              <div id="notif-popover" class="notif-popover" style="display:none;"></div>
            </div>
          </header>

          <main class="page-content" id="view-container">
            <div class="card" style="text-align:center; padding:2rem; color:var(--text-muted);">Loading...</div>
          </main>
        </div>

        <nav class="mobile-bottom-nav" aria-label="Mobile navigation">
          ${NAV_ITEMS.slice(0, 5)
            .map(
              (item) => `
            <button class="${item.id === this.currentView ? 'active' : ''}" data-view="${item.id}">
              <span>${item.icon}</span>
              <span>${item.short}</span>
            </button>
          `
            )
            .join('')}
        </nav>
      </div>
    `;

    this.root.querySelectorAll('[data-view]').forEach((btn) => {
      btn.addEventListener('click', () => this.navigate(btn.dataset.view));
    });

    this.root.querySelector('#mobile-menu-toggle').addEventListener('click', () => {
      this.mobileMenuOpen = !this.mobileMenuOpen;
      this.root.querySelector('#sidebar').classList.toggle('open', this.mobileMenuOpen);
    });

    this.root.querySelector('#quick-tasks-btn').addEventListener('click', () => this.navigate('tasks'));
    this.root.querySelector('#topbar-timer-pill').addEventListener('click', () => this.navigate('timer'));

    this.root.querySelector('#notif-toggle-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      this.notifOpen = !this.notifOpen;
      if (this.notifOpen) {
        await this.refreshNotifications();
      } else {
        this.renderNotifPopover();
      }
    });

    this.root.querySelector('#logout-btn').addEventListener('click', async () => {
      try {
        await api.logout();
      } catch {
        // proceed with local sign-out even if session already expired
      }
      this.user = null;
      this.stopLoops();
      showToast('Signed out', 'info');
      this.renderAuth('');
    });

    this.updateTimerPills();
    await Promise.all([this.renderCurrentView(), this.refreshNotifications()]);
  }

  async renderCurrentView() {
    const viewContainer = document.getElementById('view-container');
    if (!viewContainer) return;
    const renderer = VIEW_RENDERERS[this.currentView];
    try {
      await renderer(viewContainer, this);
    } catch (err) {
      viewContainer.innerHTML = `<div class="alert alert-danger">Could not load view: ${escapeHtml(err.message)}</div>`;
    }
  }
}

const app = new StudyFlowApp();
app.init();
