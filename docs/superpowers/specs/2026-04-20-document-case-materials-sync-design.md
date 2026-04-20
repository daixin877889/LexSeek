# 文书助手与案件材料双向同步设计

> **Goal：** 解决"从案件进入新建的文书草稿，文书助手查不到案件材料"的 bug，并顺势打通双向数据通路——从文书助手上传的材料即案件材料；任一侧解绑即同步消失。

---

## 1. 背景与问题

### 1.1 现状

- 从 `/dashboard/cases/:id?tab=documents` 的「+ 新建文书」Sheet 选模板 → POST `/drafts { templateId, caseId }` → 跳编辑页。此流程不走 sourceFileIds，不触发 `ensureMaterialsReadyForDraftService`，draft 作用域下没有任何 `case_materials` 记录。
- `searchCaseMaterials` tool 的分流逻辑（`server/services/workflow/tools/searchCaseMaterials.tool.ts:57-60`）：
  ```ts
  const results = effectiveDraftId
    ? await searchMaterialsByDraftService(...)   // 优先走 draftId
    : await searchMaterialsService(...)          // 有 draftId 就进不来
  ```
  ctx.draftId 对文书 draft 恒为真，caseId 分支永远走不到。
- 结果：即便用户从案件进入的 draft，agent 调用 `search_case_materials` 也只能查 draft 作用域，查不到案件材料。

### 1.2 次生需求（用户同意在一个 spec 中一起处理）

- 从文书助手上传的材料应**就是**案件材料（数据语义统一，不是复制）。
- 从文书编辑页的材料选择器上传时，应禁选"本案件已有 ossFile"。
- 文书编辑页需要一个「查看所有材料」入口，预览本案件+本 draft 的全部材料。
- 案件材料 Tab 里解绑一条记录 → 草稿也同步看不到（预期语义，已由数据模型选择天然满足）。
- 删除整个 draft → 该 draft 关联的材料 `draftId` 置空、`caseId` 保留（不随 draft 消失）。

### 1.3 非目标

- 不修改 `case_materials` 表 schema（现有字段已够用）。
- 不回迁独立文书页历史产生的 `(caseId=null, draftId=Y)` 记录——保留原语义。
- 不重复造材料预览组件，复用现有 `CaseAnalysisDocPreviewDialog` / `CaseAnalysisAudioPreviewDialog` / 内嵌文本 Dialog。
- 不在文书编辑页提供"从 draft 解绑单条材料"的独立 UI（解绑仅经案件材料 Tab）。

---

## 2. 数据模型

`case_materials` 表字段现状保持不变：`caseId: Int?`、`draftId: Int?`、`ossFileId: Int?`、无唯一约束，具 `deletedAt`。

应用层新增一种语义合法组合：

| caseId | draftId | ossFileId | 语义 |
| --- | --- | --- | --- |
| X | null | Z | 案件直接上传（现状） |
| null | Y | Z | 独立文书页上传（现状，向后兼容） |
| **X** | **Y** | **Z** | **从带 caseId 的 draft 上传 —— 一条双绑记录（新）** |

识别表（`docRecognitionRecords` / `imageRecognitionRecords` / `asrRecords`）按 `ossFileId` 索引，与 `case_materials` 记录解耦。软删 `case_materials` 不影响识别结果，相同 ossFile 再次关联时能自动复用已有识别。

---

## 3. 后端改动

### 3.1 `ensureMaterialsReadyForDraftService`

**签名扩展：**

```ts
// 旧
ensureMaterialsReadyForDraftService(ossFileId, draftId, userId)

// 新
ensureMaterialsReadyForDraftService(ossFileId, draftId, userId, caseId?: number | null)
```

**关键改动 — 替换现有查重逻辑：**

现有实现（`materialPipeline.service.ts:630`）是 `findMaterialByDraftIdAndOssFileIdDao(draftId, ossFileId)`——按 `(draftId, ossFileId)` 找现有记录，找不到就新建。**此逻辑下 bug**：case 已有 `(caseId=X, draftId=null, ossFileId=Z)` 时，draft 上传同 ossFile 按 draftId=Y 查不到 → 新建 `(X, Y, Z)` → 同一 ossFile 两条记录并存 → 案件材料 Tab 显示重复项。

**替换为"按 `(userId, ossFileId)` 查活跃记录后分支 upsert"**，保证同一 ossFile 最多一条活跃记录：

