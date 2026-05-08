# OSS 上传回调失败前端兜底校验 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 OSS 上传链路加一条前端兜底：当回调失败导致 `ossFiles.status` 停留在 `PENDING` 时，前端自动调新接口由后端 `head` OSS 校验真实状态并修复，避免"OSS 文件已存在但 LexSeek 报上传失败"。

**Architecture:** 复用项目已有 `StorageAdapter` 抽象 + `server/lib/oss` 底层封装。新增 `headFile` 底层函数 + 适配器 `head` 抽象方法 + 阿里云适配器实现 + 兜底 `verifyAndFix` service + 用户端 `POST /api/v1/storage/confirm-upload` handler。前端 composable 在收到 callback 失败响应时调用兜底接口。零数据库变更。

**Tech Stack:** Nuxt 4 / Nitro / Prisma / TypeScript / vitest / ali-oss SDK / shadcn-vue（不涉及）。

**Spec:** `docs/superpowers/specs/2026-05-08-oss-callback-fallback-design.md`

---

## File Structure（实施目标的所有文件）

### 生产代码

| # | 文件 | 类型 | 责任 |
|---|------|------|------|
| 1 | `server/lib/oss/headFile.ts` | 新增 | OSS 底层 head 封装（ali-oss `getObjectMeta`），单一定义 `HeadObjectResult` 类型 |
| 2 | `server/lib/oss/index.ts` | 修改 | re-export `headFile` 函数与 `HeadObjectResult` 类型 |
| 3 | `server/lib/storage/types.ts` | 修改 | `StorageAdapter` 接口加 `head` 抽象方法；从 `../oss/headFile` re-export `HeadObjectResult`；`AliyunPostSignatureResult` 加可选 `ossFileId` |
| 4 | `server/lib/storage/base.ts` | 修改 | `BaseStorageAdapter` 加 `head` 默认实现（throw NotImplemented） |
| 5 | `server/lib/storage/adapters/aliyun-oss.ts` | 修改 | `AliyunOssAdapter` 实现 `head`，调底层 `headFile` |
| 6 | `shared/types/oss.ts` | 修改 | 前端 `PostSignatureResult` 接口加可选 `ossFileId?: number` |
| 7 | `server/services/files/ossFiles.dao.ts` | 修改 | 新增 `markOssFileUploadedByVerifyDao` 原子条件更新 DAO |
| 8 | `server/services/files/ossFileVerify.service.ts` | 新增 | `verifyAndFixOssFileService` |
| 9 | `server/services/storage/storage.service.ts` | 修改 | 内部 `getAdapter` 改为导出 `getStorageAdapterService` |
| 10 | `server/api/v1/storage/confirm-upload/.post.ts` | 新增 | 用户端兜底接口 |
| 11 | `server/api/v1/storage/presigned-url/.post.ts` | 修改 | handler `results.push` 时把 `ossFileId: ossFile.id` 拼进返回项 |
| 12 | `app/composables/useFileUploadWorker.ts` | 修改 | task 结构带 `ossFileId`；success 分支检测 `data.success===false` 触发兜底 |

### 测试代码

| # | 文件 | 类型 | 测试目标 |
|---|------|------|---------|
| T1 | `tests/server/storage/oss-head-file.test.ts` | 新增 | `headFile` 函数三种 OSS 响应 |
| T2 | `tests/server/storage/aliyun-oss-adapter-unit.test.ts` | 新增 | `AliyunOssAdapter.head` 单元测试（mock 底层 headFile，与现有真实集成测试 `aliyun-oss-adapter.test.ts` 并行存在） |
| T3 | `tests/server/files/ossFiles.dao.unit.test.ts` | 追加 | `markOssFileUploadedByVerifyDao` 条件更新 |
| T4 | `tests/server/files/ossFileVerify.service.test.ts` | 新增 | `verifyAndFixOssFileService` 全状态机 |
| T5 | `tests/server/storage/storage.handlers.test.ts` | 追加 | `confirm-upload` handler 集成 |
| T6 | `tests/client/composables/useFileUploadWorker.test.ts` | 追加 | 兜底分支前端逻辑 |

> **测试文件位置依据**：项目里 `tests/server/storage/` 已经是 storage / adapter / handler 测试的统一目录（28 个文件）；`tests/server/files/` 是 ossFiles DAO / files service 测试目录（已有 `oss-files-dao.test.ts` / `ossFiles.dao.unit.test.ts`）。本 plan **追加**已有文件而不是新建并行文件，避免重复目录。

---

## 任务总览

| Task | 摘要 | 依赖 |
|------|------|------|
| 1 | `headFile` 底层函数 + `HeadObjectResult` 类型 | — |
| 2 | `StorageAdapter.head` 接口 + `BaseStorageAdapter` 默认实现 + `AliyunPostSignatureResult.ossFileId` | 1 |
| 3 | `AliyunOssAdapter.head` 实现 | 2 |
| 4 | `shared/types/oss.ts` `PostSignatureResult.ossFileId` | — |
| 5 | `storage.service.ts` 内部 `getAdapter` 改为导出 `getStorageAdapterService` | — |
| 6 | `markOssFileUploadedByVerifyDao` 原子条件更新 | — |
| 7 | `verifyAndFixOssFileService` | 3, 5, 6 |
| 8 | `POST /api/v1/storage/confirm-upload` handler | 7 |
| 9 | `presigned-url` handler 透出 `ossFileId` | 4 |
| 10 | `useFileUploadWorker` 前端兜底分支 | 4, 8, 9 |
| 11 | grep 调用方核对、typecheck、全量测试、收尾 commit | 1-10 |

---

## Task 1: `headFile` 底层函数 + `HeadObjectResult` 类型（含测试）

**Files:**
- Create: `server/lib/oss/headFile.ts`
- Modify: `server/lib/oss/index.ts`
- Test: `tests/server/storage/oss-head-file.test.ts`

- [ ] **Step 1: 写失败测试** `tests/server/storage/oss-head-file.test.ts`

