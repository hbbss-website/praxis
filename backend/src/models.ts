export const userRoles = ['admin', 'teacher', 'student'] as const;
export const recordStatuses = ['approved', 'pending', 'rejected'] as const;
export const notificationTypes = ['approved', 'rejected', 'deleted', 'other'] as const;

export type UserRole = typeof userRoles[number];
export type RecordStatus = typeof recordStatuses[number];
export type NotificationType = typeof notificationTypes[number];

export interface AppNotification {
  id: number;
  student_id: number;
  type: NotificationType;
  message: string;
  is_read: boolean;
  created_at: string;
}

export interface User {
  id: number;
  uid: string;
  password: string;
  role: UserRole;
  name: string;
  created_at: string;
}

export interface PublicUser {
  id: number;
  uid: string;
  role: UserRole;
  name: string;
  password_setup_required: boolean;
}

export interface AuthTokenPayload extends PublicUser {
  exp?: number;
  iat?: number;
  iss?: string;
  aud?: string | string[];
}

export interface StudentSummary {
  id: number;
  uid: string;
  name: string;
  created_at: string;
}

export interface UserSummary extends StudentSummary {
  role: UserRole;
}

export interface PracticeRecord {
  id: number;
  student_id: number;
  student_uid_snapshot: string | null;
  title: string;
  content: string;
  practice_date: string;
  location: string | null;
  duration: number;
  image_path: string | null;
  status: RecordStatus;
  teacher_comment: string | null;
  created_at: string;
  updated_at: string;
  updated_by_uid: string | null;
}

export interface StudentRecord extends PracticeRecord {
  student_name: string;
}

export interface TeacherRecord extends StudentRecord {
  student_uid: string;
}

export interface TeacherRecordSummary {
  id: number;
  student_id: number;
  title: string;
  practice_date: string;
  status: RecordStatus;
  created_at: string;
  student_name: string;
  student_uid: string;
}

export interface CreateRecordInput {
  student_id: number;
  title: string;
  content: string;
  practice_date: string;
  location: string | null;
  duration: number;
  image_path: string | null;
}

export interface UpdateRecordInput {
  title?: string;
  content?: string;
  practice_date?: string;
  location?: string | null;
  duration?: number;
  image_path?: string | null;
  status?: RecordStatus;
  teacher_comment?: string | null;
  updated_by_uid?: string | null;
}

export interface RecordFilters {
  student_id?: number | null;
  teacher_id?: number | null;
  status?: RecordStatus | null;
  practice_after?: string | null;
  practice_before?: string | null;
  created_after?: string | null;
  created_before?: string | null;
  updated_after?: string | null;
  updated_before?: string | null;
}

export interface RecordStatistics {
  total_records: number;
  pending_count: number;
  approved_count: number;
  rejected_count: number;
  total_duration: number;
}

export interface TeacherStatistics extends RecordStatistics {
  student_count: number;
  student_durations: Array<{
    student_id: number;
    student_name: string;
    student_uid: string;
    total_duration: number;
  }>;
}

export interface TeacherStudentAssignment {
  teacher_id: number;
  student_id: number;
}

export interface CreateUserResult {
  id: number;
  uid: string;
  name: string;
  role: UserRole;
  password: string;
}

export interface UploadResult {
  message: string;
  filename: string;
  imageUrl: string;
}

export interface CsvImportEntry {
  lineNumber: number;
  name: string;
  role: UserRole;
  teacher_uid: string;
}

export interface CsvImportPreview {
  message: string;
  encoding: 'utf-8' | 'utf-16' | 'gbk';
  totalCount: number;
  studentCount: number;
  entries: CsvImportEntry[];
}
