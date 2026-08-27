/**
 * 异常事件登记台 - 后端服务入口
 * 技术栈: Node.js + Express
 * 端口: 3000 (可通过 PORT 环境变量覆盖)
 */

'use strict';

const express = require('express');
const cors = require('cors');
const path = require('path');

const { requestLogger } = require('./middleware/logger');
const { errorHandler } = require('./middleware/errorHandler');
const incidentRoutes = require('./routes/incidents');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== 全局中间件 =====
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(requestLogger());

// ===== 静态文件（前端） =====
// 本地: __dirname = incident-dashboard/backend, 前端在 incident-dashboard/
// Vercel: __dirname = /var/task/incident-dashboard/backend, 前端在 /var/task/incident-dashboard/
const FRONTEND_DIR = path.join(__dirname, '..');

// 检查前端目录是否存在 index.html，不存在则尝试上两级（Vercel 不同配置情况）
let staticDir = FRONTEND_DIR;
const fs = require('fs');
if (!fs.existsSync(path.join(FRONTEND_DIR, 'index.html'))) {
  const altDir = path.join(__dirname, '..', '..');
  if (fs.existsSync(path.join(altDir, 'index.html'))) {
    staticDir = altDir;
  }
}

app.use(express.static(staticDir));

// 根路径返回 index.html
app.get('/', (req, res) => {
  const indexPath = path.join(staticDir, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '前端文件未找到' } });
  }
});

// ===== API 路由 =====
app.use('/api/incidents', incidentRoutes);

// ===== 健康检查 =====
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ===== Swagger 文档 =====
app.get('/api/docs', (req, res) => {
  res.sendFile(path.join(__dirname, 'swagger.html'));
});
app.get('/api/docs/swagger.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'swagger.json'));
});
// 兼容 swagger.html 内部相对路径
app.get('/swagger.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'swagger.json'));
});

// ===== 404 处理 =====
app.use((req, res) => {
  // API 请求返回 JSON 404
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: '接口不存在' },
    });
  }
  // 非 API 请求回退到 index.html（支持前端路由）
  const indexPath = path.join(staticDir, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '页面未找到' } });
  }
});

// ===== 错误处理（必须放在最后） =====
app.use(errorHandler());

// ===== 启动（仅本地开发时执行，Vercel 上跳过） =====
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`============================================`);
    console.log(`  异常事件登记台 - 后端服务`);
    console.log(`  监听端口: ${PORT}`);
    console.log(`  API 前缀: /api/incidents`);
    console.log(`  前端地址: http://localhost:${PORT}`);
    console.log(`============================================`);
  });
}

module.exports = app;
