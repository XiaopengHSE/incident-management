/**
 * 领域层: 事件实体、状态机、业务规则
 * 职责: 定义 Event 结构、状态迁移规则、权限校验、幂等控制
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ========== 常量定义 ==========
const SEVERITY_TIMEOUT_HOURS = {
  '紧急': 4,
  '高': 24,
  '中': 72,
  '低': 168,
};

const VALID_SEVERITIES = Object.keys(SEVERITY_TIMEOUT_HOURS);
const VALID_STATUSES = ['待处理', '处理中', '已解决', '已关闭'];

// 状态迁移图: from -> allowed[]
const STATE_MACHINE = {
  '待处理': ['处理中', '已解决', '已关闭'],
  '处理中': ['待处理', '已解决', '已关闭'],
  '已解决': ['待处理', '处理中', '已关闭'],
  '已关闭': [], // 终态，不可迁移
};

// 各状态允许的操作权限
const STATUS_PERMISSIONS = {
  '待处理': { edit: true, assign: true, close: true },
  '处理中': { edit: true, assign: true, close: true },
  '已解决': { edit: true, assign: false, close: true },
  '已关闭': { edit: false, assign: false, close: false },
};

// ========== 工具 ==========
function generateId() {
  return 'inc_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6);
}

function nowISO() {
  return new Date().toISOString();
}

// ========== 实体工厂 ==========
function createEventEntity({ title, severity, assignee, status, remark, idempotencyKey }) {
  if (!title || title.trim().length === 0) {
    throw new DomainError('VALIDATION', '事件标题不能为空');
  }
  if (title.trim().length > 200) {
    throw new DomainError('VALIDATION', '事件标题不能超过200字');
  }
  if (!VALID_STATUSES.includes(status)) {
    throw new DomainError('VALIDATION', `无效的处理状态: ${status}`);
  }
  if (!VALID_SEVERITIES.includes(severity)) {
    throw new DomainError('VALIDATION', `无效的严重度: ${severity}`);
  }

  const now = nowISO();
  return {
    id: generateId(),
    title: title.trim(),
    severity,
    assignee: (assignee || '').trim().slice(0, 50),
    status,
    remark: (remark || '').trim().slice(0, 1000),
    createdAt: now,
    updatedAt: now,
    closedAt: null,
    history: [
      { status, time: now, remark: '事件创建' }
    ],
    idempotencyKey: idempotencyKey || null,
    version: 1, // 乐观锁版本号
  };
}

// ========== 状态迁移规则 ==========
function canTransition(fromStatus, toStatus) {
  if (fromStatus === toStatus) return true; // 允许同状态更新（如只改备注）
  const allowed = STATE_MACHINE[fromStatus] || [];
  return allowed.includes(toStatus);
}

function validateTransition(incident, newStatus) {
  if (incident.status === '已关闭' && newStatus !== '已关闭') {
    throw new DomainError('FORBIDDEN', '已关闭的事件不能修改状态');
  }
  if (incident.status !== newStatus && !canTransition(incident.status, newStatus)) {
    throw new DomainError('FORBIDDEN',
      `状态迁移不允许: ${incident.status} → ${newStatus}`);
  }
}

// ========== 权限规则 ==========
function checkPermission(incident, action) {
  const perms = STATUS_PERMISSIONS[incident.status];
  if (!perms || !perms[action]) {
    throw new DomainError('FORBIDDEN',
      `当前状态「${incident.status}」不允许执行「${action}」操作`);
  }
}

// ========== 幂等控制 ==========
function checkIdempotency(existing, key) {
  if (!key) return;
  if (existing && existing.idempotencyKey === key) {
    throw new DomainError('IDEMPOTENT', '重复请求，已处理', { incident: existing });
  }
}

// ========== 超时计算 ==========
function isOverdue(incident) {
  if (incident.status === '已关闭' || incident.status === '已解决') {
    return false;
  }
  const hours = SEVERITY_TIMEOUT_HOURS[incident.severity] || 72;
  const deadline = new Date(new Date(incident.createdAt).getTime() + hours * 3600 * 1000);
  return new Date() > deadline;
}

// ========== 业务事务: 更新事件 ==========
function updateEventEntity(incident, { title, severity, assignee, status, remark }, expectedVersion) {
  // 乐观锁校验
  if (expectedVersion !== undefined && incident.version !== expectedVersion) {
    throw new DomainError('CONFLICT', '数据已被他人修改，请刷新后重试');
  }

  // 权限校验
  checkPermission(incident, 'edit');

  // 校验
  if (!title || title.trim().length === 0) {
    throw new DomainError('VALIDATION', '事件标题不能为空');
  }
  if (title.trim().length > 200) {
    throw new DomainError('VALIDATION', '事件标题不能超过200字');
  }
  if (!VALID_STATUSES.includes(status)) {
    throw new DomainError('VALIDATION', `无效的处理状态: ${status}`);
  }
  if (severity && !VALID_SEVERITIES.includes(severity)) {
    throw new DomainError('VALIDATION', `无效的严重度: ${severity}`);
  }

  // 状态迁移校验
  validateTransition(incident, status);

  const oldStatus = incident.status;
  const now = nowISO();

  incident.title = title.trim();
  if (severity) incident.severity = severity;
  incident.assignee = (assignee || '').trim().slice(0, 50);
  incident.remark = (remark || '').trim().slice(0, 1000);
  incident.updatedAt = now;
  incident.version += 1;

  if (status !== oldStatus) {
    incident.status = status;
    incident.history.push({
      status,
      time: now,
      remark: remark
        ? `状态变更: ${oldStatus} → ${status}（备注: ${remark}）`
        : `状态变更: ${oldStatus} → ${status}`
    });
  }

  return incident;
}

// ========== 业务事务: 关闭事件 ==========
function closeEventEntity(incident, closeRemark, expectedVersion) {
  if (expectedVersion !== undefined && incident.version !== expectedVersion) {
    throw new DomainError('CONFLICT', '数据已被他人修改，请刷新后重试');
  }

  if (incident.status === '已关闭') {
    throw new DomainError('CONFLICT', '事件已经是关闭状态');
  }

  checkPermission(incident, 'close');

  const oldStatus = incident.status;
  const now = nowISO();

  incident.status = '已关闭';
  incident.closedAt = now;
  incident.updatedAt = now;
  incident.version += 1;
  incident.history.push({
    status: '已关闭',
    time: now,
    remark: closeRemark
      ? `关闭事件（备注: ${closeRemark}）`
      : `关闭事件: ${oldStatus} → 已关闭`
  });

  return incident;
}

// ========== 领域错误 ==========
class DomainError extends Error {
  constructor(code, message, meta = {}) {
    super(message);
    this.code = code;
    this.meta = meta;
    this.name = 'DomainError';
  }
}

// ========== 导出 ==========
module.exports = {
  SEVERITY_TIMEOUT_HOURS,
  VALID_STATUSES,
  VALID_SEVERITIES,
  STATE_MACHINE,
  STATUS_PERMISSIONS,
  createEventEntity,
  updateEventEntity,
  closeEventEntity,
  checkPermission,
  checkIdempotency,
  canTransition,
  isOverdue,
  DomainError,
};
