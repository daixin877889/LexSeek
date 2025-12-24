# 阿里云 OSS 通用库（服务端）

一个通用的阿里云 OSS 封装库，支持客户端直传签名、服务端文件操作和私有文件 URL 签名。所有配置在调用时传入，不依赖环境变量。

> ⚠️ 本模块仅供服务端使用，类型定义位于 `shared/types/oss.ts`，可供客户端和服务端共用。

## 功能特性

- ✅ 客户端直传签名生成（V4 签名）
- ✅ 私有文件签名 URL 生成
- ✅ 服务端文件上传（Buffer/流）
- ✅ 服务端文件下载（Buffer/流）
- ✅ 服务端文件删除（单个/批量）
- ✅ STS 临时凭证支持
- ✅ 完整的 TypeScript 类型定义

## 快速开始

### 基础配置

```typescript
import type { OssConfig } from '~~/shared/types/oss'

// 基础配置（不使用 STS）
const config: OssConfig = {
  accessKeyId: 'your-access-key-id',
  accessKeySecret: 'your-access-key-secret',
  bucket: 'your-bucket-name',
  region: 'cn-hangzhou'
}

// 使用自定义域名的配置
const configWithCustomDomain: OssConfig = {
  accessKeyId: 'your-access-key-id',
  accessKeySecret: 'your-access-key-secret',
  bucket: 'your-bucket-name',
  region: 'cn-hangzhou',
  customDomain: 'https://cdn.example.com'  // 自定义域名（CDN 加速域名）
}

// 使用 STS 临时凭证的配置
const configWithSts: OssConfig = {
  accessKeyId: 'your-access-key-id',
  accessKeySecret: 'your-access-key-secret',
  bucket: 'your-bucket-name',
  region: 'cn-hangzhou',
  customDomain: 'https://cdn.example.com',  // 可选：自定义域名
  sts: {
    roleArn: 'acs:ram::1234567890:role/oss-role',
    roleSessionName: 'session-name',  // 可选
    durationSeconds: 3600             // 可选，默认 3600
  }
}
```

### 自定义域名说明

`customDomain` 字段用于配置 CDN 加速域名或自定义域名，配置后：

1. **签名结果的 `host` 字段**会使用自定义域名，前端上传时会直接上传到该域名
2. 支持以下格式：
   - `https://cdn.example.com` - 完整 URL
   - `cdn.example.com` - 会自动添加 `https://` 前缀
3. 如果不配置，默认使用阿里云 OSS 标准域名：`https://{bucket}.oss-{region}.aliyuncs.com`

**使用场景**：
- 配置了 CDN 加速的 Bucket
- 绑定了自定义域名的 Bucket
- 需要通过特定域名访问 OSS 的场景

## API 文档

### 1. 客户端直传签名

生成前端直传 OSS 所需的签名信息。

```typescript
import { generatePostSignature } from '~~/server/lib/oss'

const signature = await generatePostSignature(config, {
  // 文件目录前缀
  dir: 'uploads/images/',
  // 文件名生成选项（可选）
  fileKey: {
    originalFileName: 'photo.jpg',  // 原始文件名（用于提取扩展名）
    strategy: 'uuid'                // 'uuid' | 'timestamp' | 'original' | 'custom'
    // 或使用自定义文件名：
    // strategy: 'custom',
    // customFileName: 'my-file.jpg'
  },
  // 签名过期时间（分钟），默认 10
  expirationMinutes: 10,
  // 回调配置（可选）
  callback: {
    callbackUrl: 'https://your-server.com/api/callback/oss',
    callbackBody: 'filename=${object}&size=${size}&mimeType=${mimeType}',
    callbackBodyType: 'application/x-www-form-urlencoded',
    // 自定义回调参数（会自动添加 x: 前缀）
    // ⚠️ 重要：变量名必须全部使用小写字母，不能包含大写字母
    callbackVar: {
      'userid': '12345',              // ✅ 正确：全小写，会自动变成 x:userid
      'originalfilename': 'photo.jpg' // ✅ 正确：全小写
      // 'userId': '12345'            // ❌ 错误：包含大写字母，OSS 回调时值会为空
    }
  },
  // 策略条件（可选）
  conditions: {
    // 文件大小限制 [最小, 最大]（字节）
    contentLengthRange: [0, 10 * 1024 * 1024],  // 最大 10MB
    // 允许的文件类型
    contentType: ['image/jpeg', 'image/png', 'image/gif']
  }
})

// 返回结果
console.log(signature)
// {
//   host: 'https://bucket.oss-cn-hangzhou.aliyuncs.com',
//   policy: 'base64-encoded-policy',
//   signatureVersion: 'OSS4-HMAC-SHA256',
//   credential: 'access-key-id/date/region/oss/aliyun_v4_request',
//   date: '20231225T120000Z',
//   signature: 'signature-string',
//   dir: 'uploads/images/',
//   key: 'uploads/images/550e8400-e29b-41d4-a716-446655440000.jpg',  // 如果配置了 fileKey
//   callback: 'base64-encoded-callback',      // 如果配置了回调
//   securityToken: 'sts-token'                // 如果使用 STS
// }
```

