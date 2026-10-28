/**
 * Cloudflare Worker Authentication & Session Management
 * Uses standard Web Crypto API (SubtleCrypto)
 * Provides salted PBKDF2-SHA256 password hashing and stateless signed HTTP-only cookies
 */

const SESSION_COOKIE_NAME = 'sithumini_admin_session';
const SESSION_MAX_AGE_SEC = 86400; // 24 hours
const DEFAULT_PBKDF2_ITERATIONS = 100000;
const HASH_ALGORITHM_IDENTIFIER = 'pbkdf2_sha256';

/**
 * Constant-time string comparison
 */
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Converts ArrayBuffer or Uint8Array to hexadecimal string
 */
export function bufferToHex(buffer) {
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Converts hexadecimal string to Uint8Array safely
 */
export function hexToBytes(hex) {
  if (typeof hex !== 'string' || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
    return null;
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Computes salted PBKDF2-SHA256 password hash using Web Crypto API.
 * Format: pbkdf2_sha256$iterations$saltHex$derivedHashHex
 */
export async function hashPassword(password, { saltHex = null, iterations = DEFAULT_PBKDF2_ITERATIONS } = {}) {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('Password must be a non-empty string.');
  }

  const iterCount = parseInt(iterations, 10);
  if (isNaN(iterCount) || iterCount < 10000) {
    throw new Error('Iteration count must be at least 10,000.');
  }

  let saltBytes;
  if (saltHex) {
    saltBytes = hexToBytes(saltHex);
    if (!saltBytes || saltBytes.length < 16) {
      throw new Error('Provided saltHex must be valid hex representing at least 16 bytes.');
    }
  } else {
    saltBytes = crypto.getRandomValues(new Uint8Array(16));
    saltHex = bufferToHex(saltBytes);
  }

  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: iterCount,
      hash: 'SHA-256',
    },
    keyMaterial,
    256 // 256 bits = 32 bytes
  );

  const hashHex = bufferToHex(derivedBits);
  return `${HASH_ALGORITHM_IDENTIFIER}$${iterCount}$${saltHex}$${hashHex}`;
}

/**
 * Verifies password against versioned salted hash format:
 * pbkdf2_sha256$iterations$saltHex$derivedHashHex
 */
export async function verifyPassword(password, storedHash) {
  if (typeof password !== 'string' || typeof storedHash !== 'string') {
    return false;
  }

  const parts = storedHash.split('$');
  if (parts.length !== 4) {
    return false;
  }

  const [algorithm, iterStr, saltHex, expectedHashHex] = parts;
  if (algorithm !== HASH_ALGORITHM_IDENTIFIER) {
    return false;
  }

  const iterations = parseInt(iterStr, 10);
  if (isNaN(iterations) || iterations < 10000 || iterations > 1000000) {
    return false;
  }

  const saltBytes = hexToBytes(saltHex);
  if (!saltBytes || saltBytes.length < 16) {
    return false;
  }

  if (!expectedHashHex || expectedHashHex.length !== 64 || !/^[0-9a-fA-F]+$/.test(expectedHashHex)) {
    return false;
  }

  try {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );

    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: saltBytes,
        iterations: iterations,
        hash: 'SHA-256',
      },
      keyMaterial,
      256
    );

    const computedHashHex = bufferToHex(derivedBits);
    return timingSafeEqual(computedHashHex.toLowerCase(), expectedHashHex.toLowerCase());
  } catch (err) {
    console.error('[Worker Auth] Password verification error:', err);
    return false;
  }
}

/**
 * Verifies admin credentials against environment configuration
 */
export async function verifyAdminCredentials(username, password, env) {
  if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
    return false;
  }

  const expectedUser = env.ADMIN_USERNAME;
  if (!expectedUser || !timingSafeEqual(username, expectedUser)) {
    return false;
  }

  const isProd = env.NODE_ENV === 'production';
  const expectedHash = env.ADMIN_PASSWORD_HASH;
  const expectedPlain = env.ADMIN_PASSWORD;

  if (expectedHash) {
    return await verifyPassword(password, expectedHash);
  }

  // In production, hashed password is required - fail closed
  if (isProd) {
    console.error('[Worker Auth] ADMIN_PASSWORD_HASH is required in production.');
    return false;
  }

  // Plaintext password comparison only for local development if explicitly configured
  if (expectedPlain) {
    return timingSafeEqual(password, expectedPlain);
  }

  return false;
}

/**
 * Generates HMAC-SHA256 signature for session payload
 */
async function signPayload(payload, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return bufferToHex(signatureBuffer);
}

/**
 * Creates signed session token: username.timestamp.signature
 */
export async function createSessionToken(username, secret) {
  if (!secret) throw new Error('SESSION_SECRET required to create session token');
  const timestamp = Date.now().toString();
  const payload = `${username}:${timestamp}`;
  const signature = await signPayload(payload, secret);
  return `${username}.${timestamp}.${signature}`;
}

/**
 * Verifies signed session token
 */
export async function verifySessionToken(token, secret) {
  if (!token || typeof token !== 'string' || !secret) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [username, timestampStr, providedSig] = parts;
  const timestamp = parseInt(timestampStr, 10);
  if (isNaN(timestamp)) return null;

  const now = Date.now();
  // Reject future timestamps or expired tokens (older than 24h)
  if (timestamp > now + 60000 || (now - timestamp) > (SESSION_MAX_AGE_SEC * 1000)) {
    return null;
  }

  const payload = `${username}:${timestampStr}`;
  const expectedSig = await signPayload(payload, secret);

  if (!timingSafeEqual(providedSig, expectedSig)) {
    return null;
  }

  return username;
}

/**
 * Parses cookies from Cookie request header
 */
export function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;

  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx > -1) {
      const key = pair.slice(0, idx).trim();
      const val = pair.slice(idx + 1).trim();
      cookies[key] = decodeURIComponent(val);
    }
  }
  return cookies;
}

/**
 * Retrieves authenticated admin username from request or null
 */
export async function getAdminFromRequest(request, env) {
  const secret = env.SESSION_SECRET;
  if (!secret) return null;

  const cookieHeader = request.headers.get('Cookie') || request.headers.get('cookie');
  const cookies = parseCookies(cookieHeader);
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) return null;

  return await verifySessionToken(token, secret);
}

/**
 * Builds Set-Cookie string for issuing admin session
 */
export function buildSessionCookie(token, isProduction = false) {
  const secureFlag = isProduction ? '; Secure' : '';
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE_SEC}${secureFlag}`;
}

/**
 * Builds Set-Cookie string for clearing admin session
 */
export function buildClearSessionCookie(isProduction = false) {
  const secureFlag = isProduction ? '; Secure' : '';
  return `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secureFlag}`;
}
