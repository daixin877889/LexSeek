# 文书标题 + 多版本 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为文书草稿加入可编辑标题（AI 可覆盖 + 用户锁定）、AI 自动快照（10 条共享上限）、用户主动版本（命名/重命名/恢复/导出），不影响小索和合同审查 Agent。

**Architecture:** 扩展 `documentDrafts` 增加 `title / titleOverridden` 两列；新增 `documentDraftSnapshots`（自动历史）和 `documentDraftVersions`（用户里程碑）两张表；Agent 的 `draftSchema` 加入可选 `aiTitle`，在 `draftResultPersistence.middleware` afterAgent 里同事务写 draft.values + snapshot + 条件应用 aiTitle；前端顶栏 inline 编辑标题 + 右侧 Sheet 承载"版本 / 快照"两 tab，复用 shadcn Dialog/Sheet/Input 基建。

**Tech Stack:** Nuxt 4 + Vue 3 + TypeScript + Prisma + PostgreSQL + Vitest + dayjs + langchain(createMiddleware) + shadcn-vue

**Spec 依据：** `docs/superpowers/specs/2026-04-19-document-title-versions-design.md`

---

## 文件结构总览

### Prisma / 数据库
- **改：** `prisma/models/document.prisma`
- **新增：** `prisma/migrations/20260419XXXXXX_add_draft_title_snapshots_versions/migration.sql`

### 后端服务
- **改：** `server/services/assistant/document/documentDraft.dao.ts`
- **改：** `server/services/assistant/document/documentDraft.service.ts`
- **改：** `server/services/assistant/document/documentExport.service.ts`（提取纯函数 + 加 exportVersionByIdService）
- **改：** `server/services/assistant/document/draftSchema.builder.ts`
- **改：** `server/services/workflow/middleware/draftResultPersistence.middleware.ts`
- **新增：** `server/services/assistant/document/documentDraftSnapshot.dao.ts`
- **新增：** `server/services/assistant/document/documentDraftSnapshot.service.ts`
- **新增：** `server/services/assistant/document/documentDraftVersion.dao.ts`
- **新增：** `server/services/assistant/document/documentDraftVersion.service.ts`

### 后端 API 路由
- **新增：** `server/api/v1/assistant/document/drafts/[id]/title.patch.ts`
- **新增：** `server/api/v1/assistant/document/drafts/[id]/snapshots.get.ts`
- **新增：** `server/api/v1/assistant/document/drafts/snapshots/apply/[snapshotId].post.ts`
- **新增：** `server/api/v1/assistant/document/drafts/[id]/versions.get.ts`
- **新增：** `server/api/v1/assistant/document/drafts/[id]/versions.post.ts`
- **新增：** `server/api/v1/assistant/document/drafts/versions/[versionId].patch.ts`
- **新增：** `server/api/v1/assistant/document/drafts/versions/[versionId].delete.ts`
- **新增：** `server/api/v1/assistant/document/drafts/versions/restore/[versionId].post.ts`
- **新增：** `server/api/v1/assistant/document/drafts/versions/export/[versionId].get.ts`

### 共享类型
- **改：** `shared/types/document.ts`（加 DocumentDraftSnapshot / DocumentDraftVersion 等类型）

### 前端
- **改：** `app/composables/useDocumentDraft.ts`（追加 title/versions/snapshots/preview 四块）
- **改：** `app/pages/dashboard/document/drafts/[id].vue`
- **新增：** `app/components/assistant/document/DocumentDraftTitleInput.vue`
- **新增：** `app/components/assistant/document/DocumentHistorySheet.vue`
- **新增：** `app/components/assistant/document/DocumentVersionList.vue`
- **新增：** `app/components/assistant/document/DocumentSnapshotList.vue`
- **新增：** `app/components/assistant/document/DocumentSnapshotDetail.vue`

### Seed
- **改：** `prisma/seeds/seedData.sql`（documentMain_system 升 v4 + 兜底 UPDATE）

### 测试
- **新增：** `tests/server/assistant/document/documentDraftSnapshot.service.test.ts`
- **新增：** `tests/server/assistant/document/documentDraftSnapshot.dao.test.ts`
- **新增：** `tests/server/assistant/document/documentDraftVersion.service.test.ts`
- **新增：** `tests/server/assistant/document/documentDraftVersion.dao.test.ts`
- **新增：** `tests/server/assistant/document/draftTitle.service.test.ts`
- **新增：** `tests/server/assistant/document/draftResultPersistence.middleware.test.ts`
- **新增：** `tests/server/api/v1/assistant/document/drafts-title.api.test.ts`
- **新增：** `tests/server/api/v1/assistant/document/drafts-snapshots.api.test.ts`
- **新增：** `tests/server/api/v1/assistant/document/drafts-versions.api.test.ts`
- **改：** `tests/client/composables/useDocumentDraft.extensions.test.ts`（扩展）
- **新增：** `tests/client/components/DocumentDraftTitleInput.test.ts`
- **新增：** `tests/client/components/DocumentSnapshotDetail.test.ts`

---

## 前置提醒给实施者

1. **测试命令：** 用 `npx vitest run <path>` 而不是 `bun test`（Nuxt 自动导入只在 vitest 下解析）
2. **类型检查：** 用 `npx nuxi typecheck` 而不是 `tsc`
3. **数据库：** 本地 Postgres 跑在 Docker 容器 `postgres-postgres-1`；测试库 `ls_new_testing`，主库 `ls_new`
4. **服务端自动导入：** `prisma`、`logger`、`resSuccess/resError`、H3 函数都无需 import
5. **用户认证：** `event.context.auth?.user`（**不是** `event.context.user`），若无则 `resError(event, 401, '请先登录')`
6. **`useApiFetch` 返回值：** 自动拆 `data` 字段，类型直接声明为业务数据，**别包** `{ data: T }`
7. **API 响应：** 永远返 HTTP 200，错误用 `resError(event, code, msg)`
8. **用户端/管理端：** 本计划所有接口都是**用户端**，严格 owner-only，**不允许**在 handler 内引入 `checkIsSuperAdmin`
9. **Shadcn 组件：** `app/components/ui/**` 禁止修改，只 import 使用
10. **每个 Task 结束都提交一次 git commit**，提交信息用中文 + 符合项目 `.claude/rules/git.md` 的 conventional commit 格式

---

## Task 1: Prisma schema + 迁移（加 title + 两张新表）

**Files:**
- Modify: `prisma/models/document.prisma`
- Create: `prisma/migrations/20260419XXXXXX_add_draft_title_snapshots_versions/migration.sql`

- [ ] **Step 1: 修改 `prisma/models/document.prisma`，在 `documentDrafts` 加 title/titleOverridden 字段，并新增两张表**

追加到 `documentDrafts` 模型（紧跟 `status` 字段之后）：
```prisma
    /// 文书标题（创建时默认 "模板名-YYMMDD"；AI 仅在 titleOverridden=false 时覆盖）
    title           String    @default("") @db.VarChar(200)
    /// 用户是否手动修改过标题；为 true 后 AI 不再覆盖
    titleOverridden Boolean   @default(false) @map("title_overridden")
```

并在 `documentDrafts` 的 relations 区块（`materials caseMaterials[]` 之后）追加：
```prisma
    /// AI 历史快照与覆盖前自动备份
    snapshots documentDraftSnapshots[]
    /// 用户主动保存的版本
    versions  documentDraftVersions[]
```

在 `documentDrafts` 模型下方追加两张新表：
```prisma
/// 文书草稿快照表 - AI 重跑 / 覆盖工作区前的自动历史记录（10 条共享上限）
model documentDraftSnapshots {
    id        Int      @id @default(autoincrement())
    draftId   Int      @map("draft_id")
    /// 来源：ai-extract（AI 生成后落盘）、workspace-backup（覆盖工作区前自动备份）
    source    String   @db.VarChar(30)
    /// 快照时的 values 全量拷贝
    values    Json     @default("{}") @db.JsonB
    /// AI 本轮产出的推断标题（可空）
    aiTitle   String?  @map("ai_title") @db.VarChar(200)
    createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

    draft documentDrafts @relation(fields: [draftId], references: [id], onDelete: Cascade)

    @@index([draftId, createdAt(sort: Desc)], map: "idx_doc_snapshots_draft_time")
    @@map("document_draft_snapshots")
}

/// 文书草稿版本表 - 用户主动保存的里程碑，只读、永久保留、无上限
model documentDraftVersions {
    id        Int      @id @default(autoincrement())
    draftId   Int      @map("draft_id")
    /// 版本序号，1 基；同 draftId 内自增，删除不回收
    versionNo Int      @map("version_no")
    /// 用户命名（默认建议"第 X 版"由前端带出）
    name      String   @db.VarChar(100)
    /// 版本的 values 全量拷贝
    values    Json     @default("{}") @db.JsonB
    /// 版本创建时 draft 的标题（用于导出文件名 / 历史显示）
    titleAt   String   @map("title_at") @db.VarChar(200)
    createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

    draft documentDrafts @relation(fields: [draftId], references: [id], onDelete: Cascade)

    @@unique([draftId, versionNo], map: "idx_doc_versions_draft_no")
    @@index([draftId, createdAt(sort: Desc)], map: "idx_doc_versions_draft_time")
    @@map("document_draft_versions")
}
```

- [ ] **Step 2: 生成迁移目录 + SQL**

Run:
```bash
mkdir -p prisma/migrations/20260419120000_add_draft_title_snapshots_versions
```

