# 合同审查 Playbook（按合同类型的审查清单）设计

> 编号：M7 · contract-review-playbook
> 定稿日：2026-04-21
> 前置依赖：M6.1（分档总览 + 引用跳转）已发布
> 后续依赖：#3 对话化批注、#4 追踪修订（复用本期的命中要点与标准建议）

---

## 0. 一句话概括

给每个合同类型配一份可维护的"审查清单"，AI 逐条审查时对照清单，结果页呈现"对照 N 条命中 M 条"，历史报告永久冻结当时使用的清单快照。

---

## 1. 产品边界

### 1.1 目标痛点

当前所有合同类型共用同一套通用审查 prompt，漏判率高且体感差（用户感觉不到"系统针对这类合同做过针对性设计"）。Playbook 通过"按类型定制要点清单"让 AI 审查更精准、让用户看到可度量的对照结果。

### 1.2 覆盖范围

- 发版时覆盖 6 种合同类型（劳动 / 租赁 / 买卖 / 服务 / 借款 / 保密协议），各预置 10~15 条要点。
- "其他"类型不配清单，走老流程降级，总览区不显示清单板块。
- AI 发现的清单外风险正常显示，不会被清单"吃掉"。

### 1.3 核心承诺

- **快照冻结**：每次审查的清单是提交那一刻的快照，永久不变。运营后续修改只影响新审查。
- **零新增用户心智**：用户不选清单、不预览清单；系统按合同类型自动挂。
- **AI 自由度保留**：清单是增量燃料不是枷锁，AI 仍可发现清单外的重要风险。
- **立场偏好语义**：每条要点附带 `stance_preference`（strict / balanced / lenient），和用户立场（甲方 / 乙方 / 中立）联合作用于 AI 审查口径；该语义同时是后续 #3 对话化批注、#4 追踪修订的共享锚点。

### 1.4 本期不做

- 用户自建清单（未来"律所版"再议）。
- 用户提交前的清单预览页。
- 用户手动改 AI 的命中判定（AI 判错可通过"新增/编辑风险"间接修正）。
- "其他"类型的通用清单。
- 清单版本号发布流程、审批工作流、A/B 灰度、效果统计看板。
- 跨类型要点复制、批量导入。
- 要点硬删除（v1 只停用，不提供 DELETE 接口）。
- 要点手动拖拽排序（v1 按 `code` 自然序）。

---

## 2. 用户端体感

### 2.1 提交审查

与 Playbook 上线前完全一致。系统识别出合同类型后自动挂清单，用户无感。

### 2.2 审查过程

顶部阶段进度条保持 5 段（识别 → 立场 → 切分 → 分析 → 汇总），不新增阶段。
"分析"阶段单条 prompt 多带 2000~4000 字清单内容，单条响应时间预计增加 10~20%（主流模型可忽略）。

### 2.3 结果页 · 总览新增"清单对照"板块

位置：总评下方、"新增风险"按钮上方，默认展开。

示意样式：

```
审查清单 · 劳动合同                     命中 3 / 12
─────────────────────────────────
⚠ 试用期约定合规性（高）    → 跳到第 2.1 条
⚠ 加班费基数（中）          → 跳到第 5.3 条
⚠ 竞业补偿上限（中）        → 跳到第 9.2 条
─────────────────────────────────
✓ 未命中 9 条（点击展开）
   · 工时制度
   · 社保缴纳
   · 年休假安排
   · ...（展开后列出全部要点标题）
```

- 命中项：点击跳转对应合同条款（复用现有要点跳转逻辑）。
- 未命中项：默认折叠为一行，展开后只显示要点标题；不提供跳转（无对应条款）。

### 2.4 风险卡片 · 要点徽章

每条风险卡片标题行多一个灰色小徽章，形如：`⚠·试用期约定合规性`。

- **组件复用**：直接用 `app/components/ui/badge/Badge.vue`（shadcn-vue 已装），`variant="secondary"` 灰色风格；禁止修改 `components/ui/` 下文件。
- **深色模式**：shadcn Badge 自带 dark 适配，无需额外工作。
- hover / 点击徽章：tooltip（shadcn `Tooltip` 组件）展示该要点全文（检查内容 / 法律依据 / 标准建议 / 立场偏好）。
- 清单外的风险：不显示徽章，其余样式不变。

### 2.5 "其他"类型合同

总览区不显示"清单对照"板块，风险卡不带徽章，体感与 Playbook 上线前完全一致。

