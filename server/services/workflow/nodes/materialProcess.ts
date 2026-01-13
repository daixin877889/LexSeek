/**
 * 材料处理节点
 *
 * LangGraph 工作流中的材料处理节点，负责：
 * 1. 检查案件材料的处理状态
 * 2. 聚合所有已完成处理的材料内容
 * 3. 将聚合后的内容存入工作流状态
 *
 * @see Requirements 3.12, 3.13
 * @see design.md - LangGraph 工作流架构
 */

import { AIMessage } from '@langchain/core/messages'
import {
    type CaseAnalysisState,
    type CaseAnalysisStateUpdate,
    type MaterialInfo,
} from '../state'
import { WorkflowPhase } from '#shared/types/case'
import {
    getCompletedMaterialsContentService,
    getMaterialsStatsService,
} from '../../material/material.service'
import { MaterialType, MaterialTypeText } from '#shared/types/material'
import { logger } from '#shared/utils/logger'

/** 材料处理节点名称 */
export const MATERIAL_PROCESS_NODE_NAME = 'material_process'

/** 材料处理结果 */
interface MaterialProcessResult {
    /** 是否成功 */
    success: boolean
    /** 聚合后的材料内容 */
    aggregatedContent: string
    /** 材料信息列表 */
    materials: MaterialInfo[]
    /** 错误信息（如果有） */
    error?: string
    /** 材料统计 */
    stats: {
        total: number
        completed: number
        failed: number
        pending: number
    }
}

/**
 * 材料处理节点
 *
 * 该节点在工作流开始时执行，负责：
 * 1. 检查是否有待处理的材料（如果有，返回错误提示用户等待）
 * 2. 检查是否有处理失败的材料（如果有，返回错误提示用户重试）
 * 3. 聚合所有已完成处理的材料内容
 * 4. 更新工作流状态，准备进入下一阶段
 *
 * @param state 当前工作流状态
 * @returns 状态更新
 */
export async function materialProcessNode(
    state: CaseAnalysisState
): Promise<CaseAnalysisStateUpdate> {
    const { caseId, sessionId } = state

    logger.info('材料处理节点开始执行', {
        caseId,
        sessionId,
        phase: state.currentPhase,
    })

    try {
        // 处理材料
        const result = await processMaterials(caseId)

        if (!result.success) {
            // 材料处理失败，返回错误状态
            // Requirements 3.13: 如果材料处理失败，返回错误信息并允许用户重试
            logger.warn('材料处理失败', {
                caseId,
                error: result.error,
                stats: result.stats,
            })

            return {
                error: result.error || '材料处理失败',
                currentPhase: WorkflowPhase.MATERIAL_PROCESS,
                messages: [
                    new AIMessage({
                        content: formatErrorMessage(result),
                    }),
                ],
            }
        }

        // 材料处理成功
        // Requirements 3.12: 当所有材料处理完成时，继续执行案情信息检查节点
        logger.info('材料处理完成', {
            caseId,
            materialCount: result.materials.length,
            contentLength: result.aggregatedContent.length,
        })

        return {
            materials: result.materials,
            aggregatedContent: result.aggregatedContent,
            currentPhase: WorkflowPhase.CASE_INFO_CHECK,
            error: null,
            messages: [
                new AIMessage({
                    content: formatSuccessMessage(result),
                }),
            ],
        }
    } catch (error) {
        // 捕获未预期的错误
        const errorMessage = error instanceof Error ? error.message : '未知错误'
        logger.error('材料处理节点执行异常', {
            caseId,
            error: errorMessage,
        })

        return {
            error: `材料处理异常: ${errorMessage}`,
            currentPhase: WorkflowPhase.MATERIAL_PROCESS,
            messages: [
                new AIMessage({
                    content: `材料处理过程中发生异常：${errorMessage}。请稍后重试或联系管理员。`,
                }),
            ],
        }
    }
}

