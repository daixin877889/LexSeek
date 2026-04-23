# SubAgent Chain of Thought 可视化设计

- **日期**：2026-04-23
- **范围**：小索（案件助手）场景下，把子 Agent（`ask_*_expert` 类工具）的内部思考过程在主对话列表中可视化展示
- **不涉及**：案件初始化分析（工作流式单 Agent）、法律助手（单 Agent 场景，无子 Agent）、其他上下文治理议题（另行立项）

## 1. 背景与目标

### 1.1 现状
- 小索后端已实现「主 Agent + 子 Agent」架构：`server/services/workflow/agents/caseMainAgent.ts` 主 Agent 通过 `subAgentToolFactory.ts` 把每个 NodeConfig 注册为 `ask_{name}_expert` 工具
- 子 Agent 跑在独立子 thread（`{sessionId}_sub_{safeName}`），消息独立落 LangGraph checkpoint
- `server/services/workflow/agents/threadState.ts` 已提供 `loadSubAgentThreads()` 可一次性加载全部子 thread 消息
- **但前端目前只渲染主 thread 消息**：看得到 `ask_*_expert` 的 `tool_call` 入参和 `ToolMessage` 结果，看不到子 Agent 内部的思考、工具调用、检索结果

### 1.2 目标
让律师在主对话列表里：
1. 运行中能实时看到子 Agent 每一步思考与工具调用（token 级流式）
2. 子 Agent 结束 1 秒后自动收起折叠，保留主流程干净
3. 分析结束后点开任意历史回复，完整思考链都能回放
4. 断线重连、页面刷新不丢失任何子 Agent 消息

### 1.3 非目标
- 不改造子 Agent 的工具形态（仍是 `ask_*_expert` 工具，不改成 LangGraph supervisor / subgraph，见方案权衡）
- 不修改前端现有消息过滤逻辑（`useMessageParser` 的 `SubAgentContext` 前缀过滤规则保持）
- 不修改任何 `ai-elements/` 下第三方组件源文件
- 不涉及案件状态 / 上下文治理 / 记忆召回等议题

## 2. 整体架构

```
┌─────────────────────────────────────────────────────────┐
│  主 Agent (caseMainAgent)                               │
│    tool_call: ask_risk_expert(...)                      │
│    ToolMessage: "<子 Agent 返回的完整结论>"              │
└───────────────┬─────────────────────────────────────────┘
                │  触发
                ▼
┌─────────────────────────────────────────────────────────┐
│  subAgentToolFactory (invoke 拿返回值 + callbacks 转发) │
│    ┌──────────────────────────────────────────────┐     │
│    │ 子 Agent (独立 thread)                       │     │
│    │   AIMessage(content="让我先查材料…")        │     │
│    │   AIMessage(tool_calls=[search_case_mat…])  │     │
│    │   ToolMessage(content=[…hits…])              │     │
│    │   AIMessage(content="综合来看，风险等级…")  │     │
│    └──────────────────────────────────────────────┘     │
│         │ LangChain callbacks (旁路)                    │
│         ▼                                               │
│    publishAgentEvent(runId, { agentName, threadId,      │
│      parentToolCallId, messageId, event, delta })       │
└───────────────┬─────────────────────────────────────────┘
                │  SSE (Redis Stream + Pub/Sub)
                ▼
┌─────────────────────────────────────────────────────────┐
│  前端 useStreamChat                                     │
│   - 主 thread messages (现有，不动)                     │
│   - subThreadsMap[toolCallId] = {                       │
│       agentName, threadId, messages, status             │
│     }                                                   │
└───────────────┬─────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────┐
│  AiToolRenderer 路由                                    │
│    toolName.startsWith('ask_') && endsWith('_expert')   │
│      → <SubAgentChainOfThought> 折叠卡片                │
│    其它工具                                             │
│      → 现有 Tool 组件（保持不变）                       │
└─────────────────────────────────────────────────────────┘
```