```typescript
/**
 * server/lib/oss/headFile 单元测试
 *
 * mock ali-oss client 的 getObjectMeta；不联实际 OSS。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// 用 vi.hoisted 保证 mock fn 在 vi.mock 工厂执行前可用（ESM 提升要求，与项目 11+ 处现有风格一致）
const { getObjectMetaMock } = vi.hoisted(() => ({ getObjectMetaMock: vi.fn() }))
vi.mock('~~/server/lib/oss/client', () => ({
    createOssClient: vi.fn(async () => ({
        client: { getObjectMeta: getObjectMetaMock },
    })),
}))

import { headFile } from '~~/server/lib/oss/headFile'

const fakeConfig = {
    accessKeyId: 'ak',
    accessKeySecret: 'sk',
    bucket: 'b',
    region: 'oss-cn-hangzhou',
} as any

describe('headFile (server/lib/oss)', () => {
    beforeEach(() => {
        getObjectMetaMock.mockReset()
    })

    it('对象存在时返回结构化 HeadObjectResult', async () => {
        getObjectMetaMock.mockResolvedValueOnce({
            status: 200,
            res: {
                headers: {
                    'content-length': '12345',
                    etag: '"abc123"',
                    'content-type': 'application/pdf',
                    'last-modified': 'Sun, 03 May 2026 09:00:00 GMT',
                },
            },
        })

        const result = await headFile(fakeConfig, 'user1/case/file.pdf')

        expect(result).not.toBeNull()
        expect(result!.size).toBe(12345)
        expect(result!.etag).toBe('abc123')
        expect(result!.contentType).toBe('application/pdf')
        expect(result!.lastModified).toBeInstanceOf(Date)
    })

    it('NoSuchKey 返回 null（不抛错）', async () => {
        const err: any = new Error('NoSuchKey')
        err.code = 'NoSuchKey'
        err.status = 404
        getObjectMetaMock.mockRejectedValueOnce(err)

        const result = await headFile(fakeConfig, 'user1/case/missing.pdf')

        expect(result).toBeNull()
    })

    it('网络/凭证等其他错误向上抛出', async () => {
        const err: any = new Error('NetworkError')
        err.code = 'NetworkError'
        err.status = 500
        getObjectMetaMock.mockRejectedValueOnce(err)

        await expect(headFile(fakeConfig, 'user1/case/x.pdf')).rejects.toThrow('NetworkError')
    })
})
```

- [ ] **Step 2: 跑测试确认 fail**

Run: `npx vitest run tests/server/storage/oss-head-file.test.ts --reporter=verbose`

Expected: 全部失败，提示 `Cannot find module '~~/server/lib/oss/headFile'`

- [ ] **Step 3: 实现 `server/lib/oss/headFile.ts`**

```typescript
/**
 * OSS head（获取对象元数据）
 *
 * 用 ali-oss client.getObjectMeta()——SDK 自带告警："Because HeadObject has gzip
 * enabled, head cannot get the file size correctly. If you need to get the file size,
 * please use getObjectMeta"。两者返回结构兼容，getObjectMeta 在 gzip 对象上拿到的
 * content-length 准确。
 */
import type { OssConfig } from '~~/shared/types/oss'
import { createOssClient } from './client'
import { createLogger } from '#shared/utils/logger'

/**
 * head 操作结果（对象元数据） — 单一定义源
 */
export interface HeadObjectResult {
    /** 对象字节数（OSS Content-Length） */
    size: number
    /** OSS ETag（已去引号） */
    etag: string
    /** Content-Type，可能为空字符串 */
    contentType: string
    /** 最后修改时间 */
    lastModified: Date
}

/**
 * head OSS 对象元数据
 * @returns 对象存在 → 元数据；NoSuchKey/404 → null；其他错误 → throw
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

- [ ] **Step 4: 修改 `server/lib/oss/index.ts` 追加 re-export**

在文件末尾追加（如果已有 export 块就在合适位置插入）：

```typescript
export { headFile } from './headFile'
export type { HeadObjectResult } from './headFile'
```

- [ ] **Step 5: 跑测试确认 pass**

Run: `npx vitest run tests/server/storage/oss-head-file.test.ts --reporter=verbose`

Expected: 3/3 passed

- [ ] **Step 6: commit**

```bash
git add server/lib/oss/headFile.ts server/lib/oss/index.ts tests/server/storage/oss-head-file.test.ts
git commit -m "feat(storage): 新增 OSS headFile 底层封装与 HeadObjectResult 类型"
```

---

## Task 2: `StorageAdapter.head` 接口 + `BaseStorageAdapter` 默认实现 + `AliyunPostSignatureResult.ossFileId`

**Files:**
- Modify: `server/lib/storage/types.ts`
- Modify: `server/lib/storage/base.ts`

> 这一节只动接口定义，不涉及业务逻辑，没有独立测试用例。后续 Task 3 的 `AliyunOssAdapter.head` 测试会通过类型签名兜底。

- [ ] **Step 1: 修改 `server/lib/storage/types.ts`**

在"操作结果类型"段下追加 re-export（保持 storage → oss 单向依赖方向）：

```typescript
// re-export 让 StorageAdapter 接口签名能引用，与项目既有 storage→oss 依赖方向一致
// （参见 server/lib/storage/adapters/aliyun-oss.ts:37 已有 import from oss）
export type { HeadObjectResult } from '../oss/headFile'
```

在 `StorageAdapter` 接口的现有方法（`upload` / `download` / ...）后追加：

```typescript
    /**
     * 查询对象元数据
     * @param path 对象路径
     * @returns 对象存在 → 元数据；不存在 → null；网络/凭证等基建错误 → 抛异常
     */
    head(path: string): Promise<HeadObjectResult | null>
```

在 `AliyunPostSignatureResult` 接口现有字段（`securityToken?` 等）后追加：

```typescript
    /**
     * 对应的 ossFiles 表记录 ID
     * 由 presigned-url handler 写入；前端用于上传后的兜底校验
     */
    ossFileId?: number
```

- [ ] **Step 2: 修改 `server/lib/storage/base.ts`**

在 `BaseStorageAdapter` 类内追加 `head` 默认实现（在 `testConnection` 等其他抽象方法旁）：

```typescript
    async head(_path: string): Promise<HeadObjectResult | null> {
        throw new Error(`${this.type} adapter does not implement head()`)
    }
```

文件顶部如果还没有 import，需要补上：

```typescript
import type { HeadObjectResult } from './types'
```

- [ ] **Step 3: 类型检查**

Run: `bun run typecheck`

Expected: 通过（接口扩展，不影响现有实现因为 base 提供了默认 head；只有 AliyunOssAdapter 在 Task 3 会重写）

- [ ] **Step 4: commit**

```bash
git add server/lib/storage/types.ts server/lib/storage/base.ts
git commit -m "feat(storage): StorageAdapter 接口加 head 抽象方法 + 签名结果加 ossFileId"
```

---

## Task 3: `AliyunOssAdapter.head` 实现（含测试）

**Files:**
- Modify: `server/lib/storage/adapters/aliyun-oss.ts`
- Test: `tests/server/storage/aliyun-oss-adapter-unit.test.ts`（新建，与现有的真实 OSS 集成测试 `aliyun-oss-adapter.test.ts` 并行）

- [ ] **Step 1: 新建 `tests/server/storage/aliyun-oss-adapter-unit.test.ts`**

> 不追加到现有 `aliyun-oss-adapter.test.ts`：现有文件是真实 OSS 集成测试（含 describe.skip 控制无凭证时跳过）；本步骤的 head 单元测试用 mock 底层 lib，独立成一个 `*-unit.test.ts` 文件更清晰。

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// 用 vi.hoisted 把 mock fn 提到 vi.mock 工厂之前可用（避免 TDZ）
const { headFileMock } = vi.hoisted(() => ({ headFileMock: vi.fn() }))
vi.mock('~~/server/lib/oss', async (importOriginal) => {
    const actual = await importOriginal<any>()
    return {
        ...actual,
        headFile: headFileMock,
    }
})

import { AliyunOssAdapter } from '~~/server/lib/storage/adapters/aliyun-oss'
import { StorageProviderType } from '~~/server/lib/storage/types'

const adapterConfig = {
    type: StorageProviderType.ALIYUN_OSS,
    name: 'test',
    bucket: 'b',
    region: 'oss-cn-hangzhou',
    accessKeyId: 'ak',
    accessKeySecret: 'sk',
    enabled: true,
} as const

describe('AliyunOssAdapter.head', () => {
    beforeEach(() => {
        headFileMock.mockReset()
    })

    it('对象存在 → 返回 HeadObjectResult', async () => {
        headFileMock.mockResolvedValueOnce({
            size: 100,
            etag: 'abc',
            contentType: 'image/png',
            lastModified: new Date('2026-05-01T00:00:00Z'),
        })

        const adapter = new AliyunOssAdapter(adapterConfig as any)
        const result = await adapter.head('user1/case/x.png')

        expect(result).toEqual({
            size: 100,
            etag: 'abc',
            contentType: 'image/png',
            lastModified: new Date('2026-05-01T00:00:00Z'),
        })
        expect(headFileMock).toHaveBeenCalledWith(
            expect.objectContaining({ bucket: 'b', region: 'oss-cn-hangzhou' }),
            'user1/case/x.png'
        )
    })

    it('对象不存在 → 返回 null', async () => {
        headFileMock.mockResolvedValueOnce(null)
        const adapter = new AliyunOssAdapter(adapterConfig as any)
        expect(await adapter.head('missing')).toBeNull()
    })

    it('底层抛错 → 适配器向上抛', async () => {
        headFileMock.mockRejectedValueOnce(new Error('boom'))
        const adapter = new AliyunOssAdapter(adapterConfig as any)
        await expect(adapter.head('x')).rejects.toThrow()
    })
})
```

