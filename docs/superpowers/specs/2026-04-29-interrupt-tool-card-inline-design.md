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

### 模块 1：数据层 (`app/composables/useStreamChat.ts`)

新增响应式状态：

```ts
interface ResolvedInterruptEntry {
  interrupt: { type: string; toolCallId: string; [key: string]: unknown }
  resumeValue: unknown // null 表示取消
  resolvedAt: Date
}

const resolvedInterrupts = ref<Map<string, ResolvedInterruptEntry>>(new Map())
```

行为：
- `resolveInterrupt(value)` 调用前：把 `{ interrupt: interruptData.value, resumeValue: value, resolvedAt: new Date() }` 写入 Map（key=`interruptData.value.toolCallId`）
- `switchSession()` / `init()` 切换会话时：`resolvedInterrupts.value.clear()`
- 暴露给 setup 调用方使用（与现有 `interruptData` 并列）

### 模块 2：渲染层 (`app/components/ai/AiToolRenderer.vue`)

新增 props：

```ts
interface Props {
  toolCall: ToolCallWithResult
  toolMap?: Record<string, Component>
  // 新增
  interruptData?: { type?: string; toolCallId?: string;[key: string]: unknown } | null
  resolvedInterrupts?: Map<string, ResolvedInterruptEntry>
}
```

渲染优先级（v-if 链，自上而下）：

```vue
<!-- 1. active interrupt：仅渲染活跃卡片 -->
<InterruptDispatcher
  v-if="isActiveInterrupt"
  mode="active"
  :interrupt="interruptData"
  @submit="..." @cancel="..."
/>

<!-- 2. resolved interrupt（isToolCard=true）：snapshot + 可选 toolMap 完成态 -->
<template v-else-if="resolvedEntry">
  <InterruptDispatcher
    mode="snapshot"
    :interrupt="resolvedEntry.interrupt"
    :resume-value="resolvedEntry.resumeValue"
  />
  <component
    v-if="toolCall.state === 'output-available' && toolMap?.[toolCall.name]"
    :is="toolMap[toolCall.name]"
    :tool-name="toolCall.name"
    :input="toolCall.args"
    :output="toolCall.result"
    :state="toolCall.state"
  />
</template>

<!-- 3. 普通工具：现状不变 -->
<component v-else-if="toolMap?.[toolCall.name]" .../>
<SubAgentChainOfThought v-else-if="isSubAgentTool(...)" .../>
<!-- ...原有内置卡片分支 -->
```

判断辅助：

```ts
const isActiveInterrupt = computed(() => {
  return props.interruptData?.toolCallId === props.toolCall.id
    && globalInterruptRegistry.isToolCard(props.interruptData?.type ?? '')
})
const resolvedEntry = computed(() => {
  return props.resolvedInterrupts?.get(props.toolCall.id) ?? null
})
```

### 模块 3：组件链透传 props

`AiChat.vue` → `AiMessageList.vue` → `AiMessageListVirtualItem.vue` → `AiToolRenderer.vue`：

四个组件都新增 props `interruptData`, `resolvedInterrupts` 并向下透传。每层都是简单 `<Component v-bind="$attrs" :interrupt-data="..." :resolved-interrupts="..."/>` 风格。

调用方（`CaseDetailXiaosuo` / `AssistantChatPanel` / `ContractReviewPanel`）从 `useStreamChat` 解构两个状态后传给 `<AiChat>`。

### 模块 4：InterruptDispatcher (`app/components/InterruptDispatcher.vue`)

新增 props：

```ts
interface Props {
  interrupt: { type?: string;[key: string]: unknown } | null
  isSubmitting?: boolean
  // 新增
  mode?: 'active' | 'snapshot' // 默认 'active'
  resumeValue?: unknown // mode='snapshot' 时必传
}
```

新行为：透传 `mode` 和 `resumeValue` 到子组件（TemplateSelectCard / StanceSelectCard）。中断卡（`isToolCard=false`）忽略这两个新 props（永远是 active 模式）。

### 模块 5：卡片组件 (`TemplateSelectCard.vue` / `StanceSelectCard.vue`)

#### TemplateSelectCard

新增 props：

```ts
interface Props {
  interrupt: TemplateInterrupt
  onResolve?: (value: ResolveValue | null) => Promise<void> | void
  mode?: 'active' | 'snapshot' // 默认 'active'
  resumeValue?: { templateId?: number; sourceText?: string } | null
}
```

`mode === 'snapshot'` 时：
- 整个根 div 加 `opacity-70`，边框改 `border-muted`
- `selectedId` 直接初始化为 `resumeValue?.templateId`（如果有）
- 隐藏"使用此模板" / "取消" 按钮，仅显示"已选模板：xxx"或"已取消"
- 列表项 disabled，无 hover、无选择动画
- 移除"根据「...」为您推荐"intent 引导文字
- "浏览全部 N 个模板" / 搜索 / 分类 dropdown 全部隐藏

`mode === 'active'`（默认）时：行为不变，但**移除 intent 引导文字**（line 252-254 的 `<p v-if="intentText">`）—— 内联后用户原始陈述已在消息流上方可见，不重复。

#### StanceSelectCard

`mode === 'snapshot'` 时：
- 整体降饱和（同上）
- 选项变 disabled，显示用户已选立场
- 隐藏提交/取消按钮，仅显示"已选立场：xxx"
- `mode === 'active'` 时维持现状

### 模块 6：Panel 入口（3 个）

`CaseDetailXiaosuo.vue` / `AssistantChatPanel.vue` / `ContractReviewPanel.vue` 现有 Dialog 块改成：

