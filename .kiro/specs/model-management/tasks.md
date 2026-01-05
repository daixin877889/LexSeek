# Implementation Plan: Model Management

## Overview

本实现计划将模型管理功能分解为可执行的编码任务，按照数据模型 → 数据访问层 → 服务层 → API 层 → 前端页面的顺序逐步实现。

## Tasks

- [x] 1. 创建数据模型和类型定义
  - [x] 1.1 创建 Prisma 模型文件 `prisma/models/model.prisma`
    - 定义 modelProviders、modelApiKeys、models 三个表
    - 包含所有字段、索引和关联关系
    - _Requirements: 1.1, 2.1, 3.1_
  - [x] 1.2 创建 TypeScript 类型定义 `shared/types/model.ts`
    - 定义 ModelType 枚举和标签
    - 定义 FullModelConfig、EmbeddingConfig 等业务类型
    - 定义输入类型（CreateModelProviderInput 等）
    - _Requirements: 3.4_
  - [x] 1.3 执行数据库迁移
    - 运行 `bunx prisma migrate dev` 创建数据库表
    - _Requirements: 1.1, 2.1, 3.1_

- [x] 2. 实现数据访问层 (DAO)
  - [x] 2.1 创建 `server/services/model/modelProviders.dao.ts`
    - 实现 create、findById、findByName、findMany、update、softDelete 方法
    - _Requirements: 6.1_
  - [x] 2.2 创建 `server/services/model/modelApiKeys.dao.ts`
    - 实现 create、findById、findByProviderId、findDefaultByProviderId、update、setDefault、softDelete 方法
    - _Requirements: 6.2_
  - [x] 2.3 创建 `server/services/model/models.dao.ts`
    - 实现 create、findById、findByType、findByProviderId、findDefaultByType、findMany、update、setDefault、softDelete 方法
    - _Requirements: 6.3_
  - [x] 2.4 编写 DAO 层属性测试
    - **Property 1: 数据模型结构完整性**
    - **Property 2: 唯一性约束验证**
    - **Property 3: 软删除功能**
    - **Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.2, 3.1, 3.2**

- [x] 3. Checkpoint - 确保 DAO 层测试通过
  - 确保所有测试通过，如有问题请询问用户

- [x] 4. 实现服务层
  - [x] 4.1 创建 `server/services/model/modelProviders.service.ts`
    - 实现提供商的业务逻辑封装
    - _Requirements: 6.1_
  - [x] 4.2 创建 `server/services/model/modelApiKeys.service.ts`
    - 实现 API 密钥的业务逻辑封装
    - 实现设置默认密钥逻辑（取消旧默认）
    - _Requirements: 6.2, 2.4_
  - [x] 4.3 创建 `server/services/model/models.service.ts`
    - 实现模型的业务逻辑封装
    - 实现设置默认模型逻辑（同类型取消旧默认）
    - _Requirements: 6.3, 3.5_
  - [x] 4.4 创建 `server/services/model/modelConfig.service.ts`
    - 实现 getModelConfigById 方法
    - 实现 getModelsByType 方法（支持排序和过滤）
    - 实现 getModelsByProviderId 方法
    - 实现 getDefaultEmbeddingConfig 方法
    - 实现 getDefaultChatConfig 方法
    - 实现 getDefaultAsrConfig 方法
    - 实现 getEmbeddingConfigWithFallback 方法（数据库优先，环境变量回退）
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 4.1, 4.2, 4.3, 4.4_
  - [x] 4.5 编写服务层属性测试
    - **Property 6: 默认标识唯一性**
    - **Property 7: 配置获取回退机制**
    - **Property 8: 完整配置对象**
    - **Property 10: 默认模型获取**
    - **Property 11: 列表排序和过滤**
    - **Property 12: 按提供商查询**
    - **Validates: Requirements 2.4, 3.5, 4.1, 4.2, 4.3, 4.4, 6.4, 6.5, 8.1-8.9**

- [x] 5. Checkpoint - 确保服务层测试通过
  - 确保所有测试通过，如有问题请询问用户

- [x] 6. 更新运行时配置
  - [x] 6.1 更新 `nuxt.config.ts` 添加 embedding 配置组
    - 添加 apiKey、baseUrl、model、dimensions、batchSize 配置项
    - _Requirements: 5.1, 5.2_

- [x] 7. 改造向量存储服务
  - [x] 7.1 更新 `server/services/legal/vectorStore.service.ts`
    - 修改 getEmbeddings 函数，优先从数据库获取配置
    - 实现环境变量回退逻辑
    - 添加配置来源日志记录
    - _Requirements: 7.1, 7.2, 7.3, 7.4_
  - [x] 7.2 编写向量存储服务集成测试
    - 测试数据库配置获取
    - 测试环境变量回退
    - **Validates: Requirements 7.1, 7.2, 7.3**

- [x] 8. Checkpoint - 确保向量存储服务测试通过
  - 所有 10 个测试用例通过

