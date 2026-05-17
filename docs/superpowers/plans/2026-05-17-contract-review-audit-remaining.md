# 合同审查代码审查问题修复 — 剩余批次交接文档

> **文档性质**：2026-05-17 一次 5-agent 并行代码审查（原始产出见 `docs/superpowers/plans/2026-05-17-contract-review-audit-fixes.md`）的**剩余未做项**交接。审查覆盖合同审查模块「首次审查 → 导出 → 客户回传」完整生命周期。
>
> **背景**：原始审查列出 44 个待修问题，分五批。**第一、二、三批已全部完成并提交**（见下「二、已完成」）。本文档交接**第四批、待核实项、第五批**，供新会话独立执行。
>
> **修复目标**：合同审查是严谨的法律业务功能，不容数据错误。「中等」问题应修复并测试验证；「待核实项」先核实再决定；「轻微」问题择机修复。
>
> **审查日期**：2026-05-17。本交接文档成稿：2026-05-17。

---

## 一、模块背景

LexSeek 是 Nuxt 4（Nitro 服务端）+ Vue 3 + Prisma + PostgreSQL 的全栈法律 AI 应用。合同审查模块的完整生命周期：

1. **首次审查**：用户上传合同 docx → AI 识别合同类型/甲乙方 → 用户确认立场 → 按 playbook 切分条款 → 逐条 LLM 审查输出风险 → 风险落库 `contract_risks`/`contract_annotations` → 把风险批注回写进 docx。
2. **导出**：律师下载带批注/修订标记的 docx，3 种模式 —— `comment`（批注气泡，默认）/ `redline`（Track Changes 修订标记）/ `both`。
3. **回传**：客户用 Word 改了合同后回传，`uploadClientVersionService` 解析、识别处置、迁移锚点、生成新版本快照。

**关键源码**：
- 首次审查工作流：`server/services/workflow/agents/contractReviewMainAgent.ts`
- 回传服务：`server/agents/contract/uploadClientVersion.service.ts`
- docx 处理：`server/agents/contract/docx/**`（parser / redlineInjector / commentInjector / redlineParser / wordCommentParser 等）
- 工具：`server/agents/contract/utils/**`（anchorMigrate / clauseDiff / textSimilarity / clauseToParagraph 等）
- 前端：`app/composables/useContractReviewVersion.ts` / `useContractReviewExport.ts`、`app/components/assistant/contract/**`

**技术文档**：`docs/tech-docs/backend/contract.md`（含 §11.9 段落口径、§12 双锚点迁移、§13 修订版回传识别）。

**原始审查文档**：`docs/superpowers/plans/2026-05-17-contract-review-audit-fixes.md` —— 含完整 44 项清单、「复核结论（2026-05-17 二次核对）」、「orphaned 专项」。orphaned/S5 已修复，新会话主要参考其「复核结论」一节里的跨项发现（本文档「六、跨项重要上下文」已提炼相关部分）。

---

## 二、已完成（勿重复修复）

第一~三批共 17 个问题已修复并提交到 `dev` 分支：

| 批次 | 问题 | 提交 |
|------|------|------|
| 一 | S6（SSE 流错误处理）+ 复核结论补充 | `835d57a1` |
| 一 | S4（回传 Step 4a 写库失败错误处理 + 回滚） | `a86d8bf8` |
| 一 | S5（回传锚点迁移改 redline-aware 确定性定位，修复大批 orphaned） | `6c9144a8` |
| 一 | S1（首次审查全条款失败误判完成）、M1（早期失败误锁 failed） | 在 `contractReviewMainAgent.ts` / `uploadClientVersion.service.ts` 内（含 `09c79dba`） |
| 二 | S2 / S3 / M14 / M17 / M16（comment 导出致 docx 损坏的多个问题） | `522174c3` |
| 三 | S7（回传锚点迁移 fallback 全文扫描加上限保护） | `1f9c2df2` |
| 三 | M5（回传批注匹配作者身份证兜底）+ M7（customXml 残留安全网） | `02ddade3` |
| 三 | M4（回传 Step 3/3b 异常补精确错误码） | `b6e92413` |
| 三 | M2 / M3 / M6（回传补偿/事务边界统筹） | `b7fe78ca` |
| 三 | M8（统一段落口径，clauseParagraphIndex 改用批注注入口径） | `3f7d76fa` |