- [ ] **Step 2: 跑测试确认 fail**

Run: `npx vitest run tests/server/storage/aliyun-oss-adapter-unit.test.ts --reporter=verbose`

Expected: 失败，提示 `adapter does not implement head` 或类似

- [ ] **Step 3: 实现 `AliyunOssAdapter.head` 在 `server/lib/storage/adapters/aliyun-oss.ts`**

文件顶部 import 区追加（如果尚未导入 `headFile`）：

```typescript
import { headFile as ossHeadFile } from '~~/server/lib/oss'
import type { HeadObjectResult } from '../types'
```

类内 `download` / `downloadStream` 旁追加：

```typescript
    /**
     * 查询对象元数据
     */
    async head(path: string): Promise<HeadObjectResult | null> {
        try {
            return await ossHeadFile(this.toOssConfig(), path)
        } catch (error) {
            // 对齐既有适配器风格：保留底层错误，由上层决定 503/重试
            if (this.isNotFoundError(error)) return null
            throw error
        }
    }
```

> 注：因为底层 `headFile` 内部已经把 `NoSuchKey` 转 null，正常情况下不会走 `isNotFoundError` 分支；保留这层兜底是为了和现有适配器其他方法的错误识别风格一致（参见 `download` 第 217 行）。

- [ ] **Step 4: 跑测试确认 pass**

Run: `npx vitest run tests/server/storage/aliyun-oss-adapter-unit.test.ts --reporter=verbose`

Expected: 3/3 passed

- [ ] **Step 5: commit**

```bash
git add server/lib/storage/adapters/aliyun-oss.ts tests/server/storage/aliyun-oss-adapter-unit.test.ts
git commit -m "feat(storage): AliyunOssAdapter 实现 head 方法"
```

---

## Task 4: `shared/types/oss.ts` 加 `PostSignatureResult.ossFileId`

**Files:**
- Modify: `shared/types/oss.ts`

> 纯类型字段追加，前端需要这个字段拿到 ossFile.id 才能调兜底接口。无独立测试。

- [ ] **Step 1: 改 `shared/types/oss.ts` 的 `PostSignatureResult` 接口**

在第 95-120 行 `PostSignatureResult` 现有字段（`securityToken?` 后）追加：

```typescript
    /**
     * 对应的 ossFiles 表记录 ID
     * 由 /api/v1/storage/presigned-url handler 写入；前端在上传后用于兜底校验
     */
    ossFileId?: number
```

- [ ] **Step 2: 类型检查**

Run: `bun run typecheck`

Expected: 通过（纯增量字段，无现有调用者会破坏）

- [ ] **Step 3: commit**

```bash
git add shared/types/oss.ts
git commit -m "feat(storage): PostSignatureResult 加可选 ossFileId 用于前端兜底"
```

---

## Task 5: `storage.service.ts` 导出 `getStorageAdapterService`

**Files:**
- Modify: `server/services/storage/storage.service.ts`

> 把内部 `getAdapter`（第 31-54 行）改为导出 + 重命名（符合 Service 后缀规则），文件内部其他位置（`uploadFileService` / `downloadFileService` 等）的本地调用也同步替换。

- [ ] **Step 1: 在 `server/services/storage/storage.service.ts` 第 31 行修改函数签名**

```typescript
// 改前
async function getAdapter(options: { ... }): Promise<StorageAdapter> { ... }

// 改后
export async function getStorageAdapterService(options: {
    configId?: number
    userId?: number
    type?: StorageProviderType
}): Promise<StorageAdapter> {
    // 函数体保持不变
    ...
}
```

- [ ] **Step 2: 文件内其他调用点替换**

在 `uploadFileService` / `downloadFileService` / `downloadFileStreamService` / `deleteFileService` / `generateSignedUrlService` / `generatePostSignatureService` / `testStorageConnectionService` 等函数内部，把 `getAdapter(` 全部替换为 `getStorageAdapterService(`。

可以用编辑器全文件 replace（仅限本文件）：`getAdapter(` → `getStorageAdapterService(`

- [ ] **Step 3: 类型检查 + 跑现有 storage service 测试，确认无回归**

Run: `bun run typecheck`
Run: `npx vitest run tests/server/storage/storage.service.test.ts --reporter=verbose`

Expected: 类型通过 + 现有测试全部仍然 pass（仅函数名变化，行为不变）

- [ ] **Step 4: commit**

```bash
git add server/services/storage/storage.service.ts
git commit -m "refactor(storage): 内部 getAdapter 改为导出 getStorageAdapterService"
```

---

## Task 6: `markOssFileUploadedByVerifyDao` 原子条件更新

**Files:**
- Modify: `server/services/files/ossFiles.dao.ts`
- Test: `tests/server/files/ossFiles.dao.unit.test.ts`（追加）

- [ ] **Step 1: 在 `tests/server/files/ossFiles.dao.unit.test.ts` 末尾追加 describe 块**

复用项目现成的 test-db-helper（`tests/server/files/test-db-helper.ts` 已提供 `createTestUser` / `createTestOssFile` / `cleanupTestData` / `createEmptyTestIds`，自动走 worker 隔离 prisma + 唯一手机号生成）。

