# 工具卡 interrupt 内联化设计

**日期：** 2026-04-29
**作者：** AI 协作 + 戴鑫
**状态：** Approved

## 背景与问题

LexSeek 在小索 / 法律助手 / 合同审查面板里调用 LangGraph Agent，agent 在工具内 `interrupt()` 暂停时，前端把 `__interrupt__` payload 通过 `globalInterruptRegistry` 派发到对应 Vue 组件。当前所有 interrupt 都被 `<Dialog>` 包成模态弹窗（含 backdrop、阻止 outside-click），覆盖在对话面板之上。

注册表已经按 `isToolCard` 区分两类 interrupt：

- **工具卡（`isToolCard=true`）**：用户在几个候选项里做选择（如选模板、选审查立场）
- **中断卡（`isToolCard=false`）**：复杂问答（如 `case_info_check` 表单）

但当前 UI 层把两类都包进 Dialog，`isToolCard` 字段仅在事件分发协议（`onResolve` callback vs `submit/cancel` emit）上起作用，未在视觉层生效。

业界主流 AI chat 产品（Vercel AI SDK Chatbot、Claude Code、GitHub Copilot Chat、LangGraph Studio、Cursor / Windsurf 等）对"工具调用等待用户响应"几乎全部采用消息流内联，模态仅用于危险操作或全屏专注表单。当前模态实现违反业界惯例：

- 截断对话上下文（用户看不到 AI 的解释 / 自己刚才说的话）
- intent 文字过长占模态视觉（截图证据：长达 2 行的"根据「...」为您推荐"陈述句重复了用户输入）
- 与已有 `DraftDocumentCard` / `ReviewContractCard` 等"工具结果卡内联消息流"的范式不一致

## 目标

把所有 `isToolCard=true` 类型的 interrupt 卡片改为消息流内联渲染，与已有工具结果卡片体系融合：

1. interrupt 等待期：在触发它的 `tool_call` 那条 AIMessage 位置，渲染对应卡片活跃态
2. resolve 后：卡片冻结成 snapshot 常驻当前 session 消息流，下方追加工具结果卡片
3. 输入框仍 disable（保留 LangGraph 的 interrupt 等待语义，不改交互协议）
4. `isToolCard=false` 的中断卡完全保持现状（仍走 `<Dialog>`）

## 非目标

- 不改 LangGraph interrupt() / resume() 协议
- 不修改 `globalInterruptRegistry` / `InterruptDispatcher` 的事件分发逻辑（onResolve callback 不变）
- 不持久化 `resolvedInterrupts`（刷新页面后实时快照丢失，但 DraftDocumentCard 仍能展示完整结果，信息无损）
- 不为新 interrupt 类型自动启用内联（必须显式注册时声明 `isToolCard: true`）

## 数据模型与生命周期

`isToolCard=true` 卡片在消息流里有两个生命阶段，对应同一个 `tool_call_id`：

| 阶段 | 触发条件 | 数据源 | 视觉 |
|------|---------|--------|------|
| **A. active 等待中** | `interruptData.toolCallId === toolCall.id` | `useStreamChat.interruptData`（实时） | 活跃卡片：可点选、可取消、按钮可用、amber 边框 |
| **B. resolved 已选** | `interruptData` 已清空且当前 session 中已 resolve 过此 toolCallId | `useStreamChat.resolvedInterrupts.get(toolCallId)` | 冻结快照：所有按钮 disabled、整体 `opacity-70`、边框降饱和、显示"已选 X" 或 "已取消"，复用现有 `confirmed` 视觉 |
| **C. 工具完成态** | `toolCall.state === 'output-available'`（messages 含对应 ToolMessage） | `toolCall.result` | 紧贴在 B 卡片下方，渲染 `toolMap[name]`（如 DraftDocumentCard "已完成起草《...》"） |

**A → B → C 时序**：用户点"使用此模板"→ `onResolve(value)` → useStreamChat 把 `interruptData` 与 `value` 写入 `resolvedInterrupts`，然后清空 `interruptData` → AiToolRenderer 切到 B 渲染 → LangGraph 子流跑出 ToolMessage → toolCall.state 变为 'output-available' → C 卡片在 B 下方 mount。

**取消行为**：用户点"取消"→ `onResolve(null)` → 同样写入 `resolvedInterrupts`（resumeValue=null）→ 切到 B 渲染显示"已取消" → 后续 toolCall **不会**有 result（agent 收到 cancelled=true）→ 仅 B snapshot 留在消息流，无 C。

## 组件结构

### 模块 1：数据层 helper composable

