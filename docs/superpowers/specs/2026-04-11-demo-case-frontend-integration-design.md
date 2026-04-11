# 示范案例前台接入设计

## 背景

`/dashboard/cases/create` 页面的"或者点击下方案例快速体验"模块当前由 `app/components/caseAnalysis/example.vue` 提供 4 条硬编码的示例卡片，其中仅第 1 条有完整内容。点击卡片后将内容文本填入 `AiPromptInput`，由用户手动点击"提取信息"走标准创建流程。

后台侧已实现 `demoCases` 模型及完整的 CRUD（`/admin/demo-cases` 管理页、`GET /api/v1/demo-cases` 列表、`POST /api/v1/demo-cases/create-case/:id` 直接创建），但是前台页面完全没有接入后台数据，两侧脱节。同时 admin `FormDialog.vue` 的预设材料区只允许粘贴裸文件 URL，没有真正的 OSS 上传能力，生产上不可用。

## 目标

- 前台 `/dashboard/cases/create` 的示例卡片数据来自 `demoCases` 表
- 点击卡片后，**体验与用户自行上传材料的体验完全对齐**：文本填入输入框、文件出现在附件列表、识别状态立即"已识别"
- 重复点击同一 demo case 不在用户云盘中产生多余的 ossFile 记录
- 最终走原有 `POST /api/v1/case/extract` → 确认表单 → `POST /api/v1/case/create` 流程，生成普通案件（`isDemo=false`）出现在用户的案件列表中
- Admin 管理页同步改造为真实 OSS 上传，端到端可用
- 顺手清理仍在调用废弃端点的 dead code 组件 `app/components/case/DemoCaseList.vue`（目前无页面引用它，但仍调用 `/api/v1/demo-cases/create-case/:id` 旧端点，避免未来误复用）
- `GET /api/v1/demo-cases/create-case/:id`（旧的"一键创建"直达端点）在本任务范围内不再被前台使用，暂不删除以保持向后兼容；后续由独立任务清理

## 非目标

- 不改变用户自上传文件的 `useBatchUpload` 上传管道
- 不引入 `ossFiles.fileMd5`、`cloneFromOssFileId` 等新增字段
- 不为识别服务做透传层修改（admin 上传的文件仍走原有 `/api/v1/recognition/start` 管道完成识别）
- 不在用户点击时做 OSS `CopyObject` —— 克隆的 ossFile 记录与源文件指向同一 OSS object key

## 设计方案

### 1. 数据模型

#### 1.1 `demoCases` 新增顶级 `content` 列

文本案情描述从 `materials` JSON 数组中抽出为一等字段，确保"一条 demo case 只能有一段文本"在 schema 层物理约束。

```prisma
model demoCases {
    // ... 现有字段 ...
    /// 示范案例的文本案情描述（点击后填入用户输入框）
    content String? @db.Text
    // ... 现有字段 ...
}
```

#### 1.2 `demoCases.materials` JSON 结构收紧

仅存文件类材料，`type=1`（文本）整体废弃：

```ts
interface DemoCaseMaterial {
  /** 材料名称 */
  name: string
  /** 材料类型：2=文档，3=图片，4=音频 */
  type: 2 | 3 | 4
  /** admin 上传 OSS 后得到的 ossFile.id（必填） */
  sourceOssFileId: number
}
```

Admin API（见 3.3）负责物理拒绝 `type=1` 与缺失 `sourceOssFileId` 的请求。

#### 1.3 `ossFiles` 表仅增加部分唯一索引

**不新增任何列**。用 `(userId, bucketName, filePath)` 做克隆去重的天然联合键，语义是"该用户云盘里已有指向同一 OSS 对象的记录"。

**必须是 UNIQUE（而非普通 index）**，否则两个并发 prepare 请求会各自 miss、各自 create，产生重复克隆行。同时为了兼容"用户软删除自己的克隆记录后再次点击同一 demo case 需要能建新行"的场景（见 5.1），约束必须只作用于未软删行。

结论：必须使用 Postgres 部分唯一索引 `CREATE UNIQUE INDEX ... WHERE deleted_at IS NULL`。**Prisma `@@unique` 不支持 partial 索引**，因此必须在 Prisma migration 的 `migration.sql` 中手写原生 DDL：

```sql
-- 在 Prisma migration 的 migration.sql 末尾手写
-- 注意：PG15+ 的 UNIQUE 索引默认 NULLS DISTINCT，多个 filePath=NULL 的行不会触发约束
-- 对示范案例场景无影响（源材料必有 filePath），此处不额外加 NULLS NOT DISTINCT
CREATE UNIQUE INDEX "idx_oss_files_user_bucket_path"
  ON "oss_files" ("user_id", "bucket_name", "file_path")
  WHERE "deleted_at" IS NULL;
```

