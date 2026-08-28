/**
 * 数据层: Supabase 云端仓库 (PostgREST)
 * 职责: 数据持久化、乐观锁、历史记录、幂等键
 * 说明: 通过 @supabase/supabase-js 对云端 incidents / incident_history 表执行
 *       SELECT / INSERT / UPDATE，替换原先的本地 JSON 文件存储。
 */

'use strict';

const path = require('path');

// 本地开发时加载仓库根目录的环境变量；Vercel 上由平台注入环境变量。
// 使用 try/catch 包裹，dotenv 不可用时静默降级（不会因缺少依赖而崩溃）。
try {
  require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });
  require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env.local') });
} catch (e) {
  // ignore
}

const { createClient } = require('@supabase/supabase-js');
const { DomainError } = require('../domain/incident');

const TABLE_INCIDENTS = 'incidents';
const TABLE_HISTORY = 'incident_history';

// 单例客户端：服务端使用 service_role key 以绕过 RLS 并拥有完整 CRUD 权限
let _client = null;
function getClient() {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('缺少 Supabase 环境变量: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  }

  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}

// ========== 字段映射: 领域(camelCase) <-> 数据库(snake_case) ==========
function toRow(incident) {
  return {
    id: incident.id,
    title: incident.title,
    severity: incident.severity,
    assignee: incident.assignee,
    status: incident.status,
    remark: incident.remark,
    created_at: incident.createdAt,
    updated_at: incident.updatedAt,
    closed_at: incident.closedAt,
    idempotency_key: incident.idempotencyKey,
    version: incident.version,
  };
}

function toHistoryRow(incidentId, h) {
  return { incident_id: incidentId, status: h.status, time: h.time, remark: h.remark };
}

function toEntity(row, history) {
  return {
    id: row.id,
    title: row.title,
    severity: row.severity,
    assignee: row.assignee,
    status: row.status,
    remark: row.remark,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at,
    idempotencyKey: row.idempotency_key,
    version: row.version,
    history: history || [],
  };
}

// 批量读取历史记录并按 incident_id 分组
async function fetchHistory(incidentIds) {
  if (!incidentIds || incidentIds.length === 0) return {};
  const client = getClient();
  const { data, error } = await client
    .from(TABLE_HISTORY)
    .select('incident_id, status, time, remark')
    .in('incident_id', incidentIds)
    .order('time', { ascending: true })
    .order('id', { ascending: true });

  if (error) throw new Error(`历史记录读取失败: ${error.message}`);

  const map = {};
  for (const h of data) {
    if (!map[h.incident_id]) map[h.incident_id] = [];
    map[h.incident_id].push({ status: h.status, time: h.time, remark: h.remark });
  }
  return map;
}

// 规范化数据库错误信息
function dbError(action, error) {
  return new Error(`${action}失败: ${error.message}`);
}

// ========== 查询 ==========
async function findById(id) {
  const client = getClient();
  const { data, error } = await client
    .from(TABLE_INCIDENTS)
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw dbError('查询事件', error);
  if (!data) return null;

  const history = await fetchHistory([id]);
  return toEntity(data, history[id] || []);
}

async function findByIdempotencyKey(key) {
  if (!key) return null;
  const client = getClient();
  const { data, error } = await client
    .from(TABLE_INCIDENTS)
    .select('*')
    .eq('idempotency_key', key)
    .maybeSingle();

  if (error) throw dbError('幂等键查询', error);
  if (!data) return null;

  const history = await fetchHistory([data.id]);
  return toEntity(data, history[data.id] || []);
}

// ========== 写入 ==========
async function insert(incident) {
  const client = getClient();

  const { data, error } = await client
    .from(TABLE_INCIDENTS)
    .insert(toRow(incident))
    .select();

  if (error) {
    // 23505 = 唯一约束冲突（幂等键），映射为领域冲突
    if (error.code === '23505') {
      throw new DomainError('CONFLICT', '事件已存在（幂等键冲突）');
    }
    throw dbError('创建事件', error);
  }

  const historyRows = (incident.history || []).map((h) => toHistoryRow(incident.id, h));
  if (historyRows.length > 0) {
    const { error: herr } = await client.from(TABLE_HISTORY).insert(historyRows);
    if (herr) throw dbError('写入历史记录', herr);
  }

  return incident;
}

// 更新：读取 -> 领域逻辑(乐观锁校验/状态机) -> 原子条件更新(再次校验版本) -> 追加历史
async function update(id, updater) {
  const incident = await findById(id);
  if (!incident) return null;

  const prevVersion = incident.version;
  const prevHistoryCount = incident.history.length;

  // 领域层执行更新（内含乐观锁校验，可能抛出 DomainError）
  const updated = updater(incident);

  const client = getClient();
  const { data, error } = await client
    .from(TABLE_INCIDENTS)
    .update(toRow(updated))
    .eq('id', id)
    .eq('version', prevVersion) // 数据库层乐观锁：仅当版本未变时更新
    .select();

  if (error) throw dbError('更新事件', error);
  if (!data || data.length === 0) {
    throw new DomainError('CONFLICT', '数据已被他人修改，请刷新后重试');
  }

  // 追加本次新增的历史记录（不重复写入已有历史）
  const newHistory = updated.history.slice(prevHistoryCount);
  if (newHistory.length > 0) {
    const historyRows = newHistory.map((h) => toHistoryRow(id, h));
    const { error: herr } = await client.from(TABLE_HISTORY).insert(historyRows);
    if (herr) throw dbError('写入历史记录', herr);
  }

  // 以数据库返回的行重建实体，保证时间戳与云端一致
  return toEntity(data[0], updated.history);
}

// ========== 列表查询（支持筛选） ==========
async function list(filter = {}) {
  const client = getClient();
  let query = client.from(TABLE_INCIDENTS).select('*');

  if (filter.status) query = query.eq('status', filter.status);
  if (filter.severity) query = query.eq('severity', filter.severity);
  if (filter.excludeClosed) query = query.neq('status', '已关闭');
  if (filter.assignee) query = query.ilike('assignee', `%${filter.assignee}%`);
  if (filter.keyword) {
    const kw = filter.keyword;
    query = query.or(
      `title.ilike.%${kw}%,remark.ilike.%${kw}%,assignee.ilike.%${kw}%`
    );
  }
  query = query.order('created_at', { ascending: false });

  const { data, error } = await query;
  if (error) throw dbError('列表查询', error);
  if (!data || data.length === 0) return [];

  const historyMap = await fetchHistory(data.map((r) => r.id));
  return data.map((r) => toEntity(r, historyMap[r.id] || []));
}

// ========== 统计 ==========
async function countRows(mutate) {
  const client = getClient();
  let query = client.from(TABLE_INCIDENTS).select('id', { count: 'exact', head: true });
  if (mutate) query = mutate(query);
  const { count, error } = await query;
  if (error) throw dbError('统计', error);
  return count || 0;
}

async function getStats() {
  const [total, open, closed] = await Promise.all([
    countRows(),
    countRows((q) => q.neq('status', '已关闭')),
    countRows((q) => q.eq('status', '已关闭')),
  ]);
  return { total, open, closed };
}

// ========== 导出 ==========
async function exportJSON() {
  const incidents = await list({});
  return JSON.stringify({ incidents }, null, 2);
}

async function exportCSV() {
  const incidents = await list({});
  const headers = ['ID', '标题', '严重度', '负责人', '状态', '备注', '创建时间', '更新时间', '关闭时间'];
  const rows = incidents.map((i) => [
    i.id, i.title, i.severity, i.assignee, i.status, i.remark,
    i.createdAt, i.updatedAt, i.closedAt || '',
  ]);
  const escape = (val) => {
    const str = String(val).replace(/"/g, '""');
    if (str.includes(',') || str.includes('\n') || str.includes('"')) {
      return `"${str}"`;
    }
    return str;
  };
  return [headers.join(','), ...rows.map((r) => r.map(escape).join(','))].join('\n');
}

// 清理旧数据（仅保留最近 1000 条）
async function cleanup() {
  const client = getClient();
  const { data, error } = await client
    .from(TABLE_INCIDENTS)
    .select('id')
    .order('created_at', { ascending: false })
    .range(1000, 999999);

  if (error) throw dbError('清理查询', error);
  if (!data || data.length === 0) return;

  const ids = data.map((r) => r.id);
  const { error: derr } = await client.from(TABLE_INCIDENTS).delete().in('id', ids);
  if (derr) throw dbError('清理删除', derr);
}

module.exports = {
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