### 2.6 历史审查

快照冻结：两个月前的审查今天打开，看到的清单仍是当时的版本。运营在此期间新增/修改要点不影响历史报告。

### 2.7 导出评审报告（PDF）

PDF 在"总览"后新增一节"审查清单对照"，内容与页面所见一致（命中项 + 未命中项列表）。

---

## 3. 运营端

### 3.1 入口

后台左侧菜单新增："审查清单管理"，路径 `/admin/contract-playbooks`。权限：super_admin only（由现有 `server/middleware/03.permission.ts` 中间件保护）。

**菜单注册**：新菜单项需在 `server/api/v1/admin/menu-routers.get.ts` 的返回结构中声明一条，与 `/admin/document-templates` 并列放置，否则超管登录后导航栏看不到入口。

### 3.2 页面布局

**左右分栏**

- 左侧 200px 宽：合同类型 Tab（6 项，每项后面显示启用要点数）。
- 右侧：要点列表 + 工具栏。

**右侧工具栏**

`[+ 新增要点]` · 标题搜索框 · 启用状态筛选下拉（全部 / 仅启用 / 仅停用）。

**要点列表**

按 `code` 自然序显示（v1 不做手动排序，下一版再考虑）。字段列：序号 · 标题 · 等级 · 立场偏好 · 启用开关 · 更新时间 · 操作（编辑 / 停用）。

### 3.3 要点编辑抽屉

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| 标题 | string(30) | 是 | 要点简称，展示在徽章与清单列表 |
| 默认等级 | enum(high/medium/low) | 是 | AI 判定风险级别的参考基线 |
| 立场偏好 | enum(strict/balanced/lenient) | 是 | 针对用户立场的审查严格度：strict=在用户立场下必须严格审查、balanced=中性、lenient=用户立场下可宽松对待。AI prompt 会据此调整判定口径 |
| 检查内容 | text(≤500 字) | 是 | 给 AI 看的指导语 |
| 法律依据 | text(≤300 字) | 否 | 引用法条，命中时显示在风险卡详情 |
| 标准建议 | text(≤500 字) | 否 | 违反时的推荐改法，AI 会参考；后续 #4 追踪修订功能将直接用此字段作为修订文本基线 |
| 启用状态 | bool | 是 | 关闭的要点不喂给 AI，但历史快照仍可引用 |

### 3.4 操作语义

- **新增 / 编辑**：立即对新审查生效；历史审查不受影响（快照已冻结）。
- **停用**：软下线语义，不喂给 AI，但历史快照中引用的要点仍完整显示。
- **删除**：v1 不支持硬删除，只能"停用"。UI 操作列不显示"删除"按钮。v2 再按需增加"从未被引用可硬删"能力（届时再扫 `playbook_snapshot->'points'` 的 `code`）。
- **排序**：v1 按 `code` 自然序显示。手动拖拽排序推到 v2，届时再引入 `sort_order` 字段与 reorder 接口。

### 3.5 种子数据

`seedData.sql` 预置 6 类 × 10~15 条 ≈ 70 条要点（由项目组 + 法律顾问合作编写）。种子数据遵守现有规范：`ON CONFLICT (name) DO NOTHING` 保证幂等。

---

## 4. 系统设计（概念层）

### 4.0 迁移策略（强制）

所有数据库变更**必须**走 `.claude/rules/database.md` 规定的 Prisma 迁移流程：

1. 修改 `prisma/models/*.prisma`（新增 `contractPlaybook.prisma` 模型 + 在 `contractReview.prisma` 加 `playbookSnapshot Json?`）。
2. 执行 `bun run prisma:migrate --name add_contract_playbooks`（或 `--create-only` 后手工审核）。
3. PR 提交前确认 `bun run prisma:generate` 已同步 `generated/prisma/**`；`prisma migrate status` 显示 "Database schema is up to date"。

**禁止**：手写 SQL 脚本、`db push`、直接编辑 `prisma/migrations/**`。

`playbook_snapshot jsonb NULL` 是新增列（非类型改），无需 USING 子句。

### 4.1 数据结构

