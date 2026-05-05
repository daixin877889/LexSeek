# 文书 Agent 与工具架构修正 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `documentMain` 从"被工具嵌套调用的子 Agent"修正为"平级主 Agent",把 `draft_document` 工具拆成 3 个无会话纯函数(`recommend_template` / `save_document_draft` / `update_document_draft`),三个 Agent(caseMain / assistantMain / documentMain)都挂 `legal-document-writer` skill,各自闭环工作。

**Architecture:** Agent 通过 ReAct 循环用 skill 写作规范方法论 + 自己的对话上下文产出每个 placeholder 字段值,主动调工具落库;工具不嵌套 Agent,只做明确的 IO。三入口共享同一组工具,通过 `draftId` 共享当前草稿状态。

**Tech Stack:** TypeScript / Nuxt 4 (Nitro) / LangChain (createAgent / interrupt / toolStrategy 删除) / LangGraph PostgresSaver checkpointer / deepagents skill middleware / Prisma / Vitest

**关联 spec:** `docs/superpowers/specs/2026-05-05-document-agent-tool-refactor-design.md`

**分支策略:** 在新分支 `feature/document-agent-tool-refactor` 上推进,4 个 Stage 全部完成后一次性 PR 合 dev。项目尚未生产部署,无灰度/回滚 SOP。

---

## File Structure

### 新建文件(3 个工具 + 1 个 e2e 测试 + 1 个维护脚本)

| 文件 | 职责 |
|---|---|
| `server/services/agent-platform/tools/recommendTemplate.tool.ts` | 模板推荐工具,内部 interrupt 弹卡片让用户选模板,resume 后返回 templateId + placeholders |
| `server/services/agent-platform/tools/saveDocumentDraft.tool.ts` | 创建草稿并写字段值,返回 draftId/href |
| `server/services/agent-platform/tools/updateDocumentDraft.tool.ts` | 增量更新草稿字段值 |
| `tests/server/agent-platform/tools/recommendTemplate.test.ts` | 工具单测 |
| `tests/server/agent-platform/tools/saveDocumentDraft.test.ts` | 工具单测 |
| `tests/server/agent-platform/tools/updateDocumentDraft.test.ts` | 工具单测 |
| `tests/e2e/document-draft-via-assistant.spec.ts` | 端到端测试 |
| `server/scripts/migrateFillingDrafts.ts` | 一次性数据修复脚本(filling → failed) |

### 修改文件(8 个)

| 文件 | 改动 |
|---|---|
| `server/services/agent-platform/tools/index.ts` | 删 draft_document 注册;加 3 个新工具 |
| `server/services/workflow/middleware/index.ts` | 删 draftResultPersistenceMiddleware export 行 |
| `server/services/workflow/agents/documentMainAgent.ts` | 删 toolStrategy / responseFormat / draftResultPersistence;新工具列表;系统 prompt 注入 draft 状态 |
| `server/agents/document/agent.config.ts` | description 描述更新 |
| `server/services/node/prompt.service.ts` | PromptRenderContext 接口扩展 4 个字段 |
| `server/agents/document/documentDraft.service.ts` | patchDraftService 加 metadata 可选参数 |
| `server/services/workflow/repairOrphanToolUse.ts` | 几条 SQL 加 `langgraph.` schema 前缀 |
| `prisma/seeds/seedData.sql` | nodes.tools / node_skills / prompts 字段值同步 |
| `tests/server/workflow/agents/documentMainAgent.test.ts` | 重写,删除 toolStrategy mock |
| `tests/server/assistant/document/documentDraft.service.test.ts` | 删 buildDraftSchema mock |

### 删除文件(8 个,5 个源 + 3 个测试)

| 文件 | 删除原因 |
|---|---|
| `server/services/agent-platform/tools/draftDocument.tool.ts` | 反模式工具被 3 工具替代 |
| `server/agents/document/middleware/draftResultPersistence.middleware.ts` | toolStrategy 取消后无用 |
| `server/services/workflow/middleware/draftResultPersistence.middleware.ts` | re-export shim |
| `server/agents/document/draftSchema.builder.ts` | toolStrategy schema 构造器无用 |
| `server/services/assistant/document/draftSchema.builder.ts` | re-export shim |
| `tests/server/assistant/document/draftResultPersistence.middleware.test.ts` | 测试目标删除 |
| `tests/server/workflow/middleware/draftResultPersistence.test.ts` | 同上 |
| `tests/server/assistant/document/draftSchema.builder.test.ts` | 测试目标删除 |

---

## Stage 0:前置 spike(2 个 task)

### Task 0.0:创建分支

**Files:** 无

- [ ] **Step 1:在 dev 分支拉新分支**

```bash
git checkout dev
git pull origin dev
git checkout -b feature/document-agent-tool-refactor
git status
```

Expected: `On branch feature/document-agent-tool-refactor`,工作区干净。

---

### Task 0.1:spike C1 — 验证 seedData.sql 修改不会触发 prisma drift

**目的**:确认数据级变更(改 INSERT 字段值)不会让 `prisma migrate status` 报 drift。

**Files:** 临时改 `prisma/seeds/seedData.sql`(验证完恢复)

- [ ] **Step 1:跑 baseline migrate status**

```bash
bun run prisma:generate
DATABASE_URL='postgresql://daixin@localhost:5432/ls_new?TimeZone=UTC' npx prisma migrate status
```

Expected: 输出含 `Database schema is up to date!`(或类似无 drift 提示)。

- [ ] **Step 2:在 seedData.sql 临时改一行**

打开 `prisma/seeds/seedData.sql` 找到 `INSERT INTO "public"."nodes"` id=17(documentMain)那行,把末尾 `'f', 'f');` 临时改成 `'f', 't');`(改 thinking_enabled 字段值)。

- [ ] **Step 3:把改动应用到 dev 库**

```bash
docker exec postgres-postgres-1 psql -U daixin -d ls_new -c "UPDATE nodes SET thinking_enabled = true WHERE id = 17;"
```

Expected: `UPDATE 1`。

- [ ] **Step 4:跑 migrate status 确认无 drift**

```bash
DATABASE_URL='postgresql://daixin@localhost:5432/ls_new?TimeZone=UTC' npx prisma migrate status
```

Expected: 仍然显示 `Database schema is up to date!`,无 drift 提示。**这就证明数据级变更不会触发 schema drift**。

- [ ] **Step 5:回滚临时改动**

```bash
docker exec postgres-postgres-1 psql -U daixin -d ls_new -c "UPDATE nodes SET thinking_enabled = false WHERE id = 17;"
git checkout prisma/seeds/seedData.sql
```

Expected: dev 库 `thinking_enabled=false` 恢复,seedData.sql 工作区无变化。

- [ ] **Step 6:Commit spike 验证记录**

```bash
git commit --allow-empty -m "spike(C1): 验证 seedData.sql 修改不触发 prisma drift,通过"
```

---

> **spike C3 已合并到 Task 1.4 实现注释**(原独立任务删除)。toolCallId 双层包装解包逻辑直接抄 `draftDocument.tool.ts:99-112` + `reviewContract.tool.ts` 同款机制,实施时在 Task 1.4 代码注释里对照即可。
>
> spike C2(systemPrompt 跨轮次 values 感知)在 Stage 2 完成 documentMain 重写后才能跑,放到 Task 2.12 内做。

---

## Stage 1:新建 3 个工具

### Task 1.0:shared/types/agentEvent.ts 加 DRAFT_UPDATED 枚举值

**目的**:在写新工具前先把类型加好,避免 Task 1.2/1.3 实现时 import 失败。

**Files:**
- Modify: `shared/types/agentEvent.ts`

- [ ] **Step 1:查看现有 SSECustomEventType 定义**

```bash
grep -n "DRAFT_SAVED\|SSECustomEventType\|enum SSECustomEventType" /Users/daixin/work/dev/LexSeek/LexSeek/shared/types/agentEvent.ts
```

Expected: 看到 `DRAFT_SAVED = 'draft_saved'`(行 71 附近)和 `[SSECustomEventType.DRAFT_SAVED]: DraftSavedPayload`(行 218 附近)。

- [ ] **Step 2:加 DRAFT_UPDATED 枚举值 + payload 类型映射**

修改 `shared/types/agentEvent.ts`,在 `SSECustomEventType` 枚举里 `DRAFT_SAVED = 'draft_saved'` 那行下面加:

```typescript
DRAFT_UPDATED = 'draft_updated',
```

在 payload 类型映射的 interface(`SSECustomEventPayloadMap` 或类似名字)里 `DRAFT_SAVED` 对应行下面加:

```typescript
[SSECustomEventType.DRAFT_UPDATED]: DraftUpdatedPayload
```

并在文件中合适位置(其他 Payload 类型附近)新增类型定义:

```typescript
/** DRAFT_UPDATED event payload(update_document_draft 工具发) */
export interface DraftUpdatedPayload {
    draftId: number
    changedFields: string[]
    summary: string
}
```

- [ ] **Step 3:跑 typecheck**

```bash
bun run typecheck 2>&1 | tail -10
```

Expected: 零错。

- [ ] **Step 4:Commit**

```bash
git add shared/types/agentEvent.ts
git commit -m "feat(types): SSECustomEventType 加 DRAFT_UPDATED + DraftUpdatedPayload"
```

---

### Task 1.1:扩展 patchDraftService 接口加 metadata 参数

**目的**:让 `update_document_draft` 工具能一次调用同时改 values + metadata.suggestions,不用拆两步。

**Files:**
- Modify: `server/agents/document/documentDraft.service.ts:158-196`

- [ ] **Step 1:写失败测试**

修改 `tests/server/assistant/document/documentDraft.service.test.ts`,在合适位置加新测试用例(注意:这个测试文件依赖现有 mock 套路,先看现有 patchDraftService 测试如何写,然后追加):

```typescript
describe('patchDraftService - metadata 参数', () => {
    it('传入 metadata 时一并写入 draft.metadata 字段', async () => {
        // 假设已有 user/draft/template fixture
        const result = await patchDraftService(userId, draftId, {
            values: { 原告: '张三' },
            metadata: { suggestions: { 被告: '请补充被告住址' } },
        })
        expect(result).toHaveProperty('draft')
        expect((result as any).draft.values.原告).toBe('张三')
        expect((result as any).draft.metadata.suggestions.被告).toBe('请补充被告住址')
    })

    it('不传 metadata 时不修改 draft.metadata', async () => {
        const result = await patchDraftService(userId, draftId, {
            values: { 原告: '李四' },
        })
        // 不应改 metadata,保持原值
        expect((result as any).draft.metadata).toBeNull() // or 原值
    })
})
```

- [ ] **Step 2:跑测试确认失败**

```bash
npx vitest run tests/server/assistant/document/documentDraft.service.test.ts -t "metadata 参数" --reporter=verbose
```

Expected: FAIL,因为 patchDraftService 当前不接 metadata 参数。

- [ ] **Step 3:实现 metadata 支持**

修改 `server/agents/document/documentDraft.service.ts:158-196`:

```typescript
export async function patchDraftService(
    userId: number,
    draftId: number,
    input: {
        values: Record<string, string | null>
        metadata?: Record<string, unknown>  // 新增可选参数
    },
): Promise<{ draft: any } | ServiceError> {
    const draft = await getDocumentDraftDAO(draftId)
    if (!draft) {
        return { error: '草稿不存在', code: 404 }
    }

    if (draft.userId !== userId) {
        return { error: '无权修改此草稿', code: 403 }
    }

    if ((draft.status as DocumentDraftStatus) === 'drafting' || (draft.status as DocumentDraftStatus) === 'filling') {
        return { error: '草稿正在生成中,请稍后再修改', code: 409 }
    }

    const template = await getDocumentTemplateDAO(draft.templateId)
    const rawPlaceholders = Array.isArray(template?.placeholders) ? template.placeholders as Array<{ name: unknown }> : []
    const allowedKeys = new Set(rawPlaceholders.map(p => String(p.name ?? '')))

    const filteredValues: Record<string, string | null> = {}
    for (const [key, value] of Object.entries(input.values)) {
        if (allowedKeys.has(key)) {
            filteredValues[key] = value
        }
    }

    const existingValues = (draft.values as Record<string, string | null>) ?? {}
    const mergedValues = { ...existingValues, ...filteredValues }

    // 构造 update 入参,可选写入 metadata
    const updateData: { values: any; metadata?: any } = {
        values: mergedValues as any,
    }
    if (input.metadata !== undefined) {
        // 合并 metadata 而非覆盖(保留 existingDraft.metadata 中其他键)
        const existingMetadata = (draft.metadata as Record<string, unknown> | null) ?? {}
        updateData.metadata = { ...existingMetadata, ...input.metadata }
    }

    const updated = await updateDocumentDraftDAO(draftId, updateData as any)

    return { draft: updated }
}
```

- [ ] **Step 4:跑测试确认通过**

```bash
npx vitest run tests/server/assistant/document/documentDraft.service.test.ts -t "metadata 参数" --reporter=verbose
```

Expected: PASS。

- [ ] **Step 5:跑全套 patchDraftService 测试确认无回归**

```bash
npx vitest run tests/server/assistant/document/documentDraft.service.test.ts -t "patchDraftService" --reporter=verbose
```

Expected: 全部 PASS。

- [ ] **Step 6:Commit**

