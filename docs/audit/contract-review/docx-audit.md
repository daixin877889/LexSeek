# 合同审查 Phase B 审计 — docx 导出注入 + 客户回传识别链路

**审计人**：auditor-docx
**权威源**：`docs/superpowers/specs/2026-04-22-contract-review-versioning-phase-b-design.md`（附 `2026-04-17-contract-review-design.md` §10）
**审计范围**：
- `server/services/assistant/contract/docx/*.ts`（9 个文件）
- `server/services/assistant/contract/utils/{wordCommentRef,anchorMigrate,clauseDiff,llmJson}.ts`
- `server/services/assistant/contract/uploadClientVersion.service.ts`
- `server/api/v1/assistant/contract/reviews/[id]/upload-version.post.ts`
- `server/api/v1/assistant/contract/reviews/versions/**`
- `app/components/assistant/contract/ContractUploadNewVersionDialog.vue`
- 对应 `tests/server/assistant/contract/docx/**`、`utils/**`、`uploadClientVersion.service.test.ts`

## 结论概览

整体实现已经相当成熟：三重身份证（customXml 为主 + author 尾标 + 头像缩写）、AST 层改写、NO_ANNOTATION_MATCH 保护、原子状态锁、跨 review 串扰拒绝、孤儿 reply 降级、碰撞降级、syncReviewRisksJsonb 等加固点都已落地。测试覆盖面较广（parser / injector / diff / anchor / upload service 都有），并能回归 Word "删除个人信息"、截断 w:initials 的极端场景。

但仍有**若干偏差与中高危隐患**，集中在：(1) 语义空间错配（paragraphIndex vs clauseIndex）、(2) 存量兼容缺口（Phase A 存量 clauses 未补算、无"恢复推送"入口）、(3) 事务边界（AI/全局复核的新建在事务外）、(4) 产品面契约偏离（§6.2 要求"以系统库为准"但代码把客户改文本当作外部回复）。详见下文。

---

## 偏差清单（Critical / High / Medium / Low）

### Critical

#### C1 · 客户改 AI 批注文本被升格为 external reply，违反 §6.2 / §11 的"系统库为准"铁律
- **证据**：`uploadClientVersion.service.ts:321-332 + 563-581`——`editedSystemReplies` 当作 `authorType='external'`、`content='客户修改了批注内容为：...'` 新建子 annotation。
- **Spec**：§6.2 明文"DB 原 content 保留（不管客户是否改过文本，Phase B **统一以系统库为准**）"；§11 表格同样标注 Phase B 统一以系统库为准，"客户编辑过"徽章推迟到 Phase C。
- **影响**：会在风险卡片下出现 Phase C 才允许的"客户修改了批注内容为 X"提示；律师产品语义混乱，且后续导出会在每次 upload 后 append 一条 reply，多轮流转后注释链被挤爆。属于"AI 必须遵守的规则 #1 — 不许修改客户的需求"被违反：需求方没同意把这条提前到 Phase B。
- **建议**：回到 spec 口径：`editedSystemReplies` 只打 logger.info 诊断（客户改了但不采纳），不生成 external reply；或产品经理书面签字同意再保留。

#### C2 · Phase A 存量 snapshot 没有"一次性补算 clauses"的兜底，历史风险锚点迁移完全失效
- **证据**：`uploadClientVersion.service.ts:163-174`——`oldClauses = snapshot.clauses ?? []`，空时直接进 diff。`diffClauses([], newClauses)` 会把**所有新条款标 `added`**、modified=[]、removed=[]（参见 `clauseDiff.ts:65-68` + 测试 `diffClauses` "旧为空时所有新条款都是 added"）。
- **Spec**：§7.3 明确要求 B1 子期对存量 currentVersion 补算 clauses 后再进入 diff；§14.1 再次强调"Phase A 存量合同首次 Phase B 上传时补算 clauses"。
- **影响**：存量合同（Phase A 时期生成的 initial_upload / lawyer_save）首次客户回传时，historical risks 都不会走锚点迁移（modified/removed 都空），`originalAnchorQuote` 永远不写，所有 AI 风险 `anchorParagraphIndex` 保持旧段落索引。如果客户只是把条款内容轻改（文档结构大致相同），原风险还能显示；一旦客户重排条款顺序，锚点悄悄错位且用户无感。
- **建议**：`step 2` 解析完新文本后、`step 3` 之前，检查 `currentVersion.snapshotData.clauses` 是否缺失；缺失时用 `segmentClauses(currentVersion.snapshotData.docxText)` 回填 snapshotData（可以 upsert 回同一 version 的 snapshotData）后再进入 diff。

