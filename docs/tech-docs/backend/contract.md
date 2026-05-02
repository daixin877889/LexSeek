# 合同审查模块

LexSeek 的合同审查能力基于 LangGraph stateGraph + 自研 `agent-platform` 适配层，实现"上传 docx → AI 识别合同类型与立场 → 用户确认立场 → 按 playbook 切分逐条审查 → 结构化风险输出 + 批注回写 docx"的端到端工作流。

工作区与历史版本物理分离：工作区数据存 `contract_risks` / `contract_annotations`（实时态），保存版本时整体快照写入 `contract_review_versions.snapshot_data`（不可变）。

---

## 1. 架构概览

```
用户上传 docx (POST /reviews)
    │
    ▼
contractReviews row 创建 (status=pending) ─── 入队 agentRun
    │
    ▼
runContractReviewChat (stateGraph vertical)
    │  ① detect    → AI 识别合同类型 + 甲乙方
    │  ② stance    → interrupt → 用户确认立场（partyA/partyB/neutral）
    │  ③ segment   → 条款切分 (clauseToParagraph)
    │  ④ analyze   → 按 playbook 逐条 LLM 审查 → Risk[]
    │  ⑤ summarize → 生成 ContractOverview (highlights + overall)
    │  ⑥ persist   → reviewResultPersistence.middleware
    │                   → docx 批注回写 + 上传 OSS → reviewedFileId
    │                   → contract_risks / contract_annotations 写入
    │
    ▼
status=completed，前端通过 SSE 实时收到每个阶段事件
```

每个阶段都通过 `publishCustomEvent` 发出 `ContractReviewEvent`：`stage` / `progress` / `risk` / `overview` 四种 type，前端 `useStreamChat` 接收后驱动 `RiskListPanel` / `OverviewPanel` 实时渲染。

详细阶段事件序列见 `server/services/workflow/agents/contractReviewMainAgent.ts` 顶部注释。

---

## 2. 数据模型

| 表 | 文件 | 职责 |
|----|------|------|
| `contract_reviews` | `prisma/models/contractReview.prisma` | 审查主表，含 `risks` / `summary` / `playbookSnapshot` 等 JSONB 字段，状态机驱动 |
| `contract_playbooks` | `prisma/models/contractPlaybook.prisma` | 审查清单要点（按合同类型维护），管理端可改 |
| `contract_risks` | `prisma/models/contractRiskAndAnnotation.prisma` | 工作区实时风险（含锚点信息） |
| `contract_annotations` | 同上 | 批注气泡，永不物理删除（软删 `deletedAt`） |
| `contract_review_versions` | `prisma/models/contractReviewVersion.prisma` | 版本快照（不可变 JSONB） |
| `contract_review_legacy_risks_backup` | `prisma/models/contractReviewLegacyBackup.prisma` | 迁移期数据备份 |

### 2.1 状态机

`contractReviews.status`：

```
pending → reviewing → awaiting_stance → reviewing → completed
                                                    └─→ failed
                                          rebuilding (临时态)
```

- `awaiting_stance`：interrupt 中，等用户调 `POST /reviews/stance/:id` 提交立场
- `rebuilding`：仅 docx 重建期间短暂占据，不进状态机主图
- `REVIEW_EDITABLE_STATUSES`：仅 `completed` 允许编辑 risks / 重生批注

### 2.2 caseId 二态归属

`contractReviews.caseId` 可空：
- `null` = 独立审查（assistant 入口 / dashboard/contract）
- 非 `null` = 案件下合同审查（案件详情 Tab 入口），关联 `cases` 表

---

## 3. 合同类型分类（11 大类 / 41 细分）

`shared/types/contract.ts` 集中维护：

- `CONTRACT_TYPE_CATEGORIES` — 11 大类（劳动用工 / 保密协议 / 买卖合同 / 租赁合同 / 服务承揽委托 / 仓储物流 / 担保借贷 / 婚姻家庭继承 / 知识产权 / 软件与创作 / 互联网平台）
- `CONTRACT_TYPE_OPTIONS` — 41 个细分类型 + `'其他'` 兜底，作为 LLM `partyDetector` 的候选集与管理端 `z.enum` 校验值域
- `CATEGORY_TO_SUBTYPES` / `SUBTYPE_TO_CATEGORY` — 双向映射，UI 二级展开 + 反查归类

DB 层 `contract_playbooks.contractType` 是 `varchar(50)` 不加约束，允许 LLM 输出新类型；管理端写入仍走 `z.enum(CONTRACT_TYPE_OPTIONS)` 收口。

---

## 4. Playbook 与快照机制

### Playbook 要点

