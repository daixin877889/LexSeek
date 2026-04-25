# 上下文机制评测基建 实施计划 v2（清理版）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

> **本文档替代 v1**（`2026-04-25-context-governance-eval-plan.md`）。v1 保留供审计追踪，**实施请以 v2 为准**。修订原因：v1 含错误代码块 + 双层结构（Task 原文 + 附录 A）易混淆，v2 已合并修订到 Task 原文，单一信源。

**Goal:** 在 `tests/eval/` 下造一个独立于 vitest 的端到端评测框架，手动 `bun run eval:context` 触发，对 M1-M4 改造给 26 项指标的通过/不通过结论 + MD/JSON/HTML 三件套报告。

**Architecture:**
- Eval 跑在独立 PostgreSQL 库 `ls_eval` + 独立 Redis db=15（防污染生产 consolidator 队列）
- LLM usage 通过新建 `LLMUsageCallbackHandler` 从 LangChain `response_metadata.usage` 抓 DeepSeek 原始 cache 字段
- Cost 串行跑 29 提问 + 3 段 transcript + 6 安全 + 4 稳定断言；并发=1 保证 cache 对齐
- Quality 走 facts 字符串匹配 + DeepSeek-as-judge（每条 3 次取平均）
- Extraction 通过 consolidator 新增 `processNowService` 同步等待
- Security 直调 service 层（绕过 HTTP，避开 dev server + token 依赖）
- Stability 用 `buildContextSegments` 比 sha256 验证字节稳定

**Tech Stack:** Bun + TypeScript + Prisma + LangChain JS + js-tiktoken + DeepSeek API + ioredis + 静态 vanilla JS HTML viewer + Tailwind v4 Browser CDN

**关联文档：**
- 设计文档：`docs/superpowers/specs/2026-04-25-context-governance-eval-design.md`
- 评测对象：`docs/superpowers/specs/2026-04-23-case-context-governance-design.md`（M1-M4）

---

## 0. 关键架构决策（已锁定）

| 决策 | 选项 | 理由 |
|---|---|---|
| Redis 隔离 | **db=15 独立 + flushdb 清表** | 同实例不同 db，零侵入 consolidator 业务代码 |
| ARCHIVED 守卫缺失 | **保留断言原状，eval FAIL 算真实业务 bug** | 现状：`writeMemoryService` / `updateMemoryService` / `initAnalysisService` 缺 `isCaseReadOnly` 守卫（M3 spec §12 铁律），eval 跑出来 FAIL 是它的价值所在；修复属于独立工单 |
| LLM callback 注入 | **`CaseAgentOptions` 加 `callbacks` 字段** | LangChain 推荐方式，生产端也能复用线上 cache 监控 |
| Security HTTP vs Service | **service 直调** | 项目 ARCHIVED 守卫**应在** service 层（CLAUDE.md §5），HTTP 直调能验证业务规则，绕过 dev server + token 依赖 |
| 报告产出 | **MD 节选 + JSON 完整 + HTML viewer** 三件套，独立 reporter | 单一 JSON schema 演化时 MD/HTML 各自定制 |
| 测试位置 | colocation（紧邻被测代码）`tests/eval/utils/*.test.ts` | eval 是独立子系统，与 `tests/server/` 集中模式无冲突 |

---

## 1. 真实代码核对清单（实施前必读）

为避免 v1 在伪代码上踩坑，以下是关键依赖的**真实**代码事实（已 grep 验证）：

| 依赖 | 真实路径 / 签名 | 注意 |
|---|---|---|
| `runCaseChat` | `server/services/workflow/agents/caseMainAgent.ts:69`，签名 `(sessionId: string, message: string \| undefined, options: CaseAgentOptions & { command?: unknown }): Promise<ReadableStream<Uint8Array>>` | **位置参数 + 流式返回**，不是 `runCaseChat({...})` |
| `CaseAgentOptions` | 同文件，需在 Task 4 加 `callbacks?: BaseCallbackHandler[]` 字段 | |
| SSE 协议 | `server/services/sse/agentSseStream.ts:172-225`，**named events**：`event: values\ndata: {...}\n\n` / `event: messages\n...` / `event: custom\n...` | **不是** `data: {type: 'final_answer'}` |
| `buildContextSegments` | `server/services/workflow/context/moduleContextBuilder.ts:27`，签名 `Params = { caseId: number, agentName: string, userQuery: string, roleAndFlowTemplate?: string }` | **不是** `{caseId, moduleId, userId}`；内部跑向量召回，非纯函数 |
| Prisma model `caseMemories` | `prisma/models/case.prisma:303`，`model caseMemories { ... @@map("case_memories") }` | **client API 用 `prisma.caseMemories`**（驼峰）；表名（SQL 语句里）才用 snake_case |
| consolidator QUEUE_KEY | `server/services/memory/consolidator.service.ts:11`，`const QUEUE_KEY = 'consolidator:due'` | 复用文件已有常量，不重新声明 |
| `users` 表必填字段 | `prisma/models/user.prisma`：`name` (NOT NULL) + `phone` (NOT NULL unique) | upsert 必须含两者 |
| `mergeAutofillPreservingUserInput` | `app/composables/useCaseCreation.ts`（**前端**）| 服务端不可 import，eval 内联同样的 10 行纯函数 |
| `searchCaseAnalysisTool` | `server/services/workflow/tools/search_case_analysis.tool.ts` | 通过 import 整个 module 后取 `tool` 或 `createTool`（实施前 grep 真实导出名） |
| `isCaseReadOnly` | `shared/types/case.ts` 导出，仅 `case.service.ts:245` + `analysis.service.ts:180` 调用过 | **memory + initAnalysis 服务层缺守卫**（业务 bug） |
| `getStorageAdapter` | **不存在**。`server/lib/storage/index.ts` 导出 `StorageFactory` 类 | Task 6 通过给 factory 加 `setOverride` 钩子注入 mock |
| `getRedisClient` | `server/lib/redis.ts`（ioredis ^5.10.1，`lazyConnect: true`）| 支持 `.ping()` / `.select(15)` / `.flushdb()` |
| `ContextSegments` 字段 | 4 段：`roleAndFlow / caseProfile / moduleSummaries / dynamicContext`（不是 5 段） | spec 已修正用语 |

**别名 spike 前置 hard-gate**：Task 1 的 `bun run eval:context` 必须能解析 `~~/` 别名，否则**全 plan 后续 Task 阻塞**，需要提前回退到相对路径方案。

---

## 2. File Structure

```
tests/eval/
├── README.md
├── runEval.ts                              # 入口
├── utils/
│   ├── prng.ts                             # mulberry32 + UUID v4
│   ├── runtimeGuards.ts                    # DATABASE_URL/Redis/EVAL_KEY healthcheck + db=15 切换
│   ├── traceReader.ts                      # 从 agent_runs 读 tool_calls
│   ├── sseConsumer.ts                      # 真实 SSE named-event 协议消费
│   └── ossMock.ts                          # 通过 StorageFactory.setOverride 注入 fake adapter
├── fixtures/
│   ├── buildFixture.ts                     # 3 案件 + 旧分析（含 ensureEvalUser）
│   ├── testDataset.ts                      # 29 提问
│   ├── extractionDataset.ts                # 3 段 transcript
│   └── securityDataset.ts                  # 6 个独立断言（service 直调）
├── metrics/
│   ├── costMetrics.ts
│   ├── qualityMetrics.ts
│   ├── judgePrompt.ts
│   ├── judgeRunner.ts
│   ├── taskMetrics.ts
│   ├── extractionMetrics.ts
│   ├── securityMetrics.ts
│   └── stabilityMetrics.ts
├── runner/
│   └── datasetRunner.ts                    # runOneChat（含 SSE 消费 + token 采集）
└── report/
    ├── reportTypes.ts
    ├── jsonReporter.ts
    ├── markdownReporter.ts
    └── reportIndex.ts

server/services/workflow/callbacks/         # 新目录
└── LLMUsageCallbackHandler.ts

server/services/workflow/agents/caseMainAgent.ts  # 修改：CaseAgentOptions 加 callbacks
server/services/memory/consolidator.service.ts    # 修改：加 processNowService
server/lib/storage/factory.ts                     # 修改：加 setOverride 钩子（仅 eval 用）

docs/eval-reports/
├── viewer.html                             # 静态可视化（Tailwind v4 Browser CDN）
└── index.json                              # 报告索引
```

---

## 3. Task 顺序（不可交换）

```
Phase 1 骨架 + 基建（Task 1-9）：能跑出 cost-only 报告
Phase 2 Quality + Task 接入（Task 10-13）
Phase 3 Extraction + Security + Stability（Task 14-18）
Phase 4 Viewer + 校准 + README（Task 19-20）
```

**首跑预期**：Task 9 step 6 第一次 `bun run eval:context`，cacheHitRate 因冷启动可能 < 60% → exit 1 是预期，**不是 plan 故障**。Task 13 接入真 dataset 跑多模块多轮后才有意义。

---

## Task 1: 项目骨架 + ls_eval 库 + Redis db=15 + 别名 spike（前置 hard-gate）

**Files:**
- Create: `tests/eval/runEval.ts`（占位入口）
- Create: `tests/eval/utils/runtimeGuards.ts`
- Create: `tests/eval/README.md`（占位）
- Modify: `package.json:scripts`

- [ ] **Step 1: 目录骨架**

```bash
mkdir -p tests/eval/{utils,fixtures,metrics,runner,report}
mkdir -p server/services/workflow/callbacks
mkdir -p docs/eval-reports
```

- [ ] **Step 2: package.json 加 script**

```json
"eval:context": "DATABASE_URL='postgresql://daixin:daixin88@localhost:5432/ls_eval?schema=public&TimeZone=UTC' bun run tests/eval/runEval.ts"
```

- [ ] **Step 3: 实现 runtimeGuards.ts**

```ts
// tests/eval/utils/runtimeGuards.ts
import { prisma } from '~~/server/utils/db'
import { getRedisClient } from '~~/server/utils/redis'

export const EVAL_REDIS_DB = 15

export async function assertEvalRuntime(): Promise<void> {
  const url = process.env.DATABASE_URL ?? ''
  if (!url.includes('ls_eval')) {
    throw new Error(`[eval] DATABASE_URL 必须包含 'ls_eval'，当前疑似指向生产/测试库`)
  }

  if (!process.env.EVAL_DEEPSEEK_KEY) {
    throw new Error('[eval] 必须设环境变量 EVAL_DEEPSEEK_KEY（DeepSeek API key）')
  }

  // Redis 切换到 db=15 + 清空（隔离生产 consolidator 队列）
  const redis = getRedisClient()
  try {
    await Promise.race([
      redis.ping(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('redis ping timeout 3s')), 3000)),
    ])
  } catch (e) {
    throw new Error(`[eval] Redis 不可达：${e instanceof Error ? e.message : e}`)
  }
  await redis.select(EVAL_REDIS_DB)
  await redis.flushdb()

  // Prisma client 可连
  await prisma.$queryRaw`SELECT 1`
}
```

