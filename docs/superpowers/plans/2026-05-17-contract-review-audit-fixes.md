# 合同审查全生命周期 代码审查问题修复 — 交接文档

> **文档性质**：一次 5-agent 并行代码审查的产出汇总。审查覆盖合同审查模块「首次审查 → 导出 → 客户回传」完整生命周期的每一个环节。本文档列出全部待修复问题，供新会话逐批修复。
>
> **修复目标**：合同审查是严谨的法律业务功能，不容数据错误。所有「严重」「中等」问题必须修复并测试验证；「轻微」问题择机修复。
>
> **审查日期**：2026-05-17 ｜ **审查范围**：`server/agents/contract/**`、`server/services/workflow/agents/contractReviewMainAgent.ts`、`server/api/v1/assistant/contract/**`、`app/components/assistant/contract/**`、`app/composables/useContractReviewVersion.ts` 等。

---

## 一、模块背景

LexSeek 是 Nuxt 4 + Vue 3 + Prisma + PostgreSQL 的法律 AI 应用。合同审查模块的完整生命周期：

1. **首次审查**：用户上传合同 docx → AI 识别合同类型/甲乙方 → 用户确认立场 → 按 playbook 切分条款 → 逐条 LLM 审查输出风险 `Risk[]` → 风险落库 `contract_risks`/`contract_annotations` → 把风险批注回写进 docx。
2. **导出**：律师下载带批注/修订标记的 docx，3 种模式 —— `comment`（批注气泡，默认）/ `redline`（Track Changes 修订标记 `<w:ins>`/`<w:del>`）/ `both`。导出修订版时把每条风险对应的修订/批注 `w:id` 写进 customXml「身份证」文件（`word/customXml/redlineRefs.xml`、`annotationRefs.xml`）。
3. **回传**：客户用 Microsoft Word 改了合同后回传，`uploadClientVersionService` 解析回传 docx，识别客户对每条修订的处置（接受/拒绝/未处理/需确认）、批注的增删改回复，把旧风险位置锚点迁移到新合同，生成新版本快照。

关键源码：
- 首次审查工作流：`server/services/workflow/agents/contractReviewMainAgent.ts`
- 回传服务：`server/agents/contract/uploadClientVersion.service.ts`
- docx 处理：`server/agents/contract/docx/**`（parser/redlineInjector/commentInjector/redlineParser/wordCommentParser/redlineLocate/customXmlLocator/customXmlRegistrar/commentContentMatch/xmlAst/zipRewriter/clauseSegmenter）
- 工具：`server/agents/contract/utils/**`（anchorMigrate/clauseDiff/textSimilarity/clauseToParagraph/wordCommentRef）
- 前端：`app/composables/useContractReviewVersion.ts`、`app/components/assistant/contract/**`

技术文档：`docs/tech-docs/backend/contract.md`。

---

## 二、本次审查前已修复的 bug（现状，勿重复修复）

本轮审查前的同一开发周期内，以下 bug 已修复并提交（位于 `dev` 分支）。新会话**核对这些修复是否彻底，不要重复修**；若发现修复有漏洞，在对应问题项标注：

1. **Word 兼容性**：Word 重存 docx 会把 `word/customXml/*.xml` 移到包根并改名 `item{N}.xml`、重排所有 `w:id`。已修：`customXmlLocator` 按命名空间 URI + 根元素本地名定位身份证；`commentContentMatch` 按批注正文内容匹配（不靠 w:id）；`redlineParser` 的 `trustWordIds` 据「身份证是否在原始路径」判定，false 时 `classifyRedlineDecision` 跳过 w:id 精确层。
2. **事务超时**：`uploadClientVersion` Step 5 锚点迁移的重 CPU 计算已移出 Prisma 事务（commit `2bed4ffd`）。
3. **进度 loading**：每个步骤进入时补发 `{ step, status:'progress' }` 事件（commit `b8349081`、`69e1e4f7`）。
4. **批注误删**：`removedAnnIds` 改用 `customXmlRefEntries`（身份证登记的「实际导出过批注的 annotation」全集）判定（commit `2709e3c3`）。
5. **修订半接受**：`classifyRedlineDecision` Layer 2 用 `corpusIns`（段落 `<w:ins>` 标记内文本）区分「未处理」和「半接受」（commit `06fca82e`）。
6. **editedSystemReplies** 批注内容比对从严格 `trim ===` 改为 `normalizeForMatch` 归一化（commit `69e1e4f7`）。

---

## 三、orphaned 专项（最复杂、最高优先级，单独详述）

### 现象
客户回传修订稿后，大量风险（实测 17 条全部）`orphaned=true`，变成「孤立批注」——风险位置丢失，无法在新合同中定位。

### 确切根因（推断链已验证成立）