`contract_playbooks` 按 `(contractType, code)` 唯一，每条要点字段：

| 字段 | 用途 |
|------|------|
| `contractType` | 41 细分之一 |
| `code` | 稳定标识（如 `probation` / `overtime`），快照引用使用 |
| `title` | 要点简称（≤30 字符） |
| `defaultLevel` | AI 判定基线：`high` / `medium` / `low` |
| `stancePreference` | 客观严格度：`strict` / `balanced` / `lenient`（默认 `balanced`） |
| `checkContent` | 给 AI 的指导语 |
| `legalBasis` | 法律依据（可选） |
| `suggestion` | 标准建议（可选，多版本"追踪修订"会用作修订文本基线） |
| `enabled` | v1 不支持硬删，仅停用 |

种子数据：`prisma/seeds/contractPlaybooks.json`（1532 行，由 `server/scripts/importContractPlaybooks.ts` 导入）。

### 快照冻结

审查发起时（`detect` 阶段拿到 `contractType` 后），后端把当前启用的 playbook 要点拍快照写入 `contractReviews.playbookSnapshot`：

```ts
interface PlaybookSnapshot {
    contractType: string
    points: PlaybookPointSnapshot[]
    snapshotAt: string  // ISO 时间戳
}
```

> 运营后续修改 `contract_playbooks` 不影响历史审查——历史快照永远定格在审查发起时。"其他"类型或无启用要点时 `playbookSnapshot` 为 `null`，AI 走泛化审查路径。

---

## 5. Vertical Agent 注册

`server/agents/contract/agent.config.ts` 用 `defineDomainAgent` 注册：

```ts
export const contractAgent = defineDomainAgent({
    scope: SessionScope.CONTRACT,
    agentType: 'stateGraph',           // 自定义 graph，非 createAgent
    nodeName: 'contractReviewMain',
    runStateGraph: async (ctx) => {
        const { runContractReviewChat } = await import(
            '~~/server/services/workflow/agents/contractReviewMainAgent'
        )
        return runContractReviewChat(ctx.sessionId, { ... })
    },
})
```

> 走 `stateGraph` 而非 `createAgent` 是因为合同审查有自定义 `resume` 路径（首轮 `parseAndAskStance` interrupt → resume 后直接执行 `runAnalyzeLoop`，不再过 `agent.stream`）。详见 `agent-platform.md` 中 vertical 注册章节。

业务侧 service / DAO 全部位于 `server/agents/contract/`（不是 `server/services/contract/`），与 vertical 同目录便于内聚。

---

## 6. API 速查

### 6.1 用户端（`/api/v1/assistant/contract/`）

| 方法 | 路径 | 用途 |
|------|------|------|
| POST | `/reviews` | 创建审查（上传 / 粘贴），可选 `caseId` 归属案件 |
| GET | `/reviews` | 当前用户审查列表（含风险计数） |
| GET | `/reviews/:id` | 审查详情 |
| PATCH | `/reviews/:id` | 编辑 risks（仅 `completed` 状态） |
| DELETE | `/reviews/:id` | 软删 |
| POST | `/reviews/stance/:id` | 提交立场（推动 `awaiting_stance → reviewing`） |
| POST | `/chat` | 与审查会话对话（用于追问 / 调整审查结论） |
| POST | `/reviews/rebuild-docx/:id` | 用工作区当前 risks 重建批注 docx |
| GET | `/reviews/download/:id` | 下载批注后的 docx |
| POST | `/reviews/export-pdf/:id` | 导出 PDF 版本 |
| GET / POST | `/reviews/version-list/:id` | 版本列表 / 创建 lawyer_save 版本 |
| GET / PATCH | `/reviews/versions/:versionId` | 版本快照详情 / 切换 `currentVersionId` |
| GET | `/reviews/versions/download/:versionId` | 下载某版本 docx |
| POST | `/reviews/upload-version/:id` | 上传客户回传版本（diff + AI 标注） |
| POST | `/reviews/add-annotation/:id` | 新增批注 |
| PATCH / DELETE | `/reviews/annotations/:annotationId` | 编辑 / 软删批注 |
| PATCH | `/reviews/annotations/restore/:annotationId` | 恢复客户端删除的批注（取消 `suppressInExport`） |
| PATCH | `/reviews/risks/:riskId` | 单条 risk 处置（`handled` / `ignored`） |
| PATCH | `/reviews/risk-list/:id` | 批量编辑 risks |

