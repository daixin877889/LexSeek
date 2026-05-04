# Langfuse 集成 PR 1 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成 Langfuse 集成的基建落地——OTel SDK 启动、ALS 业务上下文透传、chatModelFactory ES Proxy、PII 脱敏纯函数 4 件套。**业务侧不接入**（PR 2 才接），本 PR 完成后 dev 启动应"无 trace 但功能正常"。

**Architecture:** 在 chatModelFactory 出口包 ES Proxy，从 AsyncLocalStorage 取业务上下文同步注入 RunnableConfig（runName / tags / camelCase metadata）；OTel NodeSDK 通过全局 tracer provider 接管 trace 上送；mask + shouldExportSpan 钩子挂在 LangfuseSpanProcessor 上做 PII 脱敏与 nostream 豁免。

**Tech Stack:** Nuxt 4 / Nitro / TypeScript / `@langfuse/langchain` v5 + `@langfuse/otel` v5 + `@langfuse/tracing` v5 + `@opentelemetry/sdk-node` / Vitest

**Spec 来源:** `docs/superpowers/specs/2026-05-04-langfuse-integration-design.md`（v3）

---

## 文件结构总览

PR 1 涉及文件（按职责分组）：

| 路径 | 类型 | 一句话职责 |
|------|------|-----------|
| `server/lib/langfuse/types.ts` | 新增 | 类型定义（LangfuseTraceContext / LangfuseVertical）+ deriveScope helper |
| `server/lib/langfuse/redactPII.ts` | 新增 | PII 脱敏纯函数 + redactDeep 递归 helper |
| `server/lib/langfuse/context.ts` | 新增 | AsyncLocalStorage store + withLangfuseContext / getLangfuseContext |
| `server/lib/langfuse/client.ts` | 新增 | CallbackHandler 单例 + noop 兜底 + getLangfuseRuntimeConfig 缓存 |
| `server/lib/langfuse/modelProxy.ts` | 新增 | wrapWithLangfuse(model) ES Proxy 拦截 invoke/stream/batch/streamEvents |
| `server/lib/langfuse/index.ts` | 新增 | barrel 导出 |
| `server/middleware/04.langfuseContext.ts` | 新增 | HTTP 入口处 enterWith ALS 根上下文 |
| `server/plugins/langfuse-otel.ts` | 新增 | NodeSDK + LangfuseSpanProcessor + close hook + tracingEnabled gate |
| `server/services/node/chatModelFactory.ts` | 改造 | 出口包 wrapWithLangfuse |
| `server/services/agent-platform/tools/invokeNodeJson.ts` | 改造 | tag `langsmith:nostream` → `langfuse:nostream` |
| `nuxt.config.ts` | 改造 | runtimeConfig.langfuse 段 |
| `.env.example` | 改造 | 新增 6 个 LANGFUSE_* env |
| `tests/_infra/global-setup.ts` | 改造 | 强制 `LANGFUSE_TRACING_ENABLED=false` |
| `.claude/rules/git.md` | 改造 | scope 列表追加 `observability` |
| `tests/server/lib/langfuse/*.test.ts` | 新增 | 5 个核心模块单测 |

---

## Task 1：scope 规则 + ALS 同步语义验证 + 装包

**Files:**
- Modify: `.claude/rules/git.md`
- Create: `tests/server/lib/langfuse/als-sync.test.ts`
- Modify: `package.json`（通过 bun add 间接修改）

- [ ] **Step 1.1：在 `.claude/rules/git.md` 的 scope 列表追加 `observability`**

打开 `.claude/rules/git.md`，找到 "Scope 作用域" 段落，在最后一行 `- contract` 后追加：

```markdown
- `observability` - 可观测性 / Langfuse / OTel
```

- [ ] **Step 1.2：写 ALS 同步语义验证测试**

新建 `tests/server/lib/langfuse/als-sync.test.ts`，完整内容：

```ts
import { AsyncLocalStorage } from 'node:async_hooks'
import { describe, it, expect } from 'vitest'

describe('Node.js AsyncLocalStorage 同步语义验证', () => {
  const als = new AsyncLocalStorage<{ marker: string }>()

  it('als.run 内同步函数能立即取到 store', () => {
    let captured: string | undefined
    als.run({ marker: 'sync' }, () => {
      captured = als.getStore()?.marker
    })
    expect(captured).toBe('sync')
  })

  it('als.run 内 await Promise 后仍能取到 store', async () => {
    let captured: string | undefined
    await als.run({ marker: 'async' }, async () => {
      await Promise.resolve()
      captured = als.getStore()?.marker
    })
    expect(captured).toBe('async')
  })

  it('als.enterWith 后续同步代码能取到 store', () => {
    function setupAndRead() {
      als.enterWith({ marker: 'enter-with' })
      return als.getStore()?.marker
    }
    // 包在 als.run 里以避免污染其他测试
    let captured: string | undefined
    als.run({ marker: 'outer' }, () => {
      captured = setupAndRead()
    })
    expect(captured).toBe('enter-with')
  })
})
```

- [ ] **Step 1.3：跑测试，应全部 PASS（Node 18+ ALS 标准行为）**

Run:
```bash
npx vitest run tests/server/lib/langfuse/als-sync.test.ts --reporter=verbose
```
Expected: 3 tests passed

- [ ] **Step 1.4：装 6 个 npm 包**

Run:
```bash
bun add @langfuse/langchain @langfuse/core @langfuse/otel @langfuse/tracing @opentelemetry/api @opentelemetry/sdk-node
```
Expected: 6 packages installed; `package.json` dependencies 段新增对应条目。

> **不要**移除 `langsmith`——它是直接依赖且可能被 `deepagents` 内部使用。移除工作放到 PR 3 验证 deepagents 兼容后。

- [ ] **Step 1.5：跑全套类型检查不回归**

Run:
```bash
bun run typecheck
```
Expected: 0 type errors

- [ ] **Step 1.6：commit**

```bash
git add .claude/rules/git.md tests/server/lib/langfuse/als-sync.test.ts package.json bun.lock
git commit -m "$(cat <<'EOF'
feat(observability): scope 规则与 ALS 同步语义验证测试 + 装 Langfuse SDK

- .claude/rules/git.md 追加 observability scope，让规则先于业务 commit 落地
- 验证 Node.js AsyncLocalStorage 在 run / enterWith / 跨 await 三种场景下的同步保持语义
- 装 @langfuse/langchain@5 全套 + OpenTelemetry SDK
EOF
)"
```

---

## Task 2：types.ts + redactPII.ts + index.ts barrel

**Files:**
- Create: `server/lib/langfuse/types.ts`
- Create: `server/lib/langfuse/redactPII.ts`
- Create: `server/lib/langfuse/index.ts`
- Create: `tests/server/lib/langfuse/redactPII.test.ts`

- [ ] **Step 2.1：写 `types.ts`**

新建 `server/lib/langfuse/types.ts`，完整内容：