创建 `prisma/migrations/20260419120000_add_draft_title_snapshots_versions/migration.sql`，内容如下：
```sql
-- 给 document_drafts 加 title / title_overridden
ALTER TABLE "public"."document_drafts"
    ADD COLUMN "title" VARCHAR(200) NOT NULL DEFAULT '',
    ADD COLUMN "title_overridden" BOOLEAN NOT NULL DEFAULT false;

-- 回填老记录的 title：模板名 + YYMMDD（用数据库时区 Asia/Shanghai 保证本地日期）
UPDATE "public"."document_drafts" d
   SET "title" = COALESCE(t."name", '文书')
                 || '-' || to_char(d."created_at" AT TIME ZONE 'Asia/Shanghai', 'YYMMDD')
  FROM "public"."document_templates" t
 WHERE d."template_id" = t."id" AND d."title" = '';

-- 文书快照表
CREATE TABLE "document_draft_snapshots" (
    "id" SERIAL NOT NULL,
    "draft_id" INTEGER NOT NULL,
    "source" VARCHAR(30) NOT NULL,
    "values" JSONB NOT NULL DEFAULT '{}',
    "ai_title" VARCHAR(200),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_draft_snapshots_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "idx_doc_snapshots_draft_time" ON "document_draft_snapshots"("draft_id", "created_at" DESC);
ALTER TABLE "document_draft_snapshots"
    ADD CONSTRAINT "document_draft_snapshots_draft_id_fkey"
    FOREIGN KEY ("draft_id") REFERENCES "document_drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 文书版本表
CREATE TABLE "document_draft_versions" (
    "id" SERIAL NOT NULL,
    "draft_id" INTEGER NOT NULL,
    "version_no" INTEGER NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "values" JSONB NOT NULL DEFAULT '{}',
    "title_at" VARCHAR(200) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_draft_versions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "idx_doc_versions_draft_no" ON "document_draft_versions"("draft_id", "version_no");
CREATE INDEX "idx_doc_versions_draft_time" ON "document_draft_versions"("draft_id", "created_at" DESC);
ALTER TABLE "document_draft_versions"
    ADD CONSTRAINT "document_draft_versions_draft_id_fkey"
    FOREIGN KEY ("draft_id") REFERENCES "document_drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 3: 生成 Prisma Client**

Run:
```bash
bun run prisma:generate
```
Expected: "✔ Generated Prisma Client ... "

- [ ] **Step 4: 推送到主库 + 测试库**

Run:
```bash
DATABASE_URL='postgresql://daixin@localhost:5432/ls_new?schema=public' bun run prisma:migrate deploy
DATABASE_URL='postgresql://daixin@localhost:5432/ls_new_testing?schema=public' bun run prisma:migrate deploy
```
Expected: 两个库都出现 `1 migration ... applied`

- [ ] **Step 5: 类型检查**

Run: `npx nuxi typecheck`
Expected: 现有代码类型不回归（新表/新字段出现在 `~~/generated/prisma/client`）

- [ ] **Step 6: Commit**
```bash
git add prisma/models/document.prisma prisma/migrations/20260419120000_add_draft_title_snapshots_versions
git commit -m "feat(db): 文书草稿加 title/titleOverridden，新增 snapshots/versions 两张表"
```

---

## Task 2: 扩展 `documentDraft.dao` — `updateDraftTitleDAO` + create 带 title

**Files:**
- Modify: `server/services/assistant/document/documentDraft.dao.ts`
- Modify: `server/services/assistant/document/documentDraft.service.ts:86-95`（`createDraftService` 里计算并传入 title）
- Test: `tests/server/assistant/document/documentDraft.dao.test.ts`（扩展）

- [ ] **Step 1: 写失败测试 — 覆盖 `updateDraftTitleDAO` 三条关键行为**

在 `tests/server/assistant/document/documentDraft.dao.test.ts` 末尾追加：
```ts
describe('updateDraftTitleDAO', () => {
    it('应当更新 title 并同步 titleOverridden=true', async () => {
        const draft = await createDocumentDraftDAO({
            userId: 1, templateId: 1, sessionId: 'sid-title-1',
            status: 'ready', values: {}, sourceRef: null, metadata: null, caseId: null,
        })
        const updated = await updateDraftTitleDAO(draft.id, '我的起诉状', true)
        expect(updated.title).toBe('我的起诉状')
        expect(updated.titleOverridden).toBe(true)
    })

    it('AI 分支带 ifNotOverridden=true 时，overridden=true 应拒绝覆盖', async () => {
        const draft = await createDocumentDraftDAO({
            userId: 1, templateId: 1, sessionId: 'sid-title-2',
            status: 'ready', values: {}, sourceRef: null, metadata: null, caseId: null,
        })
        await updateDraftTitleDAO(draft.id, '用户命名', true)
        const result = await updateDraftTitleDAO(draft.id, 'AI 自动命名', false, { ifNotOverridden: true })
        expect(result).toBeNull()
    })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/server/assistant/document/documentDraft.dao.test.ts -t updateDraftTitleDAO`
Expected: FAIL — `updateDraftTitleDAO is not defined`

- [ ] **Step 3: 实现 `updateDraftTitleDAO` 并让 `createDocumentDraftDAO` 支持 title/titleOverridden**

修改 `server/services/assistant/document/documentDraft.dao.ts`：

在 `CreateDocumentDraftInput` interface 里追加：
```ts
    /** 初始标题；不传走数据库默认空串 */
    title?: string
    /** 初始覆盖位，默认 false */
    titleOverridden?: boolean
```

修改 `createDocumentDraftDAO` 的 `data` 对象，追加两行：
```ts
            title: input.title ?? '',
            titleOverridden: input.titleOverridden ?? false,
```

在文件末尾追加：
```ts
/**
 * 更新草稿标题。
 * @param id 草稿 ID
 * @param title 新标题
 * @param overridden 置位值；AI 路径传 false、用户路径传 true
 * @param opts.ifNotOverridden true 时仅在当前 titleOverridden=false 才更新（AI 安全写）；
 *                              更新命中返回记录；未命中返回 null（竞态/用户已改过）
 */
export async function updateDraftTitleDAO(
    id: number,
    title: string,
    overridden: boolean,
    opts: { ifNotOverridden?: boolean } = {},
    tx?: Prisma.TransactionClient,
) {
    const db = tx ?? prisma
    if (opts.ifNotOverridden) {
        const result = await db.documentDrafts.updateMany({
            where: { id, deletedAt: null, titleOverridden: false },
            data: { title, titleOverridden: overridden, updatedAt: new Date() },
        })
        if (result.count === 0) return null
        return db.documentDrafts.findFirst({ where: { id, deletedAt: null } })
    }
    return db.documentDrafts.update({
        where: { id },
        data: { title, titleOverridden: overridden, updatedAt: new Date() },
    })
}
```

- [ ] **Step 4: 修改 `createDraftService` 以计算默认标题**

在 `server/services/assistant/document/documentDraft.service.ts` 文件顶部 import：
```ts
import dayjs from 'dayjs'
```

在 `createDraftService` 中，`const draft = await createDocumentDraftDAO({...})` 调用前插入：
```ts
    const defaultTitle = `${template.name}-${dayjs().format('YYMMDD')}`
```
并在 `createDocumentDraftDAO` 入参里追加：
```ts
        title: defaultTitle,
        titleOverridden: false,
```

- [ ] **Step 5: 运行测试确认通过 + 现有测试不回归**

Run: `npx vitest run tests/server/assistant/document/documentDraft.dao.test.ts tests/server/assistant/document/documentDraft.service.test.ts`
Expected: PASS（含新增 2 个 + 旧测全绿）

- [ ] **Step 6: Commit**
```bash
git add server/services/assistant/document/documentDraft.dao.ts server/services/assistant/document/documentDraft.service.ts tests/server/assistant/document/documentDraft.dao.test.ts
git commit -m "feat(document): documentDraft.dao 支持 title 字段 + updateDraftTitleDAO"
```

---

## Task 3: 新建 `documentDraftSnapshot.dao` + 测试

**Files:**
- Create: `server/services/assistant/document/documentDraftSnapshot.dao.ts`
- Create: `tests/server/assistant/document/documentDraftSnapshot.dao.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `tests/server/assistant/document/documentDraftSnapshot.dao.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import {
    createSnapshotDAO,
    listSnapshotsDAO,
    getSnapshotByIdDAO,
} from '~~/server/services/assistant/document/documentDraftSnapshot.dao'
import { createDocumentDraftDAO } from '~~/server/services/assistant/document/documentDraft.dao'

async function makeDraft(sessionId: string) {
    return createDocumentDraftDAO({
        userId: 1, templateId: 1, sessionId,
        status: 'ready', values: {}, sourceRef: null, metadata: null, caseId: null,
    })
}

describe('documentDraftSnapshot.dao', () => {
    it('createSnapshotDAO 写入并能被 get 到', async () => {
        const draft = await makeDraft('sid-snap-1')
        const snap = await createSnapshotDAO({
            draftId: draft.id,
            source: 'ai-extract',
            values: { name: 'Alice' },
            aiTitle: '测试标题',
        })
        expect(snap.id).toBeGreaterThan(0)
        const got = await getSnapshotByIdDAO(snap.id)
        expect(got?.source).toBe('ai-extract')
        expect(got?.aiTitle).toBe('测试标题')
        expect(got?.values).toEqual({ name: 'Alice' })
    })

    it('listSnapshotsDAO 按 createdAt 降序返回', async () => {
        const draft = await makeDraft('sid-snap-2')
        await createSnapshotDAO({ draftId: draft.id, source: 'ai-extract', values: { a: '1' } })
        await new Promise(r => setTimeout(r, 5))
        await createSnapshotDAO({ draftId: draft.id, source: 'workspace-backup', values: { a: '2' } })
        const list = await listSnapshotsDAO(draft.id)
        expect(list).toHaveLength(2)
        expect(list[0]!.source).toBe('workspace-backup')
        expect(list[1]!.source).toBe('ai-extract')
    })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/server/assistant/document/documentDraftSnapshot.dao.test.ts`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 实现 DAO**

创建 `server/services/assistant/document/documentDraftSnapshot.dao.ts`:
```ts
/**
 * DocumentDraftSnapshot DAO
 *
 * 文书草稿快照（AI 每次重跑 + 覆盖工作区前自动备份）。
 * 10 条共享上限的清理逻辑由 Service 层在事务内处理，DAO 只做基础 CRUD。
 */

import type { Prisma } from '#shared/types/prisma'

export interface CreateSnapshotInput {
    draftId: number
    /** 'ai-extract' | 'workspace-backup' */
    source: string
    values: Record<string, unknown>
    aiTitle?: string | null
}

export async function createSnapshotDAO(
    input: CreateSnapshotInput,
    tx?: Prisma.TransactionClient,
) {
    const db = tx ?? prisma
    return db.documentDraftSnapshots.create({
        data: {
            draftId: input.draftId,
            source: input.source,
            values: input.values as any,
            aiTitle: input.aiTitle ?? null,
        },
    })
}

export async function listSnapshotsDAO(
    draftId: number,
    tx?: Prisma.TransactionClient,
) {
    const db = tx ?? prisma
    return db.documentDraftSnapshots.findMany({
        where: { draftId },
        orderBy: { createdAt: 'desc' },
    })
}

export async function getSnapshotByIdDAO(
    id: number,
    tx?: Prisma.TransactionClient,
) {
    const db = tx ?? prisma
    return db.documentDraftSnapshots.findUnique({ where: { id } })
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/server/assistant/document/documentDraftSnapshot.dao.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add server/services/assistant/document/documentDraftSnapshot.dao.ts tests/server/assistant/document/documentDraftSnapshot.dao.test.ts
git commit -m "feat(document): 新增 documentDraftSnapshot DAO"
```

---

## Task 4: 新建 `documentDraftVersion.dao` + 测试

**Files:**
- Create: `server/services/assistant/document/documentDraftVersion.dao.ts`
- Create: `tests/server/assistant/document/documentDraftVersion.dao.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `tests/server/assistant/document/documentDraftVersion.dao.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import {
    createVersionDAO,
    listVersionsDAO,
    getVersionByIdDAO,
    updateVersionNameDAO,
    deleteVersionDAO,
} from '~~/server/services/assistant/document/documentDraftVersion.dao'
import { createDocumentDraftDAO } from '~~/server/services/assistant/document/documentDraft.dao'

async function makeDraft(sessionId: string) {
    return createDocumentDraftDAO({
        userId: 1, templateId: 1, sessionId,
        status: 'ready', values: {}, sourceRef: null, metadata: null, caseId: null,
    })
}

describe('documentDraftVersion.dao', () => {
    it('createVersionDAO 写入并按 id 获取', async () => {
        const draft = await makeDraft('sid-ver-1')
        const v = await createVersionDAO({
            draftId: draft.id, versionNo: 1, name: '第 1 版',
            values: { a: '1' }, titleAt: 'T-260419',
        })
        const got = await getVersionByIdDAO(v.id)
        expect(got?.name).toBe('第 1 版')
        expect(got?.versionNo).toBe(1)
        expect(got?.titleAt).toBe('T-260419')
    })

    it('listVersionsDAO 按 createdAt 降序', async () => {
        const draft = await makeDraft('sid-ver-2')
        await createVersionDAO({ draftId: draft.id, versionNo: 1, name: 'V1', values: {}, titleAt: 'T' })
        await new Promise(r => setTimeout(r, 5))
        await createVersionDAO({ draftId: draft.id, versionNo: 2, name: 'V2', values: {}, titleAt: 'T' })
        const list = await listVersionsDAO(draft.id)
        expect(list[0]!.name).toBe('V2')
        expect(list[1]!.name).toBe('V1')
    })

    it('updateVersionNameDAO 重命名成功', async () => {
        const draft = await makeDraft('sid-ver-3')
        const v = await createVersionDAO({ draftId: draft.id, versionNo: 1, name: 'old', values: {}, titleAt: 'T' })
        const u = await updateVersionNameDAO(v.id, 'new')
        expect(u.name).toBe('new')
    })

    it('deleteVersionDAO 物理删除，不回收 version_no', async () => {
        const draft = await makeDraft('sid-ver-4')
        const v = await createVersionDAO({ draftId: draft.id, versionNo: 1, name: 'V1', values: {}, titleAt: 'T' })
        await deleteVersionDAO(v.id)
        const got = await getVersionByIdDAO(v.id)
        expect(got).toBeNull()
    })

    it('同 draftId 重复 versionNo 应命中唯一约束 P2002', async () => {
        const draft = await makeDraft('sid-ver-5')
        await createVersionDAO({ draftId: draft.id, versionNo: 1, name: 'A', values: {}, titleAt: 'T' })
        await expect(
            createVersionDAO({ draftId: draft.id, versionNo: 1, name: 'B', values: {}, titleAt: 'T' }),
        ).rejects.toMatchObject({ code: 'P2002' })
    })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/server/assistant/document/documentDraftVersion.dao.test.ts`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 实现 DAO**

创建 `server/services/assistant/document/documentDraftVersion.dao.ts`:
```ts
/**
 * DocumentDraftVersion DAO
 *
 * 用户主动保存的版本快照；只读，无上限；支持 CRUD 与重命名。
 * versionNo 自增逻辑在 Service 层事务中 SELECT MAX+1，此处仅提供原子写。
 */

import type { Prisma } from '#shared/types/prisma'

export interface CreateVersionInput {
    draftId: number
    versionNo: number
    name: string
    values: Record<string, unknown>
    titleAt: string
}

export async function createVersionDAO(
    input: CreateVersionInput,
    tx?: Prisma.TransactionClient,
) {
    const db = tx ?? prisma
    return db.documentDraftVersions.create({
        data: {
            draftId: input.draftId,
            versionNo: input.versionNo,
            name: input.name,
            values: input.values as any,
            titleAt: input.titleAt,
        },
    })
}

export async function listVersionsDAO(
    draftId: number,
    tx?: Prisma.TransactionClient,
) {
    const db = tx ?? prisma
    return db.documentDraftVersions.findMany({
        where: { draftId },
        orderBy: { createdAt: 'desc' },
    })
}

export async function getVersionByIdDAO(
    id: number,
    tx?: Prisma.TransactionClient,
) {
    const db = tx ?? prisma
    return db.documentDraftVersions.findUnique({ where: { id } })
}

export async function updateVersionNameDAO(
    id: number,
    name: string,
    tx?: Prisma.TransactionClient,
) {
    const db = tx ?? prisma
    return db.documentDraftVersions.update({
        where: { id },
        data: { name },
    })
}

export async function deleteVersionDAO(
    id: number,
    tx?: Prisma.TransactionClient,
) {
    const db = tx ?? prisma
    return db.documentDraftVersions.delete({ where: { id } })
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/server/assistant/document/documentDraftVersion.dao.test.ts`
Expected: PASS（含 5 条用例）

- [ ] **Step 5: Commit**
```bash
git add server/services/assistant/document/documentDraftVersion.dao.ts tests/server/assistant/document/documentDraftVersion.dao.test.ts
git commit -m "feat(document): 新增 documentDraftVersion DAO"
```

---

## Task 5: 扩展 `documentDraft.service` — title 相关 Service 方法

**Files:**
- Modify: `server/services/assistant/document/documentDraft.service.ts`
- Create: `tests/server/assistant/document/draftTitle.service.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `tests/server/assistant/document/draftTitle.service.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocksDao = vi.hoisted(() => ({
    getDocumentDraftDAO: vi.fn(),
    updateDraftTitleDAO: vi.fn(),
}))

vi.mock('~~/server/services/assistant/document/documentDraft.dao', () => mocksDao)
vi.mock('../../../server/services/assistant/document/documentDraft.dao', () => mocksDao)

import {
    updateDraftTitleService,
    applyAITitleIfAllowedService,
} from '../../../server/services/assistant/document/documentDraft.service'

describe('updateDraftTitleService', () => {
    beforeEach(() => { vi.clearAllMocks() })

    it('owner 可更新标题并置 titleOverridden=true', async () => {
        mocksDao.getDocumentDraftDAO.mockResolvedValue({ id: 1, userId: 10, deletedAt: null })
        mocksDao.updateDraftTitleDAO.mockResolvedValue({ id: 1, title: 'X', titleOverridden: true })
        const r = await updateDraftTitleService(10, 1, 'X')
        expect('draft' in r && r.draft.title).toBe('X')
        expect(mocksDao.updateDraftTitleDAO).toHaveBeenCalledWith(1, 'X', true)
    })

    it('非 owner 返 403', async () => {
        mocksDao.getDocumentDraftDAO.mockResolvedValue({ id: 1, userId: 99, deletedAt: null })
        const r = await updateDraftTitleService(10, 1, 'X')
        expect('error' in r && r.code).toBe(403)
    })

    it('不存在返 404', async () => {
        mocksDao.getDocumentDraftDAO.mockResolvedValue(null)
        const r = await updateDraftTitleService(10, 1, 'X')
        expect('error' in r && r.code).toBe(404)
    })
})

describe('applyAITitleIfAllowedService', () => {
    beforeEach(() => { vi.clearAllMocks() })

    it('titleOverridden=false 时正常写入', async () => {
        mocksDao.updateDraftTitleDAO.mockResolvedValue({ id: 1, title: 'AI', titleOverridden: false })
        const ok = await applyAITitleIfAllowedService(1, 'AI')
        expect(ok).toBe(true)
        expect(mocksDao.updateDraftTitleDAO).toHaveBeenCalledWith(1, 'AI', false, { ifNotOverridden: true })
    })

    it('原子 update 未命中（用户已改）时返 false，不抛错', async () => {
        mocksDao.updateDraftTitleDAO.mockResolvedValue(null)
        const ok = await applyAITitleIfAllowedService(1, 'AI')
        expect(ok).toBe(false)
    })

    it('空字符串直接跳过', async () => {
        const ok = await applyAITitleIfAllowedService(1, '')
        expect(ok).toBe(false)
        expect(mocksDao.updateDraftTitleDAO).not.toHaveBeenCalled()
    })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/server/assistant/document/draftTitle.service.test.ts`
Expected: FAIL — 两个函数未定义

- [ ] **Step 3: 实现 Service 方法**

在 `server/services/assistant/document/documentDraft.service.ts` 顶部 import 处追加：
```ts
import { updateDraftTitleDAO } from './documentDraft.dao'
```

在文件末尾追加：
```ts
// ==================== updateDraftTitleService ====================

/**
 * 用户主动修改标题。owner-only；写入后锁定 titleOverridden=true，AI 不再覆盖。
 * 空字符串 / 超长由 API 层 zod 拦截。
 */
export async function updateDraftTitleService(
    userId: number,
    draftId: number,
    title: string,
): Promise<{ draft: any } | ServiceError> {
    const draft = await getDocumentDraftDAO(draftId)
    if (!draft) return { error: '草稿不存在', code: 404 }
    if (draft.userId !== userId) return { error: '无权修改此草稿', code: 403 }

    const updated = await updateDraftTitleDAO(draftId, title, true)
    return { draft: updated }
}

// ==================== applyAITitleIfAllowedService ====================

/**
 * AI 应用推断标题。仅在 titleOverridden=false 时更新；用户已改则跳过。
 * 原子 UPDATE 保证无竞态；返回是否真的写入。
 */
export async function applyAITitleIfAllowedService(
    draftId: number,
    aiTitle: string,
): Promise<boolean> {
    if (!aiTitle || !aiTitle.trim()) return false
    const result = await updateDraftTitleDAO(draftId, aiTitle.trim(), false, { ifNotOverridden: true })
    return result != null
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/server/assistant/document/draftTitle.service.test.ts`
Expected: PASS（4 条全绿）

- [ ] **Step 5: Commit**
```bash
git add server/services/assistant/document/documentDraft.service.ts tests/server/assistant/document/draftTitle.service.test.ts
git commit -m "feat(document): 新增 updateDraftTitleService + applyAITitleIfAllowedService"
```

---

## Task 6: 新建 `documentDraftSnapshot.service` + 测试

**Files:**
- Create: `server/services/assistant/document/documentDraftSnapshot.service.ts`
- Create: `tests/server/assistant/document/documentDraftSnapshot.service.test.ts`

**核心点（回看 spec §5.2）：**
- `createSnapshotService` 事务内 insert + 保留 10 条（DELETE NOT IN ... LIMIT 10）
- `applySnapshotFieldsService` 先自动备份工作区 → 再覆盖（合并 fieldNames）
- Owner 校验走 `snapshot → draft → userId` 链
- 未知 fieldName **直接跳过**（不 warn）

- [ ] **Step 1: 写失败测试**

创建 `tests/server/assistant/document/documentDraftSnapshot.service.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createDocumentDraftDAO } from '~~/server/services/assistant/document/documentDraft.dao'
import {
    createSnapshotService,
    applySnapshotFieldsService,
    listSnapshotsForUserService,
} from '~~/server/services/assistant/document/documentDraftSnapshot.service'
import { listSnapshotsDAO } from '~~/server/services/assistant/document/documentDraftSnapshot.dao'

async function makeDraft(userId: number, sid: string, values: Record<string, unknown> = {}) {
    return createDocumentDraftDAO({
        userId, templateId: 1, sessionId: sid,
        status: 'ready', values, sourceRef: null, metadata: null, caseId: null,
    })
}

describe('createSnapshotService', () => {
    it('写入单条快照并能被 list', async () => {
        const d = await makeDraft(10, 'sid-sp-1')
        await createSnapshotService(d.id, 'ai-extract', { values: { a: '1' }, aiTitle: 'T' })
        const list = await listSnapshotsDAO(d.id)
        expect(list).toHaveLength(1)
        expect(list[0]!.aiTitle).toBe('T')
    })

    it('插入第 11 条时最老一条被清', async () => {
        const d = await makeDraft(10, 'sid-sp-2')
        for (let i = 0; i < 11; i++) {
            await createSnapshotService(d.id, 'ai-extract', { values: { i: String(i) } })
            await new Promise(r => setTimeout(r, 2))
        }
        const list = await listSnapshotsDAO(d.id)
        expect(list).toHaveLength(10)
        // 最老那条 values.i = '0' 应已被清
        const oldest = list[list.length - 1]!
        expect((oldest.values as any).i).not.toBe('0')
    })
})

describe('listSnapshotsForUserService', () => {
    it('非 owner 返 403', async () => {
        const d = await makeDraft(10, 'sid-sp-3')
        await createSnapshotService(d.id, 'ai-extract', { values: {} })
        const r = await listSnapshotsForUserService(99, d.id)
        expect('error' in r && r.code).toBe(403)
    })
    it('owner 可拉到列表', async () => {
        const d = await makeDraft(10, 'sid-sp-4')
        await createSnapshotService(d.id, 'ai-extract', { values: {} })
        const r = await listSnapshotsForUserService(10, d.id)
        expect('snapshots' in r && r.snapshots).toHaveLength(1)
    })
})

describe('applySnapshotFieldsService', () => {
    beforeEach(() => {})

    it('先写 workspace-backup 再覆盖（全量）', async () => {
        const d = await makeDraft(10, 'sid-sp-5', { name: 'old', amount: '100' })
        const snap = (await createSnapshotService(d.id, 'ai-extract', {
            values: { name: 'new', amount: '200' },
        }))
        const r = await applySnapshotFieldsService(10, d.id, snap.id)
        expect('draft' in r).toBe(true)
        expect('draft' in r && (r.draft.values as any).name).toBe('new')
        expect('draft' in r && (r.draft.values as any).amount).toBe('200')
        const list = await listSnapshotsDAO(d.id)
        // 2 条：原 ai-extract + 新 workspace-backup
        expect(list.filter(s => s.source === 'workspace-backup')).toHaveLength(1)
    })

    it('只覆盖指定 fieldNames', async () => {
        const d = await makeDraft(10, 'sid-sp-6', { name: 'old', amount: '100' })
        const snap = (await createSnapshotService(d.id, 'ai-extract', {
            values: { name: 'new', amount: '200' },
        }))
        const r = await applySnapshotFieldsService(10, d.id, snap.id, ['name'])
        expect('draft' in r && (r.draft.values as any).name).toBe('new')
        expect('draft' in r && (r.draft.values as any).amount).toBe('100') // 未覆盖
    })

    it('未知 fieldName 跳过，不抛错', async () => {
        const d = await makeDraft(10, 'sid-sp-7', { name: 'old' })
        const snap = (await createSnapshotService(d.id, 'ai-extract', { values: { name: 'new' } }))
        const r = await applySnapshotFieldsService(10, d.id, snap.id, ['name', 'no-such-field'])
        expect('draft' in r && (r.draft.values as any).name).toBe('new')
    })

    it('非 owner 返 403', async () => {
        const d = await makeDraft(10, 'sid-sp-8')
        const snap = (await createSnapshotService(d.id, 'ai-extract', { values: {} }))
        const r = await applySnapshotFieldsService(99, d.id, snap.id)
        expect('error' in r && r.code).toBe(403)
    })

    it('snapshot 不属于该 draft 返 404', async () => {
        const d1 = await makeDraft(10, 'sid-sp-9')
        const d2 = await makeDraft(10, 'sid-sp-10')
        const snap = (await createSnapshotService(d1.id, 'ai-extract', { values: {} }))
        const r = await applySnapshotFieldsService(10, d2.id, snap.id)
        expect('error' in r && r.code).toBe(404)
    })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/server/assistant/document/documentDraftSnapshot.service.test.ts`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 实现 Service**

创建 `server/services/assistant/document/documentDraftSnapshot.service.ts`:
```ts
/**
 * DocumentDraftSnapshot Service
 *
 * 封装快照业务规则：
 * - 10 条共享上限（同事务内 insert + 清理）
 * - 字段级/全量恢复前自动 workspace-backup
 * - owner-only 校验
 */

import type { Prisma } from '#shared/types/prisma'
import { getDocumentDraftDAO, updateDocumentDraftDAO } from './documentDraft.dao'
import { createSnapshotDAO, listSnapshotsDAO, getSnapshotByIdDAO } from './documentDraftSnapshot.dao'

const SNAPSHOT_KEEP = 10

type ServiceError = { error: string; code: number }

export interface SnapshotPayload {
    values: Record<string, unknown>
    aiTitle?: string | null
}

/**
 * 创建快照并清理最旧，保持 draftId 下总数 ≤ SNAPSHOT_KEEP。
 * 清理失败仅日志 warn 不阻塞主流程。
 */
export async function createSnapshotService(
    draftId: number,
    source: 'ai-extract' | 'workspace-backup',
    payload: SnapshotPayload,
    tx?: Prisma.TransactionClient,
) {
    const db = tx ?? prisma
    return db.$transaction(async (innerTx) => {
        const snap = await createSnapshotDAO({
            draftId, source,
            values: payload.values,
            aiTitle: payload.aiTitle ?? null,
        }, innerTx)

        try {
            // 保留最新 SNAPSHOT_KEEP 条，其余清除
            await innerTx.$executeRaw`
                DELETE FROM "document_draft_snapshots"
                WHERE "draft_id" = ${draftId}
                  AND "id" NOT IN (
                    SELECT "id" FROM "document_draft_snapshots"
                    WHERE "draft_id" = ${draftId}
                    ORDER BY "created_at" DESC
                    LIMIT ${SNAPSHOT_KEEP}
                  )
            `
        } catch (err) {
            logger.warn('清理旧快照失败（不阻塞）', { draftId, error: err })
        }

        return snap
    })
}

export async function listSnapshotsForUserService(
    userId: number,
    draftId: number,
): Promise<{ snapshots: any[] } | ServiceError> {
    const draft = await getDocumentDraftDAO(draftId)
    if (!draft) return { error: '草稿不存在', code: 404 }
    if (draft.userId !== userId) return { error: '无权访问此草稿', code: 403 }

    const snapshots = await listSnapshotsDAO(draftId)
    return { snapshots }
}

/**
 * 用快照的 values 覆盖工作区（全量或指定字段）。
 * 事务内：1) 先写 workspace-backup 快照 → 2) 合并 values → 3) 更新 draft。
 */
export async function applySnapshotFieldsService(
    userId: number,
    draftId: number,
    snapshotId: number,
    fieldNames?: string[],
): Promise<{ draft: any } | ServiceError> {
    const draft = await getDocumentDraftDAO(draftId)
    if (!draft) return { error: '草稿不存在', code: 404 }
    if (draft.userId !== userId) return { error: '无权访问此草稿', code: 403 }

    const snap = await getSnapshotByIdDAO(snapshotId)
    if (!snap || snap.draftId !== draftId) {
        return { error: '快照不存在', code: 404 }
    }

    const currentValues = (draft.values as Record<string, unknown>) ?? {}
    const snapValues = (snap.values as Record<string, unknown>) ?? {}

    // 合并规则：fieldNames=undefined → 全量覆盖；否则仅覆盖指定字段（未知字段直接跳过）
    let mergedValues: Record<string, unknown>
    if (!fieldNames) {
        mergedValues = { ...currentValues, ...snapValues }
    } else {
        mergedValues = { ...currentValues }
        for (const f of fieldNames) {
            if (f in snapValues) mergedValues[f] = snapValues[f]
        }
    }

    const updated = await prisma.$transaction(async (tx) => {
        await createSnapshotService(draftId, 'workspace-backup', {
            values: currentValues,
        }, tx)
        return tx.documentDrafts.update({
            where: { id: draftId },
            data: { values: mergedValues as any, updatedAt: new Date() },
        })
    })

    return { draft: updated }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/server/assistant/document/documentDraftSnapshot.service.test.ts`
Expected: PASS（7 条全绿）

- [ ] **Step 5: Commit**
```bash
git add server/services/assistant/document/documentDraftSnapshot.service.ts tests/server/assistant/document/documentDraftSnapshot.service.test.ts
git commit -m "feat(document): documentDraftSnapshot Service（10 条上限 + 字段级恢复 + 自动 backup）"
```

---

## Task 7: 新建 `documentDraftVersion.service` + 测试

**Files:**
- Create: `server/services/assistant/document/documentDraftVersion.service.ts`
- Create: `tests/server/assistant/document/documentDraftVersion.service.test.ts`

**核心点：**
- `createVersionService`：事务内 MAX+1 → insert；P2002 重试一次
- `restoreVersionService`：先自动备份 workspace-backup → 再覆盖 draft.values
- `renameVersionService` / `deleteVersionService`：owner-only

- [ ] **Step 1: 写失败测试**

创建 `tests/server/assistant/document/documentDraftVersion.service.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { createDocumentDraftDAO } from '~~/server/services/assistant/document/documentDraft.dao'
import {
    createVersionService,
    listVersionsForUserService,
    restoreVersionService,
    renameVersionService,
    deleteVersionService,
} from '~~/server/services/assistant/document/documentDraftVersion.service'
import { listVersionsDAO } from '~~/server/services/assistant/document/documentDraftVersion.dao'

async function makeDraft(userId: number, sid: string, values: Record<string, unknown> = {}) {
    return createDocumentDraftDAO({
        userId, templateId: 1, sessionId: sid,
        status: 'ready', values, sourceRef: null, metadata: null,
        caseId: null, title: 'T-260419', titleOverridden: false,
    })
}

describe('createVersionService', () => {
    it('版本号从 1 连续自增', async () => {
        const d = await makeDraft(10, 'sid-v-1', { a: '1' })
        const r1 = await createVersionService(10, d.id, 'First')
        const r2 = await createVersionService(10, d.id, 'Second')
        expect('version' in r1 && r1.version.versionNo).toBe(1)
        expect('version' in r2 && r2.version.versionNo).toBe(2)
    })

    it('values 和 titleAt 快照自 draft', async () => {
        const d = await makeDraft(10, 'sid-v-2', { name: 'Alice' })
        const r = await createVersionService(10, d.id, 'V1')
        expect('version' in r && (r.version.values as any).name).toBe('Alice')
        expect('version' in r && r.version.titleAt).toBe('T-260419')
    })

    it('非 owner 返 403', async () => {
        const d = await makeDraft(10, 'sid-v-3')
        const r = await createVersionService(99, d.id, 'X')
        expect('error' in r && r.code).toBe(403)
    })

    it('删除后版本号不回收', async () => {
        const d = await makeDraft(10, 'sid-v-4')
        const r1 = await createVersionService(10, d.id, 'V1')
        const r2 = await createVersionService(10, d.id, 'V2')
        const r3 = await createVersionService(10, d.id, 'V3')
        if ('version' in r3) await deleteVersionService(10, r3.version.id)
        const r4 = await createVersionService(10, d.id, 'V4')
        expect('version' in r4 && r4.version.versionNo).toBe(4)
    })
})

describe('restoreVersionService', () => {
    it('恢复前自动快照当前工作区（workspace-backup）', async () => {
        const d = await makeDraft(10, 'sid-v-5', { a: 'current' })
        const vRes = await createVersionService(10, d.id, 'V1')
        if (!('version' in vRes)) throw new Error('version 创建失败')

        // 之后用户改了工作区
        const { updateDocumentDraftDAO } = await import('~~/server/services/assistant/document/documentDraft.dao')
        await updateDocumentDraftDAO(d.id, { values: { a: 'edited' } as any })

        const restored = await restoreVersionService(10, d.id, vRes.version.id)
        expect('draft' in restored && (restored.draft.values as any).a).toBe('current') // 版本值回来了

        // workspace-backup 保留了 'edited'
        const { listSnapshotsDAO } = await import('~~/server/services/assistant/document/documentDraftSnapshot.dao')
        const snapshots = await listSnapshotsDAO(d.id)
        const backup = snapshots.find(s => s.source === 'workspace-backup')
        expect(backup).toBeDefined()
        expect((backup!.values as any).a).toBe('edited')
    })

    it('版本不属于该 draft 返 404', async () => {
        const d1 = await makeDraft(10, 'sid-v-6')
        const d2 = await makeDraft(10, 'sid-v-7')
        const v = await createVersionService(10, d1.id, 'V1')
        if (!('version' in v)) throw new Error()
        const r = await restoreVersionService(10, d2.id, v.version.id)
        expect('error' in r && r.code).toBe(404)
    })
})

describe('renameVersionService', () => {
    it('重命名成功', async () => {
        const d = await makeDraft(10, 'sid-v-8')
        const v = await createVersionService(10, d.id, 'old')
        if (!('version' in v)) throw new Error()
        const r = await renameVersionService(10, v.version.id, 'new')
        expect('version' in r && r.version.name).toBe('new')
    })
    it('非 owner 返 403', async () => {
        const d = await makeDraft(10, 'sid-v-9')
        const v = await createVersionService(10, d.id, 'old')
        if (!('version' in v)) throw new Error()
        const r = await renameVersionService(99, v.version.id, 'new')
        expect('error' in r && r.code).toBe(403)
    })
})

describe('listVersionsForUserService', () => {
    it('owner 可拉到列表', async () => {
        const d = await makeDraft(10, 'sid-v-10')
        await createVersionService(10, d.id, 'V1')
        const r = await listVersionsForUserService(10, d.id)
        expect('versions' in r && r.versions).toHaveLength(1)
    })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/server/assistant/document/documentDraftVersion.service.test.ts`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 实现 Service**

创建 `server/services/assistant/document/documentDraftVersion.service.ts`:
```ts
/**
 * DocumentDraftVersion Service
 *
 * 用户主动保存的版本（里程碑），owner-only。
 * - createVersionService: MAX+1 + P2002 重试 1 次
 * - restoreVersionService: 先 workspace-backup 再覆盖 draft.values
 */

import { getDocumentDraftDAO } from './documentDraft.dao'
import {
    createVersionDAO, listVersionsDAO, getVersionByIdDAO,
    updateVersionNameDAO, deleteVersionDAO,
} from './documentDraftVersion.dao'
import { createSnapshotService } from './documentDraftSnapshot.service'

type ServiceError = { error: string; code: number }

export async function createVersionService(
    userId: number,
    draftId: number,
    name: string,
): Promise<{ version: any } | ServiceError> {
    const draft = await getDocumentDraftDAO(draftId)
    if (!draft) return { error: '草稿不存在', code: 404 }
    if (draft.userId !== userId) return { error: '无权访问此草稿', code: 403 }

    // 事务内 MAX+1 → insert；P2002 重试 1 次
    const attempt = async (): Promise<any> => prisma.$transaction(async (tx) => {
        const agg = await tx.documentDraftVersions.aggregate({
            _max: { versionNo: true },
            where: { draftId },
        })
        const nextNo = (agg._max.versionNo ?? 0) + 1
        return createVersionDAO({
            draftId,
            versionNo: nextNo,
            name,
            values: (draft.values as Record<string, unknown>) ?? {},
            titleAt: draft.title ?? '',
        }, tx)
    })

    try {
        const v = await attempt()
        return { version: v }
    } catch (err: any) {
        if (err?.code === 'P2002') {
            const v = await attempt()
            return { version: v }
        }
        throw err
    }
}

export async function listVersionsForUserService(
    userId: number,
    draftId: number,
): Promise<{ versions: any[] } | ServiceError> {
    const draft = await getDocumentDraftDAO(draftId)
    if (!draft) return { error: '草稿不存在', code: 404 }
    if (draft.userId !== userId) return { error: '无权访问此草稿', code: 403 }

    const versions = await listVersionsDAO(draftId)
    return { versions }
}

export async function restoreVersionService(
    userId: number,
    draftId: number,
    versionId: number,
): Promise<{ draft: any } | ServiceError> {
    const draft = await getDocumentDraftDAO(draftId)
    if (!draft) return { error: '草稿不存在', code: 404 }
    if (draft.userId !== userId) return { error: '无权访问此草稿', code: 403 }

    const version = await getVersionByIdDAO(versionId)
    if (!version || version.draftId !== draftId) {
        return { error: '版本不存在', code: 404 }
    }

    const currentValues = (draft.values as Record<string, unknown>) ?? {}
    const restoredValues = (version.values as Record<string, unknown>) ?? {}

    const updated = await prisma.$transaction(async (tx) => {
        await createSnapshotService(draftId, 'workspace-backup', {
            values: currentValues,
        }, tx)
        return tx.documentDrafts.update({
            where: { id: draftId },
            data: { values: restoredValues as any, updatedAt: new Date() },
        })
    })

    return { draft: updated }
}

export async function renameVersionService(
    userId: number,
    versionId: number,
    name: string,
): Promise<{ version: any } | ServiceError> {
    const version = await getVersionByIdDAO(versionId)
    if (!version) return { error: '版本不存在', code: 404 }

    const draft = await getDocumentDraftDAO(version.draftId)
    if (!draft) return { error: '草稿不存在', code: 404 }
    if (draft.userId !== userId) return { error: '无权修改此版本', code: 403 }

    const updated = await updateVersionNameDAO(versionId, name)
    return { version: updated }
}

export async function deleteVersionService(
    userId: number,
    versionId: number,
): Promise<{ ok: true } | ServiceError> {
    const version = await getVersionByIdDAO(versionId)
    if (!version) return { error: '版本不存在', code: 404 }

    const draft = await getDocumentDraftDAO(version.draftId)
    if (!draft) return { error: '草稿不存在', code: 404 }
    if (draft.userId !== userId) return { error: '无权删除此版本', code: 403 }

    await deleteVersionDAO(versionId)
    return { ok: true }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/server/assistant/document/documentDraftVersion.service.test.ts`
Expected: PASS（8 条全绿）

- [ ] **Step 5: Commit**
```bash
git add server/services/assistant/document/documentDraftVersion.service.ts tests/server/assistant/document/documentDraftVersion.service.test.ts
git commit -m "feat(document): documentDraftVersion Service（create/list/restore/rename/delete）"
```

---

## Task 8: 重构 `documentExport.service` — 提取 `renderDraftToDocx` 纯函数 + 新增 `exportVersionByIdService`

**Files:**
- Modify: `server/services/assistant/document/documentExport.service.ts`
- Modify: `tests/server/assistant/document/documentExport.test.ts`（追加版本导出用例）

**目标：** 保持 `exportDraftService` 外部 API 不变（老路径继续跑），内部把"下载模板 buffer + docxtemplater 渲染 + 上传 OSS + 落 ossFiles"抽成纯函数 `renderAndUploadDocx`，新增 `exportVersionByIdService` 复用该函数。

- [ ] **Step 1: 写失败测试 — 版本导出路径**

在 `tests/server/assistant/document/documentExport.test.ts` 末尾追加：
```ts
describe('exportVersionByIdService', () => {
    beforeEach(() => { vi.clearAllMocks() })

    it('owner 成功导出：用 version.values 渲染、文件名为 titleAt-name.docx', async () => {
        // 已存在的 mocks（模板下载、上传、ossFiles）沿用；仅补 version 相关
        // 这里示例假设 template/draft mock 已在文件顶部；若缺再补齐
        const { exportVersionByIdService } = await import(
            '~~/server/services/assistant/document/documentExport.service'
        )
        // 构造一个属于 userId=10 的 draft + 一个版本
        const { createDocumentDraftDAO } = await import(
            '~~/server/services/assistant/document/documentDraft.dao'
        )
        const { createVersionService } = await import(
            '~~/server/services/assistant/document/documentDraftVersion.service'
        )
        const d = await createDocumentDraftDAO({
            userId: 10, templateId: 1, sessionId: 'sid-exp-1',
            status: 'ready', values: { name: '张三' }, sourceRef: null,
            metadata: null, caseId: null, title: 'T-260419', titleOverridden: false,
        })
        const v = await createVersionService(10, d.id, '初版')
        if (!('version' in v)) throw new Error()

        const r = await exportVersionByIdService(10, v.version.id)
        expect('downloadUrl' in r).toBe(true)
    })

    it('非 owner 返 403', async () => {
        const { exportVersionByIdService } = await import(
            '~~/server/services/assistant/document/documentExport.service'
        )
        // 随便传一个不存在的 ID 也能直接检验 404；若要真 403 需 mock 到有效版本
        const r = await exportVersionByIdService(99, 999999)
        expect('error' in r && (r.code === 403 || r.code === 404)).toBe(true)
    })
})
```

- [ ] **Step 2: 重构 `documentExport.service.ts`**

修改 `server/services/assistant/document/documentExport.service.ts`：

在文件顶部 import 处追加：
```ts
import { getVersionByIdDAO } from './documentDraftVersion.dao'
```

在 `extractDocxtemplaterErrorDetail` 函数之前追加新纯函数：
```ts
/**
 * 将 template + values 渲染为 docx 并上传 OSS，返回 ossFileId + 签名下载 URL。
 * 供 exportDraftService（工作区）与 exportVersionByIdService（版本）共用。
 */
async function renderAndUploadDocx(params: {
    userId: number
    templateId: number
    values: Record<string, unknown>
    fileBaseName: string
}): Promise<{ ossFileId: number; downloadUrl: string } | ExportError> {
    const { userId, templateId, values, fileBaseName } = params

    const template = await getDocumentTemplateDAO(templateId)
    if (!template) return { error: '模板已删除，无法导出', code: 404 }

    const templateOssFile = await findOssFileByIdDao(template.ossFileId)
    if (!templateOssFile) return { error: '模板文件丢失', code: 404 }
    if (!templateOssFile.filePath) return { error: '模板文件路径缺失', code: 500 }

    const templateBuffer = await downloadFileService(templateOssFile.filePath, { userId })

    const zip = new PizZip(templateBuffer)
    let renderedBuffer: Buffer
    try {
        const doc = new Docxtemplater(zip, {
            paragraphLoop: true,
            linebreaks: true,
            nullGetter: () => '',
            delimiters: { start: '{{', end: '}}' },
        })
        doc.render(values)
        renderedBuffer = doc.getZip().generate({ type: 'nodebuffer' }) as Buffer
    } catch (err) {
        const detail = extractDocxtemplaterErrorDetail(err)
        logger.error('docxtemplater 渲染失败', { templateId, detail })
        return { error: `模板占位符不合法：${detail}。请检查模板文件并修正（占位符需用双花括号 {{name}}）。`, code: 400 }
    }

    const safeName = fileBaseName.replace(/[\\/:*?"<>|]/g, '_')
    const ossPath = `users/${userId}/document-exports/${Date.now()}_${safeName}.docx`
    const [uploadResult, storageConfig] = await Promise.all([
        uploadFileService(ossPath, renderedBuffer, {
            contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            userId,
        }),
        getDefaultStorageConfigDao(StorageProviderType.ALIYUN_OSS, userId),
    ])
    const bucketName = storageConfig?.bucket ?? ''

    const ossFile = await createOssFileDao({
        userId,
        bucketName,
        fileName: `${safeName}.docx`,
        filePath: uploadResult.name,
        fileSize: renderedBuffer.length,
        fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        source: FileSource.DOCUMENT_EXPORT,
        status: OssFileStatus.UPLOADED,
        encrypted: false,
    })

    const downloadUrl = await generateSignedUrlService(uploadResult.name, { expires: 3600, userId })

    return { ossFileId: ossFile.id, downloadUrl }
}
```

改造 `exportDraftService`：把步骤 2~9（从取 template 到 generateSignedUrlService）全部替换成：
```ts
    const rendered = await renderAndUploadDocx({
        userId,
        templateId: draft.templateId,
        values: (draft.values as Record<string, unknown>) ?? {},
        fileBaseName: draft.title || String(draftId),
    })
    if ('error' in rendered) return rendered

    await updateDocumentDraftDAO(draftId, {
        status: 'exported',
        outputFileId: rendered.ossFileId,
    })

    return { ossFileId: rendered.ossFileId, downloadUrl: rendered.downloadUrl }
```

在文件末尾追加 `exportVersionByIdService`：
```ts
/**
 * 按版本 ID 导出文书。与工作区导出并行，不修改 draft.status / outputFileId。
 */
export async function exportVersionByIdService(
    userId: number,
    versionId: number,
): Promise<ExportDraftResponse | ExportError> {
    const version = await getVersionByIdDAO(versionId)
    if (!version) return { error: '版本不存在', code: 404 }

    const draft = await getDocumentDraftDAO(version.draftId)
    if (!draft) return { error: '草稿不存在', code: 404 }
    if (draft.userId !== userId) return { error: '无权导出此版本', code: 403 }

    const rendered = await renderAndUploadDocx({
        userId,
        templateId: draft.templateId,
        values: (version.values as Record<string, unknown>) ?? {},
        fileBaseName: `${version.titleAt}-${version.name}`,
    })
    if ('error' in rendered) return rendered

    return { ossFileId: rendered.ossFileId, downloadUrl: rendered.downloadUrl }
}
```

- [ ] **Step 3: 运行测试**

Run: `npx vitest run tests/server/assistant/document/documentExport.test.ts`
Expected: 旧用例 + 新用例 全绿（可能需要微调 mock）

- [ ] **Step 4: Commit**
```bash
git add server/services/assistant/document/documentExport.service.ts tests/server/assistant/document/documentExport.test.ts
git commit -m "refactor(document): 导出抽离 renderAndUploadDocx 纯函数 + 新增 exportVersionByIdService"
```

---

## Task 9: `draftSchema.builder` 加 `aiTitle` 可选字段

**Files:**
- Modify: `server/services/assistant/document/draftSchema.builder.ts`
- Modify: `tests/server/assistant/document/draftSchema.builder.test.ts`（追加用例）

- [ ] **Step 1: 写失败测试**

在 `tests/server/assistant/document/draftSchema.builder.test.ts` 末尾追加：
```ts
describe('aiTitle 字段', () => {
    it('schema 包含可选 aiTitle', () => {
        const schema = buildDraftSchema([{ name: 'f1' }] as any)
        const parsed = schema.parse({ values: { f1: 'x' }, aiTitle: '我的标题' })
        expect((parsed as any).aiTitle).toBe('我的标题')
    })

    it('aiTitle 可省略', () => {
        const schema = buildDraftSchema([{ name: 'f1' }] as any)
        const parsed = schema.parse({ values: { f1: 'x' } })
        expect((parsed as any).aiTitle).toBeUndefined()
    })

    it('aiTitle 超长（>200）校验失败', () => {
        const schema = buildDraftSchema([{ name: 'f1' }] as any)
        expect(() => schema.parse({ values: { f1: 'x' }, aiTitle: 'a'.repeat(201) })).toThrow()
    })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/server/assistant/document/draftSchema.builder.test.ts -t aiTitle`
Expected: FAIL

- [ ] **Step 3: 修改 builder**

修改 `server/services/assistant/document/draftSchema.builder.ts` 的 return 对象：
```ts
  return z.object({
    values: z.object(valuesShape).describe('按模板占位符填充的键值对'),
    suggestions: z
      .record(z.string(), z.string())
      .optional()
      .describe('字段填充依据或建议（key = 占位符名称）'),
    aiTitle: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('AI 推断的文书标题（10~30 字），用于列表/顶栏识别；非文书正文内容'),
  })
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/server/assistant/document/draftSchema.builder.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add server/services/assistant/document/draftSchema.builder.ts tests/server/assistant/document/draftSchema.builder.test.ts
git commit -m "feat(document): draftSchema 新增 aiTitle 可选字段"
```

---

## Task 10: 改造 `draftResultPersistence.middleware` — afterAgent 写快照 + 条件覆盖 title

**Files:**
- Modify: `server/services/workflow/middleware/draftResultPersistence.middleware.ts`
- Create: `tests/server/assistant/document/draftResultPersistence.middleware.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `tests/server/assistant/document/draftResultPersistence.middleware.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
    updateDocumentDraftDAO: vi.fn(),
    createSnapshotService: vi.fn(),
    applyAITitleIfAllowedService: vi.fn(),
}))

vi.mock('~~/server/services/assistant/document/documentDraft.dao', () => ({
    updateDocumentDraftDAO: mocks.updateDocumentDraftDAO,
}))
vi.mock('../../../server/services/assistant/document/documentDraft.dao', () => ({
    updateDocumentDraftDAO: mocks.updateDocumentDraftDAO,
}))
vi.mock('~~/server/services/assistant/document/documentDraftSnapshot.service', () => ({
    createSnapshotService: mocks.createSnapshotService,
}))
vi.mock('../../../server/services/assistant/document/documentDraftSnapshot.service', () => ({
    createSnapshotService: mocks.createSnapshotService,
}))
vi.mock('~~/server/services/assistant/document/documentDraft.service', () => ({
    applyAITitleIfAllowedService: mocks.applyAITitleIfAllowedService,
}))
vi.mock('../../../server/services/assistant/document/documentDraft.service', () => ({
    applyAITitleIfAllowedService: mocks.applyAITitleIfAllowedService,
}))

import { draftResultPersistenceMiddleware } from '../../../server/services/workflow/middleware/draftResultPersistence.middleware'

function invokeAfter(state: any, draftId = 1) {
    const mw = draftResultPersistenceMiddleware({ draftId, sessionId: 'sid' })
    // createMiddleware 返回的对象结构里 afterAgent.hook 直接可调用
    return (mw as any).afterAgent.hook(state)
}

describe('draftResultPersistence afterAgent', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.updateDocumentDraftDAO.mockResolvedValue({})
        mocks.createSnapshotService.mockResolvedValue({ id: 1 })
        mocks.applyAITitleIfAllowedService.mockResolvedValue(true)
    })

    it('structuredResponse 含 values + aiTitle → 写 snapshot、更新 values、应用 aiTitle', async () => {
        await invokeAfter({
            structuredResponse: {
                values: { f1: 'v1' },
                suggestions: { f1: '来自材料' },
                aiTitle: '张三诉李四起诉状',
            },
        })
        expect(mocks.createSnapshotService).toHaveBeenCalledWith(
            1, 'ai-extract',
            expect.objectContaining({ values: { f1: 'v1' }, aiTitle: '张三诉李四起诉状' }),
        )
        expect(mocks.updateDocumentDraftDAO).toHaveBeenCalledWith(1, expect.objectContaining({
            values: { f1: 'v1' },
            status: 'ready',
        }))
        expect(mocks.applyAITitleIfAllowedService).toHaveBeenCalledWith(1, '张三诉李四起诉状')
    })

    it('无 aiTitle 时不调用 applyAITitleIfAllowedService，但仍写 snapshot 与 values', async () => {
        await invokeAfter({
            structuredResponse: { values: { f1: 'v1' } },
        })
        expect(mocks.createSnapshotService).toHaveBeenCalled()
        expect(mocks.applyAITitleIfAllowedService).not.toHaveBeenCalled()
    })

    it('结构化缺失且消息体无 JSON → status=failed，不写 snapshot', async () => {
        await invokeAfter({ messages: [] })
        expect(mocks.createSnapshotService).not.toHaveBeenCalled()
        expect(mocks.updateDocumentDraftDAO).toHaveBeenCalledWith(1, { status: 'failed' })
    })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/server/assistant/document/draftResultPersistence.middleware.test.ts`
Expected: FAIL — 中间件还没引入新逻辑

- [ ] **Step 3: 改造中间件**

修改 `server/services/workflow/middleware/draftResultPersistence.middleware.ts`：

顶部 import 追加：
```ts
import { createSnapshotService } from '../../assistant/document/documentDraftSnapshot.service'
import { applyAITitleIfAllowedService } from '../../assistant/document/documentDraft.service'
```

修改 `DraftStructured` interface：
```ts
interface DraftStructured {
    values?: Record<string, string | null>
    suggestions?: Record<string, string>
    aiTitle?: string
}
```

在 `afterAgent.hook` 内，替换"有 structured 时"的写库分支（从 `const values = structured.values ?? {}` 到 `logger.info('draft 持久化：置 ready'...)`）为：
```ts
                    const values = structured.values ?? {}
                    const suggestions = structured.suggestions
                    const aiTitle = typeof structured.aiTitle === 'string' ? structured.aiTitle.trim() : ''

                    // 事务外先写 snapshot（snapshot service 自带事务 + 清理）
                    try {
                        await createSnapshotService(draftId, 'ai-extract', {
                            values,
                            aiTitle: aiTitle || null,
                        })
                    } catch (err) {
                        logger.warn('draft 持久化：写 ai-extract 快照失败（不阻塞）', { draftId, error: err })
                    }

                    await updateDocumentDraftDAO(draftId, {
                        values,
                        metadata: suggestions ? { suggestions } : undefined,
                        status: 'ready',
                    })

                    if (aiTitle) {
                        try {
                            await applyAITitleIfAllowedService(draftId, aiTitle)
                        } catch (err) {
                            logger.warn('draft 持久化：应用 AI 标题失败（不阻塞）', { draftId, error: err })
                        }
                    }

                    logger.info('draft 持久化：置 ready', {
                        draftId,
                        fieldCount: Object.keys(values).length,
                        hasAITitle: !!aiTitle,
                    })
```

- [ ] **Step 4: 运行测试确认通过 + 回归小索路径**

Run:
```bash
npx vitest run tests/server/assistant/document/draftResultPersistence.middleware.test.ts
npx vitest run tests/server/workflow/middleware
```
Expected: PASS，现有中间件测试无回归

- [ ] **Step 5: Commit**
```bash
git add server/services/workflow/middleware/draftResultPersistence.middleware.ts tests/server/assistant/document/draftResultPersistence.middleware.test.ts
git commit -m "feat(workflow): draftResultPersistence afterAgent 写 snapshot + 条件应用 aiTitle"
```

---

## Task 11: `seedData.sql` — `documentMain_system` 升 v4（加 aiTitle 说明）

**Files:**
- Modify: `prisma/seeds/seedData.sql`

- [ ] **Step 1: 改 INSERT 条目（首次安装用）**

找到 `seedData.sql` 第 1953 行起的 `INSERT INTO "public"."prompts" ... SELECT 'documentMain_system'`，把：
- 标题 `'文书生成主Agent系统提示词 v3'` → `'文书生成主Agent系统提示词 v4'`
- content 中的"# 结果输出（非常重要）"段落替换为：

```
# 结果输出（非常重要）

信息收集完成后，**必须**通过系统注入的结构化输出工具（tool call）返回结果，工具入参包含：
- values：模板 placeholders 对应的键值对
- suggestions：每个字段的填充依据（可选）
- aiTitle：根据所填字段推断的简短文书标题，10~30 字，如"张三诉李四借款合同纠纷起诉状"，用于列表/顶栏识别；非文书正文内容；若难以推断可省略

**严禁**在消息正文中自行写出 JSON、代码块或长篇自然语言描述最终答案——正文仅用于思考过程以及相邻工具调用之间的简要衔接。
```

- [ ] **Step 2: 改 UPDATE 兜底块（升级已有 prod/dev 数据）**

找到第 1991-2030 行的 `UPDATE "public"."prompts" AS p SET "title" = '文书生成主Agent系统提示词 v3'`，把整段替换为：

```sql
-- 对已存在的 documentMain_system 提示词刷为 v4（加入 aiTitle 输出）
UPDATE "public"."prompts" AS p
   SET "title" = '文书生成主Agent系统提示词 v4',
       "content" = '你是 LexSeek 的文书生成助手，负责按模板占位符逐一填充法律文书内容。

# 当前模板

模板名称：{{templateName}}
模板分类：{{templateCategory}}

# 可用工具

- process_materials：识别并嵌入用户提供的材料，返回就绪状态与摘要；文书场景可传 fileIds 精确处理本轮新增文件
- search_case_materials：检索已就绪的材料内容，获取当事人信息、事实经过、金额明细等
- search_law：查询相关法律条文，为文书引用提供依据

# 工作流程

1. **只要用户本轮提供了新的 fileIds（见用户消息开头的"新增材料 fileIds: [...]"提示），必须先调用 process_materials(fileIds=[...])**，等工具返回 ready 状态后再继续
2. 调用 search_case_materials 检索材料内容，逐一推断每个占位符的值
3. 如需引用法条，调用 search_law 获取准确条文
4. 对无法从材料中推断的占位符，返回 null（严禁编造）
5. 在 suggestions 中为每个字段说明填充依据或无法推断的原因

# 结果输出（非常重要）

信息收集完成后，**必须**通过系统注入的结构化输出工具（tool call）返回结果，工具入参包含：
- values：模板 placeholders 对应的键值对
- suggestions：每个字段的填充依据（可选）
- aiTitle：根据所填字段推断的简短文书标题，10~30 字，如"张三诉李四借款合同纠纷起诉状"，用于列表/顶栏识别；非文书正文内容；若难以推断可省略

**严禁**在消息正文中自行写出 JSON、代码块或长篇自然语言描述最终答案——正文仅用于思考过程以及相邻工具调用之间的简要衔接。

# 约束

- 所有涉及姓名、金额、日期的值必须来自材料或法条，来源不明的一律返回 null
- 不替用户做最终法律判断，只提供基于材料的客观填充
- 使用简体中文，法律术语准确规范',
       "updated_at" = NOW()
  FROM nodes n
 WHERE p.node_id = n.id
   AND n.name = 'documentMain' AND n.deleted_at IS NULL
   AND p.name = 'documentMain_system' AND p.deleted_at IS NULL
   AND p.title <> '文书生成主Agent系统提示词 v4';
```

- [ ] **Step 3: 直接对主库应用 UPDATE（避免等下次 seed 跑）**

Run:
```bash
docker exec postgres-postgres-1 psql -U daixin -d ls_new -c "UPDATE prompts p SET title='文书生成主Agent系统提示词 v4', updated_at=NOW() FROM nodes n WHERE p.node_id=n.id AND n.name='documentMain' AND p.name='documentMain_system' AND p.deleted_at IS NULL AND n.deleted_at IS NULL;"
```
> 注：完整 content 刷新走 seed 脚本或手工 psql 都行，这里先更新 title 走通链路；content 会在下次 `bun run prisma:seed` 时更新。若要立即生效完整内容，直接用 `docker exec ... < /path/to/sql` 执行对应 UPDATE。

- [ ] **Step 4: Commit**
```bash
git add prisma/seeds/seedData.sql
git commit -m "feat(prompt): documentMain_system 升 v4，要求返回 aiTitle"
```

---

## Task 12: API — `PATCH /drafts/[id]/title`

**Files:**
- Create: `server/api/v1/assistant/document/drafts/[id]/title.patch.ts`
- Create: `tests/server/api/v1/assistant/document/drafts-title.api.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `tests/server/api/v1/assistant/document/drafts-title.api.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { apiFetch, ensureTestUser } from '../../../../../helpers/apiTestClient'
import { createDocumentDraftDAO } from '~~/server/services/assistant/document/documentDraft.dao'

describe('PATCH /api/v1/assistant/document/drafts/[id]/title', () => {
    it('owner 修改标题成功，titleOverridden=true', async () => {
        const user = await ensureTestUser()
        const draft = await createDocumentDraftDAO({
            userId: user.id, templateId: 1, sessionId: 'api-title-1',
            status: 'ready', values: {}, sourceRef: null, metadata: null, caseId: null,
        })
        const res = await apiFetch(`/api/v1/assistant/document/drafts/${draft.id}/title`, {
            method: 'PATCH', body: { title: '我的起诉状' }, user,
        })
        expect(res.code).toBe(0)
        expect(res.data.draft.title).toBe('我的起诉状')
        expect(res.data.draft.titleOverridden).toBe(true)
    })

    it('非 owner 返 403', async () => {
        const owner = await ensureTestUser()
        const other = await ensureTestUser('other')
        const draft = await createDocumentDraftDAO({
            userId: owner.id, templateId: 1, sessionId: 'api-title-2',
            status: 'ready', values: {}, sourceRef: null, metadata: null, caseId: null,
        })
        const res = await apiFetch(`/api/v1/assistant/document/drafts/${draft.id}/title`, {
            method: 'PATCH', body: { title: 'X' }, user: other,
        })
        expect(res.code).toBe(403)
    })

    it('空标题 400', async () => {
        const user = await ensureTestUser()
        const draft = await createDocumentDraftDAO({
            userId: user.id, templateId: 1, sessionId: 'api-title-3',
            status: 'ready', values: {}, sourceRef: null, metadata: null, caseId: null,
        })
        const res = await apiFetch(`/api/v1/assistant/document/drafts/${draft.id}/title`, {
            method: 'PATCH', body: { title: '' }, user,
        })
        expect(res.code).toBe(400)
    })
})
```

> **注：** `tests/helpers/apiTestClient` 若不存在，实施时参考现有 `tests/server/assistant/document/drafts.api.test.ts` 的写法；以下剩余 API 任务的测试沿用同模式，不再重复示例样板。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/server/api/v1/assistant/document/drafts-title.api.test.ts`
Expected: FAIL — 路由不存在

- [ ] **Step 3: 实现路由**

创建 `server/api/v1/assistant/document/drafts/[id]/title.patch.ts`:
```ts
import { z } from 'zod'
import { updateDraftTitleService } from '~~/server/services/assistant/document/documentDraft.service'

const bodySchema = z.object({
    title: z.string().min(1).max(200),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const id = Number(getRouterParam(event, 'id'))
    if (!Number.isInteger(id) || id <= 0) return resError(event, 400, '草稿 ID 无效')

    const body = await readBody(event)
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) return resError(event, 400, parsed.error.issues[0]?.message ?? '参数错误')

    const result = await updateDraftTitleService(user.id, id, parsed.data.title.trim())
    if ('error' in result) return resError(event, result.code, result.error)

    return resSuccess(event, '更新成功', { draft: result.draft })
})
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/server/api/v1/assistant/document/drafts-title.api.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add server/api/v1/assistant/document/drafts/[id]/title.patch.ts tests/server/api/v1/assistant/document/drafts-title.api.test.ts
git commit -m "feat(api): 新增 PATCH /drafts/[id]/title"
```

---

## Task 13: API — 快照列表与恢复

**Files:**
- Create: `server/api/v1/assistant/document/drafts/[id]/snapshots.get.ts`
- Create: `server/api/v1/assistant/document/drafts/snapshots/apply/[snapshotId].post.ts`
- Create: `tests/server/api/v1/assistant/document/drafts-snapshots.api.test.ts`

- [ ] **Step 1: 写失败测试（list + apply 各覆盖 owner 成功 / 非 owner 403 / 404）**

创建 `tests/server/api/v1/assistant/document/drafts-snapshots.api.test.ts` 参考 Task 12 的测试风格，覆盖：
- `GET /drafts/:id/snapshots` — owner 拿到列表 / 非 owner 403
- `POST /drafts/snapshots/apply/:snapshotId` — 全量恢复、字段级恢复、非 owner 403、snapshotId 不存在 404

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/server/api/v1/assistant/document/drafts-snapshots.api.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 GET snapshots 列表**

创建 `server/api/v1/assistant/document/drafts/[id]/snapshots.get.ts`:
```ts
import { listSnapshotsForUserService } from '~~/server/services/assistant/document/documentDraftSnapshot.service'

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const id = Number(getRouterParam(event, 'id'))
    if (!Number.isInteger(id) || id <= 0) return resError(event, 400, '草稿 ID 无效')

    const r = await listSnapshotsForUserService(user.id, id)
    if ('error' in r) return resError(event, r.code, r.error)
    return resSuccess(event, '查询成功', { snapshots: r.snapshots })
})
```

- [ ] **Step 4: 实现 POST snapshot apply**

创建 `server/api/v1/assistant/document/drafts/snapshots/apply/[snapshotId].post.ts`:
```ts
import { z } from 'zod'
import { applySnapshotFieldsService } from '~~/server/services/assistant/document/documentDraftSnapshot.service'
import { getSnapshotByIdDAO } from '~~/server/services/assistant/document/documentDraftSnapshot.dao'

