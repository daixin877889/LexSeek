# 合同审查 M7 Playbook + 管理端 API + 权限隔离 审计报告

> 审计范围：M7 Playbook 业务（clinical：DB schema / DAO / 快照冻结 / matchedPointCode 白名单 / stancePreference / 管理端 CRUD / 管理端 UI / 权限隔离铁律）
> 权威需求源：`docs/superpowers/specs/2026-04-21-contract-review-playbook-design.md`
> 审计者：auditor-playbook-admin
> 日期：2026-04-24
>
> **总结：核心铁律（管理端/用户端物理隔离、快照冻结、白名单校验）全部通过；2 个中等问题 + 3 个低问题需补修，无 CRITICAL。**

---

## 1. 结论一览

| 维度 | 结论 |
|------|------|
| 铁律：管理端/用户端物理隔离 | ✅ 完全合规 |
| 用户端 owner-only，无 `checkIsSuperAdmin` 旁路 | ✅ |
| 管理端路径全由 `03.permission.ts` 拦截 | ✅ |
| Playbook 快照冻结机制 | ✅（review 表 `playbookSnapshot` 只在 resume 分支一次写入） |
| `matchedPointCode` 白名单校验 | ✅（analyzeSingleClause.ts L138-152） |
| `stancePreference` prompt 注入 | ✅（prompt 28 模板内置立场组合规则 + `{{playbookSection}}` 占位符） |
| 合同类型与 `CONTRACT_TYPE_OPTIONS` 对齐 | ✅ |
| 管理端 UI CRUD 完整性 | ✅ 符合 v1 范围（无 DELETE、无拖拽） |
| 权限泄露 | ✅ 未发现鉴权缺失接口 |
| 日志/错误处理 | ✅ 覆盖完整 |

---

## 2. CRITICAL / HIGH 问题

**无。**

---

## 3. MEDIUM 问题

### M1：`z.coerce.boolean()` 对字符串 `"false"` 会返回 `true`（已知 Zod 语义坑）

**位置**：
- `server/api/v1/admin/contract-playbooks/index.get.ts:17` — `enabled: z.coerce.boolean().optional()`
- `server/api/v1/admin/contract-reviews/index.get.ts:28` — `includeDeleted: z.coerce.boolean().optional().default(false)`

**问题**：
`z.coerce.boolean()` 底层调用 `Boolean(value)`。对 GET query 里的字符串，`Boolean("false")` → `true`，`Boolean("0")` → `true`。这意味着任何非空字符串都被当作 `true`，`?enabled=false` 实际等价于 `?enabled=true`。

**当前影响**：
- `contract-playbooks/index.get.ts`：管理端页面实际只会发 `?enabled=true`（见 `app/pages/admin/contract-playbooks/index.vue:72`），后端另一个请求不带 enabled 参数，所以此坑**暂未触发**，但一旦前端加"仅停用"过滤就会挂。
- `contract-reviews/index.get.ts`：`includeDeleted=false` 是默认值，前端目前也没实际传 `false`，但"显示已删除"复选框会发 `includeDeleted=true`，正常工作；若未来改为发显式 `false` 会挂。

**建议修复**：
```ts
enabled: z.union([z.literal('true'), z.literal('false')]).transform(v => v === 'true').optional()
// 或
enabled: z.enum(['true', 'false']).transform(v => v === 'true').optional()
```

### M2：管理端 `contract-playbooks` 未登记 `api_permissions` 与 `routers` seed，依赖兜底机制

**位置**：`prisma/seeds/seedData.sql`

**问题**：
- 全文件搜索 `contract-playbooks` 仅命中 1 处（`contract_playbooks` 表的数据 INSERT），**无** `api_permissions` 的路径登记、**无** `routers` 的菜单项登记。
- 对比：同期新增的 `/admin/contract-reviews` 在 seedData.sql 里显式登记了 `routers`（id=339/548）和 `api_permissions`（id=278-281）。

**当前影响**：
- 权限：由于 `03.permission.ts` 走权限表查询，**未登记 = 非 super_admin 一律 403**。这**刚好满足** spec §3.1 "super_admin only"，但是**意外结果**而非主动设计。如果运营希望把此菜单授权给"内容运营"角色（非超管），目前无路径——缺少对应 api_permissions 行可挂到角色。
- 菜单：`menu-routers.get.ts` 有磁盘扫描兜底（L112-135），对超管可见但显示"未归组（请补录 router）"——UX 不佳。非超管即使被授权也看不到菜单入口。

**建议修复**：
在 `seedData.sql` 补登记：
```sql
-- api_permissions（4 条：GET list / POST create / PATCH update / 若未来加 DELETE 再补）
INSERT INTO api_permissions (path, method, name, ...) VALUES
  ('/api/v1/admin/contract-playbooks', 'GET',  'GET admin / contract-playbooks',  ...),
  ('/api/v1/admin/contract-playbooks', 'POST', 'POST admin / contract-playbooks', ...),
  ('/api/v1/admin/contract-playbooks/:id', 'PATCH', 'PATCH admin / contract-playbooks / [id]', ...);

-- routers（菜单项）
INSERT INTO routers (name, title, path, is_menu, icon, ...) VALUES
  ('admin-contract-playbooks', '审查清单管理', '/admin/contract-playbooks', 't', 'ListChecksIcon', ...);
```
注意走正式 Prisma 迁移流程：先改 seed、在新环境 `prisma migrate deploy` 时自然应用；不要手工写入运行数据库。