#### 4.1.1 新增表：`contract_playbooks`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | serial PK | | |
| contract_type | varchar(50) | NOT NULL | 与 `CONTRACT_TYPE_OPTIONS` 对齐的字符串；DB 不加外键枚举，容错 |
| code | varchar(20) | NOT NULL + (contract_type, code) UNIQUE | 如 "probation"、"overtime"；作为快照引用的稳定标识 |
| title | varchar(30) | NOT NULL | |
| default_level | varchar(10) | NOT NULL CHECK in ('high','medium','low') | AI 判定风险级别的基线 |
| stance_preference | varchar(10) | NOT NULL CHECK in ('strict','balanced','lenient') DEFAULT 'balanced' | 针对用户立场的审查严格度；#3 对话批注、#4 追踪修订将基于此决定 AI 语气与建议力度 |
| check_content | text | NOT NULL | 给 AI 的指导语 |
| legal_basis | text | NULL | 法律依据（可选） |
| suggestion | text | NULL | 违反时的标准建议；#4 追踪修订将直接用作修订文本基线 |
| enabled | boolean | NOT NULL DEFAULT true | |
| created_at | timestamptz | NOT NULL DEFAULT now() | |
| updated_at | timestamptz | NOT NULL DEFAULT now() | |
| deleted_at | timestamptz | NULL | 软删除（v1 仅通过 `enabled=false` 停用，不做硬删；字段保留为 v2 删除能力预留） |

索引：`(contract_type, enabled, code)` 支持按类型拉启用要点列表。

#### 4.1.2 扩展表：`contract_reviews`

新增字段 `playbook_snapshot jsonb NULL`。

**类型定义位置**：`shared/types/contract.ts` 新增 export `PlaybookSnapshot`、`PlaybookPointSnapshot`、`StancePreference`。

```ts
export type StancePreference = 'strict' | 'balanced' | 'lenient'

export interface PlaybookPointSnapshot {
    code: string
    title: string
    defaultLevel: 'high' | 'medium' | 'low'
    stancePreference: StancePreference
    checkContent: string
    legalBasis?: string
    suggestion?: string
}

export interface PlaybookSnapshot {
    contractType: string
    points: PlaybookPointSnapshot[]
    snapshotAt: string  // ISO 时间戳，便于 UI 显示"本审查使用清单版本快照于 YYYY-MM-DD"
}
```

- 快照在 `detect 阶段完成 → analyze 阶段开始之前`写入（resume 分支内，详见 §4.2.1）。
- 若 `contract_type === '其他'` 或该类型无启用要点，`playbook_snapshot = null`。

#### 4.1.3 扩展类型：`Risk`

**类型定义位置**：`shared/types/contract.ts`（已存在 `Risk` 接口，新增一个可选字段）。

```ts
export interface Risk {
    // ... 现有字段保持不变
    matchedPointCode?: string  // 命中的要点 code；清单外风险留空
}
```

`matchedPointCode` 用 `code` 而非数字编号，避免 AI 返回 `P3` 这种与位置耦合的值（快照里的位置可能变）。AI prompt 里直接写 `code = "probation"`。

#### 4.1.4 扩展：提示词渲染链路

**渲染函数**：沿用现有 `server/services/node/prompt.service.ts` 的 `renderContent()`，不新增渲染器。

**改动点**：`contractReviewAnalyzeClause_system` 提示词模板（DB `prompts` 表 id=28）新增占位符 `{{playbookSection}}` 与 `{{stanceBiasSection}}`。

**调用链**：
```
analyzeSingleClause(ctx, snapshot)
  ↓ 根据 snapshot 生成 playbookSection / stanceBiasSection 两段字符串
  ↓
renderContent(systemPrompt, {
    ...existingVars,
    playbookSection,       // 整份清单要点（含 code / 等级 / 立场偏好 / 检查内容 / 法律依据 / 标准建议）
    stanceBiasSection,     // 按用户立场（partyA/B/neutral）+ 要点 stance_preference 派生的审查口径指引
})
```

**snapshot 存在时，`{{playbookSection}}` 渲染为**：
```
## 本合同审查清单（劳动合同）
- code="probation"  [高 · 立场:strict]  试用期约定合规性
    检查内容：...
    法律依据：...
    标准建议：...
- code="overtime"  [中 · 立场:balanced]  加班费基数
    ...

请逐条审查合同条款。若违反上述某条要点，在输出风险时填 "matchedPointCode": "probation"（code 原样引用，不要编号）。
若发现清单外的重大风险，照常输出，matchedPointCode 留空。
```