```ts
// 新 DAO（可放 material.dao.ts）
export async function findActiveMaterialByOssFileIdDao(userId: number, ossFileId: number) {
    return prisma.caseMaterials.findFirst({
        where: { userId, ossFileId, deletedAt: null },
    })
}

// ensureMaterialsReadyForDraftService 主体改为：
export async function ensureMaterialsReadyForDraftService(
    ossFileId: number,
    draftId: number,
    userId: number,
    caseId?: number | null,
) {
    const existing = await findActiveMaterialByOssFileIdDao(userId, ossFileId)

    let materialId: number
    if (!existing) {
        // 无活跃记录 → 新建双绑或半绑
        const created = await prisma.caseMaterials.create({
            data: { userId, ossFileId, caseId: caseId ?? null, draftId, /* type/name/status 等沿用旧逻辑 */ },
        })
        materialId = created.id
    } else {
        materialId = existing.id
        // 已有活跃记录：按需补齐缺失字段
        const patch: Record<string, unknown> = {}
        if (caseId != null && existing.caseId == null) patch.caseId = caseId
        if (existing.draftId !== draftId)               patch.draftId = draftId
        if (Object.keys(patch).length > 0) {
            await prisma.caseMaterials.update({ where: { id: existing.id }, data: patch })
        }
        // 已 COMPLETED 则直接返回（沿用既有短路行为）
        if (existing.status === MaterialStatus.COMPLETED) {
            return { id: existing.id, status: existing.status, draftId: draftId, ossFileId: existing.ossFileId }
        }
    }
    // 识别 + 嵌入流水线走原有逻辑（按 ossFileId 查既有识别表，COMPLETED 跳过）
    ...
}
```

**边界场景处理（写在实现中的注释，非代码）：**

| existing 状态 | 本次入参 | upsert 结果 | 语义 |
|---|---|---|---|
| `(X, null, Z)` case-only | caseId=X, draftId=Y | 变 `(X, Y, Z)` 双绑 | ✅ 用户原需求 |
| `(null, Y, Z)` draft-only（独立文书页） | caseId=X, draftId=Y | 变 `(X, Y, Z)` 双绑 | ✅ 补齐 caseId |
| `(X, Y, Z)` 双绑已存在 | caseId=X, draftId=Y | 无变更 | ✅ 幂等 |
| `(X, Y_other, Z)` 案件已被另一 draft 绑定 | caseId=X, draftId=Y | 变 `(X, Y, Z)`，原 draft_other 不再绑此材料 | ⚠️ 异常数据：同一 case 下两个活跃 draft 用同文件，本次覆盖原绑定；当前业务不构造该场景，实现时加 `logger.warn` |
| `(X_other, Y_other, Z)` 属于另一用户案件 | - | 不会命中（DAO where 带 `userId`） | ✅ |

- 识别记录按 `ossFileId` 查既有表，若已 COMPLETED 则跳过识别（沿用现有逻辑，无需改动）

**调用点同步：**

- `createDraftService`（POST `/drafts` 时）把 `draft.caseId` 传下去
- `processMaterialsTool`（agent 调用 `process_materials(fileIds)` 时）从 context 取 `caseId` 传下去
- 任何从 draft 端触发材料关联的入口都要带上 caseId

### 3.2 新查询：`findMaterialsByCaseOrDraftIdDao` + `searchMaterialsByCaseOrDraftService`

**DAO（`server/services/material/material.dao.ts`）：**

```ts
async function findMaterialsByCaseOrDraftIdDao(
  caseId: number | null,
  draftId: number | null,
): Promise<CaseMaterial[]> {
  const ors = [
    caseId != null ? { caseId } : null,
    draftId != null ? { draftId } : null,
  ].filter(Boolean)
  if (ors.length === 0) return []
  return prisma.caseMaterials.findMany({
    where: { OR: ors, deletedAt: null },
    orderBy: { createdAt: 'desc' },
  })
}
```

**Service（`server/services/material/materialPipeline.service.ts`）：**

```ts
async function searchMaterialsByCaseOrDraftService(
  userId: number,
  ids: { caseId: number | null; draftId: number | null },
  options: { query?: string; sourceId?: number; k?: number },
): Promise<MaterialHit[]> {
  const materials = await findMaterialsByCaseOrDraftIdDao(ids.caseId, ids.draftId)
  // 双绑记录同时匹配两个分支，Prisma OR 查询天然去重（同一条记录只返一次）
  // 继续走现有 embedding retrieval / 排序逻辑
  return await runRetrievalOverMaterials(userId, materials, options)
}
```

### 3.3 `searchCaseMaterials` tool 替换分流

