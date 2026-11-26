import { GoogleGenAI } from '@google/genai';
import { HttpError } from '../utils/http.js';

const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.csv', '.json', '.js', '.py', '.html', '.css']);
const MULTIMODAL_MIMES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'text/plain',
  'text/markdown',
  'text/csv',
]);

/**
 * Resolve and validate the requested Gemini model against configured models.
 */
export function resolveGeminiModel(requestedModel, config) {
  const allowed = new Set((config.availableGeminiModels || []).map((m) => m.id));
  if (config.geminiModel) allowed.add(config.geminiModel);

  const chosen = String(requestedModel || config.geminiModel || 'gemini-2.5-flash').trim();
  if (!allowed.has(chosen)) {
    throw new HttpError(400, `Unsupported Gemini model "${chosen}".`);
  }
  return chosen;
}

function getGenAIClient(config) {
  if (config.geminiClient) return config.geminiClient;
  const apiKey = String(config.geminiApiKey || '').trim();
  if (!apiKey) {
    throw new HttpError(
      503,
      'Google Gemini API key is not configured. Add GEMINI_API_KEY to your server .env file and restart StudyFlow.'
    );
  }
  return new GoogleGenAI({ apiKey });
}

function parseJsonResponse(rawText) {
  const cleaned = String(rawText || '')
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new HttpError(502, 'Gemini returned an unexpected format. Please try again.');
  }
}

function mapGeminiError(err) {
  if (err instanceof HttpError) return err;
  const msg = String(err?.message || 'Unknown Gemini error');
  const status = Number(err?.status || err?.code || 0);

  if (status === 401 || status === 403 || /API_KEY_INVALID|API key not valid|permission/i.test(msg)) {
    return new HttpError(502, 'Gemini API authentication failed. Please check GEMINI_API_KEY in your .env file.');
  }
  if (status === 429 || /quota|rate limit|resource_exhausted/i.test(msg)) {
    return new HttpError(429, 'Gemini API rate limit or quota reached. Please wait a moment and try again.');
  }
  if (status === 404 || /model.*not found|This model.*is not supported/i.test(msg)) {
    return new HttpError(400, 'Selected Gemini model is unavailable for your API key. Please choose another model from the dropdown (try Gemini 3.5 Flash).');
  }
  if (status === 503 || /high demand|overloaded|service unavailable/i.test(msg)) {
    return new HttpError(503, 'Gemini model is temporarily overloaded. Please wait a moment and try again, or switch to a different model.');
  }
  return new HttpError(502, `Gemini AI request failed: ${msg}`);
}

export async function generateWithGemini({
  config,
  model,
  contents,
  systemInstruction,
  expectJson = false,
  temperature = 0.6,
}) {
  const client = getGenAIClient(config);
  const chosenModel = resolveGeminiModel(model, config);

  const reqConfig = {
    temperature,
  };
  if (systemInstruction) {
    reqConfig.systemInstruction = systemInstruction;
  }
  if (expectJson) {
    reqConfig.responseMimeType = 'application/json';
  }

  try {
    const response = await client.models.generateContent({
      model: chosenModel,
      contents,
      config: reqConfig,
    });
    const text = typeof response?.text === 'function' ? response.text() : response?.text;
    if (!text) {
      throw new HttpError(502, 'Gemini returned an empty response. Please try again.');
    }
    return {
      model: chosenModel,
      text,
      data: expectJson ? parseJsonResponse(text) : null,
    };
  } catch (err) {
    throw mapGeminiError(err);
  }
}

export async function testGeminiConnection(config, model) {
  const res = await generateWithGemini({
    config,
    model,
    contents: 'Reply with exactly: StudyFlow Gemini connection verified.',
    temperature: 0,
  });
  return { ok: true, model: res.model, reply: res.text.trim() };
}