**核心铁律**：
1. 返回值路径（`invoke` + 从 `result.messages` 末尾找 AI）与消息转发路径（callbacks）**物理分离**，参考 2026-04-07 commit 7a7e53db 教训
2. 子 thread 与主 thread 上下文**完全隔离**，工具注入式子 Agent 的上下文配额由 `subAgentToolFactory.buildBriefContext` 控制，不合流
3. 所有图标使用 `lucide-vue-next`，不使用 emoji

## 3. 组件设计

### 3.1 新增组件清单

| 组件 / 文件 | 职责 |
|---|---|
| `app/components/ai/SubAgentChainOfThought.vue` | 单个子 Agent 的可视化卡片（折叠 + 步骤 + 状态） |
| `app/components/ai/composables/useAutoCollapseOnStreamEnd.ts` | 复用 Reasoning 的"边沿触发 1s 自动收起 + 用户手动闸门"逻辑 |
| `app/components/ai/composables/useSubThreadMessages.ts` | 从 `subThreadsMap` 提取指定 `toolCallId` 的子 Agent 消息流 |
| `server/services/sse/agentEventBridge.ts` | 扩展 event payload 字段（向后兼容） |

### 3.2 现有组件改动

| 文件 | 改动内容 | 影响面 |
|---|---|---|
| `app/components/ai/AiToolRenderer.vue` | 增加 `ask_*_expert` 路由分支 | 3-5 行 |
| `app/composables/useStreamChat.ts` | 新增 `subThreadsMap` 状态 + SSE 事件分桶累积逻辑 | ~60 行 |
| `app/components/ai/composables/useMessageParser.ts` | **不改**（过滤规则保持） | 0 行 |
| `server/services/workflow/agents/subAgentToolFactory.ts` | 在 `agent.invoke` 调用上挂 LangChain callbacks 转发 step 事件 | ~50 行，不动 `invoke` 返回值路径 |
| `server/api/v1/case/analysis/chat.post.ts`（或其 loadHistory 服务） | 返回 `subThreads` 字段（`loadSubAgentThreads` 已存在，直接调用） | ~20 行 |

### 3.3 SubAgentChainOfThought 组件结构

```vue
<template>
  <ChainOfThought v-model="isOpen">
    <ChainOfThoughtHeader>
      <template #icon>
        <Loader2 v-if="isRunning" class="animate-spin size-4" />
        <AlertCircle v-else-if="isFailed" class="size-4 text-destructive" />
        <Brain v-else class="size-4" />
      </template>
      {{ agentTitle }}
      <span v-if="isRunning" class="ml-2 text-xs text-muted-foreground">思考中…</span>
      <span v-else-if="isFailed" class="ml-2 text-xs text-destructive">失败</span>
      <span v-else-if="durationSec" class="ml-2 text-xs text-muted-foreground">
        思考 {{ durationSec }}s
      </span>
    </ChainOfThoughtHeader>

    <ChainOfThoughtStep
      v-for="step in steps"
      :key="step.key"
      :label="step.label"
      :description="step.isActive ? throttledActiveDescription : step.description"
      :status="step.status"
    >
      <template #icon><!-- Brain / Wrench / CheckCircle2 按 step.kind 切换 --></template>
      <ChainOfThoughtContent v-if="step.kind === 'tool_call'">
        <ChainOfThoughtSearchResults v-if="isSearchTool(step.toolName) && step.toolResult">
          <ChainOfThoughtSearchResult
            v-for="hit in step.toolResult" :key="hit.id"
          >{{ hit.title || hit.text }}</ChainOfThoughtSearchResult>
        </ChainOfThoughtSearchResults>
        <AiToolRenderer v-else v-bind="toToolPart(step)" />
      </ChainOfThoughtContent>
      <ChainOfThoughtContent v-else-if="step.kind === 'conclusion'">
        <Response :content="step.description" />
      </ChainOfThoughtContent>
    </ChainOfThoughtStep>
  </ChainOfThought>
</template>
```

**约束**：
- 不修改 `ChainOfThought*` 源文件；失败态靠 Header 的 slot 叠加红色徽章实现
- 所有图标来自 `lucide-vue-next`
- `<Response>` 用 ai-elements 的 Markdown 渲染（与主 Agent 回复观感一致）

