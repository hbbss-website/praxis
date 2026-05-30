import { eq, lt, isNull, and, sql } from 'drizzle-orm';

import { loginLockoutMs, loginMaxAttempts } from './config';
import { db } from '../db/client';
import { loginAttempts } from '../db/schema';

export function getRemainingLockoutMs(key: string, now = Date.now()) {
  prune(now);
  const row = db.select().from(loginAttempts).where(eq(loginAttempts.key, key)).get();
  if (!row || row.lockedUntil === null) return 0;
  return Math.max(0, row.lockedUntil - now);
}

export function recordLoginFailure(key: string, now = Date.now()) {
  prune(now);
  const row = db.select().from(loginAttempts).where(eq(loginAttempts.key, key)).get();
  const currentCount = row ? (row.lockedUntil !== null && row.lockedUntil <= now ? 0 : row.count) : 0;
  const newCount = currentCount + 1;
  const lockedUntil = newCount >= loginMaxAttempts ? now + loginLockoutMs : null;
  db.insert(loginAttempts)
    .values({ key, count: newCount, lastAttemptAt: now, lockedUntil })
    .onConflictDoUpdate({
      target: loginAttempts.key,
      set: { count: newCount, lastAttemptAt: now, lockedUntil }
    })
    .run();
  return getRemainingLockoutMs(key, now);
}

export function clearLoginFailures(key: string) {
  db.delete(loginAttempts).where(eq(loginAttempts.key, key)).run();
  prune(Date.now());
}

function prune(now = Date.now()) {
  const threshold = now - loginLockoutMs * 2;
  db.delete(loginAttempts).where(
    and(
      isNull(loginAttempts.lockedUntil),
      lt(loginAttempts.lastAttemptAt, threshold)
    )
  ).run();
}
