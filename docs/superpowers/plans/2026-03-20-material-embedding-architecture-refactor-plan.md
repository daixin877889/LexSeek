# 案件材料嵌入体系重构实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一案件材料嵌入体系，创建 textContentRecords 表存储文本材料，消除 caseMaterials 上的 embeddingStatus/content/originalContent 冗余字段，以各识别记录表的 lastEmbeddingAt 作为唯一嵌入状态标准。

**Architecture:** 新增 textContentRecords 表对齐 docRecognitionRecords 结构，为文本材料提供独立存储。新增 `batchCheckMaterialEmbeddedService` 统一嵌入状态查询，按材料类型查对应识别记录表的 `lastEmbeddingAt`。重构 `ensureMaterialsEmbeddedService` 和分析端点使用统一入口，删除旧版 `embedMaterialService` 调用链。

**Tech Stack:** Prisma ORM (PostgreSQL), TypeScript, Vitest, Nuxt Server (Nitro)

**Spec:** `docs/superpowers/specs/2026-03-20-material-embedding-architecture-refactor-design.md`

**Spec 偏差说明：**
- Spec 中 textContentRecords 模型的 `@@index([ossFileId])` 为笔误，文本材料无 ossFileId，已省略
- 统一入口使用 `embedMaterialUnifiedService` 而非 Spec 中的 `embedMaterialService`，因为旧版同名函数仍保留用于向后兼容
- 函数名添加 `Service` 后缀（如 `batchCheckMaterialEmbeddedService`），符合项目命名规范
- 迁移脚本修正了 Spec 中 `user_id` 的来源——caseMaterials 表无 user_id 字段，需从 cases 表 JOIN 获取

---

## File Structure

### 新增文件

| 文件 | 职责 |
|------|------|
| `prisma/models/materials.prisma` | textContentRecords Prisma 模型定义 |
| `server/services/material/textContentRecords.dao.ts` | textContentRecords 数据访问层（CRUD + 嵌入更新） |
| `server/services/material/textContentRecords.service.ts` | 文本材料业务逻辑（创建 + 嵌入编排） |
| `tests/server/material/textContentRecords.dao.test.ts` | DAO 层测试 |
| `tests/server/material/textContentRecords.service.test.ts` | Service 层测试 |
| `tests/server/material/batchCheckMaterialEmbedded.test.ts` | 统一嵌入状态查询测试 |
| `tests/server/material/embedMaterialUnified.test.ts` | 统一嵌入入口测试 |

### 修改文件

| 文件 | 变更内容 |
|------|---------|
| `prisma/models/case.prisma:111-147` | caseMaterials 模型删除 content/originalContent/embeddingStatus 字段 |
| `server/services/material/materialEmbedding.service.ts` | 新增 `embedMaterialUnifiedService`、`batchCheckMaterialEmbeddedService`、`isMaterialEmbeddedService` |
| `server/services/material/materialProcess.service.ts:1-427` | 重构 `ensureMaterialsEmbeddedService` 和 `embedSingleMaterial`，移除旧版 embedMaterialService 导入 |
| `server/services/case/caseMaterial.service.ts:31-176` | `batchAddCaseMaterialsService` 文本材料创建时同写 textContentRecords，删除 embeddingStatus 逻辑 |
| `server/services/case/caseMaterial.dao.ts` | 删除 `updateMaterialEmbeddingStatusDAO`、`batchUpdateMaterialEmbeddingStatusByOssFileIdDAO`，DAO 参数删除 embeddingStatus 相关字段 |
| `server/services/material/material.service.ts:22-32` | MaterialWithFile 接口不再继承 embeddingStatus 字段（Prisma 模型变更后自动生效） |
| `server/api/v1/case/analysis/stream/[sessionId].post.ts:46` | 使用 `batchCheckMaterialEmbeddedService` 替代 `embeddingStatus` 过滤 |
| `tests/server/material/ensure-materials-embedded.test.ts` | 更新 mock 和断言适配新逻辑 |
| `tests/server/case/caseMaterialEmbedding.service.test.ts` | 更新嵌入状态断言 |
| `server/services/case/case.service.ts:112-135` | 替换 `batchEmbedTextMaterialsService` 调用为 `ensureMaterialsEmbeddedService` |
| `tests/server/material/embedding-status.test.ts` | 删除（不再有 embeddingStatus） |
| `tests/server/material/embedding-status-fix.test.ts` | 删除（不再有 embeddingStatus） |
| `tests/server/case/caseMaterialEmbedding.service.test.ts` | 删除（测试已废弃的 embedTextMaterialService） |
| `tests/server/case/case.service.test.ts` | 更新 batchEmbedTextMaterialsService 引用 |

---

## Phase 1: Schema + 数据迁移

### Task 1: 创建 textContentRecords Prisma 模型

**Files:**
- Create: `prisma/models/materials.prisma`

- [ ] **Step 1: 创建 materials.prisma 模型文件**

```prisma
// prisma/models/materials.prisma

/// 文本内容记录表
/// 对齐 docRecognitionRecords 结构，为 CASE_CONTENT 类型材料提供独立存储
model textContentRecords {
    /// 记录ID，主键，自增
    id              Int       @id @default(autoincrement())
    /// 用户ID
    userId          Int       @map("user_id")
    /// 关联的案件ID
    caseId          Int       @map("case_id")
    /// 关联的案件材料ID（可选，材料可能在关联前就创建）
    materialId      Int?      @map("material_id")
    /// 文本内容（Markdown格式）
    content         String?   @db.Text
    /// HTML格式内容
    htmlContent     String?   @map("html_content") @db.Text
    /// 处理状态：0-待处理 1-处理中 2-成功 3-失败
    status          Int       @default(0)
    /// 向量ID列表
    vectorIds       Json?     @default("[]") @map("vector_ids")
    /// 最后嵌入时间（非null表示已完成嵌入）
    lastEmbeddingAt DateTime? @map("last_embedding_at") @db.Timestamptz(6)
    /// 创建时间
    createdAt       DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
    /// 最后更新时间
    updatedAt       DateTime  @default(now()) @map("updated_at") @db.Timestamptz(6)
    /// 删除时间（软删除）
    deletedAt       DateTime? @map("deleted_at") @db.Timestamptz(6)

    @@index([userId], map: "idx_text_content_records_user_id")
    @@index([caseId], map: "idx_text_content_records_case_id")
    @@index([materialId], map: "idx_text_content_records_material_id")
    @@map("text_content_records")
}
```

- [ ] **Step 2: 生成 Prisma 客户端，验证模型无报错**

Run: `bun run prisma:generate`
Expected: 无报错，`generated/prisma/` 下生成 textContentRecords 相关类型

- [ ] **Step 3: Commit**

```bash
git add prisma/models/materials.prisma
git commit -m "feat(db): 新增 textContentRecords 模型定义"
```

---

### Task 2: 创建数据迁移脚本

> **注意：** 此任务包含数据迁移和破坏性 schema 变更。需在测试环境验证后才能在生产执行。迁移脚本会自动由 `prisma:migrate` 生成骨架，然后手动添加数据迁移 SQL。

**Files:**
- Modify: `prisma/models/case.prisma:111-147`

- [ ] **Step 1: 修改 caseMaterials 模型，删除三个废弃字段**

在 `prisma/models/case.prisma` 中删除以下三行：

```prisma
// 删除这三行：
    content         String?   @db.Text
    originalContent String?   @map("original_content") @db.Text
    embeddingStatus String?   @default("pending") @map("embedding_status") @db.VarChar(20)
```

修改后的 caseMaterials 模型应为：

```prisma
model caseMaterials {
    id              Int       @id @default(autoincrement())
    caseId          Int       @map("case_id")
    name            String    @db.VarChar(255)
    type            Int
    ossFileId       Int?      @map("oss_file_id")
    isEncrypted     Boolean   @default(false) @map("is_encrypted")
    status          Int       @default(1)
    createdAt       DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
    updatedAt       DateTime  @default(now()) @map("updated_at") @db.Timestamptz(6)
    deletedAt       DateTime? @map("deleted_at") @db.Timestamptz(6)

    case cases @relation(fields: [caseId], references: [id], onDelete: NoAction, onUpdate: NoAction)

    @@index([caseId], map: "idx_case_materials_case_id")
    @@index([type], map: "idx_case_materials_type")
    @@index([status], map: "idx_case_materials_status")
    @@index([deletedAt], map: "idx_case_materials_deleted_at")
    @@map("case_materials")
}
```

