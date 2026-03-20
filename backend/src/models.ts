export type UserRole = 'admin' | 'teacher' | 'student';

export type RecordStatus = 'approved' | 'pending' | 'rejected';

export type NotificationType = 'approved' | 'rejected' | 'deleted';

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
}

export interface AuthTokenPayload extends PublicUser {
  exp?: number;
  iat?: number;
}

export interface PracticeRecord {
  id: number;
  student_id: number;
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
  student_id?: number | string | null;
  status?: RecordStatus | string | null;
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

export interface TeacherStudentAssignment {
  teacher_id: number;
  student_id: number;
}

export interface CreateUserResult {
  id: number;
  uid: string;
  name: string;
  role: UserRole;
  password: string; // plaintext, only returned on creation
}

export interface DatabaseState {
  users: User[];
  practice_records: PracticeRecord[];
  notifications: AppNotification[];
  teacher_students: TeacherStudentAssignment[];
  nextId: {
    users: number;
    practice_records: number;
    notifications: number;
  };
  nextUidNumber: {
    admin: number;
    teacher: number;
    student: number;
  };
}