```typescript
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { markOssFileUploadedByVerifyDao } from '~~/server/services/files/ossFiles.dao'
import { OssFileStatus } from '#shared/types/file'
import { getTestPrisma } from './test-db-helper'
import {
    createTestUser,
    createTestOssFile,
    cleanupTestData,
    createEmptyTestIds,
} from './test-db-helper'

describe('markOssFileUploadedByVerifyDao', () => {
    const testIds = createEmptyTestIds()
    let userId: number

    beforeAll(async () => {
        const user = await createTestUser()
        userId = user.id
        testIds.userIds.push(user.id)
    })

    afterEach(async () => {
        // 每个 test 创建的 ossFile 单独清掉，避免同 worker DB 内污染
        if (testIds.ossFileIds.length) {
            await getTestPrisma().ossFiles.deleteMany({
                where: { id: { in: testIds.ossFileIds } },
            })
            testIds.ossFileIds = []
        }
    })

    afterAll(async () => {
        await cleanupTestData(testIds)
    })

    async function makeRow(status: number, deletedAt: Date | null = null) {
        const file = await createTestOssFile(userId, { status })
        testIds.ossFileIds.push(file.id)
        if (deletedAt) {
            await getTestPrisma().ossFiles.update({
                where: { id: file.id },
                data: { deletedAt },
            })
        }
        return file
    }

    it('PENDING 时改成 UPLOADED 且 count=1', async () => {
        const row = await makeRow(OssFileStatus.PENDING)
        const count = await markOssFileUploadedByVerifyDao(row.id)
        expect(count).toBe(1)
        const fresh = await getTestPrisma().ossFiles.findUnique({ where: { id: row.id } })
        expect(fresh!.status).toBe(OssFileStatus.UPLOADED)
    })

    it('已 UPLOADED 不改 且 count=0', async () => {
        const row = await makeRow(OssFileStatus.UPLOADED)
        const count = await markOssFileUploadedByVerifyDao(row.id)
        expect(count).toBe(0)
    })

    it('FAILED 不改 且 count=0', async () => {
        const row = await makeRow(OssFileStatus.FAILED)
        const count = await markOssFileUploadedByVerifyDao(row.id)
        expect(count).toBe(0)
    })

    it('deletedAt 非 null 不改 且 count=0', async () => {
        const row = await makeRow(OssFileStatus.PENDING, new Date())
        const count = await markOssFileUploadedByVerifyDao(row.id)
        expect(count).toBe(0)
    })

    it('并发两次：只有一次 count=1', async () => {
        const row = await makeRow(OssFileStatus.PENDING)
        const [a, b] = await Promise.all([
            markOssFileUploadedByVerifyDao(row.id),
            markOssFileUploadedByVerifyDao(row.id),
        ])
        expect(a + b).toBe(1)
    })
})
```

- [ ] **Step 2: 跑测试确认 fail**

Run: `npx vitest run tests/server/files/ossFiles.dao.unit.test.ts -t markOssFileUploadedByVerifyDao --reporter=verbose`

Expected: import 失败 / 函数未定义

- [ ] **Step 3: 在 `server/services/files/ossFiles.dao.ts` 末尾追加 DAO 函数**

```typescript
/**
 * 仅在 status=PENDING 时把记录标记为 UPLOADED（条件更新，原子幂等）
 *
 * 用于回调失败兜底场景：head OSS 命中后由本函数收敛 status；
 * 调用方根据返回的 count 区分"我改的（count=1）" / "已被回调或别人改过（count=0）"。
 *
 * @returns 实际改动行数
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

> 注：文件顶部如果还没 import 这些会用到的，确认一下：`OssFileStatus` 来自 `#shared/types/file`、`prisma` 来自 `~~/server/utils/db`、`logger` 在白名单自动可用（不需要 import）。

- [ ] **Step 4: 跑测试确认 pass**

Run: `npx vitest run tests/server/files/ossFiles.dao.unit.test.ts -t markOssFileUploadedByVerifyDao --reporter=verbose`

Expected: 5/5 passed

- [ ] **Step 5: commit**

```bash
git add server/services/files/ossFiles.dao.ts tests/server/files/ossFiles.dao.unit.test.ts
git commit -m "feat(storage): 新增 markOssFileUploadedByVerifyDao 原子条件更新"
```

---

## Task 7: `verifyAndFixOssFileService`（含测试）

**Files:**
- Create: `server/services/files/ossFileVerify.service.ts`
- Test: `tests/server/files/ossFileVerify.service.test.ts`

- [ ] **Step 1: 写失败测试 `tests/server/files/ossFileVerify.service.test.ts`**

按 `.claude/rules/testing.md` 终极规则"涉及数据库操作必须真实执行"，DAO / prisma 全部走真实 worker 隔离 DB；只有 adapter（OSS 网络层）必须 mock。