**纠正**：`useStreamChat` 本身不负责 `resolveInterrupt` 包装也不管 session 切换——这些在 3 个 Panel 的 setup 里（`AssistantChatPanel.vue:159`、`CaseDetailXiaosuo.vue:97`、`ContractReviewPanel.vue:539`）。所以新数据结构不放在 useStreamChat。

新建 `app/composables/agent-platform/useInterruptSnapshot.ts`，提供 reactive Record + 写入/清空 helper：

```ts
import { reactive } from 'vue'

export interface ResolvedInterruptEntry {
  interrupt: { type: string; toolCallId: string; [key: string]: unknown }
  resumeValue: unknown // null 表示取消
  resolvedAt: Date
}

export function useInterruptSnapshot() {
  const resolvedInterrupts = reactive<Record<string, ResolvedInterruptEntry>>({})

  /** 在 panel 的 resolveInterrupt 内调用，记录刚 resolve 的 interrupt */
  function record(
    interruptData: { type?: string; toolCallId?: string; [key: string]: unknown } | null,
    resumeValue: unknown,
  ): void {
    if (!interruptData?.toolCallId || !interruptData.type) return
    resolvedInterrupts[interruptData.toolCallId] = {
      interrupt: interruptData as ResolvedInterruptEntry['interrupt'],
      resumeValue,
      resolvedAt: new Date(),
    }
  }

  /** 切换 session 时调用，清空所有快照 */
  function clear(): void {
    for (const k in resolvedInterrupts) {
      delete resolvedInterrupts[k]
    }
  }

  return { resolvedInterrupts, record, clear }
}
```

3 个 Panel 各自在 setup 调 `useInterruptSnapshot()`，分别在自己的 `resolveInterrupt` 内调 `record(interruptData.value, value)`，在 session 切换钩子（`watch` / 切换函数）调 `clear()`。

`reactive<Record>` 风格与 `useStreamChat` 同文件 `subThreadsMap` / `syntheticToolCalls` 一致，无新模式。

### 模块 2：渲染层 (`app/components/ai/AiToolRenderer.vue`)

通过 `inject` 拿上下文（不走 props 透传链——见模块 3）：

```ts
const messageStreamContext = inject<{
  interruptData: Ref<{ type?: string; toolCallId?: string; [key: string]: unknown } | null>
  resolvedInterrupts: Record<string, ResolvedInterruptEntry>
  resolveInterrupt: (value: unknown) => void
} | null>('messageStreamContext', null)
```

渲染优先级（v-if 链，自上而下）：

```vue
<!-- 1. interrupt 关联（active 或 resolved）：合并为一条分支，靠 resumeValue 是否存在判定模式 -->
<template v-if="isInterruptToolCardCall">
  <InterruptDispatcher
    :interrupt="resolvedEntry?.interrupt ?? messageStreamContext?.interruptData.value"
    :resume-value="resolvedEntry?.resumeValue"
    @submit="(v) => messageStreamContext?.resolveInterrupt(v)"
    @cancel="() => messageStreamContext?.resolveInterrupt(null)"
  />
  <!-- resolved 且工具完成时，紧贴下方追加 toolMap 完成态 -->
  <component
    v-if="resolvedEntry && toolCall.state === 'output-available' && toolMap?.[toolCall.name]"
    :is="toolMap[toolCall.name]"
    :tool-name="toolCall.name"
    :input="toolCall.args"
    :output="toolCall.result"
    :state="toolCall.state"
  />
</template>

<!-- 2. 普通工具（非 isToolCard）：现状不变 -->
<component v-else-if="toolMap?.[toolCall.name]" .../>
<SubAgentChainOfThought v-else-if="isSubAgentTool(...)" .../>
<!-- ...原有内置卡片分支 -->
```

判断辅助：

```ts
const resolvedEntry = computed(() => {
  return messageStreamContext?.resolvedInterrupts[props.toolCall.id] ?? null
})
const isInterruptToolCardCall = computed(() => {
  // active：当前 interruptData 命中本 toolCall + 类型是工具卡
  const active = messageStreamContext?.interruptData.value
  if (active?.toolCallId === props.toolCall.id
      && globalInterruptRegistry.isToolCard(active.type ?? '')) {
    return true
  }
  // resolved：本 toolCall 在历史 Map 里
  return !!resolvedEntry.value
})
```

### 模块 3：消息流上下文（provide / inject）

不走 4 层 props 透传——沿用 `CaseDetailXiaosuo.vue:50` 已有的 `provide('subAgentAccess', ...)` 范式：

调用方（`CaseDetailXiaosuo` / `AssistantChatPanel` / `ContractReviewPanel`）从 `useStreamChat` + 自身 setup 解构后 provide：

