# LexSeek 初始化分析工作流开发报告

## 一、需求概述

为 LexSeek 法律 AI 应用的初始化分析模块实现完整的工作流生命周期管理，包括：
- 多模块串行分析（summary → chronicle → claim → trend → cause → defense → evidence）
- 基于 LangGraph interrupt 机制的积分检查/扣减/购买 UI 交互
- 页面刷新后的状态恢复（消息、模块状态、积分状态）
- 大量消息的高性能渲染

## 二、技术栈

| 层 | 技术 |
|---|------|
| 工作流引擎 | LangGraph StateGraph + interrupt/Command |
| 流式传输 | LangGraph SSE → Worker → Redis → SSE → 前端 |
| 前端 SDK | @langchain/vue useStream + FetchStreamTransport |
| 虚拟滚动 | @tanstack/vue-virtual |
| 自动滚底 | vue-stick-to-bottom (StickToBottom) |
| 状态持久化 | PostgreSQL (Prisma) + LangGraph PostgresSaver checkpoint |

## 三、遇到的坑与解决方式

### 坑 1：interrupt() 被 try-catch 吞掉

**现象**：案件概要模块被跳过，直接执行第二个模块。

**根因**：`interrupt()` 通过抛出 `GraphInterrupt` 异常工作。积分检查代码用 try-catch 包裹了 interrupt()，catch 块捕获了 GraphInterrupt 并返回 `{ pointsChecked: true }`，导致框架看不到中断，节点直接退出。

**解决**：
1. 外层 catch 加 `isGraphInterrupt(error)` 检查，re-throw
2. 积分检查逻辑不用 try-catch 包裹 interrupt()

**规则**：**永远不要在 try-catch 中调用 interrupt()。如果外层有 catch，必须用 isGraphInterrupt 判断并 re-throw。**

### 坑 2：LangGraph values 流不包含 __interrupt__

**现象**：后端正确触发了 interrupt，但前端 `stream.interrupt` 始终为 undefined，购买 UI 不弹出。

**根因**：LangGraph 的 `mapOutputValues` 故意过滤掉 `__interrupt__` 字段。values 流模式不传递 interrupt 数据。interrupt 信息只存在 thread state（checkpoint）中。

**解决**：Worker 在 stream 结束后调用 `workflow.getState()` 读取 checkpoint 中的 interrupt 数据，合并到最后一条 values 事件中重新发布，确保它是最后一个 values 事件（SDK 的 StreamManager 对有 __interrupt__ 的 values 用 merge 语义，对无 __interrupt__ 的用 replace 语义）。

**规则**：**LangGraph values 流模式不传 interrupt 数据。自定义后端需要从 checkpoint 读取并手动注入到 values 事件中。**

### 坑 3：Vue 响应式 bug — stream.interrupt getter

**现象**：SSE 中 `__interrupt__` 数据到达前端，但 `stream.interrupt` computed 不更新。

**根因**：`@langchain/vue` 的 `stream.interrupt` getter 只依赖 `isLoading.value` 建立 Vue 响应式追踪。stream 期间 `isLoading` 不变 → Vue 不重新求值 → interrupt 永远是旧值。

**解决**：不用 `stream.interrupt`，直接从 `values.__interrupt__` 读取：
```typescript
const interrupt = computed(() => {
    const v = values.value
    if (!v?.__interrupt__?.length) return undefined
    return v.__interrupt__.length === 1 ? v.__interrupt__[0] : v.__interrupt__
})
```

**规则**：**@langchain/vue 的 stream.interrupt 在自定义后端场景下不可靠。直接从 stream.values.__interrupt__ 读取。**

### 坑 4：SSE 连接不关闭导致 resume 无法执行

**现象**：购买积分后点击"继续"，没有反应。

**根因**：INTERRUPTED 不在 SSE 端点的 TERMINAL_STATUSES 中 → SSE 连接持续开放 → `FetchStreamTransport` 的 `for await` 未结束 → `stream.submit()` 被排队 → resume 请求无法发出。

**解决**：INTERRUPTED 加入 TERMINAL_STATUSES，SSE 收到 INTERRUPTED 后关闭连接，让客户端能发起新请求。

**规则**：**对 SSE 连接来说，INTERRUPTED 是终结状态。关闭连接让客户端能 submit resume。**

### 坑 5：interrupt + resume 后多次 interrupt 被全部消费

