import {
  hashPassword,
  verifyPassword,
  isValidEmail,
  createSession,
  deleteSession,
} from '../utils/auth.js';
import { readJsonBody, sendJson, buildCookieHeader, HttpError } from '../utils/http.js';
import { seedSampleDataForUser } from '../services/seed.js';

export async function handleAuthRoutes(req, res, ctx) {
  const { db, pathname, config, user, sessionToken } = ctx;

  if (pathname === '/api/auth/register' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const fullName = String(body.full_name || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const institution = String(body.institution || '').trim();
    const semester = String(body.semester || '').trim();
    const loadSampleData = Boolean(body.load_sample_data);

    if (fullName.length < 2) {
      throw new HttpError(400, 'Please enter your full name (at least 2 characters).');
    }
    if (!isValidEmail(email)) {
      throw new HttpError(400, 'Please enter a valid college email address.');
    }
    if (password.length < 6 || password.length > 256) {
      throw new HttpError(400, 'Password must be between 6 and 256 characters long.');
    }

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      throw new HttpError(409, 'An account with this college email already exists.');
    }

    const { hash, salt } = hashPassword(password);
    const result = db.prepare(`
      INSERT INTO users (full_name, email, password_hash, password_salt, institution, semester)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(fullName, email, hash, salt, institution, semester);

    const userId = Number(result.lastInsertRowid);
    if (loadSampleData) {
      seedSampleDataForUser(db, userId);
    }

    const { token } = createSession(db, userId, config.sessionMaxMs);
    const createdUser = db.prepare(`
      SELECT id, full_name, email, institution, semester, created_at
      FROM users WHERE id = ?
    `).get(userId);

    const cookie = buildCookieHeader(config.cookieName, token, {
      maxAgeSeconds: Math.floor(config.sessionMaxMs / 1000),
    });

    sendJson(res, 201, { user: createdUser, token }, { 'Set-Cookie': cookie });
    return true;
  }

  if (pathname === '/api/auth/login' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');

    if (!isValidEmail(email) || !password) {
      throw new HttpError(400, 'College email and password are required.');
    }

    const found = db.prepare(`
      SELECT id, full_name, email, password_hash, password_salt, institution, semester, created_at
      FROM users WHERE email = ?
    `).get(email);

    if (!found || !verifyPassword(password, found.password_hash, found.password_salt)) {
      throw new HttpError(401, 'Invalid college email or password.');
    }

    const { token } = createSession(db, found.id, config.sessionMaxMs);
    const cookie = buildCookieHeader(config.cookieName, token, {
      maxAgeSeconds: Math.floor(config.sessionMaxMs / 1000),
    });

    sendJson(
      res,
      200,
      {
        user: {
          id: found.id,
          full_name: found.full_name,
          email: found.email,
          institution: found.institution,
          semester: found.semester,
          created_at: found.created_at,
        },
        token,
      },
      { 'Set-Cookie': cookie }
    );
    return true;
  }

  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    deleteSession(db, sessionToken);
    const cookie = buildCookieHeader(config.cookieName, '', { clear: true });
    sendJson(res, 200, { ok: true }, { 'Set-Cookie': cookie });
    return true;
  }

  if (pathname === '/api/auth/me' && req.method === 'GET') {
    if (!user) {
      throw new HttpError(401, ctx.expiredReason || 'Authentication required.');
    }
    sendJson(res, 200, { user });
    return true;
  }

  if (pathname === '/api/auth/seed-sample' && req.method === 'POST') {
    if (!user) {
      throw new HttpError(401, ctx.expiredReason || 'Authentication required.');
    }
    const seeded = seedSampleDataForUser(db, user.id);
    sendJson(res, 200, { seeded });
    return true;
  }

  return false;
}