- [ ] **Step 2: 生成迁移脚本**

Run: `bun run prisma:migrate -- --name migrate_case_materials_refactor --create-only`
Expected: 在 `prisma/migrations/` 下生成新的迁移目录，包含自动生成的 `migration.sql`

- [ ] **Step 3: 编辑迁移脚本，在自动生成的 SQL 前添加数据迁移**

在生成的 `migration.sql` 顶部（在 Prisma 自动生成的 DROP COLUMN 和 CREATE TABLE 语句之前），手动调整顺序为：

```sql
-- 1. 先创建 text_content_records 表（Prisma 自动生成的 CREATE TABLE 保留在此处）

-- 2. 迁移 CASE_CONTENT 类型材料的 content → textContentRecords
INSERT INTO text_content_records (user_id, case_id, material_id, content, html_content, status, vector_ids, last_embedding_at, created_at, updated_at)
SELECT
    c2.user_id,
    cm.case_id,
    cm.id AS material_id,
    cm.content,
    cm.original_content,
    CASE cm.embedding_status
        WHEN 'pending' THEN 0
        WHEN 'processing' THEN 1
        WHEN 'completed' THEN 2
        WHEN 'failed' THEN 3
        ELSE 0
    END AS status,
    '[]'::jsonb AS vector_ids,
    CASE WHEN cm.embedding_status = 'completed' THEN NOW() ELSE NULL END AS last_embedding_at,
    cm.created_at,
    NOW() AS updated_at
FROM case_materials cm
JOIN cases c2 ON cm.case_id = c2.id
WHERE cm.type = 1
AND cm.deleted_at IS NULL
AND cm.content IS NOT NULL;

-- 3. 从 case_material_embeddings 反查 vector_ids（对已完成嵌入的材料）
UPDATE text_content_records t
SET vector_ids = COALESCE(
    (SELECT jsonb_agg(e.id::text)
     FROM case_material_embeddings e
     WHERE e.metadata->>'materialId' = t.material_id::text),
    '[]'::jsonb
)
WHERE t.status = 2
AND t.material_id IS NOT NULL;

-- 4. 然后执行 Prisma 自动生成的 DROP COLUMN 语句（删除 content/original_content/embedding_status）
```

- [ ] **Step 4: 在测试数据库上执行迁移验证**

Run: `bun run prisma:migrate`
Expected: 迁移成功，text_content_records 表已创建，数据已迁移

- [ ] **Step 5: 验证迁移数据完整性**

Run: `bun run prisma:studio`
验证：打开 textContentRecords 表确认数据存在且 materialId 正确关联

- [ ] **Step 6: 重新生成 Prisma 客户端**

Run: `bun run prisma:generate`
Expected: caseMaterials 类型中不再包含 content/originalContent/embeddingStatus 字段

- [ ] **Step 7: Commit**

```bash
git add prisma/models/case.prisma prisma/migrations/
git commit -m "refactor(db): 迁移文本材料到 textContentRecords 表，删除 caseMaterials 废弃字段"
```

---

## Phase 2: DAO + Service 层

### Task 3: textContentRecords DAO 层

**Files:**
- Create: `server/services/material/textContentRecords.dao.ts`
- Test: `tests/server/material/textContentRecords.dao.test.ts`

- [ ] **Step 1: 编写 DAO 测试**

```typescript
// tests/server/material/textContentRecords.dao.test.ts

/**
 * textContentRecords DAO 测试
 *
 * 测试文本内容记录的 CRUD 操作和嵌入状态更新
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { config } from 'dotenv'
import { resolve } from 'node:path'

config({ path: resolve(__dirname, '../../../.env.testing') })

import {
    createTextContentRecordDAO,
    findTextContentRecordByIdDAO,
    findTextContentRecordByMaterialIdDAO,
    findTextContentRecordsByMaterialIdsDAO,
    updateTextContentRecordEmbeddingDAO,
} from '../../../server/services/material/textContentRecords.dao'

// 测试辅助：收集创建的记录 ID 用于清理
const createdIds: number[] = []

describe('textContentRecords DAO', () => {
    afterAll(async () => {
        // 清理测试数据
        const { PrismaClient } = await import('../../../generated/prisma/client')
        const prisma = new PrismaClient()
        if (createdIds.length > 0) {
            await prisma.textContentRecords.deleteMany({
                where: { id: { in: createdIds } },
            })
        }
        await prisma.$disconnect()
    })

    it('createTextContentRecordDAO 应创建文本内容记录', async () => {
        const record = await createTextContentRecordDAO({
            userId: 1,
            caseId: 1,
            materialId: null,
            content: '测试文本内容',
            htmlContent: '<p>测试文本内容</p>',
        })
        createdIds.push(record.id)

        expect(record.id).toBeGreaterThan(0)
        expect(record.content).toBe('测试文本内容')
        expect(record.htmlContent).toBe('<p>测试文本内容</p>')
        expect(record.status).toBe(0) // 默认待处理
        expect(record.lastEmbeddingAt).toBeNull()
    })

    it('findTextContentRecordByIdDAO 应按 ID 查找', async () => {
        const record = await createTextContentRecordDAO({
            userId: 1,
            caseId: 1,
            content: '查找测试',
        })
        createdIds.push(record.id)

        const found = await findTextContentRecordByIdDAO(record.id)
        expect(found).not.toBeNull()
        expect(found!.id).toBe(record.id)
    })

    it('findTextContentRecordByMaterialIdDAO 应按 materialId 查找', async () => {
        const testMaterialId = 99999
        const record = await createTextContentRecordDAO({
            userId: 1,
            caseId: 1,
            materialId: testMaterialId,
            content: 'materialId 查找测试',
        })
        createdIds.push(record.id)

        const found = await findTextContentRecordByMaterialIdDAO(testMaterialId)
        expect(found).not.toBeNull()
        expect(found!.materialId).toBe(testMaterialId)
    })

    it('findTextContentRecordsByMaterialIdsDAO 应批量查找', async () => {
        const ids = [88881, 88882]
        for (const mid of ids) {
            const r = await createTextContentRecordDAO({
                userId: 1,
                caseId: 1,
                materialId: mid,
                content: `批量查找-${mid}`,
            })
            createdIds.push(r.id)
        }

        const records = await findTextContentRecordsByMaterialIdsDAO(ids)
        expect(records.length).toBe(2)
    })

    it('updateTextContentRecordEmbeddingDAO 应更新嵌入结果', async () => {
        const record = await createTextContentRecordDAO({
            userId: 1,
            caseId: 1,
            content: '嵌入更新测试',
        })
        createdIds.push(record.id)

        const now = new Date()
        await updateTextContentRecordEmbeddingDAO(record.id, {
            vectorIds: ['vec-1', 'vec-2'],
            lastEmbeddingAt: now,
            status: 2,
        })

        const updated = await findTextContentRecordByIdDAO(record.id)
        expect(updated!.status).toBe(2)
        expect(updated!.lastEmbeddingAt).not.toBeNull()
        expect(updated!.vectorIds).toEqual(['vec-1', 'vec-2'])
    })
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run tests/server/material/textContentRecords.dao.test.ts --reporter=verbose`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 DAO 层**

