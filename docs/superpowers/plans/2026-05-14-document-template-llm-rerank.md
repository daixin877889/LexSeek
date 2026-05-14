# 文书模板 LLM Rerank 推荐 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把现有"纯关键字打分推荐文书模板"升级为"粗筛召回 30 条 → LLM 基于案件上下文 rerank 选 top 5"的两阶段架构，让推荐质量真正受益于案件信息。

**Architecture:**
- **第 1 步（粗筛）**：现有 `recommendDocumentTemplatesService` 继续按 keyword 命中 / category 缩范围 / 最近使用打分，但 limit 提到 30 条返回。Item 新增 `recentlyUsed` 字段透传给后续步骤。
- **第 2 步（精排 / rerank）**：新建 `rerankTemplatesService`，复用 documentMain 节点的同款大模型，把【案件 4 段 + 用户最新一句话 + 30 条候选 name/description】喂给 LLM，让 LLM 输出 top 5 排序。**调用骨架直接对照 `server/services/retrieval/intentClassifier.service.ts` 已有的 `.withStructuredOutput()` + Zod schema 写法。**
- **工具串接**：`recommend_template` 工具内部按"粗筛 → rerank → interrupt 弹卡片"三步走；rerank 全程加 4 类 fallback（LLM 抛错 / 超时 / 输出空 / 校验后不足），任何失败都回退到现有评分公式的 top 5，用户体验只会"退化到现状"而不会出错。

**Tech Stack:**
- LangChain `.withStructuredOutput()` 强制 JSON 输出（防 LLM 编自由文本）
- `createChatModel` 创建独立 LLM 实例（streaming=false、temperature=0.1）
- 复用 `buildContextSegments` 拉案件 4 段、复用 `getValidNodeConfig('documentMain')` 拿模型配置
- AbortController + setTimeout 实现 15s 硬超时
- Vitest mock `createChatModel` / `getValidNodeConfig` / `buildContextSegments` 做单元测试

---

## File Structure

**Create:**
- `server/agents/document/templateRerank.service.ts` — LLM rerank 服务（新建，约 200 行）
- `tests/server/assistant/document/templateRerank.service.test.ts` — rerank 服务单测（新建，10 个用例）

**Modify:**
- `server/agents/document/templateRecommend.service.ts` — `TemplateRecommendItem` 加 `recentlyUsed` 字段；`limit` 上限从 20 提到 50（足以覆盖决策的 30 候选）
- `server/services/agent-platform/tools/recommendTemplate.tool.ts` — 工具内插入 rerank 阶段，加入参/出参日志
- `tests/server/assistant/document/templateRecommend.service.test.ts` — 新增 1 个用例覆盖 `recentlyUsed` 字段（粗筛 limit 是否生效由工具层测试覆盖，不在 service 层做 ORM 代理测试）
- `tests/server/agent-platform/tools/recommendTemplate.test.ts` — 改造现有 3 个用例适配新流程，加 1 个 rerank fallback 用例 + 校验"工具调粗筛 service 时传 limit=30"

**Untouched（重要 — 这些不动）:**
- 前端 `TemplateSelectCard.vue` / `RecommendTemplateCard.vue` — interrupt payload 完全兼容（只是 recommendations 数组里多了一个可选字段，前端忽略即可）
- 数据库 schema — 不加表、不加字段、不跑 migration
- `documentMainAgent.ts` — Agent 层不动，所有改动锁在工具层

---

## Task 1：扩展粗筛 Service 返回 recentlyUsed + 提高 limit 上限

**Files:**
- Modify: `server/agents/document/templateRecommend.service.ts:42-51`（TemplateRecommendItem 接口）
- Modify: `server/agents/document/templateRecommend.service.ts:155`（limit clamp）
- Modify: `server/agents/document/templateRecommend.service.ts:227-235`（items 映射）
- Test: `tests/server/assistant/document/templateRecommend.service.test.ts`（追加 1 个用例）

- [ ] **Step 1.1：先把 recentlyUsed 字段的失败测试写出来**

在 `tests/server/assistant/document/templateRecommend.service.test.ts` 文件**末尾**（第 379 行 `})` 闭合 describe 之前）追加：

```typescript
    it('10. items 中的 recentlyUsed 标记最近 30 天用过的模板', async () => {
        const user = await createTestUser()
        testIds.userIds.push(user.id)

        const used = await createTpl({ name: '近期合同', category: 'general' })
        const unused = await createTpl({ name: '其他合同', category: 'general' })
        await createDraftWithTemplate(user.id, used.id, 5)

        const r = await recommendDocumentTemplatesService({
            userId: user.id,
            intent: '合同',
            keywords: ['合同'],
            limit: 20,
        })

        const usedItem = r.items.find(i => i.id === used.id)
        const unusedItem = r.items.find(i => i.id === unused.id)
        expect(usedItem!.recentlyUsed).toBe(true)
        expect(unusedItem!.recentlyUsed).toBe(false)
    })
```

> 说明：原 case 11（验证 limit=30 返回 25 条）已砍掉——那是测 Prisma findMany 行为（ORM 代理），项目 testing.md 明文禁止。limit=30 实际生效与否由工具层测试 `recommendTemplate.test.ts` 的"成功路径"用例校验（断言 `mock.calls[0][0].limit === 30`）。

- [ ] **Step 1.2：跑新增用例确认失败**

```bash
npx vitest run tests/server/assistant/document/templateRecommend.service.test.ts -t '10. items 中的 recentlyUsed' --reporter=verbose
```

期望：报 `expect(usedItem!.recentlyUsed).toBe(true)` → 实际 `undefined`。

- [ ] **Step 1.3：修改 TemplateRecommendItem 接口**

把 `server/agents/document/templateRecommend.service.ts:42-51`：

```typescript
export interface TemplateRecommendItem {
    id: number
    name: string
    category: string
    scope: string
    description: string | null
    priority: number
    /** 评分（用于调试 / 透传到前端做次序解释） */
    score: number
}
```

改为：

```typescript
export interface TemplateRecommendItem {
    id: number
    name: string
    category: string
    scope: string
    description: string | null
    priority: number
    /** 评分（用于调试 / 透传到前端做次序解释） */
    score: number
    /** 当前查看用户最近 30 天内是否用过该模板（rerank 阶段会读） */
    recentlyUsed: boolean
}
```

- [ ] **Step 1.4：放开 limit 上限**

把 `server/agents/document/templateRecommend.service.ts:155`：

```typescript
    const limit = Math.max(1, Math.min(20, input.limit ?? 5))
```

改为：

```typescript
    const limit = Math.max(1, Math.min(50, input.limit ?? 5))
```

> 决策值是 30 候选，上限设 50 已远高于实际需要，不暴露过宽接口给后续误用。

- [ ] **Step 1.5：items 映射时写入 recentlyUsed**

把 `server/agents/document/templateRecommend.service.ts:227-235`：

```typescript
    const items = scored.slice(0, limit).map(({ tpl, score }) => ({
        id: tpl.id,
        name: tpl.name,
        category: tpl.category,
        scope: tpl.scope,
        description: tpl.description ?? null,
        priority: tpl.priority,
        score,
    }))
```

