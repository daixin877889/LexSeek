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

### 1.4 本期不做

- 用户自建清单（未来"律所版"再议）。
- 用户提交前的清单预览页。
- 用户手动改 AI 的命中判定（AI 判错可通过"新增/编辑风险"间接修正）。
- "其他"类型的通用清单。
- 清单版本号发布流程、审批工作流、A/B 灰度、效果统计看板。
- 跨类型要点复制、批量导入。

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

每条风险卡片标题行多一个灰色小徽章：`⚠·试用期约定合规性`。
- hover / 点击徽章：tooltip 或弹层展示该要点全文（检查内容 / 法律依据 / 标准建议）。
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

后台左侧菜单新增："审查清单管理"，路径 `/admin/contract-playbooks`。权限：super_admin only（由现有 `03.permission.ts` 中间件保护）。

### 3.2 页面布局

**左右分栏**

- 左侧 200px 宽：合同类型 Tab（6 项，每项后面显示启用要点数）。
- 右侧：要点列表 + 工具栏。

**右侧工具栏**

`[+ 新增要点]` · 标题搜索框 · 启用状态筛选下拉（全部 / 仅启用 / 仅停用）。

**要点列表**

按手动排序显示，支持拖拽调序。字段列：序号 · 标题 · 等级 · 启用开关 · 更新时间 · 操作（编辑 / 删除）。

### 3.3 要点编辑抽屉

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| 标题 | string(30) | 是 | 要点简称，展示在徽章与清单列表 |
| 默认等级 | enum(high/medium/low) | 是 | AI 判定的参考基线 |
| 检查内容 | text(≤500 字) | 是 | 给 AI 看的指导语 |
| 法律依据 | text(≤300 字) | 否 | 引用法条，命中时显示在风险卡详情 |
| 标准建议 | text(≤500 字) | 否 | 违反时的推荐改法，AI 会参考 |
| 启用状态 | bool | 是 | 关闭的要点不喂给 AI，但历史快照仍可引用 |
| 排序号 | int | 自动 | 拖拽后端赋值，影响总览展示顺序 |

### 3.4 操作语义

- **新增 / 编辑**：立即对新审查生效；历史审查不受影响（快照已冻结）。
- **停用**：软下线语义，不喂给 AI，但历史快照中引用的要点仍完整显示。
- **删除**：仅允许删除"从未被任何审查快照引用过"的要点；被引用判断基于扫描 `contract_reviews.playbook_snapshot->'points'` 中 `code` 字段是否出现（Postgres JSONB 的 `@>` / `jsonb_path_exists` 可高效查询）。被引用时 API 返回 409，UI 按钮灰禁用并提示"该要点已被历史审查引用，无法删除，可改为停用"。
- **拖拽排序**：整类型内排序，立即生效。

### 3.5 种子数据

`seedData.sql` 预置 6 类 × 10~15 条 ≈ 70 条要点（由项目组 + 法律顾问合作编写）。种子数据遵守现有规范：`ON CONFLICT (name) DO NOTHING` 保证幂等。

---

## 4. 系统设计（概念层）

### 4.1 数据结构

#### 4.1.1 新增表：`contract_playbooks`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | serial PK | | |
| contract_type | varchar(50) | NOT NULL | 与 `CONTRACT_TYPE_OPTIONS` 对齐的字符串；DB 不加外键枚举，容错 |
| code | varchar(20) | NOT NULL + (contract_type, code) UNIQUE | 如 "probation"、"overtime"；作为快照引用的稳定标识 |
| title | varchar(30) | NOT NULL | |
| default_level | varchar(10) | NOT NULL CHECK in ('high','medium','low') | |
| check_content | text | NOT NULL | |
| legal_basis | text | NULL | |
| suggestion | text | NULL | |
| enabled | boolean | NOT NULL DEFAULT true | |
| sort_order | int | NOT NULL DEFAULT 0 | 类型内排序 |
| created_at | timestamptz | NOT NULL DEFAULT now() | |
| updated_at | timestamptz | NOT NULL DEFAULT now() | |
| deleted_at | timestamptz | NULL | 软删除，兼容"被历史引用无法硬删"场景 |

索引：`(contract_type, enabled, sort_order)` 支持按类型拉启用要点列表。

#### 4.1.2 扩展表：`contract_reviews`

