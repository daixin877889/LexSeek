# 存储与 OSS

LexSeek 的文件存储分为两套体系：旧版 OSS 直连模块（`server/lib/oss/`）和新版多云适配器体系（`server/lib/storage/`），通过统一的服务层（`server/services/storage/` 和 `server/services/files/`）对外暴露。

---

## 1. 架构概览

```
API 层
  │
  ├── server/services/storage/storage.service.ts    ← 新版入口（推荐）
  │       │
  │       └── server/lib/storage/                    ← 多云适配器体系
  │               ├── factory.ts                     ← 工厂（单例缓存）
  │               ├── base.ts                        ← 抽象基类
  │               ├── types.ts                       ← 统一类型定义
  │               ├── errors.ts                      ← 统一错误体系
  │               ├── callback/                      ← 回调处理
  │               └── adapters/
  │                   ├── aliyun-oss.ts
  │                   ├── qiniu.ts                   ← 预留
  │                   └── tencent-cos.ts              ← 预留
  │
  └── server/services/files/files.service.ts         ← 旧版入口（部分已标记 @deprecated）
          │
          └── server/lib/oss/                         ← 旧版阿里云 OSS 直连
                  ├── client.ts
                  ├── upload.ts
                  ├── download.ts
                  ├── delete.ts
                  ├── signedUrl.ts
                  └── postSignature.ts
```

---

## 2. 新版 Storage 适配器体系

### 2.1 适配器接口 (`server/lib/storage/types.ts`)

所有存储服务商必须实现 `StorageAdapter` 接口：

```typescript
interface StorageAdapter {
    readonly type: StorageProviderType

    upload(path: string, data: Buffer | Readable, options?: UploadOptions): Promise<UploadResult>
    download(path: string, options?: DownloadOptions): Promise<Buffer>
    downloadStream(path: string, options?: DownloadOptions): Promise<Readable>
    delete(paths: string | string[]): Promise<DeleteResult>
    generateSignedUrl(path: string, options?: SignedUrlOptions): Promise<string>
    generatePostSignature(options: PostSignatureOptions): Promise<PostSignatureResult>
    testConnection(): Promise<boolean>
}
```

### 2.2 支持的服务商

```typescript
enum StorageProviderType {
    ALIYUN_OSS = 'aliyun_oss',     // 阿里云 OSS（已实现）
    QINIU = 'qiniu',               // 七牛云（已实现骨架）
    TENCENT_COS = 'tencent_cos'    // 腾讯云 COS（已实现骨架）
}
```

### 2.3 工厂模式 (`server/lib/storage/factory.ts`)

`StorageFactory` 使用单例模式管理适配器实例：

```typescript
class StorageFactory {
    // 适配器实例缓存，key 格式: type:configId 或 type:bucket:region
    private static adapters: Map<string, StorageAdapter>

    // 获取适配器（自动缓存）
    static getAdapter(config: StorageConfig): StorageAdapter

    // 注册自定义适配器（扩展新服务商）
    static registerAdapter(type: StorageProviderType, constructor: AdapterConstructor): void

    // 清除缓存（配置变更时调用）
    static clearCache(configKey?: string): void
    static clearCacheByConfigId(configId: number): void
}
```

### 2.4 基础适配器 (`server/lib/storage/base.ts`)

`BaseStorageAdapter` 抽象类提供：
- 配置验证（`validateConfig()`）
- 统一错误转换（`wrapUploadError()`, `wrapDownloadError()` 等）
- 错误类型识别（`isNotFoundError()`, `isPermissionError()` 等）
- 文件名生成（UUID / 时间戳 / 原始名 / 自定义）
- 路径构建辅助方法

### 2.5 统一错误体系 (`server/lib/storage/errors.ts`)

```
StorageError (基类)
├── StorageConfigError          - 配置错误
├── StorageNotFoundError        - 文件不存在
├── StoragePermissionError      - 权限不足
├── StorageNetworkError         - 网络错误
├── StorageUploadError          - 上传错误
├── StorageDownloadError        - 下载错误
├── StorageDeleteError          - 删除错误
├── StorageSignatureError       - 签名错误
└── StorageStsError             - STS 临时凭证错误
```