```typescript
/**
 * verifyAndFixOssFileService 集成测试
 *
 * - 真实 worker 隔离 DB（getTestPrisma）；createTestUser/createTestOssFile fixture
 * - 仅 mock storage adapter（OSS 网络层）
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from 'vitest'
import { OssFileStatus } from '#shared/types/file'

// 唯一 mock：getStorageAdapterService 返回带可控 head 的伪 adapter
const { adapterHeadMock } = vi.hoisted(() => ({ adapterHeadMock: vi.fn() }))
vi.mock('~~/server/services/storage/storage.service', () => ({
    getStorageAdapterService: vi.fn(async () => ({ head: adapterHeadMock })),
}))

import { verifyAndFixOssFileService } from '~~/server/services/files/ossFileVerify.service'
import { getTestPrisma } from '../files/test-db-helper'
import {
    createTestUser,
    createTestOssFile,
    cleanupTestData,
    createEmptyTestIds,
} from '../files/test-db-helper'

describe('verifyAndFixOssFileService', () => {
    const testIds = createEmptyTestIds()
    let userId: number

    beforeAll(async () => {
        const user = await createTestUser()
        userId = user.id
        testIds.userIds.push(user.id)
    })

    beforeEach(() => {
        adapterHeadMock.mockReset()
    })

    afterEach(async () => {
        if (testIds.ossFileIds.length) {
            await getTestPrisma().ossFiles.deleteMany({
                where: { id: { in: testIds.ossFileIds } },
            })
            testIds.ossFileIds = []
        }
    })

    afterAll(async () => {
        await cleanupTestData(testIds)
    })

    async function makeFile(status: number, opts?: { filePath?: string | null }) {
        const file = await createTestOssFile(userId, {
            status,
            filePath: opts?.filePath === null ? undefined : (opts?.filePath ?? `u/${Date.now()}_${Math.random()}.pdf`),
        })
        // filePath=null 场景必须直接 update（createTestOssFile 默认会塞个值）
        if (opts?.filePath === null) {
            await getTestPrisma().ossFiles.update({
                where: { id: file.id },
                data: { filePath: null },
            })
        }
        testIds.ossFileIds.push(file.id)
        return file
    }

    it('file 不存在 → invalid', async () => {
        const r = await verifyAndFixOssFileService(99999999, userId)
        expect(r).toEqual({ ok: false, reason: 'invalid' })
    })

    it('userId 不匹配 → forbidden', async () => {
        const file = await makeFile(OssFileStatus.PENDING)
        const otherUser = await createTestUser()
        testIds.userIds.push(otherUser.id)
        const r = await verifyAndFixOssFileService(file.id, otherUser.id)
        expect(r).toEqual({ ok: false, reason: 'forbidden' })
    })

    it('已 UPLOADED → ok 直接返回（不调 head）', async () => {
        const file = await makeFile(OssFileStatus.UPLOADED)
        const r = await verifyAndFixOssFileService(file.id, userId)
        expect(r).toEqual({ ok: true, status: 'uploaded' })
        expect(adapterHeadMock).not.toHaveBeenCalled()
    })

    it('已 FAILED → already_failed', async () => {
        const file = await makeFile(OssFileStatus.FAILED)
        const r = await verifyAndFixOssFileService(file.id, userId)
        expect(r).toEqual({ ok: false, reason: 'already_failed' })
    })

    it('PENDING + filePath 缺失 → invalid', async () => {
        const file = await makeFile(OssFileStatus.PENDING, { filePath: null })
        const r = await verifyAndFixOssFileService(file.id, userId)
        expect(r).toEqual({ ok: false, reason: 'invalid' })
    })

    it('PENDING + head=null → not_found，DB 不动', async () => {
        const file = await makeFile(OssFileStatus.PENDING)
        adapterHeadMock.mockResolvedValueOnce(null)
        const r = await verifyAndFixOssFileService(file.id, userId)
        expect(r).toEqual({ ok: false, reason: 'not_found' })
        const fresh = await getTestPrisma().ossFiles.findUnique({ where: { id: file.id } })
        expect(fresh!.status).toBe(OssFileStatus.PENDING)
    })

    it('PENDING + head 命中 → DB 改为 UPLOADED', async () => {
        const file = await makeFile(OssFileStatus.PENDING)
        adapterHeadMock.mockResolvedValueOnce({
            size: 1, etag: 'x', contentType: 'application/pdf', lastModified: new Date(),
        })
        const r = await verifyAndFixOssFileService(file.id, userId)
        expect(r).toEqual({ ok: true, status: 'uploaded' })
        const fresh = await getTestPrisma().ossFiles.findUnique({ where: { id: file.id } })
        expect(fresh!.status).toBe(OssFileStatus.UPLOADED)
    })

    it('并发两次：最终 status=UPLOADED 且最少一次返回 ok', async () => {
        const file = await makeFile(OssFileStatus.PENDING)
        adapterHeadMock.mockResolvedValue({
            size: 1, etag: 'x', contentType: 'pdf', lastModified: new Date(),
        })
        const [a, b] = await Promise.all([
            verifyAndFixOssFileService(file.id, userId),
            verifyAndFixOssFileService(file.id, userId),
        ])
        expect([a, b].some((r) => r.ok)).toBe(true)
        const fresh = await getTestPrisma().ossFiles.findUnique({ where: { id: file.id } })
        expect(fresh!.status).toBe(OssFileStatus.UPLOADED)
    })

    it('PENDING + head 抛错 → 服务向上抛', async () => {
        const file = await makeFile(OssFileStatus.PENDING)
        adapterHeadMock.mockRejectedValueOnce(new Error('OSS 5xx'))
        await expect(verifyAndFixOssFileService(file.id, userId)).rejects.toThrow('OSS 5xx')
    })
})
```

- [ ] **Step 2: 跑测试确认 fail**

Run: `npx vitest run tests/server/files/ossFileVerify.service.test.ts --reporter=verbose`

Expected: 全部失败，函数未定义

- [ ] **Step 3: 实现 `server/services/files/ossFileVerify.service.ts`**

```typescript
/**
 * 校验并修复 OSS 文件状态（前端兜底链路服务层）
 *
 * 当回调失败导致 ossFiles.status 停在 PENDING 时，由本服务通过 head OSS
 * 直接核对实际状态并修复。详见 docs/superpowers/specs/2026-05-08-oss-callback-fallback-design.md
 */
import { OssFileStatus } from '#shared/types/file'
import { createLogger } from '#shared/utils/logger'
import { StorageProviderType } from '~~/server/lib/storage/types'
import { getStorageAdapterService } from '~~/server/services/storage/storage.service'
import { prisma } from '~~/server/utils/db'
import {
    findOssFileByIdDao,
    markOssFileUploadedByVerifyDao,
} from './ossFiles.dao'

const log = createLogger('ossFileVerify')

export type VerifyOssFileResult =
    | { ok: true; status: 'uploaded' }
    | { ok: false; reason: 'forbidden' | 'not_found' | 'already_failed' | 'invalid' }

/**
 * 校验并修复单条 OSS 文件状态
 * - 已 UPLOADED → ok
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
    const file = await findOssFileByIdDao(fileId)

    if (!file) return { ok: false, reason: 'invalid' }
    if (file.userId !== userId) return { ok: false, reason: 'forbidden' }

    if (file.status === OssFileStatus.UPLOADED) {
        return { ok: true, status: 'uploaded' }
    }
    if (file.status === OssFileStatus.FAILED) {
        return { ok: false, reason: 'already_failed' }
    }

    if (!file.filePath) {
        log.error('PENDING 文件缺少 filePath，无法兜底', { fileId })
        return { ok: false, reason: 'invalid' }
    }

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
        // 并发：被回调或其他兜底先改了；fresh-read 判断
        const fresh = await prisma.ossFiles.findFirst({
            where: { id: fileId },
            select: { status: true },
        })
        if (fresh && fresh.status === OssFileStatus.UPLOADED) {
            return { ok: true, status: 'uploaded' }
        }
        return { ok: false, reason: 'invalid' }
    }
    return { ok: true, status: 'uploaded' }
}
```

- [ ] **Step 4: 跑测试确认 pass**

Run: `npx vitest run tests/server/files/ossFileVerify.service.test.ts --reporter=verbose`

Expected: 9/9 passed

- [ ] **Step 5: commit**

```bash
git add server/services/files/ossFileVerify.service.ts tests/server/files/ossFileVerify.service.test.ts
git commit -m "feat(storage): 新增 verifyAndFixOssFileService 兜底校验服务"
```

---

## Task 8: `POST /api/v1/storage/confirm-upload` handler（含集成测试）

**Files:**
- Create: `server/api/v1/storage/confirm-upload/.post.ts`
- Test: `tests/server/storage/storage.handlers.test.ts`（追加）

- [ ] **Step 1: 在 `tests/server/storage/storage.handlers.test.ts` 中追加（不新建文件）**

文件已在第 5-6 行 `import './_helpers/handler-test'` + `import { makeEvent, expectSuccess, expectError } from '../_helpers/handler-test'`，第 8-27 行已有一组 `vi.mock(...)`，第 33-65 行批量动态 import handler。**复用全部现成模板**，只做三处增量：

**1）在顶部 vi.mock 列表（第 25-27 行 `userBenefit.service` mock 之后）追加**：

```typescript
vi.mock('~~/server/services/files/ossFileVerify.service', () => ({
    verifyAndFixOssFileService: vi.fn(),
}))
```

**2）在文件中段 import / `vi.mocked(...)` 块（约第 42-55 行）追加**：

