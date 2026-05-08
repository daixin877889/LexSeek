# 合同审查 · 精准锚点 + Track Changes 模式 · 设计文档

> **定位**：合同审查模块对标市面专业工具（Spellbook / Robin AI / Anthropic Citations / ContractEval）的第一轮升级。修复 playbook 失效线上 bug，把"段落级锚点 + 批注模式"升级为"双锚点 + 批注/修订双模式"。
> **内部代号**：`contract-review-precise-anchoring`（不在用户面前出现）
> **用户视角**：风险卡片能精确到导致风险的具体句子，下载时可选"修订模式"看到 Word 风格的删除线 + 新增。
> **范围**：PRE-1（partyDetector 短路 bug）+ SUB-1（精准锚点 + Track Changes）合并实施。SUB-2~6（关键条款抽取 / 缺失条款检测 / 合同问答 / 执行摘要 2.0 / 谈判 fallback）留作后续路线图独立 spec。

---

## 1. 背景

### 1.1 现状的三个问题

**问题 1：Playbook 在线上从未真正生效（PRE-1）**

`server/agents/contract/docx/partyDetector.ts:49-51` 提前 return：

```ts
if (matchA && matchB) {
    return { partyA: matchA, partyB: matchB, contractType: null, source: 'regex' }
}
```

合同里"甲方：xxx" / "乙方：xxx"是规整格式，正则几乎必中 → 直接 return → `contractType` 永远 null。数据库现场（最近 10 条）：`party_a` / `party_b` 全部 ✓，`contract_type` 全部为空，`playbook_snapshot` 全部 null。这意味着按合同类型挂载的审查清单**从写下来到现在都没参与过 prompt**——LexSeek 合同审查的核心定位之一彻底失效。

**问题 2：风险锚点只到段落级，导致 UI 显示和 Track Changes 都受限**

`analyzeSingleClause.ts` 把整段（标题 + 正文几百字）作为 `clauseText` 喂给 LLM，prompt 要求 LLM 输出"条款原文片段"但**没有强约束**。LLM 自由摘取的结果：有时是整段、有时是标题、偶尔是有问题的具体句子。线上反馈"风险卡只对应到大标题，没对应到详细条款"即此现象。

数据库 `contract_risks.anchor_paragraph_index` 是段落序号（commentInjector 期望空间），`anchor_char_start/end` 字段存在但首次审查从不写入，仅 Phase B 锚点迁移用——首次审查时 LexSeek **没有字符级锚点**。这导致：
- 风险卡里"原文条款"显示整段（信息密度低）
- DocxPreview 高亮整段（视觉粗糙）
- Track Changes 模式无法实现——锚不到字符就只能"整段删除整段新增"，redline 失去价值

**问题 3：导出仅批注模式，缺少律师业务流必备的 Track Changes**

行业里"批注（comment 气泡）"和"修订（Track Changes）"是两种独立工具：
- 批注 = 边栏注释 + 可对话追加 → 适合"沟通讨论"阶段
- 修订 = 直接改原文 + 可接受/拒绝 → 适合"定稿前一轮"

LexSeek 当前只输出批注。律师拿到 AI 改写建议要在 Word 里手动逐条改，定稿效率低；客户回传时只能"接受批注"或"自己改"，没有 Word 原生的"接受/拒绝修订"工作流。

### 1.2 市面对标调研结论

调研了 Spellbook（GPT-5/Claude/Word 集成）、Robin AI（RAG + chunk metadata）、Harvey AI（cascading LLM + binary doc matching）、Anthropic Claude Citations API（原生 char_location）、ContractEval 学术 benchmark（GPT-4.1 F1=0.641 / 开源最强 Qwen3 8B "thinking" F1=0.540）。

**关键发现**：
- Anthropic Citations 内部机制是"模型输出 sentence index → SDK 转 char offset"，模型从不数字符位置——这是行业最高标准的内部做法
- ContractEval 数据表明 DeepSeek 量级开源模型直接输出精确 quote 准确率估计在 60% 以下
- 行业实战派（Width.ai 等）用 LLM quote + 服务端 fuzzy match（diff-match-patch）作为兼容老模型的 fallback

**LexSeek 路线选择**：路线 2（Inline Sentence ID）主路径 + 路线 3（dmp fuzzy match）fallback + 段落降级——不依赖任何特定 SDK，兼容现用 DeepSeek，复用前端已用的 `diff-match-patch` 库。

---

## 2. 定位与边界

### 2.1 范围（做的事）

1. **PRE-1**：修 `partyDetector.ts` 短路逻辑，让 contractType 真正识别 → playbook 真正参与 prompt
2. **数据模型激进重构**：drop `anchor_*` 5 个字段，重建为 `clause_*` + `quote_*` 双锚点（9 字段）
3. **路线 2 实现**：服务端切句标 ID → prompt 改造 → LLM 输出 `problemSentenceIds` + `problematicQuote` → 服务端 deterministic 解析
4. **路线 3 fallback**：sentence ID 解析失败时走 dmp.match_main 模糊匹配
5. **风险卡 UI 改造**：默认 Layout A（Stacked 三段）+ 可切换到 Layout C（Inline diff）
6. **DocxPreview 字符级高亮**：clause 段落浅黄底 + quote 字符段深黄底（双层渐进）
7. **Track Changes 导出**：批注 / 修订 / 双模式 切换；OOXML 用 `<w:ins>` / `<w:del>` / `<w:delText>`；偏好存 localStorage
8. **Phase B 锚点迁移升级**：双锚点优先级（quote 优先 → clause fallback → orphaned）

### 2.2 不做的事（留作后续）

| 子项目 | 内容 | 留作 |
|---|---|---|
| SUB-2 | 关键条款抽取（合同金额/期限/付款方式 → 卡片） | 独立 spec |
| SUB-3 | 缺失条款检测（playbook 反向） | 独立 spec |
| SUB-4 | 合同问答（Chat with Contract / RAG） | 独立 spec |
| SUB-5 | 执行摘要 2.0（商业/风险/谈判 三段） | 独立 spec |
| SUB-6 | 谈判 fallback position（ideal/acceptable/fallback 三档） | 独立 spec |

不做的设计取舍：
- **不引入新的"修订模式"顶级菜单**——靠下载按钮旁的 toggle 切换，不破坏现有信息架构
- **不做 redline 自动应用**（"一键接受所有 AI 修订"）——超出 SUB-1 范围
- **不做跨合同条款库**（Clause Library）——属于 SUB-6 后置功能
- **不做合同问答内嵌风险面板**——属于 SUB-4

### 2.3 用户语言

- 风险卡里：仍叫"原文条款"（完整 clause）和"建议改写"（suggestedClauseText）；新增"问题片段"独立框
- 下载切换：批注 / 修订 / 双模式（不用 "Track Changes" 等英文术语）
- 不暴露"sentence ID" / "fuzzy match" / "锚点" 等技术词

---

## 3. PRE-1：partyDetector 短路修复

### 3.1 修改前

```ts
export async function detectParties(paragraphs: string[]): Promise<PartyDetectionResult> {
    const fullText = paragraphs.join('\n')
    const matchA = pickValidCandidate(fullText, PARTY_A_PATTERN)
    const matchB = pickValidCandidate(fullText, PARTY_B_PATTERN)
    if (matchA && matchB) {
        // BUG: 永远 return null contractType
        return { partyA: matchA, partyB: matchB, contractType: null, source: 'regex' }
    }
    // ... LLM fallback
}
```

### 3.2 修改后

