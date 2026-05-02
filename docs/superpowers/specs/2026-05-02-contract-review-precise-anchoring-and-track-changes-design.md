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
        return {
            // 正则结果作为 fallback——LLM 没输出但正则有则用正则
            partyA: result.partyA ?? matchA ?? null,
            partyB: result.partyB ?? matchB ?? null,
            contractType: result.contractType ?? null,
            source: (matchA && matchB) ? 'regex+llm' : 'llm',
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

- [ ] 正则命中甲乙方但 LLM 失败 → 回退到正则结果（不退化）
- [ ] 正则命中甲乙方 + LLM 成功 → contractType 不再 null
- [ ] 正则未命中 → 走原 LLM 全识别路径
- [ ] `source` 字段值新增 `regex+llm`（仅作为 PartyDetectionResult 内存返回值；调用方 `parseAndAskStance.tool.ts` 用 `logger.info` 落日志便于线上观察 regex/llm 一致率，不入 DB）

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
| `clause_index` | INT NOT NULL | 条款序号（segmentClauses 产出，1-based） |
| `clause_text` | TEXT NOT NULL | 完整条款原文（=segment.text） |
| `clause_paragraph_index` | INT | 非空段落序号（commentInjector 期望空间） |
| `clause_char_start` | INT | 在文档全文 normalizedText 里的 offset |
| `clause_char_end` | INT | 同上 |
| `problematic_quote` | TEXT | 精确问题片段（路线 2 产物，NULL = 解析全失败降级） |
| `quote_char_start` | INT | 在 `clause_text` 内的相对 offset（不是文档全文！） |
| `quote_char_end` | INT | 同上 |
| `quote_match_source` | VARCHAR(20) | `sentence_id` / `fuzzy` / `fallback`（运维埋点） |
| `original_clause_text` | TEXT | 客户回传迁移前的原 `clause_text`（原 `original_anchor_quote` 改名） |

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
  /// 条款序号（segmentClauses 产出）
  clauseIndex          Int    @map("clause_index")
  /// 完整条款原文（segmentClauses 产出的 segment.text）
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

合同审查功能未上线，老数据可丢。迁移做：

1. `bun run prisma:migrate --name refactor_contract_risks_dual_anchor --create-only` 生成迁移
2. 手工编辑迁移 SQL：
   ```sql
   -- 1. drop 老字段
   ALTER TABLE "contract_risks" DROP COLUMN "anchor_quote";
   ALTER TABLE "contract_risks" DROP COLUMN "anchor_paragraph_index";
   ALTER TABLE "contract_risks" DROP COLUMN "anchor_char_start";
   ALTER TABLE "contract_risks" DROP COLUMN "anchor_char_end";
   ALTER TABLE "contract_risks" DROP COLUMN "original_anchor_quote";
   -- 2. truncate 已有数据（用户同意）
   TRUNCATE TABLE "contract_risks", "contract_annotations" CASCADE;
   -- 3. 新增字段
   ALTER TABLE "contract_risks" ADD COLUMN "clause_index" INT NOT NULL;
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

### 5.1 切句规则（splitSentences）

新建 `server/agents/contract/utils/splitSentences.ts`：

```ts
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
 * 中文合同条款断句：分号 + 句号/问号/感叹号 + 换行 + 子项编号行首
 *
 * 切分点：
 * - `。！？；` + `\n`
 * - 行首子项编号：`^\s*[（(]?(?:[一二三四五六七八九十]+|\d+(\.\d+)*|[a-zA-Z])[）)]?[、.\s]`
 *
 * 不切分：逗号、顿号、引号内/括号内
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

新建 `server/agents/contract/utils/resolveQuoteAnchor.ts`：

```ts
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
    // 档 1：sentence_id 主路径
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

    // 档 2：fuzzy match fallback
    const quote = input.aiOutput.problematicQuote?.trim()
    if (quote && quote.length >= 4) {
        const offset = fuzzyMatchOffset(input.clauseText, quote)
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

/** 用 diff-match-patch 找最相似 substring */
function fuzzyMatchOffset(text: string, pattern: string): { start: number; end: number } | null {
    // 用 dmp.match_main 找 substring 起点（双向 Bitap + Levenshtein）
    // Match_Threshold 默认 0.5（越小越严格），合同场景设 0.3 更稳
}
```

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

风险卡展开后：

```
┌─────────────────────────────────────────────────┐
│ [中] 违约金  [📋 命中清单 · payment_default]      │
│ 逾期付款违约金过低，对乙方追讨成本不足            │
├─────────────────────────────────────────────────┤
│ 📄 条款标题                                       │
│ 第三条 工资支付（第 5 段）                         │
│                                                  │
│ 📜 完整原文                                       │
│ ┌─────────────────────────────────────────────┐ │
│ │ 工资按月支付。 [深黄底高亮 quote 字符段]      │ │
│ │ 工资按月底前最后一个工作日结算；逾期支付的，  │ │
│ │ 每日按 0.05% 加收滞纳金 [/高亮]。乙方有权追讨。│ │
│ └─────────────────────────────────────────────┘ │
│                                                  │
│ ⚠️ 问题片段                                       │
│ ┌─────────────────────────────────────────────┐ │
│ │ "工资按月底前最后一个工作日结算；逾期支付的， │ │
│ │  每日按 0.05% 加收滞纳金"                    │ │
│ └─────────────────────────────────────────────┘ │
│                                                  │
│ ✏️ 建议改写                                       │
│ ┌─────────────────────────────────────────────┐ │
│ │ 工资按月底前最后一个工作日结算；逾期支付的，  │ │
│ │ 每日按 **0.5%** 加收滞纳金，且累计逾期超 30   │ │
│ │ 日的，乙方有权解除合同。                     │ │
│ └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

### 6.2 Layout C（Inline diff，可切）

```
┌─────────────────────────────────────────────────┐
│ [中] 违约金  [📋 命中清单 · payment_default]      │
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

`DocxPreview.vue` 用 `docx-preview` 库渲染 docx，按 `anchorParagraphIndex` 给段落加黄色背景。

### 7.2 升级

双层渐进高亮：
- 段落级（浅黄底 `bg-yellow-50/40`）：clause_paragraph_index 命中
- 字符级（深黄底 `bg-yellow-300/60`）：quote_char_start..quote_char_end 命中

实现思路：
1. 找到 `<w:p>` 对应的 DOM 元素（段落级，已有逻辑）
2. 在该段落内根据 `quote_char_start/end`（在 clause_text 内的相对 offset）→ 计算在段落 textContent 里的 offset
3. **手动 split text node + insert span**：遍历段落内 text node，累加字符数找到 quote 起止位置；分别拆 startOffset / endOffset 的 text node；中间所有 node（含跨多个 `<w:r>` run 的）外包 `<span class="quote-highlight">`（不能用 `Range.surroundContents`，它不支持跨多节点）

边角情况：
- quote=null 时只做段落级浅黄高亮（=现状）
- quote 起止偏移落在段落空白字符（如换行 / 制表符）→ 自动 trim 到最近非空字符
- 段落 textContent 长度 < quote_char_end → 写日志告警 + 降级到段落级高亮（不该出现，但兜底）

### 7.3 焦点动画

点击风险卡时（focusedRiskId 变化）：
- 滚动到段落
- quote 高亮加 `animate-pulse` 1 秒（CSS animation）
- pin 状态保持深黄；focus 状态深红边框

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

新建 `server/agents/contract/docx/redlineInjector.ts`：

```ts
export async function injectRedlineMarks(
    docxBuffer: Buffer,
    risks: ContractRiskEntity[],
    options: { author: string; reviewId: number }
): Promise<{ buffer: Buffer; warnings: string[] }>
```

对每个有 `problematicQuote` + `suggestedClauseText` 的 risk：
1. 找到 quote 在 docx `<w:p>` 里的字符 offset（用 quote_char_start/end + clauseParagraphIndex）
2. 把 quote 字符段拆出独立 `<w:r>`
3. **整段替换策略**（v1）：删除整个 `problematicQuote`、新增整个 `suggestedClauseText`（不做字符级 inline diff）：
   ```xml
   <w:del w:id="N" w:author="LexSeek" w:date="...">
     <w:r><w:delText xml:space="preserve">[完整 problematicQuote 文字]</w:delText></w:r>
   </w:del>
   <w:ins w:id="N+1" w:author="LexSeek" w:date="...">
     <w:r><w:t xml:space="preserve">[完整 suggestedClauseText]</w:t></w:r>
   </w:ins>
   ```
   选择整段替换的理由：① 实现简单可靠，每个 risk 只产生一对 ins/del；② Word 接受/拒绝时律师可整条决策；③ 字符级 inline diff（用 dmp 拆 ins/del 多段）留作 v2 优化项
4. mode='both' 时同时挂 comment（现有 commentInjector 逻辑），mode='redline' 时只 redline 不 comment
5. `w:id` 在文档内唯一递增（从现有 `<w:document>` 里最大 id + 1 起）；`w:author` 固定 "LexSeek"（v2 按律师姓名）；`w:date` ISO 8601

### 8.4 边角

- quote=null 的 risk：redline 模式下只挂 comment（无锚点不能 redline）
- suggestedClauseText 为 low risk 没填的：跳过 redline，但仍挂 comment
- both 模式下 comment 文本去掉 suggestedClauseText 段（避免和 redline 重复显示）

---

## 9. Phase B 锚点迁移升级

### 9.1 现状

`uploadClientVersion.service.ts` 用 `r.anchorQuote.includes(oldClauseHead)` + 模糊匹配，把客户回传的新 docx 里旧 risk 的位置迁移过去。

### 9.2 双锚点优先级

新逻辑：
1. **优先用 `problematicQuote`** 在客户新 docx 里做 dmp 模糊匹配
   - 命中 → 取上下文找 `clauseText` 在新 docx 里的位置 → 写入新 `clauseText` / `clauseCharStart/End` / `problematicQuote` / `quoteCharStart/End`
2. **fallback：用 `clauseText` 模糊匹配**
   - 命中 → 写入新 clauseText，**置 `problematicQuote = null`**（迁移后 quote 失效；下次审查会重新分析）
3. **都失败 → `orphaned = true`**

为什么优先 quote：精确句子比整段更稳定（条款里其它字改了，只要"导致风险的那句话"还在就能锚住）。

### 9.3 originalClauseText 写入

迁移时如果 `clauseText` 变化（`existing.clauseText !== matchedClauseText`），把 `existing.clauseText` 写入 `originalClauseText` 字段（保留原文供 UI"原文已修改"提示）。

---

## 10. 测试策略

### 10.1 单元测试

| 文件 | 覆盖 |
|---|---|
| `splitSentences.test.ts` | 中文断句规则：分号 / 子项编号 / 嵌套 / 引号内分号不切 / 连续分号 |
| `resolveQuoteAnchor.test.ts` | 三档 fallback：sentence_id 命中 / fuzzy 命中 / 全失败降级 |
| `contractRisk.service.test.ts` | persistAiRisksAsContractRows 双锚点字段写入（已有，需扩展新字段断言） |
| `partyDetector.test.ts` | 正则命中 + LLM 推 contractType / 正则失败 + LLM 全识别 / LLM 失败 + 正则降级 |
| `redlineInjector.test.ts` | OOXML 输出验证：`<w:ins>` / `<w:del>` / `<w:delText>` 标签结构 |

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
| 1 | `pre-1-party-detector-fix` | partyDetector 修复 + 测试 | 0.5 天 |
| 2 | `sub-1-data-model-refactor` | Prisma schema 重构 + 迁移 + truncate + service/dao 改名 + 类型 | 1.5 天 |
| 3 | `sub-1-route2-anchoring` | splitSentences + resolveQuoteAnchor + prompt 改造 + risksSchema 扩展 + 单测 | 2.5 天 |
| 4 | `sub-1-frontend-risk-card` | RiskCard Layout A + C 切换 + RiskListPanel 适配 + e2e | 2 天 |
| 5 | `sub-1-docx-preview-highlight` | 字符级高亮 + 焦点动画 | 1 天 |
| 6 | `sub-1-redline-export` | redlineInjector + 下载模式 toggle + 后端 API | 2.5 天 |
| 7 | `sub-1-phase-b-dual-anchor` | uploadClientVersion 锚点迁移升级 + 双锚点优先级 | 2 天 |

**总计**：12 天工作量。每个 PR 独立可发布 / 可回滚。1+2+3 是基础（前后端断开会有空窗），4-7 可在 3 之后任意顺序。

---

## 12. 风险点与 mitigation

| 风险 | 影响 | mitigation |
|---|---|---|
| DeepSeek-v4-flash 不严格遵守 sentence_id 输出 | sentence_id 命中率低，fuzzy 兜底压力大 | 上线后用 quote_match_source 埋点观察；若 fallback > 20% 改 prompt 加 example / 改 model |
| OOXML redline 实现踩 Word 兼容性坑 | 修订模式打开错位 / 丢标记 | 用 mammoth 解析自己输出的 docx 做 round-trip 测试；准备一组 fixture 合同 |
| Phase B 双锚点迁移逻辑改动大易回归 | 客户回传链路炸 | 先在 Phase B 测试 fixture 全量过一遍；保留旧逻辑作为 feature flag 兜底 1 周 |
| 命名重构 anchor → clause 影响面广 | 漏改某处 → 编译通不过 | 一次性完成 + 全量 typecheck + 测试 |
| Layout C 内联 diff 中 dmp 跨段标点变化导致诡异 diff | 律师困惑 | dmp 设置 timeout=0.1 + diff_cleanupSemantic；提供 fallback 到 Layout A 的退路 |

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

---

## 14. 附录 · 命名词典

| 旧名 | 新名 | 备注 |
|---|---|---|
| `anchor_quote` | `clause_text` | 完整条款原文 |
| `anchor_paragraph_index` | `clause_paragraph_index` | 非空段落序号 |
| `anchor_char_start/end` | `clause_char_start/end` | 在文档全文 offset |
| `original_anchor_quote` | `original_clause_text` | Phase B 锚点迁移痕迹 |
| —（新增） | `problematic_quote` | 精确问题片段 |
| —（新增） | `quote_char_start/end` | 在 clause 内相对 offset |
| —（新增） | `quote_match_source` | 解析来源运维埋点 |
| —（新增） | `clause_index` | 条款序号 |

代码层面：所有 `anchor*` 标识符改名 `clause*`（DAO / Service / Type / 前端）。一次性 search-replace + 测试覆盖。

用户语言层面：UI 仍叫"原文条款"+"问题片段"+"建议改写"，不暴露 `anchor` / `clause` / `quote` 等技术词。
