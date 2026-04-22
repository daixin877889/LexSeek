# 合同审查 · 多版本协作 设计文档

> **定位**：合同审查模块的能力升级，不是新模块、不是新入口。
> **内部代号**：`contract-review-versioning`（仅用于 spec/分支/字段，**不在用户面前出现**）
> **用户视角**：仍然是"合同审查"，只是支持多次上传、保留历史、批注双向同步。

---

## 1. 背景与动机

现有合同审查是**一次性审查**：律师上传 docx → AI 审 → 律师看结果/处置 → 最多下载个带批注 Word 文件。一旦发给客户、客户回批注再发回来，系统无法继承前面的讨论，只能当作一份全新合同重新审查，历史讨论丢失。

真实工作流场景：

```
律师上传 v1 → AI 审查 → 律师加回复/处置 → 下载发给客户
                                                ↓
律师上传 v3 ← ← ← ← ← ← ← ← 客户用 Word 回批注、改正文 ← ←
```

律师需要：
1. 合同能多次上传，历史批注不丢
2. 自己的批注和客户的批注都能在 Word 和系统之间双向流转
3. 客户改过的条款 AI 能识别并重审，但律师之前处置过的风险不被冲刷
4. 能回看每一轮合同走到什么状态

---

## 2. 定位与边界

### 2.1 用户语言层面

- 不出现 "多轮协作"、"版本管理"、"对话化批注" 等功能名
- 版本在 UI 里直接叫 `v1` / `v2` / `v3`，配合系统标签（初次上传 / 客户回传 / 律师保存 / 自动备份）
- 时间线就叫 "历史版本"，不起其他花名
- 菜单、按钮、toast、导出文件名一律遵循以上约束

### 2.2 入口不变

- 路由：`/dashboard/contract` 及 `/dashboard/contract/:id`（当前结构）
- 菜单项：现有 "合同审查" 菜单项
- 列表页：现有列表结构不变，每条记录仍是一份合同审查
- 详情页：进入详情后才看到"时间线"这些新交互元素

### 2.3 产品能力承诺（给律师看的话术）

1. **合同可以多次上传，历史不丢**
2. **律师在系统里的批注和回复，导出 Word 时自动带上**
3. **客户在 Word 里加的批注，系统能识别并展示**
4. **客户改过的内容 AI 会重新看一眼，律师之前处置过的风险不会被推翻**

### 2.4 不做的事（本期边界）

- 多律师协作（仍 owner-only，客户端不开账户）
- 实时 co-editing（像 Google Docs）
- 版本分支（从 v1 派生另一条线）
- 律师在系统里 @AI 追问
- 批注搜索、@ 提醒、标签等高级管理能力

---

## 3. 核心概念

| 概念 | 定义 |
|---|---|
| 工作区 | 律师当前可编辑的状态。所有操作（处置风险、加回复、改批注）实时落库。只有一个工作区。 |
| 版本快照 | 在特定时刻对工作区做的全量 dump，不可变。四种产生途径（见 §4）。 |
| 风险（Risk）| 长寿命实体，有 AI / 外部新增 / 本轮复核 三种来源，有处置状态。 |
| 批注（Annotation）| 挂在风险下的对话气泡，有作者类型（AI / 律师 / 外部）、可有父子关系（承载 Word answer reply）。 |
| Word 批注身份证 | 系统导出 docx 时给每条批注塞入的隐形稳定标识，客户回传时用来识别哪条批注被改/删。 |

---

## 4. 版本管理规则

### 4.1 四种版本产生方式

| 方式 | systemLabel | 触发时机 | 律师可操作 |
|---|---|---|---|
| 初次上传 | `initial_upload` | 律师第一次上传 docx | 自动 |
| 客户回传 | `client_return` | 律师上传一份外部修改过的 docx（非首次） | 自动 |
| 律师保存 | `lawyer_save` | 律师手动点 "保存新版本" | 手动 |
| 自动备份 | `auto_backup` | 律师触发 "上传新版本" 时，系统保护工作区 | 自动 |

### 4.2 版本不可删

任何版本一旦产生，律师不能删除（审计/客户争议保全）。版本号 `v1`, `v2`, `v3` 单调递增、不回收。

### 4.3 "保存新版本" 是独立功能

