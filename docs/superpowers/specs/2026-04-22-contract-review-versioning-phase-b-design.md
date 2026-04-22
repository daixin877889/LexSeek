# 合同审查 · 多版本协作 Phase B 设计文档

> **定位**：Phase A（数据地基 + 首次上传 + 工作区编辑 + 手动保存版本 + 切换历史版本只读）已就绪，Phase B 补齐"客户回传 docx 后的完整处理链路"。
> **内部代号**：`contract-review-versioning-phase-b`（仅用于 spec/分支/字段，**不在用户面前出现**）
> **用户视角**：仍然是"合同审查" —— 律师能做的事多了"上传新版本"，其他无感知新增。

---

## 1. 背景

Phase A 构建了多版本的**地基**：可以产生 `initial_upload` / `lawyer_save` 两类版本，可切换历史版本查看只读快照。但**客户回传后的上传**（`client_return` / `auto_backup` 两类版本）尚未落地。

Phase B 的核心价值：**律师把带批注的合同发给客户 → 客户在 Word 里加/改/删批注、改正文 → 律师上传回传的 docx → 系统无丢失地识别所有变化、自动触发增量审查、保留全部历史讨论**。

这是"合同审查多轮流转"产品承诺（Phase A spec §2.3）的真正落地。

---

## 2. 定位与边界

### 2.1 用户语言层面（延续 Phase A 铁律）

- 用户仍然看到的是"合同审查"
- **不引入新的顶级功能名**（如"协作"、"审阅流"等）
- 上传按钮文案："上传新版本"
- 时间线节点标签：`initial_upload` / `lawyer_save`（Phase A）+ `client_return` / `auto_backup`（Phase B 新增）
- 导出 docx 文件名 `{合同名}_v{N}_{YYYY-MM-DD}.docx`（Phase A 已落地）

### 2.2 Phase B 范围（做的事）

1. "上传新版本"入口 + 分步 SSE 进度展示
2. **自动备份**（`auto_backup` 版本）保护律师在途编辑
3. 解析客户回传的 docx（正文 + comments.xml）
4. 识别正文条款级 diff + 批注的增/删/回复
5. AI 增量审查（仅改动条款重审）+ 全局复核
6. 批注锚点迁移（模糊匹配 + 孤立批注区）
7. 写入工作区 + 创建 `client_return` 快照
8. "本轮变化"摘要横幅 + "AI 已重审" 徽章
9. "外部新增" / "客户已移除" / "孤立批注" 三个分组的展示
10. "恢复推送"律师手动覆盖客户删除意图

### 2.3 Phase B **不做**的事

- 对比抽屉（Phase C）
- 外部新增分组的筛选/分类 UI（Phase C）
- 分步 checkpoint 续跑（失败就回到 `auto_backup` 状态）
- 多律师协作（客户侧不开账户）

### 2.4 与 Phase A 的依赖

- 字段扩展：在 Phase A 已有的 3 张新表上 `ALTER TABLE ADD COLUMN`（6 字段）+ 枚举扩（3 个）
- 版本快照 service 的 snapshotData 扩展 `clauses` 字段
- `useContractReviewVersion` composable 扩展"上传新版本"动作
- `ContractReviewPanel` 加"上传新版本"按钮，打开上传 dialog

---

## 3. 核心概念扩展

补充 Phase A §3 之外的概念：

| 概念 | 定义 |
|---|---|
| **wordCommentRef** | 系统给每条 Word 批注的稳定标识，写入 `w:initials` 字段（格式 `LS:LEXSEEK-{annotationId}-{random8}`）。客户用 Word 编辑不破坏此字段，回传时系统按此识别每条批注对应 DB annotation。 |
| **条款（Clause）** | 合同正文的最小法律语义单元。复用 M4 segment 的切分结果。Phase B 所有 diff、锚点、AI 审查都围绕条款展开。 |
| **条款级 diff** | 对新旧 docx 的条款数组做 LCS（最长公共子序列）对齐，标记新增/删除/修改的条款。 |
| **增量审查** | 仅对 diff 识别出的"改动条款"跑一遍 M4 原有 LangGraph 子图；playbookSnapshot 锁 v1。 |
| **全局复核** | 所有改动完成后，用简化 prompt 跑一次"本轮改动是否引入条款平衡性/一致性问题"的检查；若有输出，生成 1 条 `source=global_review` 的风险条目。 |
| **锚点迁移** | 历史风险挂在改动条款上时，用字符级相似度 + 关键词兜底算法在新条款里重新定位锚点；失败则标 `orphaned=true`。 |
| **客户已移除** | 客户在 Word 里把某条 AI/律师批注删了。系统不物理删，标记 `removedByClient=true` + `suppressInExport=true`；"恢复推送"允许律师手动覆盖。 |

---

## 4. 数据模型 Phase B 扩展

### 4.1 `ContractReviewVersion`（现有表加 1 字段）

```prisma
docxFileId    Int?     @map("docx_file_id")
```

