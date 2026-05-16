# 合同审查 · 修订版回传识别 + 自定义署名 · 设计文档

> 日期：2026-05-16
> 范围：合同审查的导出端（修订版 docx 生成）与上传端（客户回传 docx 处理）
> 关联：本设计延续 `2026-05-02-contract-review-precise-anchoring-and-track-changes-design.md`（修订模式导出）与 `2026-04-22-contract-review-versioning-phase-b-design.md`（客户回传 6 步链路）

---

## 1. 背景

### 1.1 现状与问题

合同审查支持把 AI 审查结果导出成三种 docx 给客户：

| 模式 | 呈现 | OOXML |
|---|---|---|
| 批注模式 | AI 风险做成 Word 批注气泡 | `<w:comment>` + `<w:commentRangeStart/End>` |
| 修订模式 | AI 改写做成 Word 修订标记 | `<w:ins>` / `<w:del>` |
| 双模式 | 批注 + 修订并存 | 上面两套 |

客户下载、在 Word 里处理后回传，系统通过「上传新版本」识别客户对每条建议做了什么。

**问题**：批注模式能正常回传——批注在 docx 里带「身份证」（`word/customXml/annotationRefs.xml` 登记每条批注属于哪个审查、哪条记录），回传时按身份证匹配。但**修订标记不带身份证**：

- `<w:ins>/<w:del>` 只有一个 Word 本地 `w:id`，`w:author` 是写死的常量字符串，没有任何信息把它关联回 `reviewId` / `riskId`。
- 回传链路（`uploadClientVersion.service.ts`）只解析批注、只按批注身份证匹配，完全看不见修订标记。

后果：客户下载**修订版**、在 Word 里接受/拒绝修订后回传 → 系统只能匹配到极少数「降级成批注」的风险（修订模式下无锚点/无改写建议的风险会 fallback 成批注）。实测一份 23 条风险的合同，17 条是修订标记、4 条是 fallback 批注，命中率 17%，低于 20% 安全线 → 触发 `uploadClientVersion` 的「防误删保护」中止，报错「上传 docx 中的批注与系统中任何一条都对不上」。

报错的第 3 条原因「当前 docx 是改造前的老导出」是误导——真实原因是「模式不对，系统不认识修订标记」。

### 1.2 顺带需求：自定义署名

当前 AI 产生的修订标记作者名是写死的 `LexSeek AI`，AI 批注作者名是 `LS:AI`。律师把 AI 审查结果作为自己的工作成果交付给客户时，这两处会暴露用了 AI 工具。需要让律师能设置自己的署名，导出时 AI 修订/批注统一显示成该署名。

### 1.3 关键事实依据

- **customXml 经 Word 编辑后保留**：现有批注身份证机制（`annotationRefs.xml`）已在生产运行，项目代码记录的事实是「Word / WPS 保存时不篡改 customXml」。给修订标记加同样的 customXml 身份证，这条路已被验证可行。**边界**：LibreOffice、或 Word 的「检查文档 → 删除个人信息」等操作可能整体清除 customXml part，此时修订身份证连同批注身份证一起丢失、回传识别归零——靠 §9 安全保护拦截并提示客户重新下载，不静默放行。
- **Word 接受/拒绝修订的 XML 变化由 OOXML（ECMA-376）明确定义**：接受 `<w:ins>` = 保留文字、去标签；拒绝 `<w:ins>` = 文字连标签一起删；接受 `<w:del>` = 文字连标签一起删；拒绝 `<w:del>` = 文字恢复（`<w:delText>`→`<w:t>`）、去标签。识别算法据此设计，并配「正文比对」兜底层，使其不依赖 Word 的 `w:id` 是否稳定。

---

## 2. 定位与边界

### 2.1 范围（做的事）

1. **自定义署名**：用户设置页新增「合同导出署名」字段；导出修订/批注/双模式时，AI 修订标记与 AI 批注的作者名用该署名（未设置则用账号姓名兜底）。
2. **修订标记身份证**：导出修订/双模式时，新增 customXml 文件 `word/customXml/redlineRefs.xml`，登记每条修订属于哪个审查、哪条风险。
3. **回传识别**：上传链路新增修订解析步骤，用「`w:id` 精确层 + 正文比对兜底层」双层算法，判定每条修订被客户**接受 / 拒绝 / 未处理 / 需确认**。
4. **处置落库**：风险表新增独立的「客户修订处置」维度；客户接受的修订自动把风险标记为已解决。
5. **安全保护升级**：「防误删」从「只数批注命中率」改为「批注 + 修订统一覆盖率」，并对跨审查 docx 串扰单独拦截。
6. **报错文案修正**：去掉误导的「老导出」提示。
7. **前端呈现**：回传完成横幅显示修订处置统计；风险列表每条加客户处置徽章。

