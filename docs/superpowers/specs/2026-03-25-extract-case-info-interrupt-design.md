# 案件信息提取与中断确认 — 全局设计

> 日期：2026-03-25
> 状态：待评审
> 范围：案件信息结构化提取、存储、分析消费 + 中断确认流程

## 1. 背景与目标

### 1.1 现状问题

1. `extract_case_info` 工具返回提取指南（非实际数据），前端表单无数据回显
2. `cases` 表只有 `title`、`plaintiff`(JSON)、`defendant`(JSON)、`caseTypeId` — 无法存储动态字段
3. 不同案件类型可提取的信息差异大（合同纠纷有合同金额/签约日期，侵权有伤害类型等）
4. 无中断机制：工具执行后 Agent 直接继续，不等待用户确认
5. 长期记忆（CompositeBackend + PostgresStore）设计了但未实现，提取结果无法跨会话复用

### 1.2 设计目标

- 通用结构化提取：一个提取节点，固定字段用 schema 约束，动态字段由 LLM 根据材料和案件类型自动提取
- 三层存储：固定字段同步到 `cases` 表 → JSONB 存全量 → 长期记忆双写
- 分析可消费：通过 prompt 注入 + 长期记忆语义检索，让所有子代理都能访问提取的信息
- 中断确认：工具返回后自动中断，用户确认/编辑后恢复

## 2. 数据模型

### 2.1 cases 表变更

新增 `extractedInfo` JSONB 字段和 `summary` 文本字段：

```prisma
model cases {
  // 现有固定字段（保留，用于列表查询和筛选）
  title       String?   @db.VarChar(500)
  plaintiff   Json?     // ["张三", "张三公司"]
  defendant   Json?     // ["李四"]
  caseTypeId  Int?

  // 新增
  summary       String?  @db.Text          // 案件概述（从提取结果同步）
  extractedInfo Json?    @db.JsonB         // 全量提取结果（固定+动态字段）
}
```

`extractedInfo` 示例：

```json
{
  // 固定字段（同步到 cases 表对应列）
  "title": "张三与李四买卖合同纠纷",
  "plaintiff": ["张三"],
  "defendant": ["李四"],
  "caseType": "民事",           // 必须匹配 case_types 表中的值
  "summary": "原告张三于2021年5月向被告李四购买车辆...",

  // 扩展字段（LLM 根据材料和案件类型自动提取，数组对象形式）
  "extraFields": [
    { "name": "caseNumber", "title": "案号", "value": "(2022)京0105民初1234号" },
    { "name": "court", "title": "受理法院", "value": "北京市朝阳区人民法院" },
    { "name": "causeOfAction", "title": "案由", "value": "买卖合同纠纷" },
    { "name": "amount", "title": "涉案金额", "value": "680000元" },
    { "name": "contractDate", "title": "合同签订日期", "value": "2021-05-15" },
    { "name": "deliveryDeadline", "title": "交付期限", "value": "2021-06-30" },
    { "name": "disputeFocus", "title": "争议焦点", "value": "车辆交付延迟与质量问题" }
  ]
}
```

### 2.2 nodes 表变更

新增 `outputSchema` 可空 JSON 字段：

```prisma
model nodes {
  // 现有字段...
  outputSchema  Json?    @db.JsonB   // 结构化输出 schema（JSON Schema 格式）
}
```

### 2.3 提取节点配置

`extractInfo` 节点（`type = 'extraction'`）：

```json
{
  "name": "extractInfo",
  "type": "extraction",
  "modelId": "deepseek-1",
  "outputSchema": {
    "type": "object",
    "properties": {
      "title": { "type": "string", "description": "案件名称（如：张三与李四买卖合同纠纷）" },
      "plaintiff": { "type": "array", "items": { "type": "string" }, "description": "原告列表" },
      "defendant": { "type": "array", "items": { "type": "string" }, "description": "被告列表" },
      "caseType": { "type": "string", "description": "案件类型，必须从 case_types 表的可选值中选取" },
      "summary": { "type": "string", "description": "案件简要概述（200字以内）" },
      "extraFields": {
        "type": "array",
        "description": "根据案件材料内容提取的其他有价值的信息，每项包含英文标识、中文名称和值",
        "items": {
          "type": "object",
          "properties": {
            "name": { "type": "string", "description": "英文标识（camelCase）" },
            "title": { "type": "string", "description": "中文名称" },
            "value": { "type": "string", "description": "提取的值" }
          },
          "required": ["name", "title", "value"]
        }
      }
    },
    "required": ["title", "plaintiff", "defendant", "caseType", "summary", "extraFields"]
  }
}
```