/**
 * 处理案件材料
 *
 * 支持两种输入方式：
 * 1. 上传的材料文件（存储在 materials 表中）
 * 2. 直接输入的文本案情信息（存储在 cases.content 字段中）
 *
 * @param caseId 案件 ID
 * @returns 材料处理结果
 */
async function processMaterials(caseId: number): Promise<MaterialProcessResult> {
    // 获取材料统计信息
    const stats = await getMaterialsStatsService(caseId)

    // 如果没有上传材料，检查案件是否有直接输入的文本内容
    if (stats.total === 0) {
        // 获取案件信息，检查 content 字段
        const caseRecord = await prisma.cases.findUnique({
            where: { id: caseId },
            select: { id: true, title: true, content: true },
        })

        if (caseRecord?.content && caseRecord.content.trim()) {
            // 有直接输入的文本内容，将其作为虚拟材料处理
            const textContent = caseRecord.content.trim()
            const virtualMaterial: MaterialInfo = {
                id: 0, // 虚拟材料 ID
                name: '案情描述',
                type: MaterialType.TEXT, // 文本类型
                content: textContent,
            }

            logger.info('使用案件文本内容作为材料', {
                caseId,
                contentLength: textContent.length,
            })

            return {
                success: true,
                aggregatedContent: `## 案情描述\n\n${textContent}`,
                materials: [virtualMaterial],
                stats: {
                    total: 1,
                    completed: 1,
                    failed: 0,
                    pending: 0,
                },
            }
        }

        // 既没有上传材料，也没有文本内容
        return {
            success: false,
            aggregatedContent: '',
            materials: [],
            error: '案件没有上传任何材料，也没有输入案情信息，请先上传案件相关材料或输入案情描述',
            stats: {
                total: 0,
                completed: 0,
                failed: 0,
                pending: 0,
            },
        }
    }

    // 检查是否有待处理或处理中的材料
    if (stats.pending > 0 || stats.processing > 0) {
        const pendingCount = stats.pending + stats.processing
        return {
            success: false,
            aggregatedContent: '',
            materials: [],
            error: `还有 ${pendingCount} 个材料正在处理中，请等待处理完成后再开始分析`,
            stats: {
                total: stats.total,
                completed: stats.completed,
                failed: stats.failed,
                pending: pendingCount,
            },
        }
    }

    // 检查是否有处理失败的材料
    if (stats.failed > 0) {
        return {
            success: false,
            aggregatedContent: '',
            materials: [],
            error: `有 ${stats.failed} 个材料处理失败，请重新处理失败的材料或删除后再开始分析`,
            stats: {
                total: stats.total,
                completed: stats.completed,
                failed: stats.failed,
                pending: 0,
            },
        }
    }

    // 检查是否有已完成的材料
    if (stats.completed === 0) {
        return {
            success: false,
            aggregatedContent: '',
            materials: [],
            error: '没有可用的材料内容，请确保至少有一个材料处理成功',
            stats: {
                total: stats.total,
                completed: 0,
                failed: stats.failed,
                pending: 0,
            },
        }
    }

    // 获取所有已完成处理的材料内容
    const completedMaterials = await getCompletedMaterialsContentService(caseId)

    // 转换为 MaterialInfo 格式
    const materials: MaterialInfo[] = completedMaterials.map((m) => ({
        id: m.materialId,
        name: m.name,
        type: m.type,
        content: m.content,
    }))

    // 聚合材料内容
    const aggregatedContent = aggregateMaterialsContent(materials)

    return {
        success: true,
        aggregatedContent,
        materials,
        stats: {
            total: stats.total,
            completed: stats.completed,
            failed: stats.failed,
            pending: 0,
        },
    }
}

/**
 * 聚合材料内容
 *
 * 将多个材料的内容聚合为一个字符串，便于后续 AI 分析
 * 格式：
 * ```
 * ## 材料1：[材料名称]（[材料类型]）
 * [材料内容]
 *
 * ## 材料2：[材料名称]（[材料类型]）
 * [材料内容]
 * ```
 *
 * @param materials 材料列表
 * @returns 聚合后的内容
 */
