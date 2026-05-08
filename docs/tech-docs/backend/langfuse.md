# Langfuse 可观测性集成

LexSeek 通过自托管 Langfuse 收集所有 LLM 调用的 trace（输入/输出/token/延迟/调用链），用于生产排障、token 计费核查、PII 合规审计与模型效果回归。

## 架构概览

```
HTTP 请求
   │
   ▼
01.requestId → 02.auth → 03.permission → 04.langfuseContext (enterWith ALS 根)
                                              │
                                              ▼
                                  业务 service / handler
                                              │
                              ┌───────────────┼────────────────┐
                              │               │                │
                              ▼               ▼                ▼
                  withLangfuseContext   withLangfuseContext   withLangfuseContext
                  ({caseId, vertical}) ({reviewId, vertical}) ({sessionId, ...})
                              │
                              ▼
                       createChatModel (内含 wrapWithLangfuse Proxy)
                              │
                              ▼
                       model.invoke / stream / batch / streamEvents
                              │  ← Proxy 同步读 ALS 注入 RunnableConfig
                              │     (runName / tags / metadata.* )
                              ▼
                  LangChain CallbackHandler + OTel SpanProcessor
                              │
                              ▼
                  LangfuseSpanProcessor (mask PII / shouldExportSpan 豁免)
                              │
                              ▼
                       Langfuse 自托管服务
```

核心机制（5 件套）：

1. **AsyncLocalStorage 上下文**：HTTP middleware 与业务节点把 `requestId / userId / runId / sessionId / caseId / reviewId / draftId / materialId / vertical` 写入 ALS
2. **chatModelFactory ES Proxy**：`createChatModel` 出口包 `wrapWithLangfuse(model)`，拦截 `invoke / stream / batch / streamEvents`，从 ALS 同步读上下文注入 `RunnableConfig`
3. **OTel NodeSDK 全局 tracer provider**：`LangfuseSpanProcessor` 接管 trace 上送，复用 LangChain 内置 OTel 集成
4. **PII 脱敏 mask 钩子**：`mask` 钩子接 stringified JSON 字符串，整段跑 `redactPII` 4 类正则（身份证 / 银行卡 / 手机号 / 邮箱）
5. **`langfuse:nostream` tag 豁免**：`shouldExportSpan` 钩子检测 tag，跳过 `invokeNodeJson` 这类内部 JSON 解析调用的上送

## 源码路径

| 路径 | 职责 |
|------|------|
| `server/lib/langfuse/types.ts` | 类型定义 + `LangfuseVertical` (12 种) + `deriveScope(vertical)` 映射 |
| `server/lib/langfuse/redactPII.ts` | PII 脱敏纯函数（4 类正则）|
| `server/lib/langfuse/context.ts` | ALS store + `withLangfuseContext / enterLangfuseContext / getLangfuseContext` |
| `server/lib/langfuse/client.ts` | `CallbackHandler` 单例 + `NoopCallbackHandler` 兜底 + `getLangfuseRuntimeConfig` 缓存 |
| `server/lib/langfuse/modelProxy.ts` | `wrapWithLangfuse(model)` ES Proxy 拦截器 |
| `server/lib/langfuse/index.ts` | barrel 导出 |
| `server/middleware/04.langfuseContext.ts` | HTTP 入口起 ALS 根上下文 |
| `server/plugins/langfuse-otel.ts` | NodeSDK + LangfuseSpanProcessor + close hook |
| `server/services/node/chatModelFactory.ts` | 出口 `wrapWithLangfuse(model)` |

## 业务侧接入指南（PR 2 模式）

### 模式 A：service / handler 函数顶层

```typescript
import { withLangfuseContext } from '~~/server/lib/langfuse'

export async function someBusinessService(params: { caseId: number; ... }) {
  return withLangfuseContext(
    { caseId: params.caseId, vertical: 'init-analysis' },
    () => someBusinessServiceInner(params),
  )
}

async function someBusinessServiceInner(params: ...): Promise<...> {
  // 原业务逻辑 — 包含 createChatModel + model.invoke
}
```

