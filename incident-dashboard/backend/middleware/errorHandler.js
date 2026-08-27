/**
 * 错误处理与追踪中间件
 * 统一捕获异常，返回结构化错误响应，记录错误追踪日志
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { DomainError } = require('../domain/incident');

const TRACE_LOG = path.join(__dirname, '..', 'logs', 'trace.log');
const ERROR_LOG = path.join(__dirname, '..', 'logs', 'error.log');

function ensureLogDir() {
  const dir = path.dirname(TRACE_LOG);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
ensureLogDir();

function writeTrace(entry) {
  const line = JSON.stringify({ ...entry, _t: new Date().toISOString() });
  fs.appendFileSync(TRACE_LOG, line + '\n', 'utf8');
}

function writeError(entry) {
  const line = JSON.stringify({ ...entry, _t: new Date().toISOString() });
  fs.appendFileSync(ERROR_LOG, line + '\n', 'utf8');
}

// 错误码映射表
const ERROR_MAP = {
  VALIDATION: { status: 400, message: '请求参数校验失败' },
  FORBIDDEN:  { status: 403, message: '操作不被允许' },
  CONFLICT:   { status: 409, message: '数据冲突' },
  IDEMPOTENT: { status: 200, message: '重复请求' },
  NOT_FOUND:  { status: 404, message: '资源不存在' },
  INTERNAL:   { status: 500, message: '服务器内部错误' },
};

function errorHandler() {
  return (err, req, res, next) => {
    const reqId = req.requestId || '-';
    const isDomain = err instanceof DomainError;
    const code = isDomain ? err.code : 'INTERNAL';
    const mapped = ERROR_MAP[code] || ERROR_MAP.INTERNAL;

    const traceEntry = {
      reqId,
      code,
      path: req.path,
      method: req.method,
      message: err.message,
      stack: err.stack ? err.stack.split('\n').slice(0, 5) : null,
      body: req.body,
    };

    if (mapped.status >= 500) {
      console.error(`[ERROR ${reqId}]`, err.message, err.stack);
      writeError(traceEntry);
    } else {
      console.warn(`[WARN ${reqId}]`, err.message);
      writeTrace(traceEntry);
    }

    // IDEMPOTENT 特殊处理：返回已存在的数据
    if (code === 'IDEMPOTENT' && err.meta && err.meta.incident) {
      return res.status(200).json({
        success: true,
        incident: err.meta.incident,
        _idempotent: true,
      });
    }

    res.status(mapped.status).json({
      success: false,
      error: {
        code,
        message: err.message || mapped.message,
        reqId,
      },
    });
  };
}

module.exports = { errorHandler };
