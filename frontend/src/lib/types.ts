import type {
  AppNotification,
  ClassAssignments,
  ClassStudentAssignment,
  ClassSummary,
  ClassOverview,
  ClassTeacherAssignment,
  CreateUserResult,
  CsvImportEntry,
  CsvImportPreview,
  NotificationType,
  OverviewData,
  OverviewTrendPoint,
  PracticeTask,
  PracticeTaskDetail,
  PracticeTaskSummary,
  PublicUser,
  RecordStatistics,
  RecordStatus,
  StudentOverview,
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
  ClassOverview,
  ClassTeacherAssignment,
  CsvImportEntry,
  CsvImportPreview,
  NotificationType,
  OverviewData,
  OverviewTrendPoint,
  PracticeTask,
  PracticeTaskDetail,
  PracticeTaskSummary,
  RecordStatistics,
  RecordStatus,
  StudentOverview,
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

export interface CreatedUsersPayload {
  message: string;
  users: CreatedUser[];
  credentialsCsv: string;
}

export interface CreatedUserPayload {
  message: string;
  user: CreatedUser;
  credentialsCsv: string;
}

export interface AppRuntimeConfig {
  site_name: string;
  upload_image_max_size_bytes: number;
  timezone: string;
  password_min_length: number;
  password_max_length: number;
}

export interface ApiError {
  error?: string;
}