#### C3 · 全局复核新建风险硬编码 `anchorParagraphIndex: 0`，会让所有 global_review 风险在 M5 导出时挤压到合同首段
- **证据**：`uploadClientVersion.service.ts:505-506`——`anchorQuote: (r.problem ?? '').slice(0, 50)`、`anchorParagraphIndex: 0`。
- **Spec**：§9.2 的 global review risk 只要求 `source='global_review'` + 五段式，未规定锚点；但 M5 `rebuildDocxService` 会把所有 global_review annotation 按 anchorParagraphIndex 塞进 document.xml 的第 0 个非空段落；多条一起导出时首段会挂 N 条批注，既不符合用户语义，也与"外部批注顶置琥珀色"等视觉规划互相覆盖。
- **影响**：首段被批注刷屏；律师看到批注区卡片时 locate 跳到合同开头；Word 内首段的 commentRangeStart 叠加 N 次，极端情况会撞到 `assertCommentIntegrity` 的限界（commentInjector 不校验"同段上限"，但视觉可读性已经崩坏）。
- **建议**：global_review 专门建模一条"文档级风险"渲染入口（不挂特定段落；导出时可选：独立章节末尾 / 跳过不注入 Word 批注）；或把 `anchorParagraphIndex` 设成 null 并在 rebuild 的 exportable 过滤里单独处理。

#### C4 · `newIndependent` 用 `paraIdx < newClauses.length` 做越界校验，两者不是同一索引空间
- **证据**：`uploadClientVersion.service.ts:586-592`——`paraIdx = c.anchorParagraphIndex`（来自 `wordCommentParser`，**非空段落序号**）；`newClauses` 是 `segmentClauses` 切出来的**条款序号**（通过正则"第 X 条"聚合，一个条款可能对应多段落，或整篇仅 1 个条款）。
- **影响**：
  1. 客户批注挂在非 "第 X 条" 开头的段落（常见于附录、签名段）时 paraIdx=10，但 newClauses.length=5（条款数），`paraIdx < newClauses.length` 为 false，锚点回退到 0，`anchorQuote = newClauses[0].text`——批注显示位置与客户实际意图完全错位；
  2. 即便 paraIdx < newClauses.length 通过，`anchorQuote = newClauses[paraIdx].text` 也不是段落 paraIdx 的文本，而是第 paraIdx 个**条款**的全文，跳转到的内容完全错。
  3. 下游 rebuildDocx 写回 docx 时用 anchorParagraphIndex 作为"非空段落序号"（commentInjector 的语义），M4 存量风险又用它作 clauseIndex——本来就有歧义，Phase B 又把两个空间混为一谈。
- **建议**：统一语义。`contractRisks.anchorParagraphIndex` 在整个项目里要么是"条款 index"要么是"非空段落 index"，二选一落成注释并重构。短期修复：把 `newIndependent` 的 anchorParagraphIndex 直接透传 comment 的非空段落序号；`anchorQuote` 改为该段落的全文（需要从 paragraphs 数组查，而不是 newClauses），避免把条款全文当作锚点。

### High

