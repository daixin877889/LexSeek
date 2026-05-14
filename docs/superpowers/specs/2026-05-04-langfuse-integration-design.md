# Langfuse 集成设计（自托管 langfuse.lexseek.cn）

| 项 | 值 |
|----|----|
| Spec 日期 | 2026-05-04 |
| Spec 版本 | v4（5check 三轮后修订；针对 Langfuse JS SDK v5 + OTel 模式；反查走 metadata.runId；mask 钩子接收 stringified JSON） |
| 关联 issue / 需求 | "为项目整合 Langfuse"（用户 brainstorming 任务） |
| 影响范围 | server 端：所有 LLM 调用链路；新增 1 个中间件 + 1 个 Nitro plugin + 1 个 lib 模块 |
| 是否引入新依赖 | 是：`@langfuse/langchain` `@langfuse/core` `@langfuse/otel` `@langfuse/tracing` `@opentelemetry/api` `@opentelemetry/sdk-node`；移除：`langsmith`（PR 3 验证 deepagents 兼容后） |
| 是否需要数据库迁移 | 否 |
| 是否影响前端 | 否（本次只做后端 trace 落地） |

---

## 1. 概述

LexSeek 是一个生产级法律 AI 应用，后端聚集了大量基于 LangChain / LangGraph 的 LLM 调用（约 18 处 `createChatModel` 调用点，覆盖 7 类业务）。当前可观测性几乎空白：项目里有 `langsmith` 依赖但**未真正启用**，只有 `langsmith:nostream` tag 用法，没有任何上送链路。

本 spec 设计**自托管 Langfuse**（`https://langfuse.lexseek.cn`）的接入方案，目标：

1. **端到端可观测**：每次 LLM 调用、工具执行、子 agent 调用都有 trace
2. **业务实体可反查**：trace 上能挂 `userId / sessionId / runId / caseId / reviewId / draftId / materialId`，便于排查"为什么 X 案件的 Y 节点 LLM 给出了 Z 答案"
3. **成本可量化**：自动捕获 token 数、按模型单价估算单次成本
4. **零业务侵入**：18 处 LLM 调用点的业务代码不需要改动 callback 参数；通过工厂层 + AsyncLocalStorage 自动注入
5. **PII 合规**：身份证 / 手机号 / 邮箱 / 银行卡号在上送前自动脱敏；自托管已避免数据出境

> **架构基础**：Langfuse JS SDK 自 v4 起整体迁移到 OpenTelemetry。`@langfuse/langchain` 仅负责生成 OTel span，**实际上送依赖 `@langfuse/otel` 的 `LangfuseSpanProcessor` + OpenTelemetry NodeSDK**。本 spec 全部按 v5 形态设计。

---

## 2. 决策摘要

| # | 决策点 | 结论 |
|---|--------|------|
| D1 | 集成范围 | **全量**：18 个 `createChatModel` 调用点全部覆盖（agent 主入口 + 案件初始化 + 案件提取 + 子 agent + 合同上传 + 通用问答 + 意图分类 + 素材摘要 + 文档/案件/合同/助手 vertical workflow agents） |
| D2 | 挂点策略 | **工厂底层 ES Proxy 拦截 + AsyncLocalStorage 透传业务上下文**（同步链路）；trace 实际上送由 OTel NodeSDK + LangfuseSpanProcessor 全局接管 |
| D3 | trace_id 反查机制 | **B 档：放弃确定性 trace_id，反查靠 `metadata.runId`**。trace_id 由 OTel 自动随机分配；所有 trace 的 metadata 强制写入 `runId / requestId / userId / 业务实体 ID`，反查在 Langfuse UI metadata 过滤器搜 `runId=xxx` 即可 |
| D4 | PII 脱敏 | **B 档**：主体内容（案情/合同正文/咨询）原样上送；身份证 / 手机号 / 邮箱 / 银行卡号正则打码；通过 `LangfuseSpanProcessor` 的 `mask` 钩子统一拦截，**对嵌套对象/数组递归处理** |
| D4-1 | 多环境隔离 | 后台已分 dev/staging/prod 三个 Langfuse 项目；本次只接入 dev（用户提供的 KEY 是 dev 环境的） |
| D4-2 | 调试模式 | 通过 `LANGFUSE_MASK_PII` 环境变量控制；**dev 默认开**，**prod 强制开**（即使 env 写 false 也忽略） |
| D5a | 附加能力（本次做） | LangSmith 清理（移除依赖 + tag 改名 `langfuse:nostream`，依赖移除在 PR 3 验证 deepagents 兼容后）；token 成本追踪（CallbackHandler 自带，零代码） |
| D5b | 附加能力（留口子） | 用户反馈打分（前端 score 按钮）；Langfuse Prompt Management；业务步骤自定义 span |
| D6 | vertical 维度 | 保留 12 个细分维度（产品视角不收敛，便于后续按"案件初始化"/"合同上传"等场景独立观察） |
| D7 | nostream 豁免 | 在 `LangfuseSpanProcessor.shouldExportSpan` 钩子上判定（OTel 模式下统一闸口）；modelProxy 不参与豁免 |

---

## 3. 架构设计

### 3.1 数据流总图