`schema.prisma` 中**不要**写 `@@unique` 或 `@@index` 来描述这个约束；手写 migration 与 `prisma migrate dev` 的 diff 检测不冲突（Prisma 会把 partial index 视为"数据库独有"并忽略）。后续执行 `prisma db pull` 时应注意该索引不会回流到 schema。

**并发写入时的行为**：两个并发 prepare 请求同时 miss、同时 create 时，其中一个会因为 UNIQUE 约束违反抛 `P2002` 错误；prepare 服务层捕获这个错误后，重新执行 `findFirst` 即可拿到另一个请求刚写入的克隆行，正常返回。

#### 1.4 数据迁移脚本

一次性 SQL（放入 Prisma migration 的 `migration.sql` 中，紧随 `ALTER TABLE` 之后）：

```sql
-- 把存量文本材料搬到 content 列
UPDATE demo_cases
SET content = materials->0->>'content'
WHERE jsonb_array_length(materials) >= 1
  AND materials->0->>'type' = '1';

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

**当前生产库状态**：只有 1 条 `demoCase`（id=2），仅 1 条 `type=1` 材料，迁移后 `content` 非空、`materials` 为 `[]`。无文件类材料需要回迁。

### 2. 后端：prepare 端点

#### 2.1 新端点 `POST /api/v1/demo-cases/:id/prepare`

**鉴权**：必须登录（`event.context.auth?.user`）。

**入参**：路径 `id`，无 body。

**出参**：

```ts
{
  code: 200,
  message: '准备示范案例成功',
  data: {
    /** 回显 demoCase.content，可能为 null */
    content: string | null,
    /** 用户云盘中对应的 ossFile 列表，与 materials 顺序一致 */
    files: OssFileItem[]
  }
}
```

`OssFileItem` 结构与 `useApiFetch<OssFileItem>` 既有契约一致：

```ts
{
  id: number, fileName: string, fileSize: number, fileType: string,
  source: FileSource, sourceName: string,
  status: number, statusName: string,
  encrypted: boolean, createdAt: string
}
```

**错误响应**：
| 场景 | code | message |
|---|---|---|
| 未登录 | 401 | 请先登录 |
| 参数错误 | 400 | 参数错误：... |
| demoCase 不存在 | 404 | 示范案例不存在 |
| demoCase 已禁用 | 400 | 示范案例已禁用 |
| 某个 source ossFile 被软删 | 500 | 示范案例资源异常，请联系管理员 |
| 服务器异常 | 500 | 准备示范案例失败 |

#### 2.2 克隆流程（单材料视角）

对 `demoCase.materials` 顺序遍历，每一项执行（**位于事务内部，create 失败不做局部 catch**）：

```ts
// 1. 读取 admin 源 ossFile
const source = await tx.ossFiles.findUnique({ where: { id: material.sourceOssFileId } })
if (!source || source.deletedAt) {
  throw new Error('示范案例资源异常')
}

// 2. 查用户云盘里是否已有指向同一 OSS 对象的行
const existing = await tx.ossFiles.findFirst({
  where: {
    userId: user.id,
    bucketName: source.bucketName,
    filePath: source.filePath,
    deletedAt: null,
  },
})

if (existing) {
  result.push(toOssFileItem(existing))
  continue
}

// 3. 未命中：创建新 ossFile 行（字段直接复制自 source，仅 userId 换成当前用户）
// P2002 冲突不在此处 catch —— 详见下方"事务级重试"。
const clone = await tx.ossFiles.create({
  data: {
    userId: user.id,
    bucketName: source.bucketName,
    fileName: source.fileName,
    filePath: source.filePath,           // 同一 OSS object
    fileSize: source.fileSize,
    fileType: source.fileType,
    source: FileSource.CASE_ANALYSIS,    // 与用户自上传对齐
    status: source.status,
    // encrypted / originalMimeType 不显式传入，使用 schema 默认值；
    // 项目已不再使用端到端加密，这两个字段由 Prisma 默认值兜底
  },
})

// 4. 同步克隆识别与嵌入（见 2.3）
await cloneRecognitionAndEmbeddingsService({
  tx,
  sourceUserId: source.userId,
  sourceOssFileId: source.id,
  targetUserId: user.id,
  targetOssFileId: clone.id,
})

