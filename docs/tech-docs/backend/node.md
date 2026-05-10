# 节点与 Prompt 模块

节点模块提供 AI 工作流中「节点」的定义、分组管理、Prompt 版本管理、会员访问控制，以及通过 ChatModelFactory 将节点配置转化为 LangChain 模型实例的能力。

## 模块架构

```
server/services/node/
├── node.dao.ts           # 节点 + 节点分组 DAO
├── node.service.ts        # 节点 + 节点分组 Service + 节点配置服务
├── prompt.dao.ts          # Prompt DAO
├── prompt.service.ts      # Prompt Service（版本管理、变量渲染）
├── access.dao.ts          # 会员节点权限 DAO
├── access.service.ts      # 会员节点权限 Service
└── chatModelFactory.ts    # 聊天模型工厂（SDK 类型 → LangChain 实例）
```

## 1. 节点定义与管理

### node.dao.ts

**节点分组 DAO**：

| 方法 | 说明 |
|------|------|
| `createNodeGroupDao` | 创建分组 |
| `findNodeGroupByIdDao` | 按 ID 查询，include 节点计数 |
| `findManyNodeGroupsDao` | 分页列表 |
| `findAllNodeGroupsDao` | 不分页全量（按 priority 排序） |
| `softDeleteNodeGroupDao` | 软删除 |

**节点 DAO**：

| 方法 | 说明 |
|------|------|
| `createNodeDao` | 创建节点（include group + model） |
| `findNodeByIdDao` | 按 ID 查询（include group + model + prompts） |
| `findNodeByNameDao` | 按名称查询 |
| `findManyNodesDao` | 分页列表，支持 type/groupId/status/keyword 筛选 |
| `findAllNodesDao` | 不分页全量（按 priority + createdAt 排序） |
| `getNodeConfigDao` | **完整配置查询**：node → model → modelProvider → modelApiKeys + prompts（status=1） |
| `getNodeConfigByIdDao` | 同上，按 ID 查询 |
| `batchUpdateNodeGroupDao` | 批量更新节点分组 |

### node.service.ts

**节点服务**：

| 方法 | 说明 |
|------|------|
| `createNodeService` | 创建节点，检查名称唯一 + 模型存在 + 分组存在；非 extraction/agent 类型清空 outputSchema |
| `updateNodeService` | 更新节点 |
| `deleteNodeService` | 软删除（有节点的分组不可删除） |
| `batchUpdateNodeGroupService` | 批量更新节点分组 |

**节点配置服务**（核心）：

| 方法 | 说明 |
|------|------|
| `getNodeConfigService` | 按名称获取 `NodeConfig`（完整配置包含模型、Provider、API Key、Prompt） |
| `getNodeConfigByIdService` | 按 ID 获取 `NodeConfig` |
| `getValidNodeConfig` | 获取配置 + **验证**（节点存在/启用、API Key 已配置） |
| `getNodeConfigsByTypes` | 按节点类型列表批量获取配置（用于工作流加载） |

**NodeConfig 结构**：

```typescript
interface NodeConfig {
    id: number
    name: string              // 唯一标识
    type: string              // 节点类型
    prompts: NodePromptConfig[] // 生效的 Prompt 列表
    modelId: number
    modelName: string         // 模型标识符（如 gpt-4）
    modelSdkType: SdkType     // SDK 类型（openai/deepseek/gemini/anthropic）
    modelProviderBaseUrl: string
    modelApiKeys: NodeApiKeyConfig[]
    tools: string[]           // 可用工具列表
    outputSchema: Record<string, unknown> | null
    modelContextWindow?: number
}
```

## 2. Prompt 管理

### prompt.dao.ts

| 方法 | 说明 |
|------|------|
| `createPromptDao` | 创建 Prompt（默认 status=0 未生效） |
| `findPromptByIdDao` | 按 ID 查询（include node） |
| `findManyPromptsDao` | 分页列表 |
| `findActivePromptDao` | 查询节点指定类型的**生效** Prompt（status=1） |
| `findPromptVersionsDao` | 按 nodeId+name+type 查询版本历史 |
| `getLatestVersionDao` | 获取最新版本号 |
| `deactivatePromptsByTypeDao` | 停用节点指定类型的所有 Prompt |

### prompt.service.ts

**版本管理**：

| 方法 | 说明 |
|------|------|
| `createPromptService` | 创建，自动生成版本号（v1, v2, v3...） |
| `updatePromptService` | 如果 content 变化 → **创建新版本**（而非覆盖原版本） |
| `activatePromptService` | 激活版本，**事务**：先停用同节点同类型所有 Prompt → 激活当前 |
| `deactivatePromptService` | 停用 |
| `getPromptVersionsService` | 查询版本历史 |

**变量渲染**：

| 方法 | 说明 |
|------|------|
| `extractVariables` | 从 `{{variableName}}` 格式提取变量名列表 |
| `renderContent` | 替换 `{{variableName}}` 为实际值 |
| `renderPromptService` | 渲染已保存的 Prompt |
| `previewPromptService` | 预览渲染（不保存） |

**版本号规则**：`v1` → `v2` → `v3`，由 `generateNextVersion` 自动递增。

