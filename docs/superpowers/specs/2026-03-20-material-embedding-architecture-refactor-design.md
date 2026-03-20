# 案件材料嵌入体系重构设计文档

> 日期：2026-03-20
> 状态：评审中
> 涉及范围：Prisma Schema、迁移脚本、服务层、API 层、前端

## 背景与问题

### 当前架构问题

项目存在**两套并行的嵌入体系**：

| 维度 | 旧版（embedMaterialService） | 新版（embedDoc/Img/AudService） |
|------|------|------|
| 索引字段 | materialId + caseId | ossFileId |
| 元数据 | MaterialEmbeddingMetadata | ContentEmbeddingMetadata |
| 嵌入状态 | caseMaterials.embeddingStatus | *_records.lastEmbeddingAt |
| 存储表 | case_material_embeddings | case_material_embeddings |
| 检索filter | { userId, caseId } | { userId, source } |
| 适用场景 | 案件分析检索 | 内容检索 |

**具体问题**：
1. `caseMaterials.content` 承担文本存储职能，违反单一职责
2. `caseMaterials.embeddingStatus` 和 `*_records.lastEmbeddingAt` 双轨状态判断不一致
3. 文本材料（CASE_CONTENT）直接存 content，文件材料走识别记录表，逻辑不对称
4. 分析端点判断"是否已嵌入"只看 embeddingStatus，对文件材料无效（文件材料即使识别记录已有向量，只要 caseMaterials.embeddingStatus 不是 completed 就会重复嵌入）
5. 旧版 `embedMaterialService` 被废弃但仍有残留调用

### 重构目标

1. 文本材料创建独立存储表，对齐文件材料识别记录表结构
2. case_materials 只做关联（caseId + type + ossFileId），不承担存储和状态
3. 统一嵌入状态判断标准：`*_records.lastEmbeddingAt` 非 null = 已嵌入
4. 复用现有识别逻辑（四型分发）
5. 统一材料嵌入逻辑
6. 清理旧逻辑

---

## 设计决策

| 决策 | 选择 | 原因 |
|------|------|------|
| 文本材料表名 | textContentRecords | 与 xxxRecognitionRecords 命名风格对齐 |
| 文本材料表结构 | 对齐 docRecognitionRecords | 统一结构便于统一处理逻辑 |
| 文本内容存储 | markdownContent + htmlContent | 用户输入文本存入这两个字段 |
| 嵌入状态判断 | 各识别记录表的 lastEmbeddingAt | 唯一标准，无需冗余字段 |
| 嵌入逻辑 | 保留四型分发（doc/image/audio/text） | 现有逻辑稳定，只需替换调用方 |
| 统一嵌入入口 | materialEmbedding.service.ts | 嵌入应独立于案件关联（独立上传场景） |
| case_materials | 删除 embeddingStatus/content/originalContent | 只做关联 |
| 数据迁移 | 一次性迁移脚本 | 风险可控，完成后删除 |

---

## 新增 / 修改的数据模型

### textContentRecords 表（新建）

位置：`prisma/models/materials.prisma`（新建文件，对齐 recognition.prisma 的组织方式）

```prisma
model textContentRecords {
    id              Int       @id @default(autoincrement())
    userId          Int       @map("user_id")
    caseId          Int       @map("case_id")
    materialId      Int?      @map("material_id")
    content         String?    @db.Text
    htmlContent     String?    @map("html_content") @db.Text
    status          Int       @default(0)  // 0-待处理 1-处理中 2-成功 3-失败
    vectorIds       Json?     @default("[]") @map("vector_ids")
    lastEmbeddingAt DateTime?  @map("last_embedding_at") @db.Timestamptz(6)
    createdAt       DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
    updatedAt       DateTime  @default(now()) @map("updated_at") @db.Timestamptz(6)
    deletedAt       DateTime? @map("deleted_at") @db.Timestamptz(6)

    @@index([userId])
    @@index([caseId])
    @@index([materialId])
    @@index([ossFileId:oss_file_id])  // 逻辑关联，与 caseMaterials.ossFileId 对应
}
```

> 注：structure 对齐 docRecognitionRecords，包含 status/vectorIds/lastEmbeddingAt，但不含 ossFileId（文本材料无需）。可选的 materialId 字段关联 case_materials（但非外键，因为可能在关联前就创建）。

### case_materials 表（修改）

修改：`prisma/models/case.prisma`

删除字段：
- `content` — 文本内容迁移到 textContentRecords
- `originalContent` — 不再需要
- `embeddingStatus` — 状态迁移到 textContentRecords.lastEmbeddingAt

保留字段：id, caseId, name, type, ossFileId, isEncrypted, status, createdAt, updatedAt, deletedAt

### schema.prisma