- 不绑定到导出按钮
- 律师随时可点
- 未点保存前，工作区状态在当前最新版本之上累积（直到下一次上传触发自动备份）
- 工作区所有编辑是实时落库的（参考文书 debounce PATCH 模式）。"保存新版本" 的语义是**把当前工作区状态 dump 成一条不可变快照**，而非"保存未提交的修改"
- UI 上如果工作区相对 `currentVersionId` 有差异，显示"自 v2 以来有 N 处编辑"提示 + 蓝色"保存新版本"按钮；反之按钮灰色禁用（没必要保存）

### 4.3.1 自动备份的幂等规则

如果 "上传新版本" 触发时，工作区相对 `currentVersionId` 无任何编辑差异（律师上次保存/上传后没改过），**跳过 auto_backup**，直接处理新文件 → 生成 `client_return`。避免产生内容完全一样的冗余快照。

### 4.4 导出不产生版本

- 导出只是下载一个带批注的 docx 文件
- 导出文件名必带版本号：`{合同名}_{版本号或"工作区"}_{日期}.docx`
  - 示例：`设备采购合同_v3_2026-04-26.docx`
  - 工作区（未保存）：`设备采购合同_工作区_2026-04-26.docx`

### 4.5 旧版本只读

- 任何历史版本（`v1` 到最新已保存的版本）均不可编辑
- UI 上切到历史版本显示灰色横幅 + 按钮禁用
- 律师如果想 "从 v1 重新开始"，走 "下载 v1 docx → 重新上传" 的流程，会产生一个新版本

### 4.6 版本命名

- `systemLabel` 由系统生成、不可改（4 类固定枚举）
- 律师可加一条自由文本备注（如 "发张三法务审阅"）
- 备注在时间线展开态可见、可编辑

---

## 5. 数据模型

参考项目内已验证的"文书生成"模式（`documentDrafts` + `documentDraftVersions`）：**工作区主表实时变动，历史版本表纯 JSON 快照**。

### 5.1 四张表

```
ContractReview（主表 · 工作区承载）
    ├─ currentVersionId → ContractReviewVersion（当前基于哪个快照）
    ├─ maxVersionNo（版本号计数器）
    ├─ ContractRisk[]（工作区风险清单 · 实时变动）
    └─ ContractAnnotation[]（工作区批注/回复 · 实时变动）

ContractReviewVersion（历史版本快照 · 不可变）
    └─ snapshotData JSON { risks[], annotations[], docxText, paragraphs }
```

### 5.2 `ContractReview`（现有表 · 扩展）

新增字段：
- `currentVersionId: bigint?` — 当前工作区基于哪个快照
- `maxVersionNo: int default 0` — 已产生的版本号上限
- 原 `risks: Json` 字段 → **数据迁移到 ContractRisk 表后清空**（保留字段名但留空，或移除，取决于存量数据量）

### 5.3 `ContractReviewVersion`（新表 · 版本快照）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | bigint PK | |
| reviewId | bigint FK (cascade) | 归属合同审查 |
| versionNumber | int | v1/v2/v3... review 内单调递增 |
| systemLabel | enum | `initial_upload` / `client_return` / `lawyer_save` / `auto_backup` |
| lawyerNote | text? | 律师备注 |
| docxFileId | bigint? | 本版 docx 在 OSS 的文件 ID（上传类版本必有；纯逻辑快照可空） |
| snapshotData | jsonb | 完整快照 `{ risks[], annotations[], docxText, paragraphs }`  |
| createdById | bigint FK | 创建人 |
| createdAt | datetime | |

约束：
- `@@unique([reviewId, versionNumber])`
- 索引：`(reviewId, createdAt desc)` 用于时间线排序

### 5.4 `ContractRisk`（新表 · 工作区实时）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | bigint PK | |
| reviewId | bigint FK (cascade) | |
| source | enum | `ai` / `external_new` / `global_review` |
| code | string? | playbook code，仅 `ai` 来源有值 |
| category, level, stance, problem, legalBasis, analysis, suggestion | 五段式内容 | |
| archivedStatus | enum? | `handled` / `ignored` / `client_removed` — 工作区内的处置状态 |
| archivedAt | datetime? | |
| anchorQuote | text | 当前锚点原文 |
| anchorParagraphIndex, anchorCharStart, anchorCharEnd | int? | 锚点坐标 |
| originalAnchorQuote | text? | 如发生过迁移，保留首次原文（UI "原文已修改" 提示用）|
| orphaned | boolean default false | 当前版本无法定位锚点（孤立批注）|
| createdAt, updatedAt | datetime | |

