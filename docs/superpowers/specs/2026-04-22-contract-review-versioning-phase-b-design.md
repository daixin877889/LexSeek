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
- 枚举 `archivedStatus` 扩展：`handled` / `ignored` / `client_removed`（客户在 Word 里删的 AI 风险对应的状态，下次导出不推送）

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

### 5.2 SSE 事件协议（复用现有 contract review stream 通道）

服务端按步骤发送事件：

```jsonc
{ "event": "upload-version-progress", "data": { "step": "backup",  "status": "running" } }
{ "event": "upload-version-progress", "data": { "step": "backup",  "status": "done" } }
{ "event": "upload-version-progress", "data": { "step": "parse",   "status": "running" } }
{ "event": "upload-version-progress", "data": { "step": "parse",   "status": "done" } }
{ "event": "upload-version-progress", "data": { "step": "diff",    "status": "running" } }
{ "event": "upload-version-progress", "data": { "step": "diff",    "status": "done", "changedClauseCount": 2, "clientAddedCount": 1, "clientRemovedCount": 1 } }
{ "event": "upload-version-progress", "data": { "step": "ai",      "status": "running", "total": 2, "current": 1 } }
{ "event": "upload-version-progress", "data": { "step": "ai",      "status": "done" } }
{ "event": "upload-version-progress", "data": { "step": "merge",   "status": "running" } }
{ "event": "upload-version-progress", "data": { "step": "merge",   "status": "done", "newVersionId": 123 } }
```

前端展示：5 个步骤圆点 + 当前 active 步带动画，完成后关闭 dialog 跳到新版本工作区并显示本轮变化横幅。

### 5.3 自动备份幂等规则（Phase A spec §4.3.1 落地）

若工作区相对 `currentVersionId` 无任何编辑差异（`ContractRisk.updatedAt` 和 `ContractAnnotation.createdAt` 的最大值 ≤ currentVersion.createdAt），**跳过 auto_backup**，直接处理新 docx → 生成 `client_return`。避免产生冗余快照。

---

## 6. wordCommentRef 机制

### 6.1 生成与写入

系统导出 docx 时，`commentInjector.ts` 对每条需要导出的 annotation：

1. 若 `annotation.wordCommentRef` 非空 → 直接用
2. 否则新生成：`LEXSEEK-{annotationId}-{random8}` + 写回 DB
3. 组装 comments.xml 时，`<w:comment w:id="N" w:initials="LS:LEXSEEK-{annotationId}-{random8}" ...>`

**前缀 `LS:`** 让客户看 Word 批注时能识别"这是系统自动生成的标识，不是真实作者名"。

### 6.2 回传时识别

解析回传 docx 的 comments.xml，对每条 `<w:comment>`：

```
initials = comment.attr('w:initials')
if initials starts with 'LS:LEXSEEK-':
    systemAnnotationId = parse(initials).annotationId
    → 命中系统 annotation（按 id 查 DB）
    → 检查 content 是否变化：
        - 内容相同：保留
        - 内容不同（客户改了 AI 批注文本）：标记 "客户改过" / 保留 DB 原内容 + UI 提示
else:
    → 识别为客户新增（建立新 annotation，authorType='external'）
```

客户用 Word 的"答复批注"功能生成的子 comment：

```
parent w:id → 找到父 comment → 若父命中系统 annotation：
    子 comment 作为 child annotation 入库：authorType='external', parentAnnotationId=父 DB id
若父 comment 没有 wordCommentRef（是客户新增的根）：
    父+子 都作为独立 annotation 入库，保持父子关系
```

### 6.3 客户删除 AI 批注的识别

DB 里 annotation 存在但回传 docx 里找不到对应 `wordCommentRef`：

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

### 7.2 算法：LCS 对齐 + 字符相似度判定修改

1. 用 `diff-match-patch` 或 `fast-diff` 库对 A/B 的条款**文本**序列做 LCS 对齐：
   - 完全相同的条款 → `kept`
   - A 有 B 没有 → `removed`
   - B 有 A 没有 → `added`
   - **同位置但文本不同**（LCS 允许这种配对）→ 候选 `modified`

2. 对候选 `modified` 的每对 `(oldClause, newClause)`，计算字符级相似度（Levenshtein / 归一化到 [0,1]）：
   - 相似度 ≥ 0.5：视为"同一条款的修改"
   - 相似度 < 0.5：视为"删 + 增"（拆成一个 `removed` 一个 `added`）

3. 输出 `{ added[], removed[], modified[] }` 三个数组

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

**复用 M4 的 LangGraph 子图**（`contractReviewMainAgent` 的 `analyzeSingleClause` 节点）：