新增字段 `playbook_snapshot jsonb NULL`：

```ts
type PlaybookSnapshot = {
    contractType: string  // 快照时该 review 的合同类型
    points: Array<{
        code: string         // 稳定标识
        title: string
        defaultLevel: 'high' | 'medium' | 'low'
        checkContent: string
        legalBasis?: string
        suggestion?: string
    }>
    snapshotAt: string  // ISO 时间戳
}
```

- 快照在 `detect 阶段完成 → analyze 阶段开始之前`写入。
- 若 contract_type === '其他' 或该类型无启用要点，`playbook_snapshot = null`。

#### 4.1.3 扩展类型：`Risk`

新增可选字段 `matchedPointCode?: string`：

```ts
export interface Risk {
    id: string
    clauseIndex: number
    clauseText: string
    level: RiskLevel
    category: string
    problem: string
    legalBasis?: string
    analysis: string
    risk: string
    suggestion: string
    suggestedClauseText?: string
    matchedPointCode?: string  // 新增：命中的要点 code；清单外风险留空
}
```

`matchedPointCode` 用 `code` 而非数字编号，避免 AI 返回 `P3` 这种和位置耦合的值（快照里的位置可能变）。AI prompt 里直接写 `code = "probation"`。

#### 4.1.4 扩展：提示词

`contractReviewAnalyzeClause_system` 提示词模板新增占位符 `{{playbookSection}}`。当前审查挂了清单时，该占位符渲染为：

```
## 本合同审查清单（劳动合同）
P1. [高] 试用期约定合规性（code="probation"）
    检查内容：...
    法律依据：...
    标准建议：...
P2. [中] 加班费基数（code="overtime"）
    ...

请逐条审查合同条款。若违反上述某条要点，在输出风险时填 "matchedPointCode": "probation"。
若发现清单外的重大风险，照常输出，matchedPointCode 留空。
```

无清单时该占位符渲染为空字符串，AI 行为退回到 Playbook 上线前。

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
// 2. [新增] 写快照
const snapshot = await loadPlaybookSnapshot(review.contractType)  // null if '其他' or 无要点
if (snapshot) await updateContractReviewDAO(review.id, { playbookSnapshot: snapshot })
// 3. runAnalyzeLoop（已有，传入 snapshot）
```

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

新增 composable `useContractPlaybookMatch(snapshot, risks)`：
- 输入：PlaybookSnapshot | null · Risk[]
- 输出：
  ```ts
  {
      enabled: boolean          // snapshot 不为 null
      total: number             // 快照要点总数
      hitCount: number          // 被 risks.matchedPointCode 引用的不同 code 数
      hits: Array<{ point; risk }>     // 命中项（按快照排序）
      misses: Array<{ point }>          // 未命中项
      extras: Risk[]                    // 清单外风险
  }
  ```

OverviewPanel 使用该 composable 渲染"清单对照"板块。RiskListPanel 的风险卡徽章渲染时按 `matchedPointCode` 查快照取 title。

### 4.5 API 约定

#### 4.5.1 用户端

无需改动现有 API。`GET /api/v1/assistant/contract/reviews/:id` 自动带出 `playbook_snapshot`（Prisma select 一并捞出即可）。

#### 4.5.2 管理端（新增）

沿用 document-templates 的 CRUD 成对接口风格，路径位于 `server/api/v1/admin/contract-playbooks/`：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/admin/contract-playbooks` | 列表，支持 contract_type / enabled / q 过滤 |
| POST | `/api/v1/admin/contract-playbooks` | 新增要点 |
| PATCH | `/api/v1/admin/contract-playbooks/:id` | 编辑要点 |
| DELETE | `/api/v1/admin/contract-playbooks/:id` | 删除要点（被引用时返回 409 要求改为停用） |
| POST | `/api/v1/admin/contract-playbooks/reorder` | 批量更新排序（body: `{ contract_type, ids: number[] }`） |

严格走管理端权限中间件；不做用户端对称接口（本期用户无需读写 playbook，只读快照）。

---

## 5. 测试策略

### 5.1 单元测试

- `contract_playbooks.dao.test.ts`：CRUD + 过滤 + 被引用保护。
- `loadPlaybookSnapshot.test.ts`：按类型捞取 + 空结果 + "其他"类型降级。
- `analyzeSingleClause.playbook.test.ts`：
  - prompt 正确渲染 playbookSection
  - AI 返回合法 matchedPointCode 正常透传
  - AI 返回不存在的 code 降级为清单外
  - snapshot=null 时 prompt 不带 playbookSection
