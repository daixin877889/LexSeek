# 需求文档

## 简介

将当前项目的 `law_embeddings` 表 metadata 结构调整为与旧项目一致，以便于数据迁移。主要涉及字段命名从 camelCase 改为 snake_case，以及部分字段的增删和格式调整。

## 术语表

- **Law_Embeddings**: 法律条文向量嵌入表，存储法律条文的向量化数据用于语义检索
- **Metadata**: 嵌入记录的元数据，包含法律法规和条文的关键信息
- **LegalType**: 法律类型，包括法律、法规、司法解释等
- **ArticleType**: 条文类型，包括 l1-l5 层级、通知、附件等

## 需求

### 需求 1: 元数据字段命名规范调整

**用户故事:** 作为数据迁移工程师，我需要将 metadata 字段命名从 camelCase 改为 snake_case，以便与旧项目数据结构保持一致。

#### 验收标准

1. WHEN 构建嵌入元数据时，THE Embedding_Service SHALL 使用 `articles_id` 替代 `articleId`
2. WHEN 构建嵌入元数据时，THE Embedding_Service SHALL 使用 `legal_id` 替代 `legalId`
3. WHEN 构建嵌入元数据时，THE Embedding_Service SHALL 使用 `legal_name` 替代 `legalName`
4. WHEN 构建嵌入元数据时，THE Embedding_Service SHALL 使用 `legal_type` 替代 `legalType`
5. WHEN 构建嵌入元数据时，THE Embedding_Service SHALL 使用 `article_type` 替代 `articleType`
6. WHEN 构建嵌入元数据时，THE Embedding_Service SHALL 使用 `invalid_date` 替代 `invalidDate`
7. WHEN 构建嵌入元数据时，THE Embedding_Service SHALL 使用 `publish_date` 替代 `publishDate`
8. WHEN 构建嵌入元数据时，THE Embedding_Service SHALL 使用 `effective_date` 替代 `effectiveDate`
9. WHEN 构建嵌入元数据时，THE Embedding_Service SHALL 使用 `chapter_hierarchy` 数组替代 `hierarchyPath` 字符串

### 需求 2: 新增旧项目特有字段

**用户故事:** 作为数据迁移工程师，我需要在 metadata 中添加旧项目特有的字段，以保持数据结构完整性。

#### 验收标准

1. WHEN 构建嵌入元数据时，THE Embedding_Service SHALL 包含 `issuing_authority` 字段（发文机关）
2. WHEN 构建嵌入元数据时，THE Embedding_Service SHALL 包含 `document_number` 字段（文号）
3. WHEN 构建嵌入元数据时，THE Embedding_Service SHALL 包含 `last_edited_at` 字段（最后编辑时间）
4. WHEN 构建嵌入元数据时，THE Embedding_Service SHALL 包含 `loc` 字段（文本位置信息，包含 lines.from 和 lines.to）

### 需求 3: 移除当前项目特有字段

**用户故事:** 作为数据迁移工程师，我需要移除旧项目中不存在的字段，以避免数据结构不一致。

#### 验收标准

1. WHEN 构建嵌入元数据时，THE Embedding_Service SHALL NOT 包含 `isValid` 字段
2. WHEN 构建嵌入元数据时，THE Embedding_Service SHALL NOT 包含 `legalCode` 字段
3. WHEN 构建嵌入元数据时，THE Embedding_Service SHALL NOT 包含 `hierarchyPath` 字符串字段（改用 `chapter_hierarchy` 数组）

### 需求 4: 法律类型格式调整

**用户故事:** 作为数据迁移工程师，我需要将法律类型从英文枚举值改为中文显示名称，以与旧项目保持一致。

#### 验收标准

1. WHEN legal_type 为 'law' 时，THE Embedding_Service SHALL 存储为 "法律"
2. WHEN legal_type 为 'regulation' 时，THE Embedding_Service SHALL 存储为 "法规"
3. WHEN legal_type 为 'judicial_interp' 时，THE Embedding_Service SHALL 存储为 "司法解释"
4. WHEN legal_type 为 'guideline' 时，THE Embedding_Service SHALL 存储为 "指导意见"

### 需求 5: 日期格式调整

**用户故事:** 作为数据迁移工程师，我需要将日期格式从 'YYYY-MM-DD' 改为 ISO 8601 带时区格式，以与旧项目保持一致。

#### 验收标准

1. WHEN 格式化 publish_date 时，THE Embedding_Service SHALL 使用 'YYYY-MM-DDTHH:mm:ss+08:00' 格式
2. WHEN 格式化 effective_date 时，THE Embedding_Service SHALL 使用 'YYYY-MM-DDTHH:mm:ss+08:00' 格式
3. WHEN 格式化 invalid_date 时，THE Embedding_Service SHALL 使用 'YYYY-MM-DDTHH:mm:ss+08:00' 格式
4. WHEN 格式化 last_edited_at 时，THE Embedding_Service SHALL 使用 'YYYY-MM-DDTHH:mm:ss+08:00' 格式
5. WHEN 日期值为 null 时，THE Embedding_Service SHALL 保持 null 值

### 需求 6: 更新所有引用 metadata 字段的代码

**用户故事:** 作为开发者，我需要更新所有查询和操作 metadata 字段的代码，以使用新的 snake_case 字段名。

#### 验收标准

1. WHEN 查询嵌入记录时，THE System SHALL 使用 `metadata->>'articles_id'` 替代 `metadata->>'articleId'`
2. WHEN 查询嵌入记录时，THE System SHALL 使用 `metadata->>'legal_id'` 替代 `metadata->>'legalId'`
3. WHEN 更新嵌入元数据时，THE System SHALL 使用 snake_case 字段名
4. WHEN 删除嵌入记录时，THE System SHALL 使用 `metadata->>'articles_id'` 进行匹配

### 需求 7: 类型定义更新

**用户故事:** 作为开发者，我需要更新 TypeScript 类型定义，以反映新的 metadata 结构。

#### 验收标准

1. THE LawEmbeddingMetadata 接口 SHALL 使用 snake_case 字段命名
2. THE LawEmbeddingMetadata 接口 SHALL 包含 `loc` 字段类型定义
3. THE LawEmbeddingMetadata 接口 SHALL 包含 `chapter_hierarchy` 数组类型
4. THE LawEmbeddingMetadata 接口 SHALL 移除 `isValid`、`legalCode`、`hierarchyPath` 字段