- `client_return` 版本：绑定客户回传的原始 docx OSS 文件
- `initial_upload` / `lawyer_save` / `auto_backup`：仍为 null

### 4.2 `ContractRisk`（现有表加 2 字段 + 扩 1 枚举）

```prisma
originalAnchorQuote String?  @map("original_anchor_quote") @db.Text
orphaned            Boolean  @default(false)
```

- 枚举 `source` 扩展：`ai` / `external_new`（客户新增独立批注升格）/ `global_review`（全局复核）
- 枚举 `archivedStatus` **不扩展**。客户删 AI 批注对应风险的"已移除"状态通过批注侧 `ContractAnnotation.removedByClient + suppressInExport` 表达（见 §4.3），不在风险侧重复建模

### 4.3 `ContractAnnotation`（现有表加 3 字段 + 扩 1 枚举）

```prisma
wordCommentRef   String?  @map("word_comment_ref") @db.VarChar(60)
removedByClient  Boolean  @default(false) @map("removed_by_client")
suppressInExport Boolean  @default(false) @map("suppress_in_export")

@@index([wordCommentRef])
```

- `authorType` 枚举扩展：新增 `external`（客户批注）

### 4.4 `VersionSystemLabel` 枚举扩展

- 枚举扩展：新增 `client_return` / `auto_backup`
- `VERSION_SYSTEM_LABEL_DISPLAY` 扩展：`client_return: '客户回传'` / `auto_backup: '自动备份'`

### 4.5 `snapshotData` JSON 结构扩展

```jsonc
{
  "risks": [...],
  "annotations": [...],
  "docxText": "...",
  "clauses": [                         // Phase B 新增
    { "index": 0, "text": "...", "offsetStart": 0, "offsetEnd": 123 },
    { "index": 1, "text": "...", "offsetStart": 123, "offsetEnd": 245 }
  ]
}
```

`clauses` 是"条款数组"：对应 M4 segment 阶段切出来的 Clause，用于 diff/锚点。Phase B 新产生的版本会写入此字段；Phase A 存量版本（`docxText` 为空的）读取时 fallback 成空数组。

---

## 5. 上传客户回传 docx 的 6 步流程

### 5.1 流程图

```
律师点"上传新版本" → 选客户回传的 docx
         │
         ▼
 [Step 1] auto_backup
   - 把工作区当前 ContractRisk + ContractAnnotation + currentVersion.docxText dump 成新版本
   - systemLabel = 'auto_backup'
         │
         ▼
 [Step 2] 解析新 docx
   - 提取 docxText + clauses[]（走 M4 segment 逻辑）
   - 提取 comments.xml 的 raw 批注数组（含 author / w:id / w:initials / content）
         │
         ▼
 [Step 3] 识别差异
   - 正文条款级 LCS diff → { added[], removed[], modified[] }
   - 批注 wordCommentRef 比对 → { kept[], modifiedContent[], removed[], newByClient[] }
         │
         ▼
 [Step 4] AI 增量审查 + 全局复核
   - 对 modified[].clauses 逐条跑 M4 子图（playbook 锁 v1）
   - 跑全局复核简化 prompt（输入：所有改动条款 + 原有风险摘要）
         │
         ▼
 [Step 5] 锚点迁移
   - 历史风险（挂在 modified[].clause 上）：字符级相似度匹配 → 失败 → 关键词兜底 → 失败 → orphaned=true
   - originalAnchorQuote 首次迁移时记录
         │
         ▼
 [Step 6] 写工作区 + 新版本快照
   - 应用变更到 ContractRisk / ContractAnnotation 表
   - 创建 ContractReviewVersion { systemLabel: 'client_return', docxFileId }
   - ContractReview.currentVersionId 指向新版本
```

### 5.2 SSE 事件协议（**独立 SSE 端点**，不复用 contract review stream）

**重要修正**：Phase A 的 `emitContractReviewEvent` 通道绑定在 LangGraph agent run（需 `runId + sessionId`），上传新版本是独立 HTTP POST 不跑 agent，**无法复用该通道**。Phase B 的上传端点必须自己直接返回 `text/event-stream` 响应体，前端用 `EventSource` 或 `fetch + reader` 消费。

端点签名：

```
POST /api/v1/assistant/contract/reviews/:id/upload-version
  Content-Type: application/json
  body: { ossFileId: number }
  Response: text/event-stream（分步事件流，结束时 close）
```

事件类型（每步仅发一次 `done`，不发 running；前端自己把"未发 done 的步骤"视为进行中）：