改为：

```typescript
    const items = scored.slice(0, limit).map(({ tpl, score }) => ({
        id: tpl.id,
        name: tpl.name,
        category: tpl.category,
        scope: tpl.scope,
        description: tpl.description ?? null,
        priority: tpl.priority,
        score,
        recentlyUsed: recentTemplateIds.has(tpl.id),
    }))
```

- [ ] **Step 1.6：跑全部 10 个粗筛 Service 单测确认通过**

```bash
npx vitest run tests/server/assistant/document/templateRecommend.service.test.ts --reporter=verbose
```

期望：全部 10 个用例 PASS（原 9 个 + 新 1 个 recentlyUsed）。

- [ ] **Step 1.7：Commit**

```bash
git add server/agents/document/templateRecommend.service.ts tests/server/assistant/document/templateRecommend.service.test.ts
git commit -m "$(cat <<'EOF'
feat(tools): 粗筛 Service 加 recentlyUsed 字段并放开 limit 上限至 50

- TemplateRecommendItem 增加 recentlyUsed 标志，给后续 rerank 阶段透传"用户最近用过"信号
- limit 上限从 20 提升到 50，让工具能传 limit=30 拿候选池给 rerank
EOF
)"
```

---

## Task 2：新建 rerank Service —— 类型骨架 + 短路分支

**Files:**
- Create: `server/agents/document/templateRerank.service.ts`
- Create: `tests/server/assistant/document/templateRerank.service.test.ts`

本任务只落"输入输出类型 + 候选为空 / 候选数 ≤ topN 两个不调 LLM 的短路分支"，让框架先跑起来；调 LLM 的核心逻辑在 Task 3 / 4 / 5 增量推进。

- [ ] **Step 2.1：写短路分支的失败测试**

新建文件 `tests/server/assistant/document/templateRerank.service.test.ts`：

```typescript
/**
 * 文书模板 rerank Service 单元测试
 *
 * **Feature: document-template-llm-rerank / Task 2-5**
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('~~/server/services/node/node.service', () => ({
    getValidNodeConfig: vi.fn(),
}))
vi.mock('~~/server/services/node/chatModelFactory', () => ({
    createChatModel: vi.fn(),
}))
vi.mock('~~/server/services/agent-platform/context/moduleContextBuilder', () => ({
    buildContextSegments: vi.fn(),
}))

import { rerankTemplatesService, type TemplateCandidate } from '~~/server/agents/document/templateRerank.service'

function makeCandidate(id: number, overrides: Partial<TemplateCandidate> = {}): TemplateCandidate {
    return {
        id,
        name: `模板${id}`,
        category: 'general',
        description: null,
        recentlyUsed: false,
        ...overrides,
    }
}

describe('rerankTemplatesService', () => {
    beforeEach(() => {
        vi.resetAllMocks()
    })

    it('候选为空：picks=[]、fallback=false、不调 LLM', async () => {
        const r = await rerankTemplatesService({
            userId: 1,
            sessionId: 's1',
            userQuery: '帮我写起诉状',
            intent: '起诉状',
            candidates: [],
        })
        expect(r.picks).toEqual([])
        expect(r.fallback).toBe(false)
    })

    it('候选数 ≤ topN：直接返回所有、fallback=false、不调 LLM', async () => {
        const r = await rerankTemplatesService({
            userId: 1,
            sessionId: 's1',
            userQuery: 'x',
            intent: 'x',
            candidates: [makeCandidate(10), makeCandidate(11), makeCandidate(12)],
            topN: 5,
        })
        expect(r.picks.map(p => p.templateId)).toEqual([10, 11, 12])
        expect(r.fallback).toBe(false)
    })
})
```

- [ ] **Step 2.2：跑测试验证失败**

```bash
npx vitest run tests/server/assistant/document/templateRerank.service.test.ts --reporter=verbose
```

期望：报 "Cannot find module '~~/server/agents/document/templateRerank.service'"。

- [ ] **Step 2.3：新建 rerank Service 骨架文件**

新建 `server/agents/document/templateRerank.service.ts`：

```typescript
/**
 * 文书模板 rerank Service
 *
 * 粗筛召回（templateRecommend.service）后由 LLM 基于【案件上下文 + 用户最新一句话】
 * 重新排序，返回 top N。失败 / 超时 / 编造 id / 输出空 全部 fallback 回粗筛顺序。
 *
 * 调用骨架（createChatModel + withStructuredOutput + Zod schema）参考：
 *   server/services/retrieval/intentClassifier.service.ts
 *
 * @see docs/superpowers/plans/2026-05-14-document-template-llm-rerank.md
 */

// ==================== 类型 ====================

export interface TemplateCandidate {
    id: number
    name: string
    category: string
    description: string | null
    /** 用户最近 30 天用过 */
    recentlyUsed: boolean
}

export interface RerankInput {
    userId: number
    /** 案件 ID，无案件场景（独立草稿）可缺省 */
    caseId?: number | null
    sessionId: string
    /** 用户最新一句话（rerank LLM 的核心信号） */
    userQuery: string
    /** LLM 在粗筛阶段抽出的意图（仅作上下文参考） */
    intent: string
    /** 待 rerank 的候选 */
    candidates: TemplateCandidate[]
    /** 最终输出条数（默认 5） */
    topN?: number
    /** rerank LLM 调用超时（默认 15000 ms） */
    timeoutMs?: number
}

export interface RerankPick {
    templateId: number
    /** LLM 给的简短理由（可选） */
    reason?: string
}

export type RerankFallbackReason =
    | 'timeout'
    | 'llm_error'
    | 'empty_output'
    | 'not_enough_valid_ids'

export interface RerankResult {
    picks: RerankPick[]
    /** 是否走了 fallback 路径（任意一种失败/降级） */
    fallback: boolean
    fallbackReason?: RerankFallbackReason
}

// ==================== 主入口 ====================

export async function rerankTemplatesService(input: RerankInput): Promise<RerankResult> {
    const { candidates, topN = 5 } = input

    // 1. 空候选 → 直接返回（不调 LLM）
    if (candidates.length === 0) {
        return { picks: [], fallback: false }
    }

    // 2. 候选数 ≤ topN → 全量返回（不需要 rerank）
    if (candidates.length <= topN) {
        return {
            picks: candidates.map(c => ({ templateId: c.id })),
            fallback: false,
        }
    }

    // 3. TODO（Task 3-5）：调 LLM rerank
    throw new Error('rerankTemplatesService: LLM rerank 未实现（Task 3-5 落地）')
}
```

- [ ] **Step 2.4：跑两个短路用例确认通过**

```bash
npx vitest run tests/server/assistant/document/templateRerank.service.test.ts --reporter=verbose
```

期望：两个用例 PASS。

- [ ] **Step 2.5：Commit**

```bash
git add server/agents/document/templateRerank.service.ts tests/server/assistant/document/templateRerank.service.test.ts
git commit -m "feat(tools): rerank service 骨架与两个短路分支（空候选 / 候选 ≤ topN）"
```

---

## Task 3：rerank Service —— LLM 调用主路径 + 输出校验

