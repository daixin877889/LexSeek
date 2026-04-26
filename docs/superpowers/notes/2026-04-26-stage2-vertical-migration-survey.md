# 阶段 2 Vertical 搬迁前置调研报告

> 本文档供 T13-T17 vertical 搬迁时直接参考，避免重复翻源码。
> 调研时间：2026-04-26。源文件：`server/services/workflow/agents/`。

---

## 总体对比速览

| 维度 | caseMain | module | assistant | document | contract |
|------|----------|--------|-----------|----------|---------|
| nodeName | `caseMain` | 动态（moduleName） | `assistantMain` | `documentMain` | `contractReviewMain` |
| 代理类型 | createAgent | createAgent | createAgent | createAgent + responseFormat | createAgent（resume 绕过） |
| 计费键 | `case_analysis_token` | `case_analysis_token` | `assistant_token` | `document_draft_token` | `contract_review_token` |
| skillsMiddleware | 有（模块级单例） | 有（模块级单例） | 无 | 无 | 无 |
| 业务私有中间件 | caseProcessMaterial | 无 | 无 | draftResultPersistence | reviewResultPersistence |
| 使用 buildMiddlewareStack | 否 | 否 | 否 | 否 | **是** |
| subAgent 工具 | 有（analysis/document） | 无 | 无 | 无 | 无 |
| 业务私有工具（非节点） | skill 系列×5 | saveAnalysisResult + skill 系列×5 | 无 | 无 | 无 |
| resume 特殊路径 | 标准 Command | 标准 Command | 标准 Command | 标准 Command | **完全绕过 agent.stream** |
| 入参有 message | 有 | 有 | 有 | 有 | **无**（内部构造） |

---

## 1. case-main（小索）

**源文件：** `server/services/workflow/agents/caseMainAgent.ts`

**对应 vertical：** `server/agents/case-main/`（T13）

### nodeName

```
caseMain
```

### 中间件清单

| 顺序 | 中间件 | 归属 | 迁移目标 |
|------|--------|------|---------|
| 1 | `createMessageIntegrityMiddleware()` | 平台通用 | agent-platform/middleware |
| 2 | `createScopeGuardMiddleware()` | 平台通用 | agent-platform/middleware |
| 3 | `pointConsumptionMiddleware(userId, 'case_analysis_token', sessionId)` | 平台通用 | agent-platform/middleware |
| 4 | `caseProcessMaterialMiddleware(userId, caseId)` | **业务私有** | case-main/middleware/ |
| 5 | `summarizationMiddleware({ model, trigger: [{ tokens: triggerTokens }] })` | 平台通用（langchain 内置） | 工厂内置 |
| 6 | `safetyTrimMiddleware({ model, maxTokens, systemPrompt, maxOutputTokens })` | 平台通用 | agent-platform/middleware |
| 7 | `skillsMiddleware`（模块级单例） | 平台通用 | 工厂内置（T8 buildSkillsMiddlewareForNode） |
| 8 | `createAuditMiddleware()` | 平台通用 | agent-platform/middleware |

**注意：** 当前未使用 `buildMiddlewareStack`，中间件直接数组传入（无 priority 保障）。T13 改造时需要补上。

### customTools 清单（节点配置之外的额外注入）

| 工具 | 来源 | 说明 |
|------|------|------|
| subAgent 工具 | `createSubAgentTools(subAgentConfigs, toolContext)` | 节点类型 `['analysis', 'document']` |
| `read_skill_file` | `createReadSkillFileTool(toolContext)` | Skill 管理 |
| `write_skill_file` | `createWriteSkillFileTool(toolContext)` | Skill 管理 |
| `run_skill_script` | `createRunSkillScriptTool(toolContext)` | Skill 管理 |
| `run_skill_command` | `createRunSkillCommandTool(toolContext)` | Skill 管理 |
| `upload_workspace_file` | `createUploadWorkspaceFileTool(toolContext)` | 工作区上传 |

工具按 name 去重，后注入的 skillTools 胜出（防止 DB tools 与 skill 工具同名导致 LangChain 报错）。

### hooks / 副作用

- **无显式 beforeRun/afterRun hook**
- 启动前并发加载：`checkpointer + store + mainConfig + subAgentConfigs`
- 系统提示词在 `renderSystemPrompt` 基础上追加两段"铁律"：
  - 工具选择规则（区分 write_case_memory vs write_skill_file）
  - 综合题应对规则（三层信息源引用）
- 暴露 `getChatThreadState(sessionId)` 用于 interrupt 检测

### 特殊路径

- 支持标准 Command 中断恢复
- `callbacks` 字段透传给 `agent.stream`（eval/监控用途）