**现象**：用户没购买积分就点"继续"，模块直接失败而不是再次弹出购买 UI。

**根因**：LangGraph 的 interrupt 匹配机制——每次 resume 后节点重新执行，之前的 `interrupt()` 调用按顺序匹配 resume 值（返回值而非抛异常）。如果代码中有多个 interrupt（check + recheck），多次 resume 后所有 interrupt 都被"消费"完毕，代码 fallthrough 到后续逻辑。

**解决**：用 `while (true) { check → break if OK → interrupt() }` 循环替代多个 interrupt 调用。每次 resume 后只有一个 interrupt 被消费，循环重新检查，不足则再次 interrupt。

**规则**：**不要用多个 interrupt() 做"检查-重检查"。用 while 循环 + 单个 interrupt()，resume 后循环继续。**

### 坑 6：积分扣减失败丢弃分析结果

**现象**：模块分析完成后积分扣减失败，结果被丢弃，浪费了 LLM token。

**根因**：代码顺序是"提取结果 → 扣积分 → 持久化"，扣减失败直接 return failedModules，不保存结果。

**解决**：改为"提取结果 → 持久化（COMPLETED + pointDeducted=false）→ 扣积分"。扣减失败 → interrupt 弹购买 UI → resume 后从 DB 读取已保存的结果 → 跳过分析直接扣减。

**规则**：**先持久化结果，再扣积分。扣减和分析状态用独立字段（pointDeducted）追踪，不耦合。**

### 坑 7：刷新后 selectedModules 丢失未开始的模块

**现象**：刷新页面后状态栏只显示已完成的模块，等待分析的模块消失。

**根因**：`loadStatus` 从 DB 恢复 `selectedModules`，但 DB 只记录已开始分析的模块（有 case_analyses 记录的），未开始的模块被过滤掉。

**解决**：`loadStatus` 只作初始 UI 恢复，始终重连 SSE 获取 values 快照。LangGraph checkpoint 中保存了完整的 `selectedModules`，通过 `watch(values)` 恢复。

**规则**：**DB 状态不是权威来源，LangGraph checkpoint 才是。刷新后始终从 SSE 获取完整状态。**

### 坑 8：SSE replay 2000+ 条事件导致页面卡顿

**现象**：刷新页面后需要几十秒才能渲染完成。

**根因**：SSE 重连时 replay 了 run 的所有历史事件（包括每个 token 的 messages 事件），2.5MB 数据、2000+ 条事件逐条触发 StreamManager 状态更新 → Vue 响应式 → DOM 更新。

**解决**：
1. **后端**：replay 时只发最后一条 values 快照（包含完整 state），不逐条发历史事件
2. **前端**：用 @tanstack/vue-virtual 虚拟滚动，只渲染可视区域的消息 DOM

**规则**：**SSE replay 只发 values 快照，不要逐条重放。大量消息用虚拟滚动。**

### 坑 9：case_analyses 唯一约束冲突

**现象**：重新分析时 `Unique constraint failed on (case_id, node_id)`。

**根因**：唯一约束是 `(case_id, node_id) WHERE is_active = true`。上次分析留下的 active 记录未停用，新记录创建时冲突。

**解决**：创建 IN_PROGRESS 记录前先调用 `deactivateVersionsDao(caseId, nodeId)` 停用旧记录。

**规则**：**创建新分析记录前必须先停用同 case+node 的旧 active 记录。**

### 坑 10：coerceRawMessages 不支持 system 消息

**现象**：刷新页面后系统提示词泄露到消息列表中显示给用户。

**根因**：`coerceRawMessages` 没有 `system` 类型分支，system 消息返回 null 被过滤。修复后添加了 SystemMessage 支持但忘记在渲染层过滤。

**解决**：
1. `coerceRawMessages` 添加 `type === 'system'` → `new SystemMessage(inner)` 分支
2. `useMessageParser` 的 filter 中添加 `!(m instanceof SystemMessage)` 过滤

**规则**：**system 消息必须在解析层过滤掉，绝不能渲染到前端。任何新增消息类型都要检查是否应该对用户可见。**

### 坑 11：数据库分析节点配置了积分工具

**现象**：分析过程中出现大量"积分预扣 错误"的工具调用消息。