落 LLM rerank 的正常路径：拉案件上下文 + 取节点配置 + 创建 LLM + 构造 prompt + `.withStructuredOutput()` 调用 + 校验输出 id 在 candidate 集合内、去重、按 LLM 顺序返回 picks。

**Files:**
- Modify: `server/agents/document/templateRerank.service.ts`
- Modify: `tests/server/assistant/document/templateRerank.service.test.ts`

- [ ] **Step 3.1：先写 LLM 正常返回合法 id 的失败测试**

在 `templateRerank.service.test.ts` 的 `describe` 内追加：

```typescript
    it('LLM 正常返回 → picks 按 LLM 顺序、不走 fallback', async () => {
        const { getValidNodeConfig } = await import('~~/server/services/node/node.service')
        const { createChatModel } = await import('~~/server/services/node/chatModelFactory')
        const { buildContextSegments } = await import('~~/server/services/agent-platform/context/moduleContextBuilder')

        ;(getValidNodeConfig as any).mockResolvedValue({
            modelSdkType: 'openai',
            modelName: 'gpt-4o-mini',
            modelMaxOutputTokens: 4096,
            modelApiKeys: [{ status: 1, apiKey: 'sk-test' }],
            modelProviderBaseUrl: 'https://api.example.com',
        })
        ;(buildContextSegments as any).mockResolvedValue({
            roleAndFlow: '',
            caseProfile: '## 案件档案\n劳动纠纷',
            moduleSummaries: '',
            dynamicContext: '## 材料清单\n劳动合同.pdf',
        })

        // mock chat model：.withStructuredOutput(...).invoke(...) 返回 picks
        const invokeMock = vi.fn().mockResolvedValue({
            picks: [
                { templateId: 12, reason: '劳动相关' },
                { templateId: 10, reason: '次选' },
            ],
        })
        const withStructuredOutputMock = vi.fn().mockReturnValue({ invoke: invokeMock })
        ;(createChatModel as any).mockReturnValue({ withStructuredOutput: withStructuredOutputMock })

        const r = await rerankTemplatesService({
            userId: 1,
            caseId: 99,
            sessionId: 's1',
            userQuery: '帮我写劳动仲裁申请书',
            intent: '劳动仲裁',
            candidates: [
                makeCandidate(10, { name: '民事起诉状', category: 'litigation' }),
                makeCandidate(11, { name: '调解协议', category: 'general' }),
                makeCandidate(12, { name: '劳动仲裁申请书', category: 'labor' }),
                makeCandidate(13, { name: '股权转让协议', category: 'commercial' }),
                makeCandidate(14, { name: '辞职报告', category: 'labor' }),
                makeCandidate(15, { name: '探视协议', category: 'family' }),
            ],
            topN: 5,
        })

        expect(r.fallback).toBe(false)
        expect(r.picks.map(p => p.templateId)).toEqual([12, 10])
        expect(r.picks[0]!.reason).toBe('劳动相关')
        // 校验 LLM 被调用了，且 invoke 收到的 messages 里包含案件信息
        expect(invokeMock).toHaveBeenCalledOnce()
    })

    it('LLM 返回部分 id 编造（candidates 里没有）→ 过滤后仍 ≥3 → fallback=false', async () => {
        const { getValidNodeConfig } = await import('~~/server/services/node/node.service')
        const { createChatModel } = await import('~~/server/services/node/chatModelFactory')
        const { buildContextSegments } = await import('~~/server/services/agent-platform/context/moduleContextBuilder')
        ;(getValidNodeConfig as any).mockResolvedValue({
            modelSdkType: 'openai',
            modelName: 'gpt-4o-mini',
            modelMaxOutputTokens: 4096,
            modelApiKeys: [{ status: 1, apiKey: 'sk-test' }],
            modelProviderBaseUrl: 'https://api.example.com',
        })
        ;(buildContextSegments as any).mockResolvedValue({
            roleAndFlow: '', caseProfile: '', moduleSummaries: '', dynamicContext: '',
        })
        const invokeMock = vi.fn().mockResolvedValue({
            picks: [
                { templateId: 99999 },  // 编造
                { templateId: 10 },
                { templateId: 11 },
                { templateId: 88888 },  // 编造
                { templateId: 12 },
            ],
        })
        ;(createChatModel as any).mockReturnValue({
            withStructuredOutput: vi.fn().mockReturnValue({ invoke: invokeMock }),
        })

        const r = await rerankTemplatesService({
            userId: 1,
            sessionId: 's1',
            userQuery: 'x',
            intent: 'x',
            candidates: [
                makeCandidate(10),
                makeCandidate(11),
                makeCandidate(12),
                makeCandidate(13),
                makeCandidate(14),
                makeCandidate(15),
            ],
            topN: 5,
        })
        // 编造的 99999 / 88888 被过滤；合法 10/11/12 保留，3 条足够，不走 fallback
        expect(r.fallback).toBe(false)
        expect(r.picks.map(p => p.templateId)).toEqual([10, 11, 12])
    })

    it('LLM 返回重复 id → 去重保留首次', async () => {
        const { getValidNodeConfig } = await import('~~/server/services/node/node.service')
        const { createChatModel } = await import('~~/server/services/node/chatModelFactory')
        const { buildContextSegments } = await import('~~/server/services/agent-platform/context/moduleContextBuilder')
        ;(getValidNodeConfig as any).mockResolvedValue({
            modelSdkType: 'openai', modelName: 'gpt-4o-mini', modelMaxOutputTokens: 4096,
            modelApiKeys: [{ status: 1, apiKey: 'sk-test' }],
            modelProviderBaseUrl: 'https://api.example.com',
        })
        ;(buildContextSegments as any).mockResolvedValue({
            roleAndFlow: '', caseProfile: '', moduleSummaries: '', dynamicContext: '',
        })
        const invokeMock = vi.fn().mockResolvedValue({
            picks: [
                { templateId: 10, reason: '首次' },
                { templateId: 10, reason: '重复' },  // 重复
                { templateId: 11 },
                { templateId: 12 },
            ],
        })
        ;(createChatModel as any).mockReturnValue({
            withStructuredOutput: vi.fn().mockReturnValue({ invoke: invokeMock }),
        })

        const r = await rerankTemplatesService({
            userId: 1, sessionId: 's1', userQuery: 'x', intent: 'x',
            candidates: [makeCandidate(10), makeCandidate(11), makeCandidate(12), makeCandidate(13), makeCandidate(14), makeCandidate(15)],
            topN: 5,
        })
        expect(r.picks.map(p => p.templateId)).toEqual([10, 11, 12])
        expect(r.picks[0]!.reason).toBe('首次')  // 保留首次出现的 reason
        expect(r.fallback).toBe(false)
    })
```

- [ ] **Step 3.2：跑测试确认失败**

```bash
npx vitest run tests/server/assistant/document/templateRerank.service.test.ts --reporter=verbose
```

期望：3 个新用例 fail 在 `throw new Error('LLM rerank 未实现')`。

- [ ] **Step 3.3：实现 LLM 调用主路径**

把 `server/agents/document/templateRerank.service.ts` 末尾的 TODO 段（`throw new Error('rerankTemplatesService: LLM rerank 未实现...')`）替换为完整实现：