---

## 4. LOW 问题

### L1：种子数据每类 1 条占位（spec 承诺 10~15 条）

**位置**：`prisma/seeds/seedData.sql` L2269-2308

**问题**：
spec §3.5 承诺"预置 6 类 × 10~15 条 ≈ 70 条要点"；实际 seed 只有 6 条（每类 1 条）。spec 注释解释"运营在后台补齐其余"，但交付说明与 spec 正文不一致。

**影响**：生产首发如果运营没来得及补齐，90% 条款进入 AI 清单前是"空"的，spec §4.3 降级策略会把所有类型当成"无清单"审查，跟 Playbook 上线前行为一致但 spec §6.1 的 Phase 2 承诺打折。

**建议**：
- 要么：发版前法律顾问补齐 seed 数据。
- 要么：更新 spec §3.5 明确"首发先由运营手工录入，seed 不强制完备"。

### L2：`contract-reviews/index.get.ts` 搜索模糊关键词暴露跨用户文件名

**位置**：`server/api/v1/admin/contract-reviews/index.get.ts:26` — `q: z.string().min(1).max(100).optional()`

**说明**：管理端允许跨用户模糊搜原文件名——这是管理端设计内预期行为（non-blocking），列入"管理端权限包含此特权"的明示。日志里记录了 `adminUserId`，留痕充分。

**建议**：无需修复，仅提醒 Code Review 时注意该权限粒度属设计选型。

### L3：`contractReviewMainAgent.ts:433` 写快照异常吞掉且无 metric

**位置**：`server/services/workflow/agents/contractReviewMainAgent.ts:450-455`

**问题**：
```ts
} catch (err) {
    logger.warn('Playbook 快照写入失败，降级为无清单审查', {...})
}
```
异常只输出 warn 日志，但当前无 `metric` 统计；若 DB 长期异常，监控看板不会立即感知"清单对照功能哑火"。spec §4.3 降级策略 OK，但缺**可观测性**。

**建议**：按项目现有 metric 框架（`logger` + 若接入 Sentry/Prometheus 也补一次 counter），追加 `metric.increment('contract_review.playbook_snapshot_failed')`。

---

## 5. 正向确认（符合设计的关键点）

### 5.1 管理端/用户端物理隔离（铁律）✅

对照 `.claude/rules/api.md` 的"系统级规则"逐项验：

| 条目 | 对照结果 |
|------|---------|
| 用户端 `/api/v1/assistant/contract/**` 严格 owner-only | ✅ `reviewGuard.ts:56-59` 即使是 super_admin 也会被 403 挡掉（`review.userId !== user.id`） |
| 用户端接口未使用 `checkIsSuperAdmin` 旁路 | ✅ `grep -rn checkIsSuperAdmin server/api/v1/assistant/contract/` 无命中 |
| 管理端路径位于 `server/api/v1/admin/**` | ✅ `contract-playbooks/` 与 `contract-reviews/` 皆在此 |
| 管理端路由由 `03.permission.ts` 统一拦截 | ✅ 权限表无 playbook 相关条目，非 super_admin 一律 403（见 M2）；super_admin 走 `permission.service.ts:223-225` 放行 |
| 同一资源两端物理分离，不共享 handler | ✅ `contract-reviews` 两套：用户端 `reviews/[id].get.ts`（loadOwnedReview）vs 管理端 `admin/contract-reviews/[id].get.ts`（getAdminReviewDAO 无 owner 过滤） |

### 5.2 快照冻结机制 ✅

- **唯一写入点**：`contractReviewMainAgent.ts:443`（resume 分支内，stance 落库之后、analyze 开始之前），与 spec §4.2.1 位置完全一致。
- **全代码全局搜索** `playbookSnapshot` 的写入：仅此一处 `updateContractReviewDAO(...{ playbookSnapshot })`，后续 rebuild / version / uploadClientVersion 路径**只读不写**。
- **uploadClientVersion.service.ts:403** 正确复用原始 `review.playbookSnapshot`（客户回传后的增量审查仍用原始清单，符合"快照冻结"语义）。
- **版本快照** `contractReviewVersions.snapshotData` 包含 `risks + annotations + docxText + clauses`，**不**重复存 `playbookSnapshot`——正确，因为 review 表本身已冻结，版本展示时从 `review.playbookSnapshot` 读即可。spec §1.3 的疑问（"版本保存时 playbookSnapshot 是否也冻结到 version snapshot"）答案是"不需要，review 级别已冻结"，设计合理。

### 5.3 matchedPointCode 白名单校验 ✅

