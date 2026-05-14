# SubAgent Chain of Thought 可视化设计

- **日期**：2026-04-23
- **范围**：小索（案件助手）场景下，把子 Agent（`ask_*_expert` 类工具）的内部思考过程在主对话列表中可视化展示
- **不涉及**：案件初始化分析（工作流式单 Agent）、通用问答（单 Agent 场景，无子 Agent）、其他上下文治理议题（另行立项）

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
| `app/components/ai/SubAgentChainOfThought.vue` | 单个子 Agent 的可视化卡片（折叠 + 步骤 + 状态）；自动收起逻辑与子 thread 取数均**内联**在组件 `<script setup>` 中，不另抽 composable（后续出现第 3 处使用方再抽） |
| `server/services/sse/agentEventBridge.ts` | 扩展 event payload 字段（向后兼容） |

**说明**：若 `SubAgentChainOfThought.vue` 实际行数超过 **200 行**，把「消息 → Step 映射」的纯函数（`mapMessagesToSteps(messages, isRunning)`）拆成 `app/components/ai/composables/mapMessagesToSteps.ts`（与 `useMessageParser.ts` 同目录，遵循项目现有 `ai/composables/` 惯例）；其它逻辑保持内联。

### 3.2 现有组件改动

| 文件 | 改动内容 | 影响面 |
|---|---|---|
| `app/components/ai/AiToolRenderer.vue` | 增加 `ask_*_expert` 路由分支 | 3-5 行 |
| `app/composables/useStreamChat.ts` | 新增 `subThreadsMap` 状态 + SSE 事件分桶累积逻辑 | ~60 行 |
| `app/components/ai/composables/useMessageParser.ts` | **不改**（过滤规则保持） | 0 行 |
| `server/services/workflow/agents/subAgentToolFactory.ts` | 在 `agent.invoke` 调用上挂 LangChain callbacks 转发 step 事件 | ~50 行，不动 `invoke` 返回值路径 |
| `server/api/v1/case/analysis/chat.post.ts`（或其 loadHistory 服务） | 返回 `subThreads` 字段（`loadSubAgentThreads` 已存在，直接调用） | ~20 行 |

### 3.3 SubAgentChainOfThought 组件结构

**关键约束（来自官方 API 核对）**：
- `ChainOfThoughtHeader` **只有默认 slot**（内部硬编码 `<BrainIcon>` + `<ChevronDownIcon>`），**没有 `#icon` named slot**
- `ChainOfThoughtStep.status` **仅支持** `'complete' | 'active' | 'pending'`，**没有 `'failed'`**
- `ChainOfThoughtStep` **有 `#icon` named slot**（见本地 `ChainOfThoughtStep.vue:38`），可用

据此设计：
- 状态徽章（运行中 / 失败 / 思考耗时）**放在 Header 默认 slot 内**，紧跟标题，与 Header 硬编码的 BrainIcon 共存
- 失败态不传 `status='failed'`，**改用 `ChainOfThoughtStep` 的 `class` prop 叠加 `text-destructive`** + Header 层的红色徽章表达失败信息

```vue
<template>
  <ChainOfThought v-model="isOpen">
    <ChainOfThoughtHeader>
      <!-- Header 默认 slot：标题 + 状态徽章（无 #icon slot 可用） -->
      <span class="font-semibold">{{ agentTitle }}</span>
      <Loader2 v-if="isRunning" class="ml-2 size-3 animate-spin text-muted-foreground" />
      <span v-if="isRunning" class="ml-1 text-xs text-muted-foreground">思考中…</span>
      <span v-else-if="isFailed" class="ml-2 text-xs text-destructive">失败：{{ failureReason }}</span>
      <span v-else-if="durationSec" class="ml-2 text-xs text-muted-foreground">
        思考 {{ durationSec }}s
      </span>
    </ChainOfThoughtHeader>

    <ChainOfThoughtStep
      v-for="step in steps"
      :key="step.key"
      :label="step.label"
      :description="step.isActive ? throttledActiveDescription : step.description"
      :status="step.isFailed ? 'complete' : step.status"
      :class="step.isFailed ? 'text-destructive' : undefined"
    >
      <template #icon>
        <!-- 语义图标：Brain / FileText / Wrench / CheckCircle2，按 step.kind 切换 -->
        <component :is="iconFor(step.kind)" class="size-3.5" />
      </template>

      <ChainOfThoughtContent v-if="step.kind === 'tool_call'">
        <ChainOfThoughtSearchResults v-if="looksLikeSearchResult(step.toolResult)">
          <ChainOfThoughtSearchResult
            v-for="hit in step.toolResult" :key="hit.id ?? hit.title ?? hit.text"
          >{{ hit.title || hit.text }}</ChainOfThoughtSearchResult>
        </ChainOfThoughtSearchResults>
        <AiToolRenderer v-else v-bind="toToolPart(step)" />
      </ChainOfThoughtContent>
      <!-- 仅当全文比折叠态摘要更长（hasMore）时才渲染展开区，避免短内容重复 -->
      <ChainOfThoughtContent
        v-else-if="step.hasMore && (step.kind === 'conclusion' || step.kind === 'thinking' || step.kind === 'analysis')"
      >
        <Response :content="step.fullContent" />
      </ChainOfThoughtContent>
    </ChainOfThoughtStep>
  </ChainOfThought>
</template>
```

