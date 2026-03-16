// database.js
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = process.env.DATABASE_FILE
  ? path.resolve(process.env.DATABASE_FILE)
  : path.join(__dirname, 'database.json');

let db = {
  users: [],
  practice_records: [],
  nextId: { users: 1, practice_records: 1 }
};

function saveData() {
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

function loadData() {
  if (!fs.existsSync(dbPath)) {
    return;
  }

  try {
    db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  } catch (error) {
    console.warn('Failed to parse database file, starting with a fresh data store.');
  }
}

function initDefaultData() {
  if (db.users.length > 0) {
    return;
  }

  const hashedPassword = bcrypt.hashSync('123456', 10);
  const createdAt = new Date().toISOString();

  db.users.push(
    {
      id: db.nextId.users++,
      username: 'teacher1',
      password: hashedPassword,
      role: 'teacher',
      name: 'Teacher One',
      created_at: createdAt
    },
    {
      id: db.nextId.users++,
      username: 'student1',
      password: hashedPassword,
      role: 'student',
      name: 'Student One',
      created_at: createdAt
    },
    {
      id: db.nextId.users++,
      username: 'student2',
      password: hashedPassword,
      role: 'student',
      name: 'Student Two',
      created_at: createdAt
    }
  );

  saveData();
}

const database = {
  findUserByUsername(username) {
    return db.users.find((user) => user.username === username);
  },

  findUserById(id) {
    return db.users.find((user) => user.id === Number(id));
  },

  getAllStudents() {
    return db.users
      .filter((user) => user.role === 'student')
      .map(({ id, username, name, created_at }) => ({
        id,
        username,
        name,
        created_at
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  getRecordsByStudent(studentId) {
    return db.practice_records
      .filter((record) => record.student_id === Number(studentId))
      .map((record) => {
        const student = this.findUserById(record.student_id);
        return {
          ...record,
          student_name: student ? student.name : ''
        };
      })
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  },

  getAllRecords(filters = {}) {
    let records = db.practice_records.map((record) => {
      const student = this.findUserById(record.student_id);
      return {
        ...record,
        student_name: student ? student.name : '',
        student_username: student ? student.username : ''
      };
    });

    if (filters.student_id) {
      records = records.filter((record) => record.student_id === Number(filters.student_id));
    }

    if (filters.status) {
      records = records.filter((record) => record.status === filters.status);
    }

    return records.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  },

  createRecord(record) {
    const newRecord = {
      id: db.nextId.practice_records++,
      ...record,
      status: 'pending',
      teacher_comment: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    db.practice_records.push(newRecord);
    saveData();
    return newRecord;
  },

  updateRecord(id, updates) {
    const index = db.practice_records.findIndex((record) => record.id === Number(id));
    if (index === -1) {
      return null;
    }

    db.practice_records[index] = {
      ...db.practice_records[index],
      ...updates,
      updated_at: new Date().toISOString()
    };
    saveData();
    return db.practice_records[index];
  },

  deleteRecord(id) {
    const index = db.practice_records.findIndex((record) => record.id === Number(id));
    if (index === -1) {
      return false;
    }

    db.practice_records.splice(index, 1);
    saveData();
    return true;
  },

  getRecordById(id) {
    return db.practice_records.find((record) => record.id === Number(id)) || null;
  },

  getStatistics() {
    return {
      total_records: db.practice_records.length,
      pending_count: db.practice_records.filter((record) => record.status === 'pending').length,
      approved_count: db.practice_records.filter((record) => record.status === 'approved').length,
      rejected_count: db.practice_records.filter((record) => record.status === 'rejected').length,
      student_count: db.users.filter((user) => user.role === 'student').length
    };
  }
};

loadData();
initDefaultData();

module.exports = database;
