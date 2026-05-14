# 三个 Agent 上下文同步机制统一 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把小索 / 模块对话 / 文书生成 三个 Agent 的"案件相关上下文"统一改为"每轮发消息时新增一条带 metadata 标记的 HumanMessage 注入对话"，SystemMessage 退化为只含稳定 roleAndFlow 段（Anthropic 路径仍挂 1h cache_control），三个入口都挂上未处理材料自动补做钩子。

**Architecture:** 新中间件 `caseContextSyncMiddleware` 在 `beforeAgent` 钩子里调 `buildContextSegments` 实时拉案件 4 段（+ 文书 2 段），用 `splice` 原地把上下文 HumanMessage 插到本轮 user 之前（沿用现有 caseContextMiddleware 已生产 1 年的同款机制：splice + return truthy 走 LangGraph state merge 路径），双轨打 `injectedBy='CaseContextSyncMiddleware'` metadata（response_metadata + additional_kwargs）兜底 SDK 序列化丢字段；三个 Agent 的 SystemMessage 构造统一复用现有 `buildSystemPromptForAgent({ caseId: null, ... })` 退化路径（与 assistantAgent 同款），不重复造轮子；过滤逻辑收敛到中央判定 `isInjectedContextMessage`，前端只识别新 tag。

**Tech Stack:** TypeScript / LangChain v1 createAgent / @langchain/langgraph / Vitest（npx vitest run）/ Prisma / Bun / 现有 `buildSystemPromptForAgent` + `cachedPromptToAnthropicContent`

**Spec 引用：** [docs/superpowers/specs/2026-05-05-agent-context-sync-unification-design.md](../specs/2026-05-05-agent-context-sync-unification-design.md)

---

## 文件结构

### 新增

| 文件 | 责任 |
|---|---|
| `server/agents/_shared/case-context/caseContextSync.middleware.ts` | 新中间件实现（含 draftLoader 接口） |
| `tests/server/agents/_shared/case-context/caseContextSync.middleware.test.ts` | 新中间件单测，覆盖率 ≥90% |
| `tests/server/agent-platform/caseContextSync.integration.test.ts` | spec §7.2 要求的集成测试（draft.values 编辑后下轮可见） |

### 删除

| 文件 | 原因 |
|---|---|
| `server/agents/_shared/case-context/caseContext.middleware.ts` | 旧中间件被新版替代 |

### 修改

| 文件 | 改动 |
|---|---|
| `server/services/agent-platform/context/injectorDetection.ts` | INJECTOR_EXACT 新增 `'CaseContextSyncMiddleware'`；`getMessageInjector` 双轨读 response_metadata + additional_kwargs |
| `server/services/agent-platform/factory/runtime.ts` | SystemMessage 构造改用 `buildSystemPromptForAgent({ caseId: null, ... })` 退化路径（与 assistantAgent 同款）|
| `server/agents/case-main/agent.config.ts` | 切换 import：`caseContextMiddleware` → `caseContextSyncMiddleware` |
| `server/services/workflow/agents/moduleAgent.ts` | 删 `buildSystemPromptForAgent` 多段拼装调用，改用退化调用；中间件加 caseProcessMaterial + caseContextSync；safetyTrim systemPrompt 改算 roleAndFlow |
| `server/services/workflow/agents/documentMainAgent.ts` | 同模块对话改造；renderSystemPrompt 收窄；实现 draftLoader 闭包（valuesJSON 独立 try/catch 容错）；原 line 97-101 placeholders/values 渲染整体迁移；caseProcessMaterial 仅 caseId 非空时挂 |
| `server/services/agent-platform/nodeConfig/promptRenderer.ts` | `PromptRenderContext` 删 `currentValuesJSON?` / `placeholdersWithHints?` dead 字段 + 删函数内对应分支 |
| `server/services/workflow/middleware/index.ts` | 第 7-9 行过时注释更新 |
| `server/services/agent-platform/context/moduleContextBuilder.ts` | `buildSystemPromptForAgent` 上方加注释明示真实调用方现状 |
| `server/services/workflow/agents/threadState.ts` | 第 90-100 行 + 266-267 行 hardcoded 过滤改调 `isInjectedContextMessage` |
| `app/components/ai/composables/useMessageParser.ts` | 第 255-261 行兜底过滤简化为只识别 `'CaseContextSyncMiddleware'` |
| `prisma/seeds/seedData.sql` | `documentMain_system` prompt content 字段：删两行占位符引用 + 加一句静态指引 |

### 数据级变更

- 改 dev 库 `prompts` 表 `documentMain_system` 行 `content` 字段（同 seedData.sql 改动）

---

## Task 1：扩展 injectorDetection 支持新 tag + 双轨字段读取

**Files:**
- Modify: `server/services/agent-platform/context/injectorDetection.ts`
- Test: `tests/server/services/agent-platform/context/injectorDetection.test.ts`（新建——已 grep 确认目录下无该文件）

- [ ] **Step 1: 新建测试文件**

```ts
// tests/server/services/agent-platform/context/injectorDetection.test.ts
import { describe, it, expect } from 'vitest'
import {
  isInjectorFromContextMiddleware,
  getMessageInjector,
  isInjectedContextMessage,
} from '~~/server/services/agent-platform/context/injectorDetection'

describe('injectorDetection - 新 tag CaseContextSyncMiddleware', () => {
  it('isInjectorFromContextMiddleware 识别新 tag', () => {
    expect(isInjectorFromContextMiddleware('CaseContextSyncMiddleware')).toBe(true)
  })

  it('isInjectorFromContextMiddleware 仍识别旧 tag（兼容历史 checkpoint）', () => {
    expect(isInjectorFromContextMiddleware('CaseContextMiddleware')).toBe(true)
    expect(isInjectorFromContextMiddleware('ModuleContext_caseSummary')).toBe(true)
    expect(isInjectorFromContextMiddleware('CaseMaterial_xxx')).toBe(true)
    expect(isInjectorFromContextMiddleware('SubAgentContext_yyy')).toBe(true)
  })

  it('getMessageInjector 从 response_metadata 读 injectedBy', () => {
    const msg = { response_metadata: { injectedBy: 'CaseContextSyncMiddleware' } }
    expect(getMessageInjector(msg)).toBe('CaseContextSyncMiddleware')
  })

  it('getMessageInjector 从 additional_kwargs 读 injectedBy（双轨兜底）', () => {
    const msg = { additional_kwargs: { injectedBy: 'CaseContextSyncMiddleware' } }
    expect(getMessageInjector(msg)).toBe('CaseContextSyncMiddleware')
  })

  it('getMessageInjector 优先 response_metadata（双字段都存在时）', () => {
    const msg = {
      response_metadata: { injectedBy: 'CaseContextSyncMiddleware' },
      additional_kwargs: { injectedBy: 'OldTag' },
    }
    expect(getMessageInjector(msg)).toBe('CaseContextSyncMiddleware')
  })

  it('isInjectedContextMessage 整合双轨判定', () => {
    expect(isInjectedContextMessage({
      additional_kwargs: { injectedBy: 'CaseContextSyncMiddleware' },
    })).toBe(true)
    expect(isInjectedContextMessage({})).toBe(false)
    expect(isInjectedContextMessage({ response_metadata: { injectedBy: 'foo' } })).toBe(false)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
npx vitest run tests/server/services/agent-platform/context/injectorDetection.test.ts --reporter=verbose
```
Expected: 多条 FAIL（'CaseContextSyncMiddleware' 不在 INJECTOR_EXACT；getMessageInjector 不读 additional_kwargs）

- [ ] **Step 3: 修改 injectorDetection.ts 实现**

```ts
// server/services/agent-platform/context/injectorDetection.ts
const INJECTOR_PREFIXES = ['ModuleContext', 'CaseMaterial', 'SubAgentContext'] as const
const INJECTOR_EXACT = new Set([
    'CaseContextMiddleware',           // 旧 tag，保留兼容历史 checkpoint
    'CaseContextSyncMiddleware',       // 新 tag（本次改造）
])

export function isInjectorFromContextMiddleware(injector: string | undefined | null): boolean {
    if (!injector) return false
    if (INJECTOR_EXACT.has(injector)) return true
    return INJECTOR_PREFIXES.some(p => injector.startsWith(p))
}

/**
 * 从消息对象提取 injectedBy。
 * 双轨字段：优先 response_metadata.injectedBy；fallback 到 additional_kwargs.injectedBy。
 *
 * 双轨原因：项目记忆 feedback_message_metadata_first.md 指出 LangGraph SDK
 * plain object 序列化路径会丢 additional_kwargs；checkpoint 反序列化也可能仅
 * 还原其中一边，双轨写 + 双轨读保证兜底。
 */
export function getMessageInjector(msg: unknown): string | undefined {
    if (!msg || typeof msg !== 'object') return undefined
    const m = msg as Record<string, unknown>

    const topMeta = m.response_metadata as Record<string, unknown> | undefined
    const topInjector = topMeta?.injectedBy
    if (typeof topInjector === 'string') return topInjector

    const ak = m.additional_kwargs as Record<string, unknown> | undefined
    const akInjector = ak?.injectedBy
    if (typeof akInjector === 'string') return akInjector

    const inner = m.data as Record<string, unknown> | undefined
    if (inner && typeof inner === 'object') {
        const innerMeta = inner.response_metadata as Record<string, unknown> | undefined
        const innerInjector = innerMeta?.injectedBy
        if (typeof innerInjector === 'string') return innerInjector
        const innerAk = inner.additional_kwargs as Record<string, unknown> | undefined
        const innerAkInjector = innerAk?.injectedBy
        if (typeof innerAkInjector === 'string') return innerAkInjector
    }
    return undefined
}

export function isInjectedContextMessage(msg: unknown): boolean {
    return isInjectorFromContextMiddleware(getMessageInjector(msg))
}
```