#### H1 · Step 4 AI 增量审查 + 全局复核的新建在事务之外，与 Step 5+6 事务失败时出现部分提交
- **证据**：`uploadClientVersion.service.ts:383-531` 的风险/批注 `create/update` 直接用 `prisma.*`（非 tx）；`534-668` 的 `$transaction` 只包裹了 removed/reply/editedSystemReplies/newIndependent/锚点迁移。
- **影响**：若 merge 阶段事务回滚，4a/4b 已经落地的新 AI 风险 + external_new 风险保留，但不会产生 `client_return` 版本快照。客户下次刷新工作区看到**凭空多出的风险条目**，却没有对应的新版本出处，无法追溯。
- **建议**：把整个 Step 4-6 包在一个 `$transaction`（或 Step 4 写入在 tx 内 deferred 执行，全部成功后再一次性 commit）；或在 Step 6 失败分支里补一个回滚 Step 4 新建行的逻辑。

#### H2 · Step 4a "已存在风险" 检测用 `.find` + `oldIndex`，多风险同条款时只更新首条、其余重复新建
- **证据**：`uploadClientVersion.service.ts:407-447`——`existingRisk = dbRisks.find(r => r.source === 'ai' && r.anchorParagraphIndex === m.oldIndex && r.archivedStatus === null)`。
- **影响**：
  1. 同一条款历史上分析出两条 AI 风险（合同审查很常见，如"违约金过高"+"管辖条款不利"），Phase B 只覆盖第一条的 level/suggestion，第二条原地保留；
  2. 新增的 AI 风险还会被完整 `create` 一条（命中不到时走新建分支），导致同条款 risk 数量膨胀；
  3. 命中时只更新 level/suggestion，不更新 problem/analysis/legalBasis——客户改了条款后律师看到的风险描述仍是旧文本，**产品体验上"AI 已重审"的徽章变成误导**。
- **建议**：
  - 要么按 "同条款清掉所有未处置 AI 风险 → 重新插入" 语义；
  - 要么用 `category + code` 之类的复合键做 match，保留处置状态但覆盖全量文本；
  - 同时 existingRisk 的 anchorParagraphIndex 要迁移到 `m.newIndex`，否则 Step 5 还会再处理一次这条。

#### H3 · 没有"恢复推送"接口/服务，spec §6.3 / §12.6 的铁律未闭环
- **证据**：全仓搜索 `suppressInExport` / `removedByClient` / `restore` 无对应 PATCH 端点或 service 方法；前端 `useContractReviewVersion.ts` 也无 `restoreRemovedAnnotation` 类方法。
- **Spec**：§6.3 "恢复推送按钮点后仅将 `suppressInExport=false`"；§12.6 详述确认对话框 + destructive 按钮文案。§附录决策 11 列明此行为。
- **影响**：一旦某条 AI 批注被客户删除，律师再也无法让它回到下一次导出——与"批注永不丢失"的核心承诺正面冲突。
- **建议**：补 `PATCH /api/v1/assistant/contract/reviews/annotations/:id/restore`（或复用现有 PATCH 加新字段），同时把 "client_return" 之后再次出现同 wordCommentRef 时自动把 `suppressInExport=false` 也纳入考虑（客户"反悔"场景）。

#### H4 · `fallbackFail`（系统 ref 指向已删除 annotation）被静默丢弃，没有转入 newIndependent
- **证据**：`uploadClientVersion.service.ts:207-218`——命中 refFromMap 但 `!annById.has(refFromMap.annotationId)` 只 `logger.warn` 后 `continue`，既不落 removedByClient，也不作为 external_new 新建。
- **影响**：客户给某条已被律师硬删的 AI 批注做了回复/补充，这段内容**完全消失**——客户以为律师收到，律师侧看不到。同时此分支下 `commentByAnnId.size` 不受影响，但数据损失悄无声息。
- **建议**：命中 fallback 失败时把该 comment 推入 `newIndependent` + logger.warn；或新建 external_new 风险并明确把 problem 前缀加"（失联批注的客户补充）"之类提示。

