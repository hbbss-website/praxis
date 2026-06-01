import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { parse } from "smol-toml";

export interface AppConfig {
  site_name: string;
  port: number;
  vite_port: number;
  backend_host: string;
  frontend_host: string;
  jwt_secret: string;
  jwt_issuer: string;
  jwt_expires_in: string;
  login_max_attempts: number;
  login_lockout_ms: number;
  upload_image_max_size_bytes: number;
  temp_upload_ttl_ms: number;
  temp_upload_cleanup_interval_ms: number;
  timezone: string;
  trust_proxy: boolean;
  is_production: boolean;
  cors_origins: string[];
  record_max_images: number;
  max_daily_records: number;
  generated_password_length: number;
  initial_admin_password: string;
  upload_webp_quality: number;
  upload_max_image_dimension: number;
  upload_webp_effort: number;
  csv_import_max_size_bytes: number;
  user_name_max_length: number;
  title_max_length: number;
  content_max_length: number;
  comment_max_length: number;
  password_min_length: number;
  password_max_length: number;
  uid_max_length: number;
  location_max_length: number;
  max_record_duration: number;
}

declare global {
  var __praxisConfigFile: string | undefined;
}

const configFilePath = path.resolve(
  globalThis.__praxisConfigFile ?? "config.toml",
);

function randomSecret() {
  return crypto.randomBytes(32).toString("hex");
}

function askToPersistJwtSecret() {
  const buffer = Buffer.alloc(32);

  process.stdout.write(
    "jwt_secret 不存在，是否向 config.toml 写入随机的值以继续？[y/N] ",
  );

  try {
    const bytesRead = fs.readSync(0, buffer, 0, buffer.length, null);
    const answer = buffer
      .subarray(0, bytesRead)
      .toString("utf8")
      .trim()
      .toLowerCase();

    return answer === "y" || answer === "yes";
  } catch {
    console.error("\n无法读取终端输入。");
    process.exit(1);
  }
}

function writeJwtSecretToConfig(secret: string) {
  fs.mkdirSync(path.dirname(configFilePath), { recursive: true });

  if (!fs.existsSync(configFilePath)) {
    fs.writeFileSync(configFilePath, `jwt_secret = "${secret}"\n`);
    return;
  }

  const content = fs.readFileSync(configFilePath, "utf8");
  const nextContent = /^jwt_secret\s*=.*$/m.test(content)
    ? content.replace(/^jwt_secret\s*=.*$/m, `jwt_secret = "${secret}"`)
    : `${content}${content.endsWith("\n") ? "" : "\n"}jwt_secret = "${secret}"\n`;

  fs.writeFileSync(configFilePath, nextContent);
}

function ensureJwtSecret(source: Record<string, unknown>) {
  if (typeof source.jwt_secret === "string" && source.jwt_secret.trim()) {
    return;
  }

  if (!askToPersistJwtSecret()) {
    console.error("缺少 jwt_secret，程序已退出。");
    process.exit(1);
  }

  const jwtSecret = randomSecret();
  writeJwtSecretToConfig(jwtSecret);
  source.jwt_secret = jwtSecret;
  appConfig.jwt_secret = jwtSecret;
}

function createDefaultConfig(): AppConfig {
  return {
    site_name: "Praxis",
    port: 3000,
    vite_port: 5173,
    backend_host: "127.0.0.1",
    frontend_host: "127.0.0.1",
    jwt_secret: randomSecret(),
    jwt_issuer: "praxis",
    jwt_expires_in: "8h",
    login_max_attempts: 5,
    login_lockout_ms: 15 * 60 * 1000,
    upload_image_max_size_bytes: 5 * 1024 * 1024,
    temp_upload_ttl_ms: 30 * 60 * 1000,
    temp_upload_cleanup_interval_ms: 5000,
    timezone: "UTC+8",
    trust_proxy: false,
    is_production: false,
    cors_origins: [],
    record_max_images: 9,
    max_daily_records: 50,
    generated_password_length: 8,
    initial_admin_password: "12345678",
    upload_webp_quality: 76,
    upload_max_image_dimension: 1920,
    upload_webp_effort: 5,
    csv_import_max_size_bytes: 50 * 1024 * 1024,
    user_name_max_length: 40,
    title_max_length: 120,
    content_max_length: 5000,
    comment_max_length: 500,
    password_min_length: 8,
    password_max_length: 32,
    uid_max_length: 32,
    location_max_length: 120,
    max_record_duration: 24,
  };
}

function loadRawConfig() {
  if (!fs.existsSync(configFilePath)) {
    return {};
  }

  return parse(fs.readFileSync(configFilePath, "utf8"));
}

