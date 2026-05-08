# OSS 上传回调失败的前端兜底校验设计

## 概述

当前文件上传走 OSS 直传 + 回调写库的流程，回调失败（如服务重启、DB 抖动、callback handler 抛错）时 LexSeek 这边的 `ossFiles.status` 永远停在 `PENDING(0)`，前端因为收到 `{ success:false, error }` 把当次上传判定为失败，但 OSS 上文件其实已经在了。

本设计新增一条前端兜底链路：当前端检测到回调失败时，主动调一个新接口 `POST /api/v1/storage/confirm-upload`，由后端用 OSS `head` 直接核对实际状态；若文件存在则把 `status` 修复为 `UPLOADED` 并返回成功。整条改动不引入定时任务、不增加数据库列、不动现有 `callback` 接口语义。

## 背景

### 当前链路

1. 前端调 `POST /api/v1/storage/presigned-url`（`server/api/v1/storage/presigned-url/.post.ts`）：服务端事务里 `createOssFilesDao` 落库（`status=PENDING`）+ `generatePostSignatureService` 生成 OSS 直传签名，返回 `PostSignatureResult[]`。
2. 前端 Worker（`app/workers/fileUpload.worker.ts`）走 OSS PostObject 直传。
3. OSS 上传完成后回调 LexSeek 的 `POST /api/v1/storage/callback`（`server/api/v1/storage/callback/.post.ts`），handler 调 `updateOssFileDao` 把 `status` 改成 `UPLOADED(1)`。
4. OSS 把 callback handler 的 JSON 响应**透传**给上传方（即前端 Worker）作为本次 PostObject 的响应体。

### 失败场景

`server/api/v1/storage/callback/.post.ts` 现状：

- 第 18 行 `readBody(event)` 异常 → catch 命中，返回 `{ success:false, error:'callback processing failed' }`
- 第 49 行 `updateOssFileDao(fileId, { status: UPLOADED, ... })` 异常 → catch 命中，同上返回
- 第 40-46 行 `fileId` 缺失 → 返回 `{ success:false, error:'fileId is required' }`

三种情况下文件可能已上传到 OSS，但 LexSeek 数据库 `ossFiles.status` 仍然是 `PENDING`。前端 Worker 的 success 消息透传给 Composable 的 `data = { success:false, error:... }`，Composable 现在把它当作业务数据传给 `onSuccess`，调用方下游又会因为找不到 fileId/url 等字段失败。

### 现有可复用资产

| 资产 | 路径 | 用途 |
|------|------|------|
| OSS 适配器抽象 | `server/lib/storage/types.ts` `StorageAdapter` 接口 | 在此加 `head` 抽象方法 |
| 阿里云适配器 | `server/lib/storage/adapters/aliyun-oss.ts` `AliyunOssAdapter` | 在此实现 `head` |
| OSS 底层封装 | `server/lib/oss/{upload,delete,signedUrl}.ts` 等 | 类比加 `headFile.ts` |
| OSS NoSuchKey 识别 | `AliyunOssAdapter.isNotFoundError(error)` | head 内部直接复用 |
| OSS 文件状态枚举 | `shared/types/file.ts` `OssFileStatus` | 不动 |
| ossFiles DAO | `server/services/files/ossFiles.dao.ts` | 加一个原子条件更新 DAO |
| 签名结果类型 | `server/lib/storage/types.ts` `AliyunPostSignatureResult` | 加可选字段 `ossFileId` |

## 目标

1. **前端体验保底**：回调挂掉时用户当次仍然能完成上传（多 0.3-0.8s 校验延迟），不出现"OSS 文件已存在但 LexSeek 报上传失败"的误判。
2. **数据状态收敛**：`ossFiles.status` 在回调链路成功率 < 100% 的情况下仍能稳定收敛到正确值。
3. **零数据库变更**：不加表、不加字段、不写迁移，所有改动都在代码层。
4. **零侵入现有 callback 接口**：保留 `callback` handler 现状（catch 不抛错、恒返回 200），避免 OSS 端做无谓重试。

## 非目标

- 不做后台定时扫描任务（已在 brainstorming 阶段砍掉）。
- 不为腾讯云 / 七牛云适配器实现 `head`（两家 adapter 当前整体仍是 stub）。
- 不在 `ossFiles` 表加 `etag` / `lastVerifiedAt` 等字段（YAGNI；本期不做覆盖检测）。
- 不对 callback handler 做重试包装（`success:false` 在 OSS 层已是 client error，重试也不会成功）。
- 不接告警 / metrics 通道（项目暂未统一告警基建，本期只用 logger 结构化输出）。