- [ ] **Step 4: 跑测试确认通过**

Run:
```bash
npx vitest run tests/server/services/agent-platform/context/injectorDetection.test.ts --reporter=verbose
```
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add server/services/agent-platform/context/injectorDetection.ts \
        tests/server/services/agent-platform/context/injectorDetection.test.ts
git commit -m "feat(agent-platform): injectorDetection 支持新 tag CaseContextSyncMiddleware + 双轨字段读取"
```

---

## Task 2：实现 caseContextSyncMiddleware（含单测）

**Files:**
- Create: `server/agents/_shared/case-context/caseContextSync.middleware.ts`
- Test: `tests/server/agents/_shared/case-context/caseContextSync.middleware.test.ts`

> 实施前置：`buildContextSegments` 真实返回 `ContextSegments` 接口含 `roleAndFlow / caseProfile / moduleSummaries / dynamicContext` 4 字段，本 plan 测试 mock 已对齐。中间件实现仅读 `caseProfile / moduleSummaries / dynamicContext` 三段（roleAndFlow 段不再用）。

> 注：spec §7.1 第 7、8 条（agentName='caseMain' 含全部模块 / agentName=moduleName 排除自身）的具体行为由 `buildContextSegments` 自身单测覆盖（spec §7.5 不重复测试），中间件层仅断言 `agentName` 透传给 `buildContextSegments`。

- [ ] **Step 1: 写完整单测文件（先 RED）**

```ts
// tests/server/agents/_shared/case-context/caseContextSync.middleware.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { HumanMessage } from '@langchain/core/messages'
import { caseContextSyncMiddleware } from '~~/server/agents/_shared/case-context/caseContextSync.middleware'

vi.mock('~~/server/services/agent-platform/context/moduleContextBuilder', () => ({
  buildContextSegments: vi.fn(),
}))
import { buildContextSegments } from '~~/server/services/agent-platform/context/moduleContextBuilder'

const mockSegments = (overrides: Record<string, string> = {}) => ({
  roleAndFlow: '',
  caseProfile: '## 案件档案\n```json\n{}\n```',
  moduleSummaries: '## 已完成分析模块',
  dynamicContext: '## 案件材料清单',
  ...overrides,
})

const runHook = async (mw: any, state: { messages: any[] }) => {
  const ret = await mw.beforeAgent.hook(state)
  return { state, ret }
}

beforeEach(() => {
  vi.mocked(buildContextSegments).mockResolvedValue(mockSegments())
})

describe('caseContextSyncMiddleware', () => {
  it('caseId 非空 + draftLoader=null：仅注入案件 4 段；context 在 user message 之前；hook 返回 truthy 触发 merge 路径', async () => {
    const mw = caseContextSyncMiddleware({ caseId: 1, agentName: 'caseMain' })
    const userMsg = new HumanMessage('帮我看下案件')
    const state = { messages: [userMsg] }
    const { ret } = await runHook(mw, state)

    expect(state.messages.length).toBe(2)
    expect(state.messages[0].response_metadata?.injectedBy).toBe('CaseContextSyncMiddleware')
    expect(state.messages[0].content).toContain('案件档案')
    expect(state.messages[0].content).toContain('案件材料清单')
    expect(state.messages[0].content).not.toContain('当前已填字段')
    expect(state.messages[1]).toBe(userMsg)         // user 仍在末尾
    expect(ret).toEqual({})                          // 显式 return {} 触发 LangGraph state merge 路径
  })

  it('caseId=null + draftLoader 非空：仅注入文书段', async () => {
    const mw = caseContextSyncMiddleware({
      caseId: null,
      agentName: 'documentMain',
      draftLoader: async () => ({
        placeholdersWithHints: '- 原告姓名',
        draftValuesJSON: async () => '{"原告":"张三"}',
      }),
    })
    const state = { messages: [new HumanMessage('填一下')] }
    await runHook(mw, state)

    expect(state.messages[0].content).toContain('当前已填字段')
    expect(state.messages[0].content).toContain('张三')
    expect(state.messages[0].content).toContain('模板待填占位符')
  })

  it('caseId 非空 + draftLoader 非空：注入 4+2 段', async () => {
    const mw = caseContextSyncMiddleware({
      caseId: 1,
      agentName: 'documentMain',
      draftLoader: async () => ({
        placeholdersWithHints: '- 原告姓名',
        draftValuesJSON: async () => '{"原告":"张三"}',
      }),
    })
    const state = { messages: [new HumanMessage('继续')] }
    await runHook(mw, state)

    expect(state.messages[0].content).toContain('案件档案')
    expect(state.messages[0].content).toContain('当前已填字段')
    expect(state.messages[0].content).toContain('张三')
  })

  it('draftLoader() 整体抛错：仅丢失文书段，4 段照常注入', async () => {
    const mw = caseContextSyncMiddleware({
      caseId: 1,
      agentName: 'documentMain',
      draftLoader: async () => { throw new Error('db down') },
    })
    const state = { messages: [new HumanMessage('xxx')] }
    await runHook(mw, state)

    expect(state.messages.length).toBe(2)
    expect(state.messages[0].content).toContain('案件档案')
    expect(state.messages[0].content).not.toContain('当前已填字段')
  })

  it('draftValuesJSON() 抛错：placeholders 仍展示，currentValues 置空（spec §5.2 容错粒度）', async () => {
    const mw = caseContextSyncMiddleware({
      caseId: 1,
      agentName: 'documentMain',
      draftLoader: async () => ({
        placeholdersWithHints: '- 原告姓名',
        draftValuesJSON: async () => { throw new Error('values query failed') },
      }),
    })
    const state = { messages: [new HumanMessage('xxx')] }
    await runHook(mw, state)

    expect(state.messages[0].content).toContain('模板待填占位符')
    expect(state.messages[0].content).toContain('原告姓名')
    // valuesJSON 置空字符串占位，不影响 placeholders 展示
    expect(state.messages[0].content).toContain('当前已填字段')
  })

  it('buildContextSegments 抛错：messages 不变，不阻塞 Agent', async () => {
    vi.mocked(buildContextSegments).mockRejectedValueOnce(new Error('db down'))
    const mw = caseContextSyncMiddleware({ caseId: 1, agentName: 'caseMain' })
    const userMsg = new HumanMessage('q')
    const state = { messages: [userMsg] }
    await runHook(mw, state)

    expect(state.messages.length).toBe(1)
    expect(state.messages[0]).toBe(userMsg)
  })

  it('多轮调用：每轮新增一条注入消息（不复用历史）', async () => {
    const mw = caseContextSyncMiddleware({ caseId: 1, agentName: 'caseMain' })
    const state = { messages: [new HumanMessage('q1')] }

    await runHook(mw, state)
    expect(state.messages.length).toBe(2)

    state.messages.push({ _getType: () => 'ai', content: 'a1' } as any)
    state.messages.push(new HumanMessage('q2'))
    await runHook(mw, state)

    expect(state.messages.length).toBe(5)
    expect(state.messages[3].response_metadata?.injectedBy).toBe('CaseContextSyncMiddleware')
    expect(state.messages[4].content).toBe('q2')
  })

  it('双轨写 metadata：response_metadata + additional_kwargs 都含 injectedBy', async () => {
    const mw = caseContextSyncMiddleware({ caseId: 1, agentName: 'caseMain' })
    const state = { messages: [new HumanMessage('q')] }
    await runHook(mw, state)

    const ctx = state.messages[0]
    expect(ctx.response_metadata?.injectedBy).toBe('CaseContextSyncMiddleware')
    expect(ctx.additional_kwargs?.injectedBy).toBe('CaseContextSyncMiddleware')
  })

  it('agentName 透传给 buildContextSegments', async () => {
    const mw = caseContextSyncMiddleware({ caseId: 1, agentName: 'caseAnalysisSummary' })
    await runHook(mw, { messages: [new HumanMessage('q')] })

    expect(buildContextSegments).toHaveBeenCalledWith(
      expect.objectContaining({ caseId: 1, agentName: 'caseAnalysisSummary' }),
    )
  })
})
```

- [ ] **Step 2: 跑测试确认失败（中间件文件还没建）**

Run:
```bash
npx vitest run tests/server/agents/_shared/case-context/caseContextSync.middleware.test.ts --reporter=verbose
```
Expected: 全部 FAIL（cannot find module 'caseContextSync.middleware'）

- [ ] **Step 3: 创建中间件文件实现**

```ts
// server/agents/_shared/case-context/caseContextSync.middleware.ts
/**
 * 案件上下文同步中间件
 *
 * 替代旧 caseContextMiddleware，统一三个 Agent（小索 / 模块对话 / 文书生成）
 * 的"案件相关上下文"管线：
 *
 * - 每轮 Agent 启动时（beforeAgent 钩子）实时拉案件 4 段（caseProfile +
 *   moduleSummaries + materialList + memoryRecall），文书 Agent 还会通过
 *   draftLoader 拉草稿当前字段 + 模板占位符 2 段。
 * - 拼成单一字符串构造 HumanMessage，splice 原地插入到本轮 user message 之前。
 * - 双轨打 injectedBy='CaseContextSyncMiddleware' metadata
 *   （response_metadata + additional_kwargs 兜底 SDK 序列化丢字段）。
 * - hook 显式 return {} 触发 LangGraph state merge 路径
 *   （沿用现有 caseContextMiddleware 已生产 1 年模式：splice + truthy return；
 *    return undefined 会让框架走早退分支 `{ jumpTo: void 0 }`，跳过 state merge）。
 *
 * 不依赖 LangGraph add_messages reducer 的 return-数组重排能力（reducer 不会按
 * return 顺序重排，见 spec §3.1 决策表）。
 *
 * @see docs/superpowers/specs/2026-05-05-agent-context-sync-unification-design.md §4.1
 */

