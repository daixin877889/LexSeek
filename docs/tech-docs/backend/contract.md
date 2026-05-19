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

业务侧 service / DAO 大部分位于 `server/agents/contract/`，与 vertical 同目录便于内聚；stateGraph 主图 `contractReviewMainAgent.ts` 仍在 `server/services/workflow/agents/`。

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
| POST | `/reviews/add-risk/:id` | 手动新增风险 |
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
| `cot_messages` 字段独立存事件序列 | `skipStanceInterrupt` 路径（通用问答 reviewContract 工具调用）不写 LangGraph checkpoint，靠此字段实现"刷新历史"恢复 |

---

## 10. 引用关系

| 文档 | 关系 |
|------|------|
| [agent-platform.md](./agent-platform.md) | vertical 注册 / `stateGraph` 路径 / 中间件栈 |
| [skills.md](./skills.md) | 合同审查节点 `contractReviewMain` 关联的 skills |
| [case.md](./case.md) | `contractReviews.caseId` 关联 cases 表，案件详情 Tab 入口 |
| [data-model.md](../architecture/data-model.md) | 5 张合同表的字段全貌与关系图 |
| [sse-event-bridge.md](../patterns/sse-event-bridge.md) | `publishCustomEvent` SSE 事件桥接通用模式 |

---

## 11. 导出模式（批注 / 修订 / 双模式）

PR6 落地的 Track Changes 导出能力。下载按钮（`RiskListPanel.vue` 底部 DropdownMenu）支持三种模式，模式偏好持久化到 `localStorage:contract-review-export-mode`。

### 11.1 三模式定义

| 模式 | API mode | 用途 | OOXML 标签 |
|---|---|---|---|
| 批注模式 | `comment`（默认） | 律师/客户对话讨论阶段 | `<w:comment>` + `<w:commentRangeStart/End>` |
| 修订模式 | `redline` | 定稿前一轮，律师按 Track Changes 接受/拒绝 AI 改写 | `<w:ins>` / `<w:del>` |
| 两者并存 | `both` | 既要修订动作又要保留沟通气泡，悬停修订段直接弹气泡 | 上面两套并存，commentRange 精确包到 del+ins 周围 |

入口：`GET /api/v1/assistant/contract/reviews/download/:id?mode=comment|redline|both`（同样适用于 `/versions/download/:versionId`）。

### 11.2 ID 协调（关键 · 不修会让 Word 拒打开）

OOXML `w:id` 在文档内是跨多种元素**共享**的 ID 池：bookmark / `<w:ins>` / `<w:del>` / `<w:rPrChange>` / `<w:pPrChange>` / `<w:commentRangeStart/End>` / `<w:commentReference>` / `<w:moveFromRangeStart>` 等。撞 ID → Word 报"文件已损坏"拒打开。

`server/agents/contract/docx/xmlAst.ts` 的 `findMaxSharedId` 扫所有此类标签返回最大 w:id；`rebuildDocxService` 用 `findMaxSharedId(原 docx) + 1` 作为 `idStart` 喂给 `redlineInjector`，再用 `redlineInjector.nextIdAfter` 接力 `commentInjector` 的 `idStart` 参数。`commentInjector` 默认 `idStart=0` 完全向后兼容。

注意：`<w:commentRangeStart/End/Reference>` 三标签共享同一个 w:id（指向同一个 comment）是 OOXML 标准设计，不算撞车。撞车专指"实例标签"（ins/del/bookmark）的 w:id 与 commentReference w:id 落入同一池后冲突。

### 11.3 跨 run 拆分保留 rPr

合同正文同一句话常跨多个 `<w:r>`（粗体的"违约金"在自己 run、普通字在另一 run）。`redlineInjector.splitRunAtOffset` 拆 run 时 deep-clone `<w:rPr>` 副本到两侧，quote 范围 run 把 `<w:t>` 替换为 `<w:delText>`（保留 `xml:space="preserve"`），整体 wrap 进 `<w:del>`。律师拒绝修订时原字体格式（粗体/字号/颜色）完整恢复。

### 11.4 整段替换保留段落标记符

quote == 整段 `clauseText` 且 textContent 完全覆盖时，仍只在段内装 `<w:del>`（包旧文字）+ `<w:ins>`（包改写建议），**不**对段落标记符（pilcrow ¶）做任何修订标记。

能进入 redline 的 risk 一定带非空 `suggestedClauseText`（见 §11.6 跳过条件），"整段命中"本质是"整段**替换**"而非"整段删除"。按 ECMA-376 §17.13.5.15，给 `<w:p><w:pPr><w:rPr>` 加 `<w:del/>` 表示段落标记符被删除，Word 会把该段与**下一段合并**显示——整段替换若删段落标记符，下一条款标题会被吸进正文末尾、排版错乱。段落标记符保留后，律师"接受所有修订"即得到"旧文字删除、新文字保留、段落独立"的正确结果。

