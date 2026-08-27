/**
 * 后端 API 集成测试
 * 运行: node test.js
 */

'use strict';

const http = require('http');
const assert = require('assert');

const PORT = 3001; // 使用独立端口避免冲突
const HOST = 'localhost';

let server;

// ===== 测试工具 =====
function request(method, path, body) {
  return new Promise((resolve, reject) => {
    // 使用 URL 对象正确处理编码
    const url = new URL(path, `http://${HOST}:${PORT}`);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

let pass = 0, fail = 0;
function test(name, fn) {
  return fn().then(() => {
    pass++;
    console.log('  PASS:', name);
  }).catch(e => {
    fail++;
    console.log('  FAIL:', name, '|', e.message);
  });
}

// ===== 测试套件 =====
async function runTests() {
  console.log('============================================');
  console.log('  异常事件登记台 - 后端 API 测试');
  console.log('============================================\n');

  // 1. 健康检查
  await test('GET /api/health 应返回 ok', async () => {
    const { status, body } = await request('GET', '/api/health');
    assert.strictEqual(status, 200);
    assert.strictEqual(body.status, 'ok');
  });

  // 2. 创建事件
  let createdId;
  await test('POST /api/incidents 创建成功', async () => {
    const { status, body } = await request('POST', '/api/incidents', {
      title: '测试事件A',
      severity: '紧急',
      assignee: '测试员',
      status: '待处理',
      remark: '备注内容',
    });
    assert.strictEqual(status, 201);
    assert.strictEqual(body.success, true);
    assert.ok(body.incident.id.startsWith('inc_'));
    assert.strictEqual(body.incident.title, '测试事件A');
    createdId = body.incident.id;
  });

  await test('POST /api/incidents 空标题应 400', async () => {
    const { status, body } = await request('POST', '/api/incidents', {
      title: '', severity: '中', assignee: '', status: '待处理',
    });
    assert.strictEqual(status, 400);
    assert.strictEqual(body.success, false);
    assert.ok(body.error.message.includes('标题'));
  });

  await test('POST /api/incidents 无效状态应 400', async () => {
    const { status, body } = await request('POST', '/api/incidents', {
      title: 'X', severity: '中', assignee: '', status: '不存在',
    });
    assert.strictEqual(status, 400);
    assert.strictEqual(body.success, false);
  });

  // 3. 列表查询
  await test('GET /api/incidents 应返回列表', async () => {
    const { status, body } = await request('GET', '/api/incidents');
    assert.strictEqual(status, 200);
    assert.ok(Array.isArray(body.incidents));
    assert.ok(body.incidents.length >= 1);
  });

  await test('GET /api/incidents?status=待处理 筛选准确', async () => {
    // 先创建一条处理中的
    await request('POST', '/api/incidents', {
      title: '筛选测试-处理中', severity: '中', assignee: 'X', status: '处理中', remark: '',
    });
    const { body } = await request('GET', '/api/incidents?status=' + encodeURIComponent('待处理'));
    assert.ok(body.incidents.every(i => i.status === '待处理'));
  });

  await test('GET /api/incidents?keyword=测试 关键词筛选', async () => {
    const { body } = await request('GET', '/api/incidents?keyword=' + encodeURIComponent('测试'));
    assert.ok(body.incidents.length >= 1);
    assert.ok(body.incidents.some(i => i.title.includes('测试')));
  });

  // 4. 统计
  await test('GET /api/incidents/stats 统计准确', async () => {
    const { status, body } = await request('GET', '/api/incidents/stats');
    assert.strictEqual(status, 200);
    assert.ok(typeof body.stats.total === 'number');
    assert.ok(typeof body.stats.open === 'number');
    assert.ok(typeof body.stats.closed === 'number');
  });

  // 5. 更新事件
  await test('PATCH /api/incidents/:id 更新成功', async () => {
    const { body } = await request('PATCH', `/api/incidents/${createdId}`, {
      title: '测试事件A-已修改',
      severity: '高',
      assignee: '修改员',
      status: '处理中',
      remark: '修改备注',
    });
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.incident.title, '测试事件A-已修改');
    assert.strictEqual(body.incident.status, '处理中');
    assert.ok(body.incident.history.length >= 2);
  });

  await test('PATCH /api/incidents/:id 无效迁移应 403', async () => {
    // 尝试从处理中直接改回已关闭（不允许）
    // 先创建一个已解决的
    const { body: created } = await request('POST', '/api/incidents', {
      title: '状态机测试', severity: '低', assignee: 'X', status: '已解决', remark: '',
    });
    // 已解决 -> 待处理 是允许的，已解决 -> 已关闭 也是允许的
    // 测试已关闭 -> 处理中（不允许）
    const { body: closed } = await request('POST', `/api/incidents/${created.incident.id}/close`, { remark: '' });
    const { status, body } = await request('PATCH', `/api/incidents/${created.incident.id}`, {
      title: 'X', severity: '低', assignee: '', status: '处理中', remark: '',
    });
    assert.strictEqual(status, 403);
    assert.strictEqual(body.success, false);
  });

  await test('PATCH /api/incidents/:id 乐观锁冲突应 409', async () => {
    const { body: created } = await request('POST', '/api/incidents', {
      title: '乐观锁测试', severity: '低', assignee: 'X', status: '待处理', remark: '',
    });
    const id = created.incident.id;
    // 第一次更新（版本 1 -> 2）
    await request('PATCH', `/api/incidents/${id}`, {
      title: '乐观锁测试', severity: '低', assignee: 'X', status: '处理中', remark: '', version: 1,
    });
    // 第二次用旧版本号更新应失败
    const { status, body } = await request('PATCH', `/api/incidents/${id}`, {
      title: '乐观锁测试', severity: '低', assignee: 'X', status: '处理中', remark: '', version: 1,
    });
    assert.strictEqual(status, 409);
    assert.strictEqual(body.success, false);
    assert.ok(body.error.message.includes('已被他人修改'));
  });

  // 6. 关闭事件
  await test('POST /api/incidents/:id/close 关闭成功', async () => {
    const { body: created } = await request('POST', '/api/incidents', {
      title: '待关闭', severity: '低', assignee: 'C', status: '处理中', remark: '',
    });
    const { status, body } = await request('POST', `/api/incidents/${created.body.incident.id}/close`, { remark: '问题已修复' });
    assert.strictEqual(status, 200);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.incident.status, '已关闭');
  });

  await test('POST /api/incidents/:id/close 重复关闭应 409', async () => {
    const { body: created } = await request('POST', '/api/incidents', {
      title: '重复关闭测试', severity: '低', assignee: 'C', status: '待处理', remark: '',
    });
    const id = created.incident.id;
    await request('POST', `/api/incidents/${id}/close`, { remark: '' });
    const { status, body } = await request('POST', `/api/incidents/${id}/close`, { remark: '' });
    assert.strictEqual(status, 409);
    assert.strictEqual(body.success, false);
  });

  // 7. 详情
  await test('GET /api/incidents/:id 详情准确', async () => {
    const { body } = await request('GET', `/api/incidents/${createdId}`);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.incident.id, createdId);
  });

  await test('GET /api/incidents/:id 不存在应 404', async () => {
    const { status, body } = await request('GET', '/api/incidents/inc_not_exist');
    assert.strictEqual(status, 404);
    assert.strictEqual(body.success, false);
  });

  // 8. 幂等性
  await test('POST /api/incidents 幂等键重复应返回已有数据', async () => {
    const key = 'idem_test_' + Date.now();
    const { body: first } = await request('POST', '/api/incidents', {
      title: '幂等测试', severity: '低', assignee: 'X', status: '待处理', remark: '', idempotencyKey: key,
    });
    const { status, body } = await request('POST', '/api/incidents', {
      title: '幂等测试-不同标题', severity: '低', assignee: 'X', status: '待处理', remark: '', idempotencyKey: key,
    });
    assert.strictEqual(status, 200);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body._idempotent, true);
    assert.strictEqual(body.incident.id, first.body.incident.id);
  });

  // 9. 导出
  await test('GET /api/incidents/export/json 应返回 JSON', async () => {
    const { status, body } = await request('GET', '/api/incidents/export/json');
    assert.strictEqual(status, 200);
    assert.ok(typeof body === 'string' || typeof body === 'object');
  });

  // 10. 404
  await test('GET /api/notexist 应 404', async () => {
    const { status } = await request('GET', '/api/notexist');
    assert.strictEqual(status, 404);
  });

  // 汇总
  console.log('\n============================================');
  console.log(`  总计: ${pass + fail} | 通过: ${pass} | 失败: ${fail}`);
  console.log('============================================');
}

// ===== 启动测试服务器 =====
const app = require('./server');
// 覆盖端口
const originalPort = app.get ? undefined : undefined;

// 清理数据文件
const fs = require('fs');
const path = require('path');
const dataFile = path.join(__dirname, 'data', 'incidents.json');
if (fs.existsSync(dataFile)) fs.unlinkSync(dataFile);

// 启动临时服务器
server = app.listen(PORT, async () => {
  console.log(`测试服务器启动于端口 ${PORT}\n`);
  try {
    await runTests();
  } finally {
    server.close();
    process.exit(fail > 0 ? 1 : 0);
  }
});
