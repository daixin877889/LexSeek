# 小索子 Agent 分析持久化与上下文复用设计

**版本**: 1.1
**日期**: 2026-04-17
**状态**: 审查通过

---

## 一、概述

### 1.1 背景

小索（xiaosuo）是案件详情页的 AI 助手，复用 `caseMainAgent`（type=1 session），通过子 Agent 工具委派（`createSubAgentTools` → `ask_${name}_expert`）调用各分析模块。当前实现存在两个用户感知的问题：

1. **小索调用模块分析后未将结果保存为新版本**：子 Agent 在 `subAgentToolFactory.ts:189-198` 创建时只挂了 `pointConsumptionMiddleware`，子 Agent 完成后只把最后一条 AIMessage 文本通过 tool result 返回给主 Agent，**完全不写入 `caseAnalyses` 表**。
2. **小索上下文中没有已有分析结果**：`caseMainAgent.ts:147-160` 的中间件链只挂了 `caseMaterialContextMiddleware`（仅注入材料），没有注入"已完成模块分析结果"。当用户让小索"基于案件概要做 PPT"时，即便 `caseAnalyses` 已有 `summary` 模块的 isActive 版本，小索也看不到，只能再次触发子 Agent 重新分析。

### 1.2 设计目标

- 子 Agent 完成后**自动**保存为新版本（含 `version` 自增、`isActive` 切换、旧版本 deactivate）
- 小索对话上下文**包含所有 isActive 模块结果**，让小索能直接利用已有分析回答问题
- 严格遵守 [2026-04-09 上下文工程优化 spec](./2026-04-09-context-engineering-optimization-design.md) 已确立的所有原则：
  - `systemPrompt` 保持纯静态（命中 Prompt Caching）
  - 动态上下文用 `HumanMessage + response_metadata.injectedBy` 注入
  - 历史注入消息保持原样不动
  - hash 检测增量、只追加变更部分
  - token 预算复用 `moduleContextBuilder` 的 30% 框架

### 1.3 设计约束

- **不破坏 Prompt Caching**：`systemPrompt` 不拼接动态内容
- **不重复造轮子**：复用现有 `analysisResultPersistenceMiddleware`、`moduleContextMiddleware`、`loadCompletedResultsService`、`cleanupStaleAnalysesService`
- **YAGNI**：不为假设的未来需求拆分中间件，最小改动
- **互斥规则不变**：`MATERIAL_CONTEXT ⊕ MODULE_CONTEXT`（priority=30 同级互斥），改造后小索仍只挂 1 个 priority=30 的中间件
- **共享版本体系**：小索通过子 Agent 触发的分析，与模块对话手动跑出来的结果**共享同一套 `caseAnalyses` 版本树**（按 `(caseId, nodeId)` 自增 version），用户在版本列表中可统一切换

---

## 二、问题根因

### 2.1 问题 1：未保存为新版本

**根因路径**：`caseMainAgent.runCaseChat` → 子 Agent 工具 `ask_${name}_expert` → `subAgentToolFactory.ts` 内创建 `createAgent` → `agent.invoke()` → 提取最后一条 AIMessage 文本作为 tool result 返回。

**关键代码片段**（`server/services/workflow/agents/subAgentToolFactory.ts:189-198`）：

```typescript
const agent = createAgent({
    model,
    systemPrompt,
    tools: subTools,
    checkpointer,
    store,
    middleware: [
        pointConsumptionMiddleware(context.userId, 'case_analysis_token', context.sessionId),
    ],
})
```

**对比** `moduleAgent.ts:108`，独立的模块对话 Agent 显式注入了 `saveResultTool`（`save_analysis_result`），通过工具调用进入 `saveAndActivateAnalysisService`。子 Agent 链路上**既没有 save 工具，也没有持久化中间件**，所以无法形成新版本。

### 2.2 问题 2：小索看不到已有分析

**根因路径**：`caseMainAgent.ts:147-160` 中间件链。

**关键代码片段**：

