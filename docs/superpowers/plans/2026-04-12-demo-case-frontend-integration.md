# 示范案例前台接入 实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `/dashboard/cases/create` 页面的硬编码示范案例替换为后台 `demoCases` 数据，点击卡片后通过克隆 OSS 文件记录让用户体验与自行上传完全对齐（文本填入 + 文件附件 + 已识别状态），最终走原流程生成普通案件。

**Architecture:** 三层数据改动：① Prisma `demoCases.content` 顶级字段 + `ossFiles` 联合唯一约束（`@@unique`）；② 后端新增 `POST /api/v1/demo-cases/:id/prepare` 端点，克隆 ossFile 行（复活语义）+ 克隆识别记录（`status=2` 过滤、`last_embedding_at=NULL`）；③ Admin FormDialog 改造 + 前端 `example.vue` 重构 + `useCaseCreation` composable 扩展。嵌入向量不克隆，由分析启动时的既有 `ensureMaterialsReadyService` 延迟生成。

**Tech Stack:** Nuxt 4, Vue 3, TypeScript, Prisma 7.2, PostgreSQL 15+, Vitest, Tailwind CSS v4, shadcn-vue

**Spec:** `docs/superpowers/specs/2026-04-11-demo-case-frontend-integration-design.md`

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `prisma/models/case.prisma` | 修改 | `demoCases.content` 新列 |
| `prisma/models/file.prisma` | 修改 | `ossFiles` 联合 `@@unique` 约束 |
| `prisma/migrations/XXXXXX_demo_case_content_and_ossfiles_unique/migration.sql` | 创建 | schema 变更 + 存量数据迁移 |
| `shared/types/file.ts` | 修改 | `FileSource.DEMO_CASE` 枚举 + `FileSourceName` 映射 |
| `shared/utils/file.ts` | 修改 | `getFileSourceAccept` acceptList 加 `DEMO_CASE` |
| `shared/types/case.ts` | 修改 | 新增 `DemoCaseMaterial` / `DemoCaseListItem` / `DemoCasePrepareResponse` 类型 |
| `server/services/case/demoCase.dao.ts` | 修改 | `DemoCaseMaterial` 接口 + `CreateDemoCaseInput`/`UpdateDemoCaseInput` 新增 `content` |
| `server/services/case/demoCase.service.ts` | 修改 | 新增 `ensureSourceFileRecognitionService` / `cloneRecognitionService` / `prepareDemoCaseForUserService` |
| `server/api/v1/demo-cases/prepare/[id].post.ts` | 创建 | prepare 端点 HTTP 层 |
| `server/api/v1/admin/demo-cases/index.post.ts` | 修改 | zod 校验 + `content` + ensureSourceFileRecognition 调用 |
| `server/api/v1/admin/demo-cases/[id].put.ts` | 修改 | 同上 |
| `app/components/admin/demo-cases/MaterialUploader.vue` | 创建 | admin 侧的 OSS 文件上传组件 |
| `app/components/admin/demo-cases/FormDialog.vue` | 修改 | content Textarea + materials 区用 MaterialUploader 替换 |
| `app/pages/admin/demo-cases/index.vue` | 修改 | `loadCaseTypes` 改调 API |
| `app/components/caseAnalysis/example.vue` | 修改 | 删除硬编码 + loading/selectingId props + 空状态隐藏 |
| `app/composables/useCaseCreation.ts` | 修改 | 新增 `demoCases` / `loadDemoCases` / `applyDemoCase` / `handleExampleSelect` / `confirmReplaceExample` |
| `app/pages/dashboard/cases/create.vue` | 修改 | 接入 composable 的 demo case 逻辑 |
| `app/components/case/DemoCaseList.vue` | 删除 | dead code，仍调用废弃端点 |
| `tests/server/case/demoCase.service.test.ts` | 修改 | 扩展测试 |
| `tests/server/case/demoCase.dao.test.ts` | 修改 | 扩展测试 |
| `tests/server/demoCases/prepare.test.ts` | 创建 | API 层测试 |
| `tests/server/admin/demoCaseMaterials.test.ts` | 创建 | admin 校验 + ensureSourceFileRecognition 测试 |
| `tests/app/composables/useCaseCreation.test.ts` | 创建 | 前端 composable 测试 |

## 任务依赖顺序

subagent-driven 执行时按 Task 编号顺序执行。关键依赖：

| Task | 依赖 | 备注 |
|------|------|------|
| 1 | — | Prisma schema 修改 |
| 2 | 1 | 必须先完成 schema 才能 migrate |
| 3 | 2 | DAO 类型更新，依赖 Prisma generate 后的新类型 |
| 4 | — | FileSource 枚举，独立 |
| 5 | — | shared 类型，独立 |
| 6 | 3, 5 | clone 测试需要 DAO 类型与 shared 类型 |
| 7 | 6 | 实现 cloneRecognitionService 前测试应存在 |
| 8 | 3 | admin 测试需要 DAO 新类型 |
| 9 | 8, 3 | ensureSourceFileRecognitionService 实现 |
| 10 | 7 | prepare 测试需要 clone 已实现 |
| 11 | 10, 7, 9 | prepare 实现需要 clone + 测试 |
| 12 | 11 | API 端点需要 service |
| 13 | 9, 11 | Admin API 需要 ensureSourceFileRecognition + DAO 更新 |
| 14 | 4, 5 | MaterialUploader 需要 DEMO_CASE FileSource |
| 15 | 14, 3 | FormDialog 使用 MaterialUploader + 新 DAO 类型 |
| 16 | — | Admin 页面小改，独立 |
| 17 | 5 | example.vue 使用 DemoCaseListItem |
| 18 | 5, 17 | composable 扩展使用 shared 类型 |
| 19 | 18, 17 | create.vue 使用 composable 与新 example |
| 20 | — | 删除 dead code，独立 |
| 21 | 1-20 | 最终端到端验收 |

---

## Task 1: Prisma Schema 变更

**Files:**
- Modify: `prisma/models/case.prisma:208-241`
- Modify: `prisma/models/file.prisma:2-42`

- [ ] **Step 1: 在 `demoCases` 模型中新增 `content` 列**

编辑 `prisma/models/case.prisma`，在 `model demoCases { ... }` 内 `description` 字段之后插入：

```prisma
    /// 示范案例的文本案情描述（点击后填入用户输入框）
    content     String?   @db.Text
```

- [ ] **Step 2: 在 `ossFiles` 模型末尾新增复合唯一约束**

编辑 `prisma/models/file.prisma`，在 `@@map("oss_files")` 之前插入：

```prisma
    // 示范案例克隆场景的去重联合键：同一用户下同一 OSS 对象（bucket+path）只能有一行
    // 显式指定约束名，便于排查 P2002 错误时通过 err.meta.target 识别冲突来源
    @@unique([userId, bucketName, filePath], map: "idx_oss_files_user_bucket_path")
```

- [ ] **Step 3: 生成 Prisma Client**

Run: `bun run prisma:generate`
Expected: `Prisma Client (v7.2.0) generated successfully`

- [ ] **Step 4: 提交 schema 变更**

```bash
git add prisma/models/case.prisma prisma/models/file.prisma
git commit -m "feat(db): demoCases 新增 content 列 + ossFiles 联合唯一约束"
```

---

## Task 2: 生成并手写 migration

**Files:**
- Create: `prisma/migrations/<timestamp>_demo_case_content_and_ossfiles_unique/migration.sql`

- [ ] **Step 1: 生成空 migration 文件**

Run: `bunx prisma migrate dev --create-only --name demo_case_content_and_ossfiles_unique`
Expected: 创建 `prisma/migrations/<timestamp>_demo_case_content_and_ossfiles_unique/migration.sql`，包含 `ALTER TABLE demo_cases ADD COLUMN content` 和 `CREATE UNIQUE INDEX idx_oss_files_user_bucket_path`

- [ ] **Step 2: 在 migration.sql 末尾追加数据迁移 SQL**

编辑刚生成的 `migration.sql`，在自动生成的 DDL 之后追加：

```sql
-- 把存量文本材料搬到 content 列
UPDATE demo_cases
SET content = materials->0->>'content'
WHERE jsonb_array_length(materials) >= 1
  AND materials->0->>'type' = '1'
  AND content IS NULL;

-- materials 仅保留非文本项（当前生产库无文件类材料，执行后应为空数组）
UPDATE demo_cases
SET materials = COALESCE(
  (
    SELECT jsonb_agg(elem)
    FROM jsonb_array_elements(materials) elem
    WHERE elem->>'type' != '1'
  ),
  '[]'::jsonb
);
```

- [ ] **Step 3: 执行 migration**

Run: `bunx prisma migrate dev`
Expected: `All migrations have been successfully applied`

- [ ] **Step 4: 校验数据**

Run: `docker exec postgres-postgres-1 psql -U daixin -d ls_new -c "SELECT id, title, content IS NOT NULL AS has_content, materials FROM demo_cases WHERE deleted_at IS NULL;"`
Expected: id=2 的行 `has_content=t`, `materials='[]'`

- [ ] **Step 5: 同步测试库 schema**

