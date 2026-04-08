# 模块对话上下文隔离实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将模块对话的上下文注入从 `SystemMessage` 改为`HumanMessage + metadata`，实现上下文完全不出现在前端，同时保持命中模型供应商的 Prompt Caching。

**Architecture:** 采用三层架构：
1. **注入层** (`moduleContextMiddleware`)：使用 `HumanMessage` 注入上下文，添加`response_metadata.injectedBy` 标记
2. **过滤层** (`chat.post.ts` + `useMessageParser.ts`)：服务端 SSE 推送前过滤 + 前端渲染时过滤
3. **持久化层**：LangGraph 自动将完整消息历史持久化到 PostgresSaver

**Tech Stack:** LangChain.js, Nuxt Server, Vue 3, PostgresSaver

**Spec Reference:** `docs/superpowers/specs/2026-04-08-module-chat-context-isolation-design.md`

---

## 前置任务

- [ ] **Step 1: 确认设计文档已审核通过**

检查设计文档：`docs/superpowers/specs/2026-04-08-module-chat-context-isolation-design.md`

确认用户已审核并批准设计文档。

---

## 阶段 1：模块对话核心修改（P0）

### Task 1: 修改 `moduleContext.middleware.ts`

**Files:**
- Modify: `server/services/workflow/middleware/moduleContext.middleware.ts`
- Test: `tests/server/workflow/middleware/moduleContext.middleware.test.ts`（新建）

- [ ] **Step 1.1: 读取当前文件**

读取 `server/services/workflow/middleware/moduleContext.middleware.ts`，确认当前使用 `SystemMessage` 注入的位置。

- [ ] **Step 1.2: 修改注入逻辑**

将 `SystemMessage` 改为 `HumanMessage`，添加 metadata 标记：

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
    sections: sections.length,
  },
})
```

- [ ] **Step 1.3: 确认导入**

确保文件导入了 `HumanMessage`：
```typescript
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
```

- [ ] **Step 1.4: 编写单元测试**

创建测试文件 `tests/server/workflow/middleware/moduleContext.middleware.test.ts`，覆盖：
- 首轮对话：全量注入上下文
- 无变更场景：跳过注入
- 有变更场景：增量注入
- metadata 标记正确性验证

- [ ] **Step 1.5: 运行测试**

```bash
npx vitest run tests/server/workflow/middleware/moduleContext.middleware.test.ts -v
```
Expected: PASS

- [ ] **Step 1.6: 提交**

```bash
git add server/services/workflow/middleware/moduleContext.middleware.ts
git add tests/server/workflow/middleware/moduleContext.middleware.test.ts
git commit -m "feat(module-context): use HumanMessage with metadata for context injection"
```

---

### Task 2: 修改 `chat.post.ts`

**Files:**
- Modify: `server/api/v1/case/analysis/chat.post.ts`

- [ ] **Step 2.1: 读取当前文件**

读取 `server/api/v1/case/analysis/chat.post.ts`，找到 3 处 values 事件推送位置。

- [ ] **Step 2.2: 添加过滤函数**

在文件顶部（导入语句之后，handler 函数之前）添加过滤函数：

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

- [ ] **Step 2.3: 修改推送点 1（第 200-210 行）**

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

- [ ] **Step 2.4: 修改推送点 2（fallback 推送）】**

在 fallback 逻辑中应用同样的过滤。

- [ ] **Step 2.5: 修改推送点 3（Redis Stream replay）**

```typescript
// 变更后
for (const evt of missed) {
  let sseData: string
  if (evt.type === 'stream_event') {
    if (evt.event === 'values') {
      const filteredMessages = filterInjectedMessages(evt.data.messages ?? [])
      sseData = `event: values\ndata: ${JSON.stringify({ ...evt.data, messages: filteredMessages })}\n\n`
    } else {
      sseData = `event: ${evt.event}\ndata: ${JSON.stringify(evt.data)}\n\n`
    }
  }
  // ... 其他事件类型处理
  controller.enqueue(encoder.encode(sseData))
}
```

- [ ] **Step 2.6: 类型检查**

```bash
npx nuxi typecheck
```
Expected: No errors

- [ ] **Step 2.7: 提交**

```bash
git add server/api/v1/case/analysis/chat.post.ts
git commit -m "feat(chat-api): filter injected context messages before SSE push"
```

---

### Task 3: 修改 `useMessageParser.ts`

**Files:**
- Modify: `app/components/ai/composables/useMessageParser.ts`

- [ ] **Step 3.1: 读取当前文件**

读取 `app/components/ai/composables/useMessageParser.ts`，找到 filter 逻辑（第 144 行附近）。

- [ ] **Step 3.2: 修改过滤逻辑**

```typescript
// 变更前
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