result.push(toOssFileItem(clone))
```

**事务级重试（关键修订）**：

Postgres 的事务在 UNIQUE 违反（P2002）抛出后会进入 aborted 状态，**此后任何查询都会失败**（`current transaction is aborted, commands ignored until end of transaction block`）。因此 P2002 的兜底**不能在同一个事务内 catch 重查**，必须放到 `$transaction` 调用**外层**重开一个新事务：

```ts
// 服务层入口，包住整个 $transaction
async function prepareDemoCaseForUserService(
  demoCaseId: number,
  user: { id: number },
): Promise<{ content: string | null, files: OssFileItem[] }> {
  const MAX_RETRIES = 2
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const demoCase = await tx.demoCases.findFirst({
            where: { id: demoCaseId, deletedAt: null, status: 1 },
          })
          if (!demoCase) throw /* 404 或 400 对应错误 */

          const materials = (demoCase.materials ?? []) as unknown as DemoCaseMaterial[]
          const result: OssFileItem[] = []

          for (const material of materials) {
            // ... 上面 1-4 步（findFirst 命中复用、miss 则 create + 克隆识别/嵌入）
          }

          return { content: demoCase.content, files: result }
        },
        { timeout: 30_000, maxWait: 5_000 },
      )
    } catch (err: any) {
      // 只重试因并发产生的 UNIQUE 冲突；其他错误直接上抛
      // 精确匹配 idx_oss_files_user_bucket_path 索引，避免误重试
      // （项目既有 service 层使用 err?.code 鸭子类型判断，不引入 instanceof）
      const isOssFileClonedConflict =
        err?.code === 'P2002'
        && Array.isArray(err?.meta?.target)
        && (err.meta.target as string[]).some(t => t.includes('idx_oss_files_user_bucket_path'))
      if (isOssFileClonedConflict && attempt < MAX_RETRIES) {
        logger.warn('prepare demo case P2002 retry', { demoCaseId, userId: user.id, attempt })
        continue
      }
      throw err
    }
  }
  // 理论不可达
  throw new Error('prepare demo case 重试超出上限')
}
```

**幂等性保证**：每次重试都是一次全新的事务，顶部的 `tx.ossFiles.findFirst` 会重查联合键。第二次进入时，另一个并发请求已经 commit，`findFirst` 直接命中并复用，不会再触发 create。因此最多重试 1 次就能稳定成功，留 `MAX_RETRIES=2` 作为保险。整个 prepare 操作天然幂等（联合键命中即复用）。

**执行模型说明**：
- 所有材料在同一个事务中**顺序克隆**，不并发，保证事务边界清晰
- 嵌入向量的 pgvector 写入通过 `tx.$executeRawUnsafe` / `tx.$queryRawUnsafe` 在同一事务连接上执行，与 ossFile create 共享事务
- `$transaction` 调用显式指定 `timeout: 30_000`（默认 5s 对多文件 + 嵌入向量克隆不够）
- 任一环节失败（非 P2002）整体回滚，返回 500

#### 2.3 识别记录 + 嵌入向量克隆

新建服务函数 `cloneRecognitionAndEmbeddingsService(input)` 放在 `server/services/case/demoCase.service.ts`。

**关键原则：只克隆 status=成功的识别记录。**

理由：若源识别记录处于 `PROCESSING`/`FAILED`，直接复制到用户侧会触发后续两种异常行为：
1. `POST /api/v1/recognition/start` 再次被用户端的 `addFiles` 触发时，现有服务（`ocr.service.ts` 的 `createImageConversionService`、`mineru.service.ts` 的 `submitPdfConversionService`）判断到已有非 COMPLETED 记录，会根据路径不同表现为"重复创建被拒绝"或"重新调用 MinerU 并扣用户积分" —— 后者是对用户的硬伤害
2. 对于图片路径直接返回"图片已存在识别记录，请勿重复创建"错误，用户卡在识别中状态

因此克隆流程必须按"status=成功"严格过滤；admin 侧识别未成功时，跳过识别克隆，让用户端的 `addFiles → /api/v1/recognition/start` 走**新建**分支，与 admin 侧完全解耦。

**状态值常量参考**（对应 `prisma/models/recognition.prisma`）：
- `doc_recognition_records.status=2` 为成功
- `image_recognition_records.status=2` 为成功
- `asr_records.status=2` 为成功

**识别记录克隆**（三类按需处理，且只克隆 status=2 的行）：

```sql
-- 文档识别：字段 1:1 复制，仅换 user_id / oss_file_id
INSERT INTO doc_recognition_records
  (user_id, oss_file_id, status, html_content, markdown_content,
   keywords, summary, vector_ids, last_embedding_at, last_edit_at,
   created_at, updated_at)