## 架构设计

### 整体数据流

```
                       ┌────────────────────────────────────────────┐
                       │  前端 Composable                            │
                       │  useFileUploadWorker.upload()              │
                       └──────────────┬─────────────────────────────┘
                                      │ 已知 ossFileId（来自 presigned-url 返回）
                                      ▼
                       ┌────────────────────────────────────────────┐
                       │  Worker → OSS 直传                          │
                       └──────────────┬─────────────────────────────┘
                                      │ status=200, body=callback 响应
                                      ▼
                  ┌───────────────────┴────────────────────┐
       data.success !== false                  data.success === false
                  │                                        │
                  ▼                                        ▼
            正常路径                          POST /api/v1/storage/confirm-upload
            onSuccess(data)                          { fileId: ossFileId }
                                                          │
                                                          ▼
                                       ┌──────────────────────────────────────┐
                                       │ verifyAndFixOssFileService           │
                                       │ ┌──────────────────────────────────┐ │
                                       │ │ 1. 校验归属（owner-only）         │ │
                                       │ │ 2. 读 ossFiles.status            │ │
                                       │ │   ── UPLOADED → resSuccess       │ │
                                       │ │   ── FAILED   → resError 409     │ │
                                       │ │   ── PENDING  → 走 head           │ │
                                       │ │ 3. AliyunOssAdapter.head(path)   │ │
                                       │ │   ── 命中 → DAO 条件更新        │ │
                                       │ │              → resSuccess        │ │
                                       │ │   ── null   → resError 404       │ │
                                       │ │   ── throw  → resError 503       │ │
                                       │ └──────────────────────────────────┘ │
                                       └──────────────────────────────────────┘
```

### 新增 / 修改文件清单

| 文件 | 类型 | 说明 |
|------|------|------|
| `server/lib/oss/headFile.ts` | 新增 | OSS 底层 head 封装（类比 `upload.ts`）+ 单一定义 `HeadObjectResult` 接口 |
| `server/lib/oss/index.ts` | 修改 | re-export `headFile` 和 `HeadObjectResult` 类型 |
| `server/lib/storage/types.ts` | 修改 | `StorageAdapter` 接口加 `head`；从 `../oss/headFile` re-export `HeadObjectResult`；`AliyunPostSignatureResult` 加可选 `ossFileId` |
| `shared/types/oss.ts` | 修改 | 前端实际引用的 `PostSignatureResult` 接口加可选 `ossFileId?: number` |
| `server/lib/storage/base.ts` | 修改 | `BaseStorageAdapter` 加 `head` 默认实现（throw NotImplemented） |
| `server/lib/storage/adapters/aliyun-oss.ts` | 修改 | 重写 `head`，调底层 `headFile` |
| `server/services/files/ossFiles.dao.ts` | 修改 | 新增 `markOssFileUploadedByVerifyDao` 原子条件更新 |
| `server/services/files/ossFileVerify.service.ts` | 新增 | 新增 `verifyAndFixOssFileService` |
| `server/api/v1/storage/confirm-upload/.post.ts` | 新增 | 用户端兜底接口 |
| `server/api/v1/storage/presigned-url/.post.ts` | 修改 | handler 内 `results.push` 时把 `ossFileId: ossFile.id` 拼进返回项 |
| `server/services/storage/storage.service.ts` | 修改 | 把内部 `getAdapter` 重命名为 `getStorageAdapterService` 并导出，供 verify service 复用 |
| `app/composables/useFileUploadWorker.ts` | 修改 | 在 Worker `success` 消息分发里识别 `data.success === false` 并触发兜底；上传发起方需要把 `ossFileId` 注入 task |

### 测试文件

| 文件 | 类型 | 说明 |
|------|------|------|
| `tests/server/lib/storage/aliyun-oss-head.test.ts` | 新增 | AliyunOssAdapter.head 在 NoSuchKey / 200 / 5xx 三种 OSS 响应下的返回 |
| `tests/server/services/files/ossFileVerify.service.test.ts` | 新增 | verifyAndFixOssFileService 状态机覆盖 |
| `tests/server/api/v1/storage/confirm-upload.test.ts` | 新增 | 接口集成：未登录 / 越权 / PENDING+head 命中 / PENDING+head=null / 已 UPLOADED / 已 FAILED |
| `tests/server/services/files/ossFiles.dao.test.ts` | 新增或追加 | `markOssFileUploadedByVerifyDao` 条件更新原子性（PENDING→UPLOADED 唯一改一次） |
| `tests/client/composables/useFileUploadWorker.test.ts` | 新增 | 兜底分支：data.success===false + ossFileId 缺失/命中/接口失败 |

