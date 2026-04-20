import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = process.env.SE_KEY_LOG_DIR
  || path.join(__dirname, '..', 'logs');

fs.mkdirSync(LOG_DIR, { recursive: true });

// Rolling by UTC-local date: logs/2026-04-20.log
function currentLogPath() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return path.join(
    LOG_DIR,
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.log`
  );
}

function write(level, msg, meta) {
  const line = JSON.stringify({
    t: new Date().toISOString(),
    level,
    msg,
    ...(meta && typeof meta === 'object' ? meta : {}),
  }) + '\n';

  // Async append — never block request handling on disk IO.
  fs.appendFile(currentLogPath(), line, (err) => {
    if (err) console.error('[logger] write failed:', err.message);
  });

  // Also mirror to stdout/stderr so nssm/pm2 captures it.
  const out = level === 'error' ? console.error : console.log;
  out(`[${level}] ${msg}`, meta ?? '');
}

export const log = {
  info:  (msg, meta) => write('info',  msg, meta),
  warn:  (msg, meta) => write('warn',  msg, meta),
  error: (msg, meta) => write('error', msg, meta),
};