Run: `DATABASE_URL='postgresql://daixin:daixin88@127.0.0.1:5432/ls_new_testing?schema=public' bun run prisma:push --accept-data-loss`
Expected: `Database schema is now in sync with your Prisma schema`

- [ ] **Step 6: 提交 migration**

```bash
git add prisma/migrations/
git commit -m "feat(db): 添加 content 列迁移与存量文本材料搬迁"
```

---

## Task 3: 更新 DAO 层类型定义

**Files:**
- Modify: `server/services/case/demoCase.dao.ts:14-50`

- [ ] **Step 1: 更新 `DemoCaseMaterial` 接口**

编辑 `server/services/case/demoCase.dao.ts`，将现有的 `DemoCaseMaterial` 接口替换为：

```ts
/** 预设文件材料项（文本内容已提升到 demoCases.content 顶级字段） */
export interface DemoCaseMaterial {
    /** 材料名称（展示用） */
    name: string
    /** 材料类型：2-文档，3-图片，4-音频（文本 type=1 已废弃） */
    type: 2 | 3 | 4
    /** admin 上传得到的 ossFile.id */
    sourceOssFileId: number
}
```

- [ ] **Step 2: 更新 `CreateDemoCaseInput` 和 `UpdateDemoCaseInput`**

在同文件中，`CreateDemoCaseInput` 接口添加 `content`：

```ts
export interface CreateDemoCaseInput {
    title: string
    description?: string | null
    content?: string | null
    caseTypeId: number
    materials?: DemoCaseMaterial[]
    coverImage?: string | null
    priority?: number
    status?: number
}
```

同样为 `UpdateDemoCaseInput` 添加 `content?: string | null`。

- [ ] **Step 3: 更新 `createDemoCaseDao` 写入 `content`**

找到 `createDemoCaseDao` 函数，在 `data: { ... }` 对象中加入 `content: data.content ?? null,`。

- [ ] **Step 4: 更新 `updateDemoCaseDao` 写入 `content`**

找到 `updateDemoCaseDao` 函数的 `updateData` 构建逻辑，加入：

```ts
if (data.content !== undefined) updateData.content = data.content
```

- [ ] **Step 5: TypeScript 检查**

Run: `npx nuxi typecheck`
Expected: 不报新错误（原有代码仍引用旧 DemoCaseMaterial 字段处会报错，这是预期的，将在后续 task 修正）

- [ ] **Step 6: 提交**

```bash
git add server/services/case/demoCase.dao.ts
git commit -m "refactor(db): demoCase DAO 接口收紧文件材料 + 加 content 字段"
```

---

## Task 4: 新增 FileSource.DEMO_CASE

**Files:**
- Modify: `shared/types/file.ts:4-29`
- Modify: `shared/utils/file.ts:85-101`

- [ ] **Step 1: 在 `FileSource` 枚举末尾添加 `DEMO_CASE`**

编辑 `shared/types/file.ts`，在 `FileSource` 枚举内添加：

```ts
export enum FileSource {
  // ... 现有 ...
  DEMO_CASE = 'demo_case',
}
```

- [ ] **Step 2: 在 `FileSourceName` 映射中添加对应显示名**

同文件 `FileSourceName` 映射末尾添加：

```ts
[FileSource.DEMO_CASE]: '示范案例',
```

- [ ] **Step 3: 在 `getFileSourceAccept` 的 `acceptList` 中追加 `DEMO_CASE`**

编辑 `shared/utils/file.ts` 的 `getFileSourceAccept` 函数，在 `acceptList` 数组末尾追加（在 `CASE_ANALYSIS` 之后）：

```ts
{
  name: FileSourceName[FileSource.DEMO_CASE],
  accept: mapAccept({ ...ASR_ACCEPT, ...DOC_ACCEPT, ...IMAGE_ACCEPT }),
},
```

- [ ] **Step 4: 类型检查**

Run: `npx nuxi typecheck`
Expected: 不报错

- [ ] **Step 5: 提交**

```bash
git add shared/types/file.ts shared/utils/file.ts
git commit -m "feat(file): 新增 FileSource.DEMO_CASE 上传场景"
```

---

## Task 5: 新增 shared/types/case.ts 类型

**Files:**
- Modify: `shared/types/file.ts`
- Modify: `shared/types/case.ts`

- [ ] **Step 1: 在 `shared/types/file.ts` 中新增 `OssFileDto`**

服务端不能 import `app/store/file.ts`（那是前端 Pinia 边界）。为 API 契约定义一个纯类型 DTO，形状与前端 `OssFileItem` 兼容：

```ts
/** OssFile API 传输对象（client/server 共享） */
export interface OssFileDto {
  id: number
  fileName: string
  fileSize: number
  fileType: string
  source: string
  sourceName: string
  status: number
  statusName: string
  encrypted: boolean
  createdAt: string
}
```

注意：`app/store/file.ts` 中既有的 `OssFileItem` **不动**，它是前端 store 的内部类型；`OssFileDto` 是对外 API 契约。两者字段兼容，前端收到 `OssFileDto` 后可直接当作 `OssFileItem` 使用（TypeScript 结构子类型）。

- [ ] **Step 2: 在 `shared/types/case.ts` 中新增示范案例相关类型**

```ts
import type { OssFileDto } from './file'

/** 示范案例文件材料（与 server DemoCaseMaterial 结构同步，用于前台类型） */
export interface DemoCaseFileMaterial {
  name: string
  type: 2 | 3 | 4
  sourceOssFileId: number
}

/** 示范案例列表项（GET /api/v1/demo-cases 返回） */
export interface DemoCaseListItem {
  id: number
  title: string
  description: string | null
  caseTypeId: number
  caseTypeName: string
  coverImage: string | null
  priority: number
}

/** 示范案例 prepare 响应 */
export interface DemoCasePrepareResponse {
  content: string | null
  files: OssFileDto[]
}
```

- [ ] **Step 3: 类型检查**

Run: `npx nuxi typecheck`
Expected: 不报错

- [ ] **Step 4: 提交**

```bash
git add shared/types/file.ts shared/types/case.ts
git commit -m "feat(types): 新增 OssFileDto 与示范案例前台类型"
```

---

## Task 6: `cloneRecognitionService` 测试先行

**Files:**
- Test: `tests/server/case/demoCase.service.test.ts`

- [ ] **Step 1: 在现有测试文件末尾新增 describe 块**

在 `tests/server/case/demoCase.service.test.ts` 末尾追加：

```ts
describe('cloneRecognitionService', () => {
  let sourceUserId: number
  let targetUserId: number
  let sourceOssFileId: number
  let targetOssFileId: number

  beforeEach(async () => {
    // 创建两个测试用户 + 两个 ossFile（source/target 指向同一 bucket+path）
    const sourceUser = await prisma.users.create({ data: { phone: `src${Date.now()}`, nickname: 'src' } })
    const targetUser = await prisma.users.create({ data: { phone: `tgt${Date.now()}`, nickname: 'tgt' } })
    sourceUserId = sourceUser.id
    targetUserId = targetUser.id

    const source = await prisma.ossFiles.create({
      data: {
        userId: sourceUserId,
        bucketName: 'test-bucket',
        fileName: 'sample.pdf',
        filePath: 'test/sample.pdf',
        fileSize: 1024,
        fileType: 'application/pdf',
        source: 'demo_case',
        status: 1,
      },
    })
    sourceOssFileId = source.id

    const target = await prisma.ossFiles.create({
      data: {
        userId: targetUserId,
        bucketName: 'test-bucket',
        fileName: 'sample.pdf',
        filePath: 'test/sample.pdf',
        fileSize: 1024,
        fileType: 'application/pdf',
        source: 'case_analysis',
        status: 1,
      },
    })
    targetOssFileId = target.id
  })

  afterEach(async () => {
    // 清理测试数据（按外键依赖倒序）
    await prisma.docRecognitionRecords.deleteMany({ where: { userId: { in: [sourceUserId, targetUserId] } } })
    await prisma.imageRecognitionRecords.deleteMany({ where: { userId: { in: [sourceUserId, targetUserId] } } })
    await prisma.asrRecords.deleteMany({ where: { userId: { in: [sourceUserId, targetUserId] } } })
    await prisma.ossFiles.deleteMany({ where: { userId: { in: [sourceUserId, targetUserId] } } })
    await prisma.users.deleteMany({ where: { id: { in: [sourceUserId, targetUserId] } } })
  })

  it('克隆 status=2 的 docRecognitionRecord，last_embedding_at 置 NULL', async () => {
    await prisma.docRecognitionRecords.create({
      data: {
        userId: sourceUserId,
        ossFileId: sourceOssFileId,
        status: 2,
        markdownContent: 'hello',
        htmlContent: '<p>hello</p>',
        summary: '摘要',
        lastEmbeddingAt: new Date(),
      },
    })

    await prisma.$transaction(async (tx) => {
      await cloneRecognitionService({
        tx,
        sourceUserId,
        sourceOssFileId,
        targetUserId,
        targetOssFileId,
      })
    })

    const cloned = await prisma.docRecognitionRecords.findFirst({
      where: { userId: targetUserId, ossFileId: targetOssFileId },
    })
    expect(cloned).not.toBeNull()
    expect(cloned?.markdownContent).toBe('hello')
    expect(cloned?.lastEmbeddingAt).toBeNull()
    expect(cloned?.vectorIds).toEqual([])
  })

  it('跳过 status!=2 的识别记录', async () => {
    await prisma.docRecognitionRecords.create({
      data: {
        userId: sourceUserId,
        ossFileId: sourceOssFileId,
        status: 1,  // PROCESSING
        markdownContent: null,
      },
    })

    await prisma.$transaction(async (tx) => {
      await cloneRecognitionService({
        tx,
        sourceUserId,
        sourceOssFileId,
        targetUserId,
        targetOssFileId,
      })
    })

    const cloned = await prisma.docRecognitionRecords.findFirst({
      where: { userId: targetUserId, ossFileId: targetOssFileId },
    })
    expect(cloned).toBeNull()
  })

  it('克隆 asrRecords 时 asr_tasks_id / json_oss_file_id / temp_file_path 显式为 NULL', async () => {
    await prisma.asrRecords.create({
      data: {
        userId: sourceUserId,
        ossFileId: sourceOssFileId,
        status: 2,
        summary: '对话摘要',
        asrTasksId: 999,           // admin 侧的任务 id（跨用户引用）
        jsonOssFileId: 888,        // admin 侧的 json 文件（跨用户引用）
        tempFilePath: '/tmp/foo',  // admin 侧的临时路径
        lastEmbeddingAt: new Date(),
      },
    })

    await prisma.$transaction(async (tx) => {
      await cloneRecognitionService({
        tx,
        sourceUserId,
        sourceOssFileId,
        targetUserId,
        targetOssFileId,
      })
    })

    const cloned = await prisma.asrRecords.findFirst({
      where: { userId: targetUserId, ossFileId: targetOssFileId },
    })
    expect(cloned).not.toBeNull()
    expect(cloned?.summary).toBe('对话摘要')
    expect(cloned?.asrTasksId).toBeNull()
    expect(cloned?.jsonOssFileId).toBeNull()
    expect(cloned?.tempFilePath).toBeNull()
    expect(cloned?.lastEmbeddingAt).toBeNull()
  })

  it('源文件没有任何识别记录时不抛错', async () => {
    await prisma.$transaction(async (tx) => {
      await cloneRecognitionService({
        tx,
        sourceUserId,
        sourceOssFileId,
        targetUserId,
        targetOssFileId,
      })
    })
    // 只要不抛错就算通过
  })
})
```

