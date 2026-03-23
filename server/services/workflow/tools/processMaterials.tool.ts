/**
 * 材料处理工具
 *
 * 检查材料状态、触发识别/嵌入、从各识别记录表获取实际内容、
 * 评估 token 量决定提供模式（全量/摘要）
 */

import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import type { ToolDefinition, ToolContext } from './types'
import { getMaterialsByCaseIdService } from '../../material/material.service'
import { batchCheckMaterialEmbeddedService } from '../../material/materialEmbedding.service'
import { ensureMaterialsEmbeddedService } from '../../material/materialProcess.service'

const TOKEN_THRESHOLD = 32000

/** 简单 token 估算（中文约 2 字符/token，英文约 4 字符/token） */
function estimateTokens(text: string): number {
    if (!text) return 0
    const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length
    const otherChars = text.length - chineseChars
    return Math.ceil(chineseChars / 2 + otherChars / 4)
}

/**
 * 从各识别记录表获取材料的实际内容
 *
 * caseMaterials 表只有元信息，内容分散在：
 * - 文本(1): textContentRecords.content (按 materialId)
 * - 文档(2): docRecognitionRecords.markdownContent (按 ossFileId)
 * - 图片(3): imageRecognitionRecords.markdownContent (按 ossFileId)
 * - 音频(4): asrRecords.summary (按 ossFileId)
 */
async function fetchMaterialContents(
    materials: { id: number; type: number; ossFileId: number | null }[]
): Promise<Map<number, string>> {
    const contentMap = new Map<number, string>()

    const textMaterials = materials.filter(m => m.type === 1)
    const docMaterials = materials.filter(m => m.type === 2 && m.ossFileId)
    const imgMaterials = materials.filter(m => m.type === 3 && m.ossFileId)
    const audioMaterials = materials.filter(m => m.type === 4 && m.ossFileId)

    const queries: Promise<void>[] = []

    // 文本材料：从 textContentRecords 获取
    if (textMaterials.length > 0) {
        queries.push(
            prisma.textContentRecords.findMany({
                where: {
                    materialId: { in: textMaterials.map(m => m.id) },
                    content: { not: null },
                    deletedAt: null,
                },
                select: { materialId: true, content: true },
            }).then(records => {
                for (const r of records) {
                    if (r.materialId && r.content) {
                        contentMap.set(r.materialId, r.content)
                    }
                }
            })
        )
    }

    // 文档材料：从 docRecognitionRecords 获取
    if (docMaterials.length > 0) {
        const ossFileIdToMaterialId = new Map(docMaterials.map(m => [m.ossFileId!, m.id]))
        queries.push(
            prisma.docRecognitionRecords.findMany({
                where: {
                    ossFileId: { in: [...ossFileIdToMaterialId.keys()] },
                    markdownContent: { not: null },
                    deletedAt: null,
                },
                select: { ossFileId: true, markdownContent: true },
                orderBy: { createdAt: 'desc' },
            }).then(records => {
                const seen = new Set<number>()
                for (const r of records) {
                    if (r.ossFileId && r.markdownContent && !seen.has(r.ossFileId)) {
                        seen.add(r.ossFileId)
                        const materialId = ossFileIdToMaterialId.get(r.ossFileId)
                        if (materialId) contentMap.set(materialId, r.markdownContent)
                    }
                }
            })
        )
    }

    // 图片材料：从 imageRecognitionRecords 获取
    if (imgMaterials.length > 0) {
        const ossFileIdToMaterialId = new Map(imgMaterials.map(m => [m.ossFileId!, m.id]))
        queries.push(
            prisma.imageRecognitionRecords.findMany({
                where: {
                    ossFileId: { in: [...ossFileIdToMaterialId.keys()] },
                    markdownContent: { not: null },
                    deletedAt: null,
                },
                select: { ossFileId: true, markdownContent: true },
                orderBy: { createdAt: 'desc' },
            }).then(records => {
                const seen = new Set<number>()
                for (const r of records) {
                    if (r.ossFileId && r.markdownContent && !seen.has(r.ossFileId)) {
                        seen.add(r.ossFileId)
                        const materialId = ossFileIdToMaterialId.get(r.ossFileId)
                        if (materialId) contentMap.set(materialId, r.markdownContent)
                    }
                }
            })
        )
    }

    // 音频材料：从 asrRecords 获取
    if (audioMaterials.length > 0) {
        const ossFileIdToMaterialId = new Map(audioMaterials.map(m => [m.ossFileId!, m.id]))
        queries.push(
            prisma.asrRecords.findMany({
                where: {
                    ossFileId: { in: [...ossFileIdToMaterialId.keys()] },
                    summary: { not: null },
                    deletedAt: null,
                },
                select: { ossFileId: true, summary: true },
                orderBy: { createdAt: 'desc' },
            }).then(records => {
                const seen = new Set<number>()
                for (const r of records) {
                    if (r.ossFileId && r.summary && !seen.has(r.ossFileId)) {
                        seen.add(r.ossFileId)
                        const materialId = ossFileIdToMaterialId.get(r.ossFileId)
                        if (materialId) contentMap.set(materialId, r.summary)
                    }
                }
            })
        )
    }

    await Promise.all(queries)
    return contentMap
}