### 2.2 不做的事（留作后续）

- PDF 导出的署名（PDF 无 Word 修订/批注结构，本次不动）。
- 修订作者多元（每条修订显示不同律师）——本次所有 AI 修订统一一个署名。
- 「一键接受所有 AI 修订」按钮。
- 「客户接受的修订对应条款跳过 AI 增量重审」的性能优化——保持现有 Step 4 行为不变，修订识别是叠加逻辑。
- 客户在修订之外自己手动改的正文，仍由现有 `diffClauses` + AI 增量审查兜底，不属本次新增。
- 重构现有 1000+ 行的 `uploadClientVersion.service.ts`（既有技术债，超出本次范围）——本次新增逻辑尽量落在新文件，见 §6.3。

### 2.3 用户语言

对产品/业务方沟通时：

- 「修订版回传」= 客户在 Word 里接受/拒绝 AI 改写建议后，把文件传回系统。
- 「客户修订处置」= 客户对每条 AI 改写的态度：采纳了 / 拒绝了 / 还没看 / 判不准。
- 「署名」= 交付给客户的文件上，AI 部分显示成谁的名字。
- 避免对业务方用 `<w:ins>` / `customXml` / `w:id` 等词。

---

## 3. 数据模型变更

一次 `prisma migrate dev`，新增 2 列，均可空、向后兼容。

### 3.1 `users` 表（加 1 字段）

```prisma
model users {
  // ...现有字段
  /// 合同审查导出署名：导出修订/批注 docx 时 AI 修订与 AI 批注的作者名。
  /// 为空时导出端回退到 users.name。
  contractExportSignature String? @map("contract_export_signature") @db.VarChar(50)
}
```

### 3.2 `contractRisks` 表（加 1 字段）

```prisma
model contractRisks {
  // ...现有字段
  /// 客户对该风险所对应 AI 修订的处置（与律师的 archivedStatus 是独立维度）：
  /// accepted（采纳改写）/ rejected（保留原文）/ untouched（未处理）/ ambiguous（无法自动判定）。
  /// null = 该风险未以修订形式导出过 / 不适用。
  clientRedlineDecision String? @map("client_redline_decision") @db.VarChar(12)
}
```

> `clientRedlineDecision` 与现有处置状态 `archivedStatus`（handled / ignored / client_removed）是**两个维度**：前者记录客户态度，后者记录律师/系统处置。互不覆盖。

### 3.3 类型同步

- `shared/types/user.ts` — `UserInfo`（及 `SafeUserInfo`）加 `contractExportSignature?: string | null`。
- `shared/types/contract.ts` —
  - 新增 `ClientRedlineDecision` —— 按 `.claude/rules/types.md` 字符串枚举规范，用 TS `enum`（`ACCEPTED='accepted'` / `REJECTED='rejected'` / `UNTOUCHED='untouched'` / `AMBIGUOUS='ambiguous'`）+ `ClientRedlineDecisionText: Record<ClientRedlineDecision, string>` 中文标签映射。
  - `ContractRiskEntity` 加 `clientRedlineDecision: ClientRedlineDecision | null`。

---

## 4. 自定义署名

### 4.1 存储与默认值

- 存 `users.contractExportSignature`，可空。
- 导出端取值：`signature = (user.contractExportSignature ?? '').trim() || user.name`。即未设置或设置为空白时，回退到账号姓名。

### 4.2 设置入口

- **页面**：`app/pages/dashboard/settings/profile.vue`「个人资料」表单加一个「合同导出署名」输入框，配说明文案（如「导出合同审查 docx 时，AI 修订与批注以此署名显示；留空则使用姓名」）。
- **API**：复用 `PUT /api/v1/users/profile`。改动点：handler 的 zod schema 加 `contractExportSignature: z.string().max(50).optional()` 并解构透传；`formatUserResponseService` 与 `SafeUserInfo` 类型加该字段，使 `GET /api/v1/users/me` 返回它。`updateUserProfileDao` 入参已是泛型 `Prisma.usersUpdateInput` 透传，**无需改动**。
- **store**：`app/store/user.ts` 的 `updateUserProfile` 透传新字段。

