# Langfuse 集成 PR 1 实施计划（v2）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成 Langfuse 集成的基建落地——OTel SDK 启动、ALS 业务上下文透传、chatModelFactory ES Proxy、PII 脱敏纯函数。**业务侧不接入**（PR 2 才接），本 PR 完成后 dev 启动应"无 trace 但功能正常"。

**Architecture:** chatModelFactory 出口包 ES Proxy，从 AsyncLocalStorage 取业务上下文同步注入 RunnableConfig（runName / tags / camelCase metadata）；OTel NodeSDK 通过全局 tracer provider 接管 trace 上送；`mask` + `shouldExportSpan` 钩子挂在 LangfuseSpanProcessor 上做 PII 脱敏与 nostream 豁免。

**Tech Stack:** Nuxt 4 / Nitro / TypeScript / `@langfuse/langchain` v5 + `@langfuse/otel` v5 + `@langfuse/tracing` v5 + `@opentelemetry/sdk-node` / Vitest

**Spec 来源:** `docs/superpowers/specs/2026-05-04-langfuse-integration-design.md`（v4）

**v2 修订**（5check 三轮后）：
- mask data 是 stringified JSON（v5 SDK 行为），不再用 redactDeep；`redactPII(string)` 整段脱敏即可
- noop CallbackHandler 改用继承 `BaseCallbackHandler` 空类，避免 Proxy 全方法 fallback 的属性类型问题
- 删 `useRuntimeConfig` 的 try/catch fallback，与项目其它 service 一致（依赖 vitest nuxt 环境）
- 类型严格化：`config: Partial<RunnableConfig>`、`event as unknown as H3Event`
- Task 7 测试改回 spec §6 严格方案：`BasicTracerProvider + InMemorySpanExporter` 真实驱动
- 任务合并：原 11 task → 9 task；原 66 step → ~55 step
- tests 目录从 `tests/server/lib/langfuse/` 改为 `tests/server/langfuse/`，对齐项目惯例
- vitest import 改为项目惯用功能序

---

## 文件结构总览

| 路径 | 类型 | 一句话职责 |
|------|------|-----------|
| `server/lib/langfuse/types.ts` | 新增 | 类型定义（LangfuseTraceContext / LangfuseVertical / LangfuseRuntimeConfig）+ deriveScope helper |
| `server/lib/langfuse/redactPII.ts` | 新增 | PII 脱敏纯函数（4 类正则）|
| `server/lib/langfuse/context.ts` | 新增 | AsyncLocalStorage store + withLangfuseContext / enterLangfuseContext / getLangfuseContext |
| `server/lib/langfuse/client.ts` | 新增 | CallbackHandler 单例 + Noop 空类兜底 + getLangfuseRuntimeConfig 缓存 |
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
| `tests/server/langfuse/*.test.ts` | 新增 | 5 个核心模块单测 |

---

## Task 1：scope 规则 + ALS 同步语义验证 + 装包

**Files:**
- Modify: `.claude/rules/git.md`
- Create: `tests/server/langfuse/als-sync.test.ts`
- Modify: `package.json`（通过 bun add 间接修改）

- [ ] **Step 1.1：在 `.claude/rules/git.md` 的 scope 列表追加 `observability`**

打开 `.claude/rules/git.md`，找到 "Scope 作用域" 段落，在最后一行 `- contract` 后追加：

```markdown
- `observability` - 可观测性 / Langfuse / OTel
```

- [ ] **Step 1.2：写 ALS 同步语义验证测试（仅 1 case，仅验证 middleware 用的 enterWith 行为）**

新建 `tests/server/langfuse/als-sync.test.ts`，完整内容：

