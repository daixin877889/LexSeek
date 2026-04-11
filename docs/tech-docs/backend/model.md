# LLM 模型管理模块

模型管理模块提供 Provider → Model → API Key 三层结构的 LLM 模型配置管理，以及通过 ChatModelFactory 动态创建 LangChain 模型实例的能力。

## 模块架构

```
server/services/model/
├── modelProviders.dao.ts      # 提供商 DAO
├── modelProviders.service.ts   # 提供商 Service
├── models.dao.ts              # 模型配置 DAO
├── models.service.ts          # 模型配置 Service
├── modelApiKeys.dao.ts        # API Key DAO
├── modelApiKeys.service.ts    # API Key Service
└── modelConfig.service.ts     # 模型配置聚合 Service（组装 FullModelConfig）
```

## 数据模型关系

```
modelProviders (1) ──→ (N) models
modelProviders (1) ──→ (N) modelApiKeys
```

- 每个 Provider 有唯一 `baseUrl`
- 每个 Provider 可配置多个 Model（chat/embedding/rerank/asr）
- 每个 Provider 可配置多个 API Key，其中一个为 `isDefault`

## 1. Provider 管理

### modelProviders.dao.ts / modelProviders.service.ts

| 方法（Service） | 说明 |
|--------|------|
| `createModelProviderService` | 创建，**检查名称唯一性** |
| `getModelProvidersService` | 分页列表 |
| `getAllModelProvidersService` | 不分页全量 |
| `updateModelProviderService` | 更新，检查新名称不冲突 |
| `deleteModelProviderService` | 软删除 |

Provider 核心字段：`name`、`baseUrl`、`description`。

**Provider 典型示例**：

| name | baseUrl | 说明 |
|------|---------|------|
| OpenAI | `https://api.openai.com/v1` | OpenAI 官方 |
| DeepSeek | `https://api.deepseek.com` | DeepSeek 官方 |
| 阿里云 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | 通义千问（OpenAI 兼容） |
| Google | `https://generativelanguage.googleapis.com` | Gemini |
| Anthropic | `https://api.anthropic.com` | Claude |

## 2. 模型配置

### models.dao.ts

| 方法 | 说明 |
|------|------|
| `createModelDao` | 创建模型，支持 `sdkType` 字段（默认 'openai'） |
| `findModelByIdDao` | 按 ID 查询（include modelProvider） |
| `findModelsByTypeDao` | 按类型查询（chat/embedding/rerank/asr） |
| `findDefaultModelByTypeDao` | 查询指定类型的默认模型（isDefault=true, status=1） |
| `setDefaultModelDao` | **事务**：取消同类型其他默认 → 设置当前为默认 |
| `findManyModelsDao` | 分页列表，支持 modelType/providerId/status 筛选 |

### models.service.ts

| 方法 | 说明 |
|------|------|
| `createModelService` | 创建模型，验证 Provider 存在 + sdkType 合法 |
| `updateModelService` | 更新模型，设为默认时调用 `setDefaultModelDao` |
| `setDefaultModelService` | 单独设置默认模型 |
| `deleteModelService` | 软删除 |

**sdkType 验证**：通过 `SDK_TYPES` 常量数组验证，支持 `openai`、`deepseek`、`gemini`、`anthropic`。

**模型字段说明**：

| 字段 | 说明 |
|------|------|
| `name` | 模型标识符（如 gpt-4、deepseek-chat） |
| `displayName` | 显示名称 |
| `modelType` | 模型类型：chat / embedding / rerank / asr |
| `sdkType` | LangChain SDK 类型（决定用哪个包创建实例） |
| `contextWindow` | 上下文窗口大小 |
| `dimensions` | 向量维度（embedding 专用） |
| `batchSize` | 批处理大小（embedding 专用） |
| `isDefault` | 同类型下是否默认 |
| `priority` | 优先级（数值越小越优先） |
| `inputCostPerMillionTokens` | 输入成本/百万 token |
| `outputCostPerMillionTokens` | 输出成本/百万 token |

## 3. API Key 管理

### modelApiKeys.dao.ts / modelApiKeys.service.ts

