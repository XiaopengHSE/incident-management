/**
 * 数据层: JSON 文件存储仓库
 * 职责: 数据持久化、原子读写、数据迁移、备份
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'incidents.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

// 确保目录存在
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
ensureDir(DATA_DIR);
ensureDir(BACKUP_DIR);

// 原子写入：先写临时文件，再重命名
function atomicWrite(filePath, data) {
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

// 加载数据
function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return { incidents: [], _meta: { version: 1, createdAt: new Date().toISOString() } };
    }
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.incidents)) {
      return { incidents: [], _meta: { version: 1 } };
    }
    return parsed;
  } catch (e) {
    throw new Error(`数据加载失败: ${e.message}`);
  }
}

// 保存数据
function saveData(data) {
  try {
    atomicWrite(DATA_FILE, data);
    return true;
  } catch (e) {
    throw new Error(`数据保存失败: ${e.message}`);
  }
}

// 创建备份
function createBackup() {
  try {
    if (!fs.existsSync(DATA_FILE)) return null;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(BACKUP_DIR, `incidents-${timestamp}.json`);
    fs.copyFileSync(DATA_FILE, backupPath);
    // 只保留最近 20 个备份
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('incidents-'))
      .map(f => ({ name: f, time: fs.statSync(path.join(BACKUP_DIR, f)).mtime.getTime() }))
      .sort((a, b) => b.time - a.time);
    if (files.length > 20) {
      files.slice(20).forEach(f => fs.unlinkSync(path.join(BACKUP_DIR, f.name)));
    }
    return backupPath;
  } catch (e) {
    console.error('[Repository] 备份失败:', e.message);
    return null;
  }
}

// 按 ID 查找
function findById(id) {
  const data = loadData();
  return data.incidents.find(i => i.id === id) || null;
}

// 按幂等键查找
function findByIdempotencyKey(key) {
  if (!key) return null;
  const data = loadData();
  return data.incidents.find(i => i.idempotencyKey === key) || null;
}

// 插入
function insert(incident) {
  const data = loadData();
  data.incidents.unshift(incident);
  saveData(data);
  return incident;
}

// 更新
function update(id, updater) {
  const data = loadData();
  const idx = data.incidents.findIndex(i => i.id === id);
  if (idx === -1) return null;
  const updated = updater(data.incidents[idx]);
  data.incidents[idx] = updated;
  saveData(data);
  return updated;
}

// 列表查询（支持筛选）
function list(filter = {}) {
  const data = loadData();
  let list = [...data.incidents];

  if (filter.status) {
    list = list.filter(i => i.status === filter.status);
  }
  if (filter.severity) {
    list = list.filter(i => i.severity === filter.severity);
  }
  if (filter.assignee) {
    list = list.filter(i => i.assignee && i.assignee.includes(filter.assignee));
  }
  if (filter.keyword) {
    const kw = filter.keyword.toLowerCase();
    list = list.filter(i =>
      (i.title && i.title.toLowerCase().includes(kw)) ||
      (i.remark && i.remark.toLowerCase().includes(kw)) ||
      (i.assignee && i.assignee.toLowerCase().includes(kw))
    );
  }
  if (filter.excludeClosed) {
    list = list.filter(i => i.status !== '已关闭');
  }

  // 默认按创建时间倒序
  list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return list;
}

// 统计
function getStats() {
  const data = loadData();
  const total = data.incidents.length;
  const open = data.incidents.filter(i => i.status !== '已关闭').length;
  const closed = data.incidents.filter(i => i.status === '已关闭').length;
  return { total, open, closed };
}

// 导出 JSON
function exportJSON() {
  return JSON.stringify(loadData(), null, 2);
}

// 导出 CSV
function exportCSV() {
  const data = loadData();
  const headers = ['ID', '标题', '严重度', '负责人', '状态', '备注', '创建时间', '更新时间', '关闭时间'];
  const rows = data.incidents.map(i => [
    i.id, i.title, i.severity, i.assignee, i.status, i.remark,
    i.createdAt, i.updatedAt, i.closedAt || ''
  ]);
  const escape = (val) => {
    const str = String(val).replace(/"/g, '""');
    if (str.includes(',') || str.includes('\n') || str.includes('"')) {
      return `"${str}"`;
    }
    return str;
  };
  return [headers.join(','), ...rows.map(r => r.map(escape).join(','))].join('\n');
}

// 清理旧数据（保留最近 1000 条）
function cleanup() {
  const data = loadData();
  if (data.incidents.length > 1000) {
    createBackup();
    data.incidents = data.incidents.slice(0, 1000);
    saveData(data);
  }
}

module.exports = {
  loadData,
  saveData,
  createBackup,
  findById,
  findByIdempotencyKey,
  insert,
  update,
  list,
  getStats,
  exportJSON,
  exportCSV,
  cleanup,
};
