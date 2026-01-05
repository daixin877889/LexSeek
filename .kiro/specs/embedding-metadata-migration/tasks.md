# 实现计划: Embedding Metadata 迁移

## 概述

将当前项目的 `law_embeddings` 表 metadata 结构调整为与旧项目一致，涉及类型定义、服务层、数据访问层和搜索工具的修改。

## 任务

- [x] 1. 更新类型定义
  - [x] 1.1 更新 LawEmbeddingMetadata 接口为 snake_case 命名
    - 修改 `shared/types/legal.ts`
    - 新增 `TextLocation` 接口
    - 将所有字段改为 snake_case
    - 新增 `issuing_authority`、`document_number`、`last_edited_at`、`loc` 字段
    - 移除 `isValid`、`legalCode`、`hierarchyPath` 字段
    - 将 `chapter_hierarchy` 类型改为 `string[]`
    - _需求: 7.1, 7.2, 7.3, 7.4_

- [x] 2. 更新服务层
  - [x] 2.1 重构 buildEmbeddingMetadata 函数
    - 修改 `server/services/legal/lawEmbedding.service.ts`
    - 输出字段改为 snake_case
    - 新增 `issuing_authority`、`document_number`、`last_edited_at` 字段
    - 将 `hierarchyPath` 改为 `chapter_hierarchy` 数组
    - 日期格式改为 ISO 8601 带时区格式
    - _需求: 1.1-1.9, 2.1-2.4, 3.1-3.3, 5.1-5.5_
  - [x] 2.2 更新 getLegalTypeName 函数
    - 确保法律类型转换为中文
    - _需求: 4.1-4.4_
  - [x] 2.3 更新 updateEmbeddingsValidStatus 函数
    - 修改 SQL 更新语句使用 snake_case 字段名
    - 移除 `isValid` 字段更新逻辑
    - _需求: 6.3_
  - [x] 2.4 编写 buildEmbeddingMetadata 属性测试
    - **Property 1: Metadata 字段命名符合 snake_case 规范**
    - **Property 2: Metadata 包含所有必需的旧项目字段**
    - **Property 3: Metadata 不包含已移除的字段**
    - **验证: 需求 1.1-1.9, 2.1-2.4, 3.1-3.3**
  - [x] 2.5 编写法律类型转换属性测试
    - **Property 4: legal_type 字段值为中文**
    - **验证: 需求 4.1-4.4**
  - [x] 2.6 编写日期格式化属性测试
    - **Property 5: 日期字段格式符合 ISO 8601 带时区格式**
    - **验证: 需求 5.1-5.5**
  - [x] 2.7 编写 chapter_hierarchy 属性测试
    - **Property 6: chapter_hierarchy 为字符串数组**
    - **验证: 需求 1.9**

- [x] 3. 检查点 - 确保服务层测试通过
  - 确保所有测试通过，如有问题请询问用户

- [x] 4. 更新数据访问层
  - [x] 4.1 更新 lawEmbeddings.dao.ts 查询字段名
    - 将 `metadata->>'legalId'` 改为 `metadata->>'legal_id'`
    - 将 `metadata->>'articleId'` 改为 `metadata->>'articles_id'`
    - 将 `metadata->>'hierarchyPath'` 改为 `metadata->>'chapter_hierarchy'`
    - _需求: 6.1, 6.2, 6.4_
  - [x] 4.2 更新 legalMain.service.ts 查询字段名
    - 修改统计查询中的 metadata 字段访问
    - _需求: 6.1, 6.2_

- [x] 5. 更新搜索工具
  - [x] 5.1 更新 searchLaw.tool.ts 向量搜索过滤器
    - 将过滤器字段名改为 snake_case
    - _需求: 6.1, 6.2_
  - [x] 5.2 更新 searchLaw.tool.ts SQL 查询字段名
    - 将 SQL 查询中的 metadata 字段访问改为 snake_case
    - _需求: 6.1, 6.2_
  - [x] 5.3 更新 searchLawService 返回值映射
    - 将返回值中的 metadata 字段访问改为 snake_case
    - _需求: 6.1, 6.2_

- [x] 6. 更新 API 层
  - [x] 6.1 更新 law-embeddings API 的元数据更新逻辑
    - 修改 `server/api/v1/admin/law-embeddings/[id].put.ts`
    - 使用 snake_case 字段名
    - _需求: 6.3_

- [x] 7. 检查点 - 确保所有修改完成
  - 确保所有测试通过，如有问题请询问用户
  - 运行 TypeScript 类型检查确保无编译错误

## 注意事项

- 每个任务都引用了具体的需求以便追溯
- 检查点用于确保增量验证
- 属性测试验证通用正确性属性