> **不要重复修这些**。若发现某项修复有漏洞，在对应剩余问题项里标注，不要回退已提交的修复。

---

## 三、第四批 — 首次审查 / 导出其余中等问题（建议优先做）

> **格式**：编号 ｜ 环节 ｜ `文件:行号` ｜ 问题 / 后果 / 修复方案。
> **行号严重漂移**：原审查行号基于 2026-05-17 早期快照，第一~三批改动后 `uploadClientVersion.service.ts` / `parser.ts` / `anchorMigrate.ts` / `redlineInjector.ts` / `commentInjector.ts` / `contractReviewMainAgent.ts` 行号已大幅偏移。**一律按函数名 / 代码内容重新定位，不要信行号。**

### M9 ｜首次审查｜`analyzeSingleClause.ts` + `reviewResultPersistence.middleware.ts`（含崩溃路径，本批最高优先）

`clauseIndex` 完全信任 LLM 回填。`analyzeSingleClause` 明知正在分析 `ctx.clause.index`，却只覆盖 `id` 和 `matchedPointCode`，`clauseIndex` 直接用 `rawRisk.clauseIndex`。`riskSchema` 的 `clauseIndex` describe 写「段落索引（0-based）」与实际 1-based `segment.index` 矛盾。

后果：① LLM 回有效但错误的 index → 取到错条款 → `clauseText`/`clauseParagraphIndex`/quote 锚点全错、批注静默挂错条款；② LLM 回越界 index → `clauseIndexToParagraphIndex.get` 返回 undefined → `clauseParagraphIndex` 落库 null → `runAnnotateAndUpload` 用 `a.risk.clauseParagraphIndex!` 把 null 传给 `injectAnnotations`，`paraIdx>=0` 对 null 求值 true、`normalizedParas[null]` 得 undefined、`paraText.includes()` 抛 `TypeError` → **整份审查置 failed**。

**修复**：`analyzeSingleClause` 返回时强制 `clauseIndex: ctx.clause.index`；修正 `riskSchema` 的 describe 文案；`injectAnnotations` 对非整数 `paraIdx` 用 `Number.isInteger` 兜底。

### M10 ｜首次审查｜`analyzeSingleClause.ts` vs `contractRisk.service.ts`

句子 ID 解析基准不一致。`analyzeSingleClause` 给 LLM 看的 `[Sn]` 视图来自 `splitSentences(ctx.clause.text)`（含「第X条」编号前缀）；`persistAiRisksAsContractRows` 解析 `problemSentenceIds` 用 `splitSentences(textWithoutNumber)`（去编号文本）。条款编号单独占首行时（正式合同常见），两个 sentence 数组错位一位 → 每条风险的 `problematicQuote`/`quoteCharStart/End` 全部偏移一句，`matchSource` 仍是 `'sentence_id'` 不报警。

**修复**：`analyzeSingleClause` 的 `[Sn]` 视图改用 `ctx.clause.textWithoutNumber`，与落库解析基准统一。

### M11 ｜首次审查｜`contractReviewMainAgent.ts`（resume 分支）

resume 分支不响应 `signal`。`options.signal` 只接到首轮 `agent.stream`。resume 分支的 `runAnalyzeLoop → analyzeSingleClause → invokeNodeJson → model.invoke` 全程不传 signal。用户在最耗时的逐条分析阶段点取消/超时，审查不中断、继续烧 token。

**修复**：把 `signal` 透传进 `runAnalyzeLoop` / `invokeNodeJson` 的 `model.invoke`。