```typescript
// server/services/material/textContentRecords.dao.ts

/**
 * 文本内容记录数据访问层
 *
 * 提供 textContentRecords 表的 CRUD 操作和嵌入状态更新
 */

import type { textContentRecords, Prisma } from '~~/generated/prisma/client'

/**
 * 创建文本内容记录
 */
export const createTextContentRecordDAO = async (
    data: {
        userId: number
        caseId: number
        materialId?: number | null
        content?: string | null
        htmlContent?: string | null
    },
    tx?: Prisma.TransactionClient
): Promise<textContentRecords> => {
    const client = tx || prisma
    return client.textContentRecords.create({
        data: {
            userId: data.userId,
            caseId: data.caseId,
            materialId: data.materialId ?? null,
            content: data.content ?? null,
            htmlContent: data.htmlContent ?? null,
        },
    })
}

/**
 * 按 ID 查询
 */
export const findTextContentRecordByIdDAO = async (
    id: number,
    tx?: Prisma.TransactionClient
): Promise<textContentRecords | null> => {
    const client = tx || prisma
    return client.textContentRecords.findFirst({
        where: { id, deletedAt: null },
    })
}

/**
 * 按 materialId 查询
 */
export const findTextContentRecordByMaterialIdDAO = async (
    materialId: number,
    tx?: Prisma.TransactionClient
): Promise<textContentRecords | null> => {
    const client = tx || prisma
    return client.textContentRecords.findFirst({
        where: { materialId, deletedAt: null },
    })
}

/**
 * 批量按 materialId 查询
 */
export const findTextContentRecordsByMaterialIdsDAO = async (
    materialIds: number[],
    tx?: Prisma.TransactionClient
): Promise<textContentRecords[]> => {
    const client = tx || prisma
    return client.textContentRecords.findMany({
        where: {
            materialId: { in: materialIds },
            deletedAt: null,
        },
    })
}

/**
 * 更新嵌入结果
 */
export const updateTextContentRecordEmbeddingDAO = async (
    id: number,
    data: {
        vectorIds?: string[]
        lastEmbeddingAt?: Date
        status?: number
    },
    tx?: Prisma.TransactionClient
): Promise<void> => {
    const client = tx || prisma
    await client.textContentRecords.update({
        where: { id },
        data: {
            ...(data.vectorIds !== undefined && { vectorIds: data.vectorIds }),
            ...(data.lastEmbeddingAt !== undefined && { lastEmbeddingAt: data.lastEmbeddingAt }),
            ...(data.status !== undefined && { status: data.status }),
            updatedAt: new Date(),
        },
    })
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run tests/server/material/textContentRecords.dao.test.ts --reporter=verbose`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add server/services/material/textContentRecords.dao.ts tests/server/material/textContentRecords.dao.test.ts
git commit -m "feat(material): 新增 textContentRecords DAO 层"
```

---

### Task 4: 统一嵌入状态查询服务

**Files:**
- Modify: `server/services/material/materialEmbedding.service.ts`
- Test: `tests/server/material/batchCheckMaterialEmbedded.test.ts`

- [ ] **Step 1: 编写统一嵌入状态查询测试**

```typescript
// tests/server/material/batchCheckMaterialEmbedded.test.ts

/**
 * 统一嵌入状态查询测试
 *
 * 测试 batchCheckMaterialEmbeddedService 按材料类型查对应识别记录表的 lastEmbeddingAt
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// mock prisma
const mockPrisma = {
    caseMaterials: {
        findMany: vi.fn(),
    },
    textContentRecords: {
        findMany: vi.fn(),
    },
    docRecognitionRecords: {
        findMany: vi.fn(),
    },
    imageRecognitionRecords: {
        findMany: vi.fn(),
    },
    asrRecords: {
        findMany: vi.fn(),
    },
}

vi.stubGlobal('prisma', mockPrisma)

import {
    isMaterialEmbeddedService,
    batchCheckMaterialEmbeddedService,
} from '../../../server/services/material/materialEmbedding.service'

describe('batchCheckMaterialEmbeddedService', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('空数组应返回空 Map', async () => {
        const result = await batchCheckMaterialEmbeddedService([])
        expect(result.size).toBe(0)
    })

    it('文本材料应查 textContentRecords 的 lastEmbeddingAt', async () => {
        mockPrisma.caseMaterials.findMany.mockResolvedValue([
            { id: 1, type: 1, ossFileId: null },
        ])
        mockPrisma.textContentRecords.findMany.mockResolvedValue([
            { materialId: 1, lastEmbeddingAt: new Date() },
        ])

        const result = await batchCheckMaterialEmbeddedService([1])
        expect(result.get(1)).toBe(true)
    })

    it('文档材料应查 docRecognitionRecords 的 lastEmbeddingAt', async () => {
        mockPrisma.caseMaterials.findMany.mockResolvedValue([
            { id: 2, type: 2, ossFileId: 100 },
        ])
        mockPrisma.docRecognitionRecords.findMany.mockResolvedValue([
            { ossFileId: 100, lastEmbeddingAt: new Date() },
        ])

        const result = await batchCheckMaterialEmbeddedService([2])
        expect(result.get(2)).toBe(true)
    })

    it('未嵌入的材料应返回 false', async () => {
        mockPrisma.caseMaterials.findMany.mockResolvedValue([
            { id: 3, type: 3, ossFileId: 200 },
        ])
        mockPrisma.imageRecognitionRecords.findMany.mockResolvedValue([
            { ossFileId: 200, lastEmbeddingAt: null },
        ])

        const result = await batchCheckMaterialEmbeddedService([3])
        expect(result.get(3)).toBe(false)
    })

    it('混合类型应正确分发查询', async () => {
        mockPrisma.caseMaterials.findMany.mockResolvedValue([
            { id: 1, type: 1, ossFileId: null },
            { id: 2, type: 2, ossFileId: 100 },
            { id: 3, type: 3, ossFileId: 200 },
            { id: 4, type: 4, ossFileId: 300 },
        ])
        mockPrisma.textContentRecords.findMany.mockResolvedValue([
            { materialId: 1, lastEmbeddingAt: new Date() },
        ])
        mockPrisma.docRecognitionRecords.findMany.mockResolvedValue([
            { ossFileId: 100, lastEmbeddingAt: null },
        ])
        mockPrisma.imageRecognitionRecords.findMany.mockResolvedValue([
            { ossFileId: 200, lastEmbeddingAt: new Date() },
        ])
        mockPrisma.asrRecords.findMany.mockResolvedValue([
            { ossFileId: 300, lastEmbeddingAt: new Date() },
        ])

        const result = await batchCheckMaterialEmbeddedService([1, 2, 3, 4])
        expect(result.get(1)).toBe(true)   // 文本，已嵌入
        expect(result.get(2)).toBe(false)  // 文档，未嵌入
        expect(result.get(3)).toBe(true)   // 图片，已嵌入
        expect(result.get(4)).toBe(true)   // 音频，已嵌入
    })

    it('找不到材料的 ID 应返回 false', async () => {
        mockPrisma.caseMaterials.findMany.mockResolvedValue([])

        const result = await batchCheckMaterialEmbeddedService([999])
        expect(result.get(999)).toBe(false)
    })
})

describe('isMaterialEmbeddedService', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('单个材料已嵌入应返回 true', async () => {
        mockPrisma.caseMaterials.findMany.mockResolvedValue([
            { id: 1, type: 1, ossFileId: null },
        ])
        mockPrisma.textContentRecords.findMany.mockResolvedValue([
            { materialId: 1, lastEmbeddingAt: new Date() },
        ])

        const result = await isMaterialEmbeddedService(1)
        expect(result).toBe(true)
    })
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run tests/server/material/batchCheckMaterialEmbedded.test.ts --reporter=verbose`
Expected: FAIL（函数不存在）

- [ ] **Step 3: 在 materialEmbedding.service.ts 末尾添加统一嵌入状态查询函数**

在 `server/services/material/materialEmbedding.service.ts` 文件末尾追加：

```typescript
// ============================================
// 统一嵌入状态查询
// ============================================

/**
 * 批量查询材料的嵌入状态
 *
 * 按材料类型查对应识别记录表的 lastEmbeddingAt：
 * - CASE_CONTENT (1) → textContentRecords.lastEmbeddingAt
 * - DOCUMENT (2) → docRecognitionRecords.lastEmbeddingAt
 * - IMAGE (3) → imageRecognitionRecords.lastEmbeddingAt
 * - AUDIO (4) → asrRecords.lastEmbeddingAt
 *
 * @param materialIds case_materials.id[]
 * @returns Map<materialId, isEmbedded>
 */