## 4. 消息 → Step 映射规则

遍历子 thread 的 messages 数组（已过滤 `injectedBy=SubAgentContext` 注入消息），按以下规则打标：

**重要：一条 AIMessage 可能同时含 thinking / content text / tool_calls，需要拆解为多个 Step。**

「思考过程」在项目里是独立字段而非 `content`，来自 `extractThinking(m)`（`useMessageParser.ts:72`），兼容三种传输格式：
- `contentBlocks[].type === 'reasoning'`（LGP transport 路径）
- `content[].type === 'thinking'`（FetchStreamTransport 路径）
- `additional_kwargs.reasoning_content`（Ollama / DeepSeek）

### 4.0 拆解规则

对每一条 `AIMessage`（非最后一条）：
1. 若 `extractThinking(m)` 非空 → 产出一个「思考」Step
2. 若 `content` 去掉 thinking 块后仍有 text 且非空 → 产出一个「分析」Step（模型在 tool_call 之间说的"过渡/推理说明"）
3. 若 `tool_calls[]` 非空 → 按数组顺序，**每个 tool_call 独立一个「调用 X」Step**

对**最后一条** `AIMessage`（子 Agent 给主 Agent 的最终回复）：
1. 若 `extractThinking(m)` 非空 → 先产出一个「思考」Step（结束后全部 complete）
2. 最终 content text → 产出一个「得出结论」Step（token 流入中时 active，走 throttle）

**ToolMessage 始终不单独成 Step**，按 `tool_call_id` 挂到对应的 tool_call Step 的 `<ChainOfThoughtContent>` 里。

### 4.1 映射对照表

| 子 thread 原始数据 | 映射结果 | 图标（lucide） | status 规则 |
|---|---|---|---|
| `HumanMessage(injectedBy=SubAgentContext)` | **隐藏**（`useMessageParser` 已过滤） | — | — |
| `HumanMessage`（子 Agent 首个问题，来自 `ask_*_expert` 的 question 入参） | **不成 Step**，放在 Header 下方的「问题摘要」条 | — | — |
| `AIMessage.thinking`（通过 extractThinking 提取，可能为纯 reasoning 块） | 「思考」Step：折叠态显示 thinking 前 80 字；展开用 `<Response>` 渲染完整 thinking（等同 Reasoning 组件风格） | `Brain` | 非最后一条 AIMessage → complete；最后一条且子 Agent 还在跑 → active |
| `AIMessage.content` 的 text 部分（剥离 thinking 块后剩余的字符串） | 「分析」Step：折叠态 80 字摘要；展开用 `<Response>` 渲染完整 Markdown | `FileText` | 与上条同 |
| `AIMessage.tool_calls[]`（每个 tool_call） | 「调用 {toolTitle}」Step × N，description = args 一行摘要 | `Wrench` | 出现后 → active；对应 ToolMessage 到达 → complete |
| `ToolMessage` | **不成 Step**，内嵌到对应 tool_call Step 的 `<ChainOfThoughtContent>`（检索类 → SearchResults；其它 → AiToolRenderer） | — | 到达即翻上方 tool_call Step 为 complete |
| **最后一条 `AIMessage`** 的 content text（final answer） | 「得出结论」Step：折叠态 80 字摘要；展开用 `<Response>` 渲染完整 Markdown | `CheckCircle2` | 子 Agent 整体结束 → complete；token 流入中 → active（走 30ms throttle） |

### 4.2 折叠态 vs 展开态的分工

- **ChainOfThoughtStep 的 `description`** = 折叠视图（step 头部一行简摘，供扫视，~80 字）
- **ChainOfThoughtContent** = 展开视图（点开步骤后看完整内容，`<Response>` 渲染 Markdown）
- throttle 30ms 仅作用于 **active step 的 description**（折叠视图），ChainOfThoughtContent 内部的 `<Response>` 组件自带增量渲染，不额外 throttle

### 4.3 纯 thinking 阶段的处理

流式中模型可能先输出 thinking、尚未输出 content 也未产生 tool_call，此时最后一条 AIMessage 只有 thinking。按上面规则：
- 最后一条 AIMessage → 产出「思考」Step（active，thinking token 实时流入，走 30ms throttle）
- 还不存在「得出结论」Step（直到 content 出现或子 Agent 结束）

