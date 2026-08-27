import { describe, it, expect, beforeEach, vi } from 'vitest';

// 模拟 localStorage
const localStorageMock = (() => {
  let store = {};
  return {
    getItem: (key) => store[key] || null,
    setItem: (key, value) => { store[key] = value; },
    removeItem: (key) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

Object.defineProperty(global, 'localStorage', { value: localStorageMock });

// 引入被测模块（将在后续步骤实现）
import {
  createIncident,
  getAllIncidents,
  getIncidentById,
  updateIncident,
  closeIncident,
  filterIncidents,
  isOverdue,
  exportToCSV,
  initStorage,
  STORAGE_KEY,
} from '../app.js';

describe('Incident Registry Core Logic', () => {
  beforeEach(() => {
    localStorage.clear();
    initStorage();
  });

  describe('createIncident', () => {
    it('should create an incident with default status "open"', () => {
      const incident = createIncident({
        title: '服务器宕机',
        severity: 'high',
        assignee: '张三',
        note: '生产环境主节点无法访问',
      });
      expect(incident).toBeDefined();
      expect(incident.id).toBeTypeOf('string');
      expect(incident.title).toBe('服务器宕机');
      expect(incident.severity).toBe('high');
      expect(incident.assignee).toBe('张三');
      expect(incident.status).toBe('open');
      expect(incident.note).toBe('生产环境主节点无法访问');
      expect(incident.history).toBeInstanceOf(Array);
      expect(incident.history.length).toBe(1);
      expect(incident.history[0].action).toBe('created');
    });

    it('should throw if title is empty', () => {
      expect(() => createIncident({ title: '', severity: 'low', assignee: 'A' }))
        .toThrow('标题不能为空');
    });

    it('should throw if severity is invalid', () => {
      expect(() => createIncident({ title: 'T', severity: 'urgent', assignee: 'A' }))
        .toThrow('严重度无效');
    });
  });

  describe('getAllIncidents', () => {
    it('should return empty array initially', () => {
      expect(getAllIncidents()).toEqual([]);
    });

    it('should return all created incidents', () => {
      createIncident({ title: 'A', severity: 'low', assignee: 'A' });
      createIncident({ title: 'B', severity: 'high', assignee: 'B' });
      expect(getAllIncidents().length).toBe(2);
    });
  });

  describe('getIncidentById', () => {
    it('should return the correct incident', () => {
      const inc = createIncident({ title: 'X', severity: 'medium', assignee: 'C' });
      expect(getIncidentById(inc.id).title).toBe('X');
    });

    it('should return null for unknown id', () => {
      expect(getIncidentById('not-exist')).toBeNull();
    });
  });

  describe('updateIncident', () => {
    it('should update fields and append history', () => {
      const inc = createIncident({ title: 'Old', severity: 'low', assignee: 'A', note: 'n1' });
      const updated = updateIncident(inc.id, { assignee: 'B', note: 'n2' });
      expect(updated.assignee).toBe('B');
      expect(updated.note).toBe('n2');
      expect(updated.history.length).toBe(2);
      expect(updated.history[1].action).toBe('updated');
    });

    it('should throw if incident not found', () => {
      expect(() => updateIncident('missing', {})).toThrow('事件不存在');
    });

    it('should not allow editing closed incident', () => {
      const inc = createIncident({ title: 'T', severity: 'low', assignee: 'A' });
      closeIncident(inc.id, '已修复');
      expect(() => updateIncident(inc.id, { note: 'x' })).toThrow('已关闭的事件不可编辑');
    });
  });

  describe('closeIncident', () => {
    it('should mark status as closed and add history', () => {
      const inc = createIncident({ title: 'T', severity: 'low', assignee: 'A' });
      const closed = closeIncident(inc.id, '问题已修复');
      expect(closed.status).toBe('closed');
      expect(closed.history[closed.history.length - 1].action).toBe('closed');
    });

    it('should throw if already closed', () => {
      const inc = createIncident({ title: 'T', severity: 'low', assignee: 'A' });
      closeIncident(inc.id, 'done');
      expect(() => closeIncident(inc.id, 'again')).toThrow('事件已关闭');
    });
  });

  describe('filterIncidents', () => {
    beforeEach(() => {
      createIncident({ title: '服务器报警', severity: 'high', assignee: '张三', status: 'open' });
      createIncident({ title: '网络延迟', severity: 'medium', assignee: '李四', status: 'open' });
      createIncident({ title: '日志清理', severity: 'low', assignee: '张三', status: 'closed' });
    });

    it('should filter by severity', () => {
      expect(filterIncidents({ severity: 'high' }).length).toBe(1);
      expect(filterIncidents({ severity: 'high' })[0].title).toBe('服务器报警');
    });

    it('should filter by status', () => {
      expect(filterIncidents({ status: 'open' }).length).toBe(2);
      expect(filterIncidents({ status: 'closed' }).length).toBe(1);
    });

    it('should filter by assignee', () => {
      expect(filterIncidents({ assignee: '张三' }).length).toBe(2);
    });

    it('should filter by keyword in title', () => {
      expect(filterIncidents({ keyword: '服务器' }).length).toBe(1);
      expect(filterIncidents({ keyword: '日志' }).length).toBe(1);
    });

    it('should combine filters', () => {
      expect(filterIncidents({ assignee: '张三', status: 'open' }).length).toBe(1);
    });
  });

  describe('isOverdue', () => {
    it('should return false for newly created incident', () => {
      const inc = createIncident({ title: 'T', severity: 'low', assignee: 'A' });
      expect(isOverdue(inc, 24)).toBe(false);
    });

    it('should return true for old open incident', () => {
      const inc = createIncident({ title: 'T', severity: 'low', assignee: 'A' });
      // 手动修改 createdAt 到 48 小时前
      inc.createdAt = Date.now() - 48 * 60 * 60 * 1000;
      expect(isOverdue(inc, 24)).toBe(true);
    });

    it('should return false for closed incidents regardless of age', () => {
      const inc = createIncident({ title: 'T', severity: 'low', assignee: 'A' });
      inc.createdAt = Date.now() - 100 * 60 * 60 * 1000;
      inc.status = 'closed';
      expect(isOverdue(inc, 24)).toBe(false);
    });
  });

  describe('exportToCSV', () => {
    it('should generate valid CSV string', () => {
      const inc = createIncident({ title: 'A",B', severity: 'low', assignee: '王五', note: '包含,逗号"和引号' });
      const csv = exportToCSV([inc]);
      expect(csv).toContain('ID,标题,严重度,负责人,状态,备注,创建时间,更新时间');
      expect(csv).toContain(inc.id);
      expect(csv).toContain('"A"",B"'); // 引号转义
    });

    it('should handle empty array', () => {
      const csv = exportToCSV([]);
      expect(csv).toContain('ID,标题,严重度,负责人,状态,备注,创建时间,更新时间');
      const lines = csv.trim().split('\n');
      expect(lines.length).toBe(1);
    });
  });

  describe('Persistence', () => {
    it('should survive localStorage round-trip', () => {
      const inc = createIncident({ title: '持久化测试', severity: 'high', assignee: 'A' });
      // 模拟刷新：重新 initStorage
      initStorage();
      const all = getAllIncidents();
      expect(all.length).toBe(1);
      expect(all[0].title).toBe('持久化测试');
    });
  });
});