```ts
export async function detectParties(paragraphs: string[]): Promise<PartyDetectionResult> {
    const fullText = paragraphs.join('\n')
    const matchA = pickValidCandidate(fullText, PARTY_A_PATTERN)
    const matchB = pickValidCandidate(fullText, PARTY_B_PATTERN)

    // 不再短路：无论正则是否命中甲乙方，都调 LLM 推 contractType
    // 正则命中的甲乙方作为 hint 透传给 LLM，LLM 可参考也可纠正
    try {
        const preview = fullText.slice(0, 1500)
        const result = await invokeNodeJson({
            nodeName: 'contractPartyDetect',
            temperature: 0,
            schema: llmResultSchema,
            buildPrompt: (template) => {
                const rendered = template.replace('{{contractTypeOptions}}', CONTRACT_TYPE_OPTIONS.map(t => `- ${t}`).join('\n'))
                // 把正则结果作为 hint 注入 prompt
                const hintBlock = (matchA || matchB)
                    ? `\n\n## 正则提示\n甲方候选：${matchA ?? '未识别'}\n乙方候选：${matchB ?? '未识别'}\n（如果正则正确请直接采用；如果识别错误，请覆盖）`
                    : ''
                return `${rendered}${hintBlock}\n\n合同内容：\n${preview}`
            },
            errorPrefix: 'contractPartyDetect',
        })
        // 加 logger 埋点观察 regex/LLM 一致率（不污染 source 字面量 union）
        const regexHinted = !!(matchA && matchB)
        if (regexHinted) {
            logger.info('[contractPartyDetect] regex+llm', {
                regexHinted,
                regexPartyA: matchA, regexPartyB: matchB,
                llmPartyA: result.partyA, llmPartyB: result.partyB,
                contractType: result.contractType,
                consistent: result.partyA === matchA && result.partyB === matchB,
            })
        }
        return {
            // 正则结果作为 fallback——LLM 没输出但正则有则用正则
            partyA: result.partyA ?? matchA ?? null,
            partyB: result.partyB ?? matchB ?? null,
            contractType: result.contractType ?? null,
            source: 'llm', // 调过 LLM 就是 llm（无需新增 'regex+llm' 字面量）
        }
    } catch (_err) {
        // LLM 失败时退回到只有正则的结果（contractType 仍为 null，等同于历史行为）
        return { partyA: matchA, partyB: matchB, contractType: null, source: 'regex' }
    }
}
```

### 3.3 prompt 改造点

`prompts.contractPartyDetect_system` 已有的 prompt 不需要大改——它本来就要求输出 `partyA` / `partyB` / `contractType` 三个字段。只需要在 prompt 末尾追加一段："如果上方提供了'正则提示'，请优先采用正则识别的甲乙方（除非明显错误）；contractType 必须从给定枚举中选择，无法判断时输出 null。"

### 3.4 验证

- [ ] 正则命中甲乙方但 LLM 失败 → 回退到正则结果（不退化，source='regex'）
- [ ] 正则命中甲乙方 + LLM 成功 → contractType 不再 null（source='llm'，logger 落 regexHinted=true）
- [ ] 正则未命中 → 走原 LLM 全识别路径（source='llm'）
- [ ] `PartyDetectionResult.source` 字面量 union 保持 `'regex' | 'llm' | 'none'` 不变（不扩 'regex+llm'）；运维观察 regex/LLM 一致率走 `logger.info` 的 `regexHinted` / `consistent` 字段

---

## 4. 数据模型激进重构

### 4.1 字段变更全貌

**drop（5 个）**：

| 字段 | 原用途 |
|---|---|
| `anchor_quote` | 段落原文（语义模糊） |
| `anchor_paragraph_index` | 非空段落序号 |
| `anchor_char_start` | 文档全文 offset（仅 Phase B 写入） |
| `anchor_char_end` | 同上 |
| `original_anchor_quote` | Phase B 锚点迁移前的原 anchor_quote |

**新增（9 个）**：

| 字段 | 类型 | 用途 |
|---|---|---|
| `clause_index` | INT | 条款序号（segmentClauses 产出，1-based）；**source='global_review' 时为 null**（全局复核无单条款锚） |
| `clause_text` | TEXT NOT NULL | 完整条款原文（按 source 填充，见 §4.2.1） |
| `clause_paragraph_index` | INT | 非空段落序号（commentInjector 期望空间） |
| `clause_char_start` | INT | 在文档全文 normalizedText 里的 offset |
| `clause_char_end` | INT | 同上 |
| `problematic_quote` | TEXT | 精确问题片段（路线 2 产物，NULL = 解析全失败降级） |
| `quote_char_start` | INT | 在 `clause_text` 内的相对 offset（不是文档全文！） |
| `quote_char_end` | INT | 同上 |
| `quote_match_source` | VARCHAR(20) | `sentence_id` / `fuzzy` / `fallback`（运维埋点） |
| `original_clause_text` | TEXT | 客户回传迁移前的原 `clause_text`（原 `original_anchor_quote` 改名） |

#### 4.1.1 各 source 的 clause_text 填充规则

`clause_text NOT NULL` 跨三种 source 都要有值：

| source | clause_text 来源 | clause_index | 字段语义 |
|---|---|---|---|
| `ai`（首次审查） | segmentClauses 产出的 `segment.text` | segment.index | 完整条款 |
| `external_new`（Phase B 客户外部新增批注） | 客户回传 docx 里批注 `<w:commentRangeStart>` 所在段落的全文（uploadClientVersion 已有逻辑产出） | 找匹配的最近 segment.index；找不到时填 0 | 批注所在段落 |
| `global_review`（全局复核） | review 全局风险描述（无具体条款）→ 由 globalReview 节点 LLM 输出 `representativeQuote` 字段填充；找不到时填 review.summary 摘录 | NULL | 整篇复核 |

`clauseIndex` 只对 `ai`/`external_new` 必填，`global_review` 可空——schema 在 Prisma 里用 nullable Int，DAO 写入校验保证非 global_review 必有。

### 4.2 Prisma schema

`prisma/models/contractRiskAndAnnotation.prisma` 修改 contractRisks model：

```prisma
model contractRisks {
  id         Int    @id @default(autoincrement())
  reviewId   Int    @map("review_id")
  source     String @db.VarChar(20)
  code       String? @db.VarChar(30)
  category   String  @db.VarChar(50)
  level      String  @db.VarChar(10)
  stance     String  @default("balanced") @db.VarChar(10)
  problem    String  @db.Text
  legalBasis String? @map("legal_basis") @db.Text
  analysis   String? @db.Text
  suggestion String? @db.Text
  suggestedClauseText String? @map("suggested_clause_text") @db.Text

  archivedStatus String?   @map("archived_status") @db.VarChar(20)
  archivedAt     DateTime? @map("archived_at")

  // ===== 双锚点：层 1 完整条款（粗）=====
  /// 条款序号（segmentClauses 产出）；source='global_review' 时为 null
  clauseIndex          Int?   @map("clause_index")
  /// 完整条款原文：ai → segment.text；external_new → 批注所在段落；global_review → review 全局描述
  clauseText           String @map("clause_text") @db.Text
  /// 非空段落序号（commentInjector 期望空间）
  clauseParagraphIndex Int?   @map("clause_paragraph_index")
  /// clause 在文档全文 normalizedText 里的 offset
  clauseCharStart      Int?   @map("clause_char_start")
  clauseCharEnd        Int?   @map("clause_char_end")

  // ===== 双锚点：层 2 精确问题片段（细）=====
  /// 路线 2 产出；NULL = 解析全失败降级，UI 退回到 clauseText 显示
  problematicQuote     String?  @map("problematic_quote") @db.Text
  /// 在 clauseText 内的相对 offset（不是文档全文 offset）
  quoteCharStart       Int?     @map("quote_char_start")
  quoteCharEnd         Int?     @map("quote_char_end")
  /// sentence_id / fuzzy / fallback；运维监控匹配率
  quoteMatchSource     String?  @map("quote_match_source") @db.VarChar(20)

  // ===== Phase B 锚点迁移痕迹 =====
  originalClauseText String?  @map("original_clause_text") @db.Text
  orphaned           Boolean  @default(false) @map("orphaned")

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  review      contractReviews       @relation(fields: [reviewId], references: [id], onDelete: Cascade)
  annotations contractAnnotations[]

  @@index([reviewId, source])
  @@index([reviewId, archivedStatus])
  @@map("contract_risks")
}
```

### 4.3 迁移策略

合同审查功能未上线，老数据可丢。迁移走 Prisma migrate **--create-only** 流程（按 `.claude/rules/database.md` "唯一例外" 章节），手工修订 SQL 加 truncate + drop+add 顺序保护：

1. `bun run prisma:migrate -- --create-only --name refactor_contract_risks_dual_anchor` 生成迁移（注意 `--` 显式分隔以确保参数透传给 prisma CLI）
2. 手工编辑生成的 `prisma/migrations/<ts>_refactor_contract_risks_dual_anchor/migration.sql`：
   ```sql
   -- 1. drop 老字段
   ALTER TABLE "contract_risks" DROP COLUMN "anchor_quote";
   ALTER TABLE "contract_risks" DROP COLUMN "anchor_paragraph_index";
   ALTER TABLE "contract_risks" DROP COLUMN "anchor_char_start";
   ALTER TABLE "contract_risks" DROP COLUMN "anchor_char_end";
   ALTER TABLE "contract_risks" DROP COLUMN "original_anchor_quote";
   -- 2. truncate 已有数据（合同审查未上线，老数据可丢；执行前必须 confirm 未上线）
   TRUNCATE TABLE "contract_risks", "contract_annotations" CASCADE;
   -- 3. 新增字段
   ALTER TABLE "contract_risks" ADD COLUMN "clause_index" INT;
   ALTER TABLE "contract_risks" ADD COLUMN "clause_text" TEXT NOT NULL;
   ALTER TABLE "contract_risks" ADD COLUMN "clause_paragraph_index" INT;
   ALTER TABLE "contract_risks" ADD COLUMN "clause_char_start" INT;
   ALTER TABLE "contract_risks" ADD COLUMN "clause_char_end" INT;
   ALTER TABLE "contract_risks" ADD COLUMN "problematic_quote" TEXT;
   ALTER TABLE "contract_risks" ADD COLUMN "quote_char_start" INT;
   ALTER TABLE "contract_risks" ADD COLUMN "quote_char_end" INT;
   ALTER TABLE "contract_risks" ADD COLUMN "quote_match_source" VARCHAR(20);
   ALTER TABLE "contract_risks" ADD COLUMN "original_clause_text" TEXT;
   ```
3. 同步清空 `contract_review_legacy_risks_backup` 与 `contract_review_versions`（snapshot 引用旧字段）
4. `bun run prisma:migrate` 应用并把 review 状态全部置 failed（让用户重传）

**PR 2 描述模板必含**（按 `.claude/rules/database.md:51` 要求）：
> 手工修订 migration.sql：truncate + drop+add 顺序保护、合同审查未上线允许丢老数据。理由：跨步骤需保数据顺序避免 NOT NULL 列加列报错；用户同意人：（PR 创建时填）。

### 4.4 类型同步

`shared/types/contract.ts` 的 `ContractRiskEntity`：

```ts
export interface ContractRiskEntity {
    id: number
    reviewId: number
    source: RiskSource
    code: string | null
    category: string
    level: RiskLevel
    stance: StancePreference
    problem: string
    legalBasis: string | null
    analysis: string | null
    suggestion: string | null
    suggestedClauseText: string | null
    archivedStatus: RiskArchivedStatus | null
    archivedAt: string | null

