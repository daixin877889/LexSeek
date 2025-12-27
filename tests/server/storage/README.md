# 存储系统测试模块

本模块包含文件存储系统相关的所有测试用例，涵盖阿里云 OSS 集成、签名生成、回调处理、配置验证等功能。

## 测试文件列表

| 文件 | 说明 |
|------|------|
| `storage-aliyun.test.ts` | 阿里云 OSS 签名格式和配置验证 |
| `storage-callback.test.ts` | 回调数据解析和验证 |
| `storage-config.test.ts` | 存储配置验证 |
| `storage-errors.test.ts` | 存储错误类和错误转换工具测试 |
| `storage-factory.test.ts` | 存储工厂模式和类型守卫函数测试 |
| `storage-isolation.test.ts` | 存储隔离测试 |
| `storage-adapters.test.ts` | 存储适配器配置验证测试 |
| `storage-base.test.ts` | 存储基类辅助方法和错误转换测试 |
| `storage-base-extended.test.ts` | 存储基类扩展测试（错误转换和辅助方法） |
| `oss-utils.test.ts` | OSS 工具函数测试 |
| `oss-errors.test.ts` | OSS 错误类测试 |
| `oss-validator.test.ts` | OSS 配置验证器测试 |
| `oss-integration.test.ts` | 阿里云 OSS 集成测试（需要真实配置） |
| `oss-edge-cases.test.ts` | OSS 边缘情况和错误处理测试 |
| `oss-signed-url.test.ts` | OSS 签名 URL 测试 |
| `oss-client.test.ts` | OSS 客户端创建和 STS 凭证测试 |
| `aliyun-oss-adapter.test.ts` | 阿里云 OSS 适配器集成测试（需要真实配置） |

## 运行测试

```bash
# 运行存储模块所有测试
bun run test:storage

# 或使用 npx
npx vitest run tests/server/storage --reporter=verbose

# 运行带覆盖率的测试
npx vitest run tests/server/storage --coverage

# 运行特定测试文件
npx vitest run tests/server/storage/storage-aliyun.test.ts --reporter=verbose
```

## 覆盖率统计

当前存储模块测试覆盖率：**95.8%**

| 模块 | 语句覆盖率 | 分支覆盖率 | 函数覆盖率 |
|------|-----------|-----------|-----------|
| oss/ | 96.93% | 85.49% | 100% |
| storage/ | 97.83% | 87.93% | 100% |
| storage/adapters/ | 90.83% | 87.5% | 94.28% |

### 未覆盖代码说明

以下代码分支未被覆盖，主要是防御性编程和错误处理分支：

1. **client.ts 第 13 行**：STS 配置缺失检查（内部函数的防御性检查）
2. **download.ts 第 40, 77 行**：非 404 下载错误处理（需要模拟网络错误）
3. **signedUrl.ts 第 46-47 行**：STS token 手动添加分支（依赖 ali-oss 库行为）
4. **postSignature.ts 第 102 行**：默认策略分支（TypeScript 类型限制）
5. **base.ts 第 117, 128, 139 行**：StorageError 实例转换分支（实际使用中很少触发）
6. **base.ts 第 302 行**：默认策略分支（TypeScript 类型限制）
7. **aliyun-oss.ts 错误处理分支**：需要特定错误条件才能触发

## 测试用例详情

### oss-integration.test.ts - 阿里云 OSS 集成测试

> 注意：此测试需要在 .env 文件中配置阿里云 OSS 相关环境变量

**OSS 客户端创建**
- 应成功创建 OSS 客户端
- 使用 STS 时应返回临时凭证

**签名生成**
- 应生成有效的 POST 签名
- 配置 fileKey 时应生成完整的 key
- 配置回调时应包含 callback 字段
- 配置自定义变量时应包含 callbackVar 字段
- 应生成有效的签名 URL
- 签名 URL 应支持 response headers 设置
- 签名 URL 应支持不同的 HTTP 方法

**文件上传下载**
- 应成功上传文件
- 应成功下载文件
- 下载不存在的文件应抛出错误
- 应支持 Range 下载（部分内容）
- 应成功流式下载文件
- 流式下载不存在的文件应抛出错误
- 流式下载应支持 Range 选项

**文件删除**
- 应成功删除文件
- 批量删除应返回所有删除的文件路径

**Property: 签名格式一致性**
- 任意目录的签名结果格式应一致