```jsonc
{ "event": "upload-version-progress", "data": { "step": "backup",  "status": "done" } }
{ "event": "upload-version-progress", "data": { "step": "parse",   "status": "done" } }
{ "event": "upload-version-progress", "data": { "step": "diff",    "status": "done", "externalChangeCount": 4, "clauseModifiedCount": 1 } }
{ "event": "upload-version-progress", "data": { "step": "ai",      "status": "progress", "total": 2, "current": 1 } }
{ "event": "upload-version-progress", "data": { "step": "ai",      "status": "done" } }
{ "event": "upload-version-progress", "data": { "step": "merge",   "status": "done", "newVersionId": 123 } }
{ "event": "upload-version-complete", "data": { "newVersionId": 123, "summary": "4 条外部变更 · 1 条正文修改 · AI 已重审" } }
```

事件类型枚举放 `#shared/types/contract.ts` 的 SSE 常量表（和项目现有字符串枚举规范一致），前后端共用避免字符串硬编码漂移。

前端展示：5 个步骤圆点，收到某步 `done` 事件切下一步为 active；ai 步骤的 `progress` 事件用于显示"正在重审第 N/M 条"。

### 5.3 自动备份幂等规则（Phase A spec §4.3.1 落地）

若工作区相对 `currentVersionId` 无任何编辑差异（`ContractRisk.updatedAt` 和 `ContractAnnotation.createdAt` 的最大值 ≤ currentVersion.createdAt），**跳过 auto_backup**，直接处理新 docx → 生成 `client_return`。避免产生冗余快照。

**跳过 auto_backup 时的失败回退**：若未生成 auto_backup（无工作区编辑）且 Step 2-6 中任一步失败，律师回到**上传前的 currentVersion 状态**（原 currentVersion 未变，工作区状态未动）；若已生成 auto_backup 后某步失败，则回到 auto_backup 状态（currentVersionId 指向 auto_backup）。

---

## 6. wordCommentRef 机制

### 6.1 commentInjector 重写（不是改造）

**重要修正**：现有 `server/services/assistant/contract/docx/commentInjector.ts` 的入口是 `injectComments(docxBuffer, risks: Risk[])`，按 Risk 索引生成 `w:id`，`w:author` 硬编码为 "LexSeek 审查助手"，**没有 annotation 概念**。Phase B 需要**重写**为按 annotation 注入的新入口（保留旧入口作为向下兼容兜底，或一次性迁移替换）：

```ts
// 新入口（子期 B1 实现）
injectAnnotations(docxBuffer: Buffer, annotations: ContractAnnotationForExport[]): Buffer

interface ContractAnnotationForExport {
    id: number
    riskId: number
    authorType: 'ai' | 'lawyer' | 'external'
    authorName: string        // AI=固定 "AI"，lawyer=律师姓名，external=Word author 原值
    content: string
    parentAnnotationId: number | null  // Word answer reply 父子关系
    anchorQuote: string       // 挂在文档的哪段文字上
    anchorParagraphIndex: number
    wordCommentRef: string | null   // 已存在则沿用；为 null 则函数内部生成
}
```

内部逻辑：
1. 对每条 annotation，若 `wordCommentRef` 非空沿用；否则新生成 `LEXSEEK-{annotationId}-{random8}` 并**回写 DB**
2. 组装每条 `<w:comment>` 元素时：
   - `w:id` = 按顺序 0, 1, 2, ...（Word 本地 id）
   - `w:author` = 作者名，**加 `LS:` 前缀**（如 `LS:AI`、`LS:张律师`、`LS:外部/某某某`）—— 保证客户在 Word 主视图一眼看到 `LS:` 标识
   - `w:initials` = `LEXSEEK-{annotationId}-{random8}`（作为系统稳定身份证，无 `LS:` 前缀以节省长度）
   - `parentAnnotationId` 非空时，同时输出对应的 Word "答复批注" XML 结构（引用父 comment 的 `w:id`）
3. 返回新 docx buffer + 每条 annotation 的 `wordCommentRef`（调用方可用于 DB 回写）

**关于客户可见性**：Word 批注卡片的头像位置显示 `w:author`（主字段），通常也会显示 `w:initials` 的前两字符作为头像文字。两处都带 `LS` 前缀，确保客户**在主视图**就能识别系统标识而非真实作者名。

### 6.2 回传时识别

解析回传 docx 的 comments.xml，对每条 `<w:comment>`：

```
initials = comment.attr('w:initials')
if initials matches /^LEXSEEK-\d+-[a-zA-Z0-9]{8}$/:
    systemAnnotationId = parse(initials).annotationId
    → 命中系统 annotation（按 id 查 DB）
    → DB 原 content 保留（不管客户是否改过文本，Phase B 统一以系统库为准；
       "客户改过 AI 批注文本" 的识别与 UI 提示放 Phase C，避免引入额外展示维度）
else:
    → 识别为客户新增（建立新 annotation，authorType='external'）
```

客户用 Word 的"答复批注"功能生成的子 comment（注：`initials` 不含 `LS:` 前缀）：

```
parent w:id → 找到父 comment → 若父的 initials 命中系统 annotation：
    子 comment 作为 child annotation 入库：authorType='external', parentAnnotationId=父 DB id
若父 comment 没有匹配 initials（是客户新增的根）：
    父+子 都作为独立 annotation 入库，保持父子关系
```

