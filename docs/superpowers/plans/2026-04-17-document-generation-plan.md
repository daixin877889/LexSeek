# 文书生成 Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现律师端的文书生成功能：选模板 → 提交材料 → AI 按 schema 填充占位符 → 表单编辑（含实时预览） → 导出 .docx；独立使用与案件详情复用两场景。

**Architecture:** 复用现有 caseMainAgent 骨架搭 `documentMain` agent 节点，LangChain v1 `createAgent` + `responseFormat` 动态 Zod schema；占位符扫描用 mammoth，导出用 docxtemplater，实时预览用 docx-preview；材料走现有 `caseMaterials` 表加 `draftId` 字段，复用 OCR/embedding/检索栈；扣费复用 `pointConsumptionMiddleware`，结果写回复用 analysis 中间件范式新建 `draftResultPersistenceMiddleware`。

**Tech Stack:** Nuxt 4 + Vue 3 + Tailwind v4 + shadcn-vue / Prisma (PostgreSQL + pgvector) / LangChain v1 + LangGraph / Bun / Vitest / Zod v4

**冻结 Spec:** [`docs/superpowers/specs/2026-04-17-document-generation-design.md`](../specs/2026-04-17-document-generation-design.md)（1000 行，经 10 次迭代 + 4 维度 R2 Approved）

---

## 文件结构总览

### 新建文件

**后端服务层**（`server/services/assistant/document/`）：
- `types.ts` — 模块内部类型（Placeholder 值对象等）
- `templateScanner.ts` — mammoth 扫占位符（中英混合正则）
- `draftSchema.builder.ts` — 动态构造 Zod schema
- `documentTemplate.dao.ts` — 模板 CRUD DAO
- `documentTemplate.service.ts` — 模板 CRUD Service + 配额 20 校验
- `documentDraft.dao.ts` — Draft CRUD DAO
- `documentDraft.service.ts` — Draft CRUD Service + sourceRef 预处理
- `documentExport.service.ts` — docxtemplater 渲染导出

**后端中间件 / Agent**：
- `server/services/workflow/middleware/draftResultPersistence.middleware.ts` — afterAgent 写回
- `server/services/workflow/agents/documentMainAgent.ts` — `runDocumentChat` 入口

**后端材料并行扩展**：
- `server/services/material/material.service.ts` — 新增 `getMaterialsByDraftIdService`
- `server/services/material/material.dao.ts` — 新增 `findMaterialsByDraftIdDao`
- `server/services/material/materialPipeline.service.ts` — 新增 `searchMaterialsByDraftService` / `ensureMaterialsReadyForDraftService`

**API 端点**（`server/api/v1/assistant/document/`）：
- `templates.get.ts` / `templates.post.ts`
- `templates/[id].get.ts` / `templates/[id].patch.ts` / `templates/[id].delete.ts`
- `drafts.get.ts` / `drafts.post.ts`
- `drafts/[id].get.ts` / `drafts/[id].patch.ts`
- `drafts/[id]/export.post.ts`

**前端页面**（`app/pages/`）：
- `dashboard/assistant/document.vue` — 独立文书生成主页（新；原 WIP 占位改造）
- `dashboard/assistant/document/templates.vue` — 私人模板管理
- `admin/document-templates.vue` — 全局模板管理（super_admin）

**前端组件**（`app/components/assistant/document/`）：
- `DocumentDraftPanel.vue` — 主容器，支持 `:case-id` prop
- `DocumentTemplatePicker.vue` — 分类 Tab + 模板卡片
- `DocumentSourceInput.vue` — **瘦封装**：`<AiPromptInput>`（复用现有 721 行，含上传/拖拽/进度/识别）+ 案件场景叠加 `<CaseAnalysisMaterialSelector>`（复用现有 562 行）；**严禁重复实现上传 UI 或材料选择 Dialog**
- `DocumentRunStatus.vue` — runStatus 展示
- `DocumentFieldForm.vue` — 字段表单（控件推断 4 种）
- `DocumentPreview.vue` — docx-preview + TreeWalker 替换

**前端 composable**：
- `app/composables/useDocumentDraft.ts` — 基于 `useStreamChat` 的 draft 数据流封装

**共享类型**：
- `shared/types/document.ts` — 业务枚举 + 值对象 + API 请求响应接口

**数据库 & Seed**：
- `prisma/models/document.prisma` — documentTemplates + documentDrafts（新文件，按 Prisma 模块化惯例）
- `prisma/seeds/document-templates/*.docx` — 3-5 个样本模板
- `prisma/seed.ts` — 追加 `seedDocumentMainNode` / `seedDocumentDraftTokenRule` / `seedDocumentTemplates` 函数
- `prisma/seeds/seedData.sql` — 追加 node / prompt / point_consumption_items 行

**脚本**：
- `scripts/importDocumentTemplates.ts` — CSV 批量导入

### 修改文件

- `server/services/workflow/tools/types.ts` — `ToolContext` 加 `draftId?: number`
- `server/services/workflow/tools/searchCaseMaterials.tool.ts` — schema 加 draftId；createTool 内 if 分支
- `server/services/workflow/utils/promptRenderer.ts` — `PromptRenderContext` 加 `templateName` / `templateCategory`
- `server/services/agent/agentWorker.ts:164+` — scope 分流链前端加 `if (session.scope === 'document')`
- `prisma/models/case.prisma` — `caseMaterials.caseId` DROP NOT NULL + 新增 `draftId` 字段 + 索引
- `app/pages/dashboard/document.vue` — 原 WIP 占位页删除（被新 `document.vue` 替代；路径需要调整）

### 依赖安装

```bash
bun add docxtemplater pizzip          # M1 需要
bun add docx-preview                   # M5 需要（可 M1 一并装）
```

---

## 里程碑导航

| 里程碑 | 章节 | 交付单元 |
|---|---|---|
| M1 | §1 数据层 + 依赖 | 两张新表、caseMaterials 迁移、templateScanner、样本模板 seed |
| M2 | §2 模板 API + admin 页 | 模板 CRUD 全套、配额校验、admin 管理页 |
| M3 | §3 AI 填充闭环 | documentMain 节点、draftSchema、工具扩展、中间件、Worker 分支、draft API |
| M4 | §4 用户页 + 导出 | DocumentDraftPanel 主流程、导出 API、下载 |
| M5 | §5 实时预览 | docx-preview 集成 + TreeWalker 替换 + 降级准备 |
| M6 | §6 案件 tab 复用 | caseDetail documents tab + caseMaterials 预填 |
| M7 | §7 批量导入 + E2E | import 脚本 + 完整 E2E + 覆盖率达标 |

**依赖链**：M1 → M2/M3（并行，M2 需模板数据源，M3 需 agent 基建）→ M4（依赖 M3）→ M5 / M6（依赖 M4）→ M7（依赖 M4）

---

## §1 M1 数据层 + 依赖

### Task 1.1: 安装第三方依赖

**Files:**
- Modify: `package.json`, `bun.lock`

- [ ] **Step 1: 安装后端 .docx 生成依赖**

Run: `bun add docxtemplater pizzip`
Expected: `package.json` 新增两行依赖，`bun.lock` 更新

- [ ] **Step 2: 安装前端 .docx 预览依赖**

Run: `bun add docx-preview`
Expected: `package.json` 新增 `docx-preview` 依赖

- [ ] **Step 3: 验证导入**