1. **`parseContractDocx` 提取的是「接受全部修订后的定稿态」文本。**
   - `server/agents/contract/docx/parser.ts:25-41` AST 路径 `paragraphsFromAst` → `paragraphText`（`xmlAst.ts:190-196`）只累加 `tagOf(n)==='w:t'` 的文本。`<w:ins>` 内部是 `<w:r><w:t>` 会被提取；`<w:del>` 内部是 `<w:r><w:delText>`，`delText ≠ w:t`，**完全不提取**。
   - mammoth 路径同口径：`node_modules/mammoth/lib/docx/body-reader.js` 中 `w:ins` 读取、`w:del` 在 `ignoreElements` 整块忽略。
   - 合同基本都有条款编号 → 强制走 AST 路径（`parser.ts:73-76`），结论不变。
   - **结果**：提取出的 = 保留 ins、丢弃 del = 接受所有修订后的定稿文本。

2. **Step 2 产出的 `newClauses`/`newDocxText` 是定稿态。** `uploadClientVersion.service.ts:172-183` 调 `parseContractDocx` + `segmentClauses`。客户回传的 docx 是 LexSeek 首轮导出的 redline 修订稿（每条风险被写成 `<w:del><w:delText>原问题片段</w:delText></w:del><w:ins><w:t>AI建议文本</w:t></w:ins>`），客户只接受少数修订、大部分标记残留。提取后 newClauses 里每条被审条款 = 「前段 + AI建议文本 + 后段」，**原问题片段已随 delText 被丢弃**。

3. **双锚点迁移拿「原文锚点」去「定稿态语料」找 → 必然失配。** `anchorMigrate.ts:212-276` `migrateRiskWithDualAnchor`：档 1 用 `oldProblematicQuote`（首轮记录的原问题片段原文）在定稿态 `newDocxText` 里 fuzzy → 找不到；档 2 用 `oldClauseText`（原条款全文）在定稿态 newClauses Levenshtein → AI 改动幅度大时相似度 <0.6 失配；档 3 两者失败 → `orphaned=true`（`uploadClientVersion.service.ts:921-935` 附近）。

4. **关键设计缺陷：Step 5 锚点迁移完全没用 `redlineRefs.xml`。** 回传 docx 携带 `word/customXml/redlineRefs.xml`，里面精确登记了每条风险的 `riskId → delIds/insId/paraIdxs`。`parseRedlineMarks` 在 Step 3b 已解析它并用于修订处置识别，但 **Step 5 锚点迁移对所有 `dbRisks` 一律走模糊匹配，没用 `redline.refs`**。对 redline 风险，`ref.paraIdxs` 就是「这条风险现在在哪个段落」的权威答案。

### 修复方案（推荐：redline-aware 确定性迁移）

- **主路径**：对每条在 `redline.refs` 里有登记的风险（`ref.riskId`），直接用 `ref.paraIdxs` 定位它在回传 docx 的段落，映射到该段落对应的 `newClauses` 条款（`buildClauseToParagraphMap` 的逆向：paraIdx → 包含该段的 segment）。`newClauseText` 取该 segment.text、`clauseParagraphIndex` 取 `paraIdxs[0]`。确定性、不依赖相似度阈值。
- **回退路径**：`redlineRefs` 缺失/不可信（`trustWordIds=false` 或跨审查）时才回落模糊匹配。回退时**不能用定稿态文本**——应让 `parseContractDocx` 额外产出一份「拒绝所有修订」视图（提取 `<w:delText>` + 段内非 ins 的普通 `<w:t>`，排除 `<w:ins>` 文本），它精确还原首轮审查时的原文，旧风险的 `clauseText`/`problematicQuote` 必然能命中；定位到段落后再映射回定稿态条款写库。`redlineParser.ts` 已经在分别收集 `tNorm`/`delNorm`/`insNorm`，可复用同样思路。
- ins/del 不增删段落（redlineInjector 保留段落标记符），「拒绝修订」视图与定稿态视图段落数一致，段落级一一对应可靠。

> **此修复会动到 Step 5 核心逻辑，必须充分测试**：用真实文件 `劳动合同_v1_2026-05-17.docx`（导出版）+ `劳动合同用户修改.docx`（客户接受 3 条修订后的回传版）验证 review 8，确认 17 条风险能正确迁移、不再 orphaned。

---

## 四、待修复问题全清单

> 格式：编号 ｜ 环节 ｜ `文件:行号` ｜ 问题 / 根因 / 后果 / 修复方案。

### 严重（S1–S7）

**S1 ｜ 首次审查 ｜ `contractReviewMainAgent.ts:613`**
全部条款分析失败时，合同被误判「审查完成·无明显风险」。`runAnalyzeLoop` 返回 `{ risks, warnings }`，resume 分支只解构 `const { risks } = ...`，`warnings` 被丢弃。LLM/网络故障导致所有条款 `analyzeSingleClause` 抛错时：risks 保持 `[]` → `summarizeOverview(0条)` 返回「本合同未识别到明显风险」→ `persistRisksAndCreateV1Snapshot` 建空快照 → status 置 `completed`。后果：一份根本没被 AI 分析过的合同显示「完成·无风险」，律师可能漏掉全部真实风险；部分失败（30 条挂 20 条）同样静默。已有 `segments.length===0` 的 fail-fast 没覆盖「切分成功但分析全失败」。**修复**：捕获 warnings；`risks.length===0 && warnings.length>0` 时不得置 completed（全失败应置 failed）；部分失败应把失败条款数落库或在 summary 标注。