要点：
- patch 增量合入当前 ALS（外层已设的 `requestId / userId / runId / sessionId` 自动透传，本层只补业务实体 ID + vertical）
- patch 中 `undefined` 字段不擦除已有值（如本层不知 `caseId` 就别写）
- 嵌套调用内层 vertical 覆盖外层（spec 设计：runtime 顶层包 `case-main`，内层 `invokeNodeJson` 覆盖为 `invoke-node-json`）

### 模式 B：HTTP API handler

```typescript
export default defineEventHandler(async (event) => {
  return withLangfuseContext({ vertical: 'extract' }, () => extractHandler(event))
})

async function extractHandler(event: H3Event) {
  // 原 handler body
}
```

### 模式 C：worker / cron 任务（非 HTTP 上下文）

```typescript
private async executeRun(run: agentRuns): Promise<void> {
  return withLangfuseContext(
    {
      runId: run.id,
      sessionId: run.sessionId,
      threadId: run.sessionId,
      userId: run.userId,
      caseId: run.caseId ?? undefined,
    },
    () => this.executeRunInner(run),
  )
}
```

### 模式 D：tool callback（如 subAgent / invokeNodeJson）

```typescript
const subAgentTool = tool(
  async (input, cfg): Promise<string> => {
    return withLangfuseContext({ vertical: 'sub-agent' }, () => runSubAgentInner())

    async function runSubAgentInner(): Promise<string> {
      // 原 callback body
    }
  },
  { name, description, schema },
)
```

## metadata 字段映射

业务字段如何出现在 Langfuse trace：

| ALS 字段 | RunnableConfig 位置 | Langfuse UI 位置 |
|---|---|---|
| `userId` | `metadata.langfuseUserId` (string) | trace 顶层 user_id 过滤器 |
| `sessionId` | `metadata.langfuseSessionId` | trace 顶层 session_id 过滤器 |
| `runId` | `metadata.runId` | metadata 自由字段 |
| `requestId` | `metadata.requestId` | metadata 自由字段 |
| `caseId` | `metadata.caseId` | metadata 自由字段 |
| `reviewId` / `draftId` / `materialId` | `metadata.{字段名}` | metadata 自由字段 |
| `vertical` (内层覆盖) | `runName` 顶层 + `tags` 顶层 | trace 列表名称 + 标签筛选 |
| `vertical` (派生) | `metadata.scope` (CASE/CONTRACT/...) | metadata 自由字段 |
| `gitSha` / `environment` | `metadata.{字段名}` | metadata 自由字段 |

## metadata.runId 反查 SOP

线上某个用户报告"刚才那次案件分析卡住了"，需要从 `agent_runs` 表反查到 Langfuse trace：

1. 在 PostgreSQL 找 run：
   ```sql
   SELECT id, session_id, user_id, case_id, status, created_at
   FROM agent_runs
   WHERE user_id = <userId> AND created_at > NOW() - INTERVAL '1 hour'
   ORDER BY created_at DESC LIMIT 5;
   ```
2. 拿到 `runs.id`（UUID 字符串）
3. 在 Langfuse UI 顶部过滤栏 → metadata 过滤 `runId = <UUID>`
4. 出现的所有 trace 都属于这次 run（一次 run 可能产生多个子 trace：主 agent + 子 agent + invokeNodeJson 等）

反过来：trace 上的 `metadata.runId` 直接对应 `agent_runs.id`，无须再做映射表。

## PII 脱敏说明

`server/lib/langfuse/redactPII.ts` 4 类正则按顺序应用：

1. **身份证（GB 11643 校验码验证）** → `***IDCARD***`
2. **银行卡（16-19 位独立数字串）** → `***BANKCARD***`
3. **手机号（`1[3-9]\d{9}` 独立词）** → `***PHONE***`
4. **邮箱** → `***EMAIL***`

设计权衡：BANKCARD 范围 `\d{16,19}` 与"无效身份证"/"粘连数字串"重叠，采用「宁可错杀」策略（过度脱敏视为可接受）。生产环境 `LANGFUSE_MASK_PII` 默认强制开启（即使 env 写 `false` 也忽略，见 `langfuse-otel.ts`）。