## 详细设计

### 1. OSS 底层 — `server/lib/oss/headFile.ts`

类比 `upload.ts` / `delete.ts` 的写法。`HeadObjectResult` 类型在本文件单一定义；`server/lib/storage/types.ts` 通过 `export type { HeadObjectResult } from '../oss/headFile'` re-export，保持项目既有"storage → oss" 的依赖方向。

> **SDK 方法选择**：用 `client.getObjectMeta(name)` 而不是 `client.head(name)`。原因：ali-oss `head.js` 源码里自带告警："Because HeadObject has gzip enabled, head cannot get the file size correctly. If you need to get the file size, please use getObjectMeta"。两者返回结构兼容（`{status, res}`，`res.res.headers` 字段相同），但 `getObjectMeta` 在带 gzip 的对象上能拿到准确 `content-length`。

```typescript
import type { OssConfig } from '~~/shared/types/oss'
import { createOssClient } from './client'
import { createLogger } from '#shared/utils/logger'

/**
 * head 操作结果（对象元数据） — 单一定义源
 */
export interface HeadObjectResult {
    /** 对象字节数 */
    size: number
    /** OSS ETag（去引号） */
    etag: string
    /** Content-Type */
    contentType: string
    /** 最后修改时间 */
    lastModified: Date
}

/**
 * head OSS 对象元数据
 * @returns 对象存在 → 元数据；NoSuchKey/404 → null；其他错误（5xx/网络/凭证）→ throw
 */
export async function headFile(
    config: OssConfig,
    objectKey: string
): Promise<HeadObjectResult | null> {
    const log = createLogger('oss:head')
    const { client } = await createOssClient(config)

    try {
        const res = await client.getObjectMeta(objectKey)
        const headers = res.res.headers as Record<string, string | undefined>

        return {
            size: Number(headers['content-length'] ?? 0),
            etag: String(headers.etag ?? '').replace(/"/g, ''),
            contentType: String(headers['content-type'] ?? ''),
            lastModified: new Date(String(headers['last-modified'] ?? Date.now())),
        }
    } catch (error: unknown) {
        const e = error as { code?: string; status?: number }
        if (e?.code === 'NoSuchKey' || e?.status === 404) {
            log.debug('对象不存在', { objectKey })
            return null
        }
        log.warn('head 调用异常，向上抛出', { objectKey, error })
        throw error
    }
}
```

`server/lib/oss/index.ts` 追加：

```typescript
export { headFile } from './headFile'
export type { HeadObjectResult } from './headFile'
```

### 2. 适配器层 — `server/lib/storage/types.ts`

#### 2.1 re-export `HeadObjectResult`（保持 storage → oss 依赖方向）

`HeadObjectResult` 单一定义在 `server/lib/oss/headFile.ts`（详见 §1）。`server/lib/storage/types.ts` 在"操作结果类型"段下追加：

```typescript
// re-export 让 StorageAdapter 接口签名能引用，避免跨层反向依赖
export type { HeadObjectResult } from '../oss/headFile'
```

> 与 `aliyun-oss.ts` 等已有"storage → oss"依赖一致（参考 `server/lib/storage/adapters/aliyun-oss.ts:37`）；oss 是底层、storage 是抽象层，类型从底层向上 re-export，不引入反向依赖。

#### 2.2 `StorageAdapter` 接口加方法

```typescript
export interface StorageAdapter {
    // ...现有方法...

    /**
     * 查询对象元数据
     * @param path 对象路径
     * @returns 存在则返回元数据；不存在返回 null；网络/凭证等基建错误抛异常
     */
    head(path: string): Promise<HeadObjectResult | null>
}
```

#### 2.3 两处签名结果类型同步加 `ossFileId`

LexSeek 项目里前后端各有一份签名结果类型定义，调用路径不同，必须**两处都加**：

| 位置 | 类型 | 谁用 |
|------|------|------|
| `server/lib/storage/types.ts` `AliyunPostSignatureResult` | 后端适配器返回类型（联合类型 `PostSignatureResult` 的一员） | server/lib/storage 内部 |
| `shared/types/oss.ts` `PostSignatureResult` | 前端用的扁平接口（已经包含阿里云字段） | `app/composables/useFileUploadWorker.ts` 等前端模块 |

