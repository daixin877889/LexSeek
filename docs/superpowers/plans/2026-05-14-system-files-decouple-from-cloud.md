# 系统级文件与用户云盘解耦 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把"管理员上传的全局文书模板"从管理员个人云盘里彻底剥离 — 既不占配额、也不出现在列表里 — 同时建立"系统级文件归属"的通用规则。

**Architecture:** 把 `ossFiles.userId` 从 `NOT NULL` 放宽为 `NULL`，约定 `userId = NULL` 表示"系统所有，不属于任何个人云盘"。决策上移到 API 接口层：管理端接口显式传 `ownerUserId: null`，用户端接口显式传 `ownerUserId: 当前用户 ID`；service / DAO 是无身份感知的通用层，不再用 `isAdmin` 分支判定行为。用户云盘列表与配额查询的 WHERE 条件保持 `userId = me`，全局模板因 `userId = NULL` 天然被排除。

**Tech Stack:** Prisma 7 + PostgreSQL 14 + Nuxt 4（Nitro）+ TypeScript + Vitest

**Spec 参考:** [docs/superpowers/specs/2026-05-13-system-files-decouple-from-cloud-design.md](../specs/2026-05-13-system-files-decouple-from-cloud-design.md)

**关键代码事实（在动手前先读一遍）:**
- 真实 service 实现：`server/agents/document/documentTemplate.service.ts`
- shim 路径：`server/services/assistant/document/documentTemplate.service.ts`（一行 re-export，调用方实际经此路径 import）
- DAO：`server/services/files/ossFiles.dao.ts:15`（`createOssFileDao`）、`:166`（`ossUsageDao`）、`:308`（`findOssFilesByUserIdDao`）
- 管理端 handler：`server/api/v1/admin/document-templates/index.post.ts`（当前传 `isAdmin: true`）
- 用户端 handler：`server/api/v1/assistant/document/templates.post.ts`（当前传 `isAdmin: false`）
- 现有测试：`tests/server/assistant/document/documentTemplate.service.test.ts`
- 现有 createOssFileDao 调用点共 7 处：documentTemplate.service.ts、contractReviewRebuild.service.ts、uploadAndRegisterOssFile.ts、documentExport.service.ts、storage/presigned-url/.get.ts、uploadWorkspaceFile.tool.ts、ossFiles.dao.ts（自身）

---

## File Structure

**创建：**
- `prisma/migrations/<timestamp>_decouple_ossfile_user_to_nullable/migration.sql`（由 `prisma migrate dev` 自动生成，不手写）
- `server/scripts/migrateGlobalTemplateOwnership.ts`（一次性维护脚本）
- `tests/server/scripts/migrateGlobalTemplateOwnership.test.ts`（脚本单测，跑真实库）
- `tests/server/files/ossUsageDao.systemFiles.test.ts`（配额/列表回归测试）

**修改：**
- `prisma/models/file.prisma:6`（`userId` 改 nullable）
- `server/agents/document/documentTemplate.service.ts:31-41,75-88`（参数结构变更、删除 `isAdmin` 分支）
- `server/api/v1/admin/document-templates/index.post.ts:46-56`（调用参数）
- `server/api/v1/assistant/document/templates.post.ts:57-67`（调用参数）
- `tests/server/assistant/document/documentTemplate.service.test.ts`（同步参数变更）
- `.claude/rules/api.md`（末尾追加一条 "系统级文件入口需将 userId 写入 NULL" 备注）

**不修改（编译器会提示是否需要后续 follow-up）：**
- `server/services/files/ossFiles.dao.ts`（DAO 类型自动跟随 Prisma 变化，无需手改签名）
- 其余 6 个 createOssFileDao 调用点（它们传 `number`，新类型 `number | null` 仍接受）

---

## 关键环境假设（在第一行 Task 之前先确认）

| 项 | 当前值 | 影响 |
|---|---|---|
| PostgreSQL 版本 | **17**（`docker/postgres/Dockerfile` 第 1 行 `FROM pgvector/pgvector:pg17`） | 默认 `NULLS DISTINCT`，多条 NULL 行可在 UNIQUE 索引下共存 |
| 复合唯一索引 | `idx_oss_files_user_bucket_path = (userId, bucketName, filePath)` | 当前迁移文件**未**声明 `NULLS NOT DISTINCT` — 已 grep 历史 migrations 核实 |
| Prisma | 7.x | `Int` → `Int?` 自动生成 `ALTER COLUMN ... DROP NOT NULL`，`ossFilesCreateInput.userId` 类型自动放宽为 `number \| null \| undefined`，DAO 签名无需手改 |

> 这三条是本 plan 的隐含前提；如果有人在实施前改动了它们（尤其是给索引加 `NULLS NOT DISTINCT`），Task 5 的第三个测试会立即报错，提醒回滚假设。

---

## Task 1：把 `ossFiles.userId` 改成 nullable

**目的：** 仅一处 schema 变更（Prisma 自动生成 `ALTER COLUMN userId DROP NOT NULL`），为后续业务改造打基础。该操作经查 Prisma 官方文档与项目内先例（`20260507102823_add_node_prompts_logical_columns`）确认零锁表。

**Files:**
- Modify: `prisma/models/file.prisma:6`
- Create: `prisma/migrations/<timestamp>_decouple_ossfile_user_to_nullable/migration.sql`（自动生成）

- [ ] **Step 1: 修改 Prisma schema 中 `ossFiles.userId` 为 nullable**

