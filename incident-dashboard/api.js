/**
 * 前端服务层: API 客户端
 * 职责: 封装 HTTP 请求、加载状态、错误处理、缓存刷新
 */

(function () {
  'use strict';

  const BASE_URL = '';
  const CACHE_KEY = '_api_cache_incidents';
  const CACHE_TTL_MS = 30000; // 30秒缓存

  // ===== 状态管理 =====
  const state = {
    loading: false,
    error: null,
    lastFetch: 0,
    pendingRequests: new Map(), // 用于取消重复请求
  };

  function setLoading(v) {
    state.loading = v;
    document.dispatchEvent(new CustomEvent('api:loading', { detail: v }));
  }

  function setError(err) {
    state.error = err;
    document.dispatchEvent(new CustomEvent('api:error', { detail: err }));
  }

  function clearError() {
    state.error = null;
  }

  // ===== 核心请求方法 =====
  async function request(method, path, body, options = {}) {
    const url = `${BASE_URL}${path}`;
    const abortKey = `${method}:${path}`;

    // 取消同路径的未完成的 GET 请求
    if (method === 'GET' && state.pendingRequests.has(abortKey)) {
      state.pendingRequests.get(abortKey).abort();
    }

    const controller = new AbortController();
    state.pendingRequests.set(abortKey, controller);

    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      ...options,
    };
    if (body) opts.body = JSON.stringify(body);

    setLoading(true);
    clearError();

    try {
      const response = await fetch(url, opts);
      const data = await response.json().catch(() => ({
        success: false,
        error: { message: '服务器返回了非 JSON 数据' },
      }));

      if (!response.ok || !data.success) {
        const err = new Error(data.error?.message || `HTTP ${response.status}`);
        err.code = data.error?.code || 'HTTP_ERROR';
        err.status = response.status;
        err.reqId = data.error?.reqId;
        throw err;
      }

      return data;
    } catch (e) {
      if (e.name === 'AbortError') {
        return { _aborted: true };
      }
      setError(e);
      throw e;
    } finally {
      state.pendingRequests.delete(abortKey);
      if (state.pendingRequests.size === 0) setLoading(false);
    }
  }

  // ===== 缓存层 =====
  function cacheGet(key) {
    try {
      const raw = localStorage.getItem(CACHE_KEY + ':' + key);
      if (!raw) return null;
      const { t, data } = JSON.parse(raw);
      if (Date.now() - t > CACHE_TTL_MS) return null;
      return data;
    } catch (e) {
      return null;
    }
  }

  function cacheSet(key, data) {
    try {
      localStorage.setItem(CACHE_KEY + ':' + key, JSON.stringify({ t: Date.now(), data }));
    } catch (e) {
      // 忽略缓存写入错误
    }
  }

  function cacheClear() {
    Object.keys(localStorage)
      .filter(k => k.startsWith(CACHE_KEY + ':'))
      .forEach(k => localStorage.removeItem(k));
  }

  // ===== API 方法 =====

  async function getIncidents(filter = {}) {
    const qs = new URLSearchParams();
    Object.entries(filter).forEach(([k, v]) => { if (v) qs.append(k, v); });
    const path = '/api/incidents?' + qs.toString();

    const cached = cacheGet(path);
    if (cached) return cached;

    const data = await request('GET', path);
    cacheSet(path, data);
    return data;
  }

  async function getIncident(id) {
    return request('GET', `/api/incidents/${id}`);
  }

  async function createIncident(payload) {
    // 自动生成幂等键
    const body = {
      ...payload,
      idempotencyKey: 'create_' + payload.title + '_' + (payload.assignee || ''),
    };
    const data = await request('POST', '/api/incidents', body);
    cacheClear();
    return data;
  }

  async function updateIncident(id, payload) {
    const data = await request('PATCH', `/api/incidents/${id}`, payload);
    cacheClear();
    return data;
  }

  async function closeIncident(id, remark, version) {
    const data = await request('POST', `/api/incidents/${id}/close`, { remark, version });
    cacheClear();
    return data;
  }

  async function getStats() {
    const cached = cacheGet('/api/incidents/stats');
    if (cached) return cached;
    const data = await request('GET', '/api/incidents/stats');
    cacheSet('/api/incidents/stats', data);
    return data;
  }

  async function exportData(format) {
    const url = `${BASE_URL}/api/incidents/export/${format}`;
    const response = await fetch(url);
    if (!response.ok) {
      const err = new Error('导出失败');
      err.status = response.status;
      throw err;
    }
    const blob = await response.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `incidents_${new Date().toISOString().slice(0,10)}.${format}`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ===== 自动刷新 =====
  function startAutoRefresh(callback, intervalMs = 30000) {
    const timer = setInterval(async () => {
      try {
        const data = await getIncidents();
        if (callback) callback(data);
      } catch (e) {
        // 静默失败，不中断定时器
      }
    }, intervalMs);
    return () => clearInterval(timer);
  }

  // ===== 表单校验（前端） =====
  function validateForm({ title, status }) {
    const errors = [];
    if (!title || title.trim().length === 0) errors.push('事件标题不能为空');
    if (title && title.trim().length > 200) errors.push('事件标题不能超过200字');
    if (!status) errors.push('处理状态不能为空');
    return errors;
  }

  // ===== 暴露 =====
  window.IncidentAPI = {
    getIncidents,
    getIncident,
    createIncident,
    updateIncident,
    closeIncident,
    getStats,
    exportData,
    startAutoRefresh,
    validateForm,
    cacheClear,
    getState: () => ({ ...state }),
  };
})();