**根因**：数据库 nodes 表中所有分析节点都配了 `reserve_points`、`confirm_points`、`rollback_points` 工具。LLM 在 ReAct 循环中尝试调用这些工具但配置不匹配，反复失败重试。

**解决**：从数据库中移除分析节点的积分工具。积分检查/消耗完全在工作流节点层面处理，LLM 不应操作积分。

**规则**：**积分操作是基础设施逻辑，不是 LLM 的工具。不要把积分工具配给分析节点。**

### 坑 12：非 resume 请求命中 INTERRUPTED run 导致接口无响应

**现象**：`/api/v1/case/init-analysis` 接口不返回任何数据，前端无响应。

**根因**：`findActiveRunBySessionIdDAO` 将 `INTERRUPTED` 视为"活跃"状态（与 PENDING/RUNNING 并列）。当工作流因积分不足被 interrupt 后，后续的非 resume 新请求进入"重连"分支，直接使用 interrupted run 的 ID 创建 SSE。SSE replay 旧事件后发现最后状态就是 `INTERRUPTED`（终结状态）→ 立即关闭连接 → 客户端收到瞬间关闭的空 SSE 流。

**解决**：在非 resume 模式下，如果发现活跃 run 是 `INTERRUPTED` 状态，先将其标记为 `COMPLETED`，再走正常的"模块完成检查 → 创建新 run"流程：
```typescript
if (activeRun && activeRun.status !== AGENT_RUN_STATUS.INTERRUPTED) {
    // 有活跃 run（pending/running）→ 重连
    runId = activeRun.id
} else {
    // interrupted → 标记完成，走新建逻辑
    if (activeRun?.status === AGENT_RUN_STATUS.INTERRUPTED) {
        await prisma.agentRuns.update({
            where: { id: activeRun.id },
            data: { status: AGENT_RUN_STATUS.COMPLETED, completedAt: new Date() },
        })
    }
    // ... 检查模块完成状态 → 创建新 run
}
```

**规则**：**INTERRUPTED 对 SSE 连接是终结状态（坑 4），但对任务队列不应视为"活跃"。非 resume 请求遇到 INTERRUPTED run 时，必须先关闭旧 run 再创建新 run，否则会陷入死循环。**

### 坑 13：刷新页面后分析中的模块状态消失

**现象**：在第一个模块分析过程中刷新页面，顶部的模块进度条全部显示为 idle，正在分析的模块没有 streaming 状态。

**根因（双层问题）**：

**第一层：`loadStatus()` 不推断 streaming 状态。** status API 将 IN_PROGRESS 映射为 `idle`，`loadStatus()` 直接使用该映射，所有模块均为 idle。

**第二层：LangGraph `values` 流在节点完成前不发事件。** values 流模式只在节点执行完成后才发射状态快照。第一个模块执行期间，Redis 中没有任何 values 事件，SSE replay 为空，`watch(values)` 永远不触发，无法通过 `currentStreaming` 检测来补救。

额外发现：`watch(values)` 的 `streamStarted` 守卫也过于激进——即使后续 values 事件到达（含 `selectedModules` 但无 `result`），也会被拦截。

**解决（两处修复）**：

1. **`loadStatus()` 主动推断 streaming 模块**（关键修复）：分析进行中时，第一个非 complete/非 failed 的模块就是当前正在执行的，直接标记为 `streaming`：
```typescript
if (status.status === 'in_progress') {
    const firstRunning = selectedModules.value.find(name =>
        restored[name]?.status !== 'complete' && restored[name]?.status !== 'failed',
    )
    if (firstRunning) {
        restored[firstRunning] = { name: firstRunning, status: 'streaming', content: '' }
    }
}
```

2. **`watch(values)` 守卫放宽**（辅助修复）：有 checkpoint `selectedModules` 也视为流已建立：
```typescript
if (!streamStarted && !hasResultContent && !hasFailedContent && !mods?.length) { return }
```

**规则**：**LangGraph values 流只在节点完成后才发事件。刷新恢复不能依赖 SSE 来设置 streaming 状态——`loadStatus()` 必须基于 DB 状态自行推断当前正在执行的模块（串行执行下，第一个未完成的就是正在运行的）。**

### 坑 14：SSE 流泄露系统提示词（安全漏洞）

**现象**：浏览器 DevTools 中查看 SSE 流的原始数据，可以看到完整的系统提示词（system message）。

