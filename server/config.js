/**
 * Server Configuration & Security Validation Module
 * Sithumini Cinnamon Hub
 */

export const isProduction = process.env.NODE_ENV === 'production';
export const isTest = process.env.NODE_ENV === 'test';

export function safeMaskPhone(phone) {
  if (!phone || typeof phone !== 'string') return '[REDACTED]';
  const clean = phone.replace(/[^\d+]/g, '');
  if (clean.length <= 6) return '****';
  return `${clean.slice(0, 4)}****${clean.slice(-3)}`;
}

export function safeMaskSecret(secret) {
  if (!secret || typeof secret !== 'string') return '[UNSET]';
  if (secret.length <= 8) return '********';
  return `${secret.slice(0, 4)}...${secret.slice(-4)}`;
}

export function validateServerConfig() {
  const isProd = process.env.NODE_ENV === 'production';
  const isTesting = process.env.NODE_ENV === 'test';

  const missing = [];
  const insecure = [];

  const adminUser = process.env.ADMIN_USERNAME;
  const adminPass = process.env.ADMIN_PASSWORD;
  const sessionSecret = process.env.SESSION_SECRET;
  const whatsappAppSecret = process.env.WHATSAPP_APP_SECRET;
  const whatsappVerifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
  const whatsappAccessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const whatsappPhoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (isProd) {
    if (!adminUser) missing.push('ADMIN_USERNAME');
    if (!adminPass) missing.push('ADMIN_PASSWORD');
    if (!sessionSecret) missing.push('SESSION_SECRET');
    if (!whatsappAppSecret) missing.push('WHATSAPP_APP_SECRET');
    if (!whatsappVerifyToken) missing.push('WHATSAPP_VERIFY_TOKEN');
    if (!whatsappAccessToken) missing.push('WHATSAPP_ACCESS_TOKEN');
    if (!whatsappPhoneNumberId) missing.push('WHATSAPP_PHONE_NUMBER_ID');

    if (adminPass === 'admin20040520' || adminPass === 'admin') {
      insecure.push('ADMIN_PASSWORD cannot use default insecure password in production.');
    }
    if (sessionSecret === 'dev-session-secret' || (sessionSecret && sessionSecret.length < 16)) {
      insecure.push('SESSION_SECRET must be a secure random secret of at least 16 characters in production.');
    }

    if (missing.length > 0 || insecure.length > 0) {
      const errMsg = [
        '==================================================================',
        '[CRITICAL SECURITY BLOCKER] Server startup aborted in production:',
        ...missing.map(m => `  - Missing required environment variable: ${m}`),
        ...insecure.map(i => `  - Insecure configuration: ${i}`),
        '=================================================================='
      ].join('\n');
      console.error(errMsg);
      throw new Error(errMsg);
    }
  } else if (!isTesting) {
    if (!adminUser || !adminPass) {
      console.warn('[Security Warning] ADMIN_USERNAME or ADMIN_PASSWORD not configured. Admin login will be disabled until set.');
    }
    if (!sessionSecret) {
      console.warn('[Security Warning] SESSION_SECRET not configured. Please set a secure random string in .env.local.');
    }
    if (!whatsappAppSecret) {
      console.warn('[WhatsApp Warning] WHATSAPP_APP_SECRET not configured. Webhooks will fail closed unless ALLOW_INSECURE_WEBHOOK_BYPASS=true is set for dev.');
    }
    if (!whatsappAccessToken || !whatsappPhoneNumberId) {
      console.info('[WhatsApp Info] Meta Cloud API credentials not configured. Outgoing messages will run in local simulation mode.');
    }
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.info('[Database Info] SUPABASE_URL not configured. Operating with local catalog file fallback.');
    }
  }

  return {
    isProduction: isProd,
    isTest: isTesting,
    adminUser,
    adminPass,
    sessionSecret: sessionSecret || (isProd ? null : 'local-dev-transient-secret-key-12345'),
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    whatsappAccessToken,
    whatsappPhoneNumberId,
    whatsappVerifyToken,
    whatsappAppSecret,
    ownerPhoneNumber: process.env.OWNER_PHONE_NUMBER,
  };
}