每个错误类包含 `code`（枚举）和可选的 `cause`（原始错误），并提供 `toJSON()` 序列化方法。

错误转换工具函数：
- `convertAliyunError()` - 将阿里云 OSS SDK 错误转换为统一类型
- `convertQiniuError()` - 将七牛云 SDK 错误转换为统一类型
- `convertTencentError()` - 将腾讯云 COS SDK 错误转换为统一类型

---

## 3. 旧版 OSS 直连模块

### 3.1 客户端创建 (`server/lib/oss/client.ts`)

```typescript
async function createOssClient(config: OssConfig, useCname: boolean = false): Promise<OssClientInstance>
```

- 支持直接 AK/SK 认证和 STS 临时凭证认证
- `useCname` 参数控制是否使用自定义域名（CDN）生成 URL
- 返回 `{ client, config, credentials }` 三元组

### 3.2 核心操作

| 函数 | 文件 | 说明 |
|------|------|------|
| `uploadFile()` | `server/lib/oss/upload.ts` | 上传文件到 OSS（支持 Buffer 和 Readable 流） |
| `downloadFile()` | `server/lib/oss/download.ts` | 下载文件为 Buffer |
| `downloadFileStream()` | `server/lib/oss/download.ts` | 流式下载 |
| `deleteFile()` | `server/lib/oss/delete.ts` | 删除单个或批量文件 |
| `generateSignedUrl()` | `server/lib/oss/signedUrl.ts` | 生成私有文件的签名 URL |
| `generatePostSignature()` | `server/lib/oss/postSignature.ts` | 生成客户端直传签名 |

---

## 4. 前端直传流程

### 4.1 时序图

```
前端                     后端                     OSS
 │                        │                        │
 ├─ 1. 请求上传签名 ─────>│                        │
 │                        ├─ 2. STS 获取临时凭证 ──>│
 │                        │<─ 临时 AK/SK/Token ─────│
 │                        ├─ 3. 构建 Policy+签名    │
 │<─ 4. 返回签名结果 ─────│                        │
 │                        │                        │
 ├─ 5. FormData 直传 ────────────────────────────>│
 │                        │<─ 6. OSS 回调 ──────────│
 │                        ├─ 7. 验证回调 + 入库     │
 │                        ├─ 8. 返回成功 ──────────>│
 │<─ 9. 上传结果 ─────────────────────────────────│
```

### 4.2 签名生成 (`server/lib/oss/postSignature.ts`)

签名结果 `PostSignatureResult` 包含：

| 字段 | 说明 |
|------|------|
| `host` | 上传地址（如 `https://bucket.oss-cn-hangzhou.aliyuncs.com`） |
| `policy` | Base64 编码的 Policy JSON |
| `signatureVersion` | `'OSS4-HMAC-SHA256'`（V4 签名） |
| `credential` | 凭证信息 |
| `date` | 签名日期（UTC 格式） |
| `signature` | 签名值 |
| `dir` | 文件目录前缀 |
| `key` | 完整文件路径（含生成的文件名） |
| `callback` | Base64 编码的回调配置 |
| `callbackVar` | 标准化后的自定义变量 |
| `callbackVarBase64` | 自定义变量的 Base64 编码 |
| `securityToken` | STS 安全令牌（使用 STS 时） |

### 4.3 回调变量规范

OSS 回调的自定义变量有以下约束：
- 变量名自动添加 `x:` 前缀（如 `userId` -> `x:userId`）
- 变量名不能包含 `:` 字符（`x:` 前缀除外）
- 变量名不能包含大写字母
- 变量值通过前端 FormData 传递
- `callbackBody` 中使用 `${x:varName}` 引用变量

---

## 5. 回调处理与验证

### 5.1 回调处理器 (`server/lib/storage/callback/`)