文件顶部的 import 增加（如不存在）：
```ts
import { cloneRecognitionService } from '../../../server/services/case/demoCase.service'
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run tests/server/case/demoCase.service.test.ts -t "cloneRecognitionService"`
Expected: 所有新增 it 失败，错误为 `cloneRecognitionService is not a function` 或类似 import 错误

- [ ] **Step 3: 暂不提交**（等实现完成后一起提交）

---

## Task 7: 实现 `cloneRecognitionService`

**Files:**
- Modify: `server/services/case/demoCase.service.ts`

- [ ] **Step 1: 在文件末尾添加 `cloneRecognitionService`**

在 `server/services/case/demoCase.service.ts` 末尾添加：

```ts
import type { Prisma } from '~~/generated/prisma/client'

/** 克隆识别记录的输入参数 */
export interface CloneRecognitionInput {
    tx: Prisma.TransactionClient
    sourceUserId: number
    sourceOssFileId: number
    targetUserId: number
    targetOssFileId: number
}

/**
 * 克隆 admin 源文件的识别记录到用户名下（复用 MinerU/OCR/ASR 结果）
 *
 * 只克隆 status=2 的成功记录。last_embedding_at 显式置 NULL：
 * 因为嵌入向量本身不克隆，由分析启动时的 ensureMaterialsReadyService 延迟生成。
 * 若复制源的 last_embedding_at，batchCheckMaterialEmbeddedService 会误判已嵌入。
 *
 * ASR 记录中 asr_tasks_id / json_oss_file_id / temp_file_path 显式置 NULL，
 * 避免跨用户引用 admin 侧的 ASR 任务 / JSON 文件 / 临时文件路径。
 */
export async function cloneRecognitionService(input: CloneRecognitionInput): Promise<void> {
    const { tx, sourceUserId, sourceOssFileId, targetUserId, targetOssFileId } = input

    // 1. 克隆文档识别
    await tx.$executeRawUnsafe(`
        INSERT INTO doc_recognition_records
          (user_id, oss_file_id, status, html_content, markdown_content,
           keywords, summary, vector_ids, last_embedding_at, last_edit_at,
           created_at, updated_at)
        SELECT $1::int, $2::int, status, html_content, markdown_content,
               keywords, summary, '[]'::jsonb, NULL, last_edit_at,
               now(), now()
        FROM doc_recognition_records
        WHERE user_id = $3::int
          AND oss_file_id = $4::int
          AND status = 2
          AND deleted_at IS NULL
    `, targetUserId, targetOssFileId, sourceUserId, sourceOssFileId)

    // 2. 克隆图片识别
    await tx.$executeRawUnsafe(`
        INSERT INTO image_recognition_records
          (user_id, oss_file_id, status, image_type, html_content, markdown_content,
           keywords, summary, vector_ids, last_embedding_at, last_edit_at,
           created_at, updated_at)
        SELECT $1::int, $2::int, status, image_type, html_content, markdown_content,
               keywords, summary, '[]'::jsonb, NULL, last_edit_at,
               now(), now()
        FROM image_recognition_records
        WHERE user_id = $3::int
          AND oss_file_id = $4::int
          AND status = 2
          AND deleted_at IS NULL
    `, targetUserId, targetOssFileId, sourceUserId, sourceOssFileId)

    // 3. 克隆 ASR 识别（跨用户引用字段显式置 NULL）
    await tx.$executeRawUnsafe(`
        INSERT INTO asr_records
          (user_id, oss_file_id, asr_tasks_id, status, audio_url, audio_duration,
           result, json_oss_file_id, temp_file_path, speakers, keywords, summary,
           vector_ids, last_embedding_at, last_edit_at, created_at, updated_at)
        SELECT $1::int, $2::int,
               NULL,
               status, audio_url, audio_duration,
               result,
               NULL,
               NULL,
               speakers, keywords, summary,
               '[]'::jsonb, NULL, last_edit_at, now(), now()
        FROM asr_records
        WHERE user_id = $3::int
          AND oss_file_id = $4::int
          AND status = 2
          AND deleted_at IS NULL
    `, targetUserId, targetOssFileId, sourceUserId, sourceOssFileId)
}
```

- [ ] **Step 2: 运行测试验证通过**

Run: `npx vitest run tests/server/case/demoCase.service.test.ts -t "cloneRecognitionService"`
Expected: 4 个新 case 全部 PASS

- [ ] **Step 3: 提交**

```bash
git add server/services/case/demoCase.service.ts tests/server/case/demoCase.service.test.ts
git commit -m "feat(case): 新增 cloneRecognitionService，克隆 admin 识别记录到用户命名空间"
```

---

## Task 8: `ensureSourceFileRecognitionService` 测试先行

**Files:**
- Test: `tests/server/admin/demoCaseMaterials.test.ts`

- [ ] **Step 1: 创建测试文件**

`tests/server/admin/demoCaseMaterials.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ensureSourceFileRecognitionService } from '../../../server/services/case/demoCase.service'

// Mock 底层识别服务
vi.mock('../../../server/services/material/mineru.service', () => ({
  convertPdfService: vi.fn().mockResolvedValue({ success: true, task: { taskId: 'mock-task' } }),
}))
vi.mock('../../../server/services/material/ocr.service', () => ({
  createImageConversionService: vi.fn().mockResolvedValue({ success: true }),
}))

describe('ensureSourceFileRecognitionService', () => {
  let adminUserId: number
  let pdfFileId: number

  beforeEach(async () => {
    const admin = await prisma.users.create({ data: { phone: `admin${Date.now()}`, nickname: 'admin' } })
    adminUserId = admin.id
    const pdf = await prisma.ossFiles.create({
      data: {
        userId: adminUserId,
        bucketName: 'test-bucket',
        fileName: 'doc.pdf',
        filePath: `test/${Date.now()}.pdf`,
        fileSize: 100,
        fileType: 'application/pdf',
        source: 'demo_case',
        status: 1,
      },
    })
    pdfFileId = pdf.id
  })

  afterEach(async () => {
    await prisma.docRecognitionRecords.deleteMany({ where: { userId: adminUserId } })
    await prisma.ossFiles.deleteMany({ where: { userId: adminUserId } })
    await prisma.users.deleteMany({ where: { id: adminUserId } })
    vi.clearAllMocks()
  })

  it('三张识别表都无记录时调用底层识别服务', async () => {
    const { convertPdfService } = await import('../../../server/services/material/mineru.service')
    await ensureSourceFileRecognitionService(pdfFileId)
    expect(convertPdfService).toHaveBeenCalledWith(pdfFileId, adminUserId)
  })

  it('已有 docRecognitionRecord 时不调用底层服务', async () => {
    await prisma.docRecognitionRecords.create({
      data: { userId: adminUserId, ossFileId: pdfFileId, status: 1 },
    })
    const { convertPdfService } = await import('../../../server/services/material/mineru.service')
    vi.clearAllMocks()
    await ensureSourceFileRecognitionService(pdfFileId)
    expect(convertPdfService).not.toHaveBeenCalled()
  })

  it('底层服务抛错时不抛出（只记 warn）', async () => {
    const { convertPdfService } = await import('../../../server/services/material/mineru.service')
    vi.mocked(convertPdfService).mockRejectedValueOnce(new Error('boom'))
    await expect(ensureSourceFileRecognitionService(pdfFileId)).resolves.toBeUndefined()
  })

  it('源文件不存在时抛错', async () => {
    await expect(ensureSourceFileRecognitionService(999999999)).rejects.toThrow()
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run tests/server/admin/demoCaseMaterials.test.ts`
Expected: 全部失败（函数未实现）

