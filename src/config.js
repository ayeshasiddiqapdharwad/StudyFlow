import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

/**
 * Load key=value pairs from .env without overriding existing environment variables.
 */
export function loadDotEnv(envPath = path.join(ROOT_DIR, '.env')) {
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}

loadDotEnv();

export const AVAILABLE_GEMINI_MODELS = [
  { id: 'gemini-3.5-flash',      label: 'Gemini 3.5 Flash (Fast & Balanced)' },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite (Ultra Fast)' },
  { id: 'gemini-3.6-flash',      label: 'Gemini 3.6 Flash (Advanced)' },
  { id: 'gemini-3.7-flash',      label: 'Gemini 3.7 Flash' },
  { id: 'gemini-3.8-flash',      label: 'Gemini 3.8 Flash' },
  { id: 'gemini-4-neon',         label: 'Gemini 4 Neon' },
  { id: 'gemini-4-argon',        label: 'Gemini 4 Argon' },
  { id: 'gemini-4-carbon',       label: 'Gemini 4 Carbon' },
  { id: 'gemini-4-hydrogen',     label: 'Gemini 4 Hydrogen' },
];

export const config = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '127.0.0.1',
  dbPath: process.env.STUDYFLOW_DB_PATH || path.join(ROOT_DIR, 'data', 'studyflow.db'),
  uploadsDir: process.env.STUDYFLOW_UPLOADS_DIR || path.join(ROOT_DIR, 'data', 'uploads'),
  publicDir: path.join(ROOT_DIR, 'public'),
  // Default 30 minutes inactivity timeout (NFR3)
  sessionIdleMs: Number(process.env.SESSION_IDLE_MS || 30 * 60 * 1000),
  // Maximum session absolute lifetime: 7 days
  sessionMaxMs: Number(process.env.SESSION_MAX_MS || 7 * 24 * 60 * 60 * 1000),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES || 10 * 1024 * 1024),
  cookieName: 'studyflow_sid',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3.5-flash',
  availableGeminiModels: AVAILABLE_GEMINI_MODELS,
};