### 6.3 客户删除 AI 批注的识别

DB 里 annotation 存在但回传 docx 里找不到匹配的 `LEXSEEK-{id}-{rand}` initials：

```
annotation.removedByClient = true
annotation.suppressInExport = true   // 下次导出跳过
```

UI 在"客户已移除"分组折叠显示；"恢复推送"按钮点后仅将 `suppressInExport=false`（`removedByClient=true` 保留作为历史记录）。

### 6.4 极端兜底

若客户通过非 Word 渠道（WPS、Google Docs 另存、OCR 转换等）把 docx 的 `w:initials` 全洗了：

- 所有 comment 都识别为"客户新增"
- DB 里的历史 annotation 不会被 `removedByClient` 标记（因为系统查不到对应关系，保守处理）
- 前端 UI 顶部横幅提示"本次上传未识别到历史批注对应关系，已按外部新增处理"

---

## 7. 条款 diff 算法

### 7.1 输入

- **A**: `oldClauses: Clause[]`（来自 currentVersion.snapshotData.clauses，或 Phase A 存量的为空数组）
- **B**: `newClauses: Clause[]`（当前解析的新 docx）

### 7.2 算法：LCS 对齐（`diff-match-patch@^1.0.5` · 已在 package.json）

1. 用 `diff-match-patch`（项目已有依赖，含 TypeScript 定义）对 A/B 的条款**文本**序列做 LCS 对齐：
   - 完全相同的条款 → `kept`
   - A 有 B 没有 → `removed`
   - B 有 A 没有 → `added`
   - **同位置但文本不同**（LCS 允许这种配对）→ 归入 `modified`，不再引入相似度阈值做"拆删+增"的分支（简化实施；即便相似度低，后续锚点迁移失败会自然走孤立批注区，效果等价）

2. 输出 `{ added[], removed[], modified[] }` 三个数组

### 7.3 兜底

- `oldClauses` 为空（Phase A 存量数据）→ 全部 newClauses 视为 `added`，不做 AI 重审（新条款没有历史风险可对齐，直接跳过增量审查）
- 客户只改了空格/换行/不可见字符 → 相似度 > 0.95，直接归为 `kept`（不触发重审）

---

## 8. 锚点模糊匹配

### 8.1 触发场景

`modified[].oldClause` 上挂的每条历史风险/批注，锚点要在 `newClause` 内重新定位。

### 8.2 算法（两段）

**第一段：字符级相似度匹配**
- 输入：`anchorQuote`（历史锚点原文，可能 20-100 字）+ `newClauseText`
- 算法：滑动窗口在 `newClauseText` 上取与 `anchorQuote` 等长的子串，计算 Levenshtein 相似度
- 取相似度最高的子串；若最高 ≥ 0.6 → 命中，更新锚点

**第二段：关键词兜底**
- 从 `anchorQuote` 提取 2-3 个关键词（过滤停用词，按字符长度/频率挑选）
- 在 `newClauseText` 搜索"包含所有关键词的最短子串"
- 若找到 → 命中，更新锚点；否则 → `orphaned=true`

### 8.3 副作用

- 首次迁移时：`originalAnchorQuote = 历史 anchorQuote`
- `anchorQuote` / `anchorParagraphIndex` / `anchorCharStart` / `anchorCharEnd` 全部刷新为新定位
- UI 在该风险卡片上显示"原文已修改"Tooltip，悬浮显示 `originalAnchorQuote`

### 8.4 性能

- 单条风险的匹配耗时 < 20ms（纯字符串算法）
- 一份合同通常 10-30 条风险，全匹配 < 1s，可接受同步执行

---

## 9. AI 增量审查 + 全局复核

### 9.1 增量审查

**复用 M4 的 `analyzeSingleClause` 函数**（位于 `server/services/assistant/contract/analyzeSingleClause.ts`，已是独立导出的纯函数）：

- 输入：`modified[].newClause`（改动后的条款原文）+ 以下上下文字段（**都从 `contractReviews` 表直接读**，不要求客户重新选择立场或合同类型）：
  - `stance`、`partyA`、`partyB`、`contractType`
  - `playbookSnapshot`（锁 v1，直接读 `review.playbookSnapshot`）
- 输出：0-N 条新的 `ContractRisk`（source=ai）
- **处置保护**：已存在的 AI 风险如果标了 `archivedStatus != null`，增量审查**不允许**覆盖；即便同一条款上 AI 识别出"类似风险"，也只新增 risk 条目，不改旧的

实现细节：
- 旧风险挂在 `oldClause`；锚点迁移后挂到 `newClause`
- 增量审查新产生的风险也挂到 `newClause`
- **重叠风险（新旧都识别出"违约金过高"）的展示**：Phase B 不做特殊合并/去重；两条并列在 RiskListPanel 里显示，律师自行处理。后续观察到需要合并再 Phase C 补

### 9.2 全局复核