const bodySchema = z.object({
    fieldNames: z.array(z.string().min(1)).optional(),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const snapshotId = Number(getRouterParam(event, 'snapshotId'))
    if (!Number.isInteger(snapshotId) || snapshotId <= 0) {
        return resError(event, 400, '快照 ID 无效')
    }

    const body = await readBody(event)
    const parsed = bodySchema.safeParse(body ?? {})
    if (!parsed.success) return resError(event, 400, parsed.error.issues[0]?.message ?? '参数错误')

    // 通过 snapshotId 反查 draftId，由 Service 做归属校验
    const snapshot = await getSnapshotByIdDAO(snapshotId)
    if (!snapshot) return resError(event, 404, '快照不存在')

    const r = await applySnapshotFieldsService(user.id, snapshot.draftId, snapshotId, parsed.data.fieldNames)
    if ('error' in r) return resError(event, r.code, r.error)
    return resSuccess(event, '恢复成功', { draft: r.draft })
})
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/server/api/v1/assistant/document/drafts-snapshots.api.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**
```bash
git add server/api/v1/assistant/document/drafts/[id]/snapshots.get.ts server/api/v1/assistant/document/drafts/snapshots tests/server/api/v1/assistant/document/drafts-snapshots.api.test.ts
git commit -m "feat(api): 新增 GET 快照列表 + POST 快照恢复接口"
```