创建临时测试脚本 `/tmp/deps.ts`：
```typescript
import Docxtemplater from 'docxtemplater'
import PizZip from 'pizzip'
console.log('docxtemplater ok:', typeof Docxtemplater, 'pizzip ok:', typeof PizZip)
```
Run: `bun /tmp/deps.ts && rm /tmp/deps.ts`
Expected: `docxtemplater ok: function pizzip ok: function`

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lock
git commit -m "chore(assistant): 安装文书生成依赖 docxtemplater/pizzip/docx-preview"
```

### Task 1.2: Prisma schema — caseMaterials 加 draftId + 新增 documentTemplates/documentDrafts

**Files:**
- Modify: `prisma/models/case.prisma` (caseMaterials)
- Create: `prisma/models/document.prisma`
- Test: 通过 `bun run prisma:migrate dev` 验证

- [ ] **Step 1: 修改 `prisma/models/case.prisma` 的 caseMaterials**

找到 `model caseMaterials`，做 2 处修改：
- 将 `caseId Int @map("case_id")` 改为 `caseId Int? @map("case_id")`
- 在字段区新增 `draftId Int? @map("draft_id")`
- 在关系区新增 `draft documentDrafts? @relation(fields: [draftId], references: [id], onDelete: NoAction, onUpdate: NoAction)`
- 在 `@@index` 区新增 `@@index([draftId], map: "idx_case_materials_draft")`

- [ ] **Step 2: 创建 `prisma/models/document.prisma`**

按 spec §5.1 + §5.2（含 sessionId `@@unique` override） + 父 spec §4.7 / §4.8 定义两个模型：

```prisma
model documentTemplates {
    id             Int       @id @default(autoincrement())
    name           String    @db.VarChar(200)
    category       String    @db.VarChar(100)
    scope          String    @default("global") @db.VarChar(20)
    userId         Int?      @map("user_id")
    ossFileId      Int       @map("oss_file_id")
    placeholders   Json      @default("[]") @db.JsonB
    description    String?   @db.VarChar(500)
    priority       Int       @default(100)
    status         Int       @default(1)
    createdAt      DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
    updatedAt      DateTime  @default(now()) @map("updated_at") @db.Timestamptz(6)
    deletedAt      DateTime? @map("deleted_at") @db.Timestamptz(6)

    user  users?            @relation(fields: [userId], references: [id], onDelete: NoAction, onUpdate: NoAction)
    drafts documentDrafts[]

    @@index([scope, userId], map: "idx_doc_templates_scope_user")
    @@index([category], map: "idx_doc_templates_category")
    @@index([status, deletedAt], map: "idx_doc_templates_status")
    @@map("document_templates")
}

model documentDrafts {
    id            Int       @id @default(autoincrement())
    userId        Int       @map("user_id")
    caseId        Int?      @map("case_id")
    sessionId     String    @map("session_id") @db.VarChar(100)
    templateId    Int       @map("template_id")
    values        Json      @default("{}") @db.JsonB
    sourceRef     Json?     @db.JsonB
    metadata      Json?     @db.JsonB
    outputFileId  Int?      @map("output_file_id")
    status        String    @default("drafting") @db.VarChar(30)
    createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
    updatedAt     DateTime  @default(now()) @map("updated_at") @db.Timestamptz(6)
    deletedAt     DateTime? @map("deleted_at") @db.Timestamptz(6)

    user     users             @relation(fields: [userId], references: [id], onDelete: NoAction, onUpdate: NoAction)
    case     cases?            @relation(fields: [caseId], references: [id], onDelete: NoAction, onUpdate: NoAction)
    template documentTemplates @relation(fields: [templateId], references: [id], onDelete: NoAction, onUpdate: NoAction)
    materials caseMaterials[]

    @@unique([sessionId], map: "idx_doc_drafts_session")
    @@index([userId, deletedAt], map: "idx_doc_drafts_user")
    @@index([caseId], map: "idx_doc_drafts_case")
    @@index([templateId], map: "idx_doc_drafts_template")
    @@map("document_drafts")
}
```

- [ ] **Step 3: 修改 `prisma/models/user.prisma` / `prisma/models/case.prisma` 加反向关系**

- `users` 模型追加：`documentTemplates documentTemplates[]` 和 `documentDrafts documentDrafts[]`
- `cases` 模型追加：`documentDrafts documentDrafts[]`

- [ ] **Step 4: 生成 migration 并应用**

Run: `bun run prisma:migrate dev --name add_document_templates_and_drafts_and_case_materials_draft_id`
Expected: 创建 migration 文件、`documentTemplates` / `documentDrafts` 表落地、`case_materials.case_id` DROP NOT NULL、`case_materials.draft_id` 新增、所有索引落地

- [ ] **Step 5: 验证 prisma client 类型生成**

Run: `bun run prisma:generate && npx nuxi typecheck 2>&1 | head -30`
Expected: prisma/client 含 `documentTemplates` / `documentDrafts` 类型导出；若 caseId 改 optional 引发类型报错，在本步修复所有 non-null 假设（例如加 `!` 或 optional chaining）

- [ ] **Step 6: Commit**

```bash
git add prisma/models/case.prisma prisma/models/document.prisma prisma/models/user.prisma prisma/migrations/
git commit -m "feat(db): 新增文书生成两张表 + caseMaterials 加 draftId 字段"
```

### Task 1.3: `shared/types/document.ts` 业务类型

**Files:**
- Create: `shared/types/document.ts`
- Test: 通过 typecheck 验证导入

- [ ] **Step 1: 创建 `shared/types/document.ts`**

按 spec §8.2.1 写入：

```typescript
/**
 * 文书生成相关业务类型
 *
 * 约定：Prisma row 类型直接从 #shared/types/prisma 导入，不在此处手写镜像。
 * 本文件只放业务枚举、API 请求响应、值对象。
 */

// ==================== 分类枚举 ====================
export const DOCUMENT_CATEGORIES = [
    { key: 'general',          label: '律师通用工具' },
    { key: 'litigation',       label: '起诉·应诉·上诉' },
    { key: 'procedure',        label: '流程变更·程序操作' },
    { key: 'evidence',         label: '证据·鉴定·调查取证' },
    { key: 'preservation',     label: '保全·冻结·先予执行' },
    { key: 'enforcement',      label: '执行·追偿·强制措施' },
    { key: 'arbitration',      label: '仲裁·调解·担保物权' },
    { key: 'protection_order', label: '人身安全保护令' },
    { key: 'identity',         label: '身份·监护·失踪' },
] as const

export type DocumentCategoryKey = typeof DOCUMENT_CATEGORIES[number]['key']
export const DOCUMENT_CATEGORY_KEYS = DOCUMENT_CATEGORIES.map(c => c.key) as readonly DocumentCategoryKey[]

// ==================== Draft 状态枚举 ====================
export type DocumentDraftStatus = 'drafting' | 'filling' | 'ready' | 'exported' | 'failed'

// ==================== 值对象 ====================
export interface Placeholder {
    name: string
    firstContext: string
}

export interface DocumentSourceRef {
    text?: string
    fileIds?: number[]
    caseId?: number
}

export interface DocumentDraftMetadata {
    suggestions?: Record<string, string>
}

// ==================== API 请求/响应 ====================
export interface CreateDraftRequest {
    templateId: number
    sourceText?: string
    sourceFileIds?: number[]
    caseId?: number
}

export interface CreateDraftResponse {
    draftId: number
    sessionId: string
}

export interface PatchDraftRequest {
    values: Record<string, string | null>
}

export interface ExportDraftResponse {
    ossFileId: number
    downloadUrl: string
}
```

- [ ] **Step 2: Typecheck**

Run: `npx nuxi typecheck 2>&1 | grep document`
Expected: 无 error

- [ ] **Step 3: Commit**

```bash
git add shared/types/document.ts
git commit -m "feat(types): 新增 shared/types/document.ts 文书生成业务类型"
```

### Task 1.4: `templateScanner` 中英混合占位符扫描

**Files:**
- Create: `server/services/assistant/document/templateScanner.ts`
- Create: `server/services/assistant/document/types.ts` (若不存在)
- Test: `tests/server/assistant/document/templateScanner.test.ts`

- [ ] **Step 1: 准备 fixture .docx**

先写 5 个最小 .docx 到 `tests/fixtures/document-templates/`（可用 `docx` 库脚本生成；保持 ≤ 1KB）：
- `english.docx`：只含 `{{plaintiff_name}}` / `{{loan_amount}}` 等英文占位符
- `chinese.docx`：只含 `{{原告}}` / `{{借款金额}}` 等中文占位符
- `mixed.docx`：混合中英 + 重复占位符
- `empty.docx`：无占位符的普通文档
- `long-context.docx`：占位符所在段落超过 200 字

- [ ] **Step 2: 写失败测试**

创建 `tests/server/assistant/document/templateScanner.test.ts`：

```typescript
import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { scanPlaceholders } from '~~/server/services/assistant/document/templateScanner'