```typescript
// ==================== LLM 调用主路径 ====================

import { z } from 'zod'
import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import { getValidNodeConfig } from '~~/server/services/node/node.service'
import { createChatModel } from '~~/server/services/node/chatModelFactory'
import { buildContextSegments } from '~~/server/services/agent-platform/context/moduleContextBuilder'

const DOCUMENT_MAIN_NODE_NAME = 'documentMain'

const RerankOutputSchema = z.object({
    picks: z.array(z.object({
        templateId: z.number().int(),
        reason: z.string().optional(),
    })).max(10),
})

const SYSTEM_PROMPT = `你是法律文书模板推荐专家。用户正在律师文书生成助手中起草法律文书，
你需要根据【案件上下文】和【用户最新一句话】，从给定的候选模板中选出最合适的若干个模板。

判断维度（重要性递减）：
1. 模板是否切合用户最新一句话表达的文书起草需求
2. 模板适用的法律领域是否匹配案件类型（如劳动纠纷案件应优先劳动相关模板）
3. 模板是否适合当前案件所处阶段（起诉/答辩/上诉/执行）
4. 候选中标记 recentlyUsed=true 的模板说明用户最近用过，
   若与当前需求相关可适当优先；若需求明显切换则不应仅凭"用过"加权

严格按 JSON schema 输出，templateId 必须来自候选列表的 id，禁止编造。`

function buildUserMessage(input: RerankInput, caseContext: string): string {
    const candidatesForLLM = input.candidates.map(c => ({
        id: c.id,
        name: c.name,
        category: c.category,
        description: c.description ?? null,
        recentlyUsed: c.recentlyUsed,
    }))
    const sections: string[] = []
    if (caseContext.trim().length > 0) {
        sections.push(`## 案件信息\n${caseContext}`)
    }
    sections.push(`## 用户最新一句话\n${input.userQuery}`)
    if (input.intent && input.intent !== input.userQuery) {
        sections.push(`## 用户意图（粗筛阶段提取）\n${input.intent}`)
    }
    sections.push(`## 候选模板（共 ${candidatesForLLM.length} 条）\n\`\`\`json\n${JSON.stringify(candidatesForLLM)}\n\`\`\``)
    sections.push(`## 输出要求\n返回 picks 数组，按合适度从高到低排序，长度 ≤ ${input.topN ?? 5}。templateId 必须来自候选 id。reason 可选，一句话说明。`)
    return sections.join('\n\n')
}

async function callRerankLLM(input: RerankInput, caseContext: string): Promise<{ templateId: number; reason?: string }[]> {
    const nodeConfig = await getValidNodeConfig(DOCUMENT_MAIN_NODE_NAME, '文书生成主Agent')
    const activeApiKey = nodeConfig.modelApiKeys.find((k: any) => k.status === 1)
    if (!activeApiKey) {
        throw new Error(`${DOCUMENT_MAIN_NODE_NAME} 节点没有可用的 API 密钥`)
    }
    const model = createChatModel({
        sdkType: nodeConfig.modelSdkType,
        modelName: nodeConfig.modelName,
        apiKey: activeApiKey.apiKey,
        baseUrl: nodeConfig.modelProviderBaseUrl,
        temperature: 0.1,
        streaming: false,
        maxTokens: Math.min(2000, nodeConfig.modelMaxOutputTokens ?? 2000),
    })

    const structured = (model as any).withStructuredOutput(RerankOutputSchema, { name: 'rerank_picks' })
    const messages = [
        new SystemMessage(SYSTEM_PROMPT),
        new HumanMessage(buildUserMessage(input, caseContext)),
    ]

    const timeoutMs = input.timeoutMs ?? 15000
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(new Error('rerank_timeout')), timeoutMs)

    try {
        const out = await structured.invoke(messages, { signal: ac.signal }) as z.infer<typeof RerankOutputSchema>
        return out.picks
    }
    finally {
        clearTimeout(timer)
    }
}

async function loadCaseContext(input: RerankInput): Promise<string> {
    if (input.caseId == null) return ''
    const segs = await buildContextSegments({
        caseId: input.caseId,
        agentName: DOCUMENT_MAIN_NODE_NAME,
        userQuery: input.userQuery,
    })
    return [segs.caseProfile, segs.moduleSummaries, segs.dynamicContext]
        .filter(s => s && s.trim().length > 0)
        .join('\n\n')
}
```

然后修改 `rerankTemplatesService` 主体，把原来 `throw new Error(...)` 那段替换为完整流程：

```typescript
export async function rerankTemplatesService(input: RerankInput): Promise<RerankResult> {
    const { candidates, topN = 5 } = input

    // 1. 空候选 → 直接返回（不调 LLM）
    if (candidates.length === 0) {
        return { picks: [], fallback: false }
    }

    // 2. 候选数 ≤ topN → 全量返回（不需要 rerank）
    if (candidates.length <= topN) {
        return {
            picks: candidates.map(c => ({ templateId: c.id })),
            fallback: false,
        }
    }

    // 3. 拉案件上下文（无 caseId 时返回空串）
    const caseContext = await loadCaseContext(input).catch(err => {
        logger.warn('[rerankTemplatesService] loadCaseContext 失败，按无案件继续', { err })
        return ''
    })

    // 4. 调 LLM rerank
    const llmPicks = await callRerankLLM(input, caseContext)

    // 5. 校验：templateId 必须在 candidates 集合内 + 去重
    const validIdSet = new Set(candidates.map(c => c.id))
    const seen = new Set<number>()
    const validPicks: RerankPick[] = []
    for (const p of llmPicks) {
        if (!validIdSet.has(p.templateId)) continue
        if (seen.has(p.templateId)) continue
        seen.add(p.templateId)
        validPicks.push({ templateId: p.templateId, reason: p.reason })
    }

    // 6. 截到 topN
    const finalPicks = validPicks.slice(0, topN)

    // 7. LLM 至少返回了 1 个有效 id → 尊重 LLM 判断，按 LLM 顺序返回
    if (finalPicks.length > 0) {
        return { picks: finalPicks, fallback: false }
    }

    // 8. LLM 返回的 id 全部编造（0 个有效）→ 用 candidates 顺序补足
    return fillFromCandidates(finalPicks, seen, candidates, topN, 'not_enough_valid_ids')
}

