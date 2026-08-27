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
app.use(express.static(path.join(__dirname, '..')));

// ===== API 路由 =====
app.use('/api/incidents', incidentRoutes);

// ===== 健康检查 =====
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ===== 404 处理 =====
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: '接口不存在' },
  });
});

// ===== 错误处理（必须放在最后） =====
app.use(errorHandler());

// ===== 启动 =====
app.listen(PORT, () => {
  console.log(`============================================`);
  console.log(`  异常事件登记台 - 后端服务`);
  console.log(`  监听端口: ${PORT}`);
  console.log(`  API 前缀: /api/incidents`);
  console.log(`  前端地址: http://localhost:${PORT}`);
  console.log(`============================================`);
});

module.exports = app;
