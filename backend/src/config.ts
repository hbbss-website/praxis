import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { parse, stringify } from 'smol-toml';

export interface AppConfig {
  port: number;
  vite_port: number;
  backend_host: string;
  frontend_host: string;
  database_file: string;
  jwt_secret: string;
  jwt_issuer: string;
  jwt_expires_in: string;
  login_max_attempts: number;
  login_lockout_ms: number;
  upload_image_max_size_bytes: number;
  trust_proxy: boolean;
  is_production: boolean;
  cors_origins: string[];
}

declare global {
  var __socialPracticeConfigFile: string | undefined;
}

const configFilePath = path.resolve(globalThis.__socialPracticeConfigFile ?? 'config.toml');

function randomSecret() {
  return crypto.randomBytes(32).toString('hex');
}

function createDefaultConfig(): AppConfig {
  return {
    port: 3000,
    vite_port: 5173,
    backend_host: '127.0.0.1',
    frontend_host: '127.0.0.1',
    database_file: 'backend/data/app.db',
    jwt_secret: randomSecret(),
    jwt_issuer: 'social-practice-system',
    jwt_expires_in: '8h',
    login_max_attempts: 5,
    login_lockout_ms: 15 * 60 * 1000,
    upload_image_max_size_bytes: 5 * 1024 * 1024,
    trust_proxy: false,
    is_production: false,
    cors_origins: []
  };
}

function loadRawConfig() {
  if (!fs.existsSync(configFilePath)) {
    const defaultConfig = createDefaultConfig();
    fs.writeFileSync(configFilePath, stringify(defaultConfig));
    console.log('config.toml 不存在，已自动生成');
    return defaultConfig;
  }

  return parse(fs.readFileSync(configFilePath, 'utf8'));
}

function getString(source: Record<string, unknown>, key: keyof AppConfig, fallback: string) {
  const value = source[key];
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function getPositiveInteger(source: Record<string, unknown>, key: keyof AppConfig, fallback: number) {
  const value = source[key];
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}

function getBoolean(source: Record<string, unknown>, key: keyof AppConfig, fallback: boolean) {
  const value = source[key];
  return typeof value === 'boolean' ? value : fallback;
}

function getStringArray(source: Record<string, unknown>, key: keyof AppConfig) {
  const value = source[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean) : [];
}

function normalizeConfig(source: unknown): AppConfig {
  const fallback = createDefaultConfig();
  const config = typeof source === 'object' && source !== null ? source as Record<string, unknown> : {};

  return {
    port: getPositiveInteger(config, 'port', fallback.port),
    vite_port: getPositiveInteger(config, 'vite_port', fallback.vite_port),
    backend_host: getString(config, 'backend_host', fallback.backend_host),
    frontend_host: getString(config, 'frontend_host', fallback.frontend_host),
    database_file: getString(config, 'database_file', fallback.database_file),
    jwt_secret: getString(config, 'jwt_secret', fallback.jwt_secret),
    jwt_issuer: getString(config, 'jwt_issuer', fallback.jwt_issuer),
    jwt_expires_in: getString(config, 'jwt_expires_in', fallback.jwt_expires_in),
    login_max_attempts: getPositiveInteger(config, 'login_max_attempts', fallback.login_max_attempts),
    login_lockout_ms: getPositiveInteger(config, 'login_lockout_ms', fallback.login_lockout_ms),
    upload_image_max_size_bytes: getPositiveInteger(config, 'upload_image_max_size_bytes', fallback.upload_image_max_size_bytes),
    trust_proxy: getBoolean(config, 'trust_proxy', fallback.trust_proxy),
    is_production: getBoolean(config, 'is_production', fallback.is_production),
    cors_origins: getStringArray(config, 'cors_origins')
  };
}

export const appConfig = normalizeConfig(loadRawConfig());
export const appConfigPath = configFilePath;