**简化 prompt，单次 chatModel 调用**（不走 LangGraph 子图）：

- 模型通过 `createChatModel(getValidNodeConfig('contractReviewGlobalReview'))` 统一走项目 node 配置（和 `analyzeSingleClause` 保持同一套模型选择机制）
- 在 DB `node` 表新增节点 `contractReviewGlobalReview` + 对应 prompt 条目（挂在 `server/services/workflow/nodes/contractReviewGlobalReview/prompts/` 或项目现有 prompts 组织路径）—— 保持"prompt 可运营热更"的现有约定，不要硬编码在 TS 文件里
- Prompt 骨架（写入 DB 时的初版）：

```
System: 你是合同审查专家。
User:
  原合同摘要：{ overview.summary }
  所有改动条款及其新内容：[{ clauseIndex, oldText, newText }, ...]
  已有未处置风险列表（摘要）：[{ category, level }, ...]

请判断：本轮改动是否引入新的条款平衡性问题或连锁风险？
- 若有，输出一个 JSON：{ category, level, problem, analysis, suggestion }
- 若无，输出：{ "noIssue": true }
```

- 有输出 → 创建 1 条 `source=global_review` 的风险
- 无输出 → 跳过
- 触发条件：只要 `modified[].length > 0` 就跑（后续观察到无用可升级为阈值触发，决策 8）

### 9.3 失败处理

- 单条条款增量审查失败 → 该条款的重审结果标 "审查失败，请手动检查"（不阻塞整个上传链路）
- 全局复核失败 → 跳过（不创建 global_review 风险）；前端横幅提示"全局复核未能完成，可手动触发重试"（重试按钮在 Phase C 做）

---

## 10. 客户新增独立批注

### 10.1 识别

回传 docx 里的 comment 没有 `LS:LEXSEEK-` 前缀，且不是某已识别批注的 child → 视为"客户新增独立批注"。

### 10.2 处理

- 创建 1 条新 `ContractRisk` { `source='external_new'`, `level='medium'`（默认）, `category='客户新增'`, `problem=批注内容`, `anchorQuote=批注锚定文本` }
- 同时创建 1 条挂在此 risk 下的 `ContractAnnotation` { `authorType='external'`, `authorName=comment.w:author`, `content=批注内容` }

### 10.3 UI 展示

- 风险清单顶部固定显示"外部新增（N）"分组
- 卡片左侧竖条用**琥珀色**（和 AI 风险的红/黄/绿区分）
- 每条显示：作者名 + "外部批注"标签 + 内容摘要
- 律师可给这条"标处置"/"回复"，但不能改 AI 五段式字段（本来就没有）

---

## 11. 异常与兜底

| 场景 | Phase B 行为 |
|---|---|
| 客户改了空格/标点 | 条款相似度 > 0.95，不触发重审 |
| 客户重写整个条款 | 相似度 < 0.5，拆成"删+增"；历史风险按锚点迁移走孤立批注区 |
| 客户用 WPS 等工具洗掉 `w:initials` | 全识别为"外部新增"；顶部横幅提示 |
| 增量审查某条款失败 | 标"审查失败"，不阻塞；版本仍产生 |
| 全局复核失败 | 跳过；横幅提示 |
| 上传中断（断网、解析错）| auto_backup 已完成 → 回到 auto_backup 状态；client_return 不生成 |
| 工作区无差异时上传 | 跳过 auto_backup；直接产 client_return |
| 客户在 Word 里改了 AI 批注的文本 | DB 原 content 保留；UI 显示"客户编辑过"标记（Phase B 不做，Phase C 补）|
| 客户在 Word 里改了 AI 批注的文本 | Phase B **统一以系统库为准**（客户的文本编辑被忽略），不做"客户编辑过"徽章；Phase C 再决定是否需要暴露"客户改过批注文本"的信号 |
| 客户上传一份完全不相干的 docx | 条款 LCS 大量 removed/added；锚点全失败 → 所有历史风险进孤立区。属于兜底兼容（非 Phase B 必做的 UI）：可以不加 UI 警告，让律师通过"孤立批注数 = 几乎全部"自然感知 |

---

## 12. UI 交互规范

### 12.1 "上传新版本"触发点

- 位置：ContractReviewPanel 顶部工具栏，紧邻"保存新版本"按钮
- 图标：`UploadIcon`（lucide-vue-next）
- 仅在工作区态可用；只读态禁用 + tooltip "仅在工作区可操作"

### 12.2 上传 Dialog

- shadcn `Dialog` + `DialogContent`
- 标题："上传新版本 — 客户回传的 docx"
- 提示 banner（`bg-primary/5 border-primary/20`）："上传后系统会自动备份你当前的编辑，防止工作内容丢失"
- 文件选择：拖拽 + 点击，仅 accept `.docx`。**走项目现有 OSS 预签名上传链路**（复用 `useBatchUpload`，和 `NewReviewDialog` 首次上传保持一致）：前端先拿 `ossFileId`，再 POST `{ossFileId}` 到 `/upload-version` 端点
- 选文件后变为分步进度列表（5 步），每步一个圆点 + 文案
  - 未开始：灰色空心圆
  - 进行中：蓝色实心圆 + `animate-pulse`
  - 完成：绿色实心圆 + Check 图标
  - 失败：红色实心圆 + X 图标