**约束**：
- 不修改 `ChainOfThought*` 源文件；失败靠 `class="text-destructive"` + Header 红徽章，不靠 status
- 所有图标来自 `lucide-vue-next`
- `<Response>` 用 ai-elements 的 Markdown 渲染（与主 Agent 回复观感一致）
- `looksLikeSearchResult(r)` = `Array.isArray(r) && r.length > 0 && (r[0]?.title || r[0]?.text)`，**不维护工具名白名单**（新增检索类工具零成本接入）

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
| `ToolMessage` | **不成 Step**，内嵌到对应 tool_call Step 的 `<ChainOfThoughtContent>`（结构识别 `looksLikeSearchResult()` → SearchResults；否则 → AiToolRenderer） | — | 到达即翻上方 tool_call Step 为 complete |
| **最后一条 `AIMessage`** 的 content text（final answer） | 「得出结论」Step：折叠态 80 字摘要；展开用 `<Response>` 渲染完整 Markdown | `CheckCircle2` | 子 Agent 整体结束 → complete；token 流入中 → active（走 30ms throttle） |

**关于失败态**：Step 级失败不用 `status='failed'`（API 不支持），改用 `class="text-destructive"` 叠加视觉 + Header 红色徽章显示失败原因。详见 §3.3 组件结构。

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
- **结构识别 `looksLikeSearchResult(toolResult)`**：`Array.isArray(r) && r.length > 0 && (r[0]?.title || r[0]?.text)` → 用 `<ChainOfThoughtSearchResults>` + `<ChainOfThoughtSearchResult>` 列出每条命中
- 其它形状 → 复用 `<AiToolRenderer>`（同款小卡片），保持与主 Agent 工具风格一致
- **不维护工具名白名单**：新增检索类工具只要 tool_result 结构一致即自动识别

### 4.5 状态流转
- 子 Agent 开始（首条 callback 事件到）→ `subThread.status = 'running'`，卡片 `isOpen = true`
- 每新增一个 tool_call → 新建 `active` step，上一个 `active` step 翻 `complete`
- 子 Agent 结束：**唯一触发**为 callbacks 的 `handleChainEnd` 在 root runId 回调 → `status = 'completed'`。ToolMessage 返回主 thread 只翻主 thread 的 tool_call 显示态，不反向操作子 thread 状态（避免双触发竞态）
- 子 Agent 失败（catch 分支 / SSE 收到 `status_change=failed`）→ `status = 'failed'`，最后 active step 翻 `complete` + 加 `class="text-destructive"`（避免永久转圈），失败信息显示在 Header 红色徽章

## 5. 流式与 throttle 策略

### 5.1 数据层（完整）
- SSE `handleLLMNewToken` 回调每个 token 触发
- 前端 `useStreamChat` 接到事件后，按 `parentToolCallId + messageId` 定位到 `subThreadsMap[toolCallId].messages[idx]`
- **每 token 都累积**到 `content` 字符串里（无丢失），确保刷新恢复内容完整