### 11.5 both 模式 commentRange 精确包裹（spec §8.3.6 核心 UX）

`redlineInjector` 装填后返回 `spansByRiskId: Map<riskId, RedlineWrapTarget>`，记录每条 risk 的 `<w:del>` / `<w:ins>` 节点 w:id 与所在段落索引。`rebuildDocxService` both 模式调 `injectAnnotations` 时透传 `wrapTargetByRiskId`，`commentInjector.injectMarkersIntoParagraph` 在该 risk 段落内按精确坐标插 `<w:commentRangeStart>` 到 `<w:del>` 之前、`<w:commentRangeEnd>` 到 `<w:ins>` 之后——律师悬停修订段直接弹批注气泡。

跨段 risk 的 `paragraphSpans` 含多个元素，commentRange 跨第一段到最后一段。

### 11.6 边角处理

| 场景 | 行为 |
|---|---|
| `problematicQuote=null` 的 risk | redline 模式跳过 → fallback 走 comment（spec §8.4） |
| `suggestedClauseText` 为空的 low risk | redline 模式跳过 → fallback 走 comment |
| LLM 输出 `suggestedClauseText` 含 `\n` | `riskSchema.builder.ts` refine 直接 reject，让 LLM 重生成 |
| LLM 输出含 U+0008 等控制字符 | `xmlAst.stripIllegalXmlChars` 在 `buildInsertNode` / `convertRunToDeleteRun` 写文本前过滤 |
| `clauseText` 与 OOXML 段落 textContent 不一致 | `redlineLocate.locateQuoteInParagraphs` 返回 null，redlineInjector 跳过该 risk → fallback 走 comment |

### 11.7 已知不做（v2 范畴）

- "一键接受所有 AI 修订"按钮（律师批量接受 redline）
- 修订模式下"评论 + 修订"对话线（comment 仍只在 comment 模式有）
- 修订作者多元（当前固定 author=`LexSeek AI`，未来按律师姓名）
- LLM 自评（输出 sentence_id 后让 LLM 验证片段是否真对应）
- Windows Word 兼容性：开发端是 macOS + Docker 部署，PR6 仅做 macOS Word 实测；Windows 兼容靠线上回归

### 11.8 关键文件清单

**新建**：
- `server/agents/contract/docx/redlineLocate.ts` — OOXML AST 内定位 quote 字符段（含 `computeRunLength` / `paragraphTextLengthByRunRule` export）
- `server/agents/contract/docx/redlineInjector.ts` — `<w:del>` / `<w:ins>` 装配 + 段落删除标记 + ID 协调 + spansByRiskId 收集

**改造**：
- `server/agents/contract/docx/xmlAst.ts` — 加 `findMaxSharedId` / `stripIllegalXmlChars` / `collectNonEmptyParagraphs`（抽出公共）
- `server/agents/contract/docx/commentInjector.ts` — `InjectAnnotationsOptions { idStart, wrapTargetByRiskId }` + `nextIdAfter`
- `server/agents/contract/contractReviewRebuild.service.ts` — 接受 `opts.mode`
- `server/agents/contract/contractReviewVersion.service.ts` — `downloadContractReviewVersionService` 接受 `opts.mode`
- `server/agents/contract/riskSchema.builder.ts` — `suggestedClauseText` reject `\r|\n`

### 11.9 段落口径：分析口径 vs 批注注入口径（M8）

`parseContractDocx` 产出两套段落数组，二者在含表格合同上不一致：

| 口径 | 字段 | 含义 | 用途 |
|---|---|---|---|
| 分析口径 | `paragraphs` | 递归收集所有非空 `<w:p>`（含 `<w:tbl>` 单元格内） | 条款切分 / AI 审查 |
| 批注注入口径 | `bodyParagraphs` | 仅 `<w:body>` 直接子 `<w:p>`（`collectNonEmptyParagraphs` 口径） | `commentInjector` 注入批注、`parseWordComments` 的 `anchorParagraphIndex` |

`bodyParagraphIndex` 是 `paragraphs[i] → bodyParagraphs` 下标的映射，表格内段落为 `null`。

写 `contract_risks.clauseParagraphIndex` 必须用批注注入口径——首次审查（`contractReviewMainAgent`）与客户回传增量审查（`uploadClientVersion`）都经 `buildClauseToBodyParagraphMap`（`utils/clauseToParagraph.ts`）把条款序号换算成该口径。条款落在表格内时 `clauseParagraphIndex` 为 `null`：风险仍在工作区清单展示，但其批注无法注入 docx（与 `global_review` 风险同口径，`rebuildDocx` 按 `null` 过滤）。