#### H5 · `commentByAnnId = 0` 保护判断只检查 "有任何旧批注 + 有任何新批注" 两个条件，误杀 / 漏报都存在
- **证据**：`uploadClientVersion.service.ts:271-293`——`if (commentByAnnId.size === 0 && dbAnnotations.length > 0 && newComments.length > 0)`。
- **漏报**：dbAnnotations 里仅有 external 批注（`authorType='external'`，不写 wordCommentRef）、无 AI/lawyer 批注，客户回传 docx 删掉一条 external 独立评论、重新加一条独立评论 —— `commentByAnnId` 为空因为没有系统批注需要匹配，但我们仍进入"全删+全新增"流程，可能误报 NO_ANNOTATION_MATCH。
- **误杀**：`commentByAnnId` 至少 1 条匹配就绕过保护；但如果 DB 有 10 条 AI 批注，客户误上传另一份合同（跨 review）导致 9 条走 crossReviewRejected、1 条恰好同 id 同 rand 命中（极小概率），保护不触发但结果是灾难性的。
- **建议**：
  1. 把保护条件收紧为："**存在 wordCommentRef 非空的 dbAnnotation**（即 AI/律师系统批注）且 commentByAnnId.size / 系统批注数 < 阈值（如 20%）"；
  2. 对 crossReviewRejected > 0 的情况直接阻断（目前已在 crossReviewRejected > 0 时换 message，但没直接触发"拒绝"——已经在 commentByAnnId=0 里拒，漏在部分命中+部分跨 review 的复合场景）。

#### H6 · upload 链路未传 `segmentClauses` 的 `llmFallback`，正则命中不足时 `newClauses` 退化为单段
- **证据**：`uploadClientVersion.service.ts:140`——`const { segments, normalizedText } = await segmentClauses(paragraphs.join('\n'))`，options 为空。`segmentClauses` 默认 `minRegexHits=3`，正则命中 < 3 且无 fallback 时直接返回（可能产出 1 段）。
- **影响**：客户把合同 reformat 导致"第 X 条"标号丢失、或合同本就使用非标编号（比如"条款 1:"、Appendix A），`newClauses` 将只有 1 个 segment，整个 diff 基本无意义，增量审查对象是整篇合同文本。同样 parser 的 `oldClauses`（来自存量 snapshot）若也是正则产物，两边对比时 1v1 比对——效果接近"什么都没 diff 到"。
- **建议**：在 uploadClientVersionService 里注入合同审查 workflow 节点的 `llmFallback`（M4 本身有这个能力），保持正则/LLM 两级降级一致。

#### H7 · customXml part 路径 `/word/customXml/annotationRefs.xml` 非标准，Word "检查文档 → 删除文档属性和个人信息" 有概率清掉
- **证据**：`commentInjector.ts:47-49, 492-515`；OOXML 规范的 customXml part 一般落在 `/customXml/itemN.xml`（包根级别），`/word/` 子目录里存放 main document part 的附属件。本 repo 把自定义 customXml 放到 `word/customXml/annotationRefs.xml`，虽然能被 parser 读回（因为手动注册了 Content_Types + rels），Word 的"删除个人信息"可能判断它不是 data bindings 类 customXml 而直接移除。
- **影响**：三重身份证的第一防线失效，只剩 `w:author` 尾标。而 `w:author` 本身在"删除个人信息"场景会被洗成空串，这时第二防线也废——身份证链路完全 NO_ANNOTATION_MATCH。
- **证据（正向）**：测试 `wordCommentParser.test.ts:326` 覆盖"无 customXml + author 匿名化"场景，期望 annotationRefsByWId=0 走 NO_ANNOTATION_MATCH。行为上是兜底安全的；但生产会在**客户正常审阅**（未做任何恶意操作）后意外触发"上传 docx 中的批注与系统中任何一条都对不上"的红线错误，律师不知所措。
- **建议**：
  1. 把 customXml 真正放到 `/customXml/item1.xml` + `/customXml/itemProps1.xml`（itemProps 是 Office 期望看到的协议签名）；或
  2. 直接把身份证塞进 `docx` 的 `core.xml`（dcterms 扩展）、`app.xml` 或自定义 `docProps/custom.xml`——Office 更严格地保留这些；
  3. 现状方案至少补一个**埋点统计**：线上观察 customXml 幸存率，不幸存时在 UI 横幅提示律师"客户的 Word 版本可能清除了系统标识"。

