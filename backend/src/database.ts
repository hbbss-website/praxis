import fs from 'node:fs';
import path from 'node:path';

import { appConfig } from './config';
import { ensureDatabaseSchema } from './db/setup';
import * as repo from './db/repository';
import { seedDefaultAdmin } from './db/repository/users';

const uploadDir = path.resolve(process.cwd(), 'backend/data/uploads');
const tmpUploadDir = path.resolve(process.cwd(), 'backend/data/tmp-uploads');

class SQLiteDatabase {
  readonly MAX_DAILY_RECORDS = appConfig.max_daily_records;

  constructor() {
    ensureDatabaseSchema();
    fs.mkdirSync(uploadDir, { recursive: true });
    fs.mkdirSync(tmpUploadDir, { recursive: true });
    seedDefaultAdmin();
  }

  isValidRole = repo.isValidRole;
  findUserById = repo.findUserById;
  findUserByUid = repo.findUserByUid;
  findTeachersByUids = repo.findTeachersByUids;
  getUsersByRole = repo.getUsersByRole;
  searchUsersByRole = repo.searchUsersByRole;
  getAllStudents = repo.getAllStudents;
  createUser = repo.createUser;
  createUsers = repo.createUsers;
  updateUserName = repo.updateUserName;
  updateUserPassword = repo.updateUserPassword;
  resetUserPasswords = repo.resetUserPasswords;
  deleteUser = repo.deleteUser;

  createClass = repo.createClass;
  findClassById = repo.findClassById;
  findClassByCid = repo.findClassByCid;
  updateClassName = repo.updateClassName;
  getClasses = repo.getClasses;
  getTeacherClasses = repo.getTeacherClasses;
  assignTeachersToClass = repo.assignTeachersToClass;
  removeTeachersFromClass = repo.removeTeachersFromClass;
  assignStudentsToClass = repo.assignStudentsToClass;
  removeStudentsFromClass = repo.removeStudentsFromClass;
  clearStudentClasses = repo.clearStudentClasses;
  setStudentsClass = repo.setStudentsClass;
  getAllClassAssignments = repo.getAllClassAssignments;
  getClassStudents = repo.getClassStudents;
  getTeacherStudents = repo.getTeacherStudents;
  searchStudents = repo.searchStudents;
  searchStudentsForClassAssignment = repo.searchStudentsForClassAssignment;
  getAssignedStudents = repo.getAssignedStudents;
  getTeacherStudentIds = repo.getTeacherStudentIds;
  getTeacherClassIds = repo.getTeacherClassIds;
  getStudentClassId = repo.getStudentClassId;
  getClassesForTask = repo.getClassesForTask;

  getClassIdsForTask = repo.getClassIdsForTask;
  getStudentTaskById = repo.getStudentTaskById;
  getManageableTaskById = repo.getManageableTaskById;
  createTask = repo.createTask;
  updateTask = repo.updateTask;
  deleteTask = repo.deleteTask;
  countTaskClassRecords = repo.countTaskClassRecords;
  removeTaskClass = repo.removeTaskClass;
  getStudentTasks = repo.getStudentTasks;
  getManageableTasks = repo.getManageableTasks;
  getTaskDetail = repo.getTaskDetail;

  createRecord = repo.createRecord;
  getRecordById = repo.getRecordById;
  canAccessUpload = repo.canAccessUpload;
  getRecordsByStudent = repo.getRecordsByStudent;
  getRecordsByStudentTask = repo.getRecordsByStudentTask;
  countStudentTaskRecords = repo.countStudentTaskRecords;
  getTeacherRecordById = repo.getTeacherRecordById;
  getAllRecords = repo.getAllRecords;
  updateRecord = repo.updateRecord;
  deleteRecord = repo.deleteRecord;
  countStudentRecordsToday = repo.countStudentRecordsToday;

  createNotification = repo.createNotification;
  getNotificationsByStudent = repo.getNotificationsByStudent;
  getUnreadNotificationCount = repo.getUnreadNotificationCount;
  markNotificationsAsRead = repo.markNotificationsAsRead;

  enqueueTempUpload = repo.enqueueTempUpload;
  cleanupExpiredTempUploads = repo.cleanupExpiredTempUploads;
  startTempUploadCleanupWorker = repo.startTempUploadCleanupWorker;

  getStudentStatistics = repo.getStudentStatistics;
  getStatistics = repo.getStatistics;
  getOverview = repo.getOverview;
}

const database = new SQLiteDatabase();
export default database;