import { createMiddleware } from 'langchain'
import { HumanMessage } from '@langchain/core/messages'
import { buildContextSegments } from '~~/server/services/agent-platform/context/moduleContextBuilder'

interface DraftLoaderResult {
    /** 模板待填占位符清单（已渲染好的字符串，闭包外捕获不变） */
    placeholdersWithHints: string
    /** 实时拉 draft.values 序列化为 JSON（每轮调用） */
    draftValuesJSON: () => Promise<string>
}

interface CaseContextSyncOptions {
    caseId: number | null
    agentName: string
    draftLoader?: () => Promise<DraftLoaderResult | null>
}

export const caseContextSyncMiddleware = (options: CaseContextSyncOptions) =>
    createMiddleware({
        name: 'CaseContextSyncMiddleware',

        beforeAgent: {
            hook: async (state: any) => {
                const messages: any[] = state.messages ?? []

                try {
                    const lastHuman = [...messages].reverse().find(
                        m => m._getType?.() === 'human' || m.constructor?.name === 'HumanMessage',
                    )
                    const userQuery = typeof lastHuman?.content === 'string' ? lastHuman.content : ''

                    const lines: string[] = []

                    // 案件 4 段
                    if (options.caseId !== null) {
                        const segs = await buildContextSegments({
                            caseId: options.caseId,
                            agentName: options.agentName,
                            userQuery,
                        })
                        if (segs.caseProfile) lines.push(segs.caseProfile)
                        if (segs.moduleSummaries) lines.push(segs.moduleSummaries)
                        if (segs.dynamicContext) lines.push(segs.dynamicContext)
                    }

                    // 文书 2 段：外层 try/catch 处理 draftLoader() 整体抛错；内层 try/catch
                    // 处理 draftValuesJSON() 抛错（spec §5.2：仅 currentValues 置空，placeholders 仍展示）
                    if (options.draftLoader) {
                        try {
                            const draft = await options.draftLoader()
                            if (draft) {
                                let valuesJSON = '{}'
                                try {
                                    valuesJSON = await draft.draftValuesJSON()
                                } catch (innerErr) {
                                    logger.warn('[CaseContextSyncMiddleware] draftValuesJSON 失败，currentValues 置空保留 placeholders', { err: innerErr })
                                }
                                lines.push(`## 当前已填字段\n\`\`\`json\n${valuesJSON}\n\`\`\``)
                                lines.push(`## 模板待填占位符\n${draft.placeholdersWithHints}`)
                            }
                        } catch (err) {
                            logger.warn('[CaseContextSyncMiddleware] draftLoader 失败，跳过文书段', { err })
                        }
                    }

                    if (lines.length === 0) return {}

                    const contextMsg = new HumanMessage({
                        content: lines.join('\n\n'),
                        response_metadata: { injectedBy: 'CaseContextSyncMiddleware' },
                        additional_kwargs: { injectedBy: 'CaseContextSyncMiddleware' },
                    })

                    // splice 原地插入：找到末尾 HumanMessage 的位置，插到它之前
                    const lastHumanIdx = messages.findLastIndex(
                        (m: any) => m._getType?.() === 'human' || m.constructor?.name === 'HumanMessage',
                    )
                    const insertIdx = lastHumanIdx >= 0 ? lastHumanIdx : messages.length
                    messages.splice(insertIdx, 0, contextMsg)
                } catch (err) {
                    logger.error('[CaseContextSyncMiddleware] 注入案件上下文失败', {
                        caseId: options.caseId,
                        agentName: options.agentName,
                        err,
                    })
                }

                // 显式 return {} 触发 LangGraph state merge 路径（沿用现有 caseContextMiddleware
                // 1 年生产模式）；return undefined 会让 langchain middleware 节点走早退
                // `{ jumpTo: void 0 }`，跳过 state merge，splice mutation 跨 super-step 行为
                // undocumented，可能不可靠。
                return {}
            },
        },
    })
```

- [ ] **Step 4: 跑测试确认通过**

Run:
```bash
npx vitest run tests/server/agents/_shared/case-context/caseContextSync.middleware.test.ts --reporter=verbose
```
Expected: 全部 PASS

- [ ] **Step 5: 检查覆盖率达 ≥90%**

Run:
```bash
npx vitest run tests/server/agents/_shared/case-context/caseContextSync.middleware.test.ts --coverage --coverage.include='server/agents/_shared/case-context/caseContextSync.middleware.ts'
```
Expected: 该文件 statements / branches / functions / lines 均 ≥ 90%

如未达标，针对未覆盖分支补测试，再次跑 coverage 确认。

- [ ] **Step 6: Commit**

```bash
git add server/agents/_shared/case-context/caseContextSync.middleware.ts \
        tests/server/agents/_shared/case-context/caseContextSync.middleware.test.ts
git commit -m "feat(agent-platform): 新增 caseContextSyncMiddleware 统一三 Agent 上下文注入

- splice 原地修改 + 显式 return {} 触发 LangGraph state merge（沿用旧
  caseContextMiddleware 1 年生产模式）
- draftValuesJSON 独立 try/catch 容错（spec §5.2：仅 currentValues 置空，
  placeholders 仍展示）
- 双轨写 metadata（response_metadata + additional_kwargs）兜底 SDK 序列化丢字段
- 单测覆盖率 ≥90%"
```

---

## Task 3：改造 promptRenderer.ts 删 dead 字段

**Files:**
- Modify: `server/services/agent-platform/nodeConfig/promptRenderer.ts`

- [ ] **Step 1: 检查现有 promptRenderer 测试**

Run:
```bash
find /Users/daixin/work/dev/LexSeek/LexSeek/tests -name "promptRenderer*" 2>/dev/null
```
如有，记录路径供 Step 4 跑回归。如无，跳过。

- [ ] **Step 2: 改 PromptRenderContext 接口删字段**

修改 `server/services/agent-platform/nodeConfig/promptRenderer.ts` 第 12-40 行 `PromptRenderContext` 接口，删除 `currentValuesJSON?: string` 与 `placeholdersWithHints?: string` 两行：

```ts
/** 渲染系统提示词时可传入的上下文变量 */
export interface PromptRenderContext {
    /** 案件 ID */
    caseId?: number
    /** 模块名称（如 case_summary、events_timeline） */
    moduleName?: string
    /** 案件类型 */
    caseType?: string
    /** 文书模板名称 */
    templateName?: string
    /** 文书模板类别 */
    templateCategory?: string
    /** 合同审查 ID（contract scope） */
    reviewId?: number
    /** 合同类型（AI 识别，可能为空） */
    contractType?: string
    /** 文书生成 fileIds（如 [1, 2, 3] 字符串形式） */
    fileIds?: string
    /** 用户补充说明文本 */
    userExtraText?: string
    /** 文书草稿 ID（documentMain 系统 prompt 注入当前 draft 状态用） */
    draftId?: number
    /** 草稿当前状态('drafting' / 'filling' / 'ready' / 'exported' / 'failed') */
    status?: string
    // 注：currentValuesJSON / placeholdersWithHints 字段已删除
    // 草稿当前字段值与模板占位符现在通过 caseContextSyncMiddleware 的 draftLoader
    // 注入到对话 HumanMessage 中，不再走 SystemMessage 模板变量替换。
    // 见 spec §4.2.3 与 §6.2 改动清单。
}
```

- [ ] **Step 3: 改 renderSystemPrompt 函数体删对应分支**

`renderSystemPrompt` 函数内（约第 94-99 行）删除：

```ts
    if (context.currentValuesJSON) {
        variables.currentValuesJSON = context.currentValuesJSON
    }
    if (context.placeholdersWithHints) {
        variables.placeholdersWithHints = context.placeholdersWithHints
    }