### 5.2 渲染层（throttle 30ms）
- 仅 `SubAgentChainOfThought` 里的 **active step 的 description** 用 `useThrottleFn(fn, 30, true)` 包装
- **`trailing=true` 必须显式传**：VueUse `useThrottleFn` 的 `trailing` 默认为 `false`，会吞掉最后一个 token；显式设 `true` 保证流结束最后一次刷新
- 实现形式：
  ```ts
  const activeContent = computed(() => steps.value.find(s => s.isActive)?.raw ?? '')
  const throttledActiveDescription = ref('')
  const updateThrottled = useThrottleFn((text: string) => {
    throttledActiveDescription.value = truncate(text, 80)   // 固定 80 字折叠摘要（不走全文），避免 Header 行频繁重排
  }, 30, /* trailing */ true)
  watch(activeContent, updateThrottled)
  ```
- **不 throttle**：历史 step（`complete`）的 description、header 的状态徽章、其它主 Agent 消息
- 离开 active（step 翻 complete）时，把完整 content 一次性写入 step.description，后续不再更新（防止尾字段因 throttle 残缺）

### 5.3 SSE 层（不 throttle）
服务端 callback 每个 token 完整转发，不合并批。原因：
- 保证重连回放粒度
- 保证服务端 checkpoint 节奏不被改造影响
- 网络流量可接受（中文场景 LLM 吐字速率 ~30-80 tok/s，30ms throttle 只是渲染层优化）

## 6. 自动折叠策略

**参考 `Reasoning.vue:73-101` 实现逻辑，直接内联在 `SubAgentChainOfThought.vue` 的 `<script setup>` 中**（不抽 composable，理由：目前只此一处使用方，Reasoning 自己也是内联的；出现第 3 处再抽）：

```ts
// SubAgentChainOfThought.vue <script setup>
const AUTO_CLOSE_DELAY = 1000
const isOpen = ref(false)
const hasAutoClosed = ref(false)
let autoCloseTimer: ReturnType<typeof setTimeout> | null = null

function cancelAutoCloseTimer() {
  if (autoCloseTimer !== null) {
    clearTimeout(autoCloseTimer)
    autoCloseTimer = null
    hasAutoClosed.value = true   // 永久关闸
  }
}

// 边沿触发：isRunning 由 true → false 且未被关闸 → 启动一次性 1s timer
watch(() => props.isRunning, (next, prev) => {
  if (next) { isOpen.value = true; return }
  if (prev === true && !hasAutoClosed.value) {
    autoCloseTimer = setTimeout(() => {
      autoCloseTimer = null
      hasAutoClosed.value = true
      isOpen.value = false
    }, AUTO_CLOSE_DELAY)
  }
}, { immediate: true })

// 用户手动展开/收起 → 取消 timer + 关闸
watch(isOpen, () => cancelAutoCloseTimer())

onBeforeUnmount(() => { if (autoCloseTimer !== null) clearTimeout(autoCloseTimer) })
```

- 参数：用 `props.isRunning` 作为边沿源
- 失败态：`isFailed=true` **不触发**自动收起（让用户看到红徽章），也不强制保持展开（用户可手动收起）
- 并发子 Agent：每个 `<SubAgentChainOfThought>` 实例**各自独立**一份 auto-collapse 状态

## 7. 双份显示

主 Agent 气泡里，`ask_*_expert` 这个工具会产生：
1. **`tool_call` 位置** → `<SubAgentChainOfThought>`（折叠卡片 + step 级简摘）
2. **`ToolMessage` 位置** → 子 Agent 的完整结论（Markdown 全文渲染，**现状保持，不动**）

这样：
- 默认态：卡片折叠，律师只看结论
- 想复盘思考链：点开卡片，每步可见
- 运行中：卡片自动展开实时看进度；结束 1s 后自动收起，结论区已经填好了

## 8. 数据流与事件

### 8.1 事件结构扩展（沿用现有 AgentEvent discriminated union）

**现有类型体系**（`shared/types/agentRun.ts:20-44`，不要破坏）：

```ts
export type AgentEvent = AgentStreamEvent | AgentStatusEvent | AgentCustomEvent
// AgentStreamEvent: { type: 'stream_event', event: 'values'|'messages'|'updates', data }
// AgentStatusEvent: { type: 'status_change', status, error? }
// AgentCustomEvent: { type: 'custom_event', name: string, data }
```

