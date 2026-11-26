import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { config as defaultConfig } from './src/config.js';
import { createDatabase } from './src/db/database.js';
import { authenticateSession } from './src/utils/auth.js';
import { parseCookies, sendJson, sendStaticFile, HttpError } from './src/utils/http.js';
import { ensureDemoAccount } from './src/services/seed.js';
import { handleAuthRoutes } from './src/routes/auth.js';
import { handleSubjectRoutes } from './src/routes/subjects.js';
import { handleTaskRoutes } from './src/routes/tasks.js';
import { handleTimetableRoutes } from './src/routes/timetable.js';
import { handleNoteRoutes } from './src/routes/notes.js';
import { handleSessionRoutes } from './src/routes/sessions.js';
import { handleDashboardRoutes } from './src/routes/dashboard.js';
import { handleReportRoutes } from './src/routes/reports.js';
import { handleNotificationRoutes } from './src/routes/notifications.js';
import { handleAiRoutes } from './src/routes/ai.js';

/**
 * Create a StudyFlow HTTP request handler and database instance.
 */
export function createStudyFlowApp(overrides = {}) {
  const cfg = { ...defaultConfig, ...overrides };
  const db = createDatabase(cfg.dbPath);
  ensureDemoAccount(db);

  async function requestHandler(req, res) {
    try {
      const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const pathname = reqUrl.pathname;
      const query = Object.fromEntries(reqUrl.searchParams.entries());

      if (pathname === '/api/health') {
        sendJson(res, 200, { status: 'ok', app: 'StudyFlow' });
        return;
      }

      if (pathname.startsWith('/api/')) {
        const cookies = parseCookies(req.headers.cookie);
        const authHeader = req.headers.authorization || '';
        const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
        const sessionToken = cookies[cfg.cookieName] || bearer || null;

        const { user, expiredReason } = authenticateSession(db, sessionToken, cfg.sessionIdleMs);
        const ctx = { db, pathname, query, user, expiredReason, sessionToken, config: cfg };

        if (await handleAuthRoutes(req, res, ctx)) return;

        if (!user) {
          throw new HttpError(401, expiredReason || 'Authentication required.');
        }

        const routeHandlers = [
          handleDashboardRoutes,
          handleSubjectRoutes,
          handleTaskRoutes,
          handleTimetableRoutes,
          handleNoteRoutes,
          handleSessionRoutes,
          handleReportRoutes,
          handleNotificationRoutes,
          handleAiRoutes,
        ];

        for (const handler of routeHandlers) {
          if (await handler(req, res, ctx)) return;
        }

        throw new HttpError(404, 'API endpoint not found.');
      }

      const served = sendStaticFile(res, cfg.publicDir, pathname);
      if (!served) {
        sendJson(res, 404, { error: 'Not found' });
      }
    } catch (err) {
      if (err instanceof HttpError) {
        sendJson(res, err.status, { error: err.message });
        return;
      }
      console.error('Unhandled server error:', err);
      sendJson(res, 500, { error: 'Internal server error' });
    }
  }

  return { requestHandler, db, config: cfg };
}

/**
 * Create a StudyFlow HTTP server instance with isolated config and database.
 */
export function createStudyFlowServer(overrides = {}) {
  const { requestHandler, db, config } = createStudyFlowApp(overrides);
  const server = http.createServer(requestHandler);
  return { server, db, config };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const { server, config } = createStudyFlowServer();

const port = Number(process.env.PORT || config.port);
const host = '0.0.0.0';

server.listen(port, host, () => {
  console.log(`StudyFlow running at http://${host}:${port}`);
});
}