注意：**没有 versionId/firstSeenInVersionId 字段**。工作区是当前快照层，历史版本通过 `ContractReviewVersion.snapshotData` 还原。

### 5.5 `ContractAnnotation`（新表 · 工作区实时）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | bigint PK | |
| reviewId | bigint FK (cascade) | |
| riskId | bigint FK (cascade) | 挂载的风险 |
| parentAnnotationId | bigint FK? | Word reply 机制承载的父子关系 |
| authorType | enum | `ai` / `lawyer` / `external` |
| authorName | string | 展示名（AI=固定 "AI"；lawyer=律师姓名；external=Word author 原值） |
| authorUserId | bigint FK? | 律师才有 |
| content | text | 内容 |
| wordCommentRef | string? | 系统给批注的稳定身份证（下次导出时塞入 Word，回传时用来匹配） |
| removedByClient | boolean default false | 客户在 Word 里删了该批注 |
| suppressInExport | boolean default false | 下次导出跳过（默认 = removedByClient） |
| createdAt | datetime | |

索引：`(riskId, createdAt)` 用于对话线排序；`(wordCommentRef)` 用于回传比对。

### 5.6 `snapshotData` JSON 结构

```json
{
  "risks": [ { /* ContractRisk 完整字段 */ } ],
  "annotations": [ { /* ContractAnnotation 完整字段含 wordCommentRef */ } ],
  "docxText": "...",
  "paragraphs": [ { "index": 0, "text": "...", "offsetStart": 0, "offsetEnd": 123 } ]
}
```

> `paragraphs` 是正文结构化表示（索引/文本/字符偏移），给 diff 和锚点定位复用。

### 5.7 playbookSnapshot 锁死在 v1

`ContractReview.playbookSnapshot` 字段现有行为保留：**同一合同审查的整个生命周期使用 v1 时采样的 playbook**。即便运营侧中途改了 playbook，后续 `client_return` 增量审查仍以 v1 playbook 为基准，保证律师判断标准稳定。

---

## 6. 核心业务流程

### 6.1 场景 1 · 首次上传

1. 律师点"新建审查"，上传 docx
2. AI 按 playbook 审查，产出风险清单
3. 系统创建 `ContractReview` 主表 + `ContractRisk[]` 子表 + `ContractAnnotation[]`（AI 每条风险默认生成一条 `authorType=ai` 的初始批注）
4. 做一次 snapshot，写入 `ContractReviewVersion`（`systemLabel=initial_upload`, `versionNumber=1`）
5. `ContractReview.currentVersionId` 指向该版本，`maxVersionNo=1`
6. 律师进入工作区

### 6.2 场景 2 · 律师编辑 + 导出

编辑：
- 处置风险（改 `archivedStatus` / `archivedAt`）
- 加批注/回复（在 `ContractAnnotation` 新增 `authorType=lawyer`）
- 改批注内容
- 所有操作通过 debounced PATCH 实时落库（参考文书 `useDocumentDraft` 的 500ms 防抖）

导出：
- 读 `ContractRisk` + `ContractAnnotation` 当前状态
- 合并生成 docx 文件（注入 comments.xml）
- 每条 annotation 的 `wordCommentRef` 写入 comments.xml 的隐形元数据（见 §8）
- 文件名规则见 §4.4
- **不产生新版本**

### 6.3 场景 3 · 客户回传后的上传

律师点"上传新版本"，选择客户回传的 docx：

**步骤 1 · 自动备份当前工作区**
- 对现有 `ContractRisk` + `ContractAnnotation` + 当前 `docxText` 做全量 dump
- 写入 `ContractReviewVersion`（`systemLabel=auto_backup`, `versionNumber++`）
- 律师在途编辑受保护

**步骤 2 · 解析新上传 docx**
- 提取正文、段落结构、comments.xml
- 按 `wordCommentRef` 比对出：客户保留/回复/删除/新增的批注

**步骤 3 · 识别差异**
- **正文 diff**：段落级对比新旧 docxText，找出修改的段落
- **批注变化**：
  - 命中 `wordCommentRef` 且内容相同 → 保留
  - 命中 `wordCommentRef` 但多了子 comment（Word answer reply） → 追加子 annotation（`authorType=external`, `parentAnnotationId=原 annotation`）
  - 系统库里有但新 docx 里找不到 `wordCommentRef` → 标 `removedByClient=true`, `suppressInExport=true`
  - 新 docx 里有无 `wordCommentRef` 的 comment → 视为客户新增独立批注，升格为 `ContractRisk(source=external_new)` + `ContractAnnotation(authorType=external)`