```bash
git add server/agents/document/documentDraft.service.ts tests/server/assistant/document/documentDraft.service.test.ts
git commit -m "feat(document): patchDraftService 加 metadata 可选参数,支持工具一次写入 values+metadata"
```

---

### Task 1.2:新建 saveDocumentDraft.tool.ts

**Files:**
- Create: `server/services/agent-platform/tools/saveDocumentDraft.tool.ts`
- Create: `tests/server/agent-platform/tools/saveDocumentDraft.test.ts`

- [ ] **Step 1:写失败测试**

创建 `tests/server/agent-platform/tools/saveDocumentDraft.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock 依赖
vi.mock('~~/server/agents/document/documentDraft.service', () => ({
    createDraftService: vi.fn(),
}))
vi.mock('~~/server/agents/document/documentDraft.dao', () => ({
    updateDocumentDraftDAO: vi.fn(),
    getDocumentDraftDAO: vi.fn(),
}))
vi.mock('~~/server/agents/document/documentDraftSnapshot.service', () => ({
    createSnapshotService: vi.fn(),
}))
vi.mock('~~/server/agents/document/documentDraft.service', async (orig) => {
    const real = await orig()
    return {
        ...real as object,
        applyAITitleIfAllowedService: vi.fn(),
    }
})
vi.mock('~~/server/services/material/materialPipeline.service', () => ({
    ensureMaterialsReadyForDraftService: vi.fn(),
}))
vi.mock('~~/server/services/agent/agentEventBridge', () => ({
    publishCustomEvent: vi.fn(),
}))

import { createTool, toolDefinition } from '~~/server/services/agent-platform/tools/saveDocumentDraft.tool'
import { createDraftService } from '~~/server/agents/document/documentDraft.service'
import { updateDocumentDraftDAO } from '~~/server/agents/document/documentDraft.dao'
import { publishCustomEvent } from '~~/server/services/agent/agentEventBridge'

describe('save_document_draft tool', () => {
    beforeEach(() => {
        vi.resetAllMocks()
    })

    it('toolDefinition 有正确的 name 和 schema', () => {
        expect(toolDefinition.name).toBe('save_document_draft')
        expect(toolDefinition.schema).toBeDefined()
    })

    it('成功路径:创建 draft + 写 values + 发 SSE event', async () => {
        ;(createDraftService as any).mockResolvedValue({ draftId: 100, sessionId: 'session-100' })
        ;(updateDocumentDraftDAO as any).mockResolvedValue({ id: 100 })
        ;(publishCustomEvent as any).mockResolvedValue(undefined)

        const tool = createTool({ userId: 1, sessionId: 'sess-x', runId: 'run-x', caseId: 5 })
        const result = await tool.invoke({
            templateId: 1,
            fieldValues: { 原告: '张三', 被告: '李四' },
        })

        const parsed = JSON.parse(result as string)
        expect(parsed.success).toBe(true)
        expect(parsed.draftId).toBe(100)
        expect(parsed.sessionId).toBe('session-100')
        expect(parsed.href).toContain('/dashboard/document/drafts/100')

        // 验证 createDraftService 调用
        expect(createDraftService).toHaveBeenCalledWith(expect.objectContaining({
            userId: 1,
            templateId: 1,
            caseId: 5,
            enqueueAgentRun: false,
        }))

        // 验证立即 update 写 values + status='ready'
        expect(updateDocumentDraftDAO).toHaveBeenCalledWith(100, expect.objectContaining({
            values: expect.any(Object),
            status: 'ready',
        }))

        // 验证 SSE event 用 await 模式发(返回值已 resolve)
        expect(publishCustomEvent).toHaveBeenCalledWith(expect.objectContaining({
            name: 'draft_saved', // SSECustomEventType.DRAFT_SAVED 枚举值
        }))
    })

    it('校验失败:fieldValues 全部为 null 拒绝', async () => {
        const tool = createTool({ userId: 1, sessionId: 'sess-x' })
        const result = await tool.invoke({
            templateId: 1,
            fieldValues: { 原告: null, 被告: null },
        })

        const parsed = JSON.parse(result as string)
        expect(parsed.success).toBe(false)
        expect(parsed.error).toContain('至少一个非 null')
    })

    it('createDraftService 失败时 throw 让 LLM 重试', async () => {
        ;(createDraftService as any).mockResolvedValue({ error: '模板不存在', code: 404 })

        const tool = createTool({ userId: 1, sessionId: 'sess-x' })
        const result = await tool.invoke({
            templateId: 999,
            fieldValues: { 原告: '张三' },
        })

        const parsed = JSON.parse(result as string)
        expect(parsed.success).toBe(false)
        expect(parsed.error).toContain('模板不存在')
    })

    it('SSE event 必须 await(检查 mock 调用是 await 后才返回)', async () => {
        let publishResolved = false
        ;(createDraftService as any).mockResolvedValue({ draftId: 100, sessionId: 'session-100' })
        ;(updateDocumentDraftDAO as any).mockResolvedValue({ id: 100 })
        ;(publishCustomEvent as any).mockImplementation(async () => {
            await new Promise(r => setTimeout(r, 10))
            publishResolved = true
        })

        const tool = createTool({ userId: 1, sessionId: 'sess-x', runId: 'run-x' })
        await tool.invoke({
            templateId: 1,
            fieldValues: { 原告: '张三' },
        })

        // tool 返回时 publishCustomEvent 应已 resolve
        expect(publishResolved).toBe(true)
    })
})
```

- [ ] **Step 2:跑测试确认失败**

```bash
npx vitest run tests/server/agent-platform/tools/saveDocumentDraft.test.ts --reporter=verbose
```

Expected: FAIL `Cannot find module '...saveDocumentDraft.tool'`。

- [ ] **Step 3:实现 saveDocumentDraft.tool.ts**

创建 `server/services/agent-platform/tools/saveDocumentDraft.tool.ts`:

```typescript
/**
 * save_document_draft 工具
 *
 * 三个 Agent(caseMain / assistantMain / documentMain)调此工具创建并落库文书草稿。
 * 工具接收已在 Agent 端用 skill + 对话上下文产出的字段值,写到 DB,返回 draftId/href。
 *
 * 不嵌套调用任何 Agent;不依赖 toolStrategy / draftResultPersistence 中间件。
 *
 * @see docs/superpowers/specs/2026-05-05-document-agent-tool-refactor-design.md §4.2
 */

import { z } from 'zod'
import type { ToolContext, ToolDefinition } from './types'
import { createSimpleTool } from './types'
import { SSECustomEventType } from '#shared/types/agentEvent'
import { publishCustomEvent } from '~~/server/services/agent/agentEventBridge'

const schema = z.object({
    templateId: z.number().int().positive().describe('模板 ID,从 recommend_template 工具的返回值取'),
    fieldValues: z.record(z.string(), z.string().nullable()).describe(
        '占位符名 → 值的映射;不知道的字段填 null,不要编造。至少一个字段非 null。',
    ),
    suggestions: z.record(z.string(), z.string()).optional().describe(
        '建议用户补充的内容(占位符名 → 一句问句),会写入 metadata.suggestions',
    ),
    aiTitle: z.string().min(1).max(200).optional().describe(
        'AI 推断的草稿标题,若用户未手动改过标题则会自动应用',
    ),
    sourceText: z.string().optional().describe(
        '用户原始诉求文字,会写到 draft.sourceRef.text 留档(后续 documentMain 重启会话时可读为初始上下文)',
    ),
    fileIds: z.array(z.number().int().positive()).optional().describe(
        '关联的 OSS 材料文件 ID 列表(若用户上传过材料)',
    ),
})

export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'save_document_draft',
    description: '创建文书草稿并写入字段值。需先调 recommend_template 拿 templateId 和字段清单。'
        + '工具会原子化创建 draft + 落库字段 + 写快照 + 关联材料 + 发 SSE 通知,返回 draftId/href 给主 Agent 引导用户跳转。',
    schema,
}

export const createTool = createSimpleTool(
    toolDefinition,
    async (input, ctx) => {
        const { userId, sessionId, runId = '', caseId } = ctx
        if (!userId || !sessionId) {
            throw new Error('save_document_draft: ToolContext 缺少 userId/sessionId')
        }

        // 校验:fieldValues 至少一个非 null
        const hasAnyValue = Object.values(input.fieldValues).some(v => v !== null && v !== '')
        if (!hasAnyValue) {
            return {
                success: false,
                error: 'fieldValues 至少一个非 null:全部为 null 表示 AI 没有产出任何内容,不应创建草稿。'
                    + '若信息不足请向用户提问,等回答后再调本工具。',
            }
        }

        // 1. 创建 draft 记录(enqueueAgentRun: false 表示工具自己写,不入 worker 队列)
        const { createDraftService } = await import('~~/server/agents/document/documentDraft.service')
        const created = await createDraftService({
            userId,
            templateId: input.templateId,
            sourceText: input.sourceText,
            sourceFileIds: input.fileIds,
            caseId: caseId ?? undefined,
            enqueueAgentRun: false,
        })
        if ('error' in created) {
            return { success: false, error: created.error }
        }
        const { draftId, sessionId: subSessionId } = created

        // 2. 立刻写 values + status='ready'(同步事务式)
        const { updateDocumentDraftDAO } = await import('~~/server/agents/document/documentDraft.dao')
        await updateDocumentDraftDAO(draftId, {
            values: input.fieldValues as any,
            metadata: input.suggestions ? { suggestions: input.suggestions } as any : undefined,
            status: 'ready',
        })

        // 3. 创建 'ai-extract' 快照
        try {
            const { createSnapshotService } = await import('~~/server/agents/document/documentDraftSnapshot.service')
            await createSnapshotService(draftId, 'ai-extract', {
                values: input.fieldValues,
                aiTitle: input.aiTitle ?? null,
            })
        }
        catch (err) {
            logger.warn('save_document_draft: 写 ai-extract 快照失败(不阻塞)', { draftId, err })
        }

        // 4. 关联材料(若有 fileIds)
        // 注意:createDraftService 已经处理了 sourceFileIds,这里无需重复

        // 5. 应用 AI 标题(若有 + titleOverridden=false)
        if (input.aiTitle) {
            try {
                const { applyAITitleIfAllowedService } = await import('~~/server/agents/document/documentDraft.service')
                await applyAITitleIfAllowedService(draftId, input.aiTitle)
            }
            catch (err) {
                logger.warn('save_document_draft: 应用 AI 标题失败(不阻塞)', { draftId, err })
            }
        }

        // 6. 计算 summary
        const filledFieldCount = Object.values(input.fieldValues).filter(v => typeof v === 'string' && v.trim()).length
        const totalFields = Object.keys(input.fieldValues).length
        const summary = filledFieldCount > 0
            ? `已自动填写 ${filledFieldCount}/${totalFields} 个字段`
            : '已建好空白草稿,等待用户补充信息'

        // 7. 跳转链接
        const fromParam = caseId ? 'xiaosuo' : 'assistant'
        const href = `/dashboard/document/drafts/${draftId}`
            + `?from=${fromParam}&sessionId=${encodeURIComponent(sessionId)}`
            + (caseId ? `&caseId=${caseId}` : '')

        // 8. 取模板名称用于 summary
        let templateName: string | null = null
        try {
            const { getDocumentTemplateDAO } = await import('~~/server/agents/document/documentTemplate.dao')
            const template = await getDocumentTemplateDAO(input.templateId)
            templateName = template?.name ?? null
        }
        catch { /* 拿不到名字不影响主流程 */ }

        const title = input.aiTitle ?? templateName ?? '未命名文书'

        // 9. await SSE event(agent-platform.md 铁律)
        try {
            await publishCustomEvent({
                type: 'custom_event',
                runId,
                sessionId,
                name: SSECustomEventType.DRAFT_SAVED,
                data: { draftId, summary, title, href },
            })
        }
        catch (err) {
            logger.warn('save_document_draft: publishCustomEvent(DRAFT_SAVED) 失败(不阻塞)', { draftId, err })
        }

        // 10. 返回 JSON 给 LLM
        return {
            success: true,
            draftId,
            sessionId: subSessionId,
            href,
            templateName,
            filledFieldCount,
            totalFields,
            summary,
        }
    },
    { errorLabel: '保存文书草稿' },
)
```

- [ ] **Step 4:跑测试确认通过**

```bash
npx vitest run tests/server/agent-platform/tools/saveDocumentDraft.test.ts --reporter=verbose
```

Expected: 全部 PASS。

- [ ] **Step 5:Commit**

```bash
git add server/services/agent-platform/tools/saveDocumentDraft.tool.ts tests/server/agent-platform/tools/saveDocumentDraft.test.ts
git commit -m "feat(agent-platform): 新增 save_document_draft 纯函数工具"
```

---

### Task 1.3:新建 updateDocumentDraft.tool.ts

**Files:**
- Create: `server/services/agent-platform/tools/updateDocumentDraft.tool.ts`
- Create: `tests/server/agent-platform/tools/updateDocumentDraft.test.ts`

- [ ] **Step 1:写失败测试**

