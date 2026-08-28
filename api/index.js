// Vercel Serverless Function 入口
// 前端静态文件由 Vercel public/ 目录自动处理
// 此处只处理 API 请求

const app = require('../incident-dashboard/backend/server.js');

module.exports = app;