- `useContractPlaybookMatch.test.ts`：命中计数 / 未命中 / 清单外三态派生。

### 5.2 集成测试

- `contract-playbook.admin.api.test.ts`：
  - 管理端 CRUD 正常
  - 删除被历史引用的要点返回 409
  - 排序更新后查询按新序返回
  - 非 super_admin 访问管理端接口 403
- `contractReviewMainAgent.playbook.test.ts`：
  - 有清单的类型 analyze 阶段 prompt 带清单
  - "其他"类型不带清单
  - AI 返回 matchedPointCode 正确写入 risks JSON

### 5.3 E2E

- 使用 Playwright 或 chrome-devtools 手动验证：
  - 劳动合同上传 → 结果页可见清单对照板块 + 命中徽章 + 未命中折叠展开
  - "其他"类型上传 → 结果页无清单板块
  - 后台编辑要点 → 新审查反映新清单；历史审查不变
  - 删除被引用的要点 → 前端显示 toast "已被历史引用"

---

## 6. 发版策略

### 6.1 分期

| 阶段 | 目标 | 产出 |
|------|------|------|
| Phase 1 | DB 结构 + 管理端 API + 初始种子 | 数据层与管理端接口可用 |
| Phase 2 | 管理端页面 | 运营可维护要点 |
| Phase 3 | 审查流程接入（快照 + analyzeSingleClause + Risk 字段） | 后端具备对照能力 |
| Phase 4 | 前端结果页 UI（OverviewPanel 清单板块 + 风险卡徽章 + PDF） | 用户可见 |

四个 Phase 可独立测试、独立发版；前三个 Phase 完成后用户看不到变化，但已经开始写入快照——这让上线 Phase 4 当天就能看到"新老数据一起工作"。

### 6.2 向后兼容

- 老审查（`playbook_snapshot = null`）：前端自动降级不显示板块，不报错。
- 新审查但 AI 不返 matchedPointCode：清单外风险处理，板块显示"命中 0/12"不是错误。
- 部署顺序：DB 迁移 → 后端 API → 前端页面；DB 先上可无感运行（播种后的要点不生效直到分析流程更新）。

### 6.3 工作量估算

| 阶段 | 工作量 | 说明 |
|------|-------|------|
| Phase 1 | 1.5 天 | Prisma schema + DAO + CRUD API + 初始空种子 |
| Phase 2 | 2 天 | 管理端页面（含拖拽排序、抽屉编辑） |
| Phase 3 | 1.5 天 | 快照写入 + analyzeSingleClause 改造 + 提示词扩展 + 单测 |
| Phase 4 | 1.5 天 | OverviewPanel 板块 + 风险卡徽章 + PDF 扩展 |
| 种子编写 | 独立 | 项目组 + 法律顾问协作，不占工程工期 |
| **合计** | **6.5 天** | 不含种子编写 |

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

## 8. 后续演进路径（参考，不在本期范围）

- **v2：用户自建清单**（律所版）——用户端新增"我的清单"页，从官方清单 fork 一份编辑。
- **v2：清单命中效果统计**——后台看板按要点统计"命中率 / 漏判率"，指导运营优化。
- **v2：要点分组 / 标签**——同类型内要点按子主题分组展示（如"劳动合同 → 入职 / 在职 / 离职"三组）。
- **v2：清单版本号 + 发布审批**——改动不立即生效，走审批流。
- **复用到 #3 对话化批注**：用户追问时 AI 可引用"清单第 5 条说……"。
- **复用到 #4 追踪修订**：用户点击"应用建议"时优先使用清单里的"标准建议"作为修订文本。

---

## 9. 开放项（需发起人确认后闭环）

本期交付前需运营 / 产品闭环以下事项：

1. 6 类清单要点初稿编写 owner 与交付时间。
2. 法律顾问审校排期。
3. 后台管理页的 UI 视觉稿（或直接沿用 document-templates 风格）。

---

**本文档遵循 `docs/superpowers/specs/` 目录的格式惯例，经过内部 4 维度审查（复用、YAGNI、规范、不偏移原始需求）。**