---

## 12. Phase B 双锚点迁移（PR7）

客户回传 docx 时，`uploadClientVersionService` Step 5 走双锚点优先级把旧 risk 的位置迁到新文档：

| 档 | 命中条件 | 写入字段 |
|---|---|---|
| 1 (quote) | `problematicQuote` 在新文档 `normalizedText` 上 fuzzy 命中且未跨段 | `clauseText` 升级为新段 segment.text 全段；`problematicQuote` 重摘录；`quoteCharStart/End` 重算到新 clauseText 内的相对 offset；`quoteMatchSource` 沿用旧值；`orphaned=false` |
| 2 (clause) | 档 1 失败 + `clauseText` 走 `migrateAnchor` 命中 | `clauseText` 升级为新段全段；`problematicQuote/quoteCharStart/End/quoteMatchSource` 全清空 null；`orphaned=false` |
| 3 (orphaned) | 两档都失败 | `orphaned=true`；`clauseText/problematicQuote/quoteMatchSource` 全保留旧值（孤立批注区展示用） |

`originalClauseText` 在迁移后 clauseText 实际变化 + 旧值非空 + 未备份过时首次写入（幂等：已有值则不覆盖）。

实现位置：
- `server/agents/contract/utils/anchorMigrate.ts` `migrateRiskWithDualAnchor` wrapper（spec §9.2，含档 1 命中后 calcSimilarity 二次校验阻断长 quote 假阳）
- `server/agents/contract/uploadClientVersion.service.ts` Step 5（spec §9.3）

为什么 quote 优先：精确句子比整段更稳定——条款里其它字改了，只要"导致风险的那句话"还在就能锚住；clauseText 含整段更易因字面变化失败。

之前 orphaned=true 的 risk 在后续回传里能再次定位时 `orphaned` 自动复位 false（不需要律师手工"重激活"）。

### 12.1 运维监控注意事项（与 spec §10.3 衔接）

spec §10.3 监控 SQL 期望首次审查的 `quote_match_source` 分布是 `sentence_id ≥ 80%, fuzzy ≤ 15%, fallback ≤ 5%`。**Phase B 迁移会污染这个分布**：

- 档 1 命中：沿用旧 `quote_match_source`（首次审查写入的值），分布无影响
- 档 2 命中：把 `quote_match_source` 清 null，独立桶
- 档 3 orphaned：保留旧值，分布无影响

**告警 SQL 必须排除迁移行**：迁移行在 Phase B 客户回传后 `updated_at > created_at`。建议监控 SQL：

```sql
-- 仅统计首次审查的命中分布，排除 Phase B 迁移行
SELECT quote_match_source, COUNT(*),
       ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct
FROM contract_risks
WHERE source = 'ai'
  AND created_at > NOW() - INTERVAL '7 days'
  AND created_at = updated_at  -- 排除 Phase B 迁移行
GROUP BY quote_match_source
ORDER BY COUNT(*) DESC;
```

---

## 13. 修订版回传识别与自定义署名

PR8 落地的能力：导出修订版 docx 时写入修订身份证，客户回传时自动识别每条 AI 修订的处置结果（接受/拒绝/未处理/需确认）；导出作者名支持用户自定义署名。

### 13.1 修订身份证（redlineRefs.xml）

`injectRedlineMarks`（`server/agents/contract/docx/redlineInjector.ts`）导出修订版 docx 后，将身份证文件写入 `word/customXml/redlineRefs.xml`，并经 `registerCustomXmlPart`（`server/agents/contract/docx/customXmlRegistrar.ts`）注册到 `[Content_Types].xml` 与对应 rels，使 Word 原生能读取该部分。

身份证 XML 结构：

```xml
<lexseekRedlineRefs xmlns="urn:lexseek:contract-review-redline:v1" reviewId="123">
  <ref riskId="5" delIds="10,11" insId="12" paraIdxs="3,4" />
  ...
</lexseekRedlineRefs>
```

| 属性 | 说明 |
|------|------|
| `reviewId` | 审查 ID，回传时用于跨审查校验，防止误回传 |
| `riskId` | 对应 `contract_risks.id` |
| `delIds` | 该 risk 的 `<w:del>` 节点 w:id 列表（逗号分隔） |
| `insId` | 该 risk 的 `<w:ins>` 节点 w:id |
| `paraIdxs` | 修订所跨非空段落序号，用于回传识别时定位语料范围 |

### 13.2 回传识别：三个核心函数

位于 `server/agents/contract/docx/redlineParser.ts`：

