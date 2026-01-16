# 设计文档

## 概述

本设计文档描述了 LexSeek AI 模型管理系统的技术架构，包括新增的 LangChain SDK 类型功能。

SDK 类型功能允许为每个模型配置使用的 LangChain SDK 包，支持 OpenAI、DeepSeek、Gemini、Anthropic 四种类型，实现根据模型配置动态选择对应的 LangChain 包创建模型实例。

## 架构

### 目录结构

```
server/
├── api/v1/admin/
│   ├── model-providers/       # 模型提供商 API
│   ├── models/                # 模型 API
│   └── model-api-keys/        # API 密钥 API
├── services/
│   ├── model/                 # 模型服务
│   └── node/                  # 节点服务
│       ├── node.service.ts    # 节点配置服务
│       └── chatModelFactory.ts # 聊天模型工厂（新增）
app/pages/admin/
├── model-providers/           # 模型提供商管理页面
├── models/                    # 模型管理页面
└── model-api-keys/            # API 密钥管理页面
shared/types/
└── model.ts                   # 模型类型定义
```

## 组件和接口

### SDK 类型枚举

```typescript
/** LangChain SDK 类型枚举 */
export type SdkType = 'openai' | 'deepseek' | 'gemini' | 'anthropic'

/** SDK 类型标签映射 */
export const SdkTypeLabels: Record<SdkType, string> = {
    openai: 'OpenAI',
    deepseek: 'DeepSeek',
    gemini: 'Gemini',
    anthropic: 'Anthropic',
}

/** SDK 类型对应的 LangChain 包 */
export const SdkTypePackages: Record<SdkType, string> = {
    openai: '@langchain/openai',
    deepseek: '@langchain/deepseek',
    gemini: '@langchain/google-genai',
    anthropic: '@langchain/anthropic',
}
```

### 聊天模型工厂接口

```typescript
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'

/** 模型创建配置 */
interface ChatModelConfig {
    sdkType: SdkType
    modelName: string
    apiKey: string
    baseUrl?: string
    temperature?: number
    streaming?: boolean
}

/** 聊天模型工厂 */
interface ChatModelFactory {
    /**
     * 根据 SDK 类型创建对应的聊天模型实例
     * @param config 模型配置
     * @returns 聊天模型实例
     * @throws Error 当 sdkType 不支持时
     */
    createChatModel(config: ChatModelConfig): BaseChatModel
}
```

### 节点配置扩展

```typescript
/** 节点完整配置（扩展） */
export interface NodeConfig {
    // ... 现有字段 ...
    
    /** 模型 SDK 类型 */
    modelSdkType: SdkType
}
```

## 数据模型

### 模型表扩展 (models)

```prisma
model models {
    /// 模型ID，主键，自增
    id                         Int       @id @default(autoincrement())
    /// 关联的模型提供商ID
    providerId                 Int       @map("provider_id")
    /// 模型名称
    name                       String    @db.VarChar(100)
    /// 模型显示名称
    displayName                String    @map("display_name") @db.VarChar(100)
    /// 模型类型：chat-对话模型，embedding-嵌入模型，asr-音频识别模型
    modelType                  String    @map("model_type") @db.VarChar(20)
    /// LangChain SDK 类型：openai、deepseek、gemini、anthropic
    sdkType                    String    @default("openai") @map("sdk_type") @db.VarChar(20)
    /// ... 其他现有字段 ...
    
    @@map("models")
}
```

### 数据库迁移

```sql
-- 添加 sdk_type 字段，默认值为 'openai'
ALTER TABLE models ADD COLUMN sdk_type VARCHAR(20) NOT NULL DEFAULT 'openai';

-- 为现有数据设置默认值（迁移时自动完成）
UPDATE models SET sdk_type = 'openai' WHERE sdk_type IS NULL;
```

## 正确性属性

*正确性属性是指在系统所有有效执行中都应该成立的特征或行为——本质上是关于系统应该做什么的形式化陈述。属性作为人类可读规范和机器可验证正确性保证之间的桥梁。*

### Property 1: SDK 类型枚举值验证

*对于任意* sdkType 值，如果它是 'openai'、'deepseek'、'gemini'、'anthropic' 之一，则应该被系统接受；否则应该被拒绝。

**验证: 需求 3.3**

