import { api } from '../api.js';
import { escapeHtml, showToast } from '../utils.js';

export function renderAuthView(container, { notice, onAuthenticated }) {
  let mode = 'login';

  function draw() {
    container.innerHTML = `
      <div class="auth-shell">
        <section class="auth-hero">
          <div class="brand-mark">
            <span class="brand-icon">SF</span>
            <span>StudyFlow</span>
          </div>
          <div>
            <h1>Organize your semester, master every deadline.</h1>
            <p>
              Built for students to keep classes, assignments, syllabus progress, lecture notes,
              and focused study hours in one calm workspace.
            </p>
            <div class="hero-pills">
              <div class="hero-pill"><strong>Weekly Timetable</strong><br />Visual class & study calendar</div>
              <div class="hero-pill"><strong>Tasks & Subtasks</strong><br />Break big assignments down</div>
              <div class="hero-pill"><strong>Syllabus Tracker</strong><br />Live completion per subject</div>
              <div class="hero-pill"><strong>Focus Timer & Reports</strong><br />Log hours & export summaries</div>
            </div>
          </div>
          <small style="opacity: 0.78;">StudyFlow — Student Study Management System</small>
        </section>

        <section class="auth-panel">
          <div class="auth-card">
            ${notice ? `<div class="alert alert-warning">${escapeHtml(notice)}</div>` : ''}
            <div class="tabs-segmented" role="tablist">
              <button type="button" id="tab-login" class="${mode === 'login' ? 'active' : ''}">Sign In</button>
              <button type="button" id="tab-register" class="${mode === 'register' ? 'active' : ''}">Create Account</button>
            </div>

            ${
              mode === 'login'
                ? `
              <form id="login-form">
                <div class="field">
                  <label for="login-email">College Email</label>
                  <input id="login-email" class="input" type="email" required placeholder="you@university.edu" autocomplete="email" />
                </div>
                <div class="field">
                  <label for="login-password">Password</label>
                  <input id="login-password" class="input" type="password" required placeholder="Enter your password" autocomplete="current-password" />
                </div>
                <div id="auth-error" class="alert alert-danger" style="display:none;"></div>
                <button class="btn btn-primary" type="submit" style="width:100%;">Sign In to Dashboard</button>
              </form>
              <div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--border); text-align:center;">
                <p style="margin: 0 0 0.6rem; font-size: 0.85rem; color: var(--text-muted);">
                  Want to explore right away? Try the pre-loaded student demo account:
                </p>
                <button type="button" id="demo-login-btn" class="btn" style="width:100%;">
                  Sign in as Demo Student (demo@studyflow.edu)
                </button>
              </div>
            `
                : `
              <form id="register-form">
                <div class="field">
                  <label for="reg-name">Full Name</label>
                  <input id="reg-name" class="input" type="text" required placeholder="Alex Rivera" />
                </div>
                <div class="field">
                  <label for="reg-email">College Email</label>
                  <input id="reg-email" class="input" type="email" required placeholder="alex@college.edu" />
                </div>
                <div class="form-row">
                  <div class="field">
                    <label for="reg-institution">College / University</label>
                    <input id="reg-institution" class="input" type="text" placeholder="Optional" />
                  </div>
                  <div class="field">
                    <label for="reg-semester">Semester</label>
                    <input id="reg-semester" class="input" type="text" placeholder="e.g. Fall 2026" />
                  </div>
                </div>
                <div class="field">
                  <label for="reg-password">Password (min 6 characters)</label>
                  <input id="reg-password" class="input" type="password" minlength="6" required placeholder="Create a strong password" />
                </div>
                <label style="display:flex; align-items:center; gap:0.5rem; font-size:0.86rem; margin-bottom:0.9rem; cursor:pointer;">
                  <input type="checkbox" id="reg-sample" checked />
                  <span>Pre-load sample subjects & timetable so I can explore faster</span>
                </label>
                <div id="auth-error" class="alert alert-danger" style="display:none;"></div>
                <button class="btn btn-primary" type="submit" style="width:100%;">Create Student Account</button>
              </form>
            `
            }
          </div>
        </section>
      </div>
    `;

    container.querySelector('#tab-login').addEventListener('click', () => {
      mode = 'login';
      draw();
    });
    container.querySelector('#tab-register').addEventListener('click', () => {
      mode = 'register';
      draw();
    });

    const errBox = container.querySelector('#auth-error');
    const showErr = (msg) => {
      errBox.textContent = msg;
      errBox.style.display = 'block';
    };

    if (mode === 'login') {
      container.querySelector('#login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        errBox.style.display = 'none';
        try {
          const res = await api.login({
            email: container.querySelector('#login-email').value.trim(),
            password: container.querySelector('#login-password').value,
          });
          showToast(`Welcome back, ${res.user.full_name}!`, 'success');
          onAuthenticated(res.user);
        } catch (err) {
          showErr(err.message);
        }
      });

      container.querySelector('#demo-login-btn').addEventListener('click', async () => {
        errBox.style.display = 'none';
        try {
          const res = await api.login({
            email: 'demo@studyflow.edu',
            password: 'StudyFlow123!',
          });
          showToast('Signed in to demo student workspace', 'success');
          onAuthenticated(res.user);
        } catch (err) {
          showErr(err.message);
        }
      });
    } else {
      container.querySelector('#register-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        errBox.style.display = 'none';
        try {
          const res = await api.register({
            full_name: container.querySelector('#reg-name').value.trim(),
            email: container.querySelector('#reg-email').value.trim(),
            institution: container.querySelector('#reg-institution').value.trim(),
            semester: container.querySelector('#reg-semester').value.trim(),
            password: container.querySelector('#reg-password').value,
            load_sample_data: container.querySelector('#reg-sample').checked,
          });
          showToast('Account created! Welcome to StudyFlow.', 'success');
          onAuthenticated(res.user);
        } catch (err) {
          showErr(err.message);
        }
      });
    }
  }

  draw();
}