function getString(
  source: Record<string, unknown>,
  key: keyof AppConfig,
  fallback: string,
) {
  const value = source[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function getPositiveInteger(
  source: Record<string, unknown>,
  key: keyof AppConfig,
  fallback: number,
) {
  const value = source[key];
  return Number.isInteger(value) && Number(value) > 0
    ? Number(value)
    : fallback;
}

function getBoolean(
  source: Record<string, unknown>,
  key: keyof AppConfig,
  fallback: boolean,
) {
  const value = source[key];
  return typeof value === "boolean" ? value : fallback;
}

function getStringArray(source: Record<string, unknown>, key: keyof AppConfig) {
  const value = source[key];
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function normalizeConfig(source: unknown): AppConfig {
  const fallback = createDefaultConfig();
  const config =
    typeof source === "object" && source !== null
      ? (source as Record<string, unknown>)
      : {};

  return {
    port: getPositiveInteger(config, "port", fallback.port),
    site_name: getString(config, "site_name", fallback.site_name),
    vite_port: getPositiveInteger(config, "vite_port", fallback.vite_port),
    backend_host: getString(config, "backend_host", fallback.backend_host),
    frontend_host: getString(config, "frontend_host", fallback.frontend_host),
    jwt_secret: getString(config, "jwt_secret", fallback.jwt_secret),
    jwt_issuer: getString(config, "jwt_issuer", fallback.jwt_issuer),
    jwt_expires_in: getString(
      config,
      "jwt_expires_in",
      fallback.jwt_expires_in,
    ),
    login_max_attempts: getPositiveInteger(
      config,
      "login_max_attempts",
      fallback.login_max_attempts,
    ),
    login_lockout_ms: getPositiveInteger(
      config,
      "login_lockout_ms",
      fallback.login_lockout_ms,
    ),
    upload_image_max_size_bytes: getPositiveInteger(
      config,
      "upload_image_max_size_bytes",
      fallback.upload_image_max_size_bytes,
    ),
    temp_upload_ttl_ms: getPositiveInteger(
      config,
      "temp_upload_ttl_ms",
      fallback.temp_upload_ttl_ms,
    ),
    temp_upload_cleanup_interval_ms: getPositiveInteger(
      config,
      "temp_upload_cleanup_interval_ms",
      fallback.temp_upload_cleanup_interval_ms,
    ),
    timezone: getString(config, "timezone", fallback.timezone),
    trust_proxy: getBoolean(config, "trust_proxy", fallback.trust_proxy),
    is_production: getBoolean(config, "is_production", fallback.is_production),
    cors_origins: getStringArray(config, "cors_origins"),
    record_max_images: getPositiveInteger(
      config,
      "record_max_images",
      fallback.record_max_images,
    ),
    max_daily_records: getPositiveInteger(
      config,
      "max_daily_records",
      fallback.max_daily_records,
    ),
    generated_password_length: getPositiveInteger(
      config,
      "generated_password_length",
      fallback.generated_password_length,
    ),
    initial_admin_password: getString(
      config,
      "initial_admin_password",
      fallback.initial_admin_password,
    ),
    upload_webp_quality: getPositiveInteger(
      config,
      "upload_webp_quality",
      fallback.upload_webp_quality,
    ),
    upload_max_image_dimension: getPositiveInteger(
      config,
      "upload_max_image_dimension",
      fallback.upload_max_image_dimension,
    ),
    upload_webp_effort: getPositiveInteger(
      config,
      "upload_webp_effort",
      fallback.upload_webp_effort,
    ),
    csv_import_max_size_bytes: getPositiveInteger(
      config,
      "csv_import_max_size_bytes",
      fallback.csv_import_max_size_bytes,
    ),
    user_name_max_length: getPositiveInteger(
      config,
      "user_name_max_length",
      fallback.user_name_max_length,
    ),
    title_max_length: getPositiveInteger(
      config,
      "title_max_length",
      fallback.title_max_length,
    ),
    content_max_length: getPositiveInteger(
      config,
      "content_max_length",
      fallback.content_max_length,
    ),
    comment_max_length: getPositiveInteger(
      config,
      "comment_max_length",
      fallback.comment_max_length,
    ),
    password_min_length: getPositiveInteger(
      config,
      "password_min_length",
      fallback.password_min_length,
    ),
    password_max_length: getPositiveInteger(
      config,
      "password_max_length",
      fallback.password_max_length,
    ),
    uid_max_length: getPositiveInteger(
      config,
      "uid_max_length",
      fallback.uid_max_length,
    ),
    location_max_length: getPositiveInteger(
      config,
      "location_max_length",
      fallback.location_max_length,
    ),
    max_record_duration: getPositiveInteger(
      config,
      "max_record_duration",
      fallback.max_record_duration,
    ),
  };
}

const rawConfig = loadRawConfig();

export const appConfig = normalizeConfig(rawConfig);
export const appConfigPath = configFilePath;

export function ensurePersistedJwtSecret() {
  ensureJwtSecret(
    typeof rawConfig === "object" && rawConfig !== null
      ? (rawConfig as Record<string, unknown>)
      : {},
  );
}