SELECT $targetUserId, $targetOssFileId, status, html_content, markdown_content,
       keywords, summary, '[]'::jsonb, last_embedding_at, last_edit_at,
       now(), now()
FROM doc_recognition_records
WHERE user_id = $sourceUserId
  AND oss_file_id = $sourceOssFileId
  AND status = 2
  AND deleted_at IS NULL
RETURNING id;
```

```sql
-- 图片识别：同上；image_type 为内容描述性字段，可直接复制
INSERT INTO image_recognition_records
  (user_id, oss_file_id, status, image_type, html_content, markdown_content,
   keywords, summary, vector_ids, last_embedding_at, last_edit_at,
   created_at, updated_at)
SELECT $targetUserId, $targetOssFileId, status, image_type, html_content, markdown_content,
       keywords, summary, '[]'::jsonb, last_embedding_at, last_edit_at,
       now(), now()
FROM image_recognition_records
WHERE user_id = $sourceUserId
  AND oss_file_id = $sourceOssFileId
  AND status = 2
  AND deleted_at IS NULL
RETURNING id;
```

```sql
-- ASR 识别：特殊字段要显式置 NULL，避免跨用户引用 admin 侧资源
-- asr_tasks_id: admin 侧的 ASR 任务 ID，用户侧不应持有外键
-- json_oss_file_id: admin 侧保存的转录原始 JSON 的 ossFileId，用户侧不应引用
-- temp_file_path: admin 侧解密临时文件路径，识别完成后应该已清理
INSERT INTO asr_records
  (user_id, oss_file_id, asr_tasks_id, status, audio_url, audio_duration,
   result, json_oss_file_id, temp_file_path, speakers, keywords, summary,
   vector_ids, last_embedding_at, last_edit_at, created_at, updated_at)
SELECT $targetUserId, $targetOssFileId,
       NULL,                    -- asr_tasks_id
       status, audio_url, audio_duration,
       result,
       NULL,                    -- json_oss_file_id
       NULL,                    -- temp_file_path
       speakers, keywords, summary,
       '[]'::jsonb, last_embedding_at, last_edit_at, now(), now()
FROM asr_records
WHERE user_id = $sourceUserId
  AND oss_file_id = $sourceOssFileId
  AND status = 2
  AND deleted_at IS NULL
