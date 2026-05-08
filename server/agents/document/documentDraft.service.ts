/**
 * DocumentDraft Service
 *
 * 封装文书草稿的创建、查询、更新业务逻辑。
 * 外部依赖（DAO、enqueueRunService、ensureMaterialsReadyForDraftService）均通过 import 注入，
 * 以便测试时 mock 替换。
 *
 * 参见 spec §3.10, §4.1, §6.7, §9.2
 */

import { getDocumentTemplateDAO } from './documentTemplate.dao'
import {
    createDocumentDraftDAO,
    getDocumentDraftDAO,
    updateDocumentDraftDAO,
    softDeleteDocumentDraftDAO,
    updateDraftTitleDAO,
    updateDraftTitleIfNotOverriddenDAO,
} from './documentDraft.dao'
import { randomUUID } from 'node:crypto'
import dayjs from 'dayjs'
import { enqueueRunService } from '~~/server/services/agent/agentRun.service'
import { ensureMaterialsReadyForDraftService } from '~~/server/services/material/materialPipeline.service'
import type { DocumentDraftStatus } from '#shared/types/document'
import { CaseStatus } from '#shared/types/case'

// ==================== 类型定义 ====================

/** createDraftService 参数 */
export interface CreateDraftParams {
    userId: number
    templateId: number
    sourceText?: string
    sourceFileIds?: number[]
    caseId?: number
    /**
     * 是否把 documentMain 入队给 agentWorker 异步执行（默认 true）。
     * 子代理工具应传 false：tool 自己会同步调 runDocumentChat，让 worker
     * 也跑会形成「同 thread_id 双实例并发」，afterAgent hook 互相覆写 draft.values。
     */
    enqueueAgentRun?: boolean
}

/** 服务层统一错误返回 */
export interface ServiceError {
    error: string
    code: number
}

// ==================== createDraftService ====================

/**
 * 创建文书草稿主流程。
 * scope=user 模板只有所有者可用；sourceFileIds 并行预处理后入队 Worker。
 */
export async function createDraftService(
    params: CreateDraftParams,
): Promise<{ draftId: number; sessionId: string } | ServiceError> {
    const { userId, templateId, sourceText, sourceFileIds, caseId, enqueueAgentRun = true } = params

    const template = await getDocumentTemplateDAO(templateId)
    if (!template) {
        return { error: '模板不存在', code: 404 }
    }

    // scope=user 时只有模板所有者可使用；scope=global 无限制
    if (template.scope === 'user' && template.userId !== userId) {
        return { error: '无权使用此模板', code: 403 }
    }

    // 直接创建 scope='document' 的 caseSession（不复用 createAssistantSessionDAO，后者会硬编码 scope='assistant'
    // 导致 agentWorker 错误路由到 runAssistantChat 通用助手）
    const session = await prisma.caseSessions.create({
        data: {
            sessionId: randomUUID(),
            scope: 'document',
            userId,
            caseId: caseId ?? null,
            type: 1,
            status: 1,
            title: template.name,
        },
    })
    const sessionId = session.sessionId

    const sourceRef: Record<string, unknown> = {}
    if (sourceText) sourceRef.text = sourceText
    if (sourceFileIds?.length) sourceRef.fileIds = sourceFileIds
    if (caseId !== undefined) sourceRef.caseId = caseId

    // 是否提供了原始材料（文本或文件）：决定是否立即触发 Agent 提取
    // 没有材料时（用户从模板直接进入工作区手填或后续再用 AI 补填），不提前入队，
    // 避免 Agent 在没有任何输入的情况下空跑产出无用消息
    const hasSource = !!sourceText || (sourceFileIds?.length ?? 0) > 0

    const defaultTitle = `${template.name}-${dayjs().format('YYMMDD')}`

    const draft = await createDocumentDraftDAO({
        userId,
        templateId,
        sessionId,
        status: hasSource ? 'drafting' : 'ready',
        values: {},
        sourceRef: Object.keys(sourceRef).length > 0 ? sourceRef : null,
        metadata: null,
        caseId: caseId ?? null,
        title: defaultTitle,
        titleOverridden: false,
    })

    if (sourceFileIds?.length) {
        // 透传 draft.caseId，让 caseMaterials 形成 (caseId+draftId+ossFileId) 双绑
        await Promise.all(
            sourceFileIds.map(ossFileId =>
                ensureMaterialsReadyForDraftService(ossFileId, draft.id, userId, draft.caseId ?? null),
            ),
        )
    }

    if (hasSource && enqueueAgentRun) {
        await enqueueRunService({
            sessionId,
            threadId: sessionId,
            userId,
            caseId: caseId ?? null,
            input: {},
        })
    }

    return { draftId: draft.id, sessionId }
}

// ==================== getDraftService ====================

/** 查询草稿详情，校验归属权后返回 draft 记录。 */
export async function getDraftService(
    userId: number,
    draftId: number,
): Promise<{ draft: any } | ServiceError> {
    const draft = await getDocumentDraftDAO(draftId)
    if (!draft) {
        return { error: '草稿不存在', code: 404 }
    }

    if (draft.userId !== userId) {
        return { error: '无权访问此草稿', code: 403 }
    }

    return { draft }
}

// ==================== patchDraftService ====================