### 入参签名

```typescript
runCaseChat(
    sessionId: string,
    message: string | undefined,
    options: CaseAgentOptions & { command?: unknown },
): Promise<ReadableStream<Uint8Array>>

interface CaseAgentOptions {
    userId: number
    caseId: number
    runId: string
    thinking?: boolean
    signal?: AbortSignal
    callbacks?: BaseCallbackHandler[]
}
```

### T13 vertical 改造要点

1. `caseProcessMaterialMiddleware` 搬到 `case-main/middleware/`
2. 补充 `buildMiddlewareStack` 使用（当前无 priority 保障）
3. skillsMiddleware 改为工厂统一处理（不再是模块级单例）
4. subAgent 工具通过 `customTools` 回调传入
5. 系统提示词"铁律"追加逻辑需在 `DomainAgentDefinition` 中表达（可通过 nodeName + renderSystemPrompt 扩展）

---

## 2. case-module（模块对话）

**源文件：** `server/services/workflow/agents/moduleAgent.ts`

**对应 vertical：** `server/agents/case-module/`（T14）

### nodeName

**动态**：运行时通过 `options.moduleName` 传入，即 `getValidNodeConfig(moduleName, ...)`。
这是模块对话与其他 agent 最大的区别——没有固定 nodeName，而是按模块（如 `caseAnalysisSummary`、`caseTimeline` 等）动态加载节点配置。

### 中间件清单

| 顺序 | 中间件 | 归属 | 迁移目标 |
|------|--------|------|---------|
| 1 | `createMessageIntegrityMiddleware()` | 平台通用 | agent-platform/middleware |
| 2 | `createScopeGuardMiddleware()` | 平台通用 | agent-platform/middleware |
| 3 | `pointConsumptionMiddleware(userId, 'case_analysis_token', sessionId)` | 平台通用 | agent-platform/middleware |
| 4 | `summarizationMiddleware(...)` | 平台通用 | 工厂内置 |
| 5 | `safetyTrimMiddleware(...)` | 平台通用 | agent-platform/middleware |
| 6 | `skillsMiddleware`（模块级单例） | 平台通用 | 工厂内置（T8） |
| 7 | `createAuditMiddleware()` | 平台通用 | agent-platform/middleware |

**注意：**
- **无业务私有中间件**（caseMaterialContext、moduleContext 均不挂载）
- 上下文通过 `buildSystemPromptForAgent` 注入 system prompt，而非中间件注入
- 当前未使用 `buildMiddlewareStack`

### customTools 清单

| 工具 | 来源 | 说明 |
|------|------|------|
| `save_analysis_result` | `createSaveAnalysisResultTool(toolContext)` | **业务私有工具**，保存模块分析结果 |
| `read_skill_file` | `createReadSkillFileTool(toolContext)` | Skill 管理 |
| `write_skill_file` | `createWriteSkillFileTool(toolContext)` | Skill 管理 |
| `run_skill_script` | `createRunSkillScriptTool(toolContext)` | Skill 管理 |
| `run_skill_command` | `createRunSkillCommandTool(toolContext)` | Skill 管理 |
| `upload_workspace_file` | `createUploadWorkspaceFileTool(toolContext)` | 工作区上传 |

### hooks / 副作用

- toolContext 携带额外字段：
  - `moduleName`、`nodeId`
  - `getState: async () => getSessionState(sessionId)`（状态读取回调）
  - `model`（模型实例，供工具内部调用）
- 系统提示词追加 `save_analysis_result` 使用提示

### 特殊路径

- 支持三种输入模式：
  - `command` 存在 → `new Command({ resume: command })`
  - `message` 存在 → `{ messages: [new HumanMessage(message)] }`
  - 两者均无（重连）→ `{ messages: [] }`

### 入参签名

```typescript
runModuleChat(
    sessionId: string,
    message: string | undefined,
    options: ModuleAgentOptions,
): Promise<ReadableStream<Uint8Array>>

interface ModuleAgentOptions {
    userId: number
    caseId: number
    moduleName: string    // 动态节点名（关键）
    nodeId: number
    command?: unknown
    runId?: string
    thinking?: boolean
    signal?: AbortSignal
}
```

### T14 vertical 改造要点

1. nodeName 动态，`defineDomainAgent` 的 `nodeName` 字段需要在运行时通过 `ctx.metadata.moduleName` 解析（或走工厂特殊路径）
2. `saveAnalysisResult` 通过 `customTools` 回调传入
3. toolContext 的 `getState` 和 `model` 字段需在工厂的 AgentRunnerContext 中体现或通过 customTools 闭包捕获
4. 补充 `buildMiddlewareStack` 使用

