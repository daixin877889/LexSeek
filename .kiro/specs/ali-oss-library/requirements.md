# 需求文档

## 简介

将阿里云 OSS 功能封装成一个通用的、可配置的库，支持在使用时传入所有配置参数，不依赖环境变量或外部配置文件。该库主要用于生成客户端直传所需的签名信息。

## 术语表

- **OSS_Library**: 阿里云 OSS 封装库，提供 OSS 操作的核心功能
- **STS_Client**: 阿里云安全令牌服务客户端，用于获取临时访问凭证
- **Post_Policy**: OSS PostObject 上传策略，定义上传的约束条件
- **Signature_Generator**: 签名生成器，用于生成 V4 签名
- **Callback_Config**: 回调配置，定义上传完成后的回调参数

## 需求

### 需求 1：OSS 配置管理

**用户故事：** 作为开发者，我希望在调用时传入所有 OSS 配置，以便在不同场景下灵活使用不同的 OSS 配置。

#### 验收标准

1. WHEN 调用 OSS_Library 的任何方法时 THEN OSS_Library SHALL 接受包含 accessKeyId、accessKeySecret、bucket、region 的配置对象
2. WHEN 配置对象缺少必需字段时 THEN OSS_Library SHALL 抛出明确的错误信息指明缺少的字段
3. WHEN 提供 STS 角色 ARN 时 THEN OSS_Library SHALL 使用 STS 获取临时凭证
4. WHEN 不提供 STS 角色 ARN 时 THEN OSS_Library SHALL 直接使用提供的 accessKeyId 和 accessKeySecret

### 需求 2：生成客户端直传签名

**用户故事：** 作为开发者，我希望生成客户端直传所需的签名信息，以便前端可以直接上传文件到 OSS。

#### 验收标准

1. WHEN 调用生成签名方法时 THEN Signature_Generator SHALL 返回包含 host、policy、signature、credential、date 的签名对象
2. WHEN 指定签名过期时间时 THEN Signature_Generator SHALL 使用指定的过期时间生成策略
3. WHEN 未指定签名过期时间时 THEN Signature_Generator SHALL 使用默认的 10 分钟过期时间
4. WHEN 使用 STS 临时凭证时 THEN Signature_Generator SHALL 在返回对象中包含 security_token 字段

### 需求 3：回调配置支持

**用户故事：** 作为开发者，我希望配置上传完成后的回调参数，以便服务器能够接收上传完成的通知。

#### 验收标准

1. WHEN 提供回调 URL 时 THEN Callback_Config SHALL 生成 Base64 编码的回调配置
2. WHEN 提供自定义回调参数时 THEN Callback_Config SHALL 将自定义参数包含在回调体中
3. WHEN 未提供回调配置时 THEN OSS_Library SHALL 返回不包含 callback 字段的签名对象
4. WHEN 回调体类型未指定时 THEN Callback_Config SHALL 默认使用 application/x-www-form-urlencoded

### 需求 4：上传路径配置

**用户故事：** 作为开发者，我希望指定文件上传的目录前缀和文件名规则，以便组织 OSS 中的文件结构。

#### 验收标准

1. WHEN 指定目录前缀时 THEN OSS_Library SHALL 在返回对象中包含 dir 字段
2. WHEN 提供文件名生成函数时 THEN OSS_Library SHALL 使用该函数生成文件名
3. WHEN 未指定目录前缀时 THEN OSS_Library SHALL 使用空字符串作为默认前缀

### 需求 5：策略条件扩展

**用户故事：** 作为开发者，我希望添加自定义的策略条件，以便限制上传文件的类型、大小等属性。

#### 验收标准

1. WHEN 提供额外的策略条件时 THEN Post_Policy SHALL 将这些条件合并到策略中
2. WHEN 指定文件大小限制时 THEN Post_Policy SHALL 添加 content-length-range 条件
3. WHEN 指定文件类型限制时 THEN Post_Policy SHALL 添加 content-type 条件

### 需求 6：私有 Bucket 文件 URL 生成

**用户故事：** 作为开发者，我希望为私有 Bucket 中的文件生成带签名的访问 URL，以便用户能够临时访问私有文件。

#### 验收标准

1. WHEN 调用生成签名 URL 方法时 THEN OSS_Library SHALL 返回带有签名参数的完整 URL
2. WHEN 指定 URL 过期时间时 THEN OSS_Library SHALL 使用指定的过期时间生成签名
3. WHEN 未指定 URL 过期时间时 THEN OSS_Library SHALL 使用默认的 1 小时过期时间
4. WHEN 文件路径包含特殊字符时 THEN OSS_Library SHALL 正确编码 URL

### 需求 7：服务端文件上传

**用户故事：** 作为开发者，我希望在服务端直接上传文件到 OSS，以便处理服务端生成的文件或从其他来源获取的文件。

#### 验收标准

1. WHEN 调用上传方法并提供 Buffer 数据时 THEN OSS_Library SHALL 将数据上传到指定路径
2. WHEN 调用上传方法并提供文件流时 THEN OSS_Library SHALL 将流数据上传到指定路径
3. WHEN 上传成功时 THEN OSS_Library SHALL 返回包含文件路径和 ETag 的结果对象
4. WHEN 上传失败时 THEN OSS_Library SHALL 抛出包含错误详情的异常
5. WHEN 指定文件元数据时 THEN OSS_Library SHALL 将元数据附加到上传的文件

### 需求 8：服务端文件下载

**用户故事：** 作为开发者，我希望在服务端从 OSS 下载文件，以便进行文件处理或转发给用户。

#### 验收标准

1. WHEN 调用下载方法时 THEN OSS_Library SHALL 返回文件的 Buffer 数据
2. WHEN 调用流式下载方法时 THEN OSS_Library SHALL 返回可读流
3. WHEN 文件不存在时 THEN OSS_Library SHALL 抛出明确的文件不存在错误
4. WHEN 指定下载范围时 THEN OSS_Library SHALL 只下载指定范围的数据

### 需求 9：服务端文件删除

**用户故事：** 作为开发者，我希望在服务端删除 OSS 中的文件，以便清理不需要的文件或实现文件管理功能。

#### 验收标准

1. WHEN 调用删除方法并提供单个文件路径时 THEN OSS_Library SHALL 删除该文件
2. WHEN 调用批量删除方法并提供文件路径数组时 THEN OSS_Library SHALL 删除所有指定文件
3. WHEN 删除成功时 THEN OSS_Library SHALL 返回删除结果
4. WHEN 删除不存在的文件时 THEN OSS_Library SHALL 不抛出错误（静默成功）

### 需求 10：类型安全

**用户故事：** 作为开发者，我希望库提供完整的 TypeScript 类型定义，以便获得良好的开发体验和类型检查。

#### 验收标准

1. THE OSS_Library SHALL 导出所有配置接口的 TypeScript 类型定义
2. THE OSS_Library SHALL 导出返回值的 TypeScript 类型定义
3. WHEN 使用 TypeScript 时 THEN 编译器 SHALL 能够正确推断所有参数和返回值的类型