`prisma/schema.prisma` 引入新模型：
```prisma
generator client {
    provider = "prisma-client-js"
    output   = "../generated/prisma"
}

datasource db {
    provider = "postgresql"
    url      = env("DATABASE_URL")
}

model textContentRecords { /* ... */ }
```

---

## 数据迁移

### 迁移脚本

位置：`prisma/migrations/YYYYMMDDHHMMSS_migrate_case_materials_refactor/migration.sql`

```sql
-- 1. 创建 textContentRecords 表（由 Prisma migrate 生成）

-- 2. 迁移 CASE_CONTENT 类型材料的 content → textContentRecords
INSERT INTO text_content_records (user_id, case_id, material_id, content, html_content, status, vector_ids, last_embedding_at, created_at, updated_at)
SELECT
    c.user_id,
    c.case_id,
    c.id AS material_id,
    c.content,
    c.original_content,  -- 复用 originalContent 作为 htmlContent
    CASE c.embedding_status
        WHEN 'pending' THEN 0
        WHEN 'processing' THEN 1
        WHEN 'completed' THEN 2
        WHEN 'failed' THEN 3
        ELSE 0
    END AS status,
    '[]'::jsonb AS vector_ids,
    CASE WHEN c.embedding_status = 'completed' THEN NOW() ELSE NULL END AS last_embedding_at,
    c.created_at,
    NOW() AS updated_at
FROM case_materials c
WHERE c.type = 1  -- CASE_CONTENT
AND c.deleted_at IS NULL;

-- 3. 更新 vector_ids（从 case_material_embeddings 表反查）
-- 对于 embedding_status = 'completed' 的材料，从向量表中获取 chunkCount 作为 vectorIds
UPDATE text_content_records t
SET vector_ids = (
    SELECT jsonb_agg(id::text)
    FROM case_material_embeddings e
    WHERE e.metadata->>'materialId' = t.material_id::text
)
WHERE t.status = 2  -- 已在步骤2中标记为 completed
AND t.material_id IS NOT NULL;

-- 4. 更新 last_embedding_at
UPDATE text_content_records t
SET last_embedding_at = (
    SELECT MAX((e.metadata->>'lastEmbeddingAt')::timestamptz)
    FROM case_material_embeddings e
    WHERE e.metadata->>'materialId' = t.material_id::text
)
WHERE t.material_id IS NOT NULL;

-- 5. 删除 case_materials 的 content / originalContent / embeddingStatus 列
ALTER TABLE case_materials
    DROP COLUMN IF EXISTS content,
    DROP COLUMN IF EXISTS original_content,
    DROP COLUMN IF EXISTS embedding_status;
```

---

## 服务层设计

### 新增 DAO：textContentRecords.dao.ts

位置：`server/services/material/textContentRecords.dao.ts`

```typescript
// 创建文本内容记录
export const createTextContentRecordDao = async (
    data: { userId, caseId?, materialId?, content, htmlContent? },
    tx?: Prisma.TransactionClient
): Promise<textContentRecords> { ... }

// 按 ID 查询
export const findTextContentRecordByIdDao = async (id: number, tx?: ...): Promise<textContentRecords | null> { ... }

// 按 materialId 查询
export const findTextContentRecordByMaterialIdDao = async (materialId: number, tx?: ...): Promise<textContentRecords | null> { ... }

// 批量按 materialId 查询
export const findTextContentRecordsByMaterialIdsDao = async (materialIds: number[], tx?: ...): Promise<textContentRecords[]> { ... }

// 更新嵌入结果
export const updateTextContentRecordEmbeddingDao = async (
    id: number,
    data: { vectorIds?: Json, lastEmbeddingAt?: Date, status?: number },
    tx?: Prisma.TransactionClient
): Promise<void> { ... }
```

### 新增 Service：textContentRecords.service.ts

位置：`server/services/material/textContentRecords.service.ts`

```typescript
// 创建文本材料（同时创建 case_materials 和 textContentRecords）
export const createTextContentMaterialService = async (
    data: { userId, caseId?, name, content, asrOptions? }
): Promise<{ caseMaterial: caseMaterials, textRecord: textContentRecords }>

// 文本材料嵌入（含状态管理）
export const embedTextContentService = async (
    textRecordId: number,
    userId: number,
    asrOptions?: ASROptions
): Promise<{ success: boolean; chunkCount?: number; error?: string }>
```

### 修改 materialEmbedding.service.ts

#### embedTextService（已存在，无需修改）
- 签名：`embedTextService({ content, userId, materialId, materialName })`
- 写入向量表，metadata source='text'，sourceId=materialId

#### 新增统一入口函数