describe('scanPlaceholders', () => {
    it('提取纯英文占位符', async () => {
        const buf = await readFile('tests/fixtures/document-templates/english.docx')
        const result = await scanPlaceholders(buf)
        expect(result.map(p => p.name)).toEqual(expect.arrayContaining(['plaintiff_name', 'loan_amount']))
    })

    it('提取纯中文占位符', async () => {
        const buf = await readFile('tests/fixtures/document-templates/chinese.docx')
        const result = await scanPlaceholders(buf)
        expect(result.map(p => p.name)).toEqual(expect.arrayContaining(['原告', '借款金额']))
    })

    it('中英混合 + 去重', async () => {
        const buf = await readFile('tests/fixtures/document-templates/mixed.docx')
        const result = await scanPlaceholders(buf)
        const names = result.map(p => p.name)
        expect(names).toContain('原告')
        expect(names).toContain('plaintiff_id')
        expect(new Set(names).size).toBe(names.length) // 去重
    })

    it('每个占位符携带首次出现段落上下文', async () => {
        const buf = await readFile('tests/fixtures/document-templates/mixed.docx')
        const result = await scanPlaceholders(buf)
        const pl = result.find(p => p.name === '原告')
        expect(pl?.firstContext).toContain('原告') // 包含段落原文
    })

    it('无占位符返回空数组', async () => {
        const buf = await readFile('tests/fixtures/document-templates/empty.docx')
        const result = await scanPlaceholders(buf)
        expect(result).toEqual([])
    })
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run tests/server/assistant/document/templateScanner.test.ts --reporter=verbose`
Expected: FAIL with "Cannot find module templateScanner"

- [ ] **Step 3: 实现 `templateScanner.ts`**

按 spec §8.1 编写：

```typescript
/**
 * 文书模板占位符扫描器
 *
 * 用 mammoth 提取 .docx 纯文本，正则匹配 {{name}} 占位符。
 * 支持中英混合命名（name 由 \u4e00-\u9fa5 或 \w 字符组成）。
 */
import mammoth from 'mammoth'
import type { Placeholder } from '#shared/types/document'

const PLACEHOLDER_RE = /\{\{([\u4e00-\u9fa5\w]+)\}\}/g

export async function scanPlaceholders(docxBuffer: Buffer): Promise<Placeholder[]> {
    const { value: rawText } = await mammoth.extractRawText({ buffer: docxBuffer })
    const map = new Map<string, string>()
    let match: RegExpExecArray | null
    while ((match = PLACEHOLDER_RE.exec(rawText)) !== null) {
        const name = match[1]
        if (!map.has(name)) {
            const lineStart = rawText.lastIndexOf('\n', match.index) + 1
            const lineEnd = rawText.indexOf('\n', match.index + match[0].length)
            const firstContext = rawText.slice(lineStart, lineEnd === -1 ? undefined : lineEnd)
            map.set(name, firstContext)
        }
    }
    return [...map.entries()].map(([name, firstContext]) => ({ name, firstContext }))
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run tests/server/assistant/document/templateScanner.test.ts --reporter=verbose`
Expected: 5/5 passed

- [ ] **Step 5: Commit**

```bash
git add server/services/assistant/document/templateScanner.ts \
        tests/server/assistant/document/templateScanner.test.ts \
        tests/fixtures/document-templates/
git commit -m "feat(assistant): 新增 templateScanner 支持中英混合占位符扫描"
```

### Task 1.5: 3-5 个样本模板入仓 + 样本 seed 函数

**Files:**
- Create: `prisma/seeds/document-templates/*.docx`（5 个，对应产品默认 O1：起诉状/答辩状/委托代理合同/律师函/民事协议）
- Modify: `prisma/seed.ts` 追加 `seedDocumentTemplates`
- Modify: `prisma/seeds/seedData.sql` 不加样本模板（需 OSS），只在后续 Task 3.9 补 nodes/prompts/计费键

> **前置说明**：产品 O1 未最终确认时，默认选用上述 5 份（与 spec §15 O1 "建议" 对齐）；若 M1 启动前产品改口，替换文件即可。

- [ ] **Step 1: 准备 5 个样本模板**

放入 `prisma/seeds/document-templates/`：
- `民间借贷起诉状.docx`（category=`litigation`）
- `民事答辩状.docx`（category=`litigation`）
- `委托代理合同.docx`（category=`general`）
- `律师函.docx`（category=`general`）
- `民事调解协议.docx`（category=`arbitration`）

每个模板至少包含 5-10 个中英文混合占位符（如 `{{原告}}` / `{{plaintiff_id_number}}` / `{{借款金额}}` / `{{签订日期}}`）。

- [ ] **Step 2: 追加 `seedDocumentTemplates` 到 `prisma/seed.ts`**

**OSS 上传真实 API**（参考 `server/services/workflow/tools/uploadWorkspaceFile.tool.ts:184-213`）：
1. `uploadFileService(ossPath, buffer, { contentType, userId? })` → 返回 `UploadResult`
2. `getDefaultStorageConfigDao(StorageProviderType.ALIYUN_OSS)` → 拿 bucket name
3. `createOssFileDao({ userId, bucketName, fileName, filePath: uploadResult.name, fileSize, fileType, source })` → 返回 `ossFiles` row
4. `ossFile.id` 即 `documentTemplates.ossFileId`

```typescript
import fs from 'node:fs'
import path from 'node:path'
import { scanPlaceholders } from '~~/server/services/assistant/document/templateScanner'
import { uploadFileService } from '~~/server/services/storage/storage.service'
import { createOssFileDao } from '~~/server/services/files/ossFiles.dao'
import { getDefaultStorageConfigDao } from '~~/server/services/storage/storageConfig.dao'
import { StorageProviderType } from '~~/shared/types/storage'

const CATEGORY_BY_NAME_PREFIX: Record<string, string> = {
    '民间借贷起诉状': 'litigation',
    '民事答辩状': 'litigation',
    '委托代理合同': 'general',
    '律师函': 'general',
    '民事调解协议': 'arbitration',
}

async function seedDocumentTemplates(prismaClient: PrismaClient): Promise<void> {
    const dir = path.join(process.cwd(), 'prisma/seeds/document-templates')
    if (!fs.existsSync(dir)) return

    const storageConfig = await getDefaultStorageConfigDao(StorageProviderType.ALIYUN_OSS)
    const bucketName = storageConfig?.bucket ?? ''

    const files = fs.readdirSync(dir).filter(f => f.endsWith('.docx'))
    for (const file of files) {
        const name = path.basename(file, '.docx')
        const category = CATEGORY_BY_NAME_PREFIX[name]
        if (!category) {
            console.warn(`[seed] 样本模板 ${name} 未映射到 category，跳过`)
            continue
        }

        const existing = await prismaClient.documentTemplates.findFirst({
            where: { name, scope: 'global', deletedAt: null },
        })
        if (existing) continue

        const buffer = fs.readFileSync(path.join(dir, file))
        const placeholders = await scanPlaceholders(buffer)
        if (placeholders.length === 0) {
            throw new Error(`[seed] 样本模板 ${file} 无占位符，请检查`)
        }

        // 上传到 OSS + 写 ossFiles 行
        const ossPath = `seed-templates/${Date.now()}_${file}`
        const uploadResult = await uploadFileService(ossPath, buffer, {
            contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        })
        const ossFile = await createOssFileDao({
            userId: null,
            bucketName,
            fileName: file,
            filePath: uploadResult.name,
            fileSize: buffer.length,
            fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            source: FileSource.DOCUMENT_TEMPLATE,
            status: OssFileStatus.UPLOADED,
            encrypted: false,
        })

        await prismaClient.documentTemplates.create({
            data: {
                name,
                category,
                scope: 'global',
                userId: null,
                ossFileId: ossFile.id,
                placeholders: placeholders as any,
                description: `系统预置：${name}`,
                priority: 100,
                status: 1,
            },
        })
        console.log(`[seed] 文书模板写入：${name}（${placeholders.length} 个占位符）`)
    }
}
```

注：`FileSource` enum 若无 `DOCUMENT_TEMPLATE` 值，需先在 `shared/types/file.ts` 追加。

- [ ] **Step 3: 在 `main()` 中调用**

```typescript
async function main(): Promise<void> {
    // ... 现有调用 ...
    await seedDocumentTemplates(prisma)
}
```

- [ ] **Step 4: 运行 seed 验证**

Run: `bun prisma db seed`
Expected: `[seed] 文书模板写入：民间借贷起诉状（N 个占位符）` 等 5 行 log

- [ ] **Step 5: DB 验证**

```bash
psql $DATABASE_URL -c "SELECT name, category, jsonb_array_length(placeholders) FROM document_templates WHERE scope='global';"
```
Expected: 5 行

- [ ] **Step 6: 幂等验证**

Run: `bun prisma db seed`
Expected: 无重复插入，log 不打印

- [ ] **Step 7: Commit**

```bash
git add prisma/seeds/document-templates/*.docx prisma/seed.ts
git commit -m "feat(assistant): seed 5 个样本文书模板"
```

### M1 验收

- [ ] migration 成功应用
- [ ] `bun prisma db seed` 后 document_templates 有 5 行，document_drafts 为空
- [ ] `npx nuxi typecheck` 通过
- [ ] `npx vitest run tests/server/assistant/document/templateScanner.test.ts` 5/5 passed

---

## §2 M2 模板 API + Admin 页

### Task 2.1: 模板 DAO

**Files:**
- Create: `server/services/assistant/document/documentTemplate.dao.ts`
- Test: `tests/server/assistant/document/documentTemplate.dao.test.ts`

- [ ] **Step 1: 写失败测试（覆盖 happy path + 配额边界）**

涵盖：`createDocumentTemplateDAO`、`getDocumentTemplateDAO`、`listDocumentTemplatesDAO`（按 scope/category/q 过滤 + 分页）、`updateDocumentTemplateDAO`、`softDeleteDocumentTemplateDAO`、`countUserTemplatesDAO`

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run tests/server/assistant/document/documentTemplate.dao.test.ts`
Expected: FAIL with module not found

- [ ] **Step 3: 实现 DAO**

方法名后缀 `DAO`（`.claude/rules/api.md` 规范）。查询 `deletedAt: null`；列表查询支持 `scope` / `category` / `q`（name ILIKE） / 分页。

- [ ] **Step 4: 运行测试验证通过**

Expected: ALL passed

- [ ] **Step 5: Commit**

```bash
git add server/services/assistant/document/documentTemplate.dao.ts \
        tests/server/assistant/document/documentTemplate.dao.test.ts
git commit -m "feat(assistant): 新增 documentTemplate DAO"
```

### Task 2.2: 模板 Service（含配额 20 校验）

**Files:**
- Create: `server/services/assistant/document/documentTemplate.service.ts`
- Test: `tests/server/assistant/document/documentTemplate.service.test.ts`

- [ ] **Step 1: 写失败测试**

必覆盖：
- 用户上传成功（扫描占位符成功）
- 扫描无占位符 → 抛错
- 配额边界：20 个成功 / 第 21 个被拒（并发 2 个请求只 1 个成功 → 测 `$transaction` 串行化）
- admin 上传自动 scope=global
- 文件大小 > 20MB 拒绝
- 格式非 .docx 拒绝

- [ ] **Step 2: 运行测试验证失败**

- [ ] **Step 3: 实现 Service**

**OSS 上传真实 API**：与 Task 1.5 Step 2 一致，用 `uploadFileService + createOssFileDao` 替代虚构的 `uploadBufferToOSS`（见 `server/services/workflow/tools/uploadWorkspaceFile.tool.ts:184-213` 参考实现）。

```typescript
import { uploadFileService } from '~~/server/services/storage/storage.service'
import { createOssFileDao } from '~~/server/services/files/ossFiles.dao'
import { getDefaultStorageConfigDao } from '~~/server/services/storage/storageConfig.dao'
import { StorageProviderType } from '~~/shared/types/storage'

export const MAX_PRIVATE_TEMPLATES = 20

export async function createDocumentTemplateService(params: {
    userId: number
    isAdmin: boolean
    file: Buffer
    fileName: string
    fileSize: number
    mimeType: string
    name: string
    category: DocumentCategoryKey
    description?: string
}): Promise<{ templateId: number } | { error: string; code: number }> {
    // 1. 文件大小 / 格式校验
    if (params.fileSize > 20 * 1024 * 1024) return { error: '文件不能超过 20MB', code: 413 }
    if (!params.fileName.endsWith('.docx')) return { error: '仅支持 .docx 格式', code: 400 }

    // 2. 扫描占位符
    const placeholders = await scanPlaceholders(params.file)
    if (placeholders.length === 0) return { error: '未扫描到占位符，请检查模板', code: 400 }

    // 3. 上传 helper（抽出便于两分支复用）
    async function uploadAndCreate(scope: 'user' | 'global', userId: number | null) {
        const storageConfig = await getDefaultStorageConfigDao(StorageProviderType.ALIYUN_OSS, userId ?? undefined)
        const bucketName = storageConfig?.bucket ?? ''
        const ossPath = scope === 'user'
            ? `users/${params.userId}/templates/${Date.now()}_${params.fileName}`
            : `global-templates/${Date.now()}_${params.fileName}`
        const uploadResult = await uploadFileService(ossPath, params.file, { contentType: params.mimeType, userId: userId ?? undefined })
        const ossFile = await createOssFileDao({
            userId,
            bucketName,
            fileName: params.fileName,
            filePath: uploadResult.name,
            fileSize: params.fileSize,
            fileType: params.mimeType,
            source: FileSource.DOCUMENT_TEMPLATE,
            status: OssFileStatus.UPLOADED,
            encrypted: false,
        })
        return ossFile.id
    }

    // 4. 配额校验（scope=user 且 transaction 内串行）
    if (!params.isAdmin) {
        return await prisma.$transaction(async (tx) => {
            const count = await tx.documentTemplates.count({
                where: { userId: params.userId, scope: 'user', deletedAt: null },
            })
            if (count >= MAX_PRIVATE_TEMPLATES) return { error: `私人模板已达上限 ${MAX_PRIVATE_TEMPLATES} 个`, code: 403 }

            const ossFileId = await uploadAndCreate('user', params.userId)
            const template = await tx.documentTemplates.create({
                data: {
                    name: params.name, category: params.category, scope: 'user',
                    userId: params.userId, ossFileId, placeholders: placeholders as any,
                    description: params.description, priority: 100, status: 1,
                },
            })
            return { templateId: template.id }
        })
    }

    // 5. admin 上传：scope=global
    const ossFileId = await uploadAndCreate('global', null)
    const template = await prisma.documentTemplates.create({
        data: {
            name: params.name, category: params.category, scope: 'global',
            userId: null, ossFileId, placeholders: placeholders as any,
            description: params.description, priority: 100, status: 1,
        },
    })
    return { templateId: template.id }
}
```

- [ ] **Step 4: 运行测试通过**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(assistant): 新增 documentTemplate service（含配额 20 校验）"
```

### Task 2.3: 模板 API 端点（5 个）

**Files:**
- Create: `server/api/v1/assistant/document/templates.get.ts` / `.post.ts`
- Create: `server/api/v1/assistant/document/templates/[id].get.ts` / `.patch.ts` / `.delete.ts`
- Test: `tests/server/assistant/document/templates.api.test.ts`

- [ ] **Step 1: 写失败集成测试**

覆盖每个端点 happy path + 一例 4xx：
- GET / 列表（scope 过滤）
- POST / 上传（multipart/form-data，用 FormData fixture）
- GET /:id
- PATCH /:id 改元信息
- DELETE /:id 软删
- 配额=20 边界（并发请求只一个成功）
- 扫描失败回 400

- [ ] **Step 2-4: 实现 5 个端点 → 跑测试通过**

每个端点：`defineEventHandler` + zod `safeParse` + 调 service + `resSuccess`/`resError`
文件上传用 `readMultipartFormData(event)` 获取 file blob
`event.context.auth?.user.id` 拿 userId；`event.context.auth?.user.role` 判断 admin

- [ ] **Step 5: Commit**

```bash
git add server/api/v1/assistant/document/ tests/server/assistant/document/templates.api.test.ts
git commit -m "feat(api): 新增文书模板 CRUD 5 个端点"
```

### Task 2.4: Admin 模板管理页

**Files:**
- Create: `app/pages/admin/document-templates.vue`

- [ ] **Step 1: 复用现有 admin layout 写列表 + 上传 dialog**

参考 `app/pages/admin/` 下的其他页面（如果有）或直接用 shadcn-vue 的 Table + Dialog + Input。
包含：列表（分页/搜索/分类过滤）/ 上传对话框 / 编辑元信息 dialog / 删除确认 / 启用禁用 toggle

- [ ] **Step 2: 页面通过 middleware / RBAC 保护，仅 super_admin 可访问**

`definePageMeta({ layout: 'admin-layout', middleware: ['auth', 'admin'] })` 或现有等价机制

- [ ] **Step 3: 手测：浏览器登录 super_admin → /admin/document-templates → 上传一个 .docx → 列表出现**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(admin): 新增全局文书模板管理页"
```

### Task 2.5: 私人模板管理页

**Files:**
- Create: `app/pages/dashboard/assistant/document/templates.vue`

- [ ] **Step 1: 类比 admin 页实现私人模板列表 + 上传**

显示"已用 X / 20"；上传满 20 个时上传按钮 disabled + tooltip。

- [ ] **Step 2: 手测 + Commit**

```bash
git commit -m "feat(assistant): 新增私人文书模板管理页"
```

### M2 验收

- [ ] admin 浏览器登录 → 上传 .docx → 列表可见
- [ ] 普通用户浏览器登录 → /dashboard/assistant/document/templates → 上传第 21 个被拒 + 错误提示
- [ ] `npx vitest run tests/server/assistant/document/` 全绿

---

## §3 M3 AI 填充闭环（关键里程碑）

### Task 3.1: PoC 验证 `state.structuredResponse` 可见性

**Files:**
- Create: `tests/server/workflow/createAgent.responseFormat.poc.test.ts`

**目的**：确认 LangChain v1 `createAgent` 的 `responseFormat` 结果能在 `afterAgent` 中间件 hook 中通过 `state.structuredResponse` 读取。这是 §6.6 `draftResultPersistenceMiddleware` 的前提假设。

- [ ] **Step 1: 写 PoC 测试**

```typescript
import { describe, it, expect } from 'vitest'
import { createAgent, createMiddleware } from 'langchain'
import { z } from 'zod'

describe('createAgent responseFormat → state.structuredResponse', () => {
    it('afterAgent hook 能读到 state.structuredResponse', async () => {
        const captured: any = {}
        const spy = createMiddleware({
            name: 'Spy',
            afterAgent: { hook: async (state: any) => { captured.structured = state.structuredResponse } },
        })

        const agent = createAgent({
            model: /* 现有 createChatModel(dev 模型) */,
            tools: [],
            systemPrompt: '返回 {"x": "hi"}',
            responseFormat: z.object({ x: z.string() }),
            middleware: [spy],
        })

        await agent.invoke({ messages: [{ role: 'user', content: '返回 x=hi' }] })
        expect(captured.structured).toBeDefined()
        expect(captured.structured).toHaveProperty('x')
    })
})
```

- [ ] **Step 2: 运行（需真实模型，mark skip 在 CI 上，本地 dev 跑）**

Run: `SKIP_E2E=false npx vitest run tests/server/workflow/createAgent.responseFormat.poc.test.ts`

**如果 PASS**：确认 §6.6 方案可行，进下一步。
**如果 FAIL**：spec §14 R3b 回退路径生效——修改 §6.6 `draftResultPersistenceMiddleware` 改为从 `state.messages.at(-1)` 的 `additional_kwargs.parsed` 或 content 做 JSON parse。对应修改见 §14 R3b 回退方案；同时更新 §6.6 代码示例（为后续任务作参考）。

- [ ] **Step 3: Commit**

```bash
git commit -m "test(assistant): PoC 验证 LangChain v1 responseFormat state 可见性"
```

### Task 3.2: 接口扩展 PromptRenderContext + ToolContext

**Files:**
- Modify: `server/services/workflow/utils/promptRenderer.ts`
- Modify: `server/services/workflow/tools/types.ts`
- Test: `tests/server/workflow/promptRenderer.test.ts`（新增 case） + `tests/server/workflow/tools/searchCaseMaterials.test.ts`（后续 Task 3.4 改）

- [ ] **Step 1: 扩展 PromptRenderContext**

追加 2 字段到 `PromptRenderContext`：

```typescript
export interface PromptRenderContext {
    caseId?: number
    moduleName?: string
    caseType?: string
    templateName?: string       // 新增
    templateCategory?: string   // 新增
}
```

在 `renderSystemPrompt` body 的 `variables` 组装处追加：
```typescript
if (context.templateName) variables.templateName = context.templateName
if (context.templateCategory) variables.templateCategory = context.templateCategory
```

- [ ] **Step 2: 扩展 ToolContext**

追加 1 字段到 `ToolContext`：

```typescript
export interface ToolContext {
    userId: number
    caseId?: number
    sessionId: string
    runId?: string
    draftId?: number   // 新增
}
```

- [ ] **Step 3: 增补 renderSystemPrompt 测试（验证新变量替换）**

- [ ] **Step 4: typecheck + 测试通过**

Run: `npx nuxi typecheck 2>&1 | head -10 && npx vitest run tests/server/workflow/promptRenderer.test.ts`

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(workflow): 扩展 PromptRenderContext/ToolContext 支持文书生成上下文"
```

