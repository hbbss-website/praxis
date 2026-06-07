import { and, desc, eq, sql } from 'drizzle-orm';
import type { D1DB } from '../db';
import type { NotificationType } from '../../models';
import { notifications } from '../../db/schema';
import { nowIso } from './helpers';

function toNotification(row: typeof notifications.$inferSelect) {
  return { id: row.id, student_id: row.studentId, type: row.type, is_read: row.isRead, message: row.message, created_at: row.createdAt };
}

export async function createNotification(db: D1DB, studentId: number, type: NotificationType, message: string) {
  const createdAt = nowIso();
  const [row] = await db.insert(notifications).values({ studentId, type, message, isRead: false, createdAt }).returning({ id: notifications.id });
  return { id: row!.id, student_id: studentId, type, message, is_read: false, created_at: createdAt };
}

export async function getNotificationsByStudent(db: D1DB, studentId: number) {
  const rows = await db.select().from(notifications)
    .where(eq(notifications.studentId, studentId)).orderBy(desc(notifications.createdAt)).all();
  return rows.map(toNotification);
}

export async function getUnreadNotificationCount(db: D1DB, studentId: number) {
  const row = await db.select({ count: sql<number>`count(*)` }).from(notifications)
    .where(and(eq(notifications.studentId, studentId), eq(notifications.isRead, false))).get();
  return typeof row?.count === 'number' ? row.count : Number(row?.count ?? 0) || 0;
}

export async function markNotificationsAsRead(db: D1DB, studentId: number) {
  await db.update(notifications).set({ isRead: true })
    .where(and(eq(notifications.studentId, studentId), eq(notifications.isRead, false))).run();
}