`prisma/models/file.prisma` 第 6 行原内容：
```prisma
  /// 关联的用户ID，外键关联用户表
  userId           Int       @map("user_id")
```
改为：
```prisma
  /// 文件归属人：NULL = 系统所有（不属于任何个人云盘，如全局文书模板）；非空 = 该用户的私有云盘文件
  userId           Int?      @map("user_id")
```

- [ ] **Step 2: 跑 prisma migrate dev 自动生成迁移**

执行：
```bash
bun run prisma:migrate --name decouple_ossfile_user_to_nullable
```

Expected：
- 在 `prisma/migrations/<timestamp>_decouple_ossfile_user_to_nullable/` 下生成 `migration.sql`
- SQL 内容仅一条：`ALTER TABLE "oss_files" ALTER COLUMN "user_id" DROP NOT NULL;`
- Prisma client 自动重新生成，`ossFiles.userId` 类型变为 `number | null`

- [ ] **Step 3: 验证 schema 变更生效**

执行：
```bash
bun run prisma:generate
npx tsx -e "import { prisma } from '~~/server/utils/db'; (async () => { const f = await prisma.ossFiles.findFirst(); console.log(typeof f?.userId); })()"
```

Expected：脚本可执行，且 TypeScript 编译器在显式断言时把 `f.userId` 视为 `number | null`。

- [ ] **Step 4: 跑全量类型检查**

执行：
```bash
bun run typecheck
```

Expected：可能出现 2-5 个类型错误（典型如 `findOssFilesByUserIdDao` 接收 `number` 但 caller 现在能传 `number | null`、或者其他地方 `ossFile.userId` 用于算术/字符串拼接）。**记录所有错误位置**，留到 Task 2-4 顺序消化；如果错误数量超过 10 处，在此暂停并把清单提交给 reviewer 评估范围。

- [ ] **Step 5: Commit**

```bash
git add prisma/models/file.prisma prisma/migrations/
git commit -m "$(cat <<'EOF'
feat(db): ossFiles.userId 改为 nullable 以表达系统级文件归属

NULL 含义为"文件归属系统、不属于任何个人云盘"，为后续把全局文书模板从管理员私有云盘中剥离做准备。
ALTER COLUMN ... DROP NOT NULL 为即时操作，零锁表。
EOF
)"
```

---

## Task 2：`createDocumentTemplateService` 参数语义化，决策上移

**目的：** 把"判断是不是全局模板"的逻辑从 service 内部移除，由调用方显式传 `scope` + `ownerUserId`。service 只看参数行事，不再感知"管理端/用户端"。

**Files:**
- Modify: `server/agents/document/documentTemplate.service.ts:31-41,75-152`
- Modify: `tests/server/assistant/document/documentTemplate.service.test.ts`

- [ ] **Step 1: 先改测试 — 让现有用例符合新参数形态**

打开 `tests/server/assistant/document/documentTemplate.service.test.ts`，找到第 69-79 行 `BASE_PARAMS`：

```typescript
const BASE_PARAMS = {
    userId: 1,
    isAdmin: false,
    file: makeDocxBuffer(),
    fileName: 'test-template.docx',
    fileSize: 1024 * 100, // 100KB
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    name: '测试模板',
    category: 'litigation' as const,
    description: '用于测试的模板',
}
```

改为（按新签名）：
```typescript
const BASE_PARAMS = {
    scope: 'user' as const,
    ownerUserId: 1,
    file: makeDocxBuffer(),
    fileName: 'test-template.docx',
    fileSize: 1024 * 100, // 100KB
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    name: '测试模板',
    category: 'litigation' as const,
    description: '用于测试的模板',
}
```

然后全文搜索 `userId: BASE_PARAMS.userId` 并替换为 `ownerUserId: BASE_PARAMS.ownerUserId`；搜索 `users/${BASE_PARAMS.userId}/` 改为 `users/${BASE_PARAMS.ownerUserId}/`。

- [ ] **Step 2: 在测试文件里追加一组新的"全局模板"用例**

在 `describe('createDocumentTemplateService', () => {` 内部追加一个新的 describe 块（紧接配额校验那段之后）：

```typescript
describe('全局模板（scope=global）', () => {
    it('scope=global 时调用 createOssFileDao 传 userId=null（系统归属）', async () => {
        await createDocumentTemplateService({
            ...BASE_PARAMS,
            scope: 'global',
            ownerUserId: null,
        })

        expect(mockCreateOssFileDao).toHaveBeenCalledWith(
            expect.objectContaining({ userId: null, source: 'documentTemplate' }),
            expect.anything(),
        )
    })

    it('scope=global 时跳过配额校验', async () => {
        // 即使设置 count = MAX_PRIVATE_TEMPLATES，global 路径也应放行
        mockCountUserTemplatesDAO.mockResolvedValue(MAX_PRIVATE_TEMPLATES)

        const result = await createDocumentTemplateService({
            ...BASE_PARAMS,
            scope: 'global',
            ownerUserId: null,
        })

        expect(result).toHaveProperty('templateId')
        expect(mockCountUserTemplatesDAO).not.toHaveBeenCalled()
    })

    it('scope=global 时 OSS 路径走 global-templates/ 前缀（不带 users/${id}/）', async () => {
        await createDocumentTemplateService({
            ...BASE_PARAMS,
            scope: 'global',
            ownerUserId: null,
        })

        const ossPath = mockUploadFileService.mock.calls[0][0] as string
        expect(ossPath).toMatch(/^global-templates\//)
        expect(ossPath).not.toContain('users/')
    })

    it('scope=global 时写 documentTemplates 表 userId=null、scope="global"', async () => {
        await createDocumentTemplateService({
            ...BASE_PARAMS,
            scope: 'global',
            ownerUserId: null,
        })

        expect(mockCreateDocumentTemplateDAO).toHaveBeenCalledWith(
            expect.objectContaining({ scope: 'global', userId: null }),
            expect.anything(),
        )
    })

    it('scope=user 时调用 createOssFileDao 传 userId=ownerUserId', async () => {
        await createDocumentTemplateService(BASE_PARAMS)

        expect(mockCreateOssFileDao).toHaveBeenCalledWith(
            expect.objectContaining({ userId: BASE_PARAMS.ownerUserId, source: 'documentTemplate' }),
            expect.anything(),
        )
    })
})
```

