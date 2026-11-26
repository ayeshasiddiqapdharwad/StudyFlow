import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { createStudyFlowApp } from '../server.js';
import { toLocalDateString } from '../src/utils/dates.js';

function createTestApp(extraConfig = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studyflow-test-'));
  const dbPath = path.join(tmpDir, 'studyflow.db');
  const uploadsDir = path.join(tmpDir, 'uploads');

  const { requestHandler, db, config } = createStudyFlowApp({
    dbPath,
    uploadsDir,
    ...extraConfig,
  });

  return {
    requestHandler,
    db,
    config,
    close() {
      db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

/**
 * Dispatch an HTTP request directly through StudyFlow's requestHandler using Node streams.
 */
function dispatch(app, pathName, { method = 'GET', body, token, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = new PassThrough();
    req.url = pathName;
    req.method = method;
    req.headers = { host: 'localhost', ...headers };

    if (token) req.headers.authorization = `Bearer ${token}`;

    let rawBody = null;
    if (body instanceof Buffer) {
      rawBody = body;
    } else if (body && typeof body === 'object') {
      req.headers['content-type'] = 'application/json';
      rawBody = Buffer.from(JSON.stringify(body), 'utf8');
    }

    const res = new PassThrough();
    const chunks = [];
    let statusCode = 200;
    let resHeaders = {};

    res.writeHead = (status, hdrs = {}) => {
      statusCode = status;
      for (const [k, v] of Object.entries(hdrs)) {
        resHeaders[k.toLowerCase()] = v;
      }
      return res;
    };
    res.setHeader = (k, v) => {
      resHeaders[k.toLowerCase()] = v;
    };
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      let data = text;
      try {
        data = JSON.parse(text);
      } catch {
        // non-JSON response (e.g. HTML or file download)
      }
      resolve({ status: statusCode, data, headers: resHeaders });
    });
    res.on('error', reject);

    app.requestHandler(req, res).catch(reject);

    if (rawBody) req.write(rawBody);
    req.end();
  });
}