```ts
provide('messageStreamContext', {
  interruptData,         // ComputedRef<InterruptPayload | null>
  resolvedInterrupts,    // reactive<Record<string, ResolvedInterruptEntry>>
  resolveInterrupt,      // (value: unknown) => void ← active 卡片提交回调
})
```

`resolveInterrupt` 函数体复用各 panel 已有的 toolCallId 包装逻辑（`AssistantChatPanel.vue:159` / `CaseDetailXiaosuo.vue:97` / `ContractReviewPanel.vue:539`）。AiToolRenderer 触发 active 卡片提交时直接调它，不走事件冒泡。

`AiToolRenderer` 直接 inject 使用。`AiChat` / `AiMessageList` / `AiMessageListVirtualItem` 三层中间组件**完全不用改**，零透传。

### 模块 4：InterruptDispatcher (`app/components/InterruptDispatcher.vue`)

新增 prop：

```ts
interface Props {
  interrupt: { type?: string;[key: string]: unknown } | null
  isSubmitting?: boolean
  // 新增：snapshot 模式时由 AiToolRenderer 传入；active 模式下为 undefined
  resumeValue?: unknown
}
```

不引入显式 `mode` 概念——`resumeValue` 是否为 `undefined` 即区分 active vs snapshot。中断卡（`isToolCard=false`）会忽略此 prop（永远是 active）。

### 模块 5：卡片组件 (`TemplateSelectCard.vue` / `StanceSelectCard.vue`)

#### TemplateSelectCard

新增 prop：

```ts
interface Props {
  interrupt: TemplateInterrupt
  onResolve?: (value: ResolveValue | null) => Promise<void> | void
  // 新增：snapshot 模式专用
  resumeValue?: { templateId?: number; sourceText?: string } | null
}
```

是否进入 snapshot 模式由 `props.resumeValue !== undefined` 推导（一个 computed `isSnapshot`）。

snapshot 模式（`isSnapshot === true`）在**现有 `confirmed` 视觉之上**进一步处理：
- `selectedId` 初始化为 `resumeValue?.templateId`；`confirmed` 状态自动为 true（复用 line 459-465 现有"已选模板：xxx"视觉）
- `resumeValue === null` 时显示"已取消"（沿用 confirmed 分支文本，覆写"已选"前缀）
- 整个根 div 额外加 `opacity-70`、边框改 `border-muted`（**confirmed 视觉本身没这两个**，是 snapshot 模式额外增加）
- 隐藏 active 才有的元素：搜索框、分类 dropdown、"浏览全部" 按钮、推荐区折叠按钮（`isSnapshot` 为 true 时不渲染）
- 列表项 `disabled`，无 hover

active 模式（默认）下行为不变，但**移除 intent 引导文字**（line 252-254 的 `<p v-if="intentText">`）—— 内联后用户原始陈述已在消息流上方可见，不重复。

#### StanceSelectCard

注意 StanceSelectCard 现有 `confirmed` 仅做了"提交按钮 disable + 显示已选立场"，**没有降饱和 / 隐藏 intent 段**。snapshot 模式需要在现有 `confirmed` 之上额外加：
- `opacity-70` + `border-muted`
- 隐藏"案件背景陈述" intent 段（如果有）

具体改动看实施时具体代码状态。

`isSnapshot` 同样由 `props.resumeValue !== undefined` 推导。

### 模块 6：Panel 入口（3 个）

`CaseDetailXiaosuo.vue` / `AssistantChatPanel.vue` / `ContractReviewPanel.vue` 三处改造，每处均：

1. 调 helper 拿 reactive 状态：

```ts
import { useInterruptSnapshot } from '~/composables/agent-platform/useInterruptSnapshot'
const { resolvedInterrupts, record: recordResolved, clear: clearResolved } = useInterruptSnapshot()
```

2. 在现有 `resolveInterrupt` 内（line 159 / 97 / 539 处）调 `recordResolved(interruptData.value, value)` 写入快照（在调 `resumeInterrupt(...)` 之前调）。

3. session 切换处调 `clearResolved()`：
   - `AssistantChatPanel` / `CaseDetailXiaosuo`：调 `xxxChat.switchSession(...)` 或 `init()` 时
   - `ContractReviewPanel`：reviewId / sessionId 变化时（`watch(() => props.reviewId, () => clearResolved())`）

4. 加 provide 上下文：

```ts
provide('messageStreamContext', { interruptData, resolvedInterrupts })
```

2. Dialog 加 isToolCard 条件（用 `:open` 单一控制，去掉 v-if + :open 双重控制冗余）：