### 4.3 导出端应用

涉及两个导出编排函数：`rebuildDocxService`（工作区导出）、`downloadContractReviewVersionService`（历史版本导出）。两者都已持有 `review`（含 `review.userId`）。

- 新增 service 方法 `resolveContractExportSignatureService(userId): Promise<string>` —— 经 user DAO 读 `users` 的 `name` + `contractExportSignature`，按 §4.1 规则算出署名。落在 users 领域 service 文件（方法以 `Service` 结尾、读库走 DAO，符合 Service-DAO 分层）。
- 导出前调用一次，把 `signature` 透传给注入器。

**`injectRedlineMarks`**：`options` 加 `signature: string`。修订标记 `<w:ins>` / `<w:del>` 的 `w:author` 用 `signature` 取代写死常量 `'LexSeek AI'`。

**`injectAnnotations`**：`InjectAnnotationsOptions` 加 `signature: string`。`buildCommentsXmlFromAnnotations` 按 annotation 的 `authorType` 决定 `w:author` 与头像缩写 `w:initials`：

| authorType | `w:author` | `w:initials` |
|---|---|---|
| `ai` | `signature` | `signature` 前 2 字符 |
| `lawyer` | 律师姓名 | `律` |
| `external` | 客户名 | `客` |

**LS: 前缀清理（已确认）**：现有 `buildAuthorField` 给**所有**批注作者名加 `LS:` 前缀（`LS:AI` / `LS:张三` / `LS:客户名`）。`LS` 即 LexSeek 系统标记，对客户无意义。本次导出时**一律去掉 `LS:` 前缀**——AI 内容用署名、律师批注用律师姓名、客户批注用客户名，整份 docx 作者名干净一致、无工具痕迹。`buildAuthorField` 相应重构为「去前缀 + 按 `authorType` 取署名/姓名」。

> 去 `LS:` 前缀不影响回传识别：回传匹配以 customXml 身份证为主防线，不依赖 `w:author`；`stripAuthorRef`/`stripLeadingLsPrefix` 对作者名是否带 `LS:` 均能正确处理。

---

## 5. 修订标记身份证（`redlineRefs.xml`）

### 5.1 customXml 结构

新增 customXml 文件 `word/customXml/redlineRefs.xml`，与批注身份证 `annotationRefs.xml` 平级、互不干扰：

```xml
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<lexseekRedlineRefs xmlns="urn:lexseek:contract-review-redline:v1" reviewId="871">
  <ref riskId="42" delIds="5" insId="6" paraIdxs="12"/>
  <ref riskId="43" delIds="8,10" insId="11" paraIdxs="20,21"/>
</lexseekRedlineRefs>
```

| 位置 / 属性 | 含义 |
|---|---|
| 根元素 `reviewId` | 归属审查 id，回传时用于拒绝跨审查 docx 串扰。同一文件内全部修订归属同一审查，故提到根元素、不在每个 `<ref>` 重复 |
| `<ref>` `riskId` | `contractRisks.id` |
| `<ref>` `delIds` | 该风险所有 `<w:del>` 节点的 `w:id`（跨段风险有多个，逗号分隔） |
| `<ref>` `insId` | 该风险 `<w:ins>` 节点的 `w:id`（跨段风险只有结尾段有 ins，单值） |
| `<ref>` `paraIdxs` | 该修订所跨**非空段落序号**（逗号分隔）。回传识别据此把正文比对限定在风险所属段落（§6.2），避免长文档里偶然同名命中。来自 `RedlineWrapTarget.paragraphSpans[].paraIdx` |

> 修订身份证**无 DB 对应物**（不像批注的 `wordCommentRef` 存在 DB）。修订身份是 `(reviewId, riskId)`，del/ins 的 `w:id` 每次导出重新分配，`redlineRefs.xml` 每次导出按当次分配的 id 重新生成，纯导出期产物。因此不需要 `rand` 随机段。

### 5.2 导出端写入

`injectRedlineMarks` 已通过 `InjectRedlineResult.spansByRiskId`（`Map<riskId, RedlineWrapTarget>`，`riskId → paragraphSpans[{paraIdx, delId, insId}]`）公开该映射。导出时用它直接构造并写入 `redlineRefs.xml`：