const schema = z.object({})

export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'process_materials',
    description: '检查并处理当前案件的所有材料。检查材料识别和嵌入状态，触发未完成的处理，评估 token 量决定提供模式（全量/摘要）。在开始分析前调用此工具。',
    schema,
}

export function createTool(context: ToolContext) {
    const { userId, caseId } = context

    return tool(
        async () => {
            logger.info('执行材料处理工具', { userId, caseId })

            try {
                // 1. 获取案件所有材料元信息
                const materials = await getMaterialsByCaseIdService(caseId)
                if (materials.length === 0) {
                    return JSON.stringify({
                        mode: 'empty',
                        message: '当前案件没有任何材料，请先上传案件材料。',
                        materials: [],
                    })
                }

                // 2. 检查嵌入状态，触发未完成的识别/嵌入
                const embeddedMap = await batchCheckMaterialEmbeddedService(
                    materials.map(m => m.id)
                )
                const notEmbedded = materials.filter(m => !embeddedMap.get(m.id))
                if (notEmbedded.length > 0) {
                    await ensureMaterialsEmbeddedService(notEmbedded, userId)
                }

                // 3. 从各识别记录表获取实际内容
                const contentMap = await fetchMaterialContents(materials)

                // 4. 计算总 token 量
                let totalTokens = 0
                for (const content of contentMap.values()) {
                    totalTokens += estimateTokens(content)
                }

                // 5. 决定提供模式
                const isFullMode = totalTokens < TOKEN_THRESHOLD

                const materialList = materials.map(m => {
                    const content = contentMap.get(m.id)
                    return {
                        id: m.id,
                        name: m.name,
                        type: m.type,
                        tokenCount: content ? estimateTokens(content) : 0,
                        hasContent: !!content,
                        embedded: embeddedMap.get(m.id) ?? false,
                        ...(isFullMode && content
                            ? { content }
                            : { summary: m.summary || (content ? content.substring(0, 200) + '...' : `[材料: ${m.name}，暂无内容]`) }),
                    }
                })

                const result = {
                    mode: isFullMode ? 'full' : 'summary',
                    totalTokens,
                    threshold: TOKEN_THRESHOLD,
                    materialCount: materials.length,
                    materialsWithContent: contentMap.size,
                    materials: materialList,
                    ...(isFullMode
                        ? {}
                        : {
                            hint: '材料量较大，已提供摘要。需要详细内容时请使用 search_case_materials 工具按需检索。',
                        }),
                }

                logger.info('材料处理完成', {
                    caseId,
                    mode: result.mode,
                    totalTokens,
                    materialCount: materials.length,
                    materialsWithContent: contentMap.size,
                })

                return JSON.stringify(result)
            } catch (error) {
                logger.error('材料处理失败:', error)
                return JSON.stringify({
                    error: '材料处理失败',
                    message: error instanceof Error ? error.message : '未知错误',
                })
            }
        },
        {
            name: toolDefinition.name,
            description: toolDefinition.description,
            schema: toolDefinition.schema,
        }
    )
}
