# 模块对话上下文隔离设计

**版本**: 1.0  
**日期**: 2026-04-08  
**作者**: Claude  
**状态**: 待审核

---

## 一、概述

### 1.1 问题背景

在模块对话功能开发中发现以下核心问题：

1. **LangChain SDK 限制**：`SystemMessage` 只能在消息列表的第一位，不能出现在 `HumanMessage` 之后
2. **当前设计缺陷**：`moduleContextMiddleware` 在 `beforeAgent` 中注入 `SystemMessage`，导致：
   - 用户发送新消息时，checkpoint 中包含多条 `SystemMessage`
   - LangChain SDK 校验失败：`StreamError: System messages are only permitted as the first passed message`
3. **需求约束**：
   - 上下文消息（案件材料、长期记忆、其他模块结果）不能出现在前端
   - 必须命中模型供应商的 Prompt Caching 机制（system prompt 保持不变）

### 1.2 设计目标

1. **上下文隔离**：上下文消息完全不出现在 SSE 响应中（前端不可见）
2. **缓存友好**：静态 system prompt 保持不变，历史消息（含上下文）可命中 Prompt Caching
3. **增量注入**：只在上下文变更时追加新消息，不修改历史消息
4. **前端透明**：前端只需过滤特定 metadata 的消息，无需感知上下文逻辑

### 1.3 核心设计

**关键决策**：将上下文消息从 `SystemMessage` 改为 `HumanMessage`，通过 `response_metadata.injectedBy` 标记来源，在服务端和前端双层过滤。

```
消息列表结构（checkpoint 中）：
┌─────────────────────────────────────────┐
│ [SystemMessage] 静态 prompt               │ ← 不变，命中缓存
│ "你是法律分析专家..."                     │
├─────────────────────────────────────────┤
│ [HumanMessage] 上下文 #1 (带 metadata)    │ ← 首轮注入，前端过滤
│ response_metadata: { injectedBy: '...' }  │
├─────────────────────────────────────────┤
│ [HumanMessage] 用户消息 1                 │ ← 前端可见
├─────────────────────────────────────────┤
│ [AIMessage] AI 回复 1                     │ ← 前端可见
├─────────────────────────────────────────┤
│ [HumanMessage] 上下文 #2 (增量)           │ ← 变更时注入，前端过滤
│ [HumanMessage] 用户消息 2                 │ ← 前端可见
└─────────────────────────────────────────┘
```

---

## 二、架构设计

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│  前端 (Vue + LangChain SDK)                                  │
├─────────────────────────────────────────────────────────────┤
│  useMessageParser                                            │
│    ↓ filter(msg)                                             │
│    - SystemMessage ❌                                         │
│    - ToolMessage ❌                                           │
│    - HumanMessage with metadata.injectedBy ❌                 │
│    - HumanMessage/AIMessage ✅                                │
└─────────────────────────────────────────────────────────────┘
                          ↑ SSE (filtered)
┌─────────────────────────────────────────────────────────────┐
│  服务端 (chat.post.ts)                                       │
├─────────────────────────────────────────────────────────────┤
│  SSE 推送前过滤                                                │
│    - values 事件：filter(messages)                          │
│    - replay 事件：filter(messages)                          │
└─────────────────────────────────────────────────────────────┘
                          ↑ checkpoint (full)
┌─────────────────────────────────────────────────────────────┐
│  LangGraph Agent (moduleAgent.ts)                            │
├─────────────────────────────────────────────────────────────┤
│  moduleContextMiddleware.beforeAgent                         │
│    ↓ detect changes                                          │
│    ↓ build context (HumanMessage + metadata)                 │
│    ↓ inject before latest HumanMessage                       │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 数据流

```
用户发送消息
  ↓
POST /api/v1/case/analysis/chat
  ↓
enqueueRun → Worker → runModuleChat
  ↓
Agent.stream() 
  ↓
moduleContextMiddleware.beforeAgent
  ↓ (检测变更 → 注入 HumanMessage + metadata)
LLM 推理
  ↓
checkpoint 持久化（含上下文消息）
  ↓
publishAgentEvent(values) → Redis
  ↓
chat.post.ts createEventSubscription
  ↓ (过滤上下文消息)
SSE 推送 → 前端
  ↓
useMessageParser 过滤 → 渲染
```