#### 文件名生成策略

| 策略 | 说明 | 示例 |
|------|------|------|
| `uuid` | 使用 UUID 生成文件名（默认） | `550e8400-e29b-41d4-a716-446655440000.jpg` |
| `timestamp` | 使用时间戳生成文件名 | `1703491200000.jpg` |
| `original` | 保留原始文件名 | `photo.jpg` |
| `custom` | 使用自定义文件名 | `my-custom-name.jpg` |

```typescript
// UUID 策略（默认）
fileKey: {
  originalFileName: 'photo.jpg',
  strategy: 'uuid'
}

// 时间戳策略
fileKey: {
  originalFileName: 'photo.jpg',
  strategy: 'timestamp'
}

// 保留原始文件名
fileKey: {
  originalFileName: 'photo.jpg',
  strategy: 'original'
}

// 自定义文件名（需包含扩展名）
fileKey: {
  strategy: 'custom',
  customFileName: 'my-custom-name.jpg'
}
```

#### 前端使用示例

```typescript
// 前端代码（使用服务端返回的签名信息）
const formData = new FormData()

// 优先使用服务端生成的 key，如果没有则使用 dir + 原始文件名
formData.append('key', signature.key || (signature.dir + filename))
formData.append('policy', signature.policy)
formData.append('x-oss-signature-version', signature.signatureVersion)
formData.append('x-oss-credential', signature.credential)
formData.append('x-oss-date', signature.date)
formData.append('x-oss-signature', signature.signature)

if (signature.securityToken) {
  formData.append('x-oss-security-token', signature.securityToken)
}
if (signature.callback) {
  formData.append('callback', signature.callback)
}
// 添加回调自定义变量（PostObject 表单上传时，直接作为表单字段传递）
if (signature.callbackVar) {
  for (const [key, value] of Object.entries(signature.callbackVar)) {
    formData.append(key, value)
  }
}

formData.append('file', file)

await fetch(signature.host, {
  method: 'POST',
  body: formData
})
```

### 2. 私有文件签名 URL

为私有 Bucket 中的文件生成临时访问 URL。

```typescript
import { generateSignedUrl } from '~~/server/lib/oss'

// 基础用法
const url = await generateSignedUrl(config, 'path/to/file.pdf')

// 完整选项
const url = await generateSignedUrl(config, 'path/to/file.pdf', {
  // URL 过期时间（秒），默认 3600
  expires: 7200,
  // HTTP 方法，默认 'GET'
  method: 'GET',
  // 响应头设置
  response: {
    contentType: 'application/pdf',
    contentDisposition: 'attachment; filename="document.pdf"'
  }
})
```

### 3. 服务端文件上传

```typescript
import { uploadFile } from '~~/server/lib/oss'
import { createReadStream } from 'fs'

// 上传 Buffer
const buffer = Buffer.from('file content')
const result = await uploadFile(config, 'path/to/file.txt', buffer, {
  contentType: 'text/plain',
  meta: {
    'x-oss-meta-author': 'John'
  },
  storageClass: 'Standard'  // 'Standard' | 'IA' | 'Archive'
})

// 上传文件流
const stream = createReadStream('/local/path/to/file.pdf')
const result = await uploadFile(config, 'path/to/file.pdf', stream, {
  contentType: 'application/pdf'
})

// 返回结果
console.log(result)
// {
//   name: 'path/to/file.txt',
//   etag: 'file-etag',
//   url: 'https://bucket.oss-cn-hangzhou.aliyuncs.com/path/to/file.txt'
// }
```

### 4. 服务端文件下载

```typescript
import { downloadFile, downloadFileStream } from '~~/server/lib/oss'

// 下载为 Buffer
const buffer = await downloadFile(config, 'path/to/file.txt')

// 范围下载
const partialBuffer = await downloadFile(config, 'path/to/file.txt', {
  range: 'bytes=0-1023'  // 下载前 1KB
})

// 流式下载
const stream = await downloadFileStream(config, 'path/to/file.pdf')
stream.pipe(response)  // 直接输出到响应
```

### 5. 服务端文件删除

```typescript
import { deleteFile } from '~~/server/lib/oss'

// 删除单个文件
const result = await deleteFile(config, 'path/to/file.txt')

// 批量删除
const result = await deleteFile(config, [
  'path/to/file1.txt',
  'path/to/file2.txt',
  'path/to/file3.txt'
])

// 返回结果
console.log(result)
// { deleted: ['path/to/file1.txt', 'path/to/file2.txt', 'path/to/file3.txt'] }
```