### M13 ｜导出｜`redlineInjector.ts`（`applyRedlineToParagraph` 跨 run 分支）

跨 run 修订注入丢弃 quote 区间内的非 `w:r` 节点。`middleRuns = kids.slice(start+1,end).filter(tagOf==='w:r')` 只留 run，`kids.splice` 把整段 `[start,end]` 替换。区间内的 `<w:bookmarkStart/End>`、既有 `<w:commentRangeStart/End>`、`<w:hyperlink>`（连同文字）被删 → 配对标记被切一半、悬空 → Word 报「可读性内容有问题」修复提示甚至损坏。

**修复**：跨 run 替换时保留区间内的非 run 结构节点。

### M15 ｜导出｜`redlineInjector.ts` / `commentInjector.ts`

未注入 redline 时不清理 base 里残留的 `redlineRefs.xml`。仅 `spansByRiskId.size>0` 才写 `redlineRefs.xml`；comment 模式不调 `injectRedlineMarks`；空批注分支只清 `annotationRefs` 不碰 `redlineRefs`。base 可能是客户回传件（带上一轮 `redlineRefs.xml`）→ 以 comment 模式导出时陈旧 `redlineRefs.xml` 原样进入产物 → 再回传时回传识别读到陈旧 `delIds`/`insIds` → 识别错乱。

**修复**：导出前显式清理陈旧 `redlineRefs.xml` 及 `[Content_Types].xml` / rels 登记。

### M18 ｜前端｜`useContractReviewExport.ts`（`onExportPdf`）

与 S6 同源（见「六、跨项上下文」）。export-pdf 用 `$fetch` + `responseType:'blob'`。服务端失败走 `resError` → HTTP 200 + JSON 体。ofetch 在 2xx 下不抛错，把 JSON 错误体包成 Blob 返回，`data instanceof Blob` 通过 → 把 JSON 文本当 PDF 下载成损坏文件，catch 永不执行。

**修复**：下载前判 `data.type` 是否 `application/pdf`，否则 `await data.text()` → `JSON.parse` 取 `.message` 提示。**UI 改动需在浏览器实际验证。**

### M19 ｜锚点｜`textSimilarity.ts`（`calcSimilarity`）

未控制 `dmp.Diff_Timeout`（默认 1.0s）。长条款（2000+ 字）vs 长 anchor 做 `diff_main` 超时时，dmp 返回退化的非最优 diff（趋近整体删除+整体插入）→ `diff_levenshtein ≈ maxLen` → 相似度 ≈ 0 → 本来 0.6+ 的条款被误判 <0.6 → 误 orphan / 误判 removed。

**修复**：比对前先 `normalizeForMatch` 归一并按长度截断，或显式设 `Diff_Timeout` 并对超时结果降级处理。

### M20 ｜锚点/条款｜`clauseDiff.ts` + `clauseSegmenter.ts`

**(a)** `diffClauses` 比对未做 `normalizeForMatch` 归一——`calcSimilarity(oldClause.text, newClause.text)` 直接比原文，Word 重存改空白/全半角/标点格式会让未改动条款 `sim<1` 被判 `modified`、触发多余 Step 4 AI 重审；且 `c.sim===1` 严格相等判 `unchanged` 几乎只对字节完全相同成立。修复：比对前 `normalizeForMatch`。

**(b)** `clauseSegmenter.ts` 的 `RE_DI_TIAO = /(第[...]+条)/` 无 `^` 行首锚定，正文中段的「根据第3条约定…」会被误判成新条款起点 → 后续 segment 的 index/offset 全漂移、间接污染锚点迁移。修复：对「第X条」要求出现在行首（允许少量前导空白）。

---

## 四、待核实项（先核实，再决定改不改）

### M12 ｜首次审查｜`riskSchema.builder.ts`（**需产品决策**）