两处都加 `ossFileId?: number`：

```typescript
// server/lib/storage/types.ts
export interface AliyunPostSignatureResult extends BasePostSignatureResult {
    // ...现有字段...
    ossFileId?: number   // 由 presigned-url handler 写入，前端用于兜底
}

// shared/types/oss.ts
export interface PostSignatureResult {
    // ...现有字段...
    ossFileId?: number   // 同上；与 AliyunPostSignatureResult 镜像
}
```

> 两份类型并存是项目历史结构（前端不依赖 server/lib，避免引到 Node 类型）。本期不做合并，只对齐字段；合并到统一的 BasePostSignatureResult 留给后续重构。

### 3. 适配器层 — `BaseStorageAdapter` 默认实现

`server/lib/storage/base.ts` 加：

```typescript
async head(_path: string): Promise<HeadObjectResult | null> {
    throw new Error(`${this.type} adapter does not implement head()`)
}
```

> 这样腾讯云 / 七牛云适配器即使不实现 `head` 也能编译通过；调用时报 `NotImplemented` 走上层 5xx 错误处理，不污染数据。

### 4. 适配器层 — `AliyunOssAdapter` 实现

`server/lib/storage/adapters/aliyun-oss.ts` 在 `download` 后追加：

```typescript
import { headFile as ossHeadFile } from '~~/server/lib/oss'

// ...类内...

async head(path: string): Promise<HeadObjectResult | null> {
    try {
        const result = await ossHeadFile(this.toOssConfig(), path)
        if (!result) return null
        return {
            size: result.size,
            etag: result.etag,
            contentType: result.contentType,
            lastModified: result.lastModified,
        }
    } catch (error) {
        // 配置/凭证错误转换；网络错误等保持原样向上抛
        throw convertAliyunError(error, this.wrapDownloadError(error).constructor as any)
    }
}
```

### 5. DAO — `server/services/files/ossFiles.dao.ts`

新增方法：

```typescript
/**
 * 仅在 status=PENDING 时把记录标记为 UPLOADED（条件更新，原子幂等）
 *
 * @returns 实际改动行数；0 表示已被回调路径提前修复或被并发改成其他状态
 */
export async function markOssFileUploadedByVerifyDao(
    fileId: number,
    options?: { auditNote?: string }
): Promise<number> {
    const result = await prisma.ossFiles.updateMany({
        where: {
            id: fileId,
            status: OssFileStatus.PENDING,
            deletedAt: null,
        },
        data: {
            status: OssFileStatus.UPLOADED,
        },
    })

    if (result.count > 0) {
        logger.info(
            { fileId, source: 'confirm_upload', auditNote: options?.auditNote ?? null },
            '[ossFiles] PENDING → UPLOADED via head verification'
        )
    }
    return result.count
}
```

并发安全：`updateMany` + `WHERE status=PENDING` 等价于"乐观锁"，并发两次调用只有一次会拿到 `count=1`，第二次拿到 `count=0`，service 层据此判断"已被别人修复"。

### 6. Service — `server/services/files/ossFileVerify.service.ts`

