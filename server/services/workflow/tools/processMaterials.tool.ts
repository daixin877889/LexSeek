/**
 * 材料处理工具
 *
 * 检查材料状态、触发识别/嵌入、从各识别记录表获取实际内容、
 * 评估 token 量决定提供模式（全量/摘要）
 *
 * 两种上下文模式：
 * - caseId（小索/案件分析）：扫案件下全部材料。行为保持不变。
 * - draftId（文书生成）：扫 draft 下关联材料；可传 fileIds 仅处理本次新加的文件。
 */

import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import type { ToolDefinition, ToolContext } from './types'
import {
    ensureMaterialsReadyService,
    ensureMaterialsReadyByDraftService,
    getMaterialContextService,
    estimateTokens,
    getSourceId,
    TOKEN_THRESHOLD,
} from '../../material/materialPipeline.service'
import { countTokensSync } from '~~/server/utils/tokenCounter'

/**
 * 工具返回 JSON payload 的绝对硬上限（tokens，tiktoken 估算）。
 *
 * 这是端到端兜底：无论内容/摘要分档如何，最终序列化成 ToolMessage 的 JSON 都不得超过此值。
 * 超出时从优先级最低（数组尾部）开始，逐份降级为索引模式（只保留名称/类型，summary 改为索引提示）。
 * 25K 兼顾了：DeepSeek 128K 窗口下给 systemPrompt/tools/思考/输出留 100K+ 余量。
 */
const TOOL_PAYLOAD_HARD_CAP = 25000

/** 索引模式文案：告诉 AI 这份材料存在但内容已压缩，要按关键字检索 */
const INDEX_MODE_HINT = '[内容已压缩，请使用 search_case_materials 工具按材料名或关键字检索完整内容]'

const schema = z.object({
    fileIds: z.array(z.number().int().positive()).optional().describe('可选：仅处理这些 OSS 文件 ID（不传则处理当前上下文下的全部材料）'),
})

export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'process_materials',
    description: '检查并处理当前案件或文书草稿的材料。触发未完成的识别和嵌入，评估 token 量决定提供模式（全量/摘要）。在开始分析或回填字段前调用此工具；文书生成场景可传 fileIds 精确处理本轮新增文件。',
    schema,
}