- 每条 risk 一个 `<ref riskId delIds insId paraIdxs>`：`delIds` = 所有 span 的 `delId`，`insId` = 唯一非 null 的 `insId`，`paraIdxs` = 所有 span 的 `paraIdx`（非空段落序号，逗号分隔）。
- 根元素 `reviewId` 取 `options.reviewId`（已有入参）。

`redline` 与 `both` 模式都写 `redlineRefs.xml`；`comment` 模式不写（无修订标记）。

### 5.3 customXml part 注册

`redlineRefs.xml` 需在 `[Content_Types].xml` 注册 `Override`（ContentType `application/xml`）、在 `word/_rels/document.xml.rels` 注册 `Relationship`（customXml 类型，Target `customXml/redlineRefs.xml`，Id 形如 `rIdLexseekRedlineRefs`）。

现有 `commentInjector.ts` 的 `ensureContentTypesRegistered` / `ensureDocumentRelsRegistered` 把 comments + annotationRefs 的注册写死在一起。本次抽出一个通用 customXml part 注册器（`server/agents/contract/docx/customXmlRegistrar.ts`），按 PartName 幂等注册/注销**单个** customXml part，`redlineRefs` 与 `annotationRefs` 共用；`comments.xml`（非 customXml part）的注册保持现状。注册器只做「单 part 注册/注销」，不做成通用 part 框架。

> 重构注意：`ensureContentTypesRegistered` / `ensureDocumentRelsRegistered` 除被 `injectAnnotations` 调用外，还被 `commentInjector.ts` 里 `@deprecated` 的 `injectComments` 调用。抽取后需保留旧函数签名兼容，或同步改其调用点，避免历史测试断链。
>
> `both` 模式下 redline 先跑、comment 后跑。注册器按明确的 PartName 操作，comment 步骤的注册只动 comments / annotationRefs 条目，不会清掉 redlineRefs 的注册。`injectAnnotations` 空批注分支的 `zip.remove` 也只删 annotationRefs，不碰 redlineRefs。

---

## 6. 回传识别 · 双层算法

### 6.1 新增 `redlineParser.ts`

`server/agents/contract/docx/redlineParser.ts`，与 `wordCommentParser.ts` 平级。职责：

1. 读 `word/customXml/redlineRefs.xml` → 根元素 `reviewId` + `RedlineRefEntry[]`（`{ riskId, delIds: number[], insId: number }`）。文件不存在 → 空。
2. 扫 `word/document.xml`，收集**还存活的** `<w:ins>` 与 `<w:del>` 节点的 `w:id` 两个 Set。
3. 按**非空段落**提供归一化语料 `paragraphs` 数组——每个非空段落一项，含该段 `<w:t>` 文本与 `<w:delText>` 文本（均经 `textSimilarity.ts` 的 `normalizeForMatch` 归一化）。非空段落口径与 `collectNonEmptyParagraphs` 一致；回传识别按 §5.1 的 `paraIdxs` 取对应段落语料做比对（§6.2）。

XML 解析与遍历**复用 `xmlAst.ts` 现成工具**——`findAll`（取 `ref`/`w:ins`/`w:del`/`w:t`/`w:delText` 节点）、`getAttr`（读属性）、`textOf` / `walk`（取文本），不自造遍历。判定逻辑做成**纯函数** `classifyRedlineDecision(...)` 便于单测。

### 6.2 双层判定规则

对每条修订身份证（`riskId` → `delIds` / `insId`），先归属校验，再判处置。

**归属校验**：根元素 `reviewId !==` 当前 `review.id` → 跨审查串扰，不参与处置（见 §9.2）。

记该 risk 的 DB 字段 `problematicQuote` 归一化后为 `old`、`suggestedClauseText` 归一化后为 `new`（归一化用 `normalizeForMatch`）。一条修订即「删除 `old`、插入 `new`」。

**Layer 1 · w:id 精确层（快路径）**：扫回传 docx 里存活的 `<w:ins>` / `<w:del>` 节点 id：

- `delIds` 全部存活 **且** `insId` 存活 → **未处理**。
- 部分存活（一部分在、一部分不在）→ **需确认**（部分处理，非终态）。
- 全部不存活 → 不下结论（可能真已处理，也可能 Word 重排了 w:id），转 Layer 2。

**Layer 2 · 正文比对层（Layer 1 不下结论时判定，不依赖 w:id）**：

