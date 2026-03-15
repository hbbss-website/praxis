const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, 'database.json');

// 内存数据库
let db = {
    users: [],
    practice_records: [],
    nextId: { users: 1, practice_records: 1 }
};

// 加载数据
function loadData() {
    if (fs.existsSync(dbPath)) {
        try {
            const data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
            db = data;
        } catch (error) {
            console.log('创建新数据库');
        }
    }
}

// 保存数据
function saveData() {
    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

// 初始化默认数据
async function initDefaultData() {
    if (db.users.length === 0) {
        const hashedPassword = await bcrypt.hash('123456', 10);

        db.users.push({ id: db.nextId.users++, username: 'teacher1', password: hashedPassword, role: 'teacher', name: '张老师', created_at: new Date().toISOString() }, { id: db.nextId.users++, username: 'student1', password: hashedPassword, role: 'student', name: '李明', created_at: new Date().toISOString() }, { id: db.nextId.users++, username: 'student2', password: hashedPassword, role: 'student', name: '王芳', created_at: new Date().toISOString() });

        saveData();
        console.log('默认数据已创建');
    }
}

// 数据库操作对象
const database = {
    // 用户相关
    findUserByUsername(username) {
        return db.users.find(u => u.username === username);
    },

    findUserById(id) {
        return db.users.find(u => u.id === id);
    },

    getAllStudents() {
        return db.users.filter(u => u.role === 'student').map(u => ({
            id: u.id,
            username: u.username,
            name: u.name,
            created_at: u.created_at
        }));
    },

    // 记录相关
    getRecordsByStudent(studentId) {
        return db.practice_records
            .filter(r => r.student_id === studentId)
            .map(r => {
                const student = this.findUserById(r.student_id);
                return {...r, student_name: student ? student.name : '' };
            })
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    },

    getAllRecords(filters = {}) {
        let records = db.practice_records.map(r => {
            const student = this.findUserById(r.student_id);
            return {
                ...r,
                student_name: student ? student.name : '',
                student_username: student ? student.username : ''
            };
        });

        if (filters.student_id) {
            records = records.filter(r => r.student_id === parseInt(filters.student_id));
        }
        if (filters.status) {
            records = records.filter(r => r.status === filters.status);
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
        const index = db.practice_records.findIndex(r => r.id === parseInt(id));
        if (index === -1) return null;

        db.practice_records[index] = {
            ...db.practice_records[index],
            ...updates,
            updated_at: new Date().toISOString()
        };
        saveData();
        return db.practice_records[index];
    },

    deleteRecord(id) {
        const index = db.practice_records.findIndex(r => r.id === parseInt(id));
        if (index === -1) return false;

        db.practice_records.splice(index, 1);
        saveData();
        return true;
    },

    getRecordById(id) {
        return db.practice_records.find(r => r.id === parseInt(id));
    },

    // 统计
    getStatistics() {
        return {
            total_records: db.practice_records.length,
            pending_count: db.practice_records.filter(r => r.status === 'pending').length,
            approved_count: db.practice_records.filter(r => r.status === 'approved').length,
            rejected_count: db.practice_records.filter(r => r.status === 'rejected').length,
            student_count: db.users.filter(u => u.role === 'student').length
        };
    }
};

// 初始化
loadData();
initDefaultData();

module.exports = database;