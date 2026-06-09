import type { Env } from './env';

function int(value: string | undefined, fallback: number) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function bool(value: string | undefined, fallback: boolean) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

function str(value: string | undefined, fallback: string) {
  return value?.trim() || fallback;
}

export function getCFConfig(env: Env) {
  return {
    site_name: str(env.SITE_NAME, 'Praxis'),
    icp_beian: str(env.ICP_BEIAN, ''),
    jwt_secret: str(env.JWT_SECRET, ''),
    jwt_issuer: str(env.JWT_ISSUER, 'praxis'),
    jwt_expires_in: str(env.JWT_EXPIRES_IN, '8h'),
    is_production: bool(env.IS_PRODUCTION, true),
    login_max_attempts: int(env.LOGIN_MAX_ATTEMPTS, 5),
    login_lockout_ms: int(env.LOGIN_LOCKOUT_MS, 900_000),
    upload_image_max_size_bytes: int(env.UPLOAD_IMAGE_MAX_SIZE_BYTES, 5 * 1024 * 1024),
    temp_upload_ttl_ms: int(env.TEMP_UPLOAD_TTL_MS, 30 * 60 * 1000),
    record_max_images: int(env.RECORD_MAX_IMAGES, 9),
    max_daily_records: int(env.MAX_DAILY_RECORDS, 50),
    overview_class_ranking_limit: int(env.OVERVIEW_CLASS_RANKING_LIMIT, 30),
    overview_student_ranking_limit: int(env.OVERVIEW_STUDENT_RANKING_LIMIT, 30),
    generated_password_length: int(env.GENERATED_PASSWORD_LENGTH, 8),
        initial_admin_password: str(env.INITIAL_ADMIN_PASSWORD, 'admin'),
    csv_import_max_size_bytes: int(env.CSV_IMPORT_MAX_SIZE_BYTES, 50 * 1024 * 1024),
    user_name_max_length: int(env.USER_NAME_MAX_LENGTH, 40),
    title_max_length: int(env.TITLE_MAX_LENGTH, 120),
    content_max_length: int(env.CONTENT_MAX_LENGTH, 5000),
    comment_max_length: int(env.COMMENT_MAX_LENGTH, 500),
    location_max_length: int(env.LOCATION_MAX_LENGTH, 120),
    max_record_duration: int(env.MAX_RECORD_DURATION, 24),
  };
}

export type CFConfig = ReturnType<typeof getCFConfig>;

export function parseDurationSeconds(value: string, fallback: number) {
  const match = value.trim().match(/^(\d+)(s|m|h|d)?$/i);
  if (!match) return fallback;
  const amount = Number(match[1]);
  const unit = (match[2] ?? 's').toLowerCase();
  if (!Number.isFinite(amount) || amount <= 0) return fallback;
  if (unit === 'm') return amount * 60;
  if (unit === 'h') return amount * 60 * 60;
  if (unit === 'd') return amount * 60 * 60 * 24;
  return amount;
}
