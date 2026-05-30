import { and, desc, eq, sql } from 'drizzle-orm';

import type { NotificationType } from '../../models';
import { db } from '../client';
import { nowIso, toNotification } from '../helpers';
import { notifications } from '../schema';

export function createNotification(studentId: number, type: NotificationType, message: string) {
  const createdAt = nowIso();
  const result = db.insert(notifications).values({
    studentId, type, message, isRead: false, createdAt
  }).run();
  return {
    id: Number(result.lastInsertRowid),
    student_id: studentId,
    type: type as string,
    message,
    is_read: false,
    created_at: createdAt
  };
}

export function getNotificationsByStudent(studentId: number) {
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.studentId, studentId))
    .orderBy(desc(notifications.createdAt))
    .all()
    .map(toNotification);
}

export function getUnreadNotificationCount(studentId: number) {
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(notifications)
    .where(and(eq(notifications.studentId, studentId), eq(notifications.isRead, false)))
    .get();
  return typeof row?.count === 'number' ? row.count : Number(row?.count ?? 0) || 0;
}

export function markNotificationsAsRead(studentId: number) {
  db.update(notifications).set({ isRead: true })
    .where(and(eq(notifications.studentId, studentId), eq(notifications.isRead, false)))
    .run();
}