export async function chatWithTutor({ config, model, message, history = [], subjectLabel = '' }) {
  const systemInstruction = [
    'You are StudyFlow AI, a patient, accurate, student-friendly academic tutor.',
    'Explain clearly using structured steps, intuitive examples, and concise formatting.',
    'Encourage active learning and double-check mathematical or technical accuracy.',
    subjectLabel ? `The student is currently focusing on the subject: ${subjectLabel}.` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const contents = [
    ...history.slice(-10).map((m) => ({
      role: m.role === 'model' ? 'model' : 'user',
      parts: [{ text: String(m.content || '') }],
    })),
    { role: 'user', parts: [{ text: message }] },
  ];

  const res = await generateWithGemini({
    config,
    model,
    contents,
    systemInstruction,
    temperature: 0.6,
  });

  return { model: res.model, reply: res.text.trim() };
}

export async function explainTopic({ config, model, topic, subjectLabel = '', level = 'beginner', focus = '' }) {
  const systemInstruction =
    'You are StudyFlow AI Topic Explainer. Return valid JSON only matching the requested schema.';

  const prompt = `
Explain the academic topic "${topic}"${subjectLabel ? ` in the context of "${subjectLabel}"` : ''}.
Target depth: ${level}.
${focus ? `Special focus requested by student: ${focus}` : ''}

Return ONLY a JSON object with this exact structure:
{
  "title": "Clear topic title",
  "summary": "2-3 sentence overview in plain language",
  "intuitive_analogy": "A relatable everyday analogy for a student",
  "core_concepts": [
    { "name": "Concept name", "explanation": "Clear explanation" }
  ],
  "beginner_examples": [
    { "title": "Example title", "walkthrough": "Step-by-step beginner-friendly example" }
  ],
  "common_mistakes": ["Common pitfall 1", "Common pitfall 2"],
  "quick_check": {
    "question": "1 quick self-check question",
    "answer": "Short answer and why"
  }
}
`;

  const res = await generateWithGemini({
    config,
    model,
    contents: prompt,
    systemInstruction,
    expectJson: true,
    temperature: 0.5,
  });

  return { model: res.model, explanation: res.data };
}

export async function generateQuiz({ config, model, topic, subjectLabel = '', difficulty = 'medium', count = 5, contextText = '' }) {
  const safeCount = Math.min(15, Math.max(3, Number(count) || 5));
  const systemInstruction =
    'You are StudyFlow AI Quiz Generator. Always return valid JSON only with unambiguous multiple-choice questions.';

  const prompt = `
Create a ${difficulty} difficulty multiple-choice quiz with exactly ${safeCount} questions on "${topic}"${
    subjectLabel ? ` (${subjectLabel})` : ''
  }.
${contextText ? `Reference study material:\n${contextText.slice(0, 6000)}` : ''}

Return ONLY a JSON object with this exact structure:
{
  "title": "Quiz title",
  "difficulty": "${difficulty}",
  "questions": [
    {
      "id": 1,
      "question": "Question text",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correct_index": 0,
      "explanation": "Why the correct option is right and why others are not"
    }
  ]
}
Ensure "correct_index" is an integer 0..3 matching "options".
`;

  const res = await generateWithGemini({
    config,
    model,
    contents: prompt,
    systemInstruction,
    expectJson: true,
    temperature: 0.5,
  });

  return { model: res.model, quiz: res.data };
}

export async function generateStudyPlan({ config, model, studentContext, goal = '', dailyHours = 3, focusMode = 'balanced' }) {
  const systemInstruction =
    'You are StudyFlow AI Study Planner. Build realistic, student-friendly daily and weekly schedules grounded in the student data provided. Return valid JSON only.';

  const prompt = `
Create a personalised Daily and Weekly Study Plan for this student based on their live StudyFlow data:
- Daily study hours available (outside classes): ${dailyHours} hours
- Planning preference: ${focusMode}
- Student's goal: ${goal || 'Stay ahead of upcoming deadlines and improve syllabus mastery'}
- Live academic snapshot (JSON):
${JSON.stringify(studentContext, null, 2)}

Return ONLY a JSON object with this exact structure:
{
  "overview": "Encouraging 2-3 sentence strategy tailored to their current tasks and syllabus progress",
  "priority_focus": ["Top priority 1", "Top priority 2", "Top priority 3"],
  "today_plan": [
    {
      "time_block": "e.g. 16:00 - 17:00",
      "subject": "Subject name",
      "activity": "Specific task or syllabus topic to study",
      "duration_minutes": 60,
      "reason": "Why this is scheduled now"
    }
  ],
  "weekly_plan": [
    {
      "day": "Monday",
      "focus_subject": "Primary subject(s)",
      "sessions": [
        { "activity": "Concrete study session", "duration_minutes": 60 }
      ],
      "goal": "Daily milestone"
    }
  ],
  "productivity_tips": ["Actionable tip 1", "Actionable tip 2"]
}
Include all 7 days (Monday through Sunday) in "weekly_plan".
`;

  const res = await generateWithGemini({
    config,
    model,
    contents: prompt,
    systemInstruction,
    expectJson: true,
    temperature: 0.5,
  });

  return { model: res.model, plan: res.data };
}

export async function summarizeNotes({ config, model, title = '', textContent = '', file = null, subjectLabel = '' }) {
  const systemInstruction =
    'You are StudyFlow AI Notes Summariser. Extract clear, accurate study summaries from student notes and uploaded documents. Return valid JSON only.';

  const parts = [];
  let instructionText = `Summarize the following study material${subjectLabel ? ` for subject "${subjectLabel}"` : ''}${
    title ? ` titled "${title}"` : ''
  }.

Return ONLY a JSON object with this exact structure:
{
  "title": "Concise title for the summary",
  "tldr": "2-3 sentence executive summary",
  "key_points": ["Key takeaway 1", "Key takeaway 2"],
  "definitions": [
    { "term": "Important term or formula", "meaning": "Clear definition" }
  ],
  "action_items": ["What the student should practice or review next"],
  "study_questions": ["Self-test question 1", "Self-test question 2"]
}`;

  if (textContent) {
    instructionText += `\n\nStudy Notes Content:\n${textContent.slice(0, 24000)}`;
  }
  parts.push({ text: instructionText });

  if (file && file.buffer?.length) {
    const lowerName = String(file.originalName || '').toLowerCase();
    const ext = lowerName.includes('.') ? lowerName.slice(lowerName.lastIndexOf('.')) : '';
    const mime = String(file.mimeType || 'application/octet-stream').split(';')[0].trim().toLowerCase();

    if (TEXT_EXTENSIONS.has(ext) || mime.startsWith('text/')) {
      parts.push({
        text: `\n\nUploaded File (${file.originalName}):\n${file.buffer.toString('utf8').slice(0, 24000)}`,
      });
    } else if (MULTIMODAL_MIMES.has(mime)) {
      parts.push({
        inlineData: {
          mimeType: mime,
          data: file.buffer.toString('base64'),
        },
      });
    } else {
      throw new HttpError(
        400,
        `Unsupported file format (${file.originalName}). Please upload PDF, TXT, Markdown, CSV, or image (PNG/JPG/WEBP) notes.`
      );
    }
  }

  if (!textContent && !file) {
    throw new HttpError(400, 'Please paste study notes, upload a document, or choose an existing StudyFlow note.');
  }

  const res = await generateWithGemini({
    config,
    model,
    contents: [{ role: 'user', parts }],
    systemInstruction,
    expectJson: true,
    temperature: 0.4,
  });

  return { model: res.model, summary: res.data };
}

export async function generateExamPrep({
  config,
  model,
  subjectLabel,
  topics,
  examType = 'midterm',
  daysUntilExam = 7,
  mockQuestionCount = 5,
}) {
  const safeCount = Math.min(15, Math.max(3, Number(mockQuestionCount) || 5));
  const systemInstruction =
    'You are StudyFlow AI Exam Coach. Generate thorough revision notes, conceptual practice questions with model answers, and a realistic MCQ mock test. Return valid JSON only.';

  const prompt = `
Prepare an Exam Preparation Pack for:
- Subject: ${subjectLabel || 'General'}
- Exam type: ${examType}
- Days until exam: ${daysUntilExam}
- Topics to cover: ${topics}

Return ONLY a JSON object with this exact structure:
{
  "title": "Exam Prep Pack title",
  "revision_notes": [
    {
      "section": "Topic / Module name",
      "summary": "High-yield revision summary",
      "key_points": ["Important rule, formula, or concept"]
    }
  ],
  "practice_questions": [
    {
      "question": "Short-answer or conceptual exam question",
      "hint": "Quick clue to guide thinking",
      "model_answer": "Complete, clear exam-ready answer"
    }
  ],
  "mock_test": {
    "duration_minutes": ${safeCount * 3},
    "instructions": "Brief mock test instructions",
    "questions": [
      {
        "id": 1,
        "question": "MCQ question",
        "options": ["Option A", "Option B", "Option C", "Option D"],
        "correct_index": 0,
        "explanation": "Why this answer is correct"
      }
    ]
  }
}
Include ${safeCount} questions in "mock_test.questions".
`;

  const res = await generateWithGemini({
    config,
    model,
    contents: prompt,
    systemInstruction,
    expectJson: true,
    temperature: 0.5,
  });

  return { model: res.model, exam_prep: res.data };
}
