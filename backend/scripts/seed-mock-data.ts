import { eq } from 'drizzle-orm';

import { hashPassword } from '../src/auth/password';
import database from '../src/database';
import { db, sqlite } from '../src/db/client';
import { practiceRecords } from '../src/db/schema';

const teacherPassword = 'teacher-pass-01';
const studentPassword = 'student-pass-01';

function iso(date: string) {
  return new Date(date).toISOString();
}

function setRecordCreatedAt(recordId: number, createdAt: string) {
  db.update(practiceRecords).set({ createdAt }).where(eq(practiceRecords.id, recordId)).run();
}

async function main() {
  if (database.getClasses().some((item) => item.name === '高一 1 班')) {
    console.log('Mock data already exists.');
    return;
  }

  const classes = [
    database.createClass('高一 1 班'),
    database.createClass('高一 2 班'),
    database.createClass('高二 1 班')
  ];

  const [teacherA, teacherB] = await database.createUsers([
    { name: '张老师', role: 'teacher', classId: classes[0]!.id },
    { name: '李老师', role: 'teacher', classId: classes[2]!.id }
  ]);

  database.assignTeachersToClass(classes[1]!.id, [teacherA!.id]);

  for (const teacher of [teacherA, teacherB]) {
    database.updateUserPassword(teacher!.id, await hashPassword(teacherPassword));
  }

  const students = await database.createUsers([
    { name: '陈一一', role: 'student', classId: classes[0]!.id },
    { name: '周小雨', role: 'student', classId: classes[0]!.id },
    { name: '林子墨', role: 'student', classId: classes[1]!.id },
    { name: '吴可欣', role: 'student', classId: classes[1]!.id },
    { name: '郑明远', role: 'student', classId: classes[2]!.id },
    { name: '赵若溪', role: 'student', classId: classes[2]!.id }
  ]);

  for (const student of students) {
    database.updateUserPassword(student.id, await hashPassword(studentPassword));
  }

  const admin = database.findUserByUid(1)!;
  const tasks = [
    database.createTask({
      title: '社区志愿服务',
      description: '记录一次社区服务过程，重点描述服务对象、具体工作和收获。',
      start_at: iso('2026-05-01T00:00:00+08:00'),
      end_at: iso('2026-06-20T23:59:00+08:00'),
      min_words: 80,
      min_images: 1,
      max_records_per_student: 3,
      score_enabled: true,
      class_ids: [classes[0]!.id, classes[1]!.id],
      created_by_id: teacherA!.id
    }),
    database.createTask({
      title: '暑期职业体验',
      description: '围绕一次职业体验写记录，可包含访谈、观察和个人反思。',
      start_at: iso('2026-07-01T00:00:00+08:00'),
      end_at: iso('2026-08-31T23:59:00+08:00'),
      min_words: 120,
      min_images: 0,
      max_records_per_student: 2,
      score_enabled: false,
      class_ids: classes.map((item) => item.id),
      created_by_id: admin.id
    }),
    database.createTask({
      title: '校园劳动实践',
      description: '记录一次校内劳动实践，说明分工、过程和改进建议。',
      start_at: iso('2026-03-01T00:00:00+08:00'),
      end_at: iso('2026-04-15T23:59:00+08:00'),
      min_words: 60,
      min_images: 0,
      max_records_per_student: 2,
      score_enabled: false,
      class_ids: [classes[0]!.id],
      created_by_id: teacherA!.id
    }),
    database.createTask({
      title: '博物馆研学',
      description: '完成一次展馆研学记录，写清参观主题和印象最深的展品。',
      start_at: iso('2026-04-20T00:00:00+08:00'),
      end_at: iso('2026-05-15T23:59:00+08:00'),
      min_words: 100,
      min_images: 0,
      max_records_per_student: 2,
      score_enabled: false,
      class_ids: [classes[2]!.id],
      created_by_id: teacherB!.id
    })
  ];

  const recordSeeds = [
    [tasks[0]!.id, students[0]!, '整理社区图书角', '今天和同学一起整理社区图书角，重新分类书籍并登记破损图书。服务过程中我学会了和社区工作人员沟通，也发现公共空间需要长期维护。', '2026-05-03', '社区服务站', 2, 'approved', '2026-05-04T10:20:00+08:00'],
    [tasks[0]!.id, students[1]!, '协助垃圾分类宣传', '我参与了垃圾分类宣传，向居民介绍可回收物和厨余垃圾的区别。过程中有些问题我回答得还不够清楚，后面需要提前准备资料。', '2026-05-10', '小区广场', 1.5, 'pending', '2026-05-11T18:10:00+08:00'],
    [tasks[0]!.id, students[2]!, '社区活动签到', '这次负责社区活动签到和引导，虽然工作简单，但需要耐心核对信息，不能影响活动秩序。', '2026-05-18', '社区中心', 1, 'rejected', '2026-05-18T20:00:00+08:00'],
    [tasks[2]!.id, students[0]!, '校园花坛维护', '我们清理了花坛杂草，并给植物补水。劳动后我更能理解校园环境维护的不容易。', '2026-03-12', '教学楼前', 1.2, 'approved', '2026-03-13T12:00:00+08:00'],
    [tasks[2]!.id, students[1]!, '图书馆书架整理', '按照索书号整理书架，发现细致和耐心很重要。', '2026-04-02', '图书馆', 1, 'approved', '2026-04-03T17:30:00+08:00'],
    [tasks[3]!.id, students[4]!, '青铜器展厅研学', '参观青铜器展厅后，我对器物纹样和礼制关系有了更直观的认识。', '2026-04-28', '市博物馆', 2.5, 'approved', '2026-04-29T19:00:00+08:00'],
    [tasks[3]!.id, students[5]!, '城市记忆展记录', '展览用很多老照片呈现城市变化，我记录了几个和生活有关的细节。', '2026-05-08', '市博物馆', 2, 'pending', '2026-05-09T20:10:00+08:00']
  ] as const;

  for (const seed of recordSeeds) {
    const [taskId, student, title, content, practiceDate, location, duration, status, createdAt] = seed;
    const record = database.createRecord({
      task_id: taskId,
      student_id: student.id,
      title,
      content,
      practice_date: practiceDate,
      location,
      duration,
      image_paths: [],
      cover_image_path: null
    });
    database.updateRecord(record.id, {
      status,
      teacher_comment: status === 'rejected' ? '内容略短，请补充具体过程。' : null,
      score: taskId === tasks[0]!.id && status === 'approved' ? 92 : null
    });
    setRecordCreatedAt(record.id, iso(createdAt));
  }

  console.log('Mock data created.');
  console.log(`Admin: A00001 / 12345678`);
  console.log(`Teacher: ${teacherA!.uid} / ${teacherPassword}`);
  console.log(`Teacher: ${teacherB!.uid} / ${teacherPassword}`);
  console.log(`Student: ${students[0]!.uid} / ${studentPassword}`);
}

main().finally(() => sqlite.close());
