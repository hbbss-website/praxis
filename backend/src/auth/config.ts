const DEFAULT_JWT_SECRET = 'development-only-jwt-secret-change-me';
const DEFAULT_JWT_AUDIENCE = 'social-practice-users';
const DEFAULT_JWT_ISSUER = 'social-practice-system';

function parsePositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === 'true') {
    return true;
  }

  if (normalized === 'false') {
    return false;
  }

  return fallback;
}

function parseDurationSeconds(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }

  const match = value.trim().match(/^(\d+)(s|m|h|d)?$/i);

  if (!match) {
    return fallback;
  }

  const amount = Number(match[1]);
  const unit = (match[2] ?? 's').toLowerCase();

  if (!Number.isFinite(amount) || amount <= 0) {
    return fallback;
  }

  if (unit === 'm') {
    return amount * 60;
  }

  if (unit === 'h') {
    return amount * 60 * 60;
  }

  if (unit === 'd') {
    return amount * 60 * 60 * 24;
  }

  return amount;
}

export const isProduction = process.env.NODE_ENV === 'production';
export const jwtSecret = process.env.JWT_SECRET ?? DEFAULT_JWT_SECRET;
export const jwtAudience = process.env.JWT_AUDIENCE ?? DEFAULT_JWT_AUDIENCE;
export const jwtIssuer = process.env.JWT_ISSUER ?? DEFAULT_JWT_ISSUER;
export const tokenLifetime = process.env.JWT_EXPIRES_IN ?? '8h';
export const tokenLifetimeSeconds = parseDurationSeconds(process.env.JWT_EXPIRES_IN, 8 * 60 * 60);
export const loginMaxAttempts = parsePositiveInteger(process.env.LOGIN_MAX_ATTEMPTS, 5);
export const loginLockoutMs = parsePositiveInteger(process.env.LOGIN_LOCKOUT_MS, 15 * 60 * 1000);
export const trustProxy = parseBoolean(process.env.TRUST_PROXY, false);

if (!process.env.JWT_SECRET) {
  const message = '未设置 JWT_SECRET，当前使用开发环境回退密钥。部署前请务必配置 JWT_SECRET。';

  if (isProduction) {
    throw new Error(message);
  }

  console.warn(message);
}

if (jwtSecret.length < 32) {
  const message = 'JWT_SECRET 长度至少应为 32 个字符。';

  if (isProduction) {
    throw new Error(message);
  }

  console.warn(message);
}