```ts
/**
 * Langfuse 集成 - 类型定义
 *
 * - LangfuseTraceContext: AsyncLocalStorage store 形态
 * - LangfuseVertical: 12 个细分业务维度（spec D6 决策）
 * - deriveScope: vertical → scope 映射
 */

export type LangfuseTraceContext = {
  /** HTTP 请求级（中间件填） */
  requestId: string

  /** 用户 ID（鉴权后填，公开 API 例外） */
  userId?: number

  /** agent 执行级（agentRun.service 填） */
  runId?: string
  sessionId?: string
  threadId?: string

  /** 业务实体（按场景填，可同时多个） */
  caseId?: number
  reviewId?: string
  draftId?: string
  materialId?: string

  /** 业务维度 */
  vertical?: LangfuseVertical
}

export type LangfuseVertical =
  | 'case-main'
  | 'case-analysis'
  | 'case-module'
  | 'contract'
  | 'document'
  | 'legal-assistant'
  | 'init-analysis'
  | 'extract'
  | 'intent-classifier'
  | 'material-summary'
  | 'sub-agent'
  | 'invoke-node-json'

export type LangfuseScope =
  | 'CASE'
  | 'CONTRACT'
  | 'DOCUMENT'
  | 'ASSISTANT'
  | 'MATERIAL'
  | 'RETRIEVAL'
  | 'TOOL'

export function deriveScope(vertical: LangfuseVertical): LangfuseScope {
  switch (vertical) {
    case 'case-main':
    case 'case-analysis':
    case 'case-module':
    case 'init-analysis':
    case 'extract':
      return 'CASE'
    case 'contract':
      return 'CONTRACT'
    case 'document':
      return 'DOCUMENT'
    case 'legal-assistant':
      return 'ASSISTANT'
    case 'material-summary':
      return 'MATERIAL'
    case 'intent-classifier':
      return 'RETRIEVAL'
    case 'sub-agent':
    case 'invoke-node-json':
      return 'TOOL'
  }
}

export type LangfuseRuntimeConfig = {
  publicKey: string
  secretKey: string
  baseUrl: string
  tracingEnabled: boolean
  maskPII: boolean
  environment: 'development' | 'staging' | 'production'
  gitSha: string
}
```

- [ ] **Step 2.2：写 redactPII 单测（先写测试，TDD）**

新建 `tests/server/lib/langfuse/redactPII.test.ts`，完整内容：

```ts
import { describe, it, expect } from 'vitest'
import { AIMessage, HumanMessage } from '@langchain/core/messages'
import { redactPII, redactDeep } from '~~/server/lib/langfuse/redactPII'

describe('redactPII（标量字符串）', () => {
  it.each([
    // 身份证：有效校验码 → 脱敏
    ['身份证 110101199003078515', '身份证 ***IDCARD***'],
    // 身份证：无效校验码 → 不动（避免误伤）
    ['编号 110101199003078500', '编号 110101199003078500'],
    // 金额数字串不应被当成身份证
    ['金额 110000 元', '金额 110000 元'],
    // 手机号：独立词
    ['电话 13800138000', '电话 ***PHONE***'],
    ['Tel:13800138000', 'Tel:***PHONE***'],
    // 手机号：被数字粘连不应触发
    ['合同编号 13800138000111222', '合同编号 13800138000111222'],
    // 邮箱
    ['请发邮箱 abc@def.com 收件', '请发邮箱 ***EMAIL*** 收件'],
    // 银行卡：16-19 位独立数字串
    ['卡号 6225881234567890', '卡号 ***BANKCARD***'],
    ['卡号 6225881234567890123', '卡号 ***BANKCARD***'],
    // 银行卡：被数字粘连不应触发
    ['条款编号 622588123456789012345', '条款编号 622588123456789012345'],
    // 多种 PII 混合
    [
      '客户王某身份证 110101199003078515 手机 13800138000 邮箱 a@b.com',
      '客户王某身份证 ***IDCARD*** 手机 ***PHONE*** 邮箱 ***EMAIL***',
    ],
  ])('redactPII(%j) → %j', (input, expected) => {
    expect(redactPII(input)).toBe(expected)
  })
})

describe('redactDeep（嵌套结构）', () => {
  it('null / undefined / 数字 / 布尔原样返回', () => {
    expect(redactDeep(null)).toBe(null)
    expect(redactDeep(undefined)).toBe(undefined)
    expect(redactDeep(42)).toBe(42)
    expect(redactDeep(true)).toBe(true)
  })

  it('数组里的字符串脱敏', () => {
    expect(redactDeep(['手机 13800138000', '正常文本'])).toEqual([
      '手机 ***PHONE***',
      '正常文本',
    ])
  })

  it('LangChain messages 风格的 plain 对象数组里身份证号也脱敏', () => {
    const input = [
      { role: 'user', content: '我的身份证号是 110101199003078515' },
      { role: 'assistant', content: '已记录' },
    ]
    expect(redactDeep(input)).toEqual([
      { role: 'user', content: '我的身份证号是 ***IDCARD***' },
      { role: 'assistant', content: '已记录' },
    ])
  })

  it('AIMessage 实例的 content 字符串字段脱敏', () => {
    const msg = new AIMessage('客户手机 13800138000 已记录')
    const result = redactDeep(msg) as AIMessage
    expect(result).toBeInstanceOf(AIMessage)
    expect(result.content).toBe('客户手机 ***PHONE*** 已记录')
  })

  it('HumanMessage content 是数组（multimodal）时递归处理', () => {
    const msg = new HumanMessage({
      content: [
        { type: 'text', text: '邮箱 abc@def.com' },
        { type: 'image_url', image_url: { url: 'https://x.com' } },
      ],
    })
    const result = redactDeep(msg) as HumanMessage
    expect(result).toBeInstanceOf(HumanMessage)
    expect(result.content).toEqual([
      { type: 'text', text: '邮箱 ***EMAIL***' },
      { type: 'image_url', image_url: { url: 'https://x.com' } },
    ])
  })

  it('深度嵌套对象', () => {
    const input = {
      messages: [
        {
          content: '身份证 110101199003078515',
          metadata: { phone: '13800138000' },
        },
      ],
    }
    expect(redactDeep(input)).toEqual({
      messages: [
        {
          content: '身份证 ***IDCARD***',
          metadata: { phone: '***PHONE***' },
        },
      ],
    })
  })
})
```

- [ ] **Step 2.3：跑测试，应全部 FAIL（redactPII / redactDeep 还没实现）**

Run:
```bash
npx vitest run tests/server/lib/langfuse/redactPII.test.ts --reporter=verbose
```
Expected: FAIL — Cannot find module `~~/server/lib/langfuse/redactPII`

- [ ] **Step 2.4：实现 `redactPII.ts`**

新建 `server/lib/langfuse/redactPII.ts`，完整内容：