#### H8 · 前端 `uploadNewVersion` SSE 消费无 `AbortController` / 无超时，dialog 关闭后流继续跑
- **证据**：`app/composables/useContractReviewVersion.ts:263-330` — `fetch()` 未传 signal；只监听 reader 的 streamDone；没有机制中断。
- **影响**：律师关闭 dialog 后网络请求仍在消耗流量；service 在后端一直跑到完成才释放锁（因原子锁 finally 会释放）。浏览器 tab 关闭时 fetch 被 abort，服务端发现连接断开后能否正常结束生成器未验证。
- **建议**：用 `AbortController`；`dialog close` 时 `abort()`。服务端 handler 监听 `event.req.aborted` / eventStream close 事件，尽早 break 生成器。

### Medium

#### M1 · 原子锁释放只设 `completed` / `failed`，忽略了 review 启动前可能的 `not_started` / `draft` 状态
- **证据**：`uploadClientVersion.service.ts:698-711`。
- **影响**：`loadOwnedReview` 允许 review 在非 busy 状态进入，包括 `awaiting_stance` / `not_started`（HTTP 层的 BUSY 过滤是 `['pending','reviewing','awaiting_stance','rebuilding']`）。但服务里 atomic claim 只屏蔽 busy。如果 review 原来是 `not_started`（极端情况下用户未 confirm stance 直接 upload），service 改为 `completed` 后语义错——实际没完成 M1-M4 流程。
- **建议**：finally 里只在进入前是"可控态"（e.g. originalStatus 在 {completed, failed}）时回写；保留原状态缓存值，回写成 `原状态 || completed`。

#### M2 · `syncReviewRisksJsonb` 序列化硬填 `risk: r.problem`、`analysis: r.analysis ?? ''`，丢字段且不幂等
- **证据**：`uploadClientVersion.service.ts:731-744`。
- **影响**：
  - Phase A Risk schema 的 `risk` 字段本来是"法律风险描述"，Phase B 后的 upload 把它等同于 `problem`，再下次 PDF 导出时 `risk` 和 `problem` 一模一样，卡片里重复显示；
  - `clauseText: r.anchorQuote ?? ''` 把"锚点片段"当作"条款文本"，也是漂移；
  - 只有 upload 触发同步；律师手动编辑（M6 PATCH annotation/risk）时 risks JSONB 不更新，下次律师不 upload 就 PDF 导出看到过时数据。
- **建议**：把 `syncReviewRisksJsonb` 抽为公共函数，在所有 mutating 入口（patch risk / patch annotation / archive / newIndependent 外的任何写）后触发；保留 Phase A schema 字段语义。

#### M3 · `assertCommentIntegrity` 只检查数量，同段落多 comment 顺序/嵌套错乱不报警
- **证据**：`commentInjector.ts:454-481`。
- **影响**：目前依赖 `injectMarkersIntoParagraph` 的纯一次性插入保持正确，尚未发现回归；但一旦后续谁在 `injectMarkersIntoParagraph` 加分支（e.g. w:parentId 的段落特殊处理），数量仍对、嵌套顺序错的 bug 无法被 assertion 捕捉。
- **建议**：扩展校验——`commentRangeStart` / `commentRangeEnd` / `commentReference` 按 wId 成对出现、每个 wId 在 document.xml 出现且仅出现 1 次、wId set 与 comments.xml 的 w:comment@w:id set 完全对等。