```

整段删除，其他分支保留。

- [ ] **Step 4: 跑 typecheck 确认无类型错误**

Run:
```bash
npx nuxi typecheck 2>&1 | tail -50
```
Expected: 无该文件相关错误。

如有调用方传 `currentValuesJSON` / `placeholdersWithHints` 的代码（仅 documentMainAgent.ts），typecheck 会报错——这正是 Task 7 改造时一并处理；本 Task 仅改 promptRenderer 自身。

- [ ] **Step 5: 跑现有 promptRenderer 测试（如存在）**

如 Step 1 找到测试文件：
```bash
npx vitest run <found-test-path> --reporter=verbose
```
Expected: 全部 PASS。

- [ ] **Step 6: Commit**

```bash
git add server/services/agent-platform/nodeConfig/promptRenderer.ts
git commit -m "refactor(agent-platform): promptRenderer 删除 currentValuesJSON / placeholdersWithHints dead 字段

这两个字段原服务于文书生成 Agent 的 SystemMessage 模板变量替换。
本次改造把草稿字段+占位符迁到 caseContextSyncMiddleware 注入的
HumanMessage，模板变量不再使用，按手术性修改原则清理 orphan code。"
```

---

## Task 4：改造 runtime.ts SystemMessage 复用 buildSystemPromptForAgent

**Files:**
- Modify: `server/services/agent-platform/factory/runtime.ts`

> 复用项目已有 `buildSystemPromptForAgent`：传 `caseId=null` 时它退化为"仅含 roleAndFlow 段 + 按 SDK 分流构造 SystemMessage（Anthropic 自动加 1h cache_control）"，与 `assistantAgent.ts:92` 同款模式，零新增基建。

- [ ] **Step 1: 改 import**

`runtime.ts` 顶部 import 区追加：

```ts
import { buildSystemPromptForAgent } from '~~/server/services/agent-platform/context/moduleContextBuilder'
```

- [ ] **Step 2: 修改 SystemMessage 构造逻辑**

将原 `runtime.ts` 第 159-162 行：
```ts
    // 4. 渲染 system prompt（plain text）
    const systemPrompt = renderSystemPrompt(nodeConfig, {
        caseId: ctx.caseId ?? undefined,
    })
```

改为：
```ts
    // 4. 渲染 system prompt：仅 roleAndFlow 段；4 段案件上下文交给 caseContextSyncMiddleware
    //    注入 HumanMessage（业务私有中间件由 vertical 通过 customMiddlewares 挂载）
    //    构造方式与 assistantAgent 同款：buildSystemPromptForAgent 在 caseId=null 时退化为
    //    "仅 roleAndFlow + 按 SDK 分流（Anthropic 1h cache_control / 其他 plain text）"
    const systemPromptText = renderSystemPrompt(nodeConfig, {
        caseId: ctx.caseId ?? undefined,
    })
    const { systemMessage: systemPrompt, plainText: systemPromptPlainText } = await buildSystemPromptForAgent(
        nodeConfig.modelSdkType,
        {
            caseId: null,
            agentName: resolvedNodeName,
            userQuery: '',
            roleAndFlowTemplate: systemPromptText,
        },
    )
```

- [ ] **Step 3: 同步更新 safetyTrim 的 systemPrompt 参数（保持 plain text 用于 token 计数）**

在 `runtime.ts` 中找到 `safetyTrimMiddleware({ ..., systemPrompt, ... })` 调用（约第 213-218 行），改为：
```ts
            middleware: safetyTrimMiddleware({
                model,
                maxTokens,
                systemPrompt: systemPromptPlainText,  // 用 plain text 算 token，不用 SystemMessage 实例
                maxOutputTokens,
            }),
```

- [ ] **Step 4: 跑 typecheck**

Run:
```bash
npx nuxi typecheck 2>&1 | tail -50
```
Expected: 无 runtime.ts 相关错误。

- [ ] **Step 5: Commit**

```bash
git add server/services/agent-platform/factory/runtime.ts
git commit -m "refactor(agent-platform): runtime.ts SystemMessage 构造复用 buildSystemPromptForAgent

caseId=null 时 buildSystemPromptForAgent 退化为单段 roleAndFlow，
Anthropic 路径自动加 1h cache_control，其他 SDK 走 plain text。
与 assistantAgent 同款模式，不重复造轮子。"
```

---

## Task 5：小索切换到 caseContextSyncMiddleware

**Files:**
- Modify: `server/agents/case-main/agent.config.ts`

- [ ] **Step 1: 改 import 与中间件挂载**

`server/agents/case-main/agent.config.ts` 中：

旧：
```ts
import { caseContextMiddleware } from '~~/server/agents/_shared/case-context/caseContext.middleware'
```

改为：
```ts
import { caseContextSyncMiddleware } from '~~/server/agents/_shared/case-context/caseContextSync.middleware'
```

文件内 `customMiddlewares` 数组中的 `caseContextMiddleware(ctx.caseId!, 'caseMain')` 调用改为：

```ts
        {
            middleware: caseContextSyncMiddleware({
                caseId: ctx.caseId!,
                agentName: 'caseMain',
            }),
            priority: MIDDLEWARE_PRIORITY.MODULE_CONTEXT,
            name: MIDDLEWARE_NAMES.MODULE_CONTEXT,
        },
```

- [ ] **Step 2: Commit（typecheck 留待 Task 13 统一跑）**

```bash
git add server/agents/case-main/agent.config.ts
git commit -m "refactor(case-main): 切换 caseContextMiddleware → caseContextSyncMiddleware

- 去掉同 thread 只注入一次的锁，改为每轮重拉最新上下文
- tag 'CaseContextMiddleware' → 'CaseContextSyncMiddleware'
- 用户在小索同会话内新增材料/重跑模块的内容能立即出现在下一轮上下文"
```

---

## Task 6：改造模块对话 moduleAgent.ts

**Files:**
- Modify: `server/services/workflow/agents/moduleAgent.ts`

> moduleAgent 中间件用 plain array（非 buildMiddlewareStack），按数组顺序顺序执行；新增中间件直接放在数组首部即可保证 PROCESS_MATERIAL / MODULE_CONTEXT 的优先级关系（plain array 不读 priority 字段）。

- [ ] **Step 1: 替换顶部 imports**

`server/services/workflow/agents/moduleAgent.ts` 顶部 import 区：

`buildSystemPromptForAgent` 保留（用退化路径调用，不删）；新增：

```ts
import { renderSystemPrompt } from '~~/server/services/agent-platform/nodeConfig/promptRenderer'
import { caseProcessMaterialMiddleware } from '~~/server/agents/_shared/case-context/caseProcessMaterial.middleware'
import { caseContextSyncMiddleware } from '~~/server/agents/_shared/case-context/caseContextSync.middleware'
```

- [ ] **Step 2: 替换 SystemMessage 构造段（原第 152-163 行）**

原：
```ts
    const roleAndFlowTemplate = [
        renderSystemPrompt(nodeConfig, { caseId, moduleName }),
        '当你完成该模块的分析后...请勿在工具参数中重复正文。',
    ].filter(Boolean).join('\n\n')

    const { systemMessage, plainText: plainTextPrompt } = await buildSystemPromptForAgent(
        nodeConfig.modelSdkType,
        { caseId, agentName: moduleName, userQuery: message ?? '', roleAndFlowTemplate },
    )