function fillFromCandidates(
    initial: RerankPick[],
    seen: Set<number>,
    candidates: TemplateCandidate[],
    topN: number,
    reason: RerankFallbackReason,
): RerankResult {
    const picks = [...initial]
    for (const c of candidates) {
        if (picks.length >= topN) break
        if (seen.has(c.id)) continue
        seen.add(c.id)
        picks.push({ templateId: c.id })
    }
    return { picks, fallback: true, fallbackReason: reason }
}
```

> 注意：因为 `import` 必须在文件顶部，把 Step 3.3 中所有 `import` 语句移到文件首部，与 Task 2 已有的代码合并。

- [ ] **Step 3.4：跑测试确认 3 个 LLM 用例通过**

```bash
npx vitest run tests/server/assistant/document/templateRerank.service.test.ts --reporter=verbose
```

期望：5 个用例（2 短路 + 3 LLM 正常路径）全部 PASS。

- [ ] **Step 3.5：Commit**

```bash
git add server/agents/document/templateRerank.service.ts tests/server/assistant/document/templateRerank.service.test.ts
git commit -m "feat(tools): rerank service LLM 主路径 + 输出 id 校验/去重"
```

---

## Task 4：rerank Service —— 4 类 fallback 全覆盖

补齐 LLM 抛错 / 超时 / 输出空 / 输出全无效 id 四种降级路径，以及"无 caseId 仍能 rerank"的边界。

**Files:**
- Modify: `server/agents/document/templateRerank.service.ts`（主入口加 try/catch）
- Modify: `tests/server/assistant/document/templateRerank.service.test.ts`（追加 5 个用例）

- [ ] **Step 4.1：追加 fallback 失败测试**

在 `templateRerank.service.test.ts` 末尾追加：

```typescript
    it('LLM 调用抛错 → fallback=true、reason=llm_error、按 candidates 顺序补足', async () => {
        const { getValidNodeConfig } = await import('~~/server/services/node/node.service')
        const { createChatModel } = await import('~~/server/services/node/chatModelFactory')
        const { buildContextSegments } = await import('~~/server/services/agent-platform/context/moduleContextBuilder')
        ;(getValidNodeConfig as any).mockResolvedValue({
            modelSdkType: 'openai', modelName: 'gpt-4o-mini', modelMaxOutputTokens: 4096,
            modelApiKeys: [{ status: 1, apiKey: 'sk-test' }],
            modelProviderBaseUrl: 'https://api.example.com',
        })
        ;(buildContextSegments as any).mockResolvedValue({
            roleAndFlow: '', caseProfile: '', moduleSummaries: '', dynamicContext: '',
        })
        const invokeMock = vi.fn().mockRejectedValue(new Error('网络错误'))
        ;(createChatModel as any).mockReturnValue({
            withStructuredOutput: vi.fn().mockReturnValue({ invoke: invokeMock }),
        })

        const r = await rerankTemplatesService({
            userId: 1, sessionId: 's1', userQuery: 'x', intent: 'x',
            candidates: [makeCandidate(10), makeCandidate(11), makeCandidate(12), makeCandidate(13), makeCandidate(14), makeCandidate(15)],
            topN: 5,
        })
        expect(r.fallback).toBe(true)
        expect(r.fallbackReason).toBe('llm_error')
        // 按 candidates 顺序补足
        expect(r.picks.map(p => p.templateId)).toEqual([10, 11, 12, 13, 14])
    })

    it('LLM 超时 → fallback=true、reason=timeout', async () => {
        const { getValidNodeConfig } = await import('~~/server/services/node/node.service')
        const { createChatModel } = await import('~~/server/services/node/chatModelFactory')
        const { buildContextSegments } = await import('~~/server/services/agent-platform/context/moduleContextBuilder')
        ;(getValidNodeConfig as any).mockResolvedValue({
            modelSdkType: 'openai', modelName: 'gpt-4o-mini', modelMaxOutputTokens: 4096,
            modelApiKeys: [{ status: 1, apiKey: 'sk-test' }],
            modelProviderBaseUrl: 'https://api.example.com',
        })
        ;(buildContextSegments as any).mockResolvedValue({
            roleAndFlow: '', caseProfile: '', moduleSummaries: '', dynamicContext: '',
        })
        // 模拟超时：永不 resolve，由 AbortController 中断
        const invokeMock = vi.fn().mockImplementation((_msgs, opts) =>
            new Promise((_, reject) => {
                opts.signal.addEventListener('abort', () =>
                    reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
                )
            }),
        )
        ;(createChatModel as any).mockReturnValue({
            withStructuredOutput: vi.fn().mockReturnValue({ invoke: invokeMock }),
        })

        const r = await rerankTemplatesService({
            userId: 1, sessionId: 's1', userQuery: 'x', intent: 'x',
            candidates: [makeCandidate(10), makeCandidate(11), makeCandidate(12), makeCandidate(13), makeCandidate(14), makeCandidate(15)],
            topN: 5,
            timeoutMs: 50,  // 50ms 快速超时
        })
        expect(r.fallback).toBe(true)
        expect(r.fallbackReason).toBe('timeout')
        expect(r.picks.map(p => p.templateId)).toEqual([10, 11, 12, 13, 14])
    })

    it('LLM 返回 picks=[] → fallback=true、reason=empty_output', async () => {
        const { getValidNodeConfig } = await import('~~/server/services/node/node.service')
        const { createChatModel } = await import('~~/server/services/node/chatModelFactory')
        const { buildContextSegments } = await import('~~/server/services/agent-platform/context/moduleContextBuilder')
        ;(getValidNodeConfig as any).mockResolvedValue({
            modelSdkType: 'openai', modelName: 'gpt-4o-mini', modelMaxOutputTokens: 4096,
            modelApiKeys: [{ status: 1, apiKey: 'sk-test' }],
            modelProviderBaseUrl: 'https://api.example.com',
        })
        ;(buildContextSegments as any).mockResolvedValue({
            roleAndFlow: '', caseProfile: '', moduleSummaries: '', dynamicContext: '',
        })
        ;(createChatModel as any).mockReturnValue({
            withStructuredOutput: vi.fn().mockReturnValue({
                invoke: vi.fn().mockResolvedValue({ picks: [] }),
            }),
        })

        const r = await rerankTemplatesService({
            userId: 1, sessionId: 's1', userQuery: 'x', intent: 'x',
            candidates: [makeCandidate(10), makeCandidate(11), makeCandidate(12), makeCandidate(13), makeCandidate(14), makeCandidate(15)],
            topN: 5,
        })
        expect(r.fallback).toBe(true)
        expect(r.fallbackReason).toBe('empty_output')
        expect(r.picks.length).toBe(5)
    })

    it('LLM 返回 id 全部编造 → fallback=true、reason=not_enough_valid_ids', async () => {
        const { getValidNodeConfig } = await import('~~/server/services/node/node.service')
        const { createChatModel } = await import('~~/server/services/node/chatModelFactory')
        const { buildContextSegments } = await import('~~/server/services/agent-platform/context/moduleContextBuilder')
        ;(getValidNodeConfig as any).mockResolvedValue({
            modelSdkType: 'openai', modelName: 'gpt-4o-mini', modelMaxOutputTokens: 4096,
            modelApiKeys: [{ status: 1, apiKey: 'sk-test' }],
            modelProviderBaseUrl: 'https://api.example.com',
        })
        ;(buildContextSegments as any).mockResolvedValue({
            roleAndFlow: '', caseProfile: '', moduleSummaries: '', dynamicContext: '',
        })
        ;(createChatModel as any).mockReturnValue({
            withStructuredOutput: vi.fn().mockReturnValue({
                invoke: vi.fn().mockResolvedValue({
                    picks: [{ templateId: 9999 }, { templateId: 8888 }],
                }),
            }),
        })

        const r = await rerankTemplatesService({
            userId: 1, sessionId: 's1', userQuery: 'x', intent: 'x',
            candidates: [makeCandidate(10), makeCandidate(11), makeCandidate(12), makeCandidate(13), makeCandidate(14), makeCandidate(15)],
            topN: 5,
        })
        expect(r.fallback).toBe(true)
        expect(r.fallbackReason).toBe('not_enough_valid_ids')
    })

    it('caseId 为 null → 仍能 rerank（不查案件，buildContextSegments 不被调）', async () => {
        const { getValidNodeConfig } = await import('~~/server/services/node/node.service')
        const { createChatModel } = await import('~~/server/services/node/chatModelFactory')
        const { buildContextSegments } = await import('~~/server/services/agent-platform/context/moduleContextBuilder')
        ;(getValidNodeConfig as any).mockResolvedValue({
            modelSdkType: 'openai', modelName: 'gpt-4o-mini', modelMaxOutputTokens: 4096,
            modelApiKeys: [{ status: 1, apiKey: 'sk-test' }],
            modelProviderBaseUrl: 'https://api.example.com',
        })
        const buildCtxSpy = buildContextSegments as any
        const invokeMock = vi.fn().mockResolvedValue({
            picks: [{ templateId: 10 }, { templateId: 11 }, { templateId: 12 }],
        })
        ;(createChatModel as any).mockReturnValue({
            withStructuredOutput: vi.fn().mockReturnValue({ invoke: invokeMock }),
        })

        const r = await rerankTemplatesService({
            userId: 1, caseId: null, sessionId: 's1',
            userQuery: '帮我写起诉状', intent: '起诉状',
            candidates: [makeCandidate(10), makeCandidate(11), makeCandidate(12), makeCandidate(13), makeCandidate(14), makeCandidate(15)],
            topN: 5,
        })
        expect(r.fallback).toBe(false)
        expect(buildCtxSpy).not.toHaveBeenCalled()
    })