**扩展方式**（只给三种事件类型各加一个可选 `metadata` 字段 + 定义子 Agent 事件命名规范，**不新增 `event` 枚举值**）：

```ts
/** 子 Agent 事件专属元数据；仅子 Agent 相关事件携带，主 Agent 事件全空 */
export interface SubAgentEventMetadata {
  agentName: string          // 如 "risk_assessment_expert"
  threadId: string           // 子 thread id，如 "{sessionId}_sub_risk_assessment_expert"
  parentToolCallId: string   // 主 Agent 那次 tool_call 的 id，**前端分桶 key**
  messageId?: string         // 子 Agent AIMessage 的 id（callback runId），用于 token 合并
  delta?: string             // token 增量（仅 sub_agent_token 事件时携带）
}

// 对三种现有 Event 接口各加一个可选字段（不破坏现有消费方）
export interface AgentStreamEvent  { /* existing */; metadata?: SubAgentEventMetadata }
export interface AgentStatusEvent  { /* existing */; metadata?: SubAgentEventMetadata }
export interface AgentCustomEvent  { /* existing */; metadata?: SubAgentEventMetadata }
```

**子 Agent 事件落哪个 Event 类型**：

| 子 Agent 场景 | 用哪类 Event | `name` / `event` 取值 | 说明 |
|---|---|---|---|
| 每个 token 流入 | `AgentCustomEvent` | `name: 'sub_agent_token'` | `data: undefined`，token 内容在 `metadata.delta` |
| 工具调用开始 | `AgentCustomEvent` | `name: 'sub_agent_tool_start'` | `data: { innerToolCallId, input (string), cbRunId }` |
| 工具调用结束 | `AgentCustomEvent` | `name: 'sub_agent_tool_end'` | `data: { cbRunId, output }` |
| 子 Agent 整体结束 | `AgentStatusEvent` | `status: 'completed'` / `'failed'` | 复用现有状态通道；通过 `metadata.parentToolCallId` 区分子 vs 主 |

**字段选型说明**：
- `parentThreadId` 已砍（冗余，前端已持有 sessionId）
- **必需** 5 个字段：`agentName` / `threadId` / `parentToolCallId` 在所有子 Agent 事件中必须；`messageId` / `delta` 仅 token 事件

**双向兼容**：
- **旧前端 / 新后端**：旧前端不知道 `metadata` 字段，直接忽略；`sub_agent_*` 这类新 name 在旧前端的 `AgentCustomEvent` switch-case 走 default 分支，不报错
- **新前端 / 旧后端**：旧后端不发 `sub_agent_*` 事件、也不带 metadata，新前端在 §8.2 判 `if (!ev.metadata?.parentToolCallId) return fallthroughToMainThread(ev)` 回退主 thread 分支
- 说明：双向兼容非用户显式需求，仅作部署安全基线

### 8.2 前端分桶

`subThreadsMap` 状态和 `mergeEventIntoBucket` 函数都**内联在 `app/composables/useStreamChat.ts`** 里（不单独抽文件；作为 useStreamChat 返回值的一部分暴露）：

```ts
// useStreamChat.ts（伪代码，在现有 transport 构造之后、onCustomEvent/onStreamEvent 回调里）
const subThreadsMap = reactive<Record<string /*parentToolCallId*/, SubThreadState>>({})

function mergeEventIntoBucket(bucket: SubThreadState, ev: AgentEvent) {
  // 三类处理：
  //   AgentCustomEvent name='sub_agent_token'     → 按 messageId 累积 content
  //   AgentCustomEvent name='sub_agent_tool_start' → 建 tool_call step，记 cbRunId→innerToolCallId 映射
  //   AgentCustomEvent name='sub_agent_tool_end'   → 用 cbRunId 回查映射，挂结果到对应 step
  //   AgentStatusEvent status='completed'/'failed' → 翻 bucket.status
}

// 统一入口（来自 FetchStreamTransport / SSE 消费）
function handleAgentEvent(ev: AgentEvent) {
  if (!ev.metadata?.parentToolCallId) return   // 落回主 thread 现有路径
  const md = ev.metadata

  const bucket = subThreadsMap[md.parentToolCallId] ??= {
    agentName: md.agentName, threadId: md.threadId, messages: [], status: 'running',
    runIdToInnerToolCallId: new Map<string, string>(),
  }
  mergeEventIntoBucket(bucket, ev)
}
```