```

改为：
```ts
    // SystemMessage 仅含 roleAndFlow（4 段案件上下文交给 caseContextSyncMiddleware 注入 HumanMessage）
    // 复用 buildSystemPromptForAgent 退化路径：caseId=null 时仅返单段 roleAndFlow + 按 SDK 分流
    const roleAndFlowText = [
        renderSystemPrompt(nodeConfig, { caseId, moduleName }),
        '当你完成该模块的分析后，请按以下顺序操作：1) 先以纯文本形式输出完整的分析报告（Markdown 格式）；2) 然后调用 save_analysis_result 工具（无需任何参数）。工具会自动从你刚输出的报告中读取内容保存。请勿在工具参数中重复正文。',
    ].filter(Boolean).join('\n\n')

    const { systemMessage, plainText: plainTextPrompt } = await buildSystemPromptForAgent(
        nodeConfig.modelSdkType,
        { caseId: null, agentName: moduleName, userQuery: '', roleAndFlowTemplate: roleAndFlowText },
    )
```

- [ ] **Step 3: 在 middleware 数组顶部加两个新中间件**

原 `middleware: [...]` 数组（约第 176-196 行），首条 `createMessageIntegrityMiddleware()` 之前加：

```ts
            // 业务私有：每轮自动补做未处理材料 + 实时拉案件上下文（plain array 顺序执行）
            caseProcessMaterialMiddleware(userId, caseId),
            caseContextSyncMiddleware({ caseId, agentName: moduleName }),
```

完整 middleware 数组顺序（保留原有 middleware）：
```ts
        middleware: [
            caseProcessMaterialMiddleware(userId, caseId),
            caseContextSyncMiddleware({ caseId, agentName: moduleName }),
            createMessageIntegrityMiddleware(),
            createScopeGuardMiddleware(),
            pointConsumptionMiddleware(userId, 'case_analysis_token', sessionId),
            summarizationMiddleware({ model, trigger: [{ tokens: triggerTokens }] }),
            safetyTrimMiddleware({ model, maxTokens, systemPrompt: plainTextPrompt, maxOutputTokens }),
            ...(skillsMw ? [skillsMw] : []),
            afterAgentMemoryMiddleware({ caseId, sessionId, userId }),
            createAuditMiddleware(),
        ],
```

> 注：safetyTrim 的 `systemPrompt: plainTextPrompt` 引用本任务已变更为 roleAndFlowText 的 plain text；变量名 `plainTextPrompt` 来自 `buildSystemPromptForAgent` 解构，自然与新值衔接。

- [ ] **Step 4: Commit（typecheck 留待 Task 13 统一跑）**

```bash
git add server/services/workflow/agents/moduleAgent.ts
git commit -m "refactor(case-module): SystemMessage 退化为 roleAndFlow，4 段交给 caseContextSyncMiddleware

- buildSystemPromptForAgent 改用 caseId=null 退化路径（与 assistantAgent 同款）
- middleware 数组首部加 caseProcessMaterialMiddleware + caseContextSyncMiddleware
- safetyTrim systemPrompt 自然衔接 roleAndFlow plain text"
```

---

## Task 7：改造文书生成 documentMainAgent.ts（含 draftLoader）

**Files:**
- Modify: `server/services/workflow/agents/documentMainAgent.ts`

- [ ] **Step 1: 替换顶部 imports**

`server/services/workflow/agents/documentMainAgent.ts` 顶部 import 区：

`buildSystemPromptForAgent` 保留；新增：

```ts
import { caseProcessMaterialMiddleware } from '~~/server/agents/_shared/case-context/caseProcessMaterial.middleware'
import { caseContextSyncMiddleware } from '~~/server/agents/_shared/case-context/caseContextSync.middleware'
```

`renderSystemPrompt` 已有 import，不需要改。

- [ ] **Step 2: 改 renderSystemPrompt 调用收窄 + placeholders 迁移到闭包外**

原（约第 96-112 行）：
```ts
    const placeholders = (template.placeholders ?? []) as Array<{ name: string; firstContext?: string }>
    const placeholdersWithHints = placeholders
        .map(p => `- ${p.name}${p.firstContext ? `(参考上下文:${p.firstContext})` : ''}`)
        .join('\n')
    const currentValuesJSON = JSON.stringify(draft.values ?? {}, null, 2)

    const resolvedCaseId = draft.caseId ?? caseId
    const roleAndFlowTemplate = renderSystemPrompt(nodeConfig, {
        caseId: resolvedCaseId,
        templateName: template.name,
        templateCategory: template.category,
        draftId: draft.id,
        status: draft.status,
        currentValuesJSON,
        placeholdersWithHints,
    })
```

改为：
```ts
    // 闭包外捕获：placeholders 渲染（template 不变，整 session 复用）
    const placeholders = (template.placeholders ?? []) as Array<{ name: string; firstContext?: string }>
    const placeholdersWithHints = placeholders
        .map(p => `- ${p.name}${p.firstContext ? `(参考上下文:${p.firstContext})` : ''}`)
        .join('\n')

    const resolvedCaseId = draft.caseId ?? caseId
    // SystemMessage 仅含 roleAndFlow（草稿字段+占位符 通过 caseContextSyncMiddleware 注入 HumanMessage）
    const roleAndFlowText = renderSystemPrompt(nodeConfig, {
        caseId: resolvedCaseId,
        templateName: template.name,
        templateCategory: template.category,
        draftId: draft.id,
        status: draft.status,
    })
```

- [ ] **Step 3: 替换 buildSystemPromptForAgent 调用为退化路径**

原（约第 113-121 行）：
```ts
    const { systemMessage, plainText: systemPromptPlainText } = await buildSystemPromptForAgent(
        nodeConfig.modelSdkType,
        {
            caseId: resolvedCaseId ?? null,
            agentName: DOCUMENT_MAIN_NODE_NAME,
            userQuery: message ?? '',
            roleAndFlowTemplate,
        },
    )
```

改为：
```ts
    // 复用 buildSystemPromptForAgent 退化路径：caseId=null 时仅返单段 roleAndFlow + 按 SDK 分流
    // （Anthropic 1h cache_control / 其他 SDK plain text）。与 assistantAgent / runtime.ts 同款。
    const { systemMessage, plainText: systemPromptPlainText } = await buildSystemPromptForAgent(
        nodeConfig.modelSdkType,
        {
            caseId: null,
            agentName: DOCUMENT_MAIN_NODE_NAME,
            userQuery: '',
            roleAndFlowTemplate: roleAndFlowText,
        },
    )
```

- [ ] **Step 4: 在 buildMiddlewareStack 调用之前定义 draftLoader 闭包**

在 `buildMiddlewareStack(...)` 调用之前（约第 156 行）插入 draftLoader 定义：

```ts
    // draftLoader：闭包外 placeholders 已渲染好不变；闭包内每轮实时查 draft.values
    const draftLoader = async () => ({
        placeholdersWithHints,
        draftValuesJSON: async () => {
            const latest = await findDraftBySessionIdDAO(sessionId)
            return JSON.stringify(latest?.values ?? draft.values ?? {}, null, 2)
        },
    })
```

注意：`findDraftBySessionIdDAO` 已在文件顶部 import；本步骤不新加 import。

- [ ] **Step 5: 在 middleware 栈里加 caseProcessMaterial + caseContextSync**

原 `buildMiddlewareStack([...])`（约第 156-207 行）数组中，**首条** `createMessageIntegrityMiddleware()` 之前插入：

```ts
        // 业务私有：每轮自动补做未处理材料（仅 caseId 非空时挂）+ 实时拉案件 4 段 + 文书 2 段
        ...(resolvedCaseId
            ? [{
                middleware: caseProcessMaterialMiddleware(userId, resolvedCaseId),
                priority: MIDDLEWARE_PRIORITY.PROCESS_MATERIAL,
                name: MIDDLEWARE_NAMES.PROCESS_MATERIAL,
            }]
            : []),
        {
            middleware: caseContextSyncMiddleware({
                caseId: resolvedCaseId ?? null,
                agentName: DOCUMENT_MAIN_NODE_NAME,
                draftLoader,
            }),
            priority: MIDDLEWARE_PRIORITY.MODULE_CONTEXT,
            name: MIDDLEWARE_NAMES.MODULE_CONTEXT,
        },
```

如 import 中尚无 `MIDDLEWARE_PRIORITY.PROCESS_MATERIAL` / `MIDDLEWARE_NAMES.PROCESS_MATERIAL` / `MIDDLEWARE_NAMES.MODULE_CONTEXT`，按需补 import。

- [ ] **Step 6: 验证 safetyTrim 的 systemPrompt 引用衔接正确**

Run:
```bash
grep -n "safetyTrim\|systemPrompt" /Users/daixin/work/dev/LexSeek/LexSeek/server/services/workflow/agents/documentMainAgent.ts
```
Expected: 见 `safetyTrimMiddleware` 调用处的 `systemPrompt: systemPromptPlainText`——本任务 Step 3 解构出 `systemPromptPlainText` 已对齐新值（roleAndFlow plain text）。如发现仍引用旧变量名，修正为 `systemPromptPlainText`。

- [ ] **Step 7: Commit（typecheck 留待 Task 13 统一跑）**

```bash
git add server/services/workflow/agents/documentMainAgent.ts
git commit -m "refactor(document): SystemMessage 退化为 roleAndFlow，草稿字段+占位符通过 draftLoader 注入