`useMessageParser:218-219` 已经处理了"纯 thinking 阶段不要过滤掉"的场景，我们遵从现有过滤逻辑。

### 4.4 ToolMessage 展示细节
- `toolName` 属于检索类（`search_case_materials` / `search_law` / `search_case_memory` 等）且 `toolResult` 是数组 → 用 `<ChainOfThoughtSearchResults>` + `<ChainOfThoughtSearchResult>` 列出每条命中
- 其它工具 → 复用 `<AiToolRenderer>`（同款小卡片），保持与主 Agent 工具风格一致
- 检索类白名单在 `isSearchTool()` 里集中维护，初始集合：`['search_case_materials', 'search_law', 'search_case_memory']`，后续增加工具时维护此列表

### 4.5 状态流转
- 子 Agent 开始（首条 callback 事件到）→ `subThread.status = 'running'`，卡片 `isOpen = true`
- 每新增一个 tool_call → 新建 `active` step，上一个 `active` step 翻 `complete`
- 子 Agent 结束：主触发为 callbacks 的 `handleChainEnd` 在 root runId 回调 → `status = 'completed'`；兜底触发为 ToolMessage 返回主 thread
- 子 Agent 失败（catch 分支）→ `status = 'failed'`，最后 active step 翻 complete（避免永久转圈），失败信息显示在 Header 徽章

## 5. 流式与 throttle 策略

### 5.1 数据层（完整）
- SSE `handleLLMNewToken` 回调每个 token 触发
- 前端 `useStreamChat` 接到事件后，按 `parentToolCallId + messageId` 定位到 `subThreadsMap[toolCallId].messages[idx]`
- **每 token 都累积**到 `content` 字符串里（无丢失），确保刷新恢复内容完整

### 5.2 渲染层（throttle 30ms）
- 仅 `SubAgentChainOfThought` 里的 **active step 的 description** 用 `useThrottleFn(fn, 30)` 包装
- 实现形式：
  ```ts
  const activeContent = computed(() => steps.value.find(s => s.isActive)?.raw ?? '')
  const throttledActiveDescription = ref('')
  const updateThrottled = useThrottleFn((text: string) => {
    throttledActiveDescription.value = truncate(text, 80) // 或全文，看 step.kind
  }, 30)
  watch(activeContent, updateThrottled)
  ```
- **不 throttle**：历史 step（`complete` / `failed`）的 description、header 的状态徽章、其它主 Agent 消息
- 离开 active（step 翻 complete）时，把完整 content 一次性写入 step.description，后续不再更新

### 5.3 SSE 层（不 throttle）
服务端 callback 每个 token 完整转发，不合并批。原因：
- 保证重连回放粒度
- 保证服务端 checkpoint 节奏不被改造影响
- 网络流量可接受（中文场景 LLM 吐字速率 ~30-80 tok/s，30ms throttle 只是渲染层优化）

## 6. 自动折叠策略

**复用 `Reasoning.vue:73-101` 成熟实现**（抽成 composable）：

```ts
// useAutoCollapseOnStreamEnd.ts
export function useAutoCollapseOnStreamEnd(isStreaming: Ref<boolean>, opts?: {
  defaultOpen?: boolean
  autoCloseDelay?: number   // 默认 1000ms
}) {
  const isOpen = ref(opts?.defaultOpen ?? false)
  const hasAutoClosed = ref(false)
  let timer: ReturnType<typeof setTimeout> | null = null

  watch(isStreaming, (next, prev) => {
    if (next) { isOpen.value = true; return }
    if (prev === true && !hasAutoClosed.value) {
      timer = setTimeout(() => {
        timer = null
        hasAutoClosed.value = true
        isOpen.value = false
      }, opts?.autoCloseDelay ?? 1000)
    }
  }, { immediate: true })

  // 关键闸门：用户手动切换 → 取消 timer + 永久关闸
  watch(isOpen, () => {
    if (timer !== null) { clearTimeout(timer); timer = null; hasAutoClosed.value = true }
  })

  onBeforeUnmount(() => { if (timer !== null) clearTimeout(timer) })

  return { isOpen }
}
```