**`{{stanceBiasSection}}` 渲染示例**（当前用户立场=partyB/乙方）：
```
## 审查口径（用户立场：乙方）
- strict 要点：必须严格审查，从乙方视角任何模糊约定都要提出风险
- balanced 要点：按一般法律合规性审查，不偏不倚
- lenient 要点：若属商业惯例可接受，则可不报或降级为低风险
```

snapshot 为 null 时 `{{playbookSection}}` 与 `{{stanceBiasSection}}` 均渲染为空字符串，AI 行为退回到 Playbook 上线前。

**提示词模板的 DB 迁移**：在 `prisma/seeds/seedData.sql` 里用 UPDATE 语句刷新 prompt 28 的 content 字段，保持幂等（ON CONFLICT DO UPDATE 或明确的条件更新）。

### 4.2 流程改动

只有"分析阶段"改动，其余一字不变。

**现有阶段顺序**（M6.1 已实现）：
```
segment(Phase A) → detect → stance(interrupt) → [resume] → analyze(逐条) → summarize
```

**新流程**（仅在 resume 后、analyze 开始前多一步）：
```
segment → detect → stance(interrupt)
  ↓
[resume]
  ↓
[新增] 写入 playbook_snapshot
        查 contract_playbooks WHERE contract_type=? AND enabled=true AND deleted_at IS NULL
  ↓
analyze(逐条 analyzeSingleClause，prompt 带快照)
  ↓
summarize
```

#### 4.2.1 快照写入时机

在 `runContractReviewChat` 的 resume 分支中，位于"写 stance 到 DB"与"runAnalyzeLoop 调用"之间。原因：

- 此时 contract_type 已在 parseAndAskStance 工具执行阶段写入 `contract_reviews`，可直接读取。
- resume 分支是 analyze 的唯一入口（首轮只到 stance interrupt 即挂起），此处写快照不会产生竞态。
- 与现有 "M6.1 子期 2：resume 分支激进替换"注释保持集中：所有流程编排逻辑聚于一处。

伪代码位置（contractReviewMainAgent.ts resume 分支内）：
```ts
// 1. 写 stance 到 DB（已有）
await updateContractReviewDAO(review.id, { stance, partyA, partyB, status: 'reviewing' })
// 2. [新增] 写快照（直接内联 DAO 调用，不额外封装）
const points = await listEnabledPlaybookPointsDAO(review.contractType)
const snapshot: PlaybookSnapshot | null = points.length
    ? { contractType: review.contractType!, points, snapshotAt: new Date().toISOString() }
    : null
if (snapshot) {
    await updateContractReviewDAO(review.id, { playbookSnapshot: snapshot as unknown as Prisma.InputJsonValue })
}
// 3. runAnalyzeLoop（已有，传入 snapshot）
```

`listEnabledPlaybookPointsDAO(contractType)` 是 `server/services/assistant/contract/contractPlaybook.dao.ts` 里的新增 DAO 方法，返回符合 `PlaybookPointSnapshot[]` 结构的数组。

#### 4.2.2 `analyzeSingleClause` 改动

函数签名新增可选入参 `playbookSnapshot?: PlaybookSnapshot`，传递到 prompt 渲染时决定 `{{playbookSection}}` 内容。

返回的 Risk 若带 matchedPointCode 但 code 不在快照中，服务端忽略该字段（降级为清单外风险），日志 `warn` 记录。

#### 4.2.3 `summarizeOverview` 改动

完全不改。总览区的"命中 3/12"由前端纯派生计算（快照 + risks），不需后端统计。

### 4.3 降级策略

| 场景 | 行为 |
|------|------|
| AI 返回 matchedPointCode 但 code 不在快照里 | 当作清单外风险处理，日志 warn |
| AI 忘了返回 matchedPointCode | 当作清单外风险处理 |
| AI 返回格式错误 | 沿用现有 analyzeSingleClause 的解析失败处理 |
| 运营删光某类型所有要点 | 新审查 playbook_snapshot=null，结果页不显示清单板块 |
| 快照字段为 null | 前端不显示"清单对照"板块，其余一致 |

### 4.4 前端派生逻辑

**实现位置**：`app/composables/useContractPlaybookMatch.ts`（独立文件，便于单测）。

**签名**：
```ts
export function useContractPlaybookMatch(
    snapshot: MaybeRef<PlaybookSnapshot | null>,
    risks: MaybeRef<Risk[]>,
): ComputedRef<{
    enabled: boolean                           // snapshot 不为 null
    total: number                              // 快照要点总数
    hitCount: number                           // 被 risks.matchedPointCode 引用的不同 code 数
    hits: Array<{ point: PlaybookPointSnapshot; risk: Risk }>   // 命中项（按快照顺序）
    misses: PlaybookPointSnapshot[]            // 未命中项
    extras: Risk[]                             // 清单外风险（matchedPointCode 为空或 code 无效）
}>
```

