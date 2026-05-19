# 通用问答「读文件」能力 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让「通用问答」（legal-assistant / `assistantMain`）能读取用户在对话中上传的图片/文档/音频，材料在整个对话内持续可用。

**Architecture:** 给 `case_materials` 表新增第三个归属维度 `sessionId`；新增一个 `beforeAgent` 中间件在 Agent 启动前确定性解析附件、按会话建材料记录并跑识别流水线；`process_materials` / `search_case_materials` 两个工具补 sessionId 归属分支。识别记录与向量按 `ossFileId` 存储、跨案件/草稿/会话天然共享。

**Tech Stack:** Nuxt 4 + Nitro + TypeScript、Prisma + PostgreSQL、LangChain/LangGraph、Vitest（worker 级 DB 隔离）。

**设计文档:** `docs/superpowers/specs/2026-05-19-assistant-file-reading-design.md`

**通用约束:**
- 类型检查用 `bun run typecheck`（不用 `tsc`）。
- 测试用 `npx vitest run`（禁用 `bun test`）。
- 数据库变更只走 `bun run prisma:migrate`，禁止手写 SQL / 改 migrations 目录。
- 服务端 Prisma 单例：`import { prisma } from '~~/server/utils/db'`。

**已知技术债（不在本计划范围内处理）:** `server/services/material/materialPipeline.service.ts` 现已约 970 行，超出 `main.md`「单文件超 500 行需拆分」红线。本计划 Task 5-7 会在其中新增约 30-40 行（会话 pipeline 函数与 draft 版对偶、就近放置以保持一致性）。**该文件的完整拆分是独立的重构事项，应另立专门任务处理，不在本功能计划内强行拆分**（强拆属 scope creep 且有回归风险）。实施者执行 Task 5-7 时知悉此债即可。

---

## Task 1: `case_materials` 新增 `sessionId` 归属列

**Files:**
- Modify: `prisma/models/case.prisma:151-186`（`caseMaterials` 模型）

- [ ] **Step 1: 在 `caseMaterials` 模型加 `sessionId` 字段**

在 `prisma/models/case.prisma` 的 `caseMaterials` 模型中，`draftId` 字段之后插入：

```prisma
  /// 关联的对话会话标识（通用问答场景使用，对应 caseSessions.sessionId / LangGraph thread_id）
  sessionId   String?   @map("session_id") @db.VarChar(100)
```

同时把 `caseId` / `draftId` 的注释从"与 caseId 互斥"改为可叠加语义：

```prisma
  /// 关联的案件ID（通用问答 / 文书生成场景下可为 NULL，由 draftId / sessionId 关联）
  caseId      Int?      @map("case_id")
  /// 关联的文书草稿ID（文书生成场景使用）
  draftId     Int?      @map("draft_id")
```

并在模型末尾的索引区（`@@index([draftId], ...)` 之后）加：

```prisma
  @@index([sessionId], map: "idx_case_materials_session_id")
```

- [ ] **Step 2: 生成并应用迁移**

Run: `bun run prisma:migrate --name add_session_id_to_case_materials`
Expected: 生成 `prisma/migrations/<timestamp>_add_session_id_to_case_materials/migration.sql`，内容为 `ALTER TABLE "case_materials" ADD COLUMN "session_id" VARCHAR(100);` + `CREATE INDEX "idx_case_materials_session_id" ...`；命令结尾打印 `Database schema is up to date`。

- [ ] **Step 3: 确认 Prisma client 已重新生成**

Run: `bun run prisma:generate`
Expected: 成功，无报错。

- [ ] **Step 4: 类型检查**

Run: `bun run typecheck`
Expected: 通过（`caseMaterials` 类型已含 `sessionId`）。

- [ ] **Step 5: 提交**

```bash
git add prisma/models/case.prisma prisma/migrations generated/prisma
git commit -m "feat(db): case_materials 新增 sessionId 归属列"
```

---

## Task 2: 下沉附件 sentinel 常量与解析到 shared（前端解析一并收敛）

**背景:** `__ATTACHMENTS__` sentinel 当前有三处实现：`chatQueueActions.ts` 的 `ATTACH_SENTINEL` 常量（"写"端）、`useMessageParser.ts` 的 `ATTACH_SENTINEL` 常量 + `parseHumanContent` 内一段内联解析（前端"读"端），服务端中间件还要再"读"一次。本任务把 sentinel 常量 **与解析逻辑** 一起下沉 `shared/`，让写端、前端读端、服务端读端引用同一份——**前端 `parseHumanContent` 必须改用 shared 解析**，否则解析逻辑仍是两份，spec §8「消除三份漂移」名不副实。

**Files:**
- Create: `shared/utils/attachmentSentinel.ts`
- Create: `tests/shared/utils/attachmentSentinel.test.ts`
- Modify: `app/composables/chatQueueActions.ts`（删本地 `ATTACH_SENTINEL`，改 import）
- Modify: `app/components/ai/composables/useMessageParser.ts`（删本地 `ATTACH_SENTINEL` + `parseHumanContent` 内联解析，改用 shared `splitAttachmentSentinel`）

- [ ] **Step 1: 写失败测试**