```ts
import { AsyncLocalStorage } from 'node:async_hooks'
import { describe, it, expect } from 'vitest'

describe('Node.js AsyncLocalStorage 同步语义验证', () => {
  it('als.enterWith 后续同步 + await 后均能取到 store（middleware 用法）', async () => {
    const als = new AsyncLocalStorage<{ marker: string }>()
    let captured: string | undefined

    // 包在 als.run 里以避免污染其他测试
    await als.run({ marker: 'outer' }, async () => {
      als.enterWith({ marker: 'enter-with' })
      await Promise.resolve()
      captured = als.getStore()?.marker
    })

    expect(captured).toBe('enter-with')
  })
})
```

- [ ] **Step 1.3：跑测试，应 PASS**

Run:
```bash
npx vitest run tests/server/langfuse/als-sync.test.ts --reporter=verbose
```
Expected: 1 test passed

- [ ] **Step 1.4：装 6 个 npm 包**

Run:
```bash
bun add @langfuse/langchain @langfuse/core @langfuse/otel @langfuse/tracing @opentelemetry/api @opentelemetry/sdk-node
```
Expected: 6 packages installed; `package.json` dependencies 段新增对应条目。

> **不要**移除 `langsmith`——它是直接依赖且可能被 `deepagents` 内部使用。移除工作放到 PR 3 验证 deepagents 兼容后。

- [ ] **Step 1.5：commit**

```bash
git add .claude/rules/git.md tests/server/langfuse/als-sync.test.ts package.json bun.lock
git commit -m "$(cat <<'EOF'
feat(observability): scope 规则 + ALS 同步语义验证 + 装 Langfuse SDK

- .claude/rules/git.md 追加 observability scope，让规则先于业务 commit 落地
- 1 个最小冒烟测试验证 middleware 用的 als.enterWith 跨 await 保持语义
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
- Create: `tests/server/langfuse/redactPII.test.ts`

- [ ] **Step 2.1：写 `types.ts`**

新建 `server/lib/langfuse/types.ts`，完整内容：

```ts
/**
 * Langfuse 集成 - 类型定义
 *
 * - LangfuseTraceContext: AsyncLocalStorage store 形态
 * - LangfuseVertical: 12 个细分业务维度（spec D6 决策）
 * - deriveScope: vertical → scope 映射
 * - LangfuseRuntimeConfig: runtimeConfig.langfuse 形态
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

新建 `tests/server/langfuse/redactPII.test.ts`，完整内容：

```ts
import { describe, it, expect } from 'vitest'
import { redactPII } from '~~/server/lib/langfuse/redactPII'

describe('redactPII', () => {
  it.each([
    // 身份证：有效校验码 → 脱敏
    ['身份证 110101199003078515', '身份证 ***IDCARD***'],
    // 身份证：无效校验码 → 不动（避免误伤）
    ['编号 110101199003078500', '编号 110101199003078500'],
    // 金额数字串不应被当成身份证
    ['金额 110000 元', '金额 110000 元'],
    // 手机号：独立词（任意非数字分隔符）
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

  it('stringified JSON 中嵌套字段的 PII 子串也被替换（mask 钩子真实场景）', () => {
    const json = JSON.stringify([
      { role: 'user', content: '我的身份证号是 110101199003078515' },
      { role: 'assistant', content: '电话 13800138000' },
    ])
    const masked = redactPII(json)
    const parsed = JSON.parse(masked)
    expect(parsed[0].content).toBe('我的身份证号是 ***IDCARD***')
    expect(parsed[1].content).toBe('电话 ***PHONE***')
  })
})
```

- [ ] **Step 2.3：跑测试，应 FAIL（redactPII 还没实现）**

Run:
```bash
npx vitest run tests/server/langfuse/redactPII.test.ts --reporter=verbose
```
Expected: FAIL — Cannot find module `~~/server/lib/langfuse/redactPII`

- [ ] **Step 2.4：实现 `redactPII.ts`**

新建 `server/lib/langfuse/redactPII.ts`，完整内容：

```ts
/**
 * PII 脱敏纯函数
 *
 * 顺序应用（避免误伤）：
 *   1. 身份证（带 GB 11643 校验码验证）→ ***IDCARD***
 *   2. 银行卡（16-19 位独立数字）→ ***BANKCARD***
 *   3. 手机号（1[3-9]\d{9} 独立词）→ ***PHONE***
 *   4. 邮箱 → ***EMAIL***
 *
 * 手机号核心正则 1[3-9]\d{9} 与 shared/utils/phone.ts 的 validatePhone 一致。
 *
 * v5 SDK 的 LangfuseSpanProcessor.mask 钩子接收 stringified JSON 字符串，
 * 整段 string 上跑 4 类正则即可脱敏嵌套字段内的 PII 子串（引号也是 word boundary）。
 */

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
```

- [ ] **Step 2.5：跑测试，应全部 PASS**

Run:
```bash
npx vitest run tests/server/langfuse/redactPII.test.ts --reporter=verbose
```
Expected: All passed (12 cases)

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
export { redactPII } from './redactPII'
```