**S2 ｜ 导出 ｜ `commentInjector.ts:367`（`idStart = opts?.idStart ?? 0`）**
comment 模式（默认模式）批注 w:id 从 0 起，不扫 `findMaxSharedId`。`contractReviewRebuild.service.ts:94`、`contractReviewVersion.service.ts:318` 调 `injectAnnotations` 均不传 idStart。redline/both 模式都先 `findMaxSharedId(docAst)+1`，唯独 comment 模式从 0 开始。几乎每份 docx 都带 `<w:bookmarkStart w:id="0" w:name="_GoBack">` 等。后果：注入的 `<w:commentRangeStart w:id="0">` 撞原文档既有元素 ID → Word 报「文件已损坏」；即便不撞，回传读 `annotationRefs <ref wId="0">` 时定位到错误元素。**修复**：comment 模式同样先 `findMaxSharedId(document.xml)+1` 作为 idStart 传入。

**S3 ｜ 导出 ｜ `commentInjector.ts:597-634`（`buildCommentsXmlFromAnnotations`）**
批注内容/作者名不过 `stripIllegalXmlChars`。`makeText(a.content)`、`w:author`/`w:initials` 属性、`buildCommentText`/`buildCommentParagraphs` 均未过滤——`commentInjector.ts` 全文未 import `stripIllegalXmlChars`，仅 `redlineInjector.ts:332/463` 用了。`annotation.content` 来自 AI 输出/律师与客户剪贴板粘贴，可能含 U+0008、U+001B 等非法 XML 1.0 字符。fast-xml-parser builder 只转义 `&<>"'`，不剥离控制字符。后果：非法字符写进 comments.xml → Word 拒绝打开；`assertCommentIntegrity` 重新 parse 计数仍对得上 → 抓不到 → 损坏文件静默发出。**修复**：`buildCommentsXmlFromAnnotations` 对 `a.content`/`authorName`/`signature` 统一过 `stripIllegalXmlChars`。

**S4 ｜ 回传 ｜ `uploadClientVersion.service.ts:649-734`（Step 4a）**
Step 4a 的 DB 写入循环 `for (const result of llmResults)` 无 try/catch。`prisma.contractRisks.update`/`persistAiRisksAsContractRows`/`contractAnnotations.create/update`（含第 711 行 `throw new Error`）一旦抛错：① 异常直接穿出外层 try → 只走 finally 置 status=failed，**不 yield error 事件** → 前端 `ai` 步永久转圈、拿不到错误码；② `step4CreatedRiskIds/AnnIds` 已部分填充的新建行**得不到回滚**（补偿逻辑只在 Step 5 的 catch 里）。后果正是 DOCX-H1 想防的「风险条目凭空多出但无版本快照」。**修复**：Step 4a 整段包 try/catch，catch 里复用 Step 5 同款补偿回滚 + yield `{ step:'ai', code:'AI_REVIEW_FAILED' }`。

**S5 ｜ 回传/锚点 ｜ orphaned（见上文「三、orphaned 专项」）**
客户回传修订稿后大量风险变孤立批注。根因 + 修复方案见第三节。**这是最高优先级、最复杂的修复。**

**S6 ｜ 前端 ｜ `useContractReviewVersion.ts:335-346`（`uploadNewVersion`）**
SSE 上传无法识别服务端「HTTP 200 包装的业务错误」。项目约定 `resError` 返回 HTTP **200** + JSON 体（不调 `setResponseStatus`）。`upload-version/[id].post.ts` 在 SSE 流打开前的所有失败分支（401/403/404/409/400）都走 `resError`（HTTP 200）。`uploadNewVersion` 用裸 `fetch` 判 `if (!resp.ok || !resp.body)`——`resp.ok` 对 HTTP 200 恒 true → 把 JSON 错误体当 SSE 流 `split('\n\n')` 解析，无 `event:`/`data:` 行 → 永不处理。后果：`done` 恒 false、`error` 恒 null、`steps` 全停 idle → 对话框永久显示「处理中，请稍候...」、无 toast、无失败提示。真实触发：会话过期(401)、其他标签页删了 review(403/404)、status 竞态变 busy(409)。**修复**：fetch 返回后先判 `resp.headers.get('content-type')`，不含 `text/event-stream` 则 `await resp.json()` 取 `.message` 写入 `error.value`。

**S7 ｜ 锚点 ｜ `anchorMigrate.ts:99-101`（`scanWindowRange` fallback）**
fuzzy 定位失败后 fallback 全文扫描 `scanWindowRange(clauseText, anchor, 0, clauseText.length-minWin, minWin, maxWin)`：外层 `winLen`（约 0.5·anchorLen 种）× 内层 `i`（约 clauseText.length 个）× 每次 `calcSimilarity`（`dmp.diff_main ≈ O(anchorLen²)`）= **O(clauseText.length · anchorLen³)**。2000 字条款 + 200 字 anchor ≈ 1e12 量级操作。H1 优化只在 `fuzzyLocateInText` 成功的 fast-path，而 orphaned 场景恰恰 fuzzy 失败 → 17 条风险 × 遍历全部 newClauses × 全文扫描 → Step 5 可能跑分钟级。**修复**：fallback 加上限保护（限制 clauseText 长度/winLen 步长，或命中率太低直接放弃）；若 S5 改走 redline-aware 确定性迁移可大幅绕开此路径。