## 配置与环境变量

`.env`：

```
LANGFUSE_PUBLIC_KEY=
LANGFUSE_SECRET_KEY=
LANGFUSE_BASE_URL=https://langfuse.lexseek.cn
LANGFUSE_TRACING_ENABLED=true
LANGFUSE_MASK_PII=true
LANGFUSE_ENVIRONMENT=development
```

`nuxt.config.ts` 注入到 `runtimeConfig.langfuse`，由 `getLangfuseRuntimeConfig()` 缓存读取。

测试环境强制禁用：`tests/_infra/global-setup.ts` 顶部 `process.env.LANGFUSE_TRACING_ENABLED = 'false'`，防止误上送到生产。

### ⚠️ Serverless 部署必须设置（当前自托管 Docker 不需要）

LangChain v0.3+ 把 callbacks 改为后台执行。serverless 平台（AWS Lambda、Cloudflare Workers、Vercel Edge、阿里云函数计算）进程执行完立刻退出，**后台任务来不及把 trace 上报到 Langfuse 就被杀**，会丢数据。

部署到上述平台时 `.env` 必须加：

```
LANGCHAIN_CALLBACKS_BACKGROUND=false
```

效果：把 callbacks 改回前台同步执行，handler 完成上报后再返回响应。代价是单次响应延迟略增（trace flush 时间）。

LexSeek 当前 docker 长进程部署不需要此设置——Nitro `close` hook 在 SIGTERM 时调 `nodeSdk.shutdown()` 自动 flush（见 `server/plugins/langfuse-otel.ts`）。

## 故障排查

### dev 启动看不到 `[langfuse] OTel NodeSDK 已启动`

检查：
- `.env` 是否配齐 `LANGFUSE_PUBLIC_KEY / SECRET_KEY / BASE_URL`（缺一即 skip 不启 SDK，会日志 `配置不完整...跳过 tracing 初始化`）
- `LANGFUSE_TRACING_ENABLED=false` 显式禁用 → 日志 `tracing 已禁用`

### Langfuse UI trace 为空但业务功能正常

可能原因：
- ALS 上下文缺失（`createChatModel` 调用栈外没人写 ALS）→ trace 仍能上送但 `metadata.userId / sessionId / caseId` 全部为空
- 业务节点漏接入 `withLangfuseContext` → 检查 `grep -rn withLangfuseContext server/` 是否覆盖你的入口
- `langfuse:nostream` tag 误用 → `shouldExportSpan` 主动豁免，仅 `invokeNodeJson` 等内部 JSON 调用允许此 tag

### `Error: CallbackHandler 初始化失败`

`getLangfuseHandler` 回退到 `NoopCallbackHandler`（继承 `BaseCallbackHandler` 空类），不抛异常、不阻塞业务。日志包含失败详情用于排查。

### `model.constructor.name` 是 `bound ChatXxx` 而不是 `ChatOpenAI`

历史 bug：`wrapWithLangfuse` 早期版本对 `constructor` 也调了 `.bind()`。已在 commit `31ad499e` 修复，现在 Proxy 显式排除 `constructor` 属性。

## 已知限制

- **`langsmith` 不能 `bun remove`**：`deepagents` 与 `@langchain/core` 内部硬依赖（dist/d.ts 直接 `import "langsmith"`）。即使我们用 OTel 模式 + Langfuse 替换 LangSmith tracing，这个 npm 包必须保留作为类型/运行时依赖
- **生产 SpanProcessor 队列爆容时丢老 span**：OTel 默认行为，对主流程无影响
- **trace_id 反查不便**：业务侧用 `metadata.runId` 双向映射 `agent_runs.id`，无须维护额外索引

## 相关文档

- spec：`docs/superpowers/specs/2026-05-04-langfuse-integration-design.md`
- PR1 plan：`docs/superpowers/plans/2026-05-04-langfuse-integration-pr1-plan.md`
- agent-platform：[`agent-platform.md`](./agent-platform.md)（vertical 注册与中间件栈）
- agent worker：[`agent.md`](./agent.md)（任务调度，PR2-F 接入点）