RETURNING id;
```

若查到 0 行，视为"admin 未完成识别"，跳过本张表的克隆，继续下一张。

#### 2.4 嵌入向量克隆

```sql
WITH copied AS (
  INSERT INTO case_material_embeddings (id, text, metadata, embedding)
  SELECT gen_random_uuid(),
         text,
         jsonb_set(
           jsonb_set(metadata, '{userId}', to_jsonb($targetUserId::int)),
           '{sourceId}', to_jsonb($targetOssFileId::int)
         ),
         embedding
  FROM case_material_embeddings
  WHERE metadata->>'userId' = $sourceUserId::text
    AND metadata->>'sourceId' = $sourceOssFileId::text
    AND metadata->>'source' IN ('doc', 'image', 'audio')
  RETURNING id
)
SELECT array_agg(id) FROM copied;
```

显式限定 `metadata->>'source' IN ('doc', 'image', 'audio')` 是为了把 `text` 类型的嵌入排除在克隆范围之外 —— text 类嵌入的 `sourceId` 是 `materialId`（case 级 PK），与 ossFileId 名义上不同源，理论上不会冲突；但加上显式过滤可以对未来新增 source 类型提供前置防御。

返回的新嵌入 id 数组，如有必要，回写到对应识别记录的 `vector_ids` 字段（先插入识别记录时 `vector_ids='[]'`，这里 `UPDATE ... SET vector_ids = $array`）。

**vector_ids 回填说明**：当前检索路径仅通过 `case_material_embeddings.metadata` 的 userId/sourceId 过滤，不走 `recognition_records.vector_ids`。回填仅用于管理面板展示"本文档已生成 N 个向量"这类统计，不影响检索正确性。为了保持识别记录的字段完整性，本设计选择回填；实现时若发现回填路径复杂可在代码 review 时调整为先不回填，留空数组。

**严禁绕过事务**：`server/services/legal/vectorStore.service.ts` 使用独立的 `pg.Pool`（不是 Prisma 连接池），因此 `server/services/material/materialEmbedding.service.ts` 中调用 `addDocumentsToVectorStore` / `deleteContentEmbeddings` / `getPool()` 的任何函数都会**绕过 Prisma 交互式事务**。克隆实现必须**只使用 `tx.$executeRawUnsafe` / `tx.$queryRawUnsafe`** 在 Prisma 事务连接上执行原生 SQL，**严禁调用** embedding service 或 vectorStore service 的任何函数。

#### 2.5 列表端点保持现状

`GET /api/v1/demo-cases` 现有实现已满足前台列表需要，本次不修改。

### 3. Admin 侧改造

#### 3.1 新增 `FileSource.DEMO_CASE`

本项改动涉及**三个文件**，缺一会导致云盘列表显示 undefined 或上传拒绝：

**A. `shared/types/file.ts` 的 `FileSource` 枚举** —— 增加枚举值：

```ts
export enum FileSource {
  // ... 现有 ...
  DEMO_CASE = 'demo_case',
}
```

**B. 同文件 `FileSourceName` 展示名映射** —— 增加键值对：

```ts
export const FileSourceName: Record<FileSource, string> = {
  // ... 现有 ...
  [FileSource.DEMO_CASE]: '示范案例',
}
```

不补齐会导致 `server/api/v1/files/oss/file-list.ts` 的 `FileSourceName[file.source]` 返回 `undefined`，admin 云盘列表列会显示空字符串或 undefined。

**C. `shared/utils/file.ts` 的 `getFileSourceAccept`** —— 该函数内部维护一个数组 `acceptList`，需向数组追加一项（与 `CASE_ANALYSIS` 复用同一套允许列表）：

```ts
const acceptList: FileSourceAccept[] = [
  // ... 现有六项 ...
  {
    name: FileSourceName[FileSource.DEMO_CASE],
    accept: mapAccept({ ...ASR_ACCEPT, ...DOC_ACCEPT, ...IMAGE_ACCEPT }),
  },
]
```

未补齐 `getFileSourceAccept` 会导致 admin 侧上传时 `/api/v1/storage/presigned-url` 端点返回 400 `不支持的上传场景`。

OSS 目录沿用既有 per-user 模式 `${basePath}user${user.id}/demo_case/` —— admin 账户本身就是一个正常用户，无需特殊逻辑。

#### 3.2 Admin 上传组件

新文件 `app/components/admin/demo-cases/MaterialUploader.vue`：

- 复用既有 composable `useBatchUpload`（前端 `AiPromptInput.vue` 使用同一个）
- 触发 `/api/v1/storage/presigned-url?source=demo_case` 获取签名
- 直传 OSS，上传完成后直接拿到 ossFileId（来自 `presigned-url` 响应中的 `file_id` 回调变量）
- 上传成功后自动调 `POST /api/v1/recognition/start` 触发识别
- 展示识别状态徽章：`recognizing` / `success` / `error`（`idle` 不展示）
- 支持删除已上传材料（从表单数组中移除，不物理删除 OSS 对象）

组件接口：

```ts
defineProps<{ modelValue: DemoCaseMaterial[] }>()
defineEmits<{ 'update:modelValue': [DemoCaseMaterial[]] }>()
```

**命名区分**：通过目录 `admin/demo-cases/` 隔离。实现阶段先检查既有的 `app/components/case/MaterialUploader.vue` 与 `app/components/caseCreation/MaterialUploader.vue`（两者目前是同名不同路径的业务组件），判断是否有公共底层可抽取到 `app/components/common/` 两侧共用；如有重复实现，应在本次任务内一并收敛。

#### 3.3 Admin API 变更

`POST /api/v1/admin/demo-cases` 与 `PUT /api/v1/admin/demo-cases/:id` 请求体扩展：

```ts
{
  title: string,
  description?: string | null,
  caseTypeId: number,
  content?: string | null,            // 新增
  materials: Array<{
    name: string,
    type: 2 | 3 | 4,
    sourceOssFileId: number,
  }>,
  coverImage?: string | null,
  priority?: number,
  status?: 0 | 1,
}
```

Zod 校验规则：
- `materials[].type` 仅允许 `2`、`3`、`4`，`1` 拒绝
- `materials[].sourceOssFileId` 必填
- 服务层对每个 `sourceOssFileId` 调 `findOssFileByIdDao` 校验存在且未软删
- `content` 与 `materials` 至少填一项，否则 400（保证用户点击后一定有内容进入输入框或文件列表）

响应保持 `resSuccess(event, ..., demoCase)` 契约。

#### 3.4 `FormDialog.vue` 重构

主信息区新增"案件描述"字段：

```vue
<div class="space-y-2">
  <Label>案件描述</Label>
  <Textarea v-model="form.content" rows="6" placeholder="输入示范案例的案情文本，点击后将填入用户输入框" />
