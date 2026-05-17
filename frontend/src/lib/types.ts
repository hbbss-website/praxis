import type {
  AppNotification,
  ClassAssignments,
  ClassStudentAssignment,
  ClassSummary,
  ClassTeacherAssignment,
  CreateUserResult,
  CsvImportEntry,
  CsvImportPreview,
  NotificationType,
  PublicUser,
  RecordStatistics,
  RecordStatus,
  StudentRecord,
  StudentSummary,
  StudentWithClassSummary,
  TeacherRecord,
  TeacherRecordSummary,
  TeacherStatistics,
  UploadResult,
  UserRole,
  UserSummary
} from '../../../backend/src/models';

export const API_URL = '/api';
export const MAX_RECORD_IMAGES = 9;

export type {
  AppNotification,
  ClassAssignments,
  ClassStudentAssignment,
  ClassSummary,
  ClassTeacherAssignment,
  CsvImportEntry,
  CsvImportPreview,
  NotificationType,
  RecordStatistics,
  RecordStatus,
  StudentRecord,
  StudentSummary,
  StudentWithClassSummary,
  TeacherRecord,
  TeacherRecordSummary,
  TeacherStatistics,
  UploadResult,
  UserRole,
  UserSummary
};

export type CreatedUser = CreateUserResult;
export type StoredUser = PublicUser;

export interface AppRuntimeConfig {
  upload_image_max_size_bytes: number;
}

export interface ApiError {
  error?: string;
}