1. `old` 命中 `corpusDel` → **未处理**（删除标记仍在，仅 w:id 被重排）。
2. 否则进入接受/拒绝判别。**判别字段按 `old`、`new` 的子串包含关系选择**——合同改写常是在原文上增量修改，`old` 与 `new` 易互为子串，naive「分别判断 old/new 是否命中」会误判（如 `new ⊇ old` 时全接受会因 `old` 仍是 `new` 的子串而误判 ambiguous）：

   | `old` 与 `new` 关系 | 判别规则 |
   |---|---|
   | `new` 含 `old`（在原文上扩写） | `new` 命中 `corpusT` → **接受**；`new` 未命中、`old` 命中 → **拒绝**；两者都未命中 → **需确认** |
   | `old` 含 `new`（在原文上删减） | `old` 命中 `corpusT` → **拒绝**；`old` 未命中、`new` 命中 → **接受**；两者都未命中 → **需确认** |
   | 互不包含（实质重写） | `new` 命中且 `old` 未命中 → **接受**；`old` 命中且 `new` 未命中 → **拒绝**；其余（都命中/都不命中）→ **需确认** |

> 命中判断为 `normalizeForMatch` 归一化后的包含匹配，且 **`corpusT`/`corpusDel` 限定在该风险所属段落**——按 §5.1 `redlineRefs.xml` 记录的 `paraIdxs` 取对应非空段落的 `<w:t>`/`<w:delText>` 语料，避免长文档里偶然同名子串误判。`paraIdxs` 越界（客户结构性增删段落致序号漂移）时回退全文语料。
>
> 能进入 `redlineRefs.xml` 的风险必带非空 `problematicQuote` 与 `suggestedClauseText`（无锚点/无改写的风险导出时已 fallback 成批注），故 `old`/`new` 必非空、且 `old != new`。
>
> **已知低频边界**：客户对同一条修订的「删除」与「插入」做相反操作（拒绝删除 + 接受插入），会产生原文与改写并存的重复正文，情形 A/B 可能将其误判为接受/拒绝。此为罕见异常操作（Word 的接受/拒绝通常对选区整体生效）、且产出肉眼可见的异常正文，不做额外处理。

### 6.3 接入上传链路（`uploadClientVersion.service.ts`）

现有 6 步链路（备份 → 解析 → 识别差异 → AI 增量审查 → 合并写入 → 保存快照）做**叠加式**改动，不改既有批注/diff 逻辑：

- **Step 2 解析**：在 `parseWordComments` 旁，新增 `parseRedlineMarks(docxBuffer)`。
- **Step 3 识别差异**：新增修订识别块——对每条 `RedlineRefEntry` 跑 §6.2 算法，产出 `Map<riskId, ClientRedlineDecision>` + 跨审查串扰列表 + 各类计数。安全保护改造也在此步（见 §9.1）。
- **Step 5 合并写入（事务内）**：把修订处置结果写入 DB（见 §7）。
- **Step 6 / 完成事件**：`summary` 文案追加修订处置统计（见 §10）。
- **Step 4 AI 增量审查**：不改。客户接受修订导致的条款变化，仍按现有逻辑被 `diffClauses` 当作 modified 条款重审；修订识别只是额外标注处置，不干预。

> 文件体积约束：`uploadClientVersion.service.ts` 现已 1000+ 行，远超 `.claude/rules/main.md` 的 500 行拆分线。本次**不重构既有文件**，但新增逻辑必须落在新文件——解析放 `redlineParser.ts`、判定做纯函数，`uploadClientVersion` 内只保留对它们的编排调用，把新增行数压到最低。

---

## 7. 处置落库与效果

每次回传，对本次 docx `redlineRefs.xml` 里出现、且归属校验通过的风险，在 Step 5 事务内写入：

| 判定 | `clientRedlineDecision` | `archivedStatus` |
|---|---|---|
| 接受 | `accepted` | 若当前为 null → 置 `handled` + `archivedAt=now()`（自动解决）；非 null 则不动 |
| 拒绝 | `rejected` | 不动（风险保持打开） |
| 未处理 | `untouched` | 不动 |
| 需确认 | `ambiguous` | 不动 |

要点：

