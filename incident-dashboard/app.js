/**
 * 前端应用层: 状态管理、业务封装
 * 职责: 协调 UI 与 API 客户端，提供业务语义方法
 * 注意: 本文件依赖 api.js（必须先加载）
 */

(function () {
  'use strict';

  const SEVERITY_TIMEOUT_HOURS = {
    '紧急': 4,
    '高': 24,
    '中': 72,
    '低': 168,
  };

  const VALID_STATUSES = ['待处理', '处理中', '已解决', '已关闭'];

  // ===== 状态管理 =====
  const appState = {
    incidents: [],
    stats: { total: 0, open: 0, closed: 0, overdue: 0 },
    currentFilter: {},
    loading: false,
    error: null,
    autoRefreshStop: null,
  };

  function setState(patch) {
    Object.assign(appState, patch);
    document.dispatchEvent(new CustomEvent('app:state', { detail: { ...appState } }));
  }

  // ===== 初始化加载 =====
  async function init() {
    await Promise.all([refreshList(), refreshStats()]);
  }

  // ===== 刷新列表 =====
  async function refreshList(filter = appState.currentFilter) {
    setState({ loading: true, error: null, currentFilter: filter });
    try {
      const data = await IncidentAPI.getIncidents(filter);
      setState({ incidents: data.incidents || [], loading: false });
      return data.incidents || [];
    } catch (e) {
      setState({ error: e.message, loading: false });
      throw e;
    }
  }

  // ===== 刷新统计 =====
  async function refreshStats() {
    try {
      const data = await IncidentAPI.getStats();
      setState({ stats: data.stats || { total: 0, open: 0, closed: 0, overdue: 0 } });
    } catch (e) {
      // 统计失败不阻塞
    }
  }

  // ===== 新增事件 =====
  async function createIncident({ title, severity, assignee, status, remark }) {
    const errors = IncidentAPI.validateForm({ title, status });
    if (errors.length > 0) {
      return { success: false, error: errors.join('; ') };
    }
    try {
      const data = await IncidentAPI.createIncident({
        title, severity: severity || '中', assignee, status: status || '待处理', remark
      });
      await Promise.all([refreshList(), refreshStats()]);
      return { success: true, incident: data.incident };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // ===== 更新事件 =====
  async function updateIncident(id, { title, severity, assignee, status, remark, version }) {
    const errors = IncidentAPI.validateForm({ title, status });
    if (errors.length > 0) {
      return { success: false, error: errors.join('; ') };
    }
    try {
      const data = await IncidentAPI.updateIncident(id, {
        title, severity, assignee, status, remark, version
      });
      await Promise.all([refreshList(), refreshStats()]);
      return { success: true, incident: data.incident };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // ===== 关闭事件 =====
  async function closeIncident(id, remark, version) {
    try {
      const data = await IncidentAPI.closeIncident(id, remark, version);
      await Promise.all([refreshList(), refreshStats()]);
      return { success: true, incident: data.incident };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // ===== 查询单条 =====
  async function getIncidentById(id) {
    try {
      const data = await IncidentAPI.getIncident(id);
      return data.incident || null;
    } catch (e) {
      return null;
    }
  }

  // ===== 列表查询（带筛选） =====
  async function getIncidents(filter = {}) {
    // 如果 filter 与当前缓存不同，则刷新
    const isSame = JSON.stringify(filter) === JSON.stringify(appState.currentFilter);
    if (!isSame || appState.incidents.length === 0) {
      return await refreshList(filter);
    }
    return appState.incidents;
  }

  // ===== 超时计算 =====
  function isOverdue(incident) {
    if (incident.status === '已关闭' || incident.status === '已解决') {
      return false;
    }
    const hours = SEVERITY_TIMEOUT_HOURS[incident.severity] || 72;
    const deadline = new Date(new Date(incident.createdAt).getTime() + hours * 3600 * 1000);
    return new Date() > deadline;
  }

  // ===== 统计 =====
  function getStats() {
    return appState.stats;
  }

  // ===== 导出 =====
  async function exportToJSON() {
    // 前端不再直接生成，调用 API 下载
    await IncidentAPI.exportData('json');
    return '';
  }

  async function exportToCSV() {
    await IncidentAPI.exportData('csv');
    return '';
  }

  // ===== 自动刷新控制 =====
  function startAutoRefresh(callback, intervalMs) {
    if (appState.autoRefreshStop) appState.autoRefreshStop();
    const stop = IncidentAPI.startAutoRefresh(async (data) => {
      await refreshList();
      await refreshStats();
      if (callback) callback();
    }, intervalMs);
    setState({ autoRefreshStop: stop });
    return stop;
  }

  function stopAutoRefresh() {
    if (appState.autoRefreshStop) {
      appState.autoRefreshStop();
      setState({ autoRefreshStop: null });
    }
  }

  // ===== 测试辅助（向后兼容） =====
  function _clearStorage() {
    IncidentAPI.cacheClear();
  }

  // ===== 暴露 =====
  window.IncidentApp = {
    init,
    refreshList,
    refreshStats,
    createIncident,
    updateIncident,
    closeIncident,
    getIncidentById,
    getIncidents,
    isOverdue,
    getStats,
    exportToJSON,
    exportToCSV,
    startAutoRefresh,
    stopAutoRefresh,
    getState: () => ({ ...appState }),
    _clearStorage,
    // 常量暴露
    SEVERITY_TIMEOUT_HOURS,
    VALID_STATUSES,
  };
})();