- 输入：`modified[].newClause`（改动后的条款原文）+ `playbookSnapshot`（锁 v1）
- 输出：0-N 条新的 `ContractRisk`（source=ai）
- **处置保护**：已存在的 AI 风险如果标了 `archivedStatus != null`，增量审查**不允许**覆盖（即便同一条款上 AI 识别出"类似风险"，也只新增 risk 条目，不改旧的）

实现细节：
- 旧风险挂在 `oldClause`；锚点迁移后挂到 `newClause`
- 增量审查新产生的风险挂到 `newClause`
- 两者可能重叠（新老都识别出"违约金过高"）→ 按产出时机并列存在，律师人工决定如何处理

### 9.2 全局复核

**简化 prompt，单次 chatModel 调用**（不走子图）：

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
- 触发条件：只要 `modified[].length > 0` 就跑（后续观察到无用可升级为阈值触发）

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
| 客户上传一份完全不相干的 docx | 条款 LCS 大量 removed/added；锚点全失败 → 所有历史风险进孤立区。律师看到 UI 顶部警告"回传文件与历史版本差异极大，疑似传错文件" |

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
- 文件选择：拖拽 + 点击，仅 accept `.docx`
- 选文件后变为分步进度列表（5 步），每步一个圆点 + 文案
  - 未开始：灰色空心圆
  - 进行中：蓝色实心圆 + `animate-pulse`
  - 完成：绿色实心圆 + Check 图标
  - 失败：红色实心圆 + X 图标
- 所有步骤完成 → Dialog 自动关闭 + toast "v4 客户回传已就绪 · 4 条外部变更"

### 12.3 本轮变化横幅

- 位置：结果屏顶部（只读横幅之下，如两者并存）
- 样式：`bg-primary/5 text-primary` + 信息图标
- 内容："v3 本轮变化 · 客户回传 · 回复 2 条 · 删除 1 条 · 新增 1 条 · 修改正文 1 处 · AI 已重审"
- 仅在切换到 `client_return` 类型的版本（或工作区基于 client_return 的首次访问）时显示；点 X 关闭后持久化到 localStorage（本版本不再弹）

### 12.4 风险卡片新增徽章

- "AI 已重审"：`bg-primary-100 text-primary-700` 小徽章（在 category 行右侧）
- "风险降级" / "风险升级"：对应绿/红色徽章
- "原文已修改"：卡片正文锚点旁小 i 图标，悬浮显示 `originalAnchorQuote`

### 12.5 分组显示

- **外部新增（N）· 顶置**：风险清单最顶，卡片左侧琥珀色竖条
- **客户已移除（N）· 折叠在底部**：点击展开后每条有"恢复推送"按钮（点击弹确认 dialog）
- **孤立批注（N）· 原文已修改**：在主风险清单末尾，卡片背景淡琥珀色，有"查看原始语境"按钮跳到最近能定位的历史版本

### 12.6 恢复推送确认 Dialog

- 标题："确认恢复推送？"
- 内容：`"${risk.category}" 已被客户在 v{N} 里明确删除。再次推送到下次导出的 Word 文件中，可能引起客户反感。确认继续吗？`
- 按钮：取消 / **确认恢复**（`variant="destructive"`）

---

## 13. 现有地基复用

| 地基 | Phase B 如何用 |
|---|---|
| `commentInjector.ts` | 改造：导出时给每条 annotation 生成/读取 wordCommentRef，写入 `<w:comment w:initials="LS:...">` |
| `segment` 服务（M4）| 复用：解析新 docx 时走同一条 segment 逻辑切条款 |
| `analyzeSingleClause` 子图（M4）| 复用：增量审查把 modified clauses 逐条送入 |
| `chatModel` factory | 复用：全局复核走简化 prompt 单次调用 |
| `useContractReview` composable 的 SSE 通道 | 复用：添加 `upload-version-progress` 事件类型 |
| `useContractReviewVersion` composable | 扩展：增加 `uploadNewVersion(file)` 方法 |
| `reviewGuard.ts` | 复用：上传端点用 `loadOwnedReview` |
| Phase A 的时间线组件 | 复用：新 systemLabel 两种类型的展示（`VERSION_SYSTEM_LABEL_DISPLAY` 加新 key）|
| `RiskListPanel.vue` | 扩展：支持显示外部新增/客户已移除/孤立批注三个新分组 |

---

## 14. 实施子期拆分（写 plan 时参考）

### 14.1 子期 B1 · 数据层 + 上传骨架（~1.5 天）

