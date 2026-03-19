# 流式 Todos 重复修复 - Bug 修复设计

## 概述

本次 bug 修复解决了 Vue 组件 `app/pages/dashboard/analysis/[sessionId].vue` 中的一个关键问题：AI SDK Chat 实例的流式更新导致重复创建 todo 项。根本原因是 watch 监听器在流式传输期间对 messages 数组的每次变化都会触发，导致 `updateTodos` 函数对相同的 todo 内容被多次调用。修复方案将实现一个去重机制，确保每个 todo 只创建一次，同时保留在流式传输期间更新 todo 状态的能力。

## 术语表

- **Bug_Condition (C) - Bug 条件**：触发 bug 的条件 - 当 watch 监听器在流式更新期间多次触发时，导致重复创建 todo
- **Property (P) - 属性**：期望的行为 - 每个唯一的 todo 内容应该只产生一个 todo 项，状态更新应用于现有项
- **Preservation - 保留性**：必须保持不变的现有功能 - 新 todo 创建、状态更新、非 todo 消息处理和最终状态显示
- **updateTodos**：`app/pages/dashboard/analysis/[sessionId].vue` 中处理流式消息中的 todo 数据并更新响应式 Todos 数组的函数
- **watch listener - watch 监听器**：监控 `chat.messages` 变化的 Vue watch 函数，使用 deep: true 选项
- **Todos array - Todos 数组**：存储在 UI 中显示的 QueueTodo 项的响应式数组
- **streaming updates - 流式更新**：响应生成期间来自 AI SDK Chat 实例的增量消息更新
- **sha256Text**：用于根据内容生成 todo 项唯一 ID 的哈希函数

## Bug 详情

### Bug 条件

当 AI SDK Chat 实例接收到包含 `write_todos` 工具调用的流式消息更新时，bug 就会出现。在单次工具调用的流式输出过程中，每输出一个 token，`input` 字段就会更新一次，导致带有 `{ deep: true }` 的 watch 监听器在 messages 数组每次变化时触发，从而对同一个工具调用重复调用 `updateTodos`。

**形式化规范：**

```typescript
FUNCTION isBugCondition(input)
  INPUT: input of type { 
    messages: UIMessage[], 
    toolCall: WriteTodos,
    streamingActive: boolean 
  }
  OUTPUT: boolean
  
  RETURN input.streamingActive == true
         AND input.toolCall.type == 'dynamic-tool'
         AND input.toolCall.toolName == 'write_todos'
         AND input.toolCall.state == 'input-streaming'
         AND watch listener triggers on every token update
         AND updateTodos processes same toolCallId multiple times
END FUNCTION
```

### 示例

- **示例 1（核心问题）**：在流式传输期间，一个 `write_todos` 工具调用开始输出。
  - Token 1: `{ todos: [{ content: "梳" }] }` → watch 触发 → updateTodos 被调用
  - Token 5: `{ todos: [{ content: "梳理案件" }] }` → watch 触发 → updateTodos 再次被调用
  - Token 10: `{ todos: [{ content: "梳理案件事实与时间线", status: "in_progress" }] }` → watch 触发 → updateTodos 再次被调用
  - **期望**：只在工具调用完成时（state 不再是 'input-streaming'）调用一次 updateTodos
  - **实际**：每个 token 都触发一次 updateTodos，导致数十次不必要的处理

- **示例 2（多个 todos）**：一个 `write_todos` 工具调用包含 6 个 todos。
  - 在流式输出过程中，todos 数组逐步构建：`[todo1]` → `[todo1, todo2]` → ... → `[todo1, ..., todo6]`
  - 每次数组增长都触发 watch，导致 updateTodos 被调用数十次
  - **期望**：只在工具调用完成时调用一次 updateTodos，处理完整的 6 个 todos
  - **实际**：在流式过程中被调用多次，每次处理不完整的 todos 数组

- **示例 3（状态变化）**：一个 todo 的状态在同一个工具调用中从 "pending" 变为 "in_progress"。
  - 流式输出过程中，status 字段逐步构建：`"pen"` → `"pend"` → `"pending"` → `"in_progress"`
  - 每次状态字段的 token 更新都触发 watch
  - **期望**：只在最终状态确定后更新一次
  - **实际**：在流式过程中多次触发更新

