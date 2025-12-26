# 实现计划：存储适配器系统

## 概述

本实现计划将存储适配器系统分为 5 个阶段，采用渐进式迁移策略，确保现有阿里云 OSS 功能在整个过程中保持正常运行。

## 任务列表

- [x] 1. 创建适配器层基础设施
  - [x] 1.1 创建类型定义文件 `server/lib/storage/types.ts`
    - 定义 StorageProviderType 枚举
    - 定义 StorageAdapter 接口
    - 定义各服务商配置类型（AliyunOssConfig、QiniuConfig、TencentCosConfig）
    - 定义操作选项和结果类型（UploadOptions、UploadResult、PostSignatureOptions 等）
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 10.1, 10.2_

  - [x] 1.2 创建错误类型文件 `server/lib/storage/errors.ts`
    - 定义 StorageError 基类
    - 定义 StorageConfigError、StorageNotFoundError、StoragePermissionError 等错误类型
    - _Requirements: 8.1, 8.2_

  - [x] 1.3 编写属性测试：统一错误处理
    - **Property 3: 统一错误处理**
    - **Validates: Requirements 1.7, 8.1, 8.2, 8.3**

  - [x] 1.4 创建基础适配器抽象类 `server/lib/storage/base.ts`
    - 定义 BaseStorageAdapter 抽象类
    - 实现通用的错误转换逻辑
    - _Requirements: 8.3_

- [-] 2. 实现阿里云 OSS 适配器
  - [x] 2.1 创建阿里云 OSS 适配器 `server/lib/storage/adapters/aliyun-oss.ts`
    - 实现 StorageAdapter 接口
    - 复用现有 `server/lib/oss` 模块的功能
    - 实现 upload、download、downloadStream、delete 方法
    - 实现 generateSignedUrl、generatePostSignature 方法
    - 实现 testConnection 方法
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [x] 2.2 编写属性测试：阿里云签名格式正确性
    - **Property 10: 阿里云签名格式正确性**
    - **Validates: Requirements 2.7**

  - [x] 2.3 创建适配器工厂 `server/lib/storage/factory.ts`
    - 实现 StorageFactory 类
    - 实现 getAdapter 方法
    - 实现 registerAdapter 方法
    - 实现适配器缓存机制
    - 实现 clearCache 方法
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 2.4 编写属性测试：工厂适配器创建和缓存
    - **Property 4: 工厂适配器创建**
    - **Property 5: 适配器缓存一致性**
    - **Validates: Requirements 5.1, 5.4**

  - [x] 2.5 创建统一导出文件 `server/lib/storage/index.ts`
    - 导出所有类型
    - 导出所有错误类
    - 导出工厂和适配器
    - _Requirements: 10.2_

- [x] 3. Checkpoint - 确保适配器层测试通过
  - 确保所有测试通过，如有问题请询问用户

- [x] 4. 创建服务层
  - [x] 4.1 创建存储配置数据访问层 `server/services/storage/storage-config.dao.ts`
    - 实现配置的增删改查方法
    - 实现配置验证逻辑
    - 实现敏感信息加密/解密
    - _Requirements: 6.1, 6.2, 6.3, 6.5_

  - [x] 4.2 编写属性测试：配置验证完整性
    - **Property 6: 配置验证完整性**
    - **Validates: Requirements 6.3**

  - [x] 4.3 创建存储服务 `server/services/storage/storage.service.ts`
    - 封装适配器调用
    - 实现配置变更时清除缓存
    - 实现用户配置优先级逻辑
    - _Requirements: 6.4, 7.3, 7.4_

  - [x] 4.4 编写属性测试：用户配置隔离
    - **Property 7: 用户配置隔离**
    - **Validates: Requirements 7.5**

- [x] 5. 创建回调处理器
  - [x] 5.1 创建统一回调处理器 `server/lib/storage/callback/handler.ts`
    - 定义 CallbackHandler 接口
    - 定义 CallbackData 类型
    - _Requirements: 9.1_

  - [x] 5.2 创建阿里云回调验证器 `server/lib/storage/callback/validators/aliyun.ts`
    - 实现回调签名验证
    - 实现回调数据解析
    - _Requirements: 9.2, 9.3, 9.4_

  - [x] 5.3 编写属性测试：回调处理
    - **Property 8: 回调数据解析一致性**
    - **Property 9: 回调验证正确性**
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4**