- [ ] **Step 3: 跑测试，确认期望失败**

执行：
```bash
npx vitest run tests/server/assistant/document/documentTemplate.service.test.ts --reporter=verbose
```

Expected：**多个用例 FAIL**，错误信息形如 `Object literal may only specify known properties, and 'scope' does not exist`（TypeScript 编译错误）或 mock 断言不匹配。这是 TDD 红灯。

- [ ] **Step 4: 修改 service 实现以满足新参数形态**

打开 `server/agents/document/documentTemplate.service.ts`，把第 31-41 行的 `CreateDocumentTemplateParams` 改为：

```typescript
export interface CreateDocumentTemplateParams {
    /** 归属决策：'global' = 系统所有（不占配额、不入云盘）；'user' = 用户私有（占配额、入云盘） */
    scope: 'global' | 'user'
    /** 归属人 ID。scope='global' 时必须为 null；scope='user' 时必须为正整数 */
    ownerUserId: number | null
    file: Buffer
    fileName: string
    fileSize: number
    mimeType: string
    name: string
    category: DocumentCategoryKey
    description?: string
}
```

把第 47-88 行的 `createDocumentTemplateService` 函数体改为：

```typescript
export async function createDocumentTemplateService(
    params: CreateDocumentTemplateParams,
): Promise<ServiceResult> {
    // ---- 内部不变量自卫：scope 与 ownerUserId 来自 handler，理论上一定一致；
    //      若出现矛盾说明是 handler bug（unreachable），抛 Error 让上层 500，不走业务错误码
    if (params.scope === 'global' && params.ownerUserId !== null) {
        throw new Error('[createDocumentTemplateService] invariant: scope=global 时 ownerUserId 必须为 null')
    }
    if (params.scope === 'user' && params.ownerUserId == null) {
        throw new Error('[createDocumentTemplateService] invariant: scope=user 时 ownerUserId 不能为空')
    }

    if (params.fileSize > MAX_FILE_SIZE) {
        return { error: '文件不能超过 20MB', code: 413 }
    }

    if (!params.fileName.endsWith('.docx')) {
        return { error: '仅支持 .docx 格式', code: 400 }
    }

    const placeholders = await scanPlaceholders(params.file)
    if (placeholders.length === 0) {
        return { error: '未扫描到占位符，请检查模板', code: 400 }
    }

    const compileError = tryCompileTemplate(params.file)
    if (compileError) {
        return { error: `模板占位符不合法：${compileError}。请确认所有占位符都使用双花括号 {{name}} 格式。`, code: 400 }
    }

    if (params.scope === 'global') {
        return uploadAndCreate({ params, placeholders })
    }

    // scope='user'：配额校验与写入在事务内串行，防止并发超额
    return prisma.$transaction(async (tx) => {
        const count = await countUserTemplatesDAO(params.ownerUserId!, tx)
        if (count >= MAX_PRIVATE_TEMPLATES) {
            return { error: `私人模板已达上限 ${MAX_PRIVATE_TEMPLATES} 个`, code: 403 }
        }
        return uploadAndCreate({ params, placeholders, tx })
    })
}
```

把第 92-152 行的内部 `uploadAndCreate` 改为：

```typescript
async function uploadAndCreate(opts: {
    params: CreateDocumentTemplateParams
    placeholders: Placeholder[]
    tx?: Prisma.TransactionClient
}): Promise<ServiceResult> {
    const { params, placeholders, tx } = opts

    const timestamp = Date.now()
    const ossPath =
        params.scope === 'user'
            ? `users/${params.ownerUserId}/templates/${timestamp}_${params.fileName}`
            : `global-templates/${timestamp}_${params.fileName}`

    // global 上传时 userId=null，走系统默认存储配置
    const userIdForStorage = params.ownerUserId ?? undefined

    const [uploadResult, storageConfig] = await Promise.all([
        uploadFileService(ossPath, params.file, {
            contentType: params.mimeType,
            userId: userIdForStorage,
        }),
        getDefaultStorageConfigDao(StorageProviderType.ALIYUN_OSS, userIdForStorage),
    ])

    const bucketName = storageConfig?.bucket ?? ''

    const ossFile = await createOssFileDao(
        {
            userId: params.ownerUserId,  // null = 系统所有；number = 用户私有
            bucketName,
            fileName: params.fileName,
            filePath: uploadResult.name,
            fileSize: params.fileSize,
            fileType: params.mimeType,
            source: FileSource.DOCUMENT_TEMPLATE,
            status: OssFileStatus.UPLOADED,
            encrypted: false,
        },
        tx,
    )

    const template = await createDocumentTemplateDAO(
        {
            name: params.name,
            category: params.category,
            scope: params.scope,
            userId: params.ownerUserId,
            ossFileId: ossFile.id,
            placeholders,
            description: params.description,
            priority: 100,
        },
        tx,
    )

    return { templateId: template.id }
}
```