### 中等（M1–M20）

**M1 ｜ 回传 ｜ `uploadClientVersion.service.ts:1149-1162`（finally）**
早期失败也把 status 砸成 `failed`。finally 无条件 `status = succeeded ? 'completed' : 'failed'`。Step 1（备份）/Step 2（解析）/Step 3 失败时尚未改动任何业务数据，但一个原本 `completed` 的审查会因瞬时错误（OSS 下载抖动、上传文件损坏）被置 `failed`。`REVIEW_EDITABLE_STATUSES` 只含 `completed` → **该审查从此对编辑接口返回 409，律师再也改不动风险/批注**。**修复**：对「尚未发生数据变更」的早期失败分支，恢复进入时捕获的原始 status，而非一律 failed。

**M2 ｜ 回传 ｜ `uploadClientVersion.service.ts:957-1102`**
`saveContractReviewVersionService`（约 1095 行）在 `$transaction` 之外，与 Step 5 事务非原子。事务已提交、版本快照保存抛错时：catch 只回滚 step4 新建行，tx 内已提交的 removedAnnIds 标删/replies/锚点迁移/redline 处置全部留存，但没有 `client_return` 版本快照 → 工作区状态已变、无版本、status=failed，回滚不对称。**修复**：把版本快照创建纳入同一事务，或快照失败时连同 tx 一起补偿。

**M3 ｜ 回传 ｜ `uploadClientVersion.service.ts:677-696`（Step 4 existingRisks 分支）**
Step 4 对存量风险的 in-place update 不可补偿。直接 `prisma.contractRisks.update` 覆盖存量风险的 level/category/problem/legalBasis/analysis/suggestion/clauseText，这些行不在 `step4CreatedRiskIds`。Step 5 事务失败补偿时只删新建行，被覆盖的存量风险无法还原（`originalClauseText` 只备份了 clauseText 一个字段）。**修复**：更新前快照存量风险行、失败时还原；或把存量风险更新挪进 Step 5 事务内。

**M4 ｜ 回传 ｜ `uploadClientVersion.service.ts:202-583`（Step 3/3b）**
Step 3 起点的 `Promise.all`（约 204 行）三个 DB 查询、`diffClauses`、Step 3b 查询若抛错，与 S4 同类——异常穿出、前端 `diff` 步卡死、无错误码。**修复**：Step 3+3b 包 try/catch + yield `{ step:'diff', code:'DIFF_FAILED' }`。

**M5 ｜ 回传 ｜ `uploadClientVersion.service.ts:253-326,460-480`**
重度编辑的系统批注被误判「客户删除」且编辑丢失。主匹配循环只用 `commentRefByWId`（纯内容匹配）。客户大幅改写一条 AI/律师批注、相似度 <0.85（`CONTENT_MATCH_FUZZY_THRESHOLD`）时内容匹配失败 → 不进 `commentByAnnId` → `removedAnnIds` 把它当「客户删除」标 removedByClient+suppressInExport；`editedSystemReplies` 只遍历 commentByAnnId 也抓不到 → 律师批注消失 + 客户改写内容丢失。Word 不改写 `w:author`，作者内嵌的 `[#reviewId-annId-rand]` 是可靠标识，但只在次级判定用了、没用于主匹配兜底。**修复**：内容匹配失败时用 `parseCommentRef(author)` 兜底回收 annotationId 再走 editedSystemReplies。

**M6 ｜ 回传 ｜ `uploadClientVersion.service.ts:660-727` 与 `861-947`**
Step 4a 与 Step 5 对「修改条款上的存量 AI 风险」重复处理、锚点字段双写。Step 4a（existingRisks 分支）更新风险的 clauseText/clauseParagraphIndex，Step 5 锚点迁移又基于陈旧的 `dbRisks` 快照再算一遍并覆盖。若 Step 5 `migrateRiskWithDualAnchor` 落档 3，会把 Step 4a 刚刷新过的风险标 `orphaned:true` → 风险内容是新条款的、状态却「无法定位」自相矛盾。**修复**：Step 4a 已处理的存量风险 id 记入集合，Step 5 迁移时跳过。

**M7 ｜ 回传 ｜ `uploadClientVersion.service.ts:399-430`**
newComments 为空但 customXml 身份证残留时安全网失效。`docxHasContent = newComments.length>0 || redlineHasRefs`。若客户用某工具把 comments.xml 整个剥掉、annotationRefs.xml 残留 → newComments=[]、redlineHasRefs=false → docxHasContent=false → 安全网不触发；而 `exportedAnnIds`（来自残留 customXmlRefEntries）非空 → `removedAnnIds` 把全部已导出批注标 removedByClient → 「批注被整体误删」绕过保护。**修复**：identifiableRiskIds 非空、newComments 为空、customXmlRefEntries 非空时也触发 NO_CONTENT_MATCH 保护。

