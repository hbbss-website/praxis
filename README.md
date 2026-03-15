# 社会实践记录管理系统

## 项目结构

```
social-practice-system/
├── backend/                 # 后端 (Node.js + Express + SQLite)
│   ├── server.js
│   ├── database.js
│   ├── middleware/
│   │   └── auth.js
│   ├── routes/
│   │   ├── auth.js
│   │   ├── students.js
│   │   └── teachers.js
│   └── package.json
├── frontend/                # 前端 (HTML + CSS + JS)
│   ├── index.html
│   ├── login.html
│   ├── student/
│   │   ├── dashboard.html
│   │   └── upload.html
│   ├── teacher/
│   │   └── dashboard.html
│   ├── css/
│   │   └── style.css
│   └── js/
│       ├── auth.js
│       ├── student.js
│       └── teacher.js
└── README.md
```

## 快速开始

### 1. 启动后端

```bash
cd backend
npm install
npm start
```

后端运行在 http://localhost:3000

### 2. 打开前端

直接用浏览器打开 `frontend/login.html`

或使用 VS Code Live Server 插件

## 默认账号

| 角色 | 用户名 | 密码 |
|------|--------|------|
| 老师 | teacher1 | 123456 |
| 学生 | student1 | 123456 |
| 学生 | student2 | 123456 |

## 功能说明

- **学生**: 登录后可以上传社会实践记录（标题、内容、图片、时间）
- **老师**: 登录后可以查看所有学生的社会实践记录，支持按学生筛选