| 函数 | 职责 |
|------|------|
| `parseRedlineMarks(docxBuffer)` | 读 redlineRefs.xml + 扫全文存活的 `<w:ins>` / `<w:del>` w:id 集合 + 收集所有非空段落归一化语料；文件不存在或损坏时返回空结果，不抛错 |
| `resolveCorpusForRef(paragraphs, paraIdxs)` | 按 `paraIdxs` 取该风险所属段落的 `<w:t>` / `<w:delText>` 语料（归一化），将比对范围限定在风险段落，避免全文误判 |
| `classifyRedlineDecision(input)` | 双层算法判定单条修订处置：Layer 1 比对 `delIds` / `insId` 在回传 docx 是否存活；Layer 2 比对正文语料（`problematicQuote` / `suggestedClauseText`）做文字兜底 |

`classifyRedlineDecision` 返回 4 态（`ClientRedlineDecision` 枚举，位于 `shared/types/contract.ts`）：

| 值 | 含义 |
|----|------|
| `accepted` | 客户接受了 AI 修订（del 消失、ins 保留或已接受入正文） |
| `rejected` | 客户拒绝了 AI 修订（del 保留、ins 消失） |
| `untouched` | 修订标记仍原样存活，客户未动 |
| `ambiguous` | Layer 1/2 均无法确定（如 Word 重排 w:id 后语料也对不上） |

### 13.3 uploadClientVersion 回传接入点

`uploadClientVersionService`（`server/agents/contract/uploadClientVersion.service.ts`）在接收客户回传 docx 时：

1. **Step 2**：调 `parseRedlineMarks` 解析修订信息，得到 `refs`、存活 id 集合、段落语料。
2. **Step 3b**：对每条 ref 调 `resolveCorpusForRef` + `classifyRedlineDecision`，汇总 `redlineDecisions: Map<riskId, ClientRedlineDecision>`。
3. **统一覆盖率安全保护**：批注命中数（批注链路）与修订登记数（`refs.length`）合并计算覆盖率，低于阈值时报 `NO_CONTENT_MATCH` 错误中止处理。跨审查 `reviewId` 不符时也触发同一错误，提示律师确认上传文件是否来自本审查。
4. **Step 5（事务内）**：对 `redlineDecisions` 中每条写 `contractRisks.clientRedlineDecision`；若 `decision === 'accepted'` 且该 risk 的 `archivedStatus` 为 `null`，同步将 `archivedStatus` 置为 `'handled'`（自动解决）；不覆盖律师已有处置（`archivedStatus` 非 null 时跳过自动解决）。

### 13.4 自定义署名

`resolveContractExportSignatureService(userId)`（`server/services/users/contractSignature.service.ts`）：

- 读 `users.contractExportSignature`（VARCHAR(50)）；为空/空白时回退用户账号姓名（`users.name`）；用户不存在时返回安全默认值。
- 导出修订版时，`injectRedlineMarks` 的 `options.signature` 传入署名，修订标记的 `w:author` 写该值；导出批注时 `commentInjector` 同样使用署名作者名。
- 历史写死的 `LS:` 前缀已移除，作者名就是署名本身（如"张三"），Word 修订栏/批注气泡直接显示律师姓名。

署名可通过 `PUT /api/v1/users/profile` 读写（字段 `contractExportSignature`），设置界面位于用户设置页。

### 13.5 Word 兼容性

客户用 Microsoft Word 编辑保存过的 docx 会被 Word 按 OOXML 规范规范化重写，回传识别不依赖任何会被 Word 改动的东西：

- **customXml 定位**：Word 把 `word/customXml/*.xml` 移到包根并改名为 `customXml/item{N}.xml`。回传端用 `customXmlLocator` 按 LexSeek 专有命名空间 URI + 根元素名识别，不靠固定路径（Word 的 `itemProps*.xml` 里 `<ds:schemaRef>` 也带该 URI，故命中 URI 后须 parse 确认根元素本地名以排除 properties 文件）。
- **批注关联**：Word 重排批注 `w:id`，使身份证里写入的 `wId` 主键失效。回传端用 `commentContentMatch` 按批注正文内容匹配（normalizeForMatch 归一化后 exact 优先、calcSimilarity fuzzy 兜底），不靠 `w:id`。
- **修订判定**：Word 重排修订 `w:id` 且新旧编号空间重叠。`parseRedlineMarks` 据「身份证文件是否仍在原始路径」定 `trustWordIds`；被重写过时 `classifyRedlineDecision` 跳过 w:id 精确层、只走正文比对层。
- **跨审查归属**：customXml 文件内容（含 `reviewId`）Word 不篡改，`parseWordComments` 额外返回 `customXmlRefEntries`（不经 wId 过滤），跨审查检测照常。