```

- [ ] **Step 4.2：跑测试确认 5 个 fallback 用例失败**

```bash
npx vitest run tests/server/assistant/document/templateRerank.service.test.ts --reporter=verbose
```

期望：LLM 抛错那条会因为没 try/catch 直接 reject 而 fail；超时这条会等 LLM 永不 resolve 而 timeout（除非已实现 AbortController）。

- [ ] **Step 4.3：在 rerankTemplatesService 加 try/catch 兜底**

把 `server/agents/document/templateRerank.service.ts` 中的 `rerankTemplatesService` 的"4. 调 LLM rerank"段落（`const llmPicks = await callRerankLLM(...)`）整个用 try/catch 包起来：

```typescript
    // 4. 调 LLM rerank（任何失败都 fallback 回 candidates 顺序）
    let llmPicks: { templateId: number; reason?: string }[]
    try {
        llmPicks = await callRerankLLM(input, caseContext)
    }
    catch (err) {
        const reason: RerankFallbackReason
            = err instanceof Error && (err.name === 'AbortError' || err.message === 'rerank_timeout' || /aborted/i.test(err.message))
                ? 'timeout'
                : 'llm_error'
        logger.warn('[rerankTemplatesService] LLM 调用失败，fallback 回粗筛顺序', {
            sessionId: input.sessionId,
            reason,
            err: err instanceof Error ? err.message : String(err),
        })
        return fillFromCandidates([], new Set(), candidates, topN, reason)
    }

    // 5. LLM 返回空 picks → fallback empty_output
    if (llmPicks.length === 0) {
        logger.warn('[rerankTemplatesService] LLM 返回 picks=[]，fallback', { sessionId: input.sessionId })
        return fillFromCandidates([], new Set(), candidates, topN, 'empty_output')
    }

    // 6. 校验：templateId 必须在 candidates 集合内 + 去重
    const validIdSet = new Set(candidates.map(c => c.id))
    const seen = new Set<number>()
    const validPicks: RerankPick[] = []
    for (const p of llmPicks) {
        if (!validIdSet.has(p.templateId)) continue
        if (seen.has(p.templateId)) continue
        seen.add(p.templateId)
        validPicks.push({ templateId: p.templateId, reason: p.reason })
    }

    // 7. LLM 至少返回了 1 个有效 id → 尊重 LLM 判断，按 LLM 顺序返回
    if (validPicks.length > 0) {
        return { picks: validPicks.slice(0, topN), fallback: false }
    }

    // 8. LLM 返回的 id 全部编造（0 个有效）→ 用 candidates 顺序补足
    return fillFromCandidates(validPicks.slice(0, topN), seen, candidates, topN, 'not_enough_valid_ids')
```

> 注意：`Step 3.3` 写的旧版主体已经被这段完全替换，原 `const llmPicks = await callRerankLLM(...)` 那一行不再存在。

- [ ] **Step 4.4：跑全部 rerank Service 测试确认通过**

```bash
npx vitest run tests/server/assistant/document/templateRerank.service.test.ts --reporter=verbose
```

期望：10 个用例全 PASS（2 短路 + 3 LLM 正常 + 5 fallback）。

- [ ] **Step 4.5：Commit**

```bash
git add server/agents/document/templateRerank.service.ts tests/server/assistant/document/templateRerank.service.test.ts
git commit -m "feat(tools): rerank service 四类 fallback（超时/抛错/空输出/全编造 id）"
```

---

## Task 5：改造 recommend_template 工具串接 rerank

把工具内部从"直调粗筛 → interrupt"改为"粗筛拿 30 → rerank 拿 top 5 → interrupt"。

**Files:**
- Modify: `server/services/agent-platform/tools/recommendTemplate.tool.ts`
- Modify: `tests/server/agent-platform/tools/recommendTemplate.test.ts`

- [ ] **Step 5.1：改造工具测试（旧 3 个用例适配新流程 + 加 1 个 rerank fallback 用例）**

把 `tests/server/agent-platform/tools/recommendTemplate.test.ts` 头部 mock 段扩展（加 rerank service mock）：

```typescript
vi.mock('~~/server/agents/document/templateRecommend.service', () => ({
    recommendDocumentTemplatesService: vi.fn(),
}))
vi.mock('~~/server/agents/document/templateRerank.service', () => ({
    rerankTemplatesService: vi.fn(),
}))
vi.mock('~~/server/agents/document/documentTemplate.dao', () => ({
    getDocumentTemplateDAO: vi.fn(),
}))

const { interruptMock } = vi.hoisted(() => ({ interruptMock: vi.fn() }))
vi.mock('@langchain/langgraph', () => ({
    interrupt: interruptMock,
    isGraphBubbleUp: (err: unknown) => err instanceof Error && err.message.startsWith('__BUBBLE__'),
}))