```typescript
/**
 * 统一材料嵌入入口
 *
 * 根据材料类型分发到对应嵌入服务，自动管理识别记录的 lastEmbeddingAt。
 *
 * @param materialId case_materials.id
 * @param userId 用户 ID
 * @param options 嵌入选项
 * @returns 嵌入结果
 */
export async function embedMaterialService(
    materialId: number,
    userId: number,
    options?: {
        // 文本嵌入：自定义内容（用于 textContentRecords 场景）
        content?: string
        htmlContent?: string
    }
): Promise<{ success: boolean; chunkCount?: number; error?: string }>
```

#### 内部分发逻辑

```
embedMaterialService(materialId)
  1. 查询 caseMaterials 和对应识别记录
  2. 按 type 分发：
     - CASE_CONTENT (1) → embedTextContentService → 更新 textContentRecords.lastEmbeddingAt
     - DOCUMENT (2) → embedDocumentService → 更新 docRecognitionRecords.lastEmbeddingAt
     - IMAGE (3) → embedImageService → 更新 imageRecognitionRecords.lastEmbeddingAt
     - AUDIO (4) → embedAudioService → 更新 asrRecords.lastEmbeddingAt
  3. 返回结果
```

### 修改 materialProcess.service.ts

- `processMaterialService` 中 OCR 路径：移除旧版 `embedMaterialService` 调用，改为触发 `materialEmbedding.service.ts` 的统一入口
- `ensureMaterialsEmbeddedService`：修改"是否已嵌入"的判断逻辑（见后文）

### 修改 case.service.ts

- `batchAddCaseMaterialsService`：文本材料创建时，同时创建 `textContentRecords` 记录
- 事务原子性：case_materials 和 textContentRecords 同时创建

### 修改 caseMaterial.service.ts

- `embedTextMaterialService`：重构为调用 `textContentRecords.service.ts`（或直接调用 `materialEmbedding.service.ts` 的统一入口）
- `batchAddCaseMaterialsService` 中文件材料的 embeddingStatus 判断逻辑删除（由 lastEmbeddingAt 替代）

---

## 嵌入状态统一判断

### 各表嵌入状态字段

| 表 | 嵌入状态字段 | 判断逻辑 |
|---|---|---|
| textContentRecords | lastEmbeddingAt | null = 未嵌入，非 null = 已嵌入 |
| docRecognitionRecords | lastEmbeddingAt | 同上 |
| imageRecognitionRecords | lastEmbeddingAt | 同上 |
| asrRecords | lastEmbeddingAt | 同上 |

### 统一的嵌入状态查询函数

```typescript
// 位置：server/services/material/materialEmbedding.service.ts

/**
 * 查询材料的嵌入状态
 * @param materialId case_materials.id
 * @returns 是否已嵌入
 */
export async function isMaterialEmbedded(materialId: number): Promise<boolean>

/**
 * 查询多个材料的嵌入状态
 * @param materialIds case_materials.id[]
 * @returns Map<materialId, isEmbedded>
 */
export async function batchCheckMaterialEmbedded(materialIds: number[]): Promise<Map<number, boolean>>

// 实现：
// 1. 查询 case_materials 获取 type 和 ossFileId
// 2. 按 type 查询对应识别记录表的 lastEmbeddingAt
// 3. null = false, non-null = true
```

### 修改 ensureMaterialsEmbeddedService

当前逻辑：
```typescript
const noEmbeddedMaterials = materials.filter(m => m.embeddingStatus !== 'completed')
```

改为：
```typescript
// 1. 提取所有 materialId
const materialIds = materials.map(m => m.id)

// 2. 批量查询嵌入状态
const embeddedMap = await batchCheckMaterialEmbedded(materialIds)

// 3. 过滤未嵌入材料
const noEmbeddedMaterials = materials.filter(m => !embeddedMap.get(m.id))
```

---

## 分析端点改动

### server/api/v1/case/analysis/stream/[sessionId].post.ts

```typescript
// 修改前（错误）：
const noEmbeddedMaterials = materials.filter(m => m.embeddingStatus !== 'completed')

// 修改后（正确）：
const embeddedMap = await batchCheckMaterialEmbedded(materials.map(m => m.id))
const noEmbeddedMaterials = materials.filter(m => !embeddedMap.get(m.id))
```

`ensureMaterialsEmbeddedService` 内部调用链无需改动（已通过 materialId 统一分发）。

---

## 依赖关系与调用链

### 重构后调用链