#### M4 · `globalReview` 用 greedy `/\[[\s\S]*\]/` 抓 JSON，LLM 输出包含方括号字符时整段被吃成坏 JSON
- **证据**：`uploadClientVersion.service.ts:481-482`。
- **影响**：LLM 解释文本中出现 `[示例]` / `[1]` 这类常见中文文案，greedy 捕获到最外层 `]`，中间夹杂不合法字符 → `JSON.parse` 抛错 → 全局复核静默失败，律师只看到横幅"全局复核未能完成"（现在甚至没写这个横幅）。
- **建议**：复用 `utils/llmJson.ts` 的 `extractFirstJsonObject` 思路，实现 `extractFirstJsonArray`（同样的平衡括号扫描，对 `[ ]` 做 depth 计数 + 字符串转义），避免 greedy 正则。

#### M5 · `detectUnsavedEdits` 用 `annotation.updatedAt` 但上游 DAO 对 annotation 的 delete 走软删（setting deletedAt），不会更新 updatedAt，遗漏"只有软删"的编辑场景
- **证据**：`uploadClientVersion.service.ts:764-794` + `contractAnnotation.dao.ts` 软删实现通常 `update({ data: { deletedAt: new Date() } })`——Prisma 默认会刷 updatedAt，所以此偏差实际不成立；但代码注释"annotation 不过滤 deletedAt"暗示依赖"软删会刷 updatedAt"却没强 assert。
- **影响**：未来 dao 若改成"仅设 deletedAt 且 `updatedAt: undefined`"，auto_backup 静默失效。
- **建议**：`detectUnsavedEdits` 显式 `SELECT MAX(GREATEST(updatedAt, createdAt, deletedAt))`，或在注释里锁死"软删必须刷 updatedAt"契约。

#### M6 · external_new 创建时 `problem = c.content.slice(0, 100)` 100 字截断，丢失长评论
- **证据**：`uploadClientVersion.service.ts:599-601`。
- **影响**：客户写 300 字的详尽反馈，problem 字段仅保留前 100 字，虽然 ContractAnnotation 完整保存，但 PDF 导出用的是 `contractReviews.risks` JSONB（经 `syncReviewRisksJsonb` 截断后的 problem）。
- **建议**：要么不截断（problem 是 Text 字段）、要么截断时加 `...` 表示省略。

#### M7 · SSE error 事件 data 结构未用常量/类型约束，前后端字符串漂移风险
- **证据**：`uploadClientVersion.service.ts:117, 158, 286-291, 696`——`step: 'backup' | 'parse' | 'diff' | 'ai' | 'merge'` 字符串手写；`#shared/types/contract.ts` 的 `UploadVersionStep` 类型已定义，但 service 没用 `as const` 或类型断言保证不漂。
- **影响**：typo 后前端 `steps.value.map(s => s.key === p.step ...)` 匹配失败，UI 卡在 idle。
- **建议**：用 `satisfies UploadVersionStep` 断言，或从 `#shared/types/contract` 导入 step 常量对象（类似 `CONTRACT_UPLOAD_VERSION_SSE_EVENT`）。

#### M8 · wordCommentParser 无 customXml 时静默 fallback，没在日志里区分"customXml 存在但解析失败"与"customXml 不存在"
- **证据**：`wordCommentParser.ts:155-181`——`try { ... } catch { /* 文件损坏，走 fallback */ }`，catch 块为空。
- **影响**：客户的 customXml 被某个 CAT 工具破坏（如某些合同翻译插件重写 OOXML），线上无从得知为何突然大规模走 author fallback（甚至 NO_ANNOTATION_MATCH）。
- **建议**：`catch (err) { logger.warn('customXml 损坏，走 fallback', { err }) }`。