test('StudyFlow end-to-end FR1-FR10, static UI serving, and NFR3 security', async () => {
  const app = createTestApp();
  try {
    // Health & Static HTML check
    const health = await dispatch(app, '/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.data.app, 'StudyFlow');

    const indexHtml = await dispatch(app, '/');
    assert.equal(indexHtml.status, 200);
    assert.match(indexHtml.data, /StudyFlow/);

    // FR1: Register with college email & password
    const reg = await dispatch(app, '/api/auth/register', {
      method: 'POST',
      body: {
        full_name: 'Riya Sharma',
        email: 'riya@engineering.edu',
        password: 'StrongPassword99',
        institution: 'National Tech',
        semester: 'Sem 4',
      },
    });
    assert.equal(reg.status, 201);
    assert.equal(reg.data.user.email, 'riya@engineering.edu');
    assert.ok(reg.data.token);

    // NFR3: Password must be stored hashed, never plaintext
    const storedUser = app.db.prepare('SELECT password_hash, password_salt FROM users WHERE email = ?').get('riya@engineering.edu');
    assert.ok(storedUser.password_hash);
    assert.ok(storedUser.password_salt);
    assert.notEqual(storedUser.password_hash, 'StrongPassword99');

    // FR1: Invalid password fails, valid login succeeds
    const badLogin = await dispatch(app, '/api/auth/login', {
      method: 'POST',
      body: { email: 'riya@engineering.edu', password: 'WrongPassword' },
    });
    assert.equal(badLogin.status, 401);

    const login = await dispatch(app, '/api/auth/login', {
      method: 'POST',
      body: { email: 'riya@engineering.edu', password: 'StrongPassword99' },
    });
    assert.equal(login.status, 200);
    const token = login.data.token;

    // FR5: Create subject & syllabus topics, verify completion % updates
    const subjRes = await dispatch(app, '/api/subjects', {
      method: 'POST',
      token,
      body: {
        name: 'Computer Networks',
        code: 'CS310',
        color: '#4f46e5',
        target_hours_weekly: 6,
        topics: ['OSI Model', 'TCP/IP', 'Routing Algorithms', 'DNS & HTTP'],
      },
    });
    assert.equal(subjRes.status, 201);
    const subject = subjRes.data.subject;
    assert.equal(subject.syllabus_total, 4);
    assert.equal(subject.syllabus_percent, 0);

    const t1 = await dispatch(app, `/api/syllabus-topics/${subject.topics[0].id}`, {
      method: 'PATCH',
      token,
      body: { is_completed: true },
    });
    assert.equal(t1.data.subject.syllabus_percent, 25);

    const t2 = await dispatch(app, `/api/syllabus-topics/${subject.topics[1].id}`, {
      method: 'PATCH',
      token,
      body: { is_completed: true },
    });
    assert.equal(t2.data.subject.syllabus_percent, 50);

    // FR2 & FR7: Create task due today, edit, add subtasks, toggle subtasks to complete parent task
    const todayStr = toLocalDateString();
    const taskRes = await dispatch(app, '/api/tasks', {
      method: 'POST',
      token,
      body: {
        subject_id: subject.id,
        title: 'Socket Programming Lab',
        due_date: todayStr,
        priority: 'high',
        reminder_minutes_before: 1440,
        subtasks: ['Create TCP server', 'Create TCP client'],
      },
    });
    assert.equal(taskRes.status, 201);
    const task = taskRes.data.task;
    assert.equal(task.subtasks.length, 2);
    assert.equal(task.status, 'pending');

    // Toggle first subtask -> in_progress (50%)
    const sub1Res = await dispatch(app, `/api/subtasks/${task.subtasks[0].id}`, {
      method: 'PATCH',
      token,
      body: { is_completed: true },
    });
    assert.equal(sub1Res.data.task.status, 'in_progress');
    assert.equal(sub1Res.data.task.subtask_percent, 50);

    // Edit task title
    const editRes = await dispatch(app, `/api/tasks/${task.id}`, {
      method: 'PUT',
      token,
      body: { title: 'TCP Socket Programming Lab' },
    });
    assert.equal(editRes.status, 200);
    assert.equal(editRes.data.task.title, 'TCP Socket Programming Lab');

    // Toggle second subtask -> completed (100%)
    const sub2Res = await dispatch(app, `/api/subtasks/${task.subtasks[1].id}`, {
      method: 'PATCH',
      token,
      body: { is_completed: true },
    });
    assert.equal(sub2Res.data.task.status, 'completed');
    assert.equal(sub2Res.data.task.subtask_percent, 100);

    // Create another pending task due today for FR4 reminder & FR8 dashboard checks
    const dueTask = await dispatch(app, '/api/tasks', {
      method: 'POST',
      token,
      body: {
        subject_id: subject.id,
        title: 'Packet Analysis Report',
        due_date: todayStr,
        priority: 'medium',
        reminder_minutes_before: 1440,
      },
    });
    assert.equal(dueTask.status, 201);

    // FR3: Add weekly timetable slot
    const todayDow = (new Date().getDay() + 6) % 7;
    const slotRes = await dispatch(app, '/api/timetable', {
      method: 'POST',
      token,
      body: {
        subject_id: subject.id,
        title: 'Networks Study Block',
        slot_type: 'study',
        day_of_week: todayDow,
        start_time: '00:00',
        end_time: '23:59',
        location: 'Library',
        reminder_minutes_before: 60,
      },
    });
    assert.equal(slotRes.status, 201);
    const listSlots = await dispatch(app, '/api/timetable', { token });
    assert.equal(listSlots.data.slots.length, 1);

    // FR4: Notifications triggered for upcoming task & active timetable slot
    const notifRes = await dispatch(app, '/api/notifications', { token });
    assert.equal(notifRes.status, 200);
    assert.ok(notifRes.data.notifications.some((n) => n.source_type === 'task'));
    assert.ok(notifRes.data.notifications.some((n) => n.source_type === 'timetable'));

    // FR6: Upload study note file via multipart/form-data and download it
    const boundary = '----StudyFlowTestBoundary77';
    const multipartPayload = Buffer.from(
      [
        `--${boundary}`,
        'Content-Disposition: form-data; name="title"',
        '',
        'TCP Handshake Notes',
        `--${boundary}`,
        'Content-Disposition: form-data; name="subject_id"',
        '',
        String(subject.id),
        `--${boundary}`,
        'Content-Disposition: form-data; name="tags"',
        '',
        'tcp,notes',
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="tcp-notes.txt"',
        'Content-Type: text/plain',
        '',
        'SYN -> SYN-ACK -> ACK',
        `--${boundary}--`,
        '',
      ].join('\r\n'),
      'utf8'
    );

    const uploadRes = await dispatch(app, '/api/notes', {
      method: 'POST',
      token,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      body: multipartPayload,
    });
    assert.equal(uploadRes.status, 201);
    assert.equal(uploadRes.data.note.file_name, 'tcp-notes.txt');

    const dlRes = await dispatch(app, `/api/notes/${uploadRes.data.note.id}/download`, { token });
    assert.equal(dlRes.status, 200);
    assert.equal(dlRes.data, 'SYN -> SYN-ACK -> ACK');

    // FR9: Log study time (timer & manual)
    const s1 = await dispatch(app, '/api/sessions', {
      method: 'POST',
      token,
      body: {
        subject_id: subject.id,
        mode: 'timer',
        duration_minutes: 45,
        session_date: todayStr,
        notes: 'Reviewed TCP congestion control',
      },
    });
    assert.equal(s1.status, 201);

    const s2 = await dispatch(app, '/api/sessions', {
      method: 'POST',
      token,
      body: {
        subject_id: subject.id,
        mode: 'manual',
        duration_minutes: 30,
        session_date: todayStr,
      },
    });
    assert.equal(s2.status, 201);

    // FR8: Dashboard summary
    const dash = await dispatch(app, '/api/dashboard', { token });
    assert.equal(dash.status, 200);
    assert.equal(dash.data.summary.pending_tasks, 1);
    assert.equal(dash.data.summary.completed_tasks, 1);
    assert.equal(dash.data.summary.weekly_study_minutes, 75);
    assert.equal(dash.data.today_schedule.length, 1);

    // FR10: Report generation
    const rep = await dispatch(app, `/api/reports?from=${todayStr}&to=${todayStr}`, { token });
    assert.equal(rep.status, 200);
    assert.equal(rep.data.totals.study_minutes, 75);
    assert.equal(rep.data.totals.completed_tasks, 1);
    assert.equal(rep.data.by_subject[0].subject_name, 'Computer Networks');
  } finally {
    app.close();
  }
});

test('NFR3: Session expires automatically after inactivity period', async () => {
  const app = createTestApp({ sessionIdleMs: 50 });
  try {
    const reg = await dispatch(app, '/api/auth/register', {
      method: 'POST',
      body: {
        full_name: 'Timeout Tester',
        email: 'timeout@college.edu',
        password: 'Password123',
      },
    });
    assert.equal(reg.status, 201);
    const token = reg.data.token;

    await new Promise((r) => setTimeout(r, 90));

    const res = await dispatch(app, '/api/auth/me', { token });
    assert.equal(res.status, 401);
    assert.match(res.data.error, /inactivity/i);
  } finally {
    app.close();
  }
});

test('NFR5: Demo account works and data persists across app/database restarts', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studyflow-persist-'));
  const dbPath = path.join(tmpDir, 'studyflow.db');
  const uploadsDir = path.join(tmpDir, 'uploads');

  try {
    const app1 = createStudyFlowApp({ dbPath, uploadsDir });
    const login = await dispatch(app1, '/api/auth/login', {
      method: 'POST',
      body: { email: 'demo@studyflow.edu', password: 'StudyFlow123!' },
    });
    assert.equal(login.status, 200);
    const token = login.data.token;

    const taskCreate = await dispatch(app1, '/api/tasks', {
      method: 'POST',
      token,
      body: { title: 'Survive Restart Task', due_date: '2026-12-01', priority: 'high' },
    });
    assert.equal(taskCreate.status, 201);
    app1.db.close();

    // Reopen fresh app instance on the same database file
    const app2 = createStudyFlowApp({ dbPath, uploadsDir });
    const tasksRes = await dispatch(app2, '/api/tasks', { token });
    assert.equal(tasksRes.status, 200);
    assert.ok(tasksRes.data.tasks.some((t) => t.title === 'Survive Restart Task'));
    app2.db.close();
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Security & validation: XSS upload download, malformed cookies, traversal, and subject ownership', async () => {
  const app = createTestApp();
  try {
    const u1 = await dispatch(app, '/api/auth/register', {
      method: 'POST',
      body: { full_name: 'User One', email: 'u1@college.edu', password: 'Password123' },
    });
    const u2 = await dispatch(app, '/api/auth/register', {
      method: 'POST',
      body: { full_name: 'User Two', email: 'u2@college.edu', password: 'Password123' },
    });

    // Malformed percent-encoded cookie should not throw 500
    const badCookieRes = await dispatch(app, '/api/auth/me', {
      token: u1.data.token,
      headers: { cookie: 'bad=%E0%A4%A' },
    });
    assert.equal(badCookieRes.status, 200);

    // Static traversal blocked
    const travRes = await dispatch(app, '/..%2Fpackage.json');
    assert.equal(travRes.status, 403);

    // HTML file upload with ?inline=1 must force attachment + CSP sandbox (no Stored XSS)
    const boundary = '----SecurityBoundary99';
    const htmlUpload = Buffer.from(
      [
        `--${boundary}`,
        'Content-Disposition: form-data; name="title"',
        '',
        'XSS Test',
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="evil.html"',
        'Content-Type: text/html',
        '',
        '<script>alert(1)</script>',
        `--${boundary}--`,
        '',
      ].join('\r\n'),
      'utf8'
    );
    const noteRes = await dispatch(app, '/api/notes', {
      method: 'POST',
      token: u1.data.token,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      body: htmlUpload,
    });
    assert.equal(noteRes.status, 201);

    const dlHtml = await dispatch(app, `/api/notes/${noteRes.data.note.id}/download?inline=1`, {
      token: u1.data.token,
    });
    assert.equal(dlHtml.status, 200);
    assert.match(dlHtml.headers['content-disposition'], /^attachment;/);
    assert.equal(dlHtml.headers['content-security-policy'], 'sandbox');

    // User 1 cannot assign User 2's subject on timetable PUT, nor invalid subject color/hours
    const s2 = await dispatch(app, '/api/subjects', {
      method: 'POST',
      token: u2.data.token,
      body: { name: 'Private Subject' },
    });
    const slot1 = await dispatch(app, '/api/timetable', {
      method: 'POST',
      token: u1.data.token,
      body: { title: 'My Study', day_of_week: 0, start_time: '09:00', end_time: '10:00' },
    });
    const crossPut = await dispatch(app, `/api/timetable/${slot1.data.slot.id}`, {
      method: 'PUT',
      token: u1.data.token,
      body: { subject_id: s2.data.subject.id },
    });
    assert.equal(crossPut.status, 400);

    const s1 = await dispatch(app, '/api/subjects', {
      method: 'POST',
      token: u1.data.token,
      body: { name: 'Math' },
    });
    const badColorPut = await dispatch(app, `/api/subjects/${s1.data.subject.id}`, {
      method: 'PUT',
      token: u1.data.token,
      body: { name: 'Math', color: 'red;background:url(evil)' },
    });
    assert.equal(badColorPut.status, 400);
  } finally {
    app.close();
  }
});

test('Gemini AI Study Assistant: SDK load, status, error handling, model config, and all 6 AI features', async () => {
  const { GoogleGenAI } = await import('@google/genai');
  assert.equal(typeof GoogleGenAI, 'function');

  // 1. Verify missing API key returns safe 503 without exposing secrets
  const noKeyApp = createTestApp({ geminiApiKey: '' });
  try {
    const reg = await dispatch(noKeyApp, '/api/auth/register', {
      method: 'POST',
      body: { full_name: 'AI Student', email: 'ai@college.edu', password: 'Password123' },
    });
    const token = reg.data.token;

    const statusRes = await dispatch(noKeyApp, '/api/ai/status', { token });
    assert.equal(statusRes.status, 200);
    assert.equal(statusRes.data.configured, false);
    assert.ok(Array.isArray(statusRes.data.models) && statusRes.data.models.length >= 3);
    assert.equal('geminiApiKey' in statusRes.data, false);

    const failTest = await dispatch(noKeyApp, '/api/ai/test', {
      method: 'POST',
      token,
      body: { model: 'gemini-2.5-flash' },
    });
    assert.equal(failTest.status, 503);
    assert.match(failTest.data.error, /GEMINI_API_KEY/);
  } finally {
    noKeyApp.close();
  }

  // 2. Verify all 6 AI endpoints + configurable model selection using mock Gemini client
  const recordedCalls = [];
  const mockGeminiClient = {
    models: {
      async generateContent({ model, contents, config }) {
        recordedCalls.push({ model, contents, config });
        const promptText = typeof contents === 'string'
          ? contents
          : JSON.stringify(contents);

        if (promptText.includes('StudyFlow Gemini connection verified')) {
          return { text: 'StudyFlow Gemini connection verified.' };
        }
        if (config?.responseMimeType !== 'application/json') {
          return { text: 'BFS uses a queue and explores level by level in O(V+E) time.' };
        }
        if (promptText.includes('intuitive_analogy')) {
          return {
            text: JSON.stringify({
              title: 'Recursion Explained',
              summary: 'A function solving a problem by calling itself on smaller inputs.',
              intuitive_analogy: 'Russian nesting dolls opening one smaller doll at a time.',
              core_concepts: [{ name: 'Base Case', explanation: 'Stopping condition.' }],
              beginner_examples: [{ title: 'Countdown', walkthrough: '3 -> 2 -> 1 -> Done' }],
              common_mistakes: ['Forgetting the base case'],
              quick_check: { question: 'Why is a base case needed?', answer: 'To stop infinite calls.' },
            }),
          };
        }
        if (promptText.includes('multiple-choice quiz')) {
          return {
            text: JSON.stringify({
              title: 'Trees Quiz',
              difficulty: 'medium',
              questions: [
                {
                  id: 1,
                  question: 'What is the time complexity of BST search on a balanced tree?',
                  options: ['O(1)', 'O(log n)', 'O(n)', 'O(n^2)'],
                  correct_index: 1,
                  explanation: 'Each comparison halves the search space.',
                },
              ],
            }),
          };
        }
        if (promptText.includes('weekly_plan')) {
          return {
            text: JSON.stringify({
              overview: 'Prioritize Algorithms lab and syllabus catch-up.',
              priority_focus: ['Algorithms Lab'],
              today_plan: [
                {
                  time_block: '16:00 - 17:00',
                  subject: 'Algorithms',
                  activity: 'Finish graph lab',
                  duration_minutes: 60,
                  reason: 'Due tomorrow',
                },
              ],
              weekly_plan: [
                {
                  day: 'Monday',
                  focus_subject: 'Algorithms',
                  sessions: [{ activity: 'Graph traversal practice', duration_minutes: 60 }],
                  goal: 'Complete lab',
                },
              ],
              productivity_tips: ['Use 25-minute focus blocks'],
            }),
          };
        }
        if (promptText.includes('tldr')) {
          return {
            text: JSON.stringify({
              title: 'Lecture Summary',
              tldr: 'Covers key graph algorithms and complexity.',
              key_points: ['BFS finds shortest unweighted paths'],
              definitions: [{ term: 'DAG', meaning: 'Directed Acyclic Graph' }],
              action_items: ['Implement BFS'],
              study_questions: ['When does Dijkstra fail?'],
            }),
          };
        }
        return {
          text: JSON.stringify({
            title: 'Midterm Exam Prep',
            revision_notes: [{ section: 'Graphs', summary: 'BFS/DFS basics', key_points: ['O(V+E)'] }],
            practice_questions: [{ question: 'Compare BFS and DFS', hint: 'Queue vs Stack', model_answer: 'BFS uses queue.' }],
            mock_test: {
              duration_minutes: 15,
              instructions: 'Choose the best option.',
              questions: [
                {
                  id: 1,
                  question: 'Which structure does BFS use?',
                  options: ['Stack', 'Queue', 'Heap', 'Tree'],
                  correct_index: 1,
                  explanation: 'FIFO order explores level by level.',
                },
              ],
            },
          }),
        };
      },
    },
  };

  const app = createTestApp({ geminiApiKey: 'test-key-secret', geminiClient: mockGeminiClient });
  try {
    const login = await dispatch(app, '/api/auth/login', {
      method: 'POST',
      body: { email: 'demo@studyflow.edu', password: 'StudyFlow123!' },
    });
    const token = login.data.token;

    // Ensure secret key is never exposed in status or HTML
    const status = await dispatch(app, '/api/ai/status', { token });
    assert.equal(status.status, 200);
    assert.equal(status.data.configured, true);
    assert.equal(JSON.stringify(status.data).includes('test-key-secret'), false);

    // Unsupported model rejected
    const badModel = await dispatch(app, '/api/ai/test', {
      method: 'POST',
      token,
      body: { model: 'unsupported-model' },
    });
    assert.equal(badModel.status, 400);

    // Connection test with configurable model
    const testConn = await dispatch(app, '/api/ai/test', {
      method: 'POST',
      token,
      body: { model: 'gemini-2.5-pro' },
    });
    assert.equal(testConn.status, 200);
    assert.equal(testConn.data.model, 'gemini-2.5-pro');

    const subjectsRes = await dispatch(app, '/api/subjects', { token });
    const subjectId = subjectsRes.data.subjects[0].id;

    // 1. AI Chat
    const chatRes = await dispatch(app, '/api/ai/chat', {
      method: 'POST',
      token,
      body: { message: 'Explain BFS briefly', subject_id: subjectId, model: 'gemini-2.5-flash' },
    });
    assert.equal(chatRes.status, 200);
    assert.match(chatRes.data.reply, /BFS/);

    // 2. Topic Explainer
    const expRes = await dispatch(app, '/api/ai/explain', {
      method: 'POST',
      token,
      body: { topic: 'Recursion', subject_id: subjectId, level: 'beginner' },
    });
    assert.equal(expRes.status, 200);
    assert.equal(expRes.data.explanation.title, 'Recursion Explained');

    // 3. Quiz Generator
    const quizRes = await dispatch(app, '/api/ai/quiz', {
      method: 'POST',
      token,
      body: { topic: 'Binary Search Trees', difficulty: 'medium', count: 5 },
    });
    assert.equal(quizRes.status, 200);
    assert.equal(quizRes.data.quiz.questions.length, 1);

    // 4. Personalised Study Planner (grounded in live SQLite data)
    const planRes = await dispatch(app, '/api/ai/planner', {
      method: 'POST',
      token,
      body: { daily_hours: 4, focus_mode: 'deadline_first', goal: 'Ace midterms' },
    });
    assert.equal(planRes.status, 200);
    assert.ok(planRes.data.plan.today_plan.length > 0);
    const plannerPrompt = recordedCalls.at(-1).contents;
    assert.match(plannerPrompt, /Data Structures & Algorithms/);

    // 5. Notes Summariser with multipart document upload
    const boundary = '----AiSummaryBoundary';
    const docUpload = Buffer.from(
      [
        `--${boundary}`,
        'Content-Disposition: form-data; name="title"',
        '',
        'Graph Lecture Notes',
        `--${boundary}`,
        'Content-Disposition: form-data; name="model"',
        '',
        'gemini-2.5-flash-lite',
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="lecture.txt"',
        'Content-Type: text/plain',
        '',
        'BFS uses a queue to find shortest paths in unweighted graphs.',
        `--${boundary}--`,
        '',
      ].join('\r\n'),
      'utf8'
    );
    const sumRes = await dispatch(app, '/api/ai/summarize', {
      method: 'POST',
      token,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      body: docUpload,
    });
    assert.equal(sumRes.status, 200);
    assert.equal(sumRes.data.model, 'gemini-2.5-flash-lite');
    assert.equal(sumRes.data.summary.title, 'Lecture Summary');

    // 6. Exam Preparation (auto-loads syllabus topics from subject_id)
    const examRes = await dispatch(app, '/api/ai/exam-prep', {
      method: 'POST',
      token,
      body: { subject_id: subjectId, exam_type: 'midterm', days_until_exam: 5, mock_question_count: 5 },
    });
    assert.equal(examRes.status, 200);
    assert.equal(examRes.data.exam_prep.mock_test.questions.length, 1);

    // History persisted & deletable
    const afterStatus = await dispatch(app, '/api/ai/status', { token });
    assert.equal(afterStatus.data.chat_messages.length, 2);
    assert.equal(afterStatus.data.history.length, 5);

    const delHist = await dispatch(app, `/api/ai/history/${expRes.data.id}`, {
      method: 'DELETE',
      token,
    });
    assert.equal(delHist.status, 200);

    const clearChat = await dispatch(app, '/api/ai/chat', { method: 'DELETE', token });
    assert.equal(clearChat.status, 200);
  } finally {
    app.close();
  }
});