    // 双锚点 · 层 1
    clauseIndex: number
    clauseText: string
    clauseParagraphIndex: number | null
    clauseCharStart: number | null
    clauseCharEnd: number | null

    // 双锚点 · 层 2
    problematicQuote: string | null
    quoteCharStart: number | null
    quoteCharEnd: number | null
    quoteMatchSource: 'sentence_id' | 'fuzzy' | 'fallback' | null

    // Phase B 锚点迁移痕迹
    originalClauseText: string | null
    orphaned: boolean

    createdAt: string
    updatedAt: string
}
```

---

## 5. 路线 2 主路径：Sentence ID 解析

### 5.0 风险编辑（PATCH）时的锚点字段处理

`PATCH /api/v1/assistant/contract/reviews/risks/:riskId` 现在允许律师手工改 problem / suggestion / level 等业务字段。新数据模型下：

- **clause_* 字段全部视为只读**——律师改业务文字不应破坏与原文的锚定
- **quote_* 字段也视为只读**——律师不应通过编辑 quote 触发服务端重算 offset
- 仅当律师在 UI 显式选择"重定位锚点"（v2 功能，暂不实现）时才走 resolveQuoteAnchor 重算
- handler 层的 zod schema 拒绝 clause/quote 字段出现在 PATCH body

### 5.1 切句规则（splitSentences）

新建 `server/agents/contract/utils/splitSentences.ts`：

```ts
// 复用 clauseSegmenter.ts 已有的子项编号识别正则（避免重复造轮子）
import {
    RE_DI_TIAO,    // 「第X条」
    RE_NUM_DOT,    // 「3.1」 / 「3.1.2」
    RE_CN_COMMA,   // 「一、」中文序号
} from '../docx/clauseSegmenter'

export interface SentenceSpan {
    /** 1-based ID，给 LLM prompt 用 */
    id: number
    /** 句子文本（已 trim） */
    text: string
    /** 在 segment.text 内的 0-based offset */
    charStart: number
    /** exclusive */
    charEnd: number
}

/**
 * 中文合同条款断句（一个 segment 内部继续切句）。
 *
 * 切分点：
 * - 标点：`。！？；` + 换行符 `\n`
 * - 行首子项编号：复用 `clauseSegmenter.ts` 已有的 `RE_DI_TIAO` / `RE_NUM_DOT` / `RE_CN_COMMA`（已含 cnNumToInt 中文百千位）
 *
 * 不切分：逗号、顿号、引号 / 括号 / 双引号"" / 单引号'' 内的标点
 *
 * 边角行为：
 * - 输入 `""` → 返回 `[]`（无句子）
 * - 输入仅含 1 字符（"。"）→ 切出 1 个空句子或不切（实现时返回 `[{ id: 1, text: '', charStart: 0, charEnd: 1 }]`）
 * - 整段无切分点（如标题行）→ 整段作 1 个 sentence
 * - 行内中文序数词（"前段。第二，违约金..."）不作切分点——只在行首 `^\s*` 锚定才识别为子项编号（即 RE_CN_COMMA 仅匹配行首）
 *
 * 实施前提：在 `clauseSegmenter.ts` 把 `RE_DI_TIAO` / `RE_NUM_DOT` / `RE_CN_COMMA` 三个常量从模块级 `const` 改成 `export const`（当前是模块私有），不需要新建 utils 文件单独存放。
 */
export function splitSentences(segmentText: string): SentenceSpan[]
```

### 5.2 prompt 改造

DB 节点 `contractReviewAnalyzeClause` 的 system prompt（id=28）改造：

**新增/修改占位符**：
- `{{sentencesNumbered}}` 替换原 `{{clauseText}}` —— 切句后的"[S1] xxx [S2] xxx"格式
- `{{clauseTextRaw}}` 保留 —— 完整条款原文（避免 LLM 在 sentence 视角下丢失整体上下文）

**JSON schema 输出新增**：
- `problemSentenceIds: number[]`（必填）—— 产生风险的句子 ID（多个，按出现顺序）
- `problematicQuote: string`（可选）—— 从所选 sentence 里逐字摘录的问题片段（fallback 用）

**输出指引**：
> 你必须从 `[Sn]` 标号中选择产生风险的句子 ID，按出现顺序写入 `problemSentenceIds`。`problematicQuote` 应是这些句子里逐字摘录的问题片段（不要改写、不要省略号、不要加标点）。如果整个条款都有问题，把所有 sentence ID 都列出。

### 5.3 服务端解析（resolveQuoteAnchor）

#### 5.3.1 公共 helper · `fuzzyLocateInText`（抽到 textSimilarity.ts）

`resolveQuoteAnchor` 档 2 fuzzy 匹配 与 `anchorMigrate.ts:findBestSubstring` 业务一致（都是"在文本里找最相似 substring 的起点"）。抽公共 helper 放进 `server/agents/contract/utils/textSimilarity.ts`，两边复用：

```ts
// server/agents/contract/utils/textSimilarity.ts 新增 export
import { getDmp } from './textSimilarity' // self-import 示意

/**
 * 用 diff-match-patch 的 Bitap 算法找 pattern 在 text 内最相似 substring 的起点 offset。
 *
 * **关键约束（diff-match-patch 官方文档 + 源码）**：
 * - `Match_MaxBits = 32`：pattern.length > 32 时 `match_main` **抛 throw "Pattern too long"**
 *   （**不是**返回 -1）；调用方必须先做长度判断或截前 32 字符做 anchor locate
 * - `Match_Threshold` 默认 0.5（越小越严格、越快）；合同场景压到 0.3 兼顾精度
 * - `Match_Distance` 默认 1000（搜索半径）；合同条款可超 1000 字符 → 显式设到 text.length 保证全段可搜
 * - `match_main` 找到时返回起点 offset（number），找不到返回 `-1`（不是 null）
 * - 中文 BMP 字符 1 字 = 1 UTF-16 code unit，offset 即字符 offset
 *
 * **不做标点归一化**：normalizeForMatch 含 1→3 字符（如 `'…' → '...'`） + 多空白折叠 + trim，
 * 不是 1:1 字符替换；归一化后 offset 与原文不对齐。dmp.match_main 的 Bitap fuzzy 容错本身
 * 已能处理标点小差异（中文逗号 `,` vs 英文 `,` 在 Match_Threshold=0.3 下仍可命中）；
 * 主路径 sentence_id 是 deterministic 的（无 fuzzy 容错诉求），fuzzy 路径占比 ≤ 15% 的边角
 * 标点差异由 dmp 自身吸收，不再叠归一化。
 *
 * **共享实例参数恢复**：textSimilarity.getDmp() 是全局单例，calcSimilarity / anchorMigrate
 * 等其他调用方依赖默认 Match_Threshold/Distance；本函数 try/finally 保存/恢复参数避免污染。
 */