LLM 生成的 `risk` 字段（立场专属法律风险，min1/max2000）被静默丢弃。落库进 `contractReviews.risks` 旧 JSONB，但权威的 `contractRisks` 表 / `ContractRiskEntity` 无 `risk` 列，`persistAiRisksAsContractRows` 不写它；批注文本 `renderRiskAsAnnotationText` 用 `analysis ?? risk`、`analysis` 恒有值 → `risk` 不进批注。Phase B 读 `contractRisks` 表后这段立场风险分析永久丢失，且 LLM 每条白烧 token。

**修复（需产品决策）**：要么给 `contractRisks` 加列持久化（走 `bun run prisma:migrate`，禁止手工改 migrations），要么 schema 不再强制要求 `risk`。**两个方向都改了客户需求/数据模型，必须先征得用户同意再动手。**

### V1 ｜计费

`pointConsumptionMiddleware` 只包住首轮 agent（detect/stance，token 极少），最贵的逐条分析 + summarize 走 resume 分支的 `invokeNodeJson`、无任何积分中间件。

**核实**：合同审查是否另有按次扣费机制？若按 token 计费，则分析阶段全程不计费——确认是否漏计。

### V2 ｜`summarizeOverview`

`summarizeOverview` 把 `highlights[].riskId` 存成内存里的 `randomUUID`，而 `contractRisks` 表用自增整型 id。

**核实**：审查详情页若用整型 id 渲染风险卡片，「总览要点点击联动定位风险」会失效。需核实前端实际是否用整型 id。

### V3 ｜`chat.post.ts`

与 S6 同样的「`resError` 在 SSE 流打开之前、HTTP 200」模式。

**核实**：其 SSE 消费方（`useContractAgent` / `useStreamChat`）能否识别 HTTP 200 包装的 JSON 错误，否则合同审查对话也会同类静默卡死。**注意**：V3 的失败点在第三方 SDK（`FetchStreamTransport`）内部、无法改 SDK 源码 —— 修 V3 需额外决策（让 SSE 接口「开流前失败」真返回非 200 状态码，或在包装层拦截 `content-type`），不能直接套用 S6 的修法。

---

## 五、第五批 — 轻微问题（择机修复）

> 全部为低优先级。每项一句话定位 + 修复方向；详情见原始审查文档 §四「轻微（L1–L14）」。

