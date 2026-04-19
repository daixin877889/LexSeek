# 文书标题 + 多版本设计

**日期：** 2026-04-19
**范围：** `server/services/assistant/document/**`、`server/api/v1/assistant/document/**`、`app/pages/dashboard/document/drafts/[id].vue`、`app/components/assistant/document/**`、`app/composables/useDocumentDraft.ts`、`prisma/models/document.prisma`、`prisma/seeds/seedData.sql`

## 1. 目标与背景

当前文书草稿存在两个问题：

1. 无独立"标题"字段，列表 / 顶栏展示靠拼 template.name，AI 生成的文书识别度低
2. AI 每次重跑覆盖 `values`，历次生成结果不可回溯；用户也没有"里程碑式"保存能力，稍有反复就回不去了

本设计引入 **可编辑标题** + **AI 快照（自动）** + **用户版本（主动）** 三个概念，在不影响小索 / 合同审查 / 其他 Agent 现有逻辑的前提下，扩展文书草稿的编辑体验。

## 2. 术语定义

- **标题（title）**：`documentDrafts.title`，文书的命名，全局唯一；创建时默认 `${template.name}-YYMMDD`；AI 仅在用户从未手动改过时覆盖；一旦用户改过则 `titleOverridden=true` 且永不回退
- **快照（snapshot）**：AI 重跑产出 或 "覆盖工作区前自动备份" 所生成的历史记录，`documentDraftSnapshots` 存储，所有来源**共享 10 条上限**，新快照落库同时自动清理最旧
- **版本（version）**：用户主动保存的里程碑，`documentDraftVersions` 存储，**只读**，**永久保留**，**无上限**，支持重命名、删除、预览、恢复、独立导出

## 3. 核心需求

1. 文书创建时默认标题 `${template.name}-YYMMDD`（本地时区，dayjs 格式化）
2. 用户可在顶栏 inline 编辑标题；AI 在 `titleOverridden=false` 时可覆盖
3. AI 结构化输出引入 `aiTitle` 字段，Agent 中间件落盘时写入快照 + 必要时覆盖 draft.title
4. AI 每次重跑自动存一条 `source=ai-extract` 快照；用任何快照 / 版本覆盖工作区前自动存一条 `source=workspace-backup` 快照
5. 快照共享 10 条上限，按 createdAt 降序保留；UI 提示"自动快照最多保留 10 条"
6. 快照详情面板支持"字段级"恢复（单字段 or 全部覆盖工作区）
7. 用户主动"保存当前为版本"，必填命名（默认带出"第 X 版"，X 为递增序号不回收）
8. 版本列表支持：预览（右侧预览区切到该版本 values + 左栏只读 banner）、恢复（自动 backup → 覆盖工作区）、重命名、删除、独立导出 docx
9. 不做：跨草稿分享、版本 diff 对比、切模板保留历史、多语言标题、管理端对应接口

## 4. 数据模型

### 4.1 修改 `documentDrafts`

```prisma
title           String  @default("") @db.VarChar(200)
titleOverridden Boolean @default(false) @map("title_overridden")
```

Prisma 迁移的 SQL 回填策略：

```sql
ALTER TABLE "public"."document_drafts"
  ADD COLUMN "title" VARCHAR(200) NOT NULL DEFAULT '',
  ADD COLUMN "title_overridden" BOOLEAN NOT NULL DEFAULT false;

UPDATE "public"."document_drafts" d
   SET "title" = COALESCE(t."name", '文书')
                 || '-' || to_char(d."created_at" AT TIME ZONE 'Asia/Shanghai', 'YYMMDD')
  FROM "public"."document_templates" t
 WHERE d."template_id" = t."id" AND d."title" = '';
```

### 4.2 新表 `documentDraftSnapshots`

```prisma
model documentDraftSnapshots {
    id          Int      @id @default(autoincrement())
    draftId     Int      @map("draft_id")
    /// 来源：ai-extract（AI 生成后落盘）、workspace-backup（覆盖工作区前自动备份）
    source      String   @db.VarChar(30)
    values      Json     @default("{}") @db.JsonB
    suggestions Json?    @db.JsonB
    aiTitle     String?  @map("ai_title") @db.VarChar(200)
    createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

    draft documentDrafts @relation(fields: [draftId], references: [id], onDelete: Cascade)

    @@index([draftId, createdAt(sort: Desc)], map: "idx_doc_snapshots_draft_time")
    @@map("document_draft_snapshots")
}
```

- 插入后**同事务内**执行 `DELETE WHERE draft_id=? AND id NOT IN (SELECT id ... ORDER BY created_at DESC LIMIT 10)`
- 清理失败仅日志 warn 不阻塞主流程

### 4.3 新表 `documentDraftVersions`