```
HTTP 请求
  │
  ├─ server/middleware/01.requestId.ts        → event.context.requestId
  ├─ server/middleware/02.auth.ts             → event.context.auth.user
  ├─ server/middleware/03.permission.ts       → 鉴权
  └─ server/middleware/04.langfuseContext.ts  ← 【新增】
        │
        ↓ AsyncLocalStorage.run({
              requestId,
              userId,          // 从 event.context.auth.user.id
              vertical?,       // 由后续业务节点填充
              sessionId?, runId?, threadId?, caseId?, reviewId?, draftId?, materialId?,
          })
        │
        ↓ 业务路由
        │
        ├─ enqueueRunService(...)              ← 【已存在】生成 runId/sessionId
        │     ↓ withLangfuseContext({ runId, sessionId, threadId, vertical }, fn)
        │
        ├─ runtime.ts agent.stream(...)        ← 【已存在，主入口】
        │     ↓ withLangfuseContext({ vertical }, fn)
        │
        ├─ initAnalysisService(...)            ← 【已存在】
        │     ↓ withLangfuseContext({ caseId, vertical: 'init-analysis' }, fn)
        │
        └─ ... 其他业务节点
              │
              ↓
           createChatModel(...)                ← 【已存在工厂，本次改造】
              │ 出口包 LangfuseModelProxy（同步）：
              │   - 拦截 invoke / stream / batch / streamEvents
              │   - 从 ALS 取业务上下文（同步读，无异步穿透问题）
              │   - 注入 RunnableConfig：
              │       runName: ctx.vertical                          ← 顶层（trace 列表可读名）
              │       tags: [vertical, env]                          ← 顶层
              │       metadata: { langfuseUserId, langfuseSessionId, runId, requestId, ...业务实体 } ← camelCase
              │       callbacks: [...existing, langfuseCallbackHandler]
              ↓
           model.invoke / .stream / .batch / .streamEvents
              │
              ↓ LangChain 触发 langfuseCallbackHandler，生成 OTel span
              │   span.attributes 来自上述 RunnableConfig.metadata + tags + runName
              │
              ↓ OTel NodeSDK 全局 tracer provider
              │   ↓ LangfuseSpanProcessor（在 server/plugins/langfuse-otel.ts 注册）
              │       ↓ shouldExportSpan 钩子：tags 含 'langfuse:nostream' → false（统一豁免闸口）
              │       ↓ mask 钩子：递归遍历 data，string 节点调 redactPII
              │       ↓ 后台批量异步上送
              │
              ↓ https://langfuse.lexseek.cn
                 trace_id（OTel 自动随机分配）
                 user_id, session_id, tags, metadata（含 runId）, input/output（已脱敏）
```

**关键解释**：

- **代理拦截负责"业务上下文注入"**（user/session/runId 等到 metadata、tags、runName），是同步操作；ALS 在调用栈内同步可读，不存在跨异步迭代穿透问题
- **OTel NodeSDK 负责"trace 上送"**——它通过全局 tracer provider 接管所有 OTel span（包括 LangChain callback 生成的 span 和未来可能加入的其它 OTel span），自带异步队列、批量、重试、关闭刷新
- **mask + shouldExportSpan 钩子在 LangfuseSpanProcessor 上**（不在 CallbackHandler 上）——v5 SDK 的稳定 API 形态。`langfuse:nostream` 豁免在 OTel 模式下必须放在 SpanProcessor 上，因为子 span（如 chain → llm → tool 内嵌调用）不会经过 modelProxy 的 invoke 拦截

### 3.2 模块清单

| 路径 | 类型 | 职责 |
|------|------|------|
| `server/lib/langfuse/index.ts` | 新增 | 统一 barrel 导出（与 `server/lib/payment/`、`storage/`、`oss/` 风格一致），业务侧只 import 此入口 |
| `server/lib/langfuse/types.ts` | 新增 | `LangfuseTraceContext` / `LangfuseVertical` 等类型集中定义 |
| `server/lib/langfuse/client.ts` | 新增 | Langfuse `CallbackHandler` 单例 + 初始化失败兜底（noop handler）；同时导出运行时配置访问器 `getLangfuseRuntimeConfig()`（首次调用缓存 `useRuntimeConfig().langfuse`，便于测试 mock） |
| `server/lib/langfuse/context.ts` | 新增 | AsyncLocalStorage store + `withLangfuseContext(patch, fn)` / `getLangfuseContext()` helpers |
| `server/lib/langfuse/redactPII.ts` | 新增 | PII 脱敏纯函数（4 类正则，手机号正则复用 `shared/utils/phone.ts` 的 `validatePhone` 同款核心常量）+ 单测内联 cases。**mask 钩子接收 stringified JSON 字符串**（v5 SDK 行为），直接对整段字符串调 `redactPII` 即可；嵌套对象内的 PII 子串也会被正则匹配到 |
| `server/lib/langfuse/modelProxy.ts` | 新增 | 包装 `BaseChatModel`，拦截 invoke/stream/batch/streamEvents；只注入 RunnableConfig（runName / tags / metadata / callbacks），不参与 nostream 豁免 |
| `server/middleware/04.langfuseContext.ts` | 新增 | HTTP 入口处 `withLangfuseContext()` 起根上下文 |
| `server/plugins/langfuse-otel.ts` | 新增 | Nitro plugin：启动 OpenTelemetry NodeSDK、注册 LangfuseSpanProcessor（含 mask + shouldExportSpan 钩子）、`tracingEnabled=false` 时直接 skip 不启 SDK；同文件挂 Nitro `close` hook 调 `await nodeSdk.shutdown()`（无需独立 plugin） |
| `server/services/node/chatModelFactory.ts` | 改造 | 在 `createChatModel()` 返回前用 `wrapWithLangfuse(model)` 包一层 |
| `server/services/agent-platform/tools/invokeNodeJson.ts` | 改造 | tag 从 `langsmith:nostream` 改为 `langfuse:nostream` |
| `package.json` | 改造 | + `@langfuse/langchain` `@langfuse/core` `@langfuse/otel` `@langfuse/tracing` `@opentelemetry/api` `@opentelemetry/sdk-node`；− `langsmith`（PR 3） |
| `nuxt.config.ts` | 改造 | `runtimeConfig.langfuse = { secretKey, publicKey, baseUrl, tracingEnabled, maskPII, environment, gitSha }` |
| `.env.example` | 改造 | 新增 6 个 LANGFUSE_* 环境变量样例 |
| `tests/_infra/global-setup.ts` | 改造 | 强制 `process.env.LANGFUSE_TRACING_ENABLED='false'` |
| `docs/tech-docs/backend/langfuse.md` | 新增 | 接入指南 + metadata.runId 反查 SOP + 故障排查（PR 3 产出，章节由实施时定） |
| `.claude/rules/git.md` | 改造 | scope 列表追加 `observability` |

### 3.3 ALS 上下文模型

