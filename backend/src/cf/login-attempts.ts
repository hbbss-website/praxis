import { eq, and, isNull, lt } from 'drizzle-orm';
import type { D1DB } from './db';
import { loginAttempts } from '../db/schema';

export async function getRemainingLockoutMs(db: D1DB, lockoutMs: number, key: string) {
  const now = Date.now();
  const row = await db.select().from(loginAttempts).where(eq(loginAttempts.key, key)).get();
  if (!row || row.lockedUntil === null) return 0;
  return Math.max(0, row.lockedUntil - now);
}

export async function recordLoginFailure(db: D1DB, maxAttempts: number, lockoutMs: number, key: string) {
  const now = Date.now();
  const row = await db.select().from(loginAttempts).where(eq(loginAttempts.key, key)).get();
  const currentCount = row ? (row.lockedUntil !== null && row.lockedUntil <= now ? 0 : row.count) : 0;
  const newCount = currentCount + 1;
  const lockedUntil = newCount >= maxAttempts ? now + lockoutMs : null;
  await db.insert(loginAttempts)
    .values({ key, count: newCount, lastAttemptAt: now, lockedUntil })
    .onConflictDoUpdate({ target: loginAttempts.key, set: { count: newCount, lastAttemptAt: now, lockedUntil } })
    .run();
  return Math.max(0, lockedUntil ? lockedUntil - now : 0);
}

export async function clearLoginFailures(db: D1DB, key: string) {
  await db.delete(loginAttempts).where(eq(loginAttempts.key, key)).run();
}

export async function pruneLoginAttempts(db: D1DB, lockoutMs: number) {
  const threshold = Date.now() - lockoutMs * 2;
  await db.delete(loginAttempts).where(
    and(isNull(loginAttempts.lockedUntil), lt(loginAttempts.lastAttemptAt, threshold))
  ).run();
}