#### M9 · `ContractUploadNewVersionDialog` 拖入非 .docx 只 warning toast，但 `handleFileChange` accept=.docx 可绕过（浏览器 accept 提示非强校验）
- **证据**：Dialog `processFile` 只看 `name.toLowerCase().endsWith('.docx')`，不校验 MIME；upload 端虽然也有校验（`isValidDocxBuffer`），但前端把非法文件上传到 OSS 浪费配额。
- **影响**：恶意用户把 .exe 改名 .docx 上传 OSS 后被服务端拒绝，OSS 已留下垃圾文件。
- **建议**：前端同时校验 `file.type === DOCX_MIME`（或起码 `application/vnd.openxmlformats-...`），拒绝 size=0 文件。

#### M10 · `generateSignedUrlService` mock 在 test 里仅返回 undefined，但测试里未覆盖 generate signed url 的失败分支
- **证据**：`tests/server/assistant/contract/uploadClientVersion.service.test.ts:27-31`。
- **影响**：无；测试充实度不足，留为改进项。

#### M11 · PartDetector 在 uploadClientVersion 未被调用，客户把 "甲方/乙方" 改成 "Party A/B" 后，review.partyA 仍为旧值，analyzeSingleClause 的 stance/partyA/partyB context 漂移
- **证据**：`uploadClientVersion.service.ts:397-404` 直接用 `review.partyA / review.partyB` 参与 AI 增量审查，没有在新 docx 上重新探测。
- **影响**：客户改名主要参与方（重命名乙方公司、追加签署方），AI 复审的基线信息错位。Phase B spec §9.1 强调 "stance/partyA/partyB/contractType/playbookSnapshot 都从 contractReviews 表直接读"——语义上不算 bug，但产品侧可能误解。
- **建议**：如确定 Phase B 不重新探测当事人，补单元测试锁死此行为；否则加探测。

### Low

#### L1 · `injectAnnotations` 的 `refsByAnnotationId` 越界 annotation 也登记，导致 DB 回写一个从未在 docx 出现的 ref
- **证据**：`commentInjector.ts:377-379, 428-431`——即使 `validAnnotations=0`（全部越界），refsByAnnotationId 仍含全部生成值。
- **影响**：下一次 rebuild 时这个 ref 会被沿用，但 document.xml 从没挂载过，客户本就看不到；幂等性问题很轻。
- **建议**：要么越界的 annotation 根本不生成 ref（保持 null），要么至少在日志里提示 ref 已分配但未写入 document.xml。

#### L2 · `ensureDocumentRelsRegistered` 的 rIdComments / rIdLexseekRefs 硬编码 Id，与已有 rels 冲突时未降级
- **证据**：`commentInjector.ts:649-654, 660-664`。
- **影响**：极端情况下 original docx 如果恰好已有 Id="rIdComments" 的 rel，Relationships 段里会出现同名 Id 冲突（Word 会报警）。项目 originalFileId 都是用户上传的素材，重名概率极低，但并非零。
- **建议**：生成 Id 时扫 existing rels 的 Id 集合，冲突时 `rIdComments-<rand4>`。

#### L3 · `anchorMigrate` 的 sliding window 时间复杂度 O(n * window * anchorLen)，对长条款极慢
- **证据**：`anchorMigrate.ts:48-58`——对每个长度取全量起点。条款 2000 字 + 锚点 80 字时约 40*2000=80000 次 Levenshtein，dmp 单次 O(n*m) 大致 160000 次操作，合计 ~10^10（极端情况）。
- **影响**：单个合同 anchor 迁移 1-5s 出现在热路径；Phase B spec §8.4 预估"单条风险 < 20ms、一份合同 < 1s"不一定成立。
- **建议**：加粗粒度 prefilter（rolling-hash 相似度 top-K 后再 Levenshtein），或限制 windowLen 步长为 4-8 字。

#### L4 · `escapeXml` 过滤非法控制字符后 batch 不通知调用方，静默截改客户文本
- **证据**：`xmlUtils.ts:38-47`——直接 replace。
- **影响**：客户粘贴带 BOM / control char 的内容，content 里该字符被吃掉，律师看到的少若干字符且无告警。
- **建议**：过滤时 logger.debug 记录一次数量统计。

