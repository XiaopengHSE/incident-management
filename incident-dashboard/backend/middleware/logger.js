/**
 * 请求日志中间件
 * 记录: 时间、方法、路径、状态码、耗时、请求体摘要、客户端 IP
 * 输出: 控制台 + 文件轮转
 */

'use strict';

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const LOG_FILE = path.join(LOG_DIR, 'access.log');
const ERROR_LOG_FILE = path.join(LOG_DIR, 'error.log');
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB

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
  rotateIfNeeded(filePath);
  fs.appendFileSync(filePath, line + '\n', 'utf8');
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
    writeLog(LOG_FILE, logLine);

    // 响应完成后记录
    res.on('finish', () => {
      const duration = Date.now() - start;
      const respLine = `[${now()}] ${reqId} ${res.statusCode} ${duration}ms`;
      console.log(respLine);
      writeLog(LOG_FILE, respLine);

      // 错误请求记录到 error.log
      if (res.statusCode >= 400) {
        const errLine = `[${now()}] ${reqId} ${req.method} ${req.path} ${res.statusCode} ${duration}ms`;
        writeLog(ERROR_LOG_FILE, errLine);
      }
    });

    next();
  };
}

module.exports = { requestLogger };