- buildSystemPromptForAgent 改用 caseId=null 退化路径（与 assistantAgent / runtime.ts 同款）
- renderSystemPrompt 收窄：去掉 currentValuesJSON / placeholdersWithHints 参数
- placeholders 渲染整体迁移到 draftLoader 闭包外（一次性，复用整 session）
- currentValuesJSON 拼装迁移到 draftLoader 闭包内（每轮实时查 draft.values）
- middleware 加 caseProcessMaterialMiddleware（仅 caseId 非空时挂）+ caseContextSyncMiddleware
- 用户编辑文书草稿字段后，下一轮对话能看到最新值"
```

---

## Task 8：修改 documentMain prompt 模板（seedData.sql + dev 库）

**Files:**
- Modify: `prisma/seeds/seedData.sql`（line 3673 起的 INSERT 语句 content 字段）

- [ ] **Step 1: 在 dev 库手动执行 UPDATE（同步 seedData 改动前先改 dev 库）**

> 项目数据级变更规范：直接改 dev 库 + 同步 seedData.sql。本步骤先改 dev 库验证 prompt 更新后 LLM 行为正常，再同步 seedData。

Run（连接 dev 库）：
```bash
docker exec -i $(docker ps -qf name=postgres) psql -U postgres -d ls_dev -c "
UPDATE prompts SET content = REPLACE(REPLACE(REPLACE(content,
  E'- 当前已填字段:{{currentValuesJSON}}\n', ''),
  E'- 模板字段清单:\n{{placeholdersWithHints}}\n', ''),
  E'# 当前工作上下文(运行时由系统注入)',
  E'# 当前工作上下文(每轮对话中以补充消息的形式提供草稿当前已填字段、模板待填占位符、案件档案、材料清单，请基于其中的最新内容回答用户)\n# 会话标识(运行时由系统注入)')
WHERE name = 'documentMain_system';
"
```

> 实际数据库容器名按 `docker ps` 查找替换。

- [ ] **Step 2: 验证 dev 库改动**

Run:
```bash
docker exec -i $(docker ps -qf name=postgres) psql -U postgres -d ls_dev -c "
SELECT content FROM prompts WHERE name = 'documentMain_system';
" | head -30
```
Expected: 输出中**不包含** `{{currentValuesJSON}}` 或 `{{placeholdersWithHints}}`，且开头部分含"每轮对话中以补充消息的形式提供"指引。

- [ ] **Step 3: 同步改 seedData.sql 对应 INSERT 语句的 content 字段**

打开 `prisma/seeds/seedData.sql`，定位 line 3673 起的 INSERT 语句（id=30, name='documentMain_system'）。

修改 content 字段：删除以下两段：
```
- 当前已填字段:{{currentValuesJSON}}
- 模板字段清单:
{{placeholdersWithHints}}
```

并把 `# 当前工作上下文(运行时由系统注入)` 这一行替换为：
```
# 当前工作上下文(每轮对话中以补充消息的形式提供草稿当前已填字段、模板待填占位符、案件档案、材料清单，请基于其中的最新内容回答用户)
# 会话标识(运行时由系统注入)
```

> ⚠️ 项目铁律：seedData.sql 只能 INSERT，不能 UPDATE/DELETE。本步骤是**直接修改 INSERT 语句的 content 字段值**（"现状的全量快照"），不是追加 UPDATE。

- [ ] **Step 4: Commit**

```bash
git add prisma/seeds/seedData.sql
git commit -m "feat(document): documentMain_system prompt 删除 {{currentValuesJSON}}/{{placeholdersWithHints}} 模板变量

草稿当前字段+模板占位符已迁移到 caseContextSyncMiddleware 注入的
HumanMessage（spec §4.2.3），prompt 模板加静态指引让 LLM 知道去
最新补充消息里查这些上下文。

dev 库已同步更新（项目规范：seedData.sql 是现状快照，不写 UPDATE 增量）。"
```

---

## Task 9：收敛 threadState.ts hardcoded 过滤

**Files:**
- Modify: `server/services/workflow/agents/threadState.ts`

- [ ] **Step 1: 改 getThreadValuesService 内的 hardcoded 过滤**

`server/services/workflow/agents/threadState.ts` 第 88-100 行：

旧：
```ts
        const filteredMessages = flatMessages.filter(msg => {
            if (msg.type === 'system') return false
            // 检查 HumanMessage 是否是注入的上下文消息
            if (msg.type === 'human') {
                const injector = (msg as any).response_metadata?.injectedBy as string | undefined
                if (injector?.startsWith('ModuleContext') || injector?.startsWith('CaseMaterial') || injector?.startsWith('SubAgentContext') || injector === 'CaseContextMiddleware') {
                    return false
                }
            }
            return true
        })
```

改为：
```ts
        const filteredMessages = flatMessages.filter(msg => {
            if (msg.type === 'system') return false
            // 用中央判定函数（自动覆盖新 tag CaseContextSyncMiddleware 与所有旧 tag）
            if (msg.type === 'human' && isInjectedContextMessage(msg)) return false
            return true
        })
```

- [ ] **Step 2: 改 loadSubAgentThreads 内的 hardcoded 过滤**

第 263-269 行：

旧：
```ts
                    const filteredMessages = subRawMessages
                        .map(messageToFlatDict)
                        .filter(msg => {
                            if (msg.type === 'system') return false
                            const meta = msg.response_metadata as { injectedBy?: string } | undefined
                            if (meta?.injectedBy) return false
                            return true
                        })
```

改为：
```ts
                    const filteredMessages = subRawMessages
                        .map(messageToFlatDict)
                        .filter(msg => {
                            if (msg.type === 'system') return false
                            if (isInjectedContextMessage(msg)) return false
                            return true
                        })
```

- [ ] **Step 3: 在文件顶部 import 区追加**

```ts
import { isInjectedContextMessage } from '~~/server/services/agent-platform/context/injectorDetection'
```

- [ ] **Step 4: Commit（typecheck 留待 Task 13 统一跑）**

```bash
git add server/services/workflow/agents/threadState.ts
git commit -m "refactor(workflow): threadState.ts 过滤逻辑改用 isInjectedContextMessage 中央判定

消除两处 hardcoded 字符串前缀判断，统一走 injectorDetection 模块。
新 tag 在 INJECTOR_EXACT 登记一次后自动覆盖此处。"
```

---

## Task 10：简化前端 useMessageParser.ts 兜底过滤

**Files:**
- Modify: `app/components/ai/composables/useMessageParser.ts`

- [ ] **Step 1: 改第 255-261 行 hardcoded 过滤**

旧：
```ts
        // HumanMessage 检测 metadata（注入的上下文消息）
        if (msgType === 'human') {
          const injector = (m as any).response_metadata?.injectedBy as string | undefined
          if (injector?.startsWith('ModuleContext') || injector?.startsWith('CaseMaterial') || injector?.startsWith('SubAgentContext') || injector === 'CaseContextMiddleware') {
            return false
          }
        }
```

改为：
```ts
        // HumanMessage 检测 metadata（注入的上下文消息）
        // 前端兜底定位：仅识别新机制 tag CaseContextSyncMiddleware；
        // 旧 tag（CaseContextMiddleware / ModuleContext* / CaseMaterial*）老数据
        // 由后端 SSE 流（agentSseStream）已过滤，前端不重复兜底（spec §4.3）。
        if (msgType === 'human') {
          const injector = (m as any).response_metadata?.injectedBy
            ?? (m as any).additional_kwargs?.injectedBy
          if (injector === 'CaseContextSyncMiddleware') {
            return false
          }
        }
```

- [ ] **Step 2: Commit（typecheck 留待 Task 13 统一跑）**

```bash
git add app/components/ai/composables/useMessageParser.ts
git commit -m "refactor(ui): useMessageParser 兜底过滤简化为只识别新 tag

旧 tag 老数据由后端 SSE 流统一过滤；前端兜底定位为防御性最后一道关，
不再追求与后端等价（spec §4.3 决策 B）。读取也支持 additional_kwargs 双轨字段。"
```

---

## Task 11：清理过时注释 + 删除旧 caseContext.middleware.ts

**Files:**
- Modify: `server/services/workflow/middleware/index.ts`
- Modify: `server/services/agent-platform/context/moduleContextBuilder.ts`
- Delete: `server/agents/_shared/case-context/caseContext.middleware.ts`

- [ ] **Step 1: 确认无引用残留 + 旧测试文件不存在**