## 注意事项

### 回调自定义变量命名规则

> ⚠️ **重要**：阿里云 OSS 回调自定义变量名有严格的命名限制！

使用 `callbackVar` 传递自定义变量时，库会自动添加 `x:` 前缀，你只需要传入变量名即可。变量名必须遵守以下规则：

1. **只能使用小写字母**：变量名不能包含大写字母
2. **建议只使用小写字母和数字**

```typescript
// ✅ 正确示例（库会自动添加 x: 前缀）
callbackVar: {
  'userid': '12345',           // 会变成 x:userid
  'fileid': '67890',           // 会变成 x:fileid
  'source': 'avatar',          // 会变成 x:source
  'originalfilename': 'photo.jpg'  // 会变成 x:originalfilename
}

// ❌ 错误示例（OSS 回调时这些变量的值会为空）
callbackVar: {
  'userId': '12345',           // 包含大写字母 I
  'fileId': '67890',           // 包含大写字母 I
  'originalFileName': 'photo.jpg'  // 包含大写字母 F 和 N
}
```

如果变量名包含大写字母，OSS 在回调时会返回空值，但不会报错，这可能导致难以排查的问题。

## 错误处理

库提供了多种错误类型，便于精确处理不同的错误场景：

```typescript
import {
  OssConfigError,
  OssStsError,
  OssNotFoundError,
  OssUploadError,
  OssDownloadError,
  OssDeleteError
} from '~~/server/lib/oss'

try {
  const buffer = await downloadFile(config, 'path/to/file.txt')
} catch (error) {
  if (error instanceof OssNotFoundError) {
    console.log('文件不存在')
  } else if (error instanceof OssConfigError) {
    console.log('配置错误:', error.message)
  } else if (error instanceof OssStsError) {
    console.log('STS 凭证获取失败:', error.message)
  } else {
    console.log('其他错误:', error)
  }
}
```

### 错误类型说明

| 错误类型 | 说明 |
|---------|------|
| `OssConfigError` | 配置错误，如缺少必需字段 |
| `OssStsError` | STS 临时凭证获取失败 |
| `OssNotFoundError` | 文件不存在 |
| `OssUploadError` | 上传失败 |
| `OssDownloadError` | 下载失败 |
| `OssDeleteError` | 删除失败 |
| `OssNetworkError` | 网络错误 |

## 工具函数

库还导出了一些工具函数，可按需使用：

```typescript
import {
  formatDateToUTC,    // 格式化日期为 OSS V4 签名格式
  getStandardRegion,  // 获取标准区域名称（移除 oss- 前缀）
  getCredential,      // 生成 x-oss-credential
  encodeBase64,       // Base64 编码
  decodeBase64,       // Base64 解码
  getOssHost          // 获取 OSS 主机地址
} from '~~/server/lib/oss'
```

## 类型定义

类型定义位于 `shared/types/oss.ts`，可供客户端和服务端共用：

```typescript
// 服务端导入
import type { OssConfig, PostSignatureResult } from '~~/shared/types/oss'

// 或从本模块重新导出
import type { OssConfig, PostSignatureResult } from '~~/server/lib/oss'
```

### 可用类型

- `OssConfig` - 完整 OSS 配置
- `OssBaseConfig` - 基础配置
- `OssStsConfig` - STS 配置
- `PostSignatureOptions` - 直传签名选项
- `PostSignatureResult` - 直传签名结果
- `FileKeyOptions` - 文件名生成选项
- `CallbackConfig` - 回调配置
- `PolicyConditions` - 策略条件
- `SignedUrlOptions` - 签名 URL 选项
- `UploadOptions` - 上传选项
- `UploadResult` - 上传结果
- `DownloadOptions` - 下载选项
- `DeleteResult` - 删除结果

## 在 API 路由中使用

```typescript
// server/api/oss/signature.post.ts
import { generatePostSignature } from '~~/server/lib/oss'
import type { OssConfig } from '~~/shared/types/oss'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  
  const config: OssConfig = {
    accessKeyId: process.env.OSS_ACCESS_KEY_ID!,
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET!,
    bucket: process.env.OSS_BUCKET!,
    region: process.env.OSS_REGION!,
    sts: {
      roleArn: process.env.OSS_STS_ROLE_ARN!
    }
  }

  const signature = await generatePostSignature(config, {
    dir: body.dir || 'uploads/',
    // 服务端生成文件名
    fileKey: {
      originalFileName: body.originalFileName,
      strategy: 'uuid'  // 使用 UUID 命名，避免文件名冲突
    },
    callback: {
      callbackUrl: `${process.env.APP_URL}/api/callback/oss`
    }
  })

  return signature
})
```