```typescript
middleware: [
    pointConsumptionMiddleware(userId, 'case_analysis_token', sessionId),
    caseProcessMaterialMiddleware(userId, caseId),
    caseMaterialContextMiddleware(userId, caseId),  // ← 仅注入材料
    summarizationMiddleware({ ... }),
    safetyTrimMiddleware({ ... }),
    skillsMiddleware,
],
```

**对比** `moduleAgent.ts:139-151` 挂载的 `moduleContextMiddleware(caseId, moduleName)`，后者会同时注入：① 材料 ② 长期记忆 ③ 其他模块结果 ④ 当前模块基线。小索没有等价机制，所以 `caseAnalyses` 表里的内容对它不可见。

---

## 三、改造方案

### 3.1 改造范围

| 类型 | 文件 | 修改 |
|---|---|---|
| 修改 | `server/services/workflow/middleware/moduleContext.middleware.ts` | `moduleName` 参数改可选；`injectedBy` 元数据使用 `moduleName ?? 'global'` |
| 修改 | `server/services/workflow/agents/caseMainAgent.ts` | 把 `caseMaterialContextMiddleware(userId, caseId)` 替换为 `moduleContextMiddleware(caseId)` |
| 修改 | `server/services/workflow/agents/subAgentToolFactory.ts` | 子 Agent 中间件链追加 `analysisResultPersistenceMiddleware({ agentName: config.name, caseId, sessionId })` + 失败路径不阻塞 |

新建文件：**0 个**。

### 3.2 中间件栈变更

**改造后小索 Agent**（`caseMainAgent`）中间件栈（按 priority 逻辑顺序展示）：

```
caseProcessMaterial (10)
  → pointConsumption (20)
  → moduleContext (30)              ← 替换原 caseMaterialContext
  → summarization (40)
  → safetyTrim (50)
  → skills (60)
```

> **物理顺序说明**：`caseMainAgent.ts` 当前不通过 `buildMiddlewareStack` 排序，而是直接传入数组，物理顺序为 `pointConsumption → caseProcessMaterial → caseMaterialContext → summarization → safetyTrim → skills`（即 pointConsumption 排在 caseProcessMaterial 之前）。本次改造**不调整 pointConsumption 与 caseProcessMaterial 的物理顺序，仅替换 caseMaterialContext → moduleContext**，避免引入超出本 spec 范围的回归风险。

**改造后子 Agent**（`subAgentToolFactory` 内部）中间件栈：

```
pointConsumption (20)
  → analysisResultPersistence (90)  ← 新增
```

### 3.3 互斥校验影响

- 现有：`MATERIAL_CONTEXT ⊕ MODULE_CONTEXT`（priority=30 互斥）
- 改造后：小索从 MATERIAL_CONTEXT 切换到 MODULE_CONTEXT，仍只挂 1 个 priority=30 中间件
- `buildMiddlewareStack` 互斥规则**无需改动**

---

## 四、组件改造细节

### 4.1 `moduleContextMiddleware` — 签名扩展

**文件**：`server/services/workflow/middleware/moduleContext.middleware.ts`

**签名变更**：

```typescript
// 改前
export const moduleContextMiddleware = (caseId: number, moduleName: string) => { ... }

// 改后
export const moduleContextMiddleware = (caseId: number, moduleName?: string) => { ... }
```

**4 处具体微调**：

#### ① `injectedBy` 元数据（行 127）

```typescript
// 改前
injectedBy: `ModuleContextMiddleware:${moduleName}`,

// 改后
injectedBy: `ModuleContextMiddleware:${moduleName ?? 'global'}`,
```

> 小索场景下 `moduleName` 缺省，元数据值为 `'ModuleContextMiddleware:global'`。`threadState.ts` 和 `useMessageParser.ts` 用 `startsWith('ModuleContext')` 过滤，仍正确识别。

#### ② section 3「其他模块分析结果」过滤逻辑（行 100）

```typescript
// 改前：必有 moduleName，过滤掉当前模块
const otherResults = Object.entries(completedResults)
    .filter(([key]) => key !== moduleName)

// 改后：moduleName 可缺省时所有模块都纳入
const otherResults = moduleName
    ? Object.entries(completedResults).filter(([key]) => key !== moduleName)
    : Object.entries(completedResults)
```

