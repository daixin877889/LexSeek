# Requirements Document

## Introduction

本功能将从 lexseekApi 项目移植模型管理功能到 lexseek 项目，包括模型提供商（model_providers）、模型 API 密钥（model_api_keys）和模型配置（models）三个核心表。移植后，法律向量化服务将优先从数据库获取默认的向量模型配置，环境变量作为数据库无默认向量模型时的保底措施。

## Glossary

- **Model_Provider**: 模型提供商，如 OpenAI、阿里云通义千问等，包含 API 基础 URL 等配置
- **Model_API_Key**: 模型 API 密钥，关联到特定提供商，用于 API 认证
- **Model**: 模型配置，包含模型名称、类型（chat/embedding）、优先级等信息
- **Embedding_Model**: 嵌入模型，用于将文本转换为向量表示，用于语义检索
- **Vector_Store_Service**: 向量存储服务，负责管理向量数据的存储和检索
- **Runtime_Config**: Nuxt 运行时配置，用于在应用运行时访问环境变量

## Requirements

### Requirement 1: 模型提供商数据模型

**User Story:** 作为系统管理员，我希望能够管理模型提供商信息，以便配置不同的 AI 服务提供商。

#### Acceptance Criteria

1. THE Model_Provider SHALL 包含 id、name、baseUrl、description、createdAt、updatedAt、deletedAt 字段
2. WHEN 创建模型提供商时，THE System SHALL 确保 name 字段唯一
3. THE Model_Provider SHALL 支持软删除功能

### Requirement 2: 模型 API 密钥数据模型

**User Story:** 作为系统管理员，我希望能够管理模型 API 密钥，以便安全地存储和使用 API 认证信息。

#### Acceptance Criteria

1. THE Model_API_Key SHALL 包含 id、providerId、name、apiKey、isDefault、status、dailyLimit、monthlyLimit、createdAt、updatedAt、deletedAt 字段
2. WHEN 创建 API 密钥时，THE System SHALL 确保同一提供商下 name 字段唯一
3. THE Model_API_Key SHALL 关联到 Model_Provider 表
4. THE Model_API_Key SHALL 支持设置默认密钥标识

### Requirement 3: 模型配置数据模型

**User Story:** 作为系统管理员，我希望能够管理模型配置，以便灵活配置不同类型的 AI 模型。

#### Acceptance Criteria

1. THE Model SHALL 包含 id、providerId、name、displayName、modelType、modelVersion、contextWindow、isDefault、status、priority、inputCostPerMillionTokens、outputCostPerMillionTokens、createdAt、updatedAt、deletedAt 字段
2. WHEN 创建模型时，THE System SHALL 确保同一提供商下 name 字段唯一
3. THE Model SHALL 关联到 Model_Provider 表
4. THE Model SHALL 支持 modelType 字段区分 chat（对话模型）、embedding（嵌入模型）和 asr（音频识别模型）
5. THE Model SHALL 支持设置默认模型标识和优先级

### Requirement 4: 向量化模型配置获取

**User Story:** 作为开发者，我希望向量化服务能够优先从数据库获取默认的嵌入模型配置，以便实现动态配置管理。

#### Acceptance Criteria

1. WHEN 向量化服务初始化时，THE System SHALL 首先查询数据库中 modelType 为 embedding 且 isDefault 为 true 的模型
2. IF 数据库中存在默认嵌入模型，THEN THE System SHALL 使用该模型的配置（包括关联的提供商 baseUrl 和默认 API 密钥）
3. IF 数据库中不存在默认嵌入模型，THEN THE System SHALL 使用环境变量配置作为保底措施
4. THE System SHALL 在获取模型配置时同时获取关联的提供商信息和默认 API 密钥

### Requirement 5: 运行时配置整合

**User Story:** 作为开发者，我希望嵌入模型的环境变量配置能够整合到 nuxt.config.ts 中，以便统一管理配置。

#### Acceptance Criteria

1. THE Runtime_Config SHALL 包含 embedding 配置组，包括 apiKey、baseUrl、model、dimensions、batchSize 字段
2. THE System SHALL 支持通过环境变量 NUXT_EMBEDDING_API_KEY、NUXT_EMBEDDING_BASE_URL、NUXT_EMBEDDING_MODEL 覆盖默认配置
3. WHEN 数据库配置不可用时，THE Vector_Store_Service SHALL 从 Runtime_Config 获取嵌入模型配置

### Requirement 6: 模型服务层

**User Story:** 作为开发者，我希望有统一的服务层来管理模型相关的数据操作，以便在业务逻辑中方便地使用。

