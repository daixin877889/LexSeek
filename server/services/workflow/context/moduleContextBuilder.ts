/**
 * 模块上下文构建器
 *
 * 为每个分析模块独立从 DB 构建完整上下文
 * 包括：案件基本信息、材料上下文、已完成的分析结果、案件长期记忆
 *
 * 每类上下文独立 try-catch，失败降级为空并 log warning
 * 不中断模块执行
 */

import { INIT_ANALYSIS_MODULES } from '#shared/types/initAnalysis'
import { getCaseByIdService } from '../../case/case.service'
import { getMaterialsByCaseIdService } from '../../material/material.service'
import { getMaterialContextService, buildMaterialContextMessage } from '../../material/materialPipeline.service'
import { loadCompletedResultsService } from '../../case/initAnalysis.service'
import { getStore } from '../checkpointer'

interface ModuleContextParams {
    caseId: number
    agentName: string
}

/**
 * 从 DB 构建模块上下文
 *
 * 返回结构化的上下文文本，合并到 system prompt 中
 * 空 section 自动省略
 */
export async function buildModuleContext(params: ModuleContextParams): Promise<string> {
    const { caseId, agentName } = params

    // 4 个 section 无数据依赖，并行加载
    const [caseInfoSection, materialSection, resultsSection, memorySection] = await Promise.all([
        buildCaseInfoSection(caseId),
        buildMaterialSection(caseId),
        buildCompletedResultsSection(caseId, agentName),
        buildMemorySection(caseId),
    ])

    const sections: string[] = []
    if (caseInfoSection) sections.push(caseInfoSection)
    if (materialSection) sections.push(materialSection)
    if (resultsSection) sections.push(resultsSection)
    if (memorySection) sections.push(memorySection)

    return sections.join('\n\n')
}

/** 案件基本信息 */
async function buildCaseInfoSection(caseId: number): Promise<string | null> {
    try {
        const caseRecord = await getCaseByIdService(caseId)
        if (!caseRecord) return null

        const lines: string[] = ['## 案件基本信息']

        if (caseRecord.title) lines.push(`- 标题：${caseRecord.title}`)
        if (caseRecord.caseType?.name) lines.push(`- 案件类型：${caseRecord.caseType.name}`)

        const plaintiff = caseRecord.plaintiff as string[] | null
        if (plaintiff?.length) lines.push(`- 原告：${plaintiff.join('、')}`)

        const defendant = caseRecord.defendant as string[] | null
        if (defendant?.length) lines.push(`- 被告：${defendant.join('、')}`)

        if (caseRecord.summary) lines.push(`- 案件概述：${caseRecord.summary}`)

        // extractedInfo 中的扩展信息
        const extracted = caseRecord.extractedInfo as Record<string, unknown> | null
        if (extracted) {
            for (const [key, value] of Object.entries(extracted)) {
                if (['title', 'plaintiff', 'defendant', 'summary', 'caseType'].includes(key)) continue
                if (value && typeof value === 'string') {
                    lines.push(`- ${key}：${value}`)
                }
            }
        }

        return lines.length > 1 ? lines.join('\n') : null
    } catch (error) {
        logger.warn('构建案件基本信息失败，降级为空', { caseId, error })
        return null
    }
}

/** 案件材料上下文 */
async function buildMaterialSection(caseId: number): Promise<string | null> {
    try {
        const materials = await getMaterialsByCaseIdService(caseId)
        if (!materials.length) return null

        const context = await getMaterialContextService(materials)
        if (context.mode === 'empty') return null

        return '## 案件材料\n' + buildMaterialContextMessage(context)
    } catch (error) {
        logger.warn('构建材料上下文失败，降级为空', { caseId, error })
        return null
    }
}

/** 已完成的分析结果（排除当前模块） */
async function buildCompletedResultsSection(caseId: number, excludeModule: string): Promise<string | null> {
    try {
        const results = await loadCompletedResultsService(caseId)
        // 排除当前模块的旧结果（不可变方式）
        const entries = Object.entries(results).filter(([key]) => key !== excludeModule)
        if (!entries.length) return null

        const lines: string[] = ['## 已完成的分析结果']
        for (const [moduleName, resultText] of entries) {
            const moduleInfo = INIT_ANALYSIS_MODULES.find(m => m.name === moduleName)
            const title = moduleInfo?.title ?? moduleName
            lines.push(`### ${title}（${moduleName}）`)
            lines.push(resultText)
        }

        return lines.join('\n')
    } catch (error) {
        logger.warn('构建已完成分析结果失败，降级为空', { caseId, error })
        return null
    }
}

/**
 * 获取案件长期记忆
 *
 * 从 PostgresStore 读取案件的 basic_info 记忆
 * namespace: ['cases', '<caseId>'], key: 'basic_info'
 * 与 caseExtraction.service.ts 中 saveCaseInfoService 对应
 */
export async function getCaseMemory(caseId: number): Promise<string | null> {
    const store = await getStore()
    const item = await store.get(['cases', String(caseId)], 'basic_info')
    if (!item?.value?.text) return null
    return item.value.text as string
}

/** 案件长期记忆 */
async function buildMemorySection(caseId: number): Promise<string | null> {
    try {
        const memoryText = await getCaseMemory(caseId)
        if (!memoryText) return null

        return '## 案件记忆\n' + memoryText
    } catch (error) {
        logger.warn('构建案件记忆失败，降级为空', { caseId, error })
        return null
    }
}