```typescript
import { OssFileStatus } from '#shared/types/file'
import { createLogger } from '#shared/utils/logger'
import { StorageProviderType } from '~~/server/lib/storage/types'
import { getStorageAdapterService } from '~~/server/services/storage/storage.service'
import {
    findOssFileByIdDao,
    markOssFileUploadedByVerifyDao,
} from './ossFiles.dao'

const log = createLogger('ossFileVerify')

/** verifyAndFixOssFileService 返回结果 */
export type VerifyOssFileResult =
    | { ok: true; status: 'uploaded' }
    | { ok: false; reason: 'forbidden' | 'not_found' | 'already_failed' | 'invalid' }

/**
 * 校验并修复单条 OSS 文件状态
 * - 已 UPLOADED → 直接 ok
 * - PENDING + OSS head 命中 → 修复成 UPLOADED 后 ok
 * - PENDING + OSS head=null → not_found
 * - FAILED → already_failed
 * - 不属于该用户 → forbidden
 *
 * 适配器抛异常（OSS 5xx / 网络）会向上抛，由 handler 转 503
 */
export async function verifyAndFixOssFileService(
    fileId: number,
    userId: number
): Promise<VerifyOssFileResult> {
    // 复用现成 DAO（已经过滤 deletedAt:null，返回完整 ossFiles 实体）
    const file = await findOssFileByIdDao(fileId)

    if (!file) return { ok: false, reason: 'invalid' }
    if (file.userId !== userId) return { ok: false, reason: 'forbidden' }

    if (Number(file.status) === OssFileStatus.UPLOADED) {
        return { ok: true, status: 'uploaded' }
    }
    if (Number(file.status) === OssFileStatus.FAILED) {
        return { ok: false, reason: 'already_failed' }
    }

    if (!file.filePath) {
        log.error('PENDING 文件缺少 filePath，无法兜底', { fileId })
        return { ok: false, reason: 'invalid' }
    }

    // 复用 storage.service 的 adapter 获取逻辑（按 userId 找用户绑定/默认配置）
    const adapter = await getStorageAdapterService({
        type: StorageProviderType.ALIYUN_OSS,
        userId: file.userId,
    })

    const headResult = await adapter.head(file.filePath)
    if (!headResult) {
        log.info({ fileId, filePath: file.filePath }, '[verify] head=null')
        return { ok: false, reason: 'not_found' }
    }

    const updated = await markOssFileUploadedByVerifyDao(fileId, {
        auditNote: `verified via head, size=${headResult.size}`,
    })
    if (updated === 0) {
        // 并发：被回调或其他兜底先改了；按结果重读一次判断
        const fresh = await prisma.ossFiles.findFirst({
            where: { id: fileId },
            select: { status: true },
        })
        if (fresh?.status === OssFileStatus.UPLOADED) {
            return { ok: true, status: 'uploaded' }
        }
        return { ok: false, reason: 'invalid' }
    }
    return { ok: true, status: 'uploaded' }
}
```

> **adapter 来源**：复用 `storage.service.ts` 的 `getAdapter` helper（本设计将其重命名为 `getStorageAdapterService` 并 export）。它按 `userId + type` 优先查用户绑定配置，否则回落到默认配置（`getDefaultStorageConfigDao`），与 `presigned-url`/`uploadFileService`/`downloadFileService` 走同一条配置链路。多 configId 并行（同一用户多家存储）场景留待 `ossFiles.storageConfigId` 字段引入时再开。

### 7. API 接口 — `server/api/v1/storage/confirm-upload/.post.ts`

```typescript
import { z } from '#shared/utils/zod'
import { createLogger } from '#shared/utils/logger'
import { verifyAndFixOssFileService } from '~~/server/services/files/ossFileVerify.service'

export default defineEventHandler(async (event) => {
    const log = createLogger('storage-confirm-upload')

    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const bodySchema = z.object({
        fileId: z.number({ message: 'fileId 必须为数字' }).int().positive(),
    })
    const parsed = bodySchema.safeParse(await readBody(event))
    if (!parsed.success) {
        return resError(event, 400, parsed.error.issues[0]?.message ?? '参数错误')
    }
    const { fileId } = parsed.data

    try {
        const result = await verifyAndFixOssFileService(fileId, user.id)

        if (result.ok) {
            return resSuccess(event, '已确认上传', { status: result.status })
        }

        switch (result.reason) {
            case 'forbidden': return resError(event, 403, '无权操作此文件')
            case 'not_found': return resError(event, 404, '文件未在存储上找到，请重新上传')
            case 'already_failed': return resError(event, 409, '文件已被标记为失败')
            case 'invalid': return resError(event, 400, '文件记录不存在或异常')
        }
    } catch (error) {
        log.error({ fileId, error }, '兜底校验异常')
        return resError(event, 503, 'OSS 服务暂时不可达，请稍后重试')
    }
})
```

**鉴权**：走默认 `02.auth` 中间件，必须登录；service 层做 owner-only 校验。**不进 admin 路径，不进 RBAC**（用户端接口）。

**响应码**（统一用 HTTP 风格，与项目现有约定一致；`resSuccess` 自带 0 / 200，`resError` 直接传 code）：

| code | 含义 | 前端动作 |
|------|------|---------|
| 0 / 200（resSuccess） | 已 UPLOADED 或修复成功 | 当作上传成功 |
| 400 | 参数错误 / 文件记录异常 | 报错给用户 |
| 401 | 未登录 | 跳登录页 |
| 403 | 越权 | 报错"无权操作" |
| 404 | OSS 上确实不存在 | 报错"上传失败请重试" |
| 409 | 文件已被标记为 FAILED | 报错"已失败请重新上传" |
| 503 | OSS 异常 | 前端可重试一次 |