Run:
```bash
grep -rn "caseContextMiddleware\|caseContext.middleware" \
  /Users/daixin/work/dev/LexSeek/LexSeek/server/ \
  /Users/daixin/work/dev/LexSeek/LexSeek/app/ \
  /Users/daixin/work/dev/LexSeek/LexSeek/tests/ \
  2>/dev/null | grep -v "caseContextSyncMiddleware\|caseContextSync.middleware\|CaseContextMiddleware'" \
                | grep -v "^Binary file"

find /Users/daixin/work/dev/LexSeek/LexSeek/tests -name "caseContext.middleware*" -o -name "caseContext.test*" 2>/dev/null
```
Expected:
- 第一条 grep：无输出（'CaseContextMiddleware' 是 INJECTOR_EXACT 中作为旧 tag 兼容字符串保留，不算引用）
- find：无输出（旧测试文件不存在，不需要处理）

- [ ] **Step 2: 更新 workflow/middleware/index.ts 第 7-9 行过时注释**

旧：
```ts
 * 注：caseMaterialContextMiddleware 已于 2026-04-30 删除——
 * caseMain 切换到 caseContextMiddleware（5 段式标准管线），
 * documentMainAgent 已直接调 buildSystemPromptForAgent 注入 5 段式 SystemMessage，无需独立中间件。
```

改为：
```ts
 * 注：caseMaterialContextMiddleware 已于 2026-04-30 删除——
 * caseMain / caseModule / documentMain 三个 Agent 已于 2026-05-05 统一切换到
 * caseContextSyncMiddleware（HumanMessage 注入 + 双轨 metadata + splice 模式），
 * 不再走 SystemMessage 拼装。详见 spec §4.2 与本仓库 plan 2026-05-05-agent-context-sync-unification.md。
```

- [ ] **Step 3: 在 moduleContextBuilder.ts buildSystemPromptForAgent 上方加调用方现状注释**

`server/services/agent-platform/context/moduleContextBuilder.ts` 第 152 行函数定义之上添加注释：

```ts
/**
 * 主 Agent caseMain（runtime.ts）/ caseModule（moduleAgent）/ documentMain
 * （documentMainAgent）已于 2026-05-05 改造为 SystemMessage 仅含 roleAndFlow
 * + caseContextSyncMiddleware 注入 4+2 段 HumanMessage 模式。三者通过 caseId=null
 * 退化路径仅复用本函数的"按 SDK 分流构造 SystemMessage（Anthropic 自动加 1h
 * cache_control）"能力。
 *
 * 当前使用本函数完整 5 段式拼装的调用方：
 * - subAgentToolFactory（ask_*_expert 子 Agent）
 * - runAnalysisSubAgent（案件分析子 Agent）
 * - contractReviewMainAgent（合同审查主 Agent，本次改造非目标范围 spec §2.2）
 * - assistantAgent（通用问答主 Agent，caseId 永远 null，本次改造非目标）
 *
 * 一站式构建 agent 的 SystemMessage：
 * buildContextSegments → toCachedPrompt → 按 sdkType 分流（anthropic content blocks
 * / plain text） → SystemMessage。
 */
export async function buildSystemPromptForAgent(
```

- [ ] **Step 4: 删除旧 caseContext.middleware.ts**

Run:
```bash
git rm server/agents/_shared/case-context/caseContext.middleware.ts
```

- [ ] **Step 5: Commit（typecheck 留待 Task 13 统一跑）**

```bash
git add server/services/workflow/middleware/index.ts \
        server/services/agent-platform/context/moduleContextBuilder.ts
git commit -m "chore(agent-platform): 删除旧 caseContextMiddleware + 同步过期注释

- 删 server/agents/_shared/case-context/caseContext.middleware.ts（被
  caseContextSyncMiddleware 替代，所有调用方已切换）
- workflow/middleware/index.ts:7-9 注释反映三 Agent 已统一改造现状
- moduleContextBuilder.ts buildSystemPromptForAgent 上方加注释列举真实调用方
  现状（含 4 个仍走完整 5 段式的调用方 + 3 个走退化路径的主 Agent）"
```

---

## Task 12：补 caseContextSync 集成测试（spec §7.2 要求）

**Files:**
- Create: `tests/server/agent-platform/caseContextSync.integration.test.ts`

> spec §7.2 明确要求"`tests/server/agent-platform/` 下三个 Agent 端到端集成测试 + 文书 Agent 新增'用户编辑 draft.values 后下轮 draftLoader 看到最新值'集成测试"。Task 14 端到端手动验证作为最终用户层验收，但本 Task 在自动化测试层补齐 spec §7.2 关键断言。

- [ ] **Step 1: 写集成测试文件**

```ts
// tests/server/agent-platform/caseContextSync.integration.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import { HumanMessage } from '@langchain/core/messages'
import { caseContextSyncMiddleware } from '~~/server/agents/_shared/case-context/caseContextSync.middleware'

// 真实集成：不 mock buildContextSegments，让中间件穿透到 prisma 查实际数据。
// 测试需要 worker 级 DB 隔离基建（vitest globalSetup 自动建 ls_test_w<id> 库），
// 真实写入 cases / caseMaterials / caseAnalyses 行后跑中间件验证完整链路。
//
// ⚠️ 测试无残留铁律（.claude/rules/testing.md 终极规则）：每个 it 创建的 cases /
// documentDrafts 行必须在 afterEach 反向（叶表 → 父表）按 createdIds 清理，否则
// 同 worker 跑到下一文件会因 unique 冲突或断言污染失败。

import { prisma } from '~~/server/utils/db'

const createdIds = { cases: [] as number[], drafts: [] as number[] }

async function seedCaseFixture() {
    const userId = 1
    const caseTypeId = 1 // seedData 已建
    // 创建测试案件
    const c = await prisma.cases.create({
        data: {
            userId,
            caseTypeId,
            title: '集成测试案件',
            status: 1,
            sessionId: `it-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            plaintiff: ['原告甲'],
            defendant: ['被告乙'],
            summary: '集成测试摘要',
        },
    })
    createdIds.cases.push(c.id)
    return { caseId: c.id, userId }
}