```
案件创建（case.service.ts）
  └── batchAddCaseMaterialsService
        ├── 文本材料 → textContentRecords（新建）+ case_materials
        └── 文件材料 → case_materials + *_records（识别时创建）

材料处理（materialProcess.service.ts）
  ├── DOCUMENT → mineru → docRecognitionRecords
  ├── IMAGE → ocr → imageRecognitionRecords
  ├── AUDIO → asr → asrRecords
  └── CASE_CONTENT → textContentRecords
        └── 嵌入调用 materialEmbedding.service.ts

嵌入入口（materialEmbedding.service.ts）
  ├── embedTextService → 更新 textContentRecords.lastEmbeddingAt
  ├── embedDocumentService → 更新 docRecognitionRecords.lastEmbeddingAt
  ├── embedImageService → 更新 imageRecognitionRecords.lastEmbeddingAt
  └── embedAudioService → 更新 asrRecords.lastEmbeddingAt

分析端点（analysis/stream/[sessionId].post.ts）
  └── batchCheckMaterialEmbedded（统一判断）
        └── lastEmbeddingAt 非 null = 已嵌入
```

### 旧逻辑清理清单

| 待删除 | 位置 | 说明 |
|--------|------|------|
| `caseMaterials.embeddingStatus` 列 | Prisma schema | 迁移后删除 |
| `caseMaterials.content` 列 | Prisma schema | 迁移后删除 |
| `caseMaterials.originalContent` 列 | Prisma schema | 迁移后删除 |
| `MaterialWithFile.content` | material.service.ts | 类型定义删除 |
| `MaterialWithFile.embeddingStatus` | material.service.ts | 类型定义删除 |
| 旧版 `embedMaterialService` 调用 | materialProcess.service.ts | 替换为统一入口 |
| `batchUpdateMaterialEmbeddingStatusByOssFileIdDAO` | caseMaterial.dao.ts | 由各识别记录的 updateDao 替代 |
| `batchUpdateMaterialEmbeddingStatusDAO` | caseMaterial.dao.ts | 由 batchCheckMaterialEmbedded + 各识别记录 update 替代 |

---

## 实施阶段

### Phase 1：Schema + 迁移

1. 创建 `prisma/models/materials.prisma`，新增 `textContentRecords` 模型
2. 在 `prisma/schema.prisma` 中引入新模型
3. 运行 `bun run prisma:migrate` 生成迁移脚本
4. 编辑迁移脚本，添加数据迁移 SQL（content → textContentRecords，删除废弃列）
5. 运行迁移，验证数据完整性
6. 推送 schema：`bun run prisma:push`

### Phase 2：DAO + Service

1. 创建 `textContentRecords.dao.ts`（CRUD + 嵌入结果更新）
2. 创建 `textContentRecords.service.ts`（创建文本材料 + 嵌入服务）
3. 新增 `isMaterialEmbedded` / `batchCheckMaterialEmbedded` 函数
4. 新增 `embedMaterialService` 统一入口

### Phase 3：调用方替换

1. 修改 `case.service.ts`：文本材料创建时同时写入 `textContentRecords`
2. 修改 `materialProcess.service.ts`：移除旧版 `embedMaterialService`，改为调用 `materialEmbedding.service.ts` 的统一入口
3. 修改 `caseMaterial.service.ts`：更新文件材料的 embeddingStatus 判断逻辑
4. 修改 `analysis/stream/[sessionId].post.ts`：使用 `batchCheckMaterialEmbedded` 统一判断

### Phase 4：清理

1. 删除 `caseMaterials` 的废弃列（已在 Phase 1 迁移脚本中）
2. 删除 `MaterialWithFile` 中对应的类型字段
3. 删除 `batchUpdateMaterialEmbeddingStatusDAO` / `batchUpdateMaterialEmbeddingStatusByOssFileIdDAO`
4. 删除 `caseMaterial.dao.ts` 中不再需要的函数
5. 运行全量测试，确保无回归

---

## 不在范围内

- 前端适配（材料上传/展示 UI 变更）— 独立任务
- 向量数据迁移（`case_material_embeddings` 表中旧版元数据无需迁移，共用同一张表）
- 法律条文嵌入体系（`law_embeddings` 表）— 独立体系，不受影响

---

## 关键文件索引

### 新增
- `prisma/models/materials.prisma` — textContentRecords 模型
- `server/services/material/textContentRecords.dao.ts` — DAO 层
- `server/services/material/textContentRecords.service.ts` — Service 层

### 修改
- `prisma/models/case.prisma` — 删除 embeddingStatus/content/originalContent
- `prisma/schema.prisma` — 引入 materials.prisma
- `server/services/material/materialEmbedding.service.ts` — 新增统一入口 + batchCheckMaterialEmbedded
- `server/services/material/materialProcess.service.ts` — 移除旧版嵌入调用
- `server/services/case/case.service.ts` — 文本材料创建时写 textContentRecords
- `server/services/case/caseMaterial.service.ts` — embeddingStatus 判断逻辑删除
- `server/services/material/material.service.ts` — MaterialWithFile 类型清理
- `server/api/v1/case/analysis/stream/[sessionId].post.ts` — 统一嵌入状态判断