```ts
// server/lib/langfuse/types.ts
export type LangfuseTraceContext = {
  // 基础（中间件填）
  requestId: string

  // 鉴权后填（公开 API 例外，可空）
  userId?: number

  // agent 执行才有（agent 入口填）
  runId?: string        // = agentRuns.id；写入 metadata.runId 用于反查
  sessionId?: string    // = caseSessions.sessionId / contractReviews.sessionId / documentDrafts.sessionId
  threadId?: string     // = sessionId（项目里 thread_id 就是 sessionId）

  // 业务实体（按场景填，可同时多个）
  caseId?: number
  reviewId?: string     // contractReviews.id
  draftId?: string      // documentDrafts.id
  materialId?: string

  // 维度
  vertical?: LangfuseVertical
}

export type LangfuseVertical =
  | 'case-main'
  | 'case-analysis'
  | 'case-module'
  | 'contract'
  | 'document'
  | 'legal-assistant'
  | 'init-analysis'      // 案件初始化（initAnalysis.service.ts）
  | 'extract'            // 案件信息提取（extract.post.ts）
  | 'intent-classifier'  // 检索意图分类
  | 'material-summary'   // 素材摘要
  | 'sub-agent'          // 子 agent 工具执行
  | 'invoke-node-json'   // 节点 JSON 调用
```

**填充时机**（分层叠加，外层不被内层覆盖；内层只增量补字段）：

| 时机 | 填什么 | 由谁填 |
|------|--------|--------|
| `04.langfuseContext` 中间件 | `requestId`、`userId`（鉴权后） | 框架统一 |
| `enqueueRunService` 入口 | `runId`、`sessionId`、`threadId`、初始 `vertical` | 业务（agent 调度） |
| `runtime.ts` 顶层 | `vertical`（覆盖/明确） | agent-platform |
| 案件初始化 / 提取 / 合同上传 / 文档生成 / 助手会话 / 检索 / 素材摘要 入口 | `caseId` / `reviewId` / `draftId` / `materialId` / `vertical` | 各业务服务 |

**API 形态**：

```ts
// server/lib/langfuse/context.ts

// 包裹一段异步代码，patch 字段会增量合入当前 ALS 上下文（业务节点用）
export async function withLangfuseContext<T>(
  patch: Partial<LangfuseTraceContext>,
  fn: () => Promise<T>,
): Promise<T>

// 同步进入 ALS 上下文（仅供 H3 middleware 用——middleware 是顺序执行的、
// 没有 callback 包裹结构，必须用 enterWith 而非 run）
export function enterLangfuseContext(patch: Partial<LangfuseTraceContext>): void

// 从当前 ALS 取上下文（无则返回 undefined）
// 同步函数，在 modelProxy 拦截器内同步调用
export function getLangfuseContext(): LangfuseTraceContext | undefined
```

### 3.4 字段映射

| Langfuse 字段 | 来源 | 在 RunnableConfig 中的位置 | 示例 |
|--------------|------|-----------------------------|------|
| `trace_id` | **OTel 自动随机分配**（不再用确定性算法） | — | OTel W3C trace ID |
| `runName`（trace 列表的可读名） | `ctx.vertical ?? config.runName` | 顶层 `runName: string` | `"contract"` / `"case-analysis"` |
| `user_id` | `String(ctx.userId)` | `metadata.langfuseUserId` | `"123"` |
| `session_id` | `ctx.sessionId` | `metadata.langfuseSessionId` | `"sess_..."` |
| `tags` | `[ctx.vertical, environment]`（短小、低基数，便于在 Langfuse 后台做 tag 筛选；同时 `langfuse:nostream` tag 透传到 SpanProcessor 触发豁免） | **顶层 `tags: string[]`**（不是 metadata 子键） | `["contract", "development"]` |
| `metadata`（业务字段） | `{ requestId, runId, caseId, reviewId, draftId, materialId, scope, gitSha, environment }`（`scope` 由 `vertical` 前缀推导：`case-*` / `init-analysis` / `extract` → `CASE`、`contract` → `CONTRACT`、`document` → `DOCUMENT`、`legal-assistant` → `ASSISTANT`、`material-summary` → `MATERIAL`、`intent-classifier` → `RETRIEVAL`、`sub-agent` / `invoke-node-json` → `TOOL`） | `metadata.<key>`（业务自由字段，camelCase 命名） | 全字段对象 |
| `input` / `output` | LangChain callback 自动提供，序列化为 stringified JSON 后**经 `LangfuseSpanProcessor.mask` 钩子调 `redactPII(data)` 整段脱敏**再上送 | — | stringified JSON；正则会匹配到嵌套对象内的 PII 子串 |

> **字段大小写铁律**：JS SDK v5 的 metadata 前缀字段是 **camelCase**（`langfuseUserId` / `langfuseSessionId`），**不是 Python SDK 的 snake_case**（`langfuse_user_id` / `langfuse_session_id`）。误用 snake_case 会被当成普通业务 metadata，trace 的 user_id / session_id 列将为空。

> **trace_id 不再确定性**：v5 OTel 模式下 `RunnableConfig.runId` 是 LangChain 内部 run-tree 标识（用于串联同次 invoke 的 chain → llm → tool 子运行的回调参数），**与 Langfuse trace_id 完全无关**。Langfuse 真正的 trace_id 由 OTel W3C 标准随机分配。如需"runId → 找 trace"，在 Langfuse UI 用 metadata 过滤器搜 `runId=xxx` 即可（详见 §3.5）。

`environment` 字段固定来自 `LANGFUSE_ENVIRONMENT` env（推导自 `NODE_ENV` / `NUXT_ENV`，取值 `development` / `staging` / `production`）。

`gitSha` 字段在构建期通过 `nuxt.config.ts` runtimeConfig 注入（取 `process.env.GIT_SHA` 或编译时执行 `git rev-parse --short HEAD`）；运行时只读。

### 3.5 反查 SOP（基于 metadata）

> 5check 二轮事实核对结论：v5 OTel 模式下 LangChain 的 `RunnableConfig.runId` 不会成为 Langfuse trace_id 种子，确定性算法 `createTraceId(seed)` 必须配合 `startActiveObservation` + `parentSpanContext` 才能生效——为简化复杂度，本 spec 选 B 档放弃确定性 trace_id，反查走 metadata。

**trace 上的反查字段**（modelProxy 强制写入所有 trace 的 metadata）：

| 字段 | 来源 | 用途 |
|------|------|------|
| `runId` | ALS context | agent 执行级反查（最常用）|
| `requestId` | ALS context | HTTP 请求级反查（无 runId 的轻量 LLM 调用如意图分类）|
| `caseId / reviewId / draftId / materialId` | ALS context | 业务实体级反查 |