返回直接访问（遵循 `.claude/rules/fetch.md`：不要写 `match.value.data.hits`，直接 `match.value.hits`）。

**调用方**：
- `OverviewPanel.vue` 渲染"清单对照"板块：读 `enabled / total / hitCount / hits / misses`。
- `RiskListPanel.vue` 的风险卡徽章：用 `matchedPointCode` 在 `snapshot.points` 里线性查找 title（20 条以内无性能顾虑，不必借 Map 缓存）。

### 4.5 API 约定

#### 4.5.1 用户端

无需改动现有 API。`GET /api/v1/assistant/contract/reviews/:id` 自动带出 `playbook_snapshot`（Prisma select 一并捞出即可）。

#### 4.5.2 管理端（新增）

沿用 document-templates 的 CRUD 接口风格，路径位于 `server/api/v1/admin/contract-playbooks/`：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/admin/contract-playbooks` | 列表，支持 contract_type / enabled / q 过滤 |
| POST | `/api/v1/admin/contract-playbooks` | 新增要点 |
| PATCH | `/api/v1/admin/contract-playbooks/:id` | 编辑要点（含切换 enabled） |

v1 不暴露 `DELETE`（砍硬删）、不暴露 `reorder`（砍拖拽排序），均留到 v2。

**通用约定**：
- 所有请求入参使用 `zod` 校验，失败返回 `resError(event, 400, <first-issue-message>)`；遵循 `.claude/rules/api.md`。
- 所有响应恒 HTTP 200，用 `resSuccess / resError` 的 code 字段区分。错误码：400（参数错误）/ 401（未登录）/ 403（非 super_admin）/ 404（要点不存在）/ 500（服务端错误）。
- 动态路由参数 `:id` 一律放文件名末尾（`[id].patch.ts`），遵循 `.claude/rules/api.md`。
- 严格走 `server/middleware/03.permission.ts` 的 super_admin 拦截，不在接口内做 `checkIsSuperAdmin` 旁路。
- 不做用户端对称接口（用户无需读写 playbook，只读快照）。

---

## 5. 测试策略

**测试命令**：全量 `npx vitest run`（项目约定，不用 `bun test`）；单文件 `npx vitest run tests/path.test.ts`。
**覆盖率目标**：核心路径（快照写入、prompt 渲染、前端派生）≥ 80%。

### 5.1 单元测试

- `tests/server/assistant/contract/contractPlaybook.dao.test.ts`：CRUD + 按类型过滤 + enabled 过滤。
- `tests/server/assistant/contract/analyzeSingleClause.playbook.test.ts`：
  - snapshot 传入时 prompt 正确渲染 `{{playbookSection}}` + `{{stanceBiasSection}}`
  - AI 返回合法 matchedPointCode 正常透传
  - AI 返回不存在的 code 降级为清单外，log warn
  - snapshot=null 时两段占位符渲染为空字符串
- `tests/app/composables/useContractPlaybookMatch.test.ts`：命中计数 / 未命中 / 清单外三态派生；snapshot=null 时 enabled=false。

### 5.2 集成测试

- `tests/server/admin/contract-playbooks.api.test.ts`：
  - 管理端 GET/POST/PATCH 正常
  - 非 super_admin 访问管理端接口返回 403
  - zod 校验失败返回 400
- `tests/server/workflow/agents/contractReviewMainAgent.playbook.test.ts`：
  - 有清单的类型 analyze 阶段 prompt 带清单
  - "其他"类型 prompt 不带清单
  - AI 返回 matchedPointCode 正确写入 risks JSON

### 5.3 E2E

使用项目既有 E2E 手段（chrome-devtools MCP，沿用 M6.1 验证方式）手动验证以下路径：

- 劳动合同上传 → 结果页可见清单对照板块 + 命中徽章 + 未命中折叠展开
- "其他"类型上传 → 结果页无清单板块
- 后台编辑要点（如调整立场偏好）→ 新审查反映新清单；历史审查不变

---

## 6. 发版策略

### 6.1 分期（合并到 2 个 Phase）

| 阶段 | 目标 | 产出 |
|------|------|------|
| Phase 1（运营侧） | DB 结构 + 初始种子 + 管理端 API + 管理端页面 | 运营可独立维护清单；用户端尚无感 |
| Phase 2（用户侧） | 快照写入 + analyzeSingleClause 改造 + Risk 扩展 + 结果页 UI + PDF 扩展 | 用户可见"清单对照"；老审查自动降级 |

两个 Phase 可独立合并发布。Phase 1 上线后，后台就能录入要点，但用户端仍走老审查流程；Phase 2 上线当天新审查即启用清单，历史审查自动降级为"无清单"状态。

### 6.2 向后兼容

- 老审查（`playbook_snapshot = null`）：前端自动降级不显示板块，不报错。
- 新审查但 AI 不返 matchedPointCode：清单外风险处理，板块显示"命中 0/12"不是错误。
- 部署顺序：DB 迁移 → 后端 API → 前端页面；DB 先上可无感运行（播种后的要点不生效直到分析流程更新）。

### 6.3 工作量估算

| 阶段 | 工作量 | 说明 |
|------|-------|------|
| Phase 1 | 2 天 | Prisma schema + DAO + 3 个 CRUD API + 管理端列表/抽屉页面 + 初始空种子 |
| Phase 2 | 2.5 天 | 快照写入 + analyzeSingleClause 改造 + prompt 模板扩展 + OverviewPanel 板块 + 风险卡徽章 + PDF 一节 + 单测/集成测试 |
| 种子编写 | 独立 | 项目组 + 法律顾问协作，不占工程工期 |
| **合计** | **4.5 天** | 不含种子编写 |

---

## 7. 关键风险与缓解

| 风险 | 可能性 | 影响 | 缓解 |
|------|--------|------|------|
| AI 返回的 matchedPointCode 乱写 / 胡猜 | 中 | 命中率失真 | prompt 明确"只能用清单给定的 code"；服务端白名单校验；降级为清单外 |
| 清单条目过长导致 prompt 超限 | 低 | analyze 阶段失败 | 现有 analyzeSingleClause 已有 token 截断保护；清单预计 2000~4000 字远低于窗口 |
| 种子数据法律严谨度不够 | 高 | 用户信任度受损 | 发版前法律顾问完整审校；先发 Phase 1-3 让内部试用积累反馈再 Phase 4 公开 |
| 历史快照让 DB 膨胀 | 低 | 长远存储成本 | 快照 JSON 约 5~10KB/份；年 10w 份审查 = 500MB~1GB，完全可接受 |
| 运营频繁改要点导致同日不同审查结果差异 | 低 | 用户疑问 | 快照机制已解决；同日审查结果差异仅发生在运营刚改完的短窗口，UI 文案说明"本审查使用的清单版本快照于 YYYY-MM-DD HH:mm" |

---

## 8. 下游功能的对接钩子（保留·非本期范围）

本期仅保留三个与 roadmap 后续两个功能相关的对接点，**不做额外设计延伸**：

- **#3 对话化批注**：当用户对某条风险追问时，agent 的 prompt 可将该 risk 的 `matchedPointCode` 在 `playbookSnapshot` 里查出完整要点对象（含 `suggestion / legalBasis`），塞入对话上下文。无需改表，仅在对话 agent 的 prompt builder 处读取已有快照即可。
- **#4 追踪修订**：点击"应用建议"生成修订时，优先读取 `playbookSnapshot.points[matchedPointCode].suggestion` 作为建议文本基线；无 matchedPointCode 则回退到 Risk 自身的 `suggestion` 字段（现有逻辑不变）。
- **立场偏好语义落地**：`stance_preference` 字段是 #3 #4 的共同语义支点——#3 追问时 AI 的措辞会根据 strict/balanced/lenient 自动调节；#4 生成修订时会按此调节建议文本的硬度。

其余未来方向（用户自建清单、效果统计、版本号审批、要点分组等）全部移出本期范围，避免过度设计。

---

## 9. 开放项（需发起人确认后闭环）

本期交付前需运营 / 产品闭环以下事项：

1. 6 类清单要点初稿编写 owner 与交付时间。
2. 法律顾问审校排期。
3. 后台管理页的 UI 视觉稿（或直接沿用 document-templates 风格）。

---

**本文档遵循 `docs/superpowers/specs/` 目录的格式惯例，经过内部 4 维度审查（复用、YAGNI、规范、不偏移原始需求）。**