export function fuzzyLocateInText(
    text: string,
    pattern: string,
    options?: { threshold?: number; loc?: number },
): { start: number; end: number } | null {
    const MAX_PATTERN = 32
    if (pattern.length === 0 || text.length === 0) return null

    const dmp = getDmp()
    const savedThreshold = dmp.Match_Threshold
    const savedDistance = dmp.Match_Distance
    try {
        dmp.Match_Threshold = options?.threshold ?? 0.3
        dmp.Match_Distance = Math.max(1000, text.length)

        // pattern > 32 抛 throw → 必须用前 32 字符做 anchor locate，按 pattern.length 推算 end
        const probe = pattern.length <= MAX_PATTERN ? pattern : pattern.slice(0, MAX_PATTERN)
        const start = dmp.match_main(text, probe, options?.loc ?? 0)
        if (start === -1) return null
        return { start, end: Math.min(start + pattern.length, text.length) }
    }
    finally {
        dmp.Match_Threshold = savedThreshold
        dmp.Match_Distance = savedDistance
    }
}
```

`anchorMigrate.ts:findBestSubstring` 同步重构：把内部 `dmp.match_main` 调用改为 `fuzzyLocateInText`；对返回 offset 再做现有的 Levenshtein 精扫逻辑（功能等价不变）。

#### 5.3.2 resolveQuoteAnchor 实现

```ts
// server/agents/contract/utils/resolveQuoteAnchor.ts
import { fuzzyLocateInText } from './textSimilarity'
import type { SentenceSpan } from './splitSentences'

export interface QuoteAnchorResult {
    /** 精确问题片段；null = 全失败降级 */
    problematicQuote: string | null
    /** 在 clauseText 内的相对 offset；null 时 quote 也为 null */
    charStart: number | null
    charEnd: number | null
    /** 命中来源 */
    matchSource: 'sentence_id' | 'fuzzy' | 'fallback'
}

export function resolveQuoteAnchor(input: {
    clauseText: string
    sentences: SentenceSpan[]
    aiOutput: { problemSentenceIds?: number[]; problematicQuote?: string }
}): QuoteAnchorResult {
    // 档 1：sentence_id 主路径（deterministic）
    const ids = input.aiOutput.problemSentenceIds
    if (ids && ids.length > 0) {
        const validIds = ids.filter(id => id >= 1 && id <= input.sentences.length)
        if (validIds.length > 0) {
            const minId = Math.min(...validIds)
            const maxId = Math.max(...validIds)
            const startSentence = input.sentences[minId - 1]!
            const endSentence = input.sentences[maxId - 1]!
            const charStart = startSentence.charStart
            const charEnd = endSentence.charEnd
            const quote = input.clauseText.slice(charStart, charEnd).trim()
            return { problematicQuote: quote, charStart, charEnd, matchSource: 'sentence_id' }
        }
    }

    // 档 2：fuzzy match fallback（不归一化；offset 直接对齐原文）
    const quote = input.aiOutput.problematicQuote?.trim()
    if (quote && quote.length >= 4) {
        const offset = fuzzyLocateInText(input.clauseText, quote)
        if (offset !== null) {
            return {
                problematicQuote: input.clauseText.slice(offset.start, offset.end),
                charStart: offset.start,
                charEnd: offset.end,
                matchSource: 'fuzzy',
            }
        }
    }

    // 档 3：全失败降级
    return { problematicQuote: null, charStart: null, charEnd: null, matchSource: 'fallback' }
}
```

> **已知限制**：fuzzy 路径下 `text.slice(start, start + pattern.length)` 取出的字符串与 LLM 给的 quote 可能差几个字符（容标点差异 / Bitap 模糊匹配本身的 ±1 偏差），这是预期行为；UI 显示的是"文档原文里实际存在的相似片段"，比 LLM 自由摘取更可信。

### 5.4 risksSchema.builder 同步

`server/agents/contract/riskSchema.builder.ts` 增加字段：

```ts
export const RISK_SHAPE = z.object({
    id: z.string().optional(),
    clauseIndex: z.number().int().nonnegative(),
    clauseText: z.string().min(1).max(10000),
    // 新增 ↓
    problemSentenceIds: z.array(z.number().int().positive()).default([]),
    problematicQuote: z.string().max(2000).optional(),
    // 上面已有 ↓
    level: z.enum(RISK_LEVEL),
    category: z.string().min(1).max(200),
    problem: z.string().min(1).max(2000),
    legalBasis: z.string().max(200).optional(),
    analysis: z.string().min(1).max(2000),
    risk: z.string().min(1).max(2000),
    suggestion: z.string().min(1).max(2000),
    suggestedClauseText: z.string().max(10000).optional(),
    matchedPointCode: z.string().optional(),
}).refine(
    r => r.level === 'low' || !!r.suggestedClauseText,
    { message: 'high/medium 级别必须提供 suggestedClauseText', path: ['suggestedClauseText'] },
)
```

### 5.5 落库

`persistAiRisksAsContractRows` 拼接逻辑：

```ts
const sentences = splitSentences(segment.text)
const anchor = resolveQuoteAnchor({
    clauseText: segment.text,
    sentences,
    aiOutput: { problemSentenceIds: r.problemSentenceIds, problematicQuote: r.problematicQuote },
})

const item: Prisma.contractRisksUncheckedCreateInput = {
    reviewId,
    source: row.source ?? 'ai',
    // ... 既有字段 ...

    clauseIndex: r.clauseIndex,
    clauseText: segment.text,
    clauseParagraphIndex: row.clauseParagraphIndex ?? null,
    clauseCharStart: row.clauseCharStart ?? null,
    clauseCharEnd: row.clauseCharEnd ?? null,

    problematicQuote: anchor.problematicQuote,
    quoteCharStart: anchor.charStart,
    quoteCharEnd: anchor.charEnd,
    quoteMatchSource: anchor.matchSource,
}
```

---

## 6. 风险卡 UI · Layout A 默认 + C 切换

### 6.1 Layout A（Stacked 三段，默认）

风险卡展开后（图标用 lucide-vue-next，不用 emoji——遵循 CLAUDE.md 铁律 §3）：

```
┌─────────────────────────────────────────────────┐
│ [中] 违约金  [<ClipboardList/> 命中清单 · payment_default] │
│ 逾期付款违约金过低，对乙方追讨成本不足            │
├─────────────────────────────────────────────────┤
│ <FileText/> 条款标题                              │
│ 第三条 工资支付（第 5 段）                         │
│                                                  │
│ <Quote/> 完整原文                                 │
│ ┌─────────────────────────────────────────────┐ │
│ │ 工资按月支付。 [深黄底高亮 quote 字符段]      │ │
│ │ 工资按月底前最后一个工作日结算；逾期支付的，  │ │
│ │ 每日按 0.05% 加收滞纳金 [/高亮]。乙方有权追讨。│ │
│ └─────────────────────────────────────────────┘ │
│                                                  │
│ <AlertTriangle/> 问题片段                         │
│ ┌─────────────────────────────────────────────┐ │
│ │ "工资按月底前最后一个工作日结算；逾期支付的， │ │
│ │  每日按 0.05% 加收滞纳金"                    │ │
│ └─────────────────────────────────────────────┘ │
│                                                  │
│ <PencilLine/> 建议改写                            │
│ ┌─────────────────────────────────────────────┐ │
│ │ 工资按月底前最后一个工作日结算；逾期支付的，  │ │
│ │ 每日按 **0.5%** 加收滞纳金，且累计逾期超 30   │ │
│ │ 日的，乙方有权解除合同。                     │ │
│ └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

> 实际代码用 lucide 组件：`<FileText class="size-3" />` / `<Quote class="size-3" />` / `<AlertTriangle class="size-3 text-amber-500" />` / `<PencilLine class="size-3 text-emerald-600" />`。色调跟现有 RiskCard 内已用 lucide 图标保持一致。

### 6.2 Layout C（Inline diff，可切）

