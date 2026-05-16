# 合同审查回传识别 — Word 兼容性修复 设计文档

> 日期：2026-05-16
> 状态：待评审
> 范围：合同审查「客户回传 docx」的批注/修订识别链路

## 1. 背景与问题

合同审查导出的 docx 发给客户、客户编辑后回传，LexSeek 需识别其中 AI 批注与修订的归属（每条对应系统里的哪条批注/风险），据此判断客户接受/拒绝、并做防误删保护。

**实测发现**：客户用 Microsoft Word 编辑并保存过的 docx 回传时，识别 100% 失败，触发「统一覆盖率过低」防误删保护中止（`NO_CONTENT_MATCH`）。

用一份真实的「被 Word 重存过的回传 docx」（review #3，`劳动合同_v1_2026-05-16.docx`）定位到**三层失效**：

### 层 1 — 身份证文件被改名移位

LexSeek 把身份证写在 `word/customXml/annotationRefs.xml`（批注身份证）、`word/customXml/redlineRefs.xml`（修订身份证）。Word 重存时按 OOXML 规范把 customXml part 移到包根 `customXml/`、改名为 `item1.xml`/`item2.xml`、配套 `itemProps*.xml`。LexSeek 回传解析端写死路径查找（`zip.file('word/customXml/redlineRefs.xml')`）→ 找不到 → 身份证全部读不到。

实证：该 docx 内 `customXml/item1.xml` 的内容是 `<lexseekRedlineRefs>`、`customXml/item2.xml` 是 `<lexseekAnnotationRefs>`，内容完整，只是被改了名、换了目录。

### 层 2 — 批注编号被重排

`annotationRefs.xml` 用 `wId`（docx 内批注编号）作为「身份证记录 ↔ 回传批注」的关联键。实测该 docx 的批注 `w:id` 已从导出时的 42~46 变成 4,3,19,22,23。即使层 1 修好读到身份证文件，`wId` 也对不上回传批注的实际编号。

### 层 3 — 修订编号被重排

`redlineRefs.xml` 记 `delIds`/`insId`（docx 内修订编号）。实测该 docx 的修订 `w:id` 已从导出时的连续 8~41 变成 2~44 的不连续序列。`classifyRedlineDecision` 的精确层（Layer 1，按 `w:id` 匹配）会因新旧编号空间重叠（都是小整数）而**碰巧命中不相干的修订** → 随机误判，不会干净地「全部失效」。

## 2. 根因

LexSeek 回传识别依赖了两类「会被 Word 改动」的东西：

- customXml part 的**文件路径**（Word 按 OOXML/OPC 规范把 customXml 规范化到包根 `/customXml/item*.xml`）。
- docx 内的**批注/修订编号**（OOXML 里批注、书签、修订标记**共用一套** `w:id` 编号池；LexSeek 注入的编号若与原合同元素冲突，会触发 Word 修复式重排）。

而「不会被 Word 改动」的是：

- customXml 文件的**内容**（元素、属性值）—— Word 不改非内容控件绑定的 customXml 内容。
- 批注的**正文文字**、修订的 `<w:delText>` 被删原文。

身份证里记的**业务 id**（`reviewId`、`annotationId`、`riskId`）属于「文件内容」，Word 不改，**永远有效**。失效的只是「靠 docx 内编号搭起来的那座桥」。

## 3. 修复总原则

1. 修复**全部在回传解析端**，导出端零改动 —— 已发给客户的 docx 不受影响、无需重新导出。
2. 回传识别**不再依赖任何会被 Word 改动的东西**：不靠固定路径找文件，不靠 docx 内编号做匹配。
3. 防御性自适应 —— 不假设 Word 行为 100% 固定；对「经过 Word / 没经过 Word / 经过 WPS/LibreOffice 等其他工具」都成立。

## 4. 层 1 方案 — customXml 按内容定位

新增 customXml 定位器 `server/agents/contract/docx/customXmlLocator.ts`：