> 实现位置：`useStreamChat.ts` 在当前 143 行基础上增加约 50 行。`SubThreadState` 类型定义放同文件，不单独抽。

### 8.3 恢复路径

页面刷新 / 断线重连时，`server/api/v1/case/analysis/chat.post.ts`（~L113-126 的取历史分支）在现有 `getThreadValuesService(sessionId)` 拿到主 thread 状态之后，**额外调用** `loadSubAgentThreads(sessionId, mainMessages)` → 把 `Record<parentToolCallId, SubThreadState>` 挂在响应体里返回，前端初始化灌入 `subThreadsMap`。

- 主 thread 加载：`threadState.ts:77-88` 的 `getThreadValuesService`（现有）
- 子 thread 加载：`threadState.ts:120-176` 的 `loadSubAgentThreads`（现有，直接调用无需新建）
- 现有响应结构加字段即可：`{ initialValues, subThreads?: Record<string, SubThreadState> }`

## 9. 子 Agent 服务端回调接入

### 9.1 获取 toolCallId
LangChain `tool()` 的函数第二参是 `ToolRunnableConfig`（`@langchain/core/dist/tools/types.d.ts:78-80`），其中 `toolCall?: ToolCall`。**扩展当前 `subAgentToolFactory.ts:141` 的 handler 签名从 `async (input) =>` 到 `async (input, cfg) =>`**（取名 `cfg` 避免与外层 NodeConfig 命名冲突），取 `cfg?.toolCall?.id` 作为 `parentToolCallId`。不在 `SubAgentToolContext` 类型中新增字段（避免双重记账）。

另外：主 Agent 的 `runId`（即 `agentRuns.id`）仍通过 `context.runId` 由 `SubAgentToolContext` 透传进来（供 `publishAgentEvent.runId` 使用），此字段不是 tool_call_id，不冲突。

### 9.2 callbacks 签名（已按 `@langchain/core` 官方文档核对）

```ts
// subAgentToolFactory.ts 伪代码片段
const subAgentTool = tool(
  async (input: { question: string }, cfg): Promise<string> => {
    const parentToolCallId = cfg?.toolCall?.id
    const mainRunId = context.runId    // 主 Agent run id（agentRuns.id），通过 context 透传
    const nodeConfig = config          // 外层闭包：NodeConfig，命名区别于 cfg
    // ... 其它初始化

    const result = await agent.invoke(
      { messages: initialMessages },
      {
        configurable: { thread_id: subThreadId },
        recursionLimit: 1000,
        callbacks: [{
          // 官方签名：(token, idx, runId, parentRunId?, tags?, fields?)
          handleLLMNewToken(token, _idx, cbRunId, _parentRunId) {
            // 注意：外层闭包 `config` 是 NodeConfig（subAgentToolFactory 入参），
            // 与本 handler 上方 async (input, config) 参数里的 RunnableConfig 不同名冲突，
            // 上面已用 `cfg` 命名避免冲突（见下方说明）
            publishAgentEvent({
              type: 'custom_event',
              runId: mainRunId,
              sessionId: context.sessionId,
              name: 'sub_agent_token',
              data: undefined,
              metadata: {
                agentName: nodeConfig.name,
                threadId: subThreadId,
                parentToolCallId: parentToolCallId ?? '',
                messageId: cbRunId,
                delta: token,
              },
            })
          },

          // 官方签名：(tool, input, runId, parentRunId?, tags?, metadata?, runName?, toolCallId?)
          // 第 2 参 input 是 **string**（LangChain 内部已 JSON.stringify 过），前端要 JSON.parse 才能得到 args 对象
          // 第 8 参 toolCallId 是子 Agent 内部 tool_call 的 id，前端用它建立与 tool_end 的关联
          handleToolStart(_tool, input, cbRunId, _parentRunId, _tags, _metadata, _runName, innerToolCallId) {
            publishAgentEvent({
              type: 'custom_event',
              runId: mainRunId,
              sessionId: context.sessionId,
              name: 'sub_agent_tool_start',
              data: { innerToolCallId, input /* string */, cbRunId },
              metadata: { agentName: nodeConfig.name, threadId: subThreadId, parentToolCallId: parentToolCallId ?? '' },
            })
          },

          // 官方签名：(output, runId, parentRunId?, tags?)
          // 拿不到 toolCallId，前端用 cbRunId 回查 sub_agent_tool_start 阶段建立的映射表
          handleToolEnd(output, cbRunId) {
            publishAgentEvent({
              type: 'custom_event',
              runId: mainRunId,
              sessionId: context.sessionId,
              name: 'sub_agent_tool_end',
              data: { cbRunId, output },
              metadata: { agentName: nodeConfig.name, threadId: subThreadId, parentToolCallId: parentToolCallId ?? '' },
            })
          },

          // 官方签名：(outputs, runId, parentRunId?, tags?, kwargs?)
          // root chain end 判定：`cbParentRunId === undefined`。在 `agent.invoke(..., { callbacks: [...] })`
          // 场景下，LangChain 通过 CallbackManager.configure 新建 manager，root chain 的 parentRunId 确为 undefined；
          // langgraph 内部节点/边的 chainEnd 都有 parentRunId 指向 root，因此此判定可靠。
          handleChainEnd(_outputs, _cbRunId, cbParentRunId) {
            if (cbParentRunId !== undefined) return   // 非 root，跳过
            publishAgentEvent({
              type: 'status_change',
              runId: mainRunId,
              sessionId: context.sessionId,
              status: 'completed',
              metadata: { agentName: nodeConfig.name, threadId: subThreadId, parentToolCallId: parentToolCallId ?? '' },
            })
          },
        }],
      },
    )
    // 返回值仍走 result.messages 末尾找最后一条 AI（现有逻辑不动）
  },
  { name: toolName, description, schema: z.object({ question: z.string() }) },
)
```