```
┌─────────────────────────────────────────────────┐
│ [中] 违约金  [<ClipboardList/> 命中清单 · payment_default] │
│ 逾期付款违约金过低，对乙方追讨成本不足            │
├─────────────────────────────────────────────────┤
│ 原文 → 建议（行内 diff）                           │
│ ┌─────────────────────────────────────────────┐ │
│ │ 工资按月支付。工资按月底前最后一个工作日结算；│ │
│ │ 逾期支付的，每日按 [删 0.05%][增 0.5%] 加收  │ │
│ │ 滞纳金[增 ，且累计逾期超 30 日的，乙方有权解 │ │
│ │ 除合同]。乙方有权追讨。                      │ │
│ └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

### 6.3 Layout 切换

风险面板顶部加 toggle：`[列表 ▾] [Stacked ▾ / 行内 diff]`，偏好存 `localStorage:contract-review-risk-card-layout`。

实现：`RiskCard.vue` 接受 `layout: 'stacked' | 'inline-diff'` prop，由 `RiskListPanel` 传入。

### 6.4 quote=null 降级

`problematicQuote` 为 null 时（解析全失败）：
- Layout A："问题片段"框不渲染；"完整原文"框内不做字符级高亮
- Layout C：直接显示完整 clauseText，不做 diff
- DocxPreview 仍做段落级浅黄高亮（仅 quote 字符段的深黄高亮跳过）

UI 不暴露"匹配失败"状态——用户无感降级到"段落级"基线（=现状行为）。

---

## 7. DocxPreview 字符级高亮

### 7.1 现状

`ContractDocxPreview.vue` 用 `docx-preview` 库渲染 docx，按 `anchorParagraphIndex` 给段落（`<p>` 元素）加底色，**底色按风险等级配色**——`app/utils/contractRiskLevelStyle.ts` 的 `RISK_LEVEL_DOCX_BG_CLASS`：high=红 / medium=橙 / low=灰。三态视觉：focused（点击聚焦）= 红边框 + 红光晕、pinned = 同 active、hovered = 淡黄。

### 7.2 升级目标 · 双层视觉系统

保留现状段落按级别配色（不破坏视觉级别信号），新增 quote 字符段的"统一深黄"高亮：

| 层 | 命中条件 | 视觉 | 实现 |
|---|---|---|---|
| 段落级（保留） | `clause_paragraph_index` 命中 | 现状不变：high=红/medium=橙/low=灰浅底 + 焦点态红边框红光晕 | 现状 `decorateRisks` 流程 |
| 字符级（新增） | `quote_char_start..quote_char_end` 命中 | 统一深黄底（focus/pin 三态用更深变体） | CSS Custom Highlight API |
| quote=null 降级 | quote 字段全失败 | 仅段落级高亮（=现状） | 跳过字符级 |

### 7.3 主实现 · CSS Custom Highlight API（推荐路径）

行业标准做法（Hypothesis 等开源标注工具 2024Q4 已迁移）。**不修改第三方 DOM**，跨 `<p>` / `<span>` / text node 任意区间通过 `Range` 表达，浏览器内核渲染高亮。

浏览器支持：Chrome 105+ / Safari 17.2+ / Firefox 140，**baseline 2025/06**。LexSeek 浏览器目标全覆盖。

```ts
// 1. CSS（global.css 或 component scoped）
::highlight(quote-default) { background-color: rgb(252 211 77 / 0.6); }
::highlight(quote-focused) { background-color: rgb(245 158 11 / 0.85); }
::highlight(quote-pinned)  { background-color: rgb(217 119 6 / 0.7); }

// 2. 渲染完成后构建 Range + Highlight
function decorateQuoteRange(risk: ContractRiskEntity, container: HTMLElement) {
    const range = computeQuoteRange(risk, container)
    if (!range) return
    const stateName = pickHighlightState(risk) // 'quote-default' | 'quote-focused' | 'quote-pinned'
    const existing = CSS.highlights.get(stateName) ?? new Highlight()
    existing.add(range)
    CSS.highlights.set(stateName, existing)
}
```

#### 7.3.1 关键算法 · clauseText offset → DOM Range 对齐

`clause_text` 是 `segmentClauses` 产出的 `raw.trim()`（含 `\n` 作多行段落分隔），但 docx-preview 把每个 `<w:p>` 单独渲染成 `<p>` 元素，`<p>.textContent` **不含 `\n`**——一个 `clause_text` 可能横跨多个 `<p>` 元素。

对齐算法（伪代码）：

```ts
function computeQuoteRange(risk: ContractRiskEntity, container: HTMLElement): Range | null {
    if (risk.quoteCharStart == null || risk.quoteCharEnd == null) return null

    // 1. clause_text 按 \n 拆行（segmentClauses 用 \n 连接 lines）
    const clauseLines = risk.clauseText.split('\n')

    // 2. 累加每行长度（含行尾 \n 的 1 字符），找到 quoteCharStart/End 落在哪些行 + 行内 offset
    const linePositions = computeLinePositions(clauseLines) // [{ start, end }, ...]
    const startHit = locateInLines(linePositions, risk.quoteCharStart)  // { lineIdx, lineOffset }
    const endHit = locateInLines(linePositions, risk.quoteCharEnd)

    // 3. 用 clause_paragraph_index 找起始 <p>，往后取连续 N 个非空 <p> 对应到 clauseLines[i]
    const paragraphs = findClauseParagraphs(container, risk.clauseParagraphIndex, clauseLines.length)
    if (!paragraphs[startHit.lineIdx] || !paragraphs[endHit.lineIdx]) return null

    // 4. 在 startHit 段落内按 textContent 累加字符找到对应 text node + 内部 offset；endHit 同理
    const startAnchor = walkToTextNode(paragraphs[startHit.lineIdx], startHit.lineOffset)
    const endAnchor = walkToTextNode(paragraphs[endHit.lineIdx], endHit.lineOffset)
    if (!startAnchor || !endAnchor) return null

    // 5. 构建跨节点 Range
    const range = new Range()
    range.setStart(startAnchor.node, startAnchor.offset)
    range.setEnd(endAnchor.node, endAnchor.offset)
    return range
}

/** 在 paragraph element 内遍历 text node，累加字符数找到 offset 对应的 (textNode, innerOffset) */
function walkToTextNode(p: HTMLElement, charOffset: number): { node: Text; offset: number } | null {
    let consumed = 0
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode() as Text | null
    while (node) {
        const len = node.data.length
        if (consumed + len >= charOffset) {
            return { node, offset: charOffset - consumed }
        }
        consumed += len
        node = walker.nextNode() as Text | null
    }
    return null
}
```

#### 7.3.2 字符等价性边角

docx-preview 渲染时部分字符被替换：
- `<w:tab>` → `<span>&emsp;</span>`（textContent = ` ` 全角空格），但 clause_text 里 tab 是 `\t`
- `<w:br>` → `<br>`（textContent = ''），clause_text 里换行被 segmentClauses 折叠为 `\n` 行分隔

**对齐策略**：在 `walkToTextNode` 累加时把 ` ` 视作 1 字符，对齐 clause_text 里 `\t` 的 1 字符（基本可用）。如果实测出现明显偏差，再加映射表。

#### 7.3.3 浏览器不支持 CSS Highlight 时的降级

```ts
if (typeof CSS === 'undefined' || !('highlights' in CSS)) {
    // 直接 return 不渲染字符级高亮 → 用户只看到段落级浅黄高亮（=quote=null 降级路径，§6.4）
    return
}
```

LexSeek 浏览器目标全部支持 CSS Custom Highlight API（baseline 2025/06）；不支持的边角浏览器降级到段落级高亮，与现状视觉一致。**不再写一份 DOM-mutate fallback 实现**——为不存在的目标用户写代码是 YAGNI。

### 7.4 重渲染保护

`docx-preview.renderAsync` 把 `target.innerHTML = ''`，所有手动插入物作废；CSS Custom Highlight API 的 `Range` 引用旧 text node 也会失效。

**生命周期 hook**：

```ts
watch(
    [() => props.reviewedFileId, () => props.risks, () => props.focusedRiskId, () => props.pinnedRiskIds],
    async () => {
        await renderAsync(...) // docx-preview 渲染完成
        clearAllQuoteHighlights() // CSS.highlights.delete('quote-default') 等
        for (const risk of props.risks) decorateQuoteRange(risk, container)
    },
    { immediate: true },
)
```

`clearAllQuoteHighlights` 在每次重渲染前调用：

```ts
function clearAllQuoteHighlights() {
    CSS.highlights.delete('quote-default')
    CSS.highlights.delete('quote-focused')
    CSS.highlights.delete('quote-pinned')
}
```

### 7.5 焦点动画

点击风险卡时（focusedRiskId 变化）：
- 滚动到段落（已有逻辑沿用）
- **不用 `animate-pulse` CSS class**（CSS.highlights 不支持 animation）；改用 1 秒后 `setTimeout` 把 `quote-focused` 切回 `quote-default` 实现"闪一下"效果，或者通过 `::highlight()` 的 `transition` 渐变（部分浏览器支持）

### 7.6 视觉态矩阵

| 风险态 | 段落底色 | quote 高亮 | 段落边框 |
|---|---|---|---|
| idle（无聚焦） | level 浅底（red-50 / orange-50 / gray-50） | quote-default 深黄 60% | 无 |
| hovered | 淡黄 (yellow-50) | quote-default | 无 |
| focused（点击） | level 浅底 | quote-focused 深橙 85% + 1秒后回 default | 红边框 + 红光晕 |
| pinned | level 浅底 | quote-pinned 棕黄 70% | 橙边框 |
| quote=null | 上面四种段落底色不变 | 无字符级高亮 | 同上 |

---

## 8. Track Changes docx 导出

### 8.1 导出模式

下载按钮旁加 toggle：

```vue
<DropdownMenu>
  <DropdownMenuTrigger>下载 ▾</DropdownMenuTrigger>
  <DropdownMenuContent>
    <DropdownMenuRadioGroup v-model="exportMode">
      <DropdownMenuRadioItem value="comment">批注模式</DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="redline">修订模式（Track Changes）</DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="both">两者并存</DropdownMenuRadioItem>
    </DropdownMenuRadioGroup>
  </DropdownMenuContent>