export async function batchCheckMaterialEmbeddedService(
    materialIds: number[]
): Promise<Map<number, boolean>> {
    const result = new Map<number, boolean>()
    if (materialIds.length === 0) return result

    // 1. 查询所有材料的类型和 ossFileId
    const materials = await prisma.caseMaterials.findMany({
        where: { id: { in: materialIds }, deletedAt: null },
        select: { id: true, type: true, ossFileId: true },
    })

    // 初始化所有 materialIds 为 false
    for (const id of materialIds) {
        result.set(id, false)
    }

    // 2. 按类型分组
    const textMaterialIds: number[] = []
    const docOssFileMap = new Map<number, number>()     // ossFileId -> materialId
    const imageOssFileMap = new Map<number, number>()
    const audioOssFileMap = new Map<number, number>()

    for (const m of materials) {
        switch (m.type) {
            case CaseMaterialType.CASE_CONTENT:
                textMaterialIds.push(m.id)
                break
            case CaseMaterialType.DOCUMENT:
                if (m.ossFileId) docOssFileMap.set(m.ossFileId, m.id)
                break
            case CaseMaterialType.IMAGE:
                if (m.ossFileId) imageOssFileMap.set(m.ossFileId, m.id)
                break
            case CaseMaterialType.AUDIO:
                if (m.ossFileId) audioOssFileMap.set(m.ossFileId, m.id)
                break
        }
    }

    // 3. 并行查询各类型的嵌入状态
    const queries: Promise<void>[] = []

    if (textMaterialIds.length > 0) {
        queries.push(
            prisma.textContentRecords.findMany({
                where: {
                    materialId: { in: textMaterialIds },
                    deletedAt: null,
                },
                select: { materialId: true, lastEmbeddingAt: true },
            }).then(records => {
                for (const r of records) {
                    if (r.materialId && r.lastEmbeddingAt) {
                        result.set(r.materialId, true)
                    }
                }
            })
        )
    }

    if (docOssFileMap.size > 0) {
        queries.push(
            prisma.docRecognitionRecords.findMany({
                where: {
                    ossFileId: { in: [...docOssFileMap.keys()] },
                    deletedAt: null,
                },
                select: { ossFileId: true, lastEmbeddingAt: true },
            }).then(records => {
                for (const r of records) {
                    const materialId = docOssFileMap.get(r.ossFileId)
                    if (materialId && r.lastEmbeddingAt) {
                        result.set(materialId, true)
                    }
                }
            })
        )
    }

    if (imageOssFileMap.size > 0) {
        queries.push(
            prisma.imageRecognitionRecords.findMany({
                where: {
                    ossFileId: { in: [...imageOssFileMap.keys()] },
                    deletedAt: null,
                },
                select: { ossFileId: true, lastEmbeddingAt: true },
            }).then(records => {
                for (const r of records) {
                    const materialId = imageOssFileMap.get(r.ossFileId)
                    if (materialId && r.lastEmbeddingAt) {
                        result.set(materialId, true)
                    }
                }
            })
        )
    }

    if (audioOssFileMap.size > 0) {
        queries.push(
            prisma.asrRecords.findMany({
                where: {
                    ossFileId: { in: [...audioOssFileMap.keys()] },
                    deletedAt: null,
                },
                select: { ossFileId: true, lastEmbeddingAt: true },
            }).then(records => {
                for (const r of records) {
                    const materialId = audioOssFileMap.get(r.ossFileId)
                    if (materialId && r.lastEmbeddingAt) {
                        result.set(materialId, true)
                    }
                }
            })
        )
    }

    await Promise.all(queries)
    return result
}

/**
 * 查询单个材料的嵌入状态
 *
 * @param materialId case_materials.id
 * @returns 是否已嵌入
 */
export async function isMaterialEmbeddedService(
    materialId: number
): Promise<boolean> {
    const result = await batchCheckMaterialEmbeddedService([materialId])
    return result.get(materialId) ?? false
}
```

需要在文件顶部确认已导入 `CaseMaterialType`，如果没有则添加：

```typescript
import { CaseMaterialType } from '#shared/types/case'
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run tests/server/material/batchCheckMaterialEmbedded.test.ts --reporter=verbose`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add server/services/material/materialEmbedding.service.ts tests/server/material/batchCheckMaterialEmbedded.test.ts
git commit -m "feat(material): 新增 batchCheckMaterialEmbeddedService 统一嵌入状态查询"
```

---

### Task 5: textContentRecords Service 层

**Files:**
- Create: `server/services/material/textContentRecords.service.ts`
- Test: `tests/server/material/textContentRecords.service.test.ts`

- [ ] **Step 1: 编写 Service 层测试**

```typescript
// tests/server/material/textContentRecords.service.test.ts

/**
 * textContentRecords Service 测试
 *
 * 测试文本材料嵌入的完整流程（含状态管理）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
    createTextContentRecordDAO: vi.fn(),
    findTextContentRecordByIdDAO: vi.fn(),
    findTextContentRecordByMaterialIdDAO: vi.fn(),
    updateTextContentRecordEmbeddingDAO: vi.fn(),
    embedTextService: vi.fn(),
}))

vi.mock('../../../server/services/material/textContentRecords.dao', () => ({
    createTextContentRecordDAO: mocks.createTextContentRecordDAO,
    findTextContentRecordByIdDAO: mocks.findTextContentRecordByIdDAO,
    findTextContentRecordByMaterialIdDAO: mocks.findTextContentRecordByMaterialIdDAO,
    updateTextContentRecordEmbeddingDAO: mocks.updateTextContentRecordEmbeddingDAO,
}))
vi.mock('~~/server/services/material/textContentRecords.dao', () => ({
    createTextContentRecordDAO: mocks.createTextContentRecordDAO,
    findTextContentRecordByIdDAO: mocks.findTextContentRecordByIdDAO,
    findTextContentRecordByMaterialIdDAO: mocks.findTextContentRecordByMaterialIdDAO,
    updateTextContentRecordEmbeddingDAO: mocks.updateTextContentRecordEmbeddingDAO,
}))

vi.mock('../../../server/services/material/materialEmbedding.service', () => ({
    embedTextService: mocks.embedTextService,
}))
vi.mock('~~/server/services/material/materialEmbedding.service', () => ({
    embedTextService: mocks.embedTextService,
}))

import {
    embedTextContentService,
} from '../../../server/services/material/textContentRecords.service'

describe('embedTextContentService', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('应嵌入文本内容并更新记录', async () => {
        const mockRecord = {
            id: 1, userId: 1, caseId: 1, materialId: 10,
            content: '测试内容', htmlContent: null,
            status: 0, vectorIds: [], lastEmbeddingAt: null,
        }
        mocks.findTextContentRecordByIdDAO.mockResolvedValue(mockRecord)
        mocks.embedTextService.mockResolvedValue({
            ids: ['v1', 'v2'], lastEmbeddingAt: '2026-03-20T12:00:00+08:00', chunkCount: 2,
        })
        mocks.updateTextContentRecordEmbeddingDAO.mockResolvedValue(undefined)

        const result = await embedTextContentService(1, 1)

        expect(result.success).toBe(true)
        expect(result.chunkCount).toBe(2)
        expect(mocks.updateTextContentRecordEmbeddingDAO).toHaveBeenCalledWith(
            1,
            expect.objectContaining({
                vectorIds: ['v1', 'v2'],
                status: 2,
            })
        )
    })

    it('记录不存在应返回失败', async () => {
        mocks.findTextContentRecordByIdDAO.mockResolvedValue(null)

        const result = await embedTextContentService(999, 1)

        expect(result.success).toBe(false)
        expect(result.error).toContain('不存在')
    })

    it('内容为空应返回失败', async () => {
        mocks.findTextContentRecordByIdDAO.mockResolvedValue({
            id: 1, content: null, status: 0,
        })

        const result = await embedTextContentService(1, 1)

        expect(result.success).toBe(false)
        expect(result.error).toContain('内容为空')
    })

    it('嵌入失败应更新状态为失败', async () => {
        mocks.findTextContentRecordByIdDAO.mockResolvedValue({
            id: 1, content: '测试内容', materialId: 10, status: 0,
        })
        mocks.embedTextService.mockRejectedValue(new Error('向量化失败'))
        mocks.updateTextContentRecordEmbeddingDAO.mockResolvedValue(undefined)

        const result = await embedTextContentService(1, 1)

        expect(result.success).toBe(false)
        expect(mocks.updateTextContentRecordEmbeddingDAO).toHaveBeenCalledWith(
            1,
            expect.objectContaining({ status: 3 })
        )
    })
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run tests/server/material/textContentRecords.service.test.ts --reporter=verbose`
Expected: FAIL

- [ ] **Step 3: 实现 Service 层**