```ts
// 原 57-60 行二选一分流删掉，改为：
if (caseId == null && !effectiveDraftId) {
  throw new Error('search_case_materials 需要 caseId 或 draftId，当前 context 均缺失')
}
const results = await searchMaterialsByCaseOrDraftService(
  userId,
  { caseId: caseId ?? null, draftId: effectiveDraftId ?? null },
  { query, sourceId, k },
)
```

### 3.4 删除 draft 时 draftId 置空（级联策略 A）

在 `server/services/assistant/document/documentDraft.service.ts` 的 `softDeleteDraftService` 函数内（软删 draft 记录**之前**），加一步：

```ts
await prisma.caseMaterials.updateMany({
  where: { draftId: id, deletedAt: null },
  data: { draftId: null },
})
```

- 双绑记录（有 caseId）的 caseId 保留，案件材料 Tab 仍可见
- 无 caseId 的 draft-only 记录（独立文书页场景）draftId 被置空后既无 caseId 也无 draftId → 变孤儿
  - 兼容现状：现有 schema 下无 `onDelete: Cascade`，旧流程下软删 draft 后这些记录本就孤立
  - 不做额外清理，日后若需要再专门走一次数据清理

### 3.5 新接口 `GET /api/v1/assistant/document/drafts/:id/related-materials`

**路径：** `server/api/v1/assistant/document/drafts/[id]/related-materials.get.ts`

**职责：**

- 鉴权 + owner 校验（沿用现有 draft 接口的保护模式）
- 读 draft → 取 `draft.caseId`
- 调 `findMaterialsByCaseOrDraftIdDao({ caseId: draft.caseId, draftId: draft.id })`
- 响应：`return resSuccess(event, '获取相关材料成功', items)`，其中 `items` 字段对齐前端 `CaseDetailMaterialItem` 接口（`app/composables/useCaseDetail.ts:15-27`）

**类型策略：** handler 内部自己组装返回结构，不从前端 import 类型、也不提升 `CaseDetailMaterialItem` 到 `shared/types/`——当前该类型仅前端消费；若日后后端有多处需要同结构，再提升到 `shared/types/material.ts`。

**为什么不复用 `/api/v1/case/:caseId/materials`：**
- 现有接口只支持 `where caseId=X`，无法覆盖独立文书页 draft（`caseId=null, draftId=Y`）的查询场景
- 合并参数到老接口会污染案件专属语义
- 新接口绑定在 `/assistant/document/drafts/:id` 路径下，语义清晰

前端只需这一个接口同时驱动 "禁用列表" 和 "查看所有材料 Sheet"。

---

## 4. 前端改动

### 4.1 `drafts/[id].vue`

**A. 响应式拉取相关材料：**

```ts
const { data: relatedMaterials } = useApi<CaseDetailMaterialItem[]>(
  () => draftId.value ? `/api/v1/assistant/document/drafts/${draftId.value}/related-materials` : null,
)
const relatedOssFileIds = computed(() =>
  (relatedMaterials.value ?? [])
    .map(m => m.ossFileId)
    .filter((id): id is number => id != null)
)
```

**B. MaterialSelector 禁用合并：**

第 538 行原 `:disabled-file-ids="selectedFileIds"`，改为：

```vue
:disabled-file-ids="[...selectedFileIds, ...relatedOssFileIds]"
```

合并理由：
- `selectedFileIds`：agent chat 本轮临时勾选但未落库的文件（已有逻辑）
- `relatedOssFileIds`：已落库的双绑/单绑材料

**C. 顶部栏「查看所有材料」按钮：**

位置紧邻"历史"按钮：

```vue
<Button variant="outline" size="sm" :disabled="!draft" title="所有材料" @click="allMaterialsOpen = true">
  <FolderIcon class="size-4" />
  <span class="hidden md:inline ml-1">材料</span>
</Button>
```

**D. 预览 state：** 引入与 `cases/[id].vue:98-116` 同构的 `previewMaterial` / `showPreview` / `showTextPreview` / `textContent` / `openMaterialPreview`；模板末尾引入同一套三种预览 Dialog 块（`cases/[id].vue:345-372`）。

**必需 import（Nuxt 不自动导入的部分）：**

```ts
import { CaseMaterialType } from '#shared/types/case'   // openMaterialPreview 分派判断
import { VisuallyHidden } from 'reka-ui'                 // 文本预览 Dialog 中的无障碍包装
```

其余（`Dialog` / `DialogContent` / `DialogHeader` / `DialogTitle` / `DialogDescription` / `useApiFetch` / `FileTextIcon` 等）均为 Nuxt 自动导入。