```prisma
model documentDraftVersions {
    id        Int      @id @default(autoincrement())
    draftId   Int      @map("draft_id")
    versionNo Int      @map("version_no")
    name      String   @db.VarChar(100)
    values    Json     @default("{}") @db.JsonB
    titleAt   String   @map("title_at") @db.VarChar(200)
    createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

    draft documentDrafts @relation(fields: [draftId], references: [id], onDelete: Cascade)

    @@unique([draftId, versionNo], map: "idx_doc_versions_draft_no")
    @@index([draftId, createdAt(sort: Desc)], map: "idx_doc_versions_draft_time")
    @@map("document_draft_versions")
}
```

- 版本号 txn 内 `SELECT MAX(version_no) + 1`，unique 约束兜底并发；P2002 捕获重试一次
- 删除不回收版本号（V3 删除后下一个仍是 V4）
- 支持重命名（仅 `name`，versionNo / values / titleAt 不可改）

### 4.4 关键约束

- 所有新接口的归属判定：`draftId → draft.userId == ctx.user.id`
- 标题不进入任何 snapshot/version.values；`snapshot.aiTitle` / `version.titleAt` 只是历史留痕与导出命名用
- 关系声明 `onDelete: Cascade`（物理删 draft 时连带清理）

## 5. 后端设计

### 5.1 DAO 层

`server/services/assistant/document/documentDraft.dao.ts`（扩展）
- `updateDraftTitleDAO(id, title, titleOverridden)`
- `createDraftDAO` 调整，初始化 `title` + `titleOverridden=false`

`server/services/assistant/document/documentDraftSnapshot.dao.ts`（新）
- `createSnapshotDAO(draftId, source, values, suggestions?, aiTitle?)`
- `listSnapshotsDAO(draftId, { limit?, order? })`
- `getSnapshotByIdDAO(id)`
- `deleteOldestSnapshotsDAO(draftId, keep=10)`

`server/services/assistant/document/documentDraftVersion.dao.ts`（新）
- `createVersionDAO(draftId, versionNo, name, values, titleAt)`
- `listVersionsDAO(draftId)`
- `getVersionByIdDAO(id)`
- `updateVersionNameDAO(id, name)`
- `deleteVersionDAO(id)`
- `getMaxVersionNoDAO(draftId)`

### 5.2 Service 层

`documentDraft.service.ts`（扩展）
- `updateDraftTitleService(userId, draftId, title)` — owner 校验 + 置 `titleOverridden=true`
- `applyAITitleIfAllowedService(draftId, aiTitle)` — 仅 `titleOverridden=false` 时写入；原子 `UPDATE ... WHERE id=? AND title_overridden=false`

`documentDraftSnapshot.service.ts`（新）
- `createSnapshotService(draftId, source, { values, suggestions?, aiTitle? })` — 事务内 insert + prune
- `listSnapshotsForUserService(userId, draftId)`
- `applySnapshotFieldsService(userId, draftId, snapshotId, fieldNames?)`
  1. 先 `createSnapshotService(draftId, 'workspace-backup', { values: 当前 draft.values })`
  2. 合并 fieldNames（`undefined` = 全量覆盖；unknown field 忽略且日志 warn）
  3. `UPDATE draft SET values = merged`

`documentDraftVersion.service.ts`（新）
- `createVersionService(userId, draftId, name)`
  - 事务内 `SELECT MAX(version_no) + 1 → versionNo`
  - `name` 必填（非空，由 API 层 zod 校验保障；前端默认填充 "第 X 版"）
  - 失败一次（P2002）重试
- `listVersionsForUserService(userId, draftId)`
- `restoreVersionService(userId, draftId, versionId)` — 同快照恢复：先自动快照工作区 → 再覆盖 draft.values
- `renameVersionService(userId, versionId, name)` — owner 校验 + 原子 UPDATE
- `deleteVersionService(userId, versionId)`
- `exportVersionService(userId, versionId)` — 复用 `documentExport.service.ts`，输入改为 version.values，导出文件名 `${version.titleAt}-${version.name}.docx`

### 5.3 API 路由（用户端，严格 owner-only）

```
PATCH  /api/v1/assistant/document/drafts/:id/title
         body: { title: string (1..200) }

GET    /api/v1/assistant/document/drafts/:id/snapshots
POST   /api/v1/assistant/document/drafts/:id/snapshots/:snapshotId/apply
         body: { fieldNames?: string[] }

GET    /api/v1/assistant/document/drafts/:id/versions
POST   /api/v1/assistant/document/drafts/:id/versions
         body: { name: string (1..100) }
POST   /api/v1/assistant/document/drafts/:id/versions/:versionId/restore
PATCH  /api/v1/assistant/document/drafts/:id/versions/:versionId
         body: { name: string (1..100) }
DELETE /api/v1/assistant/document/drafts/:id/versions/:versionId
GET    /api/v1/assistant/document/drafts/:id/versions/:versionId/export
```

