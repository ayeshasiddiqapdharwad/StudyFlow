import crypto from 'node:crypto';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Validate email syntax (FR1).
 */
export function isValidEmail(email) {
  return typeof email === 'string' && EMAIL_RE.test(email.trim());
}

/**
 * Hash a plaintext password using scrypt with a random 16-byte salt (NFR3).
 */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

/**
 * Verify a plaintext password against a stored scrypt hash and salt using timingSafeEqual (NFR3).
 */
export function verifyPassword(password, storedHash, storedSalt) {
  const derived = crypto.scryptSync(password, storedSalt, 64);
  const expected = Buffer.from(storedHash, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

/**
 * Create a new authenticated session for a user.
 */
export function createSession(db, userId, maxMs) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  const expiresAt = now + maxMs;
  db.prepare(`
    INSERT INTO sessions (token, user_id, created_at, last_active_at, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(token, userId, now, now, expiresAt);
  return { token, expiresAt };
}

/**
 * Validate a session token, enforcing both absolute expiration and inactivity timeout (NFR3).
 * Returns { user, expiredReason } or { user: null, expiredReason }.
 */
export function authenticateSession(db, token, idleMs) {
  if (!token) return { user: null, expiredReason: null };
  const row = db.prepare(`
    SELECT s.token, s.user_id, s.last_active_at, s.expires_at,
           u.id, u.full_name, u.email, u.institution, u.semester, u.created_at
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ?
  `).get(token);

  if (!row) return { user: null, expiredReason: null };

  const now = Date.now();
  if (now > row.expires_at) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return { user: null, expiredReason: 'Session expired. Please log in again.' };
  }

  if (now - row.last_active_at > idleMs) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return { user: null, expiredReason: 'Session expired due to inactivity. Please log in again.' };
  }

  db.prepare('UPDATE sessions SET last_active_at = ? WHERE token = ?').run(now, token);

  return {
    user: {
      id: row.id,
      full_name: row.full_name,
      email: row.email,
      institution: row.institution,
      semester: row.semester,
      created_at: row.created_at,
    },
    expiredReason: null,
  };
}

export function deleteSession(db, token) {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}
