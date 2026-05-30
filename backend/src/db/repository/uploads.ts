import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { eq } from 'drizzle-orm';

import { appConfig } from '../../config';
import { db } from '../client';
import { nowIso, tmpUploadPathPattern, uploadPathPattern } from '../helpers';
import { tempUploadDeletions } from '../schema';

const uploadDir = path.resolve(process.cwd(), 'backend/data/uploads');
const tmpUploadDir = path.resolve(process.cwd(), 'backend/data/tmp-uploads');

export function resolveUploadFilePath(imagePath: string) {
  if (!uploadPathPattern.test(imagePath)) return null;
  const filePath = path.join(uploadDir, path.basename(imagePath));
  return filePath.startsWith(uploadDir) ? filePath : null;
}

export function resolveTmpUploadFilePath(imagePath: string) {
  if (!tmpUploadPathPattern.test(imagePath)) return null;
  const filePath = path.join(tmpUploadDir, path.basename(imagePath));
  return filePath.startsWith(tmpUploadDir) ? filePath : null;
}

export function createUploadPathFromSource(sourcePath: string) {
  const filename = `${crypto.randomUUID()}${path.extname(sourcePath) || '.webp'}`;
  const targetPath = path.join(uploadDir, filename);
  if (!targetPath.startsWith(uploadDir)) throw new Error('图片路径无效。');
  return { filePath: targetPath, imagePath: `/uploads/${filename}` };
}

export function removeUploadFile(imagePath: string | null) {
  if (!imagePath) return;
  const filePath = resolveUploadFilePath(imagePath);
  if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

export function enqueueTempUpload(filePath: string) {
  if (!tmpUploadPathPattern.test(filePath)) throw new Error('图片路径无效。');
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + appConfig.temp_upload_ttl_ms).toISOString();
  db.insert(tempUploadDeletions)
    .values({ filePath, expiresAt, createdAt })
    .onConflictDoUpdate({ target: tempUploadDeletions.filePath, set: { expiresAt, createdAt } })
    .run();
}

export function cleanupExpiredTempUploads() {
  const now = nowIso();
  while (true) {
    const item = db
      .select().from(tempUploadDeletions)
      .orderBy(tempUploadDeletions.id).limit(1).get();
    if (!item || item.expiresAt > now) return;
    const filePath = resolveTmpUploadFilePath(item.filePath);
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    db.delete(tempUploadDeletions).where(eq(tempUploadDeletions.id, item.id)).run();
  }
}

export function startTempUploadCleanupWorker() {
  cleanupExpiredTempUploads();
  const timer = setInterval(() => cleanupExpiredTempUploads(), appConfig.temp_upload_cleanup_interval_ms);
  timer.unref?.();
  return timer;
}