function aggregateMaterialsContent(materials: MaterialInfo[]): string {
    if (materials.length === 0) {
        return ''
    }

    const sections = materials.map((material, index) => {
        const typeText = MaterialTypeText[material.type as MaterialType] || '未知类型'
        const header = `## 材料${index + 1}：${material.name}（${typeText}）`
        return `${header}\n\n${material.content}`
    })

    return sections.join('\n\n---\n\n')
}

/**
 * 格式化成功消息
 *
 * @param result 处理结果
 * @returns 格式化的消息
 */
function formatSuccessMessage(result: MaterialProcessResult): string {
    const { materials, stats } = result

    const materialList = materials
        .map((m, i) => {
            const typeText = MaterialTypeText[m.type as MaterialType] || '未知类型'
            return `${i + 1}. ${m.name}（${typeText}）`
        })
        .join('\n')

    return `材料处理完成，共处理 ${stats.completed} 个材料：\n\n${materialList}\n\n正在进行案情信息检查...`
}

/**
 * 格式化错误消息
 *
 * @param result 处理结果
 * @returns 格式化的错误消息
 */
function formatErrorMessage(result: MaterialProcessResult): string {
    const { error, stats } = result

    let message = error || '材料处理失败'

    if (stats.total > 0) {
        message += `\n\n材料统计：\n- 总数：${stats.total}\n- 已完成：${stats.completed}\n- 失败：${stats.failed}\n- 处理中：${stats.pending}`
    }

    return message
}

/**
 * 检查材料是否准备就绪
 *
 * 用于在启动工作流前检查材料状态
 * 支持两种输入方式：上传的材料文件或直接输入的文本内容
 *
 * @param caseId 案件 ID
 * @returns 是否准备就绪及相关信息
 */
export async function checkMaterialsReady(caseId: number): Promise<{
    ready: boolean
    message: string
    stats: {
        total: number
        completed: number
        failed: number
        pending: number
    }
}> {
    const stats = await getMaterialsStatsService(caseId)
    const pendingCount = stats.pending + stats.processing

    // 如果没有上传材料，检查案件是否有直接输入的文本内容
    if (stats.total === 0) {
        const caseRecord = await prisma.cases.findUnique({
            where: { id: caseId },
            select: { content: true },
        })

        if (caseRecord?.content && caseRecord.content.trim()) {
            // 有直接输入的文本内容
            return {
                ready: true,
                message: '案情描述已准备就绪',
                stats: {
                    total: 1,
                    completed: 1,
                    failed: 0,
                    pending: 0,
                },
            }
        }

        return {
            ready: false,
            message: '请先上传案件相关材料或输入案情描述',
            stats: {
                total: 0,
                completed: 0,
                failed: 0,
                pending: 0,
            },
        }
    }

    if (pendingCount > 0) {
        return {
            ready: false,
            message: `还有 ${pendingCount} 个材料正在处理中`,
            stats: {
                total: stats.total,
                completed: stats.completed,
                failed: stats.failed,
                pending: pendingCount,
            },
        }
    }

    if (stats.failed > 0) {
        return {
            ready: false,
            message: `有 ${stats.failed} 个材料处理失败，请重新处理或删除`,
            stats: {
                total: stats.total,
                completed: stats.completed,
                failed: stats.failed,
                pending: 0,
            },
        }
    }

    if (stats.completed === 0) {
        return {
            ready: false,
            message: '没有可用的材料内容',
            stats: {
                total: stats.total,
                completed: 0,
                failed: stats.failed,
                pending: 0,
            },
        }
    }

    return {
        ready: true,
        message: `${stats.completed} 个材料已准备就绪`,
        stats: {
            total: stats.total,
            completed: stats.completed,
            failed: stats.failed,
            pending: 0,
        },
    }
}