#### Acceptance Criteria

1. THE System SHALL 提供 Model_Provider 的 CRUD 操作服务
2. THE System SHALL 提供 Model_API_Key 的 CRUD 操作服务
3. THE System SHALL 提供 Model 的 CRUD 操作服务
4. THE System SHALL 提供获取默认嵌入模型配置的服务方法
5. WHEN 获取默认嵌入模型时，THE Service SHALL 返回完整的配置信息，包括提供商 baseUrl 和 API 密钥

### Requirement 8: 模型配置抽象获取方法

**User Story:** 作为开发者，我希望有统一的抽象方法来获取模型配置，以便在不同场景下灵活使用。

#### Acceptance Criteria

1. THE System SHALL 提供通过模型 ID 获取完整模型配置的方法
2. THE System SHALL 提供通过模型类型（chat/embedding/asr）获取模型配置列表的方法
3. THE System SHALL 提供通过提供商 ID 获取该提供商下所有模型列表的方法
4. THE System SHALL 提供获取默认嵌入模型配置的方法
5. THE System SHALL 提供获取默认聊天模型配置的方法
6. THE System SHALL 提供获取默认 ASR 模型配置的方法
7. WHEN 获取模型配置时，THE System SHALL 返回包含提供商信息和 API 密钥的完整配置对象
8. THE System SHALL 支持按优先级排序返回模型列表
9. THE System SHALL 支持按状态（启用/禁用）过滤模型列表

### Requirement 7: 向量存储服务改造

**User Story:** 作为开发者，我希望向量存储服务能够支持动态获取嵌入模型配置，以便实现配置的灵活管理。

#### Acceptance Criteria

1. WHEN 初始化嵌入模型时，THE Vector_Store_Service SHALL 首先尝试从数据库获取默认嵌入模型配置
2. IF 数据库配置获取成功，THEN THE Vector_Store_Service SHALL 使用数据库配置初始化嵌入模型
3. IF 数据库配置获取失败，THEN THE Vector_Store_Service SHALL 回退到使用环境变量配置
4. THE Vector_Store_Service SHALL 记录日志说明使用的配置来源（数据库或环境变量）

### Requirement 9: 后台模型管理页面

**User Story:** 作为系统管理员，我希望在后台有模型管理页面，以便可视化地管理模型提供商、API 密钥和模型配置。

#### Acceptance Criteria

1. THE System SHALL 提供模型提供商管理页面，支持查看、新增、编辑、删除提供商
2. THE System SHALL 提供模型 API 密钥管理页面，支持查看、新增、编辑、删除 API 密钥
3. THE System SHALL 提供模型配置管理页面，支持查看、新增、编辑、删除模型
4. WHEN 管理模型时，THE System SHALL 支持设置默认模型
5. WHEN 管理 API 密钥时，THE System SHALL 支持设置默认密钥
6. THE System SHALL 在模型列表中显示模型类型（chat/embedding/asr）标签
7. THE System SHALL 支持按提供商筛选模型列表
8. THE System SHALL 支持按模型类型筛选模型列表
9. THE System SHALL 在 API 密钥列表中隐藏敏感的密钥值，仅显示部分字符

### Requirement 10: 模型供应商详情页

**User Story:** 作为系统管理员，我希望能够查看模型供应商的详细信息，以便全面了解和管理该供应商下的所有资源。

#### Acceptance Criteria

1. WHEN 从模型提供商列表页面点击查看详情时，THE System SHALL 导航到该提供商的详情页面
2. THE System SHALL 在详情页面显示提供商的基本信息（名称、API基础URL、描述、创建时间等）
3. THE System SHALL 在详情页面显示该提供商下所有 API 密钥的列表，包括密钥名称、状态、是否默认、创建时间
4. THE System SHALL 在详情页面显示该提供商下所有模型的列表，包括模型名称、类型、状态、是否默认、优先级
5. THE System SHALL 在详情页面支持对 API 密钥进行管理操作（新增、编辑、删除、设置默认）
6. THE System SHALL 在详情页面支持对模型进行管理操作（新增、编辑、删除、设置默认）
7. THE System SHALL 在详情页面提供返回提供商列表的导航链接
8. THE System SHALL 在详情页面提供编辑提供商基本信息的功能
9. WHEN 在详情页面删除 API 密钥或模型时，THE System SHALL 显示确认对话框
10. THE System SHALL 在详情页面的 API 密钥列表中隐藏敏感的密钥值，仅显示部分字符