### 6.2 管理端（`/api/v1/admin/contract-reviews/` + `/admin/contract-playbooks/`）

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/admin/contract-reviews` | 全量审查列表（含 userId / deletedAt） |
| GET | `/admin/contract-reviews/:id` | 审查详情（不脱敏） |
| DELETE | `/admin/contract-reviews/:id` | 硬删（运营兜底） |
| GET | `/admin/contract-playbooks` | 要点清单（按 contractType 过滤） |
| POST | `/admin/contract-playbooks` | 新增要点 |
| PATCH | `/admin/contract-playbooks/:id` | 编辑要点 |

> 管理端接口走 RBAC 细粒度授权——必须在「API 权限」页扫描 + 「角色」页授权后管理类角色才能访问。详见 `.claude/rules/api.md` 管理端 API 注册流程。

---

## 7. 多版本系统

`contract_review_versions` 是**不可变快照**，每次保存写一条新行：

| systemLabel | 触发场景 |
|-------------|----------|
| `initial_upload` | 首次审查完成时自动创建 v1 |
| `lawyer_save` | 律师手动保存工作区 |
| `client_return` | 客户回传 docx 上传后（diff 完成） |
| `auto_backup` | 后台兜底（容灾） |

`contractReviews` 维护两个游标：
- `currentVersionId` — 当前工作区基于哪个快照
- `maxVersionNo` — 已产生的版本号上限（每次 snapshot 原子 +1）

切换版本走 `PATCH /reviews/versions/:versionId`，前端 `ContractVersionTimeline` 显示时间线。

### Risk 与 Annotation 维度扩展

- `contract_risks.source` — `ai`（首次审查） / `external_new`（客户回传带回的新风险） / `global_review`（全局复审）
- `contract_annotations.authorType` — `ai` / `lawyer` / `external`
- `contract_annotations.deletedAt` — 软删（铁律：批注永不物理删除）
- `contract_annotations.wordCommentRef` — Word 批注稳定身份证（格式 `LEXSEEK-{id}-{rand8}`）；**不加 UNIQUE**（并发导出时概率冲突会让 P2002 抛出整个上传失败，靠 `@@index` 加速查询足够）

---

## 8. SSE 事件协议

四种 `ContractReviewEvent`，由 `publishCustomEvent` 发出，前端 `onCustomEvent` 接收：

```ts
type ContractReviewEvent =
    | { type: 'stage'; stage: 'detect' | 'stance' | 'segment' | 'analyze' | 'summarize'
        status: 'running' | 'done'; warnings?: string[]; totalClauses?: number
        partyA?: string; partyB?: string; contractType?: string }
    | { type: 'progress'; current: number; total: number; error?: string }
    | { type: 'risk'; risk: Risk }
    | { type: 'overview'; overview: ContractOverview }
```

客户回传上传走另一组事件（`upload-version-progress` / `complete` / `error`），见 `CONTRACT_UPLOAD_VERSION_SSE_EVENT`。

---

## 9. 设计要点回顾

| 决策 | 原因 |
|------|------|
| `stateGraph` 而非 `createAgent` | 自定义 resume 路径（interrupt 后跳过 agent.stream，直接 `runAnalyzeLoop`） |
| service/DAO 在 `server/agents/contract/` 而非 `server/services/contract/` | 与 vertical 同目录便于内聚；Domain Agent 工厂注册时也方便 import |
| `playbookSnapshot` 冻结在 `contract_reviews` | 运营改 playbook 不影响历史审查；"其他"类型或无要点时为 `null` |
| 工作区 / 版本物理分离 | 工作区改动频繁；版本是合规留痕，不可变 JSONB 快照 |
| 批注永不物理删除 | 软删 `deletedAt`，避免回传 docx diff 时丢失对话上下文 |
| `wordCommentRef` 不加 UNIQUE | 并发导出时概率冲突会抛 P2002 让上传失败；rand8 碰撞概率 1/2e14 可接受 |
| `cot_messages` 字段独立存事件序列 | `skipStanceInterrupt` 路径（法律助手 reviewContract 工具调用）不写 LangGraph checkpoint，靠此字段实现"刷新历史"恢复 |

---

## 10. 引用关系

| 文档 | 关系 |
|------|------|
| [agent-platform.md](./agent-platform.md) | vertical 注册 / `stateGraph` 路径 / 中间件栈 |
| [skills.md](./skills.md) | 合同审查节点 `contractReviewMain` 关联的 skills |
| [case.md](./case.md) | `contractReviews.caseId` 关联 cases 表，案件详情 Tab 入口 |
| [data-model.md](../architecture/data-model.md) | 5 张合同表的字段全貌与关系图 |
| [sse-event-bridge.md](../patterns/sse-event-bridge.md) | `publishCustomEvent` SSE 事件桥接通用模式 |