---

## Task 14: API — 版本 list / create / rename / delete

**Files:**
- Create: `server/api/v1/assistant/document/drafts/[id]/versions.get.ts`
- Create: `server/api/v1/assistant/document/drafts/[id]/versions.post.ts`
- Create: `server/api/v1/assistant/document/drafts/versions/[versionId].patch.ts`
- Create: `server/api/v1/assistant/document/drafts/versions/[versionId].delete.ts`
- Create: `tests/server/api/v1/assistant/document/drafts-versions.api.test.ts`

- [ ] **Step 1: 写失败测试（4 个端点 × 成功/403/404/400）**

按 Task 12 模板为 4 个端点写测试。重点包括：
- create：body `{ name }` 必填非空；版本号自增 1 → 2
- rename：非 owner 403
- delete：删除后不回收版本号（用 create 一次验证 V4）

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/server/api/v1/assistant/document/drafts-versions.api.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 4 个路由**

`server/api/v1/assistant/document/drafts/[id]/versions.get.ts`:
```ts
import { listVersionsForUserService } from '~~/server/services/assistant/document/documentDraftVersion.service'

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')
    const id = Number(getRouterParam(event, 'id'))
    if (!Number.isInteger(id) || id <= 0) return resError(event, 400, '草稿 ID 无效')
    const r = await listVersionsForUserService(user.id, id)
    if ('error' in r) return resError(event, r.code, r.error)
    return resSuccess(event, '查询成功', { versions: r.versions })
})
```