管理端接口本轮不做。

### 5.4 Agent 结构化输出改造

`server/services/assistant/document/draftSchema.builder.ts`
```ts
return z.object({
  values: z.object(valuesShape).describe('...'),
  suggestions: z.record(...).optional(),
  aiTitle: z.string().min(1).max(200).optional().describe('AI 推断的文书标题（10~30 字，用于识别）'),
})
```

`server/services/workflow/middleware/draftResultPersistenceMiddleware.ts`（改造）

每次 Agent 完成时，同一事务内：
1. `createSnapshotService(draftId, 'ai-extract', { values, suggestions, aiTitle })`
2. `UPDATE draft SET values=?, metadata=jsonb_set(..., 'suggestions', ?)`
3. `aiTitle` 非空时 `applyAITitleIfAllowedService(draftId, aiTitle)`

任一步失败事务回滚；本改造不触达 caseMainAgent / 小索 / 其他 Agent。

### 5.5 seedData.sql

- `documentMain_system` 提示词升级到 v4：追加一段要求模型返回 `aiTitle`；`PROMPT_TITLE` 相应改为"文书生成主Agent系统提示词 v4"
- 同文件内追加 `UPDATE prompts SET content=..., title=...v4... WHERE title ilike '文书生成主Agent系统提示词%' AND title <> '文书生成主Agent系统提示词 v4'`，与上次 v3 升级同模式，确保既有 dev / prod DB 都能兜底刷新

## 6. 前端设计

### 6.1 草稿页顶栏改造

`app/pages/dashboard/document/drafts/[id].vue`

- 模板名文本替换为 `<DocumentDraftTitleInput :title="draft.title" @save="updateTitle" />`
- 按钮新增："保存当前为版本" → 弹 `DocumentSaveVersionDialog`；"历史" → 打开 `DocumentHistorySheet`
- 保留原"AI 生成" / "导出 word"

### 6.2 组件清单（`app/components/assistant/document/`）

| 组件 | 职责 |
|------|------|
| `DocumentDraftTitleInput.vue` | inline 编辑标题；空/超长拦截；blur/回车保存；Esc 取消 |
| `DocumentSaveVersionDialog.vue` | 创建版本；打开前先确保 versions 已加载（`loadVersions()`），输入框默认 `第 ${nextVersionNo} 版`（`nextVersionNo = max(versions.versionNo) + 1`，列表为空时 = 1）；submit 调 `saveVersion` |
| `DocumentRenameVersionDialog.vue` | 重命名版本；默认值 = 当前 name |
| `DocumentHistorySheet.vue` | 右侧 Sheet；两 tab：版本 / 快照；顶部提示语"自动快照最多保留 10 条" |
| `DocumentVersionList.vue` | 版本列表项：名称 + 时间 + [预览][恢复][重命名][导出][删除] |
| `DocumentSnapshotList.vue` | 快照列表项：来源图标 + 时间 + [查看详情] |
| `DocumentSnapshotDetail.vue` | 字段级对比表（当前 vs 快照）+ 单字段"用这个值" / 全部"采用全部"按钮 |

### 6.3 `useDocumentDraft.ts` 扩展

新增响应式状态与方法：

```ts
title, updateTitle(newTitle)
versions, loadVersions(), saveVersion(name), restoreVersion(id),
  renameVersion(id, name), deleteVersion(id), exportVersion(id)
snapshots, loadSnapshots(), applySnapshot(id, fieldNames?)
previewVersionId (ref<number|null>),    // 预览态标记
previewValues (computed<Record<string,string|null>|null>)
```

- `updateTitle` 乐观更新本地 title + titleOverridden=true；失败回滚并 toast
- `restoreVersion` / `applySnapshot` 成功后刷新 `draft` + `snapshots`（workspace-backup 会冒出来）
- 预览态：`previewVersionId` 非空时 `<AssistantDocumentPreview>` 的 values 绑到该版本 values；字段表单 disabled；顶部 banner "预览中 · ${versionName} · [退出预览]"
- 退出预览 = `previewVersionId = null`

### 6.4 历史面板 UI 细节

- 两个 tab 懒加载各自列表
- 版本列表空态："还没有保存过版本，点顶部'保存当前为版本'记录里程碑"
- 快照列表空态："还没有 AI 生成或覆盖记录"
- 快照列表顶部 banner："自动快照最多保留 10 条，新快照产生时会清理最早一条"
- 来源图标：`ai-extract` → SparklesIcon；`workspace-backup` → HistoryIcon

### 6.5 恢复操作二次确认

- 点"恢复 V1" / "全部覆盖"时弹确认："当前工作区内容将自动备份为快照再被覆盖，继续？"
- 字段级"用这个值"不弹确认（改动小，可随时通过再次恢复撤销）