- 所有步骤完成 → Dialog 自动关闭 + toast "新版本已就绪 · N 处变更"（文案不暴露 `client_return` / `external` 等技术词）

### 12.3 本轮变化横幅

- 位置：结果屏顶部（只读横幅之下，如两者并存）
- 样式：`bg-primary/5 text-primary` + 信息图标
- 内容：精简为 **2 项统计**（diff 事件回传 `externalChangeCount` + `clauseModifiedCount`）：
  - 示例："v3 客户回传 · 外部变更 4 处 · 正文改 1 处 · AI 已重审"
  - "外部变更" 包含客户的回复 / 新增 / 删除（合并成一个数字，UI 不再细分三类）
  - 用户可见文案不出现技术词（不用 `client_return` / `external_new` 字符串）
- 关闭态持久化：`localStorage['lexseek:contractReview:bannerDismissed:<versionId>'] = '1'`（统一 key 前缀，避免冲突）
- 仅在切换到 `client_return` 类型的版本（或工作区基于 client_return 的首次访问）时显示

### 12.4 风险卡片新增徽章

- "AI 已重审"：`bg-primary/10 text-primary` 小徽章（Tailwind v4 主题 token，不用 `-100 / -700` 刻度）
- "风险降级"：`bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200` —— 用现有风险等级色 token
- "风险升级"：`bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-200`
- "原文已修改"：卡片正文锚点旁小 i 图标（`Info` from lucide-vue-next），悬浮显示 `originalAnchorQuote`

### 12.5 分组显示

- **外部新增（N）· 顶置**：风险清单最顶，卡片左侧琥珀色竖条
- **客户已移除（N）· 折叠在底部**：点击展开后每条有"恢复推送"按钮（点击弹确认 dialog）
- **孤立批注（N）· 原文已修改**：在主风险清单末尾，卡片背景淡琥珀色，有"查看原始语境"按钮跳到最近能定位的历史版本

### 12.6 恢复推送确认 Dialog

- 标题："确认恢复推送？"
- 内容：`"${risk.category}" 已被客户在 v{N} 里明确删除。再次推送到下次导出的 Word 文件中，可能引起客户反感。确认继续吗？`
- 按钮：取消 / **确认恢复**（`variant="destructive"`）

---

## 13. 现有地基复用（精确路径）

| 地基 | Phase B 如何用 |
|---|---|
| `server/services/assistant/contract/docx/commentInjector.ts` | **重写**（不是改造）：新增 `injectAnnotations(buf, annotations[])` 入口（见 §6.1），保留旧 `injectComments(buf, risks[])` 入口作为兜底或迁移替换 |
| `server/services/assistant/contract/docx/clauseSegmenter.ts` 的 `segmentClauses(fullText, options)` | 复用：Step 2 解析新 docx 时，先 `loadContractFullText(ossFileId)` 拿 fullText，再 `segmentClauses` 切条款 |
| `server/services/assistant/contract/analyzeSingleClause.ts` | 复用（独立导出的纯函数）：增量审查把 modified.newClause 逐条送入；入参 `stance/partyA/partyB/contractType/playbookSnapshot` 全部从 `contractReviews` 表字段直接读 |
| `createChatModel` + `getValidNodeConfig` | 全局复核通过 `createChatModel(getValidNodeConfig('contractReviewGlobalReview'))` 走统一的模型选择，不硬编码 chatModel |
| `diff-match-patch@^1.0.5` + `@types/diff-match-patch`（**package.json 已存在**）| 直接用于条款 LCS diff |
| `app/composables/useBatchUpload.ts` 的 `uploadToOSS(file, sig, onProgress)` | 复用：前端上传走 OSS 预签名，拿到 `ossFileId` 后再调 `/upload-version` 端点 |
| `app/composables/useContractReviewVersion.ts` | 扩展：增加 `uploadNewVersion(ossFileId)` 方法，内部用 `EventSource` 或 `fetch + reader` 消费上传端点的 SSE 响应 |
| `server/services/assistant/contract/reviewGuard.ts` 的 `loadOwnedReview(event, {actionLabel})` | 复用：`POST /reviews/:id/upload-version` 端点首行调 `loadOwnedReview`，禁止手写归属校验或走 `checkIsSuperAdmin` 旁路 |
| Phase A 的时间线组件 `ContractVersionTimeline.vue` | 复用：`VERSION_SYSTEM_LABEL_DISPLAY` 加 `client_return='客户回传'` / `auto_backup='自动备份'` 两个 key |
| `app/components/assistant/contract/RiskListPanel.vue` | 扩展：支持"外部新增"顶置分组、"客户已移除"折叠分组、"孤立批注"区 |