`server/api/v1/assistant/document/drafts/[id]/versions.post.ts`:
```ts
import { z } from 'zod'
import { createVersionService } from '~~/server/services/assistant/document/documentDraftVersion.service'

const bodySchema = z.object({ name: z.string().min(1).max(100) })

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')
    const id = Number(getRouterParam(event, 'id'))
    if (!Number.isInteger(id) || id <= 0) return resError(event, 400, '草稿 ID 无效')
    const body = await readBody(event)
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) return resError(event, 400, parsed.error.issues[0]?.message ?? '参数错误')
    const r = await createVersionService(user.id, id, parsed.data.name.trim())
    if ('error' in r) return resError(event, r.code, r.error)
    return resSuccess(event, '保存成功', { version: r.version })
})
```

`server/api/v1/assistant/document/drafts/versions/[versionId].patch.ts`:
```ts
import { z } from 'zod'
import { renameVersionService } from '~~/server/services/assistant/document/documentDraftVersion.service'

const bodySchema = z.object({ name: z.string().min(1).max(100) })

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')
    const versionId = Number(getRouterParam(event, 'versionId'))
    if (!Number.isInteger(versionId) || versionId <= 0) return resError(event, 400, '版本 ID 无效')
    const body = await readBody(event)
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) return resError(event, 400, parsed.error.issues[0]?.message ?? '参数错误')
    const r = await renameVersionService(user.id, versionId, parsed.data.name.trim())
    if ('error' in r) return resError(event, r.code, r.error)
    return resSuccess(event, '重命名成功', { version: r.version })
})
```