/**
 * 更新草稿 values。drafting/filling 状态拒绝修改（409）。
 * 仅保留 template.placeholders 中定义的 key，多余 key 忽略，缺失 key 保留原值。
 *
 * 可选 metadata 参数：工具一次写入 values + suggestions 等元数据时使用。
 * metadata 与 draft.metadata 现有键合并（spread），不覆盖未传的旧键。
 */
export async function patchDraftService(
    userId: number,
    draftId: number,
    input: {
        values: Record<string, string | null>
        metadata?: Record<string, unknown>
    },
): Promise<{ draft: any } | ServiceError> {
    const draft = await getDocumentDraftDAO(draftId)
    if (!draft) {
        return { error: '草稿不存在', code: 404 }
    }

    if (draft.userId !== userId) {
        return { error: '无权修改此草稿', code: 403 }
    }

    // drafting/filling 时 Agent 仍在运行，拒绝并发修改
    if ((draft.status as DocumentDraftStatus) === 'drafting' || (draft.status as DocumentDraftStatus) === 'filling') {
        return { error: '草稿正在生成中，请稍后再修改', code: 409 }
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

    // 构造 update 入参，可选写入 metadata（合并 draft.metadata 现有键，不覆盖未传的旧键）
    const updateData: { values: any; metadata?: any } = { values: mergedValues as any }
    if (input.metadata !== undefined) {
        const existingMetadata = (draft.metadata as Record<string, unknown> | null) ?? {}
        updateData.metadata = { ...existingMetadata, ...input.metadata }
    }

    const updated = await updateDocumentDraftDAO(draftId, updateData as any)

    return { draft: updated }
}

// ==================== linkDraftToCaseService ====================

/**
 * 关联 / 解绑文书草稿到案件。
 *
 * 阶段 5 · 法律助手「+ 关联案件」入口：用户在文书页顶部"来源条"点关联，
 * 选定案件后调用此接口写入 draft.caseId；caseId=null 表示解绑。
 *
 * 校验：
 * - 草稿必须归属当前用户（owner-only）
 * - caseId 非 null 时：案件必须归属当前用户 + 未软删 + 非已归档
 *
 * 注意：drafting/filling 状态不阻塞关联（用户在 Agent 跑的同时也可能想绑案件），
 * 仅 patchDraftService 写入 values 时才校验运行态。
 */
export async function linkDraftToCaseService(
    userId: number,
    draftId: number,
    caseId: number | null,
): Promise<{ draft: any } | ServiceError> {
    const draft = await getDocumentDraftDAO(draftId)
    if (!draft) return { error: '草稿不存在', code: 404 }
    if (draft.userId !== userId) return { error: '无权修改此草稿', code: 403 }

    if (caseId !== null) {
        const caseRow = await prisma.cases.findFirst({
            where: { id: caseId, userId, deletedAt: null },
            select: { id: true, status: true },
        })
        if (!caseRow) return { error: '案件不存在或无权访问', code: 403 }
        if (caseRow.status === CaseStatus.ARCHIVED) {
            return { error: '案件已归档，不可关联', code: 409 }
        }
    }

    const updated = await updateDocumentDraftDAO(draftId, { caseId } as any)
    return { draft: updated }
}

// ==================== deleteDraftService ====================

/**
 * 软删除草稿：仅归属用户可删除。
 * 在 DAO 层通过 deletedAt=now 实现软删，getDocumentDraftDAO / listDocumentDraftsDAO 不再返回。
 */
export async function deleteDraftService(
    userId: number,
    draftId: number,
): Promise<{ ok: true } | ServiceError> {
    const draft = await getDocumentDraftDAO(draftId)
    if (!draft) {
        return { error: '草稿不存在', code: 404 }
    }

    if (draft.userId !== userId) {
        return { error: '无权删除此草稿', code: 403 }
    }

    // 级联：把该 draft 绑定的 case_materials 记录 draftId 置空，caseId 保留（spec §3.4 策略 A）
    // 双绑 (X, Y, Z) → (X, null, Z)：案件材料 Tab 仍可见
    // draft-only (null, Y, Z) → (null, null, Z)：兼容现状，允许孤儿态，不做额外清理
    await prisma.caseMaterials.updateMany({
        where: { draftId, deletedAt: null },
        data: { draftId: null },
    })

    await softDeleteDocumentDraftDAO(draftId)
    return { ok: true }
}

// ==================== updateDraftTitleService ====================

/**
 * 用户主动修改标题。owner-only；DAO 内部写入时置 titleOverridden=true，AI 不再覆盖。
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

    const updated = await updateDraftTitleDAO(draftId, title)
    return { draft: updated }
}

// ==================== applyAITitleIfAllowedService ====================

/**
 * AI 应用推断标题。仅在 titleOverridden=false 时更新（DAO 内部原子 UPDATE 保证无竞态）；
 * 用户已改 / 空字符串 都跳过，返回是否真的写入。
 */
export async function applyAITitleIfAllowedService(
    draftId: number,
    aiTitle: string,
): Promise<boolean> {
    if (!aiTitle || !aiTitle.trim()) return false
    const result = await updateDraftTitleIfNotOverriddenDAO(draftId, aiTitle.trim())
    return result != null
}
