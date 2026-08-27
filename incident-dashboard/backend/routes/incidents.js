/**
 * API 路由层: 事件管理 REST API
 * 职责: 接收请求 -> 调用校验 -> 调用领域逻辑 -> 调用仓库 -> 返回响应
 */

'use strict';

const express = require('express');
const router = express.Router();

const repo = require('../data/repository');
const domain = require('../domain/incident');
const {
  validateCreateIncident,
  validateUpdateIncident,
  validateCloseIncident,
} = require('../middleware/validator');

// ========== GET /api/incidents - 列表查询 ==========
router.get('/', (req, res, next) => {
  try {
    const filter = {
      status: req.query.status || undefined,
      severity: req.query.severity || undefined,
      assignee: req.query.assignee || undefined,
      keyword: req.query.keyword || undefined,
      excludeClosed: req.query.excludeClosed === 'true',
    };
    const incidents = repo.list(filter);
    res.json({ success: true, incidents });
  } catch (e) {
    next(e);
  }
});

// ========== GET /api/incidents/stats - 统计 ==========
router.get('/stats', (req, res, next) => {
  try {
    const stats = repo.getStats();
    const all = repo.list({ excludeClosed: true });
    stats.overdue = all.filter(domain.isOverdue).length;
    res.json({ success: true, stats });
  } catch (e) {
    next(e);
  }
});

// ========== POST /api/incidents - 创建事件 ==========
router.post('/', validateCreateIncident, (req, res, next) => {
  try {
    const { title, severity, assignee, status, remark, idempotencyKey } = req.body;

    // 幂等校验
    if (idempotencyKey) {
      const existing = repo.findByIdempotencyKey(idempotencyKey);
      domain.checkIdempotency(existing, idempotencyKey);
    }

    const incident = domain.createEventEntity({
      title, severity, assignee, status, remark, idempotencyKey
    });

    repo.insert(incident);
    res.status(201).json({ success: true, incident });
  } catch (e) {
    next(e);
  }
});

// ========== GET /api/incidents/:id - 详情 ==========
router.get('/:id', (req, res, next) => {
  try {
    const incident = repo.findById(req.params.id);
    if (!incident) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: '事件不存在' },
      });
    }
    res.json({ success: true, incident });
  } catch (e) {
    next(e);
  }
});

// ========== PATCH /api/incidents/:id - 更新事件 ==========
router.patch('/:id', validateUpdateIncident, (req, res, next) => {
  try {
    const { title, severity, assignee, status, remark } = req.body;
    const expectedVersion = req.body.version !== undefined
      ? parseInt(req.body.version, 10)
      : undefined;

    const updated = repo.update(req.params.id, (incident) => {
      return domain.updateEventEntity(incident, {
        title, severity, assignee, status, remark
      }, expectedVersion);
    });

    if (!updated) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: '事件不存在' },
      });
    }

    res.json({ success: true, incident: updated });
  } catch (e) {
    next(e);
  }
});

// ========== POST /api/incidents/:id/close - 关闭事件 ==========
router.post('/:id/close', validateCloseIncident, (req, res, next) => {
  try {
    const { remark } = req.body || {};
    const expectedVersion = req.body && req.body.version !== undefined
      ? parseInt(req.body.version, 10)
      : undefined;

    const closed = repo.update(req.params.id, (incident) => {
      return domain.closeEventEntity(incident, remark, expectedVersion);
    });

    if (!closed) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: '事件不存在' },
      });
    }

    res.json({ success: true, incident: closed });
  } catch (e) {
    next(e);
  }
});

// ========== GET /api/incidents/export/:format - 导出 ==========
router.get('/export/:format', (req, res, next) => {
  try {
    const format = req.params.format;
    if (format === 'json') {
      const json = repo.exportJSON();
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="incidents-${new Date().toISOString().slice(0,10)}.json"`);
      res.send(json);
    } else if (format === 'csv') {
      const csv = '\uFEFF' + repo.exportCSV();
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="incidents-${new Date().toISOString().slice(0,10)}.csv"`);
      res.send(csv);
    } else {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION', message: '导出格式必须是 json 或 csv' },
      });
    }
  } catch (e) {
    next(e);
  }
});

module.exports = router;