> 注意：Prisma `ossFilesCreateInput` 在 Task 1 schema 改 nullable 后，`userId` 字段类型自动变为 `number | null | undefined`，**不需要改 DAO 签名**。

- [ ] **Step 5: 跑测试，确认全部通过**

执行：
```bash
npx vitest run tests/server/assistant/document/documentTemplate.service.test.ts --reporter=verbose
```

Expected：**所有用例 PASS**（包括 Step 2 新增的 global scope 用例）。

- [ ] **Step 6: 跑类型检查（service 文件层面）**

执行：
```bash
bun run typecheck
```

Expected：service 文件无报错；handler 文件（`admin/document-templates/index.post.ts`、`assistant/document/templates.post.ts`）会报错——它们还在传 `userId/isAdmin` 旧字段。这正是 Task 3/4 要消化的。

- [ ] **Step 7: Commit（注意：handler 还没改，类型检查未全过，**不**push）**

```bash
git add server/agents/document/documentTemplate.service.ts tests/server/assistant/document/documentTemplate.service.test.ts
git commit -m "$(cat <<'EOF'
refactor(document): documentTemplate.service 参数语义化

把"是否系统归属"的决策从 service 内部上移到调用方：service 接收 scope + ownerUserId，
不再用 isAdmin 分支判定行为；scope='global' 直接放行配额，scope='user' 进入配额校验事务。
EOF
)"
```

---

## Task 3：管理端 handler 显式传 `scope: 'global'` + `ownerUserId: null`

**Files:**
- Modify: `server/api/v1/admin/document-templates/index.post.ts:46-56`

- [ ] **Step 1: 改 handler 调用 service 的参数**

`server/api/v1/admin/document-templates/index.post.ts` 第 46-56 行原内容：

```typescript
    const result = await createDocumentTemplateService({
        userId: user.id,
        isAdmin: true, // 管理端：创建全局模板
        file: fileItem.data,
        fileName,
        fileSize,
        mimeType,
        name,
        category: category as DocumentCategoryKey,
        description,
    })
```

改为：

```typescript
    const result = await createDocumentTemplateService({
        scope: 'global',
        ownerUserId: null, // 全局模板归属系统，不入任何用户云盘
        file: fileItem.data,
        fileName,
        fileSize,
        mimeType,
        name,
        category: category as DocumentCategoryKey,
        description,
    })
```

> 注意：handler 顶部的 `const user = event.context.auth?.user; if (!user) return resError(event, 401, '请先登录')` **保留**——用于 401 鉴权检查，但 `user.id` 不再传给 service（全局模板不归属任何人）。

- [ ] **Step 2: 跑类型检查确认该文件无报错**

```bash
bun run typecheck 2>&1 | grep -A2 "admin/document-templates"
```

Expected：无 admin/document-templates 相关输出（即该 handler 类型正确）。

- [ ] **Step 3: Commit**

```bash
git add server/api/v1/admin/document-templates/index.post.ts
git commit -m "$(cat <<'EOF'
refactor(api): 管理端文书模板接口显式传 ownerUserId=null

决策由 handler 显式表态，service 不再感知"管理端 / 用户端"。
EOF
)"
```

---

## Task 4：用户端 handler 显式传 `scope: 'user'` + `ownerUserId: user.id`

**Files:**
- Modify: `server/api/v1/assistant/document/templates.post.ts:57-67`

- [ ] **Step 1: 改 handler 调用 service 的参数**

`server/api/v1/assistant/document/templates.post.ts` 第 57-67 行原内容：

```typescript
    const result = await createDocumentTemplateService({
        userId: user.id,
        isAdmin: false, // 用户端接口：一律按 user scope 处理
        file: fileItem.data,
        fileName,
        fileSize,
        mimeType,
        name,
        category: category as DocumentCategoryKey,
        description,
    })
```

改为：

```typescript
    const result = await createDocumentTemplateService({
        scope: 'user',
        ownerUserId: user.id, // 用户端：模板归属当前用户，受配额限制
        file: fileItem.data,
        fileName,
        fileSize,
        mimeType,
        name,
        category: category as DocumentCategoryKey,
        description,
    })
```

> 注意：与 admin handler 对称，`user` 变量仍然用于 401 检查；`user.id` 不再单独作为 `userId` 参数传入，而是作为 `ownerUserId` 显式表达"归属当前用户"的语义。

- [ ] **Step 2: 全量类型检查（此时应 0 错误）**

```bash
bun run typecheck
```

Expected：**0 error**。如果还有错误，说明 Task 1 Step 4 漏记了点，按错误信息回去补。

- [ ] **Step 3: Commit**

```bash
git add server/api/v1/assistant/document/templates.post.ts
git commit -m "$(cat <<'EOF'
refactor(api): 用户端文书模板接口显式传 scope=user

与管理端接口对称，由 handler 表态归属语义。
EOF
)"
```

---

## Task 5：补充用户云盘 / 配额回归测试 — 证明 NULL 归属文件被天然排除

**目的：** 直接走真实库验证 `ossUsageDao` 和 `findOssFilesByUserIdDao` 不会把 `userId=NULL` 的文件计入任何用户。这是 spec §八 的关键 3、4 项。

**Files:**
- Create: `tests/server/files/ossUsageDao.systemFiles.test.ts`

- [ ] **Step 1: 写测试 — 用真实库验证 NULL 文件不被任何用户感知**

新文件 `tests/server/files/ossUsageDao.systemFiles.test.ts`：

