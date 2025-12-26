# 需求文档

## 简介

设计一个通用的文件存储适配器系统，将当前与阿里云 OSS 紧耦合的文件系统抽象为可扩展的适配器架构。该系统需要支持多种云存储服务商（阿里云 OSS、七牛云、腾讯云 COS 等），并允许用户配置自己的存储服务。

**核心原则：向后兼容优先**
- 现有的阿里云 OSS 功能必须保持完全正常运行
- 重构过程采用渐进式迁移，不影响现有业务
- 新适配器系统与现有代码并行运行，逐步替换

## 术语表

- **Storage_Adapter**: 存储适配器，定义统一的文件操作接口的抽象层
- **Storage_Provider**: 存储服务商，如阿里云 OSS、七牛云、腾讯云 COS
- **Storage_Config**: 存储配置，包含服务商凭证和连接信息
- **Presigned_URL**: 预签名 URL，用于客户端直传或临时访问私有文件
- **Callback**: 回调，文件上传完成后云服务商向服务端发送的通知
- **STS**: 安全令牌服务，用于生成临时访问凭证

## 需求

### 需求 1：统一存储适配器接口

**用户故事：** 作为开发者，我希望有一个统一的存储接口，以便在不修改业务代码的情况下切换不同的存储服务商。

#### 验收标准

1. THE Storage_Adapter SHALL 定义统一的文件上传接口，支持 Buffer 和流式上传
2. THE Storage_Adapter SHALL 定义统一的文件下载接口，支持 Buffer 和流式下载
3. THE Storage_Adapter SHALL 定义统一的文件删除接口，支持单个和批量删除
4. THE Storage_Adapter SHALL 定义统一的预签名 URL 生成接口
5. THE Storage_Adapter SHALL 定义统一的客户端直传签名生成接口
6. WHEN 调用适配器方法时，THE Storage_Adapter SHALL 返回统一格式的结果对象
7. IF 操作失败，THEN THE Storage_Adapter SHALL 抛出统一的错误类型

### 需求 2：阿里云 OSS 适配器实现

**用户故事：** 作为开发者，我希望现有的阿里云 OSS 功能能够通过适配器接口访问，以便保持向后兼容。

#### 验收标准

1. THE Aliyun_OSS_Adapter SHALL 实现 Storage_Adapter 接口的所有方法
2. THE Aliyun_OSS_Adapter SHALL 复用现有的 `server/lib/oss` 模块实现
3. THE Aliyun_OSS_Adapter SHALL 支持 STS 临时凭证
4. THE Aliyun_OSS_Adapter SHALL 支持自定义域名（CDN 加速）
5. THE Aliyun_OSS_Adapter SHALL 支持上传回调配置
6. THE Aliyun_OSS_Adapter SHALL 支持 V4 签名算法
7. WHEN 生成客户端直传签名时，THE Aliyun_OSS_Adapter SHALL 返回符合阿里云 PostObject 规范的签名信息
8. THE Aliyun_OSS_Adapter SHALL 作为默认适配器，确保现有功能无缝运行
9. WHEN 未指定存储类型时，THE System SHALL 默认使用 Aliyun_OSS_Adapter

### 需求 3：七牛云存储适配器实现

**用户故事：** 作为开发者，我希望能够使用七牛云存储服务，以便根据业务需求选择合适的存储方案。

#### 验收标准

1. THE Qiniu_Adapter SHALL 实现 Storage_Adapter 接口的所有方法
2. THE Qiniu_Adapter SHALL 支持七牛云的上传凭证生成
3. THE Qiniu_Adapter SHALL 支持七牛云的私有空间访问签名
4. THE Qiniu_Adapter SHALL 支持七牛云的回调配置
5. WHEN 生成客户端直传签名时，THE Qiniu_Adapter SHALL 返回符合七牛云上传规范的凭证信息

### 需求 4：腾讯云 COS 适配器实现

**用户故事：** 作为开发者，我希望能够使用腾讯云 COS 存储服务，以便根据业务需求选择合适的存储方案。

#### 验收标准

1. THE Tencent_COS_Adapter SHALL 实现 Storage_Adapter 接口的所有方法
2. THE Tencent_COS_Adapter SHALL 支持腾讯云的临时密钥（STS）
3. THE Tencent_COS_Adapter SHALL 支持腾讯云的自定义域名
4. THE Tencent_COS_Adapter SHALL 支持腾讯云的回调配置
5. WHEN 生成客户端直传签名时，THE Tencent_COS_Adapter SHALL 返回符合腾讯云 COS 规范的签名信息

### 需求 5：适配器工厂和注册机制

**用户故事：** 作为开发者，我希望能够通过配置动态选择和创建存储适配器，以便灵活管理多种存储服务。

#### 验收标准