### Task 3.3: Material pipeline 并行扩展（draftId-based 3+1 函数）

**Files:**
- Modify: `server/services/material/material.dao.ts` （加 `findMaterialsByDraftIdDao`）
- Modify: `server/services/material/material.service.ts` （加 `getMaterialsByDraftIdService`）
- Modify: `server/services/material/materialPipeline.service.ts` （加 `searchMaterialsByDraftService` + `ensureMaterialsReadyForDraftService`）
- Test: `tests/server/material/material.dao.draft.test.ts` + `tests/server/material/materialPipeline.draft.test.ts`

- [ ] **Step 1: 写失败测试**

`findMaterialsByDraftIdDao(draftId)` 返回 `WHERE draftId=X AND deletedAt IS NULL` 的 materials
`getMaterialsByDraftIdService(draftId)` 同 case 版本但按 draftId
`searchMaterialsByDraftService(userId, draftId, opts)`：
  1. 取 draft 的 sourceIds（材料 id 列表）
  2. 调 `retrievalRouterService({ type: 'case_material', sourceIds })` 向量检索（底层按 sourceId 过滤，复用）
`ensureMaterialsReadyForDraftService(ossFileId, draftId)`：
  1. 查 caseMaterials 是否已有记录（draftId + ossFileId 组合）
  2. 无则创建（caseId=null, draftId=X）
  3. 触发现有 OCR + embedding pipeline（复用 `embedMaterialUnifiedService`）
  4. 轮询直至 status='processed'；30s 超时抛错

