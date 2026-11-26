import fs from 'node:fs';
import path from 'node:path';
import { readJsonBody, sendJson, HttpError } from '../utils/http.js';
import { parseMultipartForm } from '../utils/multipart.js';
import { listSubjectsWithProgress } from './subjects.js';
import {
  chatWithTutor,
  explainTopic,
  generateExamPrep,
  generateQuiz,
  generateStudyPlan,
  summarizeNotes,
  testGeminiConnection,
} from '../services/gemini.js';

function resolveSubjectContext(db, userId, subjectIdRaw) {
  if (!subjectIdRaw) return { subjectId: null, subjectLabel: '' };
  const subjectId = Number(subjectIdRaw);
  const subject = db.prepare('SELECT id, name, code FROM subjects WHERE id = ? AND user_id = ?').get(subjectId, userId);
  if (!subject) throw new HttpError(400, 'Selected subject does not exist.');
  const label = subject.code ? `${subject.name} (${subject.code})` : subject.name;
  return { subjectId: subject.id, subjectLabel: label };
}

function saveHistory(db, userId, featureType, subjectId, title, output, model) {
  const result = db.prepare(`
    INSERT INTO ai_history (user_id, feature_type, subject_id, title, output_json, model)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(userId, featureType, subjectId, title, JSON.stringify(output), model);

  return Number(result.lastInsertRowid);
}

export async function handleAiRoutes(req, res, ctx) {
  const { db, pathname, query, user, config } = ctx;

  // Configuration status (never exposes GEMINI_API_KEY!)
  if (pathname === '/api/ai/status' && req.method === 'GET') {
    const history = db.prepare(`
      SELECT id, feature_type, subject_id, title, output_json, model, created_at
      FROM ai_history
      WHERE user_id = ?
      ORDER BY id DESC
      LIMIT 20
    `).all(user.id).map((h) => ({
      ...h,
      output: JSON.parse(h.output_json),
    }));

    const chatMessages = db.prepare(`
      SELECT m.id, m.subject_id, m.role, m.content, m.model, m.created_at, s.name AS subject_name
      FROM ai_chat_messages m
      LEFT JOIN subjects s ON s.id = m.subject_id
      WHERE m.user_id = ?
      ORDER BY m.id ASC
      LIMIT 60
    `).all(user.id);

    sendJson(res, 200, {
      configured: Boolean(String(config.geminiApiKey || '').trim()) || Boolean(config.geminiClient),
      default_model: config.geminiModel,
      models: config.availableGeminiModels,
      chat_messages: chatMessages,
      history,
    });
    return true;
  }

  // Test Gemini API connection
  if (pathname === '/api/ai/test' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const result = await testGeminiConnection(config, body.model);
    sendJson(res, 200, result);
    return true;
  }

  // 1. AI Chat Assistant
  if (pathname === '/api/ai/chat' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const message = String(body.message || '').trim();
    if (!message) throw new HttpError(400, 'Please enter an academic question or message.');

    const { subjectId, subjectLabel } = resolveSubjectContext(db, user.id, body.subject_id);
    const history = db.prepare(`
      SELECT role, content
      FROM ai_chat_messages
      WHERE user_id = ?
      ORDER BY id DESC
      LIMIT 10
    `).all(user.id).reverse();

    const result = await chatWithTutor({
      config,
      model: body.model,
      message,
      history,
      subjectLabel,
    });

    const insertMsg = db.prepare(`
      INSERT INTO ai_chat_messages (user_id, subject_id, role, content, model)
      VALUES (?, ?, ?, ?, ?)
    `);
    insertMsg.run(user.id, subjectId, 'user', message, result.model);
    const modelRow = insertMsg.run(user.id, subjectId, 'model', result.reply, result.model);

    sendJson(res, 200, {
      id: Number(modelRow.lastInsertRowid),
      model: result.model,
      reply: result.reply,
    });
    return true;
  }

  if (pathname === '/api/ai/chat' && req.method === 'DELETE') {
    db.prepare('DELETE FROM ai_chat_messages WHERE user_id = ?').run(user.id);
    sendJson(res, 200, { ok: true });
    return true;
  }

  // 2. Topic Explainer
  if (pathname === '/api/ai/explain' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const topic = String(body.topic || '').trim();
    const level = ['beginner', 'intermediate', 'advanced'].includes(body.level) ? body.level : 'beginner';
    const focus = String(body.focus || '').trim();
    if (!topic) throw new HttpError(400, 'Please enter a topic to explain.');

    const { subjectId, subjectLabel } = resolveSubjectContext(db, user.id, body.subject_id);
    const result = await explainTopic({
      config,
      model: body.model,
      topic,
      subjectLabel,
      level,
      focus,
    });

    const historyId = saveHistory(
      db,
      user.id,
      'explainer',
      subjectId,
      result.explanation?.title || topic,
      result.explanation,
      result.model
    );

    sendJson(res, 200, { id: historyId, model: result.model, explanation: result.explanation });
    return true;
  }

  // 3. Quiz Generator
  if (pathname === '/api/ai/quiz' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const topic = String(body.topic || '').trim();
    const difficulty = ['easy', 'medium', 'hard'].includes(body.difficulty) ? body.difficulty : 'medium';
    const count = Math.min(15, Math.max(3, Number(body.count || 5)));
    const contextText = String(body.context_text || '').trim();
    if (!topic) throw new HttpError(400, 'Please enter a topic for the quiz.');

    const { subjectId, subjectLabel } = resolveSubjectContext(db, user.id, body.subject_id);
    const result = await generateQuiz({
      config,
      model: body.model,
      topic,
      subjectLabel,
      difficulty,
      count,
      contextText,
    });

    const historyId = saveHistory(
      db,
      user.id,
      'quiz',
      subjectId,
      result.quiz?.title || `${topic} Quiz`,
      result.quiz,
      result.model
    );

    sendJson(res, 200, { id: historyId, model: result.model, quiz: result.quiz });
    return true;
  }

  // 4. Personalised Daily & Weekly Study Planner
  if (pathname === '/api/ai/planner' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const goal = String(body.goal || '').trim();
    const dailyHours = Math.min(14, Math.max(0.5, Number(body.daily_hours || 3)));
    const focusMode = ['balanced', 'deadline_first', 'exam_crunch'].includes(body.focus_mode)
      ? body.focus_mode
      : 'balanced';

    const subjects = listSubjectsWithProgress(db, user.id).map((s) => ({
      name: s.name,
      code: s.code,
      syllabus_percent: s.syllabus_percent,
      weekly_hours_logged: s.weekly_hours,
      target_hours_weekly: s.target_hours_weekly,
      incomplete_topics: s.topics.filter((t) => !t.is_completed).map((t) => t.title).slice(0, 6),
    }));

    const pendingTasks = db.prepare(`
      SELECT t.title, t.due_date, t.priority, t.status, s.name AS subject_name
      FROM tasks t
      LEFT JOIN subjects s ON s.id = t.subject_id
      WHERE t.user_id = ? AND t.status != 'completed'
      ORDER BY t.due_date ASC
      LIMIT 15
    `).all(user.id);

    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const timetable = db.prepare(`
      SELECT ts.title, ts.slot_type, ts.day_of_week, ts.start_time, ts.end_time, s.name AS subject_name
      FROM timetable_slots ts
      LEFT JOIN subjects s ON s.id = ts.subject_id
      WHERE ts.user_id = ?
      ORDER BY ts.day_of_week ASC, ts.start_time ASC
    `).all(user.id).map((slot) => ({
      day: dayNames[slot.day_of_week],
      title: slot.title,
      type: slot.slot_type,
      time: `${slot.start_time}-${slot.end_time}`,
      subject: slot.subject_name || 'General',
    }));

    const result = await generateStudyPlan({
      config,
      model: body.model,
      studentContext: {
        today_weekday: dayNames[(new Date().getDay() + 6) % 7],
        subjects,
        pending_tasks: pendingTasks,
        existing_weekly_timetable: timetable,
      },
      goal,
      dailyHours,
      focusMode,
    });

    const historyId = saveHistory(
      db,
      user.id,
      'planner',
      null,
      goal ? `Study Plan: ${goal}` : 'Personalised Daily & Weekly Study Plan',
      result.plan,
      result.model
    );

    sendJson(res, 200, { id: historyId, model: result.model, plan: result.plan });
    return true;
  }

  // 5. Notes Summariser (supports multipart document upload, pasted text, or saved StudyFlow note)
  if (pathname === '/api/ai/summarize' && req.method === 'POST') {
    const contentType = req.headers['content-type'] || '';
    let title = '';
    let textContent = '';
    let subjectIdRaw = null;
    let noteId = null;
    let model = '';
    let file = null;

    if (contentType.includes('multipart/form-data')) {
      const { fields, files } = await parseMultipartForm(req, config.maxUploadBytes);
      title = String(fields.title || '').trim();
      textContent = String(fields.text || '').trim();
      subjectIdRaw = fields.subject_id || null;
      noteId = fields.note_id ? Number(fields.note_id) : null;
      model = String(fields.model || '').trim();
      if (files.file) file = files.file;
    } else {
      const body = await readJsonBody(req);
      title = String(body.title || '').trim();
      textContent = String(body.text || '').trim();
      subjectIdRaw = body.subject_id || null;
      noteId = body.note_id ? Number(body.note_id) : null;
      model = String(body.model || '').trim();
    }

    if (noteId) {
      const savedNote = db.prepare('SELECT * FROM notes WHERE id = ? AND user_id = ?').get(noteId, user.id);
      if (!savedNote) throw new HttpError(404, 'Selected StudyFlow note not found.');
      if (!title) title = savedNote.title;
      if (!subjectIdRaw && savedNote.subject_id) subjectIdRaw = savedNote.subject_id;
      if (savedNote.content) {
        textContent = [textContent, savedNote.content].filter(Boolean).join('\n\n');
      }
      if (!file && savedNote.stored_name) {
        const userRoot = path.resolve(config.uploadsDir, String(user.id));
        const filePath = path.resolve(userRoot, savedNote.stored_name);
        if (filePath.startsWith(userRoot + path.sep) && fs.existsSync(filePath)) {
          file = {
            originalName: savedNote.file_name || savedNote.stored_name,
            mimeType: savedNote.mime_type || 'application/octet-stream',
            buffer: fs.readFileSync(filePath),
          };
        }
      }
    }

    const { subjectId, subjectLabel } = resolveSubjectContext(db, user.id, subjectIdRaw);
    const result = await summarizeNotes({
      config,
      model,
      title,
      textContent,
      file,
      subjectLabel,
    });

    const historyId = saveHistory(
      db,
      user.id,
      'summary',
      subjectId,
      result.summary?.title || title || 'Notes Summary',
      result.summary,
      result.model
    );

    sendJson(res, 200, { id: historyId, model: result.model, summary: result.summary });
    return true;
  }

  // 6. Exam Preparation (Revision notes, practice questions, mock test)
  if (pathname === '/api/ai/exam-prep' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const examType = ['midterm', 'final', 'quiz', 'practical'].includes(body.exam_type) ? body.exam_type : 'midterm';
    const daysUntilExam = Math.min(180, Math.max(1, Number(body.days_until_exam || 7)));
    const mockQuestionCount = Math.min(15, Math.max(3, Number(body.mock_question_count || 5)));

    const { subjectId, subjectLabel } = resolveSubjectContext(db, user.id, body.subject_id);
    let topics = String(body.topics || '').trim();

    if (!topics && subjectId) {
      const syllabusRows = db.prepare(`
        SELECT title FROM syllabus_topics WHERE subject_id = ? AND user_id = ? ORDER BY sort_order ASC
      `).all(subjectId, user.id);
      topics = syllabusRows.map((r) => r.title).join(', ');
    }
    if (!topics) {
      throw new HttpError(400, 'Please enter exam topics or select a subject with syllabus topics.');
    }

    const result = await generateExamPrep({
      config,
      model: body.model,
      subjectLabel,
      topics,
      examType,
      daysUntilExam,
      mockQuestionCount,
    });

    const historyId = saveHistory(
      db,
      user.id,
      'exam_prep',
      subjectId,
      result.exam_prep?.title || `${subjectLabel || 'Exam'} Prep Pack`,
      result.exam_prep,
      result.model
    );

    sendJson(res, 200, { id: historyId, model: result.model, exam_prep: result.exam_prep });
    return true;
  }

  const historyDelMatch = pathname.match(/^\/api\/ai\/history\/(\d+)$/);
  if (historyDelMatch && req.method === 'DELETE') {
    const id = Number(historyDelMatch[1]);
    db.prepare('DELETE FROM ai_history WHERE id = ? AND user_id = ?').run(id, user.id);
    sendJson(res, 200, { ok: true });
    return true;
  }

  // Optional query filter for history
  if (pathname === '/api/ai/history' && req.method === 'GET') {
    const featureType = query.feature_type || '';
    const rows = featureType
      ? db.prepare('SELECT * FROM ai_history WHERE user_id = ? AND feature_type = ? ORDER BY id DESC LIMIT 20').all(user.id, featureType)
      : db.prepare('SELECT * FROM ai_history WHERE user_id = ? ORDER BY id DESC LIMIT 20').all(user.id);
    sendJson(res, 200, {
      history: rows.map((r) => ({ ...r, output: JSON.parse(r.output_json) })),
    });
    return true;
  }

  return false;
}
