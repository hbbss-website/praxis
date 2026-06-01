import { appConfig, ensurePersistedJwtSecret } from '../config';

ensurePersistedJwtSecret();

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

export const isProduction = appConfig.is_production;
export const jwtSecret = appConfig.jwt_secret;
export const jwtIssuer = appConfig.jwt_issuer;
export const tokenLifetime = appConfig.jwt_expires_in;
export const tokenLifetimeSeconds = parseDurationSeconds(appConfig.jwt_expires_in, 8 * 60 * 60);
export const loginMaxAttempts = appConfig.login_max_attempts;
export const loginLockoutMs = appConfig.login_lockout_ms;
export const trustProxy = appConfig.trust_proxy;

if (jwtSecret.length < 32) {
  const message = 'JWT_SECRET 长度至少应为 32 个字符。';

  if (isProduction) {
    throw new Error(message);
  }

  console.warn(message);
}