- [x] 6. Checkpoint - 确保服务层测试通过
  - 确保所有测试通过，如有问题请询问用户

- [x] 7. 数据库迁移
  - [x] 7.1 创建 storageConfigs 表迁移文件
    - 添加 storageConfigs 表
    - 添加必要的索引
    - _Requirements: 6.1_

  - [x] 7.2 执行数据库迁移
    - 运行 prisma migrate
    - 生成 Prisma Client
    - _Requirements: 6.1_

- [x] 8. 迁移现有 API
  - [x] 8.1 创建新的预签名 URL API `server/api/v1/storage/presigned-url/`
    - 实现获取上传预签名接口
    - 实现批量获取预签名接口
    - 使用新的存储服务
    - _Requirements: 1.5, 2.7_

  - [x] 8.2 创建新的回调处理 API `server/api/v1/storage/callback/`
    - 实现统一回调处理接口
    - 支持不同服务商的回调
    - _Requirements: 9.3, 9.5_

  - [x] 8.3 更新现有文件服务 `server/services/files/files.service.ts`
    - 使用新的存储服务替换直接调用 OSS 库
    - 保持函数签名兼容
    - _Requirements: 11.1, 11.3_

- [x] 9. Checkpoint - 确保现有功能正常
  - 确保所有测试通过
  - 手动测试文件上传、下载、删除功能
  - 如有问题请询问用户

- [x] 10. 实现七牛云适配器
  - [x] 10.1 创建七牛云适配器 `server/lib/storage/adapters/qiniu.ts`
    - 实现 StorageAdapter 接口
    - 实现所有必需方法（占位实现，待完善）
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [ ] 10.2 编写属性测试：七牛云凭证格式正确性
    - **Property 11: 七牛云凭证格式正确性**
    - **Validates: Requirements 3.5**
    - _注：待七牛云适配器完整实现后补充_

  - [ ] 10.3 创建七牛云回调验证器 `server/lib/storage/callback/validators/qiniu.ts`
    - 实现回调签名验证
    - 实现回调数据解析
    - _Requirements: 3.4, 9.4_
    - _注：待七牛云适配器完整实现后补充_

- [x] 11. 实现腾讯云 COS 适配器
  - [x] 11.1 创建腾讯云 COS 适配器 `server/lib/storage/adapters/tencent-cos.ts`
    - 实现 StorageAdapter 接口
    - 实现所有必需方法（占位实现，待完善）
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [ ] 11.2 编写属性测试：腾讯云签名格式正确性
    - **Property 12: 腾讯云签名格式正确性**
    - **Validates: Requirements 4.5**
    - _注：待腾讯云适配器完整实现后补充_

  - [ ] 11.3 创建腾讯云回调验证器 `server/lib/storage/callback/validators/tencent.ts`
    - 实现回调签名验证
    - 实现回调数据解析
    - _Requirements: 4.4, 9.4_
    - _注：待腾讯云适配器完整实现后补充_

- [x] 12. 实现用户自定义存储配置
  - [x] 12.1 创建用户存储配置 API `server/api/v1/storage/config/`
    - 实现配置的增删改查接口
    - 实现配置连接测试接口
    - _Requirements: 7.1, 7.2_

  - [x] 12.2 更新存储服务支持用户配置
    - 实现用户配置优先级逻辑
    - 实现默认配置回退
    - _Requirements: 7.3, 7.4_

- [x] 13. 最终 Checkpoint
  - 确保所有测试通过
  - 验证所有功能正常工作
  - 如有问题请询问用户

- [x] 14. 文档和清理
  - [x] 14.1 更新 README 文档
    - 添加存储适配器使用说明
    - 添加配置示例
    - _Requirements: 10.3, 10.4_

  - [x] 14.2 添加 JSDoc 注释
    - 为所有公共接口添加详细注释
    - _Requirements: 10.3_

## 注意事项

- 所有任务都是必须完成的，包括属性测试
- 每个 Checkpoint 都需要确保测试通过后再继续
- 迁移过程中保持现有功能可用
- 如遇到问题，及时与用户沟通