**签名约定**（保持 plan 各处一致）：
- 单文件版本：`ensureMaterialsReadyForDraftService(ossFileId: number, draftId: number)`，一次处理一个
- Task 3.10 的 `createDraftService` 调用方：对 `sourceFileIds[]` 循环调用本函数

- [ ] **Step 2-4: 实现并跑通测试**

注意：所有函数的 DAO 层 `WHERE` 子句需支持 `caseId? | draftId?` 的 XOR 前置校验（应用层）。`embedMaterialUnifiedService(materialId, userId)` 不改，因它按 material.id 处理。

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(material): 新增 draftId-based 3 个 service 并行函数 + 1 个 DAO"
```

### Task 3.4: 扩展 `search_case_materials` 工具加 draftId 分支

**Files:**
- Modify: `server/services/workflow/tools/searchCaseMaterials.tool.ts`
- Test: `tests/server/workflow/tools/searchCaseMaterials.test.ts`（增补 3 路径用例）

- [ ] **Step 1: 增补测试：仅 draftId / 仅 caseId / 两者都无（报错）**

- [ ] **Step 2: schema 加 draftId**

```typescript
const schema = z.object({
    query: z.string().optional(),
    sourceId: z.number().optional(),
    draftId: z.number().optional().describe('文书 draft ID（文书生成场景传入）'),
    k: z.number().max(20).optional().default(5),
}).refine(d => d.query || d.sourceId, { message: '至少需要 query 或 sourceId' })
```

- [ ] **Step 3: createTool 内分流**

```typescript
const effectiveDraftId = input.draftId ?? context.draftId
if (caseId == null && !effectiveDraftId) throw new Error('...')
const results = effectiveDraftId
    ? await searchMaterialsByDraftService(userId, effectiveDraftId, { query, sourceId, k })
    : await searchMaterialsService(userId, caseId!, { query, sourceId, k })
```

description 更新为 "检索当前案件或文书 draft 的材料内容"

- [ ] **Step 4-5: 测试通过 + Commit**

```bash
git commit -m "feat(workflow): 扩展 search_case_materials 工具加 draftId 分支"
```

### Task 3.5: `buildDraftSchema` 动态 Zod schema 构造

**Files:**
- Create: `server/services/assistant/document/draftSchema.builder.ts`
- Test: `tests/server/assistant/document/draftSchema.builder.test.ts`

- [ ] **Step 1: 写测试（空 / 1 个 / N 个中英混合 / 重复占位符去重）**

- [ ] **Step 2-4: 实现按 spec §6.3 + 跑通**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(assistant): 新增 buildDraftSchema 动态构造模板专属 Zod schema"
```