> 本次不强制抽取预览逻辑为共享 composable 或组件。若 plan 阶段或日后 drafts/[id].vue 与 cases/[id].vue 的预览需求继续分化，再评估抽 `useMaterialPreview`。当前以"两处结构对齐"为优先，避免过早抽象。

### 4.2 `AssistantDocumentAllMaterialsSheet.vue`（新组件）

```ts
defineProps<{
  open: boolean
  materials: CaseDetailMaterialItem[]
  loading?: boolean
}>()
defineEmits<{
  'update:open': [value: boolean]
  'preview-material': [material: CaseDetailMaterialItem]
}>()
```

**只读约束（明确设计意图，非未实现）：** Sheet 不含任何上传/编辑/解绑按钮，仅 emit `preview-material`。新增/编辑/解绑走已有通道（agent chat 文件按钮 上传；案件材料 Tab 解绑）。这是刻意保持 Sheet 轻量的决定。

**模板结构：**

```vue
<Sheet :open @update:open="(v) => emit('update:open', v)">
  <SheetContent side="right" class="w-full sm:w-[50vw] sm:max-w-[720px] z-[70] p-0 flex flex-col">
    <SheetHeader class="shrink-0 p-4 border-b">
      <SheetTitle>所有材料</SheetTitle>
      <SheetDescription>
        本草稿与所属案件共享的全部材料（{{ materials.length }}）
      </SheetDescription>
    </SheetHeader>
    <div class="flex-1 min-h-0 overflow-y-auto p-4">
      <!-- 空态 -->
      <div v-if="!materials.length" class="text-center py-10 text-muted-foreground">
        <FolderIcon class="size-10 opacity-40 mx-auto mb-2" />
        暂无材料
      </div>
      <!-- 列表 -->
      <ul v-else class="divide-y">
        <li v-for="m in materials" :key="m.id"
            class="flex items-center gap-3 p-3 hover:bg-muted/40 cursor-pointer"
            @click="emit('preview-material', m)">
          <component :is="getMaterialIcon(m.type)" class="size-5 shrink-0" />
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium truncate">{{ m.name }}</p>
            <p class="text-xs text-muted-foreground">
              {{ m.typeText }}<span v-if="m.fileSize"> · {{ formatByteSize(m.fileSize, 0) }}</span>
            </p>
          </div>
        </li>
      </ul>
    </div>
  </SheetContent>
</Sheet>
```

**图标/类型/颜色工具函数：** `getMaterialIcon` / `getMaterialBgColor` / `getMaterialIconColor` 已在 `CaseDetailOverview.vue` 实现（文件内 `const getMaterialIcon = ...`）。Sheet 需要这些——方案：

- 优先从 `app/utils/caseMaterial.ts` 导入（若已存在通用工具）
- 若只存在于 `CaseDetailOverview.vue` 内部，**本次抽取**到 `app/utils/caseMaterial.ts` 供两处共用；抽取时保持实现不变，只改 import

### 4.3 `drafts/[id].vue` 挂载 Sheet

```vue
<AssistantDocumentAllMaterialsSheet
  v-model:open="allMaterialsOpen"
  :materials="relatedMaterials ?? []"
  @preview-material="openMaterialPreview"
/>
```

---

## 5. 测试

### 5.1 后端单元测试

| 测试 | 覆盖点 |
| --- | --- |
| `findMaterialsByCaseOrDraftIdDao` | 只 caseId / 只 draftId / 都有 / 都无返回空 / 软删记录不返回 / 多条双绑记录不同 ossFileId 各自返回一次 |
| `findActiveMaterialByOssFileIdDao` | 同 userId 同 ossFileId 的活跃记录唯一返回；软删记录不返回；跨 userId 不串 |
| `ensureMaterialsReadyForDraftService` upsert 四场景 | ① case-only `(X,null,Z)` + 上传(X,Y) → 变 `(X,Y,Z)`；② draft-only `(null,Y,Z)` + 上传(X,Y) → 变 `(X,Y,Z)`；③ 双绑 `(X,Y,Z)` + 重复上传 → 幂等不改；④ 无活跃记录 + 上传 → 新建 `(X,Y,Z)` |
| `searchMaterialsByCaseOrDraftService` | 去重 by id、embedding 检索结果合并排序 |
| `softDeleteDraftService`（级联 draftId 置空） | `case_materials where draftId=Y` 的 `draftId` 被置 null、`caseId` 保留 |
| `searchCaseMaterials` tool | 三种 context（只 draftId / 只 caseId / 双有）都能正确检索 |

### 5.2 前端单元测试

| 测试 | 覆盖点 |
| --- | --- |
| `AllMaterialsSheet.vue` | props 渲染数量、空态文案、点击行 emit `preview-material` |