### Property 2: 聊天模型工厂正确实例化

*对于任意* 有效的 SDK 类型和模型配置，聊天模型工厂应该返回对应 SDK 包的模型实例：
- openai → ChatOpenAI
- deepseek → ChatDeepSeek
- gemini → ChatGoogleGenerativeAI
- anthropic → ChatAnthropic

**验证: 需求 5.1, 5.2, 5.3, 5.4**

### Property 3: 节点配置 SDK 类型传递

*对于任意* 节点配置，其 modelSdkType 字段应该等于关联模型的 sdkType 字段值。

**验证: 需求 6.2**

### Property 4: 默认值向后兼容

*对于任意* 未设置 sdkType 的模型，系统应该使用 'openai' 作为默认值，确保现有功能不受影响。

**验证: 需求 3.2, 6.3, 7.1, 7.2**

## 错误处理

### SDK 类型验证错误

```typescript
// 创建/更新模型时验证 sdkType
const validSdkTypes = ['openai', 'deepseek', 'gemini', 'anthropic']
if (sdkType && !validSdkTypes.includes(sdkType)) {
    throw new Error(`不支持的 SDK 类型: ${sdkType}，支持的类型: ${validSdkTypes.join(', ')}`)
}
```

### 模型工厂错误

```typescript
// 创建模型实例时的错误处理
function createChatModel(config: ChatModelConfig): BaseChatModel {
    switch (config.sdkType) {
        case 'openai':
        case 'deepseek':
        case 'gemini':
        case 'anthropic':
            // 创建对应实例
            break
        default:
            throw new Error(`不支持的 SDK 类型: ${config.sdkType}`)
    }
}
```

## 测试策略

### 单元测试

1. **SDK 类型验证测试**
   - 测试所有有效枚举值被接受
   - 测试无效值被拒绝并返回正确错误信息

2. **聊天模型工厂测试**
   - 测试每种 SDK 类型创建正确的模型实例
   - 测试无效 SDK 类型抛出错误

3. **节点配置测试**
   - 测试 modelSdkType 字段正确返回
   - 测试默认值为 'openai'

### 属性测试

使用 fast-check 进行属性测试，最少 100 次迭代：

```typescript
// Feature: model-sdk-type, Property 1: SDK 类型枚举值验证
fc.assert(
    fc.property(
        fc.oneof(
            fc.constant('openai'),
            fc.constant('deepseek'),
            fc.constant('gemini'),
            fc.constant('anthropic'),
            fc.string() // 随机字符串
        ),
        (sdkType) => {
            const validTypes = ['openai', 'deepseek', 'gemini', 'anthropic']
            const isValid = validTypes.includes(sdkType)
            // 验证系统行为与预期一致
        }
    ),
    { numRuns: 100 }
)
```

## 实现状态

### 已完成

- 模型提供商管理
- 模型管理基础功能
- API 密钥管理
- 后台管理页面

### 待实现（SDK 类型功能）

1. 数据模型扩展
   - `prisma/models/model.prisma` - 添加 sdkType 字段
   - 数据库迁移

2. 类型定义扩展
   - `shared/types/model.ts` - 添加 SdkType 类型和相关常量

3. 服务层扩展
   - `server/services/model/models.dao.ts` - 支持 sdkType 字段
   - `server/services/model/models.service.ts` - 支持 sdkType 字段
   - `server/services/node/node.service.ts` - NodeConfig 添加 modelSdkType
   - `server/services/node/chatModelFactory.ts` - 新增聊天模型工厂

4. API 层扩展
   - `server/api/v1/admin/models/*.ts` - 支持 sdkType 参数

5. 前端扩展
   - `app/components/admin/models/ModelFormDialog.vue` - 添加 SDK 类型选择器
   - `app/pages/admin/models/index.vue` - 列表显示 SDK 类型

6. 节点服务重构
   - 使用 chatModelFactory 替换现有的 createChatModel 函数

### 相关文件

- `prisma/models/model.prisma`
- `shared/types/model.ts`
- `server/services/model/*.ts`
- `server/services/node/node.service.ts`
- `server/services/node/chatModelFactory.ts`（新增）
- `server/api/v1/admin/models/*.ts`
- `app/components/admin/models/ModelFormDialog.vue`
- `app/pages/admin/models/index.vue`
