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
} from './documentDraft.dao'
import { randomUUID } from 'node:crypto'
import { enqueueRunService } from '~~/server/services/agent/agentRun.service'
import { ensureMaterialsReadyForDraftService } from '~~/server/services/material/materialPipeline.service'
import type { DocumentDraftStatus } from '#shared/types/document'

// ==================== 类型定义 ====================

/** createDraftService 参数 */
export interface CreateDraftParams {
    userId: number
    templateId: number
    sourceText?: string
    sourceFileIds?: number[]
    caseId?: number
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
    const { userId, templateId, sourceText, sourceFileIds, caseId } = params

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

    const draft = await createDocumentDraftDAO({
        userId,
        templateId,
        sessionId,
        status: 'drafting',
        values: {},
        sourceRef: Object.keys(sourceRef).length > 0 ? sourceRef : null,
        metadata: null,
        caseId: caseId ?? null,
    })

    if (sourceFileIds?.length) {
        await Promise.all(
            sourceFileIds.map(ossFileId =>
                ensureMaterialsReadyForDraftService(ossFileId, draft.id, userId),
            ),
        )
    }

    await enqueueRunService({
        sessionId,
        threadId: sessionId,
        userId,
        caseId: caseId ?? null,
        input: {},
    })

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
 */
export async function patchDraftService(
    userId: number,
    draftId: number,
    input: { values: Record<string, string | null> },
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

    const updated = await updateDocumentDraftDAO(draftId, {
        values: mergedValues as any,
    })

    return { draft: updated }
}
