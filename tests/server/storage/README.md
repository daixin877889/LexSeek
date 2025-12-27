# 存储系统测试模块

本模块包含文件存储系统相关的所有测试用例，涵盖阿里云 OSS 集成、签名生成、回调处理、配置验证等功能。

## 测试文件列表

| 文件 | 说明 |
|------|------|
| `storage-aliyun.test.ts` | 阿里云 OSS 签名格式和配置验证 |
| `storage-callback.test.ts` | 回调数据解析和验证 |
| `storage-config.test.ts` | 存储配置验证 |
| `storage-errors.test.ts` | 存储错误处理 |
| `storage-factory.test.ts` | 存储工厂模式 |
| `storage-isolation.test.ts` | 存储隔离测试 |

## 测试用例详情

### storage-aliyun.test.ts - 阿里云签名格式正确性

**签名结果必需字段**
- 签名结果应包含 host 字段
- 签名结果应包含 policy 字段（Base64 编码）
- 签名结果应包含 signatureVersion 字段且值为 OSS4-HMAC-SHA256
- 签名结果应包含 credential 字段
- 签名结果应包含 date 字段（ISO 8601 格式）
- 签名结果应包含 signature 字段
- 签名结果应包含 dir 字段

**类型守卫**
- isAliyunPostSignatureResult 应正确识别阿里云签名结果
- isAliyunOssConfig 应正确识别阿里云配置

**host 字段格式**
- 无自定义域名时 host 应为标准 OSS 域名格式
- 有自定义域名时 host 应使用自定义域名

**可选字段**
- 配置回调时应包含 callback 字段
- 配置 STS 时应包含 securityToken 字段
- 配置 fileKey 时应包含 key 字段

**配置验证**
- 缺少 accessKeyId 应抛出 StorageConfigError
- 缺少 accessKeySecret 应抛出 StorageConfigError
- 无效的 region 格式应抛出 StorageConfigError
- 有效配置不应抛出错误

### storage-callback.test.ts - 回调数据解析一致性

**阿里云回调解析**
- 解析结果应包含 filePath 字段
- 解析结果应包含 fileSize 字段（数字类型）
- 解析结果应包含 mimeType 字段
- 解析结果应包含 customVars 字段
- 自定义变量应正确提取（移除 x: 前缀）
- 解析结果应包含 rawData 字段

**回调验证正确性**
- 有效的阿里云公钥 URL 应通过验证
- 无效的公钥 URL 应验证失败
- 恶意构造的 URL 应验证失败
- 缺少 authorization 头应验证失败
- 缺少 x-oss-pub-key-url 头应验证失败
- 两个必需头都存在时才可能验证成功

### storage-config.test.ts - 配置验证完整性

**阿里云 OSS 配置验证**
- 有效配置不应抛出错误
- 缺少 accessKeyId 应抛出 StorageConfigError

## 运行测试

```bash
# 运行存储模块所有测试
npx vitest run tests/server/storage --reporter=verbose

# 运行特定测试文件
npx vitest run tests/server/storage/storage-aliyun.test.ts --reporter=verbose
```