- [ ] **Step 4: runEval.ts 占位入口**

```ts
// tests/eval/runEval.ts
import { assertEvalRuntime } from './utils/runtimeGuards'

async function main() {
  await assertEvalRuntime()
  // eslint-disable-next-line no-console
  console.log('[eval] runtime guards passed: DB + Redis db=15 + EVAL_DEEPSEEK_KEY OK')
}

main().catch(err => {
  // eslint-disable-next-line no-console
  console.error('[eval] runner crashed', err)
  process.exit(2)
})
```

文件顶部加豁免注释：

```ts
/**
 * Eval runner（独立工具脚本，非 server runtime production code）。
 * 允许使用 console 输出进度（已豁免 no-console rule）。
 */
```

- [ ] **Step 5: 初始化 ls_eval 库**

```bash
createdb ls_eval
DATABASE_URL='postgresql://daixin:daixin88@localhost:5432/ls_eval?schema=public&TimeZone=UTC' bun run prisma:push --accept-data-loss
bun run prisma:generate  # 确保 client 已生成
```

Expected: `Database synchronized`。

- [ ] **Step 6: 别名 spike（hard-gate）**

```bash
bun run eval:context
```

Expected: 输出 `[eval] runtime guards passed: ...`。

**如果 bun 报 `Cannot resolve '~~/...'`** → 必须停下来，把 plan 后续所有 `~~/` import 改成相对路径再继续。这是 hard-gate，不要往下走。

- [ ] **Step 7: 写 README.md 占位**

```markdown
# Context Governance Eval

> 设计：`docs/superpowers/specs/2026-04-25-context-governance-eval-design.md`
> 评测对象：`docs/superpowers/specs/2026-04-23-case-context-governance-design.md`

## 一次性初始化

```bash
createdb ls_eval
DATABASE_URL='postgresql://daixin:daixin88@localhost:5432/ls_eval?schema=public&TimeZone=UTC' bun run prisma:push --accept-data-loss
bun run prisma:generate
# 注：测试用户由 buildFixture 在第一次跑时自动 upsert（id=1, name='eval-user', phone='13800000000'）
# 无需手工 seed
```

## 运行

```bash
EVAL_DEEPSEEK_KEY=sk-xxx bun run eval:context
```

依赖：
- PostgreSQL `ls_eval` 库（独立于 ls_new / ls_new_testing）
- Redis 实例可达（自动切到 db=15，与生产 db=0 隔离，跑前 flushdb）
- 环境变量 `EVAL_DEEPSEEK_KEY`

## 首跑预期

第一次 `bun run eval:context` 通常 exit 1（cacheHitRate 冷启动远低于 60%）。这是预期行为，**不是 plan 故障**。等接入真 dataset、跑多模块多轮后命中率才会到位。
```

- [ ] **Step 8: Commit**

```bash
git add tests/eval/runEval.ts tests/eval/utils/runtimeGuards.ts tests/eval/README.md package.json
git commit -m "feat(eval): 骨架 + ls_eval 库 + Redis db=15 隔离 + 别名 spike"
```

---

## Task 2: utils/prng.ts mulberry32

**Files:**
- Create: `tests/eval/utils/prng.ts`
- Test: `tests/eval/utils/prng.test.ts`

- [ ] **Step 1: 写测试**（同 v1 Task 2，确定性 + UUID v4 格式）

```ts
import { describe, it, expect } from 'vitest'
import { mulberry32, generateUuidV4 } from './prng'

describe('mulberry32', () => {
  it('同 seed 输出确定序列', () => {
    const seq1 = Array.from({ length: 10 }, () => mulberry32(42)())
    const seq2 = Array.from({ length: 10 }, () => mulberry32(42)())
    // 注：每次 mulberry32(42) 都返回新 closure，第一次调用值相同
    const r1 = mulberry32(42); const v1 = [r1(), r1(), r1()]
    const r2 = mulberry32(42); const v2 = [r2(), r2(), r2()]
    expect(v1).toEqual(v2)
  })

  it('值域 [0, 1)', () => {
    const r = mulberry32(7)
    for (let i = 0; i < 100; i++) {
      const v = r()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

describe('generateUuidV4', () => {
  it('UUID v4 格式', () => {
    const r = mulberry32(1)
    expect(generateUuidV4(r)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('同 PRNG 状态产同 UUID', () => {
    const r1 = mulberry32(42); const r2 = mulberry32(42)
    expect(generateUuidV4(r1)).toBe(generateUuidV4(r2))
  })
})
```

- [ ] **Step 2: 运行测试确认失败**：`npx vitest run tests/eval/utils/prng.test.ts`

- [ ] **Step 3: 实现**（与 v1 完全一致，复用 v1 Task 2 Step 3 代码）

- [ ] **Step 4: 测试通过 + Commit**

```bash
git add tests/eval/utils/prng.ts tests/eval/utils/prng.test.ts
git commit -m "feat(eval): mulberry32 PRNG + UUID v4 生成"
```

---

## Task 3: 新建 LLMUsageCallbackHandler

> v1 Task 3 大部分正确，本 v2 仅修正几点：① `_llm: Serialized` 类型标注；② `setWarmup` 已正确。

**Files:**
- Create: `server/services/workflow/callbacks/LLMUsageCallbackHandler.ts`
- Test: `tests/server/workflow/callbacks/LLMUsageCallbackHandler.test.ts`

按 v1 Task 3 实施，**唯一改动**：handler 的 `handleLLMStart(_llm, _prompts, runId)` 类型 `_llm: Serialized` 而非 `unknown`：

```ts
import type { Serialized } from '@langchain/core/load/serializable'

// ...
async handleLLMStart(_llm: Serialized, _prompts: string[], runId: string): Promise<void> {
  this.startTimes.set(runId, Date.now())
}
```

其余照抄 v1 Task 3。

```bash
git commit -m "feat(callbacks): LLMUsageCallbackHandler 抓供应商原始 cache 字段"
```

---

## Task 4: CaseAgentOptions 加 callbacks 字段（前置子任务）

**Files:**
- Modify: `server/services/workflow/agents/caseMainAgent.ts`

- [ ] **Step 1: 加字段**

```ts
// caseMainAgent.ts 顶部 import
import type { BaseCallbackHandler } from '@langchain/core/callbacks/base'

// CaseAgentOptions interface 加：
export interface CaseAgentOptions {
  // ... 现有字段保持 ...
  callbacks?: BaseCallbackHandler[]  // 新增：透传给底层 createChatModel
}
```

- [ ] **Step 2: 在内部 createChatModel 调用处透传**

找到 caseMainAgent.ts 里 `createChatModel({ ... })` 的所有调用点（grep `createChatModel(` in this file），在 config 对象里加：

```ts
const model = createChatModel({
  // ... 现有参数 ...
  callbacks: options?.callbacks,  // 新增
})
```

LangChain `BaseChatModel` 构造时 `callbacks` 会自动注册，handleLLMStart/End 在调用 `.invoke()` / `.stream()` 时自动触发。

- [ ] **Step 3: 类型检查**

```bash
npx nuxi typecheck 2>&1 | grep -E "caseMainAgent|callback" | head -20
```

Expected: 无错误（或只有原有错误，无新增）。

- [ ] **Step 4: Commit**

```bash
git add server/services/workflow/agents/caseMainAgent.ts
git commit -m "feat(workflow): CaseAgentOptions 支持 callbacks 透传给 chat model"
```

---

## Task 5: utils/traceReader.ts

按 v1 Task 4 实施（v1 这里没问题），文件路径 `tests/eval/utils/traceReader.ts`。

```bash
git commit -m "feat(eval): traceReader 从 agent_runs 解析 tool_calls"
```

---

## Task 6: utils/sseConsumer.ts —— 真实 SSE named-event 协议消费

**Files:**
- Create: `tests/eval/utils/sseConsumer.ts`
- Test: `tests/eval/utils/sseConsumer.test.ts`

- [ ] **Step 1: 写测试**

```ts
// tests/eval/utils/sseConsumer.test.ts
import { describe, it, expect } from 'vitest'
import { consumeAgentSseStream } from './sseConsumer'

function streamFromString(s: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(s))
      controller.close()
    },
  })
}

describe('consumeAgentSseStream', () => {
  it('解析 named events 提取最终 AI message', async () => {
    const sse = [
      'event: messages',
      'data: {"role":"assistant","content":"hello"}',
      '',
      'event: values',
      'data: {"messages":[{"role":"user","content":"hi"},{"role":"assistant","content":"final answer 内容"}]}',
      '',
      'event: custom',
      'data: {"threadId":"thread-abc","status":"ok"}',
      '',
    ].join('\n')

    const result = await consumeAgentSseStream(streamFromString(sse))
    expect(result.finalAnswer).toBe('final answer 内容')
    expect(result.threadId).toBe('thread-abc')
  })

  it('多个 values event 取最后一个的最后 AI message', async () => {
    const sse = [
      'event: values',
      'data: {"messages":[{"role":"assistant","content":"中间答案"}]}',
      '',
      'event: values',
      'data: {"messages":[{"role":"user","content":"q"},{"role":"assistant","content":"最终答案"}]}',
      '',
    ].join('\n')
    const result = await consumeAgentSseStream(streamFromString(sse))
    expect(result.finalAnswer).toBe('最终答案')
  })

  it('空流返回空字符串', async () => {
    const result = await consumeAgentSseStream(streamFromString(''))
    expect(result.finalAnswer).toBe('')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

- [ ] **Step 3: 实现**

```ts
// tests/eval/utils/sseConsumer.ts

export interface SseConsumeResult {
  finalAnswer: string
  threadId: string
  rawEvents: { event: string; data: any }[]
}

/**
 * 消费项目内 agentSseStream 输出的 named-event SSE 流。
 *
 * 协议（参考 server/services/sse/agentSseStream.ts:172-225）：
 *   event: <name>\n
 *   data: <json>\n
 *   \n
 *
 * 已知 event 名：values（含 messages 数组）/ messages（增量消息）/ custom（自定义元数据，含 threadId）/ updates 等。
 * finalAnswer 取最后一个 `event: values` 的 messages 数组里最后一条 role='assistant' 的 content。
 */