**Property: 文件上传下载往返一致性**
- 上传后下载应得到相同内容

### aliyun-oss-adapter.test.ts - 阿里云 OSS 适配器集成测试

> 注意：此测试需要在 .env 文件中配置阿里云 OSS 相关环境变量

**适配器创建**
- 应成功创建适配器实例
- 缺少 accessKeyId 应抛出配置错误
- 缺少 accessKeySecret 应抛出配置错误
- 无效的 region 格式应抛出配置错误
- 无效的 STS roleArn 格式应抛出配置错误

**连接测试**
- 应成功测试连接

**文件上传**
- 应成功上传文件
- 应支持自定义元数据
- 应支持 storageClass 选项

**文件下载**
- 应成功下载文件
- 下载不存在的文件应抛出错误
- 应支持 Range 下载

**流式下载**
- 应成功流式下载文件
- 流式下载不存在的文件应抛出错误

**文件删除**
- 应成功删除单个文件
- 应成功批量删除文件

**签名 URL 生成**
- 应生成有效的签名 URL
- 应支持不同的 HTTP 方法
- 应支持 response headers 设置

**POST 签名生成**
- 应生成有效的 POST 签名
- 应支持 fileKey 配置
- 应支持回调配置
- 应支持条件配置

**Protected 方法测试**
- getHost 应正确生成主机地址
- isNotFoundError 应识别 NoSuchKey 错误
- isPermissionError 应识别 AccessDenied 错误
- isConfigError 应识别配置相关错误
- isNetworkError 应识别网络相关错误

### oss-edge-cases.test.ts - OSS 边缘情况测试

**OSS 错误处理测试**
- OssStsError 创建和消息格式
- OssDownloadError 创建和消息格式
- OssDeleteError 创建和消息格式
- OssUploadError 创建和消息格式

**postSignature.ts 错误分支**
- 使用 custom 策略但未提供 customFileName 应抛出错误
- 使用 uuid 策略但未提供 originalFileName 应抛出错误
- 使用 timestamp 策略但未提供 originalFileName 应抛出错误

**Storage Base 辅助方法测试**
- 错误转换方法测试
- convertError 方法测试
- 辅助方法测试（getExtension、generateFileName）

**AliyunOssAdapter 错误处理测试**
- upload 错误处理
- download 错误处理
- downloadStream 错误处理
- delete 错误处理
- generateSignedUrl 错误处理
- generatePostSignature 错误处理
- testConnection 错误处理

### oss-client.test.ts - OSS 客户端测试

**createOssClient - 基本功能**
- 应成功创建 OSS 客户端（无 STS）
- 应支持 useCname 参数
- 无自定义域名时 useCname 应被忽略

**OSS 客户端 STS 测试**
- 应成功创建带 STS 凭证的 OSS 客户端
- STS 凭证应在有效期内

**OSS 客户端错误处理**
- 无效的 STS roleArn 应抛出错误
- 无效的 accessKeyId 应导致 STS 失败

### oss-signed-url.test.ts - OSS 签名 URL 测试

**基本签名 URL 生成**
- 应生成有效的签名 URL
- 应支持自定义过期时间
- 应支持不同的 HTTP 方法
- 应支持 response headers 设置
- 应使用默认过期时间（3600秒）
- 应使用默认 HTTP 方法（GET）

**自定义域名支持**
- 配置自定义域名时应使用 cname 模式

**OSS 签名 URL STS Token 测试**
- 使用 STS 时签名 URL 应包含 security-token
- STS token 应正确编码

### storage-base-extended.test.ts - Storage Base 扩展测试

**错误转换方法**
- wrapUploadError 应正确转换 StorageError 实例
- wrapUploadError 应正确转换普通 Error 实例
- wrapUploadError 应正确处理非 Error 对象
- wrapDownloadError 应正确转换和处理各种输入
- wrapDeleteError 应正确转换和处理各种输入
- wrapSignatureError 应正确转换和处理各种输入

**错误类型检测**
- isNotFoundError 应识别各种 NotFound 错误
- isPermissionError 应识别各种权限错误
- isConfigError 应识别各种配置错误
- isNetworkError 应识别各种网络错误

**辅助方法**
- getExtension 应正确提取文件扩展名
- generateFileName 应支持各种策略
- buildFilePath 应正确构建文件路径

**convertError 方法**
- 应正确转换各种错误类型