### Task 3.6: `draftResultPersistenceMiddleware`

**Files:**
- Create: `server/services/workflow/middleware/draftResultPersistence.middleware.ts`
- Test: `tests/server/workflow/middleware/draftResultPersistence.test.ts`
- Modify: `server/services/workflow/middleware/index.ts`（re-export）

- [ ] **Step 1: 写失败测试**

Mock 一个 agent + 带 responseFormat + 注入 middleware；分别测：
- beforeAgent 触发 → draft 状态置 filling
- afterAgent 收到 structuredResponse → 写 values + 置 ready
- afterAgent 无 structuredResponse → 置 failed

- [ ] **Step 2-4: 按 spec §6.6 实现 + 跑通**（注意 `{ hook }` 形状）

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(workflow): 新增 draftResultPersistence 中间件（仿 analysis 模式）"
```

### Task 3.7: `documentMainAgent.ts` 仿 caseMainAgent

**Files:**
- Create: `server/services/workflow/agents/documentMainAgent.ts`

- [ ] **Step 1: 按 spec §6.7 骨架实现**

完整实现 `runDocumentChat(sessionId, options)`：
1. 从 sessionId 反查 draft + template
2. `buildDraftSchema(template.placeholders)`
3. 加载 `nodeConfig = getValidNodeConfig('documentMain')`
4. `model = createChatModel(...)` 带 `responseFormat: schema`
5. `systemPrompt = renderSystemPrompt(nodeConfig, { caseId, templateName: template.name, templateCategory: template.category })`
6. `tools = getToolInstancesService(nodeConfig.tools, { userId, caseId, sessionId, draftId })`
7. `middleware = [pointConsumption + summarization + safetyTrim + draftResultPersistence(末位)]`
8. `createAgent({ ... })` + 返回 `agent.stream(...)`

参考 `caseMainAgent.ts` L65-181 的装配顺序。

- [ ] **Step 2: Commit（无独立测试 → 在 Task 3.11 集成测试验证）**

```bash
git commit -m "feat(workflow): 新增 documentMainAgent 仿 caseMain 骨架"
```

### Task 3.8: Worker 加 `scope === 'document'` 分支

**Files:**
- Modify: `server/services/agent/agentWorker.ts:164`（scope 分流链前端插入）

- [ ] **Step 1: 按 spec §6.7 追加分支**

```typescript
if (session.scope === 'document') {
    const { runDocumentChat } = await import('../workflow/agents/documentMainAgent')
    stream = await runDocumentChat(run.sessionId, {
        userId: session.userId!,
        caseId: session.caseId ?? undefined,
        signal: abortController.signal,
    })
}
else if (session.scope === 'assistant') { /* 现状 */ }
else { /* case 域 */ }
```

- [ ] **Step 2: 手测 Worker 启动不 crash（`bun dev`）**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(workflow): AgentWorker 加 scope=document 分支调 runDocumentChat"
```

### Task 3.9: `documentMain` 节点 + 提示词 seed

**Files:**
- Modify: `prisma/seed.ts`（追加 `seedDocumentMainNode`）
- Modify: `prisma/seeds/seedData.sql`（同步 nodes / prompts / point_consumption_items 行）

- [ ] **Step 1: 追加 seedDocumentMainNode 函数**

仿 `seedAssistantMainNode` + `seedAssistantTitleGenNode` 写法：
- 查 caseMain 的 modelId，无则首个 model
- upsert node: `name=documentMain, type=agent, tools=['search_case_materials','search_law'], priority=30`
- upsert system prompt v1（spec §6.8 内容）

- [ ] **Step 2: 追加 seedDocumentDraftTokenRule（键 document_draft_token）**

复用 assistant_token 的字段结构。

- [ ] **Step 3: `main()` 加调用**

- [ ] **Step 4: 追加到 `prisma/seeds/seedData.sql`**

与现有 assistantMain 相邻格式。

- [ ] **Step 5: 跑 `bun prisma db seed` + DB 验证**

```bash
psql $DATABASE_URL -c "SELECT name, type, tools FROM nodes WHERE name='documentMain';"
psql $DATABASE_URL -c "SELECT key FROM point_consumption_items WHERE key='document_draft_token';"
```

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(assistant): seed documentMain 节点 + 提示词 + document_draft_token 计费键"
```

### Task 3.10: Draft DAO + Service

**Files:**
- Create: `server/services/assistant/document/documentDraft.dao.ts`
- Create: `server/services/assistant/document/documentDraft.service.ts`
- Test: `tests/server/assistant/document/documentDraft.dao.test.ts` + `tests/server/assistant/document/documentDraft.service.test.ts`

- [ ] **Step 1: 写 DAO 测试 + Service 测试**

DAO: `createDocumentDraftDAO`、`getDocumentDraftDAO`、`findDraftBySessionIdDAO`、`updateDocumentDraftDAO`、`listDocumentDraftsDAO`
Service: `createDraftService`（创建 draft + session + sourceRef 预处理 + enqueueRun）、`getDraftService`、`patchDraftService`（校验 status ∈ ready/exported + values keys 校验）

- [ ] **Step 2-4: 按 spec §4.1 + §6.7 + §9.2 实现 + 跑通**

关键点：
- `createDraftService` 内部：创建 caseSession(scope='document', caseId?) + 创建 draft(status='drafting') + 预处理 sourceFileIds（调 `ensureMaterialsReadyForDraftService`）+ `enqueueRunService`
- `patchDraftService` 的 409 保护：`if (draft.status === 'drafting' || 'filling') return 409`
- values 校验：按 `buildDraftSchema(template.placeholders)` 的 keys，多余忽略、缺失保持

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(assistant): 新增 documentDraft DAO + Service"
```

### Task 3.11: Draft API 端点（4 个）

**Files:**
- Create: `server/api/v1/assistant/document/drafts.get.ts` / `.post.ts`
- Create: `server/api/v1/assistant/document/drafts/[id].get.ts` / `.patch.ts`
- Test: `tests/server/assistant/document/drafts.api.test.ts`（集成）

- [ ] **Step 1: 写集成测试（覆盖 AI 闭环）**

关键 e2e：
- POST /drafts → 返回 draftId + sessionId；30s 内 draft.status 变 ready（调 real model 或 mocked LLM fixture）
- GET /drafts/:id → 返回 values
- PATCH /drafts/:id → 改 values
- PATCH /drafts/:id 在 status=filling 返回 409

- [ ] **Step 2-4: 实现 4 个端点 + 跑通**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(api): 新增文书 draft 4 个端点（POST/GET/PATCH/LIST）"
```

### Task 3.12: SSE 对话端点 `POST /api/v1/assistant/document/chat`

**Files:**
- Create: `server/api/v1/assistant/document/chat.post.ts`
- Test: 由 M4 的手测验证（本 Task 无独立测试）

> **为什么要这个端点**：前端 `useDocumentDraft` 通过 `useStreamChat({ apiUrl: '/api/v1/assistant/document/chat' })` 订阅 SSE，以便在 AI 填充过程中实时看到 runStatus 变化、工具调用事件。`POST /drafts` 创建 draft + 入队 run，但 SSE 订阅走独立的 chat 端点，与 assistant 域范式对齐。

- [ ] **Step 1: 仿 `server/api/v1/assistant/chat.post.ts` 6 分支范式**

6 分支处理（与 assistant/case 两域一致）：
1. 活跃 run=INTERRUPTED + 新消息 → 释放旧 run，入队带 command
2. 活跃 run=RUNNING + 新消息 → 429
3. 活跃 run 其他 → 复用 runId 重连 SSE
4. 无活跃 run + 有消息/command → 入队新 run
5. 无活跃 run + 无消息无 command + 有最新 run → 重放
6. 无活跃 run + 无消息无 command + 无最新 run → 400

**关键差异**（与 assistant/chat.post 的对齐点）：
- 鉴权：`event.context.auth?.user`
- 入队参数：`scope='document'`（由 session 已决定）、`caseId` 从 session 读、`input.message`/`input.command` 按协议传
- 不做特殊消息防火墙（文书场景用户消息即"开始生成" 触发词，无黑名单需要）
- 复用现有 `extractChatParams`、`enqueueRunService`、`createAgentSseStream`、`findActiveRunBySessionIdDAO` 等

- [ ] **Step 2: 检查 session 归属并鉴权**

从 body 拿 sessionId → `findDraftBySessionIdDAO(sessionId)` → 若 draft.userId !== user.id 返回 403

- [ ] **Step 3: 手测**

```bash
# 创建 draft 拿 sessionId
curl -X POST http://localhost:3000/api/v1/assistant/document/drafts -d '{"templateId":1,"sourceText":"..."}' -b cookie.txt
# 订阅 SSE
curl -X POST http://localhost:3000/api/v1/assistant/document/chat \
  -d '{"input":{"messages":[{"content":"开始生成","type":"human"}]},"config":{"configurable":{"thread_id":"<sessionId>"}}}' \
  -b cookie.txt -N