**M8 ｜ 回传/解析 ｜ `parser.ts` vs `xmlAst.ts`/`wordCommentParser.ts`（需真实文件验证）**
paragraphs 口径不一致。`parseContractDocx` 返回的 paragraphs（mammoth `splitParagraphs` trim 后非空行 / `astParagraphs` 递归含表格、text 非空过滤）与 `buildCommentAnchorMap`、`collectNonEmptyParagraphs`（口径「body 直接子 `<w:p>` 且 hasRunChild」）不一致。`newIndependent` 用 `c.anchorParagraphIndex`（buildCommentAnchorMap 口径）去索引 `newParagraphs`（parseContractDocx 口径）取 clauseText（约 1013-1018 行），以及 `newClauseArrayIdxToParaIdx` 写入的 `clauseParagraphIndex` 与导出端 commentInjector 口径不符 → 新批注挂错段。**修复**：统一段落口径；用真实含表格/编号列表的合同验证。

**M9 ｜ 首次审查 ｜ `analyzeSingleClause.ts:107` + `reviewResultPersistence.middleware.ts:91`**
`clauseIndex` 完全信任 LLM 回填。`analyzeSingleClause` 明知正在分析 `ctx.clause.index`，却只覆盖 id 和 matchedPointCode，`clauseIndex` 用 `rawRisk.clauseIndex`。`riskSchema` 的 clauseIndex describe 写「段落索引（0-based）」与实际 1-based `segment.index` 矛盾。LLM 回有效但错误的 index → 取到错条款 → clauseText/clauseParagraphIndex/quote 锚点全错、批注静默挂错条款；回越界 index → `clauseIndexToParagraphIndex.get` 返回 undefined → clauseParagraphIndex 落库 null → `runAnnotateAndUpload` 用 `a.risk.clauseParagraphIndex!` 把 null 传给 `injectAnnotations`，`paraIdx>=0` 对 null 求值 true、`normalizedParas[null]` 得 undefined、`paraText.includes()` 抛 TypeError → **整份审查置 failed**。**修复**：`analyzeSingleClause` 返回时强制 `clauseIndex: ctx.clause.index`；修正 riskSchema describe 文案；`injectAnnotations` 对非整数 paraIdx 用 `Number.isInteger` 兜底。

**M10 ｜ 首次审查 ｜ `analyzeSingleClause.ts:130-133` vs `contractRisk.service.ts:109-121`**
句子 ID 解析基准不一致。`analyzeSingleClause` 给 LLM 看的 `[Sn]` 视图来自 `splitSentences(ctx.clause.text)`（含「第X条」编号前缀）；`persistAiRisksAsContractRows` 解析 `problemSentenceIds` 用 `splitSentences(textWithoutNumber)`（去编号文本）。条款编号单独占首行时（正式合同常见）两个 sentence 数组错位一位 → 每条风险的 problematicQuote/quoteCharStart/End 全部偏移一句，`matchSource` 仍是 'sentence_id' 不报警。**修复**：`analyzeSingleClause` 的 `[Sn]` 视图改用 `ctx.clause.textWithoutNumber`，与落库解析基准统一。

**M11 ｜ 首次审查 ｜ `contractReviewMainAgent.ts:613`（resume 分支）**
resume 分支不响应 signal。`options.signal` 只接到首轮 `agent.stream`（约 697 行）。resume 分支的 `runAnalyzeLoop → analyzeSingleClause → invokeNodeJson → model.invoke` 全程不传 signal。用户在最耗时的逐条分析阶段点取消/超时，审查不中断、继续烧 token。**修复**：把 signal 透传进 `runAnalyzeLoop`/`invokeNodeJson` 的 `model.invoke`。

**M12 ｜ 首次审查 ｜ `riskSchema.builder.ts:30,157`（需产品决策）**
LLM 生成的 `risk` 字段（立场专属法律风险，min1/max2000）被静默丢弃。落库进 `contractReviews.risks` 旧 JSONB，但权威的 `contractRisks` 表/`ContractRiskEntity` 无 risk 列，`persistAiRisksAsContractRows` 不写它；批注文本 `renderRiskAsAnnotationText` 用 `analysis ?? risk`、analysis 恒有值 → risk 不进批注。Phase B 读 contractRisks 表后这段立场风险分析永久丢失，且 LLM 每条白烧 token。**修复（需产品决策）**：要么给 `contractRisks` 加列持久化，要么 schema 不再强制要求 `risk`。

**M13 ｜ 导出 ｜ `redlineInjector.ts:418-451`（`applyRedlineToParagraph` 跨 run 分支）**
跨 run 修订注入丢弃 quote 区间内的非 `w:r` 节点。`middleRuns = kids.slice(start+1,end).filter(tagOf==='w:r')` 只留 run，`kids.splice` 把整段 [start,end] 替换。区间内的 `<w:bookmarkStart/End>`、既有 `<w:commentRangeStart/End>`、`<w:hyperlink>`（连同文字）被删 → 配对标记被切一半、悬空 → Word「可读性内容有问题」修复提示甚至损坏。**修复**：跨 run 替换时保留区间内的非 run 结构节点。