```typescript
// 验证回调请求的合法性
async function verifyCallback(event: H3Event, config: StorageConfig): Promise<CallbackVerifyResult>

// 解析回调数据为统一结构
async function parseCallback(event: H3Event, type: StorageProviderType): Promise<CallbackData>

// 注册自定义回调处理器
function registerCallbackHandler(type: StorageProviderType, handler: CallbackHandler): void
```

### 5.2 统一回调数据结构

```typescript
interface CallbackData {
    filePath: string                       // 文件路径
    fileSize: number                       // 文件大小（字节）
    mimeType: string                       // MIME 类型
    customVars: Record<string, string>     // 自定义变量
    rawData: unknown                       // 原始回调数据
}
```

### 5.3 阿里云回调验证

`AliyunCallbackValidator` 实现了阿里云 OSS 回调签名验证：
- 获取 OSS 发送的回调签名（请求头 `Authorization`）
- 使用阿里云 RSA 公钥验证签名
- 公钥通过 `x-oss-pub-key-url` 头获取（带缓存）

### 5.4 回调失败的前端兜底链路（2026-05-08）

OSS 直传成功后，OSS 服务器回调 LexSeek 的 `/api/v1/storage/callback` 写 `ossFiles.status = UPLOADED`。当回调因网络 / LexSeek 临时不可用而失败时，OSS 文件实际已存在，但 DB 行卡在 `status=PENDING`，前端会展示"上传失败"——与真实情况不符。

**兜底链路**通过让前端在收到 callback 失败响应时调一个用户端接口，由后端 head OSS 直接核对真实状态并修复：

```
前端 (useFileUploadWorker)
   │
   │ ① 收到 worker 回报：{ success: false }
   │   (callback 失败但 OSS 已成功)
   ▼
POST /api/v1/storage/confirm-upload  { fileId }
   │
   ▼
verifyAndFixOssFileService(fileId, userId)
   ├── 查 ossFiles by id
   │     ├── 不存在/userId 不匹配 → invalid / forbidden
   │     ├── 已 UPLOADED → ok（直接返）
   │     ├── 已 FAILED → already_failed
   │     └── PENDING → 继续
   │
   ├── adapter.head(filePath)
   │     ├── null（OSS 也没有）→ not_found
   │     └── 命中 → markOssFileUploadedByVerifyDao
   │           （updateMany where status=PENDING，原子条件更新，幂等并发安全）
   │
   ▼
前端：onSuccess({ recovered: true, fileId }) 或 onError
```

**关键约束**：

- 前端兜底需要 `ossFileId`，由 `POST /api/v1/storage/presigned-url` 在签名结果里透出（`PostSignatureResult.ossFileId`）
- 后端 `markOssFileUploadedByVerifyDao` 用 Prisma `updateMany` + 条件 `status=PENDING and deletedAt=null`，count=1 表示我改的、count=0 表示已被回调或并发兜底改过——天然幂等
- adapter 抛错（OSS 5xx / 网络）由 handler 转 503，前端 onError；NoSuchKey / 404 在底层 `headFile` 里转成 null，不抛错

**涉及文件**：

| 文件 | 角色 |
|------|------|
| `server/lib/oss/headFile.ts` | OSS 底层 `getObjectMeta` 封装；返回 `HeadObjectResult \| null` |
| `server/lib/storage/types.ts` | `StorageAdapter.head(path)` 抽象方法；`AliyunPostSignatureResult.ossFileId` 透出 |
| `server/lib/storage/base.ts` | `BaseStorageAdapter.head` 默认实现（throw NotImplemented） |
| `server/lib/storage/adapters/aliyun-oss.ts` | `AliyunOssAdapter.head` 调底层 `headFile` |
| `server/services/files/ossFiles.dao.ts` | `markOssFileUploadedByVerifyDao(fileId)` 原子条件更新 |
| `server/services/files/ossFileVerify.service.ts` | `verifyAndFixOssFileService(fileId, userId)` 全状态机 |
| `server/services/storage/storage.service.ts` | `getStorageAdapterService` 导出（外部 service 层共用） |
| `server/api/v1/storage/confirm-upload/.post.ts` | 用户端 handler（401/400/403/404/409/503 全分支） |
| `server/api/v1/storage/presigned-url/.post.ts` | 在 `results.push` 时拼上 `ossFileId: ossFile.id` |
| `app/composables/useFileUploadWorker.ts` | success 分支检测 `data.success===false` → 调兜底接口 |