**关键注意事项**：
- `emitContractReviewEvent` 通道（Phase A 已有的 contract review stream）**不能复用**—— 它绑定在 LangGraph agent 的 `runId + sessionId`，上传端点不跑 agent。上传端点必须自己直接返回 `text/event-stream` 响应体
- Phase B 上线后，`saveContractReviewVersionService`（Phase A 已有）的 `snapshotData` 必须**同时写 `clauses` 字段**（不止 `initial_upload` 和 `client_return`，`lawyer_save` 和 `auto_backup` 也要写），确保后续 diff 有 `oldClauses` 可对齐。这要求修改 `persistRisksAndCreateV1Snapshot`（M4 链路）和 `saveContractReviewVersionService` 本身。

---

## 14. 实施子期拆分（写 plan 时参考）

### 14.1 子期 B1 · 数据层 + 上传骨架（~1.5 天）

**新 service 文件（命名统一）**：
- `server/services/assistant/contract/uploadClientVersion.service.ts`（上传链路编排）
- `server/services/assistant/contract/wordCommentRef.service.ts`（生成/解析/对齐稳定身份证）
- `server/services/assistant/contract/clauseDiff.service.ts`（条款 LCS diff，B2 用）
- `server/services/assistant/contract/anchorMigrate.service.ts`（锚点模糊匹配，B2 用）

**B1 清单**：
- Phase B Prisma 迁移：用 `bun run prisma:migrate --name add_contract_review_phase_b_fields --create-only` 生成 → 人工审阅 SQL（确保仅 `ALTER TABLE ADD COLUMN` + `CREATE INDEX`，不要 DROP 或改 risks JSON 字段）→ `bun run prisma:migrate` 应用到本地 + `prisma:deploy` 到测试库
- shared/types 扩展：新枚举值（`VersionSystemLabel`、`RiskSource`、`AnnotationAuthorType`）+ 新实体字段 + SSE 事件类型枚举（如 `ContractReviewSSEEvent.UPLOAD_VERSION_PROGRESS`）
- `commentInjector.ts` 新增 `injectAnnotations` 入口（旧 `injectComments` 保留，M5 原路径不中断）
- `wordCommentRef.service.ts`：生成 `LEXSEEK-{id}-{rand8}`、校验 initials 格式、反解析 annotationId
- 改造 `persistRisksAndCreateV1Snapshot` + `saveContractReviewVersionService`：snapshotData 同时写 `clauses` 字段（Phase B 上线后所有新版本都要写，Phase A 存量 fallback 空数组）
- 端点骨架 `POST /api/v1/assistant/contract/reviews/[id]/upload-version.post.ts`：body `{ossFileId}` + 首行 `loadOwnedReview(event, {actionLabel: '上传新版本'})` + 返回 `text/event-stream`
- 此期端点只实现 backup + parse + merge 三步（diff 和 ai 步骤占位跳过，client_return 只复制 auto_backup 的数据；留着子期 B2/B3 填充）
- `useBatchUpload` 集成：前端先 OSS 预签名上传拿 `ossFileId` 再调端点
- `useContractReviewVersion.uploadNewVersion(ossFileId)` 前端方法（消费 SSE 流）
- `ContractReviewPanel` 加"上传新版本"按钮（lucide `UploadIcon`，只读态禁用）+ Dialog 分步进度 UI（B1 阶段先渲染 3 步骨架：备份 / 解析 / 合并；B2/B3 扩展到 5 步）
- 验证收尾：`npx nuxi typecheck` + 相关单元测试 + `prisma migrate status` 无 drift

### 14.2 子期 B2 · 批注识别 + 条款 diff + 锚点迁移（~2 天）

- 解析 comments.xml 提取 raw 批注（作者名 / initials / content / parent）
- 按 initials 的 `LEXSEEK-{id}-{rand8}` 格式比对识别：kept / removed / newByClient（"modifiedContent" 场景不识别，以系统库为准，见 §6.2）
- `clauseDiff.service.ts`：用 `diff-match-patch` 做条款 LCS 对齐
- `anchorMigrate.service.ts`：字符级 Levenshtein 模糊匹配；失败标 `orphaned=true`（关键词兜底推迟到观察线上数据后再决定，见 §15）
- `originalAnchorQuote` 首次迁移时记录
- 孤立批注区 UI + "原文已修改"Tooltip（主题 token：`bg-primary/10 text-primary`）
- 客户已移除分组 UI（折叠在清单底部）+ "恢复推送"确认 Dialog（保留 destructive 变体 + 警告文案，不改 toast）
- 外部新增分组 UI（顶置，琥珀色竖条）
- SSE 进度事件扩展（加 diff 步骤，回传 `externalChangeCount` + `clauseModifiedCount` 两项统计）
- 验证收尾：`npx nuxi typecheck` + 测试 + `prisma migrate status`