**M14 ｜ 导出 ｜ `commentInjector.ts:488`（`injectAnnotations`）**
comments.xml 整体覆盖。`writeTextToZip('word/comments.xml', buildCommentsXmlFromAnnotations(...))` 只含我方批注，原文档既有 `<w:comment>` 被丢，但 document.xml 里它们的 commentRangeStart/End/reference 不会被清。`assertCommentIntegrity`（约 513-540）统计 rangeStart 数 = 原生 + 新注入 ≠ validCount → 抛错 → **带客户原生批注的合同永远无法以 comment 模式导出**。**修复**：保留原生 `<w:comment>` 并合并，或清理原生 comment 的残留标记。

**M15 ｜ 导出 ｜ `redlineInjector.ts:226` / `commentInjector.ts:373-383`**
未注入 redline 时不清理 base 里残留的 `redlineRefs.xml`。仅 `spansByRiskId.size>0` 才写 redlineRefs.xml；comment 模式不调 `injectRedlineMarks`；空批注分支只清 annotationRefs 不碰 redlineRefs。base 可能是客户回传件（带上一轮 redlineRefs.xml）→ 以 comment 模式导出时陈旧 redlineRefs.xml 原样进入产物 → 再回传时回传识别读到陈旧 delIds/insIds → 识别错乱。**修复**：导出前显式清理陈旧 redlineRefs.xml 及 Content_Types/rels 登记。

**M16 ｜ 导出 ｜ `contractReviewRebuild.service.ts:100` / `contractReviewVersion.service.ts:323-324`**
`findMaxSharedId` 只扫 `word/document.xml`，漏 header*/footer*/footnotes/endnotes/comments.xml 里的 w:id-bearing 元素 → 新分配的 `<w:del>/<w:ins>` w:id 可能与页眉书签、原生 comment ID 撞车。**修复**：扫描所有相关 part 的 w:id 取全局 max。

**M17 ｜ 导出 ｜ `downloadContractReviewVersionService`（需与回传逻辑协调）**
base = 客户回传 docx 时重复注入。下载「客户回传」类版本时 base = 回传原件，已含我方上一轮注入的批注/修订标记，重新注入会叠加或触发 `assertCommentIntegrity` 抛错。**修复**：确认回传是否产出「干净 base」，否则历史版本下载对回传版本会失败/产出脏文件。

**M18 ｜ 前端 ｜ `useContractReviewExport.ts:36-48`（`onExportPdf`）**
与 S6 同源。export-pdf 用 `$fetch` + `responseType:'blob'`。服务端失败走 `resError` → HTTP 200 + JSON。ofetch 在 2xx 下不抛错，把 JSON 错误体包成 Blob 返回，`data instanceof Blob` 通过 → 把 JSON 文本当 PDF 下载成损坏文件，catch 永不执行。**修复**：下载前判 `data.type` 是否 `application/pdf`，否则 `await data.text()` → JSON.parse 取 message 提示。

**M19 ｜ 锚点 ｜ `textSimilarity.ts:24-32`（`calcSimilarity`）**
未控制 `dmp.Diff_Timeout`（默认 1.0s）。长条款（2000+ 字）vs 长 anchor 做 `diff_main` 超时时，dmp 返回退化的非最优 diff（趋近整体删除+整体插入）→ `diff_levenshtein ≈ maxLen` → 相似度 ≈ 0 → 本来 0.6+ 的条款被误判 <0.6 → 误 orphan/误判 removed。**修复**：比对前先 `normalizeForMatch` 归一并按长度截断，或显式设 Diff_Timeout 并对超时结果降级处理。

**M20 ｜ 锚点/条款 ｜ `clauseDiff.ts:38-47` + `clauseSegmenter.ts:132`**
（a）`diffClauses` 比对未做 `normalizeForMatch` 归一——`calcSimilarity(oldClause.text, newClause.text)` 直接比原文，Word 重存改空白/全半角/标点格式会让未改动条款 sim<1 被判 `modified`、触发多余 Step 4 AI 重审；且第 57 行 `c.sim===1` 严格相等判 unchanged 几乎只对字节完全相同成立。修复：比对前 `normalizeForMatch`。
（b）`clauseSegmenter.ts:132` `RE_DI_TIAO = /(第[...]+条)/` 无 `^` 行首锚定，正文中段的「根据第3条约定…」会被误判成新条款起点 → 后续 segment 的 index/offset 全漂移、间接污染锚点迁移。修复：对「第X条」要求出现在行首（允许少量前导空白）。

### 轻微（L1–L14）