#### L5 · `commentInjector.injectComments`（旧版）依然导出且被 integration.test 使用，可能误导新代码复用
- **证据**：`docx/index.ts:5`、`tests/server/assistant/contract/docx/integration.test.ts` 多处。
- **影响**：新接入方查看 `injectComments` 看不到 Phase C+ 身份证写入，复制到新流程会生成不可追溯的 docx。
- **建议**：给 `injectComments` 加 `@deprecated` JSDoc（已有注释但未用 `@deprecated` tag 让 IDE 划删除线提示）；测试换用 `injectAnnotations` 或标记 legacy 用途。

#### L6 · `clauseSegmenter` 的 `normalizedText` 与 parse 出的 paragraphs 不完全同源，给 `oldClauses / oldDocxText` 语义留下暗坑
- **证据**：`clauseSegmenter.ts:87-90` `normalizedText` 源于 `paragraphs.join('\n')`（非空段落拼接）；但 parser.ts 的 paragraphs 已经 `trim` 每行+过滤空行。所以 `normalizedText` 的 offset 空间**不等于**原始 docx 的字符 offset。
- **影响**：下游 anchorMigrate 做 `newClauses[i].text.slice(charStart, charEnd)` 是安全的（它在 normalizedText 自己的空间里切），但 syncReviewRisksJsonb 和 PDF 导出如果要高亮回原始 docx 会失准。
- **建议**：至少 snapshotData 里同时存 `normalizedText` 和 `rawFullText`（或加一个 `offsetsInRaw` 映射），避免后续使用者踩坑。

#### L7 · `parseContractDocx` 调用 `mammoth.extractRawText` 忽略嵌入表格，表格条款永远不进 paragraphs
- **证据**：`parser.ts:16-27`。
- **影响**：含表格的合同（如价格明细、履约时间表）在 paragraphs 里看不到，Phase B 条款 diff 永远看不到表格变化。这是 Phase A 既有限制，Phase B 继承。
- **建议**：作为已知局限记入 `docs/tech-docs/guides/pitfalls.md`；Phase C 考虑走 `mammoth.convertToHtml` / 自定义 XML 解析提取表格。

#### L8 · 测试覆盖补强建议
- `integration.test.ts` 只跑 5 个样本 + `injectComments`（旧），**没有 injectAnnotations 端到端 + parseWordComments 回环测试**（注入后解析→对齐 annotationId）——虽然 `commentInjector.annotations.test.ts` 和 `wordCommentParser.test.ts` 各自有覆盖，但缺少"注入→Word 模拟修改→解析"的串行闭环用例。
- 空 docx / 纯图片 docx / 无 body 段落 docx 未覆盖。
- 同一 annotation 的 wordCommentRef 被两条不同 docx 的 customXml 声明为不同 annotation（"customXml 中毒"）未测试。
- `uploadClientVersionService` 的"client 回传 5/50/500 条 comment"性能基准未测。

---

## 附：若干未被采纳但值得留意的设计选项

1. **customXml vs docProps/custom.xml**：后者是 OOXML 官方"用户自定义属性"区，保留率更高、可被 COM 脚本直接读。Phase C 可考虑迁移。
2. **身份证里带 reviewId 的隐私权衡**：spec §15 已记，属于 Phase C 优化。Phase B 接受暴露数字 id。
3. **`diff_match_patch` 重复实例化**：`clauseDiff.ts:16` 的 `calcSimilarity` 每次调用 `new diff_match_patch()`；`anchorMigrate.ts` 用模块级单例。两边行为一致，但 diff_match_patch 内部有状态变量（`Diff_Timeout` 等），模块级单例在并发请求时若被 monkey-patch 会串味。建议统一成"每次函数内部 new"。

---

**偏差条数统计**：Critical 4、High 8、Medium 11、Low 8，合计 **31 条**。