```typescript
import { verifyAndFixOssFileService } from '~~/server/services/files/ossFileVerify.service'
const mVerify = vi.mocked(verifyAndFixOssFileService)
```

**3）在 handler 动态 import 列表（约第 57-65 行 `presignedConfigHandler` 之后）追加**：

```typescript
const { default: confirmUploadHandler } = await import('../../../server/api/v1/storage/confirm-upload/.post')
```

**4）在文件末尾追加 describe 块**：

```typescript
describe('POST /api/v1/storage/confirm-upload', () => {
    beforeEach(() => vi.clearAllMocks())

    it('未登录 → 401', async () => {
        const res: any = await confirmUploadHandler(makeEvent({ body: { fileId: 1 } }) as any)
        expectError(res, 401, '请先登录')
    })

    it('参数错误（缺 fileId）→ 400', async () => {
        const res: any = await confirmUploadHandler(makeEvent({ userId: 100, body: {} }) as any)
        expectError(res, 400)
    })

    it('verify 返回 ok=true → 200 + status=uploaded', async () => {
        mVerify.mockResolvedValueOnce({ ok: true, status: 'uploaded' })
        const res: any = await confirmUploadHandler(makeEvent({ userId: 100, body: { fileId: 1 } }) as any)
        const data = expectSuccess(res)
        expect(data).toEqual({ status: 'uploaded' })
        expect(mVerify).toHaveBeenCalledWith(1, 100)
    })

    it('verify forbidden → 403', async () => {
        mVerify.mockResolvedValueOnce({ ok: false, reason: 'forbidden' })
        const res: any = await confirmUploadHandler(makeEvent({ userId: 100, body: { fileId: 1 } }) as any)
        expectError(res, 403)
    })

    it('verify not_found → 404', async () => {
        mVerify.mockResolvedValueOnce({ ok: false, reason: 'not_found' })
        const res: any = await confirmUploadHandler(makeEvent({ userId: 100, body: { fileId: 1 } }) as any)
        expectError(res, 404)
    })

    it('verify already_failed → 409', async () => {
        mVerify.mockResolvedValueOnce({ ok: false, reason: 'already_failed' })
        const res: any = await confirmUploadHandler(makeEvent({ userId: 100, body: { fileId: 1 } }) as any)
        expectError(res, 409)
    })

    it('verify invalid → 400', async () => {
        mVerify.mockResolvedValueOnce({ ok: false, reason: 'invalid' })
        const res: any = await confirmUploadHandler(makeEvent({ userId: 100, body: { fileId: 1 } }) as any)
        expectError(res, 400)
    })

    it('verify 抛错 → 503', async () => {
        mVerify.mockRejectedValueOnce(new Error('OSS dead'))
        const res: any = await confirmUploadHandler(makeEvent({ userId: 100, body: { fileId: 1 } }) as any)
        expectError(res, 503)
    })
})
```

> 关键：**不要**重复 `vi.mock('h3', ...)` 或自造 makeEvent —— `_helpers/handler-test.ts` 已通过 `globalThis` 注入了 `readBody` / `defineEventHandler` / `resSuccess` / `resError` 等所有自动导入函数（参见 `_helpers/handler-test.ts:46-85`），与 Nitro 真实行为一致。makeEvent 真实签名是 `makeEvent({ userId?, body?, query?, params?, headers? })`。

- [ ] **Step 2: 跑测试确认 fail**

Run: `npx vitest run tests/server/storage/storage.handlers.test.ts -t "confirm-upload" --reporter=verbose`

Expected: handler 文件不存在

- [ ] **Step 3: 实现 `server/api/v1/storage/confirm-upload/.post.ts`**

```typescript
/**
 * 用户端：OSS 上传后兜底校验接口
 *
 * 当 OSS 直传成功但 LexSeek callback 处理失败时，前端调用本接口由后端 head OSS
 * 直接核对实际状态。详见 docs/superpowers/specs/2026-05-08-oss-callback-fallback-design.md
 */
import { z } from 'zod'
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
            case 'forbidden':
                return resError(event, 403, '无权操作此文件')
            case 'not_found':
                return resError(event, 404, '文件未在存储上找到，请重新上传')
            case 'already_failed':
                return resError(event, 409, '文件已被标记为失败')
            case 'invalid':
                return resError(event, 400, '文件记录不存在或异常')
        }
    } catch (error) {
        log.error({ fileId, err: error }, '兜底校验异常')
        return resError(event, 503, 'OSS 服务暂时不可达，请稍后重试')
    }
})
```

- [ ] **Step 4: 跑测试确认 pass**

Run: `npx vitest run tests/server/storage/storage.handlers.test.ts -t "confirm-upload" --reporter=verbose`

Expected: 8/8 passed

- [ ] **Step 5: commit**

```bash
git add server/api/v1/storage/confirm-upload/.post.ts tests/server/storage/storage.handlers.test.ts
git commit -m "feat(storage): 新增用户端 POST /storage/confirm-upload 兜底接口"
```

---

## Task 9: `presigned-url` handler 透出 `ossFileId`

**Files:**
- Modify: `server/api/v1/storage/presigned-url/.post.ts`

> 已有的 `tests/server/storage/storage.handlers.test.ts` 里有 presigned-url 用例（如有），追加一条断言新字段；如无对应用例则跳过测试新增。

- [ ] **Step 1: 在 `server/api/v1/storage/presigned-url/.post.ts` 第 142-203 行的事务里改 `results.push`**

定位到（约第 165-200 行内）：

```typescript
const signature = await generatePostSignatureService({
    // ...现有参数...
})

results.push(signature as PostSignatureResult)
```

改为：

```typescript
const signature = await generatePostSignatureService({
    // ...现有参数...
})

results.push({
    ...(signature as PostSignatureResult),
    ossFileId: ossFile.id,
} as PostSignatureResult)
```

> 注：`PostSignatureResult` 的两个定义（前端 `shared/types/oss.ts` 和后端 `server/lib/storage/types.ts`）都在 Task 4 / Task 2 里加了可选 `ossFileId`，所以这里的 cast 不会破坏类型。

- [ ] **Step 2: 在 `tests/server/storage/storage.handlers.test.ts` 的 presignedPostHandler 用例里追加断言（必须执行）**

现有文件已经有 `presignedPostHandler` 的成功用例（**第 311 行** `describe('POST /api/v1/storage/presigned-url', () => { ... })`），找到一条"成功创建签名"的成功断言后追加：

```typescript
expect((res as any).data?.[0]?.ossFileId).toBeTypeOf('number')
expect((res as any).data?.[0]?.ossFileId).toBeGreaterThan(0)
```

> 这一步不是"如有则加" — 现有文件确实有 presigned-url POST 测试覆盖（已确认），必须落地 ossFileId 断言，避免回归。

- [ ] **Step 3: 类型检查 + 现有相关测试确认无回归**

Run: `bun run typecheck`
Run: `npx vitest run tests/server/storage/storage.handlers.test.ts --reporter=verbose`

Expected: 类型通过；现有用例全部仍 pass

- [ ] **Step 4: commit**