- **L1 ｜ `anchorMigrate.ts:109-122`**：`migrateAnchor` fast-path「首个达标即返回」非全局最优。`preferredNewClauseArrayIdx` 来自模糊配对的 `clauseDiff.modified`、可能错配，命中 ≥0.6 即 return 不再比较其它条款。建议 fast-path 也参与全局取 max。
- **L2 ｜ `anchorMigrate.ts:218-219`**：`MIN_QUOTE_LEN_FOR_TIER1=4` 偏低，4 字 quote fuzzy 误命中率高。建议酌情提高。
- **L3 ｜ `clauseSegmenter.ts:117-125`**：「第3.1条」无法提取序号 → `currentDiTiaoIdx` 变 null → 多级编号子项匹配失效。边缘格式。
- **L4 ｜ `parser.ts:36-40`**：`paragraphsFromAst` `catch { return [] }` 吞掉所有 AST 解析异常，document.xml 解析异常且 `prefixMap.size>0` 时 paragraphs 为空 → 下游全 orphan 且无日志。建议至少 `logger.warn`。
- **L5 ｜ `clauseToParagraph.ts:42-58`**：`buildClauseToParagraphMap` 依赖「段落文本不含内部换行」隐含前提，某 `<w:t>` 字面含 `\n` 时 offset→段落映射失准。理论边界。
- **L6 ｜ `redlineParser.ts:195-201`**：`trustWordIds=true` 时「半接受」被 Layer 1 短路成 AMBIGUOUS（del 全存活 + ins 不存活时 Layer 1 直接返回 AMBIGUOUS，不进 Layer 2 半接受识别）。本 session 修的半接受只在 `trustWordIds=false` 路径生效。危害小（Word 接受修订通常触发规范化→trustWordIds 转 false），AMBIGUOUS 是保守落点不丢数据。建议补说明或让 Layer 1 对该组合下沉 Layer 2。
- **L7 ｜ `uploadClientVersion.service.ts:1060-1073`**：客户跨两次上传「先接受后拒绝」时 `archivedStatus` 不回退（accept 分支只加不减）→ 已被拒绝的风险仍以「已处理」隐藏。
- **L8 ｜ `uploadClientVersion.service.ts:801-826`**：Step 4b 全局复核部分失败被吞（catch 仅 `logger.warn` 继续），已建 risk 可能缺对应 annotation，半成品 risk 已进 step4CreatedRiskIds。
- **L9 ｜ `uploadClientVersion.service.ts:1226-1231`**：`detectUnsavedEdits` 的 latestRisk 查询未加 DOCX-M2 同类过滤（latestAnn 过滤了 removedByClient/suppressInExport，latestRisk 没有）→ 系统自身的 redline 处置写入也 bump risk.updatedAt → 在 M2 场景下次 upload 多触发一次 auto_backup。
- **L10 ｜ 多个路由 readBody 未 `.catch`**：`upload-version/[id].post.ts:38`、`add-annotation/[id].post.ts:34`、`annotations/[annotationId].patch.ts:30`、`risks/[riskId].patch.ts:33`、`versions/[versionId].patch.ts:28` 裸 `await readBody(event)`，畸形 JSON body → 500 而非 400。同模块 risk-list/stance/export-pdf/reviews.post 均已 `.catch(()=>null)`，不一致。
- **L11 ｜ `useContractReviewVersion.ts:413-423`（`updateVersionNote`）**：PATCH 失败时本地 versions 不回滚，且 `VersionTimeline.saveEditNote` 已先关掉编辑框 → 备注文字丢失。
- **L12 ｜ `commentInjector.ts:623`**：`injectAnnotations` 把多行 content 塞进单个 `<w:p><w:r><w:t>`，AI 批注的【法律依据】【条款分析】多行 `\n` 在 `<w:t>` 里 Word 不渲染换行 → 气泡里挤成一行。废弃版 `injectComments` 用 `buildCommentParagraphs` 按 `\n` 拆段反而是对的。建议按行拆 `<w:p>`。
- **L13 ｜ `redlineInjector.ts:487-497`（`wholeParagraphRunSplit`）**：对「无直接 `w:r` 子节点」段落（run 全嵌 hyperlink/sdt 内）返回 `startRunIdx/endRunIdx=-1`，`computeRunLength(kids[-1]!)` 对 undefined 取 tagOf 崩溃。当前被 redlineLocate 一致性校验挡住，属未设防脆弱点。建议 `firstRunIdx===-1` 时跳过该段。
- **L14 ｜ `redlineInjector.ts:374-413`（`applyRedlineToParagraph` same-run 分支）**：`if (upToEnd.left)` 无 else，落空时 fall-through 进跨 run 分支 → 对同一 run 二次切分产出双删。实际几乎不可达。建议补 else 明确跳过/告警。

### 需核实项（非定论，先核实再决定改不改）

- **V1 ｜ 计费**：`pointConsumptionMiddleware` 只包住首轮 agent（detect/stance，token 极少），最贵的逐条分析 + summarize 走 resume 分支的 `invokeNodeJson`、无任何积分中间件。**核实**：合同审查是否另有按次扣费？若按 token 计费则分析阶段全程不计费。
- **V2 ｜ `summarizeOverview`**：把 `highlights[].riskId` 存成内存里的 `randomUUID`，`contractRisks` 表用自增整型 id。**核实**：审查详情页若用整型 id 渲染风险卡片，总览要点点击联动会失效。
- **V3 ｜ `chat.post.ts:40-62`**：与 S6 同样的「resError 在 SSE 流之前、HTTP 200」模式。**核实**：其 SSE 消费方（`useContractAgent`/`useStreamChat`）能否识别 HTTP 200 JSON 错误，否则合同审查对话也会同类静默卡死。

---

## 五、修复批次建议

**第一批 — 数据正确性 / 用户卡死（最高优先级）**：S1、S4、S5（orphaned）、S6、M1（早期失败砸 failed）。这批直接影响用户当前能否正常使用。