**正向查询**（已知 runId → 找 trace）：

1. 从项目库 `agentRuns` 表查到 `runId`
2. 浏览器打开 Langfuse 后台 → Traces 列表
3. 点 Filter → metadata → key=`runId` value=`<runId>` → 即可定位 trace

**反向查询**（已知 traceId → 找业务记录）：

1. 在 Langfuse 上看到一条 trace
2. 点开 trace 详情 → metadata 面板看 `runId` / `requestId` / `caseId` 等字段
3. 拿到 runId 去 `agentRuns` 表查关联的 sessionId / userId / caseId / threadId

**轻量 LLM 调用反查**（intentClassifier、material 摘要等无 runId 的场景）：metadata 写入 `requestId` + `userId` + 业务实体 ID，可通过这些维度过滤。

### 3.6 PII 脱敏方案

**纯函数签名**：

```ts
// server/lib/langfuse/redactPII.ts
export function redactPII(text: string): string
```

> **为什么不需要递归 helper**：5check 三轮事实核对（`@langfuse/otel` v5 文档 + 源码）确认 mask 钩子的 `data` 参数是 **stringified JSON 字符串**（"stringified JSON of attribute values"），不是结构化对象。整段 string 上跑 4 类 PII 正则，嵌套对象内的 PII 子串也会被匹配（即使是 `"110101199003078515"` 这样带引号的 JSON 值，引号也是 word boundary）。

**4 类规则（顺序应用）**：

| 类型 | 正则 | 替换为 | 备注 |
|------|------|--------|------|
| 身份证号 | `\b[1-9]\d{5}(?:18\|19\|20)\d{2}(?:0[1-9]\|1[012])(?:0[1-9]\|[12]\d\|3[01])\d{3}[\dXx]\b` + 末位校验码验证 | `***IDCARD***` | 严格 18 位 + 校验码（避免误伤"110000 元"等数字串） |
| 手机号 | `(?<![\d])1[3-9]\d{9}(?![\d])` | `***PHONE***` | 独立词边界（前后非数字）；**核心 `1[3-9]\d{9}` 复用 `shared/utils/phone.ts` 的 `validatePhone` 同款常量**（避免两处维护歧义） |
| 邮箱 | `[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}` | `***EMAIL***` | 标准 RFC 5322 简化版 |
| 银行卡号 | `(?<![\d])\d{16,19}(?![\d])` | `***BANKCARD***` | 独立词边界（避免误伤合同条款编号） |

**应用位置**：v5 SDK 的 `mask` 钩子挂在 `LangfuseSpanProcessor` 构造时（**不**在 CallbackHandler 上），同时 `shouldExportSpan` 钩子统一处理 `langfuse:nostream` 豁免：

```ts
// server/plugins/langfuse-otel.ts（伪代码）
import { NodeSDK } from '@opentelemetry/sdk-node'
import { LangfuseSpanProcessor } from '@langfuse/otel'
import { redactPII } from '~~/server/lib/langfuse/redactPII'
import { getLangfuseRuntimeConfig } from '~~/server/lib/langfuse'

export default defineNitroPlugin((nitroApp) => {
  const cfg = getLangfuseRuntimeConfig()
  if (!cfg.tracingEnabled) {
    // 测试 / 显式禁用环境直接 skip，不启 NodeSDK
    return
  }

  const enableMask = cfg.environment === 'production' ? true : cfg.maskPII

  const spanProcessor = new LangfuseSpanProcessor({
    publicKey: cfg.publicKey,
    secretKey: cfg.secretKey,
    baseUrl: cfg.baseUrl,
    environment: cfg.environment,
    mask: enableMask
      // data 是 stringified JSON（v5 SDK 行为，非对象），直接整段脱敏
      ? ({ data }: { data: string }) => redactPII(data)
      : undefined,
    shouldExportSpan: ({ otelSpan }) => {
      // tags 透传到 OTel span attributes 后用 attribute key 'langfuse.trace.tags' 取
      const tags = otelSpan.attributes['langfuse.trace.tags'] as string[] | undefined
      return !tags?.includes('langfuse:nostream')
    },
  })

  const sdk = new NodeSDK({ spanProcessors: [spanProcessor] })
  sdk.start()

  // 同文件挂 close hook，无需独立 plugin
  nitroApp.hooks.hook('close', async () => {
    await sdk.shutdown()
  })
})
```

> **`shouldExportSpan` attribute key 名称**：`langfuse.trace.tags` 是 v5 SDK 把 RunnableConfig.tags 写到 OTel span 时使用的标准 attribute key。PR 1 实施时再次 read `node_modules/@langfuse/otel/dist/...` 确认（如有变动以源码为准）。

**调试模式**：

- env `LANGFUSE_MASK_PII=false` → 关闭脱敏（仅 dev 生效）
- env `LANGFUSE_MASK_PII=true` 或未设置 → 启用脱敏
- **prod 环境强制启用**：`langfuse-otel.ts` 中判断 `environment === 'production'` 时无视 env 变量值，强制 `enableMask = true`

**单测覆盖**（`tests/server/langfuse/redactPII.test.ts`，**用 `it.each` 内联**）：