| 方法（Service） | 说明 |
|--------|------|
| `createModelApiKeyService` | 创建，验证 Provider 存在；如设为默认则取消同 Provider 下其他默认 |
| `getModelApiKeysByProviderIdService` | 获取 Provider 的密钥列表 |
| `getDefaultModelApiKeyService` | 获取 Provider 的默认密钥 |
| `setDefaultModelApiKeyService` | **事务**：取消同 Provider 其他默认 → 设置当前为默认 |
| `deleteModelApiKeyService` | 软删除 |

API Key 支持 `dailyLimit` 和 `monthlyLimit` 配额限制。

**API Key 状态**：
- `status=1`：启用
- `status=0`：停用

**密钥存储**：API Key 明文存储在数据库中（`modelApiKeys.apiKey` 字段），用于运行时构建 LLM 客户端。

## 4. 模型配置聚合

### modelConfig.service.ts

将 Model + Provider + 默认 API Key 组装为 `FullModelConfig`：

```typescript
interface FullModelConfig {
    model: models & { modelProvider: modelProviders }
    provider: modelProviders
    apiKey: modelApiKeys | null
}
```

| 方法 | 说明 |
|------|------|
| `getModelConfigByIdService` | 按模型 ID 获取完整配置 |
| `getModelConfigsByTypeService` | 按类型获取配置列表 |
| `getDefaultEmbeddingConfigService` | 获取默认嵌入模型配置 |
| `getDefaultChatConfigService` | 获取默认聊天模型配置 |
| `getDefaultAsrConfigService` | 获取默认 ASR 模型配置 |
| `getDefaultRerankConfigService` | 获取默认 Rerank 模型配置 |
| `getEmbeddingConfigWithFallbackService` | **数据库优先，环境变量回退**的嵌入配置获取 |
| `getRerankConfigWithFallbackService` | **数据库优先，环境变量回退**的 Rerank 配置获取 |

**回退机制**：
1. 尝试从数据库获取默认模型 + Provider + 默认 API Key
2. 如果不完整，回退到环境变量（`NUXT_EMBEDDING_API_KEY` 等）
3. 返回统一的 `EmbeddingConfig` / `RerankConfig` 结构

**EmbeddingConfig 结构**：

```typescript
interface EmbeddingConfig {
    apiKey: string
    baseUrl: string
    model: string      // 默认 'text-embedding-v3'
    dimensions: number  // 默认 1536
    batchSize: number   // 默认 5
    source: 'database' | 'environment'
}
```

**RerankConfig 结构**：

```typescript
interface RerankConfig {
    apiKey: string
    baseUrl: string
    model: string      // 默认 'gte-rerank-v2'
    source: 'database' | 'environment'
}
```

**环境变量清单**（回退配置）：

| 变量 | 说明 |
|------|------|
| `NUXT_EMBEDDING_API_KEY` | 嵌入模型 API Key |
| `NUXT_EMBEDDING_BASE_URL` | 嵌入模型 Base URL |
| `NUXT_EMBEDDING_MODEL` | 嵌入模型名称 |
| `NUXT_RERANK_API_KEY` | Rerank 模型 API Key |
| `NUXT_RERANK_BASE_URL` | Rerank 模型 Base URL |
| `NUXT_RERANK_MODEL` | Rerank 模型名称 |

## 与 node 模块的协作

模型通过 `nodes.modelId` 关联到节点。节点配置服务（`getNodeConfigService`）会级联查询：

```
nodes → models → modelProviders → modelApiKeys(isDefault=true)
```

ChatModelFactory（`server/services/node/chatModelFactory.ts`）使用节点配置中的 `sdkType`、`modelName`、`apiKey`、`baseUrl` 创建 LangChain 模型实例。详见 [node.md](./node.md)。

## 注意事项

1. **同类型唯一默认**：同一 modelType 下只能有一个 isDefault=true 的模型
2. **同 Provider 唯一默认密钥**：同一 providerId 下只能有一个 isDefault=true 的 API Key
3. **sdkType 扩展**：新增 SDK 类型需同时更新 `#shared/types/model` 中的 `SDK_TYPES` 和 ChatModelFactory
4. **软删除**：Provider、Model、API Key 均使用软删除

## 相关文档

- [tech-docs/backend/node.md](./node.md) — 节点如何绑定模型和 ChatModelFactory
- [tech-docs/backend/legal.md](./legal.md) — 嵌入模型如何被法律向量化模块使用