```ts
/**
 * PII 脱敏纯函数
 *
 * - redactPII(text): 对单个字符串应用 4 类 PII 替换
 * - redactDeep(value): 递归遍历 string / array / object / LangChain BaseMessage 实例
 *
 * 顺序应用（避免误伤）：
 *   1. 身份证（带校验码验证）→ ***IDCARD***
 *   2. 银行卡（16-19 位独立数字）→ ***BANKCARD***
 *   3. 手机号（1[3-9]\d{9} 独立词）→ ***PHONE***
 *   4. 邮箱 → ***EMAIL***
 *
 * 手机号核心正则 1[3-9]\d{9} 与 shared/utils/phone.ts 的 validatePhone 一致。
 */

import { BaseMessage } from '@langchain/core/messages'

// 国标 GB 11643-1999 18 位身份证校验
const ID_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
const ID_CHECK_CODES = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2']

function isValidIdCard(id: string): boolean {
  if (!/^\d{17}[\dXx]$/.test(id)) return false
  let sum = 0
  for (let i = 0; i < 17; i++) {
    sum += Number.parseInt(id[i]!, 10) * ID_WEIGHTS[i]!
  }
  const expected = ID_CHECK_CODES[sum % 11]
  return id[17]!.toUpperCase() === expected
}

const ID_CARD_PATTERN
  = /\b[1-9]\d{5}(?:18|19|20)\d{2}(?:0[1-9]|1[012])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b/g
const BANKCARD_PATTERN = /(?<!\d)\d{16,19}(?!\d)/g
const PHONE_PATTERN = /(?<!\d)1[3-9]\d{9}(?!\d)/g
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g

export function redactPII(text: string): string {
  return text
    .replace(ID_CARD_PATTERN, m => (isValidIdCard(m) ? '***IDCARD***' : m))
    .replace(BANKCARD_PATTERN, '***BANKCARD***')
    .replace(PHONE_PATTERN, '***PHONE***')
    .replace(EMAIL_PATTERN, '***EMAIL***')
}

export function redactDeep(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return redactPII(value)
  if (typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(redactDeep)

  if (value instanceof BaseMessage) {
    // 浅拷贝实例（保留原型链 + 类标识），仅替换 content
    const cloned = Object.assign(Object.create(Object.getPrototypeOf(value)), value)
    if (typeof cloned.content === 'string') {
      cloned.content = redactPII(cloned.content)
    }
    else if (Array.isArray(cloned.content)) {
      cloned.content = cloned.content.map(redactDeep)
    }
    return cloned
  }

  // 普通对象浅遍历
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = redactDeep(v)
  }
  return out
}
```

- [ ] **Step 2.5：跑测试，应全部 PASS**

Run:
```bash
npx vitest run tests/server/lib/langfuse/redactPII.test.ts --reporter=verbose
```
Expected: All passed (16+ assertions)

- [ ] **Step 2.6：写 `index.ts` barrel**

新建 `server/lib/langfuse/index.ts`，完整内容：

```ts
/**
 * Langfuse 集成 barrel 导出
 *
 * 业务侧只需 import from '~~/server/lib/langfuse'
 */

export type { LangfuseRuntimeConfig, LangfuseScope, LangfuseTraceContext, LangfuseVertical } from './types'
export { deriveScope } from './types'
export { redactDeep, redactPII } from './redactPII'
```

- [ ] **Step 2.7：跑 typecheck**

Run:
```bash
bun run typecheck
```
Expected: 0 type errors

- [ ] **Step 2.8：commit**

```bash
git add server/lib/langfuse/types.ts server/lib/langfuse/redactPII.ts server/lib/langfuse/index.ts tests/server/lib/langfuse/redactPII.test.ts
git commit -m "$(cat <<'EOF'
feat(observability): 新增 PII 脱敏纯函数与递归 helper

- redactPII 4 类规则（身份证 18 位+校验码 / 手机号 / 邮箱 / 银行卡），手机号核心正则与 shared/utils/phone.ts 同款
- redactDeep 递归处理 string / array / plain object / LangChain BaseMessage 实例
- types.ts 集中定义 LangfuseTraceContext / LangfuseVertical / deriveScope
- index.ts barrel 统一导出
EOF
)"
```

---

## Task 3：context.ts（ALS store + helpers）

**Files:**
- Create: `server/lib/langfuse/context.ts`
- Modify: `server/lib/langfuse/index.ts`
- Create: `tests/server/lib/langfuse/context.test.ts`

- [ ] **Step 3.1：写测试**

新建 `tests/server/lib/langfuse/context.test.ts`，完整内容：

```ts
import { describe, expect, it } from 'vitest'
import { getLangfuseContext, withLangfuseContext } from '~~/server/lib/langfuse/context'

describe('Langfuse ALS context', () => {
  it('在 with 包裹外取不到上下文', () => {
    expect(getLangfuseContext()).toBeUndefined()
  })

  it('在 with 包裹内能取到完整上下文', async () => {
    const captured = await withLangfuseContext(
      { requestId: 'req-1', userId: 42, vertical: 'case-analysis' },
      async () => getLangfuseContext(),
    )
    expect(captured).toMatchObject({
      requestId: 'req-1',
      userId: 42,
      vertical: 'case-analysis',
    })
  })

  it('嵌套调用时内层增量补字段，不覆盖外层', async () => {
    const captured = await withLangfuseContext(
      { requestId: 'req-1', userId: 42, vertical: 'case-analysis' },
      async () => withLangfuseContext(
        { caseId: 100, vertical: 'init-analysis' },
        async () => getLangfuseContext(),
      ),
    )
    expect(captured).toMatchObject({
      requestId: 'req-1',
      userId: 42,
      vertical: 'init-analysis', // 内层覆盖
      caseId: 100, // 内层补字段
    })
  })

  it('patch 中的 undefined 字段不应擦除已有值', async () => {
    const captured = await withLangfuseContext(
      { requestId: 'req-1', userId: 42 },
      async () => withLangfuseContext(
        { userId: undefined, caseId: 100 },
        async () => getLangfuseContext(),
      ),
    )
    expect(captured?.userId).toBe(42)
    expect(captured?.caseId).toBe(100)
  })

  it('await Promise 后仍能取到上下文', async () => {
    const captured = await withLangfuseContext(
      { requestId: 'req-1' },
      async () => {
        await Promise.resolve()
        await new Promise(resolve => setTimeout(resolve, 1))
        return getLangfuseContext()
      },
    )
    expect(captured?.requestId).toBe('req-1')
  })
})
```

- [ ] **Step 3.2：跑测试，应 FAIL**

Run:
```bash
npx vitest run tests/server/lib/langfuse/context.test.ts --reporter=verbose
```
Expected: FAIL — Cannot find module `context`

- [ ] **Step 3.3：实现 `context.ts`**

新建 `server/lib/langfuse/context.ts`，完整内容：

```ts
/**
 * Langfuse 业务上下文（AsyncLocalStorage）
 *
 * - withLangfuseContext(patch, fn): 包裹一段异步代码；patch 增量合入当前上下文
 * - getLangfuseContext(): 同步取当前上下文，无则 undefined
 *
 * 同步语义：modelProxy 在 invoke 拦截器内同步读 ALS，行为见 als-sync.test.ts
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import type { LangfuseTraceContext } from './types'

const storage = new AsyncLocalStorage<LangfuseTraceContext>()

export function getLangfuseContext(): LangfuseTraceContext | undefined {
  return storage.getStore()
}

export async function withLangfuseContext<T>(
  patch: Partial<LangfuseTraceContext>,
  fn: () => Promise<T>,
): Promise<T> {
  const current = storage.getStore()
  const merged: LangfuseTraceContext = {
    requestId: '',
    ...current,
    ...stripUndefined(patch),
  }
  return storage.run(merged, fn)
}

/**
 * Nitro 中间件用：在请求最外层 enterWith 起根上下文。
 * 不需要 callback 包裹（H3 middleware 是顺序执行的）。
 */
export function enterLangfuseContext(patch: Partial<LangfuseTraceContext>): void {
  const current = storage.getStore()
  const merged: LangfuseTraceContext = {
    requestId: '',
    ...current,
    ...stripUndefined(patch),
  }
  storage.enterWith(merged)
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  const out = {} as Partial<T>
  for (const [k, v] of Object.entries(obj) as Array<[keyof T, T[keyof T]]>) {
    if (v !== undefined) out[k] = v
  }
  return out
}
```