**根因**：LangGraph 工作流中，每个分析节点通过 `innerGraph.invoke({ messages: [systemPrompt, humanMessage] })` 执行 LLM。系统提示词被 MessagesValue reducer 累积到外层工作流状态的 `messages` 字段中。Worker 将 values/messages 事件原样发布到 Redis，SSE 端点原样转发给客户端。虽然前端 `useMessageParser` 在渲染层过滤了 SystemMessage，但 SSE 原始数据中仍包含完整提示词，用户通过 DevTools 或抓包即可获取。

**泄露路径**：
```
工作流 initialMessages 含系统提示
  → MessagesValue reducer 累积到状态
  → values 事件 data.messages 包含系统消息
  → Worker publishAgentEvent 未过滤
  → Redis stream 存储原始数据
  → SSE 端点转发给客户端
  → DevTools 可见完整系统提示词
```

**解决**：在 Worker 发布层（`agentWorker.ts`）统一过滤，添加 `stripSystemMessages` 函数：
- `values` 事件：从 `data.messages` 数组中移除 `type === 'system'` 的消息
- `messages` 事件：过滤掉整条 system 类型消息（返回 null 跳过发布）
- 所有 `publishAgentEvent` 调用前统一调用过滤，确保 Redis 和 SSE 均不含系统消息

**规则**：**系统提示词是敏感数据，必须在数据离开服务器前剥离。前端过滤只是展示层防护，不能替代服务端过滤。任何新增的事件发布路径都必须经过 `stripSystemMessages` 处理。**

## 四、架构决策记录

### 积分生命周期设计

```
每个模块节点：
1. 查 DB（sessionId + nodeId）→ COMPLETED+已扣费则跳过
2. 会员检查 → while 循环 interrupt
3. 积分预检 → while 循环 interrupt
4. 创建 IN_PROGRESS 记录
5. 执行 LLM 分析 → 持久化为 COMPLETED + pointDeducted=false + tokenCount + tokens
6. 扣减积分 → while 循环 interrupt → 成功后 pointDeducted=true
```

### 状态字段分离

case_analyses 表新增 3 个字段，分析状态和扣减状态独立：
- `point_deducted` (boolean) — 积分是否已扣减
- `token_count` (int) — 千 token 数（扣减单位）
- `tokens` (int) — 实际 token 总数

### SSE 数据流

```
LangGraph workflow.stream()
  → Worker 逐条发布到 Redis
  → Worker stream 结束后检查 checkpoint interrupt
  → 有 interrupt → 注入 __interrupt__ 到最后一条 values → 发布 INTERRUPTED 状态
  → SSE 端点从 Redis replay（只发 values 快照）+ 订阅实时事件
  → 前端 useStream SDK 处理 values 事件
```

### Token 计算规则

- 优先使用模型返回的 `usage_metadata.total_tokens`
- 备降：每字符 4 token（中文法律文本场景）
- 消耗项目 key：`case_analysis_token`，单价按数据库 point_consumption_items 配置

## 五、关键文件索引

| 文件 | 职责 |
|------|------|
| `server/services/workflow/caseAnalysisV2.workflow.ts` | 工作流定义 + 分析节点（积分检查/消耗/持久化） |
| `server/services/workflow/caseAnalysisV2.executor.ts` | 工作流执行器 + getWorkflowThreadState |
| `server/services/agent/agentWorker.ts` | Worker：stream 处理、interrupt 检测、__interrupt__ 注入 |
| `server/api/v1/case/init-analysis.post.ts` | SSE 端点：新建/重连/resume/快照 replay |
| `app/composables/useInitAnalysis.ts` | 前端状态管理：phase、moduleStates、interrupt、loadStatus |
| `app/components/ai/AiMessageList.vue` | 消息列表（虚拟滚动适配层） |
| `app/components/ai/AiMessageListVirtual.vue` | 虚拟滚动实现（@tanstack/vue-virtual + StickToBottom） |
| `app/components/ai/composables/useMessageParser.ts` | 消息解析（coerceRawMessages + system 过滤） |
| `server/services/case/analysis.dao.ts` | 分析记录 DAO（新增 pointDeducted/tokenCount/tokens 字段） |
| `server/services/case/initAnalysis.service.ts` | 状态查询服务（hasPendingInterrupt） |
| `shared/types/agentRun.ts` | INTERRUPTED 状态定义 |