import { createTool, toolDefinition } from '~~/server/services/agent-platform/tools/recommendTemplate.tool'
import { recommendDocumentTemplatesService } from '~~/server/agents/document/templateRecommend.service'
import { rerankTemplatesService } from '~~/server/agents/document/templateRerank.service'
import { getDocumentTemplateDAO } from '~~/server/agents/document/documentTemplate.dao'
```

把现有"成功路径"用例改写为同时 mock 粗筛 + rerank：

```typescript
    it('成功路径：粗筛 30 候选 → rerank 选 top 5 → interrupt → resume → 拉 placeholders', async () => {
        ;(recommendDocumentTemplatesService as any).mockResolvedValue({
            items: [
                { id: 1, name: '民事起诉状', category: 'litigation', scope: 'global', description: null, priority: 100, score: 14, recentlyUsed: false },
                { id: 2, name: '答辩状', category: 'litigation', scope: 'global', description: null, priority: 100, score: 12, recentlyUsed: false },
                { id: 3, name: '调解协议', category: 'general', scope: 'global', description: null, priority: 100, score: 5, recentlyUsed: false },
            ],
            total: 3,
            usedKeywords: ['起诉状'],
            fallbackToRecency: false,
        })
        ;(rerankTemplatesService as any).mockResolvedValue({
            picks: [{ templateId: 1, reason: '最贴近起诉需求' }],
            fallback: false,
        })
        interruptMock.mockReturnValue({ resume: { 'call-id-x': { templateId: 1 } } })
        ;(getDocumentTemplateDAO as any).mockResolvedValue({
            id: 1, name: '民事起诉状', category: 'litigation',
            placeholders: [{ name: '原告' }, { name: '被告' }],
        })

        const tool = createTool({ userId: 1, sessionId: 'sess-x', caseId: 99 })
        const raw: any = await tool.invoke(
            { intent: '起草起诉状', keywords: ['起诉状'] },
            { configurable: {}, toolCall: { id: 'call-id-x' } } as any,
        )
        const parsed = JSON.parse(typeof raw === 'string' ? raw : raw.content)
        expect(parsed.success).toBe(true)
        expect(parsed.templateId).toBe(1)
        expect(parsed.placeholders).toEqual([{ name: '原告' }, { name: '被告' }])
        // 粗筛传 limit=30；rerank 收到 candidates 含 recentlyUsed 字段
        expect((recommendDocumentTemplatesService as any).mock.calls[0][0].limit).toBe(30)
        expect((rerankTemplatesService as any).mock.calls[0][0].candidates[0]).toMatchObject({
            id: 1, name: '民事起诉状', recentlyUsed: false,
        })
        // interrupt payload 中的 recommendations 只剩 rerank 后的 1 条
        const interruptPayload = interruptMock.mock.calls[0][0]
        expect(interruptPayload.type).toBe('template_select')
        expect(interruptPayload.recommendations.map((r: any) => r.id)).toEqual([1])
    })

    it('rerank fallback：LLM 失败时按粗筛顺序展示，仍能正常弹卡 + resume', async () => {
        ;(recommendDocumentTemplatesService as any).mockResolvedValue({
            items: [
                { id: 1, name: '民事起诉状', category: 'litigation', scope: 'global', description: null, priority: 100, score: 14, recentlyUsed: false },
                { id: 2, name: '答辩状', category: 'litigation', scope: 'global', description: null, priority: 100, score: 12, recentlyUsed: false },
            ],
            total: 2,
            usedKeywords: ['起诉状'],
            fallbackToRecency: false,
        })
        ;(rerankTemplatesService as any).mockResolvedValue({
            picks: [{ templateId: 1 }, { templateId: 2 }],
            fallback: true,
            fallbackReason: 'llm_error',
        })
        interruptMock.mockReturnValue({ resume: { 'call-id-x': { templateId: 1 } } })
        ;(getDocumentTemplateDAO as any).mockResolvedValue({ id: 1, name: '民事起诉状', placeholders: [] })

        const tool = createTool({ userId: 1, sessionId: 'sess-x' })
        const raw: any = await tool.invoke(
            { intent: '起诉' },
            { configurable: {}, toolCall: { id: 'call-id-x' } } as any,
        )
        const parsed = JSON.parse(typeof raw === 'string' ? raw : raw.content)
        expect(parsed.success).toBe(true)
        // fallback 时 interrupt payload 也要带 fallbackReason，便于前端可选展示降级提示
        const interruptPayload = interruptMock.mock.calls[0][0]
        expect(interruptPayload.rerankFallback).toBe(true)
        expect(interruptPayload.rerankFallbackReason).toBe('llm_error')
    })
```

保留旧"用户取消"和"toolCallId 双层包装解包"两个用例，把它们里 `recommendDocumentTemplatesService` mock 返回值 items 元素加上 `recentlyUsed: false` 字段（让 TypeScript 不报错；如果用 `as any` 则可以不加）。

- [ ] **Step 5.2：跑工具测试确认失败**

```bash
npx vitest run tests/server/agent-platform/tools/recommendTemplate.test.ts --reporter=verbose
```

期望：成功路径 fail 因为工具还没调 rerank、`interruptPayload.recommendations` 包含全部 3 条而非 1 条。

- [ ] **Step 5.3：改造 recommend_template 工具串接 rerank**

把 `server/services/agent-platform/tools/recommendTemplate.tool.ts:78-95` 段：

```typescript
                // 1. 模板推荐
                const reco = await recommendDocumentTemplatesService({
                    userId,
                    intent: input.intent,
                    keywords: input.keywords,
                    categoryHint: input.category,
                })

                // 2. interrupt 弹卡片(沿用 TemplateSelectCard 既有 payload 形态)
                const resumed = interrupt({
                    type: 'template_select',
                    toolCallId,
                    intent: input.intent,
                    keywords: reco.usedKeywords,
                    recommendations: reco.items,
                    total: reco.total,
                    fallbackToRecency: reco.fallbackToRecency,
                }) as unknown
```

改为：

```typescript
                // 1. 粗筛：拿 30 条候选（足以让 rerank 有挑选空间）
                const reco = await recommendDocumentTemplatesService({
                    userId,
                    intent: input.intent,
                    keywords: input.keywords,
                    categoryHint: input.category,
                    limit: 30,
                })

                // 2. LLM rerank：基于案件上下文挑出 top 5
                const rerank = await rerankTemplatesService({
                    userId,
                    caseId: context.caseId ?? null,
                    sessionId,
                    userQuery: input.intent,
                    intent: input.intent,
                    candidates: reco.items.map(it => ({
                        id: it.id,
                        name: it.name,
                        category: it.category,
                        description: it.description,
                        recentlyUsed: it.recentlyUsed,
                    })),
                    topN: 5,
                })

                logger.info('[recommend_template] 推荐完成', {
                    sessionId,
                    caseId: context.caseId,
                    candidateCount: reco.items.length,
                    rerankPicks: rerank.picks.map(p => p.templateId),
                    rerankFallback: rerank.fallback,
                    rerankFallbackReason: rerank.fallbackReason,
                })

                // 3. 按 rerank picks 顺序映射回完整 item（保留卡片需要的所有字段）
                const itemMap = new Map(reco.items.map(it => [it.id, it]))
                const finalRecommendations = rerank.picks
                    .map(p => itemMap.get(p.templateId))
                    .filter((it): it is NonNullable<typeof it> => it != null)

                // 4. interrupt 弹卡片（payload 形态保持兼容，新增可选 rerankFallback 字段）
                const resumed = interrupt({
                    type: 'template_select',
                    toolCallId,
                    intent: input.intent,
                    keywords: reco.usedKeywords,
                    recommendations: finalRecommendations,
                    total: reco.total,
                    fallbackToRecency: reco.fallbackToRecency,
                    rerankFallback: rerank.fallback,
                    rerankFallbackReason: rerank.fallbackReason,
                }) as unknown