---

## 3. legal-assistant（法律助手）

**源文件：** `server/services/workflow/agents/assistantAgent.ts`

**对应 vertical：** `server/agents/legal-assistant/`（T15）

### nodeName

```
assistantMain
```

### 中间件清单

| 顺序 | 中间件 | 归属 | 迁移目标 |
|------|--------|------|---------|
| 1 | `createMessageIntegrityMiddleware()` | 平台通用 | agent-platform/middleware |
| 2 | `createScopeGuardMiddleware()` | 平台通用 | agent-platform/middleware |
| 3 | `pointConsumptionMiddleware(userId, 'assistant_token', sessionId)` | 平台通用（计费键独立） | agent-platform/middleware |
| 4 | `summarizationMiddleware(...)` | 平台通用 | 工厂内置 |
| 5 | `safetyTrimMiddleware(...)` | 平台通用 | agent-platform/middleware |
| 6 | `createAuditMiddleware()` | 平台通用 | agent-platform/middleware |

**注意：**
- **最精简的中间件栈**：无 skillsMiddleware、无业务私有中间件
- 计费键 `assistant_token` 与 case 域独立

### customTools 清单

- 仅 `mainConfig.tools`（节点配置工具）
- **无任何额外注入工具**
- toolContext 为 `{ userId, sessionId }`（无 caseId、无 runId）

### hooks / 副作用

- 无额外启动前处理
- 暴露 `getAssistantThreadState(sessionId)` 用于 interrupt 检测
- `buildSystemPromptForAgent` 传 `caseId: null`（system prompt 退化为单段 roleAndFlow）

### 特殊路径

- 无 case 上下文，最通用的 agent
- 无 skillsMiddleware（法律助手场景不启用 skills）

### 入参签名

```typescript
runAssistantChat(
    sessionId: string,
    message: string | undefined,
    options: AssistantAgentOptions,
): Promise<ReadableStream<Uint8Array>>

interface AssistantAgentOptions {
    userId: number
    thinking?: boolean
    signal?: AbortSignal
    command?: unknown
}
```

### T15 vertical 改造要点

1. 结构最简单，直接用 `defineDomainAgent` 包装即可
2. 计费键通过工厂参数表达（`assistant_token`）
3. `customTools` 为空（undefined）
4. `customMiddlewares` 为空（undefined）

---

## 4. document（文书生成）

**源文件：** `server/services/workflow/agents/documentMainAgent.ts`

**对应 vertical：** `server/agents/document/`（T16）

### nodeName

```
documentMain
```

### 中间件清单

| 顺序 | 中间件 | 归属 | 迁移目标 |
|------|--------|------|---------|
| 1 | `createMessageIntegrityMiddleware()` | 平台通用 | agent-platform/middleware |
| 2 | `createScopeGuardMiddleware()` | 平台通用 | agent-platform/middleware |
| 3 | `pointConsumptionMiddleware(userId, 'document_draft_token', sessionId)` | 平台通用（计费键独立） | agent-platform/middleware |
| 4 | `summarizationMiddleware(...)` | 平台通用 | 工厂内置 |
| 5 | `safetyTrimMiddleware(...)` | 平台通用 | agent-platform/middleware |
| 6 | `draftResultPersistenceMiddleware({ draftId, sessionId })` | **业务私有** | document/middleware/ |
| 7 | `createAuditMiddleware()` | 平台通用 | agent-platform/middleware |

**注意：**
- `draftResultPersistenceMiddleware` 必须在 audit 之前、排在工具调用结果都可见后执行
- 当前未使用 `buildMiddlewareStack`（plan T16 已注明这是修复点之一）

### customTools 清单

- 仅 `nodeConfig.tools`（节点配置工具）
- **无额外注入工具**
- toolContext 扩展字段：`draftId: draft.id`

### hooks / 副作用（最多启动前预处理）

- 并发加载：`checkpointer + store + getValidNodeConfig + findDraftBySessionIdDAO`
- 串行加载：`getDocumentTemplateDAO(draft.templateId)`
- 动态构造 `responseFormat = toolStrategy(buildDraftSchema(template.placeholders))`（**特有**）
- `buildInitialPromptFromDraft(draft, templateName)` — 无用户消息时自动构造首轮指令：
  - 若 `sourceRef.fileIds` 非空：指示模型先 `process_materials` 再 `search_case_materials`
  - 若有 `draft.caseId`：指示模型先 `search_case_materials`
  - 否则：先查草稿域材料，再向用户索要
- 暴露 `getDocumentThreadState(sessionId)` 用于 interrupt 检测