```typescript
/**
 * 系统级文件（ossFiles.userId=NULL）回归测试
 *
 * 验证：把全局文书模板等"系统资源"标记为 userId=NULL 后，
 * - ossUsageDao(任意 userId) 不再把它计入配额
 * - findOssFilesByUserIdDao(任意 userId) 不在列表中返回
 * - findOrphanOssFilesDAO 不会把仍被 documentTemplates 引用的 NULL 文件当作孤儿误清理
 *
 * **Feature: system-files-decouple-from-cloud**
 * **Validates: spec §八 测试 2/3**
 */

import { describe, it, expect, afterEach } from 'vitest'
import {
    createTestUser,
    createTestOssFile,
    cleanupTestData,
    createEmptyTestIds,
    type TestIds,
} from './test-db-helper'
import { prisma } from '~~/server/utils/db'
import {
    ossUsageDao,
    findOssFilesByUserIdDao,
    findOrphanOssFilesDAO,
} from '~~/server/services/files/ossFiles.dao'
import { FileSource, OssFileStatus } from '#shared/types/file'

describe('ossUsageDao / findOssFilesByUserIdDao 对系统级文件（userId=NULL）的处理', () => {
    const testIds: TestIds = createEmptyTestIds()
    const extraTemplateIds: number[] = []

    afterEach(async () => {
        if (extraTemplateIds.length > 0) {
            await prisma.documentTemplates.deleteMany({ where: { id: { in: extraTemplateIds } } })
            extraTemplateIds.length = 0
        }
        await cleanupTestData(testIds)
        testIds.userIds.length = 0
        testIds.ossFileIds.length = 0
    })

    /** helper 当前不支持 userId=null，所以系统级文件用 prisma 直写 */
    async function makeSystemOssFile(size: number, fileName: string) {
        const row = await prisma.ossFiles.create({
            data: {
                userId: null,
                bucketName: 'test-bucket',
                fileName,
                filePath: `test/${Date.now()}_${Math.random()}_${fileName}`,
                fileSize: size,
                fileType: 'application/octet-stream',
                source: FileSource.DOCUMENT_TEMPLATE,
                status: OssFileStatus.UPLOADED,
                encrypted: false,
            },
        })
        testIds.ossFileIds.push(row.id)
        return row
    }

    it('userId=NULL 的文件不计入任何用户配额', async () => {
        const user = await createTestUser()
        testIds.userIds.push(user.id)

        // 用户自己的私有文件 200 字节
        const privateFile = await createTestOssFile(user.id, { fileSize: 200 })
        testIds.ossFileIds.push(privateFile.id)
        // 系统级文件 1000 字节
        await makeSystemOssFile(1000, `global_${Date.now()}.bin`)

        const usage = await ossUsageDao(user.id)

        expect(usage.fileSize).toBe(200)
        expect(usage.count).toBe(1)
    })

    it('userId=NULL 的文件不出现在任何用户的云盘列表里', async () => {
        const user = await createTestUser()
        testIds.userIds.push(user.id)

        const privateFile = await createTestOssFile(user.id, { fileSize: 100 })
        testIds.ossFileIds.push(privateFile.id)
        await makeSystemOssFile(100, `global_${Date.now()}.bin`)

        const { files, total } = await findOssFilesByUserIdDao(user.id, { page: 1, pageSize: 50 })

        expect(total).toBe(1)
        expect(files).toHaveLength(1)
        expect(files[0]!.id).toBe(privateFile.id)
    })

    it('多个 userId=NULL 的文件不会触发复合唯一索引冲突（PG 17 默认 NULLS DISTINCT 假设）', async () => {
        // 关键回归：原索引 @@unique([userId, bucketName, filePath])，userId 改 nullable 后两条 NULL 行可以并存
        // 若未来有人在迁移里给索引加 NULLS NOT DISTINCT，此用例将立即报错，提醒回滚
        const r1 = await makeSystemOssFile(100, `dup_${Date.now()}_1.bin`)
        const r2 = await makeSystemOssFile(100, `dup_${Date.now()}_2.bin`)

        expect(r1.id).not.toBe(r2.id)
    })

    it('findOrphanOssFilesDAO 不会把"仍被 documentTemplates 引用的 NULL 归属文件"误判为孤儿', async () => {
        // 业务场景：管理员上传的全局模板，ossFile.userId=NULL 但仍被 documentTemplates.ossFileId 引用
        // 期望：孤儿扫描跳过这种文件
        const ossFile = await makeSystemOssFile(100, `tpl_${Date.now()}.docx`)
        const tpl = await prisma.documentTemplates.create({
            data: {
                name: `回归_${Date.now()}_${Math.random()}`,
                category: 'litigation',
                scope: 'global',
                userId: null,
                ossFileId: ossFile.id,
                placeholders: [],
                priority: 100,
            },
        })
        extraTemplateIds.push(tpl.id)

        const orphanIds = await findOrphanOssFilesDAO(500)

        expect(orphanIds).not.toContain(ossFile.id)
    })
})
```

> 关键复用：`createTestUser` / `createTestOssFile` / `cleanupTestData` / `createEmptyTestIds` 来自项目现有 `tests/server/files/test-db-helper.ts`（含 phone 并发安全、级联清理），不再自写。helper 不支持 `userId=null`（签名是 `userId: number`），所以系统级文件用 `prisma.ossFiles.create` 直写。

- [ ] **Step 2: 跑测试**

执行：
```bash
npx vitest run tests/server/files/ossUsageDao.systemFiles.test.ts --reporter=verbose
```