### 14.3 子期 B3 · AI 增量审查 + 全局复核 + 联调（~1.5 天）

- 增量审查：把 modified[].newClause 逐条送入 `analyzeSingleClause`（`stance/partyA/partyB/contractType/playbookSnapshot` 从 review 表读）
- 全局复核：
  - 在 DB `node` 表新建节点 `contractReviewGlobalReview`（含 prompt 条目）
  - 通过 `createChatModel(getValidNodeConfig('contractReviewGlobalReview'))` 调用
  - 有产出时创建 1 条 `source=global_review` 的 ContractRisk
- 处置保护：增量审查不覆盖 `archivedStatus != null` 的风险
- SSE 进度事件扩展（加 ai 步骤，支持 `progress: {current, total}` 事件）
- "AI 已重审" / "风险降级" / "风险升级" 徽章（主题 token：`bg-primary/10 text-primary` + rose/emerald 等级色）
- 本轮变化横幅（2 项统计简化版）
- 端到端手测 + 已知 edge case 覆盖（空白调整、整段重写、客户 docx 无关、客户用 WPS 洗 initials）
- 验证收尾：`npx nuxi typecheck` + 全量 vitest + `prisma migrate status`

**合计工期：5 天**（与 Phase A 同节奏）

---

## 15. 开放问题（实施时再定）

- 字符相似度阈值（`0.5` / `0.6` / `0.7`）：实现阶段跑真实合同样本调参，`anchorMigrate.service` 支持可配置阈值
- 关键词兜底算法（Phase C 再决定是否加）：若上线观察到纯字符匹配的 orphaned 率高，再引入。候选方案：简单 TF + 停用词 / jieba 中文分词 / embedding 相似度
- 全局复核 prompt 模板：按 §9.2 骨架写 DB 节点 `contractReviewGlobalReview` 初版，prompt 文本在 `server/services/workflow/nodes/<node>/prompts/` 或按项目现有组织位置
- 上传失败态文案：Phase B 先用笼统 toast "上传失败，请重试"；具体分步失败信息 + 重试按钮放 Phase C
- 客户可见标识 `LS:`（决策 14）客户感知度：上线后收集反馈，Phase C 可考虑把 `w:author` 从 `LS:AI` 改为更友好的 `LexSeek 合同审查系统` 之类
- `LS:LEXSEEK-{id}-{rand8}` 直接暴露系统 id 给客户的产品风险：Phase B 接受；若客户反馈困惑，Phase C 再混淆为短 hash

---

## 附录：决策清单（brainstorm 定案）

| # | 决策 | 选项 |
|---|---|---|
| 1 | `wordCommentRef` 存放位置 | **A**: `w:initials` 存 `LEXSEEK-{id}-{rand8}` 稳定标识 + `w:author` 双写加 `LS:` 前缀让客户主视图可见 |
| 2 | 正文 diff 对齐单位 | **A**: 条款（Clause，复用 M4 segment）|
| 3 | 条款对齐算法 | **B**: LCS 最长公共子序列（`diff-match-patch` 或 `fast-diff`）|
| 4 | 锚点模糊匹配算法 | **A**: Phase B 先只用字符级 Levenshtein（阈值 0.6），关键词兜底推迟到观察 orphaned 率后 Phase C 再决定 |
| 5 | AI 增量审查实现 | **C**: 增量审查复用 M4 子图；全局复核走简化 prompt 单次调用 |
| 6 | 上传 SSE 协议 | 上传端点**独立**返回 `text/event-stream`（不复用 LangGraph contract review stream，因绑 agent run 不适用）；事件枚举放 `#shared/types/contract.ts` 共用 |
| 7 | 失败/中断恢复 | **A**: auto_backup 已成功 → 回到 auto_backup 状态；不做分步 checkpoint 续跑 |
| 8 | 全局复核触发条件 | **A**: 只要有任意改动条款就跑（先无脑覆盖所有场景）|
| 9 | 实施分期 | B1 数据地基+上传骨架 / B2 批注识别+锚点迁移 / B3 AI 增量审查+联调 |
| 10 | "外部新增"独立批注处理 | 升格为 `source=external_new` 的 ContractRisk，顶置分组显示 |
| 11 | "客户已移除"批注处理 | `removedByClient=true` + `suppressInExport=true` 软删；律师可"恢复推送" |
| 12 | 锚点无法定位处理 | `orphaned=true`，进"孤立批注"分组；保留 `originalAnchorQuote` 供 tooltip |
| 13 | 已处置风险保护 | 增量审查**不能**覆盖 `archivedStatus != null` 的风险 |
| 14 | `LS:` 前缀可见性 | 客户看到 Word 批注作者显示为 `LS: LEXSEEK-42-a3b8c9d2`，视为系统标识 |
| 15 | Phase A 存量数据兼容 | 存量 snapshot 无 `clauses` 字段时视为空数组，不触发历史风险的锚点迁移 |