**步骤 4 · AI 增量审查 + 全局复核**
- 仅对 diff 命中的改动段落跑 AI 审查（playbook 锁定 v1）
- 增量审查只能：更新原有风险的 level/suggestion、新增 `source=ai` 风险
- **不能** 改变律师已处置的风险状态
- 另跑一次全局复核，若发现整体平衡问题，新增一条 `source=global_review` 风险

**步骤 5 · 锚点迁移**
- 对每条挂在"改动段落上"的历史批注，用模糊匹配（关键词 + Levenshtein + 原锚点附近 N 字）尝试在新正文定位
- 匹配成功 → 刷新锚点坐标，`originalAnchorQuote` 首次记录原文
- 匹配失败 → `orphaned=true`，UI 入"孤立批注"区

**步骤 6 · 写入工作区 + 新版本快照**
- 所有变更落到 `ContractRisk` / `ContractAnnotation` 表（工作区最新状态）
- `ContractReview.currentVersionId` 指向即将创建的新版本
- 创建 snapshot 写入 `ContractReviewVersion`（`systemLabel=client_return`, `versionNumber++`）

**律师视角**：上传完成后看到的界面
- 时间线多了 2 个节点（`auto_backup` + `client_return`）
- 顶部横幅："v3 本轮变化：客户对 2 条 AI 风险做了回复 · 删除 1 条 AI 批注 · 新增独立批注 1 条 · 修改正文 1 处 · AI 已重审"
- 外部新增分组顶置，显示客户独立批注
- 被客户删的 AI 批注进"客户已移除"折叠区
- AI 重审的条款标徽章"AI 已重审 · 风险降级"
- 全局复核新增条目在清单末尾

### 6.4 场景 4 · 切换旧版本（只读）

- 律师点时间线上任意旧版本
- 系统读取 `ContractReviewVersion.snapshotData`，以相同结构返回
- UI 进入只读模式（灰色横幅、按钮禁用）
- 律师看完点"返回工作区"

### 6.5 场景 5 · 对比两个版本

- 律师点"与 v2 对比"按钮
- 系统分别读取工作区（当前 `ContractRisk` + `ContractAnnotation`）和 v2 `snapshotData`
- 做 diff：
  - 正文段落对比
  - 风险新增/删除/修改
  - 批注变化
- 抽屉 UI 渲染（见 §7.6）

---

## 7. UI 交互规范

### 7.1 时间线

**收缩态**（默认 · 左侧窄条 48px）
- 显示：版本号圆点 + 小徽章提示最新有变更
- 顶部切换按钮展开

**展开态**（220px）
- 每节点显示：版本号 + systemLabel + 日期 + 变更徽章 + 律师备注
- 点节点切换版本
- 编辑备注小图标 → input 直接改

状态（展开 vs 收缩）存 localStorage。

### 7.2 工作区 vs 只读历史版本

| 元素 | 工作区 | 只读 |
|---|---|---|
| 顶部横幅 | 无（或"N 处未保存编辑"徽章） | 浅灰整条 "历史版本 · 只读模式" + "返回工作区" 按钮 |
| 保存/上传按钮 | 正常，蓝色高亮（如有未保存） | 灰色禁用，tooltip "仅在工作区可操作" |
| 内容区底色 | 正常 | 微灰 |
| 批注回复框 | 正常可用 | 禁用 + 提示只读 |
| 下载按钮 | 正常（导出工作区） | 正常（下载该版本 docx） |

### 7.3 气泡对话线

- 按时间从旧到新从上往下
- 每条带作者徽章（AI / 我 / 张三 · 外部批注）
- 父子 reply 关系：子回复缩进 + 竖线
- 最下方回复框 + 提示 "回复会在下次导出时合并进 Word 文件"
- 历史版本下输入框禁用

### 7.4 三种特殊分组

**外部新增分组**（顶在风险清单最顶部）
- 标题 "外部新增（N）"
- 卡片左侧黄色竖条区别于 AI 风险
- 每条显示作者名 + "外部批注"标签

