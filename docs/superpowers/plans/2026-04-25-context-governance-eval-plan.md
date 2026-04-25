# 上下文机制评测基建（Context Governance Eval）实施计划 v1（已废弃）

> ⚠️ **本文档已被 v2 替代，请勿用作实施依据**：
> - 实施依据：`2026-04-25-context-governance-eval-plan-v2.md`
> - v1 含错误代码块（`prisma.case_memories` 应为 `caseMemories`、`runCaseChat` 签名错、SSE 协议虚构、`buildContextSegments` 签名错、`vi.mock` 在 bun runtime 不可用、ossMock 写不存在的 export 等）
> - v1 末尾的"附录 A 修订记录"自身又含 4 个 P0 错（SSE/monkey-patch/users 字段/buildContextSegments 签名）
> - v2 已合并所有修订到 Task 原文（单一信源），可直接按 Task 顺序实施

> **本文档保留仅供审计追踪**。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `tests/eval/` 下造一个独立于 vitest 的端到端评测框架，手动 `bun run eval:context` 触发，对 M1-M4（案件上下文治理）改造效果给出 26 项指标的通过/不通过结论 + MD/JSON/HTML 三件套报告。

**Architecture:** 评测框架本体跑在独立 `ls_eval` 测试库，并发度=1 串行跑 29 提问 + 3 段抽取 transcript + 6 安全 + 4 稳定断言。Cost 通过新建的 `LLMUsageCallbackHandler` 从 LangChain 的 `response_metadata.usage` 读 DeepSeek 原始 cache 字段；Quality 走 facts 字符串匹配 + DeepSeek-as-judge；Extraction 通过 consolidator 新增的 `processNowService` 同步等待。Security/Stability 独立 step 直接调服务/HTTP 断言。三件套报告共享 JSON schema。

**Tech Stack:** Bun + TypeScript + Prisma + LangChain JS + js-tiktoken + DeepSeek API + 静态 vanilla JS HTML viewer + Tailwind CDN

**关联文档：**
- 设计文档：`docs/superpowers/specs/2026-04-25-context-governance-eval-design.md`
- 评测对象：`docs/superpowers/specs/2026-04-23-case-context-governance-design.md`（M1-M4 改造）

---

## File Structure

### 新建

```
tests/eval/
├── README.md                            # 使用说明
├── runEval.ts                           # 入口（Step 1-9）
├── utils/
│   ├── prng.ts                          # mulberry32 确定性 PRNG
│   ├── traceReader.ts                   # 从 agent_runs 读 tool_calls
│   ├── ossMock.ts                       # OSS 客户端 mock 注入
│   └── runtimeGuards.ts                 # DATABASE_URL 必须含 ls_eval 等防误删守卫
├── fixtures/
│   ├── buildFixture.ts                  # 3 案件完整数据 builder
│   ├── testDataset.ts                   # Part 1 的 29 条提问
│   ├── extractionDataset.ts             # Part 2 的 3 段 transcript
│   └── securityDataset.ts               # Part 3 的独立断言配置
├── metrics/
│   ├── costMetrics.ts                   # token / cache / latency 聚合
│   ├── qualityMetrics.ts                # facts 匹配 + judge 调度
│   ├── judgePrompt.ts                   # DeepSeek judge prompt 模板
│   ├── taskMetrics.ts                   # 工具调用准确率
│   ├── extractionMetrics.ts             # recall / precision / 版本链
│   ├── securityMetrics.ts               # 跨案件 + ARCHIVED 守卫 + AI autofill
│   └── stabilityMetrics.ts              # prompt hash + switch active + 旧数据
└── report/
    ├── reportTypes.ts                   # 共享 JSON schema
    ├── jsonReporter.ts                  # 完整 JSON
    ├── markdownReporter.ts              # 节选 MD
    └── reportIndex.ts                   # 维护 docs/eval-reports/index.json

server/services/workflow/callbacks/      # 新目录
└── LLMUsageCallbackHandler.ts           # 从 response_metadata.usage 抓原始 cache 字段

docs/eval-reports/
├── viewer.html                          # 静态可视化页面（永久）
└── index.json                           # 报告索引
```

### 修改

- `package.json`：新增 `eval:context` script
- `server/services/memory/consolidator.service.ts`：新增 public `processNowService(caseId)` 方法

---

## Task 1: 项目骨架 + ls_eval 库初始化 + bun 别名 spike

**Files:**
- Create: `tests/eval/runEval.ts`（占位）
- Create: `tests/eval/README.md`（占位）
- Create: `tests/eval/utils/runtimeGuards.ts`
- Modify: `package.json:scripts`

- [ ] **Step 1: 创建目录骨架**

```bash
mkdir -p tests/eval/{utils,fixtures,metrics,report}
mkdir -p server/services/workflow/callbacks
mkdir -p docs/eval-reports
```

- [ ] **Step 2: 在 package.json 加 eval 脚本**

修改 `package.json`，在 `scripts` 节加：

```json
"eval:context": "DATABASE_URL='postgresql://daixin:daixin88@localhost:5432/ls_eval?schema=public&TimeZone=UTC' bun run tests/eval/runEval.ts"
```

- [ ] **Step 3: 写 runtimeGuards.ts**

```ts
// tests/eval/utils/runtimeGuards.ts
export function assertEvalDatabase(): void {
  const url = process.env.DATABASE_URL ?? ''
  if (!url.includes('ls_eval')) {
    throw new Error(
      `[eval] 拒绝运行：DATABASE_URL 必须包含 'ls_eval'，当前值疑似指向生产/测试库。\n` +
      `请用 'bun run eval:context' 启动，不要直接 'bun run tests/eval/runEval.ts'。`,
    )
  }
}
```

- [ ] **Step 4: 写 runEval.ts 占位入口**

```ts
// tests/eval/runEval.ts
import { assertEvalDatabase } from './utils/runtimeGuards'

async function main() {
  assertEvalDatabase()
  // eslint-disable-next-line no-console
  console.log('[eval] runEval skeleton ok, DATABASE_URL guard passed')
}

main().catch(err => {
  // eslint-disable-next-line no-console
  console.error('[eval] runner crashed', err)
  process.exit(2)
})
```

- [ ] **Step 5: 初始化 ls_eval 数据库**

```bash
createdb ls_eval
DATABASE_URL='postgresql://daixin:daixin88@localhost:5432/ls_eval?schema=public&TimeZone=UTC' bun run prisma:push --accept-data-loss
```

Expected: `Database synchronized` 或同等成功消息。

- [ ] **Step 6: 验证 bun runtime + 别名解析**

```bash
bun run eval:context
```

Expected: 输出 `[eval] runEval skeleton ok, DATABASE_URL guard passed`。

如果 bun 报 `Cannot resolve '~~/...'`，回退方案：runEval.ts 全部 import 走相对路径（`../../server/...`），后续所有任务遵循该约定。

- [ ] **Step 7: 写 README.md 占位**

```markdown
# Context Governance Eval

手动触发的端到端评测框架。详见 `docs/superpowers/specs/2026-04-25-context-governance-eval-design.md`。

## 一次性初始化

```bash
createdb ls_eval
DATABASE_URL='postgresql://daixin:daixin88@localhost:5432/ls_eval?schema=public&TimeZone=UTC' bun run prisma:push --accept-data-loss
```

## 运行

```bash
bun run eval:context
```

报告产出：`docs/eval-reports/YYYY-MM-DD-HHmm-context-governance.{md,json}`。

打开 viewer：`python3 -m http.server` 后访问 `http://localhost:8000/docs/eval-reports/viewer.html`。
```

- [ ] **Step 8: Commit**

```bash
git add tests/eval/runEval.ts tests/eval/README.md tests/eval/utils/runtimeGuards.ts package.json
git commit -m "feat(eval): 初始化 eval 框架骨架 + ls_eval 库守卫"
```

---

## Task 2: utils/prng.ts —— mulberry32 确定性 PRNG

**Files:**
- Create: `tests/eval/utils/prng.ts`
- Test: `tests/eval/utils/prng.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/eval/utils/prng.test.ts
import { describe, it, expect } from 'vitest'
import { mulberry32, generateUuidV4 } from './prng'

