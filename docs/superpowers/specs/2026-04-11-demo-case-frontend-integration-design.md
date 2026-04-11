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

#### 1.3 `ossFiles` 表仅增加复合索引

**不新增任何列**。用 `(userId, bucketName, filePath)` 做克隆去重的天然联合键，语义是"该用户云盘里已有指向同一 OSS 对象的记录"。

```prisma
model ossFiles {
    // ... 现有字段 ...
    @@index([userId, bucketName, filePath], map: "idx_oss_files_user_bucket_path")
}
```

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

对 `demoCase.materials` 顺序遍历，每一项执行：

```ts
// 1. 读取 admin 源 ossFile
const source = await findOssFileByIdDao(material.sourceOssFileId)
if (!source || source.deletedAt) {
  throw new Error('示范案例资源异常')
}

// 2. 查用户云盘里是否已有指向同一 OSS 对象的行
const existing = await prisma.ossFiles.findFirst({
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
const clone = await prisma.ossFiles.create({
  data: {
    userId: user.id,
    bucketName: source.bucketName,
    fileName: source.fileName,
    filePath: source.filePath,           // 同一 OSS object
    fileSize: source.fileSize,
    fileType: source.fileType,
    source: FileSource.CASE_ANALYSIS,    // 与用户自上传对齐
    status: source.status,
    encrypted: source.encrypted,
    originalMimeType: source.originalMimeType,
  },
})

// 4. 同步克隆识别与嵌入（见 2.3）
await cloneRecognitionAndEmbeddings({
  sourceUserId: source.userId,
  sourceOssFileId: source.id,
  targetUserId: user.id,
  targetOssFileId: clone.id,
})

result.push(toOssFileItem(clone))
```

**顺序执行而非并发**：所有材料在同一个 Prisma `$transaction` 中顺序克隆，保证整个 prepare 操作的原子性。嵌入向量的 pgvector 写入是原生 SQL，使用 `$queryRawUnsafe`/`$executeRawUnsafe` 在同一事务内执行。

任一环节失败整体回滚，返回 500。

#### 2.3 识别记录 + 嵌入向量克隆

新建服务函数 `cloneRecognitionAndEmbeddingsService(input)` 放在 `server/services/case/demoCase.service.ts`。

**识别记录克隆**（三类按需处理）：

```sql
-- 文档识别
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
  AND deleted_at IS NULL
RETURNING id;
```

`image_recognition_records`、`asr_records` 结构类似，字段映射 1:1 复制。若源文件对应表中没有行（admin 尚未完成识别），跳过并继续。

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
  RETURNING id
)
SELECT array_agg(id) FROM copied;
```

返回的新嵌入 id 数组，如有必要，回写到对应识别记录的 `vector_ids` 字段（先插入识别记录时 `vector_ids='[]'`，这里 `UPDATE ... SET vector_ids = $array`）。

**vector_ids 回填说明**：当前检索路径仅通过 `case_material_embeddings.metadata` 的 userId/sourceId 过滤，不走 `recognition_records.vector_ids`。回填仅用于管理面板展示"本文档已生成 N 个向量"这类统计，不影响检索正确性。为了保持识别记录的字段完整性，本设计选择回填；实现时若发现回填路径复杂可在代码 review 时调整为先不回填，留空数组。

#### 2.5 列表端点保持现状

`GET /api/v1/demo-cases` 现有实现已满足前台列表需要，本次不修改。

### 3. Admin 侧改造

#### 3.1 新增 `FileSource.DEMO_CASE`

`shared/types/file.ts` 增加枚举项：

```ts
export enum FileSource {
  // ... 现有 ...
  DEMO_CASE = 'demo_case',
}
```

`shared/utils/fileSourceConfig.ts`（或等价位置）新增上传场景配置：允许常见文档、图片、音频 MIME，文件大小上限暂定 50MB。

OSS 目录按既有模式 `${basePath}user${user.id}/demo_case/`，或者新增"系统资源"目录 `${basePath}system/demo_case/` —— **决定**：沿用既有 per-user 目录，admin 账户本身就是一个正常用户，无需特殊逻辑。

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

**命名区分**：与 `app/components/caseAnalysis/MaterialUploader.vue`（如果存在）不冲突，通过目录 `admin/demo-cases/` 隔离。实现阶段先检查 caseAnalysis 目录下是否有可抽取的公共底层组件，若有则提取到 `app/components/common/` 两侧共用。

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
| admin 上传文件但识别尚未完成 | 克隆 ossFile 成功，`doc_recognition_records` 等表查不到源行 → 跳过该表克隆，无致命错误；前端 `addFiles` 后走既有 `/api/v1/recognition/start` 路径，用户会看到"识别中"→"已识别" |
| admin 源文件被软删 | `prepare` 在 2.2 第 1 步检测到 `source.deletedAt` 非空，整体事务回滚并返回 500 `示范案例资源异常` |
| 用户重复点同一 demo case | `(userId, bucketName, filePath)` 命中 → 返回同一 ossFileId；`AiPromptInput.addFiles` 内部基于 `selectedFileIds` 去重，不会在文件列表里出现两份 |
| 用户已自上传同名文件然后点击 demo case | `filePath` 不同（用户上传生成的是 `user<id>/case_analysis/uuid.pdf`，admin 上传是 `user<adminId>/demo_case/uuid.pdf`），视为两份独立文件。这是预期行为 |
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
   - `cloneRecognitionAndEmbeddingsService`：doc/image/asr 三类识别记录的克隆、源无识别记录的跳过、嵌入向量 metadata 正确更新
3. 新文件 `tests/server/demoCases/prepare.test.ts`
   - `POST /api/v1/demo-cases/:id/prepare` API 层：401 未登录、404 不存在、400 已禁用、200 正常返回 shape（断言 `content` 与 `files[]`）
4. 新文件 `tests/server/admin/demoCaseMaterials.test.ts`
   - Admin 校验：`materials[].type=1` 被拒、`sourceOssFileId` 必填、source ossFile 不存在被拒、`content` 与 `materials` 同时为空被拒

**前端**：本次不新增组件级测试，遵循项目既有前端测试密度。手测脚本写入验收清单（5.3）。

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