创建 `tests/shared/utils/attachmentSentinel.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { ATTACH_SENTINEL, parseAttachmentFileIds, splitAttachmentSentinel } from '#shared/utils/attachmentSentinel'

describe('parseAttachmentFileIds', () => {
  it('从带 sentinel 的内容解析出 ossFileId 列表', () => {
    const content = `${ATTACH_SENTINEL}${JSON.stringify([
      { id: 11, fileName: 'a.jpg', fileType: 'image/jpeg', fileSize: 1, encrypted: false },
      { id: 22, fileName: 'b.pdf', fileType: 'application/pdf', fileSize: 2, encrypted: false },
    ])}\n\n请看图片`
    expect(parseAttachmentFileIds(content)).toEqual([11, 22])
  })

  it('无 sentinel 时返回空数组', () => {
    expect(parseAttachmentFileIds('普通文本')).toEqual([])
  })

  it('sentinel 后 JSON 畸形时返回空数组', () => {
    expect(parseAttachmentFileIds(`${ATTACH_SENTINEL}{不是数组`)).toEqual([])
  })

  it('过滤掉非正整数 id', () => {
    const content = `${ATTACH_SENTINEL}${JSON.stringify([
      { id: 5 }, { id: 0 }, { id: -1 }, { id: 'x' }, {},
    ])}`
    expect(parseAttachmentFileIds(content)).toEqual([5])
  })
})

describe('splitAttachmentSentinel', () => {
  it('分离附件清单与去 sentinel 后的正文', () => {
    const content = `${ATTACH_SENTINEL}${JSON.stringify([
      { id: 3, fileName: 'c.jpg', fileType: 'image/jpeg', fileSize: 1, encrypted: false },
    ])}\n\n正文内容`
    const r = splitAttachmentSentinel(content)
    expect(r.attachments.map(a => a.id)).toEqual([3])
    expect(r.rawContent).toBe('正文内容')
  })

  it('无 sentinel 时 attachments 为空、rawContent 原样返回', () => {
    expect(splitAttachmentSentinel('普通文本')).toEqual({ attachments: [], rawContent: '普通文本' })
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/shared/utils/attachmentSentinel.test.ts`
Expected: FAIL，提示无法解析模块 `#shared/utils/attachmentSentinel`。

- [ ] **Step 3: 实现 shared 工具**

创建 `shared/utils/attachmentSentinel.ts`：

```ts
/**
 * 聊天消息附件 sentinel —— 双端共用的单一数据源。
 *
 * 前端把"用户上传的文件"编码成 message content 前缀：
 *   __ATTACHMENTS__\n[{id,fileName,fileType,fileSize,encrypted}, ...]\n\n正文
 * 服务端中间件 / 前端解析器都从这里取常量与解析逻辑，禁止各自再抄一份。
 */

/** content sentinel 前缀 */
export const ATTACH_SENTINEL = '__ATTACHMENTS__\n'

/** sentinel 后的轻量附件元数据 */
export interface AttachmentPayloadItem {
  id: number
  fileName: string
  fileType: string
  fileSize: number
  encrypted: boolean
}

function isAttachmentPayloadItem(a: unknown): a is AttachmentPayloadItem {
  return !!a && typeof a === 'object'
    && Number.isInteger((a as AttachmentPayloadItem).id)
    && (a as AttachmentPayloadItem).id > 0
}

/**
 * 解析 message content：分离附件清单与去掉 sentinel 后的正文。
 *
 * 这是唯一的 sentinel 解析核心——前端 useMessageParser 与服务端中间件都基于它，
 * 禁止再各写一份。
 *
 * @returns attachments 附件清单（无附件 / 解析失败为 []）；rawContent 去掉 sentinel 后的正文
 */
export function splitAttachmentSentinel(
  content: string,
): { attachments: AttachmentPayloadItem[]; rawContent: string } {
  if (!content.startsWith(ATTACH_SENTINEL)) {
    return { attachments: [], rawContent: content }
  }
  const newlineIdx = content.indexOf('\n', ATTACH_SENTINEL.length)
  const json = newlineIdx === -1
    ? content.slice(ATTACH_SENTINEL.length)
    : content.slice(ATTACH_SENTINEL.length, newlineIdx)
  const rawContent = newlineIdx === -1
    ? ''
    : content.slice(newlineIdx + 1).replace(/^\n+/, '')
  let attachments: AttachmentPayloadItem[] = []
  try {
    const arr = JSON.parse(json)
    if (Array.isArray(arr)) attachments = arr.filter(isAttachmentPayloadItem)
  } catch {
    // sentinel JSON 解析失败，忽略
  }
  return { attachments, rawContent }
}

/**
 * 解析 message content 里的附件清单。无附件 / 解析失败返回 []。
 */
export function parseAttachments(content: string): AttachmentPayloadItem[] {
  return splitAttachmentSentinel(content).attachments
}

/**
 * 解析 message content，仅返回去重后的 ossFileId 列表。
 */
export function parseAttachmentFileIds(content: string): number[] {
  return [...new Set(parseAttachments(content).map(a => a.id))]
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/shared/utils/attachmentSentinel.test.ts`
Expected: PASS（6 项）。

- [ ] **Step 5: 前端 `chatQueueActions.ts` 改用 shared 常量与类型**

`app/composables/chatQueueActions.ts`：

1. 删除本地 `ATTACH_SENTINEL` 注释与定义（约 49-50 行）。
2. 删除本地 `interface AttachmentPayloadItem`（约 34 行）——它与 shared 的同名接口字段完全一致，统一到 shared 一处。
3. 顶部 import：

```ts
import { ATTACH_SENTINEL, type AttachmentPayloadItem } from '#shared/utils/attachmentSentinel'
```

（`buildAttachmentsPayload` 内对 `ATTACH_SENTINEL`、`AttachmentPayloadItem` 的引用不变。`chatQueueActions.ts` 是"写"端，只用常量与类型。若本地 `AttachmentPayloadItem` 与 shared 字段有出入，以 shared 为准对齐。）

- [ ] **Step 6: 前端 `useMessageParser.ts` 改用 shared 解析**

`app/components/ai/composables/useMessageParser.ts`：

1. 删除本地 `const ATTACH_SENTINEL = '__ATTACHMENTS__\n'`（约 51 行），文件顶部 import 区加：

```ts
import { splitAttachmentSentinel } from '#shared/utils/attachmentSentinel'
```

2. 把 `parseHumanContent` 里那段内联 sentinel 解析（约 132-150 行：`rawContent.startsWith(ATTACH_SENTINEL)` 的整个 `if` 块）替换为调用 shared 解析，保留"附件优先取 `additional_kwargs`，无则回退 sentinel"的原有优先级：

```ts
  let rawContent = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
  const split = splitAttachmentSentinel(rawContent)
  rawContent = split.rawContent
  if (!attachments && split.attachments.length > 0) {
    attachments = split.attachments
  }
```

3. `splitAttachmentSentinel` 返回的 `attachments` 类型为 shared 的 `AttachmentPayloadItem[]`。核对它与本文件原 `ParsedAttachment` 类型（约 30 行）字段是否一致：一致则把 `ParsedAttachment` 改为 `import type { AttachmentPayloadItem as ParsedAttachment }`（或直接用 `AttachmentPayloadItem`），原本地 `isParsedAttachment` 过滤函数若仅服务于此处可一并删除；若 `ParsedAttachment` 有额外字段，以 shared 类型为准对齐，不得让两份类型再分叉。

- [ ] **Step 7: 类型检查 + 跑受影响的前端测试**

Run: `bun run typecheck`
Expected: 通过。

Run: `npx vitest run tests/app/composables/useStreamChat.subThreads.test.ts`
Expected: PASS（确认前端附件链路未破）。

- [ ] **Step 8: 提交**

```bash
git add shared/utils/attachmentSentinel.ts tests/shared/utils/attachmentSentinel.test.ts app/composables/chatQueueActions.ts app/components/ai/composables/useMessageParser.ts
git commit -m "refactor(chat): 附件 sentinel 常量与解析下沉到 shared"
```

---

## Task 3: DAO 层 —— 按 sessionId 查材料

**Files:**
- Modify: `shared/types/material.ts:76-90`（`CreateMaterialInput`）
- Modify: `server/services/material/material.dao.ts`（`createMaterialDao` + `findMaterialsByCaseIdDao` 附近 + `findMaterialsByCaseOrDraftIdDao`）
- Test: `tests/server/material/materialSession.dao.test.ts`（新建）

- [ ] **Step 1: 写失败测试**

创建 `tests/server/material/materialSession.dao.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { prisma } from '~~/server/utils/db'
import {
  createMaterialDao,
  findMaterialsBySessionIdDao,
  findMaterialsByCaseOrDraftIdDao,
} from '~~/server/services/material/material.dao'

describe('findMaterialsBySessionIdDao', () => {
  it('只返回该 sessionId 下未删除的材料', async () => {
    const sid = `sess-${Date.now()}`
    const a = await createMaterialDao({ sessionId: sid, name: 'A', type: 3 })
    await createMaterialDao({ sessionId: 'other-sess', name: 'B', type: 3 })

    const rows = await findMaterialsBySessionIdDao(sid)
    expect(rows.map(r => r.id)).toEqual([a.id])

    await prisma.caseMaterials.update({ where: { id: a.id }, data: { deletedAt: new Date() } })
    expect(await findMaterialsBySessionIdDao(sid)).toEqual([])
  })
})

describe('findMaterialsByCaseOrDraftIdDao（含 sessionId 分支）', () => {
  it('按 sessionId OR 合并', async () => {
    const sid = `sess-or-${Date.now()}`
    const m = await createMaterialDao({ sessionId: sid, name: 'C', type: 3 })
    const rows = await findMaterialsByCaseOrDraftIdDao({ caseId: null, draftId: null, sessionId: sid })
    expect(rows.map(r => r.id)).toEqual([m.id])
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/server/material/materialSession.dao.test.ts`
Expected: FAIL（`findMaterialsBySessionIdDao` 未导出 / `findMaterialsByCaseOrDraftIdDao` 签名不符）。

- [ ] **Step 3: `CreateMaterialInput` 加 `sessionId`、`caseId` 改可选 + `createMaterialDao` 透传**

`shared/types/material.ts` 的 `CreateMaterialInput`（76 行起）：把 `caseId` 改为可选（通用问答/文书场景可不传），并新增 `sessionId`：

```ts
export interface CreateMaterialInput {
    /** 关联的案件ID（按归属维度可选；与 draftId / sessionId 可并存） */
    caseId?: number | null
    /** 关联的文书草稿ID（文书草稿场景使用） */
    draftId?: number
    /** 关联的对话会话标识（通用问答场景使用，对应 caseSessions.sessionId） */
    sessionId?: string | null
    /** 材料名称 */
    name: string
```

（`name` 之后的 `type` / `content` / `originalContent` / `ossFileId` 等字段保持原样。）

`server/services/material/material.dao.ts` 的 `createMaterialDao` 的 `data` 对象里，在 `draftId` 那行之后加一行：

```ts
                sessionId: data.sessionId ?? null,
```

- [ ] **Step 4: 新增 `findMaterialsBySessionIdDao`**

> 命名说明：`api.md` 规定 DAO 方法以 `DAO` 结尾，但现网 `material.dao.ts` 全部用小写 `*Dao`（`createMaterialDao` 等）。新增函数**跟随本文件局部约定用 `*Dao`**（文件内一致优先于全局规范字面）；这与现状一致，无需改名。

在 `findMaterialsByCaseIdDao`（约 112 行）之后插入：

```ts
/**
 * 按对话会话标识查询材料（通用问答场景）
 */
export const findMaterialsBySessionIdDao = async (
    sessionId: string,
    tx?: Prisma.TransactionClient,
): Promise<caseMaterials[]> => {
    try {
        return await (tx || prisma).caseMaterials.findMany({
            where: { sessionId, deletedAt: null },
            orderBy: { createdAt: 'asc' },
        })
    } catch (error) {
        logger.error('通过会话标识查询材料失败：', error)
        throw error
    }
}
```

- [ ] **Step 5: `findMaterialsByCaseOrDraftIdDao` 改为对象参数 + 支持 sessionId**

把现有 `findMaterialsByCaseOrDraftIdDao`（约 354 行）整体替换为：

```ts
/** 材料归属维度：caseId / draftId / sessionId 至少一个非空 */
export interface MaterialOwnerFilter {
    caseId: number | null
    draftId: number | null
    sessionId?: string | null
}

/**
 * 按归属维度（案件 / 草稿 / 会话）OR 合并查询材料。
 */
export const findMaterialsByCaseOrDraftIdDao = async (
    owner: MaterialOwnerFilter,
    tx?: Prisma.TransactionClient,
): Promise<caseMaterials[]> => {
    const orBranches: Prisma.caseMaterialsWhereInput[] = []
    if (owner.caseId != null) orBranches.push({ caseId: owner.caseId })
    if (owner.draftId != null) orBranches.push({ draftId: owner.draftId })
    if (owner.sessionId != null) orBranches.push({ sessionId: owner.sessionId })
    if (orBranches.length === 0) return []
    try {
        return await (tx || prisma).caseMaterials.findMany({
            where: { OR: orBranches, deletedAt: null },
            orderBy: { createdAt: 'asc' },
        })
    } catch (error) {
        logger.error('按归属维度查询材料失败：', error)
        throw error
    }
}
```

> 注意：原函数体若有 `try/catch` 后续行（如 catch 块），整体覆盖。其唯一调用方 `getMaterialsByCaseOrDraftIdService` 将在 Task 4 同步改造。

- [ ] **Step 6: 运行测试确认通过**

Run: `npx vitest run tests/server/material/materialSession.dao.test.ts`
Expected: PASS（2 项）。

- [ ] **Step 7: 提交**

```bash
git add shared/types/material.ts server/services/material/material.dao.ts tests/server/material/materialSession.dao.test.ts
git commit -m "feat(material): DAO 支持按会话标识查询材料"
```

---

## Task 4: Service 层 —— 按 sessionId 取材料

**Files:**
- Modify: `server/services/material/material.service.ts`（`getMaterialsByCaseIdService` 附近 + `getMaterialsByCaseOrDraftIdService`）
- Test: `tests/server/material/materialSession.service.test.ts`（新建）

- [ ] **Step 1: 写失败测试**

创建 `tests/server/material/materialSession.service.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { createMaterialDao } from '~~/server/services/material/material.dao'
import {
  getMaterialsBySessionIdService,
  getMaterialsByCaseOrDraftIdService,
} from '~~/server/services/material/material.service'

describe('getMaterialsBySessionIdService', () => {
  it('返回会话材料并附加 OSS 文件信息字段', async () => {
    const sid = `sess-svc-${Date.now()}`
    await createMaterialDao({ sessionId: sid, name: 'A', type: 3 })
    const rows = await getMaterialsBySessionIdService(sid)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveProperty('fileName')
  })
})

describe('getMaterialsByCaseOrDraftIdService（含 sessionId）', () => {
  it('按 sessionId 取材料', async () => {
    const sid = `sess-svc-or-${Date.now()}`
    const m = await createMaterialDao({ sessionId: sid, name: 'B', type: 3 })
    const rows = await getMaterialsByCaseOrDraftIdService({ caseId: null, draftId: null, sessionId: sid })
    expect(rows.map(r => r.id)).toEqual([m.id])
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/server/material/materialSession.service.test.ts`
Expected: FAIL（`getMaterialsBySessionIdService` 未导出 / `getMaterialsByCaseOrDraftIdService` 签名不符）。

- [ ] **Step 3: 新增 `getMaterialsBySessionIdService`**

`material.service.ts`，在 `getMaterialsByDraftIdService`（约 174 行）之后插入：

```ts
/**
 * 获取对话会话的所有材料（通用问答场景）
 */
export const getMaterialsBySessionIdService = async (
    sessionId: string,
): Promise<MaterialWithFile[]> => {
    const materials = await findMaterialsBySessionIdDao(sessionId)
    return attachOssFileInfo(materials)
}
```

并在 `material.service.ts` 顶部从 `./material.dao` 的 import 列表里补上 `findMaterialsBySessionIdDao` 与 `MaterialOwnerFilter`。

- [ ] **Step 4: `getMaterialsByCaseOrDraftIdService` 改对象参数**

把 `getMaterialsByCaseOrDraftIdService`（约 275 行）替换为：

```ts
export const getMaterialsByCaseOrDraftIdService = async (
    owner: MaterialOwnerFilter,
): Promise<MaterialWithFile[]> => {
    const materials = await findMaterialsByCaseOrDraftIdDao(owner)
    return attachOssFileInfo(materials)
}
```

并把 `getMaterialsByCaseOrDraftIdWithStatusService`（约 286 行）内部调用改为：

```ts
    const materials = await getMaterialsByCaseOrDraftIdService({ caseId, draftId })
```

（`getMaterialsByCaseOrDraftIdWithStatusService` 自身 `(caseId, draftId)` 签名保持不变，不影响其 API 调用方。）

- [ ] **Step 5: 全量扫描并修正 `getMaterialsByCaseOrDraftIdService` 其它调用方**

Run: `grep -rn "getMaterialsByCaseOrDraftIdService" server/ --include="*.ts" | grep -v ".test."`
对每个调用方改为对象参数。已知 `server/services/material/materialPipeline.service.ts` 的 `searchMaterialsByCaseOrDraftService` 内部调用它——把那一处临时改为对象参数（仅 caseId/draftId，sessionId 留待 Task 7）：

```ts
    const allMaterials = await getMaterialsByCaseOrDraftIdService({
        caseId: ids.caseId,
        draftId: ids.draftId,
    })
```

若 grep 出其它调用方，同样改为 `{ caseId, draftId }` 对象参数。

- [ ] **Step 6: 运行测试确认通过**

Run: `npx vitest run tests/server/material/materialSession.service.test.ts`
Expected: PASS（2 项）。

- [ ] **Step 7: 类型检查**

Run: `bun run typecheck`
Expected: 通过，0 error（material 模块全部调用方已对齐对象参数）。

- [ ] **Step 8: 提交**

```bash
git add server/services/material/material.service.ts tests/server/material/materialSession.service.test.ts
git commit -m "feat(material): Service 支持按会话标识取材料"
```

---

## Task 5: 单文件材料就绪 —— 抽公共核心 + 会话入口

**背景:** `ensureMaterialsReadyForDraftService` 的核心逻辑（按 ossFileId 查/建记录、补齐归属、复用已就绪、触发识别、轮询终态）与会话场景完全一致，仅"归属维度"不同。抽成归属无关的 `ensureSingleMaterialReady`，draft 与 session 各做薄包装。

**Files:**
- Modify: `server/services/material/materialPipeline.service.ts:816-937`
- Test: `tests/server/material/ensureSessionMaterial.test.ts`（新建）

- [ ] **Step 1: 写失败测试**

创建 `tests/server/material/ensureSessionMaterial.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { prisma } from '~~/server/utils/db'
import { ensureMaterialsReadyForSessionService } from '~~/server/services/material/materialPipeline.service'
import { findMaterialsBySessionIdDao } from '~~/server/services/material/material.dao'

/**
 * 建一个最小可用的 ossFiles 行（图片），返回 ossFileId。
 * 字段以本仓库 ossFiles 模型必填项为准，缺字段时按报错补齐。
 */
async function seedOssImage(userId: number): Promise<number> {
  const f = await prisma.ossFiles.create({
    data: {
      userId,
      fileName: `t-${Date.now()}.jpg`,
      fileType: 'image/jpeg',
      fileSize: BigInt(1024),
      filePath: `test/t-${Date.now()}.jpg`,
    } as any,
  })
  return f.id
}

describe('ensureMaterialsReadyForSessionService', () => {
  it('为会话内新文件建立 sessionId 归属的 case_materials 记录', async () => {
    const userId = 1
    const sid = `sess-ensure-${Date.now()}`
    const ossFileId = await seedOssImage(userId)

    await ensureMaterialsReadyForSessionService(ossFileId, sid, userId)

    const rows = await findMaterialsBySessionIdDao(sid)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.ossFileId).toBe(ossFileId)
    expect(rows[0]?.sessionId).toBe(sid)
  })

  it('同一文件重复调用幂等，不产生第二条记录', async () => {
    const userId = 1
    const sid = `sess-idem-${Date.now()}`
    const ossFileId = await seedOssImage(userId)
    await ensureMaterialsReadyForSessionService(ossFileId, sid, userId)
    await ensureMaterialsReadyForSessionService(ossFileId, sid, userId)
    expect(await findMaterialsBySessionIdDao(sid)).toHaveLength(1)
  })
})
```

> 若 `seedOssImage` 因 ossFiles 必填字段缺失报错，按报错信息补齐对应字段（参考 `prisma/models/*.prisma` 里 `ossFiles` 模型）。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/server/material/ensureSessionMaterial.test.ts`
Expected: FAIL（`ensureMaterialsReadyForSessionService` 未导出）。

- [ ] **Step 3: 抽出 `ensureSingleMaterialReady` 核心 + 改写 draft 包装**

把 `materialPipeline.service.ts` 中现有的 `ensureMaterialsReadyForDraftService`（连同其上方约 806-815 行的 JSDoc 文档注释，整体替换约 806-937 行——以函数名定位为准）整体替换为下面三段：

```ts
/** 单文件材料的归属维度（至少一个非空） */
interface SingleMaterialOwner {
    caseId?: number | null
    draftId?: number | null
    sessionId?: string | null
}

/**
 * 单文件材料就绪保障（归属无关核心）
 *
 * 1. 按 ossFileId 查/建 case_materials 记录，按需补齐 caseId/draftId/sessionId 归属列
 * 2. 已识别+已嵌入 → 直接置 COMPLETED，跳过重复识别/嵌入
 * 3. 否则触发 processMaterialService（识别+嵌入），轮询至终态
 */
async function ensureSingleMaterialReady(
    ossFileId: number,
    userId: number,
    owner: SingleMaterialOwner,
): Promise<{ id: number; status: number; ossFileId: number | null }> {
    const existing = await findActiveMaterialByOssFileIdDao(ossFileId)
    let materialId: number

    if (existing) {
        materialId = existing.id
        // 按需补齐缺失的归属列；已有值与入参不同仅告警不覆盖（caseId/draftId），sessionId 同理
        const patch: Partial<{ caseId: number; draftId: number; sessionId: string }> = {}
        if (owner.caseId != null && existing.caseId == null) patch.caseId = owner.caseId
        else if (owner.caseId != null && existing.caseId != null && existing.caseId !== owner.caseId) {
            logger.warn('case_materials caseId 冲突，保留原值', { materialId: existing.id, existingCaseId: existing.caseId, incomingCaseId: owner.caseId })
        }
        if (owner.draftId != null && existing.draftId !== owner.draftId) {
            if (existing.draftId != null) logger.warn('case_materials draftId 被覆盖', { materialId: existing.id, oldDraftId: existing.draftId, newDraftId: owner.draftId })
            patch.draftId = owner.draftId
        }
        if (owner.sessionId != null && existing.sessionId == null) patch.sessionId = owner.sessionId
        if (Object.keys(patch).length > 0) {
            await prisma.caseMaterials.update({ where: { id: existing.id }, data: patch })
        }

        if (existing.status === MaterialStatus.COMPLETED) {
            generateMaterialSummaryService(existing.id).catch(() => { /* 内部已 catch */ })
            return { id: existing.id, status: existing.status, ossFileId: existing.ossFileId }
        }
    } else {
        const ossFile = await prisma.ossFiles.findFirst({
            where: { id: ossFileId, deletedAt: null },
            select: { fileName: true, fileType: true },
        })
        if (!ossFile) throw new Error(`OSS 文件不存在: ${ossFileId}`)
        const materialType = getMaterialTypeFromMime(ossFile.fileType)
        const newMaterial = await createMaterialDao({
            caseId: owner.caseId ?? null,
            draftId: owner.draftId ?? null,
            sessionId: owner.sessionId ?? null,
            ossFileId,
            name: ossFile.fileName ?? `材料_${ossFileId}`,
            type: materialType,
        })
        materialId = newMaterial.id
    }

    // 跨归属复用：已识别 + 已嵌入直接置 COMPLETED
    const materialDetail = await getMaterialByIdService(materialId)
    if (materialDetail) {
        const [recognizedMap, embeddedMap] = await Promise.all([
            batchCheckMaterialRecognizedService([materialDetail]),
            batchCheckMaterialEmbeddedService([materialId]),
        ])
        if (recognizedMap.get(materialId) && embeddedMap.get(materialId)) {
            if (materialDetail.status !== MaterialStatus.COMPLETED) {
                await updateMaterialStatusService(materialId, MaterialStatus.COMPLETED)
            }
            generateMaterialSummaryService(materialId).catch(() => { /* 内部已 catch */ })
            return { id: materialId, status: MaterialStatus.COMPLETED, ossFileId: materialDetail.ossFileId }
        }
    }

    try {
        await processMaterialService(materialId, userId)
    } catch (err) {
        if (!(err instanceof MaterialProcessError) || err.code !== 400) throw err
    }

    for (let i = 0; i < MAX_POLLS; i++) {
        const updated = await findMaterialByIdDao(materialId)
        if (updated?.status === MaterialStatus.COMPLETED) {
            generateMaterialSummaryService(materialId).catch(() => { /* 内部已 catch */ })
            return { id: updated.id, status: updated.status, ossFileId: updated.ossFileId }
        }
        if (updated?.status === MaterialStatus.FAILED) {
            throw new Error(`材料处理失败: ${materialId}`)
        }
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
    }
    throw new Error(`材料处理超时: ${materialId}`)
}

/**
 * 单文件材料就绪保障（文书草稿场景）—— 薄包装，保持既有调用方签名不变。
 */
export async function ensureMaterialsReadyForDraftService(
    ossFileId: number,
    draftId: number,
    userId: number,
    caseId?: number | null,
): Promise<{ id: number; status: number; draftId: number | null; ossFileId: number | null }> {
    const r = await ensureSingleMaterialReady(ossFileId, userId, { caseId, draftId })
    return { id: r.id, status: r.status, draftId, ossFileId: r.ossFileId }
}

/**
 * 单文件材料就绪保障（通用问答会话场景）。
 */
export async function ensureMaterialsReadyForSessionService(
    ossFileId: number,
    sessionId: string,
    userId: number,
): Promise<{ id: number; status: number; ossFileId: number | null }> {
    return ensureSingleMaterialReady(ossFileId, userId, { sessionId })
}
```

> 上面用到的 `getMaterialTypeFromMime` / `createMaterialDao` / `findActiveMaterialByOssFileIdDao` / `getMaterialByIdService` / `batchCheckMaterialRecognizedService` / `batchCheckMaterialEmbeddedService` / `updateMaterialStatusService` / `findMaterialByIdDao` / `generateMaterialSummaryService` / `processMaterialService` / `MaterialProcessError` / `MaterialStatus` / `MAX_POLLS` / `POLL_INTERVAL_MS` 均为本文件原 `ensureMaterialsReadyForDraftService` 已引用的标识符，无需新增 import。

- [ ] **Step 4: 运行新测试确认通过**

Run: `npx vitest run tests/server/material/ensureSessionMaterial.test.ts`
Expected: PASS（2 项）。

- [ ] **Step 5: 跑草稿路径回归测试**

Run: `npx vitest run tests/server/material tests/server/agent-platform/tools/processMaterials.test.ts`
Expected: PASS（确认 `ensureMaterialsReadyForDraftService` 包装重写未破坏草稿场景）。

- [ ] **Step 6: 提交**

```bash
git add server/services/material/materialPipeline.service.ts tests/server/material/ensureSessionMaterial.test.ts
git commit -m "refactor(material): 抽出归属无关的单文件就绪核心 + 新增会话入口"
```

---

## Task 6: 会话材料批处理入口 `ensureMaterialsReadyBySessionService`

**Files:**
- Modify: `server/services/material/materialPipeline.service.ts`（`ensureMaterialsReadyByDraftService` 之后）
- Test: `tests/server/material/ensureSessionMaterial.test.ts`（追加）

- [ ] **Step 1: 追加失败测试**

在 `tests/server/material/ensureSessionMaterial.test.ts` 末尾追加：

```ts
import { ensureMaterialsReadyBySessionService } from '~~/server/services/material/materialPipeline.service'

describe('ensureMaterialsReadyBySessionService', () => {
  it('传 fileIds 时为每个文件建会话材料并返回汇总', async () => {
    const userId = 1
    const sid = `sess-batch-${Date.now()}`
    const f1 = await seedOssImage(userId)
    const f2 = await seedOssImage(userId)
    const result = await ensureMaterialsReadyBySessionService(sid, userId, { fileIds: [f1, f2] })
    expect(result.totalMaterials).toBe(2)
    expect(await findMaterialsBySessionIdDao(sid)).toHaveLength(2)
  })

  it('不传 fileIds 时扫描会话已有材料', async () => {
    const userId = 1
    const sid = `sess-scan-${Date.now()}`
    const f1 = await seedOssImage(userId)
    await ensureMaterialsReadyForSessionService(f1, sid, userId)
    const result = await ensureMaterialsReadyBySessionService(sid, userId, {})
    expect(result.totalMaterials).toBe(1)
  })

  it('会话无任何材料时返回空汇总', async () => {
    const result = await ensureMaterialsReadyBySessionService(`sess-empty-${Date.now()}`, 1, {})
    expect(result.totalMaterials).toBe(0)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/server/material/ensureSessionMaterial.test.ts`
Expected: 新增 3 项 FAIL（`ensureMaterialsReadyBySessionService` 未导出）。

- [ ] **Step 3: 实现 `ensureMaterialsReadyBySessionService`**

在 `materialPipeline.service.ts` 的 `ensureMaterialsReadyByDraftService` 函数之后插入：

```ts
/**
 * 通用问答会话批处理：按 sessionId 扫描关联材料并确保识别+嵌入。
 *
 * 与 ensureMaterialsReadyByDraftService 对偶（后者按 draftId）。
 * - 传 fileIds → 先对每个文件走单文件 pipeline 建 (sessionId, ossFileId) 记录，
 *   再按会话全量材料补齐识别/嵌入。
 * - 不传 fileIds → 直接扫 sessionId 下已有 caseMaterials 全部。
 *
 * @param sessionId 对话会话标识（LangGraph thread_id）
 * @param userId 调用用户
 * @param options.fileIds 可选：仅处理这些 OSS 文件
 * @param onProgress 可选：材料就绪进度回调
 */
export async function ensureMaterialsReadyBySessionService(
    sessionId: string,
    userId: number,
    options: { fileIds?: number[] } = {},
    onProgress?: (snapshot: MaterialReadinessSnapshot[]) => void | Promise<void>,
): Promise<MaterialReadyResult> {
    const initialFailed: MaterialFailedItem[] = []

    // 1. 对用户新选的 fileIds，先走单文件 pipeline 保证 (sessionId, ossFileId) 记录存在且跑完
    if (options.fileIds && options.fileIds.length > 0) {
        const perFileResults = await Promise.allSettled(
            options.fileIds.map(fid => ensureMaterialsReadyForSessionService(fid, sessionId, userId)),
        )
        for (let i = 0; i < perFileResults.length; i++) {
            const r = perFileResults[i]!
            if (r.status === 'rejected') {
                initialFailed.push({
                    materialId: 0,
                    name: `ossFile_${options.fileIds[i]}`,
                    error: r.reason instanceof Error ? r.reason.message : String(r.reason),
                })
            }
        }
    }

    // 2. 拉取会话全量材料，交给共享流水线补齐识别/嵌入/摘要
    const materials = await getMaterialsBySessionIdService(sessionId)
    return runRecognitionAndEmbeddingPipeline(materials, userId, initialFailed, onProgress)
}
```

并在 `materialPipeline.service.ts` 顶部从 `./material.service` 的 import 列表里补上 `getMaterialsBySessionIdService`。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/server/material/ensureSessionMaterial.test.ts`
Expected: PASS（全部 5 项）。

- [ ] **Step 5: 提交**

```bash
git add server/services/material/materialPipeline.service.ts tests/server/material/ensureSessionMaterial.test.ts
git commit -m "feat(material): 新增会话材料批处理入口 ensureMaterialsReadyBySessionService"
```

---

## Task 7: 检索服务支持 sessionId 归属

**Files:**
- Modify: `server/services/material/materialPipeline.service.ts`（`searchMaterialsByCaseOrDraftService`）
- Test: `tests/server/material/searchMaterialsSession.test.ts`（新建）

- [ ] **Step 1: 写失败测试**

创建 `tests/server/material/searchMaterialsSession.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { searchMaterialsByCaseOrDraftService } from '~~/server/services/material/materialPipeline.service'

describe('searchMaterialsByCaseOrDraftService（sessionId 归属）', () => {
  it('三个归属维度全空时返回空数组', async () => {
    const r = await searchMaterialsByCaseOrDraftService(
      1,
      { caseId: null, draftId: null, sessionId: null },
      { k: 5 },
    )
    expect(r).toEqual([])
  })

  it('传 sessionId 但会话无材料时返回空数组', async () => {
    const r = await searchMaterialsByCaseOrDraftService(
      1,
      { caseId: null, draftId: null, sessionId: `sess-search-${Date.now()}` },
      { query: '随便搜', k: 5 },
    )
    expect(r).toEqual([])
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/server/material/searchMaterialsSession.test.ts`
Expected: FAIL（`ids` 不接受 `sessionId` 字段 / 类型错）。

- [ ] **Step 3: 改造 `searchMaterialsByCaseOrDraftService`**

把 `searchMaterialsByCaseOrDraftService`（约 796-804 行）替换为：

```ts
export async function searchMaterialsByCaseOrDraftService(
    userId: number,
    ids: { caseId: number | null; draftId: number | null; sessionId?: string | null },
    options: { query?: string; sourceId?: number; k?: number },
): Promise<MaterialSearchToolResult[]> {
    if (ids.caseId == null && ids.draftId == null && ids.sessionId == null) return []
    const allMaterials = await getMaterialsByCaseOrDraftIdService({
        caseId: ids.caseId,
        draftId: ids.draftId,
        sessionId: ids.sessionId ?? null,
    })
    return searchWithinMaterialsService(userId, allMaterials, options)
}
```

> 同步检查：本文件其它对 `getMaterialsByCaseOrDraftIdService` 的调用（Task 4 已把它改为对象参数）。Run `grep -n "getMaterialsByCaseOrDraftIdService" server/services/material/materialPipeline.service.ts` 并把每处改成对象参数。

- [ ] **Step 4: 运行测试 + 类型检查**

Run: `npx vitest run tests/server/material/searchMaterialsSession.test.ts`
Expected: PASS（2 项）。

Run: `bun run typecheck`
Expected: 通过（material 模块全绿）。

- [ ] **Step 5: 提交**

```bash
git add server/services/material/materialPipeline.service.ts tests/server/material/searchMaterialsSession.test.ts
git commit -m "feat(material): 检索服务支持会话标识归属"
```

---

## Task 8: `process_materials` 工具 —— 会话归属分支

**Files:**
- Modify: `server/services/agent-platform/tools/processMaterials.tool.ts:49-148`
- Test: `tests/server/agent-platform/tools/processMaterials.test.ts`（追加）

- [ ] **Step 1: 追加失败测试**

在 `tests/server/agent-platform/tools/processMaterials.test.ts` 的 `vi.mock` 块里，给 `~~/server/services/material/materialPipeline.service` 的 mock 补一行：

```ts
    ensureMaterialsReadyBySessionService: vi.fn(),
```

在 import 块补：

```ts
import { ensureMaterialsReadyBySessionService } from '~~/server/services/material/materialPipeline.service'
```

在测试文件末尾追加（`makeMaterial` 等辅助沿用文件已有定义）：

```ts
describe('process_materials —— 会话归属分支', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('无 caseId/draftId 但有 sessionId 时走 ensureMaterialsReadyBySessionService', async () => {
    ;(ensureMaterialsReadyBySessionService as any).mockResolvedValue({
      materials: [], totalMaterials: 0, alreadyEmbedded: 0, newlyProcessed: 0,
      embeddedMap: new Map(), failed: [],
    })
    const tool = createTool({ userId: 1, sessionId: 'sess-1' } as any)
    const raw = await tool.invoke({ fileIds: [9] })
    const out = JSON.parse(raw as string)
    expect(ensureMaterialsReadyBySessionService).toHaveBeenCalledWith('sess-1', 1, { fileIds: [9] })
    expect(out.mode).toBe('empty')
    expect(out.message).toContain('本对话')
  })

  it('caseId/draftId/sessionId 全缺时返回 error JSON', async () => {
    const tool = createTool({ userId: 1, sessionId: '' } as any)
    const raw = await tool.invoke({})
    const out = JSON.parse(raw as string)
    expect(out.error).toBe('材料处理失败')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/server/agent-platform/tools/processMaterials.test.ts`
Expected: 新增 2 项 FAIL（会话分支未实现，sessionId 场景仍抛"需要 caseId 或 draftId"）。

- [ ] **Step 3: 实现会话分支**

`processMaterials.tool.ts`：

第 15-23 行 import 块补 `ensureMaterialsReadyBySessionService`：

```ts
import {
    ensureMaterialsReadyService,
    ensureMaterialsReadyByDraftService,
    ensureMaterialsReadyBySessionService,
    getMaterialContextService,
    estimateTokens,
    getSourceId,
    TOKEN_THRESHOLD,
    snapshotMaterialReadiness,
} from '~~/server/services/material/materialPipeline.service'
```

第 49 行 `createTool` 内解构补 `sessionId`：

```ts
export function createTool(context: ToolContext) {
    const { userId, caseId, draftId, sessionId } = context
```

把第 58-66 行的归属判定 + 批处理入口选择替换为：

```ts
                if (caseId == null && draftId == null && !sessionId) {
                    throw new Error('process_materials 工具需要 caseId / draftId / sessionId，当前上下文均缺失')
                }

                // 按优先级选择批处理入口：draftId > caseId > sessionId（通用问答）
                const ready = draftId != null
                    ? await ensureMaterialsReadyByDraftService(draftId, userId, { fileIds, caseId: caseId ?? null })
                    : caseId != null
                        ? await ensureMaterialsReadyService(caseId, userId)
                        : await ensureMaterialsReadyBySessionService(sessionId!, userId, { fileIds })
                const { materials, embeddedMap } = ready
```

把第 69-75 行的空态文案（`materials.length === 0`）替换为：

```ts
                if (materials.length === 0) {
                    return JSON.stringify({
                        mode: 'empty',
                        message: draftId != null
                            ? '当前文书草稿还没有材料，请先在输入框里上传/选择文件。'
                            : caseId != null
                                ? '当前案件没有任何材料，请先上传案件材料。'
                                : '本对话还没有上传任何文件，请先在输入框上传后再提问。',
                        materials: [],
                    })
                }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/server/agent-platform/tools/processMaterials.test.ts`
Expected: PASS（含原有全部用例 + 新增 2 项）。

- [ ] **Step 5: 提交**

```bash
git add server/services/agent-platform/tools/processMaterials.tool.ts tests/server/agent-platform/tools/processMaterials.test.ts
git commit -m "feat(tools): process_materials 支持通用问答会话归属"
```

---

## Task 9: `search_case_materials` 工具 —— 会话归属分支

**Files:**
- Modify: `server/services/agent-platform/tools/searchCaseMaterials.tool.ts:33-64`
- Test: `tests/server/agent-platform/tools/searchCaseMaterialsSession.test.ts`（新建）

- [ ] **Step 1: 写失败测试**

创建 `tests/server/agent-platform/tools/searchCaseMaterialsSession.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

;(globalThis as any).logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }

vi.mock('~~/server/services/material/materialPipeline.service', () => ({
  searchMaterialsByCaseOrDraftService: vi.fn(),
}))
vi.mock('~~/server/services/workflow/context/toolResultTruncator', () => ({
  truncateToolResults: (x: unknown) => x,
}))

import { searchMaterialsByCaseOrDraftService } from '~~/server/services/material/materialPipeline.service'
import { createTool } from '~~/server/services/agent-platform/tools/searchCaseMaterials.tool'

describe('search_case_materials —— 会话归属分支', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('无 caseId/draftId 但有 sessionId 时按 sessionId 检索', async () => {
    ;(searchMaterialsByCaseOrDraftService as any).mockResolvedValue([
      { sourceId: 1, content: '命中片段' },
    ])
    const tool = createTool({ userId: 1, sessionId: 'sess-9' } as any)
    await tool.invoke({ query: '合同金额', k: 5 })
    expect(searchMaterialsByCaseOrDraftService).toHaveBeenCalledWith(
      1,
      { caseId: null, draftId: null, sessionId: 'sess-9' },
      { query: '合同金额', sourceId: undefined, k: 5 },
    )
  })

  it('caseId/draftId/sessionId 全缺时报错', async () => {
    const tool = createTool({ userId: 1, sessionId: '' } as any)
    const raw = await tool.invoke({ query: 'x', k: 5 })
    expect(JSON.stringify(raw)).toContain('search_case_materials')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/server/agent-platform/tools/searchCaseMaterialsSession.test.ts`
Expected: FAIL（会话分支未实现）。

- [ ] **Step 3: 实现会话分支**

`searchCaseMaterials.tool.ts`，把 `createTool` 回调体（35-62 行）改为：

```ts
    async (input, ctx) => {
        const { userId, caseId, draftId: ctxDraftId, sessionId } = ctx
        const { query, sourceId, draftId: inputDraftId, k = 5 } = input

        // input 中的 draftId 覆盖 context 中的 draftId
        const effectiveDraftId = inputDraftId ?? ctxDraftId

        // 模型传入的 k 值 clamp 到 [1, MAX_K]，避免因超限报错
        const safeK = Math.min(Math.max(1, Math.floor(k)), MAX_K)

        logger.info('执行材料检索工作流工具', { userId, caseId, draftId: effectiveDraftId, sessionId, query, sourceId, k: safeK })

        if (caseId == null && !effectiveDraftId && !sessionId) {
            throw new Error('search_case_materials 需要 caseId / draftId / sessionId')
        }

        // 合并检索：caseId / draftId / sessionId 由服务层 OR 查询 + 天然去重
        const results = await searchMaterialsByCaseOrDraftService(
            userId,
            { caseId: caseId ?? null, draftId: effectiveDraftId ?? null, sessionId: sessionId ?? null },
            { query, sourceId, k: safeK },
        )

        if (results.length === 0) return { error: '未找到指定材料' }

        logger.info('材料检索完成', { caseId, draftId: effectiveDraftId, sessionId, resultCount: results.length })
        return truncateToolResults(results)
    },
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/server/agent-platform/tools/searchCaseMaterialsSession.test.ts`
Expected: PASS（2 项）。

- [ ] **Step 5: 提交**

```bash
git add server/services/agent-platform/tools/searchCaseMaterials.tool.ts tests/server/agent-platform/tools/searchCaseMaterialsSession.test.ts
git commit -m "feat(tools): search_case_materials 支持通用问答会话归属"
```

---

## Task 10: 抽出材料就绪进度推送辅助

**背景:** `caseProcessMaterialMiddleware` 里"`onProgress` 快照 → `PREPARE_MATERIALS` SSE 事件（start/progress/end + 全 ready 抑制）"约 60 行逻辑，会话中间件要复用。抽到 `_shared` 单一来源。

**Files:**
- Create: `server/agents/_shared/material-prepare/materialPrepareProgress.ts`
- Test: `tests/server/agents/materialPrepareProgress.test.ts`（新建）

- [ ] **Step 1: 写失败测试**

创建 `tests/server/agents/materialPrepareProgress.test.ts`：

```ts
import { describe, it, expect, vi } from 'vitest'

;(globalThis as any).logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }

import { createMaterialPrepareEmitter } from '~~/server/agents/_shared/material-prepare/materialPrepareProgress'

const snap = (status: string) => [{ materialId: 1, name: 'a', status } as any]

describe('createMaterialPrepareEmitter', () => {
  it('runId 为 null 时 onProgress / finalize 均为安全空操作', async () => {
    const e = createMaterialPrepareEmitter(null, '')
    await e.onProgress(snap('recognizing'))
    await e.finalize()
    expect(e).toBeTruthy()
  })

  it('首次快照即全 ready 时整轮抑制，不 emit', async () => {
    const emit = vi.fn(async () => {})
    const e = createMaterialPrepareEmitter('run-1', 'sess-1', emit)
    await e.onProgress(snap('ready'))
    await e.finalize()
    expect(emit).not.toHaveBeenCalled()
  })

  it('有进行中材料时 emit start，再 finalize emit end', async () => {
    const emit = vi.fn(async () => {})
    const e = createMaterialPrepareEmitter('run-2', 'sess-2', emit)
    await e.onProgress(snap('recognizing'))
    await e.finalize()
    const phases = emit.mock.calls.map(c => (c[0] as any).data.phase)
    expect(phases).toContain('start')
    expect(phases).toContain('end')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/server/agents/materialPrepareProgress.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现进度推送辅助**

创建 `server/agents/_shared/material-prepare/materialPrepareProgress.ts`：

```ts
/**
 * 材料就绪进度推送辅助
 *
 * 把 ensureMaterials*Service 的 onProgress 快照转成 PREPARE_MATERIALS SSE 事件
 * （phase=start/progress/end），供案件 / 通用问答两个材料预处理中间件共用。
 *
 * 抑制规则：首次快照即"全部 ready"时整轮抑制（不 emit），避免二次分析 / 刷新重连
 * 时弹一个瞬间"已完成"的噪音卡片。
 */
import { createCustomEventEmitter } from '~~/server/services/agent-platform/sse/customEventEmitter'
import { SSECustomEventType } from '#shared/types/agentEvent'
import type {
    PrepareMaterialItem,
    PrepareMaterialsPayload,
} from '#shared/types/agentEvent'
import type { MaterialReadinessSnapshot } from '~~/server/services/material/materialPipeline.service'

type EmitFn = (event: { name: SSECustomEventType; data: PrepareMaterialsPayload }) => Promise<void>

export interface MaterialPrepareEmitter {
    /** 传给 ensureMaterials*Service 的进度回调 */
    onProgress: (snapshot: MaterialReadinessSnapshot[]) => Promise<void>
    /** 流水线结束后调用：若曾 emit 过 start 则补一条 phase=end */
    finalize: () => Promise<void>
}

/**
 * @param runId   非空才推送 SSE；null 时返回安全空操作
 * @param sessionId 会话标识
 * @param emitOverride 测试注入用；生产留空走 createCustomEventEmitter
 */
export function createMaterialPrepareEmitter(
    runId: string | null,
    sessionId: string,
    emitOverride?: EmitFn,
): MaterialPrepareEmitter {
    const emit: EmitFn | null = runId
        ? (emitOverride ?? (createCustomEventEmitter({ runId, sessionId }) as EmitFn))
        : null

    let started = false
    let suppressed = false
    let toolCallId: string | null = null
    let lastSnapshot: MaterialReadinessSnapshot[] = []

    const toItems = (s: MaterialReadinessSnapshot[]): PrepareMaterialItem[] =>
        s.map(x => ({ id: x.materialId, name: x.name, status: x.status }))

    const onProgress = async (snapshot: MaterialReadinessSnapshot[]) => {
        lastSnapshot = snapshot
        if (!emit) return

        if (!started && !suppressed) {
            if (snapshot.length > 0 && snapshot.every(s => s.status === 'ready')) {
                suppressed = true
                return
            }
        }
        if (suppressed) return

        if (!started) {
            started = true
            toolCallId = `prepare-${runId}`
            await emit({
                name: SSECustomEventType.PREPARE_MATERIALS,
                data: { phase: 'start', toolCallId, materials: toItems(snapshot) },
            })
        } else {
            await emit({
                name: SSECustomEventType.PREPARE_MATERIALS,
                data: { phase: 'progress', toolCallId: toolCallId!, materials: toItems(snapshot) },
            })
        }
    }

    const finalize = async () => {
        if (!emit || !started || !toolCallId) return
        const failedCount = lastSnapshot.filter(s => s.status === 'failed').length
        await emit({
            name: SSECustomEventType.PREPARE_MATERIALS,
            data: { phase: 'end', toolCallId, materials: toItems(lastSnapshot), failedCount },
        })
    }

    return { onProgress, finalize }
}
```

> `MaterialReadinessSnapshot` 已由 `materialPipeline.service.ts` 导出（见该文件 `export interface MaterialReadinessSnapshot`）。`createCustomEventEmitter` 的返回值在 `caseProcessMaterial.middleware.ts` 已按 `emit({ name, data })` 形态调用，此处 `EmitFn` 类型与之对齐。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/server/agents/materialPrepareProgress.test.ts`
Expected: PASS（3 项）。

- [ ] **Step 5: 提交**

```bash
git add server/agents/_shared/material-prepare/materialPrepareProgress.ts tests/server/agents/materialPrepareProgress.test.ts
git commit -m "refactor(agents): 抽出材料就绪进度推送共享辅助"
```

---

## Task 11: `caseProcessMaterialMiddleware` 改用共享辅助

**背景:** 让案件材料预处理中间件复用 Task 10 的辅助，消除重复逻辑、保证两端进度卡片行为一致。

**Files:**
- Modify: `server/agents/_shared/case-context/caseProcessMaterial.middleware.ts`

- [ ] **Step 1: 改写中间件 hook 使用辅助**

把 `caseProcessMaterial.middleware.ts` 的 `beforeAgent.hook`（27-102 行）整体替换为：

```ts
            hook: async (_state) => {
                const emitter = createMaterialPrepareEmitter(runId, sessionId)
                try {
                    const result = await ensureMaterialsReadyService(caseId, userId, emitter.onProgress)
                    logger.info('材料预处理完成', {
                        caseId,
                        totalMaterials: result.totalMaterials,
                        alreadyEmbedded: result.alreadyEmbedded,
                        newlyProcessed: result.newlyProcessed,
                        failedCount: result.failed.length,
                    })
                    if (result.failed.length > 0) {
                        logger.warn('部分材料处理失败', { failed: result.failed })
                    }
                    await emitter.finalize()
                } catch (error) {
                    logger.error('材料预处理中间件异常，继续启动 Agent', { caseId, error })
                }
            }
```

并把文件顶部 import 区调整为（删除不再用到的 `createCustomEventEmitter` / `SSECustomEventType` / `PrepareMaterial*` 类型 import、`MaterialReadinessSnapshot` 若仅此处用也删）：

```ts
import { createMiddleware } from "langchain"
import { ensureMaterialsReadyService } from "~~/server/services/material/materialPipeline.service"
import { createMaterialPrepareEmitter } from "~~/server/agents/_shared/material-prepare/materialPrepareProgress"
```

- [ ] **Step 2: 类型检查**

Run: `bun run typecheck`
Expected: 通过（无未使用 import 报错）。

- [ ] **Step 3: 跑案件分析回归测试**

Run: `npx vitest run tests/server/integration/caseAnalysis.test.ts`
Expected: PASS（确认案件材料预处理未被破坏）。

> 若该集成测试在全量负载外单独跑偶发 `database ls_test_wN does not exist`，重试单文件一次确认是环境抖动而非真实回归。

- [ ] **Step 4: 提交**

```bash
git add server/agents/_shared/case-context/caseProcessMaterial.middleware.ts
git commit -m "refactor(agents): caseProcessMaterial 中间件复用共享进度辅助"
```

---

## Task 12: 通用问答材料预处理中间件

**Files:**
- Create: `server/agents/legal-assistant/assistantProcessMaterial.middleware.ts`
- Test: `tests/server/agents/assistantProcessMaterial.test.ts`（新建）

- [ ] **Step 1: 写失败测试**

创建 `tests/server/agents/assistantProcessMaterial.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

;(globalThis as any).logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }

const ensureBySession = vi.fn()
vi.mock('~~/server/services/material/materialPipeline.service', () => ({
  ensureMaterialsReadyBySessionService: ensureBySession,
}))
vi.mock('~~/server/agents/_shared/material-prepare/materialPrepareProgress', () => ({
  createMaterialPrepareEmitter: () => ({ onProgress: vi.fn(), finalize: vi.fn() }),
}))

import { ATTACH_SENTINEL } from '#shared/utils/attachmentSentinel'
import { assistantProcessMaterialMiddleware } from '~~/server/agents/legal-assistant/assistantProcessMaterial.middleware'

/** 取中间件的 beforeAgent hook（兼容 createMiddleware 的 { hook } 形态） */
function getBeforeAgentHook(mw: any) {
  const ba = mw.beforeAgent
  return typeof ba === 'function' ? ba : ba.hook
}

const humanMsg = (content: string) => ({ getType: () => 'human', content })

describe('assistantProcessMaterialMiddleware', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('最新消息含附件 sentinel 时调用 ensureMaterialsReadyBySessionService', async () => {
    ensureBySession.mockResolvedValue({
      materials: [], totalMaterials: 0, alreadyEmbedded: 0, newlyProcessed: 0, embeddedMap: new Map(), failed: [],
    })
    const mw = assistantProcessMaterialMiddleware(1, 'sess-1', 'run-1')
    const content = `${ATTACH_SENTINEL}${JSON.stringify([{ id: 7 }, { id: 8 }])}\n\n看图`
    await getBeforeAgentHook(mw)({ messages: [humanMsg(content)] })
    expect(ensureBySession).toHaveBeenCalledWith('sess-1', 1, { fileIds: [7, 8] }, expect.any(Function))
  })

  it('无附件时不调用任何处理', async () => {
    const mw = assistantProcessMaterialMiddleware(1, 'sess-2', 'run-2')
    await getBeforeAgentHook(mw)({ messages: [humanMsg('纯文本提问')] })
    expect(ensureBySession).not.toHaveBeenCalled()
  })

  it('ensure 抛错时吞掉异常不阻断 Agent', async () => {
    ensureBySession.mockRejectedValue(new Error('boom'))
    const mw = assistantProcessMaterialMiddleware(1, 'sess-3', 'run-3')
    const content = `${ATTACH_SENTINEL}${JSON.stringify([{ id: 1 }])}`
    await expect(getBeforeAgentHook(mw)({ messages: [humanMsg(content)] })).resolves.not.toThrow()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/server/agents/assistantProcessMaterial.test.ts`
Expected: FAIL（中间件模块不存在）。

- [ ] **Step 3: 实现中间件**

创建 `server/agents/legal-assistant/assistantProcessMaterial.middleware.ts`：

```ts
/**
 * 通用问答材料预处理中间件
 *
 * Agent 启动前（beforeAgent）确定性地解析最新用户消息里的 __ATTACHMENTS__ 附件清单，
 * 按 sessionId 建/复用 case_materials 记录并跑识别+嵌入流水线，期间通过
 * PREPARE_MATERIALS SSE 事件推「材料处理」进度卡片。
 *
 * 与案件域的 caseProcessMaterialMiddleware 同构，区别仅在归属维度（sessionId vs caseId）
 * 与材料来源（解析消息附件 vs 扫案件全量）。
 */
import { createMiddleware } from 'langchain'
import { ensureMaterialsReadyBySessionService } from '~~/server/services/material/materialPipeline.service'
import { createMaterialPrepareEmitter } from '~~/server/agents/_shared/material-prepare/materialPrepareProgress'
import { parseAttachmentFileIds } from '#shared/utils/attachmentSentinel'

/**
 * 从 messages 数组取最后一条 human 消息的纯字符串 content。
 *
 * 类型判定：LangChain 消息实例用 `getType()`（当前公开方法）；`_getType()` 是
 * 旧版兜底。不再判 `m.type`——真实 BaseMessage 实例上 `type` 是泛型参数而非运行时
 * 字段，恒为 undefined（属 dead 分支）。
 */
function lastHumanContent(messages: unknown): string {
    if (!Array.isArray(messages)) return ''
    for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i] as { getType?: () => string; _getType?: () => string; content?: unknown } | undefined
        if (!m) continue
        const type = typeof m.getType === 'function'
            ? m.getType()
            : typeof m._getType === 'function'
                ? m._getType()
                : ''
        if (type === 'human') {
            return typeof m.content === 'string' ? m.content : ''
        }
    }
    return ''
}

export const assistantProcessMaterialMiddleware = (
    userId: number,
    sessionId: string,
    runId: string | null = null,
) => {
    return createMiddleware({
        name: 'AssistantProcessMaterialMiddleware',
        beforeAgent: {
            hook: async (state: { messages?: unknown }) => {
                const fileIds = parseAttachmentFileIds(lastHumanContent(state.messages))
                if (fileIds.length === 0) return  // 本轮无新附件，零开销返回

                const emitter = createMaterialPrepareEmitter(runId, sessionId)
                try {
                    const result = await ensureMaterialsReadyBySessionService(
                        sessionId,
                        userId,
                        { fileIds },
                        emitter.onProgress,
                    )
                    logger.info('通用问答材料预处理完成', {
                        sessionId,
                        totalMaterials: result.totalMaterials,
                        newlyProcessed: result.newlyProcessed,
                        failedCount: result.failed.length,
                    })
                    if (result.failed.length > 0) {
                        logger.warn('通用问答部分材料处理失败', { sessionId, failed: result.failed })
                    }
                    await emitter.finalize()
                } catch (error) {
                    logger.error('通用问答材料预处理中间件异常，继续启动 Agent', { sessionId, error })
                }
            },
        },
    })
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/server/agents/assistantProcessMaterial.test.ts`
Expected: PASS（3 项）。

- [ ] **Step 5: 验证前端「材料处理」卡片与 scope 无关（确认无需改前端）**

spec §8 与本计划假设：前端 `useStreamChat` 已能据 `PREPARE_MATERIALS` 事件合成「材料处理」卡片，通用问答 scope 复用此能力无需改前端。**核实该假设**——读 `app/composables/useStreamChat.ts` 中处理 `prepare_materials` / 合成 `process_materials` 工具卡片的逻辑（约 470-506 行），确认它只依赖事件 payload、不按 case/assistant scope 分流。

Run: `grep -n "prepare_materials\|PREPARE_MATERIALS\|caseId\|scope" app/composables/useStreamChat.ts | sed -n '1,40p'`
Expected: `prepare_materials` 合成卡片逻辑不含 scope/caseId 判分。若发现确实按 scope 分流——停下，把"前端适配"补为新任务后再继续。

- [ ] **Step 6: 提交**

```bash
git add server/agents/legal-assistant/assistantProcessMaterial.middleware.ts tests/server/agents/assistantProcessMaterial.test.ts
git commit -m "feat(agents): 新增通用问答材料预处理中间件"
```

---

## Task 13: 把中间件挂载到 legal-assistant Agent

**Files:**
- Modify: `server/services/agent-platform/middleware/types.ts`（`MIDDLEWARE_NAMES`）
- Modify: `server/agents/legal-assistant/agent.config.ts`

- [ ] **Step 1: `MIDDLEWARE_NAMES` 新增 `ASSISTANT_PROCESS_MATERIAL`**

`MIDDLEWARE_NAMES.PROCESS_MATERIAL` 的字面量是 `'caseProcessMaterial'`（案件域专用）。通用问答中间件复用该名会让日志显示 `caseProcessMaterial`、语义错位。在 `server/services/agent-platform/middleware/types.ts` 的 `MIDDLEWARE_NAMES` 里、`PROCESS_MATERIAL` 那行之后加：

```ts
    ASSISTANT_PROCESS_MATERIAL: 'assistantProcessMaterial',
```

（`MIDDLEWARE_PRIORITY` 不新增——通用问答中间件复用 `PROCESS_MATERIAL: 10` 优先级即可，priority 仅决定栈内排序，与名称无关。）

- [ ] **Step 2: 给 `defineDomainAgent` 加 `customMiddlewares`**

把 `legal-assistant/agent.config.ts` 的 `defineDomainAgent({...})` 调用替换为：

```ts
import { defineDomainAgent } from '~~/server/services/agent-platform/factory/defineDomainAgent'
import { SessionScope } from '#shared/types/agentEvent'
import {
    MIDDLEWARE_PRIORITY,
    MIDDLEWARE_NAMES,
} from '~~/server/services/agent-platform/middleware/types'
import { assistantProcessMaterialMiddleware } from '~~/server/agents/legal-assistant/assistantProcessMaterial.middleware'

export const legalAssistantAgent = defineDomainAgent({
    scope: SessionScope.ASSISTANT,
    agentType: 'createAgent',
    nodeName: 'assistantMain',
    description: '通用问答（assistantMain 节点）',

    /**
     * 业务私有中间件：
     * - assistantProcessMaterial（priority=PROCESS_MATERIAL=10）：Agent 启动前解析用户
     *   上传附件、按会话建材料并跑识别流水线，让 process_materials /
     *   search_case_materials 可读到内容。
     */
    customMiddlewares: async (ctx) => [
        {
            middleware: assistantProcessMaterialMiddleware(ctx.userId, ctx.sessionId, ctx.runId),
            priority: MIDDLEWARE_PRIORITY.PROCESS_MATERIAL,
            name: MIDDLEWARE_NAMES.ASSISTANT_PROCESS_MATERIAL,
        },
    ],
})
```

> 保留文件原有的顶部注释块。

- [ ] **Step 3: 类型检查**

Run: `bun run typecheck`
Expected: 通过。

- [ ] **Step 4: 提交**

```bash
git add server/services/agent-platform/middleware/types.ts server/agents/legal-assistant/agent.config.ts
git commit -m "feat(agents): legal-assistant 挂载材料预处理中间件"
```

---

## Task 14: 删除会话时级联软删材料

**背景:** 通用问答会话删除后，其归属的 `case_materials` 记录应一并软删，避免游离数据。

**Files:**
- Modify: `server/services/assistant/assistantSession.dao.ts:133-150`
- Test: `tests/server/assistant/assistantSessionDelete.test.ts`（新建）

- [ ] **Step 1: 写失败测试**

创建 `tests/server/assistant/assistantSessionDelete.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { prisma } from '~~/server/utils/db'
import { createMaterialDao, findMaterialsBySessionIdDao } from '~~/server/services/material/material.dao'
import { softDeleteAssistantSessionDAO } from '~~/server/services/assistant/assistantSession.dao'

describe('softDeleteAssistantSessionDAO 级联软删材料', () => {
  it('删除会话后该会话材料 deletedAt 被置上', async () => {
    const userId = 1
    const sessionId = `sess-del-${Date.now()}`
    await prisma.caseSessions.create({
      data: { sessionId, scope: 'assistant', userId, status: 1, type: 1 },
    })
    await createMaterialDao({ sessionId, name: 'M', type: 3 })

    const r = await softDeleteAssistantSessionDAO(sessionId, userId)
    expect(r.success).toBe(true)
    expect(await findMaterialsBySessionIdDao(sessionId)).toEqual([])
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/server/assistant/assistantSessionDelete.test.ts`
Expected: FAIL（材料未被级联软删，`findMaterialsBySessionIdDao` 仍返回 1 条）。

- [ ] **Step 3: 在 DAO 里加级联软删**

把 `assistantSession.dao.ts` 的 `softDeleteAssistantSessionDAO` 替换为：

```ts
export async function softDeleteAssistantSessionDAO(
    sessionId: string,
    userId: number,
): Promise<{ success: boolean; error?: string }> {
    return prisma.$transaction(async (tx) => {
        const result = await tx.caseSessions.updateMany({
            where: { sessionId, scope: 'assistant', userId, deletedAt: null },
            data: { deletedAt: new Date() },
        })
        if (result.count === 0) {
            return { success: false, error: '会话不存在或无权操作' }
        }
        // 级联软删该会话归属的材料（通用问答上传的文件）
        await tx.caseMaterials.updateMany({
            where: { sessionId, deletedAt: null },
            data: { deletedAt: new Date() },
        })
        return { success: true }
    })
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/server/assistant/assistantSessionDelete.test.ts`
Expected: PASS（1 项）。

- [ ] **Step 5: 提交**

```bash
git add server/services/assistant/assistantSession.dao.ts tests/server/assistant/assistantSessionDelete.test.ts
git commit -m "feat(assistant): 删除通用问答会话时级联软删其材料"
```

---

## Task 15: 更新 `assistantMain` 系统提示词

**背景:** 材料处理已由中间件确定性完成，提示词只需让模型知道"用户上传的材料已自动识别，用 `process_materials` 读取、`search_case_materials` 检索"。属数据级变更：改 dev 库 + 同步 `seedData.sql`，不写 migration。

**Files:**
- Modify: dev 数据库 `prompts` 表中**启用的** `assistantMain_system` 行
- Modify: `prisma/seeds/seedData.sql`（同一行的 INSERT）

> ⚠️ `seedData.sql` 里 `assistantMain_system` 有**两行**：`id=18`（title 含 `v1`）与 `id=49`（title 无 v1、`version='v5'`、`status=1`）。`node_prompts`(node_id=15) 按 **name** 关联，运行时取 `status=1` 的那条。**先确认哪条 `status=1`**——经核查为 `id=49`（v5）；若实施时数据已变，以 dev 库 `SELECT id,version,status FROM prompts WHERE name='assistantMain_system'` 实际结果为准，改启用的那条。下文 Step 1-3 的"id=49"均指"启用行"。

- [ ] **Step 1: 定稿提示词改动**

在启用行（id=49）内容的「能力边界」工具清单里，把 `process_materials` / `search_case_materials` 两条描述明确为通用问答语境：

- `process_materials：读取用户在本对话中上传的材料内容（图片/文档/音频已自动识别，调用即可获取全文或摘要）`
- `search_case_materials：在本对话已上传的材料里按关键字/语义检索片段`

并在「工具调用规则」区补一条：

`- 用户上传文件后，材料会被自动识别，无需你做额外处理。需要材料内容时直接调用 process_materials；材料较多或文档较长时用 search_case_materials 按需检索。`

- [ ] **Step 2: 改 dev 库**

用 `prisma studio`（`bun run prisma:studio`）或直接连 dev 库，把 `prompts` 表启用行（id=49）的 `content` 改成 Step 1 定稿内容。

- [ ] **Step 3: 同步 `seedData.sql`**

在 `prisma/seeds/seedData.sql` 里定位启用行的 `INSERT INTO "public"."prompts" ... VALUES (49, 'assistantMain_system', ...)`，把其 `content` 字段值改成与 dev 库一致的定稿内容。**只改这一条 INSERT 的 VALUES，不动 id=18 那行，不新增 UPDATE 语句。**

- [ ] **Step 4: 提交**

```bash
git add prisma/seeds/seedData.sql
git commit -m "docs(prompts): assistantMain 提示词明确通用问答材料工具用法"
```

---

## Task 16: 端到端验证

**Files:** 无代码改动，纯验证。

- [ ] **Step 1: 运行 simplify 技能优化本次新增/改动代码**

按项目规约（CLAUDE.md「每次完成编码后都使用 simplify 技能优化代码」），对本计划新增/修改的文件跑一遍 `simplify`，按其结论修正。

- [ ] **Step 2: 全量类型检查**

Run: `bun run typecheck`
Expected: 通过，0 error。

- [ ] **Step 3: 跑相关测试集**

Run: `npx vitest run tests/shared/utils/attachmentSentinel.test.ts tests/server/material tests/server/agent-platform/tools tests/server/agents tests/server/assistant`
Expected: 全部 PASS。

- [ ] **Step 4: 手动 E2E（chrome-devtools）**

启动 `bun dev`，用 chrome-devtools 走通用问答：
1. 新建一个通用问答对话。
2. 上传一张含文字的图片，提问"这张图片写了什么"。
   - 预期：出现「材料处理」进度卡片；助手回答能复述图片中的文字，**不再出现** `process_materials 工具需要 caseId 或 draftId` 报错。
3. 同一对话下一轮，不重传文件，追问图片细节。
   - 预期：助手仍能引用该图片内容（会话级记忆生效）。
4. 上传一份多页 PDF，问一个只在某页出现的细节。
   - 预期：助手通过 `search_case_materials` 检索到对应片段并正确回答。
5. 上传一个音频文件（验证 ASR 路径），问其中提到的内容。
   - 预期：助手能复述音频转写出的关键信息（spec 目标含音频材料，须实测 ASR 链路）。
6. 删除该对话后，确认 dev 库中对应 `case_materials` 行 `deleted_at` 已置上。

- [ ] **Step 5: 最终提交（如 simplify 有改动）**

```bash
git add -A
git commit -m "chore(assistant): 通用问答读文件能力 simplify 优化与收尾"
```

---

## 实施完成标准

- [ ] 通用问答上传图片/文档/音频后，助手能读到内容，无工具报错。
- [ ] 上传的文件在整个对话内多轮可用。
- [ ] `case_materials` 多一个 `sessionId` 归属维度；未来「从对话创建案件」可用一句 `UPDATE` 迁移材料。
- [ ] 案件分析 / 文书生成两个 scope 的既有行为不受影响（回归测试通过）。
- [ ] 新增代码测试覆盖；`bun run typecheck` 全绿。
