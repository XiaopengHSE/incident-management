# 异常事件登记台

前后端分离的异常事件管理系统。纯本地运行，无需外部依赖，不连接真实业务系统，不发送真实消息。

## 架构概览

```
┌─────────────┐     HTTP /fetch      ┌─────────────┐
│   浏览器     │ ◄──────────────────► │  Express    │
│  (index.html)│                      │  (server.js) │
├─────────────┤                      ├─────────────┤
│ api.js      │                      │ routes/     │
│ - API 客户端 │                      │ - REST API  │
│ - 加载状态   │                      │             │
│ - 错误处理   │                      │ middleware/ │
│ - 缓存刷新   │                      │ - 请求日志   │
│             │                      │ - 错误追踪   │
│ app.js      │                      │ - 请求校验   │
│ - 状态管理   │                      │             │
│ - 业务封装   │                      │ domain/     │
│ - 表单校验   │                      │ - 状态机    │
│             │                      │ - 权限规则   │
│             │                      │ - 幂等控制   │
│             │                      │             │
│             │                      │ data/       │
│             │                      │ - JSON 存储  │
│             │                      │ - 原子写入   │
└─────────────┘                      └─────────────┘
```

## 快速开始

### 1. 启动后端

```bash
cd backend
node server.js
```

后端服务默认监听 `http://localhost:3000`，API 前缀为 `/api/incidents`。

### 2. 打开前端

浏览器访问 `http://localhost:3000` 即可使用完整功能。

> 后端 `server.js` 已通过 `express.static` 托管了前端文件，无需额外启动前端服务器。

### 3. 运行测试

**后端 API 测试：**
```bash
cd backend
node test.js
```

**前端浏览器测试：**
浏览器直接打开 `tests.html`（使用 localStorage 独立测试前端 UI 逻辑）。

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/incidents` | 列表查询（支持 `?status=&severity=&assignee=&keyword=`） |
| GET | `/api/incidents/stats` | 统计数据 |
| POST | `/api/incidents` | 创建事件 |
| GET | `/api/incidents/:id` | 事件详情 |
| PATCH | `/api/incidents/:id` | 更新事件（支持乐观锁 `version`） |
| POST | `/api/incidents/:id/close` | 关闭事件 |
| GET | `/api/incidents/export/:format` | 导出（`json` 或 `csv`） |

## 领域规则

- **状态迁移**：待处理 ↔ 处理中 ↔ 已解决 → 已关闭（终态不可迁出）
- **权限控制**：已关闭事件不可编辑/关闭
- **乐观锁**：更新/关闭时传入 `version` 防止并发冲突
- **幂等性**：创建时传入 `idempotencyKey`，重复请求返回已有数据
- **超时规则**：紧急 4h / 高 24h / 中 72h / 低 7d

## 数据与观测

- **数据存储**：`backend/data/incidents.json`（自动创建）
- **请求日志**：`backend/logs/access.log`
- **错误追踪**：`backend/logs/error.log` + `backend/logs/trace.log`
- **数据备份**：`backend/data/backups/`（自动保留最近 20 份）

## 技术栈

- **后端**：Node.js + Express + CORS
- **前端**：原生 HTML/CSS/JS（无框架依赖）
- **存储**：JSON 文件（原子写入）
- **测试**：Node.js assert + 浏览器原生测试