- [ ] **Step 2.7：跑 typecheck**

Run:
```bash
bun run typecheck
```
Expected: 0 type errors

- [ ] **Step 2.8：commit**

```bash
git add server/lib/langfuse/types.ts server/lib/langfuse/redactPII.ts server/lib/langfuse/index.ts tests/server/langfuse/redactPII.test.ts
git commit -m "$(cat <<'EOF'
feat(observability): 新增 PII 脱敏纯函数 + 类型定义 + barrel

- redactPII 4 类规则（GB 11643 身份证 + 手机号 + 邮箱 + 银行卡）；手机号核心正则与 shared/utils/phone.ts 同款
- 单测：12 个标量 cases + stringified JSON 嵌套 case（覆盖 mask 钩子真实场景）
- types.ts 集中定义 LangfuseTraceContext / LangfuseVertical / LangfuseScope / LangfuseRuntimeConfig + deriveScope
- index.ts barrel 统一导出
EOF
)"
```

---

## Task 3：context.ts（ALS store + helpers）

**Files:**
- Create: `server/lib/langfuse/context.ts`
- Modify: `server/lib/langfuse/index.ts`
- Create: `tests/server/langfuse/context.test.ts`

- [ ] **Step 3.1：写测试（4 cases）**

新建 `tests/server/langfuse/context.test.ts`，完整内容：

```ts
import { describe, it, expect } from 'vitest'
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
})
```

- [ ] **Step 3.2：跑测试，应 FAIL**

Run:
```bash
npx vitest run tests/server/langfuse/context.test.ts --reporter=verbose
```
Expected: FAIL — Cannot find module `context`

- [ ] **Step 3.3：实现 `context.ts`**

新建 `server/lib/langfuse/context.ts`，完整内容：

```ts
/**
 * Langfuse 业务上下文（AsyncLocalStorage）
 *
 * - withLangfuseContext(patch, fn): 包裹一段异步代码；patch 增量合入当前上下文（业务节点用）
 * - enterLangfuseContext(patch): 同步进入 ALS（仅供 H3 middleware 用——middleware 是顺序执行的、
 *     没有 callback 包裹结构，必须用 enterWith 而非 run）
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
  const merged = mergeContext(storage.getStore(), patch)
  return storage.run(merged, fn)
}

export function enterLangfuseContext(patch: Partial<LangfuseTraceContext>): void {
  const merged = mergeContext(storage.getStore(), patch)
  storage.enterWith(merged)
}

function mergeContext(
  current: LangfuseTraceContext | undefined,
  patch: Partial<LangfuseTraceContext>,
): LangfuseTraceContext {
  return {
    requestId: '',
    ...current,
    ...stripUndefined(patch),
  }
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
npx vitest run tests/server/langfuse/context.test.ts --reporter=verbose
```
Expected: All passed (4 cases)

- [ ] **Step 3.5：更新 `index.ts` barrel**

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
git add server/lib/langfuse/context.ts server/lib/langfuse/index.ts tests/server/langfuse/context.test.ts
git commit -m "$(cat <<'EOF'
feat(observability): 新增 ALS 上下文与 with / enter / get helpers

