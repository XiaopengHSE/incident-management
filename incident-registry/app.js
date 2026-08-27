// ========================
// Incident Registry - Core Logic
// ========================

export const STORAGE_KEY = 'incident-registry-data';

let incidents = [];

function generateId() {
  return 'inc_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function now() {
  return Date.now();
}

function validateSeverity(sev) {
  const valid = ['low', 'medium', 'high', 'critical'];
  if (!valid.includes(sev)) throw new Error('严重度无效');
}

function save() {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(incidents));
  }
}

export function initStorage() {
  if (typeof localStorage !== 'undefined') {
    const raw = localStorage.getItem(STORAGE_KEY);
    incidents = raw ? JSON.parse(raw) : [];
  } else {
    incidents = [];
  }
}

export function createIncident({ title, severity, assignee, note = '' }) {
  if (!title || !title.trim()) throw new Error('标题不能为空');
  validateSeverity(severity);
  if (!assignee || !assignee.trim()) throw new Error('负责人不能为空');

  const incident = {
    id: generateId(),
    title: title.trim(),
    severity,
    assignee: assignee.trim(),
    status: 'open',
    note: note.trim(),
    createdAt: now(),
    updatedAt: now(),
    history: [
      { action: 'created', timestamp: now(), note: '事件已创建' },
    ],
  };
  incidents.push(incident);
  save();
  return incident;
}

export function getAllIncidents() {
  return [...incidents];
}

export function getIncidentById(id) {
  return incidents.find(i => i.id === id) || null;
}

export function updateIncident(id, updates) {
  const inc = incidents.find(i => i.id === id);
  if (!inc) throw new Error('事件不存在');
  if (inc.status === 'closed') throw new Error('已关闭的事件不可编辑');

  const allowed = ['title', 'severity', 'assignee', 'note'];
  let changed = false;
  for (const key of allowed) {
    if (updates[key] !== undefined) {
      if (key === 'severity') validateSeverity(updates[key]);
      if (key === 'title' && (!updates[key] || !updates[key].trim())) throw new Error('标题不能为空');
      if (key === 'assignee' && (!updates[key] || !updates[key].trim())) throw new Error('负责人不能为空');
      inc[key] = updates[key].trim ? updates[key].trim() : updates[key];
      changed = true;
    }
  }

  if (changed) {
    inc.updatedAt = now();
    inc.history.push({ action: 'updated', timestamp: now(), note: updates.note || '信息已更新' });
  }
  save();
  return inc;
}

export function closeIncident(id, closeNote = '') {
  const inc = incidents.find(i => i.id === id);
  if (!inc) throw new Error('事件不存在');
  if (inc.status === 'closed') throw new Error('事件已关闭');

  inc.status = 'closed';
  inc.updatedAt = now();
  inc.history.push({ action: 'closed', timestamp: now(), note: closeNote || '事件已关闭' });
  save();
  return inc;
}

export function filterIncidents({ severity, status, assignee, keyword } = {}) {
  return incidents.filter(inc => {
    if (severity && inc.severity !== severity) return false;
    if (status && inc.status !== status) return false;
    if (assignee && inc.assignee !== assignee) return false;
    if (keyword && !inc.title.includes(keyword) && !inc.note.includes(keyword)) return false;
    return true;
  });
}

export function isOverdue(incident, thresholdHours = 24) {
  if (incident.status === 'closed') return false;
  const ageMs = now() - incident.createdAt;
  return ageMs > thresholdHours * 60 * 60 * 1000;
}

function escapeCSVCell(cell) {
  const str = String(cell ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

export function exportToCSV(incidentList) {
  const headers = ['ID', '标题', '严重度', '负责人', '状态', '备注', '创建时间', '更新时间'];
  const rows = incidentList.map(inc => [
    inc.id,
    inc.title,
    inc.severity,
    inc.assignee,
    inc.status,
    inc.note,
    new Date(inc.createdAt).toLocaleString('zh-CN'),
    new Date(inc.updatedAt).toLocaleString('zh-CN'),
  ]);
  return [headers.map(escapeCSVCell).join(','), ...rows.map(r => r.map(escapeCSVCell).join(','))].join('\n');
}

// Auto-init in browser
if (typeof window !== 'undefined') {
  initStorage();
}