- **边界情况**：同一个会话中有多个 `write_todos` 工具调用（例如，更新任务进度）。
  - 第一个工具调用：创建 6 个 todos（流式输出触发数十次 watch）
  - 第二个工具调用：更新第一个 todo 的状态为 "completed"（流式输出再次触发多次 watch）
  - **期望**：每个工具调用完成时各处理一次
  - **实际**：每个工具调用的流式过程都触发多次处理

## 期望行为

### 保留性要求

**不变的行为：**

- 当真正的新内容到达时，新 todo 的创建必须继续正常工作
- 状态更新（pending → in_progress → completed）必须继续正确应用
- 非 todo 消息（text、reasoning 等）必须继续正常处理
- 所有 todos 的最终显示状态必须保持不变
- 用于生成 todo ID 的 sha256Text 哈希机制必须保持不变

**范围：**

所有不涉及重复 todo 内容的流式更新的输入都应该完全不受此修复的影响。这包括：

- 首次出现时的初始 todo 创建
- 对现有 todos 的状态更新
- 处理非 write_todos 消息部分
- UI 中 Todos 数组的显示和渲染

## 根本原因分析

基于用户澄清和代码分析，确认的根本原因是：

**单次 `write_todos` 工具调用的流式 token 输出导致重复处理**

在一次 `write_todos` 工具调用过程中：

1. **流式 Token 输出**：AI 模型流式输出工具调用的参数（todos 数组），每输出一个 token，AI SDK 就会更新 messages 数组中该工具调用的 `input` 字段。

2. **Watch 过度触发**：由于 watch 监听器使用 `{ deep: true }`，messages 数组的每次嵌套变化（包括 `input.todos` 的增量构建）都会触发 watch。

3. **重复调用 updateTodos**：每次 watch 触发时，代码都会遍历所有 messages 和 parts，找到 `write_todos` 类型的 part，并调用 `updateTodos(part)`。

4. **缺乏状态检测**：代码没有检查工具调用的 `state` 字段（如 `input-streaming`），也没有跟踪 `toolCallId`，因此无法区分"正在流式输出中"和"已完成输出"的工具调用。

**具体流程示例：**

```
Token 1: { todos: [{ content: "梳" }] } → watch 触发 → updateTodos 调用
Token 2: { todos: [{ content: "梳理" }] } → watch 触发 → updateTodos 调用
Token 3: { todos: [{ content: "梳理案件" }] } → watch 触发 → updateTodos 调用
...
Token N: { todos: [{ content: "梳理案件事实与时间线", status: "in_progress" }] } → watch 触发 → updateTodos 调用
```

每次调用 `updateTodos` 时，虽然 upsert 逻辑会更新现有的 todo（因为 ID 相同），但这导致了大量不必要的处理和可能的 UI 闪烁。

## 正确性属性

**属性 1：Bug 条件 - 流式传输期间的去重**

_对于任何_流式更新，其中具有相同内容（因此具有相同 sha256 哈希 ID）的 todo 在不同的 watch 触发事件中多次出现，修复后的 updateTodos 函数应确保 Todos 数组中只存在一个具有该 ID 的 todo 项，其状态反映最新的更新。

**验证：需求 2.1、2.2、2.3**

**属性 2：保留性 - 现有功能**

_对于任何_表示真正新 todo（之前未见过的内容）或对现有 todo 的合法状态更新的输入，修复后的代码应产生与原始代码完全相同的行为，保留新 todo 创建、状态更新和正确的最终状态显示。

**验证：需求 3.1、3.2、3.3、3.4**

## 修复实现

### 需要的变更

假设我们的根本原因分析是正确的：

**文件**：`app/pages/dashboard/analysis/[sessionId].vue`

**函数**：`updateTodos` 和 watch 监听器

**具体变更**：

1. **添加已处理工具调用跟踪**：
   - 创建一个 `Set<string>` 来跟踪已处理的 `toolCallId`
   - 在组件的响应式数据中声明：`const processedToolCalls = new Set<string>()`

2. **修改 Watch 监听器逻辑**：
   - 在处理 `write_todos` 类型的 part 之前，添加两个检查：
     - 检查 `part.state === 'input-streaming'`，如果是则跳过
     - 检查 `processedToolCalls.has(part.toolCallId)`，如果已处理则跳过
   - 在调用 `updateTodos` 之前，将 `toolCallId` 添加到 Set 中

