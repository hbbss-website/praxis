import { createD1DB } from './db';
import { getCFConfig } from './config';
import type { Env } from './env';
import * as repo from './repository/index';
import { seedDefaultAdmin } from './repository/users';

export class CFDatabase {
  readonly MAX_DAILY_RECORDS: number;
  private db: ReturnType<typeof createD1DB>;
  private bucket: R2Bucket;
  private cfg: ReturnType<typeof getCFConfig>;

  constructor(env: Env) {
    this.db = createD1DB(env.DB);
    this.bucket = env.UPLOADS;
    this.cfg = getCFConfig(env);
    this.MAX_DAILY_RECORDS = this.cfg.max_daily_records;
  }

  async init() {
    await seedDefaultAdmin(this.db, this.cfg);
  }

  isValidRole = repo.isValidRole;
  findUserById = (id: number) => repo.findUserById(this.db, id);
  findUserByUid = (uid: number) => repo.findUserByUid(this.db, uid);
  findStudentByUid = (uid: number) => repo.findStudentByUid(this.db, uid);
  findStudentsByClassAndName = (classId: number, name: string) => repo.findStudentsByClassAndName(this.db, classId, name);
  findStaffByIdentifier = (identifier: string) => repo.findStaffByIdentifier(this.db, identifier);
  findTeachersByUids = (uids: number[]) => repo.findTeachersByUids(this.db, uids);
  getUsersByRole = (role?: any) => repo.getUsersByRole(this.db, role);
  searchUsersByRole = (role: any, query: string) => repo.searchUsersByRole(this.db, role, query);
  getAllStudents = () => repo.getAllStudents(this.db);
  createUser = (name: string, role: any, englishName?: string | null) => repo.createUser(this.db, this.cfg, name, role, englishName);
  createUsers = (entries: any[]) => repo.createUsers(this.db, this.cfg, entries);
  updateUserName = (id: number, name: string, englishName?: string | null) => repo.updateUserName(this.db, id, name, englishName);
  updateUserPassword = (id: number, hashedPassword: string) => repo.updateUserPassword(this.db, id, hashedPassword);
  resetUserPasswords = (ids: number[]) => repo.resetUserPasswords(this.db, this.cfg, ids);
  deleteUser = (id: number) => repo.deleteUser(this.db, id);

  createClass = (name: string) => repo.createClass(this.db, name);
  findClassById = (id: number) => repo.findClassById(this.db, id);
  findClassByName = (name: string) => repo.findClassByName(this.db, name);
  updateClassName = (id: number, name: string) => repo.updateClassName(this.db, id, name);
  getClasses = () => repo.getClasses(this.db);
  searchClasses = (query: string) => repo.searchClasses(this.db, query);
  getTeacherClasses = (teacherId: number) => repo.getTeacherClasses(this.db, teacherId);
  assignTeachersToClass = (classId: number, ids: number[]) => repo.assignTeachersToClass(this.db, classId, ids);
  removeTeachersFromClass = (classId: number, ids: number[]) => repo.removeTeachersFromClass(this.db, classId, ids);
  assignStudentsToClass = (classId: number, ids: number[]) => repo.assignStudentsToClass(this.db, classId, ids);
  removeStudentsFromClass = (classId: number, ids: number[]) => repo.removeStudentsFromClass(this.db, classId, ids);
  clearStudentClasses = (ids: number[]) => repo.clearStudentClasses(this.db, ids);
  setStudentsClass = (ids: number[], classId: number | null) => repo.setStudentsClass(this.db, ids, classId);
  getAllClassAssignments = () => repo.getAllClassAssignments(this.db);
  getClassStudents = (classId: number) => repo.getClassStudents(this.db, classId);
  getTeacherStudents = (teacherId: number) => repo.getTeacherStudents(this.db, teacherId);
  searchStudents = (query: string, visibleStudentIds?: Set<number>, classIds?: number[]) => repo.searchStudents(this.db, query, visibleStudentIds, classIds);
  searchStudentsForClassAssignment = (query: string, classId: number | null) => repo.searchStudentsForClassAssignment(this.db, query, classId);
  getAssignedStudents = () => repo.getAssignedStudents(this.db);
  getTeacherStudentIds = (teacherId: number) => repo.getTeacherStudentIds(this.db, teacherId);
  getTeacherClassIds = (teacherId: number) => repo.getTeacherClassIds(this.db, teacherId);
  getStudentClassId = (studentId: number) => repo.getStudentClassId(this.db, studentId);
  getClassesForTask = (taskId: number) => repo.getClassesForTask(this.db, taskId);

