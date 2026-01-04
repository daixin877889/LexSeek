# 实现计划: 法律知识库

## 概述

本实现计划将法律知识库功能分解为可执行的编码任务，按照数据库模型 → 服务层 → API 层 → 前端界面的顺序逐步实现。

## 任务

- [x] 1. 数据库模型定义
  - [x] 1.1 创建 legal.prisma 模型文件
    - 定义 legalMain 模型，包含所有必需字段和索引
    - 定义 legalArticles 模型，包含层级字段和外键关联
    - 定义 lawEmbeddings 模型（保持原有设计）
    - _需求: 1.1, 1.2, 1.3, 1.4, 1.5_
  - [x] 1.2 运行数据库迁移
    - 执行 prisma migrate 生成迁移文件
    - 验证表结构正确创建
    - _需求: 1.1, 1.2, 1.3_

- [x] 2. 类型定义和常量
  - [x] 2.1 创建法律知识库类型定义
    - 在 shared/types/legal.ts 中定义类型
    - 定义 LegalType、ArticleType 枚举
    - 定义 API 请求和响应类型
    - _需求: 1.1, 1.2_

- [x] 3. 数据访问层 (DAO)
  - [x] 3.1 创建 legalMain.dao.ts
    - 实现 CRUD 操作函数
    - 实现分页查询和筛选功能
    - _需求: 2.1, 2.2, 2.3, 2.4, 2.5_
  - [x] 3.2 创建 legalArticles.dao.ts
    - 实现 CRUD 操作函数
    - 实现按 legalId 查询功能
    - _需求: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 4. 检查点 - 确保数据库层正常工作
  - 确保所有 DAO 函数可正常调用
  - 如有问题请询问用户

- [x] 5. 向量存储服务
  - [x] 5.1 创建 vectorStore.service.ts
    - 实现 PGVectorStore 初始化和实例缓存
    - 实现 OpenAI 兼容的嵌入模型配置
    - 实现添加文档和删除嵌入方法
    - _需求: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_
  - [x] 5.2 编写向量存储服务属性测试
    - **Property 11: 向量存储实例复用**
    - **验证: 需求 7.5**

- [x] 6. 向量嵌入服务
  - [x] 6.1 创建 lawEmbedding.service.ts
    - 实现嵌入文本构建函数
    - 实现元数据构建函数
    - 实现 embedLawArticle 方法
    - 实现 deleteEmbeddingsByArticleId 方法
    - 实现 updateLegalEmbeddings 方法
    - _需求: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_
  - [x] 6.2 编写向量嵌入服务属性测试
    - **Property 4: 向量嵌入元数据完整性**
    - **Property 12: 空内容跳过嵌入**
    - **验证: 需求 4.4, 4.6**

- [x] 7. 法律法规服务层
  - [x] 7.1 创建 legalMain.service.ts
    - 实现获取列表服务（分页、筛选、排序）
    - 实现获取详情服务
    - 实现创建服务
    - 实现更新服务（含 lastEditedAt 更新）
    - 实现删除服务（软删除）
    - 实现失效状态同步服务
    - _需求: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 5.1, 5.2, 5.3_
  - [x] 7.2 编写法律法规服务属性测试
    - **Property 1: 法律法规 CRUD 操作一致性**
    - **Property 3: 软删除一致性**
    - **Property 6: 失效状态级联更新**
    - **验证: 需求 2.2, 2.3, 2.5, 5.1, 5.2**

- [x] 8. 法律条文服务层
  - [x] 8.1 创建 legalArticles.service.ts
    - 实现获取列表服务（按 legalId）
    - 实现获取详情服务
    - 实现创建服务（含触发嵌入）
    - 实现更新服务（含触发重新嵌入）
    - 实现删除服务（含删除嵌入）
    - _需求: 3.1, 3.2, 3.3, 3.4, 3.5_
  - [x] 8.2 编写法律条文服务属性测试
    - **Property 2: 法律条文与法律法规关联完整性**
    - **Property 5: 条文更新触发重新嵌入**
    - **验证: 需求 1.4, 3.1, 3.4, 4.2**

- [x] 9. 检查点 - 确保服务层正常工作
  - 确保所有服务函数可正常调用
  - 如有问题请询问用户

