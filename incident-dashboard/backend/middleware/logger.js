/**
 * 请求日志中间件
 * 记录: 时间、方法、路径、状态码、耗时、请求体摘要、客户端 IP
 * 输出: 控制台 + 文件轮转
 */

'use strict';

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB

// 检测是否在只读文件系统上运行（如 Vercel）
function isReadOnlyFs() {
  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
    return false;
  } catch (e) {
    return true;
  }
}

const IS_READ_ONLY = isReadOnlyFs();

function now() {
  return new Date().toISOString();
}

function rotateIfNeeded(filePath) {
  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).size > MAX_LOG_SIZE) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      fs.renameSync(filePath, filePath + '.' + timestamp);
    }
  } catch (e) {
    // 忽略轮转错误
  }
}

function writeLog(filePath, line) {
  // 只读文件系统上跳过文件写入，仅用 console
  if (IS_READ_ONLY) return;
  try {
    rotateIfNeeded(filePath);
    fs.appendFileSync(filePath, line + '\n', 'utf8');
  } catch (e) {
    // 写入失败时降级为 console
  }
}

function requestLogger() {
  return (req, res, next) => {
    const start = Date.now();
    const reqId = 'req_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 4);
    req.requestId = reqId;

    // 记录请求摘要
    const bodySummary = req.body
      ? JSON.stringify(req.body).slice(0, 500)
      : '-';

    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '-';

    const logLine = `[${now()}] ${reqId} ${ip} ${req.method} ${req.path} body=${bodySummary}`;
    console.log(logLine);
    writeLog(path.join(LOG_DIR, 'access.log'), logLine);

    // 响应完成后记录
    res.on('finish', () => {
      const duration = Date.now() - start;
      const respLine = `[${now()}] ${reqId} ${res.statusCode} ${duration}ms`;
      console.log(respLine);
      writeLog(path.join(LOG_DIR, 'access.log'), respLine);

      // 错误请求记录到 error.log
      if (res.statusCode >= 400) {
        const errLine = `[${now()}] ${reqId} ${req.method} ${req.path} ${res.statusCode} ${duration}ms`;
        writeLog(path.join(LOG_DIR, 'error.log'), errLine);
      }
    });

    next();
  };
}

module.exports = { requestLogger };