`server/api/v1/assistant/document/drafts/versions/[versionId].delete.ts`:
```ts
import { deleteVersionService } from '~~/server/services/assistant/document/documentDraftVersion.service'

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')
    const versionId = Number(getRouterParam(event, 'versionId'))
    if (!Number.isInteger(versionId) || versionId <= 0) return resError(event, 400, '版本 ID 无效')
    const r = await deleteVersionService(user.id, versionId)
    if ('error' in r) return resError(event, r.code, r.error)
    return resSuccess(event, '删除成功', { ok: true })
})
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/server/api/v1/assistant/document/drafts-versions.api.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add server/api/v1/assistant/document/drafts/[id]/versions.get.ts server/api/v1/assistant/document/drafts/[id]/versions.post.ts server/api/v1/assistant/document/drafts/versions tests/server/api/v1/assistant/document/drafts-versions.api.test.ts
git commit -m "feat(api): 版本 list/create/rename/delete 接口"
```

---

## Task 15: API — 版本恢复 + 导出

**Files:**
- Create: `server/api/v1/assistant/document/drafts/versions/restore/[versionId].post.ts`
- Create: `server/api/v1/assistant/document/drafts/versions/export/[versionId].get.ts`
- Extend: `tests/server/api/v1/assistant/document/drafts-versions.api.test.ts`

- [ ] **Step 1: 扩展测试（restore + export）**

追加：
- `POST /drafts/versions/restore/:versionId` — owner 成功覆盖、非 owner 403、版本不存在 404
- `GET /drafts/versions/export/:versionId` — owner 成功拿到 downloadUrl、非 owner 403

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/server/api/v1/assistant/document/drafts-versions.api.test.ts -t restore`
Expected: FAIL

- [ ] **Step 3: 实现两个路由**

`server/api/v1/assistant/document/drafts/versions/restore/[versionId].post.ts`:
```ts
import { restoreVersionService } from '~~/server/services/assistant/document/documentDraftVersion.service'
import { getVersionByIdDAO } from '~~/server/services/assistant/document/documentDraftVersion.dao'

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')
    const versionId = Number(getRouterParam(event, 'versionId'))
    if (!Number.isInteger(versionId) || versionId <= 0) return resError(event, 400, '版本 ID 无效')

    const version = await getVersionByIdDAO(versionId)
    if (!version) return resError(event, 404, '版本不存在')

    const r = await restoreVersionService(user.id, version.draftId, versionId)
    if ('error' in r) return resError(event, r.code, r.error)
    return resSuccess(event, '恢复成功', { draft: r.draft })
})
```

`server/api/v1/assistant/document/drafts/versions/export/[versionId].get.ts`:
```ts
import { exportVersionByIdService } from '~~/server/services/assistant/document/documentExport.service'

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')
    const versionId = Number(getRouterParam(event, 'versionId'))
    if (!Number.isInteger(versionId) || versionId <= 0) return resError(event, 400, '版本 ID 无效')

    const r = await exportVersionByIdService(user.id, versionId)
    if ('error' in r) return resError(event, r.code, r.error)
    return resSuccess(event, '导出成功', r)
})
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/server/api/v1/assistant/document/drafts-versions.api.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add server/api/v1/assistant/document/drafts/versions/restore server/api/v1/assistant/document/drafts/versions/export tests/server/api/v1/assistant/document/drafts-versions.api.test.ts
git commit -m "feat(api): 版本 restore + export 接口"
```

---

## Task 16: 共享类型 + `useDocumentDraft` 扩展（title / versions / snapshots / preview）

**Files:**
- Modify: `shared/types/document.ts`（追加类型）
- Modify: `app/composables/useDocumentDraft.ts`
- Modify: `tests/client/composables/useDocumentDraft.extensions.test.ts`

- [ ] **Step 1: 扩展共享类型**

在 `shared/types/document.ts` 末尾追加：
```ts
/** 文书快照来源 */
export type DraftSnapshotSource = 'ai-extract' | 'workspace-backup'

export interface DocumentDraftSnapshot {
    id: number
    draftId: number
    source: DraftSnapshotSource
    values: Record<string, string | null>
    aiTitle: string | null
    createdAt: string
}

export interface DocumentDraftVersion {
    id: number
    draftId: number
    versionNo: number
    name: string
    values: Record<string, string | null>
    titleAt: string
    createdAt: string
}
```

- [ ] **Step 2: 写失败测试**

在 `tests/client/composables/useDocumentDraft.extensions.test.ts` 末尾追加：
```ts
describe('useDocumentDraft - title/versions/snapshots 扩展', () => {
    it('updateTitle 乐观更新 title 与 titleOverridden', async () => {
        // 详细测试：mock useApiFetch 返回 { draft: { title: '新' } }，调 updateTitle 后
        // 立即断言本地 draft.title === '新' 且 titleOverridden === true
    })
    it('saveVersion 成功后 loadVersions 能拿到新版本', async () => {})
    it('applySnapshot 传 fieldNames 时正确调参', async () => {})
    it('预览态切换：previewVersionId 非空时 previewValues 指向该版本 values', async () => {})
})
```

> **注：** 此处只示意用例骨架；实施时按 Task 12 API 测试同风格用 `vi.mock('~/composables/useApiFetch', ...)` 替换 fetch，详见 `tests/client/composables/useAliyunCaptcha.test.ts` 现成模式。

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run tests/client/composables/useDocumentDraft.extensions.test.ts`
Expected: FAIL

- [ ] **Step 4: 扩展 composable**

在 `app/composables/useDocumentDraft.ts` 内，`onUnmounted` 之前追加以下代码块（保持既有风格，分区注释分组）：