#### ③ section 4「当前模块基线」（行 110-118）

```typescript
// 改前：直接取 completedResults[moduleName]
const currentModuleResult = completedResults[moduleName]
const currentModuleHash = currentModuleResult ? createHash('md5').update(currentModuleResult).digest('hex') : null
if (currentModuleHash && currentModuleHash !== newCurrentHash) {
    sections.push(`## 当前模块已有分析结果（基线）\n${currentModuleResult}`)
    newCurrentHash = currentModuleHash
}

// 改后：moduleName 缺省时跳过整个 section 4
if (moduleName) {
    const currentModuleResult = completedResults[moduleName]
    const currentModuleHash = currentModuleResult ? createHash('md5').update(currentModuleResult).digest('hex') : null
    if (currentModuleHash && currentModuleHash !== newCurrentHash) {
        sections.push(`## 当前模块已有分析结果（基线）\n${currentModuleResult}`)
        newCurrentHash = currentModuleHash
    }
}
```

#### ④ 日志（行 142-146）

无需改动。`moduleName` 字段在 logger.info 调用中允许 undefined。

### 4.2 `caseMainAgent.ts` — 中间件替换

**文件**：`server/services/workflow/agents/caseMainAgent.ts`

**Diff 预览**：

```typescript
// import 部分
- import {
-     pointConsumptionMiddleware,
-     caseProcessMaterialMiddleware,
-     caseMaterialContextMiddleware,
-     safetyTrimMiddleware,
- } from '../middleware'
+ import {
+     pointConsumptionMiddleware,
+     caseProcessMaterialMiddleware,
+     safetyTrimMiddleware,
+ } from '../middleware'
+ import { moduleContextMiddleware } from '../middleware/moduleContext.middleware'

// createAgent 中的 middleware 数组（行 147-160）
middleware: [
    pointConsumptionMiddleware(userId, 'case_analysis_token', sessionId),
    caseProcessMaterialMiddleware(userId, caseId),
-   caseMaterialContextMiddleware(userId, caseId),
+   moduleContextMiddleware(caseId),  // 不传 moduleName，注入材料 + 记忆 + 所有已完成分析
    summarizationMiddleware({ model, trigger: [{ tokens: triggerTokens }] }),
    safetyTrimMiddleware({ model, maxTokens: Math.floor(contextWindow * 0.8) }),
    skillsMiddleware,
],
```

> `userId` 参数被 `caseMaterialContextMiddleware` 形式上接受但实际未使用（见 `caseMaterialContext.middleware.ts:9` 签名 `userId` 全函数体未引用）。`moduleContextMiddleware` 不需要 `userId`，符合"案件维度全局数据"的语义。

### 4.3 `subAgentToolFactory.ts` — 持久化中间件挂载 + 失败兜底

**文件**：`server/services/workflow/agents/subAgentToolFactory.ts`

**Diff 预览（行 189-198 + 229-233）**：

```typescript
// import 追加
+ import { analysisResultPersistenceMiddleware } from '../middleware'

