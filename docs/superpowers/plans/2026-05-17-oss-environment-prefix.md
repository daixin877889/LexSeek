# OSS 文件环境前缀修复 + 历史迁移 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 11 处 OSS 上传缺环境前缀的 BUG，抽统一路径函数收敛全部 15 处上传调用点，并提供全环境历史文件迁移脚本。

**Architecture:** 新增 `server/utils/storagePath.ts` 导出 `buildStorageKey` / `buildStorageDir`，按 `{env}/{owner}/{source}/[{subDir}/]{filename}` 约定构造带环境前缀的 OSS object key；所有上传调用点改为经它构造路径。新增 `server/scripts/migrateOssBasePath.ts`，按环境读各自数据库 `ossFiles` 表，把未带前缀的历史文件在 OSS 内复制到带前缀目录并更新 `filePath`。

**Tech Stack:** Nuxt 4 / Nitro、TypeScript、Prisma、ali-oss、Vitest。

**对应 spec:** `docs/superpowers/specs/2026-05-17-oss-environment-prefix-design.md`

> **并行分支注意**：当前 `dev` 分支上有其它任务（dashboard UI 改版）并行进行。每次 commit 只 `git add` 本计划明确列出的文件，禁止 `git add -A` / `git add .`，提交前先 `git status` 确认暂存区只含本任务文件。

---

## File Structure

**新建：**
- `server/utils/storagePath.ts` — 统一路径构造函数（`buildStorageKey` / `buildStorageDir`）
- `tests/server/utils/storagePath.test.ts` — 路径函数单测
- `server/scripts/migrateOssBasePath.ts` — 历史文件迁移脚本
- `tests/server/scripts/migrateOssBasePath.test.ts` — 迁移脚本纯函数单测

**修改（11 处 BUG + 4 处收敛）：**
- `server/agents/document/documentTemplate.service.ts`
- `server/agents/document/documentExport.service.ts`
- `server/agents/contract/contractReview.service.ts`
- `server/agents/contract/contractReviewVersion.service.ts`
- `server/agents/contract/middleware/reviewResultPersistence.middleware.ts`
- `server/agents/contract/contractReviewRebuild.service.ts`
- `server/services/agent-platform/tools/uploadWorkspaceFile.tool.ts`
- `server/services/material/mineru.service.ts`
- `server/services/material/asr.service.ts`
- `server/api/v1/recognition/audio/temp-upload.post.ts`
- `server/api/v1/storage/presigned-url/.post.ts`
- `server/api/v1/storage/presigned-url/.get.ts`
- `server/services/material/mineruResult.service.ts`
- `server/services/material/imageProcessor.ts`
- 受影响测试：`tests/server/assistant/document/documentTemplate.service.test.ts`、`tests/server/assistant/document/documentExport.test.ts` — 更新路径断言为带 `test/` 前缀的新值（其余模块测试通常无需改，详见各 Task）

---

## Task 1: 新建统一路径函数 buildStorageKey / buildStorageDir

**Files:**
- Create: `server/utils/storagePath.ts`
- Test: `tests/server/utils/storagePath.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `tests/server/utils/storagePath.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { FileSource } from '#shared/types/file'
import { buildStorageKey, buildStorageDir, normalizeBasePath } from '~~/server/utils/storagePath'

// 说明：本项目 vitest 跑在 @nuxt/test-utils 的 nuxt 环境，server 模块里的
// useRuntimeConfig() 是真实自动导入，测试侧无法用 globalThis 赋值 / vi.stubGlobal
// 动态切换其返回值。因此「前缀规范化」逻辑抽成纯函数 normalizeBasePath 直接单测；
// buildStorageDir/buildStorageKey 的路径结构用例统一在测试环境真实 basePath（由
// .env.testing 的 NUXT_STORAGE_BASE_PATH 提供，= test/）下验证。

describe('normalizeBasePath（环境前缀规范化）', () => {
    it('空值 → 空字符串', () => {
        expect(normalizeBasePath('')).toBe('')
        expect(normalizeBasePath(undefined)).toBe('')
        expect(normalizeBasePath(null)).toBe('')
    })

    it('不带末尾斜杠 → 自动补全 /', () => {
        expect(normalizeBasePath('prod')).toBe('prod/')
    })

    it('已带末尾斜杠 → 原样返回', () => {
        expect(normalizeBasePath('dev/')).toBe('dev/')
    })
})

