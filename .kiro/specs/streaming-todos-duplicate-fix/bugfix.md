# Bugfix Requirements Document

## Introduction

在 `app/pages/dashboard/analysis/[sessionId].vue` 中，使用 AI SDK 的 Chat 实例处理流式消息时，由于 watch 监听器对 messages 数组进行深度监听，导致每次流式输出都会触发 `updateTodos` 函数，造成同一个 todo 内容被重复创建多次。此 bug 影响用户体验，导致任务列表显示混乱。

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN AI SDK Chat 实例接收到流式消息更新 messages 数组 THEN watch 监听器被触发并调用 updateTodos 函数

1.2 WHEN 流式输出过程中 messages 数组多次更新 THEN updateTodos 函数被多次调用，导致相同的 todo 被重复创建

1.3 WHEN 同一个 todo 内容在流式输出的不同阶段被处理 THEN 系统创建多个具有相同内容的 todo 项

### Expected Behavior (Correct)

2.1 WHEN AI SDK Chat 实例接收到流式消息更新 messages 数组 THEN 系统 SHALL 仅在 todo 数据实际变化时调用 updateTodos 函数

2.2 WHEN 流式输出过程中 messages 数组多次更新 THEN 系统 SHALL 通过去重机制确保每个 todo 只被创建一次

2.3 WHEN 同一个 todo 内容在流式输出的不同阶段被处理 THEN 系统 SHALL 更新现有 todo 的状态而不是创建新的 todo 项

### Unchanged Behavior (Regression Prevention)

3.1 WHEN watch 监听器检测到新的 todo 内容（之前不存在的） THEN 系统 SHALL CONTINUE TO 正确创建新的 todo 项

3.2 WHEN todo 的状态从 pending 变为 in_progress 或 completed THEN 系统 SHALL CONTINUE TO 正确更新 todo 的状态

3.3 WHEN messages 数组包含非 write_todos 类型的消息 THEN 系统 SHALL CONTINUE TO 正常处理其他类型的消息而不受影响

3.4 WHEN 流式输出完成后 THEN 系统 SHALL CONTINUE TO 正确显示所有 todo 项的最终状态