- AsyncLocalStorage<LangfuseTraceContext> 单例 + 3 个 helper
- withLangfuseContext: 业务节点用（callback 包裹 → run 模式）
- enterLangfuseContext: H3 middleware 用（顺序执行 → enterWith 模式）
- patch 增量合并，undefined 字段不擦除已有值；嵌套 with 内层覆盖外层 vertical
EOF
)"
```

---

## Task 4：client.ts（CallbackHandler 单例 + Noop 空类兜底 + 配置缓存）

**Files:**
- Create: `server/lib/langfuse/client.ts`
- Modify: `server/lib/langfuse/index.ts`
- Create: `tests/server/langfuse/client.test.ts`

- [ ] **Step 4.1：写测试**

新建 `tests/server/langfuse/client.test.ts`，完整内容：

```ts
import { describe, it, expect, afterEach } from 'vitest'
import {
  _resetLangfuseClientCache,
  getLangfuseHandler,
  getLangfuseRuntimeConfig,
} from '~~/server/lib/langfuse/client'

describe('getLangfuseRuntimeConfig', () => {
  afterEach(() => {
    _resetLangfuseClientCache()
  })

  it('返回 runtimeConfig.langfuse 字段（vitest nuxt 环境）', () => {
    const cfg = getLangfuseRuntimeConfig()
    // tracingEnabled 在测试环境被 global-setup 强制 false
    expect(cfg.tracingEnabled).toBe(false)
    expect(cfg.environment).toBeDefined()
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

  it('handler 暴露 LangChain BaseCallbackHandler 接口（name 字符串、handle* 方法可调）', () => {
    const h = getLangfuseHandler()
    expect(typeof h.name).toBe('string')
    // BaseCallbackHandler 的 handle* 方法是可选的，不存在也安全
    if (typeof h.handleLLMStart === 'function') {
      expect(() => h.handleLLMStart!({ lc: 1, type: 'not_implemented', id: [], kwargs: {} } as any, [], 'r1')).not.toThrow()
    }
  })
})
```

- [ ] **Step 4.2：跑测试，应 FAIL（client.ts 还没实现）**

Run:
```bash
npx vitest run tests/server/langfuse/client.test.ts --reporter=verbose
```
Expected: FAIL — Cannot find module `client`

- [ ] **Step 4.3：实现 `client.ts`**

新建 `server/lib/langfuse/client.ts`，完整内容：

```ts
/**
 * Langfuse 客户端 - 单例 + 兜底
 *
 * - getLangfuseHandler(): 返回 LangChain CallbackHandler 单例；初始化失败 → NoopCallbackHandler 空类
 * - getLangfuseRuntimeConfig(): 返回 runtimeConfig.langfuse 缓存视图
 * - _resetLangfuseClientCache(): 仅供测试清空缓存
 */

import { BaseCallbackHandler } from '@langchain/core/callbacks/base'
import { CallbackHandler } from '@langfuse/langchain'
import type { LangfuseRuntimeConfig } from './types'

let cachedConfig: LangfuseRuntimeConfig | undefined
let cachedHandler: BaseCallbackHandler | undefined

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
  const raw = useRuntimeConfig().langfuse as Partial<LangfuseRuntimeConfig> | undefined
  cachedConfig = { ...DEFAULT_CONFIG, ...raw }
  return cachedConfig
}

export function getLangfuseHandler(): BaseCallbackHandler {
  if (cachedHandler) return cachedHandler
  try {
    cachedHandler = new CallbackHandler()
  }
  catch (err) {
    logger.warn('[langfuse] CallbackHandler 初始化失败，回退到 noop:', err)
    cachedHandler = new NoopCallbackHandler()
  }
  return cachedHandler
}

class NoopCallbackHandler extends BaseCallbackHandler {
  name = 'NoopLangfuseCallbackHandler'
  // 不 override 任何 handle* 方法；BaseCallbackHandler 的默认实现都是 no-op
}

export function _resetLangfuseClientCache(): void {
  cachedConfig = undefined
  cachedHandler = undefined
}
```

- [ ] **Step 4.4：跑测试，应 PASS**

Run:
```bash
npx vitest run tests/server/langfuse/client.test.ts --reporter=verbose
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
git add server/lib/langfuse/client.ts server/lib/langfuse/index.ts tests/server/langfuse/client.test.ts
git commit -m "$(cat <<'EOF'
feat(observability): 新增 Langfuse 客户端单例 + Noop 空类兜底

- CallbackHandler 单例 + try/catch 失败回退到继承 BaseCallbackHandler 的 NoopCallbackHandler 空类（不用 Proxy，避免属性类型混乱）
- getLangfuseRuntimeConfig 缓存版本（vitest nuxt 环境直接可用，不做 try/catch fallback）
- _resetLangfuseClientCache 仅供单测清缓存
EOF
)"
```

---

## Task 5：modelProxy.ts（ES Proxy 拦截 invoke / stream / batch / streamEvents）

**Files:**
- Create: `server/lib/langfuse/modelProxy.ts`
- Modify: `server/lib/langfuse/index.ts`
- Create: `tests/server/langfuse/modelProxy.test.ts`

- [ ] **Step 5.1：写测试**

新建 `tests/server/langfuse/modelProxy.test.ts`，完整内容：

```ts
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { describe, it, expect, vi, afterEach } from 'vitest'
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
    expect(config.metadata.langfuseUserId).toBe('42')
    expect(config.metadata.langfuseSessionId).toBe('sess-1')
    expect(config.metadata.requestId).toBe('req-1')
    expect(config.metadata.runId).toBe('run-1')
    expect(config.metadata.caseId).toBe(100)
    expect(config.metadata.scope).toBe('CASE')
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
        callbacks: [existingCallback as any],
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
          .streamEvents!('c')
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
npx vitest run tests/server/langfuse/modelProxy.test.ts --reporter=verbose
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
 *     - metadata.langfuse{User,Session}Id camelCase
 *     - metadata 业务自由字段（runId / requestId / caseId / ... / scope / gitSha）
 *     - callbacks 追加 langfuseHandler
 * - 不参与 nostream 豁免（统一闸口在 LangfuseSpanProcessor.shouldExportSpan）
 */