## 7. 错误处理

| 场景 | 处理 |
|------|------|
| 非 owner 调新接口 | resError 403 |
| 标题空 / >200 | resError 400，前端也做 maxlength |
| 版本名空 / >100 | resError 400；前端兜底默认"第 X 版" |
| 版本号并发冲突 | 捕获 P2002 重试一次，仍失败 409 |
| `applySnapshot` 未知 fieldName | 忽略 + 日志 warn，不中断 |
| snapshot/version 不存在或跨 draft | 404 |
| 自动清理 snapshot 异常 | try-catch 日志 warn 不阻塞 |
| Agent 中间件落盘异常 | 同事务回滚（已有错误路径 + 日志扩展） |

## 8. 测试策略（TDD）

### 8.1 服务层（`tests/server/assistant/document/`）

**`documentDraftTitle.service.test.ts`**
- 创建草稿默认标题格式 `${templateName}-YYMMDD`
- `updateDraftTitleService` 置 titleOverridden=true
- `applyAITitleIfAllowedService`：overridden=false 更新；overridden=true 跳过
- 非 owner 返 403

**`documentDraftSnapshot.service.test.ts`**
- 插入第 11 条时最老一条被清
- `applySnapshotFieldsService` 先写 backup 再覆盖
- 传 `fieldNames` 仅覆盖给定字段；不传全量
- 未知 fieldNames 忽略
- 非 owner 403

**`documentDraftVersion.service.test.ts`**
- 版本号从 1 连续自增
- `restoreVersionService` 先 backup 再覆盖 values
- 并发 create 命中 unique 重试后成功
- `deleteVersionService` 不回收版本号（V3 删除后下一个 V4）
- `renameVersionService` 成功 + 非 owner 403

**`draftResultPersistenceMiddleware.test.ts`**（扩展）
- Agent 返回 aiTitle + overridden=false → title 更新
- Agent 返回 aiTitle + overridden=true → title 不变、snapshot.aiTitle 仍记录
- Agent 无 aiTitle → title 不动，snapshot 照写

### 8.2 接口层（`tests/server/api/v1/assistant/document/`）

每个新端点一个测试，覆盖：owner 成功路径 + 非 owner 403 + 404 + 400。

### 8.3 前端 composable（`tests/client/composables/useDocumentDraft.*.test.ts`）

- `updateTitle` 乐观更新 + 失败回滚
- `saveVersion` / `restoreVersion` / `applySnapshot` / `renameVersion` 正确改本地状态
- 预览态切换 values

### 8.4 关键组件（`tests/client/components/assistant/document/`）

- `DocumentDraftTitleInput` 编辑态切换、空值拦截、Esc 取消
- `DocumentSnapshotDetail` 字段级 / 全部两路径调用对应参数

## 9. 迁移与上线

1. **Prisma migration**：加字段 + 两张新表；SQL 附回填 title 的 UPDATE
2. **seedData.sql**：`documentMain_system` 升 v4 + 兜底 UPDATE
3. **上线顺序**：后端 + 迁移先行（老前端兼容）→ 前端发布
4. **回滚**：前端可独立回滚；后端如需回滚，先 dump 两张新表数据保险

## 10. 不做清单（YAGNI）

- 跨草稿分享 / 复制版本
- 版本间 diff 对比视图
- 切模板保留版本历史
- 标题的多语言 / i18n
- 管理端的 snapshots / versions 接口
- 快照 "加星" 免清理
- 版本的软删除（直接物理删）

## 11. 影响面评估

**触达范围：**
- `prisma/models/document.prisma`（改）
- `prisma/seeds/seedData.sql`（documentMain_system prompt 升 v4）
- `server/services/assistant/document/`（新增两个 service + 两个 dao，扩展 documentDraft.*）
- `server/services/workflow/middleware/draftResultPersistenceMiddleware.ts`（改造）
- `server/services/workflow/agents/documentMainAgent.ts` 通过 `buildDraftSchema` 间接受益（schema 自动带 aiTitle）
- `server/api/v1/assistant/document/drafts/`（新增若干路由）
- `app/composables/useDocumentDraft.ts`（扩展）
- `app/pages/dashboard/document/drafts/[id].vue`（顶栏 + 历史抽屉 + 预览态）
- `app/components/assistant/document/`（新增 6 个组件）

**不触达：**
- `caseMainAgent` 及相关小索流程
- 合同审查 Agent
- `processMaterials.tool` / `search_case_materials.tool` / `search_law.tool`
- `materialPipeline.service` 等素材管线
- RBAC / 管理端 / 其他 Agent

本设计严格只扩展 documentMain 专属链路，不修改任何跨 Agent 共享中间件的行为。
