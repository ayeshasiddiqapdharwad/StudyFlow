import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readJsonBody, sendJson, HttpError } from '../utils/http.js';
import { parseMultipartForm } from '../utils/multipart.js';

const SAFE_INLINE_MIMES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'text/plain',
  'text/markdown',
]);

function sanitizeFileName(name) {
  return path.basename(name).replace(/[^a-zA-Z0-9._-]/g, '_');
}

export async function handleNoteRoutes(req, res, ctx) {
  const { db, pathname, query, user, config } = ctx;

  if (pathname === '/api/notes' && req.method === 'GET') {
    const conditions = ['n.user_id = ?'];
    const params = [user.id];

    if (query.subject_id) {
      conditions.push('n.subject_id = ?');
      params.push(Number(query.subject_id));
    }

    const notes = db.prepare(`
      SELECT n.id, n.user_id, n.subject_id, n.title, n.content, n.file_name,
             n.mime_type, n.file_size, n.tags, n.created_at,
             s.name AS subject_name, s.code AS subject_code, s.color AS subject_color
      FROM notes n
      LEFT JOIN subjects s ON s.id = n.subject_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY n.created_at DESC, n.id DESC
    `).all(...params);

    sendJson(res, 200, { notes });
    return true;
  }

  if (pathname === '/api/notes' && req.method === 'POST') {
    const contentType = req.headers['content-type'] || '';
    let title = '';
    let content = '';
    let subjectId = null;
    let tags = '';
    let fileInfo = null;

    if (contentType.includes('multipart/form-data')) {
      const { fields, files } = await parseMultipartForm(req, config.maxUploadBytes);
      title = String(fields.title || '').trim();
      content = String(fields.content || '').trim();
      subjectId = fields.subject_id ? Number(fields.subject_id) : null;
      tags = String(fields.tags || '').trim();

      if (files.file) {
        const uploaded = files.file;
        if (!title) title = uploaded.originalName;
        const safeOriginal = sanitizeFileName(uploaded.originalName);
        const storedName = `${crypto.randomUUID()}-${safeOriginal}`;
        const userDir = path.join(config.uploadsDir, String(user.id));
        fs.mkdirSync(userDir, { recursive: true });
        fs.writeFileSync(path.join(userDir, storedName), uploaded.buffer);
        fileInfo = {
          fileName: uploaded.originalName,
          storedName,
          mimeType: uploaded.mimeType,
          fileSize: uploaded.size,
        };
      }
    } else {
      const body = await readJsonBody(req);
      title = String(body.title || '').trim();
      content = String(body.content || '').trim();
      subjectId = body.subject_id ? Number(body.subject_id) : null;
      tags = String(body.tags || '').trim();
    }

    if (!title) throw new HttpError(400, 'Note title or file is required.');
    if (subjectId) {
      const ownsSubject = db.prepare('SELECT id FROM subjects WHERE id = ? AND user_id = ?').get(subjectId, user.id);
      if (!ownsSubject) throw new HttpError(400, 'Selected subject does not exist.');
    }

    const result = db.prepare(`
      INSERT INTO notes (user_id, subject_id, title, content, file_name, stored_name, mime_type, file_size, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      user.id,
      subjectId,
      title,
      content,
      fileInfo?.fileName || null,
      fileInfo?.storedName || null,
      fileInfo?.mimeType || null,
      fileInfo?.fileSize || 0,
      tags
    );

    const note = db.prepare(`
      SELECT n.id, n.user_id, n.subject_id, n.title, n.content, n.file_name,
             n.mime_type, n.file_size, n.tags, n.created_at,
             s.name AS subject_name, s.code AS subject_code, s.color AS subject_color
      FROM notes n
      LEFT JOIN subjects s ON s.id = n.subject_id
      WHERE n.id = ?
    `).get(Number(result.lastInsertRowid));

    sendJson(res, 201, { note });
    return true;
  }

  const downloadMatch = pathname.match(/^\/api\/notes\/(\d+)\/download$/);
  if (downloadMatch && req.method === 'GET') {
    const noteId = Number(downloadMatch[1]);
    const note = db.prepare('SELECT * FROM notes WHERE id = ? AND user_id = ?').get(noteId, user.id);
    if (!note || !note.stored_name) {
      throw new HttpError(404, 'Uploaded file not found.');
    }

    const userRoot = path.resolve(config.uploadsDir, String(user.id));
    const filePath = path.resolve(userRoot, note.stored_name);
    if (!filePath.startsWith(userRoot + path.sep) || !fs.existsSync(filePath)) {
      throw new HttpError(404, 'File missing on disk.');
    }

    const rawMime = String(note.mime_type || 'application/octet-stream').split(';')[0].trim().toLowerCase();
    const canInline = query.inline === '1' && SAFE_INLINE_MIMES.has(rawMime);
    const disposition = canInline ? 'inline' : 'attachment';
    const responseMime = rawMime === 'text/markdown' && canInline ? 'text/plain; charset=utf-8' : rawMime;

    res.writeHead(200, {
      'Content-Type': responseMime,
      'Content-Disposition': `${disposition}; filename="${sanitizeFileName(note.file_name || 'note')}"`,
      'Content-Security-Policy': 'sandbox',
      'X-Content-Type-Options': 'nosniff',
    });
    fs.createReadStream(filePath).pipe(res);
    return true;
  }

  const noteMatch = pathname.match(/^\/api\/notes\/(\d+)$/);
  if (noteMatch) {
    const noteId = Number(noteMatch[1]);
    const note = db.prepare('SELECT * FROM notes WHERE id = ? AND user_id = ?').get(noteId, user.id);
    if (!note) throw new HttpError(404, 'Note not found.');

    if (req.method === 'DELETE') {
      if (note.stored_name) {
        const filePath = path.resolve(config.uploadsDir, String(user.id), note.stored_name);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }
      db.prepare('DELETE FROM notes WHERE id = ? AND user_id = ?').run(noteId, user.id);
      sendJson(res, 200, { ok: true });
      return true;
    }
  }

  return false;
}
