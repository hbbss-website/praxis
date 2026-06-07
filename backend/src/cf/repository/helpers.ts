import { randomUUID } from 'node:crypto';
import type { CFConfig } from '../config';

export const uploadPathPattern = /^\/uploads\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
export const tmpUploadPathPattern = /^\/tmp-uploads\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function nowIso() {
  return new Date().toISOString();
}

export function generatePlainPassword(length: number) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

export function r2UploadKey(imagePath: string) {
  return imagePath.replace(/^\//, '');
}

export function permanentKeyFromTmp(tmpPath: string) {
  const filename = `${randomUUID()}.webp`;
  return { key: `uploads/${filename}`, imagePath: `/uploads/${filename}` };
}

export function parseImagePaths(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string' && uploadPathPattern.test(item))
      : [];
  } catch { return []; }
}

export function parseRecordImagePaths(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string' && tmpUploadPathPattern.test(item))
      : [];
  } catch { return []; }
}

export function normalizeRecordImagePaths(value: string | null, maxImages: number) {
  return [...new Set(parseImagePaths(value))].slice(0, maxImages);
}

export function normalizeIncomingRecordImagePaths(value: string | null, maxImages: number) {
  return [...new Set(parseRecordImagePaths(value))].slice(0, maxImages);
}

export function serializeImagePaths(paths: string[], maxImages: number) {
  return JSON.stringify([...new Set(paths)].slice(0, maxImages));
}

export function toFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number(value ?? 0) || 0;
}