**客户已移除分组**（默认折叠，清单底部）
- "客户已移除（N）· 点击展开"
- 展开后每条带"恢复推送"按钮
- 点按钮弹确认框 "客户已明确删除过这条，再次推送可能引起反感。确认恢复吗？"

**孤立批注区**（清单底部，与"已移除"分开）
- "原文已修改 · 无法定位（N）"
- 每条显示完整历史讨论 + 提示
- 可点"查看原始语境"跳到最近能定位的版本

### 7.4.1 已处置风险的显示方式

风险 `archivedStatus != null` 时（包括 AI 风险和全局复核条目）：
- 卡片整体降低不透明度（~0.6）
- 右侧徽章显示处置标签（已处理 / 已忽略 / 客户已移除）
- 默认仍显示在清单内（律师可快速看到"我处理过的"），但视觉权重降低
- 提供"隐藏已处置"开关，开启后折叠所有已处置项，只留一个 "已处置（N）· 点击展开" 的折叠区
- 适用于 `source=global_review` 本轮复核条目：律师处置后自动降权，下一版本打开时不再抢注意力（与决策 15 对应）

### 7.5 上传新版本交互

1. 点按钮弹模态框
2. 提示文案："上传后系统会自动备份你当前的编辑（记为自动备份版本），防止工作内容丢失"
3. 上传中分步状态：备份工作区 → 解析文件 → 识别客户变更 → AI 重审改动条款 → 合并结果
4. 完成后模态框自动关闭，顶部 toast 提示本轮变化摘要
5. 工作区切到最新状态，时间线更新

### 7.6 对比抽屉

- 右侧滑出，宽 700px
- 顶部标题 "X 对比 Y"，双下拉可改对比两方
- 上半：正文 diff 两栏并排，改动段落高亮
- 下半：结构化变更列表
  - 正文修改（跳转到 docx 位置）
  - 外部新增（展开内容）
  - 客户回复（展开）
  - 客户删除（查看被删内容）
  - AI 重审（查看结论）
- 底部关闭按钮

---

## 8. Word 批注身份证机制

### 8.1 问题

每次律师导出 docx 发给客户，客户用 Word 编辑后回传。我们需要一种机制：在新上传的 docx 里精确找出每条批注对应系统中的哪条 annotation。Word 本身的 `w:id` 在每个 docx 内部唯一，但跨 docx 会变，不能作为稳定身份证。

### 8.2 方案

系统导出 docx 时，为每条 annotation 生成一个稳定 `wordCommentRef`（如 `LEXSEEK-{annotationId}-{random8}`），写入 `w:comment` 的 `w:initials` 属性或 customXml 元数据。客户用 Word 编辑不会破坏这个字段（Word 保留 initials 原值）。

回传时解析 docx：
- comment 有 `wordCommentRef` 字段 → 按此匹配系统 annotation
- comment 没有 `wordCommentRef` 字段 → 视为客户新增

### 8.3 Word answer reply 的处理

Word 的"答复批注"功能产生的子 comment 有 `w:parentId` 指向父 comment 的 `w:id`。解析时：
- 父 comment 的 `wordCommentRef` 命中系统 annotation → 父 annotationId 作为 `parentAnnotationId`
- 子 comment 解析为新的 `ContractAnnotation(authorType=external, parentAnnotationId=...)`

### 8.4 极端兜底

如客户重新打印/OCR/转码导致 `wordCommentRef` 全部丢失：
- 所有批注被识别为 "外部新增"
- 系统库里的历史批注在 `snapshotData` 仍保留
- UI 顶部横幅提示 "本次上传未识别到历史批注对应关系，已按外部新增处理"

---

## 9. 异常与兜底

| 场景 | 行为 |
|---|---|
| 正文大改、锚点完全无法定位 | 批注进 `orphaned=true`（孤立批注区），历史讨论保留 |
| AI 增量审查失败 | 版本仍产生，AI 部分标失败，律师可手动重试 |
| 上传一半失败（断网、解析错） | `auto_backup` 已完成 → 律师回到 `auto_backup` 状态 |
| 多标签页并发编辑 | 后端乐观锁：PATCH 带 `If-Match` 版本号；冲突返回 409 让前端合并 |
| 律师切版本时有未保存编辑 | 前端弹确认 "切换会丢失 N 处未保存编辑，先保存吗？" |
| 全局复核可能推翻律师已处置 | **不允许**：增量审查和全局复核只能新增、不能改律师人工标过 `archivedStatus` 的风险 |

