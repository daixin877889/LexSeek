# 设计文档

## 概述

本设计修复法律法规批量向量化功能的两个问题：
1. 元数据字段名不匹配导致智能跳过逻辑失效
2. 确保全量更新保存后正确触发向量化

## 架构

### 现有架构

```
全量更新页面 → batch-save API → batch-embed API → lawEmbedding.service
                    ↓                   ↓
              保存条文到数据库      查询/更新向量嵌入
```

### 问题分析

1. **元数据字段名不匹配**
   - `lawEmbedding.service.ts` 中 `buildEmbeddingMetadata` 使用 `articles_id`（蛇形命名）
   - `batch-embed.post.ts` 中查询使用 `articleId`（驼峰命名）
   - 导致查询结果始终为空，所有条文都被认为需要重新嵌入

2. **全量更新保存后向量化**
   - 当前代码逻辑正确，但需要验证内部请求头是否正确传递

## 组件和接口

### 修改文件

1. `server/api/v1/admin/legal-articles/batch-embed.post.ts`
   - 修复 SQL 查询中的字段名

### 代码修改

#### batch-embed.post.ts 修复

```typescript
// 修复前（错误）
const embeddedResult = await pool.query(
    `SELECT DISTINCT metadata->>'articleId' as article_id 
     FROM law_embeddings 
     WHERE metadata->>'articleId' = ANY($1)`,
    [articleIdsToCheck]
)

// 修复后（正确）
const embeddedResult = await pool.query(
    `SELECT DISTINCT metadata->>'articles_id' as article_id 
     FROM law_embeddings 
     WHERE metadata->>'articles_id' = ANY($1)`,
    [articleIdsToCheck]
)
```

## 数据模型

### 向量嵌入元数据结构（无变化）

```typescript
interface LawEmbeddingMetadata {
    articles_id: string      // 条文 ID（蛇形命名）
    legal_id: string         // 法律 ID
    legal_name: string       // 法律名称
    legal_type: string       // 法律类型
    article_type: string     // 条文类型
    chapter_hierarchy: string[] // 章节层级
    issuing_authority: string   // 发文机关
    document_number: string     // 文号
    publish_date: string | null // 发布日期
    effective_date: string | null // 生效日期
    invalid_date: string | null   // 失效日期
    last_edited_at: string | null // 最后编辑时间
    last_embedding_at: string     // 最后嵌入时间
}
```

## 正确性属性

*正确性属性是指在系统所有有效执行中都应保持为真的特征或行为——本质上是关于系统应该做什么的形式化陈述。属性作为人类可读规范和机器可验证正确性保证之间的桥梁。*

### 属性 1：智能跳过逻辑正确性

*对于任意*条文，如果该条文已有嵌入记录且 `lastEditedAt <= lastEmbeddingAt`，则批量向量化应跳过该条文；如果 `lastEditedAt > lastEmbeddingAt` 或无嵌入记录，则应重新嵌入。

**验证：需求 1.1, 1.2, 1.3**

### 属性 2：统计信息准确性

*对于任意*批量向量化处理结果，返回的统计信息（total、processed、skipped、upToDate、failed）之和应等于输入条文总数。

**验证：需求 2.3**

## 错误处理

1. **向量化 API 调用失败**
   - 记录错误日志
   - 不影响保存结果
   - 返回保存成功响应

2. **单个条文嵌入失败**
   - 记录错误到 errors 数组
   - 继续处理其他条文
   - 在响应中返回失败统计

## 测试策略

### 单元测试

1. **SQL 查询字段名测试**
   - 验证查询使用正确的 `articles_id` 字段名
   - 验证查询结果正确映射

2. **跳过逻辑测试**
   - 测试已有嵌入且未编辑的条文被跳过
   - 测试已有嵌入但已编辑的条文被重新嵌入
   - 测试无嵌入记录的条文被嵌入

### 属性测试

使用 Vitest 进行属性测试，每个属性至少运行 100 次迭代。

1. **属性 1 测试**：生成随机条文状态，验证跳过逻辑正确性
2. **属性 2 测试**：生成随机处理结果，验证统计信息准确性