---

## Task 9: 实现 `ensureSourceFileRecognitionService`

**Files:**
- Modify: `server/services/case/demoCase.service.ts`

**Depends on:** Task 1-3 完成（Prisma client 已重新生成、DAO 类型已更新）。

- [ ] **Step 0: 预先核实现有识别分发依赖**

在写代码之前运行以下命令验证引用项都存在：

```bash
# 验证服务函数签名都是 (ossFileId, userId)
grep -n "export.*convertPdfService\|export.*createImageConversionService\|export.*transcribeAudioService\|export.*readTextFileService\|export.*recognizeDocxService" server/services/material/*.ts

# 验证工具函数
grep -n "export.*detectFileTypeService\|export.*getExtensionFromFileName" server/services/material/fileDetect.service.ts shared/utils/file.ts

# 这些 import 全部在既有 server/api/v1/recognition/start.post.ts 中使用，是本项目的标准分发模式
```

Expected: 全部输出对应的 export 行

- [ ] **Step 1: 在 demoCase.service.ts 末尾添加函数**

```ts
import { detectFileTypeService } from '~~/server/services/material/fileDetect.service'
import { createImageConversionService } from '~~/server/services/material/ocr.service'
import { convertPdfService } from '~~/server/services/material/mineru.service'
import { transcribeAudioService } from '~~/server/services/material/asr.service'
import { readTextFileService } from '~~/server/services/material/textReader.service'
import { recognizeDocxService } from '~~/server/services/material/docxRecognition.service'
import { CaseMaterialType } from '#shared/types/case'
import { getExtensionFromFileName } from '~~/shared/utils/file'

/**
 * 确保示范案例源文件已经被识别过一次（admin save 阶段的引导）
 *
 * 若三张识别表中任一已有记录（无论状态），直接 return；
 * 否则按文件类型分发到对应识别服务触发。
 * 触发失败仅记 warn 日志，不抛错（demoCase 保存不应因识别故障而失败）。
 */
export async function ensureSourceFileRecognitionService(sourceOssFileId: number): Promise<void> {
    const source = await findOssFileByIdDao(sourceOssFileId)
    if (!source || source.deletedAt) {
        throw new Error(`sourceOssFileId=${sourceOssFileId} 不存在或已删除`)
    }

    const [doc, image, asr] = await Promise.all([
        prisma.docRecognitionRecords.findFirst({
            where: { ossFileId: sourceOssFileId, deletedAt: null },
            select: { id: true },
        }),
        prisma.imageRecognitionRecords.findFirst({
            where: { ossFileId: sourceOssFileId, deletedAt: null },
            select: { id: true },
        }),
        prisma.asrRecords.findFirst({
            where: { ossFileId: sourceOssFileId, deletedAt: null },
            select: { id: true },
        }),
    ])

    if (doc || image || asr) {
        return
    }

    const ext = getExtensionFromFileName(source.fileName) || ''
    const fileType = detectFileTypeService(source.fileName)

    try {
        switch (fileType) {
            case CaseMaterialType.IMAGE:
                await createImageConversionService(sourceOssFileId, source.userId)
                break
            case CaseMaterialType.AUDIO:
                await transcribeAudioService(sourceOssFileId, source.userId)
                break
            case CaseMaterialType.DOCUMENT:
                if (ext === 'md' || ext === 'txt') {
                    await readTextFileService(sourceOssFileId, source.userId)
                } else if (ext === 'docx') {
                    await recognizeDocxService(sourceOssFileId, source.userId)
                } else {
                    await convertPdfService(sourceOssFileId, source.userId)
                }
                break
            default:
                await convertPdfService(sourceOssFileId, source.userId)
        }
    } catch (err) {
        logger.warn('ensureSourceFileRecognitionService 触发失败', {
            sourceOssFileId,
            error: err instanceof Error ? err.message : String(err),
        })
    }
}
```

同时需要 import `findOssFileByIdDao`（已存在于 `server/services/files/ossFiles.dao.ts`）。

- [ ] **Step 2: 运行测试验证通过**

Run: `npx vitest run tests/server/admin/demoCaseMaterials.test.ts -t "ensureSourceFileRecognitionService"`
Expected: 4 个 case 全部 PASS

- [ ] **Step 3: 提交**

```bash
git add server/services/case/demoCase.service.ts tests/server/admin/demoCaseMaterials.test.ts
git commit -m "feat(case): 新增 ensureSourceFileRecognitionService，admin save 时引导源文件识别"
```

---

## Task 10: `prepareDemoCaseForUserService` 测试先行

**Files:**
- Test: `tests/server/case/demoCase.service.test.ts`

- [ ] **Step 1: 在现有 describe 块末尾追加新的 describe**

```ts
describe('prepareDemoCaseForUserService', () => {
  let adminUserId: number
  let userUserId: number
  let sourceOssFileId: number
  let demoCaseId: number

  beforeEach(async () => {
    const admin = await prisma.users.create({ data: { phone: `admin${Date.now()}`, nickname: 'admin' } })
    const user = await prisma.users.create({ data: { phone: `user${Date.now() + 1}`, nickname: 'user' } })
    adminUserId = admin.id
    userUserId = user.id

    const source = await prisma.ossFiles.create({
      data: {
        userId: adminUserId,
        bucketName: 'test-bucket',
        fileName: 'sample.pdf',
        filePath: `test/${Date.now()}.pdf`,
        fileSize: 100,
        fileType: 'application/pdf',
        source: 'demo_case',
        status: 1,
      },
    })
    sourceOssFileId = source.id

    // 假设源文件已识别成功
    await prisma.docRecognitionRecords.create({
      data: {
        userId: adminUserId,
        ossFileId: sourceOssFileId,
        status: 2,
        markdownContent: '# Doc content',
      },
    })

    // 创建一个有 content 和 materials 的 demoCase
    const caseType = await prisma.caseTypes.findFirst()
    const demoCase = await prisma.demoCases.create({
      data: {
        title: 'Test demo',
        description: 'test',
        content: '这是示范案情描述',
        caseTypeId: caseType!.id,
        materials: [{ name: '文档', type: 2, sourceOssFileId }] as any,
        status: 1,
      },
    })
    demoCaseId = demoCase.id
  })

  afterEach(async () => {
    await prisma.docRecognitionRecords.deleteMany({ where: { userId: { in: [adminUserId, userUserId] } } })
    await prisma.demoCases.deleteMany({ where: { id: demoCaseId } })
    await prisma.ossFiles.deleteMany({ where: { userId: { in: [adminUserId, userUserId] } } })
    await prisma.users.deleteMany({ where: { id: { in: [adminUserId, userUserId] } } })
  })

  it('首次克隆：返回 content + files，克隆 ossFile 与识别记录', async () => {
    const result = await prepareDemoCaseForUserService(demoCaseId, { id: userUserId })
    expect(result.content).toBe('这是示范案情描述')
    expect(result.files).toHaveLength(1)
    expect(result.files[0]?.fileName).toBe('sample.pdf')

    // 验证克隆产生的 ossFile 行
    const clones = await prisma.ossFiles.findMany({
      where: { userId: userUserId, deletedAt: null },
    })
    expect(clones).toHaveLength(1)
    expect(clones[0]?.filePath).toBe((await prisma.ossFiles.findUnique({ where: { id: sourceOssFileId } }))!.filePath)

    // 验证识别记录克隆（status=2 + last_embedding_at=NULL）
    const recRecords = await prisma.docRecognitionRecords.findMany({
      where: { userId: userUserId },
    })
    expect(recRecords).toHaveLength(1)
    expect(recRecords[0]?.lastEmbeddingAt).toBeNull()
  })

  it('再次调用：复用同一 ossFileId，不重复克隆识别记录', async () => {
    const r1 = await prepareDemoCaseForUserService(demoCaseId, { id: userUserId })
    const r2 = await prepareDemoCaseForUserService(demoCaseId, { id: userUserId })
    expect(r1.files[0]?.id).toBe(r2.files[0]?.id)

    const clones = await prisma.ossFiles.findMany({ where: { userId: userUserId, deletedAt: null } })
    expect(clones).toHaveLength(1)

    const recRecords = await prisma.docRecognitionRecords.findMany({ where: { userId: userUserId } })
    expect(recRecords).toHaveLength(1)
  })

  it('资源复活：软删后再次调用将 deletedAt 翻回 null', async () => {
    const r1 = await prepareDemoCaseForUserService(demoCaseId, { id: userUserId })
    const clonedId = r1.files[0]!.id
    // 软删
    await prisma.ossFiles.update({ where: { id: clonedId }, data: { deletedAt: new Date() } })
    // 再点
    const r2 = await prepareDemoCaseForUserService(demoCaseId, { id: userUserId })
    expect(r2.files[0]?.id).toBe(clonedId)
    const clones = await prisma.ossFiles.findMany({ where: { userId: userUserId } })
    expect(clones).toHaveLength(1)
    expect(clones[0]?.deletedAt).toBeNull()
  })

  it('demoCase 不存在时抛错', async () => {
    await expect(prepareDemoCaseForUserService(999999, { id: userUserId }))
      .rejects.toThrow()
  })

  it('demoCase 禁用时抛错', async () => {
    await prisma.demoCases.update({ where: { id: demoCaseId }, data: { status: 0 } })
    await expect(prepareDemoCaseForUserService(demoCaseId, { id: userUserId }))
      .rejects.toThrow()
  })

  it('源文件已软删时抛错', async () => {
    await prisma.ossFiles.update({ where: { id: sourceOssFileId }, data: { deletedAt: new Date() } })
    await expect(prepareDemoCaseForUserService(demoCaseId, { id: userUserId }))
      .rejects.toThrow()
  })
})
```