创建 `tests/server/agent-platform/tools/updateDocumentDraft.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('~~/server/agents/document/documentDraft.service', () => ({
    patchDraftService: vi.fn(),
    applyAITitleIfAllowedService: vi.fn(),
}))
vi.mock('~~/server/services/agent/agentEventBridge', () => ({
    publishCustomEvent: vi.fn(),
}))

import { createTool, toolDefinition } from '~~/server/services/agent-platform/tools/updateDocumentDraft.tool'
import { patchDraftService, applyAITitleIfAllowedService } from '~~/server/agents/document/documentDraft.service'
import { publishCustomEvent } from '~~/server/services/agent/agentEventBridge'

describe('update_document_draft tool', () => {
    beforeEach(() => {
        vi.resetAllMocks()
    })

    it('toolDefinition 有正确的 name 和 schema', () => {
        expect(toolDefinition.name).toBe('update_document_draft')
        expect(toolDefinition.schema).toBeDefined()
    })

    it('成功路径:复用 patchDraftService + 发 SSE event', async () => {
        ;(patchDraftService as any).mockResolvedValue({
            draft: { id: 100, values: { 原告: '张三', 被告: '李四' } },
        })
        ;(publishCustomEvent as any).mockResolvedValue(undefined)

        const tool = createTool({ userId: 1, sessionId: 'sess-x', runId: 'run-x' })
        const result = await tool.invoke({
            draftId: 100,
            fieldUpdates: { 被告: '李四' },
        })

        const parsed = JSON.parse(result as string)
        expect(parsed.success).toBe(true)
        expect(parsed.draftId).toBe(100)
        expect(parsed.changedFields).toContain('被告')

        expect(patchDraftService).toHaveBeenCalledWith(1, 100, expect.objectContaining({
            values: { 被告: '李四' },
        }))

        expect(publishCustomEvent).toHaveBeenCalledWith(expect.objectContaining({
            name: 'draft_updated', // SSECustomEventType.DRAFT_UPDATED 枚举值
        }))
    })

    it('patchDraftService 返回 ServiceError 时 throw', async () => {
        ;(patchDraftService as any).mockResolvedValue({ error: '草稿不存在', code: 404 })

        const tool = createTool({ userId: 1, sessionId: 'sess-x' })
        const result = await tool.invoke({
            draftId: 999,
            fieldUpdates: { 被告: '李四' },
        })

        const parsed = JSON.parse(result as string)
        expect(parsed.success).toBe(false)
        expect(parsed.error).toContain('草稿不存在')
    })

    it('传入 suggestions 时一并写入 metadata', async () => {
        ;(patchDraftService as any).mockResolvedValue({ draft: { id: 100, values: {} } })

        const tool = createTool({ userId: 1, sessionId: 'sess-x' })
        await tool.invoke({
            draftId: 100,
            fieldUpdates: { 被告: '李四' },
            suggestions: { 被告住址: '请补充' },
        })

        expect(patchDraftService).toHaveBeenCalledWith(1, 100, expect.objectContaining({
            metadata: expect.objectContaining({
                suggestions: { 被告住址: '请补充' },
            }),
        }))
    })

    it('传入 aiTitle 时调 applyAITitleIfAllowedService', async () => {
        ;(patchDraftService as any).mockResolvedValue({ draft: { id: 100, values: {} } })
        ;(applyAITitleIfAllowedService as any).mockResolvedValue(true)

        const tool = createTool({ userId: 1, sessionId: 'sess-x' })
        await tool.invoke({
            draftId: 100,
            fieldUpdates: { 被告: '李四' },
            aiTitle: '新标题',
        })

        expect(applyAITitleIfAllowedService).toHaveBeenCalledWith(100, '新标题')
    })
})
```

- [ ] **Step 2:跑测试确认失败**

```bash
npx vitest run tests/server/agent-platform/tools/updateDocumentDraft.test.ts --reporter=verbose
```

Expected: FAIL `Cannot find module`。

- [ ] **Step 3:实现 updateDocumentDraft.tool.ts**

创建 `server/services/agent-platform/tools/updateDocumentDraft.tool.ts`:

```typescript
/**
 * update_document_draft 工具
 *
 * Agent 增量更新已存在草稿的字段值。复用 patchDraftService(server/agents/document/
 * documentDraft.service.ts:158-196)的字段过滤+merge+落库逻辑,工具层只负责 SSE
 * 通知和 aiTitle 应用。
 *
 * @see docs/superpowers/specs/2026-05-05-document-agent-tool-refactor-design.md §4.3
 */

import { z } from 'zod'
import type { ToolContext, ToolDefinition } from './types'
import { createSimpleTool } from './types'
import { SSECustomEventType } from '#shared/types/agentEvent'
import { publishCustomEvent } from '~~/server/services/agent/agentEventBridge'

const schema = z.object({
    draftId: z.number().int().positive().describe('要更新的草稿 ID(从 save_document_draft 的返回值取)'),
    fieldUpdates: z.record(z.string(), z.string().nullable()).describe(
        '只传要改的字段(占位符名 → 新值);超出模板字段范围的会被忽略',
    ),
    suggestions: z.record(z.string(), z.string()).optional().describe(
        '追加/更新建议清单(写到 metadata.suggestions)',
    ),
    aiTitle: z.string().min(1).max(200).optional().describe(
        'AI 推断的新标题,若用户未手动改过则会自动应用',
    ),
})

export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'update_document_draft',
    description: '增量更新已有草稿的字段值。'
        + '用户在对话中提出修改请求(如"被告住址改成 XX")时调此工具,只需传要改的字段,'
        + '其余字段保持不变。会发 DRAFT_UPDATED SSE 通知前端刷新字段表单。',
    schema,
}

export const createTool = createSimpleTool(
    toolDefinition,
    async (input, ctx) => {
        const { userId, sessionId, runId = '' } = ctx
        if (!userId || !sessionId) {
            throw new Error('update_document_draft: ToolContext 缺少 userId/sessionId')
        }

        // 1. 复用 patchDraftService(行 158-196)字段过滤+merge+落库
        const { patchDraftService, applyAITitleIfAllowedService } = await import(
            '~~/server/agents/document/documentDraft.service'
        )
        const patchResult = await patchDraftService(userId, input.draftId, {
            values: input.fieldUpdates,
            metadata: input.suggestions ? { suggestions: input.suggestions } : undefined,
        })

        if ('error' in patchResult) {
            return { success: false, error: patchResult.error }
        }

        const updatedDraft = patchResult.draft

        // 2. 计算实际生效的字段(过滤掉模板范围外的 key)
        const newValues = (updatedDraft.values ?? {}) as Record<string, unknown>
        const changedFields = Object.keys(input.fieldUpdates).filter(k => k in newValues)

        // 3. 应用 AI 标题(若有)
        if (input.aiTitle) {
            try {
                await applyAITitleIfAllowedService(input.draftId, input.aiTitle)
            }
            catch (err) {
                logger.warn('update_document_draft: 应用 AI 标题失败(不阻塞)', { draftId: input.draftId, err })
            }
        }

        // 4. await SSE event(agent-platform.md 铁律)
        try {
            await publishCustomEvent({
                type: 'custom_event',
                runId,
                sessionId,
                name: SSECustomEventType.DRAFT_UPDATED,
                data: {
                    draftId: input.draftId,
                    changedFields,
                    summary: `已更新 ${changedFields.length} 个字段:${changedFields.join('、')}`,
                },
            })
        }
        catch (err) {
            logger.warn('update_document_draft: publishCustomEvent(DRAFT_UPDATED) 失败(不阻塞)', {
                draftId: input.draftId, err,
            })
        }

        return {
            success: true,
            draftId: input.draftId,
            changedFields,
            summary: `已更新 ${changedFields.length} 个字段:${changedFields.join('、')}`,
        }
    },
    { errorLabel: '更新文书草稿' },
)
```

- [ ] **Step 4:跑测试确认通过**

```bash
npx vitest run tests/server/agent-platform/tools/updateDocumentDraft.test.ts --reporter=verbose
```

Expected: 全部 PASS。

- [ ] **Step 5:Commit**

```bash
git add server/services/agent-platform/tools/updateDocumentDraft.tool.ts tests/server/agent-platform/tools/updateDocumentDraft.test.ts
git commit -m "feat(agent-platform): 新增 update_document_draft 工具,复用 patchDraftService 增量改字段"
```

---

### Task 1.4:新建 recommendTemplate.tool.ts

**Files:**
- Create: `server/services/agent-platform/tools/recommendTemplate.tool.ts`
- Create: `tests/server/agent-platform/tools/recommendTemplate.test.ts`

- [ ] **Step 1:写失败测试**

创建 `tests/server/agent-platform/tools/recommendTemplate.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('~~/server/agents/document/templateRecommend.service', () => ({
    recommendDocumentTemplatesService: vi.fn(),
}))
vi.mock('~~/server/agents/document/documentTemplate.dao', () => ({
    getDocumentTemplateDAO: vi.fn(),
}))

const interruptMock = vi.fn()
vi.mock('@langchain/langgraph', () => ({
    interrupt: interruptMock,
}))

import { createTool, toolDefinition } from '~~/server/services/agent-platform/tools/recommendTemplate.tool'
import { recommendDocumentTemplatesService } from '~~/server/agents/document/templateRecommend.service'
import { getDocumentTemplateDAO } from '~~/server/agents/document/documentTemplate.dao'

describe('recommend_template tool', () => {
    beforeEach(() => {
        vi.resetAllMocks()
    })

    it('toolDefinition 有正确的 name 和 schema', () => {
        expect(toolDefinition.name).toBe('recommend_template')
    })

    it('成功路径:推荐 + interrupt + resume + 拉 placeholders', async () => {
        ;(recommendDocumentTemplatesService as any).mockResolvedValue({
            items: [{ id: 1, name: '民事起诉状' }],
            total: 1,
            usedKeywords: ['起诉状'],
            fallbackToRecency: false,
        })
        // interrupt 返回包装的 resume value:{ resume: { [toolCallId]: { templateId: 1 } } }
        interruptMock.mockReturnValue({
            resume: { 'call-id-x': { templateId: 1 } },
        })
        ;(getDocumentTemplateDAO as any).mockResolvedValue({
            id: 1,
            name: '民事起诉状',
            category: '民事',
            placeholders: [
                { name: '原告', firstContext: '原告:{{原告}}' },
                { name: '被告', firstContext: '被告:{{被告}}' },
            ],
        })

        // tool() 第二个参数是 cfg,通过 toolCall.id 传 toolCallId
        const tool = createTool({ userId: 1, sessionId: 'sess-x' })
        const result = await tool.invoke(
            { intent: '起草起诉状', keywords: ['起诉状'] },
            { configurable: {}, toolCall: { id: 'call-id-x' } } as any,
        )

        const parsed = JSON.parse(result as string)
        expect(parsed.success).toBe(true)
        expect(parsed.templateId).toBe(1)
        expect(parsed.templateName).toBe('民事起诉状')
        expect(parsed.placeholders).toEqual([
            { name: '原告', firstContext: '原告:{{原告}}' },
            { name: '被告', firstContext: '被告:{{被告}}' },
        ])
    })

    it('用户取消(resume value 为 null):返回 cancelled=true', async () => {
        ;(recommendDocumentTemplatesService as any).mockResolvedValue({
            items: [], total: 0, usedKeywords: [], fallbackToRecency: false,
        })
        interruptMock.mockReturnValue({ resume: { 'call-id-x': null } })

        const tool = createTool({ userId: 1, sessionId: 'sess-x' })
        const result = await tool.invoke(
            { intent: '起草起诉状' },
            { configurable: {}, toolCall: { id: 'call-id-x' } } as any,
        )

        const parsed = JSON.parse(result as string)
        expect(parsed.success).toBe(false)
        expect(parsed.cancelled).toBe(true)
    })

    it('toolCallId 双层包装解包:支持 { resume: { [id]: value } } 形态', async () => {
        ;(recommendDocumentTemplatesService as any).mockResolvedValue({
            items: [{ id: 5, name: '答辩状' }], total: 1, usedKeywords: [], fallbackToRecency: false,
        })
        interruptMock.mockReturnValue({ resume: { 'tc-789': { templateId: 5 } } })
        ;(getDocumentTemplateDAO as any).mockResolvedValue({ id: 5, name: '答辩状', placeholders: [] })

        const tool = createTool({ userId: 1, sessionId: 'sess-x' })
        const result = await tool.invoke(
            { intent: '答辩' },
            { configurable: {}, toolCall: { id: 'tc-789' } } as any,
        )

        const parsed = JSON.parse(result as string)
        expect(parsed.templateId).toBe(5)
    })
})
```

- [ ] **Step 2:跑测试确认失败**

```bash
npx vitest run tests/server/agent-platform/tools/recommendTemplate.test.ts --reporter=verbose
```

Expected: FAIL `Cannot find module`。

- [ ] **Step 3:实现 recommendTemplate.tool.ts**

创建 `server/services/agent-platform/tools/recommendTemplate.tool.ts`:

```typescript
/**
 * recommend_template 工具
 *
 * 模板推荐 + interrupt 让用户选择模板。Agent 调此工具后:
 * 1. 工具内部调 recommendDocumentTemplatesService 拿候选
 * 2. interrupt({ type: 'template_select', toolCallId, ... }) 弹卡片
 * 3. 用户在 TemplateSelectCard 选完后,通过 stream.submit 提交 resume value
 * 4. 工具拿到 templateId 后查模板的 placeholders 列表回给 Agent
 * 5. Agent 看到 placeholders 字段清单后用 skill + 对话上下文产出 fieldValues
 *
 * 解包逻辑参考 draftDocument.tool.ts:99-112(spike C3 已验证可复用)。
 *
 * @see docs/superpowers/specs/2026-05-05-document-agent-tool-refactor-design.md §4.1
 */

import { z } from 'zod'
import { tool } from '@langchain/core/tools'
import { interrupt } from '@langchain/langgraph'
import type { ToolContext, ToolDefinition } from './types'
import { DOCUMENT_CATEGORY_KEYS, type DocumentCategoryKey } from '#shared/types/document'

interface TemplateSelectResumeValue {
    templateId: number
    sourceText?: string
}

const schema = z.object({
    intent: z.string().min(1).describe('用户起草意图的简短自然语言描述,例如:"起诉某某拖欠工资"'),
    keywords: z.array(z.string()).optional().describe(
        '从用户表达中抽取的关键词,用于模板召回(1-5 个)。'
        + '**优先抽完整文书名**(带"状/书/函/通知/协议"等后缀)——'
        + '用户说"起草起诉状"应给 ["起诉状"] 而非 ["起诉"];'
        + '"写一份答辩状"应给 ["答辩状"] 而非 ["答辩"]。',
    ),
    category: z.enum(DOCUMENT_CATEGORY_KEYS as unknown as [DocumentCategoryKey, ...DocumentCategoryKey[]])
        .optional()
        .describe('猜测的模板类别(可选);填写后第一层在该分类内召回'),
})

export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'recommend_template',
    description: '推荐法律文书模板并通过卡片让用户选择。'
        + '调用后会自动弹出"模板选择卡片",用户选完模板后返回 templateId 和该模板的字段清单(placeholders)。'
        + '当用户表达起草意图(如"帮我写起诉状")时第一步调此工具,'
        + '拿到字段清单后再用 save_document_draft 工具落库。',
    schema,
}

export function createTool(context: ToolContext) {
    return tool(
        async (input: z.infer<typeof schema>, cfg): Promise<string> => {
            // 顶层 try/catch:对齐 createSimpleTool 工厂的统一异常处理风格
            // (本工具因要带 cfg 参数读 toolCall.id,无法用 createSimpleTool 工厂,
            // 手动加顶层异常兜底,保证工具返回值始终是有效 JSON 字符串)
            try {
                const toolCallId = (cfg as any)?.toolCall?.id ?? ''
                const { sessionId, userId } = context
                if (!sessionId || !userId) {
                    throw new Error('recommend_template: ToolContext 缺少 sessionId/userId')
                }

                // 1. 模板推荐
                const { recommendDocumentTemplatesService } = await import(
                    '~~/server/agents/document/templateRecommend.service'
                )
                const reco = await recommendDocumentTemplatesService({
                    userId,
                    intent: input.intent,
                    keywords: input.keywords,
                    categoryHint: input.category,
                })

                // 2. interrupt 弹卡片(沿用 TemplateSelectCard 既有 payload 形态)
                const resumed = interrupt({
                    type: 'template_select',
                    toolCallId,
                    intent: input.intent,
                    keywords: reco.usedKeywords,
                    recommendations: reco.items,
                    total: reco.total,
                    fallbackToRecency: reco.fallbackToRecency,
                }) as unknown

                // 3. 双层包装解包:{ resume: { [toolCallId]: realValue } } → realValue
                //    抄 draftDocument.tool.ts:99-112 + reviewContract.tool.ts 同款机制
                //    (原 spike C3 已合并到本注释,实施时可对照原文件确认仍是项目标准)
                const unpacked = ((): TemplateSelectResumeValue | null => {
                    if (!resumed || typeof resumed !== 'object') return null
                    const layer1 = (resumed as { resume?: unknown }).resume ?? resumed
                    if (layer1 && typeof layer1 === 'object' && toolCallId in (layer1 as Record<string, unknown>)) {
                        return (layer1 as Record<string, unknown>)[toolCallId] as TemplateSelectResumeValue | null
                    }
                    return layer1 as TemplateSelectResumeValue | null
                })()

                // 4. 用户取消(resume 为 null 或缺 templateId):返回 cancelled
                if (!unpacked || typeof unpacked.templateId !== 'number') {
                    return JSON.stringify({
                        success: false,
                        cancelled: true,
                        message: '用户已取消模板选择',
                    })
                }

                // 5. 拉模板的 placeholders 列表回给 LLM
                const { getDocumentTemplateDAO } = await import(
                    '~~/server/agents/document/documentTemplate.dao'
                )
                const template = await getDocumentTemplateDAO(unpacked.templateId)
                if (!template) {
                    return JSON.stringify({
                        success: false,
                        error: `模板 #${unpacked.templateId} 不存在或已删除`,
                    })
                }

                return JSON.stringify({
                    success: true,
                    templateId: unpacked.templateId,
                    templateName: template.name,
                    templateCategory: template.category ?? null,
                    placeholders: template.placeholders, // [{ name, firstContext }, ...]
                    sourceText: unpacked.sourceText ?? null, // 用户在卡片里补充的额外说明
                })
            }
            catch (err) {
                logger.error('recommend_template 执行失败', { err, input, sessionId: context.sessionId })
                return JSON.stringify({
                    success: false,
                    error: err instanceof Error ? err.message : '推荐模板失败',
                })
            }
        },
        {
            name: toolDefinition.name,
            description: toolDefinition.description,
            schema,
        },
    )
}
```

- [ ] **Step 4:跑测试确认通过**

```bash
npx vitest run tests/server/agent-platform/tools/recommendTemplate.test.ts --reporter=verbose
```

Expected: 全部 PASS。

- [ ] **Step 5:Commit**

```bash
git add server/services/agent-platform/tools/recommendTemplate.tool.ts tests/server/agent-platform/tools/recommendTemplate.test.ts
git commit -m "feat(agent-platform): 新增 recommend_template 工具,interrupt 弹卡选模板"
```

---

### Task 1.5:tools/index.ts 注册 3 个新工具

**Files:**
- Modify: `server/services/agent-platform/tools/index.ts`

- [ ] **Step 1:看现有注册**

```bash
sed -n '15,55p' /Users/daixin/work/dev/LexSeek/LexSeek/server/services/agent-platform/tools/index.ts
```

Expected: 看到 import 列表 + toolModules map。

- [ ] **Step 2:加 import + 注册**

修改 `server/services/agent-platform/tools/index.ts`,在 `import * as draftDocumentTool` 行旁边加:

```typescript
import * as recommendTemplateTool from './recommendTemplate.tool'
import * as saveDocumentDraftTool from './saveDocumentDraft.tool'
import * as updateDocumentDraftTool from './updateDocumentDraft.tool'
```

在 `toolModules` map 里 `draft_document` 旁边加:

```typescript
recommend_template: recommendTemplateTool,
save_document_draft: saveDocumentDraftTool,
update_document_draft: updateDocumentDraftTool,
```

- [ ] **Step 3:跑 typecheck**

```bash
bun run typecheck 2>&1 | tail -10
```

Expected: 零错。

- [ ] **Step 4:跑全套 tools 测试**

```bash
npx vitest run tests/server/agent-platform/tools/ --reporter=verbose
```

Expected: 全部 PASS,包括新加的 3 个测试 + 现有所有工具测试。

- [ ] **Step 5:Commit**

```bash
git add server/services/agent-platform/tools/index.ts
git commit -m "feat(agent-platform): tools 注册表挂载 3 个新文书工具"
```

---

## Stage 2:架构切换(documentMain 重写 + DB)

### Task 2.1:扩展 PromptRenderContext 接口

**Files:**
- Modify: `server/services/node/prompt.service.ts`

- [ ] **Step 1:查看现有接口**

```bash
grep -A 20 "interface PromptRenderContext\|PromptRenderContext.*=" /Users/daixin/work/dev/LexSeek/LexSeek/server/services/node/prompt.service.ts | head -40
```

Expected: 看到现有 PromptRenderContext 接口定义。

- [ ] **Step 2:加 4 个新字段**

在 PromptRenderContext 接口里加(具体位置依现有文件结构,通常在 case/template 字段附近):

```typescript
export interface PromptRenderContext {
  // ...现有字段...

  /** 文书草稿 ID(documentMain 系统 prompt 注入用) */
  draftId?: number
  /** 草稿当前状态('ready' / 'exported' / 'failed' 等) */
  status?: string
  /** 当前已填字段值的 JSON 字符串(documentMain 系统 prompt 注入用) */
  currentValuesJSON?: string
  /** 模板字段清单 + 提示语(documentMain 系统 prompt 注入用) */
  placeholdersWithHints?: string
}
```

- [ ] **Step 3:跑 typecheck**

```bash
bun run typecheck 2>&1 | tail -10
```

Expected: 零错。

- [ ] **Step 4:跑 prompt.service 相关测试(若有)**

```bash
npx vitest run tests/server/node/prompt.service.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: 全部 PASS(若无相关测试,跳过)。

- [ ] **Step 5:Commit**

```bash
git add server/services/node/prompt.service.ts
git commit -m "feat(node): PromptRenderContext 扩展 draftId/status/currentValuesJSON/placeholdersWithHints 字段"
```

---

### Task 2.2:重写 documentMainAgent.ts

**Files:**
- Modify: `server/services/workflow/agents/documentMainAgent.ts`(大改)

- [ ] **Step 1:查看当前文件结构**

```bash
wc -l /Users/daixin/work/dev/LexSeek/LexSeek/server/services/workflow/agents/documentMainAgent.ts
sed -n '1,50p' /Users/daixin/work/dev/LexSeek/LexSeek/server/services/workflow/agents/documentMainAgent.ts
```

Expected: 看到现有导入和 prompt 选择逻辑。

- [ ] **Step 2:整文件重写**

完整覆写 `server/services/workflow/agents/documentMainAgent.ts`:

```typescript
/**
 * 文书生成主代理(documentMain 节点)
 *
 * 平级主 Agent,跟 caseMain / assistantMain 同构。挂 legal-document-writer skill,
 * 用对话上下文 + skill 写作规范方法论产出字段值,通过 save_document_draft /
 * update_document_draft 工具主动写库。
 *
 * 架构差异(对比旧实现):
 * - 删除 toolStrategy / responseFormat / buildDraftSchema 强约束 schema
 * - 删除 draftResultPersistenceMiddleware afterAgent hook 兜底
 * - 系统 prompt 启动时注入 draft 当前状态(模板/已填字段/字段清单)
 *
 * @see docs/superpowers/specs/2026-05-05-document-agent-tool-refactor-design.md §5
 */

import { createAgent, summarizationMiddleware, type ReactAgent } from 'langchain'
import { HumanMessage } from '@langchain/core/messages'
import { Command } from '@langchain/langgraph'
import { getCheckpointer, getStore } from '../checkpointer'
import { getValidNodeConfig } from '../../node/node.service'
import { createChatModel } from '../../node/chatModelFactory'
import { getToolInstancesService } from '../tools'
import { renderSystemPrompt } from '../utils/promptRenderer'
import { buildSystemPromptForAgent } from '../context/moduleContextBuilder'
import {
    createAuditMiddleware,
    createMessageIntegrityMiddleware,
    createScopeGuardMiddleware,
    pointConsumptionMiddleware,
    safetyTrimMiddleware,
    buildMiddlewareStack,
    MIDDLEWARE_PRIORITY,
    MIDDLEWARE_NAMES,
} from '../middleware'
import { afterAgentMemoryMiddleware } from '~~/server/services/agent-platform/middleware/afterAgentMemory.middleware'
import { buildLangfuseTopLevelConfig } from '~~/server/lib/langfuse'
import { findDraftBySessionIdDAO } from '../../assistant/document/documentDraft.dao'
import { getDocumentTemplateDAO } from '../../assistant/document/documentTemplate.dao'
import { resolveContextWindow } from '../context/messageCompressor'
import type { CallbackHandlerMethods } from '@langchain/core/callbacks/base'

const DOCUMENT_MAIN_NODE_NAME = 'documentMain'

export interface DocumentAgentOptions {
    userId: number
    caseId?: number
    signal?: AbortSignal
    command?: unknown
    callbacks?: CallbackHandlerMethods[]
}

/**
 * 执行文书草稿生成对话(平级主 Agent 模式)。
 */
export async function runDocumentChat(
    sessionId: string,
    message: string | undefined,
    options: DocumentAgentOptions,
): Promise<ReadableStream<Uint8Array>> {
    const { userId, caseId, signal, command } = options

    // 1. 反查 draft + template + nodeConfig + 基建(并发)
    const [checkpointer, store, nodeConfig, draft] = await Promise.all([
        getCheckpointer(),
        getStore(),
        getValidNodeConfig(DOCUMENT_MAIN_NODE_NAME, '文书生成主Agent'),
        findDraftBySessionIdDAO(sessionId),
    ])

    if (!draft) {
        throw new Error(`未找到 sessionId=${sessionId} 对应的文书草稿`)
    }

    const template = await getDocumentTemplateDAO(draft.templateId)
    if (!template) {
        throw new Error(`未找到 templateId=${draft.templateId} 对应的文书模板`)
    }

    // 2. 获取可用 API Key
    const activeApiKey = nodeConfig.modelApiKeys.find(k => k.status === 1)
    if (!activeApiKey) {
        throw new Error(`${DOCUMENT_MAIN_NODE_NAME} 节点没有可用的 API 密钥`)
    }

    // 3. 创建模型实例
    const model = createChatModel({
        sdkType: nodeConfig.modelSdkType,
        modelName: nodeConfig.modelName,
        apiKey: activeApiKey.apiKey,
        baseUrl: nodeConfig.modelProviderBaseUrl,
        temperature: 0.7,
        streaming: true,
        maxTokens: nodeConfig.modelMaxOutputTokens,
    })

    // 4. 构建系统 prompt(注入 draft 当前状态)
    const placeholders = (template.placeholders ?? []) as Array<{ name: string; firstContext?: string }>
    const placeholdersWithHints = placeholders
        .map(p => `- ${p.name}${p.firstContext ? `(参考上下文:${p.firstContext})` : ''}`)
        .join('\n')
    const currentValuesJSON = JSON.stringify(draft.values ?? {}, null, 2)

    const resolvedCaseId = draft.caseId ?? caseId
    const roleAndFlowTemplate = renderSystemPrompt(nodeConfig, {
        caseId: resolvedCaseId,
        templateName: template.name,
        templateCategory: template.category,
        draftId: draft.id,
        status: draft.status,
        currentValuesJSON,
        placeholdersWithHints,
    })
    const { systemMessage, plainText: systemPromptPlainText } = await buildSystemPromptForAgent(
        nodeConfig.modelSdkType,
        {
            caseId: resolvedCaseId ?? null,
            agentName: DOCUMENT_MAIN_NODE_NAME,
            userQuery: message ?? '',
            roleAndFlowTemplate,
        },
    )

    // 5. 加载工具(含 recommend_template / save_document_draft / update_document_draft)
    const toolContext = {
        userId,
        caseId: resolvedCaseId,
        sessionId,
        draftId: draft.id,
    }
    const baseTools = nodeConfig.tools.length > 0
        ? getToolInstancesService(nodeConfig.tools, toolContext)
        : []
    const requiredToolNames = ['search_case_analysis']
    const baseNames = new Set(baseTools.map(t => t.name))
    const missingNames = requiredToolNames.filter(n => !baseNames.has(n))
    const supplementaryTools = missingNames.length > 0
        ? getToolInstancesService(missingNames, toolContext)
        : []
    const tools = [...baseTools, ...supplementaryTools]

    logger.info('文书生成主 Agent 创建', {
        sessionId,
        draftId: draft.id,
        templateId: template.id,
        templateName: template.name,
        model: nodeConfig.modelName,
        toolsCount: tools.length,
    })

    const { triggerTokens, maxTokens, maxOutputTokens } = resolveContextWindow(
        nodeConfig.modelContextWindow,
        nodeConfig.modelMaxOutputTokens,
    )

    // 6. 组装中间件栈(afterAgentMemory 条件挂载,agent-platform.md 铁律)
    const middleware = buildMiddlewareStack([
        {
            middleware: createMessageIntegrityMiddleware(),
            priority: MIDDLEWARE_PRIORITY.MESSAGE_INTEGRITY,
            name: MIDDLEWARE_NAMES.MESSAGE_INTEGRITY,
        },
        {
            middleware: createScopeGuardMiddleware(),
            priority: MIDDLEWARE_PRIORITY.SCOPE_GUARD,
            name: MIDDLEWARE_NAMES.SCOPE_GUARD,
        },
        {
            middleware: pointConsumptionMiddleware(userId, 'document_draft_token', sessionId),
            priority: MIDDLEWARE_PRIORITY.POINT_CONSUMPTION,
            name: MIDDLEWARE_NAMES.POINT_CONSUMPTION,
        },
        {
            middleware: summarizationMiddleware({
                model,
                trigger: [{ tokens: triggerTokens }],
            }),
            priority: MIDDLEWARE_PRIORITY.SUMMARIZATION,
            name: MIDDLEWARE_NAMES.SUMMARIZATION,
        },
        {
            middleware: safetyTrimMiddleware({
                model,
                maxTokens,
                systemPrompt: systemPromptPlainText,
                maxOutputTokens,
            }),
            priority: MIDDLEWARE_PRIORITY.SAFETY_TRIM,
            name: MIDDLEWARE_NAMES.SAFETY_TRIM,
        },
        // afterAgentMemory 条件挂载:caseId 非空时才挂(铁律)
        ...(resolvedCaseId
            ? [{
                middleware: afterAgentMemoryMiddleware({
                    caseId: resolvedCaseId,
                    sessionId,
                    userId,
                }),
                priority: MIDDLEWARE_PRIORITY.RESULT_PERSISTENCE,
                name: 'afterAgentMemory',
            }]
            : []),
        {
            middleware: createAuditMiddleware(),
            priority: MIDDLEWARE_PRIORITY.AUDIT,
            name: MIDDLEWARE_NAMES.AUDIT,
        },
    ])

    const agent: ReactAgent = createAgent({
        model,
        systemPrompt: systemMessage,
        checkpointer,
        store,
        tools,
        // 不再有 responseFormat:Agent 通过 tool call 主动写库,不靠 toolStrategy 强约束
        middleware,
    })

    // 7. 构造输入
    let input: Command | { messages: HumanMessage[] }
    if (command) {
        input = new Command({ resume: command })
    }
    else if (message !== undefined) {
        input = { messages: [new HumanMessage(message)] }
    }
    else {
        // 启动时无消息(checkpoint 重放),传空 messages 让 graph 从 checkpoint 恢复
        input = { messages: [] }
    }

    // 8. 流式执行
    const { createErrorTraceHandler } = await import(
        '~~/server/services/agent-platform/diagnostics/errorTraceHandler'
    )
    return agent.stream(
        input as any,
        {
            configurable: {
                thread_id: sessionId,
            },
            streamMode: ['values', 'messages', 'updates'],
            subgraphs: true,
            encoding: 'text/event-stream',
            recursionLimit: 1000,
            signal,
            ...buildLangfuseTopLevelConfig({
                additionalCallbacks: [
                    createErrorTraceHandler({
                        sessionId,
                        agentName: 'documentMain',
                        extra: { draftId: draft.id, templateId: template.id, caseId: resolvedCaseId },
                    }),
                    ...(options.callbacks ?? []),
                ],
            }),
        },
    )
}

/**
 * 读取文书会话 checkpoint 状态(用于 interrupt 检测)。
 * 结构与 caseMainAgent.getChatThreadState 一致。
 */
export async function getDocumentThreadState(sessionId: string) {
    const checkpointer = await getCheckpointer()

    const dummyModel = createChatModel({
        sdkType: 'openai',
        modelName: 'gpt-4',
        apiKey: 'dummy',
        baseUrl: 'http://localhost',
    })

    const stateReader = createAgent({
        model: dummyModel,
        checkpointer,
    })

    return stateReader.getState({
        configurable: { thread_id: sessionId },
    })
}
```

- [ ] **Step 3:跑 typecheck**

```bash
bun run typecheck 2>&1 | tail -20
```

Expected: 零错(注意:此时旧 prompt 选择函数 buildInitialPromptFromDraft / pickInitialPromptName 被删,任何引用都已清理)。

- [ ] **Step 4:Commit**

```bash
git add server/services/workflow/agents/documentMainAgent.ts
git commit -m "refactor(workflow): documentMainAgent 重写为标准 ReAct Agent,删除 toolStrategy + 三段 user prompt 选择"
```

---

### Task 2.3:更新 agent.config.ts 描述

**Files:**
- Modify: `server/agents/document/agent.config.ts`

- [ ] **Step 1:更新 description**

修改 `server/agents/document/agent.config.ts` 第 20 行:

```typescript
description: '文书生成主 Agent(标准 ReAct + skill 加载 + 三入口共享工具)',
```

- [ ] **Step 2:Commit**

```bash
git add server/agents/document/agent.config.ts
git commit -m "docs(agent): documentAgent description 更新反映新架构"
```

---

### Task 2.4:dev 库 + seedData.sql 改 nodes.tools(三处)

**Files:**
- Modify: `prisma/seeds/seedData.sql`(三处 INSERT 字段值)

- [ ] **Step 1:dev 库直接改三个节点的 tools**

```bash
docker exec postgres-postgres-1 psql -U daixin -d ls_new <<'SQL'
UPDATE nodes SET tools = '["process_materials", "search_case_materials", "search_law", "search_case_memory", "write_case_memory", "update_case_memory", "search_case_analysis", "review_contract", "recommend_template", "save_document_draft", "update_document_draft"]'::jsonb WHERE id = 5;
UPDATE nodes SET tools = '["search_law", "review_contract", "process_materials", "search_case_materials", "recommend_template", "save_document_draft", "update_document_draft"]'::jsonb WHERE id = 15;
UPDATE nodes SET tools = '["process_materials", "search_case_materials", "search_law", "search_case_memory", "write_case_memory", "update_case_memory", "recommend_template", "save_document_draft", "update_document_draft"]'::jsonb WHERE id = 17;
SQL
docker exec postgres-postgres-1 psql -U daixin -d ls_new -c "SELECT id, name, tools FROM nodes WHERE id IN (5, 15, 17);"
```

Expected: 输出三个节点的新 tools 列表,跟 spec §6.2 一致。

- [ ] **Step 2:同步改 seedData.sql**

打开 `prisma/seeds/seedData.sql`,搜索 `INSERT INTO "public"."nodes"`,找 id=5/15/17 三行,把 `tools` 字段值改成跟 dev 库一致(就是上面 SQL 的 JSON 内容)。

注意:seedData.sql 中 INSERT 语句的 tools 字段是嵌入在长字符串里,可以直接用编辑器找到对应位置改。要保留原 INSERT 行的其他字段不变。

- [ ] **Step 3:验证 prisma migrate status 无 drift**

```bash
DATABASE_URL='postgresql://daixin@localhost:5432/ls_new?TimeZone=UTC' npx prisma migrate status
```

Expected: `Database schema is up to date!`

- [ ] **Step 4:Commit**

```bash
git add prisma/seeds/seedData.sql
git commit -m "chore(seed): 三个 Agent 节点 tools 切换到新文书工具(caseMain/assistantMain/documentMain)"
```

---

### Task 2.5:dev 库 + seedData.sql 改 node_skills 加挂

**Files:**
- Modify: `prisma/seeds/seedData.sql`(追加两行 INSERT)

- [ ] **Step 1:dev 库 INSERT 两条关联**

```bash
docker exec postgres-postgres-1 psql -U daixin -d ls_new <<'SQL'
INSERT INTO node_skills (skill_name, node_id, created_at, updated_at)
  VALUES ('legal-document-writer', 15, now(), now()),
         ('legal-document-writer', 17, now(), now())
  ON CONFLICT DO NOTHING;
SELECT skill_name, node_id FROM node_skills WHERE skill_name = 'legal-document-writer' ORDER BY node_id;
SQL
```

Expected: 输出 3 行(node_id=5/15/17),前者是 caseMain 已有,后两个是新加的。

- [ ] **Step 2:同步加到 seedData.sql**

打开 `prisma/seeds/seedData.sql`,找到现有的 `INSERT INTO "public"."node_skills"` 区域(若没有则在 `-- node_skills` 注释附近),追加两行:

```sql
INSERT INTO "public"."node_skills" ("skill_name", "node_id", "created_at", "updated_at") VALUES ('legal-document-writer', 15, '2026-05-05 12:00:00+08', '2026-05-05 12:00:00+08');
INSERT INTO "public"."node_skills" ("skill_name", "node_id", "created_at", "updated_at") VALUES ('legal-document-writer', 17, '2026-05-05 12:00:00+08', '2026-05-05 12:00:00+08');
```

- [ ] **Step 3:验证 prisma migrate status**

```bash
DATABASE_URL='postgresql://daixin@localhost:5432/ls_new?TimeZone=UTC' npx prisma migrate status
```

Expected: `Database schema is up to date!`

- [ ] **Step 4:Commit**

```bash
git add prisma/seeds/seedData.sql
git commit -m "chore(seed): assistantMain + documentMain 节点加挂 legal-document-writer skill"
```

---

### Task 2.6:重写 documentMain_system prompt + 软停用 user prompts

**Files:**
- Modify: `prisma/seeds/seedData.sql`(prompts 6 处)

- [ ] **Step 1:写新版 documentMain_system prompt 内容**

在脚本里准备新版 system prompt 文本(对应 spec §5.3,这里给完整版本):