3. **保持 updateTodos 函数不变**：
   - 现有的 upsert 逻辑（基于 sha256 hash ID）保持不变
   - 这确保了即使有任何边界情况，也能正确处理

4. **添加会话重置逻辑（可选）**：
   - 如果需要支持同一组件实例中的多个分析会话，在新会话开始时清空 `processedToolCalls`
   - 或者在 `onUnmounted` 钩子中清理

5. **添加调试日志（开发阶段）**：
   ```typescript
   if (part.state === 'input-streaming') {
     console.log('[Todos] Skipping streaming tool call:', part.toolCallId)
     return
   }
   if (processedToolCalls.has(part.toolCallId)) {
     console.log('[Todos] Skipping already processed tool call:', part.toolCallId)
     return
   }
   console.log('[Todos] Processing completed tool call:', part.toolCallId)
   ```

### 推荐方法

基于确认的根本原因，最有效的解决方案是：

**方案：检查工具调用的 `state` 字段，只在非流式状态时处理**

核心思路：

1. **状态检测**：在 watch 监听器中，遍历 messages 和 parts 时，检查 `write_todos` 工具调用的 `state` 字段。
   
2. **跳过流式中的调用**：如果 `state === 'input-streaming'`，说明工具调用还在流式输出中，跳过处理。

3. **处理完成的调用**：只有当 `state` 不是 `'input-streaming'` 时（例如，state 为 undefined 或其他最终状态），才调用 `updateTodos`。

4. **去重保护**：使用 `toolCallId` 跟踪已处理的工具调用，防止同一个工具调用被处理多次（例如，在状态从 'input-streaming' 变为最终状态时可能触发多次 watch）。

**实现伪代码：**

```typescript
// 跟踪已处理的工具调用 ID
const processedToolCalls = new Set<string>()

watch(() => chat.messages, (newMessages) => {
  newMessages.forEach((message: any) => {
    message.parts?.forEach((part: any) => {
      if (part.type === 'dynamic-tool' && part.toolName === 'write_todos') {
        // 关键检查：跳过正在流式输出的工具调用
        if (part.state === 'input-streaming') {
          return // 跳过，等待流式完成
        }
        
        // 去重：检查是否已处理过此工具调用
        if (processedToolCalls.has(part.toolCallId)) {
          return // 已处理，跳过
        }
        
        // 标记为已处理
        processedToolCalls.add(part.toolCallId)
        
        // 处理完成的工具调用
        updateTodos(part as WriteTodos)
      }
    })
  })
}, { deep: true })
```

**优点：**

- 最小化代码变更，只需添加状态检查
- 直接解决根本原因（流式 token 输出触发的重复处理）
- 保持现有的 upsert 逻辑不变
- 不需要防抖或节流，性能更好
- 清晰易懂，易于维护

**注意事项：**

- 需要在组件卸载时清理 `processedToolCalls` Set（如果需要支持多次会话）
- 或者在新的分析会话开始时重置 Set

## 测试策略

### 验证方法

测试策略遵循两阶段方法：首先，在未修复的代码上展示 bug 的反例，然后验证修复是否正常工作并保留现有行为。

### 探索性 Bug 条件检查

**目标**：在实施修复之前，展示证明 bug 的反例。确认或反驳根本原因分析。如果我们反驳，我们将需要重新假设。

**测试计划**：编写模拟具有重复 todo 内容的流式更新的测试。监控 updateTodos 被调用的次数以及创建了多少个 todo 项。在未修复的代码上运行这些测试以观察失败并理解根本原因。

**测试用例**：

1. **流式 Token 重复处理测试**：模拟单个 `write_todos` 工具调用的流式输出，其中 `input.todos` 数组逐步构建（在未修复的代码上会失败 - 预期 updateTodos 被调用数十次，每个 token 一次）

2. **状态检测测试**：模拟工具调用从 `state: 'input-streaming'` 到最终状态的转换（在未修复的代码上会失败 - 预期在流式过程中多次调用 updateTodos）

3. **多个 Todos 流式构建测试**：模拟包含 6 个 todos 的工具调用，todos 数组从 `[todo1]` 逐步增长到 `[todo1, ..., todo6]`（在未修复的代码上会失败 - 预期每次数组增长都触发 updateTodos）