- **L1** ｜`anchorMigrate.ts` `migrateAnchor`：fast-path「首个达标即返回」非全局最优，`preferredNewClauseArrayIdx` 可能错配。建议 fast-path 也参与全局取 max。
- **L2** ｜`anchorMigrate.ts`：`MIN_QUOTE_LEN_FOR_TIER1=4` 偏低，4 字 quote fuzzy 误命中率高。建议酌情提高。
- **L3** ｜`clauseSegmenter.ts`：「第3.1条」无法提取序号 → `currentDiTiaoIdx` 变 null → 多级编号子项匹配失效。边缘格式。
- **L4** ｜`parser.ts`：**M8 已把 `paragraphsFromAst` 重写为 `paragraphsFromAstWithMeta`，但仍保留 `catch { return { 空结果 } }` 静默吞掉 AST 解析异常**。document.xml 解析异常且含 numbering 时下游全 orphan 且无日志。建议 catch 里至少 `logger.warn`。
- **L5** ｜`clauseToParagraph.ts` `buildClauseToParagraphMap`：依赖「段落文本不含内部换行」隐含前提，某 `<w:t>` 字面含 `\n` 时 offset→段落映射失准。理论边界。
- **L6** ｜`redlineParser.ts`：`trustWordIds=true` 时「半接受」被 Layer 1 短路成 `AMBIGUOUS`（del 全存活 + ins 不存活时 Layer 1 直接返回，不进 Layer 2 半接受识别）。危害小（Word 接受修订通常触发规范化→`trustWordIds` 转 false），`AMBIGUOUS` 是保守落点不丢数据。建议补说明或让 Layer 1 对该组合下沉 Layer 2。
- **L7** ｜`uploadClientVersion.service.ts`：客户跨两次上传「先接受后拒绝」时 `archivedStatus` 不回退（accept 分支只加不减）→ 已被拒绝的风险仍以「已处理」隐藏。
- **L8** ｜`uploadClientVersion.service.ts` Step 4b：全局复核部分失败被吞（catch 仅 `logger.warn` 继续），已建 risk 可能缺对应 annotation。**注**：M2/M3/M6 已让 Step 4b 新建行进入补偿回滚集合（Step 5 失败时会回滚），但 Step 4b 自身「catch 吞错继续」导致的「成功上传里残留半成品 risk」仍未解决。
- **L9** ｜`uploadClientVersion.service.ts` `detectUnsavedEdits`：`latestRisk` 查询未加 DOCX-M2 同类过滤（`latestAnn` 过滤了 `removedByClient`/`suppressInExport`，`latestRisk` 没有）→ 系统自身的 redline 处置写入也 bump `risk.updatedAt` → 下次 upload 多触发一次 auto_backup。
- **L10** ｜多个路由 `readBody` 未 `.catch`：`upload-version/[id].post.ts`、`add-annotation/[id].post.ts`、`annotations/[annotationId].patch.ts`、`risks/[riskId].patch.ts`、`versions/[versionId].patch.ts` 裸 `await readBody(event)`，畸形 JSON body → 500 而非 400。同模块其它路由已 `.catch(()=>null)`，不一致。
- **L11** ｜`useContractReviewVersion.ts` `updateVersionNote`：PATCH 失败时本地 `versions` 不回滚，且 `VersionTimeline.saveEditNote` 已先关掉编辑框 → 备注文字丢失。**UI 改动需浏览器验证。**
- **L12** ｜`commentInjector.ts` `injectAnnotations`：把多行 content 塞进单个 `<w:p><w:r><w:t>`，AI 批注的【法律依据】【条款分析】多行 `\n` 在 `<w:t>` 里 Word 不渲染换行 → 气泡里挤成一行。建议按行拆 `<w:p>`（参考废弃版 `injectComments` 的 `buildCommentParagraphs`）。
- **L13** ｜`redlineInjector.ts` `wholeParagraphRunSplit`：对「无直接 `w:r` 子节点」段落（run 全嵌 hyperlink/sdt 内）返回 `startRunIdx/endRunIdx=-1`，`computeRunLength(kids[-1]!)` 对 undefined 取 `tagOf` 崩溃。当前被 redlineLocate 一致性校验挡住，属未设防脆弱点。建议 `firstRunIdx===-1` 时跳过该段。
- **L14** ｜`redlineInjector.ts` `applyRedlineToParagraph` same-run 分支：`if (upToEnd.left)` 无 else，落空时 fall-through 进跨 run 分支 → 对同一 run 二次切分产出双删。实际几乎不可达。建议补 else 明确跳过/告警。

---

## 六、跨项重要上下文（从原始审查「复核结论」提炼）

1. **S6 / M18 / V3 同根**：业务错误统一裹在 HTTP 200 里，前端/SDK 用 `resp.ok` 判失败永远为真。S6 已修（裸 `fetch` 判 `content-type`）。**M18** 同类（`$fetch` blob，判 `data.type`）。**V3** 的失败点在第三方 SDK 内部、无法改 SDK 源码——修法不能直接套 S6，需额外决策（见上 V3）。
2. **S4 / M2 / M3 / M6 / L8 同源**：回传服务的补偿逻辑历史上只能撤销新建行。M2/M3/M6 已统筹设计补偿边界（`rollbackStep4Mutations` 覆盖新建行 + in-place 更新还原；版本快照纳入 Step 5 事务）。**L8** 是这一族的残留尾巴（Step 4b 自身吞错），择机收尾。
3. **行号漂移**：原审查行号基于早期快照，第一~三批改动后已大幅偏移。执行时一律按函数名/代码内容重新定位。