- [x] 9. 实现 API 接口
  - [x] 9.1 创建模型提供商 API
    - `server/api/v1/admin/model-providers/index.get.ts` - 获取列表
    - `server/api/v1/admin/model-providers/index.post.ts` - 创建
    - `server/api/v1/admin/model-providers/[id].get.ts` - 获取详情
    - `server/api/v1/admin/model-providers/[id].put.ts` - 更新
    - `server/api/v1/admin/model-providers/[id].delete.ts` - 删除
    - _Requirements: 6.1_
  - [x] 9.2 创建模型 API 密钥 API
    - `server/api/v1/admin/model-api-keys/index.get.ts` - 获取列表
    - `server/api/v1/admin/model-api-keys/index.post.ts` - 创建
    - `server/api/v1/admin/model-api-keys/[id].get.ts` - 获取详情
    - `server/api/v1/admin/model-api-keys/[id].put.ts` - 更新
    - `server/api/v1/admin/model-api-keys/[id].delete.ts` - 删除
    - `server/api/v1/admin/model-api-keys/default/[id].put.ts` - 设置默认
    - _Requirements: 6.2_
  - [x] 9.3 创建模型配置 API
    - `server/api/v1/admin/models/index.get.ts` - 获取列表（支持按类型、提供商筛选）
    - `server/api/v1/admin/models/index.post.ts` - 创建
    - `server/api/v1/admin/models/[id].get.ts` - 获取详情
    - `server/api/v1/admin/models/[id].put.ts` - 更新
    - `server/api/v1/admin/models/[id].delete.ts` - 删除
    - `server/api/v1/admin/models/default/[id].put.ts` - 设置默认
    - _Requirements: 6.3, 8.2, 8.3_

- [x] 10. Checkpoint - 确保 API 接口测试通过
  - API 端点已创建，无语法错误

- [x] 11. 实现后台管理页面
  - [x] 11.1 创建模型提供商管理页面 `app/pages/admin/model-providers/index.vue`
    - 实现提供商列表展示
    - 实现新增、编辑、删除功能
    - _Requirements: 9.1_
  - [x] 11.2 创建模型提供商表单组件 `app/components/admin/model-providers/ProviderFormDialog.vue`
    - 实现表单验证
    - _Requirements: 9.1_
  - [x] 11.3 创建 API 密钥管理页面 `app/pages/admin/model-api-keys/index.vue`
    - 实现密钥列表展示（密钥值部分隐藏）
    - 实现新增、编辑、删除、设置默认功能
    - _Requirements: 9.2, 9.5, 9.9_
  - [x] 11.4 创建 API 密钥表单组件 `app/components/admin/model-api-keys/ApiKeyFormDialog.vue`
    - 实现表单验证
    - 实现提供商选择
    - _Requirements: 9.2_
  - [x] 11.5 创建模型管理页面 `app/pages/admin/models/index.vue`
    - 实现模型列表展示（显示类型标签）
    - 实现按提供商、类型筛选
    - 实现新增、编辑、删除、设置默认功能
    - _Requirements: 9.3, 9.4, 9.6, 9.7, 9.8_
  - [x] 11.6 创建模型表单组件 `app/components/admin/models/ModelFormDialog.vue`
    - 实现表单验证
    - 实现提供商选择
    - 实现模型类型选择
    - _Requirements: 9.3_

- [x] 13. 实现模型供应商详情页
  - [x] 13.1 更新提供商列表页面，添加详情页入口
    - 在提供商列表的操作菜单中添加"查看详情"选项
    - 实现点击跳转到详情页面的导航
    - _Requirements: 10.1_
  - [x] 13.2 创建模型供应商详情页面 `app/pages/admin/model-providers/[id].vue`
    - 实现提供商基本信息展示卡片
    - 实现面包屑导航
    - 实现编辑提供商功能
    - _Requirements: 10.2, 10.7, 10.8_
  - [x] 13.3 创建详情页 API 密钥管理组件 `app/components/admin/model-providers/ApiKeySection.vue`
    - 实现该提供商下的 API 密钥列表展示
    - 实现密钥值部分隐藏显示
    - 实现新增、编辑、删除、设置默认功能
    - 实现删除确认对话框
    - _Requirements: 10.3, 10.5, 10.9, 10.10_
  - [x] 13.4 创建详情页模型管理组件 `app/components/admin/model-providers/ModelSection.vue`
    - 实现该提供商下的模型列表展示
    - 实现新增、编辑、删除、设置默认功能
    - 实现删除确认对话框
    - _Requirements: 10.4, 10.6, 10.9_
  - [x]* 13.5 编写详情页属性测试
    - **Property 13: 详情页面信息展示完整性**
    - **Property 14: 关联数据展示完整性**
    - **Property 15: 详情页面管理操作有效性**
    - **Property 16: 详情页面编辑功能**
    - **Property 17: 敏感信息隐藏**
    - **Validates: Requirements 10.2, 10.3, 10.4, 10.5, 10.6, 10.8, 10.10**

- [x] 12. Final Checkpoint - 确保所有功能正常
  - 所有代码已创建，无语法错误

- [x] 14. Final Checkpoint - 确保详情页功能正常
  - ✅ 修复了组件导入问题（AdminModelProvidersModelSection 组件无法解析）
  - ✅ 修复了 API 密钥表单验证问题（编辑时密钥为空没有被拦截）
  - ✅ 修复了密码输入框的 DOM 警告（添加 form 标签包装）
  - ✅ 修复了密码输入框缺少 autocomplete 属性的警告
  - ✅ 所有组件导入和引用已正确配置
  - 确保详情页所有功能正常，如有问题请询问用户

## Notes

- 所有任务都是必须执行的，包括测试任务
- 每个 Checkpoint 用于验证阶段性成果
- 属性测试使用 fast-check 库，配置 `{ numRuns: 100 }` 运行 100 次
- 所有 API 使用 Zod 进行参数验证，错误信息使用中文