```
你是 LexSeek 的文书生成助手,专门为用户起草和完善法律文书。

# 当前工作上下文(运行时由系统注入)
- 草稿 ID:{{draftId}}
- 草稿状态:{{status}}(ready / exported / failed)
- 模板:{{templateName}}({{templateCategory}})
- 关联案件:{{caseId}}
- 当前已填字段:{{currentValuesJSON}}
- 模板字段清单:
{{placeholdersWithHints}}

# 工作流程
1. legal-document-writer skill 已加载,可用 read_skill_file 读对应文书的 reference/<文书类型>.md 写作规范。
2. 用对话上下文 + 已填字段 + skill 方法论:
   - 司法三段论提炼"事实和理由"(法律关系建立 → 违约/侵权事实 → 法律后果推导)
   - 配套思考"诉讼请求"(请求解除合同要带返还/赔偿,涉及金钱要写本金/利率/起止)
   - 从对话提取当事人/证据/时间线
3. 根据用户当前指令决定动作:
   - 用户首次起草 → 调 save_document_draft 一次性写入所有能填的字段
   - 用户要改某字段(如"被告住址改成 XX")→ 调 update_document_draft 增量更新
   - 信息不足 → 在对话里反问用户,等回答后再调工具
4. 字段值规则:
   - 能从对话/已填字段抽取的 → 填实
   - 不知道的 → 写 null,不要编造
   - "建议用户补充什么" → 写到 suggestions 字段(每条一句问句),不要在消息正文里输出
5. 第一次起草前若用户没指定模板,先调 recommend_template 弹卡片让用户选

# 工具
- recommend_template:推荐模板并弹卡片让用户选
- save_document_draft:创建草稿并写字段值(必须先有 templateId)
- update_document_draft:修改已有草稿的字段
- search_case_materials:检索关联案件/草稿的材料
- search_case_analysis:检索案件分析(若关联案件)
- search_case_memory / write_case_memory / update_case_memory:案件记忆操作
- search_law:检索法条
- process_materials:处理用户上传的新材料

# 不做的事
- 不在消息正文里输出大段字段值的 JSON 或代码块——所有字段值通过工具调用提交
- 不替用户做最终法律决定,只提供分析与建议
- 不编造未在对话/材料中出现的事实
- 不在自然语言里输出 emoji 表情
```

- [ ] **Step 2:dev 库写入新 prompt + 软停用 user prompts**

```bash
NEW_PROMPT=$(cat <<'PROMPT'
你是 LexSeek 的文书生成助手,专门为用户起草和完善法律文书。

# 当前工作上下文(运行时由系统注入)
- 草稿 ID:{{draftId}}
- 草稿状态:{{status}}(ready / exported / failed)
- 模板:{{templateName}}({{templateCategory}})
- 关联案件:{{caseId}}
- 当前已填字段:{{currentValuesJSON}}
- 模板字段清单:
{{placeholdersWithHints}}

# 工作流程
1. legal-document-writer skill 已加载,可用 read_skill_file 读对应文书的 reference/<文书类型>.md 写作规范。
2. 用对话上下文 + 已填字段 + skill 方法论:
   - 司法三段论提炼"事实和理由"(法律关系建立 → 违约/侵权事实 → 法律后果推导)
   - 配套思考"诉讼请求"(请求解除合同要带返还/赔偿,涉及金钱要写本金/利率/起止)
   - 从对话提取当事人/证据/时间线
3. 根据用户当前指令决定动作:
   - 用户首次起草 → 调 save_document_draft 一次性写入所有能填的字段
   - 用户要改某字段(如"被告住址改成 XX")→ 调 update_document_draft 增量更新
   - 信息不足 → 在对话里反问用户,等回答后再调工具
4. 字段值规则:
   - 能从对话/已填字段抽取的 → 填实
   - 不知道的 → 写 null,不要编造
   - "建议用户补充什么" → 写到 suggestions 字段(每条一句问句),不要在消息正文里输出
5. 第一次起草前若用户没指定模板,先调 recommend_template 弹卡片让用户选

# 工具
- recommend_template:推荐模板并弹卡片让用户选
- save_document_draft:创建草稿并写字段值(必须先有 templateId)
- update_document_draft:修改已有草稿的字段
- search_case_materials:检索关联案件/草稿的材料
- search_case_analysis:检索案件分析(若关联案件)
- search_case_memory / write_case_memory / update_case_memory:案件记忆操作
- search_law:检索法条
- process_materials:处理用户上传的新材料

# 不做的事
- 不在消息正文里输出大段字段值的 JSON 或代码块——所有字段值通过工具调用提交
- 不替用户做最终法律决定,只提供分析与建议
- 不编造未在对话/材料中出现的事实
- 不在自然语言里输出 emoji 表情
PROMPT
)

docker exec -i postgres-postgres-1 psql -U daixin -d ls_new <<SQL
UPDATE prompts SET content = \$\$$NEW_PROMPT\$\$ WHERE id = 30;
UPDATE prompts SET status = 0 WHERE id IN (45, 46, 47);
SELECT id, name, status, length(content) AS clen FROM prompts WHERE id IN (30, 45, 46, 47, 18, 29) ORDER BY id;
SQL
```

Expected: prompt id=30 长度变成新文本字符数,id=45/46/47 status=0。id=18/29(assistantMain_system / caseMain_system)保持原样(下个 task 处理)。

- [ ] **Step 3:同步改 seedData.sql**

打开 `prisma/seeds/seedData.sql`,搜索 `INSERT INTO "public"."prompts"` 找 id=30 那行,把 content 字段值替换为新版(注意 SQL 字符串转义)。
搜索 id=45/46/47 那三行,把 status 字段从 1 改 0。

> 注意:由于 INSERT 行很长且 content 是大段字符串,推荐用 `pg_dump --inserts --column-inserts` 重新导出对应行的最新值。或者用编辑器手工编辑(确认 SQL 字符串引号转义正确)。

- [ ] **Step 4:验证 prisma migrate status**

```bash
DATABASE_URL='postgresql://daixin@localhost:5432/ls_new?TimeZone=UTC' npx prisma migrate status
```

Expected: 仍 up to date。

- [ ] **Step 5:Commit**

```bash
git add prisma/seeds/seedData.sql
git commit -m "chore(seed): 重写 documentMain_system prompt 适配新架构,软停用三段 user prompt"
```

---

### Task 2.7:更新 caseMain / assistantMain system prompt 工具列表段

**Files:**
- Modify: `prisma/seeds/seedData.sql`(prompts id=18 / 29)

- [ ] **Step 1:dev 库改两条 prompt content**

caseMain_system(id=29)的工具列表段把 `draft_document` 替换成三个新工具说明;assistantMain_system(id=18)同样。

> 由于 prompt 内容长且需要保留其他段落,推荐方案:
> 1. 用 `psql` 把现有 content 导出
> 2. 文本编辑器中找到"draft_document:起草法律文书..."那一行,改成:
>    ```
>    - recommend_template:推荐法律文书模板(自动弹卡片让用户选)
>    - save_document_draft:创建文书草稿并写入字段值(需先有 templateId)
>    - update_document_draft:修改已有草稿的字段(用户改某字段时调用)
>    ```
> 3. 把改后的 content 用 `psql` UPDATE 回去

具体 SQL:

```bash
# Step 1a: 导出现有 prompt
docker exec postgres-postgres-1 psql -U daixin -d ls_new -t -c "SELECT content FROM prompts WHERE id = 18;" > /tmp/assistantMain_system.txt
docker exec postgres-postgres-1 psql -U daixin -d ls_new -t -c "SELECT content FROM prompts WHERE id = 29;" > /tmp/caseMain_system.txt

# Step 1b: 编辑这两个文件,把 draft_document 那行改成三个新工具

# Step 1c: 写回 dev 库
docker cp /tmp/assistantMain_system.txt postgres-postgres-1:/tmp/asm.txt
docker cp /tmp/caseMain_system.txt postgres-postgres-1:/tmp/csm.txt
docker exec postgres-postgres-1 psql -U daixin -d ls_new <<'SQL'
\set asm `cat /tmp/asm.txt`
\set csm `cat /tmp/csm.txt`
UPDATE prompts SET content = :'asm' WHERE id = 18;
UPDATE prompts SET content = :'csm' WHERE id = 29;
SQL
```

- [ ] **Step 2:同步改 seedData.sql**

打开 `prisma/seeds/seedData.sql`,搜索 `INSERT INTO "public"."prompts"` id=18 / id=29 那两行,把 content 字段改成跟 dev 库一致。

- [ ] **Step 3:验证 prisma migrate status**

```bash
DATABASE_URL='postgresql://daixin@localhost:5432/ls_new?TimeZone=UTC' npx prisma migrate status
```

Expected: up to date。

- [ ] **Step 4:Commit**

```bash
git add prisma/seeds/seedData.sql
git commit -m "chore(seed): caseMain/assistantMain system prompt 工具列表段更新为三个新文书工具"
```

---

### Task 2.8:修复 dev 库 filling 草稿

**Files:**
- Create: `server/scripts/migrateFillingDrafts.ts`(一次性脚本)

- [ ] **Step 1:写脚本**

创建 `server/scripts/migrateFillingDrafts.ts`:

```typescript
/**
 * 一次性数据修复:把遗留的 filling 状态草稿置 failed
 *
 * 旧架构 documentMain 启动时 draftResultPersistenceMiddleware.beforeAgent 会写
 * status='filling',若 graph 异常退出未跑 afterAgent,会卡在 filling 态。新架构
 * 没有这个中间态,这条数据是历史污染。
 *
 * 用法:`npx tsx server/scripts/migrateFillingDrafts.ts`
 */

import { prisma } from '~~/server/utils/db'
import { logger } from '#shared/utils/logger'

async function main() {
    const stuck = await prisma.documentDrafts.findMany({
        where: { status: 'filling', deletedAt: null },
        select: { id: true, sessionId: true, updatedAt: true },
    })

    logger.info(`Found ${stuck.length} filling drafts to migrate`, {
        ids: stuck.map(d => d.id),
    })

    if (stuck.length === 0) {
        logger.info('No filling drafts to migrate, exiting.')
        return
    }

    const result = await prisma.documentDrafts.updateMany({
        where: { status: 'filling', deletedAt: null },
        data: { status: 'failed' },
    })

    logger.info(`Migrated ${result.count} filling drafts to failed`)
}

main()
    .catch((err) => {
        logger.error('Migration failed', { err })
        process.exit(1)
    })
    .finally(() => process.exit(0))
```

- [ ] **Step 2:执行脚本**

```bash
DATABASE_URL='postgresql://daixin@localhost:5432/ls_new?TimeZone=UTC' npx tsx server/scripts/migrateFillingDrafts.ts
```

Expected: 输出 `Found 3 filling drafts to migrate` → `Migrated 3 filling drafts to failed`(按 dev 库实际数量)。

- [ ] **Step 3:验证修复结果**

```bash
docker exec postgres-postgres-1 psql -U daixin -d ls_new -c "SELECT status, COUNT(*) FROM document_drafts WHERE deleted_at IS NULL GROUP BY status ORDER BY status;"
```

Expected: 不再有 `filling` 行,3 条原 filling 草稿现在归到 `failed`。

- [ ] **Step 4:Commit**

```bash
git add server/scripts/migrateFillingDrafts.ts
git commit -m "chore(scripts): 一次性维护脚本修复遗留 filling 草稿到 failed"
```

---

### Task 2.9:重写 documentMainAgent 测试

**Files:**
- Modify: `tests/server/workflow/agents/documentMainAgent.test.ts`(整文件重写)

- [ ] **Step 1:整文件重写**

完整覆写 `tests/server/workflow/agents/documentMainAgent.test.ts`:

```typescript
/**
 * documentMainAgent 单测(新架构,标准 ReAct + 平级主 Agent)
 *
 * 删除测试范围:toolStrategy / responseFormat / buildDraftSchema / draftResultPersistence
 * 新增测试范围:中间件挂载 + 系统 prompt 注入 draft 状态 + 工具列表含三个新工具
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock 关键依赖
vi.mock('langchain', async (orig) => {
    const real = await orig() as any
    return {
        ...real,
        createAgent: vi.fn(),
        summarizationMiddleware: vi.fn(() => ({ name: 'summarizationMiddleware' })),
    }
})
vi.mock('../../../../server/services/workflow/checkpointer', () => ({
    getCheckpointer: vi.fn().mockResolvedValue({} as any),
    getStore: vi.fn().mockResolvedValue({} as any),
}))
vi.mock('../../../../server/services/node/node.service', () => ({
    getValidNodeConfig: vi.fn(),
}))
vi.mock('../../../../server/services/node/chatModelFactory', () => ({
    createChatModel: vi.fn(() => ({ name: 'mockModel' })),
}))
vi.mock('../../../../server/services/agent-platform/tools', () => ({
    getToolInstancesService: vi.fn(() => []),
}))
vi.mock('../../../../server/services/workflow/utils/promptRenderer', () => ({
    renderSystemPrompt: vi.fn((cfg, ctx) => `RENDERED:${JSON.stringify(ctx)}`),
}))
vi.mock('../../../../server/services/workflow/context/moduleContextBuilder', () => ({
    buildSystemPromptForAgent: vi.fn().mockResolvedValue({
        systemMessage: { type: 'system', content: 'system' },
        plainText: 'plain',
    }),
}))
vi.mock('../../../../server/services/assistant/document/documentDraft.dao', () => ({
    findDraftBySessionIdDAO: vi.fn(),
}))
vi.mock('../../../../server/services/assistant/document/documentTemplate.dao', () => ({
    getDocumentTemplateDAO: vi.fn(),
}))
vi.mock('../../../../server/lib/langfuse', () => ({
    buildLangfuseTopLevelConfig: vi.fn(() => ({})),
}))

import { runDocumentChat } from '~~/server/services/workflow/agents/documentMainAgent'
import { createAgent } from 'langchain'
import { getValidNodeConfig } from '~~/server/services/node/node.service'
import { findDraftBySessionIdDAO } from '~~/server/services/assistant/document/documentDraft.dao'
import { getDocumentTemplateDAO } from '~~/server/services/assistant/document/documentTemplate.dao'
import { renderSystemPrompt } from '~~/server/services/workflow/utils/promptRenderer'

describe('documentMainAgent (新架构)', () => {
    let mockStream: any

    beforeEach(() => {
        vi.resetAllMocks()
        mockStream = vi.fn().mockReturnValue('mock-stream')
        ;(createAgent as any).mockReturnValue({ stream: mockStream })

        ;(findDraftBySessionIdDAO as any).mockResolvedValue({
            id: 100,
            sessionId: 'sess-x',
            templateId: 1,
            caseId: null,
            values: { 原告: '张三' },
            status: 'ready',
            sourceRef: null,
        })
        ;(getDocumentTemplateDAO as any).mockResolvedValue({
            id: 1,
            name: '民事起诉状',
            category: '民事',
            placeholders: [
                { name: '原告', firstContext: '原告:{{原告}}' },
                { name: '被告', firstContext: '被告:{{被告}}' },
            ],
        })
        ;(getValidNodeConfig as any).mockResolvedValue({
            id: 17,
            name: 'documentMain',
            modelSdkType: 'anthropic',
            modelName: 'deepseek-v4-flash',
            modelProviderBaseUrl: 'https://example.com',
            modelMaxOutputTokens: 4000,
            modelContextWindow: 100000,
            modelApiKeys: [{ apiKey: 'sk-test', status: 1 }],
            tools: ['recommend_template', 'save_document_draft', 'update_document_draft'],
            prompts: [],
        })
    })

    it('createAgent 调用不含 responseFormat(toolStrategy 已删)', async () => {
        await runDocumentChat('sess-x', '帮我起草起诉状', { userId: 1 })

        const callArgs = (createAgent as any).mock.calls[0][0]
        expect(callArgs).not.toHaveProperty('responseFormat')
    })

    it('renderSystemPrompt 接收新增的 4 个字段(draftId/status/currentValuesJSON/placeholdersWithHints)', async () => {
        await runDocumentChat('sess-x', '帮我起草', { userId: 1 })

        expect(renderSystemPrompt).toHaveBeenCalledWith(
            expect.any(Object),
            expect.objectContaining({
                draftId: 100,
                status: 'ready',
                currentValuesJSON: expect.stringContaining('原告'),
                placeholdersWithHints: expect.stringContaining('原告'),
            }),
        )
    })

    it('caseId 为 null 时不挂 afterAgentMemory 中间件', async () => {
        await runDocumentChat('sess-x', '帮我起草', { userId: 1 })

        const callArgs = (createAgent as any).mock.calls[0][0]
        const mwNames = (callArgs.middleware as any[]).map(m => m.name ?? m.constructor?.name ?? '')
        expect(mwNames).not.toContain('afterAgentMemory')
    })

    it('caseId 非空时挂 afterAgentMemory 中间件', async () => {
        ;(findDraftBySessionIdDAO as any).mockResolvedValue({
            id: 100,
            sessionId: 'sess-x',
            templateId: 1,
            caseId: 5,
            values: {},
            status: 'ready',
            sourceRef: null,
        })

        await runDocumentChat('sess-x', '帮我起草', { userId: 1, caseId: 5 })

        const callArgs = (createAgent as any).mock.calls[0][0]
        // 中间件名包含 afterAgentMemory(具体形态依 buildMiddlewareStack 行为)
        const mwSerialized = JSON.stringify(callArgs.middleware)
        expect(mwSerialized).toMatch(/afterAgentMemory/)
    })

    it('工具列表包含 recommend_template / save_document_draft / update_document_draft', async () => {
        // tools 来自 nodeConfig.tools,在 mock 里已经设了 3 个新工具
        await runDocumentChat('sess-x', '帮我起草', { userId: 1 })

        // 验证调用 getToolInstancesService 时传入了正确名字
        const { getToolInstancesService } = await import('~~/server/services/agent-platform/tools')
        expect(getToolInstancesService).toHaveBeenCalledWith(
            expect.arrayContaining(['recommend_template', 'save_document_draft', 'update_document_draft']),
            expect.any(Object),
        )
    })

    it('draft 不存在时抛错', async () => {
        ;(findDraftBySessionIdDAO as any).mockResolvedValue(null)

        await expect(runDocumentChat('sess-missing', 'msg', { userId: 1 }))
            .rejects.toThrow('未找到 sessionId=sess-missing')
    })
})
```

- [ ] **Step 2:跑测试**

```bash
npx vitest run tests/server/workflow/agents/documentMainAgent.test.ts --reporter=verbose
```

Expected: 全部 PASS。

- [ ] **Step 3:Commit**

```bash
git add tests/server/workflow/agents/documentMainAgent.test.ts
git commit -m "test(workflow): documentMainAgent 测试重写,断言新 ReAct 架构"
```

---

### Task 2.10:小调 documentDraft.service 测试

**Files:**
- Modify: `tests/server/assistant/document/documentDraft.service.test.ts`

- [ ] **Step 1:删除 buildDraftSchema mock**

打开 `tests/server/assistant/document/documentDraft.service.test.ts`:

- 删除第 43 行 `vi.mock('~~/server/agents/document/draftSchema.builder', ...)` 或类似的 mock 行
- 删除第 64 行 `import { buildDraftSchema } from '~~/server/agents/document/draftSchema.builder'`
- 删除第 77 行 `const mockBuildDraftSchema = buildDraftSchema as ReturnType<typeof vi.fn>`
- 删除第 155 行附近的 `mockBuildDraftSchema.mockReturnValue(...)` 调用

(具体行号可能因 Step 1 中删除已经发生偏移,以编辑器搜索为准)

- [ ] **Step 2:跑测试**

```bash
npx vitest run tests/server/assistant/document/documentDraft.service.test.ts --reporter=verbose
```

Expected: 全部 PASS。

- [ ] **Step 3:Commit**

```bash
git add tests/server/assistant/document/documentDraft.service.test.ts
git commit -m "test(document): 删除 documentDraft.service 测试中的 buildDraftSchema mock"
```

---

### Task 2.11:跑全套测试 + 三入口手动验证

**Files:** 无

- [ ] **Step 1:跑全套测试**

```bash
bun run test 2>&1 | tail -30
```

Expected: 全部 PASS,无 fail/error。

- [ ] **Step 2:跑覆盖率**

```bash
bun run coverage 2>&1 | tail -20
```

Expected: `agent-platform/**` 覆盖率 ≥ 90%。

- [ ] **Step 3:启动 dev server**

```bash
bun dev > /tmp/dev-server.log 2>&1 &
sleep 10
tail -20 /tmp/dev-server.log
```

Expected: dev server 启动,无 startup 错误。

- [ ] **Step 4:手动验证小索路径**

打开浏览器访问 `http://localhost:3000/dashboard/cases`(或开启的端口),进入任一已分析案件 → 小索对话框 → 输入"帮我起草一份民事起诉状" → 看模板选择卡 → 选《民事起诉状(公民提起民事诉讼用)》 → 等草稿生成 → 跳转到文书页验证字段填得对。

记录验证结果:
- [ ] 模板卡片正常弹出
- [ ] 草稿创建成功(status='ready',不是 failed)
- [ ] 关键字段(原告/被告/事实和理由/诉讼请求)非 null

- [ ] **Step 5:手动验证法律助手路径(原始 bug 场景)**

访问 `http://localhost:3000/dashboard/assistant` → 创建新对话 → 输入完整案情(参考 commit 5c01203d 之前的 dev 库 ed8b94cc 失败案例:房东卖房+租客提前解约+希望继续居住或赔偿) → "帮我起草起诉状" → 选模板 → 验证字段填得对。

**关键验收**:
- [ ] 草稿不再 9 秒就 failed(应该 30+ 秒生成成功)
- [ ] 字段非 null 比例 ≥ 80%(17 字段中至少 14 个填实)
- [ ] 事实和理由 / 诉讼请求 / 原告 / 被告 四个字段必填实,且用上了对话信息

- [ ] **Step 6:手动验证文书生成入口**

访问 `http://localhost:3000/dashboard/document/templates` → 选《民事起诉状》 → 进入文书工作区 → 跟 documentMain 对话讲案情 → 验证字段填好。

记录验证结果:
- [ ] documentMain 直接接管对话
- [ ] 对话后字段被填好(通过 update 或 save 工具)

- [ ] **Step 7:跑 5 次起诉状起草定量验收**

按 spec §10.2 要求,通过法律助手起草起诉状 5 次,记录:
- [ ] ≥ 4 次 status='ready'(占比 ≥ 80%)
- [ ] 每次成功草稿字段非 null 比例 ≥ 80%
- [ ] 事实和理由 / 诉讼请求 / 原告 三个核心字段必非 null

**字段非 null 比例的验证方法**(每次起草后跑一次):

```bash
# 替换 <draftId> 为本次起草的 draftId
DRAFT_ID=<draftId>
docker exec postgres-postgres-1 psql -U daixin -d ls_new -c "
SELECT
  d.id,
  d.status,
  jsonb_array_length(t.placeholders) AS total_fields,
  (SELECT COUNT(*) FROM jsonb_each(d.values) WHERE value::text NOT IN ('null', '\"\"')) AS filled_fields,
  ROUND(
    (SELECT COUNT(*) FROM jsonb_each(d.values) WHERE value::text NOT IN ('null', '\"\"')) * 100.0
    / NULLIF(jsonb_array_length(t.placeholders), 0),
    1
  ) AS fill_pct,
  d.values->'事实和理由' AS facts,
  d.values->'诉讼请求' AS claims,
  d.values->'原告' AS plaintiff
FROM document_drafts d
JOIN document_templates t ON d.template_id = t.id
WHERE d.id = $DRAFT_ID;
"
```

Expected: `fill_pct >= 80.0`,`facts / claims / plaintiff` 三个字段都不是 null。

- [ ] **Step 8:停止 dev server**

```bash
pkill -f "nuxt dev" || true
```

- [ ] **Step 9:Commit 验证记录**

```bash
git commit --allow-empty -m "test(manual): 三入口手动验证通过,法律助手起诉状 5 次 ≥ 4 次 ready"
```

---

### Task 2.12:spike C2 验证(systemPrompt 跨轮次 values 感知)

**目的**:确认 LLM 在 update_document_draft 改字段后下一轮对话能感知最新 values。

- [ ] **Step 1:启动 dev server,进入文书工作区**

跟 Task 2.11 步骤一样启动 dev server 进入一份已起草草稿。

- [ ] **Step 2:触发 update**

在文书页对话窗输入"被告住址改成 北京市朝阳区建国路 100 号"。

观察:
- documentMain 调 update_document_draft 工具
- 工具返回 changedFields=['被告住址']
- 字段表单刷新显示新值

- [ ] **Step 3:跨轮次验证(量化判断)**

继续输入"原告联系电话填 13800138000",观察 documentMain 是否调 update_document_draft 工具更新字段。
然后再输入"我的住址刚才说错了,改成上海市浦东新区世纪大道 200 号"。

**通过判断标准(以下任一满足即通过)**:
- LLM 第三轮回复中**明确引用**已填字段值,例如:"我注意到您刚才填的原告联系电话是 13800138000……"
- LLM 调 update_document_draft 时只传"原告住址"(说明它知道"原告联系电话已经填过了,不需要改")
- 字段表单显示"原告住址"被改为新值,"原告联系电话"保持 13800138000 不变

**失败判断标准(以下任一满足即失败)**:
- LLM 在第三轮再次询问"请提供原告联系电话"(已填字段被重复问)
- LLM 调 save_document_draft(而不是 update),把所有字段重新写一遍,且其中"原告联系电话"被覆盖为 null 或丢失
- 字段表单中"原告联系电话"在第三轮后变成 null

- [ ] **Step 4:记录结果**

按 Step 3 标准明确记录通过 / 失败。

- [ ] **Step 5:Commit spike 结论**

通过情况:

```bash
git commit --allow-empty -m "spike(C2): 通过 - systemPrompt 启动时注入 currentValuesJSON 足够,LLM 跨轮次感知正确"
```

或失败情况:

```bash
git commit --allow-empty -m "spike(C2): 失败 - LLM 跨轮次看不到最新 values,优先评估 beforeAgent middleware 升级"
```

> **若 spike 失败**:优先评估 `documentDraftContextMiddleware` 升级方案(beforeAgent hook,每轮从 DB 读最新 draft.values 注入 HumanMessage,参考 `moduleContextBuilder` 模式)。
> - 评估通过且实施简单(< 1 天):在 Stage 4 加新 task 实施
> - 评估发现实施代价大或不确定:暂不强制升级,在 plan 末尾的"已知待优化"清单记录,后续迭代实施
> - 用户在文书页改字段 Agent 看不到 = 核心体验影响,但非 blocker(用户可以重新对话让 Agent 自己 update)

---

### Task 2.13:写 e2e 测试

**Files:**
- Create: `tests/e2e/document-draft-via-assistant.spec.ts`

- [ ] **Step 1:创建 e2e 测试**

创建 `tests/e2e/document-draft-via-assistant.spec.ts`:

