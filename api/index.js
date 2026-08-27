// Vercel Serverless Function 入口
// Vercel 默认将 /api 映射到 api/index.js
// vercel.json 中的 rewrites 将所有路径转发到 /api
// 此处直接导出 Express app

const app = require('../incident-dashboard/backend/server.js');

module.exports = app;
