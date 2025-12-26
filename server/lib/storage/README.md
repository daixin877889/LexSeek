# 存储适配器系统

统一的云存储操作接口，支持多种云存储服务商。

## 特性

- 统一的存储操作接口（上传、下载、删除、签名 URL）
- 支持多种云存储服务商（阿里云 OSS、七牛云、腾讯云 COS）
- 适配器工厂模式，自动缓存适配器实例
- 统一的错误处理机制
- 用户自定义存储配置支持
- 回调验证和数据解析

## 目录结构

```
server/lib/storage/
├── index.ts              # 统一导出
├── types.ts              # 类型定义
├── errors.ts             # 错误类型
├── factory.ts            # 适配器工厂
├── base.ts               # 基础适配器抽象类
├── adapters/             # 适配器实现
│   ├── aliyun-oss.ts     # 阿里云 OSS 适配器
│   ├── qiniu.ts          # 七牛云适配器
│   └── tencent-cos.ts    # 腾讯云 COS 适配器
└── callback/             # 回调处理
    ├── types.ts          # 回调类型定义
    ├── handler.ts        # 统一回调处理器
    └── validators/       # 各服务商回调验证
        └── aliyun.ts     # 阿里云回调验证器
```

## 使用示例

### 基本使用

```typescript
import { StorageFactory, StorageProviderType } from '~~/server/lib/storage'

// 获取适配器
const config = {
    type: StorageProviderType.ALIYUN_OSS,
    name: 'my-oss',
    bucket: 'my-bucket',
    region: 'cn-hangzhou',
    accessKeyId: 'your-access-key-id',
    accessKeySecret: 'your-access-key-secret',
    enabled: true
}

const adapter = StorageFactory.getAdapter(config)

// 上传文件
const result = await adapter.upload('path/to/file.txt', Buffer.from('hello'))

// 下载文件
const data = await adapter.download('path/to/file.txt')

// 生成签名 URL
const url = await adapter.generateSignedUrl('path/to/file.txt', { expires: 3600 })

// 生成客户端直传签名
const signature = await adapter.generatePostSignature({
    dir: 'uploads/',
    expirationMinutes: 10
})
```

### 使用存储服务

```typescript
import {
    uploadFileService,
    downloadFileService,
    generatePostSignatureService
} from '~~/server/services/storage/storage.service'

// 使用默认配置上传
const result = await uploadFileService('path/to/file.txt', buffer, {
    userId: 1,
    type: StorageProviderType.ALIYUN_OSS
})

// 使用指定配置上传
const result = await uploadFileService('path/to/file.txt', buffer, {
    configId: 123,
    userId: 1
})

// 生成上传签名
const signature = await generatePostSignatureService({
    dir: 'uploads/',
    userId: 1,
    callback: {
        callbackUrl: 'https://example.com/callback',
        callbackBody: 'filename=${object}&size=${size}'
    }
})
```

### 回调处理

```typescript
import { verifyCallback, parseCallback } from '~~/server/lib/storage/callback'

// 验证回调签名
const verifyResult = await verifyCallback(event, config)
if (!verifyResult.valid) {
    console.error('回调验证失败:', verifyResult.error)
}

// 解析回调数据
const callbackData = await parseCallback(event, StorageProviderType.ALIYUN_OSS)
console.log('文件路径:', callbackData.filePath)
console.log('文件大小:', callbackData.fileSize)
console.log('自定义变量:', callbackData.customVars)
```

## API 接口

### 存储配置管理

- `GET /api/v1/storage/config` - 获取配置列表
- `POST /api/v1/storage/config` - 创建配置
- `PUT /api/v1/storage/config/:id` - 更新配置
- `DELETE /api/v1/storage/config/:id` - 删除配置
- `POST /api/v1/storage/config/test` - 测试连接

### 预签名 URL

- `POST /api/v1/storage/presigned-url` - 批量获取上传预签名

### 回调处理

- `POST /api/v1/storage/callback/:provider` - 统一回调处理

## 错误处理

所有存储操作错误都继承自 `StorageError` 基类：

- `StorageConfigError` - 配置错误
- `StorageNotFoundError` - 文件不存在
- `StoragePermissionError` - 权限错误
- `StorageNetworkError` - 网络错误
- `StorageUploadError` - 上传错误
- `StorageDownloadError` - 下载错误
- `StorageDeleteError` - 删除错误
- `StorageSignatureError` - 签名错误

## 环境变量

存储配置加密需要设置以下环境变量：

```env
STORAGE_CONFIG_ENCRYPTION_KEY=your-encryption-key
```

## 扩展适配器

实现自定义适配器：

```typescript
import { BaseStorageAdapter, StorageProviderType } from '~~/server/lib/storage'

class MyAdapter extends BaseStorageAdapter {
    readonly type = 'my_storage' as StorageProviderType

    async upload(path, data, options) {
        // 实现上传逻辑
    }

    // 实现其他方法...
}

// 注册自定义适配器
StorageFactory.registerAdapter('my_storage' as StorageProviderType, MyAdapter)
```

## 待完善

- [ ] 七牛云适配器完整实现
- [ ] 腾讯云 COS 适配器完整实现
- [ ] 七牛云回调验证器
- [ ] 腾讯云回调验证器