- **接受自动解决**：客户采纳 AI 改写 = 风险条款已实际修正，自动把 `archivedStatus` 置 `handled`。但**不覆盖律师已有的处置**——若律师此前已手动处置过（`archivedStatus` 非 null），保留律师决定；客户处置徽章仍照常显示，信息不丢。
- **两个维度独立**：`clientRedlineDecision` 永远反映客户态度；`archivedStatus` 是律师/系统处置。律师能一眼区分「客户已拍板的」和「还要自己跟进的」。
- **每次回传重算**：`clientRedlineDecision` 每次回传按当次 docx 重新识别、覆盖。不在本次 `redlineRefs.xml` 里的风险不动其值（如已解决前移除、或批注模式导出的风险）。
- 历史轨迹由 `contract_review_versions` 版本快照承担，风险表不存处置时间戳。

---

## 8. 与批注回传并存

`both` 模式一份 docx 同时含修订与批注。回传时：

- **批注识别**与**修订识别**是两条独立解析链：前者读 `annotationRefs.xml` + `comments.xml`，后者读 `redlineRefs.xml` + `document.xml` 修订标记。
- 各写各的字段：批注链写 annotation 的回复/删除/新增（现有逻辑）、修订链写 `clientRedlineDecision`，互不冲突。
- 一条风险在 `both` 模式下可同时有修订身份证和批注身份证——修订链判其「接受/拒绝」，批注链判其批注是否被回复/删除，两者是对同一风险不同侧面的记录，叠加即可。

---

## 9. 安全保护与报错文案

### 9.1 防误删保护升级

现有 `tripsSafety` 只数批注命中率（`commentByAnnId.size / systemDbAnnotations.length < 0.2` 即中止），所以修订版回传必然误杀。改为**统一覆盖率**：

- `identifiableRiskIds` = 本次审查里、其批注带 `wordCommentRef`（customXml 身份证）的风险 id 集合。
- `coveredRiskIds` = （回传 docx 里批注匹配上的风险 id，经 `annById` 由 annotationId 映射）∪（`redlineRefs.xml` 中根 `reviewId` 与本审查一致的风险 id）。
- `coverageRatio = |coveredRiskIds ∩ identifiableRiskIds| / |identifiableRiskIds|`。
- 中止条件：`identifiableRiskIds` 非空 **且** docx 含批注或修订 **且** `coverageRatio < 0.2`。

即：一条系统风险只要「批注匹配上」**或**「在修订身份证里登记过」，就算被本次 docx 覆盖，不计入误删风险。

> 口径校正：现有 `systemDbAnnotations` 过滤器的 `DOCX-H5` 注释声称「忽略 external」，但实际 filter（`wordCommentRef != null`）并未排除 `external` 批注（`external` 批注同样会被 `generateWordCommentRef` 赋值）。实现时以「带 customXml 身份证」为统一口径，并同步修正该过时注释。

### 9.2 跨审查串扰拦截

`redlineRefs.xml` 根 `reviewId` 与当前审查不符 → 与现有 `crossReviewComments` 同等处理：整份修订身份证不参与处置，并在全部内容都跨审查/对不上时，报错指向「上传了别的合同的 docx」。

### 9.3 报错文案修正

`uploadClientVersion` 现有 `NO_ANNOTATION_MATCH` 错误：

- code 改名为 `NO_CONTENT_MATCH`（语义上现在覆盖批注 + 修订；前端只展示 `message`，改 code 无破坏）。
- 文案去掉误导的第 3 条「当前 docx 是改造前的老导出」。新文案：

  > 一般场景：「上传的 docx 没能和本次审查的任何批注或修订对应上，已中止处理以免误改。请确认：1) 上传的是本次审查导出的 docx；2) 客户编辑时未使用会破坏文档标识的工具——如不确定，建议重新从系统下载最新版发给客户。」

  > 跨审查场景：「上传的 docx 属于其他合同审查（文档标识里的审查编号与本次不符），已拒绝处理。请确认上传的是本审查导出的版本。」

---

## 10. 前端呈现

### 10.1 回传完成横幅

`uploadClientVersion` 完成事件的 `summary` 字符串追加修订处置统计（仅当本次有修订识别时），如：

```
本轮变化：3 处外部变更 · 5 处条款修改 · AI 增量重审 5 条 · 客户修订：接受 12 / 拒绝 5 / 未处理 6 / 待确认 1
```

沿用现有 `ContractUploadNewVersionDialog.vue` 完成横幅与 `lastUploadResult` 横幅，无需新组件。`UploadVersionCompleteData` 结构不变（只是 `summary` 内容更丰富）。

### 10.2 风险列表徽章

`RiskListPanel.vue` 每条风险加一个「客户处置」小徽章：