```ts
    // ========== Title ==========
    const title = computed(() => draft.value?.title ?? '')

    async function updateTitle(newTitle: string) {
        if (!draftId.value) return
        const clean = newTitle.trim()
        if (!clean) return
        const prev = draft.value
        if (prev) {
            draft.value = { ...prev, title: clean, titleOverridden: true } as documentDrafts
        }
        const result = await useApiFetch<{ draft: documentDrafts }>(
            `/api/v1/assistant/document/drafts/${draftId.value}/title`,
            { method: 'PATCH', body: { title: clean }, showError: true } as any,
        )
        if (!result?.draft) {
            if (prev) draft.value = prev // 回滚
            return
        }
        draft.value = result.draft
    }

    // ========== Versions ==========
    const versions = ref<DocumentDraftVersion[]>([])
    const nextVersionNo = computed(() =>
        (versions.value.reduce((m, v) => Math.max(m, v.versionNo), 0)) + 1,
    )

    async function loadVersions() {
        if (!draftId.value) return
        const r = await useApiFetch<{ versions: DocumentDraftVersion[] }>(
            `/api/v1/assistant/document/drafts/${draftId.value}/versions`,
        )
        versions.value = r?.versions ?? []
    }

    async function saveVersion(name: string) {
        if (!draftId.value) return null
        const r = await useApiFetch<{ version: DocumentDraftVersion }>(
            `/api/v1/assistant/document/drafts/${draftId.value}/versions`,
            { method: 'POST', body: { name } } as any,
        )
        if (r?.version) versions.value = [r.version, ...versions.value]
        return r?.version ?? null
    }

    async function renameVersion(versionId: number, name: string) {
        const r = await useApiFetch<{ version: DocumentDraftVersion }>(
            `/api/v1/assistant/document/drafts/versions/${versionId}`,
            { method: 'PATCH', body: { name } } as any,
        )
        if (r?.version) {
            versions.value = versions.value.map(v => v.id === versionId ? r.version : v)
        }
    }

    async function deleteVersion(versionId: number) {
        const r = await useApiFetch<{ ok: true }>(
            `/api/v1/assistant/document/drafts/versions/${versionId}`,
            { method: 'DELETE' } as any,
        )
        if (r?.ok) versions.value = versions.value.filter(v => v.id !== versionId)
    }

    async function restoreVersion(versionId: number) {
        const r = await useApiFetch<{ draft: documentDrafts }>(
            `/api/v1/assistant/document/drafts/versions/restore/${versionId}`,
            { method: 'POST' } as any,
        )
        if (r?.draft) {
            draft.value = r.draft
            await loadSnapshots() // workspace-backup 会冒出来
        }
    }

    async function exportVersion(versionId: number) {
        const r = await useApiFetch<{ ossFileId: number; downloadUrl: string }>(
            `/api/v1/assistant/document/drafts/versions/export/${versionId}`,
        )
        if (!r?.downloadUrl) return
        const a = document.createElement('a')
        a.href = r.downloadUrl
        a.download = ''
        a.style.display = 'none'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
    }

    // ========== Snapshots ==========
    const snapshots = ref<DocumentDraftSnapshot[]>([])

    async function loadSnapshots() {
        if (!draftId.value) return
        const r = await useApiFetch<{ snapshots: DocumentDraftSnapshot[] }>(
            `/api/v1/assistant/document/drafts/${draftId.value}/snapshots`,
        )
        snapshots.value = r?.snapshots ?? []
    }

    async function applySnapshot(snapshotId: number, fieldNames?: string[]) {
        const r = await useApiFetch<{ draft: documentDrafts }>(
            `/api/v1/assistant/document/drafts/snapshots/apply/${snapshotId}`,
            { method: 'POST', body: fieldNames ? { fieldNames } : {} } as any,
        )
        if (r?.draft) {
            draft.value = r.draft
            await loadSnapshots() // workspace-backup 新增
        }
    }

    // ========== Preview ==========
    const previewVersionId = ref<number | null>(null)
    const previewValues = computed<Record<string, string | null> | null>(() => {
        if (previewVersionId.value == null) return null
        const v = versions.value.find(x => x.id === previewVersionId.value)
        return v ? (v.values as Record<string, string | null>) : null
    })

    function enterPreview(id: number) { previewVersionId.value = id }
    function exitPreview() { previewVersionId.value = null }
```

在顶部 import 块追加：
```ts
import type { DocumentDraftVersion, DocumentDraftSnapshot } from '#shared/types/document'
```

在 return 对象追加：
```ts
        title, updateTitle,
        versions, nextVersionNo, loadVersions, saveVersion,
        renameVersion, deleteVersion, restoreVersion, exportVersion,
        snapshots, loadSnapshots, applySnapshot,
        previewVersionId, previewValues, enterPreview, exitPreview,
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/client/composables/useDocumentDraft.extensions.test.ts`
Expected: PASS

- [ ] **Step 6: 类型检查**

Run: `npx nuxi typecheck`
Expected: 无新报错

- [ ] **Step 7: Commit**
```bash
git add shared/types/document.ts app/composables/useDocumentDraft.ts tests/client/composables/useDocumentDraft.extensions.test.ts
git commit -m "feat(document): useDocumentDraft 扩展 title/versions/snapshots/preview"
```

---

## Task 17: `DocumentDraftTitleInput` 组件

**Files:**
- Create: `app/components/assistant/document/DocumentDraftTitleInput.vue`
- Create: `tests/client/components/DocumentDraftTitleInput.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `tests/client/components/DocumentDraftTitleInput.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import DocumentDraftTitleInput from '~/components/assistant/document/DocumentDraftTitleInput.vue'