```bash
git add server/api/v1/storage/presigned-url/.post.ts tests/server/storage/storage.handlers.test.ts
git commit -m "feat(storage): presigned-url 返回值带 ossFileId 用于前端兜底"
```

---

## Task 10: `useFileUploadWorker` 兜底分支（含测试追加）

**Files:**
- Modify: `app/composables/useFileUploadWorker.ts`
- Test: `tests/client/composables/useFileUploadWorker.test.ts`（追加）

- [ ] **Step 1: 在 `tests/client/composables/useFileUploadWorker.test.ts` 末尾追加测试**

文件顶部已存在：`MockWorker` class（第 17-48 行）+ `vi.stubGlobal('onUnmounted')` / `URL` / `Blob` / 全局 stub（第 14、52-63 行）+ 既有 `describe` 用 `vi.stubGlobal('Worker', vi.fn(() => mockWorker))`（第 71 行）。**全部复用，不重定义**。

需要新增的只有：`useApiFetch` mock + 新 describe 块。在文件末尾追加：

```typescript
// 新增 mock：useApiFetch 用于兜底接口调用
// 用 vi.hoisted 避免 vi.mock 工厂执行时 const 还在 TDZ
const { useApiFetchMock } = vi.hoisted(() => ({ useApiFetchMock: vi.fn() }))
vi.mock('~/composables/useApiFetch', () => ({
    useApiFetch: useApiFetchMock,
}))

import { useFileUploadWorker } from '~/composables/useFileUploadWorker'

describe('useFileUploadWorker — callback 失败兜底', () => {
    let mockWorker: MockWorker

    beforeEach(() => {
        vi.clearAllMocks()
        mockWorker = new MockWorker()
        vi.stubGlobal('Worker', vi.fn(() => mockWorker))
        useApiFetchMock.mockReset()
    })

    function makeSig(ossFileId?: number): PostSignatureResult {
        return {
            host: 'https://b.oss-cn-hangzhou.aliyuncs.com',
            policy: 'p',
            signatureVersion: 'v',
            credential: 'c',
            date: 'd',
            signature: 's',
            key: 'u/x.pdf',
            dir: 'u/',
            ossFileId,
        } as any
    }

    it('callback 成功 → 走正常 onSuccess（不调兜底）', async () => {
        const { upload } = useFileUploadWorker()
        const onSuccess = vi.fn()
        const id = upload(new File(['x'], 'x.pdf'), makeSig(123), { onSuccess })
        mockWorker.simulateResponse({ type: 'success', id, data: { fileId: 123, filename: 'x.pdf', success: true } })
        await new Promise((r) => setTimeout(r, 0))
        expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ fileId: 123 }))
        expect(useApiFetchMock).not.toHaveBeenCalled()
    })

    it('callback 失败 + ossFileId 缺失 → onError，不调兜底', async () => {
        const { upload } = useFileUploadWorker()
        const onError = vi.fn()
        const id = upload(new File(['x'], 'x.pdf'), makeSig(undefined), { onError })
        mockWorker.simulateResponse({ type: 'success', id, data: { success: false, error: 'callback processing failed' } })
        await new Promise((r) => setTimeout(r, 0))
        expect(onError).toHaveBeenCalled()
        expect(useApiFetchMock).not.toHaveBeenCalled()
    })

    it('callback 失败 + 兜底接口返 status=uploaded → onSuccess({recovered, fileId})', async () => {
        useApiFetchMock.mockResolvedValueOnce({ status: 'uploaded' })
        const { upload } = useFileUploadWorker()
        const onSuccess = vi.fn()
        const id = upload(new File(['x'], 'x.pdf'), makeSig(123), { onSuccess })
        mockWorker.simulateResponse({ type: 'success', id, data: { success: false } })
        await new Promise((r) => setTimeout(r, 0))
        expect(useApiFetchMock).toHaveBeenCalledWith(
            '/api/v1/storage/confirm-upload',
            expect.objectContaining({ method: 'POST', body: { fileId: 123 } })
        )
        expect(onSuccess).toHaveBeenCalledWith({ recovered: true, fileId: 123 })
    })

    it('callback 失败 + 兜底接口返 null（业务失败）→ onError', async () => {
        useApiFetchMock.mockResolvedValueOnce(null)
        const { upload } = useFileUploadWorker()
        const onError = vi.fn()
        const id = upload(new File(['x'], 'x.pdf'), makeSig(123), { onError })
        mockWorker.simulateResponse({ type: 'success', id, data: { success: false } })
        await new Promise((r) => setTimeout(r, 0))
        expect(onError).toHaveBeenCalled()
    })

    it('callback 失败 + 兜底接口抛网络错误 → onError 携带原异常', async () => {
        useApiFetchMock.mockRejectedValueOnce(new Error('网络错误'))
        const { upload } = useFileUploadWorker()
        const onError = vi.fn()
        const id = upload(new File(['x'], 'x.pdf'), makeSig(123), { onError })
        mockWorker.simulateResponse({ type: 'success', id, data: { success: false } })
        await new Promise((r) => setTimeout(r, 0))
        expect(onError).toHaveBeenCalledWith(expect.any(Error))
        const err = onError.mock.calls[0][0] as Error
        expect(err.message).toContain('网络错误')
    })
})
```

> 关键：用 `vi.stubGlobal('Worker', vi.fn(() => mockWorker))`（与文件第 71 行既有风格一致），**不要**直接 `(globalThis as any).Worker = ...`；MockWorker class 复用文件顶部第 17-48 行的现成定义，**不要**重新声明。

- [ ] **Step 2: 跑测试确认 fail**

Run: `npx vitest run tests/client/composables/useFileUploadWorker.test.ts -t "callback 失败兜底" --reporter=verbose`

Expected: 失败（composable 还没实现兜底分支）

- [ ] **Step 3: 修改 `app/composables/useFileUploadWorker.ts`**

文件顶部 import 区追加：

```typescript
import { useApiFetch } from '~/composables/useApiFetch'
```

修改 `UploadTask` 接口（在第 28-32 行附近）：

```typescript
interface UploadTask {
    id: string
    callbacks: UploadCallbacks
    ossFileId?: number   // 新增：用于兜底校验
}
```

修改 `upload` 方法（在第 114-152 行附近的 `tasks.set(id, ...)` 调用）：

```typescript
const upload = (
    file: File,
    signature: PostSignatureResult,
    callbacks: UploadCallbacks
): string => {
    const w = initWorker()
    const id = `upload_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`

    // 把 ossFileId 一并存入 task，兜底分支会用
    tasks.set(id, { id, callbacks, ossFileId: signature.ossFileId })

    // ...其他既有逻辑保持不变...
}
```

修改 success 消息分发（在第 87-105 行的 `addEventListener('message', ...)` 内 switch 块）：