```ts
describe('redactPII（标量）', () => {
  it.each([
    ['身份证 110101199003078515', '身份证 ***IDCARD***'],
    ['金额 110000 元', '金额 110000 元'],
    ['电话 13800138000', '电话 ***PHONE***'],
    ['合同编号 13800138000111222', '合同编号 13800138000111222'],
    ['邮箱 abc@def.com', '邮箱 ***EMAIL***'],
    ['卡号 6225881234567890', '卡号 ***BANKCARD***'],
    ['条款编号 622588123456789012345', '条款编号 622588123456789012345'],
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

> 银行卡 / 合同编号的歧义无法 100% 区分；规则倾向"宁可少打码不可误打码主体内容"。spec 接受这个 trade-off。

### 3.7 chatModelFactory 代理拦截设计

**问题**：直接 `model.bind({ callbacks: [handler] })` 会污染 model 实例；运行时业务上下文（user/session/runId）每次请求都不同，必须按调用动态注入。

**方案**：通过 ES Proxy 包装 model，拦截 `invoke` / `stream` / `batch` / `streamEvents` 四个调用方法，从 ALS 取上下文动态合入 RunnableConfig：

```ts
// server/lib/langfuse/modelProxy.ts（伪代码）
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

      return async function (this: unknown, input: unknown, config?: any, ...rest: unknown[]) {
        const handler = getLangfuseHandler()      // 单例；初始化失败时返回 noop
        const cfg = getLangfuseRuntimeConfig()    // 缓存版本
        const ctx = getLangfuseContext()
        const incomingTags = config?.tags ?? []

        const mergedConfig = {
          ...config,
          // trace 列表上的可读名（按 vertical 一眼看出业务线）
          runName: config?.runName ?? ctx?.vertical,
          // tags 顶层；nostream 透传给 SpanProcessor.shouldExportSpan 处理
          tags: [...incomingTags, ctx?.vertical, cfg.environment].filter(Boolean),
          callbacks: [...(config?.callbacks ?? []), handler],
          metadata: {
            ...(config?.metadata ?? {}),
            // camelCase！前缀字段必须严格一致
            langfuseUserId: ctx?.userId !== undefined ? String(ctx.userId) : undefined,
            langfuseSessionId: ctx?.sessionId,
            // 业务自由 metadata（反查靠这些字段，详见 §3.5）
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
  })
}
```

**关于"漏拦截"风险**：v5 OTel 全局 tracer provider 是真正的兜底——所有 OTel span（无论是否经过本代理）都会被 `LangfuseSpanProcessor` 捕获并上送。代理只负责"往 RunnableConfig 写业务上下文"。即使某些 LangChain 高级用法（如未来引入 `RunnableWithFallbacks`）绕过 invoke 拦截，**trace 主体不会丢**，只是该 trace 的 user/session/业务实体字段会缺失（可后续按需补）。

> **注**：spec 草稿曾考虑"代理 + LangChain 全局 callback 注册"双保险；经 5check 实测，LangChain JS 1.x 没有公开"全局 callback 注册" public API，双保险方案在 JS 端不成立；改由 OTel 全局机制接管即可。

> **`langfuse:nostream` 豁免**：在 OTel 模式下，子 span（chain → llm → tool 内嵌调用）不会经过 modelProxy 的 invoke 拦截。如果只在 modelProxy 层判 nostream，外层带 nostream 也挡不住内层 LLM 调用上报。**统一闸口必须放在 `LangfuseSpanProcessor.shouldExportSpan` 上**（见 §3.6 plugin 伪代码）；modelProxy 把 tag 透传即可，不参与豁免判断。

**改造点 `chatModelFactory.ts`**（最小改动）：

```ts
// 改造前
export function createChatModel(config: ChatModelConfig): BaseChatModel {
  // ... 现有逻辑
  return model
}

// 改造后
import { wrapWithLangfuse } from '~~/server/lib/langfuse'