不为 `drafts/[id].vue` 的 wiring 写单测（属于集成路径，由手动 E2E 覆盖）。

### 5.3 手动 E2E 清单

1. 从案件 Tab 新建草稿 → agent chat 发问让其调 `search_case_materials` → 能命中案件已有材料
2. 在同一草稿通过 agent chat 文件按钮上传一份新材料 → 案件材料 Tab 立刻看见这条新材料
3. 文书编辑页点顶部「材料」按钮 → Sheet 列出案件+草稿合集 → 点击 文档/图片/音频/文本 → 对应预览 Dialog 正确弹出
4. 文书编辑页点 chat 文件按钮弹选择器 → 本案件已有 ossFile 全部显示"已添加"灰显且不可选
5. 案件材料 Tab 解绑某条"原本由文书助手上传"的材料 → 草稿的 Sheet 立刻少了这条，agent 再查也搜不到
6. 在文书列表删除整个草稿 → 该草稿关联的 case_materials 记录 `draftId` 被置空、`caseId` 保留 → 案件材料 Tab 这些材料仍在
7. 独立文书页（无 caseId）新建草稿 → 上传材料 → 行为与改造前一致（draftId-only 记录，Sheet 只显示自己的）
8. （回归验证，非本次新增行为）同一 ossFile 在另一个案件复用时不重跑 MinerU/ASR（识别表按 ossFileId 命中机制在本次改动下未受影响）

---

## 6. 文件清单

**后端新增/改：**

| 文件 | 动作 |
| --- | --- |
| `server/services/material/material.dao.ts` | 新增 `findMaterialsByCaseOrDraftIdDao` + `findActiveMaterialByOssFileIdDao` |
| `server/services/material/materialPipeline.service.ts` | 新增 `searchMaterialsByCaseOrDraftService`；`ensureMaterialsReadyForDraftService` 签名加 `caseId` 并写入记录 |
| `server/services/assistant/document/documentDraft.service.ts` | `createDraftService` 调用 ensureMaterials 传入 draft.caseId；`softDeleteDraftService` 级联 draftId 置空 |
| `server/services/workflow/tools/searchCaseMaterials.tool.ts` | 替换分流逻辑调用新合并 service |
| `server/services/workflow/tools/processMaterials.tool.ts` | 调用 ensureMaterials 时从 ctx 取 caseId 传入 |
| `server/api/v1/assistant/document/drafts/[id]/related-materials.get.ts` | 新接口 |

**前端新增/改：**

| 文件 | 动作 |
| --- | --- |
| `app/components/assistant/document/AllMaterialsSheet.vue` | 新增 Sheet 组件 |
| `app/utils/caseMaterial.ts` | 抽取 `getMaterialIcon` / `getMaterialBgColor` / `getMaterialIconColor` 到现有文件（追加 export；原 `getMaterialType` re-export 不动） |
| `app/components/caseDetail/CaseDetailOverview.vue` | 改为 `import` 工具函数而非内联实现 |
| `app/pages/dashboard/document/drafts/[id].vue` | 拉 relatedMaterials；顶部栏加「材料」按钮；接入 AllMaterialsSheet；预览三件套照抄 |

**测试：**

| 文件 | 动作 |
| --- | --- |
| `tests/server/material/material.dao.caseOrDraft.test.ts` | DAO 单测 |
| `tests/server/material/searchMaterialsByCaseOrDraft.service.test.ts` | Service 单测 |
| `tests/server/assistant/document/documentDraft.service.test.ts` | 扩展：ensureMaterials 带 caseId 路径 + softDelete 级联 |
| `tests/server/workflow/tools/searchCaseMaterials.test.ts` | 新增或扩展：三种 context 分支 |
| `tests/client/components/AllMaterialsSheet.test.ts` | 组件 mount 测试 |

---

## 7. 回滚策略

本次改动**不改 schema、不做数据迁移**：

- 后端扩展 DAO/Service/Tool 分支逻辑，`git revert` 即可回退
- 前端新增组件和 wiring，删除 `AllMaterialsSheet.vue` + 还原 `drafts/[id].vue` 的两处改动
- 已产生的双绑记录 `(caseId=X, draftId=Y)` 回滚后仍符合旧 schema（字段可空、无唯一约束）：
  - `searchMaterialsByDraftService` 下仍能通过 draftId 分支查到
  - `searchMaterialsService` 下仍能通过 caseId 查到
  - 不会丢失，只是"同时被两侧看到"这件事回退成 schema 允许但应用层不利用