---

## 三、详细设计

### 3.1 上下文注入逻辑（`moduleContextMiddleware`）

**文件**: `server/services/workflow/middleware/moduleContext.middleware.ts`

**变更**：将 `SystemMessage` 改为 `HumanMessage`，添加 `response_metadata.injectedBy` 标记。

```typescript
// 变更前
const contextMessage = new SystemMessage(
  `<!-- module-context -->\n${sections.join('\n\n')}`,
)

// 变更后
const contextMessage = new HumanMessage({
  content: sections.join('\n\n'),
  response_metadata: {
    injectedBy: `ModuleContextMiddleware:${moduleName}`,
    injectedAt: new Date().toISOString(),
    sections: sections.length, // 用于调试
  },
})
```

**注入位置**：保持当前逻辑（最新 `HumanMessage` 之前）：
```typescript
const lastHumanIdx = state.messages.findLastIndex(
  (m: any) => m._getType?.() === 'human' || m.constructor?.name === 'HumanMessage',
)
if (lastHumanIdx >= 0) {
  state.messages.splice(lastHumanIdx, 0, contextMessage)
} else {
  state.messages.push(contextMessage)
}
```

### 3.2 SSE 推送过滤（`chat.post.ts`）

**文件**: `server/api/v1/case/analysis/chat.post.ts`

**变更点**：3 处推送 `values` 事件的位置需要过滤上下文消息。

#### 过滤函数

新增工具函数：
```typescript
/** 过滤掉上下文注入消息（HumanMessage with metadata.injectedBy） */
function filterInjectedMessages(messages: any[]): any[] {
  return messages.filter(m => {
    // SystemMessage 和 ToolMessage 始终过滤
    if (m._getType?.() === 'system' || m._getType?.() === 'tool') return false
    
    // HumanMessage 检测 metadata
    const injector = m.response_metadata?.injectedBy as string | undefined
    if (injector?.startsWith('ModuleContext') || injector?.startsWith('CaseMaterial')) {
      return false
    }
    
    return true
  })
}
```

#### 推送点 1：已完成 run 的 checkpoint 推送（第 200-210 行）

```typescript
// 变更前
const checkpointValues = await getThreadValuesService(sessionId)
if (checkpointValues) {
  const messages = (checkpointValues.messages as any[]) || []
  if (messages.length > 0) {
    controller.enqueue(encoder.encode(
      `event: values\ndata: ${JSON.stringify(checkpointValues)}\n\n`,
    ))
  }
}

// 变更后
const checkpointValues = await getThreadValuesService(sessionId)
if (checkpointValues) {
  const messages = (checkpointValues.messages as any[]) || []
  if (messages.length > 0) {
    const filteredMessages = filterInjectedMessages(messages)
    controller.enqueue(encoder.encode(
      `event: values\ndata: ${JSON.stringify({ ...checkpointValues, messages: filteredMessages })}\n\n`,
    ))
  }
}
```

#### 推送点 2：fallback 推送（第 224-234 行）

```typescript
// 变更后
const checkpointValues = await getThreadValuesService(sessionId)
if (checkpointValues) {
  const messages = (checkpointValues.messages as any[]) || []
  if (messages.length > 0) {
    const filteredMessages = filterInjectedMessages(messages)
    controller.enqueue(encoder.encode(
      `event: values\ndata: ${JSON.stringify({ ...checkpointValues, messages: filteredMessages })}\n\n`,
    ))
    return
  }
}
```

#### 推送点 3：Redis Stream replay（第 238-252 行）

