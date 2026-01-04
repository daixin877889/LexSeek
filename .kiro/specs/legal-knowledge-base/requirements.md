# 需求文档

## 简介

本文档定义了法律知识库功能的重构需求。该功能从旧项目 LsMicroService/services/langgraph 迁移到当前 Nuxt.js 项目中，主要包括法律法规管理、法律条文管理以及条文向量化处理功能。

## 术语表

- **Legal_Main**: 法律法规主表，存储法律法规的基本信息
- **Legal_Articles**: 法律条文表，存储法律法规对应的具体条款内容
- **Law_Embeddings**: 法条向量嵌入表，存储法律条文的向量化数据用于语义检索
- **Embedding**: 向量嵌入，将文本转换为高维向量表示的过程
- **Vector_Store**: 向量存储，用于存储和检索向量数据的数据库
- **Admin_Panel**: 管理后台，用于管理法律法规和条文的操作界面
- **Legal_Type**: 法律类型，包括法律(law)、行政法规(regulation)、司法解释(judicial_interp)、指导意见(guideline)
- **Article_Type**: 条文类型，包括通知(notice)、正文头部(header)、附件(annex)、各级标题(l1-l5)
- **Embedding_Service**: 向量嵌入服务，负责将文本转换为向量并存储
- **Prisma_Schema**: Prisma 数据库模型定义文件

## 需求

### 需求 1: 数据库模型定义

**用户故事:** 作为开发者，我需要在当前项目中定义法律知识库相关的数据库模型，以便存储和管理法律法规数据。

#### 验收标准

1. 当定义 Prisma 模型时，Prisma_Schema 应定义 legalMain 模型，包含字段：id、name、code、type、category、content、issuingAuthority、documentNumber、publishDate、effectiveDate、invalidDate、lastEditedAt、lastEmbeddingAt、createdAt、updatedAt、deletedAt
2. 当定义 Prisma 模型时，Prisma_Schema 应定义 legalArticles 模型，包含字段：id、legalId、type、l1-l5 层级字段、order、content、publishDate、effectiveDate、invalidDate、lastEditedAt、lastEmbeddingAt、createdAt、updatedAt、deletedAt
3. 当定义 Prisma 模型时，Prisma_Schema 应定义 lawEmbeddings 模型，包含字段：id (UUID)、text、metadata (JSON)、embedding (vector 类型)
4. legalArticles 模型应通过 legalId 字段与 legalMain 建立外键关联关系
5. lawEmbeddings 表结构不允许修改，必须保持原有设计

### 需求 2: 法律法规管理 API

**用户故事:** 作为管理员，我需要通过 API 接口对法律法规进行增删改查操作，以便维护法律知识库。

#### 验收标准

1. 当向 /api/v1/admin/legal-main 发送 GET 请求时，系统应返回分页的法律法规列表，支持筛选和排序选项
2. 当向 /api/v1/admin/legal-main/:id 发送 GET 请求时，系统应返回指定法律法规的详细信息
3. 当向 /api/v1/admin/legal-main 发送 POST 请求并携带有效数据时，系统应创建新的法律法规记录
4. 当向 /api/v1/admin/legal-main/:id 发送 PUT 请求并携带有效数据时，系统应更新指定的法律法规记录，并将 lastEditedAt 设置为当前时间戳
5. 当向 /api/v1/admin/legal-main/:id 发送 DELETE 请求时，系统应通过设置 deletedAt 字段进行软删除
6. 如果法律法规被标记为失效（invalidDate 已设置且已过期），则系统应更新所有相关法律条文及其向量嵌入元数据中的状态

### 需求 3: 法律条文管理 API

**用户故事:** 作为管理员，我需要通过 API 接口对法律条文进行增删改查操作，以便维护法律条文内容。

#### 验收标准

1. 当向 /api/v1/admin/legal-articles 发送带有 legalId 参数的 GET 请求时，系统应返回属于指定法律法规的所有条文
2. 当向 /api/v1/admin/legal-articles/:id 发送 GET 请求时，系统应返回指定条文的详细信息
3. 当向 /api/v1/admin/legal-articles 发送 POST 请求并携带有效数据时，系统应创建新的条文记录并触发向量嵌入生成
4. 当向 /api/v1/admin/legal-articles/:id 发送 PUT 请求并携带有效数据时，系统应更新条文记录，将 lastEditedAt 设置为当前时间戳，并触发重新向量化
5. 当向 /api/v1/admin/legal-articles/:id 发送 DELETE 请求时，系统应软删除条文并从 law_embeddings 表中删除对应的向量嵌入

### 需求 4: 条文向量化处理

**用户故事:** 作为系统，我需要将法律条文内容向量化并存储到 law_embeddings 表中，以便支持语义检索功能。

#### 验收标准