describe('caseContextSyncMiddleware 集成测试（穿透真实 DB）', () => {
    // 每个 it 跑完后反向清理（叶表 documentDrafts 先删，再删父表 cases）。
    // 类型 C 防 FK 残留 + 类型 B 防 unique 冲突，对齐 testing.md 套路。
    afterEach(async () => {
        if (createdIds.drafts.length) {
            await prisma.documentDrafts.deleteMany({ where: { id: { in: createdIds.drafts } } })
            createdIds.drafts = []
        }
        if (createdIds.cases.length) {
            await prisma.cases.deleteMany({ where: { id: { in: createdIds.cases } } })
            createdIds.cases = []
        }
    })

    it('小索路径：注入消息含真实案件档案 + 案件材料清单', async () => {
        const { caseId } = await seedCaseFixture()

        const mw = caseContextSyncMiddleware({ caseId, agentName: 'caseMain' })
        const userMsg = new HumanMessage('案件进展')
        const state = { messages: [userMsg] }

        await mw.beforeAgent.hook(state)

        expect(state.messages.length).toBeGreaterThanOrEqual(2)
        const ctx = state.messages[0]
        expect(ctx.response_metadata?.injectedBy).toBe('CaseContextSyncMiddleware')
        expect(ctx.content).toContain('集成测试案件')
        expect(ctx.content).toContain('原告甲')
    })

    it('文书路径：用户编辑 draft.values 后下轮 draftLoader 看到最新值（spec §7.2 关键断言）', async () => {
        const { caseId } = await seedCaseFixture()

        // 真实创建 draft（schema 字段按现有 prisma model）
        const draft = await prisma.documentDrafts.create({
            data: {
                userId: 1,
                templateId: 1, // seedData 已建
                caseId,
                values: { '原告': '初版' },
                status: 'drafting',
                title: '集成测试草稿',
                sessionId: `draft-it-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            },
        })
        createdIds.drafts.push(draft.id)

        const draftLoader = async () => ({
            placeholdersWithHints: '- 原告\n- 被告',
            draftValuesJSON: async () => {
                const latest = await prisma.documentDrafts.findFirst({
                    where: { id: draft.id },
                    select: { values: true },
                })
                return JSON.stringify(latest?.values ?? {}, null, 2)
            },
        })

        const mw = caseContextSyncMiddleware({
            caseId,
            agentName: 'documentMain',
            draftLoader,
        })

        // 第一轮：注入消息含 "初版"
        const state1 = { messages: [new HumanMessage('看看草稿')] }
        await mw.beforeAgent.hook(state1)
        expect(state1.messages[0].content).toContain('初版')

        // 用户在 UI 编辑：值改为 "更新后"
        await prisma.documentDrafts.update({
            where: { id: draft.id },
            data: { values: { '原告': '更新后' } },
        })

        // 第二轮：注入消息应含 "更新后"，不含 "初版"（draftLoader 实时查库）
        const state2 = { messages: [new HumanMessage('继续')] }
        await mw.beforeAgent.hook(state2)
        expect(state2.messages[0].content).toContain('更新后')
        expect(state2.messages[0].content).not.toContain('初版')
    })

    it('小索路径多轮：每轮新增独立注入消息（不复用历史 + 不修改历史）', async () => {
        const { caseId } = await seedCaseFixture()

        const mw = caseContextSyncMiddleware({ caseId, agentName: 'caseMain' })
        const state = { messages: [new HumanMessage('q1')] }

        await mw.beforeAgent.hook(state)
        const round1Length = state.messages.length

        // 模拟第二轮：append AI 响应 + 新 user
        state.messages.push(new HumanMessage('q2'))
        await mw.beforeAgent.hook(state)

        expect(state.messages.length).toBe(round1Length + 2)
        // 第一轮的注入消息位置不变（不修改历史）
        expect(state.messages[0].response_metadata?.injectedBy).toBe('CaseContextSyncMiddleware')
        // 第二轮注入消息插在 q2 之前
        const lastIdx = state.messages.length - 1
        expect(state.messages[lastIdx].content).toBe('q2')
        expect(state.messages[lastIdx - 1].response_metadata?.injectedBy).toBe('CaseContextSyncMiddleware')
    })
})
```

- [ ] **Step 2: 跑集成测试确认通过**

Run:
```bash
npx vitest run tests/server/agent-platform/caseContextSync.integration.test.ts --reporter=verbose
```
Expected: 全部 PASS。如失败排查：
- worker DB 隔离是否生效（参考 tests/_infra/）
- documentDrafts schema 字段名是否变更（按当前 prisma model 调整 seed）
- 待断言文字是否随 buildContextSegments 输出格式变动

- [ ] **Step 3: Commit**

```bash
git add tests/server/agent-platform/caseContextSync.integration.test.ts
git commit -m "test(agent-platform): 补 caseContextSyncMiddleware 集成测试（spec §7.2）

- 小索路径：注入消息含真实案件档案
- 文书路径：用户编辑 draft.values 后下轮 draftLoader 看到最新值（spec §7.2 关键断言）
- 多轮注入位置：每轮新增独立消息且不修改历史（spec 'A 模式' 验证）"
```

---

## Task 13：typecheck + 单测复跑（按 spec §7 验收）

**Files:**
- 全项目验证

- [ ] **Step 1: 全项目 typecheck**

Run:
```bash
npx nuxi typecheck 2>&1 | tail -50
```
Expected: 无 caseContext / caseContextSync / runtime / moduleAgent / documentMainAgent / threadState / useMessageParser / promptRenderer 相关错误。

- [ ] **Step 2: 跑改造涉及的所有单测**

Run:
```bash
npx vitest run \
  tests/server/services/agent-platform/context/injectorDetection.test.ts \
  tests/server/agents/_shared/case-context/caseContextSync.middleware.test.ts \
  tests/server/agent-platform/caseContextSync.integration.test.ts \
  --reporter=verbose
```
Expected: 全部 PASS。

- [ ] **Step 3: 跑覆盖率确认 caseContextSyncMiddleware ≥90%**

Run:
```bash
npx vitest run tests/server/agents/_shared/case-context/caseContextSync.middleware.test.ts \
  --coverage \
  --coverage.include='server/agents/_shared/case-context/caseContextSync.middleware.ts' \
  2>&1 | tail -30
```
Expected: 该文件 statements / branches / functions / lines 均 ≥ 90%。

- [ ] **Step 4: 跑工作流相关测试目录回归**

Run:
```bash
npx vitest run tests/server/services/workflow/ --reporter=verbose 2>&1 | tail -50
```
Expected: 全部 PASS。如有先前测试依赖 buildSystemPromptForAgent 模板的细节断言失败，按改造结果更新断言。

- [ ] **Step 5: 跑案件相关测试目录回归**

Run:
```bash
npx vitest run tests/server/services/case/ tests/server/agents/ --reporter=verbose 2>&1 | tail -50
```
Expected: 全部 PASS。

- [ ] **Step 6: 跑前端 useMessageParser 测试（如有）**

Run:
```bash
find /Users/daixin/work/dev/LexSeek/LexSeek/tests/client -name "*MessageParser*" 2>/dev/null
```
如有，跑：
```bash
npx vitest run <path> --reporter=verbose
```
Expected: PASS。

- [ ] **Step 7: 总结测试结果**

如全部通过，进入 Task 14。如有失败：
- 优先排查是否本次改造导致的回归
- 如是回归，定位文件 → 修复 → 再次跑该测试 → 提交修复
- 如是历史已知失败（参考 `tests/KNOWN_FAILS.md`），跳过

---

## Task 14：端到端验证 + 总结

**Files:**
- 完成性验证

- [ ] **Step 1: 启动 dev server**

Run:
```bash
bun dev &
DEV_PID=$!
sleep 10
```

记录 DEV_PID 备用。

- [ ] **Step 2: 端到端验证小索（验收第 2 条）**

通过浏览器或现有前端：
1. 进入某案件的小索对话窗口
2. 发起一轮对话："看一下案件目前进展"
3. **不退出窗口**，去案件材料页上传一份新材料 → 等到状态显示已识别
4. 回到小索窗口，发第二轮："刚才上传的材料里有什么内容"
5. 观察 LLM 回复——应当能感知到新材料（spec §10 验收第 2 条）

如失败，看 logs：检查 caseContextSyncMiddleware 日志是否有"实时拉"记录、SystemMessage 是否稳定、注入消息是否进入 LLM。

- [ ] **Step 3: 端到端验证文书生成（验收第 4 条）**

1. 创建一个文书草稿（任意模板）
2. Agent 对话填一两个字段
3. **打开 draft 编辑 UI**，手动改一个字段值并保存
4. 回到对话发新一轮："当前已填字段有哪些"
5. 观察 LLM 回复——应当看到改动后的最新值（spec §10 验收第 4 条）

> 注：本步骤的自动化版本已在 Task 12 集成测试覆盖；此处是用户层最终验收。

- [ ] **Step 4: 端到端验证三 Agent 都触发材料预处理（验收第 7 条）**

1. 案件下上传一份未识别的材料（OCR 状态为 idle）
2. 分别在小索 / 模块对话 / 文书生成三个入口发一轮对话
3. 检查 caseMaterials 表对应行的 status 字段——应在每个 Agent 启动后变为 3（COMPLETED）
4. 文书生成 caseId=null 场景：在不绑定案件的草稿里发对话——不应触发材料扫描（spec §10 验收第 7 条）

- [ ] **Step 5: 验证 SSE 流前端无注入消息（验收第 5 条）**

打开浏览器 DevTools → Network → 看任一 Agent 的 SSE 流：
- `event: values` 中的 `messages` 数组应不含 `injectedBy='CaseContextSyncMiddleware'` 的消息
- `event: messages` 增量推送应同样过滤干净

- [ ] **Step 6: 验证 checkpoint 仍存有注入消息（验收第 6 条）**

Run（连接 dev 库）：
```bash
docker exec -i $(docker ps -qf name=postgres) psql -U postgres -d ls_dev -c "
SELECT checkpoint::text
FROM langgraph.checkpoints
ORDER BY thread_id, checkpoint_id DESC
LIMIT 1;
" | grep -c "CaseContextSyncMiddleware"
```
Expected: ≥1（注入消息存在 checkpoint，不是只在内存）。

- [ ] **Step 7（可选）: Anthropic cache 命中率观察（验收第 9 条结构验证已在 Task 13 完成；命中率属上线后监控）**

如使用 Claude 模型 + 已配置 Langfuse：在 trace 或 dev server 日志查找 `prompt_cache` 日志，
SystemMessage 段应在第二轮起命中接近 100%。**非合并门槛**，命中率验证可滚到上线后例行观测（spec §8.4）。

> 如使用 OpenAI / Gemini 模型，跳过本步骤。

- [ ] **Step 8: 关闭 dev server**

按项目 feedback `feedback_kill_dev_on_finish.md`：阶段收尾必须 kill -9 dev server。

Run:
```bash
kill -9 $DEV_PID 2>/dev/null
```

- [ ] **Step 9: 总结 + 通知用户**

整理本次改造：
- 14 个任务全部完成
- 验收 9 条（spec §10）逐条结果
- 是否有发现需要后续跟进的小问题（记录到笔记，不阻塞合并）

输出给用户：
- 改造完成
- 测试 / typecheck / 端到端验证结果
- 等待用户决定是否合并 / 推 PR