# 期望：看到 values / messages / updates 事件流 + 最终 status_change: completed
```

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(api): 新增 /api/v1/assistant/document/chat SSE 端点"
```

### M3 验收

- [ ] PoC test PASS（或回退方案生效）
- [ ] curl POST `/api/v1/assistant/document/drafts` → 收 SSE → draft.status=ready → GET /:id 有 values
- [ ] 积分扣减：看 point_consumption 表新增记录
- [ ] `npx vitest run tests/server/assistant/document/ tests/server/workflow/middleware/draftResultPersistence.test.ts tests/server/material/` 全绿

---

## §4 M4 用户页 + 导出

### Task 4.1: `documentExport.service` + 导出 API

**Files:**
- Create: `server/services/assistant/document/documentExport.service.ts`
- Create: `server/api/v1/assistant/document/drafts/[id]/export.post.ts`
- Test: `tests/server/assistant/document/documentExport.test.ts`

- [ ] **Step 1: 写测试**

覆盖：正常渲染、缺字段（nullGetter 生效）、模板已删（404）、draft 不属于当前用户（403）

- [ ] **Step 2-4: 按 spec §11 实现 + 跑通**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(assistant): 新增 documentExport service + export API"
```

### Task 4.2: `useDocumentDraft` composable

**Files:**
- Create: `app/composables/useDocumentDraft.ts`

- [ ] **Step 1: 仿 `useAssistantChat.ts` 骨架，底层 `useStreamChat`**

按 spec §10.2 给出的骨架扩展：暴露 `draft / template / runStatus / messages / onStart / onFieldChange / onExport / onRegenerate`

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(assistant): 新增 useDocumentDraft composable"
```

### Task 4.3: 6 个文书组件

**Files:**
- Create: `app/components/assistant/document/DocumentDraftPanel.vue`
- Create: `app/components/assistant/document/DocumentTemplatePicker.vue`
- Create: `app/components/assistant/document/DocumentSourceInput.vue`
- Create: `app/components/assistant/document/DocumentRunStatus.vue`
- Create: `app/components/assistant/document/DocumentFieldForm.vue`
- Create: `app/components/assistant/document/DocumentPreview.vue`（M4 阶段只占位；M5 再补实时预览）

- [ ] **Step 1: DocumentTemplatePicker**

分类 Tab（9 类，从 `shared/types/document.ts` 导入）+ 模板卡片网格 + "已选 ✓ [更换]" 态

- [ ] **Step 2: DocumentSourceInput — 严禁重复实现文件上传 / 案件材料选择**

**⚠️ 复用边界**（必读）：

| 能力 | 现有文件 | 直接复用方式 |
|---|---|---|
| 文本输入 + 文件上传（拖拽/进度/识别徽章/查重/OSS 签名/预览/移除） | `app/components/ai/AiPromptInput.vue`（721 行，已完备） | `<AiPromptInput enable-file-upload @submit="handleSubmit">`；submit 事件拿到 `AiPromptSubmitData { text, files: OssFileItem[] }`，`files[].id` 就是 `ossFileId`，不要再做任何上传 UI/逻辑 |
| 案件材料多选 Dialog（类型筛选/搜索/上传新文件） | `app/components/caseAnalysis/materialSelector.vue`（562 行，已完备） | 参考 `app/components/caseAnalysis/promptInput.vue:150 / 215 / 236 / 612` 的 `<CaseAnalysisMaterialSelector ref="materialSelectorRef" :disabled-file-ids>` 组合方式 |
| 两者整合（文本 + 上传 + 案件材料选择） | `app/components/caseAnalysis/promptInput.vue` 全文就是这个模式的参考 | `DocumentSourceInput` 的骨架≈`caseAnalysis/promptInput.vue` 简化版 |

**DocumentSourceInput 的职责边界**（保持瘦）：
- 渲染 `<AiPromptInput>`（独立场景时不显示"从案件材料选"按钮）
- 案件场景（`:case-id` 存在）：额外渲染"从案件材料选"按钮，点击打开 `<CaseAnalysisMaterialSelector>`
- 提交时把 `AiPromptSubmitData.files[].id` + 案件材料选中的 `materialId[]` 合并为 `sourceFileIds[]`
- **不要**：文件上传 UI、进度条、识别徽章、文件类型筛选、上传重试——全部靠两个现有组件完成

```vue
<script setup lang="ts">
import type { AiPromptSubmitData } from '~/components/ai/AiPromptInput.vue'

const props = defineProps<{ caseId?: number }>()
const emit = defineEmits<{ submit: [data: { text: string; sourceFileIds: number[] }] }>()

const materialSelectorRef = ref<{ openDialog: () => void } | null>(null)
const selectedCaseMaterialIds = ref<number[]>([])

function handleAiSubmit(data: AiPromptSubmitData) {
  const uploadedFileIds = (data.files ?? []).map(f => f.id)
  emit('submit', {
    text: data.text,
    sourceFileIds: [...uploadedFileIds, ...selectedCaseMaterialIds.value],
  })
}
</script>

<template>
  <div>
    <AiPromptInput enable-file-upload @submit="handleAiSubmit">
      <!-- 如需在输入框下方加按钮，可通过插槽；若 AiPromptInput 无插槽就外包一层按钮区 -->
    </AiPromptInput>
    <div v-if="caseId" class="mt-2 flex items-center gap-2">
      <Button size="sm" variant="outline" @click="materialSelectorRef?.openDialog()">
        从案件材料选择
      </Button>
      <span v-if="selectedCaseMaterialIds.length" class="text-xs text-muted-foreground">
        已选 {{ selectedCaseMaterialIds.length }} 个案件材料
      </span>
    </div>
    <CaseAnalysisMaterialSelector
      v-if="caseId"
      ref="materialSelectorRef"
      :case-id="caseId"
      :disabled-file-ids="selectedCaseMaterialIds"
      @confirm="(ids: number[]) => selectedCaseMaterialIds = ids"
    />
  </div>
</template>
```

实施时若 `AiPromptInput` 无底部插槽，优先**给 AiPromptInput 加一个具名插槽**（这属于通用增强），仍禁止在 DocumentSourceInput 里重做上传。

- [ ] **Step 3: DocumentRunStatus**

MVP：`runStatus === 'filling'` 显示旋转 + "AI 正在生成文书..." 文案

- [ ] **Step 4: DocumentFieldForm**

按 §8.3 4 类控件推断：DatePicker / Number / Textarea (>50 chars) / Input
每个字段显示 `suggestions` tooltip（若存在）
值改变 → debounce 500ms → `onFieldChange`

- [ ] **Step 5: DocumentPreview（M4 占位版）**

显示 "导出预览 .docx" 按钮 → 调 `onExport` → 下载

- [ ] **Step 6: DocumentDraftPanel（主容器）**

接受 `:case-id` prop；组合上述 5 个子组件；通过 `useDocumentDraft(draftId)` 拿数据

- [ ] **Step 7: Commit**

```bash
git add app/components/assistant/document/ app/composables/useDocumentDraft.ts
git commit -m "feat(assistant): 新增文书生成前端 6 组件 + composable"
```

### Task 4.4: 独立文书生成页 `dashboard/assistant/document.vue`

**Files:**
- Create: `app/pages/dashboard/assistant/document.vue`
- Delete/replace: `app/pages/dashboard/document.vue`（原 WIP 占位，迁移到新路径或删）

- [ ] **Step 1: 替换现有 WIP 页**

spec §10.1 约定路径 `/dashboard/assistant/document`。
渲染 `<DocumentDraftPanel />`（独立场景，不传 `case-id`）。

- [ ] **Step 2: 菜单路由检查**

检查 `prisma/seed.ts` 和 DB 中 `routers` 表里"文书生成"菜单的 path 是 `/dashboard/assistant/document`（若是 `/dashboard/document` 需迁移）。