export async function consumeAgentSseStream(stream: ReadableStream<Uint8Array>): Promise<SseConsumeResult> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  const events: { event: string; data: any }[] = []
  let threadId = ''

  // 解析 buf，按 \n\n 分组
  const flush = () => {
    while (buf.includes('\n\n')) {
      const idx = buf.indexOf('\n\n')
      const chunk = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      const lines = chunk.split('\n')
      let event = ''
      let data = ''
      for (const ln of lines) {
        if (ln.startsWith('event:')) event = ln.slice(6).trim()
        else if (ln.startsWith('data:')) data = ln.slice(5).trim()
      }
      if (!event && !data) continue
      try {
        const parsed = data ? JSON.parse(data) : null
        events.push({ event, data: parsed })
        if (parsed?.threadId) threadId = parsed.threadId
      } catch { /* skip 解析错的 */ }
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    flush()
  }
  buf += decoder.decode()  // 收尾
  if (!buf.endsWith('\n\n')) buf += '\n\n'
  flush()

  // 取最后一个 values event 的最后一条 assistant 消息
  let finalAnswer = ''
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].event !== 'values') continue
    const messages = events[i].data?.messages
    if (!Array.isArray(messages)) continue
    for (let j = messages.length - 1; j >= 0; j--) {
      const m = messages[j]
      if (m?.role === 'assistant' && typeof m.content === 'string' && m.content.length > 0) {
        finalAnswer = m.content
        break
      }
      // content 为 array 时
      if (m?.role === 'assistant' && Array.isArray(m.content)) {
        finalAnswer = m.content.filter((c: any) => c?.type === 'text').map((c: any) => c.text).join('')
        if (finalAnswer) break
      }
    }
    if (finalAnswer) break
  }

  return { finalAnswer, threadId, rawEvents: events }
}
```

- [ ] **Step 4: 测试通过 + Commit**

```bash
git add tests/eval/utils/sseConsumer.ts tests/eval/utils/sseConsumer.test.ts
git commit -m "feat(eval): SSE named-event 协议消费器"
```

---

## Task 7: report 三件套（reportTypes + jsonReporter + markdownReporter）

按 v1 Task 5 实施。**改动**：
1. markdownReporter 测试只保留 1 个 facts 类 case，删除 freeform 测试（简化）
2. 报告文本无 emoji（用 `[PASS]/[FAIL]/[WARN]` 文字）

```bash
git commit -m "feat(eval): report 三件套（json/markdown reporter）"
```

---

## Task 8: utils/ossMock.ts —— StorageFactory.setOverride 钩子注入

> v1 用 `vi.mock` 在 bun runtime 不工作；v2 改用给 `StorageFactory` 加 setOverride 钩子。

**Files:**
- Modify: `server/lib/storage/factory.ts` —— 加 eval-only 钩子
- Create: `tests/eval/utils/ossMock.ts`

- [ ] **Step 1: 给 StorageFactory 加 override 钩子**

读 `server/lib/storage/factory.ts` 找 `getAdapter()` 方法（应该是 class 内的某个 method）。**在该文件末尾**或合适位置加：

```ts
// 在 StorageFactory 类内部加 static 字段：
static __evalOverride: any = null

// 在 getAdapter 方法的最开头（return 之前）加：
if (StorageFactory.__evalOverride) return StorageFactory.__evalOverride

// 文件末尾导出钩子：
export function __setStorageOverrideForEval(adapter: any): void {
  StorageFactory.__evalOverride = adapter
}
```

注：`__` 前缀和注释明示"eval-only，不要在生产代码用"。

- [ ] **Step 2: 实现 ossMock.ts**

```ts
// tests/eval/utils/ossMock.ts
import { __setStorageOverrideForEval } from '~~/server/lib/storage/factory'

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
  // 按真实 BaseStorageAdapter 接口补其他方法（grep server/lib/storage/base.ts）
}

export function installOssMock(): void {
  __setStorageOverrideForEval(fakeAdapter)
}

export function uninstallOssMock(): void {
  __setStorageOverrideForEval(null)
}
```

> 实施时如果 BaseStorageAdapter 还有其他必填方法（getSignedUrl 等），fakeAdapter 全部 stub 成 no-op 即可。

- [ ] **Step 3: 测试**

```ts
// tests/eval/utils/ossMock.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { StorageFactory } from '~~/server/lib/storage/factory'
import { installOssMock, uninstallOssMock, mockedUploads } from './ossMock'

describe('ossMock', () => {
  beforeEach(() => { uninstallOssMock(); mockedUploads.length = 0 })

  it('install 后 getAdapter 返回 fake adapter', async () => {
    installOssMock()
    const adapter = StorageFactory.getAdapter()  // 按真实 API 调用
    const url = await adapter.uploadFile('eval/x.txt', Buffer.from('hi'))
    expect(url).toMatch(/^mock:\/\//)
    expect(mockedUploads).toHaveLength(1)
  })

  it('uninstall 后恢复真实 adapter', () => {
    installOssMock()
    uninstallOssMock()
    expect(StorageFactory.__evalOverride).toBeNull()
  })
})
```

- [ ] **Step 4: 测试通过 + Commit**

```bash
git add server/lib/storage/factory.ts tests/eval/utils/ossMock.ts tests/eval/utils/ossMock.test.ts
git commit -m "feat(storage): StorageFactory 加 eval-only override 钩子 + ossMock"
```

---

## Task 9: fixtures/buildFixture.ts —— 3 案件 + 旧分析 + 自动 seed user

**Files:**
- Create: `tests/eval/fixtures/buildFixture.ts`
- Test: `tests/eval/fixtures/buildFixture.test.ts`

- [ ] **Step 1: 实现 buildFixture（关键修正：用 `prisma.caseMemories`、`name+phone` 必填、sequence reset）**

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
    analysisIds: string[]
    analysisHistoricalIds: string[]
    analysisLegacyId: string
    sessionIds: Record<string, string>
  }
  caseB: { id: number; materialIds: string[]; memoryIds: string[]; analysisIds: string[] }
  caseC: { id: number; ownerId: number; materialId: string; memoryId: string }
}

export interface BuildOpts {
  cleanFirst: boolean
  deterministicSeed: number
  ownerUserId: number
}

const TABLES_TO_CLEAN = [
  'case_analysis_embeddings', 'caseAnalyses', 'case_memories',
  'caseMaterialEmbeddings', 'caseMaterials', 'chatSessions',
  'agent_runs', 'cases',
] as const

export async function buildFixture(opts: BuildOpts): Promise<FixtureResult> {
  // 双保险：DATABASE_URL 不含 ls_eval 拒绝清表
  if (!(process.env.DATABASE_URL ?? '').includes('ls_eval')) {
    throw new Error('[fixture] 拒绝清表：DATABASE_URL 不含 ls_eval')
  }

  await ensureEvalUser(opts.ownerUserId)

  if (opts.cleanFirst) {
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${TABLES_TO_CLEAN.map(t => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
    )
  }

  const rng = mulberry32(opts.deterministicSeed)
  const caseA = await buildCaseA(opts.ownerUserId, rng)
  const caseB = await buildCaseB(opts.ownerUserId, rng)
  const caseC = await buildCaseC(opts.ownerUserId, rng)
  return { caseA, caseB, caseC }
}

async function ensureEvalUser(userId: number): Promise<void> {
  // users 表必填字段（核对 prisma/models/user.prisma）：name + phone
  await prisma.users.upsert({
    where: { id: userId },
    update: {},
    create: {
      id: userId,
      name: 'eval-user',
      phone: '13800000000',
    },
  })
  // sequence 推进，防止下次 autoincrement insert 撞 id=1
  await prisma.$executeRawUnsafe(
    `SELECT setval(pg_get_serial_sequence('users', 'id'), GREATEST((SELECT MAX(id) FROM users), 1))`,
  )
}

// === caseA ===

async function buildCaseA(ownerUserId: number, rng: () => number): Promise<FixtureResult['caseA']> {
  const created = await prisma.cases.create({
    data: {
      title: '【eval-fixture】民商事合同纠纷（二审）',
      caseTypeId: 1,                       // 假定 ls_eval 库 prisma:push 后 caseTypes 表有 id=1，否则需要预 seed
      status: 4,                            // SECOND_TRIAL
      courtName: '广州市中级人民法院',
      firstInstanceCaseNo: '(2024)粤0103民初1234号',
      secondInstanceCaseNo: '(2025)粤01民终5678号',
      firstInstanceJudge: '张三',
      secondInstanceJudge: '李四',
      ownerUserId,
    } as any,
  })

  const materialIds = await seedMaterials(created.id, rng)
  const memoryIds = await seedMemories(created.id, rng)

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
    const sessionId = await seedSession(created.id, ownerUserId, moduleId, rng)
    sessionIds[moduleId] = sessionId
  }

  return {
    id: created.id, ownerId: ownerUserId, materialIds, memoryIds,
    analysisIds, analysisHistoricalIds, analysisLegacyId, sessionIds,
  }
}

async function seedMaterials(caseId: number, rng: () => number): Promise<string[]> {
  const items = [
    ['contract', '甲乙双方主合同.docx'],
    ['contract', '补充协议.pdf'],
    ['evidence', '银行回单（首付款）.pdf'],
    ['evidence', '微信聊天记录.pdf'],
    ['evidence', '物流签收单.png'],
    ['evidence', '邮件往来.pdf'],
    ['transcript', '一审庭审笔录.pdf'],
    ['transcript', '调解记录.pdf'],
  ] as const
  const ids: string[] = []
  for (let i = 0; i < items.length; i++) {
    const id = generateUuidV4(rng)
    await prisma.caseMaterials.create({
      data: {
        id,
        caseId,
        fileName: items[i][1],
        fileType: items[i][0],
        fileSize: 102400,
        fileUrl: `mock://eval/material-${i}`,
        summary: `第 ${i + 1} 份材料预生成 100 字摘要：${items[i][1]} 关键事实。`,
        status: 2,
      } as any,
    })
    ids.push(id)
  }
  return ids
}

async function seedMemories(caseId: number, rng: () => number): Promise<string[]> {
  // 注：使用 prisma.caseMemories（驼峰），表名 case_memories 由 @@map 自动映射
  const items = [
    { kind: 'fact', subjectKey: 'fact.contract.signed_at', text: '甲乙双方于 2024-03-15 签订主合同' },
    { kind: 'fact', subjectKey: 'fact.payment.first', text: '甲方已支付首付款 100 万元' },
    { kind: 'fact', subjectKey: 'fact.delivery.overdue', text: '乙方逾期交货 45 天' },
    { kind: 'fact', subjectKey: 'fact.dispute.amount', text: '争议金额为 280 万元' },
    { kind: 'fact', subjectKey: 'fact.evidence.wechat', text: '存在微信聊天记录证明乙方承认逾期' },
    { kind: 'preference', subjectKey: 'preference.contact.method', text: '当事人偏好电话沟通' },
    { kind: 'preference', subjectKey: 'preference.strategy.attitude', text: '当事人倾向积极调解' },
    { kind: 'preference', subjectKey: 'preference.timeline.urgency', text: '当事人希望 2 个月内结案' },
    { kind: 'preference', subjectKey: 'preference.disclosure.detail', text: '不愿公开具体合同金额' },
    { kind: 'preference', subjectKey: 'preference.report.format', text: '希望分析报告以表格输出' },
    { kind: 'topic', subjectKey: 'topic.legal.basis', text: '讨论过《民法典》合同编关于违约金的条款' },
    { kind: 'topic', subjectKey: 'topic.evidence.assessment', text: '已评估微信记录的证据效力' },
    { kind: 'topic', subjectKey: 'topic.risk.financial', text: '评估了乙方的偿付能力风险' },
    { kind: 'topic', subjectKey: 'topic.precedent.search', text: '检索了类案三起，均判决支持原告' },
    { kind: 'topic', subjectKey: 'topic.strategy.mediation', text: '讨论过和解方案的可行性' },
  ]
  const ids: string[] = []
  for (const item of items) {
    const id = generateUuidV4(rng)
    await prisma.caseMemories.create({
      data: {
        id,
        text: item.text,
        metadata: {
          id, caseId, kind: item.kind, subjectKey: item.subjectKey,
          confidence: 0.8 + rng() * 0.15, source: 'fixture', invalidatedAt: null,
        },
        // embedding 是 Unsupported("vector")，create 时省略字段（Prisma 接受）
      } as any,
    })
    ids.push(id)
  }
  return ids
}

