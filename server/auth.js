/**
 * Stateless HMAC-Signed Admin Session Authentication
 * Designed for serverless (Vercel) and standalone Node environments.
 */

import crypto from 'crypto';
import { isProduction } from './config.js';

const COOKIE_NAME = 'sch_admin_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

function getSessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    if (isProduction) {
      throw new Error('SESSION_SECRET is required in production.');
    }
    return 'local-dev-fallback-session-secret-key-12345';
  }
  return secret;
}

function parseCookies(cookieHeader) {
  const list = {};
  if (!cookieHeader) return list;

  cookieHeader.split(';').forEach((cookie) => {
    const parts = cookie.split('=');
    if (parts.length >= 2) {
      list[parts[0].trim()] = decodeURIComponent(parts.slice(1).join('=').trim());
    }
  });

  return list;
}

/**
 * Creates an HMAC-SHA256 signed session cookie value.
 */
export function createSessionToken(username) {
  const secret = getSessionSecret();
  const payload = {
    u: username,
    exp: Date.now() + SESSION_TTL_MS,
  };
  const jsonStr = JSON.stringify(payload);
  const b64Payload = Buffer.from(jsonStr).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(b64Payload).digest('base64url');
  return `${b64Payload}.${signature}`;
}

/**
 * Sets the signed HTTP-only cookie on the response.
 */
export function setAdminSessionCookie(res, username) {
  const token = createSessionToken(username);
  const maxAgeSec = Math.floor(SESSION_TTL_MS / 1000);
  const secureFlag = isProduction ? '; Secure' : '';
  const cookieValue = `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secureFlag}`;
  res.setHeader('Set-Cookie', cookieValue);
}

/**
 * Clears the session cookie on logout.
 */
export function clearAdminSessionCookie(res) {
  const secureFlag = isProduction ? '; Secure' : '';
  const cookieValue = `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secureFlag}`;
  res.setHeader('Set-Cookie', cookieValue);
}

/**
 * Verifies the incoming request's session cookie.
 * Returns true if authenticated, false otherwise.
 */
export function verifyAdminSession(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[COOKIE_NAME];
  if (!token) return false;

  const parts = token.split('.');
  if (parts.length !== 2) return false;

  const [b64Payload, signature] = parts;
  const secret = getSessionSecret();

  const expectedSignature = crypto.createHmac('sha256', secret).update(b64Payload).digest('base64url');

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedSignature);

  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return false;
  }

  try {
    const raw = Buffer.from(b64Payload, 'base64url').toString('utf-8');
    const payload = JSON.parse(raw);

    if (!payload.exp || Date.now() > payload.exp) {
      return false;
    }

    req.adminUser = payload.u;
    return true;
  } catch (e) {
    return false;
  }
}