```vue
<Dialog
  v-if="interruptData && !isCurrentInterruptToolCard"
  :open="!!interruptData"
  @update:open="() => {}"
>
  <DialogContent ...>
    <InterruptDispatcher
      :interrupt="interruptData"
      @submit="resolveInterrupt"
      @cancel="..."
    />
  </DialogContent>
</Dialog>
```

判断辅助 computed：

```ts
const isCurrentInterruptToolCard = computed(() => {
  const t = interruptData.value?.type
  return typeof t === 'string' && globalInterruptRegistry.isToolCard(t)
})
```

`isToolCard=true` 时 Dialog 不渲染，由 AiToolRenderer 在消息流内联消化。

## 视觉与交互细节

### Active 卡片

- 沿用现有 amber 边框（`border-amber-300/60 bg-amber-50/60`）
- 卡片首次 mount 时 `nextTick` 调 `el.scrollIntoView({ behavior: 'smooth', block: 'center' })`
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

新增 / 扩展单测：

| 测试文件 | 用例 |
|---------|------|
| `tests/app/composables/useStreamChat.test.ts`（如不存在则创建） | resolve 后 `resolvedInterrupts` 正确填充；session 切换后清空 |
| `tests/app/components/ai/AiToolRenderer.test.ts`（新建） | 3 条 v-if 分支按预期分发：active interrupt / resolved snapshot / 普通工具 |
| `tests/app/components/agents/document/interrupts/TemplateSelectCard.test.ts` | 扩展：`mode='snapshot'` 时按钮 disabled、显示"已选 xxx"或"已取消"；移除 intent 引导文字（确认 DOM 不再渲染） |
| `tests/app/components/agents/contract/interrupts/StanceSelectCard.test.ts`（如不存在则创建） | `mode='snapshot'` 时按钮 disabled、显示已选立场 |
| `tests/app/components/caseDetail/CaseDetailXiaosuo.test.ts`（如不存在则创建） | `isToolCard=true` 时 Dialog 不渲染；`isToolCard=false` 时走 Dialog |

## 文件改动清单

| 文件 | 改动类型 |
|------|---------|
| `app/composables/useStreamChat.ts` | 修改：加 `resolvedInterrupts` 状态 + 在 resolveInterrupt 写入 + session 切换清空 |
| `app/components/ai/AiToolRenderer.vue` | 修改：加 props + 3 条 v-if 分支 |
| `app/components/ai/AiChat.vue` | 修改：透传 props |
| `app/components/ai/AiMessageList.vue` | 修改：透传 props |
| `app/components/ai/AiMessageListVirtualItem.vue` | 修改：透传 props |
| `app/components/InterruptDispatcher.vue` | 修改：加 mode / resumeValue prop 透传 |
| `app/components/agents/document/interrupts/TemplateSelectCard.vue` | 修改：加 mode / resumeValue 支持 snapshot 视觉；移除 intent 引导文字 |
| `app/components/agents/contract/interrupts/StanceSelectCard.vue` | 修改：加 mode / resumeValue 支持 snapshot 视觉 |
| `app/components/caseDetail/CaseDetailXiaosuo.vue` | 修改：Dialog 加 isToolCard 条件 |
| `app/components/assistant/AssistantChatPanel.vue` | 修改：同上 |
| `app/components/assistant/contract/ContractReviewPanel.vue` | 修改：同上 |
| `tests/app/composables/useStreamChat.test.ts` | 新建或扩展 |
| `tests/app/components/ai/AiToolRenderer.test.ts` | 新建 |
| `tests/app/components/agents/document/interrupts/TemplateSelectCard.test.ts` | 扩展 snapshot 用例 |
| `tests/app/components/agents/contract/interrupts/StanceSelectCard.test.ts` | 新建 / 扩展 |
| `tests/app/components/caseDetail/CaseDetailXiaosuo.test.ts` | 新建 / 扩展 isToolCard 分支用例 |

## 风险与权衡

| 风险 | 缓解 |
|------|------|
| props 沿 4 层组件链透传（AiChat → MessageList → VirtualItem → ToolRenderer） | 是现有架构既定模式（toolMap、tool-call-id 等已经这么传），不引入新模式；改动可控 |
| `resolvedInterrupts` 仅内存不持久化，刷新页面后 snapshot 丢失 | DraftDocumentCard 已包含模板名 / draftId / 字段统计等完整信息，刷新后仅"我当时点了哪一项"的轨迹丢失，业务影响 0 |
| StanceSelectCard 同步改造可能影响合同审查面板 | 同步加 snapshot 模式 + 测试覆盖；ContractReviewPanel Dialog 同步改造 |
| 新加 props 对没传的调用方视为未启用 | 兼容设计：`interruptData` / `resolvedInterrupts` 都是 optional，不传时 AiToolRenderer 跳过新分支，行为完全等同改造前；其它消费 `<AiChat>` 的入口（如初分模块对话）零影响 |

## 实施顺序

1. 数据层：useStreamChat 加 `resolvedInterrupts`（含单测）
2. 卡片层：TemplateSelectCard / StanceSelectCard 加 mode prop（含单测）
3. 渲染层：AiToolRenderer 加分支（含单测）
4. 透传层：AiChat / AiMessageList / AiMessageListVirtualItem 加 props
5. 入口层：3 个 Panel 的 Dialog 加 isToolCard 条件
6. 视觉收尾：移除 intent 引导文字、scrollIntoView、snapshot 视觉调优
7. 集成验证：dev 端到端跑一次模板选择 + 立场选择全流程
