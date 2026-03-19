export type UserRole = 'student' | 'teacher';

export type RecordStatus = 'approved' | 'pending' | 'rejected';

export interface User {
  id: number;
  username: string;
  password: string;
  role: UserRole;
  name: string;
  created_at: string;
}

export interface PublicUser {
  id: number;
  username: string;
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
}

export interface StudentRecord extends PracticeRecord {
  student_name: string;
}

export interface TeacherRecord extends StudentRecord {
  student_username: string;
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
}

export interface RecordFilters {
  student_id?: number | string | null;
  status?: RecordStatus | string | null;
}

export interface RecordStatistics {
  total_records: number;
  pending_count: number;
  approved_count: number;
  rejected_count: number;
  total_duration: number;
}

export interface DatabaseState {
  users: User[];
  practice_records: PracticeRecord[];
  nextId: {
    users: number;
    practice_records: number;
  };
}