Expected：4 用例全 PASS。如果第三个 FAIL（unique 冲突），说明 PostgreSQL 版本启用了 `NULLS NOT DISTINCT`——需要立即停下来通知 reviewer，因为本设计依赖 PG 默认 `NULLS DISTINCT` 行为。第四个 FAIL 说明 `findOrphanOssFilesDAO` 的 NOT EXISTS 引用扫描被改坏。

- [ ] **Step 3: Commit**

```bash
git add tests/server/files/ossUsageDao.systemFiles.test.ts
git commit -m "$(cat <<'EOF'
test(files): 验证 userId=NULL 的系统级文件不计入用户配额与列表

直接走真实库的集成测试，覆盖 spec §八 测试 2/3 与 ossFiles 复合唯一索引在 NULL 下的语义。
EOF
)"
```

---

## Task 6：一次性迁移脚本 — 把存量"全局模板"对应的 ossFile.userId 置 NULL

**Files:**
- Create: `server/scripts/migrateGlobalTemplateOwnership.ts`

- [ ] **Step 1: 写脚本**

新文件 `server/scripts/migrateGlobalTemplateOwnership.ts`：

```typescript
/**
 * 一次性数据修复：把存量全局文书模板对应的 ossFile.userId 置 NULL，
 * 完成"系统级文件"从管理员私有云盘剥离。
 *
 * 范围筛选：
 *   ossFile.source = 'documentTemplate'
 *   AND 关联的 documentTemplates.scope = 'global'
 *   AND ossFile.userId IS NOT NULL（同时承担幂等保护：已置空的记录不会再被命中）
 *
 * 不限定 deletedAt：软删除记录虽然不影响显示和配额，但顺手搬掉保持数据一致。
 *
 * 为什么走 server/scripts/ 而不是 prisma/seeds/seedData.sql：
 *   seedData.sql 是"新环境初始化的全量种子快照"，按项目数据库规则只允许 INSERT INTO，
 *   且不包含 ossFiles 这类用户运行时数据。本次是**已上线环境**的存量数据一次性修正，
 *   属于维护脚本范畴（与 migrateFillingDrafts.ts / rebuildLawEmbeddings.ts 同模式）。
 *
 * 用法：`npx tsx server/scripts/migrateGlobalTemplateOwnership.ts`
 */

import { prisma } from '~~/server/utils/db'
import { logger } from '#shared/utils/logger'
import { FileSource } from '#shared/types/file'

async function main() {
    // documentTemplates.ossFileId 是普通 Int 字段（无 @relation 反向关系），
    // 因此分两步：先取全局模板的 ossFileId 列表，再按这批 id 过滤 ossFiles 做 update。

    // 1) 拿出所有 scope='global' 模板对应的 ossFileId
    const globalTemplates = await prisma.documentTemplates.findMany({
        where: { scope: 'global' },
        select: { id: true, ossFileId: true },
    })

    if (globalTemplates.length === 0) {
        logger.info('[migrate-global-template-ownership] 没有 scope=global 的模板，跳过')
        return
    }

    const ossFileIds = globalTemplates.map(t => t.ossFileId)

    // 2) 找出对应 ossFile 中"还有归属"的行（幂等保护）
    const targets = await prisma.ossFiles.findMany({
        where: {
            id: { in: ossFileIds },
            source: FileSource.DOCUMENT_TEMPLATE,
            userId: { not: null },
        },
        select: { id: true, userId: true, fileName: true },
    })

    if (targets.length === 0) {
        logger.info('[migrate-global-template-ownership] 所有全局模板对应的 ossFile.userId 已剥离，无需迁移')
        return
    }

    logger.info('[migrate-global-template-ownership] 待迁移记录数:', {
        count: targets.length,
        sampleOssFileIds: targets.slice(0, 5).map(t => t.id),
        affectedUserIds: [...new Set(targets.map(t => t.userId).filter((v): v is number => v != null))],
    })

    // 3) 把 ossFile.userId 置为 NULL
    const result = await prisma.ossFiles.updateMany({
        where: { id: { in: targets.map(t => t.id) }, userId: { not: null } },
        data: { userId: null },
    })

    logger.info('[migrate-global-template-ownership] 完成', {
        scanned: targets.length,
        updated: result.count,
        skipped: targets.length - result.count, // 理论上是 0；非 0 说明被其他进程抢先迁移
    })
}

main()
    .catch((err) => {
        logger.error('[migrate-global-template-ownership] 失败', { err })
        process.exit(1)
    })
    .finally(() => process.exit(0))
```

> 与 `migrateFillingDrafts.ts` / `rebuildLawEmbeddings.ts` 同模式：直接走 Prisma client、`main()` + `.catch()` + `.finally(process.exit)`。

- [ ] **Step 2: 单跑脚本（在 dev 库上）验证可执行**

执行：
```bash
npx tsx server/scripts/migrateGlobalTemplateOwnership.ts
```

Expected：日志输出形如 `[migrate-global-template-ownership] 没有需要迁移的记录`（如果 dev 库里没有 scope=global 模板），或者 `完成 {scanned: N, updated: N, skipped: 0}`。脚本退出码 0。

- [ ] **Step 3: Commit**

```bash
git add server/scripts/migrateGlobalTemplateOwnership.ts
git commit -m "$(cat <<'EOF'
chore(scripts): 新增 migrateGlobalTemplateOwnership.ts 一次性迁移脚本

把存量全局文书模板对应的 ossFile.userId 置 NULL，剥离管理员私有云盘归属。
脚本幂等：WHERE userId IS NOT NULL 自卫，重复执行不会再次命中已迁移记录。
EOF
)"
```

---

## Task 7：迁移脚本的集成测试