同时在 import 添加：
```ts
import { prepareDemoCaseForUserService } from '../../../server/services/case/demoCase.service'
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run tests/server/case/demoCase.service.test.ts -t "prepareDemoCaseForUserService"`
Expected: 全部失败（函数未实现）

---

## Task 11: 实现 `prepareDemoCaseForUserService`

**Files:**
- Modify: `server/services/case/demoCase.service.ts`

- [ ] **Step 1: 添加辅助类型和主函数**

在 `server/services/case/demoCase.service.ts` 末尾添加：

```ts
import { FileSource } from '#shared/types/file'
import type { OssFileDto } from '#shared/types/file'
import { FileSourceName } from '#shared/types/file'

/** 将 Prisma ossFile 行转成 API 契约的 OssFileDto */
function toOssFileDto(file: {
    id: number
    fileName: string
    fileSize: any
    fileType: string
    source: string | null
    status: number
    encrypted: boolean
    createdAt: Date | null
}): OssFileDto {
    const source = (file.source ?? FileSource.CASE_ANALYSIS) as string
    return {
        id: file.id,
        fileName: file.fileName,
        fileSize: Number(file.fileSize),
        fileType: file.fileType,
        source,
        sourceName: FileSourceName[source as FileSource] ?? '文件',
        status: file.status,
        statusName: file.status === 1 ? '正常' : '异常',
        encrypted: file.encrypted,
        createdAt: file.createdAt?.toISOString() ?? new Date().toISOString(),
    }
}

/**
 * 准备示范案例：克隆 OSS 文件与识别记录到当前用户
 *
 * 对文件材料遍历：
 * - 若用户已有同 (bucket, filePath) 行（含软删），复用或复活
 * - 否则新建 ossFile 行 + 克隆识别记录（status=2 过滤）
 *
 * P2002 并发冲突由前端 toast 提示用户重试，事务级不做自动重试。
 */
export async function prepareDemoCaseForUserService(
    demoCaseId: number,
    user: { id: number },
): Promise<{ content: string | null; files: OssFileDto[] }> {
    return await prisma.$transaction(
        async (tx) => {
            const demoCase = await tx.demoCases.findFirst({
                where: { id: demoCaseId, deletedAt: null },
            })
            if (!demoCase) {
                throw createError({ statusCode: 404, message: '示范案例不存在' })
            }
            if (demoCase.status !== 1) {
                throw createError({ statusCode: 400, message: '示范案例已禁用' })
            }

            const materials = ((demoCase.materials ?? []) as unknown) as import('./demoCase.dao').DemoCaseMaterial[]
            const result: OssFileDto[] = []

            for (const material of materials) {
                // 1. 读取 admin 源 ossFile
                const source = await tx.ossFiles.findUnique({
                    where: { id: material.sourceOssFileId },
                })
                if (!source || source.deletedAt) {
                    throw createError({ statusCode: 500, message: '示范案例资源异常' })
                }

                if (!source.filePath) {
                    logger.error('demo case source ossFile filePath is null', {
                        ossFileId: source.id,
                    })
                    continue
                }

                // 2. 查用户云盘（不过滤 deletedAt，以便复活）
                const existing = await tx.ossFiles.findFirst({
                    where: {
                        userId: user.id,
                        bucketName: source.bucketName,
                        filePath: source.filePath,
                    },
                })

                if (existing) {
                    if (existing.deletedAt !== null) {
                        // 复活
                        const revived = await tx.ossFiles.update({
                            where: { id: existing.id },
                            data: { deletedAt: null, updatedAt: new Date() },
                        })
                        result.push(toOssFileDto(revived))
                    } else {
                        result.push(toOssFileDto(existing))
                    }
                    continue
                }

                // 3. 未命中：创建新 ossFile 行
                const clone = await tx.ossFiles.create({
                    data: {
                        userId: user.id,
                        bucketName: source.bucketName,
                        fileName: source.fileName,
                        filePath: source.filePath,
                        fileSize: source.fileSize,
                        fileType: source.fileType,
                        source: FileSource.CASE_ANALYSIS,
                        status: source.status,
                    },
                })

                // 4. 克隆识别记录（不克隆嵌入向量，由分析启动时延迟生成）
                await cloneRecognitionService({
                    tx,
                    sourceUserId: source.userId,
                    sourceOssFileId: source.id,
                    targetUserId: user.id,
                    targetOssFileId: clone.id,
                })

                result.push(toOssFileDto(clone))
            }

            return {
                content: demoCase.content,
                files: result,
            }
        },
        { timeout: 30_000, maxWait: 5_000 },
    )
}
```

- [ ] **Step 2: 运行测试验证通过**

Run: `npx vitest run tests/server/case/demoCase.service.test.ts -t "prepareDemoCaseForUserService"`
Expected: 6 个 case 全部 PASS

- [ ] **Step 3: 提交**

```bash
git add server/services/case/demoCase.service.ts tests/server/case/demoCase.service.test.ts
git commit -m "feat(case): 新增 prepareDemoCaseForUserService 克隆流程与资源复活"
```

---

## Task 12: `POST /api/v1/demo-cases/:id/prepare` 端点

**Files:**
- Create: `server/api/v1/demo-cases/prepare/[id].post.ts`
- Create: `tests/server/demoCases/prepare.test.ts`

- [ ] **Step 1: 创建 API 层测试**

`tests/server/demoCases/prepare.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { $fetch } from '@nuxt/test-utils/e2e'
import { setup } from '@nuxt/test-utils/e2e'

await setup({})

describe('POST /api/v1/demo-cases/:id/prepare', () => {
  it('未登录返回 401', async () => {
    const res = await $fetch('/api/v1/demo-cases/prepare/1', {
      method: 'POST',
    }).catch(e => e.data)
    expect(res?.code).toBe(401)
  })

  // 其余 case 在实施阶段按需补充（404/400/200）
  // 项目既有的 e2e 登录 fixture 可复用
})
```

- [ ] **Step 2: 创建端点文件**

`server/api/v1/demo-cases/prepare/[id].post.ts`:

```ts
/**
 * 准备示范案例（点击即用）
 *
 * POST /api/v1/demo-cases/prepare/:id
 *
 * 克隆示范案例的文件材料到当前用户云盘（含识别记录克隆 + 资源复活）。
 * 嵌入向量不克隆，由分析启动时 ensureMaterialsReadyService 自动补齐。
 */

import { z } from 'zod'
import { prepareDemoCaseForUserService } from '~~/server/services/case/demoCase.service'

const paramsSchema = z.object({
    id: z.coerce.number().int().positive(),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    const params = getRouterParams(event)
    const parsed = paramsSchema.safeParse(params)
    if (!parsed.success) {
        return resError(event, 400, '参数错误：' + parsed.error.issues[0]!.message)
    }

    try {
        const data = await prepareDemoCaseForUserService(parsed.data.id, { id: user.id })
        return resSuccess(event, '准备示范案例成功', data)
    } catch (error: any) {
        if (error?.statusCode) {
            return resError(event, error.statusCode, error.message || '准备示范案例失败')
        }
        logger.error('准备示范案例失败：', error)
        return resError(event, 500, '准备示范案例失败')
    }
})
```

- [ ] **Step 3: 运行测试验证**

Run: `npx vitest run tests/server/demoCases/prepare.test.ts`
Expected: 401 case PASS

- [ ] **Step 4: 提交**

```bash
git add server/api/v1/demo-cases/prepare/ tests/server/demoCases/
git commit -m "feat(api): 新增 POST /api/v1/demo-cases/prepare/:id 端点"
```

---

## Task 13: 更新 Admin API（POST / PUT demo-cases）

**Files:**
- Modify: `server/api/v1/admin/demo-cases/index.post.ts`
- Modify: `server/api/v1/admin/demo-cases/[id].put.ts`
- Test: `tests/server/admin/demoCaseMaterials.test.ts`