- 用 jszip `zip.file(/customXml\/[^/]*\.xml$/i)` 遍历 docx 内所有 customXml 文件（覆盖包根 `customXml/` 与 `word/customXml/` 两种位置）。
- 对每个文件，按 **LexSeek 专有命名空间 URI** 识别：先在文件原始 XML 字符串里搜命名空间 URI（`urn:lexseek:contract-review:v1` = 批注身份证；`urn:lexseek:contract-review-redline:v1` = 修订身份证）—— 命名空间 URI 不随 Word 改名/加前缀而变；命中后再 `parseOoxml` 确认根元素本地名（`lexseekAnnotationRefs` / `lexseekRedlineRefs`，比对时剥掉可能的 `前缀:`）。
- 返回：识别到的身份证文件 AST + 它的原始 zip 路径（路径供层 3 判断「是否被重写过」）。

`wordCommentParser.readCustomXmlRefs` 和 `redlineParser.parseRedlineMarks` 改用此定位器，不再 `zip.file('word/customXml/xxx.xml')` 写死路径。

**为什么按命名空间识别**：文件名、路径、元素前缀都可能被 Word 改；命名空间 URI 是 LexSeek 专有、且 Word 不会改 customXml 内容。`itemProps*.xml`（Word 的 customXml properties）根元素是 `ds:datastoreItem`，不含 LexSeek URI，自然被排除。

## 5. 层 2 方案 — 批注按内容匹配

回传批注 ↔ 系统批注的关联，改用**批注正文内容匹配**：

- 对每条回传 comment，取其 content，用 `normalizeForMatch` 归一化（NFKC + 中英标点统一 + 空白折叠 + trim —— 实测可消除「Word 把批注里的换行压成空格」的差异）。
- 与本 review 的 DB `annotation.content`（同样归一化）比对：
  - **一级 exact**：归一化后完全相等 → 命中。
  - **二级 fuzzy**：无 exact 命中时，用 `calcSimilarity`（Levenshtein 相似度）算最高分；分数 ≥ 阈值 0.85 且该最高分唯一（无并列）→ 命中；否则不命中。
- 匹配用**完整 content**（AI 批注通常数百字，唯一性强；用前缀会歧义）。
- 命中后得到 `annotationId`，后续既有逻辑（跨审查、collided、fallbackFail、回复升级 external）不变。

身份证文件（层 1 定位到的 `annotationRefs`）仍用于：声明 `reviewId` 做跨审查归属判定。`wId` 字段保留但不再作为匹配主键（向后兼容、调试用）。

**为什么不靠 wId**：实测 `wId` 被 Word 重排；content 匹配对「经过 Word / 没经过 Word」一律适用，统一一条路径比「wId 双轨 + 信号判断」更简单可靠。

**实测验证**：review #3 的 5 条回传批注，content 归一化后与 DB 对应 annotation（id 50/57/58/60/61）逐字一致。

## 6. 层 3 方案 — 修订禁用精确层、走正文比对

- 层 1 修好后，`parseRedlineMarks` 能定位到 `redlineRefs.xml`，读出每条 ref 的 `riskId`（业务 id，有效）/`delIds`/`insId`/`paraIdxs`。
- `parseRedlineMarks` 在定位 customXml 时记录「身份证文件是否在原始路径 `word/customXml/`」。**不在原始路径 = docx 被 Word（或同类工具）规范化重写过 = docx 内 `w:id` 不可信**。
- `classifyRedlineDecision` 增加入参 `trustWordIds: boolean`：
  - `trustWordIds = false`（被重写过）→ **跳过精确层 Layer 1**，直接走正文比对层 Layer 2。
  - `trustWordIds = true`（未被重写、customXml 在原始路径）→ 维持现有双层逻辑。
- Layer 2 正文比对不依赖 `w:id`：用 `resolveCorpusForRef` 按 `paraIdxs` 取段落语料 + 比对 `problematicQuote` / `suggestedClauseText`。
- **增强**：`paraIdxs` 因 Word 增删段落而漂移时，Layer 2 现有「`paraIdxs` 越界 → 回退全文语料」兜底之外，再增强为「按 `paraIdxs` 取的段落语料判出 AMBIGUOUS 时，用全文语料重判一次」，降低段落漂移导致的待确认率。

**为什么禁用精确层而非「自动转兜底」**：实测 Word 重排后新旧编号空间重叠（都是小整数），精确层拿旧编号去回传 docx 里查 `survivingDelIds.has(旧id)`，会碰巧命中不相干修订 → 随机误判，不会干净地「全部失效转兜底」。必须显式禁用。