- [ ] **Step 3.4：跑测试，应 PASS**

Run:
```bash
npx vitest run tests/server/lib/langfuse/context.test.ts --reporter=verbose
```
Expected: All passed

- [ ] **Step 3.5：更新 `index.ts` barrel 导出 context**

打开 `server/lib/langfuse/index.ts`，在末尾追加一行：

```ts
export { enterLangfuseContext, getLangfuseContext, withLangfuseContext } from './context'
```

- [ ] **Step 3.6：跑 typecheck**

Run:
```bash
bun run typecheck
```
Expected: 0 type errors

- [ ] **Step 3.7：commit**

```bash
git add server/lib/langfuse/context.ts server/lib/langfuse/index.ts tests/server/lib/langfuse/context.test.ts
git commit -m "$(cat <<'EOF'
feat(observability): 新增 ALS 上下文与 with 包裹 helper

- AsyncLocalStorage<LangfuseTraceContext> 单例 + with/get/enter 三个 helper
- patch 增量合并，undefined 字段不擦除已有值
- 嵌套 with 内层覆盖外层 vertical，业务实体字段累加
EOF
)"
```

---

## Task 4：client.ts（CallbackHandler 单例 + noop 兜底 + 配置缓存）

**Files:**
- Create: `server/lib/langfuse/client.ts`
- Modify: `server/lib/langfuse/index.ts`
- Create: `tests/server/lib/langfuse/client.test.ts`

- [ ] **Step 4.1：写测试**

新建 `tests/server/lib/langfuse/client.test.ts`，完整内容：

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  _resetLangfuseClientCache,
  getLangfuseHandler,
  getLangfuseRuntimeConfig,
} from '~~/server/lib/langfuse/client'

describe('getLangfuseRuntimeConfig', () => {
  afterEach(() => {
    _resetLangfuseClientCache()
  })

  it('useRuntimeConfig 不可用时 fallback 到默认值（测试环境）', () => {
    const cfg = getLangfuseRuntimeConfig()
    expect(cfg.tracingEnabled).toBe(false)
    expect(cfg.maskPII).toBe(true)
    expect(cfg.environment).toBe('development')
    expect(cfg.publicKey).toBe('')
    expect(cfg.secretKey).toBe('')
    expect(cfg.baseUrl).toBe('')
    expect(cfg.gitSha).toBe('')
  })

  it('多次调用返回同一缓存对象', () => {
    const cfg1 = getLangfuseRuntimeConfig()
    const cfg2 = getLangfuseRuntimeConfig()
    expect(cfg1).toBe(cfg2)
  })
})

describe('getLangfuseHandler', () => {
  afterEach(() => {
    _resetLangfuseClientCache()
  })

  it('多次调用返回同一单例', () => {
    const h1 = getLangfuseHandler()
    const h2 = getLangfuseHandler()
    expect(h1).toBe(h2)
  })

  it('handler 暴露的 callback hook 方法可调用且不抛异常（测试环境是 noop）', () => {
    const h = getLangfuseHandler() as Record<string, (...args: unknown[]) => unknown>
    // LangChain CallbackHandler 至少实现 handleLLMStart 等钩子；noop 兜底应让任意调用安全返回
    expect(() => h.handleLLMStart?.({}, [], 'r1')).not.toThrow()
    expect(() => h.handleChainStart?.({}, {}, 'r1')).not.toThrow()
  })
})
```

- [ ] **Step 4.2：跑测试，应 FAIL**

Run:
```bash
npx vitest run tests/server/lib/langfuse/client.test.ts --reporter=verbose
```
Expected: FAIL — Cannot find module `client`

- [ ] **Step 4.3：实现 `client.ts`**

新建 `server/lib/langfuse/client.ts`，完整内容：

```ts
/**
 * Langfuse 客户端 - 单例 + 兜底
 *
 * - getLangfuseHandler(): 返回 CallbackHandler 单例；初始化失败 → noop handler
 * - getLangfuseRuntimeConfig(): 返回 runtimeConfig.langfuse 缓存视图；测试环境 fallback 到默认
 * - _resetLangfuseClientCache(): 仅供测试清空缓存
 */

import { CallbackHandler } from '@langfuse/langchain'
import type { LangfuseRuntimeConfig } from './types'

let cachedConfig: LangfuseRuntimeConfig | undefined
let cachedHandler: CallbackHandler | undefined

const DEFAULT_CONFIG: LangfuseRuntimeConfig = {
  publicKey: '',
  secretKey: '',
  baseUrl: '',
  tracingEnabled: false,
  maskPII: true,
  environment: 'development',
  gitSha: '',
}

export function getLangfuseRuntimeConfig(): LangfuseRuntimeConfig {
  if (cachedConfig) return cachedConfig
  try {
    const raw = useRuntimeConfig().langfuse as Partial<LangfuseRuntimeConfig> | undefined
    cachedConfig = {
      ...DEFAULT_CONFIG,
      ...raw,
    }
  }
  catch {
    // 测试 / 非 Nitro 上下文 fallback
    cachedConfig = { ...DEFAULT_CONFIG }
  }
  return cachedConfig
}

export function getLangfuseHandler(): CallbackHandler {
  if (cachedHandler) return cachedHandler
  try {
    cachedHandler = new CallbackHandler()
  }
  catch (err) {
    logger.warn('[langfuse] CallbackHandler 初始化失败，回退到 noop:', err)
    cachedHandler = createNoopHandler()
  }
  return cachedHandler
}

function createNoopHandler(): CallbackHandler {
  // 用 Proxy 让任意方法调用都返回一个 no-op
  return new Proxy({} as CallbackHandler, {
    get: (_target, _prop) => () => undefined,
  })
}

export function _resetLangfuseClientCache(): void {
  cachedConfig = undefined
  cachedHandler = undefined
}
```

- [ ] **Step 4.4：跑测试，应 PASS**

Run:
```bash
npx vitest run tests/server/lib/langfuse/client.test.ts --reporter=verbose
```
Expected: All passed

- [ ] **Step 4.5：更新 `index.ts` barrel**

打开 `server/lib/langfuse/index.ts`，在末尾追加：

```ts
export { getLangfuseHandler, getLangfuseRuntimeConfig } from './client'
```

> `_resetLangfuseClientCache` 不导出（仅内部测试用，业务代码导入路径走 `'./client'` 直接 import）。

- [ ] **Step 4.6：跑 typecheck**

Run:
```bash
bun run typecheck
```
Expected: 0 type errors

- [ ] **Step 4.7：commit**

```bash
git add server/lib/langfuse/client.ts server/lib/langfuse/index.ts tests/server/lib/langfuse/client.test.ts
git commit -m "$(cat <<'EOF'
feat(observability): 新增 Langfuse 客户端单例与 noop 兜底