- [x] 10. 法律搜索工具
  - [x] 10.1 创建 searchLawTool.ts
    - 实现向量语义搜索模式
    - 实现 SQL 元数据筛选模式
    - 实现日期过滤功能（东八区时区）
    - 实现有效性过滤功能
    - 实现分页功能
    - 使用 @langchain/core/tools 定义工具
    - _需求: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_
  - [x] 10.2 编写法律搜索工具属性测试
    - **Property 7: 搜索结果格式一致性**
    - **Property 8: 向量搜索与 SQL 搜索模式切换**
    - **Property 9: 日期过滤时区一致性**
    - **Property 10: 分页结果数量约束**
    - **验证: 需求 8.1, 8.5, 8.6, 8.7**

- [x] 11. 法律法规管理 API
  - [x] 11.1 创建 GET /api/v1/admin/legal-main/index.get.ts
    - 实现分页查询
    - 实现筛选和排序
    - 参数验证使用 zod
    - _需求: 2.1_
  - [x] 11.2 创建 GET /api/v1/admin/legal-main/[id].get.ts
    - 实现获取详情
    - _需求: 2.2_
  - [x] 11.3 创建 POST /api/v1/admin/legal-main/index.post.ts
    - 实现创建法律法规
    - 参数验证使用 zod
    - _需求: 2.3_
  - [x] 11.4 创建 PUT /api/v1/admin/legal-main/[id].put.ts
    - 实现更新法律法规
    - _需求: 2.4_
  - [x] 11.5 创建 DELETE /api/v1/admin/legal-main/[id].delete.ts
    - 实现软删除
    - _需求: 2.5_

- [x] 12. 法律条文管理 API
  - [x] 12.1 创建 GET /api/v1/admin/legal-articles/index.get.ts
    - 实现按 legalId 查询
    - _需求: 3.1_
  - [x] 12.2 创建 GET /api/v1/admin/legal-articles/[id].get.ts
    - 实现获取详情
    - _需求: 3.2_
  - [x] 12.3 创建 POST /api/v1/admin/legal-articles/index.post.ts
    - 实现创建条文
    - 触发向量嵌入
    - _需求: 3.3_
  - [x] 12.4 创建 PUT /api/v1/admin/legal-articles/[id].put.ts
    - 实现更新条文
    - 触发重新嵌入
    - _需求: 3.4_
  - [x] 12.5 创建 DELETE /api/v1/admin/legal-articles/[id].delete.ts
    - 实现软删除
    - 删除对应嵌入
    - _需求: 3.5_
  - [x] 12.6 创建 POST /api/v1/admin/legal-articles/[id]/embed.post.ts
    - 实现手动触发向量化
    - _需求: 6.7_

- [x] 13. 检查点 - 确保 API 层正常工作
  - 确保所有 API 接口可正常调用
  - 如有问题请询问用户

- [x] 14. 管理后台界面 - 法律法规管理
  - [x] 14.1 创建法律法规列表页面
    - 路径: app/pages/admin/legal-main/index.vue
    - 实现列表展示、搜索、筛选功能
    - _需求: 6.1, 6.2_
  - [x] 14.2 创建法律法规表单组件
    - 路径: app/components/legal/LegalMainForm.vue
    - 实现创建和编辑表单
    - _需求: 6.3_
  - [x] 14.3 创建法律法规详情页面
    - 路径: app/pages/admin/legal-main/[id].vue
    - 实现详情展示和编辑功能
    - _需求: 6.3_

- [x] 15. 管理后台界面 - 法律条文管理
  - [x] 15.1 创建法律条文列表组件
    - 路径: app/pages/admin/legal-main/[id]/articles.vue
    - 实现层级结构展示
    - 显示嵌入状态
    - _需求: 6.4, 6.6_
  - [x] 15.2 创建法律条文表单组件
    - 路径: app/components/legal/LegalArticleForm.vue
    - 实现创建和编辑表单
    - 包含内容编辑器
    - _需求: 6.5_
  - [x] 15.3 实现手动触发向量化功能
    - 在条文列表中添加重新向量化按钮
    - _需求: 6.7_

- [x] 16. 最终检查点 - 确保所有功能正常工作
  - 确保所有测试通过
  - 如有问题请询问用户

## 注意事项

- 所有任务均为必需任务
- 每个任务引用了具体的需求编号，便于追溯
- 检查点任务用于确保增量验证
- 属性测试验证系统的正确性属性

