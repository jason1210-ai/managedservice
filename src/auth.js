'use strict';

const crypto = require('node:crypto');

const SESSION_COOKIE = 'fgs_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12시간

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

// 비밀번호 정책: 8자 이상, 영문과 숫자 포함
function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    return '비밀번호는 8자 이상 128자 이하여야 합니다.';
  }
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return '비밀번호에는 영문과 숫자가 모두 포함되어야 합니다.';
  }
  return null;
}

// 사업자등록번호(10자리) 검증번호 확인
function isValidBusinessNumber(value) {
  const digits = String(value).replace(/-/g, '');
  if (!/^\d{10}$/.test(digits)) return false;
  const d = [...digits].map(Number);
  const weights = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let sum = weights.reduce((acc, w, i) => acc + d[i] * w, 0);
  sum += Math.floor((d[8] * 5) / 10);
  return (10 - (sum % 10)) % 10 === d[9];
}

function createSessionStore(db) {
  const insert = db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)');
  const find = db.prepare(`
    SELECT u.id, u.company_id AS companyId, u.email, u.name, u.role
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?`);
  const remove = db.prepare('DELETE FROM sessions WHERE token_hash = ?');
  const purge = db.prepare('DELETE FROM sessions WHERE expires_at <= ?');

  return {
    create(userId) {
      purge.run(Date.now());
      const token = crypto.randomBytes(32).toString('base64url');
      insert.run(sha256(token), userId, Date.now() + SESSION_TTL_MS);
      return token;
    },
    lookup(token) {
      return token ? find.get(sha256(token), Date.now()) || null : null;
    },
    destroy(token) {
      if (token) remove.run(sha256(token));
    },
  };
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    if (key) out[key] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

module.exports = {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  hashPassword,
  verifyPassword,
  validatePassword,
  isValidBusinessNumber,
  createSessionStore,
  parseCookies,
};