### 8. presigned-url handler 微调

`server/api/v1/storage/presigned-url/.post.ts` 第 142-203 行的事务里，将 `ossFile.id` 注入返回结果：

```typescript
const signature = await generatePostSignatureService({
    // ...现有参数...
})

results.push({
    ...(signature as PostSignatureResult),
    ossFileId: ossFile.id,
} as PostSignatureResult)
```

类型上 `AliyunPostSignatureResult.ossFileId?: number` 已加，纯增量字段、向后兼容。

### 8.1 storage.service 导出 helper

`server/services/storage/storage.service.ts` 当前的 internal `getAdapter(options)` 函数（第 31-54 行）改成导出，并重命名以符合"Service 后缀"规则：

```typescript
// 改前（internal）
async function getAdapter(options: { configId?: number; userId?: number; type?: StorageProviderType }): Promise<StorageAdapter> { ... }

// 改后（export）
export async function getStorageAdapterService(options: {
    configId?: number
    userId?: number
    type?: StorageProviderType
}): Promise<StorageAdapter> { ... }
```

文件内部其他位置（`uploadFileService` / `downloadFileService` 等）的 `getAdapter()` 调用全部替换为 `getStorageAdapterService()`。函数体逻辑不变。

### 9. 前端 — Worker

`app/workers/fileUpload.worker.ts` **零改动**。Worker 仍然把 OSS 200/204 响应原样透传给主线程，不做业务判断。

### 10. 前端 — Composable

`app/composables/useFileUploadWorker.ts` 改动点：

#### 10.1 task 结构里携带 `ossFileId`

```typescript
interface UploadTask {
    id: string
    callbacks: UploadCallbacks
    ossFileId?: number   // 新增：用于兜底
}
```

#### 10.2 `upload` 方法签名扩展

```typescript
const upload = (
    file: File,
    signature: PostSignatureResult,
    callbacks: UploadCallbacks
): string => {
    // ...
    tasks.set(id, { id, callbacks, ossFileId: signature.ossFileId })
    // ...
}
```

#### 10.3 success 消息分发：识别回调失败、触发兜底

> 文件顶部新增 `import { useApiFetch } from '~/composables/useApiFetch'`（项目自动导入已收窄，composable 必须显式 import）。`PostSignatureResult.ossFileId` 已在 `shared/types/oss.ts` 上加可选字段，前端直接 `signature.ossFileId` 即可，无需新增 import。

```typescript
case 'success': {
    const data = response.data || {}
    const callbackOk = data?.success !== false

    if (callbackOk) {
        task.callbacks.onSuccess?.(data)
        tasks.delete(response.id)
        break
    }

    // 回调失败：用 ossFileId 兜底
    if (!task.ossFileId) {
        task.callbacks.onError?.(new Error('上传回调失败且无法兜底校验'))
        tasks.delete(response.id)
        break
    }

    try {
        const result = await useApiFetch<{ status: 'uploaded' }>(
            '/api/v1/storage/confirm-upload',
            { method: 'POST', body: { fileId: task.ossFileId } }
        )
        if (result?.status === 'uploaded') {
            // 兜底成功，等价于 callback 成功；data 由调用方按 fileId 自行查后续业务字段
            task.callbacks.onSuccess?.({ recovered: true, fileId: task.ossFileId })
        } else {
            task.callbacks.onError?.(new Error('上传校验失败，请重新上传'))
        }
    } catch (error) {
        task.callbacks.onError?.(error instanceof Error ? error : new Error('上传校验异常'))
    } finally {
        tasks.delete(response.id)
    }
    break
}
```

> ⚠️ **`useApiFetch` 自动提取 data 字段**（见 `.claude/rules/fetch.md`）：泛型直接写实际数据类型 `{ status: 'uploaded' }`，**不要**包 `{ data: ... }`；失败时 `result` 为 `null`，要先判 `null`。

#### 10.4 调用方契约

`upload()` 的 `onSuccess(data)` 回调，调用方需要兼容两种 data：

| 场景 | data 字段 |
|------|----------|
| 回调正常 | OSS 透传的 callback handler 返回值（含 `fileId` / `filename` / `size` / `mimeType` 等） |
| 兜底成功 | `{ recovered: true, fileId: number }` |

调用方（`MaterialUploader.vue` 等）取 `fileId` 即可继续后续业务流；其他字段在兜底场景下需要靠后端补 / 不依赖。