// createAgent 的 middleware 数组
const agent = createAgent({
    model,
    systemPrompt,
    tools: subTools,
    checkpointer,
    store,
    middleware: [
        pointConsumptionMiddleware(context.userId, 'case_analysis_token', context.sessionId),
+       analysisResultPersistenceMiddleware({
+           agentName: config.name,    // 与 nodes 表的 name 对齐
+           caseId: context.caseId,
+           sessionId: context.sessionId,  // ← 主 sessionId，不是 subThreadId
+       }),
    ],
})
```

> **sessionId 选择说明**：子 Agent 内部使用 `subThreadId = ${context.sessionId}_sub_${safeName}` 作为 LangGraph thread_id（用于 checkpointer 隔离子 Agent 的对话状态），但 `analysisResultPersistenceMiddleware` 的 `sessionId` 参数应**传入主 sessionId**（即 `context.sessionId`）。理由：`caseAnalyses.sessionId` 在数据模型里表示"产生该版本的会话"，按案件维度归属；版本树服务于"用户在哪个对话里跑出来的"这一业务语义，而非"在哪个子 thread 里跑出来的"技术细节。`findAnalysisBySessionAndNodeDao(sessionId, nodeId, IN_PROGRESS)` 复用记录时也按主 sessionId 维度归并。

**失败路径**：现有 `try-catch`（行 229-233）保持不动。`analysisResultPersistenceMiddleware.beforeAgent` 创建的 IN_PROGRESS 记录如果因子 Agent 异常未走完 `afterAgent`，由现有 `cleanupStaleAnalysesService`（2 小时兜底，见 `analysis.service.ts`）清理。该机制 [tech-docs/backend/case.md](../../tech-docs/backend/case.md) 已记录。

> **接受边界**：document 类节点（`SUB_AGENT_NODE_TYPES = ['analysis', 'document']`）也会通过本中间件写入 `caseAnalyses`。当前接受这种"所有子 Agent 输出统一持久化"的简化处理；如未来 document 类节点需要单独的存储语义，再做拆分。

---

## 五、数据流

### 5.1 改造前（当前 bug）

用户问"根据案件概要生成 PPT"：

```
User → SSE → AgentWorker → caseMainAgent
                              ├─ caseMaterialContextMiddleware 注入材料（无已有分析）
                              ├─ LLM 看不到 caseAnalyses 表里的 summary
                              ├─ LLM 调 ask_summary_expert(question='生成案件概要')
                              │     ↓
                              │   subAgent.invoke()
                              │     ├─ pointConsumption（扣分）
                              │     ├─ LLM 重新生成完整概要
                              │     └─ 返回最后 AIMessage（无任何持久化）
                              ↑
                              └─ LLM 拿到概要 → 写 PPT 返回

结果：① 重复一遍已有分析；② 这次结果不入版本树
```

### 5.2 改造后 — 用户已有 isActive summary 时

```
User → SSE → AgentWorker → caseMainAgent
                              ├─ moduleContextMiddleware(caseId) hash 增量
                              │   ├─ 材料：增量注入
                              │   ├─ 长期记忆：hash 变化时注入
                              │   └─ 已完成分析：注入 ## summary 分析结果 + 其他
                              ├─ LLM 看到 ## summary 分析结果
                              └─ LLM 直接基于上下文写 PPT 返回（不调子 Agent）

结果：① 立即响应；② 无重复分析；③ 无新版本污染
```

### 5.3 改造后 — 用户明示"重新分析 summary"

```
User: "请重新分析案件概要"
caseMainAgent → LLM
              ├─ moduleContextMiddleware 已注入旧 summary
              ├─ LLM 判定要重新生成 → 调 ask_summary_expert(...)
              │     ↓
              │   subAgent.invoke()
              │     ├─ pointConsumption
              │     ├─ analysisResultPersistence.beforeAgent
              │     │   ├─ getNodeByNameService('summary') → nodeId
              │     │   ├─ findAnalysisBySessionAndNodeDao → 查 IN_PROGRESS/FAILED 复用
              │     │   └─ 否则 prisma.$transaction:
              │     │       getNextVersionDao(caseId, nodeId) → version=N+1
              │     │       createAnalysisDao { status: IN_PROGRESS, version: N+1, isActive: false }
              │     │       state._analysisRecordId = newRecord.id
              │     ├─ LLM 生成新概要
              │     └─ analysisResultPersistence.afterAgent
              │         └─ prisma.$transaction:
              │             deactivateVersionsDao(caseId, nodeId)  // 旧的 isActive=false
              │             updateAnalysisDao(_analysisRecordId, {
              │                 analysisResult: <last AIMessage text>,
              │                 status: COMPLETED,
              │                 isActive: true,
              │             })
              ↑
              └─ LLM 拿新概要 → 回复用户