```vue
<Dialog
  :open="!!interruptData && !isCurrentInterruptToolCard"
  @update:open="() => {}"
>
  <DialogContent ...>
    <DialogHeader class="sr-only">
      <DialogTitle>需要您的确认</DialogTitle>
      <DialogDescription>请查看并回应以下请求</DialogDescription>
    </DialogHeader>
    <InterruptDispatcher
      :interrupt="interruptData"
      @submit="resolveInterrupt"
      @cancel="..."
    />
  </DialogContent>
</Dialog>
```

`DialogHeader` + `DialogDescription` 沿用现有 `sr-only` 兜底（`ui.md` a11y 铁律），无需新加。

判断辅助（3 处直接复制单行 computed，按 YAGNI 不抽 composable）：

```ts
import { globalInterruptRegistry } from '~/composables/agent-platform/interruptRegistry'

const isCurrentInterruptToolCard = computed(() => {
  const t = interruptData.value?.type
  return typeof t === 'string' && globalInterruptRegistry.isToolCard(t)
})
```

`isToolCard=true` 时 Dialog 不打开，由 AiToolRenderer 在消息流内联消化。

**范围说明**：本次改造仅涉及 InterruptDispatcher 体系的 Dialog（line 269 / 196 / 523 这三处）。`ContractReviewPanel.vue:511-520` 内另有一个独立的 `StanceSelectionDialog` 组件（不走 InterruptDispatcher 体系），**不在**本次改造范围。

## 视觉与交互细节

### Active 卡片

- 沿用现有 amber 边框（`border-amber-300/60 bg-amber-50/60`）
- 卡片首次 mount 时 `nextTick` 内 `templateRef.value?.scrollIntoView({ behavior: 'smooth', block: 'center' })`，**先做空值判断**（虚拟列表 unmount 风险）；如果所在虚拟项尚未进入 viewport，依靠现有消息流"滚到底"机制兜底（不重复实现）
- 移除"根据「...」为您推荐"长 intent 文字
- 不加 pulse / glow 动画
- 输入框继续 disable（沿用现有 `is-interrupted` prop），无需新增提示文字

### Resolved 快照

- 整体 `opacity-70`，边框改 `border-muted`
- 选中项前换为 lucide `<CheckCircle2 />`（实心绿）
- 完整文字描述："已选模板：民事起诉状（公民提起民事诉讼用）"或"已取消"
- 所有按钮 / 列表项 disabled，无 hover 反馈
- snapshot 转换不滚动

### 取消行为

- 用户点"取消"→ `onResolve(null)`
- `resolvedInterrupts.set(toolCallId, { resumeValue: null, ... })`
- 卡片立刻切到 snapshot 显示"已取消"
- 不会有 C 阶段卡片

## 边界场景

| 场景 | 行为 |
|------|------|
| **Active 期 agent 报错** | 沿用现状（interruptData 仍存活，用户可手动取消） |
| **Active 期 SSE 断流** | 沿用现状重试机制 |
| **刷新页面后旧 session** | `resolvedInterrupts` 为空 Map；如果 toolCall 已完成（messages 含 ToolMessage），仅显示 `toolMap[name]` 完成态卡片，DraftDocumentCard 内含模板名 / draftId / 字段统计，信息无损；如果 toolCall 当时被取消未完成，仅显示一个轻量"[模板选择已取消]"占位文本（来自 toolCall.args 推断 + 检测无 ToolMessage） |
| **Session 切换** | `resolvedInterrupts.clear()` |
| **同 session 多次 interrupt** | 每个 interrupt 按 `toolCallId` 独立索引 |
| **isToolCard=false（如 case_info_check）** | 完全不变，仍走 Dialog |

## 测试覆盖

| 测试文件 | 现状 | 改动 | 用例 |
|---------|------|------|------|
| `tests/app/composables/agent-platform/useInterruptSnapshot.test.ts` | 不存在 | 新建 | `record()` 后 `resolvedInterrupts[toolCallId]` 正确填充；`record(null, ...)` / `record(interrupt 无 toolCallId, ...)` 跳过；`clear()` 清空全部字段；reactive 触发 Vue 更新 |
| `tests/app/components/ai/AiToolRenderer.test.ts` | 不存在 | 新建 | 合并后的 v-if 分支按预期分发：active interrupt / resolved snapshot（含 toolMap 完成态接续） / 普通工具 |
| `tests/app/components/agents/document/interrupts/TemplateSelectCard.test.ts` | 已存在 | 扩展 | `resumeValue` 非 undefined 时（snapshot 模式）：按钮 disabled、显示"已选 xxx"或"已取消"；不论 active/snapshot 都不再渲染 intent 引导文字 |
| `tests/app/components/agents/contract/interrupts/StanceSelectCard.test.ts` | 已存在 | 扩展 | snapshot 模式按钮 disabled、显示已选立场 |