</div>
```

预设材料区原"文本/URL 二选一"的表单项全部删除，替换为 `<AdminDemoCasesMaterialUploader v-model="form.materials" />`。

`openEdit` 方法读取 `item.content`、`item.materials` 时按新 schema 处理；不再做 `type` 字符串/数字转换。

提交逻辑按 3.3 的契约构建 body。

#### 3.5 `/admin/demo-cases/index.vue` caseTypes 来源修正

现有实现 `loadCaseTypes` 是硬编码 5 项 mock。改为：

```ts
const loadCaseTypes = async () => {
  const data = await useApiFetch<{ items: CaseType[] }>('/api/v1/case-types')
  caseTypes.value = data?.items ?? []
}
```

### 4. 前端创建页改造

#### 4.1 `caseAnalysis/example.vue` 职责收紧

删除全部硬编码 `defaultExamples`。新的类型定义：

```ts
export interface ExampleItem {
  id: number
  title: string
  description?: string | null
  caseTypeName?: string
  coverImage?: string | null
}
```

新增 props：

```ts
withDefaults(defineProps<{
  examples: ExampleItem[]
  title?: string
  loading?: boolean
  selectingId?: number | null   // 正在 prepare 的卡片 id，用于卡片 spinner
}>(), {
  title: '✨ 或者点击下方案例快速体验',
  loading: false,
  selectingId: null,
})
```

根节点根据 loading/examples 决定是否渲染：

```vue
<template>
  <div v-if="loading || examples.length > 0">
    <!-- 标题 -->
    <div class="text-base font-bold text-muted-foreground">{{ title }}</div>

    <!-- 骨架屏 -->
    <div v-if="loading" class="grid gap-4 mt-2 grid-cols-1 sm:grid-cols-2">
      <Skeleton v-for="i in 2" :key="i" class="h-20 w-full" />
    </div>

    <!-- 数据卡片 -->
    <div v-else class="grid gap-4 mt-2 grid-cols-1 sm:grid-cols-2">
      <Card v-for="example in examples" :key="example.id"
        :class="['p-4 relative ...', selectingId === example.id && 'pointer-events-none opacity-60']"
        @click="emit('select', example)">
        <Loader2Icon v-if="selectingId === example.id" class="absolute right-3 top-3 size-4 animate-spin text-primary" />
        <CardHeader class="p-0">
          <CardTitle class="line-clamp-1 text-sm font-bold">{{ example.title }}</CardTitle>
          <CardDescription class="line-clamp-2">{{ example.description }}</CardDescription>
        </CardHeader>
      </Card>
    </div>
  </div>
</template>
```

Emit 事件只携带 `example` 对象，父组件响应点击。

#### 4.2 `/dashboard/cases/create.vue` 改造

新增状态：

```ts
const demoCases = ref<ExampleItem[]>([])
const demoCasesLoading = ref(true)
const preparingDemoCaseId = ref<number | null>(null)
const pendingExample = ref<ExampleItem | null>(null)  // 替代原 pendingExampleContent

async function loadDemoCases() {
  try {
    const data = await useApiFetch<{ items: ExampleItem[] }>('/api/v1/demo-cases')
    demoCases.value = data?.items ?? []
  } finally {
    demoCasesLoading.value = false
  }
}

onMounted(() => {
  loadCaseTypes()
  loadDemoCases()
})
```

模板替换：

```vue
<CaseAnalysisExample
  :examples="demoCases"
  :loading="demoCasesLoading"
  :selecting-id="preparingDemoCaseId"
  title="✨ 或者点击下方案例快速体验"
  @select="handleExampleSelect"
/>
```

点击处理：

```ts
async function handleExampleSelect(example: ExampleItem) {
  const input = promptInputRef.value
  if (input?.hasContent()) {
    pendingExample.value = example
    showReplaceConfirm.value = true
    return
  }
  await applyDemoCase(example)
}

async function confirmReplaceExample() {
  const example = pendingExample.value
  if (!example) return
  promptInputRef.value?.reset()
  await nextTick()
  await applyDemoCase(example)
  pendingExample.value = null
}

