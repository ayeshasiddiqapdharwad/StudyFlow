import { hashPassword } from '../utils/auth.js';
import { offsetLocalDateString } from '../utils/dates.js';

function formatDateOffset(offsetDays) {
  return offsetLocalDateString(offsetDays);
}

/**
 * Populate realistic student semester data for a user account (used for demo account
 * or when a new student opts to load sample semester data).
 */
export function seedSampleDataForUser(db, userId) {
  const existing = db.prepare('SELECT COUNT(*) AS count FROM subjects WHERE user_id = ?').get(userId);
  if (existing.count > 0) return false;

  const insertSubject = db.prepare(`
    INSERT INTO subjects (user_id, name, code, color, target_hours_weekly)
    VALUES (?, ?, ?, ?, ?)
  `);

  const s1 = insertSubject.run(userId, 'Data Structures & Algorithms', 'CS201', '#4f46e5', 6).lastInsertRowid;
  const s2 = insertSubject.run(userId, 'Software Engineering', 'SE301', '#0ea5e9', 5).lastInsertRowid;
  const s3 = insertSubject.run(userId, 'Linear Algebra', 'MA204', '#10b981', 4).lastInsertRowid;
  const s4 = insertSubject.run(userId, 'Database Systems', 'CS220', '#f59e0b', 5).lastInsertRowid;

  const insertTopic = db.prepare(`
    INSERT INTO syllabus_topics (subject_id, user_id, title, is_completed, sort_order, completed_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const nowIso = new Date().toISOString();
  const syllabusSeed = [
    [s1, 'Arrays, Linked Lists & Complexity Analysis', 1, 0],
    [s1, 'Stacks, Queues & Recursion', 1, 1],
    [s1, 'Trees, BST & AVL Rotations', 1, 2],
    [s1, 'Graphs, BFS/DFS & Shortest Paths', 0, 3],
    [s1, 'Dynamic Programming', 0, 4],
    [s2, 'SDLC Models & Agile Practices', 1, 0],
    [s2, 'Requirements Analysis & SRS Documentation', 1, 1],
    [s2, 'System Architecture & UML Modeling', 0, 2],
    [s2, 'Software Testing & QA', 0, 3],
    [s3, 'Systems of Linear Equations & Matrices', 1, 0],
    [s3, 'Vector Spaces & Subspaces', 1, 1],
    [s3, 'Eigenvalues & Eigenvectors', 1, 2],
    [s3, 'Orthogonality & SVD', 0, 3],
    [s4, 'ER Modeling & Relational Schema', 1, 0],
    [s4, 'SQL Joins, Views & Indexing', 0, 1],
    [s4, 'Normalization (1NF–BCNF)', 0, 2],
  ];
  for (const [sid, title, done, order] of syllabusSeed) {
    insertTopic.run(sid, userId, title, done, order, done ? nowIso : null);
  }

  const insertTask = db.prepare(`
    INSERT INTO tasks (user_id, subject_id, title, description, due_date, priority, status, reminder_minutes_before, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertSubtask = db.prepare(`
    INSERT INTO subtasks (task_id, user_id, title, is_completed, sort_order)
    VALUES (?, ?, ?, ?, ?)
  `);

  const t1 = insertTask.run(
    userId, s1, 'Implement Dijkstra Shortest Path Lab',
    'Complete priority-queue implementation and benchmark on sparse graphs.',
    formatDateOffset(1), 'high', 'in_progress', 1440, null
  ).lastInsertRowid;
  insertSubtask.run(t1, userId, 'Build adjacency list loader', 1, 0);
  insertSubtask.run(t1, userId, 'Implement min-heap Dijkstra loop', 1, 1);
  insertSubtask.run(t1, userId, 'Write 5 edge-case unit tests', 0, 2);

  const t2 = insertTask.run(
    userId, s2, 'Finalize StudyFlow SRS Document',
    'Review FR1–FR10 dependencies and stakeholder mapping.',
    formatDateOffset(2), 'high', 'pending', 1440, null
  ).lastInsertRowid;
  insertSubtask.run(t2, userId, 'Verify dependency matrix', 0, 0);
  insertSubtask.run(t2, userId, 'Proofread non-functional metrics', 0, 1);

  insertTask.run(
    userId, s3, 'Eigenvalues Problem Set #4',
    'Solve odd-numbered problems from Chapter 5.',
    formatDateOffset(4), 'medium', 'pending', 1440, null
  );

  insertTask.run(
    userId, s4, 'Normalize Library Database Schema to BCNF',
    'Draw functional dependency diagrams for all tables.',
    formatDateOffset(-1), 'medium', 'completed', 1440, nowIso
  );

  insertTask.run(
    userId, s1, 'Review AVL Tree Rotations Quiz',
    'Practice LL, RR, LR, RL balancing cases.',
    formatDateOffset(-2), 'low', 'completed', 1440, nowIso
  );

  const insertSlot = db.prepare(`
    INSERT INTO timetable_slots (user_id, subject_id, title, slot_type, day_of_week, start_time, end_time, location, reminder_minutes_before)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const slots = [
    [s1, 'CS201 Lecture', 'class', 0, '09:00', '10:30', 'Hall A-204', 30],
    [s2, 'SE301 Lecture', 'class', 0, '11:00', '12:30', 'Room B-102', 30],
    [s1, 'DSA Coding Practice', 'study', 0, '16:00', '17:30', 'Library Quiet Zone', 30],
    [s3, 'MA204 Lecture', 'class', 1, '10:00', '11:30', 'Math Wing 12', 30],
    [s4, 'Database Systems Lab', 'lab', 1, '14:00', '16:00', 'CS Lab 3', 30],
    [s2, 'SRS & Design Review', 'study', 2, '15:00', '16:30', 'Study Room 4', 30],
    [s3, 'Linear Algebra Problem Prep', 'study', 3, '17:00', '18:30', 'Dorm Desk', 30],
    [s4, 'SQL & Normalization Drill', 'study', 4, '10:30', '12:00', 'Library 2F', 30],
  ];
  for (const [sid, title, type, day, start, end, loc, rem] of slots) {
    insertSlot.run(userId, sid, title, type, day, start, end, loc, rem);
  }

  const insertSession = db.prepare(`
    INSERT INTO study_sessions (user_id, subject_id, mode, duration_minutes, session_date, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const sessions = [
    [s1, 'timer', 90, formatDateOffset(-4), 'Practiced BFS & DFS traversal'],
    [s2, 'manual', 60, formatDateOffset(-3), 'Drafted SRS requirements table'],
    [s3, 'timer', 75, formatDateOffset(-2), 'Eigenvalue practice problems'],
    [s4, 'timer', 50, formatDateOffset(-1), 'Reviewed 3NF vs BCNF rules'],
    [s1, 'timer', 80, formatDateOffset(0), 'Dijkstra implementation sprint'],
  ];
  for (const [sid, mode, mins, date, notes] of sessions) {
    insertSession.run(userId, sid, mode, mins, date, notes);
  }

  const insertNote = db.prepare(`
    INSERT INTO notes (user_id, subject_id, title, content, tags)
    VALUES (?, ?, ?, ?, ?)
  `);
  insertNote.run(
    userId, s1, 'Graph Traversal Cheat Sheet',
    'BFS uses a Queue (O(V+E)) for unweighted shortest paths.\nDFS uses a Stack/Recursion (O(V+E)) for cycle detection and topological sorting.\nDijkstra uses a Min-Heap (O((V+E) log V)) for non-negative edge weights.',
    'graphs,algorithms,midterm'
  );
  insertNote.run(
    userId, s2, 'IEEE 830 SRS Checklist',
    '1. Functional Requirements (FR) with clear dependencies\n2. Non-Functional Requirements (Usability, Performance, Security, Availability, Reliability, Portability, Maintainability)\n3. Stakeholder ownership and user/system interaction examples.',
    'srs,requirements,lab2'
  );

  return true;
}

/**
 * Ensure a ready-to-try demo student account exists on first boot.
 */
export function ensureDemoAccount(db) {
  const demoEmail = 'demo@studyflow.edu';
  let user = db.prepare('SELECT id FROM users WHERE email = ?').get(demoEmail);
  if (!user) {
    const { hash, salt } = hashPassword('StudyFlow123!');
    const result = db.prepare(`
      INSERT INTO users (full_name, email, password_hash, password_salt, institution, semester)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('Maya Patel', demoEmail, hash, salt, 'State Institute of Technology', 'Fall Semester');
    seedSampleDataForUser(db, Number(result.lastInsertRowid));
  }
}