```typescript
currentInstance.worker.addEventListener('message', async (event: MessageEvent<WorkerResponse>) => {
    const response = event.data
    const task = tasks.get(response.id)
    if (!task) return

    switch (response.type) {
        case 'progress':
            task.callbacks.onProgress?.(response.progress || 0)
            break

        case 'success': {
            const data = response.data || {}
            const callbackOk = (data as any)?.success !== false

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
                    task.callbacks.onSuccess?.({ recovered: true, fileId: task.ossFileId })
                } else {
                    task.callbacks.onError?.(new Error('上传校验失败，请重新上传'))
                }
            } catch (err) {
                task.callbacks.onError?.(err instanceof Error ? err : new Error('上传校验异常'))
            } finally {
                tasks.delete(response.id)
            }
            break
        }

        case 'error':
            task.callbacks.onError?.(new Error(response.error || '未知错误'))
            tasks.delete(response.id)
            break
    }
})
```

- [ ] **Step 4: 跑测试确认 pass**

Run: `npx vitest run tests/client/composables/useFileUploadWorker.test.ts --reporter=verbose`

Expected: 现有 + 新增用例全部 pass

- [ ] **Step 5: commit**

```bash
git add app/composables/useFileUploadWorker.ts tests/client/composables/useFileUploadWorker.test.ts
git commit -m "feat(storage): useFileUploadWorker 收到 callback 失败时调兜底接口"
```

---

## Task 11: 调用方核对 + typecheck + 全量测试 + 收尾

**Files:** 视调研结果决定

- [ ] **Step 1: grep 所有使用 `useFileUploadWorker` 上传的调用点**

```bash
grep -rln "useFileUploadWorker" /Users/daixin/work/dev/LexSeek/LexSeek/app
```

预期命中：`MaterialUploader.vue` / `caseCreation/MaterialUploader.vue` / `useBatchUpload.ts` 等。**预估范围 3-8 个文件**，每个改动通常 < 10 行。如果命中超过 12 个文件，停下来跟 team-lead 同步，可能需要拆分。

- [ ] **Step 2: 对每个调用点核对 onSuccess 处理**

打开每个命中文件，找到 `upload(...)` 调用 + `onSuccess` 回调，检查回调里：
- 如果只用 `data.fileId` 或 `data.recovered` → ✅ 兼容兜底分支，无需改
- 如果还用 `data.filename` / `data.size` / `data.mimeType` → ⚠️ 需要适配

适配方案（每个有强依赖的调用点）：
1. 如果调用点只是用这些字段做 toast/UI 显示，直接显示文件原始信息（File 对象自带 `file.name` / `file.size` / `file.type`）即可
2. 如果是入库的关键路径，按 `data.fileId` 调 `GET /api/v1/files/oss/:id` 类已有接口补查

- [ ] **Step 3: 提交调用点适配（如有改动）**

```bash
git add app/components/.../MaterialUploader.vue  # 等等
git commit -m "refactor(storage): 调用方兼容上传兜底返回的精简 data"
```

如无改动，跳过本 step。

- [ ] **Step 4: 类型检查**

Run: `bun run typecheck`

Expected: 通过

- [ ] **Step 5: 全量测试（确保无回归）**

Run: `bun run test`

Expected: 全部通过；如发现失败先排查是否本次改动引入；不是的话记到 `tests/KNOWN_FAILS.md` 由人工排查（本 plan 不强求修无关失败）。

- [ ] **Step 6: dev 环境手动验证**

启动 dev：

```bash
bun dev
```

模拟 callback 失败：临时改 `server/api/v1/storage/callback/.post.ts` 在第 49 行的 `updateOssFileDao` 调用前加一句：

```typescript
throw new Error('SIMULATED_CALLBACK_FAILURE')   // 测试用，验证完删除
```

操作：
1. 在 dashboard 上传一个文件
2. 观察前端是否短暂出现"校验中"或类似行为后展示上传成功
3. 检查 DB：`ossFiles` 对应行的 `status` 应该是 1（UPLOADED）
4. 检查 logger 输出应有：`[ossFiles] PENDING → UPLOADED via head verification`
5. 验证后**回退**临时改动（删除 throw 那行），不要把它进 commit

- [ ] **Step 7: 收尾 commit（如本步有任何小修）**

如果 Step 1-6 中发现还有遗漏的小修补，统一在这步打成一个 commit：

```bash
git add <files>
git commit -m "chore(storage): 兜底链路收尾修整"
```

如果什么都不缺，跳过。

---

## Self-Review

### 1. Spec coverage

| Spec 章节 | 对应 Task |
|----------|----------|
| §1 oss/headFile.ts | Task 1 |
| §2 storage/types.ts + base.ts | Task 2 |
| §3 BaseStorageAdapter.head | Task 2 |
| §4 AliyunOssAdapter.head | Task 3 |
| §5 ossFiles DAO | Task 6 |
| §6 ossFileVerify service | Task 7 |
| §7 confirm-upload handler | Task 8 |
| §8 presigned-url 透出 ossFileId | Task 9 |
| §8.1 storage.service 导出 | Task 5 |
| §10 useFileUploadWorker 改动 | Task 10 |
| §10.4 调用方契约调研 | Task 11 |
| Test §"测试策略" 5 项 | Task 1/3/6/7/8/10 各自携带 |
| 验收标准 | Task 11 Step 4-6 |

✅ Spec 全部章节有对应 Task。

### 2. Placeholder 扫描

- ❌ 无 "TBD" / "TODO" / "implement later"
- ❌ 无 "appropriate error handling" / "handle edge cases"
- ❌ 无 "similar to Task N"（Task 9 提到"如已有 fixture 复用"是真实指令，不是占位）
- ❌ 无未定义类型/方法引用：`HeadObjectResult` Task 1 定义，Task 2/3/7 引用；`getStorageAdapterService` Task 5 改名，Task 7 引用；`markOssFileUploadedByVerifyDao` Task 6 定义，Task 7 引用；`verifyAndFixOssFileService` Task 7 定义，Task 8 引用；签名都对得上

### 3. Type consistency

| 类型/函数 | 定义位置 | 引用位置 |
|----------|---------|---------|
| `HeadObjectResult` | Task 1（oss/headFile.ts）, Task 2（storage/types.ts re-export） | Task 2/3 |
| `headFile` | Task 1 | Task 3 |
| `StorageAdapter.head` | Task 2 | Task 3（实现）, Task 7（调用） |
| `AliyunPostSignatureResult.ossFileId` | Task 2 | Task 9（写入） |
| `PostSignatureResult.ossFileId` (前端) | Task 4 | Task 10（读取） |
| `getStorageAdapterService` | Task 5 | Task 7 |
| `markOssFileUploadedByVerifyDao` | Task 6 | Task 7 |
| `verifyAndFixOssFileService` | Task 7 | Task 8 |
| `VerifyOssFileResult.reason` 4 种枚举值 | Task 7 | Task 8 switch 分支匹配 ✓ |

✅ 全部一致。

### 4. 验收

- TDD 顺序：每个 Task 都是"先测试 → 跑红 → 实现 → 跑绿 → commit" 5 步
- 频繁 commit：每个 Task 一个独立 commit（共 ~10 个 commit），符合"frequent commits"
- DRY：没有写两遍代码，只有 spec 引用提示
- YAGNI：没引入不必要功能；不动 callback handler、不加字段、不做后台轮询

✅ 通过。