1. 当创建新的法律条文时，Embedding_Service 应为条文内容生成向量嵌入并存储到 law_embeddings 表中
2. 当更新法律条文时，Embedding_Service 应删除该条文的现有向量嵌入并生成新的向量嵌入
3. Embedding_Service 应通过组合法律名称、类型、章节层级和条文内容来构建嵌入文本
4. Embedding_Service 应存储元数据，包括：articles_id、legal_id、legal_name、legal_type、issuing_authority、document_number、publish_date、effective_date、invalid_date、last_edited_at、last_embedding_at、article_type、chapter_hierarchy
5. 当向量嵌入完成时，系统应更新 legalArticles 和 legalMain 记录的 lastEmbeddingAt 字段
6. 如果条文内容为空或无效，则 Embedding_Service 应跳过向量嵌入并记录警告日志

### 需求 5: 法律失效状态同步

**用户故事:** 作为管理员，当我将法律法规标记为失效时，系统需要自动同步更新相关条文和向量数据的状态。

#### 验收标准

1. 当法律法规的 invalidDate 被设置为过去的日期时，系统应将所有相关法律条文的 invalidDate 更新为相同的值
2. 当法律法规被标记为失效时，系统应更新所有对应 law_embeddings 记录中 metadata.invalid_date 字段
3. 系统应提供批量更新机制，以高效处理大量条文和向量嵌入
4. 当查询向量嵌入进行搜索时，系统应能够根据元数据中的 invalid_date 进行过滤

### 需求 6: 管理后台界面

**用户故事:** 作为管理员，我需要一个可视化的管理界面来管理法律法规和条文，以便高效地维护法律知识库。

#### 验收标准

1. Admin_Panel 应显示法律法规列表视图，包含列：名称、代码、类型、发文机关、发布日期、生效日期、状态
2. Admin_Panel 应提供按名称、代码、类型和状态搜索和筛选法律法规的功能
3. Admin_Panel 应提供创建和编辑法律法规的表单，包含所有必填字段
4. Admin_Panel 应显示选定法律法规的条文列表视图，展示层级结构
5. Admin_Panel 应提供创建和编辑法律条文的表单，包含内容编辑器
6. Admin_Panel 应显示每个条文的向量嵌入状态（最后嵌入时间）
7. Admin_Panel 应提供按钮，用于手动触发选定条文的重新向量化

### 需求 7: 向量存储服务封装

**用户故事:** 作为开发者，我需要一个封装好的向量存储服务，以便在项目中方便地进行向量操作。

#### 验收标准

1. Vector_Store_Service 应提供初始化 PGVectorStore 的方法，支持配置表名和列名
2. Vector_Store_Service 应提供向向量存储添加带有向量嵌入的文档的方法
3. Vector_Store_Service 应提供根据元数据中的 article ID 删除向量嵌入的方法
4. Vector_Store_Service 应使用 OpenAI 兼容的嵌入 API，支持配置 base URL 和模型
5. Vector_Store_Service 应处理连接池并按表名复用向量存储实例
6. 如果嵌入 API 调用失败，则 Vector_Store_Service 应记录错误并抛出适当的异常

### 需求 8: 法律条文搜索工具 (LangGraph Tool)

**用户故事:** 作为 AI Agent，我需要一个法律条文搜索工具，以便在对话中检索相关的法律法规内容。

#### 验收标准

1. Search_Law_Tool 应支持两种搜索模式：向量语义搜索（传入 query 参数）和 SQL 元数据筛选（不传入 query 参数）
2. Search_Law_Tool 应支持按以下字段过滤：legal_id、legal_name、article_type、chapter_hierarchy、keywords
3. Search_Law_Tool 应支持按日期过滤：invalid_date、publish_date、effective_date，支持操作符 >、<、=、>=、<=
4. Search_Law_Tool 应支持 isEffective 参数，用于过滤有效或失效的法律条文
5. Search_Law_Tool 应支持分页查询，k 参数作为每页大小，page 参数指定页码
6. Search_Law_Tool 应返回结果包含：score（相似度分数）、content（条文内容）、metadata（元数据）
7. Search_Law_Tool 应使用东八区时区（Asia/Shanghai）处理所有日期过滤
8. Search_Law_Tool 应使用 @langchain/core/tools 的 tool 函数定义，并提供 zod schema 验证参数

### 需求 9: 嵌入模型配置管理

**用户故事:** 作为管理员，我需要配置嵌入模型的参数，以便系统能够正确调用向量化 API。

#### 验收标准

1. 系统应支持配置嵌入模型的 API Key、Base URL 和模型名称
2. 系统应支持配置嵌入向量的维度（默认 1536）和批处理大小（默认 5）
3. 系统应从数据库中读取默认的嵌入模型配置
4. 当嵌入模型配置不存在或无效时，系统应抛出明确的错误信息