- CallbackHandler 单例 + try/catch noop fallback（初始化失败不影响主流程）
- getLangfuseRuntimeConfig 缓存版本，测试环境 fallback 到默认值，避免 mock useRuntimeConfig
- _resetLangfuseClientCache 仅供单测清缓存
EOF
)"
```

---

## Task 5：modelProxy.ts（ES Proxy 拦截 invoke / stream / batch / streamEvents）

**Files:**
- Create: `server/lib/langfuse/modelProxy.ts`
- Modify: `server/lib/langfuse/index.ts`
- Create: `tests/server/lib/langfuse/modelProxy.test.ts`

- [ ] **Step 5.1：写测试**

新建 `tests/server/lib/langfuse/modelProxy.test.ts`，完整内容：

```ts
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { _resetLangfuseClientCache } from '~~/server/lib/langfuse/client'
import { withLangfuseContext } from '~~/server/lib/langfuse/context'
import { wrapWithLangfuse } from '~~/server/lib/langfuse/modelProxy'

function createFakeModel() {
  return {
    invoke: vi.fn().mockResolvedValue({ content: 'ok' }),
    stream: vi.fn().mockResolvedValue([] as unknown[]),
    batch: vi.fn().mockResolvedValue([{ content: 'ok' }]),
    streamEvents: vi.fn().mockResolvedValue([] as unknown[]),
    nonInterceptedMethod: vi.fn().mockReturnValue('raw'),
  } as unknown as BaseChatModel & Record<string, ReturnType<typeof vi.fn>>
}