- [ ] **Step 1: 读取现有 POST 端点理解结构**

Run: `cat server/api/v1/admin/demo-cases/index.post.ts`
找到现有的 zod schema 定义与 handler 主体。

- [ ] **Step 2: 更新 zod schema**

在 `index.post.ts` 和 `[id].put.ts` 中保留原有 `title` / `description` / `caseTypeId` / `coverImage` / `priority` / `status` 字段的校验，**只替换原来的 `materials` 字段定义并新增 `content` 字段**：

**删除**：原来的 `materials` 字段（旧结构 `{ name, type, content?, fileUrl? }`）

**新增 / 替换为**：

```ts
// 位于 z.object({ ... }) 内部，保持其他字段不变
content: z.string().nullable().optional(),
materials: z.array(z.object({
    name: z.string().min(1),
    type: z.union([z.literal(2), z.literal(3), z.literal(4)]),
    sourceOssFileId: z.number().int().positive(),
})).default([]),
```

- [ ] **Step 3: 在 handler 中加入 content 与 materials 双重为空校验**

在参数解析后、数据库写入前加：

```ts
const hasContent = !!data.content?.trim()
const hasMaterials = data.materials.length > 0
if (!hasContent && !hasMaterials) {
    return resError(event, 400, '请至少填写案件描述或上传一个文件材料')
}
```

- [ ] **Step 4: 校验每个 sourceOssFileId 存在性**

```ts
for (const m of data.materials) {
    const source = await findOssFileByIdDao(m.sourceOssFileId)
    if (!source || source.deletedAt) {
        return resError(event, 400, `材料 "${m.name}" 的源文件不存在或已删除`)
    }
}
```

- [ ] **Step 5: 调用 `ensureSourceFileRecognitionService` 引导识别**

在写入 `demoCases` 之前对每个 material 顺序调用：

```ts
for (const m of data.materials) {
    await ensureSourceFileRecognitionService(m.sourceOssFileId)
}
```

注意：顺序调用而非并行，避免识别服务并发触发时的资源争用。

- [ ] **Step 6: 写入时传入 `content`**

确保 `createDemoCaseService` / `updateDemoCaseService` 调用处传入 `content: data.content ?? null`。

- [ ] **Step 7: 补 admin 校验测试**

在 `tests/server/admin/demoCaseMaterials.test.ts` 末尾追加 admin zod 校验的 describe 块（测试 type=1 拒绝、sourceOssFileId 必填、content 与 materials 都空拒绝）。可使用 service 层直接测试 zod schema，或 HTTP 层测试（选项视现有测试风格而定）。

- [ ] **Step 8: 运行测试**

Run: `npx vitest run tests/server/admin/demoCaseMaterials.test.ts`
Expected: 全部 PASS

- [ ] **Step 9: 提交**

```bash
git add server/api/v1/admin/demo-cases/ tests/server/admin/demoCaseMaterials.test.ts
git commit -m "feat(admin): demo-case API 接受 content 字段并引导源文件识别"
```

---

## Task 14: Admin MaterialUploader 组件

**Files:**
- Create: `app/components/admin/demo-cases/MaterialUploader.vue`

- [ ] **Step 1: 参考 `AiPromptInput.vue` 的 `handleFileDrop` / `handleFilesSelected` 实现**

先读 `app/components/ai/AiPromptInput.vue:324-627` 理解现有上传管道。

- [ ] **Step 2: 创建组件骨架**

`app/components/admin/demo-cases/MaterialUploader.vue`:

```vue
<template>
  <div class="space-y-2">
    <div class="flex items-center justify-between">
      <Label>预设文件材料</Label>
      <Button variant="outline" size="sm" @click="fileInputRef?.click()" :disabled="uploading">
        <Plus class="h-4 w-4 mr-1" />
        添加文件
      </Button>
      <input ref="fileInputRef" type="file" multiple class="hidden" @change="onFilePick" />
    </div>

    <div v-if="modelValue.length === 0 && uploadingFiles.length === 0"
      class="text-sm text-muted-foreground py-4 text-center border rounded-md">
      暂无预设材料，点击上方按钮添加
    </div>

    <div v-else class="space-y-2">
      <div v-for="(material, idx) in modelValue" :key="material.sourceOssFileId"
        class="flex items-center gap-2 p-2 border rounded-md">
        <FileIcon class="h-4 w-4" />
        <span class="flex-1 truncate text-sm">{{ material.name }}</span>
        <Badge :variant="getBadgeVariant(recognitionStatus.get(material.sourceOssFileId))">
          {{ getBadgeLabel(recognitionStatus.get(material.sourceOssFileId)) }}
        </Badge>
        <Button variant="ghost" size="icon" @click="removeMaterial(idx)">
          <X class="h-4 w-4" />
        </Button>
      </div>

      <div v-for="f in uploadingFiles" :key="f.id"
        class="flex items-center gap-2 p-2 border rounded-md bg-muted/30">
        <Loader2 class="h-4 w-4 animate-spin" />
        <span class="flex-1 truncate text-sm">{{ f.file.name }}</span>
        <span class="text-xs">{{ f.progress }}%</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Plus, X, FileIcon, Loader2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { FileSource } from '#shared/types/file'
import type { DemoCaseFileMaterial } from '#shared/types/case'

const modelValue = defineModel<DemoCaseFileMaterial[]>({ required: true })

const fileInputRef = ref<HTMLInputElement | null>(null)
const uploadingFiles = ref<Array<{ id: string; file: File; progress: number }>>([])
const recognitionStatus = ref<Map<number, 'recognizing' | 'success' | 'error' | null>>(new Map())
const uploading = computed(() => uploadingFiles.value.length > 0)

const fileStore = useFileStore()
const { detectMimeType, validateFile, uploadToOSS } = useBatchUpload()

async function onFilePick(event: Event) {
  const input = event.target as HTMLInputElement
  const files = input.files ? Array.from(input.files) : []
  input.value = ''
  if (files.length === 0) return

  const scenes = await fileStore.getUploadConfig(FileSource.DEMO_CASE)
  const currentScene = scenes?.[0] ?? null

  for (const file of files) {
    const v = validateFile(file, currentScene)
    if (!v.valid) {
      toast.error(`文件 "${file.name}" ${v.message}`)
      continue
    }
    const id = `upload_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
    const state = { id, file, progress: 0 }
    uploadingFiles.value.push(state)

    try {
      const signatures = await fileStore.getBatchPresignedUrls({
        source: FileSource.DEMO_CASE,
        files: [{ originalFileName: file.name, fileSize: file.size, mimeType: detectMimeType(file) }],
        encrypted: false,
      })
      const signature = signatures?.[0]
      if (!signature) throw new Error('获取签名失败')

      const data = await uploadToOSS(file, signature, p => { state.progress = p })
      const ossFileId = (data.fileId || data.id) as number

      // 追加到 modelValue
      const mat: DemoCaseFileMaterial = {
        name: file.name,
        type: inferTypeFromMime(detectMimeType(file)),
        sourceOssFileId: ossFileId,
      }
      modelValue.value = [...modelValue.value, mat]

      // 触发识别
      recognitionStatus.value.set(ossFileId, 'recognizing')
      const result = await useApiFetch<{ results: Array<{ ossFileId: number; status: string }> }>(
        '/api/v1/recognition/start',
        { method: 'POST', body: { ossFileIds: [ossFileId] }, showError: false },
      )
      if (result?.results?.[0]) {
        const s = result.results[0].status
        recognitionStatus.value.set(ossFileId,
          s === 'completed' ? 'success' : s === 'failed' ? 'error' : 'recognizing')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '上传失败')
    } finally {
      uploadingFiles.value = uploadingFiles.value.filter(f => f.id !== id)
    }
  }
}

function inferTypeFromMime(mime: string): 2 | 3 | 4 {
  if (mime.startsWith('image/')) return 3
  if (mime.startsWith('audio/')) return 4
  return 2
}

function removeMaterial(idx: number) {
  const mat = modelValue.value[idx]
  if (!mat) return
  modelValue.value = modelValue.value.filter((_, i) => i !== idx)
  recognitionStatus.value.delete(mat.sourceOssFileId)
}

function getBadgeVariant(s: 'recognizing' | 'success' | 'error' | null | undefined) {
  if (s === 'success') return 'default' as const
  if (s === 'error') return 'destructive' as const
  return 'secondary' as const
}
function getBadgeLabel(s: 'recognizing' | 'success' | 'error' | null | undefined) {
  if (s === 'success') return '已识别'
  if (s === 'error') return '识别失败'
  if (s === 'recognizing') return '识别中'
  return '未识别'
}

// openEdit 时回显识别状态：对 modelValue 中每个 sourceOssFileId 查询当前状态
async function refreshRecognitionStatus() {
  for (const mat of modelValue.value) {
    try {
      const r = await useApiFetch<{ recognized: boolean; status: number }>(
        `/api/v1/recognition/status/${mat.sourceOssFileId}`,
        { showError: false },
      )
      if (r) {
        recognitionStatus.value.set(
          mat.sourceOssFileId,
          r.recognized ? 'success' : r.status === 3 ? 'error' : 'recognizing',
        )
      }
    } catch { /* 忽略 */ }
  }
}

