# 需求文档

## 简介

本文档定义了 LexSeek AI 模型管理系统需求。

本文档整合自：model-management

## 术语表

- **Model**：AI 模型配置实体，存储在 models 表中
- **SDK_Type**：LangChain SDK 类型枚举，标识模型应使用的 LangChain 包
- **Model_Provider**：模型提供商，如 OpenAI、DeepSeek、Google、Anthropic
- **Node_Config**：节点配置，包含模型和提示词等信息
- **Chat_Model_Factory**：聊天模型工厂，根据 SDK 类型创建对应的 LangChain 模型实例

## 需求

### 需求 1：模型提供商管理

**用户故事：** 作为系统管理员，我希望能够管理 AI 模型提供商。

#### 验收标准

1. THE System SHALL 支持创建、编辑、删除模型提供商
2. THE System SHALL 支持配置提供商的 API 密钥

### 需求 2：模型管理

**用户故事：** 作为系统管理员，我希望能够管理 AI 模型。

#### 验收标准

1. THE System SHALL 支持创建、编辑、删除模型
2. THE System SHALL 支持配置模型参数
3. THE System SHALL 支持模型的启用和禁用

### 需求 3：SDK 类型字段

**用户故事：** 作为系统管理员，我希望能够为每个模型配置 LangChain SDK 类型，以便系统能够使用正确的 SDK 包调用该模型。

#### 背景

当前案件分析系统的节点使用 LangChain 调用 AI 模型，但不同的模型提供商需要使用不同的 LangChain SDK 包：
- OpenAI 模型：使用 `@langchain/openai`
- DeepSeek 模型：使用 `@langchain/deepseek`
- Gemini 模型：使用 `@langchain/google-genai`
- Anthropic 模型：使用 `@langchain/anthropic`

#### 验收标准

1. THE Model SHALL 包含 sdkType 字段，用于标识该模型使用的 LangChain SDK 类型
2. WHEN sdkType 字段未设置时，THE System SHALL 使用默认值 "openai"
3. THE SDK_Type SHALL 支持以下枚举值：openai、deepseek、gemini、anthropic
4. WHEN 创建模型时，THE System SHALL 允许指定 sdkType 字段
5. WHEN 编辑模型时，THE System SHALL 允许修改 sdkType 字段

### 需求 4：模型管理界面扩展

**用户故事：** 作为系统管理员，我希望在模型管理后台页面中能够选择和查看 SDK 类型，以便方便地配置模型。

#### 验收标准

1. WHEN 创建模型时，THE System SHALL 显示 SDK 类型选择器
2. WHEN 编辑模型时，THE System SHALL 显示当前 SDK 类型并允许修改
3. WHEN 查看模型列表时，THE System SHALL 显示每个模型的 SDK 类型
4. THE SDK 类型选择器 SHALL 显示用户友好的标签（如 "OpenAI"、"DeepSeek"、"Gemini"、"Anthropic"）

### 需求 5：动态模型实例化

**用户故事：** 作为开发者，我希望系统能够根据模型的 SDK 类型自动选择正确的 LangChain 包创建模型实例，以便支持多种模型提供商。

#### 验收标准

1. WHEN 节点配置包含 sdkType 为 "openai" 时，THE Chat_Model_Factory SHALL 使用 `@langchain/openai` 的 ChatOpenAI 创建实例
2. WHEN 节点配置包含 sdkType 为 "deepseek" 时，THE Chat_Model_Factory SHALL 使用 `@langchain/deepseek` 的 ChatDeepSeek 创建实例
3. WHEN 节点配置包含 sdkType 为 "gemini" 时，THE Chat_Model_Factory SHALL 使用 `@langchain/google-genai` 的 ChatGoogleGenerativeAI 创建实例
4. WHEN 节点配置包含 sdkType 为 "anthropic" 时，THE Chat_Model_Factory SHALL 使用 `@langchain/anthropic` 的 ChatAnthropic 创建实例
5. IF sdkType 为不支持的值，THEN THE Chat_Model_Factory SHALL 抛出明确的错误信息

### 需求 6：节点配置扩展

**用户故事：** 作为开发者，我希望节点配置能够包含模型的 SDK 类型信息，以便在创建模型实例时使用。

#### 验收标准

1. THE Node_Config SHALL 包含 modelSdkType 字段
2. WHEN 获取节点配置时，THE System SHALL 返回关联模型的 sdkType 值
3. THE modelSdkType 字段 SHALL 默认为 "openai" 以保持向后兼容

### 需求 7：向后兼容

**用户故事：** 作为系统管理员，我希望现有的模型配置在升级后能够正常工作，无需手动修改。

#### 验收标准

1. WHEN 数据库迁移执行时，THE System SHALL 为所有现有模型设置 sdkType 默认值为 "openai"
2. WHEN 现有节点调用模型时，THE System SHALL 使用默认的 OpenAI SDK（保持现有行为）
3. THE System SHALL 不破坏任何现有的模型调用功能

## 实现状态

- 需求 1-2：已完成实现和测试
- 需求 3-7：待实现（LangChain SDK 类型功能）