关键：`extraFields` 数组让 LLM 自由添加案件类型相关的扩展字段，每项包含 `name`（英文标识）、`title`（中文名称）、`value`（提取值）。System prompt 引导 LLM 根据案件类型提取相关信息。

### 2.4 caseType 值约束

`caseType` 字段**必须**取 `case_types` 表中的值，不允许 LLM 自由生成。

实现方式：
1. **Prompt 注入**：提取节点启动时查询 `case_types` 表所有启用的类型名称，注入 system prompt 作为可选值列表
2. **存储前验证**：确认后存储时，校验 `caseType` 是否匹配 `case_types` 表中的 `name`，匹配成功则同步 `caseTypeId`，匹配失败打日志告警并**保留原有 `caseTypeId` 不变**（因为 `caseTypeId` 是必填字段，不可为 null）

```typescript
// 提取节点 prompt 注入示例
const caseTypes = await prisma.caseTypes.findMany({
  where: { status: 1, deletedAt: null },
  select: { name: true },
})
const caseTypeNames = caseTypes.map(t => t.name).join('、')
// prompt 变量：caseTypeOptions = "民事、刑事、行政、..."
```

## 3. 提取与存储流程

### 3.1 提取节点 = Agent 节点（两阶段执行）

**核心原则**：提取节点与普通分析节点的执行逻辑完全一致——都是带工具的 Agent 节点。提取节点**自主查询**案件材料（通过工具），而非被动接收主代理传递的内容。这确保提取节点能获取最准确、最完整的原始信息。

**关键约束**：LangChain 的 `withStructuredOutput` 返回 `Runnable` 而非 `BaseChatModel`，不支持再调用 `bindTools`。因此提取节点采用**两阶段执行**：

1. **信息收集阶段**：普通 Agent 循环（`model.bindTools(tools)`），自主调用工具查询案件材料
2. **结构化提取阶段**：收集完成后，用 `model.withStructuredOutput(zodSchema)` 对收集到的材料做一次结构化提取

#### 执行流程

```
提取节点启动
  ↓
① 加载节点配置（nodes 表：prompt、tools、modelId、outputSchema）
② 查询 case_types 表可选值，注入 prompt 变量 {{caseTypeOptions}}
  ↓ 阶段一：信息收集（普通 Agent 循环）
③ 创建 Agent（chatModelFactory + bindTools）
④ Agent 自主调用工具（如 search_case_materials）获取案件材料
⑤ 收集到的材料内容聚合为文本
  ↓ 阶段二：结构化提取
⑥ 用 withStructuredOutput(zodSchema) 对聚合材料做一次结构化提取
⑦ interrupt() 暂停，等待用户确认
⑧ 用户确认/编辑后恢复，执行三层存储
```

#### 关键实现

```typescript
// extractInfo 节点（两阶段执行）
export async function extractInfoNode(state: CaseAnalysisState) {
  const nodeConfig = await getNodeConfigService('extractInfo')

  // 1. 查询 case_types 可选值
  const caseTypes = await prisma.caseTypes.findMany({
    where: { status: 1, deletedAt: null },
    select: { id: true, name: true },
  })
  const caseTypeOptions = caseTypes.map(t => t.name).join('、')

  // 2. 加载工具（从节点配置动态读取，与普通节点一致）
  const tools = getToolInstancesService(nodeConfig.tools, {
    userId: state.userId,
    caseId: state.caseId,
    sessionId: state.sessionId,
  })

  // 3. 渲染 prompt（注入 caseTypeOptions 等变量）
  const systemPrompt = renderPrompt(nodeConfig.prompts, { caseTypeOptions })

  // === 阶段一：信息收集（普通 Agent 循环） ===
  const model = chatModelFactory(nodeConfig)
  const modelWithTools = model.bindTools(tools)
  const collectedContent = await runAgentLoop(modelWithTools, systemPrompt, tools)
  // collectedContent: Agent 调用工具后聚合的案件材料文本

  // === 阶段二：结构化提取 ===
  const zodSchema = jsonSchemaToZod(nodeConfig.outputSchema)
  const structuredModel = chatModelFactory(nodeConfig).withStructuredOutput(zodSchema)
  const extracted = await structuredModel.invoke([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: collectedContent },
  ])

  // 4. 中断等待用户确认
  const userInput = interrupt({
    type: InterruptType.BASIC_INFO_CONFIRM,
    data: extracted,
  })

  // 5. 处理确认结果并执行三层存储
  const confirmedData = parseUserConfirmation(userInput, extracted)
  await saveCaseInfoService(state.caseId, confirmedData, caseTypes)

  return { extractedInfo: confirmedData }
}
```