watch(modelValue, refreshRecognitionStatus, { immediate: true })
</script>
```

- [ ] **Step 3: 类型检查**

Run: `npx nuxi typecheck`
Expected: 不报新错误（若 DemoCaseFileMaterial 未导出需要先完成 Task 5）

- [ ] **Step 4: 提交**

```bash
git add app/components/admin/demo-cases/MaterialUploader.vue
git commit -m "feat(admin): 新增 demo-case MaterialUploader 组件"
```

---

## Task 15: 重构 Admin FormDialog

**Files:**
- Modify: `app/components/admin/demo-cases/FormDialog.vue`

- [ ] **Step 1: 读现有 FormDialog**

Run: `cat app/components/admin/demo-cases/FormDialog.vue | head -200`
理解现有结构。

- [ ] **Step 2: 删除旧的"预设材料"手写区域，改用 MaterialUploader**

在 `<template>` 中定位到 `<!-- 预设材料 -->` 段落，完整替换为：

```vue
<!-- 案件描述 -->
<div class="space-y-2">
  <Label>案件描述</Label>
  <Textarea v-model="form.content" placeholder="点击示范案例时填入用户输入框的案情描述" rows="6" />
</div>

<!-- 预设文件材料 -->
<AdminDemoCasesMaterialUploader v-model="form.materials" />
```

- [ ] **Step 3: 更新 `form` reactive 对象与类型**

将 `materials` 项类型从旧的 `DemoCaseMaterial`（含 type:string/content/fileUrl）改为 `DemoCaseFileMaterial[]`，新增 `content: string` 字段。

- [ ] **Step 4: 更新 `getDefaultForm`、`openEdit`、`handleSubmit`**

- `getDefaultForm` 返回包含 `content: ''` 和 `materials: [] as DemoCaseFileMaterial[]`
- `openEdit` 时从 `item.content` 和 `item.materials` 填充，**对 materials 做防御性过滤**：只保留 `type ∈ [2,3,4]` 且 `sourceOssFileId` 为正整数的项，跳过旧 schema 残留的 type=1 文本项（虽然 Task 2 migration 已处理存量，但防御性过滤保证测试环境或未迁移数据不会污染）：

```ts
const materials = Array.isArray(item.materials)
  ? (item.materials as any[]).filter(m =>
      m && typeof m.sourceOssFileId === 'number' && [2, 3, 4].includes(m.type))
  : []
```

- `handleSubmit` 的 body 增加 `content: form.value.content || null`，`materials` 直接传 `form.value.materials`（已是新格式）

- [ ] **Step 5: 手动冒烟测试（如果可用）**

启动 dev server，打开 `/admin/demo-cases`，新建一个示范案例，上传一张图片，检查：
- content 能保存
- 图片上传后识别徽章从 "识别中" 变成 "已识别"
- 保存后重新打开编辑对话框，能看到已上传的文件

- [ ] **Step 6: 提交**

```bash
git add app/components/admin/demo-cases/FormDialog.vue
git commit -m "refactor(admin): demo-case FormDialog 使用 MaterialUploader + content 顶级字段"
```

---

## Task 16: Admin 页面 loadCaseTypes 改调 API

**Files:**
- Modify: `app/pages/admin/demo-cases/index.vue:208-219`

- [ ] **Step 1: 替换硬编码 mock**

将 `loadCaseTypes` 函数替换为：

```ts
const loadCaseTypes = async () => {
  const data = await useApiFetch<{ items: CaseType[] }>('/api/v1/case-types')
  caseTypes.value = data?.items ?? []
}
```

- [ ] **Step 2: 提交**

```bash
git add app/pages/admin/demo-cases/index.vue
git commit -m "fix(admin): demo-cases 页 caseTypes 改为调用 API 而非硬编码 mock"
```

---

## Task 17: `example.vue` 重构

**Files:**
- Modify: `app/components/caseAnalysis/example.vue`

- [ ] **Step 1: 完整重写文件**

```vue
<template>
  <div v-if="loading || examples.length > 0">
    <div class="p-4">
      <div class="text-base font-bold text-muted-foreground">{{ title }}</div>

      <div class="grid gap-4 mt-2 grid-cols-1 sm:grid-cols-2">
        <template v-if="loading">
          <Skeleton v-for="i in 2" :key="`sk-${i}`" class="h-20 w-full rounded-md" />
        </template>
        <template v-else>
          <Card v-for="example in examples" :key="example.id"
            :class="[
              'p-4 shadow-none rounded-md relative transition-all duration-300',
              selectingId === example.id
                ? 'pointer-events-none opacity-60'
                : 'hover:ring-1 hover:ring-primary hover:bg-primary/2 cursor-pointer',
            ]"
            @click="emit('select', example)">
            <Loader2Icon v-if="selectingId === example.id"
              class="absolute right-3 top-3 size-4 animate-spin text-primary" />
            <CardHeader class="p-0">
              <CardTitle class="line-clamp-1 text-sm font-bold">{{ example.title }}</CardTitle>
              <CardDescription class="line-clamp-2">{{ example.description }}</CardDescription>
            </CardHeader>
          </Card>
        </template>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { Loader2Icon } from 'lucide-vue-next'
import type { DemoCaseListItem } from '#shared/types/case'

/** 向后兼容的导出类型别名 */
export type ExampleItem = DemoCaseListItem

withDefaults(defineProps<{
  examples: DemoCaseListItem[]
  title?: string
  loading?: boolean
  selectingId?: number | null
}>(), {
  title: '✨ 或者点击下方案例快速体验',
  loading: false,
  selectingId: null,
})

const emit = defineEmits<{
  select: [example: DemoCaseListItem]
}>()
</script>
```

- [ ] **Step 2: 类型检查**

Run: `npx nuxi typecheck`
Expected: 不报新错误

- [ ] **Step 3: 提交**

```bash
git add app/components/caseAnalysis/example.vue
git commit -m "refactor(ui): caseAnalysis example 去除硬编码，支持 loading 与空状态"
```

---

## Task 18: 扩展 `useCaseCreation` composable

**Files:**
- Modify: `app/composables/useCaseCreation.ts`
- Test: `tests/app/composables/useCaseCreation.test.ts`

- [ ] **Step 1: 先写 composable 测试**

`tests/app/composables/useCaseCreation.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
// ... （按项目现有前端测试风格，mock useApiFetch 后测试 useCaseCreation 的新方法）
// 具体 mock 方式参考 tests/app 目录下的现有测试

describe('useCaseCreation demo case 扩展', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('loadDemoCases 成功后 demoCases 填充', async () => {
    // mock useApiFetch 返回 { items: [...] }
    // const { demoCases, loadDemoCases } = useCaseCreation()
    // await loadDemoCases()
    // expect(demoCases.value).toHaveLength(2)
  })

  it('loadDemoCases 失败时 demoCases 保持空数组', async () => {
    // mock useApiFetch 返回 null
  })

  it('applyDemoCase 成功时 setText + addFiles', async () => {
    // mock prepare 返回 content + files
    // 验证 promptInputRef 的 setText / addFiles 被调用
  })

  it('handleExampleSelect 有内容时弹出替换确认', async () => {
    // mock promptInputRef.hasContent() 返回 true
    // 验证 showReplaceConfirm 被置为 true
  })
})
```

注：具体实现依赖项目现有前端测试 mock 基础设施。若项目尚无 app/composables 测试先例，可只写 describe 结构 + skip 标记，手工验证。

- [ ] **Step 2: 在 `useCaseCreation.ts` 中扩展**

首先把 `useCaseCreation` 函数签名改为接受可选的 `promptInputRef` 参数：

```ts
interface PromptInputController {
  setText: (v: string) => void
  addFiles: (files: OssFileDto[]) => void
  reset: () => void
  hasContent: () => boolean
}

export function useCaseCreation(
  promptInputRef?: Ref<PromptInputController | null>
) {
  // 原有 state ...
}
```

然后在 `useCaseCreation` 函数体内、`return {}` 之前新增：

```ts
import type { DemoCaseListItem, DemoCasePrepareResponse } from '#shared/types/case'
import type { OssFileDto } from '#shared/types/file'

const demoCases = ref<DemoCaseListItem[]>([])
const demoCasesLoading = ref(true)
const preparingDemoCaseId = ref<number | null>(null)
const showReplaceConfirm = ref(false)
const pendingExample = ref<DemoCaseListItem | null>(null)

async function loadDemoCases() {
  demoCasesLoading.value = true
  try {
    const data = await useApiFetch<{ items: DemoCaseListItem[] }>('/api/v1/demo-cases')
    demoCases.value = data?.items ?? []
  } finally {
    demoCasesLoading.value = false
  }
}

async function fetchAndFillDemoCase(example: DemoCaseListItem): Promise<boolean> {
  const data = await useApiFetch<DemoCasePrepareResponse>(
    `/api/v1/demo-cases/prepare/${example.id}`,
    { method: 'POST' },
  )
  if (!data) return false  // useApiFetch 已吐 toast
  if (data.content) promptInputRef?.value?.setText(data.content)
  if (data.files?.length) promptInputRef?.value?.addFiles(data.files)
  return true
}