- 参数：子 Agent `isRunning` → 包进 `isStreaming`
- 失败态：`isFailed=true` 不触发自动收起（让用户看到红徽章），也不强制保持展开（允许用户手动收起）
- 并发子 Agent：每个 `<SubAgentChainOfThought>` 实例**各自独立**一个 auto-collapse 状态

## 7. 双份显示

主 Agent 气泡里，`ask_*_expert` 这个工具会产生：
1. **`tool_call` 位置** → `<SubAgentChainOfThought>`（折叠卡片 + step 级简摘）
2. **`ToolMessage` 位置** → 子 Agent 的完整结论（Markdown 全文渲染，**现状保持，不动**）

这样：
- 默认态：卡片折叠，律师只看结论
- 想复盘思考链：点开卡片，每步可见
- 运行中：卡片自动展开实时看进度；结束 1s 后自动收起，结论区已经填好了

## 8. 数据流与事件

### 8.1 事件结构扩展（向后兼容）

`publishAgentEvent` 的 payload 在原字段基础上新增：

```ts
interface AgentEventPayload {
  // 现有字段（不动）
  event: 'messages' | 'values' | 'updates' | 'token' | 'analysis_result_saved' | ...
  data: unknown

  // 新增（仅子 Agent 事件携带，主 Agent 事件不带）
  agentName?: string         // 如 "risk_assessment_expert"
  threadId?: string          // 如 "{sessionId}_sub_risk_assessment_expert"
  parentThreadId?: string    // 如 sessionId
  parentToolCallId?: string  // 主 Agent 那次 tool_call 的 id，用于前端分桶
  messageId?: string         // 子 Agent AIMessage 的 id，用于 token 合并
  delta?: string             // token 增量（仅 token 事件）
}
```

旧前端忽略这些新字段仍正常工作；旧事件不带这些字段，新前端回退到现有行为。

### 8.2 前端分桶

```ts
// useStreamChat.ts（伪代码）
const subThreadsMap = reactive<Record<string /*parentToolCallId*/, SubThreadState>>({})

onSseEvent(ev => {
  if (!ev.parentToolCallId) return fallthroughToMainThread(ev)

  const bucket = subThreadsMap[ev.parentToolCallId] ??= {
    agentName: ev.agentName!, threadId: ev.threadId!, messages: [], status: 'running',
  }
  mergeEventIntoBucket(bucket, ev) // 按 messageId / tool_call_id 合并
})
```

### 8.3 恢复路径

页面刷新 / 断线重连时，`chat.post.ts` 的 `loadHistory` 分支在返回主 thread 的 `initialValues` 同时，增加调用 `loadSubAgentThreads(sessionId, mainMessages)` → 把 `Record<parentToolCallId, SubThreadState>` 一并返回，前端初始化灌入 `subThreadsMap`。

`loadSubAgentThreads` 现有函数位置：`server/services/workflow/agents/threadState.ts:120-176`。

## 9. 子 Agent 服务端回调接入

```ts
// subAgentToolFactory.ts（伪代码片段，仅示意）
const result = await agent.invoke(
  { messages: initialMessages },
  {
    configurable: { thread_id: subThreadId },
    recursionLimit: 1000,
    callbacks: [{
      handleLLMNewToken(token, { runId: cbRunId, parentRunId }, runId) {
        publishAgentEvent(context.runId, {
          event: 'token',
          agentName: config.name, threadId: subThreadId,
          parentThreadId: context.sessionId, parentToolCallId: context.toolCallId,
          messageId: cbRunId, delta: token,
        })
      },
      handleToolStart(...) { /* 转发 tool_call step 开始 */ },
      handleToolEnd(...)   { /* 转发 ToolMessage */ },
      handleChainEnd(output, ...) { /* 转发 on_chain_end，用来翻 completed */ },
    }],
  },
)
```