**第二批 — 文件损坏**：S2、S3（comment 导出 w:id 与非法字符）、M14、M16。

**第三批 — 回传链路其余中等问题**：M2、M3、M4、M5、M6、M7、M8、S7（性能，与 S5 一并处理）。

**第四批 — 首次审查 / 导出其余中等问题**：M9、M10、M11、M13、M15、M17、M18、M19、M20。M12、V1、V2、V3 先核实再定。

**第五批 — 轻微问题**：L1–L14 择机。

> 建议：同一文件的多个问题尽量一次性改完（减少重复读改测）。每批改完跑 typecheck + 相关测试验证后再 commit，不要一次全改。

---

## 六、修复流程要求

新会话必须遵守项目规范（`CLAUDE.md` + `.claude/rules/**` 会自动加载）。关键点：

1. **先思考、再编码、再测试**：严禁靠猜测，必须先读懂相关代码/文档再动手。修复前确认根因。
2. **不修改客户需求**：遇到问题用回退方案前必须先征得用户同意。
3. **类型检查**：用 `npx nuxi typecheck`（或 `bun run typecheck`），不要用 `tsc`。
4. **测试**：用 `npx vitest run`，禁用 `bun test`。每修一批跑相关测试（`tests/server/agents/contract/**`、`tests/server/assistant/contract/**`）。全部批次改完再跑全量 `bun run test`。
5. **TDD**：改 bug 先写/改测试覆盖该 bug，再改实现。编码了旧 bug 行为的测试要同步更新。
6. **数据库变更**：若需改 schema（如 M12 给 contractRisks 加列），走 `bun run prisma:migrate`，禁止手工改 migrations。
7. **commit**：conventional commit + 中文，按逻辑原子提交。**注意**：本仓库 dev 分支可能有并行任务在同时提交，`git commit` 前先 `git status` 看暂存区，只提交自己改的文件用 `git commit -- <file1> <file2>` 显式限定路径，不要裸 `git commit`（会吞掉并行任务已暂存的文件）。
8. **完成编码后用 `simplify` 技能**优化代码。
9. **UI 改动**在浏览器实际验证（前端问题 S6、M18、L11、L12）。

---

## 七、验证方法

- **真实测试文件**（用户提供，可能仍在 `~/Downloads/`）：
  - `劳动合同_v1_2026-05-17.docx` —— LexSeek 导出的 redline 修订版（原始导出态）。
  - `劳动合同用户修改.docx` —— 客户在 Word 里接受了 3 条修订后回传的版本。
  - 对应审查 review id = 8（开发库 `ls_new`）。早前的 review 6、7 也是同类数据。
- **orphaned（S5）验证**：修复后用上述文件回传 review，确认走修订标记的风险能正确锚点迁移、不再大批 orphaned；客户接受的修订识别为 accepted、未动的为 untouched。
- **查库**：`docker exec postgres psql -U daixin -d ls_new -c "..."`，关注 `contract_risks.orphaned`/`client_redline_decision`、`contract_annotations.removed_by_client`、`contract_reviews.status`。
- **回传识别诊断**：可临时写 vitest 测试解析真实 docx（`parseRedlineMarks`/`parseWordComments`）打印中间值，诊断完删除临时文件。
- 修复涉及核心逻辑（S1、S4、S5）务必有回归测试覆盖。

---

## 八、关键文件索引

| 环节 | 文件 |
|------|------|
| 首次审查工作流 | `server/services/workflow/agents/contractReviewMainAgent.ts` |
| 单条款审查 | `server/agents/contract/analyzeSingleClause.ts`、`riskSchema.builder.ts` |
| 风险落库 | `server/agents/contract/contractRisk.service.ts`、`contractRisk.dao.ts` |
| 回传服务 | `server/agents/contract/uploadClientVersion.service.ts`（核心，1200+ 行） |
| 导出/重建 | `server/agents/contract/contractReviewRebuild.service.ts`、`contractReviewVersion.service.ts` |
| docx 注入 | `server/agents/contract/docx/redlineInjector.ts`、`commentInjector.ts`、`customXmlRegistrar.ts` |
| docx 解析 | `server/agents/contract/docx/parser.ts`、`redlineParser.ts`、`wordCommentParser.ts`、`customXmlLocator.ts`、`commentContentMatch.ts`、`clauseSegmenter.ts` |
| docx 基础 | `server/agents/contract/docx/xmlAst.ts`、`zipRewriter.ts`、`redlineLocate.ts` |
| 锚点/条款工具 | `server/agents/contract/utils/anchorMigrate.ts`、`clauseDiff.ts`、`textSimilarity.ts`、`clauseToParagraph.ts`、`wordCommentRef.ts` |
| 前端 | `app/composables/useContractReviewVersion.ts`、`useContractReviewExport.ts`、`app/components/assistant/contract/**` |
| API | `server/api/v1/assistant/contract/reviews/**` |
| 技术文档 | `docs/tech-docs/backend/contract.md` |

---

> **行号说明**：文档中的行号基于审查时（2026-05-17）的代码状态，修复过程中文件会变动，行号仅作定位参考，以实际代码为准。
