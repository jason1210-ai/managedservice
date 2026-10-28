'use strict';

const path = require('node:path');
const { openDatabase } = require('./db');
const { createApp } = require('./app');
const { hashPassword, validatePassword } = require('./auth');

// ADMIN_EMAIL / ADMIN_PASSWORD 가 설정되어 있으면 관리자(PwC 담당자) 계정을 보장한다.
function ensureAdmin(db) {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return;
  const pwError = validatePassword(password);
  if (pwError) throw new Error(`ADMIN_PASSWORD: ${pwError}`);
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    db.prepare("UPDATE users SET password_hash = ?, role = 'admin', company_id = NULL WHERE id = ?").run(
      hashPassword(password),
      existing.id,
    );
  } else {
    db.prepare("INSERT INTO users (company_id, email, name, password_hash, role) VALUES (NULL, ?, ?, ?, 'admin')").run(
      email,
      '관리자',
      hashPassword(password),
    );
  }
  console.log(`관리자 계정 확인: ${email}`);
}

function main() {
  const dbFile = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'app.db');
  const db = openDatabase(dbFile);
  ensureAdmin(db);
  const app = createApp(db, { secureCookies: process.env.SECURE_COOKIES === 'true' });
  if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => console.log(`재무성장지원서비스 포털: http://localhost:${port}`));
}

if (require.main === module) main();

module.exports = { ensureAdmin };