**铁律**：
- 仍使用 `invoke` 取返回值，`result.messages` 末尾找最后一条 AI → 作为工具字符串返回值
- callbacks 是副作用通道，不参与返回值
- `context` 需把 `runId` 和当前 `toolCallId` 透传进工具（当前签名里没有，需要通过 LangChain tool 的 `config.toolCall.id` 或 RunnableConfig 拿）

## 9.5 主题与深浅模式适配（硬性约束）

**项目支持 7 种主题色（Zinc / Violet / Rose / Blue / Green / Orange / Red / Yellow）× 浅/深模式，所有颜色必须在 14 种组合下均清晰可读、视觉协调。**

### 9.5.1 色彩职责分层

| 职责 | 使用的色系 | 主题变动响应 |
|---|---|---|
| 背景 / 文字 / 边框 / 分隔线 | shadcn token：`bg-card / bg-muted / text-foreground / text-muted-foreground / border-border / border-input` | ✅ 跟随 7 种主题变化 |
| 失败 / 删除态 | `text-destructive` / `bg-destructive/10` | ✅ 跟随主题（destructive 也是 token） |
| **语义色**（思考 / 分析 / 调用工具 / 结论）| Tailwind 固定色板 + `dark:` 变体 | ❌ **固定**（不跟随 primary 主题，保证语义稳定） |
| 焦点环 | `ring-ring` | ✅ 跟随主题 |

**为什么语义色不用 `primary`**：项目切换到 Violet / Green / Rose 主题时 `--primary` 会变色，会让「思考 Step 是什么颜色」变得不确定。所以把语义色做成"固定色板 + 深浅模式变体"，只有**文字/底色/边框**跟主题走。

### 9.5.2 语义色映射（固定）

| 语义 | icon 色 | 徽章底色 | 深色模式 icon | 深色徽章底 |
|---|---|---|---|---|
| 思考（thinking） | `text-violet-600` | `bg-violet-500/10` | `dark:text-violet-400` | `dark:bg-violet-500/15` |
| 分析（content text） | `text-blue-600` | `bg-blue-500/10` | `dark:text-blue-400` | `dark:bg-blue-500/15` |
| 调用工具（tool_call） | `text-amber-600` | `bg-amber-500/10` | `dark:text-amber-400` | `dark:bg-amber-500/15` |
| 得出结论（conclusion） | `text-emerald-600` | `bg-emerald-500/10` | `dark:text-emerald-400` | `dark:bg-emerald-500/15` |
| 失败（failed） | `text-destructive` | `bg-destructive/10` | — | — |
| 进行中（active） | 在上述语义色基础上附加 `animate-pulse` | — | — | — |

### 9.5.3 铁律

- **禁止硬编码十六进制颜色**（如 `#2563eb` / `#fafbfc`），一律使用 Tailwind 类
- **每一处 light 模式颜色必须配 `dark:` 变体**（除非 shadcn token 本身已自动适配）
- Chain of Thought 组件本身的 `bg-card / border-border` 使用 shadcn token，在深色模式下自动反色
- Response（Markdown 渲染）、SearchResults、AiToolRenderer 已内建深浅适配，直接复用不额外处理
- 参考样板：`app/components/ai/AiChatQueueChips.vue`（amber 语义）、`app/components/ai-elements/commit/CommitFileStatus.vue`（多语义色）

## 10. 非功能需求

| 维度 | 要求 |
|---|---|
| 性能 | 单个子 Agent 运行时主线程渲染刷新率 ≥ 30fps；多并发子 Agent（≤3 个）不卡顿 |
| 可观测 | `publishAgentEvent` 记录 `agentName + parentToolCallId`，便于从 Redis Stream 回溯 |
| 兼容性 | 旧版本前端打开新版本会话：忽略新字段，看到主 thread 与 `ToolMessage`（与当前行为一致）；新版本前端打开旧版本会话：`subThreadsMap` 空，只渲染主 thread |
| 可访问性 | 折叠卡片键盘可操作（Chain of Thought 原生支持 Reka UI Collapsible） |
| 暗色模式 | 全部组件需支持（Chain of Thought 与 lucide 天然兼容） |

## 11. 风险与回归点