async function seedAnalysisWithVersions(
  caseId: number, analysisType: string, rng: () => number,
): Promise<{ activeId: string; historicalId: string }> {
  const historicalId = generateUuidV4(rng)
  const activeId = generateUuidV4(rng)
  await prisma.caseAnalyses.create({
    data: {
      id: historicalId, caseId, analysisType,
      content: `${analysisType} v1 历史结论：倾向 A 方案。`.repeat(8),
      summary: `${analysisType} v1 摘要：A 方案，证据强度中。`,
      version: 1, isActive: false,
    } as any,
  })
  await prisma.caseAnalyses.create({
    data: {
      id: activeId, caseId, analysisType,
      content: `${analysisType} v2 当前结论：倾向 B 方案，证据强度高。`.repeat(8),
      summary: `${analysisType} v2 摘要：B 方案，证据强度高。`,
      version: 2, isActive: true,
    } as any,
  })
  return { activeId, historicalId }
}

async function seedLegacyAnalysis(caseId: number, rng: () => number): Promise<string> {
  const id = generateUuidV4(rng)
  await prisma.caseAnalyses.create({
    data: {
      id, caseId, analysisType: 'legacy_analysis',
      content: 'M4 上线前的旧分析报告，无 summary，无 embedding。'.repeat(5),
      summary: null,
      version: 1, isActive: true,
    } as any,
  })
  return id
}

async function seedSession(caseId: number, userId: number, moduleId: string, rng: () => number): Promise<string> {
  const sessionId = generateUuidV4(rng)
  await prisma.chatSessions.create({
    data: { sessionId, caseId, userId, moduleId } as any,
  })
  return sessionId
}

// === caseB（诱饵） ===

async function buildCaseB(ownerUserId: number, rng: () => number): Promise<FixtureResult['caseB']> {
  const created = await prisma.cases.create({
    data: { title: '【eval-诱饵】另一案件', caseTypeId: 1, status: 1, ownerUserId } as any,
  })
  const materialIds: string[] = []
  for (let i = 0; i < 3; i++) {
    const id = generateUuidV4(rng)
    await prisma.caseMaterials.create({
      data: {
        id, caseId: created.id, fileName: `decoy-${i}.pdf`, fileType: 'evidence',
        fileSize: 51200, fileUrl: `mock://eval/decoy-${i}`,
        summary: `诱饵材料 ${i}（出现在主案件 prompt 即为泄漏）`, status: 2,
      } as any,
    })
    materialIds.push(id)
  }
  const memoryIds: string[] = []
  for (const m of [
    { subjectKey: 'fact.contract.signed_at', text: '诱饵：合同签订于 2023-01-01' },
    { subjectKey: 'preference.contact.method', text: '诱饵：偏好邮件' },
    { subjectKey: 'topic.legal.basis', text: '诱饵：讨论过《公司法》' },
  ]) {
    const id = generateUuidV4(rng)
    await prisma.caseMemories.create({
      data: {
        id, text: m.text,
        metadata: { id, caseId: created.id, kind: 'fact', subjectKey: m.subjectKey, confidence: 0.9, source: 'fixture' },
      } as any,
    })
    memoryIds.push(id)
  }
  const analysisIds: string[] = []
  for (const t of ['init_analysis', 'risk_analysis']) {
    const id = generateUuidV4(rng)
    await prisma.caseAnalyses.create({
      data: {
        id, caseId: created.id, analysisType: t,
        content: `诱饵 ${t} 内容`, summary: `诱饵 ${t} 摘要`,
        version: 1, isActive: true,
      } as any,
    })
    analysisIds.push(id)
  }
  return { id: created.id, materialIds, memoryIds, analysisIds }
}

// === caseC（ARCHIVED） ===

async function buildCaseC(ownerUserId: number, rng: () => number): Promise<FixtureResult['caseC']> {
  const created = await prisma.cases.create({
    data: { title: '【eval-archived】已归档案件', caseTypeId: 1, status: 999, ownerUserId } as any,
  })
  const materialId = generateUuidV4(rng)
  await prisma.caseMaterials.create({
    data: {
      id: materialId, caseId: created.id, fileName: 'archived.pdf', fileType: 'evidence',
      fileSize: 10240, fileUrl: 'mock://eval/archived', summary: '已归档', status: 2,
    } as any,
  })
  const memoryId = generateUuidV4(rng)
  await prisma.caseMemories.create({
    data: {
      id: memoryId, text: '已归档案件记忆',
      metadata: { id: memoryId, caseId: created.id, kind: 'fact', subjectKey: 'fact.archived.test', confidence: 0.9, source: 'fixture' },
    } as any,
  })
  return { id: created.id, ownerId: ownerUserId, materialId, memoryId }
}
```

> **caseTypeId=1 假定**：`ls_eval` 库 `prisma:push` 后 `caseTypes` 表通常空。如果实施时 `caseTypeId=1` 撞 FK，在 `ensureEvalUser` 后追加 `prisma.caseTypes.upsert({ where: { id: 1 }, update: {}, create: { id: 1, name: '民商事合同纠纷' } })`。

- [ ] **Step 2: 写测试**

按 v1 Task 7 Step 4 即可。

- [ ] **Step 3: 跑测试**

```bash
DATABASE_URL='postgresql://daixin:daixin88@localhost:5432/ls_eval?schema=public&TimeZone=UTC' \
  npx vitest run tests/eval/fixtures/buildFixture.test.ts --reporter=verbose
```

如失败，按错误信息核对 prisma 字段（特别是 `caseTypeId` / `cases` 必填字段）。

- [ ] **Step 4: Commit**

```bash
git add tests/eval/fixtures/buildFixture.ts tests/eval/fixtures/buildFixture.test.ts
git commit -m "feat(eval): fixture builder（3 案件 + 旧分析 + 自动 seed user）"
```

---

## Task 10: metrics/costMetrics.ts

按 v1 Task 8 实施（v1 这部分正确）。

```bash
git commit -m "feat(eval): cost 指标聚合（cacheHitRate CRITICAL + token + p95）"
```

---

## Task 11: runner/datasetRunner.ts —— 真 SSE + token 采集

**Files:**
- Create: `tests/eval/runner/datasetRunner.ts`

- [ ] **Step 1: 实现**（关键修正：runCaseChat 真签名 + SSE 消费 + 从 LLMUsageCallbackHandler 读 system tokens 而非重算）

```ts
// tests/eval/runner/datasetRunner.ts
import { runCaseChat } from '~~/server/services/workflow/agents/caseMainAgent'
import { LLMUsageCallbackHandler } from '~~/server/services/workflow/callbacks/LLMUsageCallbackHandler'
import { consumeAgentSseStream } from '../utils/sseConsumer'

export interface RunCaseInput {
  caseId: number
  userId: number
  sessionId: string                  // 取自 fx.caseA.sessions[i]
  question: string
  isWarmup?: boolean
}

export interface RunCaseOutput {
  threadId: string
  answer: string
  latencyMs: number
  promptTokens: number               // 从 LLM response usage 取（聚合本次新增 records）
  cacheHitTokens: number
}

export async function runOneChat(input: RunCaseInput, handler: LLMUsageCallbackHandler): Promise<RunCaseOutput> {
  handler.setWarmup(input.isWarmup ?? false)
  const before = handler.getRecords().length
  const startedAt = Date.now()

  // 真实 CaseAgentOptions：{ userId, caseId, thinking?, signal?, callbacks? }
  // callbacks 通过 agent.stream 的 RunnableConfig 透传到底层 LLM（A2.3 已改造）
  const stream = await runCaseChat(input.sessionId, input.question, {
    caseId: input.caseId,
    userId: input.userId,
    callbacks: [handler],
  })

  const consumed = await consumeAgentSseStream(stream)
  const latencyMs = Date.now() - startedAt

  // 取本次新增的 usage records（可能多条，因为 agent 内部多次 LLM 调用）
  const newRecords = handler.getRecords().slice(before)
  const promptTokens = newRecords.reduce((s, r) => s + (r.usage.prompt_tokens ?? r.usage.input_tokens ?? 0), 0)
  const cacheHitTokens = newRecords.reduce((s, r) =>
    s + (r.usage.prompt_cache_hit_tokens ?? r.usage.cache_read_input_tokens ?? r.usage.prompt_tokens_details?.cached_tokens ?? 0), 0)
  // systemPromptTokens 不在此采集，由 stab-prompt-hash（Task 20）通过 buildContextSegments 输出复用算（spec §3.2 原意 4 段拼串走 tiktoken）

  return {
    threadId: consumed.threadId,
    answer: consumed.finalAnswer,
    latencyMs,
    promptTokens,
    cacheHitTokens,
  }
}
```

- [ ] **Step 2: 简单冒烟（不写单测，由 Task 12 端到端验证）**

- [ ] **Step 3: Commit**

```bash
git add tests/eval/runner/datasetRunner.ts
git commit -m "feat(eval): datasetRunner 真 SSE 消费 + token 采集"
```

---

## Task 12: runEval.ts 主循环 + 首次 cost-only 跑通

**Files:**
- Modify: `tests/eval/runEval.ts`

- [ ] **Step 1: 实现完整 runEval 主循环（Cost-only 版）**

```ts
// tests/eval/runEval.ts
/**
 * Eval runner（独立工具脚本，非 server runtime production code）。
 * 允许使用 console 输出进度（已豁免 no-console rule）。
 */
import { execSync } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
dayjs.extend(utc)
dayjs.extend(timezone)