### 9.3 铁律（编码时核验）
- 仍使用 `invoke` 取返回值，`result.messages` 末尾找最后一条 AI → 作为工具字符串返回值
- callbacks 是副作用通道，不参与返回值（历史教训 `feedback_subagent_stream_pitfall.md`）
- `handleToolEnd` **收不到 toolCallId**，前端 `mergeEventIntoBucket` 需维护 `cbRunId(tool start) → innerToolCallId` 映射，tool_end 时用 runId 回查
- `handleLLMNewToken` 第 2 参是 `NewTokenIndices`（`{ prompt, completion }`），不是 runId；真正的 runId 是第 3 参
- `handleChainEnd` 会在每个 sub-chain 结束都触发，用 `parentRunId === undefined` 识别"agent 本体根链结束"
- `streaming: true` 必须保持（`subAgentToolFactory.ts:150` 现有），否则 callback 不会逐 token 触发

## 10. 主题与深浅模式适配（硬性约束）

**项目支持 7 种主题色（Zinc / Violet / Rose / Blue / Green / Orange / Red / Yellow）× 浅/深模式，所有颜色必须在 14 种组合下均清晰可读、视觉协调。**

### 10.1 色彩职责分层

| 职责 | 使用的色系 | 主题变动响应 |
|---|---|---|
| 背景 / 文字 / 边框 / 分隔线 | shadcn token：`bg-card / bg-muted / text-foreground / text-muted-foreground / border-border / border-input` | ✅ 跟随 7 种主题变化 |
| 失败 / 删除态 | `text-destructive` / `bg-destructive/10` | ✅ 跟随主题（destructive 也是 token） |
| **语义色**（思考 / 分析 / 调用工具 / 结论）| Tailwind 固定色板 + `dark:` 变体 | ❌ **固定**（不跟随 primary 主题，保证语义稳定） |
| 焦点环 | `ring-ring` | ✅ 跟随主题 |

**为什么语义色不用 `primary`**：项目切换到 Violet / Green / Rose 主题时 `--primary` 会变色，会让「思考 Step 是什么颜色」变得不确定。所以把语义色做成"固定色板 + 深浅模式变体"，只有**文字/底色/边框**跟主题走。

### 10.2 语义色系（固定色系 + 必须配 dark 变体）