export function createChatModel(config: ChatModelConfig): BaseChatModel {
  // ... 现有逻辑
  return wrapWithLangfuse(model)
}
```

### 3.8 cron / agent-worker 等非 HTTP 触发场景

项目里有非 HTTP 入口会触发 LLM 调用（来自 `server/plugins/agent-worker.ts` / `cron-scheduler.ts`）。这些场景没有 HTTP 中间件来填 ALS 上下文。

**方案**：在 worker / cron 任务的执行入口处独立做 `withLangfuseContext()`，从任务参数（`agentRuns.id` / `userId` / `sessionId` / `caseId`）重建上下文：

```ts
// server/plugins/agent-worker.ts（伪代码）
worker.process(async (job) => {
  const { runId, userId, sessionId, caseId, vertical } = job.data
  return withLangfuseContext(
    {
      requestId: `worker:${job.id}`,
      runId, userId, sessionId, threadId: sessionId, caseId, vertical,
    },
    () => executeAgentRun(job.data),
  )
})
```

PR 2 必须显式覆盖这个改造点。

---

## 4. 配置

### 4.1 环境变量

```bash
# .env.example 新增段落
LANGFUSE_PUBLIC_KEY="pk-lf-..."         # 必填；当前 dev 环境值见配置中心
LANGFUSE_SECRET_KEY="sk-lf-..."         # 必填
LANGFUSE_BASE_URL="https://langfuse.lexseek.cn"  # 自托管地址
LANGFUSE_TRACING_ENABLED="true"         # 测试环境强制 false
LANGFUSE_MASK_PII="true"                # prod 强制 true 不可关
LANGFUSE_ENVIRONMENT="development"      # development/staging/production
```

### 4.2 nuxt.config.ts 注入

```ts
// nuxt.config.ts → runtimeConfig
runtimeConfig: {
  // ... 现有字段
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
},
```

### 4.3 当前 dev 环境配置（仅记录，不入仓库）

```
LANGFUSE_SECRET_KEY=sk-lf-88a69096-d3cc-4cd5-b2df-69db4242830e
LANGFUSE_PUBLIC_KEY=pk-lf-a46630fa-bfd7-4815-84ef-7941390a65cd
LANGFUSE_BASE_URL=https://langfuse.lexseek.cn
```

---

## 5. 实施路径（PR 拆分）

> 5check 后已合并原 PR 0 spike：v5 OTel 模式下，ALS 仅需在调用栈内同步保持，是 Node ALS 标准用法，无需独立 spike PR。改为在 PR 1 step 1 加一个 5 行的 ALS 同步保持验证测试。

### PR 1 · 基建落地

**步骤**（一个 commit 一个 step，原子提交，commit message 模板见末尾；**git.md scope 改造放第一步，让规则先于业务 commit 落地**）：

1. **scope 规则先行 + ALS 验证 + 装包**：
   - 改造 `.claude/rules/git.md`：scope 列表追加 `observability`
   - 新增 `tests/server/lib/langfuse/als-sync.test.ts`：用最小测试验证"业务 fn 内 `als.run({ marker })`，立即调用一个同步函数 `getStore()`，能取到 `marker`"——这是 OTel 模式下唯一需要的 ALS 行为
   - `bun add @langfuse/langchain @langfuse/core @langfuse/otel @langfuse/tracing @opentelemetry/api @opentelemetry/sdk-node`
   - **langsmith 暂留**——它是 `package.json` 直接依赖且可能被 `deepagents` 内部使用，移除工作放到 PR 3
2. 新增 `server/lib/langfuse/redactPII.ts`（仅 `redactPII` 函数）+ 单测（`it.each` 标量 cases + stringified JSON 嵌套 case）；同 commit 建立 `server/lib/langfuse/types.ts` + `server/lib/langfuse/index.ts` barrel
3. 新增 `server/lib/langfuse/context.ts`（ALS store + helpers）+ 单测
4. 新增 `server/lib/langfuse/client.ts`（CallbackHandler 单例 + noop 兜底 + `getLangfuseRuntimeConfig` 缓存访问器）+ 单测（mock SDK）
5. 新增 `server/lib/langfuse/modelProxy.ts` + 单测：mock model + 验证 RunnableConfig 注入（runName / tags 顶层 / camelCase metadata 字段名 / runId 写入 metadata 而非顶层）
6. 新增 `server/middleware/04.langfuseContext.ts` + 集成测试
7. 新增 `server/plugins/langfuse-otel.ts`（含 NodeSDK 启动 + LangfuseSpanProcessor + mask + shouldExportSpan + close hook + tracingEnabled gate）+ 单测：用 `BasicTracerProvider + InMemorySpanExporter` 测 SpanProcessor 的 `onStart`/`onEnd` + `shouldExportSpan`/`mask` 行为，**不启 NodeSDK**避免多 worker 全局 provider 冲突
8. 改造 `server/services/node/chatModelFactory.ts`：`return wrapWithLangfuse(model)`
9. 改造 `server/services/agent-platform/tools/invokeNodeJson.ts`：tag `langsmith:nostream` → `langfuse:nostream`
10. 改造 `nuxt.config.ts` runtimeConfig；改造 `.env.example`
11. 改造 `tests/_infra/global-setup.ts`：强制 `LANGFUSE_TRACING_ENABLED=false`

**验证**：
- `npx nuxi typecheck` 通过
- `npx vitest run tests/server/lib/langfuse/` 全部通过
- 5 个核心模块（redactPII / context / client / modelProxy + langfuse-otel.ts plugin）单测覆盖率 100%（types.ts / index.ts 仅 export 不计）
- 现有所有测试通过（不引入回归）

### PR 2 · 业务接入

**步骤**：在每个业务节点入口加 `withLangfuseContext()` 包裹（具体调用点见附录 C）：

| 入口 | 改造内容 |
|------|---------|
| `server/services/agent/agentRun.service.ts` `enqueueRunService` | 包裹 → `{ runId, sessionId, threadId, userId, vertical }` |
| `server/services/agent-platform/factory/runtime.ts` agent 入口 | 包裹 → `{ vertical }`（vertical 来自 domain agent 注册 metadata） |
| `server/services/case/initAnalysis.service.ts` | 包裹 → `{ caseId, vertical: 'init-analysis' }` |
| `server/api/v1/cases/extract.post.ts` | 包裹 → `{ caseId?, vertical: 'extract' }`（caseId 可能不存在） |
| `server/agents/contract/uploadClientVersion.service.ts` | 包裹 → `{ reviewId, caseId?, vertical: 'contract' }` |
| `server/services/assistant/assistantSession.service.ts` | 包裹 → `{ sessionId, vertical: 'legal-assistant' }` |
| `server/services/retrieval/intentClassifier.service.ts` | 包裹 → `{ vertical: 'intent-classifier' }`（无业务实体） |
| `server/services/material/material.service.ts` | 包裹 → `{ materialId, caseId?, draftId?, vertical: 'material-summary' }` |
| `server/agents/case-analysis/runAnalysisSubAgent.ts` | 包裹 → `{ vertical: 'case-analysis' }` |
| `server/services/agent-platform/subAgent/subAgentToolFactory.ts` | 包裹 → `{ vertical: 'sub-agent' }` |
| `server/services/agent-platform/tools/invokeNodeJson.ts` | 包裹 → `{ vertical: 'invoke-node-json' }` |
| `server/services/workflow/agents/caseMainAgent.ts` 等 vertical workflow agents | 包裹 → 各自 vertical |
| `server/plugins/agent-worker.ts` 任务入口 | 从 `job.data` 重建上下文 |
| `server/plugins/cron-scheduler.ts` 任务入口（如果有 LLM 调用） | 同上 |

**集成测试**：每条业务线至少 1 个 case，mock LangfuseSpanProcessor.onStart 捕获 OTel span 属性，断言：

```ts
// tests/server/integration/langfuse-business-trace.test.ts（示意）
it('案件初始化 → trace 应携带 caseId 和 vertical=init-analysis', async () => {
  const spans = mockSpanProcessor.captureSpans()
  await runInitAnalysis(caseId)
  const span = spans[0]
  expect(span.attributes['langfuse.observation.metadata.caseId']).toBe(caseId)
  expect(span.attributes['langfuse.trace.tags']).toContain('init-analysis')
})
```

### PR 3 · 清理 + 文档 + E2E

1. **验证 `deepagents` 是否真的依赖 `langsmith`**：本地启动 `bun dev`，触发一次 deep-agent 工作流；如果运行不报缺包错 → `bun remove langsmith`；否则 langsmith 保留（写入 spec 备注：保留是因为 deepagents 运行时依赖）
2. 全项目 grep `langsmith`，确认零业务代码残留（除 `langfuse:nostream` 这个 tag 外）
3. `docs/tech-docs/backend/langfuse.md` 完整文档（架构图、接入指南、metadata.runId 反查 SOP、故障排查）
4. `docs/tech-docs/README.md` 加入 langfuse.md 导航
5. **手工 E2E**：开发账号登录 dev 环境，跑一遍：
   - 案件初始化 → 看 trace
   - 案件分析对话 → 看 trace（用 metadata.runId 过滤定位）
   - 合同审查 → 看 trace
   - 通用问答对话 → 看 trace
   - 验证：user_id / session_id / tags / metadata.runId / metadata.caseId / metadata.runId 全对、PII 已脱敏（含嵌套 messages 内）、token 数有值
6. 完成 E2E checklist（见附录 B）

### Commit message 模板

按 `.claude/rules/git.md` 的 conventional commit 中文规范，scope 用本次新加的 `observability`（PR 1 step 1 落地）：

```
feat(observability): scope 规则与 ALS 同步语义验证测试
feat(observability): 新增 PII 脱敏纯函数与递归 helper
feat(observability): 新增 ALS 上下文与 with 包裹 helper
feat(observability): 新增 Langfuse 客户端单例与 noop 兜底
feat(observability): chatModelFactory 出口包 LangfuseModelProxy
feat(observability): 启动 OpenTelemetry NodeSDK 与 LangfuseSpanProcessor
refactor(observability): 案件初始化入口注入 Langfuse 上下文
chore(observability): 移除 langsmith 依赖（deepagents 验证后）
docs(observability): 新增 Langfuse 接入指南与反查 SOP
test(observability): 业务集成测试断言 trace 字段映射
```

---

## 6. 验收标准

| PR | 必须满足 |
|----|---------|
| **PR 1** | `npx nuxi typecheck` 通过；5 个核心模块（redactPII + context + client + modelProxy + langfuse-otel.ts plugin）单测 100% 覆盖（types/index 仅 export 不计）；mock SDK 验证 RunnableConfig 字段映射（runName / tags 顶层 / camelCase metadata / runId 写入 metadata）；`langfuse-otel.ts` 用 BasicTracerProvider + InMemorySpanExporter 单测覆盖 mask 闭包递归脱敏 + shouldExportSpan 豁免 + tracingEnabled gate 三件事；现有所有测试无回归 |
| **PR 2** | 每条业务线至少 1 个集成测试，断言 OTel span 属性正确；`grep -r "withLangfuseContext" server/` 验证至少 13 处使用 |
| **PR 3** | 手工 E2E checklist 全过；deepagents 依赖验证完成（langsmith 移除或留备注原因）；`docs/tech-docs/backend/langfuse.md` 完整 |

---

## 7. 风险清单

| # | 风险 | 概率 | 应对 |
|---|------|------|------|
| 1 | ALS 在调用栈内同步丢失（理论极低，但需要测试覆盖） | 极低 | PR 1 step 1 的 `als-sync.test.ts` 验证；OTel 模式不依赖跨异步迭代穿透，风险低于 spec v1 设计 |
| 2 | 代理漏拦截（如未来引入 `RunnableWithFallbacks` / `RunnableMap`） | 低 | OTel 全局 tracer provider 接管 trace 落地；漏拦截只丢业务上下文（user/session 字段空），不丢 trace 主体；建议代理白名单包含 `streamEvents`；后续若引入 fallbacks 再补 |
| 3 | PII 正则误伤（合同金额被当成身份证 / 合同条款编号被当成银行卡） | 中 | 严规则（身份证 18 位+校验码、独立词边界）；`it.each` 内联 cases 防回归；trade-off：宁可少打码不可误伤主体 |
| 4 | Langfuse 服务/网络故障 | 低 | 全局 try/catch；handler 初始化失败 → fallback 到 noop handler；OTel SDK 后台批量队列阻塞自动丢老的（drop tail） |
| 5 | trace_id 反查不便（B 档 trade-off） | 低 | 已记录反查 SOP（§3.5）：在 Langfuse UI metadata 过滤器搜 `runId=xxx`；`agentRuns` 表与 trace 通过 metadata.runId 双向可达，无数据丢失 |
| 6 | 生产性能影响 | 低 | OTel SDK 异步批量，无主流程阻塞；最坏情况内部队列爆，按默认丢老的 |
| 7 | ALS 在 cron / agent-worker 等异步任务中丢失 | 中 | PR 2 显式覆盖：在 worker / cron 任务执行入口独立 `withLangfuseContext()` 重建 |
| 8 | 测试环境意外上送到生产 Langfuse | 低但严重 | `tests/_infra/global-setup.ts` 强制 `LANGFUSE_TRACING_ENABLED='false'`；`langfuse-otel.ts` 已在 `tracingEnabled=false` 时直接 skip 不启 NodeSDK；CI 同样强制；hard rule 写入 spec |
| 9 | `LangfuseSpanProcessor.mask`/`shouldExportSpan` 签名与 SDK 实际不一致（5check 二轮已用 v5.2.0 文档/源码确认形态，但 SDK 后续小版本更新可能调整） | 低 | PR 1 step 7 实施前再次 read `node_modules/@langfuse/otel/dist/...` 确认；如签名变动，修订 `langfuse-otel.ts` 闭包写法 |
| 10 | OTel NodeSDK 启动顺序：必须先于任何 createChatModel 调用 | 低 | Nitro plugin 默认按文件名字母序加载，`langfuse-otel.ts` < `agents-load.ts` 字母序天然有序；若仍需强制可用 `nuxt.config.ts` plugin 排序配置（不引入数字前缀以保持目录命名一致性）；PR 1 step 7 实施时确认 |

---

## 8. 不在本次范围（留口子）

| 能力 | 推迟原因 | 触发时机 |
|------|---------|---------|
| 用户反馈打分（前端 score 按钮） | 是独立的产品决策（按钮放哪、奖励/惩罚机制），不该跟基建 PR 绑死 | 产品侧明确"要做反馈"时启动 |
| Langfuse Prompt Management | 现有 `nodePromptVersion` 体系已实现版本管理 + 热加载 | 需要做 prompt A/B 测试或多版本灰度时再考虑 |
| 业务步骤自定义 span | 本次只在 1-2 处示范，其它待"看到 trace 后才知道哪里需要补" | 排查具体业务问题时按需补 |
| 跨服务 / 全栈 OTel span（HTTP / DB / fetch） | OTel 已就位，但本期不引入额外 instrumentation 包 | 未来出现"trace 跨进程"或"想看完整请求链路"需求时启用对应 OTel auto-instrumentation |
| 确定性 trace_id 反查（A 档） | 需引入 `startActiveObservation` + `parentSpanContext`，trace 拓扑会多一层包裹 span，复杂度收益不匹配 | 若产品后续要求"用 runId 一键直达 trace"无中间步骤，可补回 A 档（§3.5 备注 B 档 trade-off） |

---

## 附录 A：PR 1 step 1 ALS 同步保持验证测试

**测试文件**：`tests/server/lib/langfuse/als-sync.test.ts`

**目的**：v5 OTel 模式下，业务上下文注入由 modelProxy 在 invoke 调用瞬间同步完成（从 ALS 取上下文 → 写入 RunnableConfig）。这一行为的可靠性建立在"Node.js ALS 在调用栈内同步保持"这一标准语义上。spike 测试一次性验证。

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
})
```