```typescript
// server/services/material/textContentRecords.service.ts

/**
 * 文本内容记录服务层
 *
 * 提供文本材料的嵌入编排（查找记录 → 调用向量化 → 更新状态）
 */

import {
    findTextContentRecordByIdDAO,
    findTextContentRecordByMaterialIdDAO,
    updateTextContentRecordEmbeddingDAO,
} from './textContentRecords.dao'
import { embedTextService } from './materialEmbedding.service'

/**
 * 嵌入文本内容记录
 *
 * @param textRecordId textContentRecords.id
 * @param userId 用户 ID
 * @returns 嵌入结果
 */
export const embedTextContentService = async (
    textRecordId: number,
    userId: number,
): Promise<{ success: boolean; chunkCount?: number; error?: string }> => {
    try {
        // 1. 查找记录
        const record = await findTextContentRecordByIdDAO(textRecordId)
        if (!record) {
            return { success: false, error: '文本内容记录不存在' }
        }

        // 2. 验证内容
        if (!record.content || record.content.trim() === '') {
            return { success: false, error: '文本内容为空' }
        }

        // 3. 更新状态为处理中
        await updateTextContentRecordEmbeddingDAO(textRecordId, { status: 1 })

        // 4. 调用向量化服务
        const result = await embedTextService({
            content: record.content,
            userId,
            materialId: record.materialId ?? textRecordId,
            materialName: `text-record-${textRecordId}`,
        })

        // 5. 更新嵌入结果
        await updateTextContentRecordEmbeddingDAO(textRecordId, {
            vectorIds: result.ids,
            lastEmbeddingAt: new Date(result.lastEmbeddingAt),
            status: 2, // 成功
        })

        return { success: true, chunkCount: result.chunkCount }
    } catch (error: any) {
        // 更新状态为失败
        try {
            await updateTextContentRecordEmbeddingDAO(textRecordId, { status: 3 })
        } catch {
            // 忽略状态更新失败
        }

        logger.error(`文本内容记录 ${textRecordId} 嵌入失败`, error)
        return { success: false, error: error.message || '嵌入失败' }
    }
}

/**
 * 按 materialId 嵌入文本内容
 *
 * 先通过 materialId 查找 textContentRecords 记录，再执行嵌入
 *
 * @param materialId case_materials.id
 * @param userId 用户 ID
 * @returns 嵌入结果
 */
export const embedTextContentByMaterialIdService = async (
    materialId: number,
    userId: number,
): Promise<{ success: boolean; chunkCount?: number; error?: string }> => {
    const record = await findTextContentRecordByMaterialIdDAO(materialId)
    if (!record) {
        return { success: false, error: `materialId=${materialId} 对应的文本内容记录不存在` }
    }
    return embedTextContentService(record.id, userId)
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run tests/server/material/textContentRecords.service.test.ts --reporter=verbose`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add server/services/material/textContentRecords.service.ts tests/server/material/textContentRecords.service.test.ts
git commit -m "feat(material): 新增 textContentRecords 嵌入服务层"
```

---

### Task 6: 统一嵌入入口函数

**Files:**
- Modify: `server/services/material/materialEmbedding.service.ts`
- Test: `tests/server/material/embedMaterialUnified.test.ts`

- [ ] **Step 1: 编写统一嵌入入口测试**

```typescript
// tests/server/material/embedMaterialUnified.test.ts

/**
 * 统一材料嵌入入口测试
 *
 * 测试 embedMaterialUnifiedService 按材料类型分发到对应嵌入服务
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockPrisma = {
    caseMaterials: {
        findFirst: vi.fn(),
    },
    docRecognitionRecords: {
        findFirst: vi.fn(),
        updateMany: vi.fn(),
    },
    imageRecognitionRecords: {
        findFirst: vi.fn(),
        updateMany: vi.fn(),
    },
    asrRecords: {
        findFirst: vi.fn(),
        updateMany: vi.fn(),
    },
}
vi.stubGlobal('prisma', mockPrisma)

const mocks = vi.hoisted(() => ({
    embedTextContentByMaterialIdService: vi.fn(),
    embedDocumentService: vi.fn(),
    embedImageService: vi.fn(),
    embedAudioService: vi.fn(),
}))

vi.mock('../../../server/services/material/textContentRecords.service', () => ({
    embedTextContentByMaterialIdService: mocks.embedTextContentByMaterialIdService,
}))
vi.mock('~~/server/services/material/textContentRecords.service', () => ({
    embedTextContentByMaterialIdService: mocks.embedTextContentByMaterialIdService,
}))

// embedDocumentService/embedImageService/embedAudioService 在同文件（materialEmbedding.service.ts），
// 无法通过 vi.mock 拦截。改为对模块中导出的函数做 partial mock。
// 注意：embedMaterialUnifiedService 使用同文件函数，所以我们需要用 vi.spyOn 或
// 将实现改为动态 import。这里选择让实现中用动态 import 以便测试。

import { embedMaterialUnifiedService } from '../../../server/services/material/materialEmbedding.service'

describe('embedMaterialUnifiedService', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('文本材料应分发到 embedTextContentByMaterialIdService', async () => {
        mockPrisma.caseMaterials.findFirst.mockResolvedValue({
            id: 1, type: 1, name: '案情', ossFileId: null,
        })
        mocks.embedTextContentByMaterialIdService.mockResolvedValue({
            success: true, chunkCount: 3,
        })

        const result = await embedMaterialUnifiedService(1, 1)

        expect(result.success).toBe(true)
        expect(mocks.embedTextContentByMaterialIdService).toHaveBeenCalledWith(1, 1)
    })

    it('材料不存在应返回失败', async () => {
        mockPrisma.caseMaterials.findFirst.mockResolvedValue(null)

        const result = await embedMaterialUnifiedService(999, 1)

        expect(result.success).toBe(false)
        expect(result.error).toContain('不存在')
    })

    it('文档材料应查找 docRecognitionRecords 并嵌入', async () => {
        mockPrisma.caseMaterials.findFirst.mockResolvedValue({
            id: 2, type: 2, name: '合同.pdf', ossFileId: 100,
        })
        mockPrisma.docRecognitionRecords.findFirst.mockResolvedValue({
            markdownContent: 'PDF内容',
        })
        mockPrisma.docRecognitionRecords.updateMany.mockResolvedValue({ count: 1 })
        mocks.embedDocumentService.mockResolvedValue({
            ids: ['v1'], lastEmbeddingAt: '2026-01-01', chunkCount: 2,
        })

        const result = await embedMaterialUnifiedService(2, 1)

        expect(result.success).toBe(true)
        expect(result.chunkCount).toBe(2)
        expect(mockPrisma.docRecognitionRecords.updateMany).toHaveBeenCalled()
    })

    it('图片材料应查找 imageRecognitionRecords 并嵌入', async () => {
        mockPrisma.caseMaterials.findFirst.mockResolvedValue({
            id: 3, type: 3, name: '证据.jpg', ossFileId: 200,
        })
        mockPrisma.imageRecognitionRecords.findFirst.mockResolvedValue({
            markdownContent: '图片OCR内容',
        })
        mockPrisma.imageRecognitionRecords.updateMany.mockResolvedValue({ count: 1 })
        mocks.embedImageService.mockResolvedValue({
            ids: ['v2'], lastEmbeddingAt: '2026-01-01', chunkCount: 1,
        })

        const result = await embedMaterialUnifiedService(3, 1)

        expect(result.success).toBe(true)
    })

    it('音频材料应查找 asrRecords 并嵌入', async () => {
        mockPrisma.caseMaterials.findFirst.mockResolvedValue({
            id: 4, type: 4, name: '录音.mp3', ossFileId: 300,
        })
        mockPrisma.asrRecords.findFirst.mockResolvedValue({
            summary: '音频转写内容',
        })
        mockPrisma.asrRecords.updateMany.mockResolvedValue({ count: 1 })
        mocks.embedAudioService.mockResolvedValue({
            ids: ['v3'], lastEmbeddingAt: '2026-01-01', chunkCount: 1,
        })

        const result = await embedMaterialUnifiedService(4, 1)

        expect(result.success).toBe(true)
    })

    it('缺少 ossFileId 的文件材料应返回失败', async () => {
        mockPrisma.caseMaterials.findFirst.mockResolvedValue({
            id: 5, type: 2, name: '文档', ossFileId: null,
        })

        const result = await embedMaterialUnifiedService(5, 1)

        expect(result.success).toBe(false)
        expect(result.error).toContain('ossFileId')
    })

    it('识别记录内容为空应返回失败', async () => {
        mockPrisma.caseMaterials.findFirst.mockResolvedValue({
            id: 6, type: 2, name: '空文档.pdf', ossFileId: 400,
        })
        mockPrisma.docRecognitionRecords.findFirst.mockResolvedValue({
            markdownContent: null,
        })

        const result = await embedMaterialUnifiedService(6, 1)

        expect(result.success).toBe(false)
        expect(result.error).toContain('内容为空')
    })
})
```

> **注意（同文件函数 mock 问题）：** `embedDocumentService`、`embedImageService`、`embedAudioService` 与 `embedMaterialUnifiedService` 在同一文件中。为了让测试能 mock 这些函数，实现中需要对这三个函数使用动态 import（`await import('./materialEmbedding.service')`）或将它们提取到独立模块。推荐方案：在 `embedMaterialUnifiedService` 实现中，对文档/图片/音频嵌入使用 lazy import 模式，参照现有代码中 `embedTextMaterialService` 的动态 import 风格。

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run tests/server/material/embedMaterialUnified.test.ts --reporter=verbose`
Expected: FAIL

- [ ] **Step 3: 在 materialEmbedding.service.ts 中添加统一嵌入入口**

在 `batchCheckMaterialEmbeddedService` 函数之前添加：

```typescript
// ============================================
// 统一材料嵌入入口
// ============================================

/**
 * 统一材料嵌入入口
 *
 * 根据材料类型分发到对应嵌入服务，自动管理识别记录的 lastEmbeddingAt。
 *
 * @param materialId case_materials.id
 * @param userId 用户 ID
 * @returns 嵌入结果
 */