| 语义 | 固定色系 | 说明 |
|---|---|---|
| 思考（thinking） | **violet** | icon + 底色，含 `dark:` 变体 |
| 分析（content text） | **blue** | 同上 |
| 调用工具（tool_call） | **amber** | 同上 |
| 得出结论（conclusion） | **emerald** | 同上 |
| 失败（failed） | `text-destructive` / `bg-destructive/10` | shadcn token，跟随主题 |
| 进行中（active） | 在上述语义色基础上附加 `animate-pulse` | — |

**实现阶段细化取值**（具体 `-600 / -400 / /10 / /15` 等 Tailwind token 在 writing-plans / 编码时定稿），参考样板：
- `app/components/ai/AiChatQueueChips.vue`（amber 语义 light/dark 双色完整样例）
- `app/components/ai-elements/commit/CommitFileStatus.vue`（多语义色切换样例）

### 10.3 铁律

- **禁止硬编码十六进制颜色**（如 `#2563eb` / `#fafbfc`），一律使用 Tailwind 类
- **每一处 light 模式颜色必须配 `dark:` 变体**（除非 shadcn token 本身已自动适配）
- Chain of Thought 组件本身的 `bg-card / border-border` 使用 shadcn token，在深色模式下自动反色
- Response（Markdown 渲染）、SearchResults、AiToolRenderer 已内建深浅适配，直接复用不额外处理
- 参考样板：`app/components/ai/AiChatQueueChips.vue`（amber 语义）、`app/components/ai-elements/commit/CommitFileStatus.vue`（多语义色）

## 11. 非功能需求

| 维度 | 要求 |
|---|---|
| 性能 | 单个子 Agent 运行时主线程渲染刷新率 ≥ 30fps；多并发子 Agent（≤3 个）不卡顿 |
| 可观测 | `publishAgentEvent` 记录 `agentName + parentToolCallId`，便于从 Redis Stream 回溯 |
| 兼容性 | 旧版本前端打开新版本会话：忽略新字段，看到主 thread 与 `ToolMessage`（与当前行为一致）；新版本前端打开旧版本会话：`subThreadsMap` 空，只渲染主 thread |
| 可访问性 | 折叠卡片键盘可操作（Chain of Thought 原生支持 Reka UI Collapsible） |
| 暗色模式 | 全部组件需支持（Chain of Thought 与 lucide 天然兼容） |

## 12. 风险与回归点

| 风险 | 缓解 |
|---|---|
| 子 Agent 失败或抛异常导致 SSE 流中断，前端卡在 `running` | 子 Agent 工厂 catch 分支显式 publish `AgentStatusEvent{ status:'failed', error, metadata }`；前端收到后翻 `isFailed=true` + 取出 error 显示到 Header 徽章 |
| 并发子 Agent 同时流式时渲染压力 | 已在渲染层做 30ms throttle（含 `trailing=true`）；必要时把非 active 子 Agent 的 content 字符串改为浅层 ref（减少响应式开销） |

> 已下沉到「测试 / 实施阶段」的常规项不再列入风险：虚拟列表高度测量（E2E 回归必查）、`cbRunId → innerToolCallId` 映射竞态（单测覆盖）。

## 13. 测试策略

- **单测**：
  - `mapMessagesToSteps` 纯函数：典型消息数组（纯 thinking / thinking+content / 多 tool_call / ToolMessage 后接 AI / 中途失败）的映射正确性
  - 组件内 auto-collapse 时序：streaming 边沿 true→false 1s 后收起；用户中途点开后 timer 不再收起；失败态不触发 auto-close
  - `subThreadsMap` 分桶 reducer：覆盖单桶累积 + 多桶隔离 + tool_end 通过 cbRunId 正确关联回 tool_call Step

- **E2E（手工，3 条核心路径）**：
  - 路径 A：单子 Agent 流式 + 结束 1s 自动收起 + 点开历史看完整思考链
  - 路径 B：用户中途点开卡片 + 结束后不被 auto-close 收起
  - 路径 C：刷新页面后子 Agent 历史完整回放（验证 loadSubAgentThreads 路径）

<!-- §14 原铁律清单已删除：7 条均为其它章节的复读，冗余。编码时请核验各章节嵌入的「铁律」「约束」小段即可（§2 核心铁律 / §3.3 约束 / §5 / §8.1 双向兼容 / §9.3 / §10.3）。 -->