import { assertEvalRuntime } from './utils/runtimeGuards'
import { installOssMock } from './utils/ossMock'
import { buildFixture } from './fixtures/buildFixture'
import { LLMUsageCallbackHandler } from '~~/server/services/workflow/callbacks/LLMUsageCallbackHandler'
import { runOneChat } from './runner/datasetRunner'
import { aggregateCostMetrics } from './metrics/costMetrics'
import { writeJsonReport } from './report/jsonReporter'
import { writeMarkdownReport } from './report/markdownReporter'
import type { EvalReport } from './report/reportTypes'

const OWNER_USER_ID = parseInt(process.env.EVAL_OWNER_USER_ID ?? '1', 10)
const OUT_DIR = 'docs/eval-reports'

async function main() {
  await assertEvalRuntime()
  installOssMock()

  const startedAt = Date.now()
  const handler = new LLMUsageCallbackHandler({ tag: 'main', isWarmup: true })

  // Part 0: seed fixture
  const fx = await buildFixture({ cleanFirst: true, deterministicSeed: 42, ownerUserId: OWNER_USER_ID })

  // Part 0.5: warmup（每模块跑一次空问题，之后取消 warmup flag）
  for (const moduleId of Object.keys(fx.caseA.sessionIds)) {
    try {
      await runOneChat({
        caseId: fx.caseA.id,
        userId: OWNER_USER_ID,
        sessionId: fx.caseA.sessions[0],         // A2.4 fixture 返回 sessions: string[]（非 sessionIds map）
        question: '本案当前进入哪个阶段？',
        isWarmup: true,
      }, handler)
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[eval] warmup failed', e)
    }
    break  // warmup 跑 1 次即可
  }
  handler.setWarmup(false)

  // Part 1: cost-only smoke run（10 占位提问，Task 16 替换为 TEST_DATASET 时整段删除）
  const placeholders = [
    '本案一审法官姓名？', '当前案件状态？', '甲方诉讼请求？',
    '主合同签订时间？', '存在哪些证据？', '乙方主要抗辩理由？',
    '调解过程？', '诉讼标的金额？', '本案二审法院？', '当前模块要点？',
  ]
  const promptTokensSamples: number[] = []
  for (let i = 0; i < fx.caseA.sessions.length; i++) {
    const sessionId = fx.caseA.sessions[i]!
    for (const q of placeholders) {
      try {
        const out = await runOneChat({
          caseId: fx.caseA.id, userId: OWNER_USER_ID,
          sessionId, question: q,
        }, handler)
        promptTokensSamples.push(out.promptTokens)
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[eval] case run failed', q, e)
      }
    }
  }

  // Aggregate cost metrics
  const cost = aggregateCostMetrics({
    usageRecords: handler.getRecords(),
    systemPromptTokensSamples: [],     // Phase 1 cost-only 阶段不采集；Task 20 stab-prompt-hash 接入后填充
    totalPromptTokensSamples: promptTokensSamples,
    memoryRecallLatencies: [],          // 一期作 WARN-only，后续在 service 加 timer
    analysisSummaryLatencies: [],
    anthropicProtocolSecondCacheRead: 0,
    openaiProtocolSecondCachedTokens: 0,
  })

  const criticalFailures = cost.filter(m => m.severity === 'CRITICAL' && m.result === 'fail').map(m => m.name)
  const crits = cost.filter(m => m.severity === 'CRITICAL')
  const warns = cost.filter(m => m.severity === 'WARN')

  const report: EvalReport = {
    version: '1.0',
    runAt: dayjs().tz('Asia/Shanghai').format(),
    commit: gitCommit(),
    durationMs: Date.now() - startedAt,
    summary: {
      totalCritical: crits.length, passedCritical: crits.filter(m => m.result === 'pass').length,
      totalWarn: warns.length, passedWarn: warns.filter(m => m.result === 'pass').length,
      criticalFailures, overallPass: criticalFailures.length === 0,
    },
    metrics: { cost, quality: [], task: [], extraction: [], security: [], stability: [] },
    cases: [], extractions: [], securityAssertions: [], errored: [],
  }

  await mkdir(OUT_DIR, { recursive: true })
  const md = await writeMarkdownReport(report, OUT_DIR, { excerptAnswers: true, excerptLength: 200 })
  const json = await writeJsonReport(report, OUT_DIR)
  // eslint-disable-next-line no-console
  console.log(`[eval] reports written: ${md}, ${json}`)
  // eslint-disable-next-line no-console
  console.log(`[eval] criticalFailures=${criticalFailures.length}; overallPass=${report.summary.overallPass}`)
  process.exit(criticalFailures.length > 0 ? 1 : 0)
}

function gitCommit(): string {
  try { return execSync('git rev-parse --short HEAD').toString().trim() } catch { return 'unknown' }
}

main().catch(err => {
  // eslint-disable-next-line no-console
  console.error('[eval] runner crashed before producing report', err)
  process.exit(2)
})
```

- [ ] **Step 2: 首跑冒烟**

```bash
EVAL_DEEPSEEK_KEY=sk-xxx bun run eval:context
```

**Expected**: 首跑 exit 1（cacheHitRate 冷）是预期。重点看：
- 报告文件落到 `docs/eval-reports/`
- `cost` metrics 有数据（promptTokens / cacheHitRate 都不是 0）
- 三个 module 各跑了 placeholders

如失败：按 §1 真实代码核对清单逐项排查。

- [ ] **Step 3: Commit**

```bash
git add tests/eval/runEval.ts
git commit -m "feat(eval): runEval 主循环 + 首次 cost-only 跑通"
```

---

## Task 13: fixtures/testDataset.ts （29 条提问）

按 v1 Task 10 实施（dataset 内容正确，无修改）。

```bash
git commit -m "feat(eval): testDataset 29 条提问"
```

---

## Task 14: metrics/qualityMetrics + judgePrompt + judgeRunner

按 v1 Task 11 + Task 12（judgeRunner 部分）实施，**改动**：
- markdownReporter 测试只保留 facts 类（v1 Task 5 的 freeform case 测试已删，详见 Task 7）
- **judgeRunner 处理 LangChain `resp.content`**：v1 写法 `typeof resp.content === 'string' ? resp.content : JSON.stringify(resp.content)` 会把 ContentBlock[] 序列化成带 `{type,text}` 的字符串，**丢失文本结构 → judge 解析 JSON 失败**。改为：

```ts
function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.filter((c: any) => c?.type === 'text').map((c: any) => c.text).join('')
  }
  return String(content ?? '')
}
const txt = extractText(resp.content)
```

```bash
git commit -m "feat(eval): quality 指标 + judge runner"
```

---

## Task 15: metrics/taskMetrics

按 v1 Task 12 taskMetrics 部分实施。

```bash
git commit -m "feat(eval): task 指标（toolCallAccuracy + scenarioPassRate）"
```

---

## Task 16: runEval 接入 Quality + Task（替换 placeholder）

按 v1 Task 13 实施，**关键改动**：
- **删除** Task 12 里的 placeholder 循环代码块（10 条占位提问），整段替换为 TEST_DATASET 循环
- 注释统一用 `// Part 1: dataset` / `// Aggregate quality+task` 格式

```bash
git commit -m "feat(eval): runEval 接入 Quality + Task"
```

---

## Task 17: consolidator 加 processNowService

按 v1 Task 14 实施，**关键改动**：
- QUEUE_KEY **不要重复声明**，复用 consolidator.service.ts 文件已有的 `'consolidator:due'` 常量
- 测试 beforeEach 用 `getRedisClient().select(15)` 切到 db=15 后 `.flushdb()`，不依赖具体 key

```bash
git commit -m "feat(memory): consolidator 新增 processNowService（绕 debounce）"
```

---

## Task 18: extraction dataset + metrics

按 v1 Task 15 实施。**改动**：所有 `prisma.case_memories` → `prisma.caseMemories`。

```bash
git commit -m "feat(eval): extraction dataset + 指标（precision CRITICAL）"
```

---

## Task 19: security dataset + metrics（service 直调）

**Files:**
- Create: `tests/eval/fixtures/securityDataset.ts`
- Create: `tests/eval/metrics/securityMetrics.ts`