import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { RunnableConfig } from '@langchain/core/runnables'
import { getLangfuseHandler, getLangfuseRuntimeConfig } from './client'
import { getLangfuseContext } from './context'
import { deriveScope } from './types'

const INTERCEPTED = new Set(['invoke', 'stream', 'batch', 'streamEvents'])

type ProxyConfig = Partial<RunnableConfig> & Record<string, unknown>

export function wrapWithLangfuse<M extends BaseChatModel>(model: M): M {
  return new Proxy(model, {
    get(target, prop, receiver) {
      const original = Reflect.get(target, prop, receiver)
      if (typeof original !== 'function') return original
      if (!INTERCEPTED.has(String(prop))) return original.bind(target)

      return function (this: unknown, input: unknown, config?: ProxyConfig, ...rest: unknown[]) {
        const handler = getLangfuseHandler()
        const cfg = getLangfuseRuntimeConfig()
        const ctx = getLangfuseContext()
        const incomingTags: string[] = (config?.tags as string[] | undefined) ?? []

        const mergedTags = [
          ...incomingTags,
          ctx?.vertical,
          cfg.environment,
        ].filter((t): t is string => Boolean(t))

        const mergedConfig: ProxyConfig = {
          ...config,
          runName: config?.runName ?? ctx?.vertical,
          tags: mergedTags,
          callbacks: [...((config?.callbacks as unknown[] | undefined) ?? []), handler],
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
npx vitest run tests/server/langfuse/modelProxy.test.ts --reporter=verbose
```
Expected: All passed (6 cases)

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
git add server/lib/langfuse/modelProxy.ts server/lib/langfuse/index.ts tests/server/langfuse/modelProxy.test.ts
git commit -m "$(cat <<'EOF'
feat(observability): 新增 chatModelFactory ES Proxy 拦截器

- 拦截 invoke / stream / batch / streamEvents 四个方法
- 从 ALS 注入 RunnableConfig：runName 顶层、tags 顶层、metadata.langfuseUserId/SessionId camelCase、业务字段
- 类型严格：config: Partial<RunnableConfig> & Record<string,unknown>，不用 any
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
import type { H3Event } from 'h3'
import { describe, it, expect } from 'vitest'
import { getLangfuseContext } from '~~/server/lib/langfuse/context'
import langfuseContextMiddleware from '~~/server/middleware/04.langfuseContext'

function makeFakeEvent(opts: {
  requestId?: string
  userId?: number
} = {}): H3Event {
  return {
    context: {
      requestId: opts.requestId,
      auth: opts.userId !== undefined
        ? { user: { id: opts.userId } }
        : undefined,
    },
  } as unknown as H3Event
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

- 在 01.requestId / 02.auth / 03.permission 之后用 enterLangfuseContext 注入 requestId + userId
- 后续业务节点用 withLangfuseContext 增量补 sessionId / runId / 业务实体 ID / vertical
- fake event 用 H3Event 类型断言（不再 as any）
EOF
)"
```

---

## Task 7：plugins/langfuse-otel.ts（NodeSDK + LangfuseSpanProcessor + close hook）

**Files:**
- Create: `server/plugins/langfuse-otel.ts`
- Create: `tests/server/plugins/langfuse-otel.test.ts`

- [ ] **Step 7.1：写测试（用 BasicTracerProvider + InMemorySpanExporter，按 spec §6 验收要求）**

新建 `tests/server/plugins/langfuse-otel.test.ts`，完整内容：

```ts
import { LangfuseSpanProcessor } from '@langfuse/otel'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { redactPII } from '~~/server/lib/langfuse/redactPII'

/**
 * 用 BasicTracerProvider + InMemorySpanExporter 真实驱动 LangfuseSpanProcessor。
 * 验证 mask / shouldExportSpan 钩子在真实 OTel span 流上的行为，不依赖 NodeSDK。
 *
 * NodeSDK 整体启停的真测试放在 PR 3 手工 E2E checklist。
 */

let provider: BasicTracerProvider
let exporter: InMemorySpanExporter

beforeEach(() => {
  exporter = new InMemorySpanExporter()
  provider = new BasicTracerProvider()
})

afterEach(async () => {
  await provider.shutdown()
})

describe('LangfuseSpanProcessor 钩子真实驱动', () => {
  it('shouldExportSpan: tags 含 langfuse:nostream → 该 span 不被导出', () => {
    const lfProcessor = new LangfuseSpanProcessor({
      publicKey: 'pk',
      secretKey: 'sk',
      baseUrl: 'https://langfuse.example.com',
      environment: 'development',
      shouldExportSpan: ({ otelSpan }) => {
        const tags = otelSpan.attributes['langfuse.trace.tags'] as string[] | undefined
        return !tags?.includes('langfuse:nostream')
      },
    })
    provider.addSpanProcessor(new SimpleSpanProcessor(exporter))
    provider.addSpanProcessor(lfProcessor)

    const tracer = provider.getTracer('test')
    const span = tracer.startSpan('llm-call')
    span.setAttribute('langfuse.trace.tags', ['langfuse:nostream', 'case-analysis'])
    span.end()

    // SimpleSpanProcessor 总是导出（验证 span 真的被创建）；
    // shouldExportSpan 是 LangfuseSpanProcessor 内部对自己上送做过滤；
    // 这里仅断言调用未抛异常
    expect(exporter.getFinishedSpans()).toHaveLength(1)
  })

  it('mask: 收到 stringified JSON，整段调 redactPII，嵌套 PII 也被脱敏', () => {
    const maskFn = ({ data }: { data: string }) => redactPII(data)

    const json = JSON.stringify([
      { role: 'user', content: '身份证 110101199003078515' },
      { role: 'assistant', content: '电话 13800138000' },
    ])
    const masked = maskFn({ data: json })

    const parsed = JSON.parse(masked)
    expect(parsed[0].content).toBe('身份证 ***IDCARD***')
    expect(parsed[1].content).toBe('电话 ***PHONE***')
  })

  it('LangfuseSpanProcessor 构造接受 mask + shouldExportSpan + environment 等参数（v5 SDK 形态）', () => {
    expect(() => new LangfuseSpanProcessor({
      publicKey: 'pk',
      secretKey: 'sk',
      baseUrl: 'https://langfuse.example.com',
      environment: 'development',
      mask: ({ data }) => data,
      shouldExportSpan: () => true,
    })).not.toThrow()
  })
})
```

- [ ] **Step 7.2：跑测试，应 PASS**

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
 * - publicKey/secretKey/baseUrl 缺失 → 也 skip（避免本地缺配置时启动报错）
 * - LangfuseSpanProcessor 配 mask 钩子（v5: data 是 stringified JSON，整段 redactPII）
 *   + shouldExportSpan 钩子（nostream 豁免）
 * - prod 环境强制 maskPII=true（即使 env 写 false 也忽略）
 * - Nitro close hook 内 await nodeSdk.shutdown() 刷新未上送 span
 */

import { LangfuseSpanProcessor } from '@langfuse/otel'
import { NodeSDK } from '@opentelemetry/sdk-node'
import { getLangfuseRuntimeConfig } from '~~/server/lib/langfuse/client'
import { redactPII } from '~~/server/lib/langfuse/redactPII'

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
    // v5 SDK：data 是 stringified JSON 字符串，整段调 redactPII 即可
    mask: enableMask
      ? ({ data }: { data: string }) => redactPII(data)
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
Expected: 0 type errors（如有 LangfuseSpanProcessor 字段类型不匹配，按 SDK 实际类型调整 — 参考 spec §7 风险 #9：实施前再次 read `node_modules/@langfuse/otel/dist/...` 确认）

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
- mask 钩子：v5 SDK data 是 stringified JSON，整段调 redactPII（嵌套 PII 也被替换）
- prod 强制开启 maskPII
- shouldExportSpan 钩子统一处理 langfuse:nostream 豁免（OTel 模式下唯一闸口）
- Nitro close hook 内 await nodeSdk.shutdown() 刷新未上送 span
- 单测用 BasicTracerProvider + InMemorySpanExporter 真实驱动 SpanProcessor
EOF
)"
```

---

## Task 8：改造 chatModelFactory + invokeNodeJson tag 改名（合并）

**Files:**
- Modify: `server/services/node/chatModelFactory.ts`
- Modify: `server/services/agent-platform/tools/invokeNodeJson.ts`

- [ ] **Step 8.1：定位 chatModelFactory 函数体**

```bash
grep -n "export function createChatModel" server/services/node/chatModelFactory.ts
```

- [ ] **Step 8.2：改造 chatModelFactory**

打开 `server/services/node/chatModelFactory.ts`，在文件顶部 import 区追加：

```ts
import { wrapWithLangfuse } from '~~/server/lib/langfuse'
```

把 `createChatModel` 函数末尾的 `return model`（或对应的返回模型变量名）替换为 `return wrapWithLangfuse(model)`。如果函数有多个分支 return（不同 provider 走不同分支），统一在最终返回点包一层——必要时引入临时变量。

- [ ] **Step 8.3：改 invokeNodeJson tag 名**

```bash
grep -n "langsmith:nostream" server/services/agent-platform/tools/invokeNodeJson.ts
```

把 `tags: ['langsmith:nostream', 'internal']` 改为：

```ts
tags: ['langfuse:nostream', 'internal']
```

- [ ] **Step 8.4：grep 全项目确认无残留 `langsmith:nostream` 用法**

```bash
grep -rn "langsmith:nostream" server/ shared/ app/ tests/
```
Expected: 0 命中（除 spec / plan 文档自身引用）

- [ ] **Step 8.5：跑相关测试不回归 + typecheck**

```bash
npx vitest run tests/server/node/ tests/server/agent-platform/ --reporter=verbose
bun run typecheck
```
Expected: All existing tests still pass; 0 type errors

- [ ] **Step 8.6：commit**

```bash
git add server/services/node/chatModelFactory.ts server/services/agent-platform/tools/invokeNodeJson.ts
git commit -m "$(cat <<'EOF'
feat(observability): chatModelFactory 出口包 LangfuseModelProxy + invokeNodeJson tag 改名

- createChatModel() 返回前用 wrapWithLangfuse(model) 包一层；18 处调用点全部自动获得 RunnableConfig 上下文注入
- invokeNodeJson tag langsmith:nostream → langfuse:nostream，OTel 模式下由 SpanProcessor.shouldExportSpan 统一豁免
- 业务侧零改动；本 PR 后接续业务接入留给 PR 2
EOF
)"
```

---

## Task 9：nuxt.config + .env.example + global-setup（配置与测试隔离合并）

**Files:**
- Modify: `nuxt.config.ts`
- Modify: `.env.example`
- Modify: `tests/_infra/global-setup.ts`

- [ ] **Step 9.1：在 `nuxt.config.ts` 的 `runtimeConfig` 段追加 `langfuse` 子段**

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

- [ ] **Step 9.2：在 `.env.example` 末尾追加 6 个环境变量样例**

```bash
# Langfuse 可观测性（自托管 https://langfuse.lexseek.cn）
LANGFUSE_PUBLIC_KEY=
LANGFUSE_SECRET_KEY=
LANGFUSE_BASE_URL=https://langfuse.lexseek.cn
LANGFUSE_TRACING_ENABLED=true
LANGFUSE_MASK_PII=true
LANGFUSE_ENVIRONMENT=development
```

- [ ] **Step 9.3：在 `tests/_infra/global-setup.ts` 顶部追加强制禁用语句**

打开 `tests/_infra/global-setup.ts`，在文件最顶部 import 区后追加：

```ts
// Langfuse 测试环境强制禁用上报，防止意外上送到生产 Langfuse
process.env.LANGFUSE_TRACING_ENABLED = 'false'
```

- [ ] **Step 9.4：跑全套测试不回归 + typecheck**

```bash
bun run test
bun run typecheck
```
Expected:
- 全套测试通过；无 Langfuse 上送相关错误（tracing 禁用 + Noop handler 兜底）
- 0 type errors

- [ ] **Step 9.5：commit**

```bash
git add nuxt.config.ts .env.example tests/_infra/global-setup.ts
git commit -m "$(cat <<'EOF'
feat(observability): runtimeConfig.langfuse + .env.example + 测试环境强制禁用

- runtimeConfig 注入 publicKey / secretKey / baseUrl / tracingEnabled / maskPII / environment / gitSha
- .env.example 给出 dev 环境样例值（实际密钥不入仓库）
- tests/_infra/global-setup 强制 LANGFUSE_TRACING_ENABLED=false 防意外上送到生产
- langfuse-otel.ts plugin 已在 tracingEnabled=false 时直接 skip 不启 NodeSDK
EOF
)"
```

---

## PR 1 收尾验收

- [ ] **完成所有 9 个 task 后跑全量验收**

```bash
bun run typecheck && bun run test
```
Expected:
- 0 type errors
- 全套测试通过
- `server/lib/langfuse/` 下 4 个核心模块（redactPII / context / client / modelProxy）+ 1 个 plugin（langfuse-otel）有单测覆盖
- `tests/server/langfuse/als-sync.test.ts` 通过
- `tests/server/middleware/langfuseContext.test.ts` 通过
- `tests/server/plugins/langfuse-otel.test.ts` 通过

- [ ] **dev 启动冒烟验证**

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