1. THE Storage_Factory SHALL 根据配置类型创建对应的适配器实例
2. THE Storage_Factory SHALL 支持注册自定义适配器
3. WHEN 请求未注册的适配器类型时，THE Storage_Factory SHALL 抛出明确的错误
4. THE Storage_Factory SHALL 支持适配器实例缓存，避免重复创建

### 需求 6：存储配置管理

**用户故事：** 作为系统管理员，我希望能够在数据库中管理多个存储配置，以便支持多租户或多存储场景。

#### 验收标准

1. THE Storage_Config_Service SHALL 支持从数据库读取存储配置
2. THE Storage_Config_Service SHALL 支持配置的增删改查操作
3. THE Storage_Config_Service SHALL 支持配置验证，确保必填字段完整
4. WHEN 配置发生变更时，THE Storage_Config_Service SHALL 清除相关的适配器缓存
5. THE Storage_Config_Service SHALL 支持敏感信息加密存储

### 需求 7：用户自定义存储配置

**用户故事：** 作为用户，我希望能够配置自己的云存储服务，以便使用自己的存储空间。

#### 验收标准

1. THE User_Storage_Config SHALL 允许用户添加自己的存储配置
2. THE User_Storage_Config SHALL 支持配置连接测试
3. WHEN 用户上传文件时，THE System SHALL 优先使用用户自定义的存储配置
4. IF 用户未配置自定义存储，THEN THE System SHALL 使用系统默认存储配置
5. THE User_Storage_Config SHALL 隔离不同用户的存储配置，确保数据安全

### 需求 8：统一错误处理

**用户故事：** 作为开发者，我希望有统一的错误处理机制，以便更好地处理各种存储操作异常。

#### 验收标准

1. THE Storage_Error SHALL 定义统一的错误基类
2. THE Storage_Error SHALL 包含错误码、错误消息和原始错误信息
3. THE Storage_Adapter SHALL 将各服务商的错误转换为统一的错误类型
4. IF 文件不存在，THEN THE Storage_Adapter SHALL 抛出 Storage_Not_Found_Error
5. IF 权限不足，THEN THE Storage_Adapter SHALL 抛出 Storage_Permission_Error
6. IF 配置错误，THEN THE Storage_Adapter SHALL 抛出 Storage_Config_Error
7. IF 网络错误，THEN THE Storage_Adapter SHALL 抛出 Storage_Network_Error

### 需求 9：回调处理统一化

**用户故事：** 作为开发者，我希望有统一的回调处理机制，以便简化不同存储服务商的回调处理逻辑。

#### 验收标准

1. THE Callback_Handler SHALL 定义统一的回调数据结构
2. THE Callback_Handler SHALL 支持验证回调请求的合法性
3. WHEN 收到回调请求时，THE Callback_Handler SHALL 解析并转换为统一格式
4. THE Callback_Handler SHALL 支持不同服务商的回调签名验证
5. IF 回调验证失败，THEN THE Callback_Handler SHALL 返回适当的错误响应

### 需求 10：类型安全和文档

**用户故事：** 作为开发者，我希望有完整的 TypeScript 类型定义和文档，以便更好地使用存储适配器。

#### 验收标准

1. THE Storage_Adapter SHALL 提供完整的 TypeScript 类型定义
2. THE Storage_Adapter SHALL 导出所有公共类型供外部使用
3. THE Storage_Adapter SHALL 提供详细的 JSDoc 注释
4. THE Storage_Adapter SHALL 提供使用示例和最佳实践文档


### 需求 11：向后兼容性保证

**用户故事：** 作为开发者，我希望重构后现有的所有文件操作功能都能正常工作，以便业务不受影响。

#### 验收标准

1. THE System SHALL 确保重构后所有现有文件功能正常运行
2. THE System SHALL 保持现有的数据库表结构（ossFiles）不变
3. THE System SHALL 保持现有的回调处理逻辑兼容
4. WHEN 重构完成后，THE System SHALL 支持文件上传、下载、删除、预览等所有现有功能
5. THE System SHALL 支持渐进式迁移，允许新旧代码并行运行
6. IF 适配器系统出现问题，THEN THE System SHALL 能够快速回退到原有实现
7. THE System SHALL 在重构过程中提供充分的测试覆盖

### 需求 12：迁移策略

**用户故事：** 作为开发者，我希望有清晰的迁移路径，以便安全地将现有代码迁移到新的适配器系统。

#### 验收标准

1. THE Migration_Strategy SHALL 提供兼容层，使现有代码无需修改即可运行
2. THE Migration_Strategy SHALL 支持逐步替换，一次迁移一个功能模块
3. THE Migration_Strategy SHALL 提供迁移检查清单和测试用例
4. WHEN 迁移完成后，THE System SHALL 能够移除兼容层代码
5. THE Migration_Strategy SHALL 记录所有需要修改的文件和函数