> **`runAgentLoop`**：Agent 工具调用循环的抽象——Agent 决定调用哪些工具、调用几次，直到收集足够信息。具体实现复用项目现有的 Agent 执行机制（参考 `main.ts` 中 `createDeepAgent` 的工具调用流程）。

#### saveCaseInfoService 实现

```typescript
async function saveCaseInfoService(
  caseId: number,
  confirmedData: ExtractedInfo,
  caseTypes: Array<{ id: number; name: string }>,
) {
  // 1. caseType 匹配 → caseTypeId
  const matchedType = caseTypes.find(t => t.name === confirmedData.caseType)
  if (!matchedType) {
    logger.warn('caseType 未匹配 case_types 表', {
      caseId,
      caseType: confirmedData.caseType,
    })
  }

  // 2. DB 固定字段 + JSONB
  await prisma.cases.update({
    where: { id: caseId },
    data: {
      title: confirmedData.title,
      plaintiff: confirmedData.plaintiff,
      defendant: confirmedData.defendant,
      summary: confirmedData.summary,
      extractedInfo: confirmedData,
      // caseTypeId: 匹配成功则更新，失败则保留原值不动
      ...(matchedType ? { caseTypeId: matchedType.id } : {}),
    },
  })

  // 3. 长期记忆
  const store = await getStore()
  await store.put(["cases", String(caseId)], "basic_info", {
    text: formatCaseInfo(confirmedData),
    ...confirmedData,
  })
}
```

### 3.2 extract_case_info 工具保留为材料查询工具

原 `extract_case_info` 工具不再负责提取逻辑，改为提取节点可调用的材料查询工具之一。提取节点通过 `nodes.tools` 配置决定使用哪些工具（如 `search_case_materials`、`extract_case_info` 等），工具只负责返回原始数据，结构化提取由节点的 `withStructuredOutput` 完成。

### 3.3 确认后存储（三层双写）

用户确认/编辑后，Agent 恢复时执行存储：

```
用户确认的数据 (confirmedData)
  ↓
① DB 固定字段: cases.update({ title, plaintiff, defendant, summary })
② DB JSONB: cases.update({ extractedInfo: confirmedData })
③ 长期记忆: store.put(["cases", caseId], "basic_info", confirmedData)
```

存储逻辑在 Agent 恢复后的 interrupt handler 中实现。固定字段从 `extractedInfo` 中提取并同步到 `cases` 表对应列。

### 3.4 长期记忆：PostgresStore

**不使用** CompositeBackend / 文件系统后端。直接使用 `PostgresStore`（与 `PostgresSaver` 同包 `@langchain/langgraph-checkpoint-postgres`），作为 LangGraph BaseStore 实现。

#### 初始化（单例，与 checkpointer 同模式）

新建 `server/services/agent/store.ts`：

```typescript
import { PostgresStore } from '@langchain/langgraph-checkpoint-postgres'

let storeInstance: PostgresStore | null = null

export async function getStore(): Promise<PostgresStore> {
  if (storeInstance) return storeInstance

  const config = useRuntimeConfig()
  const databaseUrl = config.agent.databaseUrl || process.env.DATABASE_URL

  // 嵌入模型配置（从 runtimeConfig.embedding 读取，支持语义搜索）
  const { apiKey, baseUrl, model, dimensions } = config.embedding
  const embeddings = createEmbeddingModel({ apiKey, baseUrl, model })

  storeInstance = PostgresStore.fromConnString(databaseUrl, {
    index: {
      embeddings,
      dims: dimensions,
      fields: ['text'],  // 对 text 字段做嵌入索引
    },
  })
  await storeInstance.setup()

  return storeInstance
}
```

嵌入模型复用 `nuxt.config.ts` 中 `runtimeConfig.embedding` 的配置（apiKey/baseUrl/model/dimensions），不硬编码模型名称。`createEmbeddingModel` 复用项目现有的嵌入模型创建逻辑。

#### 注入 Agent

```typescript
// caseAgent.ts
const store = await getStore()

const agent = createDeepAgent({
  model,
  systemPrompt,
  checkpointer,  // 短期记忆（线程状态）
  store,          // 长期记忆（跨会话）
  tools: mainTools,
  subagents: validSubagents,
})
```

Agent 的工具通过 `config.store` 访问 store（LangGraph 自动注入）。

#### 命名空间设计