```

同时在文件顶部 import 处追加：

```typescript
import { rerankTemplatesService } from '~~/server/agents/document/templateRerank.service'
```

- [ ] **Step 5.4：跑工具测试确认通过**

```bash
npx vitest run tests/server/agent-platform/tools/recommendTemplate.test.ts --reporter=verbose
```

期望：4 个工具用例（2 旧 + 2 新）全 PASS。

- [ ] **Step 5.5：Commit**

```bash
git add server/services/agent-platform/tools/recommendTemplate.tool.ts tests/server/agent-platform/tools/recommendTemplate.test.ts
git commit -m "feat(tools): recommend_template 串接 LLM rerank（粗筛 30 → rerank → interrupt）"
```

---

## Task 6：类型检查 + 全量回归 + 最终 Commit

- [ ] **Step 6.1：跑类型检查**

```bash
bun run typecheck
```

期望：无类型错误。如果 `RecommendTemplateCard.vue` / `TemplateSelectCard.vue` 的 props 类型要求 items 不带 `recentlyUsed`，那是兼容性扩展不会报错；只在前端用 `satisfies` 严格类型时可能要补字段——按报错信息修最小集即可。

- [ ] **Step 6.2：跑文书相关模块单测**

```bash
npx vitest run tests/server/assistant/document/ tests/server/agent-platform/tools/recommendTemplate.test.ts --reporter=verbose
```

期望：所有 document 相关测试 PASS（含 templateRecommend 10 个 + templateRerank 10 个 + tool 4 个 + 其它已有的 document* 测试）。

- [ ] **Step 6.3：跑全量测试**

```bash
bun run test
```

期望：全部 PASS。如有 KNOWN_FAILS（见 `tests/KNOWN_FAILS.md`）按既定列表豁免；本次改动应不引入新的 fail。

- [ ] **Step 6.4：跑覆盖率检查（agent-platform.md 铁律）**

```bash
bun run coverage 2>&1 | tail -100
```

期望：`server/agents/document/templateRerank.service.ts` 与 `server/services/agent-platform/tools/recommendTemplate.tool.ts` 行/分支覆盖率均 ≥95%。
如果没达标：补充缺失分支的测试用例，重新跑直至达标——这是合规硬要求，不能跳过。

---

> **非必做 — 人工 E2E 验收建议**（不计入 task checkbox）：
> 启动 `bun dev`，进任意案件的"文书生成"，跟 Agent 说"帮我写起诉状"。
> - 观察弹出的「模板选择」卡片是否合理
> - 对照 langfuse trace 看 rerank LLM 调用是否成功 + 入参是否带案件信息
> - 切换案件类型（劳动纠纷 → 婚姻家事）再发同一句话，看推荐是否随案件类型变化
> - 临时改 LLM key 让 rerank 失败，验证 fallback 路径仍能弹卡片（payload 中 `rerankFallback: true`）
>
> 这些验证若条件允许跑一遍最佳；不强制作为合并前卡点。

---

## Self-Review Notes

**1. 决策点覆盖**
- ✅ 决策 1（同款大模型）：`callRerankLLM` 通过 `getValidNodeConfig('documentMain')` + `createChatModel` 复用 documentMain 节点同款模型
- ✅ 决策 2（30 候选）：粗筛传 `limit: 30`
- ✅ 决策 3（评分公式仅做粗筛）：粗筛 service 保留打分作粗筛排序，最终顺序由 LLM 决定；items 增加 `recentlyUsed` 字段供 LLM 参考
- ✅ 决策 4（4 个兜底全做）：
  - LLM 编造 id → `validIdSet` 过滤（Task 3）
  - 校验后不足 3 条 → `fillFromCandidates` 补足并标 `not_enough_valid_ids`（Task 3 / 4）
  - LLM 调用失败/超时 → try/catch + AbortController（Task 4）
  - 全程日志：`logger.warn` for fallback、`logger.info` for 成功（Task 5）

**2. 不变量**
- 前端 interrupt payload `recommendations` 字段还是 `TemplateRecommendItem[]`（只是数量变成 ≤ 5）
- 工具返回值 `{ success, templateId, templateName, templateCategory, placeholders, sourceText }` 完全不变
- 前端 `TemplateSelectCard.vue` / `RecommendTemplateCard.vue` 不动
- 数据库 schema 不动

**3. 已知 trade-off**
- 多一次 LLM 调用 → 用户从"发消息"到"看到卡片"的延迟会增加 1-3 秒。决策 1 选 A（同款大模型）已接受这个 trade-off。
- `buildContextSegments` 在 rerank 里会再触发一次 `recallMemoryService`（向量检索），与 documentMain Agent 已调过的那次重复。这是当前架构接受的 trade-off（rerank 是工具内独立调用，不共享 Agent 上下文）。
- LLM 输出格式偶发不合 schema → `.withStructuredOutput()` 抛错会 fall 进 `llm_error` 分支，用户仍能拿到推荐。

**4. 关键设计决策（dev-task3 阶段澄清）**
- "校验后多少条算 rerank 成功"的阈值：**≥1**（任何 LLM 返回的有效 id 都视为成功），而非曾经设想的 ≥3。
- 理由：rerank 的本意是尊重 LLM 在案件上下文下的判断；若 LLM 看完案件信息只挑 2 条说"这两个最合适"，强行用粗筛底补到 5 条反而稀释推荐质量。
- `not_enough_valid_ids` fallback 仅在 LLM 返回的所有 id 都被 candidates 集合拒绝时触发（典型是 LLM 完全编造）。

**5. 测试覆盖（按场景）**
| 场景 | 用例位置 |
|---|---|
| 粗筛 recentlyUsed 标记 | templateRecommend.service.test.ts case 10 |
| rerank 候选为空 | templateRerank.service.test.ts case 1 |
| rerank 候选 ≤ topN | templateRerank.service.test.ts case 2 |
| rerank LLM 正常返回 | templateRerank.service.test.ts case 3 |
| rerank LLM 编造部分 id | templateRerank.service.test.ts case 4 |
| rerank LLM 返回重复 id | templateRerank.service.test.ts case 5 |
| rerank LLM 抛错 | templateRerank.service.test.ts case 6 |
| rerank LLM 超时 | templateRerank.service.test.ts case 7 |
| rerank LLM 返回空 | templateRerank.service.test.ts case 8 |
| rerank LLM 全编造 id | templateRerank.service.test.ts case 9 |
| rerank caseId=null | templateRerank.service.test.ts case 10 |
| 工具串接成功路径 + limit=30 校验 | recommendTemplate.test.ts case "成功路径" |
| 工具串接 fallback | recommendTemplate.test.ts case "rerank fallback" |
| 工具用户取消 | recommendTemplate.test.ts case "用户取消"（保留） |
| 工具 toolCallId 双层包装 | recommendTemplate.test.ts case "toolCallId 双层包装"（保留） |