async function applyDemoCase(example: DemoCaseListItem) {
  if (preparingDemoCaseId.value !== null) return
  preparingDemoCaseId.value = example.id
  try {
    await fetchAndFillDemoCase(example)
  } finally {
    preparingDemoCaseId.value = null
  }
}

async function handleExampleSelect(example: DemoCaseListItem) {
  if (promptInputRef?.value?.hasContent()) {
    pendingExample.value = example
    showReplaceConfirm.value = true
    return
  }
  await applyDemoCase(example)
}

async function confirmReplaceExample() {
  const example = pendingExample.value
  if (!example) return
  preparingDemoCaseId.value = example.id
  try {
    // 先请求 prepare，成功后再清空输入框，避免失败时内容丢失
    const data = await useApiFetch<DemoCasePrepareResponse>(
      `/api/v1/demo-cases/prepare/${example.id}`,
      { method: 'POST' },
    )
    if (!data) return  // useApiFetch 失败 toast，保留原输入
    promptInputRef?.value?.reset()
    await nextTick()
    if (data.content) promptInputRef.value?.setText(data.content)
    if (data.files?.length) promptInputRef.value?.addFiles(data.files)
  } finally {
    preparingDemoCaseId.value = null
    pendingExample.value = null
    showReplaceConfirm.value = false
  }
}
```

然后在 `return { ... }` 中**显式**列出新增字段（不要依赖批量扩散）：

```ts
return {
  // 原有字段 ...
  step,
  isSubmitting,
  isExtracting,
  caseTypes,
  extractedFormData,
  rawExtractedInfo,
  uploadedFiles,
  loadCaseTypes,
  createCase,
  extractCaseInfo,
  // demo case 扩展
  demoCases,
  demoCasesLoading,
  preparingDemoCaseId,
  showReplaceConfirm,
  pendingExample,
  loadDemoCases,
  handleExampleSelect,
  confirmReplaceExample,
  applyDemoCase,
}
```

注意：不再把 `promptInputRef` 挂在 composable 内部 ref 上，改为由调用方在 `useCaseCreation(promptInputRef)` 的参数里传入，避免同一页面多次调用时互相覆盖。

- [ ] **Step 3: 类型检查**

Run: `npx nuxi typecheck`
Expected: 不报错

- [ ] **Step 4: 提交**

```bash
git add app/composables/useCaseCreation.ts tests/app/composables/useCaseCreation.test.ts
git commit -m "feat(composable): useCaseCreation 扩展 demo case 加载与应用逻辑"
```

---

## Task 19: `create.vue` 接入 composable

**Files:**
- Modify: `app/pages/dashboard/cases/create.vue`

- [ ] **Step 1: 将 promptInputRef 作为参数传入 composable**

先把 `promptInputRef` 的声明提到 composable 调用之前，然后用参数形式传入。将：

```ts
const {
  step, isSubmitting, isExtracting, caseTypes,
  extractedFormData, rawExtractedInfo, uploadedFiles,
  loadCaseTypes, createCase, extractCaseInfo,
} = useCaseCreation()
```

改为：

```ts
const promptInputRef = ref()
const {
  step, isSubmitting, isExtracting, caseTypes,
  extractedFormData, rawExtractedInfo, uploadedFiles,
  loadCaseTypes, createCase, extractCaseInfo,
  // demo case 扩展
  demoCases, demoCasesLoading, preparingDemoCaseId,
  showReplaceConfirm, pendingExample,
  loadDemoCases, handleExampleSelect, confirmReplaceExample,
} = useCaseCreation(promptInputRef)
```

- [ ] **Step 2: 删除原有本地 `promptInputRef` 声明（如果与 Step 1 重复）**

检查 script 顶部是否已有独立的 `const promptInputRef = ref()`，如有则删除（Step 1 已声明）。

- [ ] **Step 3: onMounted 加入 loadDemoCases**

```ts
onMounted(() => {
  loadCaseTypes()
  loadDemoCases()
})
```

- [ ] **Step 4: 替换模板中的 `<CaseAnalysisExample>` 使用**

```vue
<CaseAnalysisExample
  :examples="demoCases"
  :loading="demoCasesLoading"
  :selecting-id="preparingDemoCaseId"
  title="✨ 或者点击下方案例快速体验"
  @select="handleExampleSelect"
/>
```

- [ ] **Step 5: 删除旧的本地 `handleExampleSelect` 和 `confirmReplaceExample`**

从 script 中删除现有的 `handleExampleSelect` 函数和 `confirmReplaceExample` 函数（现在由 composable 提供）。删除 `pendingExampleContent` 变量（已被 `pendingExample` 取代）。

- [ ] **Step 6: 更新"替换确认"弹窗的 action**

```vue
<AlertDialogAction @click="confirmReplaceExample">确认替换</AlertDialogAction>
```

- [ ] **Step 7: 类型检查**

Run: `npx nuxi typecheck`
Expected: 不报错

- [ ] **Step 8: 提交**

```bash
git add app/pages/dashboard/cases/create.vue
git commit -m "feat(ui): 案件创建页接入后台示范案例与 composable"
```

---

## Task 20: 清理 dead code

**Files:**
- Delete: `app/components/case/DemoCaseList.vue`

- [ ] **Step 1: 确认 DemoCaseList 组件无页面引用**

Run: `grep -rn "DemoCaseList\|CaseDemoCaseList" app/ server/ --include="*.vue" --include="*.ts" | grep -v "app/components/case/DemoCaseList.vue"`
Expected: 无输出（Nuxt 自动导入按目录前缀推导的组件名是 `CaseDemoCaseList`，两种名字都要检查）

- [ ] **Step 2: 删除文件**

Run: `rm app/components/case/DemoCaseList.vue`

- [ ] **Step 3: 类型检查**

Run: `npx nuxi typecheck`
Expected: 不报错

- [ ] **Step 4: 提交**

```bash
git add -u app/components/case/DemoCaseList.vue
git commit -m "chore(cleanup): 删除未引用的 DemoCaseList 组件（仍在调用已废弃端点）"
```

---

## Task 21: 端到端验收

**Files:**
- 无新增，只运行测试与手工验收

- [ ] **Step 1: 运行后端全量测试**

Run: `npx vitest run`
Expected: 全部 PASS

**注意**：若遇到与本次改动无关的 flaky 失败（例如 chatModelFactory 相关 —— 参见项目 MEMORY），单独重跑该测试文件确认：`npx vitest run tests/path/to/failing.test.ts`。若仍失败且与本次改动无关，记录并 surface 给 reviewer，不作为本次阻塞。

- [ ] **Step 2: 运行类型检查**

Run: `npx nuxi typecheck`
Expected: 无新增错误

- [ ] **Step 3: 启动 dev server，做手工验收**

Run: `bun dev`

逐条对照 spec 5.3 验收清单：
- [ ] Admin `/admin/demo-cases` 能上传图片/文档、保存、重新打开编辑看到已上传文件列表与识别状态
- [ ] Admin 保存不含任何 content 且 materials 为空的 demo case 被 400 拒绝
- [ ] 前端 `/dashboard/cases/create` onMount 后能看到示范案例卡片；列表空时整块隐藏
- [ ] 点击卡片后 content 立即填入输入框；文件出现在文件列表；admin 源文件已识别时徽章显示"已识别"
- [ ] 同一用户连续点击同一 demo case 两次：`docker exec postgres-postgres-1 psql -U daixin -d ls_new -c "SELECT count(*) FROM oss_files WHERE user_id = X AND file_path = Y AND deleted_at IS NULL;"` 结果为 `1`
- [ ] 软删克隆后再次点击，同上 count 仍为 `1`（资源复活）
- [ ] 点击 demo case 后点"提取信息" → 确认表单 → 创建案件 → 新案件出现在"我的案件"列表，`isDemo=false`
- [ ] 使用 demo case 创建的案件启动分析时，`case_material_embeddings` 有对应 `userId`/`sourceId` 的记录，分析流程正常完成

- [ ] **Step 4: 运行 simplify 技能优化代码**

使用 `simplify` 技能对本次改动做一次优化 pass（参照项目 CLAUDE.md 要求）。

- [ ] **Step 5: 最终提交（若 simplify 产生改动）**

```bash
git add -u
git commit -m "chore: simplify pass 优化示范案例接入改动"
```

---

## 实施顺序总览

1. Task 1-2：数据模型与迁移
2. Task 3：DAO 层类型更新
3. Task 4-5：FileSource 与共享类型
4. Task 6-7：cloneRecognitionService 测试 + 实现
5. Task 8-9：ensureSourceFileRecognitionService 测试 + 实现
6. Task 10-11：prepareDemoCaseForUserService 测试 + 实现
7. Task 12：prepare API 端点
8. Task 13：Admin API 变更
9. Task 14-16：Admin 前端（组件 + FormDialog + 页面）
10. Task 17：example.vue 重构
11. Task 18：useCaseCreation composable 扩展
12. Task 19：create.vue 接入
13. Task 20：清理 DemoCaseList 死代码
14. Task 21：端到端验收
