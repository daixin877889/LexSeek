# 需求文档

## 简介

修复法律法规批量向量化功能的三个问题：
1. 全量更新保存时向量化触发失败（内部 API 调用认证问题）
2. 批量向量化时无法正确跳过无更新的条文（元数据字段名不匹配）
3. 全量更新保存时没有删除旧条文对应的嵌入记录

## 术语表

- **System**: 法律法规管理系统
- **Batch_Save_API**: 批量保存 API (`/api/v1/admin/legal-articles/batch-save`)
- **Batch_Embed_API**: 批量向量化 API (`/api/v1/admin/legal-articles/batch-embed`)
- **Embedding_Metadata**: 向量嵌入元数据，存储在 `law_embeddings` 表的 `metadata` 字段中
- **articles_id**: 元数据中存储条文 ID 的字段名（蛇形命名）

## 需求

### 需求 1：修复元数据字段名不匹配问题

**用户故事：** 作为系统管理员，我希望批量向量化时能正确识别已有嵌入记录的条文，以便跳过无需更新的条文，提高处理效率。

#### 验收标准

1. WHEN 批量向量化 API 查询已有嵌入记录时，THE Batch_Embed_API SHALL 使用 `articles_id` 字段名（蛇形命名）而非 `articleId`（驼峰命名）
2. WHEN 条文已有嵌入记录且未被编辑，THE Batch_Embed_API SHALL 跳过该条文并计入 `alreadyUpToDate` 统计
3. WHEN 条文已有嵌入记录但被编辑过（lastEditedAt > lastEmbeddingAt），THE Batch_Embed_API SHALL 重新嵌入该条文

### 需求 2：修复全量更新保存后向量化触发失败

**用户故事：** 作为系统管理员，我希望全量更新保存法律内容后能自动触发向量化，以便新保存的条文能被检索到。

#### 验收标准

1. WHEN 全量更新保存成功后，THE Batch_Save_API SHALL 直接调用向量化服务函数而非通过 API
2. WHEN 向量化服务调用失败，THE Batch_Save_API SHALL 记录错误日志但不影响保存结果
3. WHEN 向量化完成后，THE System SHALL 返回正确的处理统计信息

### 需求 3：全量更新保存时删除旧嵌入记录

**用户故事：** 作为系统管理员，我希望全量更新保存时能删除旧条文对应的嵌入记录，以避免检索到已删除的条文。

#### 验收标准

1. WHEN 全量更新保存开始时，THE Batch_Save_API SHALL 删除该法律下所有旧条文的嵌入记录
2. WHEN 嵌入记录删除完成后，THE Batch_Save_API SHALL 继续执行条文保存和新嵌入创建
3. WHEN 嵌入记录删除失败，THE Batch_Save_API SHALL 记录错误日志但不影响保存流程

### 需求 4：日志和调试信息

**用户故事：** 作为开发人员，我希望能通过日志了解向量化处理的详细情况，以便排查问题。

#### 验收标准

1. WHEN 批量向量化开始处理时，THE Batch_Embed_API SHALL 记录待处理条文数量
2. WHEN 条文被跳过时，THE Batch_Embed_API SHALL 在调试日志中记录跳过原因
3. WHEN 批量向量化完成时，THE Batch_Embed_API SHALL 记录完整的处理统计信息