结果：① 新版本 N+1 已激活；② 用户在版本列表可切回 N；③ 下一轮对话自动注入 N+1
```

### 5.4 增量上下文逻辑

`moduleContextMiddleware` 通过 hash state 字段检测变更（已有逻辑，无需新增）：

| state 字段 | 检测内容 | 增量行为 |
|---|---|---|
| `_injectedSourceIds` | 材料 sourceId 集合 | 仅新材料注入 |
| `_lastMemoryHash` | 长期记忆 MD5 | 变化才注入 |
| `_injectedResultVersions` | `{ moduleName: contentMD5 }` | 模块内容变化才注入对应模块 |
| `_currentModuleResultHash` | 当前模块 MD5（小索场景始终为 null） | 不触发 |

→ 小索保存了新版本后，下一轮对话自动只注入"## summary 分析结果"的更新版（其它模块 hash 不变，不重复注入）。

---

## 六、错误处理矩阵

| 场景 | 现有保护 | 改造引入的新保护 |
|---|---|---|
| 子 Agent invoke 抛异常 | 现有 try-catch（`subAgentToolFactory:229-233`）返回错误字符串给主 Agent | IN_PROGRESS 记录由 `cleanupStaleAnalysesService`（2h 兜底）清理 |
| LLM 输出空内容 | `analysisResultPersistenceMiddleware:144` 已 logger.warn 并存 `''` | 不变 |
| `getNodeByNameService(config.name)` 找不到节点 | `analysisResultPersistenceMiddleware:73-76` 已 logger.error 并跳过 | 不变 |
| `loadCompletedResultsService` 抛错 | `moduleContext.middleware.ts:55` `.catch((): Record<string, string> => ({}))` | 不变 |
| 同 session 同 module 短时间并发触发 | `findAnalysisBySessionAndNodeDao` 复用 IN_PROGRESS 记录 | 不变（不会建多版本） |
| 用户中途取消 (AbortSignal) | AgentWorker 已传 signal，子 Agent 抛 AbortError | 触发"子 Agent 异常"路径 |
| document 类节点子 Agent | 中间件正常执行，写入 `caseAnalyses` | **接受**：当前不做类型区分，由用户决策 |

---

## 七、测试策略

### 7.1 单元测试

| 文件 | 用例 |
|---|---|
| `tests/server/workflow/middleware/moduleContext.middleware.test.ts` | ① 缺省 moduleName 注入所有已完成模块到 section 3；② 缺省时跳过 section 4；③ 有 moduleName 时行为不变（回归）；④ injectedBy 元数据格式正确 |
| `tests/server/workflow/agents/subAgentToolFactory.test.ts` | ① 子 Agent 完成后写入新 caseAnalyses 版本（version+1, isActive=true, 旧版本 deactivate）；② 子 Agent 异常时 IN_PROGRESS 记录由 cleanup 兜底（不留下"已完成"脏记录）；③ 子 Agent 多次调用复用 IN_PROGRESS（不重复建版本） |
| `tests/server/workflow/agents/caseMainAgent.test.ts` | ① 中间件链含 moduleContextMiddleware 而非 caseMaterialContextMiddleware；② 已完成分析存在时上下文注入正确 |

### 7.2 集成测试（新建）

`tests/server/integration/xiaosuoAnalysisFlow.test.ts`：

- **场景 1**：创建小索 session → 触发 `ask_summary_expert` → 验证 `caseAnalyses` 表新增 isActive 版本，旧版本 isActive=false
- **场景 2**：同 caseId 已有 isActive summary → 小索对话上下文应包含该 summary
- **场景 3**：模块对话保存新版本 → 切换到小索 session → 小索看到新版本（验证 hash 增量更新）
- **场景 4**：子 Agent 异常路径（mock LLM 抛错）→ 验证不会留下 `status=COMPLETED + isActive=false` 的脏数据；IN_PROGRESS 记录由 cleanup 服务兜底

### 7.3 测试约束

- 使用 `npx vitest run`（参见 `.claude/rules/commands.md`）
- 测试节点名称使用 UUID 自动生成，`afterEach` 清理（参见 [LexSeek 项目记忆](../../../../../.claude/projects/-Users-daixin-work-dev-LexSeek-LexSeek/memory/MEMORY.md) 的"测试经验"段）
- 数据库测试在 `ls_new_testing` 库

---

## 八、实施顺序

| 阶段 | 涉及文件 | 依赖 | 可独立验证 |
|---|---|---|---|
| 1 | `moduleContext.middleware.ts` 签名扩展 + 单元测试 | 无 | ✓ 单元测试 |
| 2 | `caseMainAgent.ts` 中间件替换 + 单元测试 | 阶段 1 | ✓ 启动小索看材料/记忆/分析是否注入 |
| 3 | `subAgentToolFactory.ts` 持久化挂载 + 单元测试 | 无 | ✓ 触发子 Agent 验证 caseAnalyses 写入 |
| 4 | 集成测试 | 阶段 1-3 | ✓ E2E 验收两个 bug 修复 |

阶段 1、3 可并行；阶段 2 依赖阶段 1。

---

## 九、风险与回滚

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| 小索上下文 token 上升 | 对话成本增加 | 已有 hash 增量机制 + summarizationMiddleware (40) + safetyTrimMiddleware (50) 兜底压缩；moduleContextBuilder 30% token 预算（[2026-04-09 spec 5.1](./2026-04-09-context-engineering-optimization-design.md)）已限制注入量 |
| 子 Agent 频繁调用导致版本树膨胀 | `caseAnalyses` 行数增加，版本列表 UI 体验下降 | 用户已知悉并接受（"一视同仁"）。问题 2 修复后小索调子 Agent 频率会显著降低。如未来需要可加"自动归档旧版本"清理 |
| moduleContextMiddleware 双重身份让单元测试和命名困惑 | 维护成本上升 | 测试覆盖"有/无 moduleName"两种路径；命名风险接受（YAGNI），未来如有第三种调用方再考虑拆分 section builder |
| document 类节点也写入 caseAnalyses | 可能产生语义不清晰的记录 | 用户已决策接受。如出现实际问题，加 `config.type === 'analysis'` 条件挂载即可（局限在 subAgentToolFactory，不动通用中间件） |

**回滚方式**：本设计的所有改动都是局部的、可独立 revert 的。如需回滚：
- 阶段 1：revert `moduleContext.middleware.ts`，moduleAgent 调用方不受影响
- 阶段 2：revert `caseMainAgent.ts`，回到 `caseMaterialContextMiddleware`
- 阶段 3：revert `subAgentToolFactory.ts`，子 Agent 不再持久化

---

## 十、不在本次改造范围

| 项 | 原因 |
|---|---|
| 调整 `caseMaterialContextMiddleware` 删除 `userId` 死参数 | 影响 V1/V2 init analysis path，超出本 spec 范围 |
| 把 `subAgentToolFactory` 的 `buildBriefContext` 改为也注入已完成分析 | YAGNI，小索层已注入；子 Agent 是"专家工具"语义 |
| `caseMainAgent` 切换到 `buildMiddlewareStack` | 与现有 `caseMainAgent` / `moduleAgent` 风格一致更重要 |
| 修改 `loadCompletedResultsService` 的 token 预算实现 | 已在 [2026-04-09 spec 5.1](./2026-04-09-context-engineering-optimization-design.md) 由 `moduleContextBuilder` 统一管理 |
| 区分 analysis / document 类节点的子 Agent 持久化策略 | 用户已决策当前接受统一持久化 |
| 给小索新增"切换某模块到旧版本"的工具 | 当前 UI 已有版本列表切换；小索读取时通过 `loadCompletedResultsService` 自动看到 isActive 版本，无需额外工具 |

---

## 十一、引用

- [2026-04-09 上下文工程优化 spec](./2026-04-09-context-engineering-optimization-design.md) — 上下文注入原则与中间件优先级
- [2026-04-08 小索对话设计](./2026-04-08-xiaosuo-chat-design.md) — 小索复用 caseMainAgent 的架构基础
- [tech-docs/backend/case.md](../../tech-docs/backend/case.md) — `caseAnalyses` 表与版本生命周期
- [tech-docs/backend/agent.md](../../tech-docs/backend/agent.md) — Agent Worker 与 SSE 事件桥