| `clientRedlineDecision` | 徽章文案 | 语义色 |
|---|---|---|
| `accepted` | 客户已采纳 | 绿（与「已解决」同调） |
| `rejected` | 客户已拒绝 | 橙/红 |
| `untouched` | 客户未处理 | 灰 |
| `ambiguous` | 待确认 | 黄 |
| `null` | 不显示徽章 | — |

徽章复用现有风险徽章组件 / `badge` variant，用主题语义色，确保深色模式下对比度正常；图标统一 `lucide-vue-next`，**不用 emoji**（项目铁律）。

数据流：回传完成后前端 `refreshWorkspace()` 重新拉 `GET /reviews/:id`，风险实体带上 `clientRedlineDecision` → 徽章渲染。需确保该接口的 risk 序列化包含新字段。

---

## 11. 测试策略

### 11.1 单元测试

- `redlineParser`：解析 `redlineRefs.xml`（正常 / 缺文件 / 损坏 / 跨段 `delIds` 多值 / 根 `reviewId` 读取）；`classifyRedlineDecision` 纯函数覆盖判定表每一行——未处理 / 接受 / 拒绝 / 需确认 / 部分存活 / w:id 被重排（Layer 1 失效、Layer 2 兜底）/ 跨审查；**重点覆盖「原文与改写互为子串」（`new⊇old` 与 `old⊇new`）两种重叠场景，确保不误判**。
- `injectRedlineMarks`：导出后 `redlineRefs.xml` 内容正确（根 `reviewId`、`riskId`/`delIds`/`insId`）；`w:author` 用署名。
- `injectAnnotations`：AI 批注 `w:author` = 署名、`w:initials` 取署名前 2 字；律师/客户批注作者名去 `LS:` 前缀（显示纯姓名）。
- `customXmlRegistrar`：part 注册/注销幂等；`both` 模式下 redline 与 annotationRefs 注册并存不互相清除；`@deprecated injectComments` 调用不断链。
- 安全保护：新「统一覆盖率」口径——纯修订版回传不再误杀；命中率确实过低时仍中止。
- 报错文案：一般场景与跨审查场景文案正确。
- 署名：`PUT /api/v1/users/profile` 写入与校验；未设置时导出端回退账号姓名。

### 11.2 集成测试

- 修订版 docx 全链路回传：构造一份带 `redlineRefs.xml` 的 docx，模拟「全接受 / 全拒绝 / 接受部分 / 未处理」，断言 `clientRedlineDecision` 与 `archivedStatus` 落库正确。
- `both` 模式回传：修订识别与批注识别并存、互不干扰。

### 11.3 真机 E2E（一次性验证）

导出一份修订版 → 在真实 Word 里分别做接受全部/拒绝全部/接受部分 → 回传，验证 `w:id` 存活情况与 `redlineRefs.xml` 经 Word 接受/拒绝修订 + 保存后的实际表现。若 Word 重排了 `w:id`，正文比对兜底层应仍能正确判定（设计已对此免疫）。

> Windows Word 兼容性沿用前序结论：开发端 macOS 实测，Windows 靠线上回归。

---

## 12. 实施顺序

| 步骤 | 内容 | 依赖 |
|---|---|---|
| 1 | 数据库迁移（2 列）+ `shared/types` 同步 | — |
| 2 | 自定义署名：设置页 + `PUT /users/profile` + 导出端 `resolveContractExportSignatureService` 与应用（含 §4.3 待确认结论） | 1 |
| 3 | 修订身份证导出：抽 `customXmlRegistrar` + `injectRedlineMarks` 写 `redlineRefs.xml` | 1 |
| 4 | 回传识别：`redlineParser` + `classifyRedlineDecision` 纯函数 + `uploadClientVersion` Step 2/3/5 接入 + 处置落库 | 3 |
| 5 | 安全保护升级 + 报错文案修正 | 4 |
| 6 | 前端：风险列表徽章 + 回传横幅统计文案 | 4 |
| 7 | 单元测试 / 集成测试补齐；真机 E2E 抽查 | 2-6 |
| 8 | 同步技术文档：把「修订身份证、双层回传识别、自定义署名」补进 `docs/tech-docs/backend/contract.md` | 2-6 |

步骤 2（署名）相对独立，可与 3-6 并行。步骤 4 依赖 3（要先有 `redlineRefs.xml` 才能解析）。每个模块编码完成先跑该模块单测，全部完成后再做全量测试。