describe('wrapWithLangfuse', () => {
  afterEach(() => {
    _resetLangfuseClientCache()
  })

  it('invoke 注入完整 RunnableConfig（runName / tags 顶层 / camelCase metadata）', async () => {
    const model = createFakeModel()
    const wrapped = wrapWithLangfuse(model)

    await withLangfuseContext(
      {
        requestId: 'req-1',
        userId: 42,
        sessionId: 'sess-1',
        runId: 'run-1',
        caseId: 100,
        vertical: 'case-analysis',
      },
      async () => wrapped.invoke('hello'),
    )

    expect(model.invoke).toHaveBeenCalledTimes(1)
    const [input, config] = model.invoke.mock.calls[0]!
    expect(input).toBe('hello')
    expect(config.runName).toBe('case-analysis')
    expect(config.tags).toContain('case-analysis')
    expect(config.tags).toContain('development')
    expect(config.metadata.langfuseUserId).toBe('42')
    expect(config.metadata.langfuseSessionId).toBe('sess-1')
    expect(config.metadata.requestId).toBe('req-1')
    expect(config.metadata.runId).toBe('run-1')
    expect(config.metadata.caseId).toBe(100)
    expect(config.metadata.scope).toBe('CASE')
    expect(config.metadata.environment).toBe('development')
    expect(Array.isArray(config.callbacks)).toBe(true)
  })

  it('已存在的 callbacks / tags / metadata 应合并而不是覆盖', async () => {
    const model = createFakeModel()
    const wrapped = wrapWithLangfuse(model)
    const existingCallback = { handleLLMStart: vi.fn() }

    await withLangfuseContext(
      { requestId: 'req-1', vertical: 'contract' },
      async () => wrapped.invoke('hi', {
        tags: ['custom-tag'],
        callbacks: [existingCallback],
        metadata: { customField: 'x' },
      }),
    )

    const [, config] = model.invoke.mock.calls[0]!
    expect(config.tags).toContain('custom-tag')
    expect(config.tags).toContain('contract')
    expect(config.callbacks).toContain(existingCallback)
    expect(config.metadata.customField).toBe('x')
    expect(config.metadata.scope).toBe('CONTRACT')
  })

  it('用户传入的 runName 优先于默认 vertical', async () => {
    const model = createFakeModel()
    const wrapped = wrapWithLangfuse(model)

    await withLangfuseContext(
      { requestId: 'req-1', vertical: 'contract' },
      async () => wrapped.invoke('hi', { runName: 'custom-name' }),
    )

    const [, config] = model.invoke.mock.calls[0]!
    expect(config.runName).toBe('custom-name')
  })

  it('无 ALS 上下文时仍能调通（metadata 字段 undefined 即可，不抛异常）', async () => {
    const model = createFakeModel()
    const wrapped = wrapWithLangfuse(model)

    await wrapped.invoke('hi')

    expect(model.invoke).toHaveBeenCalledTimes(1)
    const [, config] = model.invoke.mock.calls[0]!
    expect(config.metadata.langfuseUserId).toBeUndefined()
    expect(config.metadata.langfuseSessionId).toBeUndefined()
  })

  it('stream / batch / streamEvents 同样被拦截', async () => {
    const model = createFakeModel()
    const wrapped = wrapWithLangfuse(model)

    await withLangfuseContext(
      { requestId: 'req-1', vertical: 'document' },
      async () => {
        await wrapped.stream('a')
        await wrapped.batch(['b'])
        ;(wrapped as Record<string, (...args: unknown[]) => Promise<unknown>>)
          .streamEvents('c')
      },
    )

    for (const fn of [model.stream, model.batch, model.streamEvents]) {
      expect(fn).toHaveBeenCalledTimes(1)
      const [, config] = fn.mock.calls[0]!
      expect(config.runName).toBe('document')
      expect(config.metadata.scope).toBe('DOCUMENT')
    }
  })

  it('未拦截的方法保持原行为', () => {
    const model = createFakeModel()
    const wrapped = wrapWithLangfuse(model) as unknown as { nonInterceptedMethod: () => string }
    expect(wrapped.nonInterceptedMethod()).toBe('raw')
    expect(model.nonInterceptedMethod).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 5.2：跑测试，应 FAIL**

Run:
```bash
npx vitest run tests/server/lib/langfuse/modelProxy.test.ts --reporter=verbose
```
Expected: FAIL — Cannot find module `modelProxy`

- [ ] **Step 5.3：实现 `modelProxy.ts`**

新建 `server/lib/langfuse/modelProxy.ts`，完整内容：

```ts
/**
 * chatModelFactory ES Proxy 包装
 *
 * - 拦截 invoke / stream / batch / streamEvents 四个方法
 * - 从 ALS 取业务上下文，注入 RunnableConfig：
 *     - runName 顶层（trace 列表可读名）
 *     - tags 顶层（含 vertical + environment；'langfuse:nostream' 由 SpanProcessor 豁免）
 *     - metadata.langfuse* camelCase（user_id / session_id 字段名）
 *     - metadata 业务自由字段（runId / requestId / caseId / ... / scope / gitSha）
 *     - callbacks 追加 langfuseHandler
 * - 不参与 nostream 豁免（统一闸口在 LangfuseSpanProcessor.shouldExportSpan）
 */

import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { getLangfuseHandler, getLangfuseRuntimeConfig } from './client'
import { getLangfuseContext } from './context'
import { deriveScope } from './types'

const INTERCEPTED = new Set(['invoke', 'stream', 'batch', 'streamEvents'])

export function wrapWithLangfuse<M extends BaseChatModel>(model: M): M {
  return new Proxy(model, {
    get(target, prop, receiver) {
      const original = Reflect.get(target, prop, receiver)
      if (typeof original !== 'function') return original
      if (!INTERCEPTED.has(String(prop))) return original.bind(target)

      return function (this: unknown, input: unknown, config?: any, ...rest: unknown[]) {
        const handler = getLangfuseHandler()
        const cfg = getLangfuseRuntimeConfig()
        const ctx = getLangfuseContext()
        const incomingTags: string[] = config?.tags ?? []

        const mergedTags = [
          ...incomingTags,
          ctx?.vertical,
          cfg.environment,
        ].filter((t): t is string => Boolean(t))

        const mergedConfig = {
          ...config,
          runName: config?.runName ?? ctx?.vertical,
          tags: mergedTags,
          callbacks: [...(config?.callbacks ?? []), handler],
          metadata: {
            ...(config?.metadata ?? {}),
            langfuseUserId: ctx?.userId !== undefined ? String(ctx.userId) : undefined,
            langfuseSessionId: ctx?.sessionId,
            requestId: ctx?.requestId,
            runId: ctx?.runId,
            caseId: ctx?.caseId,
            reviewId: ctx?.reviewId,
            draftId: ctx?.draftId,
            materialId: ctx?.materialId,
            scope: ctx?.vertical ? deriveScope(ctx.vertical) : undefined,
            gitSha: cfg.gitSha,
            environment: cfg.environment,
          },
        }

        return original.call(target, input, mergedConfig, ...rest)
      }
    },
  }) as M
}
```

- [ ] **Step 5.4：跑测试，应 PASS**

Run:
```bash
npx vitest run tests/server/lib/langfuse/modelProxy.test.ts --reporter=verbose
```
Expected: All passed

- [ ] **Step 5.5：更新 `index.ts` barrel**

打开 `server/lib/langfuse/index.ts`，末尾追加：

```ts
export { wrapWithLangfuse } from './modelProxy'
```

- [ ] **Step 5.6：跑 typecheck**

Run:
```bash
bun run typecheck
```
Expected: 0 type errors

- [ ] **Step 5.7：commit**

```bash
git add server/lib/langfuse/modelProxy.ts server/lib/langfuse/index.ts tests/server/lib/langfuse/modelProxy.test.ts
git commit -m "$(cat <<'EOF'
feat(observability): 新增 chatModelFactory ES Proxy 拦截器

- 拦截 invoke / stream / batch / streamEvents 四个方法
- 从 ALS 注入 RunnableConfig：runName 顶层、tags 顶层、metadata.langfuseUserId/SessionId camelCase、业务字段
- nostream 豁免不在此处（统一闸口在 SpanProcessor.shouldExportSpan）
EOF
)"
```

---

## Task 6：middleware/04.langfuseContext.ts（HTTP 入口起 ALS 根上下文）

**Files:**
- Create: `server/middleware/04.langfuseContext.ts`
- Create: `tests/server/middleware/langfuseContext.test.ts`

- [ ] **Step 6.1：写测试**

新建 `tests/server/middleware/langfuseContext.test.ts`，完整内容：

```ts
import { describe, expect, it } from 'vitest'
import { getLangfuseContext } from '~~/server/lib/langfuse/context'
import langfuseContextMiddleware from '~~/server/middleware/04.langfuseContext'

function makeFakeEvent(opts: {
  requestId?: string
  userId?: number
} = {}) {
  return {
    context: {
      requestId: opts.requestId,
      auth: opts.userId !== undefined
        ? { user: { id: opts.userId } }
        : undefined,
    },
  } as any
}

describe('04.langfuseContext middleware', () => {
  it('从 event.context.requestId / auth.user.id enterWith ALS', () => {
    const event = makeFakeEvent({ requestId: 'req-A', userId: 7 })
    langfuseContextMiddleware(event)
    const ctx = getLangfuseContext()
    expect(ctx?.requestId).toBe('req-A')
    expect(ctx?.userId).toBe(7)
  })

  it('未鉴权时 userId 为 undefined（公开 API）', () => {
    const event = makeFakeEvent({ requestId: 'req-B' })
    langfuseContextMiddleware(event)
    const ctx = getLangfuseContext()
    expect(ctx?.requestId).toBe('req-B')
    expect(ctx?.userId).toBeUndefined()
  })
})
```

- [ ] **Step 6.2：跑测试，应 FAIL**

Run:
```bash
npx vitest run tests/server/middleware/langfuseContext.test.ts --reporter=verbose
```
Expected: FAIL — Cannot find module `04.langfuseContext`

- [ ] **Step 6.3：实现 middleware**

新建 `server/middleware/04.langfuseContext.ts`，完整内容：

```ts
/**
 * Langfuse 上下文中间件（在 01.requestId / 02.auth / 03.permission 之后）
 *
 * 用 enterWith 起 ALS 根上下文：requestId + userId（可空）。
 * 后续业务节点用 withLangfuseContext 增量补 sessionId / runId / 业务实体 ID / vertical。
 */

import { enterLangfuseContext } from '~~/server/lib/langfuse/context'

export default defineEventHandler((event) => {
  enterLangfuseContext({
    requestId: event.context.requestId ?? '',
    userId: event.context.auth?.user?.id,
  })
})
```

- [ ] **Step 6.4：跑测试，应 PASS**

Run:
```bash
npx vitest run tests/server/middleware/langfuseContext.test.ts --reporter=verbose
```
Expected: All passed

- [ ] **Step 6.5：跑 typecheck**

Run:
```bash
bun run typecheck
```
Expected: 0 type errors

- [ ] **Step 6.6：commit**

```bash
git add server/middleware/04.langfuseContext.ts tests/server/middleware/langfuseContext.test.ts
git commit -m "$(cat <<'EOF'
feat(observability): 新增 04.langfuseContext middleware 起 ALS 根上下文

- 在 01.requestId / 02.auth / 03.permission 之后用 enterWith 注入 requestId + userId
- 后续业务节点用 withLangfuseContext 增量补 sessionId / runId / 业务实体 ID / vertical
EOF
)"
```

---

## Task 7：plugins/langfuse-otel.ts（NodeSDK + LangfuseSpanProcessor + close hook）

**Files:**
- Create: `server/plugins/langfuse-otel.ts`
- Create: `tests/server/plugins/langfuse-otel.test.ts`

- [ ] **Step 7.1：写测试（用 BasicTracerProvider + InMemorySpanExporter，不启 NodeSDK）**

新建 `tests/server/plugins/langfuse-otel.test.ts`，完整内容：

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { redactDeep } from '~~/server/lib/langfuse/redactPII'

/**
 * langfuse-otel.ts 整体启停只在手工 E2E 验。
 * 这里用纯函数断言关键钩子的行为：
 *   - mask 钩子的闭包递归脱敏（验证 Step 7.3 引用的 redactDeep 行为已被 redactPII.test.ts 覆盖）
 *   - shouldExportSpan 钩子的 nostream 豁免逻辑
 *
 * NodeSDK 整体启停的真测试放在 PR 3 手工 E2E checklist。
 */

function createNostreamFilter(): (span: { attributes: Record<string, unknown> }) => boolean {
  return ({ attributes }) => {
    const tags = attributes['langfuse.trace.tags'] as string[] | undefined
    return !tags?.includes('langfuse:nostream')
  }
}

describe('langfuse-otel plugin 内部钩子单元行为', () => {
  it('shouldExportSpan: tags 含 langfuse:nostream → false', () => {
    const filter = createNostreamFilter()
    expect(filter({
      attributes: { 'langfuse.trace.tags': ['case-analysis', 'langfuse:nostream'] },
    })).toBe(false)
  })

  it('shouldExportSpan: tags 不含 langfuse:nostream → true', () => {
    const filter = createNostreamFilter()
    expect(filter({
      attributes: { 'langfuse.trace.tags': ['case-analysis'] },
    })).toBe(true)
  })

  it('shouldExportSpan: tags 缺失 → true（默认上送）', () => {
    const filter = createNostreamFilter()
    expect(filter({ attributes: {} })).toBe(true)
  })

  it('mask 闭包等价于 redactDeep', async () => {
    const mask = async ({ data }: { data: unknown }) => redactDeep(data)
    const result = await mask({
      data: [
        { role: 'user', content: '身份证 110101199003078515' },
      ],
    })
    expect(result).toEqual([
      { role: 'user', content: '身份证 ***IDCARD***' },
    ])
  })
})
```

- [ ] **Step 7.2：跑测试，应 PASS（纯函数验证，不依赖 plugin 是否实现）**

Run:
```bash
npx vitest run tests/server/plugins/langfuse-otel.test.ts --reporter=verbose
```
Expected: All passed

- [ ] **Step 7.3：实现 plugin**

新建 `server/plugins/langfuse-otel.ts`，完整内容：

```ts
/**
 * Langfuse OpenTelemetry NodeSDK 启动 + 关闭
 *
 * - tracingEnabled=false → 直接 skip 不启 SDK（测试 / 显式禁用）
 * - LangfuseSpanProcessor 配 mask 钩子（递归 PII 脱敏）+ shouldExportSpan 钩子（nostream 豁免）
 * - prod 环境强制 maskPII=true（即使 env 写 false 也忽略）
 * - Nitro close hook 内 await nodeSdk.shutdown() 刷新未上送 span
 */

import { LangfuseSpanProcessor } from '@langfuse/otel'
import { NodeSDK } from '@opentelemetry/sdk-node'
import { getLangfuseRuntimeConfig } from '~~/server/lib/langfuse/client'
import { redactDeep } from '~~/server/lib/langfuse/redactPII'

let nodeSdk: NodeSDK | undefined

export default defineNitroPlugin((nitroApp) => {
  const cfg = getLangfuseRuntimeConfig()

  if (!cfg.tracingEnabled) {
    logger.info('[langfuse] tracing 已禁用（LANGFUSE_TRACING_ENABLED=false）')
    return
  }

  if (!cfg.publicKey || !cfg.secretKey || !cfg.baseUrl) {
    logger.warn('[langfuse] 配置不完整（publicKey / secretKey / baseUrl），跳过 tracing 初始化')
    return
  }

  // prod 强制开启 maskPII；其它环境按 env 决定
  const enableMask = cfg.environment === 'production' ? true : cfg.maskPII

  const spanProcessor = new LangfuseSpanProcessor({
    publicKey: cfg.publicKey,
    secretKey: cfg.secretKey,
    baseUrl: cfg.baseUrl,
    environment: cfg.environment,
    mask: enableMask
      ? async ({ data }) => redactDeep(data)
      : undefined,
    shouldExportSpan: ({ otelSpan }) => {
      const tags = otelSpan.attributes['langfuse.trace.tags'] as string[] | undefined
      return !tags?.includes('langfuse:nostream')
    },
  })

  nodeSdk = new NodeSDK({ spanProcessors: [spanProcessor] })

  try {
    nodeSdk.start()
    logger.info('[langfuse] OTel NodeSDK 已启动', {
      baseUrl: cfg.baseUrl,
      environment: cfg.environment,
      maskPII: enableMask,
    })
  }
  catch (err) {
    logger.warn('[langfuse] OTel NodeSDK 启动失败:', err)
    nodeSdk = undefined
    return
  }

  nitroApp.hooks.hook('close', async () => {
    if (!nodeSdk) return
    try {
      await nodeSdk.shutdown()
      logger.info('[langfuse] OTel NodeSDK 关闭完成')
    }
    catch (err) {
      logger.warn('[langfuse] OTel NodeSDK 关闭异常:', err)
    }
  })
})
```

- [ ] **Step 7.4：跑 typecheck**

Run:
```bash
bun run typecheck
```
Expected: 0 type errors（如有 LangfuseSpanProcessor 字段类型不匹配，按 SDK 实际类型调整 — 参考 spec §7 风险 #9：PR 1 step 7 实施前再次 read `node_modules/@langfuse/otel/dist/...` 确认）

- [ ] **Step 7.5：跑 plugin 单测确认无回归**

Run:
```bash
npx vitest run tests/server/plugins/langfuse-otel.test.ts --reporter=verbose
```
Expected: All passed

- [ ] **Step 7.6：commit**

```bash
git add server/plugins/langfuse-otel.ts tests/server/plugins/langfuse-otel.test.ts
git commit -m "$(cat <<'EOF'
feat(observability): 启动 OpenTelemetry NodeSDK 与 LangfuseSpanProcessor

- tracingEnabled=false 时 skip 不启 SDK；publicKey/secretKey/baseUrl 缺失时 skip
- mask 钩子调 redactDeep 做递归 PII 脱敏；prod 强制开启 maskPII
- shouldExportSpan 钩子统一处理 langfuse:nostream 豁免（替代 modelProxy 层）
- Nitro close hook 内 await nodeSdk.shutdown() 刷新未上送 span
EOF
)"
```

---

## Task 8：改造 chatModelFactory.ts（出口包 wrapWithLangfuse）

**Files:**
- Modify: `server/services/node/chatModelFactory.ts`

- [ ] **Step 8.1：定位 createChatModel 函数体**

打开 `server/services/node/chatModelFactory.ts`，找到 `export function createChatModel(config: ChatModelConfig): BaseChatModel { ... }`（spec 起草日在第 210 行附近，**实施时用 grep 重新核对**）：

```bash
grep -n "export function createChatModel" server/services/node/chatModelFactory.ts
```

- [ ] **Step 8.2：在文件顶部 import 区追加 wrapWithLangfuse**

```ts
import { wrapWithLangfuse } from '~~/server/lib/langfuse'
```

- [ ] **Step 8.3：把 createChatModel 函数末尾的 `return model`（或对应的返回模型变量名）替换为 `return wrapWithLangfuse(model)`**

如果函数有多个分支 return（不同 provider 走不同分支），统一在最终返回点包一层 — 必要时引入临时变量：

```ts
export function createChatModel(config: ChatModelConfig): BaseChatModel {
  // ... 现有 provider 分支逻辑产生 model
  return wrapWithLangfuse(model)
}
```

- [ ] **Step 8.4：跑现有 chatModelFactory 相关测试不回归**

Run:
```bash
npx vitest run tests/server/node/chatModelFactory.test.ts --reporter=verbose 2>/dev/null \
  || npx vitest run tests/server/node/ --reporter=verbose
```
Expected: All existing tests still pass

- [ ] **Step 8.5：跑 typecheck**

Run:
```bash
bun run typecheck
```
Expected: 0 type errors

- [ ] **Step 8.6：commit**

```bash
git add server/services/node/chatModelFactory.ts
git commit -m "$(cat <<'EOF'
feat(observability): chatModelFactory 出口包 LangfuseModelProxy

- createChatModel() 返回前用 wrapWithLangfuse(model) 包一层
- 18 处 createChatModel 调用点全部自动获得 RunnableConfig 上下文注入能力
- 业务侧零改动；本 PR 后接续业务接入留给 PR 2
EOF
)"
```

---

## Task 9：改造 invokeNodeJson.ts（tag `langsmith:nostream` → `langfuse:nostream`）

**Files:**
- Modify: `server/services/agent-platform/tools/invokeNodeJson.ts`

- [ ] **Step 9.1：定位 tag 字符串**

```bash
grep -n "langsmith:nostream" server/services/agent-platform/tools/invokeNodeJson.ts
```

- [ ] **Step 9.2：改 tag**

把 `tags: ['langsmith:nostream', 'internal']`（或类似形态）改为：

```ts
tags: ['langfuse:nostream', 'internal']
```

- [ ] **Step 9.3：grep 全项目确认无残留 `langsmith:nostream` 用法**

```bash
grep -rn "langsmith:nostream" server/ shared/ app/ tests/
```
Expected: 0 命中（除 spec 文档引用）

- [ ] **Step 9.4：跑现有 invokeNodeJson 相关测试不回归**

```bash
npx vitest run tests/server/agent-platform/ --reporter=verbose
```
Expected: All existing tests still pass

- [ ] **Step 9.5：commit**

```bash
git add server/services/agent-platform/tools/invokeNodeJson.ts
git commit -m "$(cat <<'EOF'
refactor(observability): invokeNodeJson tag 改名 langsmith:nostream → langfuse:nostream

- 该 tag 透传到 OTel span attributes，由 LangfuseSpanProcessor.shouldExportSpan 统一豁免
- 沿用原"工具内部 LLM 调用不上报"的语义；只是名称对齐 Langfuse
EOF
)"
```

---

## Task 10：nuxt.config.ts + .env.example（runtimeConfig）

**Files:**
- Modify: `nuxt.config.ts`
- Modify: `.env.example`

- [ ] **Step 10.1：在 `nuxt.config.ts` 的 `runtimeConfig` 段追加 `langfuse` 子段**

打开 `nuxt.config.ts`，找到 `runtimeConfig: { ... }`（grep `runtimeConfig`），在该对象内追加：

```ts
langfuse: {
  publicKey: process.env.LANGFUSE_PUBLIC_KEY ?? '',
  secretKey: process.env.LANGFUSE_SECRET_KEY ?? '',
  baseUrl: process.env.LANGFUSE_BASE_URL ?? '',
  tracingEnabled: process.env.LANGFUSE_TRACING_ENABLED !== 'false',
  maskPII: process.env.LANGFUSE_MASK_PII !== 'false',
  environment: (process.env.LANGFUSE_ENVIRONMENT
    ?? process.env.NODE_ENV
    ?? 'development') as 'development' | 'staging' | 'production',
  gitSha: process.env.GIT_SHA ?? '',
},
```

- [ ] **Step 10.2：在 `.env.example` 末尾追加 6 个环境变量样例**

```bash
# Langfuse 可观测性（自托管 https://langfuse.lexseek.cn）
LANGFUSE_PUBLIC_KEY=
LANGFUSE_SECRET_KEY=
LANGFUSE_BASE_URL=https://langfuse.lexseek.cn
LANGFUSE_TRACING_ENABLED=true
LANGFUSE_MASK_PII=true
LANGFUSE_ENVIRONMENT=development
```

- [ ] **Step 10.3：跑 typecheck（验证 runtimeConfig 类型正确推导）**

```bash
bun run typecheck
```
Expected: 0 type errors

- [ ] **Step 10.4：commit**

```bash
git add nuxt.config.ts .env.example
git commit -m "$(cat <<'EOF'
feat(observability): nuxt.config runtimeConfig.langfuse + .env.example 6 个 env

- runtimeConfig 注入 publicKey / secretKey / baseUrl / tracingEnabled / maskPII / environment / gitSha
- .env.example 给出 dev 环境样例值（实际密钥不入仓库）
EOF
)"
```

---

## Task 11：改造 tests/_infra/global-setup.ts（强制禁用上报）

**Files:**
- Modify: `tests/_infra/global-setup.ts`

- [ ] **Step 11.1：在 global-setup 顶部追加强制禁用语句**

打开 `tests/_infra/global-setup.ts`，在文件最顶部 import 区后追加：

```ts
// Langfuse 测试环境强制禁用上报，防止意外上送到生产 Langfuse
process.env.LANGFUSE_TRACING_ENABLED = 'false'
```

- [ ] **Step 11.2：跑全套测试不回归（所有 tests/server / tests/shared / tests/client / tests/integration）**

```bash
bun run test
```
Expected: 全套测试通过；无 Langfuse 上送相关错误（因为 tracing 禁用 + handler noop 兜底）

- [ ] **Step 11.3：grep 确认 LANGFUSE_TRACING_ENABLED 设置已生效**

```bash
grep -rn "LANGFUSE_TRACING_ENABLED" tests/
```
Expected: `tests/_infra/global-setup.ts` 命中且仅这一处设 false

- [ ] **Step 11.4：commit**

```bash
git add tests/_infra/global-setup.ts
git commit -m "$(cat <<'EOF'
test(observability): tests/_infra/global-setup 强制禁用 Langfuse 上报