export function createTool(context: ToolContext) {
    const { userId, caseId, draftId } = context

    return tool(
        async (input) => {
            const fileIds = input?.fileIds
            logger.info('执行材料处理工具', { userId, caseId, draftId, fileIds })

            try {
                if (caseId == null && draftId == null) {
                    throw new Error('process_materials 工具需要 caseId 或 draftId，当前上下文均缺失')
                }

                // 1. 按优先级选择批处理入口（draftId 优先，保持小索/案件路径原样）
                const ready = draftId != null
                    ? await ensureMaterialsReadyByDraftService(draftId, userId, { fileIds, caseId: caseId ?? null })
                    : await ensureMaterialsReadyService(caseId!, userId)
                const { materials, embeddedMap } = ready

                if (materials.length === 0) {
                    return JSON.stringify({
                        mode: 'empty',
                        message: draftId != null
                            ? '当前文书草稿还没有材料，请先在输入框里上传/选择文件。'
                            : '当前案件没有任何材料，请先上传案件材料。',
                        materials: [],
                    })
                }

                // 2. 获取材料上下文（自动判断 full/summary 模式）
                const materialContext = await getMaterialContextService(materials)

                // 3. 在 context.materialList 基础上补充 tool 特有字段
                const materialList = materialContext.materialList.map(m => {
                    // 反向映射 sourceId→materialId 以查找 embeddedMap
                    const material = materials.find(mat => getSourceId(mat) === m.sourceId)
                    // tokenCount 必须反映返回 payload 中该项实际占用的 tokens：
                    // full 模式 → content 的 tokens；summary 模式 → summary 的 tokens；
                    // 否则 totalTokens 与真实发送量严重脱节（不计 summary 部分）。
                    const payloadText = m.mode === 'full' ? m.content : m.summary ?? ''
                    return {
                        ...m,
                        id: material?.id,
                        tokenCount: payloadText ? estimateTokens(payloadText) : 0,
                        embedded: material ? (embeddedMap.get(material.id) ?? false) : false,
                    }
                })

                const result = {
                    mode: materialContext.mode,
                    totalTokens: materialContext.totalTokens,
                    threshold: TOKEN_THRESHOLD,
                    materialCount: materials.length,
                    materialsWithContent: materialList.filter(m => m.hasContent).length,
                    materials: materialList,
                    ...(materialContext.mode !== 'full'
                        ? {
                            hint: '材料量较大，已提供摘要。需要详细内容时请使用 search_case_materials 工具按需检索。',
                        }
                        : {}),
                }

                // 端到端硬封顶：对最终序列化 JSON 做 token 计数，超过 TOOL_PAYLOAD_HARD_CAP 时
                // 从优先级最低（materials 数组尾部）开始逐份降级为索引模式。
                // 这是工具 payload 的最后一道防线——一旦通过此处，ToolMessage 的体积就可控。
                const finalResult = enforceTokenCap(result, TOOL_PAYLOAD_HARD_CAP)
                const finalJson = JSON.stringify(finalResult)

                logger.info('材料处理完成', {
                    caseId,
                    draftId,
                    mode: finalResult.mode,
                    totalTokens: materialContext.totalTokens,
                    materialCount: materials.length,
                    materialsWithContent: finalResult.materialsWithContent,
                    payloadTokens: countTokensSync(finalJson),
                    indexModeCount: (finalResult.materials as Array<{ mode: string }>).filter(m => m.mode === 'index').length,
                })

                return finalJson
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

/**
 * 材料列表单项（供 enforceTokenCap 使用的最小结构约束）。
 * 匹配 processMaterials 返回 materialList 的运行时形状，含 tool 层补充字段。
 */
interface MaterialItem {
    sourceId: number
    name: string
    type: number
    hasContent: boolean
    mode: 'full' | 'summary' | 'index'
    content?: string
    summary?: string
    id?: number
    tokenCount: number
    embedded: boolean
}

/**
 * 对最终返回的 result 做 payload token 封顶。
 *
 * 策略：
 * 1. 一次性序列化 + tokenize，拿到 baseline。若未超 cap 直接返回。
 * 2. 按 tokenCount 反推要省多少 tokens、降级多少份。从数组尾部（优先级最低）开始批量降级。
 *    每份降级的 token 节省量 = 该份原 tokenCount - INDEX_MODE_HINT 的 tokens。
 * 3. 降级完成后再 tokenize 一次做最终校核；如仍超 cap，继续降级若干份（最多补 2 轮，避免死循环）。
 *
 * 相比每次循环都全量 tokenize（N 份 × 每次 O(JSON 大小)），此处只 tokenize 2-3 次，百份材料也在毫秒级完成。
 */
function enforceTokenCap(
    result: {
        mode: string
        totalTokens: number
        threshold: number
        materialCount: number
        materialsWithContent: number
        materials: MaterialItem[]
        hint?: string
    },
    capTokens: number,
): typeof result {
    const materials = result.materials.map(m => ({ ...m })) // 浅拷贝，避免污染上游
    const initialSerialized = JSON.stringify({ ...result, materials })
    const initialTokens = countTokensSync(initialSerialized)
    if (initialTokens <= capTokens) return { ...result, materials }

    const INDEX_TOKENS = estimateTokens(INDEX_MODE_HINT)

    const downgradeItem = (m: MaterialItem): MaterialItem => ({
        sourceId: m.sourceId,
        name: m.name,
        type: m.type,
        hasContent: m.hasContent,
        mode: 'index',
        summary: INDEX_MODE_HINT,
        id: m.id,
        tokenCount: INDEX_TOKENS,
        embedded: m.embedded,
    })

    // 第一轮：按 tokenCount 估算一次性降级到刚好达标；乘以 1.1 留 10% 安全余量覆盖 JSON 结构开销
    let tokensToSave = (initialTokens - capTokens) * 1.1
    for (let i = materials.length - 1; i >= 0 && tokensToSave > 0; i--) {
        const m = materials[i]
        if (!m || m.mode === 'index') continue
        const saved = (m.tokenCount || 0) - INDEX_TOKENS
        if (saved <= 0) continue
        materials[i] = downgradeItem(m)
        tokensToSave -= saved
    }

    // 第二轮：重新 tokenize 校核；若仍超，继续降级直到满足或全部降完
    let finalTokens = countTokensSync(JSON.stringify({ ...result, materials }))
    if (finalTokens > capTokens) {
        for (let i = materials.length - 1; i >= 0; i--) {
            const m = materials[i]
            if (!m || m.mode === 'index') continue
            materials[i] = downgradeItem(m)
            // 每降 10 份才重新 tokenize 一次，平衡精确与性能
            if (i % 10 === 0) {
                finalTokens = countTokensSync(JSON.stringify({ ...result, materials }))
                if (finalTokens <= capTokens) break
            }
        }
    }

    const newTotalTokens = materials.reduce((sum, m) => sum + (m.tokenCount || 0), 0)
    const indexCount = materials.filter(m => m.mode === 'index').length
    const degradeHint = indexCount > 0
        ? `材料总量超出工具返回上限（${capTokens} tokens），已将 ${indexCount} 份低优先级材料降级为索引模式。需要这些材料的内容时请使用 search_case_materials 工具按名称/关键字检索。`
        : undefined

    return {
        ...result,
        materials,
        totalTokens: newTotalTokens,
        hint: degradeHint ?? result.hint,
    }
}