```typescript
// 变更后
for (const evt of missed) {
  let sseData: string
  if (evt.type === 'stream_event') {
    if (evt.event === 'values') {
      // values 事件需要过滤消息
      const filteredMessages = filterInjectedMessages(evt.data.messages ?? [])
      sseData = `event: values\ndata: ${JSON.stringify({ ...evt.data, messages: filteredMessages })}\n\n`
    } else {
      sseData = `event: ${evt.event}\ndata: ${JSON.stringify(evt.data)}\n\n`
    }
  }
  else if (evt.type === 'custom_event') {
    sseData = `event: custom\ndata: ${JSON.stringify(evt)}\n\n`
  }
  else {
    sseData = `event: status\ndata: ${JSON.stringify(evt)}\n\n`
  }
  controller.enqueue(encoder.encode(sseData))
}
```

### 3.3 前端过滤逻辑（`useMessageParser.ts`）

**文件**: `app/components/ai/composables/useMessageParser.ts`

**变更**：在 `filter` 步骤中增加对 `HumanMessage` 的 metadata 检测。

```typescript
// 变更前（第 144 行）
.filter((m) => !(m instanceof ToolMessage) && !(m instanceof SystemMessage))

// 变更后
.filter((m) => {
  // SystemMessage 和 ToolMessage 始终过滤
  if (m instanceof SystemMessage || m instanceof ToolMessage) return false
  
  // HumanMessage 检测 metadata
  if (m instanceof HumanMessage) {
    const injector = (m as any).response_metadata?.injectedBy as string | undefined
    if (injector?.startsWith('ModuleContext') || injector?.startsWith('CaseMaterial')) {
      return false
    }
  }
  
  return true
})
```

### 3.4 主对话中间件同步（`caseMaterialContextMiddleware`）

**文件**: `server/services/workflow/middleware/caseMaterialContext.middleware.ts`

**现状**：已使用 `HumanMessage` 注入（第 46、65 行），但缺少 `response_metadata` 标记。

**需要补充**：
```typescript
// 变更后
state.messages.splice(insertIdx, 0, new HumanMessage({
  content: messageText,
  response_metadata: {
    injectedBy: 'CaseMaterialContextMiddleware',
    injectedAt: new Date().toISOString(),
  },
}))
```

---

## 四、缓存命中分析

### 4.1 Prompt Caching 机制

**Anthropic Prompt Caching**：
- 缓存单位：消息级别（message-level）
- 缓存键：消息内容 hash
- 缓存范围：system prompt + 历史消息

### 4.2 命中情况

| 对话轮次 | 消息列表 | 缓存命中 |
|---------|---------|---------|
| 第 1 轮 | System + Context#1 + User#1 | 写入缓存 |
| 第 2 轮 | System + Context#1 + User#1 + AI#1 + Context#2 + User#2 | System+Context#1+User#1 命中 |
| 第 3 轮 | ... + AI#2 + Context#3 + User#3 | 历史消息全部命中 |

**结论**：
- ✅ System prompt 始终不变，100% 命中
- ✅ 历史消息（含上下文）在后续轮次中命中
- ❌ 当轮新增内容无法命中（按实际 token 计费）
- 📈 随着对话进行，缓存命中率递增

### 4.3 Token 成本估算

假设典型场景：
- System prompt: 500 tokens（固定）
- 上下文消息：每轮平均 300 tokens（仅变更时注入）
- 用户消息：每轮 100 tokens
- AI 回复：每轮 500 tokens

**10 轮对话成本**：
- 无缓存：(500 + 300 + 100 + 500) × 10 = 14,000 tokens
- 有缓存：1,400（第 1 轮）+ 600 × 9（第 2-10 轮）= 6,800 tokens
- **节省**: 约 51%

---

## 五、错误处理

### 5.1 过滤失败

**场景**：`filterInjectedMessages` 异常导致 SSE 推送失败

**处理**：
```typescript
try {
  const filteredMessages = filterInjectedMessages(messages)
  controller.enqueue(encoder.encode(
    `event: values\ndata: ${JSON.stringify({ ...checkpointValues, messages: filteredMessages })}\n\n`,
  ))
} catch (error) {
  logger.error('消息过滤失败，推送原始消息', { error, sessionId })
  // Fallback：推送原始消息（前端会过滤）
  controller.enqueue(encoder.encode(
    `event: values\ndata: ${JSON.stringify(checkpointValues)}\n\n`,
  ))
}
```