- Phase B Prisma 迁移（6 字段 + 3 枚举扩 + 1 索引）
- shared/types 扩展新枚举值和实体字段
- `commentInjector` 改造：为每条 annotation 生成/读取 wordCommentRef 写入 `w:initials`
- `POST /api/v1/assistant/contract/reviews/:id/upload-version` 端点骨架：parse + auto_backup + 占位 client_return（尚无 diff 和 AI）
- `useContractReviewVersion.uploadNewVersion()` 前端方法
- `ContractReviewPanel` 加"上传新版本"按钮 + Dialog 分步进度 UI（此期分步只有 backup + parse + merge 三步）

### 14.2 子期 B2 · 批注识别 + 条款 diff + 锚点迁移（~2 天）

- 解析 comments.xml 提取 raw 批注
- 按 wordCommentRef 比对出 4 类批注：kept / modifiedContent / removed / newByClient
- 条款 LCS diff（引入 diff 库）
- 锚点模糊匹配（字符相似度 + 关键词兜底）
- 孤立批注区 UI + "原文已修改"提示
- 客户已移除分组 UI + "恢复推送"确认 Dialog
- 外部新增分组 UI（顶置）
- SSE 进度事件扩展（加 diff 步骤）

### 14.3 子期 B3 · AI 增量审查 + 全局复核 + 联调（~1.5 天）

- 增量审查：把 modified[].newClause 送入 M4 子图
- 全局复核：简化 prompt + chatModel 调用 + 创建 global_review 风险条目
- SSE 进度事件扩展（加 ai 步骤）
- "AI 已重审" / "风险降级" 徽章
- 本轮变化横幅
- 端到端手测 + 已知 edge case 覆盖

**合计工期：5 天**（与 Phase A 同节奏）

---

## 15. 开放问题（实施时再定）

- 字符相似度阈值（0.5 / 0.6 / 0.7）：实现阶段跑真实合同样本调参
- 关键词提取算法：简单 TF（频率）还是用 jieba 等中文分词库 —— 先用最简 TF + 停用词过滤
- 全局复核的 prompt 模板：按 §9.2 骨架出初版，实施时在 `server/services/workflow/prompts/` 或类似位置定型
- wordCommentRef 随机段长度（`random8` = 8 位）：碰撞概率极低，8 位够用
- 上传 dialog 的错误态具体文案：失败时是否分步显示哪一步失败 + 重试按钮（Phase B 先不做重试，直接"上传失败，请重试"笼统 toast）

---

## 附录：决策清单（brainstorm 定案）

| # | 决策 | 选项 |
|---|---|---|
| 1 | `wordCommentRef` 存放位置 | **A**: `w:initials` + `LS:` 前缀视觉隔离 |
| 2 | 正文 diff 对齐单位 | **A**: 条款（Clause，复用 M4 segment）|
| 3 | 条款对齐算法 | **B**: LCS 最长公共子序列（`diff-match-patch` 或 `fast-diff`）|
| 4 | 锚点模糊匹配算法 | **A + B**: 字符级 Levenshtein 相似度 + 关键词兜底，阈值 0.6 |
| 5 | AI 增量审查实现 | **C**: 增量审查复用 M4 子图；全局复核走简化 prompt 单次调用 |
| 6 | 上传 SSE 协议 | **A**: 复用现有 contract review stream 通道，扩 `upload-version-progress` 事件 |
| 7 | 失败/中断恢复 | **A**: auto_backup 已成功 → 回到 auto_backup 状态；不做分步 checkpoint 续跑 |
| 8 | 全局复核触发条件 | **A**: 只要有任意改动条款就跑（先无脑覆盖所有场景）|
| 9 | 实施分期 | B1 数据地基+上传骨架 / B2 批注识别+锚点迁移 / B3 AI 增量审查+联调 |
| 10 | "外部新增"独立批注处理 | 升格为 `source=external_new` 的 ContractRisk，顶置分组显示 |
| 11 | "客户已移除"批注处理 | `removedByClient=true` + `suppressInExport=true` 软删；律师可"恢复推送" |
| 12 | 锚点无法定位处理 | `orphaned=true`，进"孤立批注"分组；保留 `originalAnchorQuote` 供 tooltip |
| 13 | 已处置风险保护 | 增量审查**不能**覆盖 `archivedStatus != null` 的风险 |
| 14 | `LS:` 前缀可见性 | 客户看到 Word 批注作者显示为 `LS: LEXSEEK-42-a3b8c9d2`，视为系统标识 |
| 15 | Phase A 存量数据兼容 | 存量 snapshot 无 `clauses` 字段时视为空数组，不触发历史风险的锚点迁移 |
