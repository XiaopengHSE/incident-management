/**
 * 数据库迁移执行脚本
 * 用法: npm run migrate
 * 职责:
 *   1. 执行 supabase/migrations 下的 DDL (建表、索引、触发器、RLS)
 *   2. 将本地 data/incidents.json 中已有的历史事件导入 Supabase (幂等)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

// 加载仓库根目录下的环境变量 (.env / .env.local)
const ROOT = path.join(__dirname, '..', '..', '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });
require('dotenv').config({ path: path.join(ROOT, '.env.local') });

const MIGRATION_FILE = path.join(ROOT, 'supabase', 'migrations', '20260828000001_init_incidents.sql');
const DATA_FILE = path.join(__dirname, '..', 'data', 'incidents.json');

function getConnectionString() {
  return process.env.POSTGRES_URL_NON_POOLING
    || process.env.POSTGRES_URL
    || process.env.DATABASE_URL;
}

async function runDdl(client) {
  const sql = fs.readFileSync(MIGRATION_FILE, 'utf8');
  console.log('[migrate] 执行 DDL:', MIGRATION_FILE);
  await client.query(sql);
  console.log('[migrate] DDL 执行完成');
}

async function importExistingData(client) {
  if (!fs.existsSync(DATA_FILE)) {
    console.log('[migrate] 未找到本地 JSON 数据文件，跳过数据导入');
    return 0;
  }

  const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const incidents = Array.isArray(parsed.incidents) ? parsed.incidents : [];
  if (incidents.length === 0) {
    console.log('[migrate] 本地 JSON 无数据，跳过数据导入');
    return 0;
  }

  let imported = 0;
  for (const inc of incidents) {
    // 幂等：已存在则跳过
    const { rowCount } = await client.query(
      'SELECT 1 FROM incidents WHERE id = $1',
      [inc.id]
    );
    if (rowCount > 0) continue;

    await client.query(
      `INSERT INTO incidents
         (id, title, severity, assignee, status, remark,
          created_at, updated_at, closed_at, idempotency_key, version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        inc.id, inc.title, inc.severity, inc.assignee || '', inc.status, inc.remark || '',
        inc.createdAt, inc.updatedAt, inc.closedAt, inc.idempotencyKey, inc.version,
      ]
    );

    for (const h of (inc.history || [])) {
      await client.query(
        'INSERT INTO incident_history (incident_id, status, time, remark) VALUES ($1, $2, $3, $4)',
        [inc.id, h.status, h.time, h.remark || '']
      );
    }
    imported++;
  }

  console.log(`[migrate] 已导入 ${imported} 条历史事件`);
  return imported;
}

async function main() {
  const connectionString = getConnectionString();
  if (!connectionString) {
    throw new Error('缺少数据库连接串 (POSTGRES_URL_NON_POOLING / POSTGRES_URL / DATABASE_URL)');
  }

  // 去除 sslmode 参数，避免 pg 将 require 当作 verify-full 导致证书链校验失败；
  // SSL 通过下方显式 ssl 配置启用，Supabase 使用自签链路，需关闭证书校验。
  const cleanConnectionString = connectionString.replace(/[?&]sslmode=[^&]*/g, '');

  const client = new Client({
    connectionString: cleanConnectionString,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    await runDdl(client);
    await importExistingData(client);
  } finally {
    await client.end();
  }

  console.log('[migrate] 迁移完成');
}

main().catch((err) => {
  console.error('[migrate] 迁移失败:', err.message);
  process.exit(1);
});