```
namespace: ["cases", "{caseId}"]
  ├── key: "basic_info"          — 用户确认的完整提取结果（固定+扩展字段）
  ├── key: "analysis_history"    — 历史分析结果摘要（后续迭代）
  └── key: "key_findings"        — 关键发现和结论（后续迭代）

namespace: ["users", "{userId}"]
  └── key: "preferences"         — 用户分析偏好（后续迭代）
```

本次实现 `basic_info`，其他 key 作为后续迭代。

#### 工具中读写示例

```typescript
// extract_case_info 工具确认后写入
const store = config.store as PostgresStore
await store.put(["cases", String(caseId)], "basic_info", {
  text: formatCaseInfo(confirmedData),  // 语义搜索用
  ...confirmedData,                     // 完整结构化数据
})

// 分析子代理读取
const item = await store.get(["cases", String(caseId)], "basic_info")
const caseInfo = item?.value  // { title, plaintiff, defendant, ..., extraFields }

// 语义搜索（需配置 index）
const results = await store.search(["cases", String(caseId)], {
  query: "争议焦点是什么",
  limit: 3,
})
```

## 4. 分析消费：提取信息如何到达子代理

### 4.1 Prompt 变量注入

Agent 主 system prompt 注入 `{{caseInfo}}`，包含 extractedInfo 的格式化文本：

```typescript
// caseAgent.ts 创建 Agent 时
const caseInfo = formatCaseInfo(caseRecord.extractedInfo)
const systemPrompt = renderPrompt(config.prompts, { caseInfo, ... })
```

`formatCaseInfo` 将 extractedInfo 格式化为 LLM 友好的文本：

```
案件名称：张三与李四买卖合同纠纷
原告：张三
被告：李四
案件类型：民事
概述：原告张三于2021年5月向被告李四购买车辆...
案号：(2022)京0105民初1234号
受理法院：北京市朝阳区人民法院
案由：买卖合同纠纷
涉案金额：680000元
合同签订日期：2021-05-15
争议焦点：车辆交付延迟与质量问题
```

固定字段直接用中文 label，扩展字段用 `extraFields[].title` 作为 label。

### 4.2 长期记忆检索

子代理工具通过 `config.store` 直接访问 PostgresStore：

```typescript
// 精确读取
const item = await config.store.get(["cases", caseId], "basic_info")
const caseInfo = item?.value

// 语义搜索（需配置嵌入索引）
const results = await config.store.search(["cases", caseId], {
  query: "合同签订日期和金额",
  limit: 3,
})
```

优势：
- 不占用 system prompt 的 token（按需检索）
- 支持语义搜索（配置 index 后）
- 跨会话可用（同一 caseId 的不同 session 都能访问）
- LangGraph 原生支持，无额外集成成本

## 5. 中断机制

### 5.1 节点级 interrupt()

使用 LangGraph 原生 `interrupt()` API（与现有 `extractInfo.ts` 一致），**不使用** `interruptOn` 工具级配置。中断发生在提取节点内部，Agent 自主收集材料 + 结构化提取后调用 `interrupt()` 暂停。

```typescript
// extractInfo 节点内（见 3.1 节）
const userInput = interrupt({
  type: InterruptType.BASIC_INFO_CONFIRM,
  data: extracted,  // 结构化提取结果
})
```

### 5.2 Worker command 传递

现有 `agentWorker.ts` 的 `executeRun` 只支持 `message` 输入。需改造为同时支持 `command`（中断恢复）：

```typescript
// agentWorker.ts - executeRun 改造
const input = run.input as { message?: string; command?: unknown }

if (input.command) {
  // 中断恢复：用 Command.resume 恢复 LangGraph 图执行
  stream = await agent.stream(
    new Command({ resume: input.command }),
    config,
  )
} else {
  // 正常消息
  stream = await agent.stream(
    { messages: [new HumanMessage(input.message)] },
    config,
  )
}
```

同时 `mainAgent` 函数签名需扩展，支持 `command` 参数（替代 `prompt`），内部根据类型决定调用 `agent.stream` 的方式。

### 5.3 API command 入队

```typescript
// chat.post.ts
const result = await enqueueRunService({
  sessionId, userId, caseId,
  input: command ? { command } : { message: text },
})
```

### 5.4 前端中断交互

已实现：
- `ExtractInfoTool.vue`：Confirmation 表单 + confirm/reject emit
- `ToolRenderer.vue`：事件透传
- `[sessionId].vue`：`handleToolConfirm` → `stream.submit(undefined, { command: { resume } })`

ExtractInfoTool 的动态字段渲染：固定字段用专用表单控件（Input/Textarea），动态字段以 key-value 列表展示，支持编辑值。