export async function embedMaterialUnifiedService(
    materialId: number,
    userId: number,
): Promise<{ success: boolean; chunkCount?: number; error?: string }> {
    // 1. 查询材料信息
    const material = await prisma.caseMaterials.findFirst({
        where: { id: materialId, deletedAt: null },
    })

    if (!material) {
        return { success: false, error: '材料不存在' }
    }

    // 2. 按类型分发
    switch (material.type) {
        case CaseMaterialType.CASE_CONTENT: {
            const { embedTextContentByMaterialIdService } = await import('./textContentRecords.service')
            return embedTextContentByMaterialIdService(materialId, userId)
        }

        case CaseMaterialType.DOCUMENT: {
            if (!material.ossFileId) {
                return { success: false, error: '文档材料缺少 ossFileId' }
            }
            // 查找文档识别记录获取内容
            const docRecord = await prisma.docRecognitionRecords.findFirst({
                where: { ossFileId: material.ossFileId, deletedAt: null },
                select: { markdownContent: true },
                orderBy: { createdAt: 'desc' },
            })
            if (!docRecord?.markdownContent) {
                return { success: false, error: '文档识别记录内容为空' }
            }
            const docResult = await embedDocumentService({
                content: docRecord.markdownContent,
                userId,
                ossFileId: material.ossFileId,
                fileName: material.name,
            })
            // 更新 lastEmbeddingAt
            await prisma.docRecognitionRecords.updateMany({
                where: { ossFileId: material.ossFileId, deletedAt: null },
                data: { lastEmbeddingAt: new Date() },
            })
            return { success: true, chunkCount: docResult.chunkCount }
        }

        case CaseMaterialType.IMAGE: {
            if (!material.ossFileId) {
                return { success: false, error: '图片材料缺少 ossFileId' }
            }
            const imgRecord = await prisma.imageRecognitionRecords.findFirst({
                where: { ossFileId: material.ossFileId, deletedAt: null },
                select: { markdownContent: true },
                orderBy: { createdAt: 'desc' },
            })
            if (!imgRecord?.markdownContent) {
                return { success: false, error: '图片识别记录内容为空' }
            }
            const imgResult = await embedImageService({
                content: imgRecord.markdownContent,
                userId,
                ossFileId: material.ossFileId,
                fileName: material.name,
            })
            await prisma.imageRecognitionRecords.updateMany({
                where: { ossFileId: material.ossFileId, deletedAt: null },
                data: { lastEmbeddingAt: new Date() },
            })
            return { success: true, chunkCount: imgResult.chunkCount }
        }

        case CaseMaterialType.AUDIO: {
            if (!material.ossFileId) {
                return { success: false, error: '音频材料缺少 ossFileId' }
            }
            const asrRecord = await prisma.asrRecords.findFirst({
                where: { ossFileId: material.ossFileId, deletedAt: null },
                select: { summary: true },
                orderBy: { createdAt: 'desc' },
            })
            if (!asrRecord?.summary) {
                return { success: false, error: '音频识别记录内容为空' }
            }
            const audioResult = await embedAudioService({
                content: asrRecord.summary,
                userId,
                ossFileId: material.ossFileId,
                fileName: material.name,
            })
            await prisma.asrRecords.updateMany({
                where: { ossFileId: material.ossFileId, deletedAt: null },
                data: { lastEmbeddingAt: new Date() },
            })
            return { success: true, chunkCount: audioResult.chunkCount }
        }

        default:
            return { success: false, error: `不支持的材料类型: ${material.type}` }
    }
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run tests/server/material/embedMaterialUnified.test.ts --reporter=verbose`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add server/services/material/materialEmbedding.service.ts tests/server/material/embedMaterialUnified.test.ts
git commit -m "feat(material): 新增 embedMaterialUnifiedService 统一嵌入入口"
```

---

## Phase 3: 调用方替换

### Task 7: 重构分析端点和 ensureMaterialsEmbeddedService

> **合并说明：** 原 Task 7（分析端点）和 Task 8（ensureMaterialsEmbeddedService）合并为一个任务，因为两者修改同一文件且有强依赖。

**Files:**
- Modify: `server/api/v1/case/analysis/stream/[sessionId].post.ts:46`
- Modify: `server/services/material/materialProcess.service.ts:1-427`
- Modify: `tests/server/material/ensure-materials-embedded.test.ts`

- [ ] **Step 1: 修改分析端点使用统一嵌入状态查询**

将 `server/api/v1/case/analysis/stream/[sessionId].post.ts` 第 46 行：

```typescript
// 修改前：
const noEmbeddedMaterials = materials.filter(material => material.embeddingStatus !== 'completed')
```

替换为：

```typescript
// 修改后：
import { batchCheckMaterialEmbeddedService } from '~~/server/services/material/materialEmbedding.service'

// ...（在获取 materials 之后）

// 确保所有材料已完成嵌入
const embeddedMap = await batchCheckMaterialEmbeddedService(materials.map(m => m.id))
const noEmbeddedMaterials = materials.filter(m => !embeddedMap.get(m.id))
```

注意：`batchCheckMaterialEmbeddedService` 是 Nuxt 服务自动导入的，但如果自动导入未覆盖到该路径，需要显式导入。根据 `architecture.md` 中 `server/services/*/*` 自动导入规则，该函数应该可以自动导入。如果不行，添加显式 import。

- [ ] **Step 2: 运行构建验证无报错**

Run: `bun run build`
Expected: 构建成功

- [ ] **Step 3: Commit analysis endpoint changes**

```bash
git add server/api/v1/case/analysis/stream/\[sessionId\].post.ts
git commit -m "refactor(analysis): 使用 batchCheckMaterialEmbeddedService 替代 embeddingStatus 判断"
```

---

- [ ] **Step 4: 重构 materialProcess.service.ts**

**8.1: 修改导入部分**（第 1-24 行）

替换旧导入：

```typescript
// 删除这两行：
import {
    embedMaterialService,
    type EmbedMaterialInput,
} from './materialEmbedding.service'
import { updateMaterialEmbeddingStatusDAO } from '../case/caseMaterial.dao'

// 替换为：
import { embedMaterialUnifiedService } from './materialEmbedding.service'
```

**8.2: 重构 embedSingleMaterial 函数**（第 371-427 行）

替换整个函数：

```typescript
async function embedSingleMaterial(
    material: MaterialWithFile,
    userId: number,
): Promise<'success' | 'failed' | 'skipped'> {
    try {
        const result = await embedMaterialUnifiedService(material.id, userId)
        if (result.success) {
            return 'success'
        }
        // 如果返回的 error 包含"内容为空"类信息，视为 skipped
        if (result.error?.includes('内容为空') || result.error?.includes('不存在')) {
            logger.warn('材料嵌入跳过', { materialId: material.id, reason: result.error })
            return 'skipped'
        }
        logger.error('材料嵌入失败', { materialId: material.id, error: result.error })
        return 'failed'
    } catch (error: any) {
        logger.error('材料嵌入异常', { materialId: material.id, error: error.message })
        return 'failed'
    }
}
```

**8.3: 更新 ensureMaterialsEmbeddedService 签名**（第 329-365 行）

简化签名，移除不再需要的 caseId 和 sessionId：

```typescript
export async function ensureMaterialsEmbeddedService(
    materials: MaterialWithFile[],
    userId: number,
): Promise<{
    total: number
    success: number
    failed: number
    skipped: number
}> {
    if (materials.length === 0) {
        return { total: 0, success: 0, failed: 0, skipped: 0 }
    }

    const results = await Promise.allSettled(
        materials.map(material => embedSingleMaterial(material, userId))
    )

    let success = 0
    let failed = 0
    let skipped = 0

    for (const result of results) {
        if (result.status === 'fulfilled') {
            switch (result.value) {
                case 'success': success++; break
                case 'failed': failed++; break
                case 'skipped': skipped++; break
            }
        } else {
            failed++
        }
    }

    return { total: materials.length, success, failed, skipped }
}
```

**8.4: 同步修改 processMaterialService 中的旧版嵌入调用**（第 170-195 行）

替换向量化部分：

```typescript
// 修改前（第 170-196 行）：
if (options.enableEmbedding !== false) {
    try {
        const session = await prisma.caseSessions.findFirst({
            where: { caseId: material.caseId, deletedAt: null },
            orderBy: { createdAt: 'desc' },
        })
        const embedInput: EmbedMaterialInput = {
            content: processResult.content,
            userId,
            caseId: material.caseId,
            materialId: material.id,
            sessionId: session?.sessionId || '',
            materialName: material.name,
            materialType: material.type as CaseMaterialType,
        }
        await embedMaterialService(embedInput)
        logger.info('材料向量化完成', { materialId })
    } catch (embedError: any) {
        logger.error('材料向量化失败', { materialId, error: embedError.message })
    }
}

// 修改后：
if (options.enableEmbedding !== false) {
    try {
        await embedMaterialUnifiedService(material.id, userId)
        logger.info('材料向量化完成', { materialId })
    } catch (embedError: any) {
        logger.error('材料向量化失败', { materialId, error: embedError.message })
    }
}
```

- [ ] **Step 5: 更新分析端点的 ensureMaterialsEmbeddedService 调用签名**

在 `server/api/v1/case/analysis/stream/[sessionId].post.ts` 中，更新 `ensureMaterialsEmbeddedService` 调用：

```typescript
// 修改前：
const embedResult = await ensureMaterialsEmbeddedService(
    noEmbeddedMaterials, user.id, caseInfo.id, sessionId
)

// 修改后：
const embedResult = await ensureMaterialsEmbeddedService(
    noEmbeddedMaterials, user.id
)
```

- [ ] **Step 6: 更新测试文件**

重写 `tests/server/material/ensure-materials-embedded.test.ts`：

```typescript
/**
 * ensureMaterialsEmbeddedService 测试（重构后）
 *
 * 测试统一嵌入入口的分发、并行执行和容错
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MaterialWithFile } from '../../../server/services/material/material.service'

const mocks = vi.hoisted(() => ({
    embedMaterialUnifiedService: vi.fn(),
}))

vi.mock('../../../server/services/material/materialEmbedding.service', () => ({
    embedMaterialUnifiedService: mocks.embedMaterialUnifiedService,
}))
vi.mock('~~/server/services/material/materialEmbedding.service', () => ({
    embedMaterialUnifiedService: mocks.embedMaterialUnifiedService,
}))

import { ensureMaterialsEmbeddedService } from '../../../server/services/material/materialProcess.service'

function makeMaterial(overrides: Partial<MaterialWithFile> & { id: number; type: number; name: string }): MaterialWithFile {
    return {
        caseId: 1,
        ossFileId: null,
        isEncrypted: false,
        status: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        ...overrides,
    } as MaterialWithFile
}

describe('ensureMaterialsEmbeddedService', () => {
    const userId = 1

    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('空数组应返回全零统计', async () => {
        const result = await ensureMaterialsEmbeddedService([], userId)
        expect(result).toEqual({ total: 0, success: 0, failed: 0, skipped: 0 })
    })

    it('成功嵌入应计为 success', async () => {
        mocks.embedMaterialUnifiedService.mockResolvedValue({ success: true, chunkCount: 3 })

        const materials = [makeMaterial({ id: 1, type: 1, name: '案情描述' })]
        const result = await ensureMaterialsEmbeddedService(materials, userId)

        expect(mocks.embedMaterialUnifiedService).toHaveBeenCalledWith(1, userId)
        expect(result.success).toBe(1)
    })

    it('嵌入失败应计为 failed', async () => {
        mocks.embedMaterialUnifiedService.mockResolvedValue({ success: false, error: '向量化失败' })

        const materials = [makeMaterial({ id: 2, type: 2, name: '合同.pdf' })]
        const result = await ensureMaterialsEmbeddedService(materials, userId)

        expect(result.failed).toBe(1)
    })

    it('内容为空返回应计为 skipped', async () => {
        mocks.embedMaterialUnifiedService.mockResolvedValue({ success: false, error: '文档识别记录内容为空' })

        const materials = [makeMaterial({ id: 3, type: 3, name: '证据.jpg' })]
        const result = await ensureMaterialsEmbeddedService(materials, userId)

        expect(result.skipped).toBe(1)
    })

    it('混合结果应正确统计', async () => {
        mocks.embedMaterialUnifiedService
            .mockResolvedValueOnce({ success: true, chunkCount: 3 })
            .mockResolvedValueOnce({ success: false, error: '向量化失败' })
            .mockResolvedValueOnce({ success: false, error: '图片识别记录内容为空' })
            .mockResolvedValueOnce({ success: true, chunkCount: 1 })

        const materials = [
            makeMaterial({ id: 1, type: 1, name: '文本' }),
            makeMaterial({ id: 2, type: 2, name: '文档' }),
            makeMaterial({ id: 3, type: 3, name: '图片' }),
            makeMaterial({ id: 4, type: 4, name: '音频' }),
        ]
        const result = await ensureMaterialsEmbeddedService(materials, userId)

        expect(result).toEqual({ total: 4, success: 2, failed: 1, skipped: 1 })
    })

    it('异常抛出应计为 failed', async () => {
        mocks.embedMaterialUnifiedService.mockRejectedValue(new Error('网络错误'))

        const materials = [makeMaterial({ id: 1, type: 1, name: '文本' })]
        const result = await ensureMaterialsEmbeddedService(materials, userId)

        expect(result.failed).toBe(1)
    })
})
```

- [ ] **Step 7: 运行测试验证通过**

Run: `npx vitest run tests/server/material/ensure-materials-embedded.test.ts --reporter=verbose`
Expected: ALL PASS

- [ ] **Step 8: Commit**

```bash
git add server/services/material/materialProcess.service.ts server/api/v1/case/analysis/stream/\[sessionId\].post.ts tests/server/material/ensure-materials-embedded.test.ts
git commit -m "refactor(material): ensureMaterialsEmbeddedService 使用统一嵌入入口"
```

---

### Task 8: 重构 batchAddCaseMaterialsService

**Files:**
- Modify: `server/services/case/caseMaterial.service.ts:31-176`
- Modify: `server/services/case/caseMaterial.dao.ts`

- [ ] **Step 1: 重构 caseMaterial.dao.ts**

**9.1: 删除 embeddingStatus 相关参数和函数**

```typescript
// caseMaterial.dao.ts

// batchAddCaseMaterialsDAO 参数类型中删除 embeddingStatus：
export const batchAddCaseMaterialsDAO = async (
    caseId: number,
    materials: Array<{
        name: string
        type: number
        ossFileId?: number | null
        isEncrypted?: boolean
        status?: number
    }>,
    tx?: Prisma.TransactionClient
): Promise<void> => {
    const client = tx || prisma
    try {
        const createData = materials.map(material => ({
            caseId,
            name: material.name,
            type: material.type,
            ossFileId: material.ossFileId ?? null,
            isEncrypted: material.isEncrypted ?? false,
            status: material.status ?? 1,
            createdAt: new Date(),
            updatedAt: new Date(),
        }))
        await client.caseMaterials.createMany({ data: createData })
    } catch (error) {
        logger.error('批量添加案件材料失败：', error)
        throw error
    }
}

// 删除整个 updateMaterialEmbeddingStatusDAO 函数（第 93-108 行）
// 删除整个 batchUpdateMaterialEmbeddingStatusByOssFileIdDAO 函数（第 169-187 行）
```

**9.2: DAO 改为逐条创建并返回 ID**

为了安全地关联 textContentRecords，将文本材料改为逐条创建：

```typescript
// 新增单条创建函数
export const createSingleCaseMaterialDAO = async (
    caseId: number,
    material: {
        name: string
        type: number
        ossFileId?: number | null
        isEncrypted?: boolean
        status?: number
    },
    tx?: Prisma.TransactionClient
): Promise<caseMaterials> => {
    const client = tx || prisma
    return client.caseMaterials.create({
        data: {
            caseId,
            name: material.name,
            type: material.type,
            ossFileId: material.ossFileId ?? null,
            isEncrypted: material.isEncrypted ?? false,
            status: material.status ?? 1,
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    })
}
```

- [ ] **Step 2: 重构 batchAddCaseMaterialsService**

简化 `caseMaterial.service.ts`，删除 embeddingStatus 检查逻辑，新增文本材料写 textContentRecords：

```typescript
// server/services/case/caseMaterial.service.ts

import type { Prisma } from '~~/generated/prisma/client'
import type { CaseMaterialParam } from '#shared/types/case'
import { CaseMaterialType } from '#shared/types/case'
import { findOssFileByIdDao } from '../files/ossFiles.dao'
import { batchAddCaseMaterialsDAO, createSingleCaseMaterialDAO } from './caseMaterial.dao'
import { createTextContentRecordDAO } from '../material/textContentRecords.dao'

export const batchAddCaseMaterialsService = async (
    caseId: number,
    userId: number,
    materials: CaseMaterialParam[],
    tx?: Prisma.TransactionClient
): Promise<void> => {
    if (!materials || materials.length === 0) return

    // 文件材料仍可批量创建（无需返回 ID）
    const fileMaterialDataList: Array<{
        name: string
        type: number
        ossFileId?: number | null
        isEncrypted?: boolean
        status?: number
    }> = []

    for (const material of materials) {
        if (!Object.values(CaseMaterialType).includes(material.type)) {
            throw new Error(`无效的材料类型: ${material.type}`)
        }

        if (material.type === CaseMaterialType.CASE_CONTENT) {
            // 文本材料：逐条创建以获取 materialId，然后创建 textContentRecords
            if (!material.content || material.content.trim() === '') {
                throw new Error('文本材料必须包含内容')
            }
            const created = await createSingleCaseMaterialDAO(caseId, {
                name: material.name || '案情描述',
                type: material.type,
                status: 1,
            }, tx)

            await createTextContentRecordDAO({
                userId,
                caseId,
                materialId: created.id,
                content: material.content,
                htmlContent: material.content,
            }, tx)
        } else {
            // 文件材料
            if (!material.ossFileId) {
                throw new Error('文件材料必须提供 OSS 文件 ID')
            }
            const ossFile = await findOssFileByIdDao(material.ossFileId, tx)
            if (!ossFile) throw new Error('OSS 文件不存在')
            if (ossFile.userId !== userId) throw new Error('无权使用该文件，请检查文件权限')

            fileMaterialDataList.push({
                name: material.name || ossFile.fileName,
                type: material.type,
                ossFileId: material.ossFileId,
                isEncrypted: ossFile.encrypted || false,
                status: 1,
            })
        }
    }

    // 文件材料批量创建
    if (fileMaterialDataList.length > 0) {
        await batchAddCaseMaterialsDAO(caseId, fileMaterialDataList, tx)
    }
}
```

- [ ] **Step 3: 删除 embedTextMaterialService 和 batchEmbedTextMaterialsService**

这两个函数不再需要，因为嵌入逻辑已由 `embedMaterialUnifiedService` → `embedTextContentByMaterialIdService` 替代。

在 `caseMaterial.service.ts` 中删除 `embedTextMaterialService` 和 `batchEmbedTextMaterialsService` 函数（第 178-319 行）。

**同时更新 `case.service.ts` 中的调用方**（第 112-135 行）：

```typescript
// 修改前（server/services/case/case.service.ts 第 121 行）：
const vectorizePromise = batchEmbedTextMaterialsService(
    textMaterialIds,
    data.userId,
    result.caseRecord.id,
    sessionId
)

// 修改后：替换为使用 ensureMaterialsEmbeddedService
// 需要先查询完整材料信息
const { ensureMaterialsEmbeddedService } = await import('../material/materialProcess.service')
const { getMaterialsByCaseIdService } = await import('../material/material.service')
const allMaterials = await getMaterialsByCaseIdService(result.caseRecord.id)
const textMaterials = allMaterials.filter(m => m.type === CaseMaterialType.CASE_CONTENT)
if (textMaterials.length > 0) {
    const vectorizePromise = ensureMaterialsEmbeddedService(textMaterials, data.userId)
    vectorizePromise.catch(error => {
        logger.error('文本材料向量化失败', {
            error: error instanceof Error ? error.message : String(error),
            materialIds: textMaterials.map(m => m.id),
            caseId: result.caseRecord.id,
        })
    })
}
```

同时删除 `case.service.ts` 中对 `batchEmbedTextMaterialsService` 的 import。

- [ ] **Step 4: 运行构建验证**

Run: `bun run build`
Expected: 构建成功（如果有编译错误，逐个修复）

- [ ] **Step 5: Commit**

```bash
git add server/services/case/caseMaterial.dao.ts server/services/case/caseMaterial.service.ts
git commit -m "refactor(case): 重构材料创建流程，删除 embeddingStatus 相关逻辑"
```

---

## Phase 4: 清理和测试

### Task 9: 清理旧版引用和测试

**Files:**
- Modify: `tests/server/material/embedding-status.test.ts` — 删除或重写
- Modify: `tests/server/material/embedding-status-fix.test.ts` — 删除或重写
- Modify: `tests/server/case/caseMaterialEmbedding.service.test.ts` — 更新断言
- Modify: `server/services/material/material.service.ts` — 如需清理 MaterialWithFile

- [ ] **Step 1: 删除不再需要的测试文件**

删除以下测试文件（它们测试的是已删除的功能）：

```bash
rm tests/server/material/embedding-status.test.ts
rm tests/server/material/embedding-status-fix.test.ts
rm tests/server/case/caseMaterialEmbedding.service.test.ts
```

`caseMaterialEmbedding.service.test.ts` 需要删除因为它直接测试了已被删除的 `embedTextMaterialService` 和 `batchEmbedTextMaterialsService`，且所有断言都依赖 `embeddingStatus` 字段。该功能现在由 `textContentRecords.service.test.ts`（Task 5）和 `embedMaterialUnified.test.ts`（Task 6）替代覆盖。

- [ ] **Step 2: 更新 case.service.test.ts 中的 batchEmbedTextMaterialsService 引用**

在 `tests/server/case/case.service.test.ts` 中：

```typescript
// 删除这行 import：
import { batchEmbedTextMaterialsService } from '../../../server/services/case/caseMaterial.service'

// 如果有 mock，替换为 mock ensureMaterialsEmbeddedService：
vi.mock('../../../server/services/material/materialProcess.service', () => ({
    ensureMaterialsEmbeddedService: vi.fn().mockResolvedValue({ total: 0, success: 0, failed: 0, skipped: 0 }),
}))
```

具体更改取决于该文件如何使用 `batchEmbedTextMaterialsService`——如果只是 import 未实际调用，删除即可。

- [ ] **Step 3: 运行全量测试**

Run: `npx vitest run --reporter=verbose`
Expected: ALL PASS

- [ ] **Step 4: 运行构建**

Run: `bun run build`
Expected: 构建成功

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(material): 清理旧版 embeddingStatus 测试和引用"
```

---

### Task 10: 最终验证

- [ ] **Step 1: 搜索代码库确认无残留 embeddingStatus 引用**

搜索 `server/` 和 `tests/` 目录中是否还有 `embeddingStatus` 引用（排除 `generated/`、`docs/`、`node_modules/`）：

Run: `grep -r "embeddingStatus" server/ tests/ --include="*.ts" | grep -v "generated/" | grep -v "node_modules/" | grep -v ".test.ts.snap"`

Expected: 无结果（或只有注释/文档引用）

- [ ] **Step 2: 运行全量测试**

Run: `npx vitest run --reporter=verbose`
Expected: ALL PASS

- [ ] **Step 3: 运行构建**

Run: `bun run build`
Expected: 构建成功

- [ ] **Step 4: Final commit**

```bash
git commit --allow-empty -m "chore(material): 材料嵌入体系重构完成 - 统一 lastEmbeddingAt 标准"
```

---

## 不在本计划范围内

以下内容在 spec 中明确标记为不在范围内：

1. **前端适配** — 材料上传/展示 UI 变更需要独立任务
2. **向量数据迁移** — `case_material_embeddings` 表中旧版元数据无需迁移
3. **法律条文嵌入体系** — `law_embeddings` 是独立体系，不受影响
4. **旧版 `embedMaterialService` 函数本体的删除** — 保留在 `materialEmbedding.service.ts` 中作为向后兼容（可在后续独立清理任务中删除）