位置：`server/services/assistant/contract/analyzeSingleClause.ts:135-152`

```ts
let matchedPointCode: string | undefined = (rawRisk.matchedPointCode?.trim() || undefined)
if (matchedPointCode && ctx.playbookSnapshot) {
    const validCodes = new Set(ctx.playbookSnapshot.points.map(p => p.code))
    if (!validCodes.has(matchedPointCode)) {
        logger.warn('analyzeSingleClause: AI 返回未知的 matchedPointCode，降级为清单外', {...})
        matchedPointCode = undefined
    }
}
if (matchedPointCode && !ctx.playbookSnapshot) {
    matchedPointCode = undefined   // snapshot 为空时 AI 不该返 code，静默忽略
}
```

三条降级路径（非法 code / 无 snapshot / 漏返）全部覆盖，与 spec §4.3 的降级表完全对齐。

### 5.4 stancePreference 注入 prompt ✅

- **DB 字段**：`contractPlaybook.prisma:13-14` 默认 `'balanced'`，VARCHAR(10)，无 CHECK（按 spec §4.1.1 应用层校验）。
- **应用层校验**：admin POST/PATCH 端点都用 `z.enum(['strict','balanced','lenient'])` 强校验。
- **prompt 模板**：seed 的 prompt id=28 包含静态"立场偏好使用规则"段落（`seedData.sql:2194-2199`），与 spec §4.1.4 的 C 方案语义对齐。
- **渲染链路**：`analyzeSingleClause.ts:199-212` `renderPlaybookSection()` 把 `stancePreference` 作为 `[立场:strict/balanced/lenient]` 渲染到 prompt 段，AI 可见。

### 5.5 合同类型与 CONTRACT_TYPE_OPTIONS 对齐 ✅

- **定义源**：`shared/types/contract.ts:27-35` 共 7 种（劳动 / 租赁 / 买卖 / 服务 / 借款 / 保密 / 其他）
- **新建审查 AI 识别**：`CONTRACT_TYPE_OPTIONS` 用于 partyDetector 的 prompt 提示（代码侧读取同一常量）
- **Playbook POST 校验**：`z.enum(CONTRACT_TYPE_OPTIONS)` 确保运营只能选这 7 种
- **管理端 UI**：`app/pages/admin/contract-playbooks/index.vue:37` 过滤掉"其他"（符合 spec §1.2 "其他"类型不配清单）
- **listEnabledPlaybookPointsDAO** 按 `contractType` 精确匹配，resume 分支写快照前先判 `review.contractType !== '其他'`（contractReviewMainAgent.ts:434），双重保险

### 5.6 PATCH 接口正确拒绝修改 contractType/code ✅

`[id].patch.ts:13-21` BodySchema 不包含 `contractType`/`code` 字段，传入这两个字段会被 Zod silently drop（非 `.strict()`），历史快照引用的 code 稳定性得到保障。注释 L4 明确指出"如需改，先停用再新建"。

### 5.7 管理端 UI 完整度 ✅（v1 范围）

- `app/pages/admin/contract-playbooks/index.vue`：左右分栏、Tab（6 种）+ 启用数徽章、筛选（全部/仅启用/仅停用）、按 code 自然序列表、编辑抽屉（Sheet）、启用开关 Switch、纯 lucide 图标、shadcn-vue Badge/Dialog/Sheet 全部正确使用（未违反 UI 铁律）。
- `app/pages/admin/contract-reviews/index.vue` + `[id].vue`：列表（跨用户）+ 详情（含软删展示）+ 软删按钮，符合管理端权限范围。
- 未实现：DELETE 按钮（正确）、拖拽排序（正确）——与 spec §3.4 一致。

### 5.8 审计日志覆盖 ✅

所有管理端 API 的 catch 分支都写了 `logger.error('[admin] ...', { userId: user.id, ... })`，留痕充分。用户端 reviewGuard 也通过 `logger.warn/info` 覆盖 403 场景。

---

## 6. 未覆盖但超出本次审计范围

- M7 Phase 2 端到端验收（chrome-devtools E2E）：由 auditor 不执行 E2E，仅做代码审计。
- prompt 模板的 AI 真实输出质量：需运行时观察 matchedPointCode 正确率（spec §7 已列为 Risk 1）。
- i18n：本次所有文案中文硬编码，与项目惯例一致。

---

## 7. 修复优先级建议

| 优先级 | 条目 | 预计工作量 |
|--------|------|-----------|
| P1 | M2：补 `api_permissions` + `routers` seed | 0.5h |
| P1 | M1：`z.coerce.boolean()` 改 `z.enum(['true','false']).transform` | 0.3h |
| P2 | L1：补齐 70 条 playbook seed（需法律顾问协作） | 独立跟踪 |
| P3 | L3：快照写入失败补 metric | 0.2h |
| - | L2：无需修复 | - |

---

**审计完成。Playbook + 管理端 API + 权限隔离三大铁律全部通过，可进入 Phase 2 上线流程。**