- [ ] **Step 3: 浏览器手测：登录 → 文书生成菜单 → 选模板 → 粘贴材料 → 点开始生成 → 看 AI 填完 → 改字段 → 导出**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(assistant): 新增独立文书生成页（替换 WIP 占位）"
```

### M4 验收

- [ ] 完整闭环可用：选模板 → 材料输入 → AI 填充 → 编辑 → 导出 → 下载的 .docx 在 Word 打开且占位符已替换
- [ ] `POST /drafts/:id/export` 测试全绿
- [ ] typecheck 通过

---

## §5 M5 实时预览

### Task 5.1: DocumentPreview 实时预览

**Files:**
- Modify: `app/components/assistant/document/DocumentPreview.vue`

- [ ] **Step 1: 按 spec §10.3 实现主流程**

```vue
<script setup lang="ts">
import { renderAsync } from 'docx-preview'
// props: templateBuffer, values
const previewRoot = ref<HTMLElement | null>(null)
const renderedOnce = ref(false)

async function updatePreview(values: Record<string, string | null>) {
    if (!previewRoot.value || !props.templateBuffer) return
    if (!renderedOnce.value) {
        await renderAsync(props.templateBuffer, previewRoot.value)
        renderedOnce.value = true
    }
    replacePlaceholders(previewRoot.value, values)
}

function replacePlaceholders(root: HTMLElement, values: Record<string, string | null>) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const tasks: Array<() => void> = []
    while (walker.nextNode()) {
        const node = walker.currentNode as Text
        const original = node.nodeValue ?? ''
        const replaced = original.replace(/\{\{([\u4e00-\u9fa5\w]+)\}\}/g, (_, name) => values[name] ?? '')
        if (replaced !== original) tasks.push(() => { node.nodeValue = replaced })
    }
    tasks.forEach(fn => fn())
}

const debouncedUpdate = useDebounceFn(updatePreview, 500)
watch(() => props.values, (v) => debouncedUpdate(v), { deep: true })
</script>

<template>
  <div ref="previewRoot" class="docx-preview-root" />
</template>
```

- [ ] **Step 2: 前端拉取 template.docx buffer**

在 `DocumentDraftPanel` 里通过 `template.ossFileId` 取 OSS 签名 URL 然后 `fetch` 为 buffer 传给 `DocumentPreview`。

- [ ] **Step 3: 手测 3-5 样本 × 5 场景 = 15-25 次渲染**

按 spec §10.3 降级门槛：**失败率 > 10%** 触发降级。记录结果。

- [ ] **Step 4:（若降级）实施方案 A**

去掉 `debouncedUpdate` watch，改为"刷新预览"按钮触发。

- [ ] **Step 5:（若仍不稳，降到方案 B）**

前端删 docx-preview；后端加 `POST /drafts/:id/preview` 端点渲染 PDF 返回 blob；前端 iframe 展示。

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(assistant): 实现文书实时预览（docx-preview + TreeWalker 替换）"
```

### M5 验收

- [ ] 改表单任一字段，右侧预览 500ms 内同步
- [ ] 3-5 样本 × 5 场景手测失败率 ≤ 10%
- [ ] 若触发降级，已按方案 A/B 实施

---

## §6 M6 案件 tab 复用

### Task 6.1: caseDetail 加 `documents` tab

**Files:**
- Modify: `app/pages/dashboard/cases/[id].vue`（或其 tab 容器组件）

- [ ] **Step 1: 找到 caseDetail tabs 配置文件**

Grep 项目 `caseDetail` / `case/[id]` 结构，找到 tab 注册位置。

- [ ] **Step 2: 新增 `documents` tab**

```vue
<TabsContent value="documents">
  <DocumentDraftPanel :case-id="caseId" />
</TabsContent>
```

- [ ] **Step 3: 手测：进案件详情 → documents tab → 模板选择能看到 caseMaterials 多选预填**

- [ ] **Step 4: 集成测试**

```typescript
// tests/server/assistant/document/caseContext.integration.test.ts
it('POST /drafts 带 caseId 时 draft.caseId 被写入', ...)
it('GET /drafts?caseId=X 返回该案件的 draft 列表', ...)
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(assistant): 案件详情页复用文书生成（documents tab）"
```

### M6 验收

- [ ] 案件详情 → documents tab → 可看到该案件已有的 drafts + 新建 draft 时 caseId 自动注入
- [ ] caseMaterials 多选预填生效
- [ ] 导出后可选"保存到案件材料库"（调现有 caseMaterial 模块）

---

## §7 M7 批量导入 + E2E

### Task 7.1: `importDocumentTemplates.ts` 脚本

**Files:**
- Create: `scripts/importDocumentTemplates.ts`
- Test: `tests/scripts/importDocumentTemplates.test.ts`

- [ ] **Step 1: 写测试**

CSV fixture 放 `tests/fixtures/import-templates.csv`（含 3 行正常 + 1 行扫描失败的 .docx 路径，fixture .docx 复用 Task 1.4 已准备的 tests/fixtures/document-templates/）。

覆盖：`--dry-run` / 正常导入 / 幂等（重复 import 去重）/ CSV 格式错误抛错 / 扫描失败中止

- [ ] **Step 2-4: 按 spec §16.3 实现**

```typescript
// scripts/importDocumentTemplates.ts
// Usage: bun scripts/importDocumentTemplates.ts path/to/templates.csv [--dry-run]
// CSV 列：file_path, name, category, description, priority

// 逐行：
// 1. 读 .docx
// 2. scanPlaceholders → 空则报错中止
// 3. --dry-run 跳过写库
// 4. 否则 uploadFileService + createOssFileDao + documentTemplates.create(scope='global')（参考 Task 1.5 Step 2 的上传流程）
// 5. name 已存在则跳过（幂等）
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(scripts): 新增 importDocumentTemplates 批量导入脚本"
```

### Task 7.2: E2E 完整跑测

- [ ] **Step 1: chrome-devtools 手测独立生成场景**

登录 → 文书生成菜单 → 民间借贷起诉状 → 粘贴 1000 字材料 → 生成 → AI 填 ≥ 80% → 改 2 字段 → 导出 → Word 打开验证格式 + 占位符已替换

- [ ] **Step 2: chrome-devtools 手测案件场景**

登录 → 进已有案件 → documents tab → 选模板 → 多选 2 个 caseMaterials → 生成 → 导出 → 可选"保存到案件材料库"

- [ ] **Step 3: 覆盖率达标**

Run: `npx vitest run --coverage tests/server/assistant/document/ tests/server/workflow/`
Expected: `server/services/assistant/document/` 行覆盖 ≥ 80%

- [ ] **Step 4: CI 全绿检查**

Run: `npx vitest run` 全套无 red

- [ ] **Step 5: Commit**

```bash
git commit -m "test(assistant): 文书生成 E2E 通过 + 覆盖率达标"
```

### M7 验收

- [ ] import 脚本 `--dry-run` + 正式导入各跑一次
- [ ] 独立 + 案件两场景完整 E2E 通过
- [ ] 覆盖率 ≥ 80%

---

## 提交前 Checklist

- [ ] 所有 Task commit 都遵循 `feat(scope): 中文描述` 格式（`.claude/rules/git.md`）
- [ ] `npx nuxi typecheck` 全绿
- [ ] `npx vitest run` 全绿
- [ ] 跑 `simplify` 技能优化新增代码（CLAUDE.md 强制）
- [ ] 覆盖率 ≥ 80%
- [ ] 实时预览在 3-5 样本 × 5 场景下失败率 ≤ 10%（否则按方案 A/B 降级）

---

## 风险点与兜底（参考 spec §14）

| 风险 | 出现时处置 |
|---|---|
| R3b structuredResponse 不可见 | Task 3.1 PoC 若 FAIL，改 draftResultPersistence 从 state.messages.at(-1) parse JSON |
| R1 实时预览跨 run 切分 | Task 5.1 Step 4/5 按门槛降级 |
| R8 材料预处理超时 | `ensureMaterialsReadyForDraftService` 30s 超时，API 返回 503 |
| caseMaterials.caseId 改 optional 类型涟漪 | Task 1.2 Step 5 修复所有 non-null 假设 |

---

**Plan 字数 ~= 实施者 2-3 天工时的可执行指令集。每个 Task 是一个独立 commit 单元，整体 30+ commits。**