- [ ] **Step 3.3: 确认导入**

确保导入了 `HumanMessage`：
```typescript
import { HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages'
```

- [ ] **Step 3.4: 类型检查**

```bash
npx nuxi typecheck
```
Expected: No errors

- [ ] **Step 3.5: 提交**

```bash
git add app/components/ai/composables/useMessageParser.ts
git commit -m "feat(message-parser): filter context-injected HumanMessages"
```

---

## 阶段 2：主对话同步（P1）

### Task 4: 修改 `caseMaterialContext.middleware.ts`

**Files:**
- Modify: `server/services/workflow/middleware/caseMaterialContext.middleware.ts`

- [ ] **Step 4.1: 读取当前文件**

读取 `server/services/workflow/middleware/caseMaterialContext.middleware.ts`，确认当前注入逻辑。

- [ ] **Step 4.2: 添加 metadata 标记**

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

- [ ] **Step 4.3: 提交**

```bash
git add server/services/workflow/middleware/caseMaterialContext.middleware.ts
git commit -m "feat(case-context): add response_metadata marker for context injection"
```

---

## 阶段 3：验证与回归

### Task 5: 运行测试

- [ ] **Step 5.1: 运行单元测试**

```bash
npx vitest run tests/server/workflow/middleware/moduleContext.middleware.test.ts -v
```

- [ ] **Step 5.2: 运行集成测试**

如果有现有的 chat API 集成测试：
```bash
npx vitest run tests/server/api/chat.test.ts -v
```

- [ ] **Step 5.3: 全量测试**

```bash
npx vitest run
```
Expected: All tests pass

---

### Task 6: 手动 E2E 测试

**Files:**
- Reference: `tests/e2e/module-chat-history-load-manual.md`

- [ ] **Step 6.1: 准备测试环境**

确保案件 #16 已完成模块分析。

- [ ] **Step 6.2: 执行手动测试用例**

按照 `tests/e2e/module-chat-history-load-manual.md` 执行 6 个测试场景：
1. 新建对话并发送第一条消息
2. 页面刷新后展开对话，历史消息正确恢复
3. 发送第二条消息并追加到历史
4. 多次刷新后所有历史消息正确显示
5. 并发对话（多模块独立 session）
6. 快速连续发送多条消息

- [ ] **Step 6.3: 记录测试结果**

填写测试结果表格，记录任何问题。

---

## 回归验证

- [ ] **Step 7: 验证主对话不受影响**

访问主对话页面（非模块对话），确认：
- 主对话的上下文注入正常工作
- 主对话的消息过滤正常工作

---

## 关键检查点

**检查点 1（阶段 1 完成后）:**
- [ ] 模块对话可以正常发送消息
- [ ] 前端不显示 SystemMessage
- [ ] 前端不显示带 metadata 的 HumanMessage

**检查点 2（阶段 2 完成后）:**
- [ ] 主对话和模块对话使用一致的 metadata 标记模式

**检查点 3（阶段 3 完成后）:**
- [ ] 所有测试通过
- [ ] 手动 E2E 测试通过
- [ ] 无回归问题

---

## 回退方案

如果实施后发现问题：

1. **消息过滤失败**：服务端 fallback 推送原始消息，前端过滤
2. **缓存命中率下降**：检查 metadata 标记是否正确，历史消息是否被修改
3. **前端渲染异常**：检查 useMessageParser 过滤逻辑是否正确

最坏情况下，可以回滚到上一个可用版本：
```bash
git revert <commit-hash>
```

---

## 完成标准

- [ ] 所有阶段任务完成
- [ ] 所有测试通过
- [ ] 手动 E2E 测试通过
- [ ] 无回归问题
- [ ] 代码已提交