| 风险 | 缓解 |
|---|---|
| 虚拟列表（`AiMessageListVirtual.vue`）对动态高度卡片测量不准 | 在 SubAgentChainOfThought 外层包 `<AiElementsMessage>` / 现有消息容器，使用现有 item 高度感知方式；落地时重点回归"卡片展开/收起时虚拟列表抖动"场景 |
| 子 Agent 失败或抛异常导致 SSE 流中断，前端卡在 `running` | 子 Agent 工厂 catch 分支显式 `publishAgentEvent({ event: 'status_change', status: 'failed' })`，前端收到后翻 `isFailed=true` |
| 并发子 Agent 同时流式时渲染压力 | 已在渲染层做 30ms throttle；必要时把非 active 子 Agent 的 content 字符串改为浅层 ref（减少响应式开销） |
| 前端过滤规则（`SubAgentContext`）意外屏蔽了子 Agent 的主消息 | 子 thread 消息在服务端已经过 `stripSystemMessages` 过滤注入消息，剩下的业务消息不带 `injectedBy`，前端过滤规则不会误伤；编码时加单测锁定映射规则 |
| `tool_call_id` 在主 Agent 回调和子 Agent 侧对齐问题 | 透传 `toolCallId` 进 `SubAgentToolContext`，作为分桶 key；单测覆盖"同一 session 连续调同一专家两次"场景 |
| 旧历史会话没有子 thread（如 4/7 之前的案件）打开时 | `subThreadsMap` 空 → 卡片降级为只显示 Header + "无详细思考记录可展示"占位；不报错 |
| auto-close 误杀用户手动展开 | 严格遵循 `Reasoning.vue` 现版实现的闸门逻辑（`hasAutoClosed` 标志 + `clearTimeout`），单测覆盖"用户 500ms 时点开 → 不应被收起" |

## 12. 测试策略

- **单测**：
  - `useAutoCollapseOnStreamEnd` 四种时序（streaming 边沿、用户手动、失败、并发）
  - `mapMessagesToSteps` 对若干典型消息数组（纯 AI / 多 tool_call / ToolMessage 后接 AI / 中途失败）的映射正确性
  - `subThreadsMap` 分桶逻辑（同 toolCallId 多事件合并、不同 toolCallId 隔离）
- **集成测**：
  - 服务端 subAgentToolFactory 的 callbacks 真的在 invoke 期间被调用（不依赖 stream）
  - loadSubAgentThreads 返回结构与前端灌入路径对齐
- **E2E（手工）**：
  - 单子 Agent 流式 + 结束 1s 自动收起
  - 用户中途点开卡片 + 不被 auto-close
  - 并发三个子 Agent
  - 断线重连回放
  - 刷新页面后历史回放
  - 子 Agent 失败 → 红色徽章 + 卡片保持状态

## 13. 实施阶段（仅概述，详见 writing-plans 产物）

1. composable `useAutoCollapseOnStreamEnd`
2. 组件 `SubAgentChainOfThought.vue`（mock 数据先行，单独可视化验收）
3. 后端事件扩展（`publishAgentEvent` 字段 + `subAgentToolFactory` callbacks）
4. 前端 `useStreamChat` 分桶 + 灌入
5. `AiToolRenderer` 路由分支
6. 恢复接口增加 `subThreads` 返回
7. 虚拟列表高度回归 + 单测 + E2E

## 14. 铁律清单（编码时逐条核验）

- [ ] 子 Agent 返回值继续用 `invoke` + `result.messages` 末尾取 AI，禁止让 stream 兼任返回值来源（教训记忆：`feedback_subagent_stream_pitfall.md`）
- [ ] `useMessageParser` 过滤规则不改
- [ ] 不修改 `app/components/ai-elements/**` 源文件，通过 slot + 外层状态实现差异化
- [ ] 图标全部 `lucide-vue-next`，禁用 emoji
- [ ] throttle 仅作用于 UI 渲染层（active step description），数据层每 token 累积
- [ ] SSE 事件新增字段**只增不改**，保持向后兼容
- [ ] 虚拟列表高度测量在卡片展开/收起时的回归测试必过