</DropdownMenu>
```

`exportMode` 用 `useLocalStorage('contract-review-export-mode', 'comment')`。

### 8.2 后端 API

GET `/api/v1/assistant/contract/reviews/download/:id?mode=comment|redline|both`

`reviewResultPersistence.middleware.ts` / `contractReviewRebuild.service.ts` 内部 `injectAnnotations` 函数升级支持 mode 参数。

### 8.3 OOXML 实现

新建 `server/agents/contract/docx/redlineInjector.ts`，复用现有 `xmlAst.ts` (`parseOoxml` / `stringifyOoxml` / `makeElement` / `walk` / `findFirst` / `escapeXml`) + `zipRewriter.ts` 基础设施：

```ts
export async function injectRedlineMarks(
    docxBuffer: Buffer,
    risks: ContractRiskEntity[],
    options: { reviewId: number; idStart: number }
): Promise<{ buffer: Buffer; warnings: string[]; nextIdAfter: number }>
```

#### 8.3.1 ID 池协调（关键 · 不修会让 Word 拒打开）

OOXML 的 `w:id` 在文档内是**跨多种元素共享 ID 池**：bookmark / `<w:ins>` / `<w:del>` / `<w:rPrChange>` / `<w:pPrChange>` / `<w:commentRangeStart>` / `<w:commentRangeEnd>` / `<w:commentReference>` / `<w:moveFromRangeStart>` 等。**ID 撞车 → Word 报"文件已损坏"拒打开**（macOS Preview 容忍但 Windows Word 严格）。

实现：把 `findMaxSharedId` 放到现有 `server/agents/contract/docx/xmlAst.ts`（与 `walk` / `findFirst` 等 OOXML AST helper 同模块），让 `commentInjector` 和 `redlineInjector` 共用同一个扫描函数：

```ts
// server/agents/contract/docx/xmlAst.ts 新增 export
const ID_BEARING_TAGS = new Set([
    'w:bookmarkStart', 'w:bookmarkEnd',
    'w:ins', 'w:del', 'w:rPrChange', 'w:pPrChange',
    'w:sectPrChange', 'w:tblPrChange', 'w:tcPrChange', 'w:trPrChange',
    'w:cellIns', 'w:cellDel', 'w:cellMerge', 'w:numberingChange',
    'w:commentRangeStart', 'w:commentRangeEnd', 'w:commentReference',
    'w:moveFromRangeStart', 'w:moveToRangeStart',
    'w:moveFromRangeEnd', 'w:moveToRangeEnd',
])

/** 扫描 document.xml AST 收集所有共享 ID 池里的 w:id 最大值；空返回 -1（调用方 +1 起 0） */
export function findMaxSharedId(rootAst: AstNode): number {
    let max = -1
    walk(rootAst, (node) => {
        if (ID_BEARING_TAGS.has(node.tag)) {
            const id = parseInt(node.attrs?.['w:id'] ?? '-1', 10)
            if (Number.isFinite(id) && id > max) max = id
        }
    })
    return max
}
```

**调用方协调**：
- `redlineInjector` 入口扫一次 `findMaxSharedId`，从 `max+1` 起分配 `w:id`，返回 `nextIdAfter`
- `commentInjector` 改造：去掉当前用数组下标当 `w:id` 的逻辑（这是已有 bug），改为接受 `idStart` 参数并从该值起递增
- `mode='both'` 时由顶层调用方协调：`redlineInjector` 先跑 → 返回 `nextIdAfter` → `commentInjector` 从 `nextIdAfter` 起步（共用同一份 ID 池基线）

#### 8.3.2 跨 run 拆分（关键 · 不修会丢字体格式）

合同正文里同一句话可能跨多个 `<w:r>` run（粗体的"违约金"在自己的 run、普通字"百分之"在另一个 run）。Quote 起止可能落在 run 内部：

```
原 <w:p> 结构：
  <w:r> <w:rPr>...粗体...</w:rPr> <w:t>违约金</w:t> </w:r>
  <w:r> <w:rPr>...常规...</w:rPr> <w:t>按月底前最后一个工作日结算；逾期支付的</w:t> </w:r>
  <w:r> <w:rPr>...常规...</w:rPr> <w:t>，每日按 </w:t> </w:r>
  <w:r> <w:rPr>...粗体红色...</w:rPr> <w:t>0.05%</w:t> </w:r>
  <w:r> <w:rPr>...常规...</w:rPr> <w:t> 加收滞纳金。</w:t> </w:r>
```

quote 跨这 5 个 run 时，正确处理：
1. 找到 quote 起止 char offset 落在哪个 run / run 内部什么位置
2. 起止 run 在 offset 处**拆成两个 run**（保留原 `<w:rPr>` 副本，`<w:t>` 文本拆开）
3. 把 quote 范围内的所有完整 run **保持各自的 `<w:rPr>` 不变**，每个 `<w:r>` 替换为：
   ```xml
   <w:r>
     <w:rPr>...原 rPr 副本...</w:rPr>
     <w:delText xml:space="preserve">原文片段</w:delText>
   </w:r>
   ```
4. 最后在第一个改造的 run 之前 insert `<w:del w:id="N" w:author="..." w:date="...">`、最后一个之后 insert `</w:del>` 闭合（在 AST 里就是 wrap N 个 run 进一个 `<w:del>` 节点）

> 这样修订接受后保留原字体格式，律师拒绝时也能完美还原。

#### 8.3.3 多行 suggestedClauseText 处理

`<w:t>` 里的 `\n` Word 渲染时会被替换成空格（不会换行）。如果 LLM 输出含换行的 suggestedClauseText，必须按 `\n` 拆分成多段，每段一个 `<w:p>`，每个 `<w:p>` 内一对 `<w:ins>`。

**v1 简化策略**：在 risksSchema.builder 里强制 `suggestedClauseText` 不含 `\n`：

```ts
suggestedClauseText: z.string().max(10000).refine(
    s => !s.includes('\n'),
    { message: 'suggestedClauseText 不允许换行（v1 整段替换不支持多段插入）' }
).optional()
```

LLM prompt 里同步加约束："suggestedClauseText 必须是单段连续文字，不要使用换行/项目符号/多段。"

v2 再支持多段插入。

#### 8.3.4 整段替换 · 标准 XML 模板

```xml
<w:del w:id="N" w:author="LexSeek AI" w:date="2026-05-02T10:30:00Z">
    <w:r>
        <w:rPr>...原 run 1 的 rPr 副本...</w:rPr>
        <w:delText xml:space="preserve">违约金</w:delText>
    </w:r>
    <w:r>
        <w:rPr>...原 run 2 的 rPr 副本...</w:rPr>
        <w:delText xml:space="preserve">按月底前...的，每日按 </w:delText>
    </w:r>
    <w:r>
        <w:rPr>...原 run 4 的 rPr 副本（粗体红色）...</w:rPr>
        <w:delText xml:space="preserve">0.05%</w:delText>
    </w:r>
    <w:r>
        <w:rPr>...原 run 5 的 rPr 副本...</w:rPr>
        <w:delText xml:space="preserve"> 加收滞纳金。</w:delText>
    </w:r>
</w:del>
<w:ins w:id="N+1" w:author="LexSeek AI" w:date="2026-05-02T10:30:00Z">
    <w:r>
        <w:rPr>...继承 quote 起始 run 的 rPr 副本...</w:rPr>
        <w:t xml:space="preserve">每日按 0.5% 加收滞纳金，且累计逾期超 30 日的，乙方有权解除合同。</w:t>
    </w:r>