---

## 七、执行规范与注意事项

新会话必须遵守项目规范（`CLAUDE.md` + `.claude/rules/**` 自动加载）。关键点：

1. **先思考、再编码、再测试**：严禁靠猜测，必须先读懂相关代码/文档再动手。修复前确认根因。
2. **不修改客户需求**：遇到问题用回退方案前必须先征得用户同意（M12 尤其——加列 vs 放松 schema 都需产品决策）。
3. **类型检查**：用 `npx nuxi typecheck`（或 `bun run typecheck`），不要用 `tsc`。
4. **TDD**：改 bug 先写/改测试覆盖该 bug，再改实现。编码了旧 bug 行为的测试要同步更新。
5. **测试命令**：用 `npx vitest run`，禁用 `bun test`。每修一项跑相关测试（`tests/server/agents/contract/**`、`tests/server/assistant/contract/**`、`tests/server/workflow/agents/contractReviewMainAgent.*`）。
6. **数据库变更**：M12 若加列，走 `bun run prisma:migrate`，禁止手工改 `prisma/migrations/`。数据级变更同步 `prisma/seeds/seedData.sql`（只 INSERT、不 UPDATE）。
7. **完成编码后用 `simplify` 技能**优化代码。
8. **UI 改动**（M18、L11）在浏览器实际验证。
9. **commit**：conventional commit + 中文，按逻辑原子提交。**`dev` 分支有并行任务在同时提交**（含合同 UI 重做、其它合同 fix）——`git commit` 前先 `git status` 看暂存区，只提交自己改的文件用 `git commit -- <file1> <file2>` 显式限定路径，不要裸 `git commit`。
10. **全量测试套件假失败**：`bun run test` 在全量负载下有大面积 worker-DB 环境性假失败（`database ls_test_wN does not exist` / `seed missing` / `prisma 为 undefined` / 超时），单次全量约 80+ fail 属正常环境噪声。判真伪方法：**单独重跑可疑文件** `npx vitest run <file>` —— 隔离通过即假失败。已知存量失败见 `tests/KNOWN_FAILS.md`。

---

## 八、验证方法

- **真实测试文件**（用户可能仍在 `~/Downloads/`）：`劳动合同_v1_2026-05-17.docx`（导出的 redline 修订版）、`劳动合同用户修改.docx`（客户回传版）。对应审查 review id = 8（开发库 `ls_new`）。
- **查库**：`docker exec postgres psql -U daixin -d ls_new -c "..."`。
- M9 涉及崩溃路径（越界 clauseIndex → 整份审查 failed），务必有回归测试覆盖。
- M13/M15 涉及 docx 文件完整性，建议用真实 docx round-trip 验证（参考 `tests/server/assistant/contract/docx/**` 既有用例）。
- M19/M20 锚点相关，可用 `tests/server/assistant/contract/utils/**` 既有 fast-check / 单测模式补覆盖。

---

## 九、建议执行顺序

1. **第四批优先**（M9 → M10 → M11 → M13 → M15 → M18 → M19 → M20）。M9 含崩溃路径，最高优先。同文件多项尽量一次改完（M9/M10 同在 `analyzeSingleClause.ts`；M13/M15 同在 `redlineInjector.ts`）。
2. **待核实项**：M12/V1/V2/V3 先核实，再向用户汇报核实结论、由用户决定改不改（V3、M12 需决策）。
3. **第五批 L1–L14** 择机，可在第四批间隙顺手处理同文件项（如改 `redlineInjector.ts` 时一并看 L13/L14；改 `uploadClientVersion.service.ts` 时看 L7/L8/L9）。
4. 每批改完跑 typecheck + 相关测试验证后再 commit，不要一次全改。全部完成后再跑一次全量 `bun run test`（注意上述假失败甄别）。