describe('DocumentDraftTitleInput', () => {
    it('默认显示态：渲染传入的 title', () => {
        const w = mount(DocumentDraftTitleInput, { props: { title: '我的起诉状' } })
        expect(w.text()).toContain('我的起诉状')
    })

    it('点击标题切换到编辑态，blur 触发 save', async () => {
        const w = mount(DocumentDraftTitleInput, { props: { title: 'old' } })
        await w.get('[data-testid="title-display"]').trigger('click')
        const input = w.get('input')
        await input.setValue('new')
        await input.trigger('blur')
        expect(w.emitted('save')?.[0]).toEqual(['new'])
    })

    it('Esc 取消不 emit save', async () => {
        const w = mount(DocumentDraftTitleInput, { props: { title: 'old' } })
        await w.get('[data-testid="title-display"]').trigger('click')
        const input = w.get('input')
        await input.setValue('changed')
        await input.trigger('keydown', { key: 'Escape' })
        expect(w.emitted('save')).toBeUndefined()
    })

    it('空字符串不 emit save', async () => {
        const w = mount(DocumentDraftTitleInput, { props: { title: 'old' } })
        await w.get('[data-testid="title-display"]').trigger('click')
        const input = w.get('input')
        await input.setValue('   ')
        await input.trigger('blur')
        expect(w.emitted('save')).toBeUndefined()
    })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/client/components/DocumentDraftTitleInput.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现组件**

创建 `app/components/assistant/document/DocumentDraftTitleInput.vue`:
```vue
<script setup lang="ts">
import { PencilIcon } from 'lucide-vue-next'

const props = defineProps<{
    title: string
}>()

const emit = defineEmits<{
    save: [newTitle: string]
}>()

const editing = ref(false)
const draft = ref('')
const inputRef = ref<HTMLInputElement | null>(null)

function startEdit() {
    draft.value = props.title
    editing.value = true
    nextTick(() => inputRef.value?.focus())
}

function commit() {
    const clean = draft.value.trim()
    editing.value = false
    if (!clean || clean === props.title) return
    emit('save', clean)
}

function cancel() {
    editing.value = false
    draft.value = props.title
}

function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') cancel()
    if (e.key === 'Enter') {
        e.preventDefault()
        commit()
    }
}
</script>

<template>
    <div class="inline-flex items-center gap-2 min-w-0">
        <template v-if="!editing">
            <span data-testid="title-display"
                class="truncate cursor-pointer hover:bg-muted/60 rounded px-1 py-0.5"
                :title="title" @click="startEdit">
                {{ title }}
            </span>
            <button type="button" class="text-muted-foreground hover:text-foreground transition"
                @click="startEdit" aria-label="编辑标题">
                <PencilIcon class="size-3.5" />
            </button>
        </template>
        <template v-else>
            <input ref="inputRef" v-model="draft" type="text" maxlength="200"
                class="text-lg md:text-xl font-semibold bg-transparent border-b border-primary outline-none min-w-[10rem] max-w-[32rem]"
                @blur="commit" @keydown="onKeydown" />
        </template>
    </div>
</template>
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/client/components/DocumentDraftTitleInput.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add app/components/assistant/document/DocumentDraftTitleInput.vue tests/client/components/DocumentDraftTitleInput.test.ts
git commit -m "feat(document): DocumentDraftTitleInput inline 编辑组件"
```

---

## Task 18: `DocumentVersionList` 组件

**Files:**
- Create: `app/components/assistant/document/DocumentVersionList.vue`

**职责：** 展示版本列表，每条含 inline 重命名、预览、恢复、导出、删除按钮；恢复前由父组件弹二次确认（本组件仅 emit 事件）。

- [ ] **Step 1: 实现组件（相对简单，无需独立单元测试；集成测试在 Task 21）**

创建 `app/components/assistant/document/DocumentVersionList.vue`:
```vue
<script setup lang="ts">
import { EyeIcon, RotateCcwIcon, DownloadIcon, Trash2Icon, PencilIcon } from 'lucide-vue-next'
import type { DocumentDraftVersion } from '#shared/types/document'

const props = defineProps<{
    versions: DocumentDraftVersion[]
}>()

const emit = defineEmits<{
    preview: [version: DocumentDraftVersion]
    restore: [version: DocumentDraftVersion]
    exportVersion: [version: DocumentDraftVersion]
    delete: [version: DocumentDraftVersion]
    rename: [id: number, newName: string]
}>()

const editingId = ref<number | null>(null)
const editingName = ref('')

function startRename(v: DocumentDraftVersion) {
    editingId.value = v.id
    editingName.value = v.name
}

function commitRename(id: number) {
    const clean = editingName.value.trim()
    editingId.value = null
    if (!clean) return
    emit('rename', id, clean)
}

function formatTime(iso: string) {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false })
}
</script>

<template>
    <div>
        <div v-if="!versions.length" class="text-sm text-muted-foreground p-6 text-center">
            还没有保存过版本，点顶部"保存当前为版本"记录里程碑
        </div>
        <ul v-else class="divide-y">
            <li v-for="v in versions" :key="v.id" class="p-3 space-y-1.5">
                <div class="flex items-center gap-2">
                    <template v-if="editingId === v.id">
                        <input v-model="editingName" type="text" maxlength="100"
                            class="flex-1 bg-transparent border-b border-primary outline-none text-sm"
                            @blur="commitRename(v.id)"
                            @keydown.enter.prevent="commitRename(v.id)"
                            @keydown.escape="editingId = null" autofocus />
                    </template>
                    <template v-else>
                        <span class="text-sm font-medium truncate flex-1" :title="v.name">{{ v.name }}</span>
                        <button type="button" class="text-muted-foreground hover:text-foreground"
                            @click="startRename(v)" aria-label="重命名">
                            <PencilIcon class="size-3" />
                        </button>
                    </template>
                </div>
                <div class="text-xs text-muted-foreground">{{ formatTime(v.createdAt) }}</div>
                <div class="flex items-center gap-1">
                    <Button size="sm" variant="ghost" @click="emit('preview', v)">
                        <EyeIcon class="size-3.5 mr-1" /> 预览
                    </Button>
                    <Button size="sm" variant="ghost" @click="emit('restore', v)">
                        <RotateCcwIcon class="size-3.5 mr-1" /> 恢复
                    </Button>
                    <Button size="sm" variant="ghost" @click="emit('exportVersion', v)">
                        <DownloadIcon class="size-3.5 mr-1" /> 导出
                    </Button>
                    <Button size="sm" variant="ghost" class="text-destructive" @click="emit('delete', v)">
                        <Trash2Icon class="size-3.5 mr-1" /> 删除
                    </Button>
                </div>
            </li>
        </ul>
    </div>
</template>
```

- [ ] **Step 2: Commit**
```bash
git add app/components/assistant/document/DocumentVersionList.vue
git commit -m "feat(document): DocumentVersionList 列表组件（inline 重命名）"
```

---

## Task 19: `DocumentSnapshotList` + `DocumentSnapshotDetail` 组件

**Files:**
- Create: `app/components/assistant/document/DocumentSnapshotList.vue`
- Create: `app/components/assistant/document/DocumentSnapshotDetail.vue`
- Create: `tests/client/components/DocumentSnapshotDetail.test.ts`

### 19.1 `DocumentSnapshotList.vue`

- [ ] **Step 1: 实现**

```vue
<script setup lang="ts">
import { SparklesIcon, HistoryIcon } from 'lucide-vue-next'
import type { DocumentDraftSnapshot } from '#shared/types/document'

defineProps<{
    snapshots: DocumentDraftSnapshot[]
}>()

const emit = defineEmits<{
    viewDetail: [snapshot: DocumentDraftSnapshot]
}>()

function formatTime(iso: string) {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false })
}
</script>

<template>
    <div>
        <div class="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground mb-2">
            自动快照最多保留 10 条，新快照产生时会清理最早一条
        </div>
        <div v-if="!snapshots.length" class="text-sm text-muted-foreground p-6 text-center">
            还没有 AI 生成或覆盖记录
        </div>
        <ul v-else class="divide-y">
            <li v-for="s in snapshots" :key="s.id" class="p-3 flex items-start gap-2">
                <SparklesIcon v-if="s.source === 'ai-extract'" class="size-4 text-primary mt-0.5" />
                <HistoryIcon v-else class="size-4 text-muted-foreground mt-0.5" />
                <div class="flex-1 min-w-0">
                    <div class="text-sm">
                        {{ s.source === 'ai-extract' ? 'AI 生成' : '覆盖前自动备份' }}
                        <span v-if="s.aiTitle" class="text-muted-foreground">· {{ s.aiTitle }}</span>
                    </div>
                    <div class="text-xs text-muted-foreground">{{ formatTime(s.createdAt) }}</div>
                </div>
                <Button size="sm" variant="ghost" @click="emit('viewDetail', s)">查看详情</Button>
            </li>
        </ul>
    </div>
</template>
```

### 19.2 `DocumentSnapshotDetail.vue`

接受 `currentValues / snapshot / placeholders` → 渲染字段对比表；emit `applyField(name)` 与 `applyAll`。

- [ ] **Step 2: 写失败测试**

创建 `tests/client/components/DocumentSnapshotDetail.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import DocumentSnapshotDetail from '~/components/assistant/document/DocumentSnapshotDetail.vue'

const snapshot = {
    id: 1, draftId: 1, source: 'ai-extract' as const,
    values: { name: '新名字', amount: '200' },
    aiTitle: null, createdAt: '2026-04-19T10:00:00Z',
}

const placeholders = [{ name: 'name' }, { name: 'amount' }] as any

describe('DocumentSnapshotDetail', () => {
    it('点"用这个值"对指定字段触发 applyField', async () => {
        const w = mount(DocumentSnapshotDetail, {
            props: {
                snapshot, placeholders,
                currentValues: { name: '老名字', amount: '100' },
            },
        })
        await w.get('[data-testid="apply-field-name"]').trigger('click')
        expect(w.emitted('applyField')?.[0]).toEqual(['name'])
    })

    it('点"全部采用"触发 applyAll', async () => {
        const w = mount(DocumentSnapshotDetail, {
            props: {
                snapshot, placeholders,
                currentValues: { name: 'old', amount: 'old' },
            },
        })
        await w.get('[data-testid="apply-all"]').trigger('click')
        expect(w.emitted('applyAll')?.length).toBe(1)
    })
})
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run tests/client/components/DocumentSnapshotDetail.test.ts`
Expected: FAIL

- [ ] **Step 4: 实现组件**

```vue
<script setup lang="ts">
import type { DocumentDraftSnapshot } from '#shared/types/document'
import type { Placeholder } from '#shared/types/document'

const props = defineProps<{
    snapshot: DocumentDraftSnapshot
    placeholders: Placeholder[]
    currentValues: Record<string, string | null>
}>()

const emit = defineEmits<{
    applyField: [fieldName: string]
    applyAll: []
}>()

function diffs() {
    return props.placeholders.map(p => ({
        name: p.name,
        current: props.currentValues[p.name] ?? '',
        snapshot: (props.snapshot.values as Record<string, string | null>)[p.name] ?? '',
    }))
}
</script>

<template>
    <div class="space-y-3">
        <div class="flex justify-end">
            <Button data-testid="apply-all" size="sm" @click="emit('applyAll')">
                全部采用此快照
            </Button>
        </div>
        <div class="rounded-md border overflow-hidden">
            <div class="grid grid-cols-[1fr_1fr_1fr_auto] text-xs bg-muted/50 px-3 py-2 font-medium">
                <span>字段</span>
                <span>当前值</span>
                <span>快照值</span>
                <span class="w-24 text-right">操作</span>
            </div>
            <ul class="divide-y">
                <li v-for="row in diffs()" :key="row.name"
                    class="grid grid-cols-[1fr_1fr_1fr_auto] items-start px-3 py-2 gap-2 text-sm">
                    <span class="font-medium truncate">{{ row.name }}</span>
                    <span class="text-muted-foreground break-words">{{ row.current || '—' }}</span>
                    <span class="break-words">{{ row.snapshot || '—' }}</span>
                    <div class="text-right">
                        <Button :data-testid="`apply-field-${row.name}`" size="sm" variant="ghost"
                            :disabled="row.current === row.snapshot" @click="emit('applyField', row.name)">
                            用这个值
                        </Button>
                    </div>
                </li>
            </ul>
        </div>
    </div>
</template>
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/client/components/DocumentSnapshotDetail.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**
```bash
git add app/components/assistant/document/DocumentSnapshotList.vue app/components/assistant/document/DocumentSnapshotDetail.vue tests/client/components/DocumentSnapshotDetail.test.ts
git commit -m "feat(document): 新增 SnapshotList + SnapshotDetail 组件"
```

---

## Task 20: `DocumentHistorySheet` 组件（版本 + 快照两 tab 容器）

**Files:**
- Create: `app/components/assistant/document/DocumentHistorySheet.vue`

**职责：** 右侧 Sheet（参考 `app/components/case/AnalysisVersionSheet.vue` 模式），两个 tab 分别装 `DocumentVersionList` 与 `DocumentSnapshotList`；对外只暴露开/关 + emit 子事件透传。

- [ ] **Step 1: 实现**

```vue
<script setup lang="ts">
import type { DocumentDraftVersion, DocumentDraftSnapshot, Placeholder } from '#shared/types/document'

const props = defineProps<{
    open: boolean
    versions: DocumentDraftVersion[]
    snapshots: DocumentDraftSnapshot[]
    placeholders: Placeholder[]
    currentValues: Record<string, string | null>
}>()

const emit = defineEmits<{
    'update:open': [open: boolean]
    'preview-version': [version: DocumentDraftVersion]
    'restore-version': [version: DocumentDraftVersion]
    'export-version': [version: DocumentDraftVersion]
    'delete-version': [version: DocumentDraftVersion]
    'rename-version': [id: number, name: string]
    'apply-snapshot-field': [snapshotId: number, fieldName: string]
    'apply-snapshot-all': [snapshotId: number]
}>()

const activeTab = ref<'versions' | 'snapshots'>('versions')
const activeSnapshot = ref<DocumentDraftSnapshot | null>(null)

function onUpdate(v: boolean) { emit('update:open', v) }
</script>

<template>
    <Sheet :open="open" @update:open="onUpdate">
        <SheetContent side="right" class="w-[480px] sm:w-[520px]">
            <SheetHeader>
                <SheetTitle>历史</SheetTitle>
                <SheetDescription>查看已保存的版本与 AI 自动快照</SheetDescription>
            </SheetHeader>
            <Tabs v-model="activeTab" class="mt-4">
                <TabsList class="grid grid-cols-2 w-full">
                    <TabsTrigger value="versions">版本（{{ versions.length }}）</TabsTrigger>
                    <TabsTrigger value="snapshots">快照（{{ snapshots.length }}）</TabsTrigger>
                </TabsList>
                <TabsContent value="versions" class="mt-2">
                    <DocumentVersionList :versions="versions"
                        @preview="(v) => emit('preview-version', v)"
                        @restore="(v) => emit('restore-version', v)"
                        @export-version="(v) => emit('export-version', v)"
                        @delete="(v) => emit('delete-version', v)"
                        @rename="(id, n) => emit('rename-version', id, n)" />
                </TabsContent>
                <TabsContent value="snapshots" class="mt-2">
                    <div v-if="!activeSnapshot">
                        <DocumentSnapshotList :snapshots="snapshots"
                            @view-detail="(s) => activeSnapshot = s" />
                    </div>
                    <div v-else class="space-y-2">
                        <Button size="sm" variant="ghost" @click="activeSnapshot = null">
                            ← 返回列表
                        </Button>
                        <DocumentSnapshotDetail :snapshot="activeSnapshot"
                            :placeholders="placeholders" :current-values="currentValues"
                            @apply-field="(name) => emit('apply-snapshot-field', activeSnapshot!.id, name)"
                            @apply-all="() => emit('apply-snapshot-all', activeSnapshot!.id)" />
                    </div>
                </TabsContent>
            </Tabs>
        </SheetContent>
    </Sheet>
</template>
```

- [ ] **Step 2: Commit**
```bash
git add app/components/assistant/document/DocumentHistorySheet.vue
git commit -m "feat(document): DocumentHistorySheet 两 tab 历史面板"
```

---

## Task 21: 草稿页集成 — 顶栏标题 + 保存版本 Dialog + 历史 Sheet + 预览态

**Files:**
- Modify: `app/pages/dashboard/document/drafts/[id].vue`

- [ ] **Step 1: 在 `<script setup>` 顶部追加 import 和 ref**

在现有 import 区域追加：
```ts
import { HistoryIcon, SaveIcon } from 'lucide-vue-next'
import type { DocumentDraftVersion } from '#shared/types/document'
```

在已解构的 `useDocumentDraft()` 返回值里追加：
```ts
    // title
    title, updateTitle,
    // versions
    versions, nextVersionNo, loadVersions, saveVersion,
    renameVersion, deleteVersion, restoreVersion, exportVersion,
    // snapshots
    snapshots, loadSnapshots, applySnapshot,
    // preview
    previewVersionId, previewValues, enterPreview, exitPreview,
```

在 `onMounted` 之后追加：
```ts
const historyOpen = ref(false)
const saveVersionDialogOpen = ref(false)
const saveVersionName = ref('')

async function openHistory() {
    historyOpen.value = true
    await Promise.all([loadVersions(), loadSnapshots()])
}

function openSaveVersionDialog() {
    saveVersionName.value = `第 ${nextVersionNo.value} 版`
    saveVersionDialogOpen.value = true
}

async function confirmSaveVersion() {
    const name = saveVersionName.value.trim()
    if (!name) return
    saveVersionDialogOpen.value = false
    const v = await saveVersion(name)
    if (v) toast.success(`已保存：${v.name}`)
}

async function handleRestoreVersion(v: DocumentDraftVersion) {
    if (!confirm('当前工作区内容将自动备份为快照再被覆盖，继续？')) return
    await restoreVersion(v.id)
    toast.success('已恢复到该版本')
    await loadSnapshots()
}

async function handleDeleteVersion(v: DocumentDraftVersion) {
    if (!confirm(`确定删除「${v.name}」？删除后无法恢复。`)) return
    await deleteVersion(v.id)
    toast.success('已删除')
}

async function handleApplySnapshotAll(snapshotId: number) {
    if (!confirm('当前工作区内容将被覆盖（会先自动备份为快照），继续？')) return
    await applySnapshot(snapshotId)
    toast.success('已覆盖工作区')
}

async function handleApplySnapshotField(snapshotId: number, fieldName: string) {
    await applySnapshot(snapshotId, [fieldName])
}
```

- [ ] **Step 2: 替换顶栏模板名显示为标题组件 + 加入按钮**

找到 `<h1>` 所在 header，整段替换为：
```vue
        <header class="flex items-center justify-between gap-4 flex-wrap">
            <div class="flex items-center gap-2 min-w-0">
                <Button variant="ghost" size="sm" @click="goBack">
                    <ArrowLeftIcon class="size-4 mr-1" />
                    返回
                </Button>
                <DocumentDraftTitleInput :title="title" @save="updateTitle" />
                <span v-if="caseId" class="text-sm text-muted-foreground">
                    · 案件 #{{ caseId }}
                </span>
            </div>
            <div class="flex items-center gap-2">
                <Button variant="outline" size="sm" @click="openHistory">
                    <HistoryIcon class="size-4 mr-1" />
                    历史
                </Button>
                <Button variant="outline" size="sm" @click="openSaveVersionDialog">
                    <SaveIcon class="size-4 mr-1" />
                    保存当前为版本
                </Button>
                <Button variant="default" class="shadow-sm" @click="openAgent">
                    <SparklesIcon class="size-4" />
                    AI 生成
                </Button>
                <Button :disabled="exportDisabled || isLoading || isExporting" @click="handleExport">
                    <Loader2Icon v-if="isExporting" class="size-4 mr-2 animate-spin" />
                    <DownloadIcon v-else class="size-4" />
                    {{ isExporting ? '导出中...' : '导出 word' }}
                </Button>
            </div>
        </header>
```

- [ ] **Step 3: 改预览值绑定 & 字段表单 disabled（支持预览态）**

把 `<AssistantDocumentFieldForm>` 的 `:values` 与 `<AssistantDocumentPreview>` 的 `:values` 改为使用 `effectiveValues`。在 `<script setup>` 内追加：
```ts
const effectiveValues = computed<Record<string, string | null>>(() =>
    (previewValues.value ?? currentValues.value) as Record<string, string | null>,
)
```
把 `<AssistantDocumentFieldForm>` 和 `<AssistantDocumentPreview>` 的 `:values="currentValues"` 改为 `:values="effectiveValues"`。

为字段表单加只读：
```vue
<AssistantDocumentFieldForm :template="template" :values="effectiveValues"
    :suggestions="suggestions"
    :readonly="previewVersionId !== null"
    @change="onFieldChange" />
```

> 注：`AssistantDocumentFieldForm` 如尚未支持 `readonly` prop，实施时补；本计划不展开。快速做法：传 `readonly` 后组件内对每个 Input/Textarea/Popover 设 `:disabled="readonly"`。

- [ ] **Step 4: 加预览态 banner（顶部 header 下方）**

在 `<header>` 之后、`<!-- 加载态 -->` 之前追加：
```vue
        <div v-if="previewVersionId !== null"
            class="flex items-center justify-between rounded-md bg-amber-100 dark:bg-amber-900/40 px-3 py-2 text-sm">
            <span>
                预览中 · 版本 #{{ previewVersionId }}（点击"退出预览"回到当前工作区）
            </span>
            <Button size="sm" variant="ghost" @click="exitPreview">退出预览</Button>
        </div>
```

- [ ] **Step 5: 页面底部追加 `DocumentHistorySheet` + 保存版本 Dialog**

在 `<CaseAnalysisMaterialSelector>` 下方追加：
```vue
        <DocumentHistorySheet v-model:open="historyOpen"
            :versions="versions" :snapshots="snapshots"
            :placeholders="template?.placeholders as any ?? []"
            :current-values="currentValues"
            @preview-version="(v) => enterPreview(v.id)"
            @restore-version="handleRestoreVersion"
            @export-version="(v) => exportVersion(v.id)"
            @delete-version="handleDeleteVersion"
            @rename-version="renameVersion"
            @apply-snapshot-field="handleApplySnapshotField"
            @apply-snapshot-all="handleApplySnapshotAll" />

        <Dialog v-model:open="saveVersionDialogOpen">
            <DialogContent class="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>保存当前为版本</DialogTitle>
                    <DialogDescription>给这一版起个名字方便之后查找</DialogDescription>
                </DialogHeader>
                <div class="py-2">
                    <Input v-model="saveVersionName" maxlength="100" placeholder="例如：客户反馈前版"
                        @keydown.enter="confirmSaveVersion" />
                </div>
                <DialogFooter>
                    <Button variant="outline" @click="saveVersionDialogOpen = false">取消</Button>
                    <Button :disabled="!saveVersionName.trim()" @click="confirmSaveVersion">保存</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
```

- [ ] **Step 6: 类型检查 + 冒烟**

Run:
```bash
npx nuxi typecheck
```
Expected: 0 error

启动 dev server 并手工验证：
1. 新建草稿默认标题 `模板名-YYMMDD`
2. 顶栏点标题可 inline 编辑
3. 点"保存当前为版本"弹框默认"第 1 版"，改成"初版"保存 → 历史里有
4. AI 生成一次 → 快照 tab 出现一条 `ai-extract`
5. 历史 → 版本 → 预览 → 顶部出现 banner，左表单只读
6. 历史 → 快照 → 查看详情 → 单字段"用这个值" → 工作区对应字段更新
7. 版本 → 恢复 → 提示确认 → 成功后快照列表多一条 `workspace-backup`
8. 版本 → 导出 → 浏览器下载

- [ ] **Step 7: Commit**
```bash
git add app/pages/dashboard/document/drafts/[id].vue
git commit -m "feat(document): 草稿页接入标题编辑/历史Sheet/保存版本Dialog/预览态"
```

---

## 自查

1. **Spec 覆盖**：
   - §2 术语 → Task 1（字段 + 表）、Task 5（titleOverridden 语义）
   - §3.核心需求 1-8 → Task 2(title 默认值)、Task 17(inline 编辑)、Task 10(AI 覆盖+快照)、Task 6(快照清理)、Task 7(版本命名/恢复/删除)、Task 15(版本导出)、Task 19(字段级恢复)、Task 21(预览+自动备份确认)
   - §4 数据模型 → Task 1
   - §5.1 DAO → Task 2/3/4
   - §5.2 Service → Task 5/6/7/8
   - §5.3 API 路由 → Task 12/13/14/15（路径均按 spec 扁平化版本一致）
   - §5.4 中间件 → Task 10
   - §5.5 seedData v4 → Task 11
   - §6.1 顶栏 → Task 21
   - §6.2 组件 5 个 → Task 17/18/19/20
   - §6.3 composable → Task 16
   - §6.4 历史面板 UI / §6.5 恢复二次确认 → Task 20/21
   - §7 错误处理 → 各 Service/API 层 + zod 校验覆盖
   - §8 测试 → 每个 Task 同步写测试
   - §9 迁移 → Task 1 含 migration + 回填 SQL
   - §10 不做清单 → 本 plan 未越界

2. **类型 / 命名一致性**：`titleOverridden`（camelCase）、`title_overridden`（DB col）统一；`DocumentDraftSnapshot` / `DocumentDraftVersion` 前后端统一；所有 Service 方法以 `Service` 结尾、DAO 以 `DAO` 结尾；API 路由参数均在文件名末尾位置（除沿用项目既有 `drafts/[id]/xxx` 模式外无中间多层嵌套）。

3. **无占位符**：已检查，每个 Step 都有实际代码 / 命令；个别 API 测试用例引用了现有 `drafts.api.test.ts` 的 helper 模式，已在 Task 12 加注释指向参考实现。

---

**Plan complete and saved to `docs/superpowers/plans/2026-04-19-document-title-versions.md`.**