async function applyDemoCase(example: ExampleItem) {
  if (preparingDemoCaseId.value !== null) return  // 防重复点击
  preparingDemoCaseId.value = example.id
  try {
    const data = await useApiFetch<{
      content: string | null
      files: OssFileItem[]
    }>(`/api/v1/demo-cases/${example.id}/prepare`, { method: 'POST' })

    if (!data) return  // useApiFetch 已吐过 toast
    if (data.content) promptInputRef.value?.setText(data.content)
    if (data.files?.length) promptInputRef.value?.addFiles(data.files)
  } finally {
    preparingDemoCaseId.value = null
  }
}
```

`pendingExampleContent` 旧变量删除。`handleExampleSelect` 不再依赖 `example.content` 字段。

#### 4.3 类型定义同步

`shared/types/case.ts` 或相近位置新增前台用的 `DemoCaseListItem`：

```ts
export interface DemoCaseListItem {
  id: number
  title: string
  description: string | null
  caseTypeId: number
  caseTypeName: string
  coverImage: string | null
  priority: number
}

export interface DemoCasePrepareResponse {
  content: string | null
  files: OssFileItem[]
}
```

`app/components/caseAnalysis/example.vue` 的 `ExampleItem` 与 `DemoCaseListItem` 保持结构兼容。

### 5. 边界场景与验收

#### 5.1 边界场景

| 场景 | 处理 |
|---|---|
| admin 上传文件但识别尚未完成 / 识别失败 | 克隆 ossFile 成功；识别记录克隆按 `status=2` 过滤，查到 0 行 → 跳过识别克隆。前端 `addFiles` 后走既有 `/api/v1/recognition/start` 路径，走新建分支，由用户端正常识别 |
| admin 源文件被软删 | `prepare` 在 2.2 第 1 步检测到 `source.deletedAt` 非空，整体事务回滚并返回 500 `示范案例资源异常` |
| 用户重复点同一 demo case（串行） | `(userId, bucketName, filePath)` 命中 → 返回同一 ossFileId；`AiPromptInput.addFiles` 内部基于 `selectedFileIds` 去重，不会在文件列表里出现两份 |
| 用户并发两次点同一 demo case | 前端 `preparingDemoCaseId` 非空时忽略后续点击；若前端防御失效（两个页面 tab），后端两个 prepare 请求其中一个会因部分唯一索引 P2002 冲突，服务层 catch 后重查联合键命中、返回同一克隆行 |
| 用户软删自己的克隆 ossFile 后再次点击 | `findFirst` 带 `deletedAt: null` 会 miss → 新建克隆行并重新克隆识别记录。旧的软删行保留（`deletedAt` 非空），`case_material_embeddings` 中旧的克隆向量成为孤儿数据（不影响检索，不清理） |
| 用户已自上传同名文件然后点击 demo case | `filePath` 不同（用户上传生成的是 `user<id>/case_analysis/uuid.pdf`，admin 上传是 `user<adminId>/demo_case/uuid.pdf`），视为两份独立文件。这是预期行为 |
| admin 修改源文件 `fileName`（不改 `filePath`） | 用户已有的克隆行保持首次克隆时的 fileName 快照，不会自动更新；用户下次点击同 demo case 仍复用旧克隆行。属于有意的快照语义 |
| admin 软删 demo case 本身 | 用户已克隆的 ossFile 不受影响，仍在用户云盘中；列表端点 `GET /api/v1/demo-cases` 过滤已软删的 demo case，用户不再看到入口 |
| admin 本人在前台使用自己创建的 demo case | 联合键 `(adminUserId, bucketName, filePath)` 直接命中源 ossFile 本身 → 返回源行，无需创建克隆。后续 addFiles + recognition/start 的 userId 校验因 userId 相同自动通过 |
| 用户 prepare 成功后未继续提取、关闭页面、下次进入 | 克隆的 ossFile 仍在用户云盘里；再次点击走联合键命中，零副作用 |
| `demoCase.content` 与 `materials` 都为空 | admin API 层阻止保存，前台不会出现这类 demo case |
| 用户点"提取信息" → 提交案件 | 走原有 `/api/v1/case/extract` → `/api/v1/case/create` 流程，`cases.isDemo = false`，出现在"我的案件"列表中 |
| `GET /api/v1/demo-cases` 请求失败 | `demoCasesLoading = false`，`demoCases = []`，整块 Example 组件隐藏，用户只看到输入框 |

#### 5.2 TDD 覆盖清单

**后端**（必需）：

1. `tests/server/case/demoCase.dao.test.ts` 扩展
   - `findOssFileByIdDao` 新 case：源文件软删返回 null
2. `tests/server/case/demoCase.service.test.ts` 扩展
   - `prepareDemoCaseForUserService`：首次克隆成功、联合键命中复用、源文件缺失抛错、多文件顺序克隆
   - **并发冲突重试**：mock `tx.ossFiles.create` 第一次抛 `P2002`、第二次 findFirst 命中，验证服务层在外层 `$transaction` 级别重开事务并返回正确结果
   - `cloneRecognitionAndEmbeddingsService`：doc/image/asr 三类识别记录的克隆、只克隆 `status=2` 的记录、源无识别记录或 status 非 2 的跳过、asr_records 克隆时 `asr_tasks_id`/`json_oss_file_id`/`temp_file_path` 显式为 NULL、嵌入向量 metadata 正确更新
3. 新文件 `tests/server/demoCases/prepare.test.ts`
   - `POST /api/v1/demo-cases/:id/prepare` API 层：401 未登录、404 不存在、400 已禁用、200 正常返回 shape（断言 `content` 与 `files[]`）
4. 新文件 `tests/server/admin/demoCaseMaterials.test.ts`
   - Admin 校验：`materials[].type=1` 被拒、`sourceOssFileId` 必填、source ossFile 不存在被拒、`content` 与 `materials` 同时为空被拒

**前端**：`applyDemoCase` / `handleExampleSelect` / `loadDemoCases` 等纯交互逻辑从 `create.vue` 抽取到 `useCaseCreation` composable 内部（已有文件，扩展即可），并在 `tests/app/composables/useCaseCreation.test.ts`（新建）中加入：
- `loadDemoCases` 成功与失败路径
- `applyDemoCase` 正常填充 text + files 分支
- `handleExampleSelect` 已有内容时弹窗分支 vs 无内容直接应用分支

组件层（`example.vue` 本身）仍维持不新增测试；逻辑已下沉到 composable 被覆盖即可。

#### 5.3 验收标准

- [ ] Prisma migration 跑完，`demo_cases.content` 列存在，`oss_files` 复合索引 `idx_oss_files_user_bucket_path` 存在
- [ ] 数据迁移后 `SELECT content, materials FROM demo_cases WHERE id = 2` 显示文本在 `content` 列、`materials` 为 `[]`
- [ ] Admin 能在示范案例表单里上传图片/文档、保存、重新打开编辑看到已上传文件列表与识别状态
- [ ] Admin 保存不含任何 content 且 materials 为空的示范案例被 400 拒绝
- [ ] 前端创建页 onMount 后看到后台示范案例卡片；列表空时整块 Example 隐藏
- [ ] 点击卡片后文本立即出现在输入框、文件出现在文件列表；admin 源文件已完成识别时文件徽章直接显示"已识别"
- [ ] 同一用户连续点击同一 demo case 两次，`SELECT count(*) FROM oss_files WHERE user_id = X AND file_path = Y AND deleted_at IS NULL` 结果为 `1`
- [ ] 点击 demo case 后点"提取信息" → 确认表单 → 创建案件 → 新案件出现在"我的案件"列表，`isDemo=false`
- [ ] 全量 `npx vitest run` 通过
- [ ] `npx nuxi typecheck` 无新增错误

## 实施顺序建议

1. 数据模型与迁移（1.1–1.4）
2. 后端 `prepareDemoCaseForUserService` + `cloneRecognitionAndEmbeddingsService` + 单元测试
3. 新端点 `POST /api/v1/demo-cases/:id/prepare` + API 层测试
4. Admin API 变更（3.3）+ Admin 侧测试
5. 新增 `FileSource.DEMO_CASE` 与上传场景配置（3.1）
6. Admin 组件 `MaterialUploader.vue` 与 `FormDialog.vue` 重构（3.2、3.4、3.5）
7. 前端 `example.vue` 重构（4.1）
8. 前端 `create.vue` 对接（4.2、4.3）
9. 端到端手测 + 验收

## 风险与备选

- **识别克隆的一致性**：admin 侧若对识别记录做了后续编辑（例如通过文档识别结果的编辑接口），已克隆到用户侧的副本不会自动同步。这是可接受的快照语义。
- **filePath 共享的所有权困惑**：两条 ossFiles 行指向同一 OSS key，管理员删除源文件 OSS 对象会导致用户侧的克隆记录变为"孤儿"。解决方案：admin 删除示范案例源文件时仅做 ossFiles 软删，不动 OSS object；或者明确"示范案例源文件不可删除，只可替换"。本 spec 选择前者，由 admin 约束层保证。