### 5.2 上下文注入失败

**场景**：`moduleContextMiddleware` 异常

**处理**：当前已实现（第 149-151 行）：
```typescript
catch (error) {
  logger.error('模块上下文注入异常，继续执行 Agent', { caseId, moduleName, error })
}
```

### 5.3 前端渲染异常

**场景**：`useMessageParser` 过滤逻辑异常

**处理**：
```typescript
.filter((m) => {
  try {
    // 过滤逻辑
  } catch (error) {
    console.error('[useMessageParser] 消息过滤失败', error, m)
    return true // Fallback：保留消息
  }
})
```

---

## 六、测试策略

### 6.1 单元测试

**测试文件**: `tests/server/workflow/middleware/moduleContext.middleware.test.ts`

**测试用例**：
1. 首轮对话：全量注入上下文
2. 无变更场景：跳过注入
3. 有变更场景：增量注入
4. metadata 标记正确性验证

### 6.2 集成测试

**测试文件**: `tests/server/api/module-chat-context.test.ts`

**测试用例**：
1. SSE 推送消息过滤验证
2. checkpoint 中消息完整性验证
3. 前端 `useMessageParser` 过滤验证

### 6.3 E2E 测试

**测试文件**: `tests/e2e/module-chat-history-load-manual.md`

**测试场景**：
1. 新建对话并发送消息
2. 页面刷新后历史恢复
3. 多轮对话上下文隔离

---

## 七、涉及的文件变更

### 新建文件

无

### 修改文件

| 文件 | 变更说明 | 优先级 |
|------|---------|--------|
| `server/services/workflow/middleware/moduleContext.middleware.ts` | SystemMessage → HumanMessage + metadata | P0 |
| `server/services/workflow/middleware/caseMaterialContext.middleware.ts` | 添加 response_metadata 标记 | P1 |
| `server/api/v1/case/analysis/chat.post.ts` | 添加 filterInjectedMessages 函数，3 处推送点过滤 | P0 |
| `app/components/ai/composables/useMessageParser.ts` | HumanMessage metadata 过滤 | P0 |

---

## 八、迁移计划

### 8.1 阶段 1：模块对话修复

1. 修改 `moduleContextMiddleware` 使用 `HumanMessage + metadata`
2. 修改 `chat.post.ts` 添加过滤逻辑
3. 修改 `useMessageParser.ts` 添加前端过滤

### 8.2 阶段 2：主对话同步

1. 修改 `caseMaterialContextMiddleware` 添加 `response_metadata`
2. 确保主对话和模块对话过滤逻辑一致

### 8.3 阶段 3：验证与回归

1. 运行单元测试
2. 运行集成测试
3. 手动 E2E 测试（参考 `tests/e2e/module-chat-history-load-manual.md`）

---

## 九、关键决策记录

### 决策 1：使用 `HumanMessage` 而非 `SystemMessage`

**原因**：
- LangChain SDK 限制：SystemMessage 只能在第一位
- HumanMessage 可出现在任意位置，不破坏消息结构

**代价**：
- 需要 metadata 标记来源
- 需要双层过滤（服务端 + 前端）

### 决策 2：双层过滤（服务端 + 前端）

**原因**：
- 服务端过滤：减少 SSE 传输数据量
- 前端过滤：兜底保障，防止服务端漏过滤

**代价**：
- 代码重复，但逻辑简单

### 决策 3：增量注入而非全量覆盖

**原因**：
- 增量注入可命中 Prompt Caching
- 全量覆盖每轮都修改历史，无法命中缓存

**代价**：
- 需要维护变更检测逻辑
- checkpoint 体积随对话增长

---

## 十、后续优化

### 10.1 消息压缩

当对话过长时，考虑：
- 使用 `summarizationMiddleware` 压缩历史消息
- 上下文消息可被摘要替代

### 10.2 缓存优化

- 探索 Anthropic `cache_control: ephemeral` 字段
- 对上下文消息显式标记可缓存部分

### 10.3 调试支持

- 在开发环境添加调试标志，可选择是否过滤上下文
- 添加日志记录注入和过滤的详细信息
