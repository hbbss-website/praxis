import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { D1DB } from '../db';
import { tempUploadDeletions } from '../../db/schema';
import { nowIso, uploadPathPattern, tmpUploadPathPattern } from './helpers';

export function r2Key(imagePath: string) {
  return imagePath.replace(/^\//, '');
}

export function permanentR2Key() {
  const filename = `${randomUUID()}.webp`;
  return { key: `uploads/${filename}`, imagePath: `/uploads/${filename}` };
}

export async function canAccessUpload(db: D1DB, bucket: R2Bucket, imagePath: string, userId: number, role: string): Promise<boolean> {
  const key = r2Key(imagePath);
  const obj = await bucket.head(key);
  if (!obj) return false;
  const meta = obj.customMetadata ?? {};
  if (role === 'admin') return true;
  if (role === 'student') return meta['student_id'] === String(userId);
  return meta['teacher_ids'] ? meta['teacher_ids'].split(',').includes(String(userId)) : false;
}

export async function deleteR2Upload(bucket: R2Bucket, imagePath: string | null) {
  if (!imagePath) return;
  if (!uploadPathPattern.test(imagePath) && !tmpUploadPathPattern.test(imagePath)) return;
  await bucket.delete(r2Key(imagePath));
}

export async function moveToPermUpload(bucket: R2Bucket, tmpPath: string) {
  if (!tmpUploadPathPattern.test(tmpPath)) throw new Error('图片路径无效。');
  const obj = await bucket.get(r2Key(tmpPath));
  if (!obj) throw new Error('图片文件不存在或已过期。');
  const { key, imagePath } = permanentR2Key();
  const body = await obj.arrayBuffer();
  await bucket.put(key, body, { httpMetadata: { contentType: 'image/webp' }, customMetadata: obj.customMetadata });
  await bucket.delete(r2Key(tmpPath));
  return imagePath;
}

export async function enqueueTempUpload(db: D1DB, ttlMs: number, filePath: string) {
  if (!tmpUploadPathPattern.test(filePath)) throw new Error('图片路径无效。');
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  await db.insert(tempUploadDeletions).values({ filePath, expiresAt, createdAt })
    .onConflictDoUpdate({ target: tempUploadDeletions.filePath, set: { expiresAt, createdAt } }).run();
}

export async function cleanupExpiredTempUploads(db: D1DB, bucket: R2Bucket) {
  const now = nowIso();
  const items = await db.select().from(tempUploadDeletions).all();
  for (const item of items) {
    if (item.expiresAt > now) continue;
    await bucket.delete(r2Key(item.filePath));
    await db.delete(tempUploadDeletions).where(eq(tempUploadDeletions.id, item.id)).run();
  }
}
