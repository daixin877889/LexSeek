# 实现计划：模型管理

## 任务列表

- [x] 1. 创建数据模型
- [x] 2. 实现模型提供商管理
- [x] 3. 实现模型管理
- [x] 4. 实现 API 密钥管理
- [x] 5. 实现后台管理页面

- [x] 6. SDK 类型功能
  - [x] 6.1 数据模型扩展
    - [x] 6.1.1 在 `prisma/models/model.prisma` 的 models 表添加 sdkType 字段
    - [x] 6.1.2 创建数据库迁移并执行
  - [x] 6.2 类型定义扩展
    - [x] 6.2.1 在 `shared/types/model.ts` 添加 SdkType 类型和相关常量
    - [x] 6.2.2 更新 CreateModelInput 和 UpdateModelInput 类型
  - [x] 6.3 服务层扩展
    - [x] 6.3.1 更新 `server/services/model/models.dao.ts` 支持 sdkType 字段
    - [x] 6.3.2 更新 `server/services/model/models.service.ts` 支持 sdkType 字段
  - [x] 6.4 API 层扩展
    - [x] 6.4.1 更新模型创建 API 支持 sdkType 参数
    - [x] 6.4.2 更新模型更新 API 支持 sdkType 参数
  - [x] 6.5 前端扩展
    - [x] 6.5.1 更新 `app/components/admin/models/ModelFormDialog.vue` 添加 SDK 类型选择器
    - [x] 6.5.2 更新 `app/pages/admin/models/index.vue` 列表显示 SDK 类型
  - [x] 6.6 聊天模型工厂
    - [x] 6.6.1 创建 `server/services/node/chatModelFactory.ts` 聊天模型工厂
    - [x] 6.6.2 更新 `server/services/node/node.service.ts` NodeConfig 添加 modelSdkType
    - [x] 6.6.3 重构现有节点服务使用 chatModelFactory

## 实现状态

- ✅ 基础模型管理功能：已完成
- 🔄 SDK 类型功能：待实现