**响应码语义**：

| 场景 | HTTP | 前端处理 |
|------|------|---------|
| `ok=true` | 200 + `{ status: 'uploaded' }` | onSuccess({ recovered: true, fileId }) |
| `forbidden` | 403 | onError 文件归属异常 |
| `not_found` | 404 | onError 提示用户重新上传 |
| `already_failed` | 409 | onError 文件已标记失败 |
| `invalid` | 400 | onError 文件记录异常 |
| adapter 抛错 | 503 | onError 提示 OSS 暂不可达 |

**未来扩展**：兜底服务通过 `getStorageAdapterService({ type: ALIYUN_OSS })` 拿适配器，所以接入七牛 / 腾讯 COS 时只需各自适配器实现 `head()` 方法、`StorageProviderType` 路由扩展即可，service / handler 不动。

详见 [docs/superpowers/specs/2026-05-08-oss-callback-fallback-design.md](../../superpowers/specs/2026-05-08-oss-callback-fallback-design.md)。

---

## 6. 服务层

### 6.1 存储服务 (`server/services/storage/storage.service.ts`)

封装适配器调用，提供统一的存储操作接口：

```typescript
// 获取适配器（外部 service 直接拿 head 等底层能力时调用）
getStorageAdapterService(options)

// 上传文件
uploadFileService(path, data, options?)

// 下载文件（Buffer / Stream）
downloadFileService(path, options?)
downloadFileStreamService(path, options?)

// 删除文件
deleteFileService(paths, options?)

// 签名 URL
generateSignedUrlService(path, options?)

// 客户端直传签名
generatePostSignatureService(options)

// 测试连接
testStorageConnectionService(options)

// 清除适配器缓存
clearAdapterCacheService(configId?)
```

所有方法支持 `configId`（使用指定配置）或使用默认配置。配置来源：
1. 优先查 `storageConfigs` 数据库表（`storageConfig.dao.ts`）
2. 兜底使用 `runtimeConfig.storage` 配置

### 6.2 文件服务 (`server/services/files/files.service.ts`)

- `generateOssPostSignatureService()`：旧版上传签名（标记 `@deprecated`，建议使用 `generatePostSignatureService`）
- `generateOssDownloadSignaturesService()`：批量生成下载签名
  - 按 bucket 分组避免重复获取配置
  - 支持 `systemConfigs` 数据库配置 + `runtimeConfig` 保底
  - 并行生成签名，失败文件自动跳过

### 6.3 OSS 文件 DAO (`server/services/files/ossFiles.dao.ts`)

管理 `ossFiles` 表的 CRUD 操作，记录文件元数据（路径、大小、MIME 类型、加密状态等）。

---

## 7. 文件加密

`ossFiles` 表包含加密相关字段：
- `encrypted: Boolean` - 是否加密
- `originalMimeType: String?` - 原始 MIME 类型（加密后 MIME 变为通用类型）

加密文件的处理流程：
1. 前端使用 age 加密算法在浏览器端加密文件
2. 加密后的文件上传到 OSS
3. 下载时先从 OSS 获取密文，再在前端解密

---

## 8. 存储配置管理

`storageConfigs` 表存储用户自定义的云存储配置：
- `userId: null` 表示系统级配置
- `config` 字段使用 JSON 存储加密的配置信息
- `isDefault` 标记默认配置
- 支持多个服务商类型共存

配置查找优先级：
1. 指定 `configId` -> 精确查询
2. 未指定 -> 查找指定类型的默认配置（`isDefault = true`）
3. 未找到 -> 回退到 `runtimeConfig.storage` 中的环境变量配置