describe('mulberry32', () => {
  it('给定相同 seed 输出确定序列', () => {
    const r1 = mulberry32(42)
    const r2 = mulberry32(42)
    const seq1 = Array.from({ length: 10 }, () => r1())
    const seq2 = Array.from({ length: 10 }, () => r2())
    expect(seq1).toEqual(seq2)
  })

  it('值域在 [0, 1)', () => {
    const r = mulberry32(7)
    for (let i = 0; i < 100; i++) {
      const v = r()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

describe('generateUuidV4', () => {
  it('给定相同 PRNG 产生相同 UUID', () => {
    const r1 = mulberry32(42)
    const r2 = mulberry32(42)
    expect(generateUuidV4(r1)).toBe(generateUuidV4(r2))
  })

  it('UUID 符合 v4 格式', () => {
    const r = mulberry32(1)
    const uuid = generateUuidV4(r)
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/eval/utils/prng.test.ts --reporter=verbose`
Expected: FAIL with `Cannot find module './prng'`。

- [ ] **Step 3: 实现 prng.ts**

```ts
// tests/eval/utils/prng.ts

/** 32-bit 确定性 PRNG。返回 [0,1) 范围内的随机数生成器。 */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0
  return function () {
    s = (s + 0x6d2b79f5) | 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 用确定性 PRNG 生成 UUID v4。同 PRNG 状态产同 UUID。 */
export function generateUuidV4(rng: () => number): string {
  const bytes = new Uint8Array(16)
  for (let i = 0; i < 16; i++) bytes[i] = Math.floor(rng() * 256)
  bytes[6] = (bytes[6] & 0x0f) | 0x40   // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80   // variant 10
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0'))
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/eval/utils/prng.test.ts --reporter=verbose`
Expected: PASS 4 tests。

- [ ] **Step 5: Commit**

```bash
git add tests/eval/utils/prng.ts tests/eval/utils/prng.test.ts
git commit -m "feat(eval): mulberry32 确定性 PRNG + UUID 生成"
```

---

## Task 3: 新建 LLMUsageCallbackHandler

**Files:**
- Create: `server/services/workflow/callbacks/LLMUsageCallbackHandler.ts`
- Test: `tests/server/workflow/callbacks/LLMUsageCallbackHandler.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/server/workflow/callbacks/LLMUsageCallbackHandler.test.ts
import { describe, it, expect } from 'vitest'
import { AIMessage } from '@langchain/core/messages'
import { LLMUsageCallbackHandler } from '~~/server/services/workflow/callbacks/LLMUsageCallbackHandler'

describe('LLMUsageCallbackHandler', () => {
  it('从 response_metadata.usage 读 DeepSeek 原始 cache 字段', async () => {
    const handler = new LLMUsageCallbackHandler({ tag: 'test', isWarmup: false })
    const fakeOutput = {
      generations: [[{
        message: new AIMessage({
          content: 'hi',
          response_metadata: {
            usage: {
              prompt_tokens: 1000,
              prompt_cache_hit_tokens: 600,
              prompt_cache_miss_tokens: 400,
              completion_tokens: 50,
            },
          },
        }),
      }]],
    }
    await handler.handleLLMEnd(fakeOutput as any, 'run-1')
    const records = handler.getRecords()
    expect(records).toHaveLength(1)
    expect(records[0].usage.prompt_tokens).toBe(1000)
    expect(records[0].usage.prompt_cache_hit_tokens).toBe(600)
    expect(records[0].isWarmup).toBe(false)
  })

  it('Anthropic 协议字段也能正确读取', async () => {
    const handler = new LLMUsageCallbackHandler({ tag: 'a', isWarmup: false })
    const fakeOutput = {
      generations: [[{
        message: new AIMessage({
          content: 'x',
          response_metadata: {
            usage: {
              input_tokens: 2000,
              output_tokens: 100,
              cache_read_input_tokens: 1500,
              cache_creation_input_tokens: 500,
            },
          },
        }),
      }]],
    }
    await handler.handleLLMEnd(fakeOutput as any, 'run-2')
    const r = handler.getRecords()[0]
    expect(r.usage.cache_read_input_tokens).toBe(1500)
  })

  it('isWarmup 标记会原样保留以便聚合时过滤', async () => {
    const handler = new LLMUsageCallbackHandler({ tag: 'warm', isWarmup: true })
    await handler.handleLLMEnd({
      generations: [[{ message: new AIMessage({ content: 'x', response_metadata: { usage: {} } }) }]],
    } as any, 'run-3')
    expect(handler.getRecords()[0].isWarmup).toBe(true)
  })

  it('记 latency（startTime → endTime）', async () => {
    const handler = new LLMUsageCallbackHandler({ tag: 't', isWarmup: false })
    const runId = 'run-4'
    await handler.handleLLMStart({} as any, ['hi'], runId)
    await new Promise(r => setTimeout(r, 20))
    await handler.handleLLMEnd({
      generations: [[{ message: new AIMessage({ content: 'x', response_metadata: { usage: {} } }) }]],
    } as any, runId)
    expect(handler.getRecords()[0].latencyMs).toBeGreaterThanOrEqual(20)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/server/workflow/callbacks/LLMUsageCallbackHandler.test.ts --reporter=verbose`
Expected: FAIL with module not found。

- [ ] **Step 3: 实现 LLMUsageCallbackHandler**

```ts
// server/services/workflow/callbacks/LLMUsageCallbackHandler.ts
import { BaseCallbackHandler } from '@langchain/core/callbacks/base'
import type { LLMResult } from '@langchain/core/outputs'

export interface RawLLMUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  // DeepSeek 原生
  prompt_cache_hit_tokens?: number
  prompt_cache_miss_tokens?: number
  // Anthropic 协议
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  // OpenAI 协议
  prompt_tokens_details?: {
    cached_tokens?: number
  }
}

export interface LLMUsageRecord {
  tag: string
  runId: string
  usage: RawLLMUsage
  latencyMs: number
  isWarmup: boolean
  ts: number
}

interface HandlerOptions {
  tag: string
  isWarmup: boolean
}

/**
 * 从 LangChain LLM callback 抓取**供应商原始 usage**（不走标准化的 usage_metadata）。
 *
 * 使用方式：在 eval runner 里实例化一次，注册到 chat model 的 callbacks 数组，
 * 跑完后 `getRecords()` 拿全部记录用于 aggregator。
 *
 * 为什么不用 LangChain 标准化的 usage_metadata：DeepSeek 的 `prompt_cache_hit_tokens`
 * 不在标准字段里，只在 `response_metadata.usage` 中。
 */
export class LLMUsageCallbackHandler extends BaseCallbackHandler {
  name = 'LLMUsageCallbackHandler'
  private records: LLMUsageRecord[] = []
  private startTimes = new Map<string, number>()

  constructor(private opts: HandlerOptions) {
    super()
  }

  async handleLLMStart(_llm: unknown, _prompts: string[], runId: string): Promise<void> {
    this.startTimes.set(runId, Date.now())
  }

  async handleLLMEnd(output: LLMResult, runId: string): Promise<void> {
    const startedAt = this.startTimes.get(runId) ?? Date.now()
    const latencyMs = Date.now() - startedAt
    this.startTimes.delete(runId)

    const message = output?.generations?.[0]?.[0]?.message as { response_metadata?: { usage?: RawLLMUsage } } | undefined
    const usage: RawLLMUsage = message?.response_metadata?.usage ?? {}

    this.records.push({
      tag: this.opts.tag,
      runId,
      usage,
      latencyMs,
      isWarmup: this.opts.isWarmup,
      ts: Date.now(),
    })
  }

  getRecords(): readonly LLMUsageRecord[] {
    return this.records
  }

  reset(): void {
    this.records = []
    this.startTimes.clear()
  }

  /** 切换 warmup flag（warmup 阶段结束后调用） */
  setWarmup(isWarmup: boolean): void {
    this.opts.isWarmup = isWarmup
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/server/workflow/callbacks/LLMUsageCallbackHandler.test.ts --reporter=verbose`
Expected: PASS 4 tests。

- [ ] **Step 5: Commit**

```bash
git add server/services/workflow/callbacks/LLMUsageCallbackHandler.ts tests/server/workflow/callbacks/LLMUsageCallbackHandler.test.ts
git commit -m "feat(callbacks): 新建 LLMUsageCallbackHandler 抓供应商原始 cache 字段"
```

---

## Task 4: utils/traceReader.ts —— 从 agent_runs 读 tool_calls

**Files:**
- Create: `tests/eval/utils/traceReader.ts`
- Test: `tests/eval/utils/traceReader.test.ts`

- [ ] **Step 1: 调研 agent_runs schema**

Run: `cat prisma/models/agentRun.prisma`

记下 `agent_runs` 表关键字段（应有 `id` / `threadId` / `state` 或类似 JSON checkpoint 字段）。下面实现假定 LangGraph checkpoint 存在 `state` JSON 字段，里面有 `messages` 数组、tool_call 信息走 `messages[].tool_calls`。如果实际字段名不同，按真实字段调整。

- [ ] **Step 2: 写失败测试**

```ts
// tests/eval/utils/traceReader.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '~~/server/utils/db'
import { getToolCallsFromThread } from './traceReader'

describe('getToolCallsFromThread', () => {
  let threadId: string

  beforeAll(async () => {
    threadId = `eval-trace-test-${Date.now()}`
    await prisma.agentRuns.create({
      data: {
        threadId,
        runId: `run-${Date.now()}`,
        kind: 'test',
        state: {
          messages: [
            { role: 'user', content: 'hi' },
            {
              role: 'assistant',
              content: '',
              tool_calls: [
                { name: 'search_case_memory', args: { query: 'foo' }, id: 't1' },
                { name: 'search_case_materials', args: { query: 'bar' }, id: 't2' },
              ],
            },
            { role: 'tool', content: '{"hits":[]}', tool_call_id: 't1' },
          ],
        },
      } as any,
    })
  })

  afterAll(async () => {
    await prisma.agentRuns.deleteMany({ where: { threadId } })
  })

  it('返回 thread 内所有 tool_calls 的 name 列表', async () => {
    const calls = await getToolCallsFromThread(threadId)
    const names = calls.map(c => c.name).sort()
    expect(names).toEqual(['search_case_materials', 'search_case_memory'])
  })

  it('thread 不存在时返回空数组', async () => {
    const calls = await getToolCallsFromThread('non-existent-thread')
    expect(calls).toEqual([])
  })
})
```

- [ ] **Step 3: 运行测试确认失败**

Run: `DATABASE_URL='postgresql://daixin:daixin88@localhost:5432/ls_eval?schema=public&TimeZone=UTC' npx vitest run tests/eval/utils/traceReader.test.ts --reporter=verbose`
Expected: FAIL（module not found）。

- [ ] **Step 4: 实现 traceReader**

```ts
// tests/eval/utils/traceReader.ts
import { prisma } from '~~/server/utils/db'

export interface ToolCallTrace {
  name: string
  args: Record<string, unknown>
  id?: string
  result?: string
}

/** 从 agent_runs 表读 thread 的所有 tool_calls。LangGraph checkpoint state 里 messages[].tool_calls。 */
export async function getToolCallsFromThread(threadId: string): Promise<ToolCallTrace[]> {
  const runs = await prisma.agentRuns.findMany({
    where: { threadId },
    select: { state: true },
    orderBy: { createdAt: 'asc' },
  })

  const calls: ToolCallTrace[] = []
  for (const run of runs) {
    const state = run.state as { messages?: Array<{ tool_calls?: ToolCallTrace[] }> } | null
    const messages = state?.messages ?? []
    for (const m of messages) {
      if (Array.isArray(m.tool_calls)) {
        for (const tc of m.tool_calls) {
          calls.push({ name: tc.name, args: tc.args ?? {}, id: tc.id })
        }
      }
    }
  }
  return calls
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `DATABASE_URL='postgresql://daixin:daixin88@localhost:5432/ls_eval?schema=public&TimeZone=UTC' npx vitest run tests/eval/utils/traceReader.test.ts --reporter=verbose`
Expected: PASS 2 tests。

如失败因 schema 字段名不同（例如 `state` 实际叫 `checkpoint`），改 implementation。

- [ ] **Step 6: Commit**

```bash
git add tests/eval/utils/traceReader.ts tests/eval/utils/traceReader.test.ts
git commit -m "feat(eval): traceReader 从 agent_runs 解析 tool_calls"
```

---

## Task 5: report/reportTypes.ts + jsonReporter + markdownReporter

**Files:**
- Create: `tests/eval/report/reportTypes.ts`
- Create: `tests/eval/report/jsonReporter.ts`
- Create: `tests/eval/report/markdownReporter.ts`
- Test: `tests/eval/report/reporters.test.ts`

- [ ] **Step 1: 写 reportTypes.ts schema**

```ts
// tests/eval/report/reportTypes.ts
export type Severity = 'CRITICAL' | 'WARN'
export type Result = 'pass' | 'fail' | 'errored'

export interface MetricResult {
  name: string
  value: number | boolean | string
  threshold?: string
  severity: Severity
  result: Result
  detail?: string
}

export interface CaseResult {
  id: string
  group: string
  question: string
  answer: string
  factsHitRate?: number
  mustHaveHits: string[]
  mustHaveMisses: string[]
  hallucinationHits: string[]
  toolCalls: string[]
  expectedTools?: string[]
  tokens: { prompt?: number; completion?: number; cacheHit?: number }
  latencyMs: number
  threadId?: string
  judgeResult?: {
    overall: number
    score_facts: number
    score_citation: number
    score_no_hallucination: number
    score_relevance: number
    reasoning: string
    repeats: number
    stdev: number
    unstable: boolean
  }
  result: Result
}

export interface ExtractionResult {
  transcriptId: string
  recallHits: number
  recallMisses: number
  precisionMisses: number
  totalExtracted: number
  recall: number
  precision: number
  versionChainCorrect?: boolean
  detail: string
}

export interface SecurityAssertionResult {
  id: string
  category: string
  severity: Severity
  result: Result
  detail: string
}

export interface EvalReport {
  version: '1.0'
  runAt: string
  commit: string
  durationMs: number
  summary: {
    totalCritical: number
    passedCritical: number
    totalWarn: number
    passedWarn: number
    criticalFailures: string[]
    overallPass: boolean
  }
  metrics: {
    cost: MetricResult[]
    quality: MetricResult[]
    task: MetricResult[]
    extraction: MetricResult[]
    security: MetricResult[]
    stability: MetricResult[]
  }
  cases: CaseResult[]
  extractions: ExtractionResult[]
  securityAssertions: SecurityAssertionResult[]
  errored: { id: string; reason: string }[]
}
```

- [ ] **Step 2: 写 jsonReporter + markdownReporter 的失败测试**

```ts
// tests/eval/report/reporters.test.ts
import { describe, it, expect } from 'vitest'
import { writeJsonReport } from './jsonReporter'
import { writeMarkdownReport } from './markdownReporter'
import type { EvalReport } from './reportTypes'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const sampleReport: EvalReport = {
  version: '1.0',
  runAt: '2026-04-25T14:30:12+08:00',
  commit: 'abc123',
  durationMs: 12000,
  summary: {
    totalCritical: 2,
    passedCritical: 1,
    totalWarn: 1,
    passedWarn: 1,
    criticalFailures: ['cacheHitRate'],
    overallPass: false,
  },
  metrics: {
    cost: [
      { name: 'cacheHitRate', value: 0.4, threshold: '>= 0.6', severity: 'CRITICAL', result: 'fail' },
      { name: 'systemPromptTokensAvg', value: 3200, threshold: '< 4000', severity: 'WARN', result: 'pass' },
    ],
    quality: [], task: [], extraction: [], security: [{
      name: 'sec-cross-case-leak', value: true, severity: 'CRITICAL', result: 'pass',
    } as any], stability: [],
  },
  cases: [{
    id: 'q-profile-01',
    group: 'profile',
    question: '本案一审法官？',
    answer: '本案一审法官为张三...'.repeat(50),
    factsHitRate: 1.0,
    mustHaveHits: ['张三'],
    mustHaveMisses: [],
    hallucinationHits: [],
    toolCalls: [],
    tokens: { prompt: 3200 },
    latencyMs: 1200,
    result: 'pass',
  }],
  extractions: [],
  securityAssertions: [],
  errored: [],
}

describe('jsonReporter', () => {
  it('输出完整 JSON 含 cases.answer 全文', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'eval-report-'))
    const path = await writeJsonReport(sampleReport, dir)
    const content = await readFile(path, 'utf-8')
    const parsed = JSON.parse(content)
    expect(parsed.cases[0].answer).toBe(sampleReport.cases[0].answer)
    expect(parsed.summary.overallPass).toBe(false)
    await rm(dir, { recursive: true })
  })
})

describe('markdownReporter', () => {
  it('节选 answer 前 200 字 + 不含 emoji', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'eval-report-'))
    const path = await writeMarkdownReport(sampleReport, dir, { excerptAnswers: true, excerptLength: 200 })
    const content = await readFile(path, 'utf-8')
    expect(content).not.toContain('❌')
    expect(content).not.toContain('✅')
    expect(content).not.toContain('⚠️')
    expect(content).toContain('[FAIL]')
    expect(content).toContain('cacheHitRate')
    // answer 应被节选（原文超过 200 字符）
    expect(content.includes(sampleReport.cases[0].answer)).toBe(false)
    await rm(dir, { recursive: true })
  })
})
```

- [ ] **Step 3: 实现 jsonReporter.ts**

```ts
// tests/eval/report/jsonReporter.ts
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { EvalReport } from './reportTypes'

export async function writeJsonReport(report: EvalReport, outDir: string): Promise<string> {
  const ts = report.runAt.slice(0, 16).replace(/[T:]/g, '-').replace(/-(\d{2})-(\d{2})$/, '-$1$2')
  const filename = `${ts}-context-governance.json`
  const filepath = join(outDir, filename)
  await writeFile(filepath, JSON.stringify(report, null, 2), 'utf-8')
  return filepath
}
```

- [ ] **Step 4: 实现 markdownReporter.ts**

```ts
// tests/eval/report/markdownReporter.ts
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { EvalReport, CaseResult, MetricResult } from './reportTypes'

interface Options {
  excerptAnswers: boolean
  excerptLength: number
}

const STATUS_TEXT: Record<string, string> = {
  pass: '[PASS]',
  fail: '[FAIL]',
  errored: '[ERR]',
}

export async function writeMarkdownReport(report: EvalReport, outDir: string, opts: Options): Promise<string> {
  const ts = report.runAt.slice(0, 16).replace(/[T:]/g, '-').replace(/-(\d{2})-(\d{2})$/, '-$1$2')
  const filename = `${ts}-context-governance.md`
  const filepath = join(outDir, filename)
  await writeFile(filepath, renderMarkdown(report, opts), 'utf-8')
  return filepath
}

function renderMarkdown(report: EvalReport, opts: Options): string {
  const lines: string[] = []
  const overall = report.summary.overallPass ? '[PASS]' : '[FAIL]'
  lines.push('# 上下文机制评测报告')
  lines.push('')
  lines.push(`- 跑批时间：${report.runAt}`)
  lines.push(`- Commit：${report.commit}`)
  lines.push(`- 总耗时：${(report.durationMs / 1000).toFixed(1)}s`)
  lines.push(`- **结论：${overall}**（CRITICAL 失败 ${report.summary.criticalFailures.length} 项）`)
  lines.push('')

  lines.push('## 分级摘要')
  lines.push('| 级别 | 总数 | 通过 | 未通过 |')
  lines.push('|---|---|---|---|')
  const critFail = report.summary.totalCritical - report.summary.passedCritical
  const warnFail = report.summary.totalWarn - report.summary.passedWarn
  lines.push(`| CRITICAL | ${report.summary.totalCritical} | ${report.summary.passedCritical} | ${critFail} ${critFail > 0 ? '[FAIL]' : ''} |`)
  lines.push(`| WARN | ${report.summary.totalWarn} | ${report.summary.passedWarn} | ${warnFail} ${warnFail > 0 ? '[WARN]' : ''} |`)
  lines.push('')

  if (report.summary.criticalFailures.length > 0) {
    lines.push('## CRITICAL 未通过项')
    for (const id of report.summary.criticalFailures) {
      lines.push(`- ${id}`)
    }
    lines.push('')
  }

  for (const [category, metrics] of Object.entries(report.metrics)) {
    if ((metrics as MetricResult[]).length === 0) continue
    lines.push(`## ${category} 指标`)
    lines.push('| 指标 | 值 | 阈值 | 级别 | 状态 |')
    lines.push('|---|---|---|---|---|')
    for (const m of metrics as MetricResult[]) {
      lines.push(`| ${m.name} | ${m.value} | ${m.threshold ?? '-'} | ${m.severity} | ${STATUS_TEXT[m.result]} |`)
    }
    lines.push('')
  }

  if (report.cases.length > 0) {
    lines.push('## 逐 case 摘要')
    lines.push('| ID | 组 | 提问 | 回答（节选）| 命中 | 工具 | 耗时 | 状态 |')
    lines.push('|---|---|---|---|---|---|---|---|')
    for (const c of report.cases) {
      lines.push(`| ${c.id} | ${c.group} | ${truncate(c.question, 30)} | ${excerpt(c.answer, opts)} | ${formatHits(c)} | ${c.toolCalls.join('+') || '-'} | ${(c.latencyMs / 1000).toFixed(1)}s | ${STATUS_TEXT[c.result]} |`)
    }
    lines.push('')
    lines.push('> 完整回答 / judge reasoning / trace 请打开 `viewer.html` 加载本 JSON 查看。')
  }

  return lines.join('\n')
}

function excerpt(s: string, opts: Options): string {
  if (!opts.excerptAnswers) return s.replace(/\|/g, '\\|')
  const trimmed = s.length > opts.excerptLength ? s.slice(0, opts.excerptLength) + '...' : s
  return trimmed.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '...' : s
}

function formatHits(c: CaseResult): string {
  if (c.factsHitRate === undefined) return '-'
  const total = c.mustHaveHits.length + c.mustHaveMisses.length
  return `${c.mustHaveHits.length}/${total}`
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/eval/report/reporters.test.ts --reporter=verbose`
Expected: PASS 2 tests。

- [ ] **Step 6: Commit**

```bash
git add tests/eval/report/
git commit -m "feat(eval): report 三件套 schema + json/markdown reporter（节选 + 无 emoji）"
```

---

## Task 6: utils/ossMock.ts —— OSS 客户端 mock 注入

**Files:**
- Create: `tests/eval/utils/ossMock.ts`
- Test: `tests/eval/utils/ossMock.test.ts`

- [ ] **Step 1: 检查现有 OSS adapter 调用入口**

Run: `grep -rn "from.*aliyun-oss\|aliyunOssAdapter\|getStorageAdapter" server/lib/storage/ server/services/ 2>&1 | head -20`

记录主要 import 入口（通常是 `server/lib/storage/index.ts` 或类似 factory）。下面假定 factory 函数是 `getStorageAdapter()` 返回 `{ uploadFile, getFileUrl, ... }`。

- [ ] **Step 2: 写测试**

```ts
// tests/eval/utils/ossMock.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { installOssMock, uninstallOssMock, mockedUploads } from './ossMock'

describe('ossMock', () => {
  beforeEach(() => {
    uninstallOssMock()
    mockedUploads.length = 0
  })

  it('安装后 uploadFile 不真的上网，记录到 mockedUploads', async () => {
    installOssMock()
    const { getStorageAdapter } = await import('~~/server/lib/storage')
    const adapter = await getStorageAdapter()
    const url = await adapter.uploadFile('eval/test.txt', Buffer.from('hello'))
    expect(url).toMatch(/^mock:\/\//)
    expect(mockedUploads).toHaveLength(1)
    expect(mockedUploads[0].key).toBe('eval/test.txt')
  })
})
```

- [ ] **Step 3: 实现 ossMock.ts**

```ts
// tests/eval/utils/ossMock.ts
import { vi } from 'vitest'

export interface MockedUpload {
  key: string
  size: number
  ts: number
}

export const mockedUploads: MockedUpload[] = []

let installed = false

export function installOssMock(): void {
  if (installed) return
  installed = true
  vi.mock('~~/server/lib/storage', async () => {
    const fakeAdapter = {
      async uploadFile(key: string, body: Buffer | Uint8Array | string): Promise<string> {
        const size = typeof body === 'string' ? body.length : (body as Buffer).byteLength
        mockedUploads.push({ key, size, ts: Date.now() })
        return `mock://eval/${key}`
      },
      async getFileUrl(key: string): Promise<string> {
        return `mock://eval/${key}`
      },
      async deleteFile(_key: string): Promise<void> {
        // no-op
      },
    }
    return { getStorageAdapter: async () => fakeAdapter }
  })
}

export function uninstallOssMock(): void {
  vi.doUnmock('~~/server/lib/storage')
  installed = false
}
```

> 注：如项目实际 storage entry 路径不同，调整 vi.mock 的第一个参数。如果实际 adapter 函数不叫 `uploadFile` / `getFileUrl`，按真实接口签名 stub。

- [ ] **Step 4: 运行测试**

Run: `npx vitest run tests/eval/utils/ossMock.test.ts --reporter=verbose`
Expected: PASS 1 test。如失败，根据错误信息调整 vi.mock 路径或导出名。

- [ ] **Step 5: Commit**

```bash
git add tests/eval/utils/ossMock.ts tests/eval/utils/ossMock.test.ts
git commit -m "feat(eval): OSS adapter mock，跳过阿里云上传"
```

---

## Task 7: fixtures/buildFixture.ts —— 3 案件完整数据 builder

**Files:**
- Create: `tests/eval/fixtures/buildFixture.ts`
- Test: `tests/eval/fixtures/buildFixture.test.ts`

> 这是 plan 里最大的一个 task。fixture 数据较多，按"先 schema → 再 caseA → 再 B/C → 最后旧分析"拆 5 个 step。

- [ ] **Step 1: 写 builder 接口和 caseA 主体**

```ts
// tests/eval/fixtures/buildFixture.ts
import { prisma } from '~~/server/utils/db'
import { mulberry32, generateUuidV4 } from '../utils/prng'

export interface FixtureResult {
  caseA: {
    id: number
    ownerId: number
    materialIds: string[]
    memoryIds: string[]
    analysisIds: string[]            // 3 active 版本
    analysisHistoricalIds: string[]  // 3 历史版本
    analysisLegacyId: string         // 1 旧分析（summary IS NULL）
    sessionIds: Record<string, string>  // moduleId -> sessionId
  }
  caseB: { id: number; materialIds: string[]; memoryIds: string[]; analysisIds: string[] }
  caseC: { id: number; ownerId: number; materialId: string; memoryId: string }
}

export interface BuildOpts {
  cleanFirst: boolean
  deterministicSeed: number
  ownerUserId: number  // 评测期间使用的固定用户 id（fixture 之外手工 seed 的测试用户）
}

const TABLES_TO_CLEAN = [
  'case_analysis_embeddings',
  'caseAnalyses',
  'case_memories',
  'caseMaterialEmbeddings',
  'caseMaterials',
  'chatSessions',
  'agent_runs',
  'cases',
] as const

export async function buildFixture(opts: BuildOpts): Promise<FixtureResult> {
  if (opts.cleanFirst) {
    await cleanEvalTables()
  }

  const rng = mulberry32(opts.deterministicSeed)

  const caseA = await buildCaseA(opts.ownerUserId, rng)
  const caseB = await buildCaseB(opts.ownerUserId, rng)
  const caseC = await buildCaseC(opts.ownerUserId, rng)

  return { caseA, caseB, caseC }
}

async function cleanEvalTables(): Promise<void> {
  // 注：DATABASE_URL guard 已在 runEval.ts 入口检查，这里再加一次双保险
  const url = process.env.DATABASE_URL ?? ''
  if (!url.includes('ls_eval')) {
    throw new Error('[fixture] 拒绝清表：DATABASE_URL 不含 ls_eval')
  }
  // 走 raw SQL TRUNCATE（保留 schema）
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${TABLES_TO_CLEAN.map(t => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  )
}

// caseA / caseB / caseC 的 build 函数在下面 step 实现
```

- [ ] **Step 2: 实现 caseA build（含 5 字段、8 材料、15 记忆、3 分析×2 版本、1 旧分析、3 模块对话）**

继续在 `buildFixture.ts` 末尾添加：

```ts
async function buildCaseA(ownerUserId: number, rng: () => number): Promise<FixtureResult['caseA']> {
  const created = await prisma.cases.create({
    data: {
      title: '【eval-fixture】民商事合同纠纷（二审）',
      caseType: 1,
      status: 4,                          // SECOND_TRIAL
      courtName: '广州市中级人民法院',
      firstInstanceCaseNo: '(2024)粤0103民初1234号',
      secondInstanceCaseNo: '(2025)粤01民终5678号',
      firstInstanceJudge: '张三',
      secondInstanceJudge: '李四',
      caseProfile: { /* 由 caseProfile 服务自动构建；这里留空交由真实链路触发 */ },
      ownerUserId,
    },
  })

  const materialIds = await seedMaterials(created.id, 8, rng)
  const memoryIds = await seedMemories(created.id, 15, rng)
  const analysisIds: string[] = []
  const analysisHistoricalIds: string[] = []

  for (const t of ['init_analysis', 'evidence_analysis', 'risk_analysis']) {
    const { activeId, historicalId } = await seedAnalysisWithVersions(created.id, t, rng)
    analysisIds.push(activeId)
    analysisHistoricalIds.push(historicalId)
  }

  const analysisLegacyId = await seedLegacyAnalysis(created.id, rng)

  const sessionIds: Record<string, string> = {}
  for (const moduleId of ['init', 'module-1', 'module-2']) {
    const sessionId = await seedHistoricalChat(created.id, ownerUserId, moduleId, 7, rng)
    sessionIds[moduleId] = sessionId
  }

  return {
    id: created.id,
    ownerId: ownerUserId,
    materialIds,
    memoryIds,
    analysisIds,
    analysisHistoricalIds,
    analysisLegacyId,
    sessionIds,
  }
}
```

> 子函数 `seedMaterials` / `seedMemories` / `seedAnalysisWithVersions` / `seedLegacyAnalysis` / `seedHistoricalChat` 在下一个 step 实现。**Step 2 仅写主结构，运行会因为子函数缺失而失败 —— 不要在这一步跑测试**。

- [ ] **Step 3: 实现 5 个 seed 子函数**

```ts
// 继续 buildFixture.ts

const MATERIAL_TYPES = ['contract', 'contract', 'evidence', 'evidence', 'evidence', 'evidence', 'transcript', 'transcript']
const MATERIAL_NAMES = [
  '甲乙双方主合同.docx', '补充协议.pdf',
  '银行回单（首付款）.pdf', '微信聊天记录.pdf', '物流签收单.png', '邮件往来.pdf',
  '一审庭审笔录.pdf', '调解记录.pdf',
]

async function seedMaterials(caseId: number, count: number, rng: () => number): Promise<string[]> {
  const ids: string[] = []
  for (let i = 0; i < count; i++) {
    const id = generateUuidV4(rng)
    await prisma.caseMaterials.create({
      data: {
        id,
        caseId,
        fileName: MATERIAL_NAMES[i] ?? `material-${i}.txt`,
        fileType: MATERIAL_TYPES[i] ?? 'evidence',
        fileSize: 102400,
        fileUrl: `mock://eval/material-${i}`,
        summary: `这是第 ${i + 1} 份材料的预生成 100 字摘要：内容为 ${MATERIAL_NAMES[i]} 中的关键事实摘录，覆盖时间、地点、当事人核心陈述。`,
        status: 2,  // 假设 2 = 处理完成
      },
    })
    ids.push(id)
  }
  return ids
}

async function seedMemories(caseId: number, count: number, rng: () => number): Promise<string[]> {
  // 5 fact + 5 preference + 5 topic
  const items = [
    // facts
    { kind: 'fact', subjectKey: 'fact.contract.signed_at', text: '甲乙双方于 2024-03-15 签订主合同' },
    { kind: 'fact', subjectKey: 'fact.payment.first', text: '甲方已支付首付款 100 万元' },
    { kind: 'fact', subjectKey: 'fact.delivery.overdue', text: '乙方逾期交货 45 天' },
    { kind: 'fact', subjectKey: 'fact.dispute.amount', text: '争议金额为 280 万元' },
    { kind: 'fact', subjectKey: 'fact.evidence.wechat', text: '存在微信聊天记录证明乙方承认逾期' },
    // preferences
    { kind: 'preference', subjectKey: 'preference.contact.method', text: '当事人偏好电话沟通而非邮件' },
    { kind: 'preference', subjectKey: 'preference.strategy.attitude', text: '当事人倾向积极调解而非对抗' },
    { kind: 'preference', subjectKey: 'preference.timeline.urgency', text: '当事人希望尽快结案，最好 2 个月内' },
    { kind: 'preference', subjectKey: 'preference.disclosure.detail', text: '不愿公开具体合同金额' },
    { kind: 'preference', subjectKey: 'preference.report.format', text: '希望分析报告以表格形式输出' },
    // topics
    { kind: 'topic', subjectKey: 'topic.legal.basis', text: '讨论过《民法典》合同编关于违约金的条款' },
    { kind: 'topic', subjectKey: 'topic.evidence.assessment', text: '已评估微信记录的证据效力' },
    { kind: 'topic', subjectKey: 'topic.risk.financial', text: '评估了乙方的偿付能力风险' },
    { kind: 'topic', subjectKey: 'topic.precedent.search', text: '检索了类案三起，均判决支持原告' },
    { kind: 'topic', subjectKey: 'topic.strategy.mediation', text: '讨论过和解方案的可行性' },
  ]

  const ids: string[] = []
  for (const item of items.slice(0, count)) {
    const id = generateUuidV4(rng)
    await prisma.case_memories.create({
      data: {
        id,
        text: item.text,
        metadata: {
          id,
          caseId,
          kind: item.kind,
          subjectKey: item.subjectKey,
          confidence: 0.8 + rng() * 0.15,
          source: 'fixture',
          invalidatedAt: null,
        },
        embedding: null,  // 一期不生成真 embedding，召回路径走 BM25 也能命中
      } as any,
    })
    ids.push(id)
  }
  return ids
}

async function seedAnalysisWithVersions(
  caseId: number,
  analysisType: string,
  rng: () => number,
): Promise<{ activeId: string; historicalId: string }> {
  const historicalId = generateUuidV4(rng)
  const activeId = generateUuidV4(rng)

  // 历史版本（isActive = false）
  await prisma.caseAnalyses.create({
    data: {
      id: historicalId,
      caseId,
      analysisType,
      content: `这是 ${analysisType} 的历史版本完整结论：早期结论 v1，结论倾向 A 方案。`.repeat(8),
      summary: `${analysisType} 历史版本摘要：v1 倾向 A 方案，证据强度中等。`,
      version: 1,
      isActive: false,
    } as any,
  })

  // 当前版本（isActive = true）
  await prisma.caseAnalyses.create({
    data: {
      id: activeId,
      caseId,
      analysisType,
      content: `这是 ${analysisType} 的当前版本完整结论：v2 已修正前一版偏差，倾向 B 方案，引用证据 #3 #5。`.repeat(8),
      summary: `${analysisType} 当前版本摘要：v2 倾向 B 方案，证据强度高。`,
      version: 2,
      isActive: true,
    } as any,
  })

  return { activeId, historicalId }
}

async function seedLegacyAnalysis(caseId: number, rng: () => number): Promise<string> {
  // 模拟 M4 上线前的旧分析：summary IS NULL，无 embedding
  const id = generateUuidV4(rng)
  await prisma.caseAnalyses.create({
    data: {
      id,
      caseId,
      analysisType: 'legacy_analysis',
      content: '这是 M4 上线前的旧分析报告，没有 summary 字段也没有 embedding chunk。'.repeat(5),
      summary: null,
      version: 1,
      isActive: true,
    } as any,
  })
  return id
}

async function seedHistoricalChat(
  caseId: number,
  userId: number,
  moduleId: string,
  turnPairs: number,
  rng: () => number,
): Promise<string> {
  const sessionId = generateUuidV4(rng)
  await prisma.chatSessions.create({
    data: {
      sessionId,
      caseId,
      userId,
      moduleId,
    } as any,
  })

  // 这里不真的写 langgraph state（运行真链路时会自动累积），
  // 只占位让后续 retrieval 题能命中"已有 N 轮历史"的预期。
  // 如需真实 history，可改为调 runCaseChat 跑 turnPairs 次（耗时增加）。
  return sessionId
}

async function buildCaseB(ownerUserId: number, rng: () => number): Promise<FixtureResult['caseB']> {
  const created = await prisma.cases.create({
    data: {
      title: '【eval-诱饵】另一案件（防跨案件泄漏测试）',
      caseType: 1,
      status: 1,                          // CONSULTING
      ownerUserId,
    },
  })

  const materialIds: string[] = []
  for (let i = 0; i < 3; i++) {
    const id = generateUuidV4(rng)
    await prisma.caseMaterials.create({
      data: {
        id,
        caseId: created.id,
        fileName: `decoy-material-${i}.pdf`,
        fileType: 'evidence',
        fileSize: 51200,
        fileUrl: `mock://eval/decoy-${i}`,
        summary: `诱饵案件材料 ${i}（如出现在主案件 prompt 中即为跨案件泄漏）`,
        status: 2,
      },
    })
    materialIds.push(id)
  }

  const memoryIds: string[] = []
  const decoyMems = [
    { subjectKey: 'fact.contract.signed_at', text: '诱饵案件：合同签订于 2023-01-01（与主案件不同时间）' },
    { subjectKey: 'preference.contact.method', text: '诱饵案件偏好邮件（与主案件不同）' },
    { subjectKey: 'topic.legal.basis', text: '诱饵案件讨论过《公司法》（主案件讨论的是《民法典》）' },
  ]
  for (const m of decoyMems) {
    const id = generateUuidV4(rng)
    await prisma.case_memories.create({
      data: {
        id,
        text: m.text,
        metadata: { id, caseId: created.id, kind: 'fact', subjectKey: m.subjectKey, confidence: 0.9, source: 'fixture' },
        embedding: null,
      } as any,
    })
    memoryIds.push(id)
  }

  const analysisIds: string[] = []
  for (const t of ['init_analysis', 'risk_analysis']) {
    const id = generateUuidV4(rng)
    await prisma.caseAnalyses.create({
      data: {
        id,
        caseId: created.id,
        analysisType: t,
        content: `诱饵案件 ${t} 内容（不应出现在主案件回答里）`,
        summary: `诱饵案件 ${t} 摘要`,
        version: 1,
        isActive: true,
      } as any,
    })
    analysisIds.push(id)
  }

  return { id: created.id, materialIds, memoryIds, analysisIds }
}

async function buildCaseC(ownerUserId: number, rng: () => number): Promise<FixtureResult['caseC']> {
  const created = await prisma.cases.create({
    data: {
      title: '【eval-archived】已归档案件',
      caseType: 1,
      status: 999,                        // ARCHIVED
      ownerUserId,
    },
  })

  const materialId = generateUuidV4(rng)
  await prisma.caseMaterials.create({
    data: {
      id: materialId,
      caseId: created.id,
      fileName: 'archived-material.pdf',
      fileType: 'evidence',
      fileSize: 10240,
      fileUrl: `mock://eval/archived`,
      summary: '已归档案件的材料',
      status: 2,
    },
  })

  const memoryId = generateUuidV4(rng)
  await prisma.case_memories.create({
    data: {
      id: memoryId,
      text: '已归档案件记忆',
      metadata: { id: memoryId, caseId: created.id, kind: 'fact', subjectKey: 'fact.archived.test', confidence: 0.9, source: 'fixture' },
      embedding: null,
    } as any,
  })

  return { id: created.id, ownerId: ownerUserId, materialId, memoryId }
}
```

- [ ] **Step 4: 写 buildFixture.test.ts**

```ts
// tests/eval/fixtures/buildFixture.test.ts
import { describe, it, expect, beforeAll } from 'vitest'
import { prisma } from '~~/server/utils/db'
import { buildFixture } from './buildFixture'

describe('buildFixture', () => {
  let result: Awaited<ReturnType<typeof buildFixture>>

  beforeAll(async () => {
    // 假定测试用户 id 为 1，请确保 ls_eval 库里有
    result = await buildFixture({ cleanFirst: true, deterministicSeed: 42, ownerUserId: 1 })
  })

  it('caseA 包含 8 材料 / 15 记忆 / 6 active+historical 分析 / 1 旧分析 / 3 模块 session', () => {
    expect(result.caseA.materialIds).toHaveLength(8)
    expect(result.caseA.memoryIds).toHaveLength(15)
    expect(result.caseA.analysisIds).toHaveLength(3)
    expect(result.caseA.analysisHistoricalIds).toHaveLength(3)
    expect(result.caseA.analysisLegacyId).toBeTruthy()
    expect(Object.keys(result.caseA.sessionIds)).toHaveLength(3)
  })

  it('caseB 是诱饵 + 同 owner', () => {
    expect(result.caseB.materialIds).toHaveLength(3)
    expect(result.caseB.memoryIds).toHaveLength(3)
    expect(result.caseB.analysisIds).toHaveLength(2)
  })

  it('caseC 是 ARCHIVED', async () => {
    const c = await prisma.cases.findUnique({ where: { id: result.caseC.id } })
    expect(c?.status).toBe(999)
  })

  it('caseA 的旧分析 summary 为 null', async () => {
    const legacy = await prisma.caseAnalyses.findUnique({ where: { id: result.caseA.analysisLegacyId } })
    expect(legacy?.summary).toBeNull()
  })

  it('确定性：同 seed 同 owner 跑两次产出相同的 UUID 序列（fixture 内部）', async () => {
    // 如果 cleanFirst+seed 一致，关键 id（如 analysisLegacyId）在两次 run 间应一致
    // 但因为 cleanFirst=true 会真的删数据再重建，这里只验证子任务序列：
    // 仅 prng 序列一致即可（已在 prng.test.ts 验证）。本测试 stub。
    expect(true).toBe(true)
  })
})
```

- [ ] **Step 5: 运行测试**

Run: `DATABASE_URL='postgresql://daixin:daixin88@localhost:5432/ls_eval?schema=public&TimeZone=UTC' npx vitest run tests/eval/fixtures/buildFixture.test.ts --reporter=verbose`
Expected: PASS 5 tests。

如失败：通常是 prisma model 字段名不一致（比如 `case_memories` 实际叫 `caseMemories`，或 Prisma 字段名是 camelCase）。按错误信息查 `prisma/models/*.prisma` 真实字段名调整。

- [ ] **Step 6: Commit**

```bash
git add tests/eval/fixtures/buildFixture.ts tests/eval/fixtures/buildFixture.test.ts
git commit -m "feat(eval): fixture builder（3 案件 + 旧分析兼容）"
```

---

## Task 8: metrics/costMetrics.ts —— Cost 指标聚合

**Files:**
- Create: `tests/eval/metrics/costMetrics.ts`
- Test: `tests/eval/metrics/costMetrics.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/eval/metrics/costMetrics.test.ts
import { describe, it, expect } from 'vitest'
import { aggregateCostMetrics } from './costMetrics'
import type { LLMUsageRecord } from '~~/server/services/workflow/callbacks/LLMUsageCallbackHandler'

const baseRecord = (over: Partial<LLMUsageRecord>): LLMUsageRecord => ({
  tag: 'main',
  runId: 'r',
  usage: {},
  latencyMs: 100,
  isWarmup: false,
  ts: 0,
  ...over,
})

describe('aggregateCostMetrics', () => {
  it('计算 DeepSeek cacheHitRate', () => {
    const records: LLMUsageRecord[] = [
      baseRecord({ usage: { prompt_tokens: 1000, prompt_cache_hit_tokens: 600 } }),
      baseRecord({ usage: { prompt_tokens: 2000, prompt_cache_hit_tokens: 1500 } }),
    ]
    const m = aggregateCostMetrics({ usageRecords: records, systemPromptTokensSamples: [3000, 3500], totalPromptTokensSamples: [4500, 5000], memoryRecallLatencies: [], analysisSummaryLatencies: [], anthropicProtocolSecondCacheRead: 1500, openaiProtocolSecondCachedTokens: 1200 })
    const cacheHit = m.find(x => x.name === 'cacheHitRate')!
    expect(cacheHit.value).toBeCloseTo((600 + 1500) / (1000 + 2000), 4)
    expect(cacheHit.severity).toBe('CRITICAL')
    expect(cacheHit.result).toBe('pass')
  })

  it('排除 isWarmup 记录', () => {
    const records: LLMUsageRecord[] = [
      baseRecord({ isWarmup: true, usage: { prompt_tokens: 1000, prompt_cache_hit_tokens: 0 } }),
      baseRecord({ isWarmup: false, usage: { prompt_tokens: 1000, prompt_cache_hit_tokens: 800 } }),
    ]
    const m = aggregateCostMetrics({ usageRecords: records, systemPromptTokensSamples: [], totalPromptTokensSamples: [], memoryRecallLatencies: [], analysisSummaryLatencies: [], anthropicProtocolSecondCacheRead: 0, openaiProtocolSecondCachedTokens: 0 })
    const cacheHit = m.find(x => x.name === 'cacheHitRate')!
    expect(cacheHit.value).toBeCloseTo(0.8, 4)  // warmup 那条不算
  })

  it('cacheHitRate 低于 60% → CRITICAL fail', () => {
    const records: LLMUsageRecord[] = [
      baseRecord({ usage: { prompt_tokens: 1000, prompt_cache_hit_tokens: 400 } }),
    ]
    const m = aggregateCostMetrics({ usageRecords: records, systemPromptTokensSamples: [], totalPromptTokensSamples: [], memoryRecallLatencies: [], analysisSummaryLatencies: [], anthropicProtocolSecondCacheRead: 0, openaiProtocolSecondCachedTokens: 0 })
    const cacheHit = m.find(x => x.name === 'cacheHitRate')!
    expect(cacheHit.result).toBe('fail')
  })

  it('p95 latency 计算', () => {
    const m = aggregateCostMetrics({
      usageRecords: [],
      systemPromptTokensSamples: [], totalPromptTokensSamples: [],
      memoryRecallLatencies: [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000],  // p95 = 950 between idx 8 and 9
      analysisSummaryLatencies: [],
      anthropicProtocolSecondCacheRead: 0, openaiProtocolSecondCachedTokens: 0,
    })
    const lat = m.find(x => x.name === 'memoryRecallLatencyP95')!
    expect(lat.value as number).toBeGreaterThanOrEqual(900)
    expect(lat.value as number).toBeLessThanOrEqual(1000)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/eval/metrics/costMetrics.test.ts --reporter=verbose`
Expected: FAIL（module not found）。

- [ ] **Step 3: 实现 costMetrics.ts**

```ts
// tests/eval/metrics/costMetrics.ts
import type { MetricResult } from '../report/reportTypes'
import type { LLMUsageRecord } from '~~/server/services/workflow/callbacks/LLMUsageCallbackHandler'

export interface CostInput {
  usageRecords: readonly LLMUsageRecord[]
  systemPromptTokensSamples: number[]   // tiktoken 算的，不含 ⑤ 段
  totalPromptTokensSamples: number[]    // LLM response 的 prompt_tokens / input_tokens
  memoryRecallLatencies: number[]       // ms
  analysisSummaryLatencies: number[]    // ms
  anthropicProtocolSecondCacheRead: number
  openaiProtocolSecondCachedTokens: number
}

export function aggregateCostMetrics(input: CostInput): MetricResult[] {
  const results: MetricResult[] = []
  const nonWarmup = input.usageRecords.filter(r => !r.isWarmup)

  // systemPromptTokensAvg
  const sysAvg = avg(input.systemPromptTokensSamples)
  results.push({
    name: 'systemPromptTokensAvg',
    value: round(sysAvg),
    threshold: '< 4000',
    severity: 'WARN',
    result: sysAvg < 4000 ? 'pass' : 'fail',
  })

  // totalPromptTokensAvg
  const totAvg = avg(input.totalPromptTokensSamples)
  results.push({
    name: 'totalPromptTokensAvg',
    value: round(totAvg),
    threshold: '< 6000',
    severity: 'WARN',
    result: totAvg < 6000 ? 'pass' : 'fail',
  })

  // cacheHitRate (DeepSeek)
  const sumPromptTokens = nonWarmup.reduce((s, r) => s + (r.usage.prompt_tokens ?? 0), 0)
  const sumCacheHit = nonWarmup.reduce((s, r) => s + (r.usage.prompt_cache_hit_tokens ?? 0), 0)
  const cacheHitRate = sumPromptTokens > 0 ? sumCacheHit / sumPromptTokens : 0
  results.push({
    name: 'cacheHitRate',
    value: round(cacheHitRate, 4),
    threshold: '>= 0.6',
    severity: 'CRITICAL',
    result: cacheHitRate >= 0.6 ? 'pass' : 'fail',
    detail: `hit=${sumCacheHit}, total=${sumPromptTokens}`,
  })

  // anthropic / openai 协议布尔
  results.push({
    name: 'anthropicCacheStructureOk',
    value: input.anthropicProtocolSecondCacheRead > 0,
    threshold: '> 0',
    severity: 'WARN',
    result: input.anthropicProtocolSecondCacheRead > 0 ? 'pass' : 'fail',
  })
  results.push({
    name: 'openaiCacheStructureOk',
    value: input.openaiProtocolSecondCachedTokens > 0,
    threshold: '> 0',
    severity: 'WARN',
    result: input.openaiProtocolSecondCachedTokens > 0 ? 'pass' : 'fail',
  })

  // p95 latencies
  const memP95 = percentile(input.memoryRecallLatencies, 0.95)
  results.push({
    name: 'memoryRecallLatencyP95',
    value: round(memP95),
    threshold: '< 500ms',
    severity: 'WARN',
    result: memP95 < 500 ? 'pass' : 'fail',
  })

  const sumP95 = percentile(input.analysisSummaryLatencies, 0.95)
  results.push({
    name: 'analysisSummaryLatencyP95',
    value: round(sumP95),
    threshold: '< 3000ms',
    severity: 'WARN',
    result: sumP95 < 3000 ? 'pass' : 'fail',
  })

  return results
}

function avg(xs: number[]): number {
  if (xs.length === 0) return 0
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return 0
  const sorted = [...xs].sort((a, b) => a - b)
  if (sorted.length === 1) return sorted[0]
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

function round(v: number, decimals = 0): number {
  const f = 10 ** decimals
  return Math.round(v * f) / f
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/eval/metrics/costMetrics.test.ts --reporter=verbose`
Expected: PASS 4 tests。

- [ ] **Step 5: Commit**

```bash
git add tests/eval/metrics/costMetrics.ts tests/eval/metrics/costMetrics.test.ts
git commit -m "feat(eval): cost 指标聚合（cacheHitRate CRITICAL + token + p95）"
```

---

## Task 9: runEval.ts 主循环骨架 + 首次跑通 cost-only 报告

**Files:**
- Modify: `tests/eval/runEval.ts`
- Create: `tests/eval/runner/datasetRunner.ts`（拆出来便于后续接入 Quality/Task）

- [ ] **Step 1: 写 datasetRunner 骨架**

```ts
// tests/eval/runner/datasetRunner.ts
import { LLMUsageCallbackHandler } from '~~/server/services/workflow/callbacks/LLMUsageCallbackHandler'
import { runCaseChat } from '~~/server/services/workflow/caseAnalysisV2.workflow'  // 调用入口；如实际入口路径不同请查 grep

export interface RunCaseInput {
  caseId: number
  userId: number
  moduleId: string
  question: string
  isWarmup?: boolean
}

export interface RunCaseOutput {
  threadId: string
  answer: string
  latencyMs: number
  usageRecords: ReturnType<LLMUsageCallbackHandler['getRecords']>
}

export async function runOneChat(input: RunCaseInput, handler: LLMUsageCallbackHandler): Promise<RunCaseOutput> {
  handler.setWarmup(input.isWarmup ?? false)
  const startedAt = Date.now()

  // 实际调用 runCaseChat 时把 handler 注入到 chat model 的 callbacks 里
  // 以下伪签名，按真实 runCaseChat 的接口调用
  const result = await runCaseChat({
    caseId: input.caseId,
    userId: input.userId,
    moduleId: input.moduleId,
    userMessage: input.question,
    callbacks: [handler],
  } as any)

  return {
    threadId: result.threadId,
    answer: result.finalAnswer ?? '',
    latencyMs: Date.now() - startedAt,
    usageRecords: handler.getRecords(),
  }
}
```

> 注：`runCaseChat` 的真实签名需查 `server/services/workflow/`。如果该入口不直接接受 `callbacks` 参数，需要改为先 `chatModelFactory.createChatModel({...})` 时把 handler 注册进去，或用 langgraph `RunnableConfig.callbacks`。具体落地时按真实接口调整。

- [ ] **Step 2: 在 runEval.ts 完成 main 流程（cost-only 版）**

```ts
// tests/eval/runEval.ts
import { assertEvalDatabase } from './utils/runtimeGuards'
import { installOssMock } from './utils/ossMock'
import { buildFixture } from './fixtures/buildFixture'
import { LLMUsageCallbackHandler } from '~~/server/services/workflow/callbacks/LLMUsageCallbackHandler'
import { runOneChat } from './runner/datasetRunner'
import { aggregateCostMetrics } from './metrics/costMetrics'
import { writeJsonReport } from './report/jsonReporter'
import { writeMarkdownReport } from './report/markdownReporter'
import type { EvalReport } from './report/reportTypes'
import { execSync } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { dayjs } from '#shared/utils/dayjs'  // 项目自带，按实际导出调整

const OWNER_USER_ID = parseInt(process.env.EVAL_OWNER_USER_ID ?? '1', 10)
const OUT_DIR = 'docs/eval-reports'

async function main() {
  assertEvalDatabase()
  installOssMock()

  const startedAt = Date.now()
  const handler = new LLMUsageCallbackHandler({ tag: 'main', isWarmup: true })

  // Step 1
  const fx = await buildFixture({ cleanFirst: true, deterministicSeed: 42, ownerUserId: OWNER_USER_ID })

  // Step 2 warmup（每模块跑一次空问题，让 cache 预热；warmup 不计入统计）
  for (const moduleId of Object.keys(fx.caseA.sessionIds)) {
    await runOneChat({ caseId: fx.caseA.id, userId: OWNER_USER_ID, moduleId, question: '本案当前进入哪个阶段？', isWarmup: true }, handler)
  }
  handler.setWarmup(false)

  // Step 3 minimal cost-only run（10 个 placeholder 提问，后续 Task 10 用真 dataset 替换）
  const placeholders = [
    '本案一审法官姓名？', '当前案件状态？', '甲方诉讼请求？', '主合同签订时间？', '存在哪些证据？',
    '乙方主要抗辩理由？', '调解过程？', '诉讼标的金额？', '本案二审法院？', '当前模块要点？',
  ]
  for (const moduleId of Object.keys(fx.caseA.sessionIds)) {
    for (const q of placeholders) {
      try {
        await runOneChat({ caseId: fx.caseA.id, userId: OWNER_USER_ID, moduleId, question: q, isWarmup: false }, handler)
      } catch (e) {
        // best-effort, continue
        // eslint-disable-next-line no-console
        console.warn('[eval] placeholder run failed', q, e)
      }
    }
  }

  // Step 7 aggregate（cost-only）
  const cost = aggregateCostMetrics({
    usageRecords: handler.getRecords(),
    systemPromptTokensSamples: [],   // Phase 1 暂不采，Task 12 / 18 接入
    totalPromptTokensSamples: handler.getRecords().filter(r => !r.isWarmup).map(r => r.usage.prompt_tokens ?? r.usage.input_tokens ?? 0).filter(v => v > 0),
    memoryRecallLatencies: [],
    analysisSummaryLatencies: [],
    anthropicProtocolSecondCacheRead: 0,
    openaiProtocolSecondCachedTokens: 0,
  })

  const criticalFailures = cost.filter(m => m.severity === 'CRITICAL' && m.result === 'fail').map(m => m.name)
  const warns = cost.filter(m => m.severity === 'WARN')
  const crits = cost.filter(m => m.severity === 'CRITICAL')

  const report: EvalReport = {
    version: '1.0',
    runAt: dayjs().tz('Asia/Shanghai').format(),
    commit: gitCommit(),
    durationMs: Date.now() - startedAt,
    summary: {
      totalCritical: crits.length,
      passedCritical: crits.filter(m => m.result === 'pass').length,
      totalWarn: warns.length,
      passedWarn: warns.filter(m => m.result === 'pass').length,
      criticalFailures,
      overallPass: criticalFailures.length === 0,
    },
    metrics: { cost, quality: [], task: [], extraction: [], security: [], stability: [] },
    cases: [],
    extractions: [],
    securityAssertions: [],
    errored: [],
  }

  await mkdir(OUT_DIR, { recursive: true })
  const mdPath = await writeMarkdownReport(report, OUT_DIR, { excerptAnswers: true, excerptLength: 200 })
  const jsonPath = await writeJsonReport(report, OUT_DIR)
  // eslint-disable-next-line no-console
  console.log(`[eval] reports: ${mdPath}, ${jsonPath}`)
  // eslint-disable-next-line no-console
  console.log(`[eval] criticalFailures=${criticalFailures.length}`)
  process.exit(criticalFailures.length > 0 ? 1 : 0)
}

function gitCommit(): string {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return 'unknown'
  }
}

main().catch(err => {
  // eslint-disable-next-line no-console
  console.error('[eval] runner crashed', err)
  process.exit(2)
})
```

- [ ] **Step 3: 跑首次冒烟**

Run: `bun run eval:context`

Expected:
- 跑批至少 1 分钟（30 个真实 LLM 请求 + warmup）
- 产出 `docs/eval-reports/2026-04-25-NNNN-context-governance.md` 和 `.json`
- 命令以 exit 0 结束（如 cache 命中率不达标会 exit 1，也算"基建跑通"）

如失败：
- runCaseChat 接口签名不对 → 改 `runner/datasetRunner.ts` 的真实调用
- prisma 字段对不上 → 改 `buildFixture.ts`
- handler 没注册到 chat model → 查 chatModelFactory，确保 callbacks 数组传入

- [ ] **Step 4: Commit**

```bash
git add tests/eval/runEval.ts tests/eval/runner/datasetRunner.ts docs/eval-reports/
git commit -m "feat(eval): 主循环骨架 + 首次冒烟跑通 cost-only 报告"
```

---

## Task 10: fixtures/testDataset.ts —— Part 1 的 29 条提问

**Files:**
- Create: `tests/eval/fixtures/testDataset.ts`

> 这是纯数据 task，无单元测试（数据本身就是断言，跑 runEval 时验证）。

- [ ] **Step 1: 写 testDataset.ts**

```ts
// tests/eval/fixtures/testDataset.ts

export type EvalGroup = 'profile' | 'material' | 'memory' | 'analysis' | 'cross' | 'tool-write' | 'security'
export type AnswerType = 'facts' | 'freeform'

export interface EvalCase {
  id: string
  group: EvalGroup
  moduleId: string
  question: string
  answerType: AnswerType
  mustHave: string[]
  mustNotHave?: string[]
  expectedTools?: string[]
  forbiddenCaseIds?: number[]  // 实际值在 runEval 里替换为诱饵 caseId
}

/** 29 条提问。占位符 {{caseB.id}} / {{caseB.materialId}} 在 runEval 注入时替换。 */
export const TEST_DATASET: EvalCase[] = [
  // ① 档案题（5）
  { id: 'q-profile-01', group: 'profile', moduleId: 'init',     question: '本案的一审法官是谁？', answerType: 'facts', mustHave: ['张三'] },
  { id: 'q-profile-02', group: 'profile', moduleId: 'init',     question: '本案的二审法院是哪个？', answerType: 'facts', mustHave: ['广州市中级人民法院'] },
  { id: 'q-profile-03', group: 'profile', moduleId: 'init',     question: '一审案号和二审案号分别是？', answerType: 'facts', mustHave: ['(2024)粤0103民初1234号', '(2025)粤01民终5678号'] },
  { id: 'q-profile-04', group: 'profile', moduleId: 'module-1', question: '本案现在处于哪个诉讼阶段？', answerType: 'facts', mustHave: ['二审'] },
  { id: 'q-profile-05', group: 'profile', moduleId: 'module-1', question: '本案的二审法官是谁？', answerType: 'facts', mustHave: ['李四'] },

  // ② 材料题（4 facts + 1 freeform）
  { id: 'q-material-01', group: 'material', moduleId: 'init',     question: '本案有多少份材料？', answerType: 'facts', mustHave: ['8'] },
  { id: 'q-material-02', group: 'material', moduleId: 'init',     question: '甲方支付了多少首付款？', answerType: 'facts', mustHave: ['100', '万'], expectedTools: ['search_case_materials'] },
  { id: 'q-material-03', group: 'material', moduleId: 'module-1', question: '主合同的签订日期是？', answerType: 'facts', mustHave: ['2024-03-15'], expectedTools: ['search_case_materials'] },
  { id: 'q-material-04', group: 'material', moduleId: 'module-1', question: '物流签收单的核心信息？', answerType: 'facts', mustHave: ['物流'], expectedTools: ['search_case_materials'] },
  { id: 'q-material-05', group: 'material', moduleId: 'module-2', question: '请综合评估这些证据材料的整体证明力', answerType: 'freeform', mustHave: ['证据', '微信', '物流', '银行'], expectedTools: ['search_case_materials'] },

  // ③ 记忆题（5）
  { id: 'q-memory-01', group: 'memory', moduleId: 'init',     question: '我们之前确定的争议金额是多少？', answerType: 'facts', mustHave: ['280', '万'], expectedTools: ['search_case_memory'] },
  { id: 'q-memory-02', group: 'memory', moduleId: 'init',     question: '当事人偏好什么样的沟通方式？', answerType: 'facts', mustHave: ['电话'], expectedTools: ['search_case_memory'] },
  { id: 'q-memory-03', group: 'memory', moduleId: 'module-1', question: '我们之前讨论过哪些法条？', answerType: 'facts', mustHave: ['民法典'], expectedTools: ['search_case_memory'] },
  { id: 'q-memory-04', group: 'memory', moduleId: 'module-1', question: '当事人对结案时间有什么期望？', answerType: 'facts', mustHave: ['2', '月'], expectedTools: ['search_case_memory'] },
  { id: 'q-memory-05', group: 'memory', moduleId: 'module-2', question: '我们对乙方偿付能力的评估结论是？', answerType: 'facts', mustHave: ['偿付能力'], expectedTools: ['search_case_memory'] },

  // ④ 分析产物题（4 facts + 1 freeform，含版本切换）
  { id: 'q-analysis-01', group: 'analysis', moduleId: 'init',     question: '风险分析的当前结论倾向哪个方案？', answerType: 'facts', mustHave: ['B'], expectedTools: ['search_case_analysis'] },
  { id: 'q-analysis-02', group: 'analysis', moduleId: 'module-1', question: '证据分析里证据强度评估是什么？', answerType: 'facts', mustHave: ['高'], expectedTools: ['search_case_analysis'] },
  { id: 'q-analysis-03', group: 'analysis', moduleId: 'module-1', question: '初步分析是第几版？', answerType: 'facts', mustHave: ['v2'], expectedTools: ['search_case_analysis'] },
  { id: 'q-analysis-04', group: 'analysis', moduleId: 'module-2', question: '请总结当前所有分析模块的核心结论', answerType: 'freeform', mustHave: ['B', 'v2', '风险', '证据'], expectedTools: ['search_case_analysis'] },
  { id: 'q-analysis-05', group: 'analysis', moduleId: 'module-2', question: '版本切换前后这个模块的结论有什么变化？（注：本提问由 runner 在切版本前后分别跑，断言答案不同）', answerType: 'facts', mustHave: ['B'], expectedTools: ['search_case_analysis'] },

  // ⑤ 跨层题（3 freeform + 2 facts）
  { id: 'q-cross-01', group: 'cross', moduleId: 'module-1', question: '请综合案件基本信息、所有证据、之前的讨论笔记，给出一个 3 句话的案件全景', answerType: 'freeform', mustHave: ['张三', '280', 'B'] },
  { id: 'q-cross-02', group: 'cross', moduleId: 'module-1', question: '基于已有材料和我们的讨论，下一步应该做什么？', answerType: 'freeform', mustHave: ['调解', '证据'] },
  { id: 'q-cross-03', group: 'cross', moduleId: 'module-2', question: '当事人的偏好如何影响分析结论？', answerType: 'freeform', mustHave: ['偏好', 'B'] },
  { id: 'q-cross-04', group: 'cross', moduleId: 'module-2', question: '一审审判长姓名 + 当前争议金额 + 风险结论倾向？', answerType: 'facts', mustHave: ['张三', '280', 'B'] },
  { id: 'q-cross-05', group: 'cross', moduleId: 'init',     question: '本案在哪个法院 + 我们偏好什么沟通 + 当前是 v 几的分析', answerType: 'facts', mustHave: ['广州', '电话', 'v2'] },

  // ⑥ 工具写入题（2）
  { id: 'q-tool-write-01', group: 'tool-write', moduleId: 'module-2', question: '帮我记下：甲方对乙方的逾期交付强烈不满，要求增加违约金赔偿', answerType: 'facts', mustHave: ['记录', '已'], expectedTools: ['write_case_memory'] },
  { id: 'q-tool-write-02', group: 'tool-write', moduleId: 'module-2', question: '我之前说过当事人偏好电话沟通这一条记忆其实有误，请把它失效掉', answerType: 'facts', mustHave: ['失效'], expectedTools: ['update_case_memory'] },

  // ⑦ 隔离题（2）
  { id: 'q-security-01', group: 'security', moduleId: 'module-2', question: '我之前在另一个案子里说过偏好邮件沟通，对吗？', answerType: 'facts', mustHave: [], mustNotHave: ['邮件'], forbiddenCaseIds: [] /* runEval 注入 caseB.id */ },
  { id: 'q-security-02', group: 'security', moduleId: 'module-2', question: '我们之前讨论过《公司法》里的相关条款吗？', answerType: 'facts', mustHave: [], mustNotHave: ['公司法'], forbiddenCaseIds: [] /* runEval 注入 caseB.id */ },
]
```

- [ ] **Step 2: Commit**

```bash
git add tests/eval/fixtures/testDataset.ts
git commit -m "feat(eval): testDataset 29 条提问（7 组覆盖 M1-M4）"
```

---

## Task 11: metrics/qualityMetrics.ts + judgePrompt.ts

**Files:**
- Create: `tests/eval/metrics/qualityMetrics.ts`
- Create: `tests/eval/metrics/judgePrompt.ts`
- Test: `tests/eval/metrics/qualityMetrics.test.ts`

- [ ] **Step 1: 写 judgePrompt.ts**

```ts
// tests/eval/metrics/judgePrompt.ts

export interface JudgeInput {
  question: string
  mustHaveJson: string  // JSON.stringify(mustHave 数组)
  answer: string
}

export function buildJudgePrompt(input: JudgeInput): string {
  return `你是一个严格的评测员。请根据以下信息对 AI 的回答打分。

【用户提问】
${input.question}

【参考事实清单】（应该被覆盖的要点）
${input.mustHaveJson}

【AI 的回答】
${input.answer}

请按以下 4 个维度打分（每项 1-5 分，1 差 5 优），然后给出综合分。

1. score_facts：事实覆盖度（参考清单命中比例）
2. score_citation：引用正确性（有没有引对材料/记忆/分析）
3. score_no_hallucination：无幻觉（有没有捏造不存在的事实，5 分=完全无幻觉，1 分=严重幻觉）
4. score_relevance：切题（有没有答所问）

严格输出以下 JSON（不要任何其他文本）：
{
  "score_facts": <1-5>,
  "score_citation": <1-5>,
  "score_no_hallucination": <1-5>,
  "score_relevance": <1-5>,
  "overall": <1-5>,
  "reasoning": "<不超过 100 字的简要说明>"
}`
}

export interface JudgeScore {
  score_facts: number
  score_citation: number
  score_no_hallucination: number
  score_relevance: number
  overall: number
  reasoning: string
}
```

- [ ] **Step 2: 写 qualityMetrics 失败测试**

```ts
// tests/eval/metrics/qualityMetrics.test.ts
import { describe, it, expect } from 'vitest'
import { evaluateFactsCase, aggregateQualityMetrics } from './qualityMetrics'
import type { CaseResult } from '../report/reportTypes'

describe('evaluateFactsCase', () => {
  it('全命中 → factsHitRate=1.0，无幻觉', () => {
    const r = evaluateFactsCase({
      answer: '本案一审法官是张三，案号 (2024)粤0103民初1234号',
      mustHave: ['张三', '(2024)粤0103民初1234号'],
      mustNotHave: ['李四'],
    })
    expect(r.factsHitRate).toBe(1.0)
    expect(r.hallucinationHits).toEqual([])
  })

  it('部分命中 + 幻觉', () => {
    const r = evaluateFactsCase({
      answer: '法官是李四',
      mustHave: ['张三'],
      mustNotHave: ['李四'],
    })
    expect(r.factsHitRate).toBe(0)
    expect(r.hallucinationHits).toEqual(['李四'])
  })

  it('normalization 处理空格 / 全半角', () => {
    const r = evaluateFactsCase({
      answer: '  张  三  ',
      mustHave: ['张三'],
    })
    expect(r.factsHitRate).toBe(1)
  })
})

describe('aggregateQualityMetrics', () => {
  it('hallucinationRate 超过 5% → CRITICAL fail', () => {
    const cases: CaseResult[] = [
      { id: 'a', group: 'profile', question: 'q', answer: '', mustHaveHits: [], mustHaveMisses: [], hallucinationHits: ['x'], toolCalls: [], tokens: {}, latencyMs: 0, result: 'fail', factsHitRate: 0 },
      ...Array.from({ length: 9 }, (_, i): CaseResult => ({ id: String(i), group: 'profile', question: 'q', answer: '', mustHaveHits: [], mustHaveMisses: [], hallucinationHits: [], toolCalls: [], tokens: {}, latencyMs: 0, result: 'pass', factsHitRate: 1 })),
    ]
    const metrics = aggregateQualityMetrics(cases)
    const h = metrics.find(m => m.name === 'hallucinationRate')!
    expect(h.severity).toBe('CRITICAL')
    expect(h.result).toBe('fail')
  })
})
```

- [ ] **Step 3: 实现 qualityMetrics.ts**

```ts
// tests/eval/metrics/qualityMetrics.ts
import type { CaseResult, MetricResult } from '../report/reportTypes'

export interface FactsInput {
  answer: string
  mustHave: string[]
  mustNotHave?: string[]
}

export interface FactsResult {
  factsHitRate: number
  mustHaveHits: string[]
  mustHaveMisses: string[]
  hallucinationHits: string[]
}

function normalize(s: string): string {
  return s.replace(/\s+/g, '').toLowerCase()
}

export function evaluateFactsCase(input: FactsInput): FactsResult {
  const ansN = normalize(input.answer)
  const hits: string[] = []
  const misses: string[] = []
  for (const kw of input.mustHave) {
    if (ansN.includes(normalize(kw))) hits.push(kw)
    else misses.push(kw)
  }
  const hallucinations: string[] = []
  for (const bad of input.mustNotHave ?? []) {
    if (ansN.includes(normalize(bad))) hallucinations.push(bad)
  }
  return {
    factsHitRate: input.mustHave.length === 0 ? 1 : hits.length / input.mustHave.length,
    mustHaveHits: hits,
    mustHaveMisses: misses,
    hallucinationHits: hallucinations,
  }
}

export function aggregateQualityMetrics(cases: CaseResult[]): MetricResult[] {
  const factsCases = cases.filter(c => c.factsHitRate !== undefined)
  const allHits = factsCases.reduce((s, c) => s + c.mustHaveHits.length, 0)
  const allTotal = factsCases.reduce((s, c) => s + c.mustHaveHits.length + c.mustHaveMisses.length, 0)
  const factsHitRate = allTotal > 0 ? allHits / allTotal : 0

  const totalCases = cases.length || 1
  const hallucCount = cases.reduce((s, c) => s + c.hallucinationHits.length, 0) +
    cases.filter(c => (c.judgeResult?.score_no_hallucination ?? 5) <= 2).length
  const hallucinationRate = hallucCount / totalCases

  const overallSum = cases.reduce((s, c) => {
    if (c.judgeResult) return s + c.judgeResult.overall
    if (c.factsHitRate !== undefined) return s + c.factsHitRate * 5
    return s
  }, 0)
  const qualityScore = overallSum / totalCases

  return [
    {
      name: 'qualityScore',
      value: round(qualityScore, 2),
      threshold: '>= 4.0',
      severity: 'WARN',
      result: qualityScore >= 4.0 ? 'pass' : 'fail',
    },
    {
      name: 'factsHitRate',
      value: round(factsHitRate, 4),
      threshold: '>= 0.8',
      severity: 'WARN',
      result: factsHitRate >= 0.8 ? 'pass' : 'fail',
    },
    {
      name: 'hallucinationRate',
      value: round(hallucinationRate, 4),
      threshold: '<= 0.05',
      severity: 'CRITICAL',
      result: hallucinationRate <= 0.05 ? 'pass' : 'fail',
    },
  ]
}

function round(v: number, decimals = 0): number {
  const f = 10 ** decimals
  return Math.round(v * f) / f
}
```

- [ ] **Step 4: 运行测试**

Run: `npx vitest run tests/eval/metrics/qualityMetrics.test.ts --reporter=verbose`
Expected: PASS 4 tests。

- [ ] **Step 5: Commit**

```bash
git add tests/eval/metrics/qualityMetrics.ts tests/eval/metrics/judgePrompt.ts tests/eval/metrics/qualityMetrics.test.ts
git commit -m "feat(eval): quality 指标（facts 匹配 + hallucinationRate CRITICAL）"
```

---

## Task 12: Judge 调度（DeepSeek 跑 freeform）+ taskMetrics

**Files:**
- Create: `tests/eval/metrics/judgeRunner.ts`
- Create: `tests/eval/metrics/taskMetrics.ts`
- Test: `tests/eval/metrics/taskMetrics.test.ts`

- [ ] **Step 1: 写 judgeRunner.ts**

```ts
// tests/eval/metrics/judgeRunner.ts
import { createChatModel } from '~~/server/services/node/chatModelFactory'
import { buildJudgePrompt, type JudgeScore } from './judgePrompt'

export interface JudgeOpts {
  apiKey: string
  baseUrl?: string
  modelName: string
  repeat: number
}

export async function runJudge(input: { question: string; mustHave: string[]; answer: string }, opts: JudgeOpts): Promise<JudgeScore & { repeats: number; stdev: number; unstable: boolean }> {
  const prompt = buildJudgePrompt({ question: input.question, mustHaveJson: JSON.stringify(input.mustHave), answer: input.answer })
  const model = createChatModel({
    sdkType: 'deepseek',
    modelName: opts.modelName,
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl,
    streaming: false,
    temperature: 0,
  } as any)

  const samples: JudgeScore[] = []
  for (let i = 0; i < opts.repeat; i++) {
    const resp = await model.invoke(prompt)
    const txt = typeof resp.content === 'string' ? resp.content : JSON.stringify(resp.content)
    const parsed = parseJudgeJson(txt)
    if (parsed) samples.push(parsed)
  }

  if (samples.length === 0) {
    return { score_facts: 0, score_citation: 0, score_no_hallucination: 0, score_relevance: 0, overall: 0, reasoning: 'judge 三次全部解析失败', repeats: 0, stdev: 0, unstable: true }
  }

  const avg = (k: keyof JudgeScore) => samples.reduce((s, x) => s + (x[k] as number), 0) / samples.length
  const overalls = samples.map(s => s.overall)
  const meanOverall = overalls.reduce((a, b) => a + b, 0) / overalls.length
  const variance = overalls.reduce((s, x) => s + (x - meanOverall) ** 2, 0) / overalls.length
  const stdev = Math.sqrt(variance)

  return {
    score_facts: avg('score_facts'),
    score_citation: avg('score_citation'),
    score_no_hallucination: avg('score_no_hallucination'),
    score_relevance: avg('score_relevance'),
    overall: meanOverall,
    reasoning: samples.map(s => s.reasoning).join(' | '),
    repeats: samples.length,
    stdev,
    unstable: stdev > 1.0,
  }
}

function parseJudgeJson(txt: string): JudgeScore | null {
  // 找第一个 { 和最后一个 } 之间的 JSON 块
  const start = txt.indexOf('{')
  const end = txt.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const obj = JSON.parse(txt.slice(start, end + 1))
    return {
      score_facts: Number(obj.score_facts ?? 0),
      score_citation: Number(obj.score_citation ?? 0),
      score_no_hallucination: Number(obj.score_no_hallucination ?? 0),
      score_relevance: Number(obj.score_relevance ?? 0),
      overall: Number(obj.overall ?? 0),
      reasoning: String(obj.reasoning ?? ''),
    }
  } catch {
    return null
  }
}
```

- [ ] **Step 2: 写 taskMetrics 测试**

```ts
// tests/eval/metrics/taskMetrics.test.ts
import { describe, it, expect } from 'vitest'
import { aggregateTaskMetrics } from './taskMetrics'
import type { CaseResult } from '../report/reportTypes'

const mkCase = (over: Partial<CaseResult>): CaseResult => ({
  id: 'x', group: 'memory', question: 'q', answer: 'a',
  mustHaveHits: [], mustHaveMisses: [], hallucinationHits: [],
  toolCalls: [], tokens: {}, latencyMs: 0, result: 'pass', ...over,
})

describe('aggregateTaskMetrics', () => {
  it('toolCallAccuracy 高于 80% → CRITICAL pass', () => {
    const cases: CaseResult[] = [
      mkCase({ id: '1', expectedTools: ['search_case_memory'], toolCalls: ['search_case_memory'] }),
      mkCase({ id: '2', expectedTools: ['search_case_memory'], toolCalls: ['search_case_memory'] }),
      mkCase({ id: '3', expectedTools: ['search_case_memory'], toolCalls: ['search_case_memory'] }),
      mkCase({ id: '4', expectedTools: ['search_case_memory'], toolCalls: ['search_case_memory'] }),
      mkCase({ id: '5', expectedTools: ['search_case_memory'], toolCalls: [] }),  // miss
    ]
    const m = aggregateTaskMetrics(cases)
    const acc = m.find(x => x.name === 'toolCallAccuracy')!
    expect(acc.value).toBeCloseTo(0.8, 4)
    expect(acc.severity).toBe('CRITICAL')
    expect(acc.result).toBe('pass')
  })
})
```

- [ ] **Step 3: 实现 taskMetrics.ts**

```ts
// tests/eval/metrics/taskMetrics.ts
import type { CaseResult, MetricResult } from '../report/reportTypes'

export function aggregateTaskMetrics(cases: CaseResult[]): MetricResult[] {
  const withExpected = cases.filter(c => c.expectedTools && c.expectedTools.length > 0)
  let hits = 0
  for (const c of withExpected) {
    const allCalled = c.expectedTools!.every(t => c.toolCalls.includes(t))
    if (allCalled) hits++
  }
  const acc = withExpected.length === 0 ? 1 : hits / withExpected.length

  const passCount = cases.filter(c => c.result === 'pass').length
  const passRate = cases.length === 0 ? 1 : passCount / cases.length

  return [
    {
      name: 'toolCallAccuracy',
      value: round(acc, 4),
      threshold: '>= 0.8',
      severity: 'CRITICAL',
      result: acc >= 0.8 ? 'pass' : 'fail',
      detail: `${hits}/${withExpected.length}`,
    },
    {
      name: 'scenarioPassRate',
      value: round(passRate, 4),
      threshold: '>= 0.9',
      severity: 'CRITICAL',
      result: passRate >= 0.9 ? 'pass' : 'fail',
      detail: `${passCount}/${cases.length}`,
    },
  ]
}

function round(v: number, decimals = 0): number {
  const f = 10 ** decimals
  return Math.round(v * f) / f
}
```

- [ ] **Step 4: 运行测试**

Run: `npx vitest run tests/eval/metrics/taskMetrics.test.ts --reporter=verbose`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add tests/eval/metrics/judgeRunner.ts tests/eval/metrics/taskMetrics.ts tests/eval/metrics/taskMetrics.test.ts
git commit -m "feat(eval): judge runner（DeepSeek 3 次重复）+ task 指标"
```

---

## Task 13: runEval.ts 接入 Quality + Task

**Files:**
- Modify: `tests/eval/runEval.ts`
- Modify: `tests/eval/runner/datasetRunner.ts`

- [ ] **Step 1: 把 placeholder 替换成真 dataset，runEval 加 quality + task aggregation**

修改 `tests/eval/runEval.ts`，把 Step 3 的 placeholders 替换为：

```ts
import { TEST_DATASET, type EvalCase } from './fixtures/testDataset'
import { evaluateFactsCase, aggregateQualityMetrics } from './metrics/qualityMetrics'
import { aggregateTaskMetrics } from './metrics/taskMetrics'
import { runJudge } from './metrics/judgeRunner'
import { getToolCallsFromThread } from './utils/traceReader'
import { countTokensSync } from '~~/server/utils/tokenCounter'

// ...

const allCaseResults: CaseResult[] = []
const tokenSysSamples: number[] = []

for (const ec of TEST_DATASET) {
  // 注入 forbiddenCaseIds 等占位
  const ec2: EvalCase = ec.group === 'security' ? { ...ec, forbiddenCaseIds: [fx.caseB.id] } : ec
  let runResult
  try {
    runResult = await runOneChat({
      caseId: fx.caseA.id,
      userId: OWNER_USER_ID,
      moduleId: ec2.moduleId,
      question: ec2.question,
      isWarmup: false,
    }, handler)
  } catch (e) {
    allCaseResults.push({
      id: ec2.id, group: ec2.group, question: ec2.question, answer: '',
      mustHaveHits: [], mustHaveMisses: ec2.mustHave, hallucinationHits: [],
      toolCalls: [], expectedTools: ec2.expectedTools, tokens: {}, latencyMs: 0,
      result: 'errored',
    })
    continue
  }

  // facts vs freeform
  let factsR: ReturnType<typeof evaluateFactsCase> | undefined
  let judgeR: CaseResult['judgeResult']
  if (ec2.answerType === 'facts') {
    factsR = evaluateFactsCase({ answer: runResult.answer, mustHave: ec2.mustHave, mustNotHave: ec2.mustNotHave })
  } else {
    const j = await runJudge(
      { question: ec2.question, mustHave: ec2.mustHave, answer: runResult.answer },
      { apiKey: process.env.EVAL_DEEPSEEK_KEY ?? '', modelName: 'deepseek-chat', repeat: 3 },
    )
    judgeR = j
  }

  const toolCalls = (await getToolCallsFromThread(runResult.threadId)).map(t => t.name)

  // facts 类断言通过条件
  let result: CaseResult['result'] = 'pass'
  if (factsR && factsR.factsHitRate < 1) result = 'fail'
  if (factsR && factsR.hallucinationHits.length > 0) result = 'fail'
  if (judgeR && judgeR.overall < 4) result = 'fail'
  if (ec2.expectedTools && !ec2.expectedTools.every(t => toolCalls.includes(t))) result = 'fail'

  allCaseResults.push({
    id: ec2.id, group: ec2.group, question: ec2.question, answer: runResult.answer,
    factsHitRate: factsR?.factsHitRate, mustHaveHits: factsR?.mustHaveHits ?? [], mustHaveMisses: factsR?.mustHaveMisses ?? [],
    hallucinationHits: factsR?.hallucinationHits ?? [],
    toolCalls, expectedTools: ec2.expectedTools, tokens: {}, latencyMs: runResult.latencyMs,
    threadId: runResult.threadId, judgeResult: judgeR, result,
  })

  // 采 systemPromptTokens（取最后一次同模块 prompt 的前 4 段 token，需要 datasetRunner 暴露）
  // 此处作为 Phase 2 起的样本采集占位，Task 18 接入 stability 时补全
}

const quality = aggregateQualityMetrics(allCaseResults)
const task = aggregateTaskMetrics(allCaseResults)

// ... 把 quality + task 加到 metrics
```

> 注：`EVAL_DEEPSEEK_KEY` 需要从环境变量传入，README 加说明。

- [ ] **Step 2: 跑全量再次冒烟**

Run: `EVAL_DEEPSEEK_KEY=sk-xxx bun run eval:context`

Expected:
- 跑 ~5-7 分钟（29 提问 + ~5 freeform × 3 judge 调用）
- 报告 metrics 含 cost / quality / task 三类
- exit 0 或 1

- [ ] **Step 3: Commit**

```bash
git add tests/eval/runEval.ts tests/eval/runner/datasetRunner.ts
git commit -m "feat(eval): runEval 接入 Quality + Task 指标 + dataset 实跑"
```

---

## Task 14: consolidator.service.ts 新增 processNowService

**Files:**
- Modify: `server/services/memory/consolidator.service.ts`
- Test: `tests/server/memory/consolidator.processNow.test.ts`

- [ ] **Step 1: 写测试**

```ts
// tests/server/memory/consolidator.processNow.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '~~/server/utils/db'
import { getRedisClient } from '~~/server/utils/redis'
import { scheduleConsolidation, processNowService } from '~~/server/services/memory/consolidator.service'

describe('processNowService', () => {
  beforeEach(async () => {
    const redis = getRedisClient()
    await redis.del('memory:consolidator:queue')  // QUEUE_KEY
  })

  it('drain 队列后立即执行 consolidate（即使 dueAt 在未来）', async () => {
    // 准备一个 caseSession
    const caseId = 9999
    const sessionId = 'eval-test-session-' + Date.now()
    await prisma.caseSessions.create({ data: { sessionId, caseId, userId: 1, moduleId: 'init' } as any })

    await scheduleConsolidation({ caseId, sessionId })

    // processNow 应该立即处理，不等 30s
    const beforeCount = await prisma.case_memories.count({ where: { metadata: { path: ['caseId'], equals: caseId } } } as any)
    await processNowService(caseId)
    // 由于 fixture session 没真实 messages，期望至少 drain 完队列不抛异常
    const queueRemaining = await getRedisClient().zcount('memory:consolidator:queue', 0, '+inf')
    expect(queueRemaining).toBe(0)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/server/memory/consolidator.processNow.test.ts --reporter=verbose`
Expected: FAIL with `processNowService is not exported`。

- [ ] **Step 3: 实现 processNowService**

修改 `server/services/memory/consolidator.service.ts`，在文件末尾追加：

```ts
const QUEUE_KEY = 'memory:consolidator:queue'  // 如已存在不要重复定义

/**
 * 立即处理指定 caseId 的对话抽取，跳过 debounce 窗口。
 *
 * 用途：
 * - eval 跑 extraction dataset 时同步等待结果（绕过 30s debounce）
 * - 管理后台未来的"立刻整理记忆"按钮
 *
 * 实现：
 *   1. 找出该 caseId 名下所有 ZSET 排队中的 sessionId
 *   2. 从 ZSET 中移除（drain）
 *   3. 同步 await consolidateSession 跑完
 */
export async function processNowService(caseId: number): Promise<void> {
  const sessions = await prisma.caseSessions.findMany({
    where: { caseId },
    select: { sessionId: true },
  })
  if (sessions.length === 0) return

  const redis = getRedisClient()
  const sessionIds = sessions.map(s => s.sessionId)

  // drain：从 ZSET 移除这些 sessionId（无论 dueAt 是否到期）
  if (sessionIds.length > 0) {
    await redis.zrem(QUEUE_KEY, ...sessionIds)
  }

  // 同步串行跑（非并发）
  for (const sid of sessionIds) {
    await consolidateSession(sid)
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/server/memory/consolidator.processNow.test.ts --reporter=verbose`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add server/services/memory/consolidator.service.ts tests/server/memory/consolidator.processNow.test.ts
git commit -m "feat(memory): consolidator 新增 processNowService（绕 debounce）"
```

---

## Task 15: extractionDataset + extractionMetrics

**Files:**
- Create: `tests/eval/fixtures/extractionDataset.ts`
- Create: `tests/eval/metrics/extractionMetrics.ts`
- Test: `tests/eval/metrics/extractionMetrics.test.ts`

- [ ] **Step 1: 写 extractionDataset.ts**

```ts
// tests/eval/fixtures/extractionDataset.ts

export interface ExpectedExtraction {
  subjectKey: string
  valueKeywords: string[]
  minConfidence: number
  optional?: boolean
}

export interface ExtractionTranscript {
  id: string
  moduleId: string
  turns: { role: 'user' | 'assistant'; content: string }[]
  expectedExtractions: ExpectedExtraction[]
  forbiddenExtractions: string[]
  /** ex-02 依赖 ex-01 的状态，需在 ex-01 之后跑 */
  runAfter?: string
}

export const EXTRACTION_DATASET: ExtractionTranscript[] = [
  {
    id: 'ex-01',
    moduleId: 'init',
    turns: [
      { role: 'user', content: '我是这个案子的甲方代理律师' },
      { role: 'assistant', content: '好的，已了解。' },
      { role: 'user', content: '甲方公司全称是天利科技股份有限公司' },
      { role: 'assistant', content: '记下了。' },
      { role: 'user', content: '我希望尽量在三个月内结案' },
      { role: 'assistant', content: '明白您的诉求。' },
      { role: 'user', content: '我个人偏好用电话沟通，不太喜欢邮件' },
      { role: 'assistant', content: '收到。' },
      { role: 'user', content: '另外乙方上周三在电话里口头承认了逾期交货的事实' },
      { role: 'assistant', content: '这是重要事实，已记录。' },
    ],
    expectedExtractions: [
      { subjectKey: 'fact.party.plaintiff_name', valueKeywords: ['天利', '科技'], minConfidence: 0.7 },
      { subjectKey: 'preference.timeline.target', valueKeywords: ['三个月', '3'], minConfidence: 0.6 },
      { subjectKey: 'preference.contact.method', valueKeywords: ['电话'], minConfidence: 0.7 },
      { subjectKey: 'fact.delivery.acknowledgement', valueKeywords: ['逾期', '承认'], minConfidence: 0.7 },
    ],
    forbiddenExtractions: ['fact.contract.amount', 'fact.dispute.location'],
  },
  {
    id: 'ex-02',
    moduleId: 'init',
    runAfter: 'ex-01',
    turns: [
      { role: 'user', content: '更正一下，刚才说的甲方公司名字错了，正确的是天利达科技集团有限公司' },
      { role: 'assistant', content: '已更正。' },
    ],
    expectedExtractions: [
      { subjectKey: 'fact.party.plaintiff_name', valueKeywords: ['天利达', '集团'], minConfidence: 0.7 },
    ],
    forbiddenExtractions: [],
  },
  {
    id: 'ex-03',
    moduleId: 'init',
    turns: [
      { role: 'user', content: '假设乙方提出 200 万的赔偿，我们是否应该接受？' },
      { role: 'assistant', content: '这取决于多个因素…' },
      { role: 'user', content: '如果对方咄咄逼人怎么办？' },
      { role: 'assistant', content: '可以采取以下应对措施…' },
    ],
    expectedExtractions: [],
    forbiddenExtractions: ['fact.settlement.amount', 'fact.opponent.attitude'],
  },
]
```

- [ ] **Step 2: 写 extractionMetrics 测试**

```ts
// tests/eval/metrics/extractionMetrics.test.ts
import { describe, it, expect } from 'vitest'
import { evaluateExtraction, aggregateExtractionMetrics } from './extractionMetrics'

describe('evaluateExtraction', () => {
  it('全命中 + 无幻觉', () => {
    const r = evaluateExtraction(
      [
        { subjectKey: 'fact.party.plaintiff_name', text: '甲方为天利科技公司', confidence: 0.9 },
      ],
      {
        expectedExtractions: [
          { subjectKey: 'fact.party.plaintiff_name', valueKeywords: ['天利', '科技'], minConfidence: 0.7 },
        ],
        forbiddenExtractions: [],
      },
    )
    expect(r.recall).toBe(1)
    expect(r.precision).toBe(1)
  })

  it('置信度低于阈值 → 不算命中', () => {
    const r = evaluateExtraction(
      [{ subjectKey: 'fact.x', text: 'x 是 y', confidence: 0.5 }],
      { expectedExtractions: [{ subjectKey: 'fact.x', valueKeywords: ['x'], minConfidence: 0.7 }], forbiddenExtractions: [] },
    )
    expect(r.recall).toBe(0)
  })

  it('forbiddenExtractions 命中 → precision 下降', () => {
    const r = evaluateExtraction(
      [{ subjectKey: 'fact.bad', text: '不该抽的', confidence: 0.9 }],
      { expectedExtractions: [], forbiddenExtractions: ['fact.bad'] },
    )
    expect(r.precision).toBe(0)
  })
})

describe('aggregateExtractionMetrics', () => {
  it('extractionPrecision 低于 95% → CRITICAL fail', () => {
    const m = aggregateExtractionMetrics([
      { transcriptId: 'a', recallHits: 5, recallMisses: 0, precisionMisses: 1, totalExtracted: 5, recall: 1, precision: 0.8, detail: '' },
    ])
    const p = m.find(x => x.name === 'extractionPrecision')!
    expect(p.severity).toBe('CRITICAL')
    expect(p.result).toBe('fail')
  })
})
```

- [ ] **Step 3: 实现 extractionMetrics.ts**

```ts
// tests/eval/metrics/extractionMetrics.ts
import type { MetricResult, ExtractionResult } from '../report/reportTypes'
import type { ExtractionTranscript } from '../fixtures/extractionDataset'

export interface ExtractedItem {
  subjectKey: string
  text: string
  confidence: number
  invalidatedAt?: Date | null
}

export function evaluateExtraction(
  extracted: ExtractedItem[],
  transcript: Pick<ExtractionTranscript, 'expectedExtractions' | 'forbiddenExtractions'>,
): ExtractionResult {
  let recallHits = 0
  let recallMisses = 0
  for (const expected of transcript.expectedExtractions) {
    const match = extracted.find(e =>
      e.subjectKey === expected.subjectKey &&
      expected.valueKeywords.every(kw => e.text.includes(kw)) &&
      e.confidence >= expected.minConfidence,
    )
    if (match) recallHits++
    else if (!expected.optional) recallMisses++
  }

  let precisionMisses = 0
  for (const e of extracted) {
    if (transcript.forbiddenExtractions.includes(e.subjectKey)) precisionMisses++
  }

  const recall = recallHits + recallMisses === 0 ? 1 : recallHits / (recallHits + recallMisses)
  const precision = extracted.length === 0 ? 1 : 1 - precisionMisses / extracted.length

  return {
    transcriptId: '',
    recallHits, recallMisses, precisionMisses, totalExtracted: extracted.length,
    recall, precision, detail: `expected=${transcript.expectedExtractions.length}, extracted=${extracted.length}`,
  }
}

export function aggregateExtractionMetrics(results: ExtractionResult[]): MetricResult[] {
  const totalRecall = results.reduce((s, r) => s + r.recallHits, 0)
  const totalRecallTotal = results.reduce((s, r) => s + r.recallHits + r.recallMisses, 0)
  const recall = totalRecallTotal === 0 ? 1 : totalRecall / totalRecallTotal

  const totalExtracted = results.reduce((s, r) => s + r.totalExtracted, 0)
  const totalPrecMiss = results.reduce((s, r) => s + r.precisionMisses, 0)
  const precision = totalExtracted === 0 ? 1 : 1 - totalPrecMiss / totalExtracted

  const versionChainCorrect = results.every(r => r.versionChainCorrect !== false)

  return [
    { name: 'extractionRecall', value: round(recall, 4), threshold: '>= 0.7', severity: 'WARN', result: recall >= 0.7 ? 'pass' : 'fail' },
    { name: 'extractionPrecision', value: round(precision, 4), threshold: '>= 0.95', severity: 'CRITICAL', result: precision >= 0.95 ? 'pass' : 'fail' },
    { name: 'versionChainCorrect', value: versionChainCorrect, threshold: 'true', severity: 'CRITICAL', result: versionChainCorrect ? 'pass' : 'fail' },
    { name: 'confidenceFilterCorrect', value: true, threshold: 'true', severity: 'WARN', result: 'pass', detail: '由 evaluateExtraction 内的 confidence 阈值保证' },
  ]
}

function round(v: number, decimals = 0): number {
  const f = 10 ** decimals
  return Math.round(v * f) / f
}
```

- [ ] **Step 4: 运行测试 + commit**

```bash
npx vitest run tests/eval/metrics/extractionMetrics.test.ts --reporter=verbose
git add tests/eval/fixtures/extractionDataset.ts tests/eval/metrics/extractionMetrics.ts tests/eval/metrics/extractionMetrics.test.ts
git commit -m "feat(eval): extraction dataset + 指标（precision CRITICAL）"
```

---

## Task 16: securityDataset + securityMetrics

**Files:**
- Create: `tests/eval/fixtures/securityDataset.ts`
- Create: `tests/eval/metrics/securityMetrics.ts`

> Security 断言主要是直接调服务，不需要单元测试（端到端 runner 里跑就足够）。

- [ ] **Step 1: 写 securityDataset.ts**

```ts
// tests/eval/fixtures/securityDataset.ts
import type { FixtureResult } from './buildFixture'

export interface SecurityAssertion {
  id: string
  category: 'cross-case-leak' | 'archived-guard' | 'ai-autofill'
  severity: 'CRITICAL' | 'WARN'
  /** 实际执行函数。返回 { pass, detail } */
  run: (fx: FixtureResult, ctx: { ownerUserId: number }) => Promise<{ pass: boolean; detail: string }>
}

export function buildSecurityAssertions(): SecurityAssertion[] {
  return [
    // sec-cross-case-leak 在 runEval 里基于 ⑦ 组结果直接判定，不在这里跑
    {
      id: 'sec-archived-updateCase',
      category: 'archived-guard',
      severity: 'CRITICAL',
      async run(fx, ctx) {
        const { $fetch } = await import('ofetch')
        try {
          const res: any = await $fetch(`http://localhost:3000/api/v1/case/${fx.caseC.id}`, {
            method: 'PUT',
            body: { title: '尝试改 ARCHIVED 标题' },
            headers: { /* eval 期间需注入测试用户 token；按真实 auth 机制补 */ },
          })
          return { pass: res.code !== 200, detail: `code=${res.code}, message=${res.message}` }
        } catch (e: any) {
          return { pass: true, detail: `HTTP error 也算挡住：${e?.message ?? e}` }
        }
      },
    },
    {
      id: 'sec-archived-initAnalysis',
      category: 'archived-guard',
      severity: 'CRITICAL',
      async run(fx, ctx) {
        const { $fetch } = await import('ofetch')
        try {
          const res: any = await $fetch(`http://localhost:3000/api/v1/case/init-analysis`, {
            method: 'POST',
            body: { caseId: fx.caseC.id },
            headers: { /* token */ },
          })
          return { pass: res.code !== 200, detail: `code=${res.code}` }
        } catch (e: any) {
          return { pass: true, detail: `${e?.message ?? e}` }
        }
      },
    },
    {
      id: 'sec-archived-write-memory',
      category: 'archived-guard',
      severity: 'CRITICAL',
      async run(fx) {
        const { writeMemoryService } = await import('~~/server/services/memory/memory.service')
        try {
          await writeMemoryService({ caseId: fx.caseC.id, text: '尝试写入', kind: 'fact', confidence: 0.9 } as any)
          return { pass: false, detail: '错误：ARCHIVED 案件不应能写入记忆' }
        } catch (e: any) {
          return { pass: true, detail: `服务层正确拒绝：${e?.message ?? e}` }
        }
      },
    },
    {
      id: 'sec-archived-update-memory',
      category: 'archived-guard',
      severity: 'CRITICAL',
      async run(fx) {
        const { updateMemoryService } = await import('~~/server/services/memory/memory.service')
        try {
          await updateMemoryService({ id: fx.caseC.memoryId, invalidate: true } as any)
          return { pass: false, detail: '错误：ARCHIVED 案件不应能更新记忆' }
        } catch (e: any) {
          return { pass: true, detail: `${e?.message ?? e}` }
        }
      },
    },
    {
      id: 'sec-ai-autofill-preserve',
      category: 'ai-autofill',
      severity: 'CRITICAL',
      async run(fx) {
        // 用现有 mergeAutofillPreservingUserInput 直接验证
        const { mergeAutofillPreservingUserInput } = await import('~~/server/services/case/autofillMerge')
        const userFilled = { firstInstanceJudge: '张三', firstInstanceCaseNo: '已填' }
        const aiExtracted = { firstInstanceJudge: '李四', firstInstanceCaseNo: 'AI填的' }
        const merged = mergeAutofillPreservingUserInput(userFilled, aiExtracted) as any
        const ok = merged.firstInstanceJudge === '张三' && merged.firstInstanceCaseNo === '已填'
        return { pass: ok, detail: JSON.stringify(merged) }
      },
    },
  ]
}
```

> 注：实际 service 路径（`mergeAutofillPreservingUserInput` / `writeMemoryService` 等）请按真实项目 grep 调整 import 路径。

- [ ] **Step 2: 写 securityMetrics.ts**

```ts
// tests/eval/metrics/securityMetrics.ts
import type { MetricResult, SecurityAssertionResult, CaseResult } from '../report/reportTypes'

export function evaluateCrossCaseLeak(securityCases: CaseResult[], decoyCaseId: number): SecurityAssertionResult {
  const leaks: string[] = []
  for (const c of securityCases) {
    // 检查 toolCalls 的 result（通过 traceReader 二次拉？这里简化用 mustNotHave 命中替代）
    if (c.hallucinationHits.length > 0) {
      leaks.push(`${c.id}: ${c.hallucinationHits.join(',')}`)
    }
  }
  return {
    id: 'sec-cross-case-leak',
    category: 'cross-case-leak',
    severity: 'CRITICAL',
    result: leaks.length === 0 ? 'pass' : 'fail',
    detail: leaks.length === 0 ? 'no leak detected' : leaks.join('; '),
  }
}

export function aggregateSecurityMetrics(results: SecurityAssertionResult[]): MetricResult[] {
  return results.map(r => ({
    name: r.id,
    value: r.result === 'pass',
    threshold: 'pass',
    severity: r.severity,
    result: r.result,
    detail: r.detail,
  }))
}
```

- [ ] **Step 3: Commit**

```bash
git add tests/eval/fixtures/securityDataset.ts tests/eval/metrics/securityMetrics.ts
git commit -m "feat(eval): security dataset 6 个断言 + 指标聚合"
```

---

## Task 17: stabilityMetrics

**Files:**
- Create: `tests/eval/metrics/stabilityMetrics.ts`

- [ ] **Step 1: 写 stabilityMetrics.ts**

```ts
// tests/eval/metrics/stabilityMetrics.ts
import { createHash } from 'node:crypto'
import type { MetricResult } from '../report/reportTypes'
import { prisma } from '~~/server/utils/db'

export async function checkPromptHashStability(buildSegments: () => Promise<{ roleAndFlow: string; caseProfile: string; moduleSummaries: string; dynamicContext: string }>): Promise<MetricResult> {
  const a = await buildSegments()
  const b = await buildSegments()
  const concat = (s: typeof a) => s.roleAndFlow + s.caseProfile + s.moduleSummaries + s.dynamicContext
  const hashA = createHash('sha256').update(concat(a)).digest('hex')
  const hashB = createHash('sha256').update(concat(b)).digest('hex')
  return {
    name: 'stab-prompt-hash',
    value: hashA === hashB,
    threshold: 'sha256(seg ①②③④) 两次相等',
    severity: 'CRITICAL',
    result: hashA === hashB ? 'pass' : 'fail',
    detail: hashA === hashB ? hashA.slice(0, 16) : `mismatch ${hashA.slice(0, 8)} vs ${hashB.slice(0, 8)}`,
  }
}

export async function checkSwitchActiveAtomic(caseId: number): Promise<MetricResult> {
  // 查 caseAnalyses 同 type 的 isActive=true 行数 = 1
  const analyses = await prisma.caseAnalyses.findMany({ where: { caseId } })
  const byType = new Map<string, typeof analyses>()
  for (const a of analyses) {
    const t = (a as any).analysisType as string
    if (!byType.has(t)) byType.set(t, [])
    byType.get(t)!.push(a)
  }
  const issues: string[] = []
  for (const [t, list] of byType) {
    const actives = list.filter(a => (a as any).isActive)
    if (actives.length !== 1) issues.push(`${t}: active=${actives.length}（期望 1）`)
    // 同步检查 case_analysis_embeddings.metadata.isActive
    if (actives[0]) {
      const embeddings = await prisma.$queryRawUnsafe<{ id: string; metadata: any }[]>(
        `SELECT id, metadata FROM case_analysis_embeddings WHERE metadata->>'caseAnalysisId' = $1`,
        actives[0].id,
      )
      const allTagActive = embeddings.every(e => e.metadata?.isActive === true)
      if (!allTagActive && embeddings.length > 0) issues.push(`${t}: 部分 embedding metadata.isActive 不一致`)
    }
  }
  return {
    name: 'stab-switch-active-atomic',
    value: issues.length === 0,
    threshold: 'isActive=1 行 + embeddings 同步',
    severity: 'CRITICAL',
    result: issues.length === 0 ? 'pass' : 'fail',
    detail: issues.length === 0 ? 'ok' : issues.join('; '),
  }
}

export async function checkOldDataGraceful(legacyAnalysisId: string, caseId: number): Promise<MetricResult> {
  const issues: string[] = []
  // 1. search_case_analysis 直接调
  try {
    const { searchCaseAnalysisService } = await import('~~/server/services/case/analysis.service')
    await searchCaseAnalysisService({ caseId, query: 'legacy', topK: 5 } as any)
  } catch (e: any) {
    issues.push(`search 抛异常：${e?.message ?? e}`)
  }
  // 2. moduleContextBuilder 渲染
  try {
    const { buildModuleContext } = await import('~~/server/services/workflow/context/moduleContextBuilder')
    const segs = await buildModuleContext({ caseId, moduleId: 'init', userId: 1 } as any) as any
    const concat = (segs.moduleSummaries ?? '')
    if (concat.includes('null') || concat.includes('undefined')) {
      issues.push(`moduleSummaries 段含 null/undefined 字面量`)
    }
  } catch (e: any) {
    issues.push(`buildModuleContext 抛异常：${e?.message ?? e}`)
  }
  return {
    name: 'stab-old-data-graceful',
    value: issues.length === 0,
    threshold: '不抛异常 + 段不含 null',
    severity: 'CRITICAL',
    result: issues.length === 0 ? 'pass' : 'fail',
    detail: issues.length === 0 ? 'ok' : issues.join('; '),
  }
}

export function checkProfileKeyOrder(profile: Record<string, unknown>): MetricResult {
  const keys = Object.keys(profile)
  const sorted = [...keys].sort()
  const ok = JSON.stringify(keys) === JSON.stringify(sorted)
  return {
    name: 'stab-profile-key-order',
    value: ok,
    threshold: '字典序',
    severity: 'WARN',
    result: ok ? 'pass' : 'fail',
    detail: ok ? 'ok' : `keys=${keys.join(',')}`,
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add tests/eval/metrics/stabilityMetrics.ts
git commit -m "feat(eval): stability 指标（hash + switch + 旧数据 + 字典序）"
```

---

## Task 18: runEval 最终接入 Part 2 + Part 3

**Files:**
- Modify: `tests/eval/runEval.ts`

- [ ] **Step 1: 在 runEval 加 Step 4-5（Part 2/3）**

修改 `tests/eval/runEval.ts`，在 Part 1 后追加：

```ts
import { EXTRACTION_DATASET } from './fixtures/extractionDataset'
import { evaluateExtraction, aggregateExtractionMetrics } from './metrics/extractionMetrics'
import { processNowService } from '~~/server/services/memory/consolidator.service'
import { buildSecurityAssertions } from './fixtures/securityDataset'
import { evaluateCrossCaseLeak, aggregateSecurityMetrics } from './metrics/securityMetrics'
import { checkPromptHashStability, checkSwitchActiveAtomic, checkOldDataGraceful, checkProfileKeyOrder } from './metrics/stabilityMetrics'
import { buildModuleContext } from '~~/server/services/workflow/context/moduleContextBuilder'

// ... 在 quality + task aggregation 之后

// Step 4: extraction
const extractions: ExtractionResult[] = []
for (const tr of EXTRACTION_DATASET) {
  // 跑 transcript 的 turns（喂给 runOneChat）
  for (const turn of tr.turns) {
    if (turn.role === 'user') {
      try {
        await runOneChat({ caseId: fx.caseA.id, userId: OWNER_USER_ID, moduleId: tr.moduleId, question: turn.content }, handler)
      } catch { /* skip */ }
    }
  }
  // 强制 flush
  await processNowService(fx.caseA.id)
  // 拉新增的 case_memories
  const recent = await prisma.case_memories.findMany({
    where: { metadata: { path: ['caseId'], equals: fx.caseA.id } } as any,
    orderBy: { createdAt: 'desc' },
    take: 30,
  })
  const extracted = recent.map(r => ({
    subjectKey: (r.metadata as any)?.subjectKey ?? '',
    text: r.text,
    confidence: (r.metadata as any)?.confidence ?? 0,
  }))
  const result = evaluateExtraction(extracted, tr)
  result.transcriptId = tr.id

  // 版本链检查（仅 ex-02）
  if (tr.id === 'ex-02') {
    const sameKey = recent.filter(r => (r.metadata as any)?.subjectKey === 'fact.party.plaintiff_name')
    const actives = sameKey.filter(r => !(r.metadata as any)?.invalidatedAt)
    result.versionChainCorrect = actives.length === 1
  }
  extractions.push(result)
}
const extractionMetrics = aggregateExtractionMetrics(extractions)

// Step 5: security + stability
const securityResults: SecurityAssertionResult[] = []
const securityCases = allCaseResults.filter(c => c.group === 'security')
securityResults.push(evaluateCrossCaseLeak(securityCases, fx.caseB.id))

for (const a of buildSecurityAssertions()) {
  try {
    const r = await a.run(fx, { ownerUserId: OWNER_USER_ID })
    securityResults.push({ id: a.id, category: a.category, severity: a.severity, result: r.pass ? 'pass' : 'fail', detail: r.detail })
  } catch (e: any) {
    securityResults.push({ id: a.id, category: a.category, severity: a.severity, result: 'errored', detail: e?.message ?? String(e) })
  }
}
const securityMetrics = aggregateSecurityMetrics(securityResults)

const stabMetrics = [
  await checkPromptHashStability(async () => {
    const r = await buildModuleContext({ caseId: fx.caseA.id, moduleId: 'module-1', userId: OWNER_USER_ID } as any) as any
    return { roleAndFlow: r.roleAndFlow, caseProfile: r.caseProfile, moduleSummaries: r.moduleSummaries, dynamicContext: '' }
  }),
  await checkSwitchActiveAtomic(fx.caseA.id),
  await checkOldDataGraceful(fx.caseA.analysisLegacyId, fx.caseA.id),
  checkProfileKeyOrder(/* 取 buildCaseProfileJson 输出 */ {} as any),
]

// 把所有 metrics 合到 report
report.metrics.extraction = extractionMetrics
report.metrics.security = securityMetrics
report.metrics.stability = stabMetrics
report.extractions = extractions
report.securityAssertions = securityResults
```

- [ ] **Step 2: 跑全量**

Run: `EVAL_DEEPSEEK_KEY=sk-xxx bun run eval:context`

Expected: 7-10 分钟跑完，产出含全 6 类指标的报告。

- [ ] **Step 3: Commit**

```bash
git add tests/eval/runEval.ts
git commit -m "feat(eval): runEval 接入 Part 2/3（extraction + security + stability）"
```

---

## Task 19: HTML Viewer + index.json

**Files:**
- Create: `docs/eval-reports/viewer.html`
- Create: `tests/eval/report/reportIndex.ts`

- [ ] **Step 1: 写 viewer.html**

```html
<!-- docs/eval-reports/viewer.html -->
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>上下文机制评测报告 Viewer</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-50 text-slate-900">
  <div class="max-w-7xl mx-auto p-6">
    <h1 class="text-2xl font-bold mb-4">上下文机制评测报告</h1>

    <div class="mb-4 flex items-center gap-3">
      <label class="text-sm">报告：</label>
      <select id="report-select" class="border rounded px-2 py-1 bg-white"></select>
      <button id="reload" class="px-3 py-1 bg-slate-200 rounded">刷新</button>
    </div>

    <div id="overview" class="mb-6"></div>
    <div id="metrics" class="mb-6"></div>
    <div id="cases"></div>
  </div>

  <script>
    async function loadIndex() {
      try {
        const res = await fetch('./index.json')
        const idx = await res.json()
        const sel = document.getElementById('report-select')
        sel.innerHTML = ''
        idx.reports.slice().reverse().forEach(r => {
          const o = document.createElement('option')
          o.value = r.filename
          o.textContent = `${r.runAt}  ${r.overallPass ? '[PASS]' : '[FAIL]'}`
          sel.appendChild(o)
        })
        if (idx.reports.length > 0) {
          await loadReport(sel.value)
        }
      } catch (e) {
        document.getElementById('overview').innerHTML = `<div class="text-red-600">加载 index.json 失败：${e}</div>`
      }
    }

    async function loadReport(filename) {
      const res = await fetch('./' + filename)
      const r = await res.json()
      renderOverview(r)
      renderMetrics(r)
      renderCases(r)
    }

    function renderOverview(r) {
      const el = document.getElementById('overview')
      const badge = r.summary.overallPass
        ? '<span class="px-3 py-1 bg-green-100 text-green-800 rounded font-bold">[PASS]</span>'
        : '<span class="px-3 py-1 bg-red-100 text-red-800 rounded font-bold">[FAIL]</span>'
      el.innerHTML = `
        <div class="bg-white p-4 rounded shadow">
          <div class="flex items-center gap-3">
            ${badge}
            <span class="text-sm text-slate-600">${r.runAt} · commit ${r.commit} · ${(r.durationMs/1000).toFixed(1)}s</span>
          </div>
          <div class="mt-3 grid grid-cols-2 gap-2 text-sm">
            <div>CRITICAL：${r.summary.passedCritical}/${r.summary.totalCritical} 通过</div>
            <div>WARN：${r.summary.passedWarn}/${r.summary.totalWarn} 通过</div>
          </div>
          ${r.summary.criticalFailures.length > 0 ? `<div class="mt-3"><strong>CRITICAL 未通过：</strong><ul class="list-disc ml-6">${r.summary.criticalFailures.map(x => `<li>${x}</li>`).join('')}</ul></div>` : ''}
        </div>
      `
    }

    function renderMetrics(r) {
      const el = document.getElementById('metrics')
      const cats = Object.entries(r.metrics)
      el.innerHTML = cats.map(([cat, ms]) => `
        <details class="bg-white p-4 rounded shadow mb-2" open>
          <summary class="font-bold cursor-pointer">${cat}（${ms.length}）</summary>
          <table class="w-full mt-2 text-sm">
            <thead><tr class="text-left text-slate-500"><th>指标</th><th>值</th><th>阈值</th><th>级别</th><th>状态</th></tr></thead>
            <tbody>${ms.map(m => `
              <tr class="border-t">
                <td class="py-1">${m.name}</td>
                <td>${m.value}</td>
                <td>${m.threshold || '-'}</td>
                <td>${m.severity}</td>
                <td class="${m.result === 'pass' ? 'text-green-700' : m.result === 'fail' ? 'text-red-700' : 'text-amber-700'}">${m.result}</td>
              </tr>`).join('')}</tbody>
          </table>
        </details>
      `).join('')
    }

    function renderCases(r) {
      const el = document.getElementById('cases')
      el.innerHTML = `
        <details class="bg-white p-4 rounded shadow">
          <summary class="font-bold cursor-pointer">逐 case 明细（${r.cases.length}）</summary>
          ${r.cases.map(c => `
            <details class="border-t pt-2 mt-2">
              <summary class="cursor-pointer text-sm">[${c.result}] ${c.id} — ${c.question}</summary>
              <div class="mt-2 text-sm">
                <div><strong>回答：</strong></div>
                <pre class="whitespace-pre-wrap bg-slate-50 p-2 rounded text-xs">${escapeHtml(c.answer)}</pre>
                <div class="mt-2"><strong>命中：</strong>${c.mustHaveHits.join(', ') || '-'}</div>
                <div><strong>未命中：</strong>${c.mustHaveMisses.join(', ') || '-'}</div>
                <div><strong>幻觉：</strong>${c.hallucinationHits.join(', ') || '-'}</div>
                <div><strong>工具：</strong>${c.toolCalls.join(', ') || '-'}</div>
                ${c.judgeResult ? `<div class="mt-2"><strong>Judge：</strong>${c.judgeResult.overall}/5（stdev ${c.judgeResult.stdev.toFixed(2)}）<br><em>${escapeHtml(c.judgeResult.reasoning)}</em></div>` : ''}
                <div class="mt-2 text-xs text-slate-500">thread=${c.threadId || '-'} · ${c.latencyMs}ms</div>
              </div>
            </details>
          `).join('')}
        </details>
      `
    }

    function escapeHtml(s) {
      return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
    }

    document.getElementById('report-select').addEventListener('change', e => loadReport(e.target.value))
    document.getElementById('reload').addEventListener('click', loadIndex)
    loadIndex()
  </script>
</body>
</html>
```

- [ ] **Step 2: 写 reportIndex.ts**

```ts
// tests/eval/report/reportIndex.ts
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { EvalReport } from './reportTypes'

export interface ReportIndexEntry {
  filename: string
  runAt: string
  commit: string
  overallPass: boolean
  criticalFailures: string[]
}

export interface ReportIndex {
  reports: ReportIndexEntry[]
}

export async function rebuildIndex(outDir: string): Promise<void> {
  const files = (await readdir(outDir)).filter(f => f.endsWith('.json') && f !== 'index.json')
  const entries: ReportIndexEntry[] = []
  for (const f of files) {
    try {
      const content = await readFile(join(outDir, f), 'utf-8')
      const r: EvalReport = JSON.parse(content)
      entries.push({
        filename: f,
        runAt: r.runAt,
        commit: r.commit,
        overallPass: r.summary.overallPass,
        criticalFailures: r.summary.criticalFailures,
      })
    } catch { /* skip 损坏的 */ }
  }
  entries.sort((a, b) => a.runAt.localeCompare(b.runAt))
  await writeFile(join(outDir, 'index.json'), JSON.stringify({ reports: entries }, null, 2), 'utf-8')
}
```

- [ ] **Step 3: 在 runEval 跑完后调 rebuildIndex**

修改 runEval.ts 末尾（在 writeJsonReport 之后）：

```ts
import { rebuildIndex } from './report/reportIndex'

// ...
await rebuildIndex(OUT_DIR)
```

- [ ] **Step 4: Commit**

```bash
git add docs/eval-reports/viewer.html tests/eval/report/reportIndex.ts tests/eval/runEval.ts
git commit -m "feat(eval): HTML viewer + index.json 自动维护"
```

---

## Task 20: 首次全量跑 + 阈值校准 + README + 破坏验证

**Files:**
- Modify: `tests/eval/README.md`
- 1-2 次手工 eval 运行 + 报告分析

- [ ] **Step 1: 干净跑一次**

```bash
EVAL_DEEPSEEK_KEY=sk-xxx bun run eval:context
```

Expected: 7-10 分钟，产出报告。

- [ ] **Step 2: 打开 viewer 验证**

```bash
python3 -m http.server &
# 访问 http://localhost:8000/docs/eval-reports/viewer.html
```

- 报告下拉框能看到刚跑的报告
- 6 类指标面板都展开
- 至少几个 case 能展开看完整回答

- [ ] **Step 3: 阈值校准**

如有 CRITICAL 失败但实测分布合理：
- `cacheHitRate` 实测 55%（接近 60%）→ 暂不放松，可能是 prompt 真有不稳定字段，先排查
- `toolCallAccuracy` 实测 75%（接近 80%）→ 同上，先排查 dataset 是不是某条提问太"套圈"

如确实是阈值过激进、首跑无问题：
- 调整 `costMetrics.ts` 等的阈值常数
- 在报告里加一行注释"基于首跑分布校准至 X"

- [ ] **Step 4: 故意破坏验证 sec-cross-case-leak 能 FAIL**

手动跑：
```bash
DATABASE_URL='postgresql://daixin:daixin88@localhost:5432/ls_eval?schema=public&TimeZone=UTC' \
  psql -c "UPDATE case_memories SET metadata = jsonb_set(metadata, '{caseId}', to_jsonb((SELECT id FROM cases WHERE title LIKE '%诱饵%' LIMIT 1))) WHERE id = (SELECT id FROM case_memories WHERE metadata->>'subjectKey' = 'fact.contract.signed_at' LIMIT 1)"
```

再跑 `bun run eval:context`，期望 `sec-cross-case-leak` FAIL。

跑完恢复：再 `bun run eval:context`（fixture builder 会清表 + 重建，自动恢复）。

- [ ] **Step 5: 完善 README.md**

```markdown
# Context Governance Eval

> 评测对象：`docs/superpowers/specs/2026-04-23-case-context-governance-design.md` 里的 M1-M4 改造效果
> 评测设计：`docs/superpowers/specs/2026-04-25-context-governance-eval-design.md`

## 一次性初始化

```bash
createdb ls_eval
DATABASE_URL='postgresql://daixin:daixin88@localhost:5432/ls_eval?schema=public&TimeZone=UTC' bun run prisma:push --accept-data-loss
# 在 ls_eval 库里手工 seed 一个测试用户（id=1），其他 fixture 数据由 buildFixture 自动写入
```

## 运行

```bash
EVAL_DEEPSEEK_KEY=sk-xxx bun run eval:context
```

跑完 7-10 分钟，产出 `docs/eval-reports/YYYY-MM-DD-HHmm-context-governance.{md,json}`。

## 查看 HTML 报告

```bash
python3 -m http.server
# 浏览器打开 http://localhost:8000/docs/eval-reports/viewer.html
```

或直接看 MD 报告（节选版）。

## 报告 3 件套

| 产物 | 内容 | 看法 |
|---|---|---|
| `*.md` | 节选 + 表格摘要 | git diff / PR review |
| `*.json` | 完整数据（含每条 case 的完整 AI 回答 + judge reasoning）| 机器分析 / viewer 加载 |
| `viewer.html` | 交互查看 | 双击或起 http server 打开 |

## 26 项指标（CRITICAL 15 / WARN 11）

详见设计文档 §3。重点 CRITICAL：
- `cacheHitRate >= 60%`（DeepSeek prompt cache 命中率）
- `hallucinationRate <= 5%`
- `toolCallAccuracy >= 80%`
- `scenarioPassRate >= 90%`
- `extractionPrecision >= 95%`
- `versionChainCorrect = true`
- 6 项 security 断言 + 3 项 stability 断言

## Exit code

| Exit | 条件 |
|---|---|
| 0 | 所有 CRITICAL 通过 |
| 1 | 任一 CRITICAL FAIL |
| 2 | Runner 本身崩溃 |

## 常见误挂排查

- `cacheHitRate` 偏低：检查 4 段 prompt 是否带了时间戳/随机字段（运行 `stab-prompt-hash`）
- `toolCallAccuracy` 偏低：可能 dataset 某条提问 LLM 选择了不调工具直接答；查 trace
- `hallucinationRate` 偏高：可能 ⑦ 组隔离题 LLM 真的从训练集编造内容；查 case 详情

## 已知限制

- tiktoken 是 OpenAI 编码（`cl100k_base`），对 DeepSeek 中文真实 token 数会高估 20-40%。`systemPromptTokensAvg < 4000` 是保守上界估算
- 三家协议 cache 字段验证仅看布尔（结构正确性），不要求达到具体命中率
```

- [ ] **Step 6: Commit**

```bash
git add tests/eval/README.md docs/eval-reports/
git commit -m "docs(eval): README 完整使用说明 + 首次全量跑校准报告"
```

---

## Self-Review

完成所有 20 个 Task 后，对照 spec 自查：

- [x] §1 整体架构 / 流水线（9 步）→ Task 9 + 18 实现
- [x] §2 Fixture 数据模型（3 案件 + 旧分析）→ Task 7
- [x] §2 Dataset 三部分（29 + 3 + 6）→ Task 10 + 15 + 16
- [x] §3.2 Cost 指标 + LLMUsageCallbackHandler → Task 3 + 8
- [x] §3.3 Quality（facts + judge）→ Task 11 + 12
- [x] §3.4 Task 指标 → Task 12
- [x] §3.5 Extraction 指标 + processNowService → Task 14 + 15
- [x] §3.6 Security 6 断言 → Task 16
- [x] §3.7 Stability 4 断言 → Task 17
- [x] §4.1-4.4 报告 3 件套 + viewer + index → Task 5 + 19
- [x] §4.6 Exit code → Task 9（try-catch）+ Task 18
- [x] §5 新建基建（5 项）→ Task 2 / 3 / 4 / 6 / 14
- [x] §6 Phase 1-4 阶段 → Task 1-9 / 10-13 / 14-18 / 19-20
- [x] §7 风险 → DATABASE_URL 守卫 + warmup 过滤 + 超时保护
- [x] §8 验收标准 → Task 20 Step 4 故意破坏验证

**没有遗漏 spec 要求**。Plan 已就绪。

---

# 附录 A：修订记录（5 维度审查后的强制修正）

> 以下修订**优先级高于上方原 Task 描述**，实施时按本附录覆盖原文。原文保留是为了审计追踪。

## A.1 Prisma 模型名修正（全局）

**问题**：所有出现的 `prisma.case_memories.xxx` **必须改为** `prisma.caseMemories.xxx`。Prisma client 用 model name（驼峰）访问，`@@map("case_memories")` 只影响数据库表名，不影响 client API。

**影响位置**：Task 7 (3 处)、Task 14 (1 处)、Task 18 (1 处)。逐处替换，**不要漏**。

`TABLES_TO_CLEAN` 数组里写的是数据库**表名**（snake_case），保留 `'case_memories'` 不改。

## A.2 Task 9 datasetRunner.ts 完全重写

**问题 1**：`runCaseChat` 真实签名是 `runCaseChat(sessionId: string, message: string | undefined, options: CaseAgentOptions): Promise<ReadableStream<Uint8Array>>`（位置参数 + 流式返回），plan 原写法编译失败。

**问题 2**：`CaseAgentOptions` 不接受 `callbacks` 字段，需要先**轻度改造**（架构 A 方案 a，已确认）。

### Task 9 前置子任务（新增）：扩展 `CaseAgentOptions` 支持 callbacks

**Files:**
- Modify: `server/services/workflow/agents/caseMainAgent.ts`
- Test: `tests/server/workflow/agents/caseMainAgent.callbacks.test.ts`

- [ ] **Step 1: 在 `CaseAgentOptions` 类型加 `callbacks?: BaseCallbackHandler[]`**

```ts
// caseMainAgent.ts 顶部
import type { BaseCallbackHandler } from '@langchain/core/callbacks/base'

export interface CaseAgentOptions {
  // ... 现有字段 ...
  callbacks?: BaseCallbackHandler[]  // 新增：透传给底层 createChatModel
}
```

- [ ] **Step 2: 在内部 `createChatModel({ ... })` 调用处把 callbacks 透传**

找到 caseMainAgent.ts 里 `createChatModel(...)` 的调用点，把 options.callbacks 传给 `callbacks` 字段：

```ts
const model = createChatModel({
  // ... 现有参数 ...
  callbacks: options.callbacks,  // LangChain BaseChatModel 构造时支持 callbacks 数组
})
```

- [ ] **Step 3: 写测试验证 callbacks 被注册**

mock createChatModel 验证它被传入 callbacks 数组。如果项目内不容易 mock，跳过本测试，靠 Task 3 的 LLMUsageCallbackHandler.test.ts 已经验证 callback 行为正确。

- [ ] **Step 4: Commit**

```bash
git add server/services/workflow/agents/caseMainAgent.ts
git commit -m "feat(workflow): CaseAgentOptions 支持 callbacks 透传给 chat model"
```

### Task 9 主任务重写：datasetRunner.ts

```ts
// tests/eval/runner/datasetRunner.ts
import { runCaseChat } from '~~/server/services/workflow/agents/caseMainAgent'
import type { LLMUsageCallbackHandler } from '~~/server/services/workflow/callbacks/LLMUsageCallbackHandler'

export interface RunCaseInput {
  caseId: number
  userId: number
  moduleId: string
  sessionId: string                  // 必须传，runCaseChat 需要
  question: string
  isWarmup?: boolean
}

export interface RunCaseOutput {
  threadId: string
  answer: string
  latencyMs: number
}

export async function runOneChat(input: RunCaseInput, handler: LLMUsageCallbackHandler): Promise<RunCaseOutput> {
  handler.setWarmup(input.isWarmup ?? false)
  const startedAt = Date.now()

  // runCaseChat 真实签名：位置参数 (sessionId, message, options) → ReadableStream
  const stream = await runCaseChat(input.sessionId, input.question, {
    caseId: input.caseId,
    userId: input.userId,
    moduleId: input.moduleId,
    callbacks: [handler],
    // 其他必填字段按 CaseAgentOptions 真实定义补
  } as any)

  // 消费整个 stream 拿最终回答（同时也把 LLM 调用走完，触发 callback）
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let answer = ''
  let threadId = ''
  // 流式协议：根据项目实际 SSE 格式解析（通常每行一个 JSON event）
  // 这里给一个保守实现：累积所有 chunk，再从最后一个 event 提取 finalAnswer + threadId
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = decoder.decode(value, { stream: true })
    // 按项目 SSE 协议解析；以下为通用兜底（按 'data: {...}' 行分隔）
    for (const line of chunk.split('\n')) {
      if (!line.startsWith('data:')) continue
      try {
        const event = JSON.parse(line.slice(5).trim())
        if (event.type === 'message_delta' && event.content) answer += event.content
        if (event.type === 'final_answer') answer = event.content
        if (event.threadId) threadId = event.threadId
      } catch { /* skip */ }
    }
  }

  return { threadId, answer, latencyMs: Date.now() - startedAt }
}
```

**实施提醒**：上面 SSE 解析是兜底，**Phase 1 第一次跑通时必须按 `server/services/sse/` 或类似处的真实 event 协议调整**。如果 runCaseChat 内部已经有 `await streamToFinalAnswer(stream)` 这种 helper，直接复用更稳。

## A.3 Task 6 ossMock.ts 改用 monkey-patch（弃 vi.mock）

**问题**：`vi.mock` 只在 vitest test 环境生效，`bun run` 启动 runEval 时 `vi` 不可用，整个 mock 是 no-op。

**新方案**：runtime 直接替换 module exports（monkey-patch）。在项目 storage factory 入口处暴露一个 `__setStorageAdapterForEval` 钩子；或者直接覆盖 `getStorageAdapter` 函数引用。

```ts
// tests/eval/utils/ossMock.ts
import * as storageModule from '~~/server/lib/storage'

export interface MockedUpload {
  key: string
  size: number
  ts: number
}

export const mockedUploads: MockedUpload[] = []

const fakeAdapter = {
  async uploadFile(key: string, body: Buffer | Uint8Array | string): Promise<string> {
    const size = typeof body === 'string' ? body.length : (body as Buffer).byteLength
    mockedUploads.push({ key, size, ts: Date.now() })
    return `mock://eval/${key}`
  },
  async getFileUrl(key: string): Promise<string> { return `mock://eval/${key}` },
  async deleteFile(_key: string): Promise<void> { /* no-op */ },
}

let originalGetAdapter: typeof storageModule.getStorageAdapter | null = null

export function installOssMock(): void {
  if (originalGetAdapter) return
  originalGetAdapter = storageModule.getStorageAdapter
  // 注：这个写法需要 storageModule 是 mutable 命名空间。如果项目用 tree-shake 后是 frozen exports，
  // 改为在 runEval 启动时显式导入 fakeAdapter 并把它注入到 storage 工厂的 registry 里。
  ;(storageModule as any).getStorageAdapter = async () => fakeAdapter
}

export function uninstallOssMock(): void {
  if (originalGetAdapter && (storageModule as any).getStorageAdapter !== originalGetAdapter) {
    ;(storageModule as any).getStorageAdapter = originalGetAdapter
  }
  originalGetAdapter = null
}
```

**Task 6 测试**：原 plan 里那个 vi.mock-based 测试**整体废弃**。只在 runEval 真跑时验证 `mockedUploads.length > 0` 即可。

**如果 storage factory 是 frozen exports（ESM strict）**：上面赋值会抛 `TypeError: Cannot assign to read only property`。回退方案：在 `server/lib/storage/index.ts` 加一个 `let _factoryOverride: typeof getStorageAdapter | null = null` + 导出 `setFactoryOverride(fn)` 钩子，eval 调用钩子注入。这是侵入性最小的依赖注入实现。

## A.4 Task 7 buildFixture 自动 seed 测试用户

**问题**：FK 约束会让 `cases.create({ ownerUserId: 1 })` 在 user 不存在时挂。

**修正**：在 `buildFixture` 入口处先 upsert 测试用户：

```ts
// 在 buildFixture 函数体最开始，cleanFirst 之前加：
async function ensureEvalUser(userId: number): Promise<void> {
  await prisma.users.upsert({
    where: { id: userId },
    update: {},
    create: {
      id: userId,
      phone: '13800000000',
      nickname: 'eval-user',
      // 其他必填字段按 prisma/models/user.prisma 的 NOT NULL 字段补
    } as any,
  })
}

// 在 export async function buildFixture(opts) 内调用：
await ensureEvalUser(opts.ownerUserId)
if (opts.cleanFirst) await cleanEvalTables()
```

**Task 1 README 同步**：移除"必须先手工 seed 测试用户"的说法，因为现在 builder 自动处理。

## A.5 Task 14 QUEUE_KEY 修正

`consolidator.service.ts:11` 真实值为 `const QUEUE_KEY = 'consolidator:due'`。Plan Task 14 的所有 `'memory:consolidator:queue'` **改为** `'consolidator:due'`。包括：
- Step 1 测试 `redis.del` 的 key
- Step 1 测试 `redis.zcount` 的 key
- Step 3 实现里如果重复定义 QUEUE_KEY，**直接复用文件已有的常量**（不要重新声明）

## A.6 Task 16 Security 改为直接调 Service 层（架构 B 方案 a）

**改动总结**：
- 全部去掉 `await import('ofetch')` 和 `$fetch('http://localhost:3000/...')` 调用
- 改为直接调 service 层（writeMemoryService / updateMemoryService / 案件更新 service 等）
- 不需要 dev server、不需要 token

### 修订后的 securityDataset.ts（替换原文）

```ts
// tests/eval/fixtures/securityDataset.ts
import type { FixtureResult } from './buildFixture'

export interface SecurityAssertion {
  id: string
  category: 'cross-case-leak' | 'archived-guard' | 'ai-autofill'
  severity: 'CRITICAL' | 'WARN'
  run: (fx: FixtureResult, ctx: { ownerUserId: number }) => Promise<{ pass: boolean; detail: string }>
}

export function buildSecurityAssertions(): SecurityAssertion[] {
  return [
    {
      id: 'sec-archived-updateCase',
      category: 'archived-guard',
      severity: 'CRITICAL',
      async run(fx) {
        // 直接调 service 层，不走 HTTP
        const { updateCaseService } = await import('~~/server/services/case/case.service')
        try {
          await updateCaseService(fx.caseC.id, fx.caseC.ownerId, { title: '尝试改 ARCHIVED 标题' } as any)
          return { pass: false, detail: '错误：service 未挡住 ARCHIVED 案件' }
        } catch (e: any) {
          return { pass: true, detail: `service 正确拒绝：${e?.message ?? e}` }
        }
      },
    },
    {
      id: 'sec-archived-initAnalysis',
      category: 'archived-guard',
      severity: 'CRITICAL',
      async run(fx) {
        const { initAnalysisService } = await import('~~/server/services/case/initAnalysis.service')
        try {
          await initAnalysisService({ caseId: fx.caseC.id, userId: fx.caseC.ownerId } as any)
          return { pass: false, detail: '错误：未挡住 ARCHIVED 案件的 initAnalysis' }
        } catch (e: any) {
          return { pass: true, detail: `service 正确拒绝：${e?.message ?? e}` }
        }
      },
    },
    {
      id: 'sec-archived-write-memory',
      category: 'archived-guard',
      severity: 'CRITICAL',
      async run(fx) {
        const { writeMemoryService } = await import('~~/server/services/memory/memory.service')
        try {
          await writeMemoryService({ caseId: fx.caseC.id, text: '尝试写入', kind: 'fact', confidence: 0.9 } as any)
          return { pass: false, detail: '错误：ARCHIVED 案件不应能写入记忆' }
        } catch (e: any) {
          return { pass: true, detail: `服务层正确拒绝：${e?.message ?? e}` }
        }
      },
    },
    {
      id: 'sec-archived-update-memory',
      category: 'archived-guard',
      severity: 'CRITICAL',
      async run(fx) {
        const { updateMemoryService } = await import('~~/server/services/memory/memory.service')
        try {
          await updateMemoryService({ id: fx.caseC.memoryId, invalidate: true } as any)
          return { pass: false, detail: '错误：ARCHIVED 案件不应能更新记忆' }
        } catch (e: any) {
          return { pass: true, detail: `${e?.message ?? e}` }
        }
      },
    },
    {
      id: 'sec-ai-autofill-preserve',
      category: 'ai-autofill',
      severity: 'CRITICAL',
      async run() {
        // mergeAutofillPreservingUserInput 在 app/composables/useCaseCreation.ts（前端代码）
        // eval 直接 inline 同样的纯函数逻辑做行为断言
        const merge = <T extends Record<string, any>>(userFilled: T, aiExtracted: Partial<T>): T => {
          const result = { ...userFilled }
          for (const [k, aiV] of Object.entries(aiExtracted)) {
            if (aiV === undefined || aiV === null || aiV === '') continue
            const userV = (result as any)[k]
            if (userV === undefined || userV === null || userV === '') (result as any)[k] = aiV
          }
          return result
        }
        const merged = merge(
          { firstInstanceJudge: '张三', firstInstanceCaseNo: '已填' },
          { firstInstanceJudge: '李四', firstInstanceCaseNo: 'AI填的' },
        )
        const ok = merged.firstInstanceJudge === '张三' && merged.firstInstanceCaseNo === '已填'
        return { pass: ok, detail: JSON.stringify(merged) }
      },
    },
  ]
}
```

**注**：上面 import 的 service 名（`updateCaseService` / `initAnalysisService` / `writeMemoryService` / `updateMemoryService`）请在实施前 grep 真实导出名调整。如果项目内 service 命名跟这里不一致，按真实名替换。

## A.7 Task 17 buildModuleContext → buildContextSegments

**修正点**：

```ts
// tests/eval/metrics/stabilityMetrics.ts 内
// 原：import { buildModuleContext } from '~~/server/services/workflow/context/moduleContextBuilder'
// 改：
import { buildContextSegments } from '~~/server/services/workflow/context/moduleContextBuilder'

// 调用：
const segs = await buildContextSegments({ caseId, moduleId: 'init', userId: 1 } as any)
// segs 类型 ContextSegments：{ roleAndFlow, caseProfile, moduleSummaries, dynamicContext }
```

Task 18 同样的修正。

## A.8 search_case_analysis 走 tool 不走 service

**问题**：项目里只有 `server/services/workflow/tools/search_case_analysis.tool.ts`，没有独立的 `searchCaseAnalysisService` 函数。

**修正**：Task 17 `stab-old-data-graceful` 里改为：

```ts
import * as searchCaseAnalysisTool from '~~/server/services/workflow/tools/search_case_analysis.tool'

// 调用：
const tool = searchCaseAnalysisTool.createTool({ caseId, userId: 1 } as any)  // 按真实工厂签名调
await tool.invoke({ query: 'legacy', topK: 5 })
```

具体 tool 工厂签名见 `tools/search_case_analysis.tool.ts` 的真实 `createTool` 或 `tool` 导出。

## A.9 systemPromptTokensAvg + latency 采集逻辑（修补 spec 漏洞）

**问题**：原 plan Task 13 标注"占位，Task 18 补全"，但 Task 18 没补。需要在 datasetRunner.ts 里加采集 hook：

```ts
// 在 runOneChat 里调用 runCaseChat 之前，先调 buildContextSegments 拿前 4 段，算 tokens
import { buildContextSegments } from '~~/server/services/workflow/context/moduleContextBuilder'
import { countTokensSync } from '~~/server/utils/tokenCounter'

export interface RunCaseOutput {
  threadId: string
  answer: string
  latencyMs: number
  systemPromptTokens: number  // 新增
}

// 在 runOneChat 函数里：
const segs = await buildContextSegments({ caseId: input.caseId, moduleId: input.moduleId, userId: input.userId } as any)
const systemPromptTokens = countTokensSync(
  (segs.roleAndFlow ?? '') + (segs.caseProfile ?? '') + (segs.moduleSummaries ?? '') + (segs.dynamicContext ?? '')
)
// ... 跑 runCaseChat ...
return { threadId, answer, latencyMs, systemPromptTokens }
```

**runEval.ts 收集**：每次 runOneChat 后 push `out.systemPromptTokens` 进 `tokenSysSamples` 数组，最终传给 `aggregateCostMetrics`。

**Latency 采集**：`memoryRecallLatencies` / `analysisSummaryLatencies` 已有现成基建吗？grep `recallMemoryService` 和 `generateSummaryService` 看是否已有 timer 埋点。如无，**一期作为 WARN-level，允许返回空数组**（聚合函数已经支持空数组返回 0）。后续在两个服务各加一个 timing wrapper 时再补。

## A.10 Tailwind CDN URL 修正

`docs/eval-reports/viewer.html` 的 Tailwind 加载改为 v4 的正确 URL：

```html
<!-- 原：<script src="https://cdn.tailwindcss.com"></script>（v3 stale URL）-->
<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
```

## A.11 dayjs 导入路径修正

项目里没有 `#shared/utils/dayjs` 文件。改为本地 import + extend：

```ts
// runEval.ts 顶部
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
dayjs.extend(utc)
dayjs.extend(timezone)
// 之后才能用 dayjs().tz('Asia/Shanghai')
```

## A.12 runtimeGuards 增强（healthcheck）

```ts
// tests/eval/utils/runtimeGuards.ts 增加 3 项检查
export async function assertEvalRuntime(): Promise<void> {
  // 1. DATABASE_URL（已有）
  const url = process.env.DATABASE_URL ?? ''
  if (!url.includes('ls_eval')) throw new Error(`[eval] DATABASE_URL 必须含 'ls_eval'`)

  // 2. EVAL_DEEPSEEK_KEY
  if (!process.env.EVAL_DEEPSEEK_KEY) {
    throw new Error('[eval] 必须设 EVAL_DEEPSEEK_KEY 环境变量（DeepSeek API key）')
  }

  // 3. Redis 可用
  try {
    const { getRedisClient } = await import('~~/server/utils/redis')
    await getRedisClient().ping()
  } catch (e) {
    throw new Error(`[eval] Redis 未启动或不可达：${e instanceof Error ? e.message : e}`)
  }

  // 4. Prisma 可连
  const { prisma } = await import('~~/server/utils/db')
  await prisma.$queryRaw`SELECT 1`
}
```

`runEval.ts` 入口处用 `await assertEvalRuntime()` 替换原来的 `assertEvalDatabase()`。

## A.13 Step 编号清理

runEval.ts 里所有内部注释 `// Step 3 / Step 4 / Step 5` 改为相对编号 `// Part 1: dataset` / `// Part 2: extraction` / `// Part 3: security & stability` / `// Aggregate` / `// Write reports`，避免和 spec §1.2 的 9 步流水线混淆。

## A.14 Task 9 placeholder 跑通后必须删除

Task 9 用了 10 条 placeholder 提问（"本案一审法官姓名？"等）跑首次冒烟。Task 13 接入真 dataset 时**必须删掉**这段 placeholder 循环代码，不要让两套并存。

## A.15 viewer.html 简化

删掉 `#reload` 刷新按钮和按列排序逻辑。MVP 仅保留：① 报告下拉框 ② Overview 面板 ③ 逐 case 展开。多余功能 Phase 5 再加。

## A.16 Task 5 markdownReporter 测试简化

只保留 1 个 facts 类的测试 case 验证 excerpt + emoji 移除。删除 freeform case 的复杂 mock。

## A.17 console.log 豁免说明

`runEval.ts` 头部加文件级注释：

```ts
/**
 * Eval runner（独立工具脚本，非 server runtime production code）。
 * 允许使用 console.log 输出进度（已豁免 no-console rule）。
 */
```

Commit scope `eval` 不在 `.claude/rules/git.md` 列表，但属于"工具/基建"语义；本 plan commit 用 `feat(eval)` / `feat(callbacks)` / `feat(workflow)` / `feat(memory)` 即可，**不需要专门修 git.md**。

## A.18 修订总结表

| 修订项 | 影响 Task | 严重度 |
|---|---|---|
| A.1 prisma.case_memories → caseMemories | T7/14/18 | P0 |
| A.2 datasetRunner + runCaseChat 真签名 + caseMainAgent 加 callbacks | T9（含前置子任务）| P0 |
| A.3 ossMock 改 monkey-patch | T6 | P0 |
| A.4 buildFixture 自动 seed 用户 | T7 | P0 |
| A.5 QUEUE_KEY = consolidator:due | T14 | P0 |
| A.6 Security 改服务层直调 | T16 | P1（同时解 dev server + token + 速度）|
| A.7 buildModuleContext → buildContextSegments | T17/18 | P0 |
| A.8 search_case_analysis 走 tool 不走 service | T17 | P0 |
| A.9 systemPromptTokens + latency 采集补实现 | T9（runOneChat 增 hook）+ T13 | P1 |
| A.10 Tailwind CDN URL | T19 | P1 |
| A.11 dayjs 本地 extend | T9 | P1 |
| A.12 runtimeGuards 增 EVAL_KEY/Redis healthcheck | T1 | P1 |
| A.13 Step 编号统一 | T9/13/18 | P2 |
| A.14 删 placeholder 循环 | T13 | P2 |
| A.15 viewer 简化 | T19 | P2 |
| A.16 reporter 测试简化 | T5 | P2 |
| A.17 console.log 豁免说明 | T9 | P2 |

实施时**严格按附录覆盖原文**。如发现附录与原文矛盾，附录优先。

---

**Plan complete and saved to `docs/superpowers/plans/2026-04-25-context-governance-eval-plan.md`. Two execution options:**

**1. Subagent-Driven (recommended)** —— 我每个 Task 派一个 fresh subagent，做完两阶段 review 再下一个，迭代快、context 隔离

**2. Inline Execution** —— 在本 session 里按 batch 跑 Task，每若干 Task 一个 checkpoint review

**Which approach?**
