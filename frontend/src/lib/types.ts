const envApiUrl = import.meta.env.VITE_API_URL?.trim().replace(/\/$/, '');

export const API_URL = envApiUrl || '/api';

export type UserRole = 'admin' | 'teacher' | 'student';
export type RecordStatus = 'approved' | 'pending' | 'rejected';
export type NotificationType = 'approved' | 'rejected' | 'deleted' | 'other';

export interface StoredUser {
  id: number;
  uid: string;
  role: UserRole;
  name: string;
}

export interface ApiError {
  error?: string;
}

export interface StudentRecord {
  id: number;
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

export interface TeacherRecord extends StudentRecord {
  student_id: number;
  student_name: string;
  student_uid: string;
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

export interface StudentSummary {
  id: number;
  uid: string;
  name: string;
  created_at: string;
}

export interface UserSummary extends StudentSummary {
  role: UserRole;
}

export interface Assignment {
  teacher_id: number;
  student_id: number;
}

export interface AppNotification {
  id: number;
  student_id: number;
  type: NotificationType;
  message: string;
  is_read: boolean;
  created_at: string;
}

export interface UploadResult extends ApiError {
  filename: string;
  imageUrl: string;
}

export interface CreatedUser {
  id: number;
  uid: string;
  name: string;
  role: UserRole;
  password: string;
}

export interface CsvImportEntry {
  lineNumber: number;
  name: string;
  role: UserRole;
  teacher_uid: string;
}

export interface CsvImportPreview {
  encoding: 'utf-8' | 'utf-16' | 'gbk';
  totalCount: number;
  studentCount: number;
  entries: CsvImportEntry[];
}