4. **快速 Token 更新测试**：模拟非常快速的 token 更新（模拟真实的流式输出速度），验证 watch 触发频率（在未修复的代码上会失败 - 预期数十次 watch 触发和 updateTodos 调用）

5. **多个工具调用测试**：模拟同一会话中的多个 `write_todos` 工具调用（例如，创建 todos 后更新状态），验证每个工具调用都被正确处理且不重复（在未修复的代码上会失败 - 预期每个工具调用的流式过程都触发多次处理）

**预期的反例**：

- updateTodos 在单个工具调用的流式过程中被调用数十次（每个 token 一次）
- watch 监听器在 `state === 'input-streaming'` 时仍然触发处理
- 同一个 `toolCallId` 被处理多次
- 可能的原因：缺乏状态检测、没有 toolCallId 去重、watch 对每个 token 变化都触发

### 修复检查

**目标**：验证对于所有 bug 条件成立的输入，修复后的函数产生预期的行为。

**伪代码：**

```typescript
FOR ALL input WHERE isBugCondition(input) DO
  result := processStreamingUpdates_fixed(input)
  ASSERT each unique todo content appears exactly once in Todos array
  ASSERT todo statuses reflect the most recent update
  ASSERT updateTodos is called only when meaningful changes occur
END FOR
```

**测试用例**：

1. **状态检测验证**：模拟工具调用从 `state: 'input-streaming'` 到完成，验证只在完成时调用一次 updateTodos
2. **ToolCallId 去重验证**：模拟同一个 toolCallId 在状态变化时可能触发多次 watch，验证只处理一次
3. **调用次数验证**：监控 updateTodos 调用次数，验证每个工具调用只被处理一次（而不是数十次）
4. **最终状态验证**：验证流式传输完成后最终 Todos 数组与预期状态匹配
5. **多工具调用验证**：验证多个 `write_todos` 工具调用都被正确处理且互不干扰

### 保留性检查

**目标**：验证对于所有 bug 条件不成立的输入，修复后的函数产生与原始函数相同的结果。

**伪代码：**

```typescript
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT processStreamingUpdates_original(input) = processStreamingUpdates_fixed(input)
END FOR
```

**测试方法**：建议使用基于属性的测试进行保留性检查，因为：

- 它会自动在输入域中生成许多测试用例
- 它能捕获手动单元测试可能遗漏的边界情况
- 它为所有非 bug 输入提供了行为不变的强有力保证

**测试计划**：首先在未修复的代码上观察非流式场景和合法更新的行为，然后编写捕获该行为的基于属性的测试。

**测试用例**：

1. **新 Todo 创建保留性**：验证当真正的新 todo 内容到达时，它被正确创建（首先在未修复的代码上测试，然后验证修复保留了这一点）
2. **状态更新保留性**：验证合法的状态更新（没有重复）正常工作（首先在未修复的代码上测试，然后验证修复保留了这一点）
3. **非 Todo 消息保留性**：验证 text、reasoning 和其他消息类型被正确处理（首先在未修复的代码上测试，然后验证修复保留了这一点）
4. **最终显示保留性**：验证最终 Todos 数组显示与预期状态匹配（首先在未修复的代码上测试，然后验证修复保留了这一点）

### 单元测试

- 使用各种输入场景（新 todos、状态更新、重复项）测试 updateTodos 函数
- 使用模拟的 messages 数组变化测试 watch 监听器触发
- 测试 sha256Text 哈希以确保 ID 生成的一致性
- 测试边界情况（空 todos 数组、单个 todo、多个 todos）

### 基于属性的测试

- 生成具有不同重复程度的随机流式序列
- 生成随机的 todo 内容和状态组合
- 验证无论流式模式如何，最终状态都是正确的且不存在重复
- 验证所有合法操作（新创建、状态更新）在许多场景中都能正常工作

### 集成测试

- 使用真实的 AI SDK Chat 实例（或模拟）测试完整的流式流程
- 测试流式传输期间和之后 Todos 数组的 UI 渲染
- 测试流式传输期间的用户交互（例如，折叠/展开任务列表）
- 测试连续的多个流式会话以确保没有状态泄漏