**通过条件**：两个断言均通过（Node.js 18+ 一定通过，作为冒烟测试存在）。

---

## 附录 B：PR 3 手工 E2E 验收 checklist

**前置**：dev 环境 `.env` 配齐 LANGFUSE_* 变量；启动 `bun dev`；浏览器登录 dev Langfuse `https://langfuse.lexseek.cn`。

**步骤 1：案件分析对话**

- [ ] 创建案件 → 上传素材 → 触发初始化分析
- [ ] 在 `agentRuns` 表查到本次 runId（记下）
- [ ] Langfuse 后台 → Traces → Filter → metadata key=`runId` value=记下的 runId → 定位 trace
- [ ] trace 详情：
  - [ ] `user_id` = 当前登录用户的 `users.id`
  - [ ] `session_id` = 案件 sessionId
  - [ ] `tags` 含 `case-analysis` 和 `development`
  - [ ] `runName` = `case-analysis`（trace 列表可读名）
  - [ ] `metadata.runId` = 本次 runId
  - [ ] `metadata.caseId` = 案件 ID
  - [ ] 至少 1 个 LLM generation，input/output 中**身份证号已脱敏成 `***IDCARD***`**（含嵌套 messages 内的字段）
  - [ ] generation 上有 token 数

**步骤 2：合同审查**