### 特殊路径

- **唯一使用 `responseFormat = toolStrategy(schema)` 的 agent**（强制结构化输出）
- `message === undefined` 是正常首轮场景（前端 submit 不带 message），自动构造启动指令
- draft.caseId 优先于 options.caseId（`resolvedCaseId = draft.caseId ?? caseId`）

### 入参签名

```typescript
runDocumentChat(
    sessionId: string,
    message: string | undefined,
    options: DocumentAgentOptions,
): Promise<ReadableStream<Uint8Array>>

interface DocumentAgentOptions {
    userId: number
    caseId?: number        // 可选，来自案件入口；draft.caseId 优先
    signal?: AbortSignal
    command?: unknown
}
```

### T16 vertical 改造要点

1. `draftResultPersistenceMiddleware` 搬到 `document/middleware/`
2. 启动前预处理（反查 draft + template、构造 responseFormat）需在 `hooks.beforeRun` 或工厂的 pre-run 阶段处理
3. `responseFormat` 字段需在 `DomainAgentDefinition` 中扩展（当前类型定义未包含）或通过 `stateGraph` 路径绕过
4. 补充 `buildMiddlewareStack` 使用
5. document service/dao/tools 大量文件需从 `server/services/assistant/document/` 搬迁

---

## 5. contract（合同审查）

**源文件：** `server/services/workflow/agents/contractReviewMainAgent.ts`

**对应 vertical：** `server/agents/contract/`（T17，最大）

### nodeName

```
contractReviewMain
```

### 中间件清单（唯一使用 buildMiddlewareStack）

| priority | 中间件 | 归属 | 迁移目标 |
|----------|--------|------|---------|
| 1 | `createMessageIntegrityMiddleware()` | 平台通用 | agent-platform/middleware |
| 5 | `createScopeGuardMiddleware()` | 平台通用 | agent-platform/middleware |
| 20 | `pointConsumptionMiddleware(userId, 'contract_review_token', sessionId)` | 平台通用 | agent-platform/middleware |
| 40 | `summarizationMiddleware(...)` | 平台通用 | 工厂内置 |
| 50 | `safetyTrimMiddleware(...)` | 平台通用 | agent-platform/middleware |
| 90 | `reviewResultPersistenceMiddleware({ reviewId, sessionId, runId })` | **业务私有** | contract/middleware/ |
| 100 | `createAuditMiddleware()` | 平台通用 | agent-platform/middleware |

**注意：** 这是 **5 个 agent 中唯一已正确使用 `buildMiddlewareStack`** 的实现，可作为其他 4 个 vertical 改造的参考。

### customTools 清单

- `nodeConfig.tools` 加载（主要是 `parseAndAskStance` 工具）
- **无额外注入工具**
- toolContext 扩展字段：`runId, reviewId: review.id`
- 温度设为 `0`（审查场景追求稳定性，区别于其他 agent 的 0.7）

### hooks / 副作用（最复杂）

**Phase A（agent 启动前同步执行，首轮和 resume 均走）：**
1. `emitContractReviewEvent(stage:segment, running)`
2. `loadContractFullText(review.originalFileId)` — 加载合同全文（获取 `paragraphs`）
3. `segmentClauses(fullText)` — 切分条款（获取 `segments` + `normalizedText`）
4. `emitContractReviewEvent(stage:segment, done, totalClauses)`
5. 失败时降级：`warnings: ['segment_failed']`，`segments = []`

### 特殊路径（最复杂，resume 完全绕过 agent.stream）

#### 首轮流程
```
runContractReviewChat → Phase A 切分 → agent.stream → parseAndAskStance 工具调用
→ emitContractReviewEvent(detect:running + done + stance:running) → interrupt 挂起
```

#### resume 流程（完全绕过 agent.stream）
```
runContractReviewChat → Phase A 切分（重新执行！）
→ 返回 new ReadableStream({ async start(controller) {
    1. 解析 command payload 取 stance/partyA/partyB
    2. updateContractReviewDAO(stance, status:'reviewing')
    3. 补发 detect:running + detect:done + stance:running + stance:done
    4. listEnabledPlaybookPointsDAO → playbookSnapshot
    5. segments 为空守卫（置 failed，补发 analyze:done + summarize running/done）
    6. runAnalyzeLoop(segments, stance, ...) → risks + warnings
    7. updateContractReviewDAO(risks)
    8. emitContractReviewEvent(summarize:running)
    9. summarizeOverview(risks) → overview
    10. updateContractReviewDAO(summary)
    11. emitContractReviewEvent(overview + summarize:done)
    12. persistRisksAndCreateV1Snapshot(risks + v1 快照)
    13. runAnnotateAndUpload → 批注 + OSS + status:completed
    controller.close()
}})
```