- [ ] **Step 1: 实现 securityDataset.ts（service 直调，无 ofetch）**

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
    // 注：sec-cross-case-leak 在 runEval 里基于 ⑦ 组结果直接判定，不在这里跑

    {
      id: 'sec-archived-updateCase',
      category: 'archived-guard',
      severity: 'CRITICAL',
      async run(fx, ctx) {
        const { updateCaseService } = await import('~~/server/services/case/case.service')
        try {
          await updateCaseService(fx.caseC.id, ctx.ownerUserId, { title: '尝试改 ARCHIVED 标题' } as any)
          return { pass: false, detail: 'service 未挡住 ARCHIVED 案件（应有 isCaseReadOnly 守卫）' }
        } catch (e: any) {
          return { pass: true, detail: `service 正确拒绝：${e?.message ?? e}` }
        }
      },
    },

    {
      id: 'sec-archived-initAnalysis',
      category: 'archived-guard',
      severity: 'CRITICAL',
      async run(fx, ctx) {
        // [WARN] 已知：initAnalysis.service.ts 当前缺 isCaseReadOnly 守卫（M3/M4 spec §12 铁律未落实）
        // eval 跑 FAIL 是真实业务 bug 报告，需独立工单补守卫
        try {
          const initAnalysisModule = await import('~~/server/services/case/initAnalysis.service')
          const fn = (initAnalysisModule as any).initAnalysisService ?? (initAnalysisModule as any).default
          if (!fn) return { pass: false, detail: 'initAnalysisService 未导出（请按真实导出名调整）' }
          await fn({ caseId: fx.caseC.id, userId: ctx.ownerUserId } as any)
          return { pass: false, detail: 'initAnalysis 未挡 ARCHIVED 案件 — 真实业务 bug（M3 spec §12）' }
        } catch (e: any) {
          return { pass: true, detail: `正确拒绝：${e?.message ?? e}` }
        }
      },
    },

    {
      id: 'sec-archived-write-memory',
      category: 'archived-guard',
      severity: 'CRITICAL',
      async run(fx) {
        // [WARN] 已知：writeMemoryService 当前缺 isCaseReadOnly 守卫（M3 spec §12 铁律未落实）
        const { writeMemoryService } = await import('~~/server/services/memory/memory.service')
        try {
          await writeMemoryService({ caseId: fx.caseC.id, text: '尝试写入', kind: 'fact', confidence: 0.9 } as any)
          return { pass: false, detail: 'writeMemory 未挡 ARCHIVED — 真实业务 bug（M3 spec §12）' }
        } catch (e: any) {
          return { pass: true, detail: `正确拒绝：${e?.message ?? e}` }
        }
      },
    },

    {
      id: 'sec-archived-update-memory',
      category: 'archived-guard',
      severity: 'CRITICAL',
      async run(fx) {
        // [WARN] 已知：updateMemoryService 当前缺 isCaseReadOnly 守卫
        const { updateMemoryService } = await import('~~/server/services/memory/memory.service')
        try {
          await updateMemoryService({ id: fx.caseC.memoryId, invalidate: true } as any)
          return { pass: false, detail: 'updateMemory 未挡 ARCHIVED — 真实业务 bug（M3 spec §12）' }
        } catch (e: any) {
          return { pass: true, detail: `正确拒绝：${e?.message ?? e}` }
        }
      },
    },

    {
      id: 'sec-ai-autofill-preserve',
      category: 'ai-autofill',
      severity: 'CRITICAL',
      async run() {
        // mergeAutofillPreservingUserInput 在 app/composables/useCaseCreation.ts（前端代码）
        // eval 内联同样的 10 行纯函数做行为断言
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

> **重要提示**：上面 4 个 `sec-archived-*` 断言一期跑出来很可能 FAIL —— 因为代码确实缺守卫。这是 eval **应当发现**的业务 bug，**不要绕过**。补守卫属于独立工单（在 `memory.service.ts` / `initAnalysis.service.ts` 加 `isCaseReadOnly(caseRecord.status) → throw new Error('案件已归档')`）。

- [ ] **Step 2: 实现 securityMetrics.ts**

按 v1 Task 16 securityMetrics.ts 实施。

- [ ] **Step 3: Commit**

```bash
git add tests/eval/fixtures/securityDataset.ts tests/eval/metrics/securityMetrics.ts
git commit -m "feat(eval): security 6 断言（service 直调，绕过 HTTP）"
```

---

## Task 20: stability metrics（buildContextSegments 真签名 + 旧数据兼容）

**Files:**
- Create: `tests/eval/metrics/stabilityMetrics.ts`

- [ ] **Step 1: 实现（关键修正：真签名 `{caseId, agentName, userQuery}`）**

```ts
// tests/eval/metrics/stabilityMetrics.ts
import { createHash } from 'node:crypto'
import { prisma } from '~~/server/utils/db'
import { buildContextSegments } from '~~/server/services/workflow/context/moduleContextBuilder'
import type { MetricResult } from '../report/reportTypes'

export async function checkPromptHashStability(caseId: number, agentName: string): Promise<MetricResult> {
  // 真签名：{ caseId, agentName, userQuery, roleAndFlowTemplate? }
  // 注意：buildContextSegments 内部跑向量召回，userQuery 必须固定才能保证两次调用结果一致
  const fixedQuery = '__eval_stability_probe__'
  const a = await buildContextSegments({ caseId, agentName, userQuery: fixedQuery })
  const b = await buildContextSegments({ caseId, agentName, userQuery: fixedQuery })

  // 比 sha256(roleAndFlow + caseProfile + moduleSummaries)
  // dynamicContext 含 ⑤ 段动态召回，预期不稳定，不进 hash
  const concat = (s: typeof a) => (s.roleAndFlow ?? '') + (s.caseProfile ?? '') + (s.moduleSummaries ?? '')
  const ha = createHash('sha256').update(concat(a)).digest('hex')
  const hb = createHash('sha256').update(concat(b)).digest('hex')
  return {
    name: 'stab-prompt-hash',
    value: ha === hb,
    threshold: 'sha256(seg ①②③) 两次相等',
    severity: 'CRITICAL',
    result: ha === hb ? 'pass' : 'fail',
    detail: ha === hb ? ha.slice(0, 16) : `mismatch ${ha.slice(0, 8)} vs ${hb.slice(0, 8)}`,
  }
}

export async function checkSwitchActiveAtomic(caseId: number): Promise<MetricResult> {
  const analyses = await prisma.caseAnalyses.findMany({ where: { caseId, deletedAt: null } as any })
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
    if (actives[0]) {
      const embeddings = await prisma.$queryRawUnsafe<{ id: string; metadata: any }[]>(
        `SELECT id, metadata FROM case_analysis_embeddings WHERE metadata->>'caseAnalysisId' = $1`,
        actives[0].id,
      )
      const allActive = embeddings.every(e => e.metadata?.isActive === true)
      if (!allActive && embeddings.length > 0) issues.push(`${t}: embedding metadata.isActive 不一致`)
    }
  }
  return {
    name: 'stab-switch-active-atomic',
    value: issues.length === 0,
    threshold: 'isActive=1 + embeddings 同步',
    severity: 'CRITICAL',
    result: issues.length === 0 ? 'pass' : 'fail',
    detail: issues.length === 0 ? 'ok' : issues.join('; '),
  }
}

export async function checkOldDataGraceful(caseId: number): Promise<MetricResult> {
  const issues: string[] = []
  // 1. search_case_analysis 工具直接调（不抛异常即合规）
  try {
    const toolModule = await import('~~/server/services/workflow/tools/search_case_analysis.tool')
    const create = (toolModule as any).createTool ?? (toolModule as any).default
    if (create) {
      const tool = create({ caseId, userId: 1 } as any)
      // tool 真实接口可能是 .invoke / .call / 直接 fn（按真实导出补全）
      try {
        if (tool?.invoke) await tool.invoke({ query: 'legacy', topK: 5 })
        else if (typeof tool === 'function') await tool({ query: 'legacy', topK: 5 })
      } catch (innerE: any) {
        issues.push(`search_case_analysis 调用抛异常：${innerE?.message ?? innerE}`)
      }
    }
  } catch (e: any) {
    issues.push(`tool 模块加载失败：${e?.message ?? e}`)
  }
  // 2. moduleContextBuilder 渲染含 legacy 分析的案件不应出现 null/undefined 字面量
  try {
    const segs = await buildContextSegments({ caseId, agentName: 'init', userQuery: '__probe__' })
    const concat = (segs.moduleSummaries ?? '') + (segs.caseProfile ?? '')
    if (concat.includes('null') || concat.includes('undefined')) {
      issues.push('moduleSummaries/caseProfile 含 null/undefined 字面量')
    }
  } catch (e: any) {
    issues.push(`buildContextSegments 抛异常：${e?.message ?? e}`)
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
    name: 'stab-profile-key-order', value: ok, threshold: '字典序',
    severity: 'WARN', result: ok ? 'pass' : 'fail',
    detail: ok ? 'ok' : `keys=${keys.join(',')}`,
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add tests/eval/metrics/stabilityMetrics.ts
git commit -m "feat(eval): stability 指标（真 buildContextSegments 签名 + 旧数据兼容）"
```

---

## Task 21: runEval 接入 Part 2 + Part 3

按 v1 Task 18 实施，**关键改动**：
- 所有 `prisma.case_memories` → `prisma.caseMemories`
- `buildModuleContext(...)` → `buildContextSegments({ caseId, agentName: moduleId, userQuery: '__probe__' })`
- 注释用 `// Part 1 / Part 2 / Part 3 / Aggregate` 取代 `// Step 3 / 4 / 5`

```bash
git commit -m "feat(eval): runEval 接入 Part 2/3（extraction + security + stability）"
```

---

## Task 22: HTML Viewer + index.json

**Files:**
- Create: `docs/eval-reports/viewer.html`
- Create: `tests/eval/report/reportIndex.ts`

- [ ] **Step 1: viewer.html（Tailwind v4 Browser CDN，删刷新+排序）**

复用 v1 Task 19 viewer.html 框架，**修正**：

```html
<!-- 改 v3 stale URL 为 v4 -->
<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
```

并删除 `id="reload"` 按钮和按列排序逻辑。仅保留：① 报告下拉框 ② Overview 面板 ③ 逐 case 展开 ④ 6 类指标 details。

- [ ] **Step 2: reportIndex.ts**

按 v1 Task 19 Step 2 实施。

- [ ] **Step 3: runEval 末尾调 rebuildIndex**

按 v1 Task 19 Step 3 实施。

- [ ] **Step 4: Commit**

```bash
git add docs/eval-reports/viewer.html tests/eval/report/reportIndex.ts tests/eval/runEval.ts
git commit -m "feat(eval): HTML viewer（Tailwind v4 CDN）+ index.json"
```

---

## Task 23: 首次全量跑 + 阈值校准 + README + 破坏验证

按 v1 Task 20 实施。**关键补充**：

- 首跑后预期 `sec-archived-write-memory` / `sec-archived-update-memory` / `sec-archived-initAnalysis` **FAIL** —— 这是真实业务 bug，已知 M3 spec §12 铁律未落实。报告原样产出，**不要绕过**。
- README 加段：
  ```markdown
  ## 已知业务 bug（eval 会发现）

  以下 CRITICAL 项首跑会 FAIL，反映项目 ARCHIVED 守卫未在 service 层落实：
  - sec-archived-initAnalysis（initAnalysisService 缺 isCaseReadOnly）
  - sec-archived-write-memory（writeMemoryService 缺）
  - sec-archived-update-memory（updateMemoryService 缺）

  修复路径：在三个 service 入口处加 `if (isCaseReadOnly(caseRecord.status)) throw new Error('案件已归档')`。
  这属于独立工单（M3 spec §12 铁律未落实），不在本 eval 计划范围。
  ```

```bash
git commit -m "docs(eval): README 完整使用说明 + 阈值校准 + 业务 bug 已知项"
```

---

## Self-Review

完成所有 23 个 Task 后，对照 spec 自查：

- [x] §1 整体流水线 9 步 → Task 12 + Task 21 实现
- [x] §2 Fixture（3 案件 + 旧分析）→ Task 9
- [x] §3 26 项指标全覆盖：
  - Cost 7 项（Task 10/11/12）
  - Quality 3 项（Task 14）
  - Task 2 项（Task 15）
  - Extraction 4 项（Task 18）
  - Security 6 项（Task 19）
  - Stability 4 项（Task 20）
- [x] §4 三件套报告（Task 7 + Task 22）
- [x] §5 新建基建：LLMUsageCallbackHandler（T3）/ processNowService（T17）/ traceReader（T5）/ prng（T2）/ ossMock（T8）/ sseConsumer（T6）/ StorageFactory.setOverride（T8）
- [x] §6 Phase 1-4 → Task 1-12 / 13-16 / 17-21 / 22-23
- [x] §7 风险缓解：Redis db=15 / 别名 spike hard-gate / 首跑 exit 1 预期声明 / DEEPSEEK_KEY healthcheck

---


---

---

# 附录 A2：基于真实代码 grep 的修正（取代之前的所有附录）

> 此前两版附录都因"凭印象写代码"再次出错。本附录每一条都已通过 `Read` / `grep` 真实文件核对，标注真实文件路径和行号。**实施时按本附录覆盖正文同名 Task。**

## A2.0 ls_eval 库初始化（**正文 Task 1 Step 5 关键修正**）

**真实情况（已验证）**：
- `prisma/seeds/seedData.sql` 含项目种子数据：7 个 case_types（id 1-7）+ 17 个 models + **21 个 nodes**（`caseInfoCheck` id=1, `extractInfo` id=2 等）
- `prisma/seed.ts` **不会**自动加载 `seedData.sql`（反过来：seed.ts 依赖 seedData 已被运行过）

**v2 正文 Task 1 Step 5 错误**：只 `prisma:push --accept-data-loss + prisma:generate`，没加载 seedData.sql。结果：`ls_eval` 库 nodes/caseTypes/models 全空，fixture 写 caseAnalyses 必撞 FK。

**正确流程**：
```bash
createdb ls_eval
DATABASE_URL='postgresql://daixin:daixin88@localhost:5432/ls_eval?schema=public&TimeZone=UTC' bun run prisma:push --accept-data-loss
DATABASE_URL='postgresql://daixin:daixin88@localhost:5432/ls_eval?schema=public&TimeZone=UTC' bun run prisma:generate
psql 'postgresql://daixin:daixin88@localhost:5432/ls_eval' -f prisma/seeds/seedData.sql
```

**fixture 不再需要 upsert nodes/caseTypes/models**，直接复用 seedData 已有：`caseTypeId: 1`（民商事案件）、`nodeId: 1`（caseInfoCheck）。

## A2.1 真实代码事实表（取代正文 §1）

| 依赖 | 真实事实（grep 验证） | 旧 plan 错误 |
|---|---|---|
| `runCaseChat` | `server/services/workflow/agents/caseMainAgent.ts:69`，`(sessionId: string, message: string \| undefined, options: CaseAgentOptions & { command?: unknown }) → Promise<ReadableStream<Uint8Array>>` | [OK] 正文 §1 已对 |
| `CaseAgentOptions` 真实字段 | 同文件 L46-55：`{ userId: number, caseId: number, thinking?: boolean, signal?: AbortSignal }`。**没有 callbacks，也没有 agentName** | 正文 §1 写"加 callbacks"，但忘了警告：**没有 agentName，RunCaseInput 不要传** |
| `agent.stream(input, config)` 调用点 | 同文件 L161-189：第二参数是 RunnableConfig `{ configurable, streamMode, subgraphs, encoding, recursionLimit, signal }` | **callbacks 注入应加在这里**（不是 ChatModelConfig） |
| `ChatModelConfig` | `server/services/node/chatModelFactory.ts:28-50`，**没有也不需要加 callbacks**。LangChain BaseChatModel 的 callbacks 通过 RunnableConfig 在 invoke/stream 时传 | v2 正文 Task 4 + A.3 错误地说要扩展 ChatModelConfig + 三家供应商分支。**全部撤销**，只在 caseMainAgent.ts agent.stream 第二参数加 `callbacks: options.callbacks` |
| `cases` 表 | `prisma/models/case.prisma:34`：必填 `userId` (Int @map "user_id") + `caseTypeId` (Int @map "case_type_id") + `title` | 正文 v2 写 `ownerUserId` [FAIL] → 改 `userId` |
| `caseSessions` model | model 名 **`caseSessions`** @@map(`case_sessions`)。必填 `sessionId` (unique)；`caseId/userId` 都 nullable；`scope` default 'case'，`type` default 1 | 正文 v2 写 `prisma.chatSessions` [FAIL] → 改 `prisma.caseSessions`，且不设 moduleId 字段（不存在） |
| `caseMaterials` 真实字段 | `prisma/models/case.prisma:149`：必填 `name` + `type` (Int 1-4) + `caseId?`；可选 `summary` (String? Text) + `status` (default 1) + `ossFileId?`。**没有 fileType / fileName / fileSize / fileUrl** | 正文 v2 fixture 全错 → 改 `name + type:2(文档)` |
| `caseAnalyses` 真实字段 | `prisma/models/case.prisma:189`：必填 `caseId` + `sessionId` (FK case_sessions.sessionId, NOT NULL String) + `nodeId` (FK nodes.id, NOT NULL Int) + `analysisType`；可选 `analysisResult` (Text) + `summary` (Text) + `version` (default 1) + `isActive` (default false) + `status` (default 1)。**没有 `content` 字段** | 正文 v2 用 `content` [FAIL] → 改 `analysisResult`；必加 `sessionId`（取自 fixture 创建的 caseSessions.sessionId）+ `nodeId: 1`（来自 seedData） |
| `caseMemories` 真实表 | `prisma/models/case.prisma:303`：**LangChain PGVectorStore 同构 schema**，仅 5 列：`id` (uuid pk default gen_random_uuid()) + `text` (Text?) + `metadata` (Json?) + `embedding` (Unsupported "vector"?) + `tsv` (Unsupported "tsvector"?) | **关键：embedding 是 `Unsupported("vector")`** —— Prisma client **不能** `caseMemories.create()`（会报 "field of type Unsupported cannot be used"）。fixture **必须**用 raw SQL `INSERT INTO case_memories (id, text, metadata) VALUES (...)` 或者走项目 `addDocumentsToVectorStore` |
| `users` 表 | `prisma/models/user.prisma`：必填 `name` + `phone` (unique) | 正文 v2 写 `nickname` [FAIL] → 改 `name` |
| `consolidator QUEUE_KEY` | `server/services/memory/consolidator.service.ts:11` `'consolidator:due'` | [OK] |
| `writeMemoryService` 签名 | `server/services/memory/memory.service.ts:22` `(input: MemoryWriteInput) → Promise<{ id: string }>`，`MemoryWriteInput = { caseId, kind, text, subjectKey?, confidence?, source? }` | [OK] |
| `updateMemoryService` 签名 | 同文件 L84，参数对象包含 `id` + `invalidate?: boolean` 等 | 实施前 grep 第 84-108 行确认完整签名 |
| `updateCaseService` 真签名 | `server/services/case/case.service.ts:234` `(caseId: number, data: UpdateCaseInput) → Promise<cases>`。**不需要 ownerUserId 参数** | 正文 v2 写 `(fx.caseC.id, ctx.ownerUserId, {...})` [FAIL] → 改 2 参数 |
| `updateCaseService` ARCHIVED 守卫 | 同文件 L245 `if (isCaseReadOnly(existing.status)) throw '案件已归档，不可编辑'` | [OK] 守卫存在，eval 测试会 PASS |
| `initAnalysisService` | **不存在**。initAnalysis.service.ts 真实导出（L250 / L271 / L316）：`canShortCircuitSSE` / `buildTerminalSnapshotEvents` / `completeAnalysisWithRAG` 等 | 改用 service 直调 `createCaseService` 不行（ARCHIVED 案件已经存在），**改方案**：直接调 `prisma.cases.findUnique` + 手工触发 ARCHIVED case 的 init 流程，但项目 init 入口在 API handler 而非 service。**结论**：删除 `sec-archived-initAnalysis` 断言，改为 `sec-archived-write-analysis`（用 `prisma.caseAnalyses.create` 时项目代码层是否拦 ARCHIVED）；或者保留该断言并标注"由于 init 流程没有独立 service 入口，本断言改为通过 HTTP 测试"——需用户拍板 |
| SSE 协议 | `server/services/sse/agentSseStream.ts:128-184`：`event: values\ndata: {messages, ...}\n\n` / `event: messages\ndata: {...}\n\n` / `event: custom\ndata: {type, ...}\n\n` | [OK] 正文 Task 6 sseConsumer 协议对 |
| `mergeAutofillPreservingUserInput` | `app/composables/useCaseCreation.ts`（**前端**），10 行纯函数 | eval 内联同样的 10 行 |
| `addDocumentsToVectorStore` | `server/services/legal/vectorStore.service.ts`，签名 `(docs, ids, { tableName })` | fixture 写 caseMemories 用此函数（推荐），或 raw SQL 直插 |
| `seedData.sql` 含数据 | 7 caseTypes + 17 models + 21 nodes（id=1=caseInfoCheck/analysis；id=2=extractInfo/extraction 等） | fixture 不需要造这三张表 |
| `BaseCallbackHandler.handleLLMStart` 真实签名 | `@langchain/core/callbacks/base`，`(llm: Serialized, prompts: string[], runId: string, parentRunId?, extraParams?, tags?, metadata?, runName?) → void \| Promise<void>` | LLMUsageCallbackHandler 签名兼容（前 3 参数即可） |

## A2.2 Task 1 真实修正（ls_eval 库初始化 + Redis）

正文 Task 1 Step 5 改为：

```bash
createdb ls_eval
DATABASE_URL='postgresql://daixin:daixin88@localhost:5432/ls_eval?schema=public&TimeZone=UTC' bun run prisma:push --accept-data-loss
DATABASE_URL='postgresql://daixin:daixin88@localhost:5432/ls_eval?schema=public&TimeZone=UTC' bun run prisma:generate
psql 'postgresql://daixin:daixin88@localhost:5432/ls_eval' -f prisma/seeds/seedData.sql
```

**Redis 隔离方案修正**：v2 正文用 `getRedisClient().select(15)` 切 process-shared singleton，会让同 process 内生产代码也看到 db=15。**改用独立 ioredis 实例**：

```ts
// tests/eval/utils/runtimeGuards.ts
import Redis from 'ioredis'
let evalRedis: Redis | null = null

export function getEvalRedisClient(): Redis {
  if (!evalRedis) {
    evalRedis = new Redis({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
      password: process.env.REDIS_PASSWORD,
      db: 15,
      lazyConnect: false,
    })
  }
  return evalRedis
}

export async function assertEvalRuntime(): Promise<void> {
  const url = process.env.DATABASE_URL ?? ''
  if (!url.includes('ls_eval')) throw new Error("DATABASE_URL 必须包含 'ls_eval'")
  if (!process.env.EVAL_DEEPSEEK_KEY) throw new Error('必须设 EVAL_DEEPSEEK_KEY')
  const redis = getEvalRedisClient()
  await Promise.race([redis.ping(), new Promise((_, rej) => setTimeout(() => rej(new Error('redis ping timeout 3s')), 3000))])
  await redis.flushdb()
  const { prisma } = await import('~~/server/utils/db')
  await prisma.$queryRaw`SELECT 1`
}

export async function teardownEvalRuntime(): Promise<void> {
  if (evalRedis) { await evalRedis.quit(); evalRedis = null }
}
```

## A2.3 Task 4 真实修正（callbacks 注入）

**撤销**正文 Task 4 + A.3 关于扩展 ChatModelConfig + 三家供应商分支的所有内容。**正确做法**：

只改两处 `caseMainAgent.ts`：

```ts
// 1. CaseAgentOptions 加字段（caseMainAgent.ts L46-55）
import type { BaseCallbackHandler } from '@langchain/core/callbacks/base'

export interface CaseAgentOptions {
  userId: number
  caseId: number
  thinking?: boolean
  signal?: AbortSignal
  callbacks?: BaseCallbackHandler[]   // 新增
}

// 2. agent.stream 第二参数加 callbacks（caseMainAgent.ts L181-190）
return agent.stream(input, {
  configurable: { thread_id: sessionId },
  streamMode: ['values', 'messages', 'updates'],
  subgraphs: true,
  encoding: 'text/event-stream',
  recursionLimit: 1000,
  signal,
  callbacks: options.callbacks,        // 新增
})
```

**不改** ChatModelConfig，**不改** 三家供应商分支。LangChain RunnableConfig.callbacks 会自动透传到所有 LLM 调用。

## A2.4 Task 9 buildFixture 真实重写要点

**caseMemories 写入用 raw SQL**（embedding Unsupported vector，Prisma create 不能用）：

```ts
async function seedMemories(caseId: number, rng: () => number): Promise<string[]> {
  const items = [/* 15 条 fact/preference/topic */]
  const ids: string[] = []
  for (const item of items) {
    const id = generateUuidV4(rng)
    const metadata = {
      id, caseId, kind: item.kind, subjectKey: item.subjectKey,
      confidence: 0.8 + rng() * 0.15, source: 'fixture',
      createdAt: new Date().toISOString(),
    }
    await prisma.$executeRawUnsafe(
      `INSERT INTO case_memories (id, text, metadata) VALUES ($1::uuid, $2, $3::jsonb)`,
      id, item.text, JSON.stringify(metadata),
    )
    // 回填 tsv（可选，召回需要 BM25 时才需要；fixture 一期可省）
    await prisma.$executeRawUnsafe(
      `UPDATE case_memories SET tsv = to_tsvector('chinese', COALESCE(text, '')) WHERE id = $1::uuid`,
      id,
    )
    ids.push(id)
  }
  return ids
}
```

**caseMaterials 用 prisma.create**（无 Unsupported 字段，可用 ORM）：

```ts
async function seedMaterials(caseId: number, rng: () => number): Promise<number[]> {
  const items = [
    { name: '甲乙双方主合同.docx', type: 2 },
    { name: '银行回单.pdf', type: 2 },
    { name: '物流签收单.png', type: 3 },
    // ... 8 条
  ]
  const ids: number[] = []
  for (const item of items) {
    const created = await prisma.caseMaterials.create({
      data: {
        caseId, name: item.name, type: item.type,
        summary: `${item.name} 关键事实摘要`, status: 3,
      },
    })
    ids.push(created.id)
  }
  return ids
}
```

**caseAnalyses 用 prisma.create + 真实必填字段**（sessionId 取自当前 case 的 caseSessions，nodeId=1 复用 seedData 的 caseInfoCheck）：

```ts
async function seedAnalysisWithVersions(
  caseId: number, sessionId: string, analysisType: string, rng: () => number,
): Promise<{ activeId: number; historicalId: number }> {
  const NODE_ID_CASE_INFO_CHECK = 1   // 复用 seedData.sql nodes id=1
  const historical = await prisma.caseAnalyses.create({
    data: {
      caseId, sessionId, nodeId: NODE_ID_CASE_INFO_CHECK, analysisType,
      analysisResult: `${analysisType} v1 历史结论：A 方案。`.repeat(8),
      summary: `${analysisType} v1 摘要：A 方案`,
      version: 1, isActive: false, status: 2,
    },
  })
  const active = await prisma.caseAnalyses.create({
    data: {
      caseId, sessionId, nodeId: NODE_ID_CASE_INFO_CHECK, analysisType,
      analysisResult: `${analysisType} v2 当前结论：B 方案。`.repeat(8),
      summary: `${analysisType} v2 摘要：B 方案`,
      version: 2, isActive: true, status: 2,
    },
  })
  return { activeId: active.id, historicalId: historical.id }
}
```

**caseSessions 用 prisma.create**：

```ts
async function seedSession(caseId: number, userId: number, rng: () => number): Promise<string> {
  const sessionId = generateUuidV4(rng)
  await prisma.caseSessions.create({
    data: {
      sessionId, caseId, userId,
      scope: 'case', type: 1, status: 1,
    },
  })
  return sessionId
}
```

**ensureEvalUser 仅 upsert users**（不需要 caseTypes/nodes/models，seedData 已含）：

```ts
async function ensureEvalUser(userId: number): Promise<void> {
  await prisma.users.upsert({
    where: { id: userId },
    update: {},
    create: { id: userId, name: 'eval-user', phone: '13800000000' },
  })
  await prisma.$executeRawUnsafe(
    `SELECT setval(pg_get_serial_sequence('users', 'id'), GREATEST((SELECT MAX(id) FROM users), 1))`,
  )
}
```

**TRUNCATE SQL 表名（snake_case）**：

```ts
const TABLES_TO_CLEAN = [
  'case_analysis_embeddings', 'case_analyses', 'case_memories',
  'case_material_embeddings', 'case_materials', 'case_sessions',
  'agent_runs', 'cases',
] as const
// 不清 case_types / models / nodes（seedData 数据保留）
// 不清 users（保留 eval-user）
```

**caseA build 主结构（修正字段名）**：

```ts
async function buildCaseA(ownerUserId: number, rng: () => number) {
  const created = await prisma.cases.create({
    data: {
      title: '【eval-fixture】民商事合同纠纷（二审）',
      caseTypeId: 1,
      status: 4,
      courtName: '广州市中级人民法院',
      firstInstanceCaseNo: '(2024)粤0103民初1234号',
      secondInstanceCaseNo: '(2025)粤01民终5678号',
      firstInstanceJudge: '张三',
      secondInstanceJudge: '李四',
      userId: ownerUserId,                 // 真实字段名（非 ownerUserId）
    },
  })

  const sessions: string[] = []
  for (let i = 0; i < 3; i++) {
    sessions.push(await seedSession(created.id, ownerUserId, rng))
  }

  const materialIds = await seedMaterials(created.id, rng)
  const memoryIds = await seedMemories(created.id, rng)

  const analysisIds: number[] = []
  const historicalIds: number[] = []
  for (let i = 0; i < 3; i++) {
    const t = ['init_analysis', 'evidence_analysis', 'risk_analysis'][i]!
    const { activeId, historicalId } = await seedAnalysisWithVersions(
      created.id, sessions[i % sessions.length]!, t, rng,
    )
    analysisIds.push(activeId)
    historicalIds.push(historicalId)
  }

  // 旧分析（summary IS NULL）
  const legacyId = (await prisma.caseAnalyses.create({
    data: {
      caseId: created.id,
      sessionId: sessions[0]!,
      nodeId: 1,
      analysisType: 'legacy_analysis',
      analysisResult: 'M4 上线前旧分析。',
      summary: null,
      version: 1, isActive: true, status: 2,
    },
  })).id

  return {
    id: created.id, ownerId: ownerUserId,
    materialIds, memoryIds,
    analysisIds, analysisHistoricalIds: historicalIds, analysisLegacyId: legacyId,
    sessions,
  }
}
```

**FixtureResult 类型相应改为 `materialIds: number[]` / `analysisIds: number[]`** 等（不再是 string[]）。

## A2.5 Task 11 datasetRunner 真实修正

`RunCaseInput` **删除 agentName 字段**（CaseAgentOptions 没有，runCaseChat 也不接受）。改为：

```ts
export interface RunCaseInput {
  caseId: number
  userId: number
  sessionId: string
  question: string
  isWarmup?: boolean
}

export async function runOneChat(input: RunCaseInput, handler: LLMUsageCallbackHandler) {
  handler.setWarmup(input.isWarmup ?? false)
  const before = handler.getRecords().length
  const startedAt = Date.now()

  const stream = await runCaseChat(input.sessionId, input.question, {
    caseId: input.caseId,
    userId: input.userId,
    callbacks: [handler],          // A2.3 改造后能透传
  })

  const consumed = await consumeAgentSseStream(stream)
  const latencyMs = Date.now() - startedAt

  const newRecords = handler.getRecords().slice(before)
  const promptTokens = newRecords.reduce((s, r) => s + (r.usage.prompt_tokens ?? r.usage.input_tokens ?? 0), 0)
  const cacheHitTokens = newRecords.reduce((s, r) =>
    s + (r.usage.prompt_cache_hit_tokens ?? r.usage.cache_read_input_tokens ?? r.usage.prompt_tokens_details?.cached_tokens ?? 0), 0)

  return {
    threadId: consumed.threadId,
    answer: consumed.finalAnswer,
    latencyMs, promptTokens, cacheHitTokens,
  }
}
```

testDataset.ts 不需要 `moduleId` 字段，改用 `sessionIndex: 0 | 1 | 2` 指向 fx.caseA.sessions 数组。

## A2.6 Task 19 Security 真实修正

```ts
// sec-archived-updateCase（真实签名 2 参数）
async run(fx) {
  const { updateCaseService } = await import('~~/server/services/case/case.service')
  try {
    await updateCaseService(fx.caseC.id, { title: '尝试改' })
    return { pass: false, detail: 'service 未挡 ARCHIVED' }
  } catch (e: any) {
    return { pass: true, detail: `正确拒绝：${e?.message ?? e}` }
  }
}
```

`sec-archived-updateCase` 应当 PASS（updateCaseService 真实有 isCaseReadOnly 守卫）。

`sec-archived-write-memory` / `sec-archived-update-memory` 预期 FAIL（业务 bug，service 无守卫，已知）。

`sec-archived-initAnalysis` —— **删除该断言（已锁定）**：项目无独立 `initAnalysisService`，init 流程在 API handler 层；HTTP 测试方案违反先前架构 B 简化决策。删除后业务规则覆盖由 `sec-archived-updateCase` + `sec-archived-write-memory` + `sec-archived-update-memory` 三项继续承担（M3 spec §12 ARCHIVED 守卫主线不丢）。

总指标数：**26 → 25**（Security 类 6 → 5）。spec §3.1 表格相应更新。

## A2.7 实施要点提醒

1. **callbacks 注入用 RunnableConfig**（不改 ChatModelConfig）
2. **caseMemories 必须 raw SQL**（embedding Unsupported）
3. **fixture 复用 seedData**（不造 nodes/caseTypes/models）
4. **caseSessions FK target**：caseAnalyses 的 sessionId 必须先存在 case_sessions 表
5. **users 必填 name**（不是 nickname）
6. **updateCaseService 2 参数**（不是 3）
7. **Security 类减一项**（initAnalysis 无独立 service 入口）

## A2.8 已锁定决策

- `sec-archived-initAnalysis` 删除，总指标 25 项（Security 类 5 项）
- spec §3.1 表格中 Security 行从 6 改 5，合计 25/CRITICAL 14

---

**Plan v2 + 附录 A2 已就绪。Two execution options:**

**1. Subagent-Driven（推荐）** —— 每 Task 派 fresh subagent，做完两阶段 review 再下一个

**2. Inline Execution** —— 本 session batch 跑，每几个 Task checkpoint

**Which approach?**