</w:ins>
```

要点：
- `xml:space="preserve"` 必加（任何位置含空白都不能丢）
- `w:date` 必带时区（`Z` UTC 或 `+08:00`）；`new Date().toISOString()` 自带 `Z`，OK
- `w:author` 固定 "LexSeek AI"（v1）；和现有 commentInjector 的 `LS:{律师名} [#...]` 格式不同**有意为之**——comment 是律师署名（要回传识别），redline 是 AI 操作（律师接受/拒绝即消失）
- `<w:ins>` 的 run 不需要保留所有原 run 的 rPr 副本，可继承 quote 起始 run 的 rPr 一段（v1 简化）

#### 8.3.5 整段删除时段落标记同步

如果 quote 范围 == 完整 clause_text，且 clause_text 是整个段落 → 律师"接受所有修订"会留下空段落（只删了文字没删段落标记）。

修复：在该 `<w:p>` 的 `<w:pPr><w:rPr>` 里追加 `<w:del>` 子标记：

```xml
<w:p>
    <w:pPr>
        <w:rPr>
            <w:del w:id="N+2" w:author="LexSeek AI" w:date="2026-05-02T10:30:00Z"/>
        </w:rPr>
    </w:pPr>
    ...上面的 <w:del> + <w:ins>...
</w:p>
```

仅当"删完整 clause_text"时启用；部分 quote 不需要。

#### 8.3.6 mode='both' 协调 comment 和 redline

both 模式下：
- redline 先 inject（占 idStart..idStart+2N）
- 然后 commentInjector 跑，从 nextIdAfter 接力
- comment 的 `<w:commentRangeStart>` / `<w:commentRangeEnd>` 包裹 `<w:del>` + `<w:ins>` **整体**（律师悬停时高亮 = 修订段，气泡显示"为什么这样改"）
- comment 内容文本去掉 suggestedClauseText 段（避免和 redline 重复信息）；保留 problem / risk / suggestion 业务字段

**comment range 与 redline 的相对位置**：

```xml
<w:p>
    ...前文...
    <w:commentRangeStart w:id="M"/>
    <w:del w:id="N">...</w:del>
    <w:ins w:id="N+1">...</w:ins>
    <w:commentRangeEnd w:id="M"/>
    <w:r><w:commentReference w:id="M"/></w:r>
    ...后文...
</w:p>
```

`<w:commentRangeStart/End>` 是 `<w:p>` 直接子节点（不能塞进 `<w:r>`）。

#### 8.3.7 settings.xml 不变

`<w:trackChanges/>` 是 settings.xml 里的开关——作用是"让 Word 在编辑时自动追踪新修改"。**已存在的 `<w:ins>` / `<w:del>` 标签不依赖此开关**，Word 打开任何 docx 都会显示已存在的修订。redlineInjector **不需要改 settings.xml**。

#### 8.3.8 输入清理

LLM 输出可能含非法 XML 字符（U+0008 等控制字符）；用现有 `xmlAst.escapeXml` 过滤所有要写入 `<w:t>` / `<w:delText>` 的文本。

### 8.4 边角

- `problematicQuote=null` 的 risk：redline 模式下只挂 comment（无锚点不能 redline）
- `suggestedClauseText` 为空（low risk）的：跳过 redline，但仍挂 comment
- both 模式下 comment 内容去掉 suggestedClauseText 段（同 8.3.6）
- LLM 输出 `suggestedClauseText` 含换行的：v1 直接 schema reject 让 LLM 重生成（同 8.3.3）；v2 再支持多段插入

### 8.5 验证

- [ ] 输出 docx 用 mammoth round-trip：parse → re-serialize 成功
- [ ] 用 Python python-docx 打开 docx：能识别 `<w:ins>` / `<w:del>` 元素，author 和 date 正确
- [ ] 用 Word 桌面版（Windows + macOS）打开：不报损坏、修订面板显示 ins/del、能正常接受/拒绝
- [ ] both 模式：redline 和 comment 的 `w:id` 不撞车（专项单测）
- [ ] 跨多 run 的 quote redline 后：律师 reject 修订，原 run 的字体格式（粗体/红色等）完整恢复

---

## 9. Phase B 锚点迁移升级

### 9.1 现状

`uploadClientVersion.service.ts` 用 `r.anchorQuote.includes(oldClauseHead)` + 模糊匹配，把客户回传的新 docx 里旧 risk 的位置迁移过去。

### 9.2 双锚点优先级

前置：客户新 docx 解析后用 `segmentClauses` 重新切分得到 `newSegments[]`（与首次审查走同一管线，结果是新的 clauseIndex / clauseText / clauseCharStart-End）。

迁移每条旧 risk：

1. **档 1：用 `existing.problematicQuote` 在客户新 docx normalizedText 上做 dmp 模糊匹配**
   - 命中位置 `quoteHitOffset` → 在 `newSegments[]` 里找包含 `quoteHitOffset` 的 segment：
     ```
     const newSegment = newSegments.find(s => s.charStart <= quoteHitOffset && quoteHitOffset < s.charEnd)
     ```
   - 找到 → 写入：`clauseIndex = newSegment.index` / `clauseText = newSegment.text` / `clauseCharStart/End = newSegment.charStart/End` / `problematicQuote` 重新摘录 / `quoteCharStart/End` 重算（在新 clauseText 里的相对 offset）
   - 找不到（quote 落在 segment 边界外）→ 视为档 1 失败，进档 2

2. **档 2：用 `existing.clauseText` 在客户新 docx normalizedText 上做 dmp 模糊匹配**
   - 命中位置 `clauseHitOffset` → 同样在 `newSegments[]` 里找包含 `clauseHitOffset` 的 segment
   - 找到 → 写入新 `clauseText`、`clauseCharStart/End`，**置 `problematicQuote = null` / `quoteCharStart/End = null` / `quoteMatchSource = null`**（迁移后 quote 失效，律师下次手动 PATCH 或下次全局重审重生）

3. **档 3：两档都失败 → `orphaned = true`**，保留旧 clauseText / problematicQuote 不变（孤立批注区展示用）

为什么优先 quote：精确句子比整段更稳定（条款里其它字改了，只要"导致风险的那句话"还在就能锚住）；clauseText 含整段更易因字面变化失败。

> **注意**：档 1 / 档 2 都依赖客户新 docx 重新跑一次 segmentClauses（与首次审查同算法，结果可重现）；这步是 Phase B 客户回传链路的必经动作（uploadClientVersion 现有逻辑也调用 segmentClauses 做 oldClauses vs newClauses diff），新方案复用同一份 newSegments 即可，无额外开销。

### 9.3 originalClauseText 写入

迁移时如果 `clauseText` 变化（`existing.clauseText !== matchedClauseText`），把 `existing.clauseText` 写入 `originalClauseText` 字段（保留原文供 UI"原文已修改"提示）。

---

## 10. 测试策略

### 10.1 单元测试

| 文件 | 覆盖 |
|---|---|
| `splitSentences.test.ts` | 中文断句规则：分号 / 子项编号 / 嵌套 / 引号内分号不切 / 连续分号 |
| `resolveQuoteAnchor.test.ts` | 三档 fallback：sentence_id 命中 / fuzzy 命中 / 全失败降级；**重点：pattern.length > 32（合同长 quote）走 anchor locate 路径；Match_Distance 设置后长条款末尾 quote 能找到；getDmp 共享实例参数恢复**（保护 calcSimilarity 不被污染） |
| `contractRisk.service.test.ts` | persistAiRisksAsContractRows 双锚点字段写入（已有，需扩展新字段断言） |
| `partyDetector.test.ts` | 正则命中 + LLM 推 contractType / 正则失败 + LLM 全识别 / LLM 失败 + 正则降级 |
| `redlineInjector.test.ts` | OOXML 输出验证：① `<w:ins>` / `<w:del>` / `<w:delText>` 标签结构；② **`w:id` 跨 bookmark / comment / ins / del 不撞车**（专项）；③ **跨多 run 的 quote 拆分后保留各 run 的 `<w:rPr>`**；④ **`xml:space="preserve"` 在所有 `<w:t>` / `<w:delText>` 都加**；⑤ **完整 clause 删除时 `<w:pPr><w:rPr><w:del/></w:rPr></w:pPr>` 段落标记同步**；⑥ both 模式 comment 包裹 `<w:del>` + `<w:ins>` 整体；⑦ LLM 输出含 `\n` 的 suggestedClauseText 被 schema reject |
| `docxPreview.highlight.test.ts`（前端） | computeQuoteRange 算法：① clause_text 含 `\n` 跨多 `<p>` 的 offset 对齐；② quote 起止落在 run 内部时 Range 正确；③ quote=null 时不创建 Highlight；④ 重渲染后 clearAllQuoteHighlights 清干净；⑤ CSS.highlights 不可用时 return 早出（不渲染字符级高亮，回到段落级） |

### 10.2 集成测试

| 场景 | 验证 |
|---|---|
| 上传 → AI 审查 → 检查 contract_risks 行 | clauseText / problematicQuote / quote_match_source 三档分布合理 |
| 上传 → 切换 layout A↔C | 前端切换流畅 / localStorage 偏好持久 |
| 下载（comment / redline / both） | 文件能用 Word 打开 / 修订标记正确显示 |
| Phase B 客户回传 + 双锚点迁移 | 优先 quote 命中率 / fallback 到 clause 命中率 / orphaned 率 |

### 10.3 运维埋点

`quote_match_source` 列上线后用 SQL 监控：

```sql
SELECT quote_match_source, COUNT(*), ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct
FROM contract_risks
WHERE source = 'ai' AND created_at > NOW() - INTERVAL '7 days'
GROUP BY quote_match_source
ORDER BY COUNT(*) DESC;
```

期望分布（理想）：`sentence_id` ≥ 80%，`fuzzy` ≤ 15%，`fallback` ≤ 5%。
监控阈值：`fallback` > 10% 时复查 prompt / 切句规则。

### 10.4 e2e 测试

`tests/e2e/contract-review-precise-anchoring.test.ts`：
- 上传 → 等审查完成 → 点击风险卡 → 验证 quote 高亮在 DocxPreview 出现
- 切换 layout A↔C → 验证 UI 渲染
- 切换下载模式（comment / redline / both） → 下载 → 用 mammoth 解析 docx 验证修订标签

---

## 11. PR 拆分顺序

| # | PR | 内容 | 预计工作量 |
|---|---|---|---|
| 1 | `pre-1-party-detector-fix` | partyDetector 修复（删短路 + LLM hint 注入）+ 测试 | 0.5 天 |
| 2 | `sub-1-data-model-refactor` | Prisma schema 重构 + 迁移 + truncate + service/dao 改名 + 类型 | 1.5 天 |
| 3 | `sub-1-route2-anchoring` | splitSentences + resolveQuoteAnchor（含 32 字符 anchor + Match_Distance + textSimilarity 单例隔离）+ prompt 改造 + risksSchema 扩展 + 单测 | 2.5 天 |
| 4 | `sub-1-frontend-risk-card` | RiskCard Layout A + C 切换 + RiskListPanel 适配 + e2e | 2 天 |
| 5 | `sub-1-docx-preview-highlight` | computeQuoteRange 算法 + CSS Custom Highlight API 主路径 + DOM-mutate fallback + 重渲染保护 + 视觉态矩阵 | 1.5 天 |
| 6 | `sub-1-redline-export` | redlineInjector（findMaxSharedId 扫描共享 ID 池 + 跨 run split + 完整 clause 删除段落标记 + xml:space + 输入清理）+ commentInjector 改造接受 idStart 参数 + 下载模式 toggle + 后端 API + Word 实测 | 3.5 天 |
| 7 | `sub-1-phase-b-dual-anchor` | uploadClientVersion 锚点迁移升级 + 双锚点优先级 | 2 天 |

**总计**：13.5 天工作量。

### 11.1 依赖关系

- PR 1（PRE-1）完全独立，可单独发布并立即生效（playbook 立刻恢复参与 prompt）
- PR 2 必须先于 PR 3-7（数据模型不重构后续都无依据）
- PR 3 必须先于 PR 4-6（前端要消费新字段、redlineInjector 要消费 quote）
- PR 5（前端字符级高亮）和 PR 6（OOXML redline）**没有代码依赖**——分别跑在 DOM Range 和 XML AST 两套数据结构上，算法不可复用；建议同人承接是为了 mental model 共享，不是必须

### 11.2 发布顺序约束（关键）

**PR 2-4 必须捆绑发布在同一窗口**，不能严格"独立可发布"——原因：PR 2 落地后 `anchor_*` 字段被 drop，旧前端代码（仍在读 `anchorQuote` / `anchorParagraphIndex`）会立刻 NPE。三种发布策略：

| 策略 | 描述 | 优劣 |
|---|---|---|
| **A. 三 PR 同窗口发布**（推荐） | PR 2/3/4 合并到一个 release tag 同时上线 | 简单；窗口期略长 |
| **B. 别名兼容层** | PR 2 后端 mapper 临时输出新+旧字段（旧字段名作 alias），PR 4 后端 mapper 删 alias | 多写一层兼容代码；后续要清理 |
| **C. Feature flag** | PR 2-4 都先合代码不上线，最后 flag 一次性打开 | 适合大版本；当前 PR 体量不必 |

选择 **A**：PR 1（PRE-1）和 PR 7（Phase B 升级）独立发布；PR 2/3/4 同窗口；PR 5/6 各自独立。

### 11.3 truncate 的执行确认

§4.3 的 `TRUNCATE TABLE contract_risks, contract_annotations, contract_review_versions CASCADE` 执行前必须确认"合同审查模块未对外上线"。迁移脚本随 `prisma/migrations/<ts>_refactor_contract_risks_dual_anchor/migration.sql` 一起 commit，配合 `bun run prisma:migrate -- --create-only --name refactor_contract_risks_dual_anchor` 流程 review 后再 apply。

---

## 12. 风险点与 mitigation

| 风险 | 影响 | mitigation |
|---|---|---|
| DeepSeek-v4-flash 不严格遵守 sentence_id 输出 | sentence_id 命中率低，fuzzy 兜底压力大 | 上线后用 quote_match_source 埋点观察；若 fallback > 20% 改 prompt 加 example / 改 model |
| OOXML redline 实现踩 Word 兼容性坑 | 修订模式打开错位 / 丢标记 | 用 mammoth 解析自己输出的 docx 做 round-trip 测试；准备一组 fixture 合同；用 Word 桌面版（Win + macOS）实测 |
| **`w:id` 跨元素 ID 池冲突** | both 模式下 redline + comment 撞 id → Word 拒打开 | findMaxSharedId 扫描所有共享 ID 池元素；redline 先跑返回 nextIdAfter，commentInjector 改造后从 nextIdAfter 接力；专项单测 |
| **跨 run quote 不保留 `<w:rPr>`** | 律师拒绝修订后字体格式（粗体/字号/颜色）丢失 | run 拆分时 deep-copy 原 `<w:rPr>` 副本到每个 delText run；fixture 测试含粗体 + 红色 quote |
| **suggestedClauseText 含换行** | Word 渲染时换行变空格丢段落 | risksSchema.builder 的 refine 强制 reject 含 `\n` 的输出；prompt 加约束让 LLM 输出单段；v2 再支持多段 |
| **`w:t` / `<w:delText>` 缺 `xml:space="preserve"`** | quote 含空白字符时 XML 解析丢空格 | redlineInjector 所有写文本节点统一用 `makeTextElement` helper 强制带属性 |
| **CSS Custom Highlight API 浏览器不支持** | 前端字符级高亮失效（降级到段落级） | 检测 `'highlights' in CSS` → 不支持直接 return 不渲染字符级；段落级浅黄高亮仍然生效（=quote=null 降级路径，与现状视觉一致） |
| **clause_text 含 `\n` 跨多 `<p>` 对齐错位** | 字符级高亮位置错 | computeQuoteRange 算法明确按 `\n` 拆行映射；e2e 测试覆盖跨段 quote |
| Phase B 双锚点迁移逻辑改动大易回归 | 客户回传链路炸 | 先在 Phase B 测试 fixture 全量过一遍；保留旧逻辑作为 feature flag 兜底 1 周 |
| 命名重构 anchor → clause 影响面广 | 漏改某处 → 编译通不过 | 一次性完成 + 全量 typecheck + 测试 |
| Layout C 内联 diff 中 dmp 跨段标点变化导致诡异 diff | 律师困惑 | dmp 设置 timeout=0.1 + diff_cleanupSemantic；提供 fallback 到 Layout A 的退路 |
| dmp 共享单例参数被污染 | calcSimilarity 等其他调用方读到错的 Match_Threshold/Distance | resolveQuoteAnchor 用 try/finally 保存恢复参数；专项单测 |

---

## 13. 已知不做的事 / 后续路线

### 13.1 SUB-2~6 留作

合同审查模块对标市场升级 brainstorm 阶段确认的整体路线图，每个子项目独立 spec → plan → 实施：

- **SUB-2 关键条款抽取（Term Extraction）**：合同金额 / 期限 / 付款方式 / 违约金 / 保密期 / 终止 / 管辖 → 结构化卡片
- **SUB-3 缺失条款检测（Issue Spotting）**：playbook 反向，未命中的"必有"要点 → 标 `source='missing'` 的风险卡
- **SUB-4 合同问答（Chat with Contract）**：RAG 化合同正文 + 条款级溯源回答
- **SUB-5 执行摘要 2.0**：现有 highlights+overall → 商业要点 / 风险评级 / 谈判要点 三段卡片
- **SUB-6 谈判 fallback position**：每条 risk 给 `{ ideal, acceptable, fallback }` 三档建议

依赖：SUB-2/3/4 互相独立可并行；SUB-5 依赖 SUB-2 商业要点 + SUB-3 缺失条款 + SUB-6 fallback；SUB-6 依赖 SUB-1 精准 quote。

### 13.2 SUB-1 内部不做的事

- "一键接受所有 AI 修订"按钮（律师批量接受 redline）
- 修订模式下的"评论 + 修订"对话线（comment 仍只在 comment 模式有）
- 修订作者多元（当前固定 author="LexSeek"，未来按律师姓名）
- LLM 自评（输出 sentence_id 后再让 LLM 验证片段是否真的对应）