**关键：** resume 路径中 Phase A（条款切分）会重新执行，`segments` 在函数作用域内被 resume 闭包捕获复用。

### 入参签名

```typescript
runContractReviewChat(
    sessionId: string,
    options: ContractReviewAgentOptions,   // 注意：无 message 参数！
): Promise<ReadableStream<Uint8Array>>

interface ContractReviewAgentOptions {
    userId: number
    runId?: string
    signal?: AbortSignal
    command?: unknown
}
```

### T17 vertical 改造要点

1. `reviewResultPersistenceMiddleware` + `runAnnotateAndUpload` 搬到 `contract/middleware/`
2. **resume 路径不搬到工厂**：plan 明确"合同审查 resume 路径重写留给阶段 4，T17 仅框架接入"
   - 建议：T17 时 `agentType: 'stateGraph'`，`runStateGraph` 内部保留现有完整逻辑（含 Phase A + resume 分支），避免拆解风险
3. 大量文件搬迁：`contract/contractReview.dao + contractPlaybook.dao + docx/ + analyzeSingleClause + summarizeOverview + contractRisk.service + contractAnnotation.dao + contractReviewVersion.service + contractRiskRender + utils/clauseToParagraph`
4. `parseAndAskStance.tool.ts` 从 `workflow/tools/` 搬到 `contract/tools/`
5. 这是所有 vertical 中工程量最大、风险最高的一个

---

## 跨 vertical 共性问题

### 1. skillsMiddleware 单例 → 工厂动态构造

caseMain 和 module 当前使用**模块级单例**：
```typescript
const skillsMiddleware = createSkillsMiddleware({
    backend: new FilesystemBackend({ rootDir: process.cwd() }),
    sources: ['.deepagents/skills/'],   // 硬编码路径
})
```

T11 工厂改造后改为 `buildSkillsMiddlewareForNode(nodeId)`（T8 已实现），按节点关联的 skills 动态构造，不再硬编码路径。

### 2. buildMiddlewareStack 缺失

除 contract 外，其他 4 个 agent 均未使用 `buildMiddlewareStack`，中间件顺序依赖手动排列。T13-T16 改造时需要补充（contract 已是正确范本）。

### 3. temperature 差异

| agent | temperature |
|-------|-------------|
| caseMain | 0.7 |
| module | 0.7 |
| assistant | 0.7 |
| document | 0.7 |
| contract | **0**（审查稳定性） |

合同审查在 `DomainAgentDefinition` 或工厂中需要支持 temperature 覆盖。

### 4. toolContext 字段差异

各 agent 向工具传递的 context 字段不同：

| agent | 额外字段 |
|-------|---------|
| caseMain | `runId`、`caseId` |
| module | `moduleName`、`nodeId`、`getState`、`model`（特殊！） |
| assistant | 无（仅 userId + sessionId） |
| document | `draftId`、`caseId`（可选） |
| contract | `runId`、`reviewId` |

`AgentRunnerContext` 当前定义中 `caseId` 和 `runId` 均已包含，但 `moduleName`、`nodeId`、`draftId`、`reviewId` 等业务私有字段需通过 `metadata` 透传或 vertical 在 `customTools` 闭包里自行从 DB 反查。

### 5. 系统提示词构造复杂度

所有 agent 都走 `renderSystemPrompt + buildSystemPromptForAgent` 双层构造，但附加内容不同：
- caseMain：追加"工具选择规则"和"综合题应对"两段铁律（业务逻辑，需在 vertical 中保留）
- module：追加 `save_analysis_result` 使用提示
- contract：通过 `buildInitialPrompt(reviewId)` 构造固定首轮指令（内部构造，无需用户 message）

---

## 调研结论 & T13-T17 实施建议

1. **T13（case-main）**：难度中，主要工作是 caseProcessMaterial 迁移 + subAgent customTools 接入 + 补 buildMiddlewareStack + 系统提示词铁律保留
2. **T14（case-module）**：难点在 nodeName 动态性，需在工厂层支持运行时动态 nodeName（通过 `ctx.metadata.moduleName`）
3. **T15（legal-assistant）**：最简单，直接 defineDomainAgent 包装，无业务私有中间件和工具
4. **T16（document）**：难点在 responseFormat 动态构造 + 大量 service/dao 文件搬迁
5. **T17（contract）**：最复杂，建议用 `agentType: 'stateGraph'`，把现有全部逻辑包在 `runStateGraph` 里，T17 只做框架接入，不拆解 resume 路径（留阶段 4）
