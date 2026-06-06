export const userRoles = ['admin', 'teacher', 'student'] as const;
export const recordStatuses = ['approved', 'pending', 'rejected'] as const;
export const notificationTypes = ['approved', 'rejected', 'deleted', 'other'] as const;
export const MAX_RECORD_IMAGES = 9;

export type UserRole = typeof userRoles[number];
export type RecordStatus = typeof recordStatuses[number];
export type NotificationType = typeof notificationTypes[number];
export type RecordSort = 'created_at_desc' | 'created_at_asc' | 'score_desc' | 'score_asc';

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
  uid: number;
  password: string;
  role: UserRole;
  name: string;
  english_name: string | null;
  created_at: string;
}

export interface PublicUser {
  id: number;
  uid: number;
  role: UserRole;
  name: string;
  english_name: string | null;
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
  uid: number;
  name: string;
  english_name: string | null;
  created_at: string;
}

export interface UserSummary extends StudentSummary {
  role: UserRole;
}

export interface PracticeRecord {
  id: number;
  task_id: number | null;
  student_id: number;
  student_uid_snapshot: number | null;
  title: string;
  content: string;
  practice_date: string;
  location: string | null;
  duration: number;
  image_paths: string[];
  cover_image_path: string | null;
  status: RecordStatus;
  teacher_comment: string | null;
  score: number | null;
  created_at: string;
}

export interface StudentRecord extends PracticeRecord {
  student_name: string;
}

export interface TeacherRecord extends StudentRecord {
  student_uid: number;
}

export interface TeacherRecordSummary {
  id: number;
  task_id: number | null;
  student_id: number;
  title: string;
  practice_date: string;
  status: RecordStatus;
  score: number | null;
  created_at: string;
  student_name: string;
  student_uid: number;
}

export interface TeacherRecordExport {
  class_label: string;
  student_name: string;
  student_uid: number;
  title: string;
  practice_date: string;
  duration: number;
  location: string;
  status: RecordStatus;
  score: number | null;
  teacher_comment: string;
  created_at: string;
  content: string;
  image_count: number;
}

export interface CreateRecordInput {
  task_id?: number | null;
  student_id: number;
  title: string;
  content: string;
  practice_date: string;
  location: string | null;
  duration: number;
  image_paths: string[];
  cover_image_path: string | null;
}

export interface UpdateRecordInput {
  title?: string;
  content?: string;
  practice_date?: string;
  location?: string | null;
  duration?: number;
  image_paths?: string[];
  cover_image_path?: string | null;
  status?: RecordStatus;
  teacher_comment?: string | null;
  score?: number | null;
}

export interface RecordFilters {
  task_id?: number | null;
  student_id?: number | null;
  student_ids?: number[] | null;
  class_id?: number | null;
  class_ids?: number[] | null;
  status?: RecordStatus | null;
  practice_after?: string | null;
  practice_before?: string | null;
  created_after?: string | null;
  created_before?: string | null;
}

export interface PracticeTask {
  id: number;
  title: string;
  description: string | null;
  start_at: string;
  end_at: string;
  min_words: number;
  min_images: number;
  max_records_per_student: number;
  score_enabled: boolean;
  created_by_id: number;
  created_at: string;
}

export interface PracticeTaskSummary extends PracticeTask {
  class_count: number;
  record_count: number;
  pending_count: number;
  approved_count: number;
  rejected_count: number;
  my_record_count?: number;
}

export interface PracticeTaskDetail extends PracticeTaskSummary {
  classes: ClassSummary[];
}

export interface CreatePracticeTaskInput {
  title: string;
  description: string | null;
  start_at: string;
  end_at: string;
  min_words: number;
  min_images: number;
  max_records_per_student: number;
  score_enabled: boolean;
  class_ids: number[];
  created_by_id: number;
}

export interface UpdatePracticeTaskInput {
  title?: string;
  description?: string | null;
  start_at?: string;
  end_at?: string;
  min_words?: number;
  min_images?: number;
  max_records_per_student?: number;
  class_ids?: number[];
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
    student_uid: number;
    total_duration: number;
  }>;
}

export interface ClassOverview {
  class_id: number;
  class_name: string;
  student_count: number;
  task_count: number;
  total_records: number;
  pending_count: number;
  approved_count: number;
  rejected_count: number;
  total_duration: number;
}

export interface StudentOverview {
  student_id: number;
  student_uid: number;
  student_name: string;
  class_id: number;
  class_name: string;
  total_records: number;
  pending_count: number;
  approved_count: number;
  rejected_count: number;
  total_duration: number;
}

export interface OverviewTrendPoint {
  month: string;
  active_task_count: number;
  submitted_record_count: number;
}

export interface OverviewData {
  classes: ClassOverview[];
  students: StudentOverview[];
  class_rankings: ClassOverview[];
  student_rankings: StudentOverview[];
  trend: OverviewTrendPoint[];
  selected_class_id: number | null;
}

export interface ClassSummary {
  id: number;
  name: string;
  created_at: string;
}

export interface ClassTeacherAssignment {
  class_id: number;
  teacher_id: number;
}

export interface ClassStudentAssignment {
  class_id: number;
  student_id: number;
}

export interface ClassAssignments {
  teachers: ClassTeacherAssignment[];
  students: ClassStudentAssignment[];
}

export interface StudentWithClassSummary extends StudentSummary {
  class_id: number | null;
  class_name: string | null;
}

export interface CreateUserResult {
  id: number;
  uid: number;
  name: string;
  english_name: string | null;
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
  english_name: string | null;
  role: UserRole;
  class_name: string | null;
}

export interface CsvImportPreview {
  message: string;
  encoding: 'utf-8' | 'utf-16' | 'gbk';
  totalCount: number;
  studentCount: number;
  entries: CsvImportEntry[];
}

export interface UserCredentialsCsvResult {
  credentialsCsv: string;
}