---

## 10. 现有地基复用

- `commentInjector.ts`：改造为 "读入现有 comments.xml + 按 `wordCommentRef` 比对 + 合并生成新 comments.xml"，核心 5 段式文本生成逻辑保留
- `ContractReview` 表：加两个字段（`currentVersionId`, `maxVersionNo`）
- `useContractReview` composable：SSE 流程不变，"客户回传触发增量审查"走同一条 stream 通道
- 风险清单、docx 预览、锚点定位等 M4-M7 UI 组件：直接继承
- 文书生成的 `useDocumentDraft` 模式（debounce PATCH、版本列表 composable、恢复预览）：参考实现合同审查的 `useContractReviewVersion`
- 文书的版本接口（`POST /versions` / `GET /versions` / 版本快照读取）：参考路由和 service 分层

---

## 11. 数据迁移

### 11.1 存量数据

- 现有 `ContractReview.risks`（JSON）需要拆成 `ContractRisk` 表行
- 现有每条审查需要创建一个 `initial_upload` 版本作为 v1

### 11.2 迁移脚本大纲

```
FOR each existing ContractReview:
  risks_array = review.risks  // 老 JSON

  FOR each risk in risks_array:
    INSERT ContractRisk (reviewId, source='ai', level=risk.level, ...)
    INSERT ContractAnnotation (riskId, authorType='ai', content=risk.generated_text, ...)

  snapshot = build_snapshot(ContractRisk, ContractAnnotation, review.docxText, review.paragraphs)

  INSERT ContractReviewVersion (reviewId, versionNumber=1, systemLabel='initial_upload', snapshotData=snapshot, docxFileId=review.reviewedFileId)

  UPDATE ContractReview SET currentVersionId=<新版本.id>, maxVersionNo=1
```

### 11.3 回滚方案

迁移前备份 `ContractReview.risks` JSON 到 `contract_review_legacy_risks_backup` 表。如出问题可直接反向同步。

---

## 12. 实施分期建议

建议拆 2-3 个 Plan 逐步上线（不在本 spec 内强制分期，以 writing-plans 拆分为准）：

- **Phase A**：数据模型 + 版本快照核心 + "初次上传 / 手动保存版本 / 时间线切换" 基本链路
- **Phase B**：上传新版本 + 客户批注识别 + 增量审查 + 锚点迁移
- **Phase C**：外部新增 / 客户已移除 / 对比抽屉 / 全局复核条目 / UI 细节打磨

---

## 13. 开放问题（待实现时再细化）

- 模糊匹配锚点的相似度阈值：实现阶段根据真实 docx 样本调参
- `wordCommentRef` 写入 Word 的具体位置（`w:initials` vs customXml）：实现阶段验证 Word 不同版本的兼容性
- 全局复核触发条件的量化标准（改动多大算触发）：先按 "任意段落变化即触发" 落地，实现阶段观察效果
- 上传过程中的分步 SSE 事件协议：按现有 contract review stream 协议扩展

---

## 附录：决策清单（brainstorm 定案）

1. 场景：双向版本流转（律师 ↔ 客户 Word 同步）
2. 作者识别：三类（AI / 我 / 外部），外部保留 Word author 原名 + "外部批注" 标签
3. 版本 UI：时间线（可收缩）+ 气泡对话线分层
4. 版本产生：上传强制 / 手动保存 / 上传前自动备份
5. 回复落盘：存库 + 导出时合并写入 docx（非实时写 zip）
6. 客户独立批注：升格为风险清单独立分组，顶置
7. 导出文件名带版本号
8. 正文变化：增量审查 + 全局复核新增条目
9. 批注锚点迁移：模糊匹配 + 孤立批注区 + "原文已修改"提示
10. 旧版本：纯只读
11. 客户删 AI 批注：标记"客户已移除" + 下次导出不再推送 + 可手动恢复
12. 版本对比：diff 并排 + 变更摘要 + 点击跳转 + 可选任意两版
13. 版本命名：系统标签固定 + 律师可加备注
14. 版本删除：不可删
15. 全局复核生命周期：律师处置后归档
16. 独立批注跨版本：复用 Word reply 机制
17. playbookSnapshot 锁死 v1
18. 数据模型：参考文书模式（工作区主表 + 快照表）