describe('buildStorageDir / buildStorageKey（路径结构）', () => {
    it('user scope 拼出 {env}/user{id}/{source}/', () => {
        expect(buildStorageDir({ scope: 'user', userId: 7, source: FileSource.DOCUMENT_TEMPLATE }))
            .toBe('test/user7/document_template/')
    })

    it('system scope owner 段为 system', () => {
        expect(buildStorageDir({ scope: 'system', source: FileSource.DOCUMENT_TEMPLATE }))
            .toBe('test/system/document_template/')
    })

    it('temp scope owner 段为 temp', () => {
        expect(buildStorageDir({ scope: 'temp', source: FileSource.ASR }))
            .toBe('test/temp/asr/')
    })

    it('subDir 作为二级目录拼入', () => {
        expect(buildStorageDir({ scope: 'user', userId: 7, source: FileSource.ASR, subDir: 'raw/2026/05/17' }))
            .toBe('test/user7/asr/raw/2026/05/17/')
    })

    it('buildStorageKey 末尾拼上 fileName', () => {
        expect(buildStorageKey({ scope: 'user', userId: 7, source: FileSource.DOCUMENT_EXPORT, fileName: 'a.docx' }))
            .toBe('test/user7/document_export/a.docx')
    })

    it('scope=user 缺 userId 抛错', () => {
        expect(() => buildStorageDir({ scope: 'user', source: FileSource.ASR }))
            .toThrow(/userId/)
    })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/server/utils/storagePath.test.ts --reporter=verbose`
Expected: FAIL —— 模块 `~~/server/utils/storagePath` 不存在。

- [ ] **Step 3: 写实现**

创建 `server/utils/storagePath.ts`：

```ts
/**
 * OSS object key 构造工具
 *
 * 统一约定：{env}/{owner}/{source}/[{subDir}/]{filename}
 * - {env}    环境前缀，来自 runtimeConfig.storage.basePath（dev/ test/ prod/），空则不加
 * - {owner}  user{id} | system | temp
 * - {source} FileSource 枚举值
 * - {subDir} 可选二级目录（前后不带斜杠）
 *
 * 仅供 Nitro 运行时（API handler / Service / 中间件 / Agent 工具）调用——依赖
 * useRuntimeConfig()。独立运行的维护脚本不要用本函数。
 */
import type { FileSource } from '#shared/types/file'

export type StorageScope = 'user' | 'system' | 'temp'

export interface StoragePathParams {
    scope: StorageScope
    /** scope='user' 时必填 */
    userId?: number
    source: FileSource
    /** 可选二级目录，前后不带斜杠 */
    subDir?: string
}

/** 规范化环境前缀：空值 → ''；非空 → 保证以 / 结尾。纯函数，便于单测。 */
export function normalizeBasePath(raw: string | null | undefined): string {
    const basePath = raw || ''
    if (!basePath) return ''
    return basePath.endsWith('/') ? basePath : `${basePath}/`
}

/** 取环境前缀（从 runtimeConfig 读取并规范化） */
function getBasePath(): string {
    return normalizeBasePath(useRuntimeConfig().storage.basePath)
}

/** owner 段：user{id} / system / temp */
function resolveOwner(scope: StorageScope, userId?: number): string {
    if (scope === 'user') {
        if (userId == null) {
            throw new Error('[storagePath] scope=user 时 userId 必填')
        }
        return `user${userId}`
    }
    return scope
}

/** 构造目录（末尾带 /），供预签名上传流程使用 */
export function buildStorageDir(params: StoragePathParams): string {
    const owner = resolveOwner(params.scope, params.userId)
    const sub = params.subDir ? `${params.subDir}/` : ''
    return `${getBasePath()}${owner}/${params.source}/${sub}`
}

/** 构造完整 object key（含 {env} 前缀） */
export function buildStorageKey(params: StoragePathParams & { fileName: string }): string {
    return `${buildStorageDir(params)}${params.fileName}`
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/server/utils/storagePath.test.ts --reporter=verbose`
Expected: PASS —— 9 个用例全绿。

- [ ] **Step 5: 类型检查**

Run: `bun run typecheck`
Expected: 无新增错误。

- [ ] **Step 6: 提交**

```bash
git add server/utils/storagePath.ts tests/server/utils/storagePath.test.ts
git commit -m "feat(storage): 新增统一 OSS 路径构造函数 buildStorageKey/buildStorageDir"
```

---

## Task 2: 收敛文书模块（documentTemplate + documentExport）

**Files:**
- Modify: `server/agents/document/documentTemplate.service.ts:110-114`
- Modify: `server/agents/document/documentExport.service.ts:88`
- Test: `tests/server/assistant/document/documentTemplate.service.test.ts`
- Test: `tests/server/assistant/document/documentExport.test.ts`

> **关键前置**：`documentTemplate.service.ts` 与 `documentExport.service.ts` 改造后经 `buildStorageKey` 间接调用 `useRuntimeConfig()`。项目 vitest 跑在 `@nuxt/test-utils` 的 nuxt 环境，`useRuntimeConfig` 是真实自动导入、**始终可用**（不会「未定义崩溃」）；其 `storage.basePath` 由 `.env.testing` 的 `NUXT_STORAGE_BASE_PATH` 提供（= `test/`）。测试侧无法用 `globalThis` 赋值或 `vi.stubGlobal` 改写 server 模块里这个自动导入的返回值，故**无需补桩**——只需把现有路径断言更新为带 `test/` 前缀的新值。

- [ ] **Step 1: 更新路径断言**

**更新断言（documentTemplate.service.test.ts）**：桩已把 `basePath` 设为 `test/`。该文件共 **3 处** OSS 路径相关断言，逐处改（**第 3 处易漏，务必改**）：

- 约第 311 行（『admin 上传：OSS 路径使用 global-templates 前缀』用例）：
```ts
// 旧：expect(ossPath).toContain('global-templates/')
// 新：
expect(ossPath).toContain('test/system/document_template/')
```
- 约第 353 行（『scope=global 时 OSS 路径走 global-templates/ 前缀』用例，其下一行 `expect(ossPath).not.toContain('users/')` 保持不变）：
```ts
// 旧：expect(ossPath).toMatch(/^global-templates\//)
// 新：
expect(ossPath).toMatch(/^test\/system\/document_template\//)
```
- 约第 210 行（『上传 OSS 路径包含 userId（用户个人模板路径隔离）』用例）—— 这条是 `users/${...}/` 模板字符串、不含 `global-templates`/`templates` 字样，按字面搜索定位不到，**漏改会导致 Task 2 测试卡在 Step 5**：
```ts
// 旧：expect(ossPath).toContain(`users/${BASE_PARAMS.ownerUserId}/`)
// 新：
expect(ossPath).toContain(`test/user${BASE_PARAMS.ownerUserId}/document_template/`)
```

改完通读整个文件，确认无其它残留的 `global-templates` / `users/` 路径断言。

**更新断言（documentExport.test.ts）**：约第 277 行，`mockUploadFileService` 的 `toHaveBeenCalledWith` 第一个实参为 `expect.stringContaining('users/100/document-exports/')`，把其中字符串改为：

```ts
expect.stringContaining('test/user100/document_export/')
```

> 该文件第 147 行 `MOCK_UPLOAD_RESULT.name`、第 154 行 `MOCK_CREATED_OSS_FILE.filePath` 是 mock 返回值（被测代码原样透传给 `createOssFileDao`），不影响断言，无需改动。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/server/assistant/document/documentTemplate.service.test.ts tests/server/assistant/document/documentExport.test.ts --reporter=verbose`
Expected: FAIL —— 路径断言不匹配（实现还在生成旧路径）。

- [ ] **Step 3: 改 documentTemplate.service.ts**

在 import 段加（`FileSource` 已在该文件 import，无需重复）：

```ts
import { buildStorageKey } from '~~/server/utils/storagePath'
```

把第 110-114 行的 `ossPath` 构造：

```ts
    const timestamp = Date.now()
    const ossPath =
        params.scope === 'user'
            ? `users/${params.ownerUserId}/templates/${timestamp}_${params.fileName}`
            : `global-templates/${timestamp}_${params.fileName}`
```

改为：

```ts
    const timestamp = Date.now()
    const ossPath =
        params.scope === 'user'
            ? buildStorageKey({
                  scope: 'user',
                  userId: params.ownerUserId!,
                  source: FileSource.DOCUMENT_TEMPLATE,
                  fileName: `${timestamp}_${params.fileName}`,
              })
            : buildStorageKey({
                  scope: 'system',
                  source: FileSource.DOCUMENT_TEMPLATE,
                  fileName: `${timestamp}_${params.fileName}`,
              })
```

> `params.ownerUserId!`：此分支 `scope==='user'`，函数开头的不变量自卫已保证 `ownerUserId` 非空。

- [ ] **Step 4: 改 documentExport.service.ts**

在 import 段加（`FileSource` 已在该文件 import）：

```ts
import { buildStorageKey } from '~~/server/utils/storagePath'
```

把第 88 行：

```ts
    const ossPath = `users/${userId}/document-exports/${Date.now()}_${safeBaseName}.docx`
```

改为：

```ts
    const ossPath = buildStorageKey({
        scope: 'user',
        userId,
        source: FileSource.DOCUMENT_EXPORT,
        fileName: `${Date.now()}_${safeBaseName}.docx`,
    })
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/server/assistant/document/documentTemplate.service.test.ts tests/server/assistant/document/documentExport.test.ts --reporter=verbose`
Expected: PASS。

- [ ] **Step 6: 类型检查**

Run: `bun run typecheck`
Expected: 无新增错误。

- [ ] **Step 7: 提交**

```bash
git add server/agents/document/documentTemplate.service.ts server/agents/document/documentExport.service.ts tests/server/assistant/document/documentTemplate.service.test.ts tests/server/assistant/document/documentExport.test.ts
git commit -m "fix(storage): 文书模板/导出上传补环境前缀，走统一路径函数"
```

---

## Task 3: 收敛合同模块（4 处上传）

**Files:**
- Modify: `server/agents/contract/contractReview.service.ts:108`
- Modify: `server/agents/contract/contractReviewVersion.service.ts:387-388`
- Modify: `server/agents/contract/middleware/reviewResultPersistence.middleware.ts:113-114`
- Modify: `server/agents/contract/contractReviewRebuild.service.ts:158`

这 4 处合同审查文件均归 `FileSource.CASE_ANALYSIS`（沿用现状）。

- [ ] **Step 1: 改 contractReview.service.ts**

在 import 段加 `import { buildStorageKey } from '~~/server/utils/storagePath'`；确认 `FileSource` 已 import（该文件已用 `FileSource.CASE_ANALYSIS`，无需重复）。

把第 108 行：

```ts
        const ossPath = `contract-review/${userId}/${randomUUID()}.docx`
```

改为：

```ts
        const ossPath = buildStorageKey({
            scope: 'user',
            userId,
            source: FileSource.CASE_ANALYSIS,
            fileName: `${randomUUID()}.docx`,
        })
```

- [ ] **Step 2: 改 contractReviewVersion.service.ts**

加 import `import { buildStorageKey } from '~~/server/utils/storagePath'`；确认 `FileSource` 已 import（该文件已 import）。

只替换 `const ossPath = ...` **这一行**（约第 388 行，其上方有 `// 上传到 OSS：...` 和 `// CORE-R3：...` 两行注释——**不要把注释纳入替换**）。把：

```ts
    const ossPath = `contract-review/${review.userId}/version-${versionId}-${randomUUID()}.docx`
```

改为：

```ts
    const ossPath = buildStorageKey({
        scope: 'user',
        userId: review.userId,
        source: FileSource.CASE_ANALYSIS,
        fileName: `version-${versionId}-${randomUUID()}.docx`,
    })
```

再把上方那行已过时的注释 `// 上传到 OSS：contract-review/<userId>/version-<versionId>-<uuid>.docx` 改为 `// 上传到 OSS（统一路径函数构造，{env}/user<id>/caseAnalysis/）`。

- [ ] **Step 3: 改 reviewResultPersistence.middleware.ts**

加 import `import { buildStorageKey } from '~~/server/utils/storagePath'`；确认 `FileSource` 已 import（该文件已用 `FileSource.CASE_ANALYSIS`）。

只替换 `const ossPath = ...` **这一行**（约第 115 行，其上方有 3 行注释——**不要把注释纳入替换**）。把：

```ts
    const ossPath = `contract-review/${review.userId}/reviewed-${randomUUID()}.docx`
```

改为：

```ts
    const ossPath = buildStorageKey({
        scope: 'user',
        userId: review.userId,
        source: FileSource.CASE_ANALYSIS,
        fileName: `reviewed-${randomUUID()}.docx`,
    })
```

再把上方那行已过时的注释 `// contract-review/<userId>/reviewed-<uuid>.docx` 改为 `// （统一路径函数构造，{env}/user<id>/caseAnalysis/）`，与 Step 2/4 的注释处理保持一致。

- [ ] **Step 4: 改 contractReviewRebuild.service.ts**

加 import `import { buildStorageKey } from '~~/server/utils/storagePath'`；若该文件未 import `FileSource`，加 `import { FileSource } from '#shared/types/file'`。

把第 158 行：

```ts
    // OSS 路径与 M3 contractReview.service 保持同构：contract-review/<userId>/<uuid>.docx
    const ossPath = `contract-review/${review.userId}/rebuild-${randomUUID()}.docx`
```

改为：

```ts
    // OSS 路径与 contractReview.service 保持同构
    const ossPath = buildStorageKey({
        scope: 'user',
        userId: review.userId,
        source: FileSource.CASE_ANALYSIS,
        fileName: `rebuild-${randomUUID()}.docx`,
    })
```

- [ ] **Step 5: 类型检查**

Run: `bun run typecheck`
Expected: 无新增错误。

- [ ] **Step 6: 验证合同模块**

合同 4 个服务/中间件文件**没有服务端单测**（现有 contract 测试均为 `tests/app/components/assistant/contract/**` 前端组件测试，不触达服务端上传代码，因此不会触发 `buildStorageKey` → 无需补 `useRuntimeConfig` 桩）。本任务路径正确性由 Step 5 的 typecheck + Task 1 的 `storagePath` 单测兜底。
可选回归确认：`npx vitest run tests/server/agent-platform --reporter=verbose`，Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add server/agents/contract/contractReview.service.ts server/agents/contract/contractReviewVersion.service.ts server/agents/contract/middleware/reviewResultPersistence.middleware.ts server/agents/contract/contractReviewRebuild.service.ts
git commit -m "fix(contract): 合同审查文件上传补环境前缀，走统一路径函数"
```

---

## Task 4: 收敛 Agent 工具上传（uploadWorkspaceFile）

**Files:**
- Modify: `server/services/agent-platform/tools/uploadWorkspaceFile.tool.ts:205,249`

- [ ] **Step 1: 加 import**

在 import 段加：

```ts
import { buildStorageKey } from '~~/server/utils/storagePath'
import { FileSource } from '#shared/types/file'
```

> 若 `FileSource` 已 import 则不重复。

- [ ] **Step 2: 改云盘上传分支（第 205 行）**

把：

```ts
        const ossPath = `users/${userId}/workspace/${sessionId}/${Date.now()}_${fileName}`
```

改为：

```ts
        const ossPath = buildStorageKey({
            scope: 'user',
            userId,
            source: FileSource.CASE_ANALYSIS,
            subDir: sessionId,
            fileName: `${Date.now()}_${fileName}`,
        })
```

- [ ] **Step 3: 改临时区上传分支（第 249 行）**

把：

```ts
        const ossPath = `temp/${userId}/workspace/${sessionId}/${timestamp}_${fileName}`
```

改为：

```ts
        const ossPath = buildStorageKey({
            scope: 'temp',
            source: FileSource.CASE_ANALYSIS,
            subDir: sessionId,
            fileName: `${timestamp}_${fileName}`,
        })
```

> temp scope 无 `userId` 段，与 spec 3.3 的 `{env}/temp/caseAnalysis/{sessionId}/...` 一致；`sessionId` 全局唯一，不会跨用户冲突。

- [ ] **Step 4: 类型检查**

Run: `bun run typecheck`
Expected: 无新增错误。

- [ ] **Step 5: 跑现有测试**

`uploadWorkspaceFile.tool.ts` 改造后经 `buildStorageKey` 间接调用 `useRuntimeConfig()`——在 nuxt 测试环境下它始终可用、`storage.basePath` 由 `.env.testing` 提供（= `test/`），无需补桩。

Run: `npx vitest run tests/server/workflow/tools/uploadWorkspaceFile.test.ts tests/server/agent-platform/tools/uploadWorkspaceFile.test.ts --reporter=verbose`
Expected: PASS。两个文件里的路径类字符串（如 `MOCK_UPLOAD_RESULT.name`、`mockResolvedValueOnce({ name: ... })`）均为 mock 返回值，非对生成路径的断言，通常无需改动；若有用例断言工具实际生成的 OSS 路径，按带 `test/` 前缀的新值更新。

- [ ] **Step 6: 提交**

```bash
# 默认只改了 .tool.ts；若 Step 5 更新了测试文件，把对应 test 文件一并 git add
git add server/services/agent-platform/tools/uploadWorkspaceFile.tool.ts
git commit -m "fix(storage): Agent 工具上传文件补环境前缀，走统一路径函数"
```

---

## Task 5: 收敛素材模块（mineru / asr / mineruResult / imageProcessor）

**Files:**
- Modify: `server/services/material/mineru.service.ts:147`
- Modify: `server/services/material/asr.service.ts:390,402-412`
- Modify: `server/services/material/mineruResult.service.ts:162-163`
- Modify: `server/services/material/imageProcessor.ts:83,86`

- [ ] **Step 1: 改 mineru.service.ts**

加 import `import { buildStorageKey } from '~~/server/utils/storagePath'`；确认 `FileSource` 已 import（该文件已用 `FileSource.DOC_EMBEDDED_IMAGE`）。

把第 147 行：

```ts
    const ossPath = `mineru/${taskId}/${uniqueName}`
```

改为：

```ts
    const ossPath = buildStorageKey({
        scope: 'user',
        userId,
        source: FileSource.DOC_EMBEDDED_IMAGE,
        subDir: taskId,
        fileName: uniqueName,
    })
```

- [ ] **Step 2: 改 asr.service.ts —— 路径**

加 import `import { buildStorageKey } from '~~/server/utils/storagePath'`；若未 import `FileSource`，加 `import { FileSource } from '#shared/types/file'`。

把第 390 行：

```ts
        const filePath = `asr/raw/${year}/${month}/${day}/${uuid}.json`
```

改为：

```ts
        const filePath = buildStorageKey({
            scope: 'user',
            userId,
            source: FileSource.ASR,
            subDir: `raw/${year}/${month}/${day}`,
            fileName: `${uuid}.json`,
        })
```

- [ ] **Step 3: 改 asr.service.ts —— 补 source 字段**

第 402-412 行的 `prisma.ossFiles.create` 当前未写 `source` 字段。在 `data` 对象里补一行（与 spec 3.3 补充说明一致）：

```ts
        const ossFile = await prisma.ossFiles.create({
            data: {
                userId,
                bucketName: bucket,
                fileName: `${uuid}.json`,
                filePath,
                fileSize: buffer.length,
                fileType: 'application/json',
                source: FileSource.ASR,
                status: 1, // 已上传
            },
        })
```

- [ ] **Step 4: 改 mineruResult.service.ts（收敛现有正确逻辑）**

加 import `import { buildStorageDir } from '~~/server/utils/storagePath'`；确认 `FileSource` 已 import。

把第 162-163 行：

```ts
    const basePath = storageConfig.basePath
    const dir = `${basePath}user${userId}/${FileSource.DOC_EMBEDDED_IMAGE}/`
```

改为（删除 `basePath` 行）：

```ts
    const dir = buildStorageDir({ scope: 'user', userId, source: FileSource.DOC_EMBEDDED_IMAGE })
```

> `storageConfig` 在该函数其它处仍用到（`ossConfig` / `bucket` / `callbackUrl`），保留；仅删 `basePath` 这一行。

- [ ] **Step 5: 改 imageProcessor.ts（收敛现有正确逻辑）**

加 import `import { buildStorageDir } from '~~/server/utils/storagePath'`；确认 `FileSource` 已 import。

把第 83 行删除：

```ts
    const basePath = storageConfig.basePath
```

把第 86 行：

```ts
    const dir = customPath || `${basePath}user${userId}/${FileSource.DOC_EMBEDDED_IMAGE}/`
```

改为：

```ts
    const dir = customPath || buildStorageDir({ scope: 'user', userId, source: FileSource.DOC_EMBEDDED_IMAGE })
```

> `storageConfig` 仍用于 `ossConfig` / `bucket`，保留。

- [ ] **Step 6: 类型检查**

Run: `bun run typecheck`
Expected: 无新增错误。

- [ ] **Step 7: 跑素材模块现有测试**

Run: `npx vitest run tests/server/material tests/server/services/material --reporter=verbose`
Expected: PASS。`mineru.service.ts` / `asr.service.ts` / `mineruResult.service.ts` / `imageProcessor.ts` 改造前**已**调用 `useRuntimeConfig()`，其测试已自带 runtimeConfig 桩，无需补桩。若 `tests/server/services/material/image-processor.test.ts`、`tests/server/material/mineruResult.service.test.ts` 有断言路径前缀的用例，按**该测试文件实际注入的 `storage.basePath` 值**（不要假定为 `test/`，逐文件查其桩）更新后再跑。

- [ ] **Step 8: 提交**

```bash
git add server/services/material/mineru.service.ts server/services/material/asr.service.ts server/services/material/mineruResult.service.ts server/services/material/imageProcessor.ts
git commit -m "fix(storage): 素材模块上传补/收敛环境前缀，ASR 落库补 source 字段"
```

> 若上一步更新了素材测试文件，把对应 test 文件一并 `git add`。

---

## Task 6: 收敛预签名上传（presigned-url .post / .get / temp-upload）

**Files:**
- Modify: `server/api/v1/storage/presigned-url/.post.ts:122-123`
- Modify: `server/api/v1/storage/presigned-url/.get.ts:66,75`
- Modify: `server/api/v1/recognition/audio/temp-upload.post.ts:119`

- [ ] **Step 1: 改 presigned-url/.post.ts**

加 import `import { buildStorageDir } from '~~/server/utils/storagePath'`（`FileSource` 已 import）。

把第 122-123 行：

```ts
        const basePath = storageConfig.basePath
        const dir = `${basePath}user${user.id}/${source}/`
```

改为（删除 `basePath` 行）：

```ts
        const dir = buildStorageDir({ scope: 'user', userId: user.id, source: source as FileSource })
```

> `storageConfig` 仍用于 `ossConfig` / `bucket` / `callbackUrl`，保留。

- [ ] **Step 2: 改 presigned-url/.get.ts**

加 import `import { buildStorageDir } from '~~/server/utils/storagePath'`（`FileSource` 已 import）。

把第 66 行删除：

```ts
        const basePath = storageConfig.basePath
```

把第 75 行：

```ts
        const dir = `${basePath}user${user.id}/${source}/`
```

改为：

```ts
        const dir = buildStorageDir({ scope: 'user', userId: user.id, source })
```

> `.get.ts` 的 `source` 已是 `FileSource` 类型（来自 `z.enum(FileSource)`），无需 `as`。`storageConfig` 仍用于 `ossConfig` / `bucket` / `callbackUrl`，保留。

- [ ] **Step 3: 改 temp-upload.post.ts**

加 import：

```ts
import { buildStorageDir } from '~~/server/utils/storagePath'
import { FileSource } from '#shared/types/file'
```

把第 119 行：

```ts
        const tempDir = `temp/asr/${year}/${month}/${day}/`
```

改为：

```ts
        const tempDir = buildStorageDir({
            scope: 'temp',
            source: FileSource.ASR,
            subDir: `${year}/${month}/${day}`,
        })
```

> 第 120 行 `const tempFilePath = ${tempDir}${tempFileName}` 不变 —— `tempDir` 现已含环境前缀，`tempFilePath` 自动带上。

- [ ] **Step 4: 类型检查**

Run: `bun run typecheck`
Expected: 无新增错误。

- [ ] **Step 5: 跑现有测试**

Run: `npx vitest run tests/server/storage tests/server/recognition --reporter=verbose`
Expected: PASS（关注预签名 / 临时上传相关用例无回归；如有断言 `dir` 的用例按新前缀更新）。

- [ ] **Step 6: 提交**

```bash
git add server/api/v1/storage/presigned-url/.post.ts server/api/v1/storage/presigned-url/.get.ts server/api/v1/recognition/audio/temp-upload.post.ts
git commit -m "fix(storage): 预签名/临时上传收敛到统一路径函数"
```

---

## Task 7: 新建历史文件迁移脚本 migrateOssBasePath

**Files:**
- Create: `server/scripts/migrateOssBasePath.ts`
- Test: `tests/server/scripts/migrateOssBasePath.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `tests/server/scripts/migrateOssBasePath.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { needsMigration, prefixedKey } from '~~/server/scripts/migrateOssBasePath'

describe('migrateOssBasePath 纯函数', () => {
    it('needsMigration: 未带前缀的路径需要迁移', () => {
        expect(needsMigration('global-templates/a.docx', 'dev/')).toBe(true)
        expect(needsMigration('users/5/templates/a.docx', 'test/')).toBe(true)
    })

    it('needsMigration: 已带前缀的路径跳过（幂等）', () => {
        expect(needsMigration('dev/user5/document_template/a.docx', 'dev/')).toBe(false)
    })

    it('needsMigration: filePath 为空跳过', () => {
        expect(needsMigration(null, 'dev/')).toBe(false)
        expect(needsMigration('', 'dev/')).toBe(false)
    })

    it('needsMigration: basePath 为空时不迁移任何行', () => {
        expect(needsMigration('global-templates/a.docx', '')).toBe(false)
    })

    it('prefixedKey: 旧路径前补环境前缀', () => {
        expect(prefixedKey('global-templates/a.docx', 'dev/')).toBe('dev/global-templates/a.docx')
    })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/server/scripts/migrateOssBasePath.test.ts --reporter=verbose`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 写迁移脚本**

创建 `server/scripts/migrateOssBasePath.ts`：

```ts
/**
 * OSS 历史文件环境前缀迁移脚本
 *
 * 把 ossFiles 表中未带环境前缀的历史文件，在 OSS 内复制到 {basePath}{filePath}，
 * 并更新 ossFiles.filePath。按环境各跑一次（用对应环境的 .env）。
 *
 * 用法（用 bun run，bun 会自动加载对应环境的 .env）：
 *   bun run server/scripts/migrateOssBasePath.ts                 # dry-run，仅打印待迁移清单
 *   bun run server/scripts/migrateOssBasePath.ts --execute       # 实际复制 + 改库（源对象保留）
 *   bun run server/scripts/migrateOssBasePath.ts --delete-source # 删除已迁移成功的根目录旧对象
 *
 * 依赖环境变量（bun run 从对应环境 .env 自动加载，或已在 shell 注入）：
 *   - DATABASE_URL
 *   - NUXT_STORAGE_BASE_PATH（环境前缀，如 dev/ test/ prod/）
 *   - NUXT_STORAGE_ALIYUN_OSS_*（OSS 凭证；DB 无存储配置时回退用）
 *   - NUXT_STORAGE_CONFIG_ENCRYPTION_KEY（解密 DB 中存储配置所需；缺失会 fail-fast 报错）
 *
 * 生产环境顺序：dry-run → execute → 人工验证 → delete-source
 */
import { fileURLToPath } from 'node:url'

/** 单批查询条数 */
const BATCH_SIZE = 200
/** 阿里云 CopyObject 单对象上限 1GB，超过需 multipartUploadCopy，本脚本直接跳过告警 */
const MAX_COPY_SIZE = 1024 * 1024 * 1024

/** 迁移脚本只用到 OSS client 的这几个方法（ali-oss 无 .d.ts，按需结构化定义，避免 any） */
interface OssClientLike {
    getObjectMeta(key: string): Promise<{ res: { headers: Record<string, string | undefined> } }>
    copy(target: string, source: string): Promise<unknown>
    delete(key: string): Promise<unknown>
}

/** 该行是否需要迁移：filePath 非空、basePath 非空、且 filePath 未以 basePath 开头 */
export function needsMigration(filePath: string | null, basePath: string): boolean {
    if (!filePath || !basePath) return false
    return !filePath.startsWith(basePath)
}

/** 旧路径补上环境前缀 */
export function prefixedKey(filePath: string, basePath: string): string {
    return `${basePath}${filePath}`
}

/**
 * 取对象大小（字节）。对象不存在（NoSuchKey / 404）返回 null；
 * 其它错误（网络 / 凭证等）向上抛出，由调用方计入 failed，避免把瞬态错误静默当成「不存在」漏迁。
 *
 * 与 server/lib/oss/headFile.ts 行为等价，但 headFile 每次调用内部都 createOssClient 新建 client；
 * 本脚本逐行批量调用、需复用同一 client，故自写此接收 client 的轻量版。
 */
async function getObjectSize(client: OssClientLike, key: string): Promise<number | null> {
    try {
        const meta = await client.getObjectMeta(key)
        return Number(meta.res.headers['content-length'] ?? 0)
    } catch (err: unknown) {
        const e = err as { code?: string; status?: number }
        if (e?.code === 'NoSuchKey' || e?.status === 404) return null
        throw err
    }
}

/** 解析命令行参数 */
function parseArgs(): { execute: boolean; deleteSource: boolean } {
    const argv = process.argv.slice(2)
    return {
        execute: argv.includes('--execute'),
        deleteSource: argv.includes('--delete-source'),
    }
}

async function main() {
    // ---- 脚本引导：独立运行不在 Nitro 运行时，先挂全局依赖再动态 import 服务层 ----
    const { prisma } = await import('../utils/db')
    const { logger: sharedLogger } = await import('../../shared/utils/logger/index')

    const g = globalThis as Record<string, unknown>
    // 显式挂全局 prisma：storageConfig.dao.ts 引用全局 prisma，而 db.ts 仅在
    // NODE_ENV!=='production' 时挂全局；本脚本含生产全环境运行，必须自己挂。
    g.prisma = prisma
    g.logger = sharedLogger
    g.useRuntimeConfig = () => ({
        storage: {
            basePath: process.env.NUXT_STORAGE_BASE_PATH || '',
            callbackUrl: process.env.NUXT_STORAGE_CALLBACK_URL || '',
            defaultType: process.env.NUXT_STORAGE_DEFAULT_TYPE || 'aliyun_oss',
            aliyunOss: {
                accessKeyId: process.env.NUXT_STORAGE_ALIYUN_OSS_ACCESS_KEY_ID || '',
                accessKeySecret: process.env.NUXT_STORAGE_ALIYUN_OSS_ACCESS_KEY_SECRET || '',
                bucket: process.env.NUXT_STORAGE_ALIYUN_OSS_BUCKET || '',
                region: process.env.NUXT_STORAGE_ALIYUN_OSS_REGION || '',
                customDomain: process.env.NUXT_STORAGE_ALIYUN_OSS_CUSTOM_DOMAIN || '',
            },
        },
    })

    // 全局依赖就绪后再动态 import 服务层
    const { StorageProviderType, isAliyunOssConfig } = await import('../lib/storage/types')
    const { getDefaultStorageConfigDao } = await import('../services/storage/storageConfig.dao')
    const { createOssClient } = await import('../lib/oss/client')

    const { execute, deleteSource } = parseArgs()
    const basePath = process.env.NUXT_STORAGE_BASE_PATH || ''
    if (!basePath) {
        sharedLogger.error('未设置 NUXT_STORAGE_BASE_PATH，无环境前缀可迁移，退出')
        process.exit(1)
    }
    const mode = deleteSource ? 'delete-source' : execute ? 'execute' : 'dry-run'
    sharedLogger.info(`OSS 迁移启动 | 环境前缀=${basePath} | 模式=${mode}`)

    // ---- 建一次 OSS client，全程复用 ----
    const storageConfig = await getDefaultStorageConfigDao(StorageProviderType.ALIYUN_OSS)
    if (!storageConfig || !isAliyunOssConfig(storageConfig)) {
        sharedLogger.error('未找到阿里云 OSS 存储配置，退出')
        process.exit(1)
    }
    const { client } = (await createOssClient({
        accessKeyId: storageConfig.accessKeyId,
        accessKeySecret: storageConfig.accessKeySecret,
        bucket: storageConfig.bucket,
        region: storageConfig.region,
        customDomain: storageConfig.customDomain,
        sts: storageConfig.sts,
    })) as { client: OssClientLike }

    let cursor = 0
    let scanned = 0, hit = 0, done = 0, skipped = 0, failed = 0

    for (;;) {
        const rows = await prisma.ossFiles.findMany({
            where: { id: { gt: cursor } },
            orderBy: { id: 'asc' },
            take: BATCH_SIZE,
            select: { id: true, filePath: true },
        })
        if (rows.length === 0) break
        cursor = rows[rows.length - 1]!.id

        for (const row of rows) {
            scanned++
            const filePath = row.filePath

            if (deleteSource) {
                // 删源模式：filePath 已是带前缀的新路径，反推旧路径并删除
                if (!filePath || !filePath.startsWith(basePath)) continue
                const oldKey = filePath.slice(basePath.length)
                if (!oldKey || oldKey === filePath) continue
                try {
                    const oldSize = await getObjectSize(client, oldKey)
                    if (oldSize === null) { skipped++; continue }
                    const newSize = await getObjectSize(client, filePath)
                    if (newSize === null) {
                        sharedLogger.warn(`新对象不存在，保留源对象 id=${row.id} ${filePath}`)
                        skipped++
                        continue
                    }
                    await client.delete(oldKey)
                    done++
                    sharedLogger.info(`已删除源对象 id=${row.id} ${oldKey}`)
                } catch (err) {
                    failed++
                    sharedLogger.error(`删除源对象失败 id=${row.id} ${oldKey}:`, err)
                }
                continue
            }

            // 迁移模式（dry-run / execute）
            if (!needsMigration(filePath, basePath)) continue
            hit++
            const oldKey = filePath as string
            const newKey = prefixedKey(oldKey, basePath)
            try {
                const size = await getObjectSize(client, oldKey)
                if (size === null) {
                    sharedLogger.warn(`源对象不存在，跳过 id=${row.id} ${oldKey}`)
                    skipped++
                    continue
                }
                if (size > MAX_COPY_SIZE) {
                    sharedLogger.warn(`对象 >1GB 跳过（需 multipartUploadCopy）id=${row.id} ${oldKey}`)
                    skipped++
                    continue
                }
                if (!execute) {
                    sharedLogger.info(`[dry-run] 待迁移 id=${row.id}: ${oldKey} -> ${newKey}`)
                    continue
                }
                await client.copy(newKey, oldKey)
                await prisma.ossFiles.update({ where: { id: row.id }, data: { filePath: newKey } })
                done++
                sharedLogger.info(`已迁移 id=${row.id}: ${oldKey} -> ${newKey}`)
            } catch (err) {
                failed++
                sharedLogger.error(`迁移失败 id=${row.id} ${oldKey}:`, err)
            }
        }
    }

    sharedLogger.info(
        `迁移结束 | 模式=${mode} 扫描=${scanned} 命中=${hit} 完成=${done} 跳过=${skipped} 失败=${failed}`,
    )
    await prisma.$disconnect()
}

// 仅当作为脚本直接运行时执行 main（被测试 import 时不执行）
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
    main().catch((err) => {
        console.error('迁移脚本异常:', err)
        process.exit(1)
    })
}
```

> `createOssClient` 入参类型是 `OssConfig`；上面传入的对象字面量字段（`accessKeyId` / `accessKeySecret` / `bucket` / `region` / `customDomain` / `sts`）正是 `OssConfig` 的字段，结构匹配，无需显式 import `OssConfig` 类型。

- [ ] **Step 4: 运行单测确认通过**

Run: `npx vitest run tests/server/scripts/migrateOssBasePath.test.ts --reporter=verbose`
Expected: PASS —— 5 个纯函数用例全绿，且 `main()` 不被执行（脚本被 import 时 `process.argv[1]` ≠ 脚本路径）。

- [ ] **Step 5: 类型检查**

Run: `bun run typecheck`
Expected: 无新增错误。

- [ ] **Step 6: 对开发库做 dry-run 冒烟验证**

Run: `bun run server/scripts/migrateOssBasePath.ts`（用 `bun run`：bun 自动加载 `.env`，含 `DATABASE_URL` / `NUXT_STORAGE_*` / `NUXT_STORAGE_CONFIG_ENCRYPTION_KEY`）
Expected: 打印 `模式=dry-run`，列出开发库 `ossFiles` 中未带 `dev/` 前缀的历史行（`[dry-run] 待迁移 ...`），结束打印统计；**不产生任何 OSS 写入或 DB 更新**。若 `ossFiles` 表为空或全部已带前缀，命中数为 0 也属正常。

- [ ] **Step 7: 提交**

```bash
git add server/scripts/migrateOssBasePath.ts tests/server/scripts/migrateOssBasePath.test.ts
git commit -m "feat(storage): 新增 OSS 历史文件环境前缀迁移脚本"
```

---

## Task 8: 全量校验

**Files:** 无（仅校验）

- [ ] **Step 1: 全量类型检查**

Run: `bun run typecheck`
Expected: 无错误。

- [ ] **Step 2: 全量测试**

Run: `bun run test`
Expected: 全绿。若出现大面积 `database ls_test_wN does not exist` / Timeout，属测试基建在高负载下的环境性假失败，单独重跑可疑文件确认（参见项目记忆「全量测试 worker DB 假失败」）。关注的是无因本次路径改动导致的真实回归。

- [ ] **Step 3: 人工核对验收标准**

对照 spec 第五节逐条确认：
1. 15 处上传全部经统一函数构造路径；
2. 统一函数与受影响测试通过、typecheck 无错；
3. 迁移脚本 dry-run 能正确列出待迁移文件；
4. 新上传的文书模板落在 `{env}/system/document_template/` 或 `{env}/user{id}/document_template/`，不再进 OSS 根目录。

> 受影响的测试断言修正已在 Task 2-6 各自任务内随代码一并提交，此处不再单独提交。

---

## 执行后的运维步骤（不在代码任务内，供执行者知会用户）

代码合并、各环境部署后，按环境各跑一次迁移脚本（顺序：先 dev/test 验证，再 prod）：

```bash
# 每个环境用其自己的 .env（bun run 自动加载；须含 DATABASE_URL / NUXT_STORAGE_* / NUXT_STORAGE_CONFIG_ENCRYPTION_KEY）
bun run server/scripts/migrateOssBasePath.ts                 # 1. dry-run 查清单
bun run server/scripts/migrateOssBasePath.ts --execute       # 2. 复制 + 改库
# 3. 人工抽查若干文件可正常下载
bun run server/scripts/migrateOssBasePath.ts --delete-source # 4. 确认无误后删根目录旧对象
```