## 6. 前端 ExtractInfoTool 扩展字段支持

当前表单只渲染固定字段。需要渲染 `extraFields` 数组：

```vue
<!-- 扩展字段：LLM 提取的额外信息 -->
<div v-for="(field, idx) in formData.extraFields" :key="field.name" class="space-y-2">
    <Label>{{ field.title }}</Label>
    <Input v-model="formData.extraFields[idx].value" />
</div>
<Button variant="outline" size="sm" @click="addExtraField">
    + 添加字段
</Button>
```

`extraFields` 从 `parsedOutput.extraFields` 初始化，用户可编辑值、删除或添加新字段。确认后 `extraFields` 随固定字段一起提交。

## 7. 修改文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `prisma/models/case.prisma` | 修改 | 新增 summary、extractedInfo 字段 |
| `prisma/models/node.prisma` | 修改 | 新增 outputSchema 字段 |
| Prisma migration | 新建 | 两个表的字段变更 + extractInfo 节点 seed 数据 |
| `server/services/agent/store.ts` | 新建 | PostgresStore 单例（长期记忆后端） |
| `server/services/workflow/nodes/extractInfo.ts` | 修改 | 改为两阶段 Agent 节点：工具收集 + 结构化提取 + case_types 约束 |
| `server/services/agent/caseAgent.ts` | 修改 | 注入 store 配置 |
| `server/services/agent/main.ts` | 修改 | `mainAgent` 支持 command 参数（中断恢复） |
| `server/services/agent/agentWorker.ts` | 修改 | command 分支 + Command.resume |
| `server/api/v1/case/analysis/chat.post.ts` | 修改 | command 入队 |
| `app/components/caseAnalysis/tools/ExtractInfoTool.vue` | 修改 | 扩展字段支持（从扁平结构迁移到 extraFields 数组） |
| `nuxt.config.ts` | 修改 | 新增 `runtimeConfig.embedding` 配置段 |

## 8. 依赖

- `@langchain/langgraph-checkpoint-postgres`：`PostgresStore`（已安装，同包含 PostgresSaver）
- LangChain `withStructuredOutput` API
- JSON Schema → Zod 转换：使用 `zod-to-json-schema` 的逆向（或在 seed 阶段直接存 Zod 兼容格式）。实现时选择最小依赖方案，必要时手写转换函数
- 语义搜索可选：嵌入模型配置通过 `nuxt.config.ts` 的 `runtimeConfig.embedding`（apiKey/baseUrl/model/dimensions）+ 对应环境变量

## 9. 迁移策略

### 9.1 数据库迁移

- `cases` 表新增 `summary`、`extractedInfo` 字段（均可空，不影响现有数据）
- `nodes` 表新增 `outputSchema` 字段（可空）
- 通过 Prisma migration SQL 为 `extractInfo` 节点填充 `outputSchema` 和 `tools` 配置

### 9.2 前端兼容

现有 `ExtractInfoTool.vue` 的 `CaseInfo` 接口使用扁平结构（`caseNumber`、`court` 等顶级可选字段）。迁移策略：
- **不做旧数据兼容**：`extractedInfo` 是新字段，旧案件无此数据，不存在格式冲突
- 前端直接改为 `extraFields` 数组渲染，旧的扁平字段 UI 移除

### 9.3 节点迁移

现有 `extractInfo.ts` 从 `state.aggregatedContent` 被动接收材料。迁移后改为 Agent 自主调用工具。原有的 `aggregatedContent` 状态字段保留（其他节点可能使用），但 `extractInfo` 节点不再依赖它。

## 10. 验证

### 正向流程

1. 提取：Agent 自主调用工具获取材料，输出包含固定+动态字段的结构化 JSON
2. caseType：提取结果中的 caseType 值来自 case_types 表
3. 中断：结构化提取后图自动暂停
4. 表单：ExtractInfoTool 正确回显固定字段和动态字段（extraFields 数组）
5. 确认：用户编辑后数据正确传回
6. 存储：cases 表固定字段更新 + extractedInfo JSONB 写入 + 长期记忆写入
7. 消费：分析子代理能通过 prompt 变量和长期记忆访问提取信息
8. 恢复：Agent 恢复后正常继续后续分析步骤

### 异常流程

9. 提取失败（工具调用异常/LLM 返回格式错误）：节点捕获异常，返回错误消息，不中断整体流程
10. caseType 匹配失败：打日志告警，保留原有 caseTypeId 不变
11. 用户取消确认：图回到中断前状态，可重新触发提取