## 7. 跨审查保护

身份证文件里的 `reviewId` 是文件内容、Word 不改。层 1 定位到身份证文件后，`reviewId !== 当前 review.id` → 跨审查拒绝，既有逻辑不变。批注侧由身份证文件的 `reviewId` 判定；修订侧由 `redlineRefs.xml` 根元素的 `reviewId` 判定。

## 8. 改动范围

**回传解析端：**

- 新增 `server/agents/contract/docx/customXmlLocator.ts` — customXml 按命名空间 URI 定位。
- 改 `server/agents/contract/docx/wordCommentParser.ts` — `readCustomXmlRefs` 改用定位器。
- 改 `server/agents/contract/docx/redlineParser.ts` — `parseRedlineMarks` 改用定位器并记录「是否原始路径」标志；`classifyRedlineDecision` 加 `trustWordIds` 入参；Layer 2 增加全文语料重判兜底。
- 改 `server/agents/contract/uploadClientVersion.service.ts` — 批注关联改用 content 匹配（见第 5 节）；把「是否被重写」标志传给修订识别。

**导出端：零改动。**

## 9. 测试

- 把用户提供的「被 Word 重存过的真实回传 docx」（review #3）作为核心回归 fixture，存入测试资源目录。
- 单元测试：
  - `customXmlLocator` 对「原始路径 / 包根改名 item*.xml / 文件不存在 / 根元素带命名空间前缀」各情况识别正确。
  - 批注 content 匹配：exact 命中 / fuzzy 命中 / 歧义（并列最高分）不命中 / 全低于阈值不命中。
  - `classifyRedlineDecision` 的 `trustWordIds` 开关：true 时走双层、false 时跳过 Layer 1。
- 集成测试：用该真实 docx 跑完整回传链路（`uploadClientVersionService`），断言批注与修订都能识别、不触发 `NO_CONTENT_MATCH` 误中止。

## 10. 兼容性

- **没经过 Word 的 docx**（customXml 在原始路径、编号未重排）：层 1 定位器扫描范围含原始路径，照样找到；层 2 content 匹配一律适用；层 3 `trustWordIds = true` 维持双层。
- **经过 WPS / LibreOffice 等其他工具**：定位器扫描 + content 匹配不依赖具体工具行为，一律适用。
- **存量已导出的 docx**：导出端零改动，存量 docx 格式不变；新的回传解析逻辑对存量 docx 同样工作。

## 11. 验证依据

本方案所有关键假设均经实证 / 源码 / 文档核实，非推测：

- **层 1 可行性**：jszip `^3.10.1` 的 `file(regex)` / `forEach` API 经类型定义核实存在；`xmlAst` 的 `parseOoxml` / `findFirst` / `getAttr` 解析能力经源码核实。Word 改名 customXml：实证（review #3 docx 的 `customXml/item1.xml` = lexseekRedlineRefs、`item2.xml` = lexseekAnnotationRefs）+ OOXML/OPC 规范调研佐证（customXml 标准位置为包根 `/customXml/`，Word 重存会规范化到此，属确定行为）。
- **层 2 可行性**：review #3 的 22 条 DB 批注与 docx 5 条回传批注实测逐条比对，content 归一化后逐字一致；`calcSimilarity` / `normalizeForMatch` 源码核实（`normalizeForMatch` 的 `\s+→' '` 折叠正好消除 Word 把换行压成空格的差异）。
- **层 3 必要性**：`classifyRedlineDecision` 源码核实精确层在编号重排下的误判风险（新旧 id 空间重叠、`survivingDelIds.has(旧id)` 碰巧命中）；实测 review #3 docx 的修订编号已与导出值不一致。
- **身份证业务 id 永久有效**：调研确认 Word 不改 customXml 文件内容（除非经内容控件编辑），故 `reviewId` / `annotationId` / `riskId` 永远有效。
- **诚实标注的不确定点**：「Word 为何重排编号」无 100% 定论 —— 调研显示 Word 默认不主动重排、但 OOXML 共享 `w:id` 池下 id 冲突会触发修复式重排；实证显示该 docx 编号确已变。方案不依赖 docx 内编号，此不确定性不影响方案成立。