- [ ] 上传合同 → 触发审查
- [ ] Langfuse 后台用 metadata.runId 找到 trace
- [ ] `tags` 含 `contract`；`runName` = `contract`
- [ ] `metadata.reviewId` = `contractReviews.id`
- [ ] `metadata.caseId` 对应正确（可空）

**步骤 3：通用问答对话**

- [ ] 通用问答输入问题 → 等待回答
- [ ] Langfuse 用 metadata.runId 找到 trace
- [ ] `tags` 含 `legal-assistant`；`runName` = `legal-assistant`
- [ ] `metadata.caseId` 应为空

**步骤 4：调试模式（仅 dev）**

- [ ] 设 `LANGFUSE_MASK_PII=false` 重启 → 重跑步骤 1
- [ ] trace 中身份证号**应为原文**（验证开关有效）
- [ ] 改回 `LANGFUSE_MASK_PII=true`

**步骤 5：故障兜底**

- [ ] 临时把 `LANGFUSE_BASE_URL` 改成无效域名 → 重启
- [ ] 重跑案件分析
- [ ] 业务流程**正常完成**（不报错、不阻塞）
- [ ] 服务端日志有 `langfuse: ...` 警告但无 ERROR

**步骤 6：nostream 豁免**

- [ ] 在 `invokeNodeJson` 触发的节点 JSON 调用上确认 trace **不出现**在 Langfuse（验证 `langfuse:nostream` 在 SpanProcessor.shouldExportSpan 上生效）
- [ ] 该节点的内嵌子 LLM 调用同样不出现（验证 OTel 子 span 也被豁免）

---

## 附录 C：项目里 `createChatModel` 调用点完整清单（共 18 处）

> 行号截至 spec 起草日 2026-05-04。**实施 PR 2 前必须用 `grep -n createChatModel server/ -r` 重新核对路径与函数位置**——CLAUDE.md 终极规则要求"必须通过 grep 真实代码而不是凭印象"。

PR 2 必须覆盖以下所有入口的上下文注入。每处旁边的"覆盖方式"指明如何让 trace 上下文到位。

| 调用点（路径 + 函数） | 业务线 | 覆盖方式 |
|--------|--------|---------|
| `server/services/agent-platform/factory/runtime.ts` agent 主入口 | agent 主入口 | `enqueueRunService` 已包；runtime 顶层补 vertical |
| `server/services/agent-platform/tools/invokeNodeJson.ts` | 节点 JSON | tool 入口包 `{ vertical: 'invoke-node-json' }` |
| `server/services/agent-platform/subAgent/subAgentToolFactory.ts` | 子 agent | tool 入口包 `{ vertical: 'sub-agent' }` |
| `server/services/case/initAnalysis.service.ts` | 案件初始化 | service 顶层包 `{ caseId, vertical: 'init-analysis' }` |
| `server/api/v1/cases/extract.post.ts`（2 处 createChatModel 在同一 handler 内） | 案件提取 | API handler 入口包一次 `{ caseId?, vertical: 'extract' }` 即覆盖两处 |
| `server/agents/case-analysis/runAnalysisSubAgent.ts` | 案件分析子 agent | 入口包 `{ vertical: 'case-analysis' }` |
| `server/agents/contract/uploadClientVersion.service.ts` | 合同上传 | 入口包 `{ reviewId, caseId?, vertical: 'contract' }` |
| `server/services/assistant/assistantSession.service.ts` | 助手会话 | 入口包 `{ sessionId, vertical: 'legal-assistant' }` |
| `server/services/retrieval/intentClassifier.service.ts` | 意图分类 | 入口包 `{ vertical: 'intent-classifier' }` |
| `server/services/material/material.service.ts` | 素材摘要 | 入口包 `{ materialId, caseId?, draftId?, vertical: 'material-summary' }` |
| `server/services/workflow/agents/caseMainAgent.ts` | case-main workflow | 入口包 `{ vertical: 'case-main' }` |
| `server/services/workflow/agents/moduleAgent.ts` | case-module workflow | 入口包 `{ vertical: 'case-module' }` |
| `server/services/workflow/agents/contractReviewMainAgent.ts` | contract workflow | 入口包 `{ reviewId, caseId?, vertical: 'contract' }` |
| `server/services/workflow/agents/documentMainAgent.ts`（2 处） | document workflow | 入口包 `{ draftId, caseId?, vertical: 'document' }` |
| `server/services/workflow/agents/assistantAgent.ts`（2 处） | assistant workflow | 入口包 `{ sessionId, vertical: 'legal-assistant' }` |

---
