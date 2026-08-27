# 错误修复记录

## Fix #1 — localStorage 数据迁移导致的筛选失效

### 现象
测试 `testFilterByStatus` 失败：筛选"处理中"状态时返回空数组，但预期应返回 1 条。

### 根因
事件对象的 `status` 字段在编辑时从中文 `"处理中"` 被意外替换为英文 `"in_progress"`（编辑表单 option value 与显示文本不一致）。导致列表渲染时状态筛选匹配失败。

### 修复
统一编辑表单中 `<option>` 的 `value` 属性与显示文本为中文，与创建表单保持一致：
```html
<!-- 修复前 -->
<option value="in_progress">处理中</option>

<!-- 修复后 -->
<option value="处理中">处理中</option>
```

### 验证
重新运行 `tests.html`，`testFilterByStatus` 通过，全部 12 项测试绿色。