```typescript
/**
 * 端到端:法律助手起草起诉状(原始 bug 路径)
 *
 * 用 chrome-devtools MCP 跑真实浏览器,验证三入口共享同一组工具的行为一致。
 * 主要覆盖法律助手对话 → 调起草 → 选模板 → 字段被填好的全流程。
 */

import { describe, it, expect } from 'vitest'

// 注:具体 e2e 框架如何调用 chrome-devtools MCP 工具,参考项目其他 e2e spec
// 这里给出测试逻辑骨架,实施时按现有 e2e 范式补充

describe.skip('e2e: 法律助手起草起诉状', () => {
    it('完整流程:对话讲案情 → 起草 → 选模板 → 草稿 ready', async () => {
        // 1. 启动浏览器,登录测试账号
        // 2. 访问 /dashboard/assistant
        // 3. 输入完整案情(房屋租赁纠纷)
        // 4. 等 LLM 回复
        // 5. 输入"帮我起草起诉状"
        // 6. 等 TemplateSelectCard 出现
        // 7. 选《民事起诉状(公民提起民事诉讼用)》提交
        // 8. 等草稿生成完成(SSE event DRAFT_SAVED)
        // 9. 跳转到 /dashboard/document/drafts/<id>
        // 10. 验证 draft.status='ready'
        // 11. 验证关键字段非 null

        expect(true).toBe(true) // 占位,实施时填充真实逻辑
    })
})
```

> 注:测试当前 `describe.skip`,真实 e2e 实施需要参考项目其他 e2e spec(若有 chrome-devtools MCP 集成)的模板。如果 e2e 基建没就绪,这个 task 可以延后到 stage 4 或独立做,不阻塞主链路。

- [ ] **Step 2:跑测试(skip 应该自动通过)**

```bash
npx vitest run tests/e2e/document-draft-via-assistant.spec.ts --reporter=verbose
```

Expected: 1 个 skipped。

- [ ] **Step 3:Commit**

```bash
git add tests/e2e/document-draft-via-assistant.spec.ts
git commit -m "test(e2e): 法律助手起草起诉状 e2e 骨架(待 chrome-devtools MCP 基建到位后填充)"
```

---

## Stage 3:清理旧反模式代码

### Task 3.1:删除 draft_document 工具注册 + 删 4 个反模式文件

**Files:**
- Modify: `server/services/agent-platform/tools/index.ts`(删 draft_document)
- Modify: `server/services/workflow/middleware/index.ts`(删 export)
- Delete: 5 个文件

- [ ] **Step 1:改 tools/index.ts 删 draft_document 注册**

修改 `server/services/agent-platform/tools/index.ts`:
- 删除 `import * as draftDocumentTool from './draftDocument.tool'` 行
- 删除 `toolModules` map 里的 `draft_document: draftDocumentTool,` 行

- [ ] **Step 2:改 workflow/middleware/index.ts 删 export**

修改 `server/services/workflow/middleware/index.ts`:
- 删除第 16 行 `export { draftResultPersistenceMiddleware } from './draftResultPersistence.middleware'`

- [ ] **Step 3:删 5 个反模式文件**

```bash
rm /Users/daixin/work/dev/LexSeek/LexSeek/server/services/agent-platform/tools/draftDocument.tool.ts
rm /Users/daixin/work/dev/LexSeek/LexSeek/server/agents/document/middleware/draftResultPersistence.middleware.ts
rm /Users/daixin/work/dev/LexSeek/LexSeek/server/services/workflow/middleware/draftResultPersistence.middleware.ts
rm /Users/daixin/work/dev/LexSeek/LexSeek/server/agents/document/draftSchema.builder.ts
rm /Users/daixin/work/dev/LexSeek/LexSeek/server/services/assistant/document/draftSchema.builder.ts
```

- [ ] **Step 4:跑 typecheck**

```bash
bun run typecheck 2>&1 | tail -30
```

Expected: 零错(此时若有遗漏 import 会立即暴露)。如有错,按编译错误修。

- [ ] **Step 5:Commit**

```bash
git add -A
git commit -m "chore(agent-platform): 删除 draftDocument.tool 反模式 + draftResultPersistence + draftSchema.builder"
```

---

### Task 3.2:删除 3 个过时测试

**Files:**
- Delete: 3 个测试文件

- [ ] **Step 1:删除测试**

```bash
rm /Users/daixin/work/dev/LexSeek/LexSeek/tests/server/assistant/document/draftResultPersistence.middleware.test.ts
rm /Users/daixin/work/dev/LexSeek/LexSeek/tests/server/workflow/middleware/draftResultPersistence.test.ts
rm /Users/daixin/work/dev/LexSeek/LexSeek/tests/server/assistant/document/draftSchema.builder.test.ts
rm /Users/daixin/work/dev/LexSeek/LexSeek/tests/server/agent-platform/tools/draftDocument.test.ts
```

- [ ] **Step 2:跑全套测试**

```bash
bun run test 2>&1 | tail -20
```

Expected: 全部 PASS,无任何 fail/error。

- [ ] **Step 3:跑覆盖率**

```bash
bun run coverage 2>&1 | tail -10
```

Expected: `agent-platform/**` 覆盖率 ≥ 90%。

- [ ] **Step 4:Commit**

```bash
git add -A
git commit -m "test: 删除随旧代码移除的过期测试(draftResultPersistence / draftSchema / draftDocument)"
```

---

### Task 3.3:验证 structuredResponse 全库零引用

**Files:** 无(只验证)

- [ ] **Step 1:全库 grep**

```bash
grep -rn "structuredResponse" /Users/daixin/work/dev/LexSeek/LexSeek/server /Users/daixin/work/dev/LexSeek/LexSeek/app /Users/daixin/work/dev/LexSeek/LexSeek/shared --include="*.ts" --include="*.vue" 2>/dev/null | grep -v node_modules
```

Expected: 输出为空(零引用)。

- [ ] **Step 2:Commit 验证记录**

```bash
git commit --allow-empty -m "verify: structuredResponse 全库引用清零,旧 toolStrategy 路径完全移除"
```

---

## Stage 4:配套清理

### Task 4.1:修 repairOrphanToolUseCheckpoint SQL schema 前缀

**Files:**
- Modify: `server/services/workflow/repairOrphanToolUse.ts`

- [ ] **Step 1:确认告警**

```bash
grep -n "FROM checkpoints\|UPDATE checkpoint_blobs" /Users/daixin/work/dev/LexSeek/LexSeek/server/services/workflow/repairOrphanToolUse.ts
```

Expected: 看到 4 处 SQL 没有 `langgraph.` schema 前缀(行 333/365/381/416)。

- [ ] **Step 2:加 schema 前缀**

修改 `server/services/workflow/repairOrphanToolUse.ts` 行 333,把 `FROM checkpoints` 改成 `FROM langgraph.checkpoints`。同样处理:
- 行 365:`FROM checkpoints` → `FROM langgraph.checkpoints`
- 行 381:`FROM checkpoint_blobs` → `FROM langgraph.checkpoint_blobs`
- 行 416:`UPDATE checkpoint_blobs` → `UPDATE langgraph.checkpoint_blobs`

- [ ] **Step 3:跑 repair 测试(若有)**

```bash
npx vitest run tests/server/workflow/repairOrphanToolUse.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: 通过(若无对应测试,跳过)。

- [ ] **Step 4:验证日志告警消失**

启动 dev server,触发一次 documentMain 流程,观察日志:

```bash
bun dev > /tmp/dev-after.log 2>&1 &
sleep 15
grep "Lazy repair.*整体失败" /tmp/dev-after.log
pkill -f "nuxt dev"
```

Expected: 日志中不再有 `Lazy repair 整体失败:relation "checkpoints" does not exist` 告警。

- [ ] **Step 5:Commit**

```bash
git add server/services/workflow/repairOrphanToolUse.ts
git commit -m "fix(workflow): repairOrphanToolUseCheckpoint SQL 加 langgraph schema 前缀,清告警"
```

---

### Task 4.2:更新技术文档

**Files:**
- Modify: `docs/tech-docs/backend/agent-platform.md`
- Modify: `docs/tech-docs/backend/workflow.md`(若有相关说明)

- [ ] **Step 1:更新 agent-platform.md**

打开 `docs/tech-docs/backend/agent-platform.md`,加一段说明 documentMain 是平级 Agent:

```markdown
## documentMain 是平级 Agent(2026-05-05 修正)

documentMain 不再是"被 draft_document 工具嵌套调用的子 Agent",而是跟 caseMain /
assistantMain 同构的平级主 Agent。三个 Agent 都挂 legal-document-writer skill,
通过 recommend_template / save_document_draft / update_document_draft 三个无会话
纯函数工具协作起草文书。

详见 `docs/superpowers/specs/2026-05-05-document-agent-tool-refactor-design.md`。
```

- [ ] **Step 2:更新 workflow.md(若有反模式描述)**

打开 `docs/tech-docs/backend/workflow.md`,搜索 `draft_document` / `runDocumentChat` 相关段落,删除"工具同步嵌套子 Agent"等过时描述。如无相关段落,跳过。

- [ ] **Step 3:Commit 文档更新**

```bash
git add docs/tech-docs/backend/agent-platform.md docs/tech-docs/backend/workflow.md
git commit -m "docs(tech-docs): 更新 agent-platform / workflow 文档反映 documentMain 平级架构"
```

- [ ] **Step 4:边缘测试 mock 修复 checklist**(按需,只改实际 fail 的)

跑一次 `bun run test` 看是否有以下三个测试因新架构 fail,逐一处理:

- [ ] `tests/server/workflow/threadState.test.ts` — 若 fail,通常是 documentMain mock 仍假设有 toolStrategy/responseFormat。改成普通 ReAct mock
- [ ] `tests/app/components/ai/AiToolRenderer.test.ts` — 若 fail,通常是工具卡渲染断言依赖 `draft_document` 名。加上新 3 工具卡(`recommend_template` / `save_document_draft` / `update_document_draft`)的渲染断言
- [ ] `tests/server/assistant/document/documentDraft.service.test.ts` — Task 2.10 已处理,无需再动

每修一个跑一次对应测试确认通过。**所有都不 fail 则跳过本步**。

- [ ] **Step 5:Commit 边缘测试修(若有改动)**

```bash
git add -A
git status --short  # 确认只动了上述 checklist 文件
git commit -m "test: 修复新架构对边缘测试的影响(若有)"
```

---

### Task 4.3:最终全套验证

**Files:** 无

- [ ] **Step 1:typecheck 零错**

```bash
bun run typecheck 2>&1 | tail -5
```

Expected: 无错误输出。

- [ ] **Step 2:全套测试通过**

```bash
bun run test 2>&1 | tail -20
```

Expected: 全部 PASS。

- [ ] **Step 3:覆盖率达标**

```bash
bun run coverage 2>&1 | tail -10
```

Expected: `agent-platform/**` 覆盖率 ≥ 90%。

- [ ] **Step 4:prisma migrate status 无 drift**

```bash
DATABASE_URL='postgresql://daixin@localhost:5432/ls_new?TimeZone=UTC' npx prisma migrate status
```

Expected: `Database schema is up to date!`

- [ ] **Step 5:三入口最后手动验证一次**

跟 Task 2.11 一样启动 dev server,跑三入口端到端各一次,确认:
- 小索 → 起诉状 ✓
- 法律助手 → 起诉状(原始 bug 场景) ✓
- 文书入口 → 跟 documentMain 对话 ✓

- [ ] **Step 6:验证前端零改动(spec §12.3 要求)**

```bash
# 检查 spec §12.3 列出的"零改动"前端组件确实没被本分支改过
git diff dev --stat -- \
  app/components/agents/document/interrupts/TemplateSelectCard.vue \
  app/composables/agents/useDocumentAgent.ts \
  app/composables/document/useDocumentDraftFields.ts \
  app/pages/dashboard/document/drafts/\[id\].vue \
  app/components/InterruptDispatcher.vue
```

Expected: 输出为空(以上 5 个文件零改动)。如有改动,要么是误改要回滚,要么是确实需要改要在 spec §12.3 里更新清单。

- [ ] **Step 7:Commit 最终验收**

```bash
git commit --allow-empty -m "verify: 全套验证通过 + 前端零改动确认,可合并到 dev"
```

- [ ] **Step 8:推分支(等用户合并)**

```bash
git push -u origin feature/document-agent-tool-refactor
echo "分支已推,等用户 review + 合并到 dev"
```

---

## 完成标记

全部 4 个 Stage 完成且 Task 4.3 全套验证通过后:

- [ ] 创建 PR 从 `feature/document-agent-tool-refactor` 合到 `dev` 分支
- [ ] PR 描述列出:
  - spec 链接:`docs/superpowers/specs/2026-05-05-document-agent-tool-refactor-design.md`
  - plan 链接:`docs/superpowers/plans/2026-05-05-document-agent-tool-refactor.md`
  - 5 维度审查通过记录
  - 三入口手动验证截图(若有)
  - failed 比例从 27% 降到 X%(待实测)
- [ ] 等 review approval 后合并

---

## 附录:每个 Stage 提前预读的 spec 章节

| Stage | spec 章节 | 重点 |
|---|---|---|
| Stage 0 | §10.3 | 3 个 spike 验证目标 |
| Stage 1 | §4 / §12.4 | 工具接口契约 + 文件命名映射 |
| Stage 2 | §5 / §6 | documentMain 重写 + 数据库变更 |
| Stage 3 | §7 | 删除清单 + 引用点清理 |
| Stage 4 | §11 / §12.5 | 决策记录 + 配套清理 |