> 这一节有个隐含约束：**兜底分支返回的 data 只保证 `{ recovered: true, fileId: number }` 两个字段**。
>
> plan 阶段必须做的一项调研：grep 所有 `useFileUploadWorker().upload(...)` 的调用点（`MaterialUploader.vue` 等），核对它们的 `onSuccess` 是否对 `filename` / `size` / `mimeType` 等字段有强依赖；若有，**在 plan 里同步修整这些调用点**——让兜底分支等价：拿到 `fileId` 后由调用方按需另查（已有 `/api/v1/files/*` 类查询接口可用）。本期 spec 只锁定 `fileId 一定有`，调用点适配的具体范围由 plan 量化。

## 错误处理与边界场景

| 场景 | 当前行为 | 设计后行为 |
|------|---------|-----------|
| OSS 直传成功 + callback 成功 | 上传成功 | 不变 |
| OSS 直传成功 + callback handler 抛错 | 前端报错 | 触发 confirm-upload → head 命中 → 修复 → 上传成功 |
| OSS 直传成功 + DB updateOssFileDao 失败 | 同上 | 同上 |
| OSS 直传成功 + 回调网络丢失 / OSS 没拿到 callback 响应 | 用户感知到上传"失败"（但 OSS 实际有文件） | 同上（前端在 success 分支拿到 `data.success===false` 这条路才走兜底；如果 OSS 直传层就抛 error，进的是 Worker error 分支，本期不做兜底——见非目标） |
| OSS 直传失败（403/网络/超时） | Worker error 分支报错 | 不变（不在本期兜底范围） |
| confirm-upload 接口 OSS 凭证错误 | N/A | 503 → 前端可重试 |
| confirm-upload 并发：用户连点 / Worker 重发 | N/A | DAO 条件更新 + service 层 fresh-read 兜底，幂等返回 success |
| 前端拿不到 ossFileId（旧版客户端 / 兼容场景） | N/A | onError("上传回调失败且无法兜底校验") — 按上传失败处理 |

## 测试策略

### 单元 / 集成测试（必写，TDD 顺序）

按"先红后绿"顺序：

1. **`tests/server/services/files/ossFiles.dao.test.ts`** —— 给 `markOssFileUploadedByVerifyDao` 加用例：
   - PENDING → 改成 UPLOADED，count=1
   - UPLOADED → 不改，count=0
   - FAILED → 不改，count=0
   - deletedAt 非 null → 不改，count=0
   - 并发两次只命中一次（fast-check property test：随机两个 promise 同时调，断言 count 之和 = 1）

2. **`tests/server/services/files/ossFileVerify.service.test.ts`** —— mock adapter.head：
   - file 不存在 → invalid
   - file.userId !== userId → forbidden
   - status=UPLOADED → ok
   - status=FAILED → already_failed
   - status=PENDING + head=null → not_found，DB 不改
   - status=PENDING + head 命中 → ok，DB.status=UPLOADED
   - status=PENDING + adapter.head throws → 服务向上抛
   - 并发：同 fileId 两次 verify，最终 status=UPLOADED 且只有一条 logger.info
   - filePath 缺失 → invalid

3. **`tests/server/lib/storage/aliyun-oss-head.test.ts`** —— mock ali-oss `client.getObjectMeta`：
   - 200 + headers → 返回结构化 HeadObjectResult
   - NoSuchKey → 返回 null
   - 5xx / 网络错误 → 抛 StorageNetworkError

4. **`tests/server/api/v1/storage/confirm-upload.test.ts`** —— 接口集成（用 worker DB 隔离）：
   - 未登录 → 401
   - 入参缺失 / 非数字 → 400
   - fileId 不存在 → 400
   - 越权（fileId 属于他人）→ 403
   - 已 UPLOADED → 200, status='uploaded'
   - 已 FAILED → 409
   - PENDING + adapter mock head=null → 404
   - PENDING + adapter mock head 命中 → 200，DB 变更
   - PENDING + adapter mock head throws → 503

### 前端测试

- `tests/client/composables/useFileUploadWorker.test.ts`（如已有则补，没有则新建）：
  - mock Worker postMessage：
    - data.success 不存在 → 走正常 onSuccess
    - data.success === false + ossFileId 缺失 → onError
    - data.success === false + ossFileId 存在 + useApiFetch mock 返回 `{status:'uploaded'}` → onSuccess({recovered:true, fileId})
    - data.success === false + useApiFetch mock 返回 null → onError