**Files:**
- Create: `tests/server/scripts/migrateGlobalTemplateOwnership.test.ts`

- [ ] **Step 1: 写测试**

新文件 `tests/server/scripts/migrateGlobalTemplateOwnership.test.ts`：

```typescript
/**
 * migrateGlobalTemplateOwnership 脚本测试
 *
 * 验证：
 * 1) 全局模板对应 ossFile.userId 被置 NULL
 * 2) 用户私有文件不受影响
 * 3) 重复执行幂等（不会改变已置 NULL 的记录）
 *
 * **Feature: system-files-decouple-from-cloud**
 * **Validates: spec §八 测试 4**
 */

import { describe, it, expect, afterEach } from 'vitest'
import { prisma } from '~~/server/utils/db'
import {
    createTestUser,
    createTestOssFile,
    cleanupTestData,
    createEmptyTestIds,
    type TestIds,
} from '../files/test-db-helper'
import { FileSource, OssFileStatus } from '#shared/types/file'

// 不直接 import 脚本（脚本带 process.exit）；改成纯函数会更可测，
// 这里取折中：把脚本核心逻辑提到本测试文件内重新实现，但与脚本保持 1:1 对应。
async function runMigration() {
    const globalTemplates = await prisma.documentTemplates.findMany({
        where: { scope: 'global' },
        select: { ossFileId: true },
    })
    if (globalTemplates.length === 0) return { scanned: 0, updated: 0 }

    const targets = await prisma.ossFiles.findMany({
        where: {
            id: { in: globalTemplates.map(t => t.ossFileId) },
            source: FileSource.DOCUMENT_TEMPLATE,
            userId: { not: null },
        },
        select: { id: true },
    })
    if (targets.length === 0) return { scanned: 0, updated: 0 }

    const result = await prisma.ossFiles.updateMany({
        where: { id: { in: targets.map(t => t.id) }, userId: { not: null } },
        data: { userId: null },
    })
    return { scanned: targets.length, updated: result.count }
}

describe('migrateGlobalTemplateOwnership', () => {
    const testIds: TestIds = createEmptyTestIds()
    const templateIds: number[] = []

    afterEach(async () => {
        if (templateIds.length > 0) {
            await prisma.documentTemplates.deleteMany({ where: { id: { in: templateIds } } })
            templateIds.length = 0
        }
        await cleanupTestData(testIds)
        testIds.userIds.length = 0
        testIds.ossFileIds.length = 0
    })

    /** 造一个全局模板（含 ossFile）—— scope='global' + ossFile.userId=管理员，模拟改造前的存量脏数据 */
    async function seedGlobalTemplateAttachedToAdmin(adminId: number) {
        const oss = await createTestOssFile(adminId, {
            fileName: `tpl_${Date.now()}_${Math.random()}.docx`,
            source: FileSource.DOCUMENT_TEMPLATE,
            status: OssFileStatus.UPLOADED,
        })
        testIds.ossFileIds.push(oss.id)
        const tpl = await prisma.documentTemplates.create({
            data: {
                name: `tpl_${Date.now()}_${Math.random()}`,
                category: 'litigation',
                scope: 'global',
                userId: null,
                ossFileId: oss.id,
                placeholders: [],
                priority: 100,
            },
        })
        templateIds.push(tpl.id)
        return { template: tpl, ossFile: oss }
    }

    /** 造一个个人模板（不应被迁移触达） */
    async function seedPersonalTemplate(ownerId: number) {
        const oss = await createTestOssFile(ownerId, {
            fileName: `tpl_${Date.now()}_${Math.random()}.docx`,
            source: FileSource.DOCUMENT_TEMPLATE,
            status: OssFileStatus.UPLOADED,
        })
        testIds.ossFileIds.push(oss.id)
        const tpl = await prisma.documentTemplates.create({
            data: {
                name: `tpl_${Date.now()}_${Math.random()}`,
                category: 'litigation',
                scope: 'user',
                userId: ownerId,
                ossFileId: oss.id,
                placeholders: [],
                priority: 100,
            },
        })
        templateIds.push(tpl.id)
        return { template: tpl, ossFile: oss }
    }

    it('全局模板对应 ossFile.userId 被置 NULL', async () => {
        const admin = await createTestUser()
        testIds.userIds.push(admin.id)
        const { ossFile } = await seedGlobalTemplateAttachedToAdmin(admin.id)

        const r = await runMigration()

        const after = await prisma.ossFiles.findUnique({ where: { id: ossFile.id } })
        expect(after?.userId).toBeNull()
        expect(r.updated).toBe(1)
    })

    it('用户个人模板对应 ossFile.userId 保持不变', async () => {
        const user = await createTestUser()
        testIds.userIds.push(user.id)
        const { ossFile } = await seedPersonalTemplate(user.id)

        await runMigration()

        const after = await prisma.ossFiles.findUnique({ where: { id: ossFile.id } })
        expect(after?.userId).toBe(user.id)
    })

    it('重复执行幂等，第二次不改任何行', async () => {
        const admin = await createTestUser()
        testIds.userIds.push(admin.id)
        await seedGlobalTemplateAttachedToAdmin(admin.id)

        const first = await runMigration()
        const second = await runMigration()

        expect(first.updated).toBe(1)
        expect(second.updated).toBe(0)
    })
})
```

> 关键复用：跨目录 `import` 同一个 `tests/server/files/test-db-helper.ts` — 不同测试目录共用一份 user/ossFile 工厂，符合 DRY。