Panel 入口 Dialog 条件化（`isToolCard=true` 时不打开）由现有 `globalInterruptRegistry.isToolCard()` 单元测试已覆盖类型分支判定，无需为每个 Panel 单独建测试文件 —— **改为 dev 端到端手动验证**（实施 Task 3 集成验证步骤已包含此环节）。

## 文件改动清单

| 文件 | 改动类型 |
|------|---------|
| `app/composables/agent-platform/useInterruptSnapshot.ts` | 新建：reactive Record + record/clear helper |
| `app/components/ai/AiToolRenderer.vue` | 修改：inject 上下文 + 加合并后的 interrupt 分支 |
| `app/components/InterruptDispatcher.vue` | 修改：加 `resumeValue` prop 透传到子组件 |
| `app/components/agents/document/interrupts/TemplateSelectCard.vue` | 修改：加 `resumeValue` 支持 snapshot 视觉（在现有 confirmed 之上加 opacity-70 + border-muted + 隐藏 active-only 元素）；移除 intent 引导文字 |
| `app/components/agents/contract/interrupts/StanceSelectCard.vue` | 修改：加 `resumeValue` 支持 snapshot 视觉（同上） |
| `app/components/caseDetail/CaseDetailXiaosuo.vue` | 修改：provide messageStreamContext + Dialog 加 isToolCard 条件 |
| `app/components/assistant/AssistantChatPanel.vue` | 修改：同上 |
| `app/components/assistant/contract/ContractReviewPanel.vue` | 修改：同上 |
| `tests/app/composables/agent-platform/useInterruptSnapshot.test.ts` | 新建：record/clear 用例 |
| `tests/app/components/ai/AiToolRenderer.test.ts` | 新建：分支分发用例 |
| `tests/app/components/agents/document/interrupts/TemplateSelectCard.test.ts` | 扩展：snapshot 模式 + intent 文字移除 |
| `tests/app/components/agents/contract/interrupts/StanceSelectCard.test.ts` | 扩展：snapshot 模式 |

**不改**的文件：`AiChat.vue` / `AiMessageList.vue` / `AiMessageListVirtualItem.vue`（改用 provide/inject 后无需透传）。

## 风险与权衡

| 风险 | 缓解 |
|------|------|
| `resolvedInterrupts` 仅内存不持久化，刷新页面后 snapshot 丢失 | DraftDocumentCard 已包含模板名 / draftId / 字段统计等完整信息，刷新后仅"我当时点了哪一项"的轨迹丢失，业务影响 0；记入待办：未来用 `additional_kwargs` 把 resumeValue 写到 ToolMessage 元数据（与 user memory `feedback_message_metadata_first` 一致） |
| StanceSelectCard 同步改造可能影响合同审查面板 | 同步加 snapshot 模式 + 测试覆盖；ContractReviewPanel Dialog 同步改造（仅本次涉及 InterruptDispatcher Dialog，不动同文件 StanceSelectionDialog） |
| `messageStreamContext` provide 在 3 个 Panel 各 provide 一次 | 与既有 `subAgentAccess` provide 模式一致（`CaseDetailXiaosuo.vue:50` 已有先例），AiToolRenderer 的 inject 拿到 null 时跳过新分支（其它消费 `<AiChat>` 的入口零影响） |
| AiToolRenderer 进入 interrupt 分支时，工具结果卡（toolMap）变成"resolved 后才显示"，而非"完成时立即显示"——可能感觉延后 | resolvedEntry 在 onResolve 调用一刻就写入，紧接着 LangGraph 跑出 ToolMessage，toolCall.state 切到 'output-available'，toolMap 卡片立即 mount；时序上跟原模态时代一致（dialog 关闭→后续工具结果卡出现），无延迟感 |

## 实施顺序

1. 数据层：useStreamChat 加 `resolvedInterrupts`（含单测）
2. 卡片层：TemplateSelectCard / StanceSelectCard 加 mode prop（含单测）
3. 渲染层：AiToolRenderer 加分支（含单测）
4. 透传层：AiChat / AiMessageList / AiMessageListVirtualItem 加 props
5. 入口层：3 个 Panel 的 Dialog 加 isToolCard 条件
6. 视觉收尾：移除 intent 引导文字、scrollIntoView、snapshot 视觉调优
7. 集成验证：dev 端到端跑一次模板选择 + 立场选择全流程