### 不写测试的场景

- E2E（跑真 OSS）：本期不做；adapter 层用 mock，service 层用 worker DB，已经覆盖关键路径。
- 性能压测：confirm-upload 走单次 OSS head（ali-oss head ~50ms）+ 1 条 DB update，复杂度 O(1)，不需要压测。

## 验收标准

- [ ] 全量测试 `bun run test` 通过
- [ ] 类型检查 `bun run typecheck` 通过
- [ ] 手动跑：在 dev 环境模拟 callback 失败（临时让 `updateOssFileDao` 抛错），前端 Worker 走兜底分支，最终 `ossFiles.status` 仍变为 UPLOADED，前端展示上传成功
- [ ] 已 UPLOADED 文件再调一次 confirm-upload：返回 200 status='uploaded'（幂等）
- [ ] OSS 上确实不存在的 fileId（PENDING 状态）：返回 404
- [ ] 前端 logger 能看到 `'PENDING → UPLOADED via head verification'` 结构化日志
- [ ] 不引入新表 / 新字段；`prisma migrate status` 显示无 drift
- [ ] 现有上传成功路径（callback 正常）行为完全不变

## 不做什么（边界）

| 不做 | 原因 |
|------|------|
| 后台定时扫描 PENDING | 本期已收敛为"前端兜底"单一链路；定时扫描留到下期需要时再做 |
| 给 ossFiles 加 `etag` / `lastVerifiedAt` 字段 | YAGNI；本期只修复 status |
| 腾讯/七牛适配器实现 head | 两家整体仍是 stub；本期只依赖阿里云 |
| 修改 callback handler 行为 | OSS 透传机制下，callback 返回 `success:false` 是 OSS 层 client error 信号，改动它会带来意外副作用 |
| 在 DB 加 audit 表记录"哪条路径修复的" | 用 logger 结构化输出 + 关键字搜日志即可；加表是过度设计 |
| 给 confirm-upload 接口加全局速率限制 | 用户端接口已在 02.auth 之后，攻击面有限；如发现滥用再加 |
| presigned-url 接口的 `ossFileId` 字段在七牛/腾讯签名结果上同步 | 两家未启用，下期统一抽到 `BasePostSignatureResult` 即可 |
| 在 ossFileVerify.service 里给兜底分支补 filename/size/mimeType 字段 | 这些字段在创建 ossFiles 时就已经写库，调用方按 fileId 查即可；不在兜底服务里重复传递 |

## 依赖与风险

### 依赖

- `ali-oss` SDK 的 `client.getObjectMeta(name)` 方法（已被项目通过 `server/lib/oss/client.ts` 引入）
- 项目已有的 `useRuntimeConfig().storage.aliyunOss` 配置链路
- `worker DB 隔离` 测试基建（`tests/_infra/`）

### 风险

| 风险 | 评估 | 应对 |
|------|------|------|
| 用户连点上传按钮 / 网络抖动重发 | DAO 条件更新 + service fresh-read 兜底已幂等 | 已在测试用例覆盖 |
| 前端拿不到 ossFileId（旧客户端缓存） | 走 onError 报"无法兜底校验"，体验和现状一致 | 不算回退，可接受 |
| storage runtimeConfig 切换到非阿里云时 head 抛 NotImplemented | 业务上目前只有阿里云 | service 层捕获后转 503；下期支持其他家时同步实现 |

> **read-after-write 一致性**：阿里云 OSS 自 2018 起对新对象提供强一致性，PostObject 200 后立即 `getObjectMeta` 必然返回，本期不为"立即可见延迟"做兜底重试。

## 实施顺序建议

按测试先行、底层先建的顺序：

1. `server/lib/oss/headFile.ts` + 单测
2. `server/lib/storage/types.ts` + `base.ts` 接口扩展
3. `server/lib/storage/adapters/aliyun-oss.ts` head 实现 + 单测
4. `server/services/files/ossFiles.dao.ts` 新 DAO + 单测
5. `server/services/files/ossFileVerify.service.ts` + 单测
6. `server/api/v1/storage/confirm-upload/.post.ts` + 集成测试
7. `server/api/v1/storage/presigned-url/.post.ts` 加 `ossFileId` 透出
8. `app/composables/useFileUploadWorker.ts` 兜底分支 + 单测
9. dev 环境手动验证（人工模拟 callback 失败）
10. typecheck + 全量测试 + commit