> 测试不直接 import 脚本（脚本含 `process.exit`），而是把脚本核心 SQL 1:1 重写为函数后跑——这是项目内 `tests/server/agent-platform/scripts/*` 的常见模式。

- [ ] **Step 2: 跑测试**

```bash
npx vitest run tests/server/scripts/migrateGlobalTemplateOwnership.test.ts --reporter=verbose
```

Expected：3 用例全 PASS。

- [ ] **Step 3: Commit**

```bash
git add tests/server/scripts/migrateGlobalTemplateOwnership.test.ts
git commit -m "$(cat <<'EOF'
test(scripts): 覆盖 migrateGlobalTemplateOwnership 的核心搬移逻辑

3 个真实库用例：全局模板被剥离 / 用户私有不变 / 幂等。
EOF
)"
```

---

## Task 8：更新 `.claude/rules/api.md` — 系统级文件落库备注

**目的：** 未来新增"系统级文件"入口的开发者打开 api.md 就能看到约定，避免再次踩同一个坑。

**Files:**
- Modify: `.claude/rules/api.md`

- [ ] **Step 1: 在 `.claude/rules/api.md` 末尾追加段落**

打开 `.claude/rules/api.md`，在最末追加：

```markdown

## 系统级文件落库（如有此类场景时参考）

`ossFiles.userId` 已设计为可空。当一份文件是"面向全体用户的系统资源"（如全局文书模板）而非任何用户的私有云盘文件时：

- 落库时 `userId` 写 `NULL`，表示"系统所有，不属于任何个人云盘"
- 用户云盘列表 `findOssFilesByUserIdDao` 与配额计算 `ossUsageDao` 按 `WHERE userId = me` 过滤，NULL 行天然被排除
- 决策在 API handler 层显式表态（管理端 handler 传 `null`，用户端 handler 传 `user.id`），与"管理端 / 用户端 API 物理隔离"铁律一致

参考实现：`server/api/v1/admin/document-templates/index.post.ts` + `server/agents/document/documentTemplate.service.ts`。
```

- [ ] **Step 2: Commit**

```bash
git add .claude/rules/api.md
git commit -m "$(cat <<'EOF'
docs(rules): 在 api.md 加入系统级文件落库 ownerUserId=null 约定

未来新增类似"管理员后台上传系统资源"的入口直接套用此约定，避免再次错把
系统资源挂到管理员私有云盘下。
EOF
)"
```

---

## Task 9：全量类型检查 + 全量测试

**目的：** 最后一道闸口，确保所有改动放在一起仍然成立。

- [ ] **Step 1: 类型检查**

```bash
bun run typecheck
```

Expected：**0 error**。任何残留错误必须当场修掉，不允许带病合并。

- [ ] **Step 2: 跑全量测试**

```bash
bun run test
```

Expected：所有测试通过。如有失败，按以下分类处理：
- **是本次改动引起的**：定位到具体测试，修复实现或修复测试（视具体情况判断）
- **与本次无关的已知失败**：核对 `tests/KNOWN_FAILS.md`，确认在已知清单内则跳过；不在则停下来通知 reviewer

- [ ] **Step 3: 跑相关单元测试单独确认**

```bash
npx vitest run tests/server/assistant/document/documentTemplate.service.test.ts tests/server/files/ossUsageDao.systemFiles.test.ts tests/server/scripts/migrateGlobalTemplateOwnership.test.ts --reporter=verbose
```

Expected：本次新增 / 修改的测试全部 PASS。

- [ ] **Step 4: 端到端验证（浏览器）— 双视角**

启动 dev：
```bash
bun dev
```

**A. 管理员视角（验证不再污染管理员云盘）**：
1. 用超管账号登录
2. 进入 `/admin/document-templates`，上传一份新的全局模板（记下文件大小）
3. 同账号进入 `/dashboard/files`（自己的云盘）
4. **核心断言**：刚上传的全局模板**不应**出现在云盘列表里
5. **核心断言**：右上角/侧栏的配额数字**不应**包含这个模板的大小

**B. 普通用户视角（回归确认普通用户依然看不到全局模板）**：
6. 切换到任意普通用户账号登录
7. 进入 `/dashboard/files`
8. **核心断言**：列表里不出现任何全局模板的文件
9. 进入 `/dashboard/document` 选择文书模板 — **依然能看到全局模板**作为可选项（业务功能未受影响）

任何一条断言失败：
- 回到 Task 2/3/4 检查 handler 调用参数是否真传了正确的 `ownerUserId`
- 用 SQL 直接验证：
  ```sql
  SELECT id, user_id, file_name, source FROM oss_files 
  WHERE source = 'documentTemplate' AND user_id IS NULL 
  ORDER BY id DESC LIMIT 5;
  ```
  期望本次管理端新上传的全局模板 `user_id` 为 NULL。

- [ ] **Step 5: 最终 commit（可选 — 若 typecheck/test 没有产生新 diff，跳过）**

如果上面的步骤产生了任何小修补，commit 它们；否则跳过。

---

## 上线节奏（实施完成后人工执行，不写进 plan 任务）

1. PR 评审通过、CI 通过
2. 合并至 `main` → 自动部署触发 `bun run prisma:deploy` 执行 `ALTER COLUMN ... DROP NOT NULL`（即时返回，零锁表）
3. 人工在生产服务器执行 `npx tsx server/scripts/migrateGlobalTemplateOwnership.ts` 一次
4. 观察 5-10 分钟：管理员账号云盘列表 / 配额恢复正常

建议执行时段：非业务高峰；脚本本身只是 N 条 UPDATE（N = 当前生产全局模板数），通常瞬时完成。
