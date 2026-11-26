let onUnauthorized = () => {};

export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

async function request(url, options = {}) {
  const isFormData = options.body instanceof FormData;
  const headers = isFormData
    ? { ...(options.headers || {}) }
    : { 'Content-Type': 'application/json', ...(options.headers || {}) };

  const res = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/api/auth/login') && !url.startsWith('/api/auth/register')) {
      onUnauthorized(data.error || 'Session expired. Please log in again.');
    }
    throw new Error(data.error || `Request failed (${res.status})`);
  }

  return data;
}

export const api = {
  // Auth
  me: () => request('/api/auth/me'),
  login: (payload) => request('/api/auth/login', { method: 'POST', body: JSON.stringify(payload) }),
  register: (payload) => request('/api/auth/register', { method: 'POST', body: JSON.stringify(payload) }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  seedSample: () => request('/api/auth/seed-sample', { method: 'POST' }),

  // Dashboard
  dashboard: () => request('/api/dashboard'),

  // Subjects & Syllabus
  getSubjects: () => request('/api/subjects'),
  createSubject: (payload) => request('/api/subjects', { method: 'POST', body: JSON.stringify(payload) }),
  updateSubject: (id, payload) => request(`/api/subjects/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteSubject: (id) => request(`/api/subjects/${id}`, { method: 'DELETE' }),
  addSyllabusTopic: (subjectId, title) =>
    request(`/api/subjects/${subjectId}/topics`, { method: 'POST', body: JSON.stringify({ title }) }),
  toggleSyllabusTopic: (topicId, isCompleted) =>
    request(`/api/syllabus-topics/${topicId}`, { method: 'PATCH', body: JSON.stringify({ is_completed: isCompleted }) }),
  deleteSyllabusTopic: (topicId) => request(`/api/syllabus-topics/${topicId}`, { method: 'DELETE' }),

  // Tasks & Subtasks
  getTasks: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/api/tasks${qs ? `?${qs}` : ''}`);
  },
  createTask: (payload) => request('/api/tasks', { method: 'POST', body: JSON.stringify(payload) }),
  updateTask: (id, payload) => request(`/api/tasks/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteTask: (id) => request(`/api/tasks/${id}`, { method: 'DELETE' }),
  addSubtask: (taskId, title) =>
    request(`/api/tasks/${taskId}/subtasks`, { method: 'POST', body: JSON.stringify({ title }) }),
  toggleSubtask: (subtaskId, isCompleted) =>
    request(`/api/subtasks/${subtaskId}`, { method: 'PATCH', body: JSON.stringify({ is_completed: isCompleted }) }),
  deleteSubtask: (subtaskId) => request(`/api/subtasks/${subtaskId}`, { method: 'DELETE' }),

  // Timetable
  getTimetable: () => request('/api/timetable'),
  createSlot: (payload) => request('/api/timetable', { method: 'POST', body: JSON.stringify(payload) }),
  updateSlot: (id, payload) => request(`/api/timetable/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteSlot: (id) => request(`/api/timetable/${id}`, { method: 'DELETE' }),

  // Notes & Files
  getNotes: (subjectId = '') => request(`/api/notes${subjectId ? `?subject_id=${subjectId}` : ''}`),
  createNote: (formDataOrJson) =>
    formDataOrJson instanceof FormData
      ? request('/api/notes', { method: 'POST', body: formDataOrJson })
      : request('/api/notes', { method: 'POST', body: JSON.stringify(formDataOrJson) }),
  deleteNote: (id) => request(`/api/notes/${id}`, { method: 'DELETE' }),

  // Study Sessions
  getSessions: () => request('/api/sessions'),
  createSession: (payload) => request('/api/sessions', { method: 'POST', body: JSON.stringify(payload) }),
  deleteSession: (id) => request(`/api/sessions/${id}`, { method: 'DELETE' }),

  // Notifications
  getNotifications: () => request('/api/notifications'),
  markNotificationRead: (id) => request(`/api/notifications/${id}/read`, { method: 'PATCH' }),
  markAllNotificationsRead: () => request('/api/notifications/read-all', { method: 'POST' }),
  dismissNotification: (id) => request(`/api/notifications/${id}`, { method: 'DELETE' }),

  // Reports
  getReport: (from, to) => request(`/api/reports?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),

  // Gemini AI Study Assistant
  aiStatus: () => request('/api/ai/status'),
  aiTest: (model) => request('/api/ai/test', { method: 'POST', body: JSON.stringify({ model }) }),
  aiChat: (payload) => request('/api/ai/chat', { method: 'POST', body: JSON.stringify(payload) }),
  aiClearChat: () => request('/api/ai/chat', { method: 'DELETE' }),
  aiExplain: (payload) => request('/api/ai/explain', { method: 'POST', body: JSON.stringify(payload) }),
  aiQuiz: (payload) => request('/api/ai/quiz', { method: 'POST', body: JSON.stringify(payload) }),
  aiPlan: (payload) => request('/api/ai/planner', { method: 'POST', body: JSON.stringify(payload) }),
  aiSummarize: (formDataOrJson) =>
    formDataOrJson instanceof FormData
      ? request('/api/ai/summarize', { method: 'POST', body: formDataOrJson })
      : request('/api/ai/summarize', { method: 'POST', body: JSON.stringify(formDataOrJson) }),
  aiExamPrep: (payload) => request('/api/ai/exam-prep', { method: 'POST', body: JSON.stringify(payload) }),
  aiDeleteHistory: (id) => request(`/api/ai/history/${id}`, { method: 'DELETE' }),
};