  getClassIdsForTask = (taskId: number) => repo.getClassIdsForTask(this.db, taskId);
  getStudentTaskById = (taskId: number, studentId: number) => repo.getStudentTaskById(this.db, taskId, studentId);
  getManageableTaskById = (taskId: number, visibleClassIds?: Set<number>) => repo.getManageableTaskById(this.db, taskId, visibleClassIds);
  createTask = (input: any) => repo.createTask(this.db, input);
  updateTask = (taskId: number, input: any) => repo.updateTask(this.db, taskId, input);
  deleteTask = (taskId: number) => repo.deleteTask(this.db, this.bucket, taskId);
  countTaskClassRecords = (taskId: number, classId: number) => repo.countTaskClassRecords(this.db, taskId, classId);
  removeTaskClass = (taskId: number, classId: number) => repo.removeTaskClass(this.db, this.bucket, taskId, classId);
  getStudentTasks = (studentId: number) => repo.getStudentTasks(this.db, studentId);
  getManageableTasks = (visibleClassIds?: Set<number>) => repo.getManageableTasks(this.db, visibleClassIds);
  getTaskDetail = (taskId: number, studentId?: number) => repo.getTaskDetail(this.db, taskId, studentId);

  createRecord = (input: any) => repo.createRecord(this.db, this.bucket, input);
  getRecordById = (id: number) => repo.getRecordById(this.db, id);
  canAccessUpload = (imagePath: string, userId: number, role: string) => repo.canAccessUpload(this.db, imagePath, userId, role);
  getRecordsByStudent = (studentId: number) => repo.getRecordsByStudent(this.db, studentId);
  getRecordsByStudentTask = (studentId: number, taskId: number) => repo.getRecordsByStudentTask(this.db, studentId, taskId);
  countStudentTaskRecords = (studentId: number, taskId: number) => repo.countStudentTaskRecords(this.db, studentId, taskId);
  getTeacherRecordById = (id: number, visibleStudentIds?: Set<number>) => repo.getTeacherRecordById(this.db, id, visibleStudentIds);
  getAllRecords = (filters?: any, visibleStudentIds?: Set<number>, sort?: any) => repo.getAllRecords(this.db, filters, visibleStudentIds, sort);
  getRecordsForExport = (filters?: any, visibleStudentIds?: Set<number>) => repo.getRecordsForExport(this.db, filters, visibleStudentIds);
  updateRecord = (id: number, updates: any) => repo.updateRecord(this.db, this.bucket, id, updates);
  deleteRecord = (id: number, imagePaths?: string[]) => repo.deleteRecord(this.db, this.bucket, id, imagePaths);
  countStudentRecordsToday = (studentId: number) => repo.countStudentRecordsToday(this.db, studentId);

  createNotification = (studentId: number, type: any, message: string) => repo.createNotification(this.db, studentId, type, message);
  getNotificationsByStudent = (studentId: number) => repo.getNotificationsByStudent(this.db, studentId);
  getUnreadNotificationCount = (studentId: number) => repo.getUnreadNotificationCount(this.db, studentId);
  markNotificationsAsRead = (studentId: number) => repo.markNotificationsAsRead(this.db, studentId);

  enqueueTempUpload = (filePath: string) => repo.enqueueTempUpload(this.db, this.cfg.temp_upload_ttl_ms, filePath);
  cleanupExpiredTempUploads = () => repo.cleanupExpiredTempUploads(this.db, this.bucket);

  getStudentStatistics = (studentId: number) => repo.getStudentStatistics(this.db, studentId);
  getStatistics = (visibleStudentIds?: Set<number>) => repo.getStatistics(this.db, visibleStudentIds);
  getOverview = (visibleClassIds?: Set<number>, selectedClassId?: number | null) => repo.getOverview(this.db, this.cfg, visibleClassIds, selectedClassId);

  // Upload helper
  putTempUpload = async (key: string, data: ArrayBuffer, contentType: string) => {
    await this.bucket.put(key, data, { httpMetadata: { contentType } });
  };

  getTempUploadUrl = (key: string) => `/uploads/${key.replace(/^uploads\//, '').replace(/^tmp-uploads\//, '')}`;
}