**Prompt 类型**（`shared/types/node.ts` 的 `PROMPT_TYPES`）：

| type | 装配位置 | 说明 |
|------|---------|------|
| `system` | system prompt（多段拼接） | 角色 / 任务 / 输出契约。同节点支持多段，按 `displayOrder` 升序拼接 |
| `user_injection` | 每轮 user 消息之前（隐藏） | 由 `userInjectionMiddleware` 在 wrapModelCall 内注入的 ephemeral HumanMessage，不写回 `state.messages` / 不进 checkpoint。多段按 `displayOrder` 拼接。常用于反越狱守卫 / 案件元数据 / 实时上下文 |
| `user` | 首轮 user 消息 | 主用户输入模板（带 `{{variables}}`），由调用方在创建首条对话时主动渲染 |
| `assistant` | 历史 assistant 消息 | 引导风格的 few-shot 历史（少用）|

同节点同 (name, type) 维度只能有一个版本处于 `status=1`；激活新版本时同维度其它版本自动 `status=0`（事务保证）。多个 prompt 通过 `node_prompts` 关联表挂到节点上，激活新版本零成本即时生效（关联跟随 `(name, type)` 而非具体版本 id）。

> `user_injection` 是 2026-05 「prompts 多节点 + 反越狱」改造引入的新类型，详见 [agent-platform.md §3](./agent-platform.md) 中 `userInjectionMiddleware` 的位置和 [docs/superpowers/specs/2026-05-06-prompts-multi-node-and-anti-jailbreak-design.md](../../superpowers/specs/2026-05-06-prompts-multi-node-and-anti-jailbreak-design.md)。

## 3. 访问控制

### access.dao.ts / access.service.ts

管理「会员级别」与「节点」的多对多权限关系（`levelNodeAccess` 表）。

| 方法（Service） | 说明 |
|--------|------|
| `getAccessMatrixService` | 获取权限矩阵（所有级别 x 所有节点） |
| `grantAccessService` | 授权，支持恢复已软删除的记录 |
| `revokeAccessService` | 撤销权限（软删除） |
| `batchGrantAccessService` | 批量授权 |
| `batchUpdateAccessService` | **全量替换**某级别的节点权限（事务） |
| `checkUserNodeAccessService` | 检查用户是否有节点访问权限（用户 → 会员 → 级别 → 权限） |
| `getUserAvailableNodesService` | 获取用户可用节点列表（带 available 标记） |
| `filterUserAccessibleNodesService` | 过滤出用户有权限的节点 ID |

**权限检查链**：`userId` → `findCurrentUserMembershipDao` → `levelId` → `findAccessByLevelAndNodeDao`

## 4. ChatModelFactory

### chatModelFactory.ts

根据 `sdkType` 动态创建对应的 LangChain 聊天模型实例。

**支持的 SDK 类型**：

| sdkType | LangChain 包 | 类 |
|---------|-------------|---|
| `openai` | `@langchain/openai` | `ChatOpenAI` |
| `deepseek` | `@langchain/deepseek` | `ChatDeepSeek` |
| `gemini` | `@langchain/google-genai` | `ChatGoogleGenerativeAI` |
| `anthropic` | `@langchain/anthropic` | `ChatAnthropic` |

**核心函数**：

```typescript
function createChatModel(config: ChatModelConfig): BaseChatModel
```

**ChatModelConfig 参数**：

| 字段 | 说明 |
|------|------|
| `sdkType` | 必填，决定使用哪个 LangChain 包 |
| `modelName` | 必填，模型标识符 |
| `apiKey` | 必填，API 密钥 |
| `baseUrl` | 可选，自定义 API 端点 |
| `temperature` | 可选，默认 0.7 |
| `streaming` | 可选，默认 true |
| `thinking` | 可选，仅 anthropic/gemini 生效，启用 extended thinking |

**thinking 模式特殊处理**：
- Anthropic：启用时 temperature 强制为 1，添加 `thinking.budget_tokens`
- Gemini：启用时添加 `thinkingConfig.thinkingBudget`

**辅助函数**：
- `isValidSdkType(sdkType)` — 验证 SDK 类型是否有效
- `getSupportedSdkTypes()` — 获取所有支持的 SDK 类型

## 典型使用流程

```
1. 节点名称 → getValidNodeConfig(name)
2. NodeConfig → createChatModel({
       sdkType: config.modelSdkType,
       modelName: config.modelName,
       apiKey: config.modelApiKeys[0].apiKey,
       baseUrl: config.modelProviderBaseUrl,
   })
3. BaseChatModel 实例用于 LangGraph workflow
```

## 注意事项

1. **节点名称唯一**：name 是节点的唯一标识，用于代码中引用
2. **Prompt 版本不可变**：内容变更会创建新版本，旧版本保留可回溯
3. **outputSchema**：仅 extraction 和 agent 类型节点支持，其他类型强制清空
4. **SDK 类型默认值**：未设置时默认为 `openai`，保持向后兼容

## 相关文档

- [tech-docs/backend/model.md](./model.md) — Provider/Model/API Key 管理
- [tech-docs/backend/membership.md](./membership.md) — 会员级别与节点访问控制