- LANGFUSE_TRACING_ENABLED=false 防测试意外上送到生产
- langfuse-otel.ts plugin 已在 tracingEnabled=false 时直接 skip 不启 NodeSDK
EOF
)"
```

---

## PR 1 收尾验收

- [ ] **完成所有 11 个 task 后跑全量验收**

```bash
bun run typecheck && bun run test
```
Expected:
- 0 type errors
- 全套测试通过
- `server/lib/langfuse/` 下 5 个核心模块（redactPII / context / client / modelProxy + langfuse-otel.ts plugin 钩子）有单测覆盖
- `tests/server/lib/langfuse/als-sync.test.ts` 通过
- `tests/server/middleware/langfuseContext.test.ts` 通过
- `tests/server/plugins/langfuse-otel.test.ts` 通过

- [ ] **最后做 dev 启动冒烟验证**

```bash
bun dev
```

观察日志应出现：
- `[langfuse] OTel NodeSDK 已启动 baseUrl=https://langfuse.lexseek.cn environment=development maskPII=true`（如本地 .env 已配齐 dev keys）
- 或 `[langfuse] 配置不完整（publicKey / secretKey / baseUrl），跳过 tracing 初始化`（本地 .env 未配 dev keys）

打开浏览器随便点一下，**不应有 Langfuse 相关报错**。

> 此时 PR 1 完成，业务侧未接入（PR 2 任务）。trace 数据可能为空（因为 createChatModel 调用栈外没人填 ALS 上下文 → modelProxy 注入的 metadata 字段全是 undefined）。这是预期。

---

## PR 1 后续

PR 1 完成后进入 PR 2（业务接入），在 13 个业务节点入口包 `withLangfuseContext()`。具体清单见 spec §5 PR 2 表格 + 附录 C。

PR 2 计划另行输出。本 plan 仅覆盖 PR 1 范围。
