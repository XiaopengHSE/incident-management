/**
 * 请求校验中间件
 * 对入参进行基础校验，阻止明显非法请求到达领域层
 */

'use strict';

const { VALID_STATUSES, VALID_SEVERITIES } = require('../domain/incident');

function validateCreateIncident(req, res, next) {
  const { title, severity, status } = req.body;
  const errors = [];

  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    errors.push('事件标题不能为空');
  } else if (title.trim().length > 200) {
    errors.push('事件标题不能超过200字');
  }

  if (severity && !VALID_SEVERITIES.includes(severity)) {
    errors.push(`严重度必须是: ${VALID_SEVERITIES.join('/')}`);
  }

  if (!status || !VALID_STATUSES.includes(status)) {
    errors.push(`处理状态必须是: ${VALID_STATUSES.join('/')}`);
  }

  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION', message: errors.join('; ') },
    });
  }

  next();
}

function validateUpdateIncident(req, res, next) {
  const { title, status } = req.body;
  const errors = [];

  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    errors.push('事件标题不能为空');
  }

  if (status && !VALID_STATUSES.includes(status)) {
    errors.push(`处理状态必须是: ${VALID_STATUSES.join('/')}`);
  }

  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION', message: errors.join('; ') },
    });
  }

  next();
}

function validateCloseIncident(req, res, next) {
  // 关闭操作不需要额外校验
  next();
}

module.exports = {
  validateCreateIncident,
  validateUpdateIncident,
  validateCloseIncident,
};
