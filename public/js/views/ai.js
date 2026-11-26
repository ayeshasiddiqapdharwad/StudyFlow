import { api } from '../api.js';
import { escapeHtml, formatDate, showToast } from '../utils.js';

const AI_TABS = [
  { id: 'chat', label: 'AI Chat' },
  { id: 'explainer', label: 'Topic Explainer' },
  { id: 'quiz', label: 'Quiz Generator' },
  { id: 'planner', label: 'Study Planner' },
  { id: 'summary', label: 'Notes Summariser' },
  { id: 'exam_prep', label: 'Exam Prep' },
];

export async function renderAiView(container, app) {
  const [statusData, { subjects }, { notes }] = await Promise.all([
    api.aiStatus(),
    api.getSubjects(),
    api.getNotes(),
  ]);

  let activeTab = app.aiInitialTab || 'chat';
  app.aiInitialTab = null;

  let selectedModel = statusData.default_model || 'gemini-2.5-flash';
  let configured = statusData.configured;
  let models = statusData.models || [];
  let chatMessages = statusData.chat_messages || [];
  let historyList = statusData.history || [];

  let loadingMsg = '';
  let errorMsg = '';

  // Active results per tab
  let explainerResult = historyList.find((h) => h.feature_type === 'explainer')?.output || null;
  let quizResult = historyList.find((h) => h.feature_type === 'quiz')?.output || null;
  let quizAnswers = {};
  let quizSubmitted = false;

  let planResult = historyList.find((h) => h.feature_type === 'planner')?.output || null;
  let summaryResult = historyList.find((h) => h.feature_type === 'summary')?.output || null;
  let examResult = historyList.find((h) => h.feature_type === 'exam_prep')?.output || null;
  let mockAnswers = {};
  let mockSubmitted = false;

  function subjectOptionsHtml(selectedId = '') {
    return `
      <option value="">General / All Subjects</option>
      ${subjects
        .map(
          (s) =>
            `<option value="${s.id}" ${String(selectedId) === String(s.id) ? 'selected' : ''}>${escapeHtml(s.name)}${
              s.code ? ` (${escapeHtml(s.code)})` : ''
            }</option>`
        )
        .join('')}
    `;
  }

  function renderMcqBlock(questions, answersMap, submitted, prefix) {
    if (!Array.isArray(questions) || questions.length === 0) {
      return '<div class="empty-state">No questions generated.</div>';
    }
    let correctCount = 0;
    if (submitted) {
      questions.forEach((q, idx) => {
        if (Number(answersMap[idx]) === Number(q.correct_index)) correctCount += 1;
      });
    }

    return `
      ${
        submitted
          ? `<div class="alert ${correctCount >= Math.ceil(questions.length * 0.6) ? 'badge-success' : 'alert-warning'}" style="margin-bottom:0.85rem;">
               <strong>Score: ${correctCount} / ${questions.length}</strong> (${Math.round(
              (correctCount / questions.length) * 100
            )}%)
             </div>`
          : ''
      }
      <div style="display:flex; flex-direction:column; gap:0.85rem;">
        ${questions
          .map((q, qIdx) => {
            const chosen = answersMap[qIdx];
            const options = Array.isArray(q.options) ? q.options : [];
            return `
              <div class="card" style="padding:0.9rem;">
                <div style="font-weight:700; margin-bottom:0.55rem;">${qIdx + 1}. ${escapeHtml(q.question)}</div>
                <div>
                  ${options
                    .map((opt, oIdx) => {
                      let cls = 'quiz-option';
                      if (submitted) {
                        if (oIdx === Number(q.correct_index)) cls += ' correct';
                        else if (Number(chosen) === oIdx) cls += ' wrong';
                      }
                      return `
                        <label class="${cls}">
                          <input type="radio" name="${prefix}-q-${qIdx}" value="${oIdx}" data-q="${qIdx}"
                            class="${prefix}-radio" ${Number(chosen) === oIdx ? 'checked' : ''} ${submitted ? 'disabled' : ''} />
                          <span>${escapeHtml(opt)}</span>
                        </label>
                      `;
                    })
                    .join('')}
                </div>
                ${
                  submitted
                    ? `<div style="margin-top:0.5rem; padding:0.55rem 0.7rem; background:var(--surface-alt); border-radius:var(--radius-sm); font-size:0.85rem;">
                         <strong>Explanation:</strong> ${escapeHtml(q.explanation || 'See highlighted correct option.')}
                       </div>`
                    : ''
                }
              </div>
            `;
          })
          .join('')}
      </div>
      <div style="display:flex; gap:0.5rem; margin-top:0.85rem;">
        ${
          !submitted
            ? `<button type="button" id="${prefix}-submit-btn" class="btn btn-primary">Check Answers</button>`
            : `<button type="button" id="${prefix}-retry-btn" class="btn">Retake</button>`
        }
      </div>
    `;
  }

  function renderMainPanel() {
    if (activeTab === 'chat') {
      return `
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Academic AI Tutor Chat</h3>
            ${chatMessages.length > 0 ? `<button id="clear-chat-btn" class="btn btn-sm">Clear Chat</button>` : ''}
          </div>
          <div class="chat-box" id="ai-chat-box">
            ${
              chatMessages.length === 0
                ? `<div style="text-align:center; color:var(--text-muted); margin:auto; padding:2rem 1rem;">
                     Ask any academic question — from calculus proofs and algorithms to essay outlines.
                   </div>`
                : chatMessages
                    .map(
                      (m) => `
                    <div class="chat-bubble ${m.role === 'user' ? 'user' : 'model'}">${escapeHtml(m.content)}</div>
                  `
                    )
                    .join('')
            }
          </div>
          <form id="ai-chat-form">
            <div class="form-row" style="margin-bottom:0.5rem;">
              <div class="field" style="margin:0;">
                <label for="chat-subject">Subject Context (Optional)</label>
                <select id="chat-subject">${subjectOptionsHtml()}</select>
              </div>
              <div class="field" style="margin:0; justify-content:end;">
                <label>&nbsp;</label>
                <span style="font-size:0.8rem; color:var(--text-muted);">Model: <strong>${escapeHtml(selectedModel)}</strong></span>
              </div>
            </div>
            <div style="display:flex; gap:0.5rem;">
              <input id="chat-input" class="input" placeholder="Ask a question (e.g. How does Dijkstra's algorithm handle negative weights?)..." required ${
                loadingMsg ? 'disabled' : ''
              } />
              <button type="submit" class="btn btn-primary" ${loadingMsg ? 'disabled' : ''}>Send</button>
            </div>
          </form>
        </div>
      `;
    }

    if (activeTab === 'explainer') {
      return `
        <div class="card" style="margin-bottom:1rem;">
          <div class="card-header"><h3 class="card-title">Topic Explainer with Beginner Examples</h3></div>
          <form id="explainer-form">
            <div class="form-row">
              <div class="field">
                <label for="exp-topic">Topic to Explain *</label>
                <input id="exp-topic" class="input" required placeholder="e.g. Recursion, Normalization (3NF), Eigenvalues" />
              </div>
              <div class="field">
                <label for="exp-subject">Subject</label>
                <select id="exp-subject">${subjectOptionsHtml()}</select>
              </div>
            </div>
            <div class="form-row">
              <div class="field">
                <label for="exp-level">Explanation Level</label>
                <select id="exp-level">
                  <option value="beginner">Beginner (intuitive + simple examples)</option>
                  <option value="intermediate">Intermediate (university depth)</option>
                  <option value="advanced">Advanced (formal & rigorous)</option>
                </select>
              </div>
              <div class="field">
                <label for="exp-focus">Specific Question / Focus (Optional)</label>
                <input id="exp-focus" class="input" placeholder="e.g. Focus on step-by-step tracing" />
              </div>
            </div>
            <button type="submit" class="btn btn-primary" ${loadingMsg ? 'disabled' : ''}>Explain Topic</button>
          </form>
        </div>

        ${
          explainerResult
            ? `<div class="card">
                <h3 style="margin:0 0 0.4rem;">${escapeHtml(explainerResult.title || 'Topic Explanation')}</h3>
                <p style="margin:0 0 0.85rem;">${escapeHtml(explainerResult.summary || '')}</p>
                ${
                  explainerResult.intuitive_analogy
                    ? `<div class="alert" style="background:var(--primary-soft); border:1px solid #c7d2fe;">
                         <strong>Everyday Analogy:</strong> ${escapeHtml(explainerResult.intuitive_analogy)}
                       </div>`
                    : ''
                }
                ${
                  Array.isArray(explainerResult.core_concepts) && explainerResult.core_concepts.length
                    ? `<h4 style="margin:0.9rem 0 0.4rem;">Core Concepts</h4>
                       <div style="display:flex; flex-direction:column; gap:0.45rem;">
                         ${explainerResult.core_concepts
                           .map(
                             (c) => `<div style="padding:0.55rem 0.7rem; background:var(--surface-alt); border-radius:var(--radius-sm);">
                               <strong>${escapeHtml(c.name)}:</strong> ${escapeHtml(c.explanation)}
                             </div>`
                           )
                           .join('')}
                       </div>`
                    : ''
                }
                ${
                  Array.isArray(explainerResult.beginner_examples) && explainerResult.beginner_examples.length
                    ? `<h4 style="margin:0.9rem 0 0.4rem;">Beginner-Friendly Examples</h4>
                       <div style="display:flex; flex-direction:column; gap:0.5rem;">
                         ${explainerResult.beginner_examples
                           .map(
                             (ex) => `<div style="padding:0.65rem 0.75rem; border:1px solid var(--border); border-radius:var(--radius-sm);">
                               <strong>${escapeHtml(ex.title)}</strong>
                               <p style="margin:0.25rem 0 0; white-space:pre-wrap; font-size:0.89rem;">${escapeHtml(ex.walkthrough)}</p>
                             </div>`
                           )
                           .join('')}
                       </div>`
                    : ''
                }
                ${
                  Array.isArray(explainerResult.common_mistakes) && explainerResult.common_mistakes.length
                    ? `<h4 style="margin:0.9rem 0 0.4rem;">Common Mistakes to Avoid</h4>
                       <ul style="margin:0; padding-left:1.2rem;">
                         ${explainerResult.common_mistakes.map((m) => `<li>${escapeHtml(m)}</li>`).join('')}
                       </ul>`
                    : ''
                }
                ${
                  explainerResult.quick_check
                    ? `<details style="margin-top:0.9rem; padding:0.6rem 0.75rem; background:var(--surface-alt); border-radius:var(--radius-sm);">
                         <summary style="cursor:pointer; font-weight:700;">Quick Self-Check: ${escapeHtml(explainerResult.quick_check.question)}</summary>
                         <p style="margin:0.45rem 0 0;">${escapeHtml(explainerResult.quick_check.answer)}</p>
                       </details>`
                    : ''
                }
              </div>`
            : ''
        }
      `;
    }

    if (activeTab === 'quiz') {
      return `
        <div class="card" style="margin-bottom:1rem;">
          <div class="card-header"><h3 class="card-title">MCQ Quiz Generator</h3></div>
          <form id="quiz-form">
            <div class="form-row">
              <div class="field">
                <label for="qz-topic">Quiz Topic *</label>
                <input id="qz-topic" class="input" required placeholder="e.g. Binary Search Trees, SQL Joins" />
              </div>
              <div class="field">
                <label for="qz-subject">Subject</label>
                <select id="qz-subject">${subjectOptionsHtml()}</select>
              </div>
            </div>
            <div class="form-row">
              <div class="field">
                <label for="qz-difficulty">Difficulty</label>
                <select id="qz-difficulty">
                  <option value="easy">Easy</option>
                  <option value="medium" selected>Medium</option>
                  <option value="hard">Hard</option>
                </select>
              </div>
              <div class="field">
                <label for="qz-count">Number of Questions (3–15)</label>
                <input id="qz-count" class="input" type="number" min="3" max="15" value="5" />
              </div>
            </div>
            <div class="field">
              <label for="qz-context">Optional Notes / Reference Text</label>
              <textarea id="qz-context" rows="2" placeholder="Paste key notes if you want questions tailored to them..."></textarea>
            </div>
            <button type="submit" class="btn btn-primary" ${loadingMsg ? 'disabled' : ''}>Generate Interactive Quiz</button>
          </form>
        </div>

        ${
          quizResult
            ? `<div class="card">
                <div class="card-header">
                  <h3 class="card-title">${escapeHtml(quizResult.title || 'Generated Quiz')}</h3>
                  <span class="badge badge-primary">${escapeHtml(quizResult.difficulty || 'medium')}</span>
                </div>
                ${renderMcqBlock(quizResult.questions, quizAnswers, quizSubmitted, 'quiz')}
              </div>`
            : ''
        }
      `;
    }

    if (activeTab === 'planner') {
      return `
        <div class="card" style="margin-bottom:1rem;">
          <div class="card-header">
            <h3 class="card-title">Personalised Daily & Weekly Study Planner</h3>
          </div>
          <p style="margin:0 0 0.85rem; font-size:0.88rem; color:var(--text-muted);">
            Gemini automatically reads your StudyFlow subjects, pending deadlines, incomplete syllabus topics, and weekly timetable.
          </p>
          <form id="planner-form">
            <div class="form-row">
              <div class="field">
                <label for="pl-hours">Daily Study Hours Available</label>
                <input id="pl-hours" class="input" type="number" step="0.5" min="0.5" max="14" value="3" />
              </div>
              <div class="field">
                <label for="pl-mode">Planning Strategy</label>
                <select id="pl-mode">
                  <option value="balanced">Balanced Across All Subjects</option>
                  <option value="deadline_first">Urgent Deadlines First</option>
                  <option value="exam_crunch">Exam Preparation Focus</option>
                </select>
              </div>
            </div>
            <div class="field">
              <label for="pl-goal">Personal Focus Goal (Optional)</label>
              <input id="pl-goal" class="input" placeholder="e.g. Finish Algorithms lab and catch up on Linear Algebra" />
            </div>
            <button type="submit" class="btn btn-primary" ${loadingMsg ? 'disabled' : ''}>Generate My Study Plan</button>
          </form>
        </div>

        ${
          planResult
            ? `<div class="card" style="margin-bottom:1rem;">
                <h3 style="margin:0 0 0.4rem;">Strategy Overview</h3>
                <p style="margin:0 0 0.75rem;">${escapeHtml(planResult.overview || '')}</p>
                ${
                  Array.isArray(planResult.priority_focus) && planResult.priority_focus.length
                    ? `<div style="display:flex; gap:0.4rem; flex-wrap:wrap; margin-bottom:0.9rem;">
                         ${planResult.priority_focus.map((p) => `<span class="badge badge-primary">${escapeHtml(p)}</span>`).join('')}
                       </div>`
                    : ''
                }
                <h4 style="margin:0.5rem 0;">Today's Recommended Schedule</h4>
                <div style="display:flex; flex-direction:column; gap:0.45rem; margin-bottom:1rem;">
                  ${(planResult.today_plan || [])
                    .map(
                      (b) => `
                    <div class="slot-card">
                      <div style="display:flex; justify-content:space-between; gap:0.5rem;">
                        <strong>${escapeHtml(b.activity)}</strong>
                        <span class="badge">${escapeHtml(b.time_block)} (${b.duration_minutes}m)</span>
                      </div>
                      <div style="font-size:0.8rem; color:var(--text-muted);">${escapeHtml(b.subject)} · ${escapeHtml(b.reason || '')}</div>
                    </div>
                  `
                    )
                    .join('')}
                </div>
                <h4 style="margin:0.5rem 0;">7-Day Weekly Roadmap</h4>
                <div class="grid grid-2">
                  ${(planResult.weekly_plan || [])
                    .map(
                      (d) => `
                    <div style="padding:0.7rem; border:1px solid var(--border); border-radius:var(--radius-sm); background:var(--surface-alt);">
                      <div style="display:flex; justify-content:space-between; margin-bottom:0.35rem;">
                        <strong>${escapeHtml(d.day)}</strong>
                        <span class="badge">${escapeHtml(d.focus_subject)}</span>
                      </div>
                      <ul style="margin:0 0 0.35rem; padding-left:1.1rem; font-size:0.84rem;">
                        ${(d.sessions || [])
                          .map((s) => `<li>${escapeHtml(s.activity)} (${s.duration_minutes}m)</li>`)
                          .join('')}
                      </ul>
                      <div style="font-size:0.78rem; color:var(--text-muted);">Goal: ${escapeHtml(d.goal || '')}</div>
                    </div>
                  `
                    )
                    .join('')}
                </div>
              </div>`
            : ''
        }
      `;
    }

    if (activeTab === 'summary') {
      return `
        <div class="card" style="margin-bottom:1rem;">
          <div class="card-header"><h3 class="card-title">Notes Summariser (Document Upload & Saved Notes)</h3></div>
          <form id="summary-form">
            <div class="form-row">
              <div class="field">
                <label for="sum-saved-note">Summarize Existing StudyFlow Note (Optional)</label>
                <select id="sum-saved-note">
                  <option value="">— Or upload/paste below —</option>
                  ${notes
                    .map(
                      (n) =>
                        `<option value="${n.id}">${escapeHtml(n.title)}${n.file_name ? ` (${escapeHtml(n.file_name)})` : ''}</option>`
                    )
                    .join('')}
                </select>
              </div>
              <div class="field">
                <label for="sum-subject">Subject</label>
                <select id="sum-subject">${subjectOptionsHtml()}</select>
              </div>
            </div>
            <div class="form-row">
              <div class="field">
                <label for="sum-file">Upload Study Document (PDF, TXT, MD, CSV, PNG/JPG)</label>
                <input id="sum-file" class="input" type="file" accept=".pdf,.txt,.md,.csv,.png,.jpg,.jpeg,.webp" />
              </div>
              <div class="field">
                <label for="sum-title">Custom Title (Optional)</label>
                <input id="sum-title" class="input" placeholder="e.g. Chapter 7 Lecture Summary" />
              </div>
            </div>
            <div class="field">
              <label for="sum-text">Or Paste Lecture Notes / Text</label>
              <textarea id="sum-text" rows="4" placeholder="Paste raw notes, textbook paragraphs, or key bullet points..."></textarea>
            </div>
            <button type="submit" class="btn btn-primary" ${loadingMsg ? 'disabled' : ''}>Summarize Notes</button>
          </form>
        </div>

        ${
          summaryResult
            ? `<div class="card">
                <h3 style="margin:0 0 0.4rem;">${escapeHtml(summaryResult.title || 'Notes Summary')}</h3>
                <div class="alert" style="background:var(--primary-soft); border:1px solid #c7d2fe;">
                  <strong>TL;DR:</strong> ${escapeHtml(summaryResult.tldr || '')}
                </div>
                <h4 style="margin:0.75rem 0 0.35rem;">Key Takeaways</h4>
                <ul style="margin:0 0 0.85rem; padding-left:1.2rem;">
                  ${(summaryResult.key_points || []).map((k) => `<li>${escapeHtml(k)}</li>`).join('')}
                </ul>
                ${
                  Array.isArray(summaryResult.definitions) && summaryResult.definitions.length
                    ? `<h4 style="margin:0.75rem 0 0.35rem;">Key Terms & Definitions</h4>
                       <div style="display:flex; flex-direction:column; gap:0.4rem; margin-bottom:0.85rem;">
                         ${summaryResult.definitions
                           .map(
                             (d) => `<div style="padding:0.5rem 0.65rem; background:var(--surface-alt); border-radius:var(--radius-sm);">
                               <strong>${escapeHtml(d.term)}:</strong> ${escapeHtml(d.meaning)}
                             </div>`
                           )
                           .join('')}
                       </div>`
                    : ''
                }
                ${
                  Array.isArray(summaryResult.action_items) && summaryResult.action_items.length
                    ? `<h4 style="margin:0.75rem 0 0.35rem;">Recommended Next Steps</h4>
                       <ul style="margin:0 0 0.85rem; padding-left:1.2rem;">
                         ${summaryResult.action_items.map((a) => `<li>${escapeHtml(a)}</li>`).join('')}
                       </ul>`
                    : ''
                }
                ${
                  Array.isArray(summaryResult.study_questions) && summaryResult.study_questions.length
                    ? `<h4 style="margin:0.75rem 0 0.35rem;">Review Questions</h4>
                       <ul style="margin:0; padding-left:1.2rem;">
                         ${summaryResult.study_questions.map((q) => `<li>${escapeHtml(q)}</li>`).join('')}
                       </ul>`
                    : ''
                }
              </div>`
            : ''
        }
      `;
    }

    // Exam Prep tab
    return `
      <div class="card" style="margin-bottom:1rem;">
        <div class="card-header"><h3 class="card-title">Exam Preparation Coach</h3></div>
        <form id="exam-form">
          <div class="form-row">
            <div class="field">
              <label for="ex-subject">Subject (auto-uses syllabus if topics left blank)</label>
              <select id="ex-subject">${subjectOptionsHtml()}</select>
            </div>
            <div class="field">
              <label for="ex-type">Exam Type</label>
              <select id="ex-type">
                <option value="midterm">Midterm Exam</option>
                <option value="final">Final Exam</option>
                <option value="quiz">Class Quiz</option>
                <option value="practical">Lab / Practical</option>
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="field">
              <label for="ex-days">Days Until Exam</label>
              <input id="ex-days" class="input" type="number" min="1" max="180" value="7" />
            </div>
            <div class="field">
              <label for="ex-count">Mock Test Questions (3–15)</label>
              <input id="ex-count" class="input" type="number" min="3" max="15" value="5" />
            </div>
          </div>
          <div class="field">
            <label for="ex-topics">Exam Topics (or leave blank to use selected subject's syllabus)</label>
            <textarea id="ex-topics" rows="3" placeholder="e.g. Trees, Graphs, Shortest Paths, Dynamic Programming"></textarea>
          </div>
          <button type="submit" class="btn btn-primary" ${loadingMsg ? 'disabled' : ''}>Build Exam Prep Pack</button>
        </form>
      </div>

      ${
        examResult
          ? `<div style="display:flex; flex-direction:column; gap:1rem;">
              <div class="card">
                <h3 style="margin:0 0 0.65rem;">${escapeHtml(examResult.title || 'Exam Revision Pack')}</h3>
                <h4 style="margin:0 0 0.45rem;">Revision Notes</h4>
                <div style="display:flex; flex-direction:column; gap:0.6rem;">
                  ${(examResult.revision_notes || [])
                    .map(
                      (sec) => `
                    <div style="padding:0.75rem; background:var(--surface-alt); border:1px solid var(--border); border-radius:var(--radius-sm);">
                      <strong>${escapeHtml(sec.section)}</strong>
                      <p style="margin:0.25rem 0 0.45rem; font-size:0.89rem;">${escapeHtml(sec.summary)}</p>
                      <ul style="margin:0; padding-left:1.2rem; font-size:0.85rem;">
                        ${(sec.key_points || []).map((kp) => `<li>${escapeHtml(kp)}</li>`).join('')}
                      </ul>
                    </div>
                  `
                    )
                    .join('')}
                </div>
              </div>

              <div class="card">
                <h4 style="margin:0 0 0.6rem;">Conceptual Practice Questions</h4>
                <div style="display:flex; flex-direction:column; gap:0.6rem;">
                  ${(examResult.practice_questions || [])
                    .map(
                      (pq, i) => `
                    <div style="padding:0.75rem; border:1px solid var(--border); border-radius:var(--radius-sm);">
                      <strong>Q${i + 1}. ${escapeHtml(pq.question)}</strong>
                      ${pq.hint ? `<div style="font-size:0.82rem; color:var(--text-muted); margin-top:0.2rem;">Hint: ${escapeHtml(pq.hint)}</div>` : ''}
                      <details style="margin-top:0.45rem;">
                        <summary style="cursor:pointer; font-size:0.85rem; font-weight:600; color:var(--primary);">Reveal Model Answer</summary>
                        <p style="margin:0.4rem 0 0; font-size:0.88rem; white-space:pre-wrap;">${escapeHtml(pq.model_answer)}</p>
                      </details>
                    </div>
                  `
                    )
                    .join('')}
                </div>
              </div>

              ${
                examResult.mock_test
                  ? `<div class="card">
                      <div class="card-header">
                        <h4 class="card-title">Interactive Mock Test</h4>
                        <span class="badge">${examResult.mock_test.duration_minutes || 15} mins recommended</span>
                      </div>
                      ${examResult.mock_test.instructions ? `<p style="margin:0 0 0.75rem; font-size:0.87rem; color:var(--text-muted);">${escapeHtml(examResult.mock_test.instructions)}</p>` : ''}
                      ${renderMcqBlock(examResult.mock_test.questions, mockAnswers, mockSubmitted, 'mock')}
                    </div>`
                  : ''
              }
            </div>`
          : ''
      }
    `;
  }

  function draw() {
    container.innerHTML = `
      <div class="card ai-toolbar" style="margin-bottom:1rem;">
        <div>
          <h2 style="margin:0; font-size:1.25rem;">✦ Gemini AI Study Assistant</h2>
          <div style="font-size:0.84rem; color:var(--text-muted); display:flex; align-items:center; gap:0.5rem; margin-top:0.2rem;">
            <span class="badge ${configured ? 'badge-success' : 'badge-warning'}">
              ${configured ? 'Gemini Key Configured' : 'API Key Needed in .env'}
            </span>
            <span>Powered securely by server-side Google GenAI SDK</span>
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
          <select id="ai-model-select" style="width:auto; min-width:220px;" aria-label="Select Gemini model">
            ${models
              .map(
                (m) =>
                  `<option value="${escapeHtml(m.id)}" ${m.id === selectedModel ? 'selected' : ''}>${escapeHtml(m.label)}</option>`
              )
              .join('')}
          </select>
          <button id="ai-test-conn-btn" class="btn btn-sm" ${loadingMsg ? 'disabled' : ''}>Test API Connection</button>
        </div>
      </div>

      ${
        !configured
          ? `<div class="alert alert-warning">
               <strong>Setup required:</strong> Add your key to <code>GEMINI_API_KEY</code> in the server <code>.env</code> file and restart StudyFlow to enable live Gemini responses.
             </div>`
          : ''
      }

      ${
        loadingMsg
          ? `<div class="ai-loading" role="status">
               <span class="spinner"></span>
               <span>${escapeHtml(loadingMsg)}</span>
             </div>`
          : ''
      }

      ${errorMsg ? `<div class="alert alert-danger">${escapeHtml(errorMsg)}</div>` : ''}

      <div class="ai-tabs" role="tablist">
        ${AI_TABS.map(
          (t) =>
            `<button type="button" class="ai-tab-btn ${activeTab === t.id ? 'active' : ''}" data-ai-tab="${t.id}">${t.label}</button>`
        ).join('')}
      </div>

      <div class="ai-layout">
        <div>${renderMainPanel()}</div>

        <aside class="card">
          <div class="card-header">
            <h3 class="card-title">Recent AI Generations</h3>
          </div>
          ${
            historyList.length === 0
              ? `<div class="empty-state" style="padding:1.25rem 0.75rem;">Your generated explanations, quizzes, summaries, study plans, and exam packs will appear here.</div>`
              : `<div style="display:flex; flex-direction:column; gap:0.5rem;">
                  ${historyList
                    .map(
                      (h) => `
                    <div style="padding:0.6rem 0.7rem; border:1px solid var(--border); border-radius:var(--radius-sm);">
                      <div style="display:flex; justify-content:space-between; gap:0.4rem; align-items:flex-start;">
                        <strong style="font-size:0.86rem;">${escapeHtml(h.title)}</strong>
                        <button class="btn btn-sm delete-ai-hist" data-id="${h.id}" style="padding:0.1rem 0.4rem;">×</button>
                      </div>
                      <div style="font-size:0.75rem; color:var(--text-muted); margin:0.2rem 0 0.4rem;">
                        <span class="badge">${escapeHtml(h.feature_type.replace('_', ' '))}</span>
                        <span>${escapeHtml(h.model)} · ${formatDate(h.created_at)}</span>
                      </div>
                      <button class="btn btn-sm open-ai-hist" data-id="${h.id}">Open</button>
                    </div>
                  `
                    )
                    .join('')}
                </div>`
          }
        </aside>
      </div>
    `;

    // Model selector & connection test
    container.querySelector('#ai-model-select').addEventListener('change', (e) => {
      selectedModel = e.target.value;
    });

    container.querySelector('#ai-test-conn-btn').addEventListener('click', async () => {
      await runWithLoading(`Testing connection to ${selectedModel}...`, async () => {
        const res = await api.aiTest(selectedModel);
        configured = true;
        showToast(`Connected (${res.model}): ${res.reply}`, 'success');
      });
    });

    // Tab switching
    container.querySelectorAll('.ai-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeTab = btn.dataset.aiTab;
        errorMsg = '';
        draw();
      });
    });

    // History open / delete
    container.querySelectorAll('.open-ai-hist').forEach((btn) => {
      btn.addEventListener('click', () => {
        const item = historyList.find((h) => h.id === Number(btn.dataset.id));
        if (!item) return;
        activeTab = item.feature_type;
        if (item.feature_type === 'explainer') explainerResult = item.output;
        if (item.feature_type === 'quiz') {
          quizResult = item.output;
          quizAnswers = {};
          quizSubmitted = false;
        }
        if (item.feature_type === 'planner') planResult = item.output;
        if (item.feature_type === 'summary') summaryResult = item.output;
        if (item.feature_type === 'exam_prep') {
          examResult = item.output;
          mockAnswers = {};
          mockSubmitted = false;
        }
        draw();
      });
    });

    container.querySelectorAll('.delete-ai-hist').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await api.aiDeleteHistory(Number(btn.dataset.id));
          historyList = historyList.filter((h) => h.id !== Number(btn.dataset.id));
          draw();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    // 1. Chat handlers
    const chatBox = container.querySelector('#ai-chat-box');
    if (chatBox) chatBox.scrollTop = chatBox.scrollHeight;

    container.querySelector('#ai-chat-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = container.querySelector('#chat-input');
      const message = input.value.trim();
      if (!message) return;
      const subjectId = container.querySelector('#chat-subject').value || null;
      await runWithLoading(`Thinking with ${selectedModel}...`, async () => {
        const res = await api.aiChat({ message, subject_id: subjectId, model: selectedModel });
        chatMessages = [
          ...chatMessages,
          { role: 'user', content: message, model: res.model },
          { role: 'model', content: res.reply, model: res.model },
        ];
      });
    });

    container.querySelector('#clear-chat-btn')?.addEventListener('click', async () => {
      try {
        await api.aiClearChat();
        chatMessages = [];
        draw();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    // 2. Topic Explainer handler
    container.querySelector('#explainer-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const topic = container.querySelector('#exp-topic').value.trim();
      const subjectId = container.querySelector('#exp-subject').value || null;
      const level = container.querySelector('#exp-level').value;
      const focus = container.querySelector('#exp-focus').value.trim();
      await runWithLoading(`Explaining "${topic}"...`, async () => {
        const res = await api.aiExplain({ topic, subject_id: subjectId, level, focus, model: selectedModel });
        explainerResult = res.explanation;
        await refreshHistory();
      });
    });

    // 3. Quiz Generator & MCQ interactive handlers
    container.querySelector('#quiz-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const topic = container.querySelector('#qz-topic').value.trim();
      const subjectId = container.querySelector('#qz-subject').value || null;
      const difficulty = container.querySelector('#qz-difficulty').value;
      const count = Number(container.querySelector('#qz-count').value);
      const contextText = container.querySelector('#qz-context').value.trim();
      await runWithLoading(`Generating ${count}-question quiz on "${topic}"...`, async () => {
        const res = await api.aiQuiz({
          topic,
          subject_id: subjectId,
          difficulty,
          count,
          context_text: contextText,
          model: selectedModel,
        });
        quizResult = res.quiz;
        quizAnswers = {};
        quizSubmitted = false;
        await refreshHistory();
      });
    });

    bindMcqEvents('quiz', quizAnswers, (next) => {
      quizSubmitted = next;
      if (!next) quizAnswers = {};
      draw();
    });

    // 4. Planner handler
    container.querySelector('#planner-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const dailyHours = Number(container.querySelector('#pl-hours').value);
      const focusMode = container.querySelector('#pl-mode').value;
      const goal = container.querySelector('#pl-goal').value.trim();
      await runWithLoading('Building your personalised daily & weekly plan...', async () => {
        const res = await api.aiPlan({
          daily_hours: dailyHours,
          focus_mode: focusMode,
          goal,
          model: selectedModel,
        });
        planResult = res.plan;
        await refreshHistory();
      });
    });

    // 5. Notes Summariser handler
    container.querySelector('#summary-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const savedNoteId = container.querySelector('#sum-saved-note').value;
      const subjectId = container.querySelector('#sum-subject').value;
      const title = container.querySelector('#sum-title').value.trim();
      const text = container.querySelector('#sum-text').value.trim();
      const file = container.querySelector('#sum-file').files[0];

      if (!savedNoteId && !text && !file) {
        errorMsg = 'Please select an existing note, upload a document, or paste study text.';
        draw();
        return;
      }

      const formData = new FormData();
      if (savedNoteId) formData.append('note_id', savedNoteId);
      if (subjectId) formData.append('subject_id', subjectId);
      if (title) formData.append('title', title);
      if (text) formData.append('text', text);
      if (file) formData.append('file', file);
      formData.append('model', selectedModel);

      await runWithLoading('Summarizing study notes with Gemini...', async () => {
        const res = await api.aiSummarize(formData);
        summaryResult = res.summary;
        await refreshHistory();
      });
    });

    // 6. Exam Prep & Mock Test handlers
    container.querySelector('#exam-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const subjectId = container.querySelector('#ex-subject').value || null;
      const examType = container.querySelector('#ex-type').value;
      const daysUntilExam = Number(container.querySelector('#ex-days').value);
      const mockQuestionCount = Number(container.querySelector('#ex-count').value);
      const topics = container.querySelector('#ex-topics').value.trim();
      await runWithLoading('Creating revision notes, practice questions & mock test...', async () => {
        const res = await api.aiExamPrep({
          subject_id: subjectId,
          exam_type: examType,
          days_until_exam: daysUntilExam,
          mock_question_count: mockQuestionCount,
          topics,
          model: selectedModel,
        });
        examResult = res.exam_prep;
        mockAnswers = {};
        mockSubmitted = false;
        await refreshHistory();
      });
    });

    bindMcqEvents('mock', mockAnswers, (next) => {
      mockSubmitted = next;
      if (!next) mockAnswers = {};
      draw();
    });
  }

  function bindMcqEvents(prefix, answersMap, onToggleSubmit) {
    container.querySelectorAll(`.${prefix}-radio`).forEach((radio) => {
      radio.addEventListener('change', () => {
        answersMap[Number(radio.dataset.q)] = Number(radio.value);
      });
    });
    container.querySelector(`#${prefix}-submit-btn`)?.addEventListener('click', () => onToggleSubmit(true));
    container.querySelector(`#${prefix}-retry-btn`)?.addEventListener('click', () => onToggleSubmit(false));
  }

  async function refreshHistory() {
    const latest = await api.aiStatus();
    historyList = latest.history || [];
  }

  async function runWithLoading(msg, fn) {
    loadingMsg = msg;
    errorMsg = '';
    draw();
    try {
      await fn();
    } catch (err) {
      errorMsg = err.message;
      showToast(err.message, 'error');
    } finally {
      loadingMsg = '';
      draw();
    }
  }

  draw();
}
