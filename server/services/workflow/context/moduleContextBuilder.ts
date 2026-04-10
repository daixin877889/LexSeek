/**
 * 模块上下文构建器
 *
 * 为每个分析模块独立从 DB 构建完整上下文
 * 包括：案件基本信息、材料上下文、已完成的分析结果、案件长期记忆
 *
 * 每类上下文独立 try-catch，失败降级为空并 log warning
 * 不中断模块执行
 *
 * token 预算机制：按 contextWindow * 0.3 分配总预算，
 * 四类上下文按优先级分配（案件信息 10% > 材料 40% > 分析结果 35% > 记忆 15%），
 * 高优先级 section 实际使用少于预算时，剩余空间分配给后续 section
 */

import { INIT_ANALYSIS_MODULES } from '#shared/types/initAnalysis'
import { countTokensSync } from '~~/server/utils/tokenCounter'
import { getCaseByIdService } from '../../case/case.service'
import { getMaterialsByCaseIdService } from '../../material/material.service'
import { getMaterialContextService, buildMaterialContextMessage } from '../../material/materialPipeline.service'
import { loadCompletedResultsService } from '../../case/initAnalysis.service'
import { getStore } from '../checkpointer'

/** 默认上下文窗口大小（主流模型保守默认） */
const DEFAULT_CONTEXT_WINDOW = 128_000

interface ModuleContextParams {
    caseId: number
    agentName: string
    /** 模型上下文窗口大小，默认 128000 */
    contextWindow?: number
}

/** 上下文预算分配 */
interface ContextBudget {
    totalBudget: number
    caseInfoBudget: number  // 10%
    materialBudget: number  // 40%
    resultsBudget: number   // 35%
    memoryBudget: number    // 15%
}

/** 按 contextWindow 的 30% 计算总预算，再按比例分配给四类上下文 */
function allocateBudget(contextWindow: number): ContextBudget {
    const totalBudget = Math.floor(contextWindow * 0.3)
    return {
        totalBudget,
        caseInfoBudget: Math.floor(totalBudget * 0.1),
        materialBudget: Math.floor(totalBudget * 0.4),
        resultsBudget: Math.floor(totalBudget * 0.35),
        memoryBudget: Math.floor(totalBudget * 0.15),
    }
}

/**
 * 按段落截断文本，保留完整段落不超过 maxTokens
 * 返回截断后的文本和实际 token 数
 */
function truncateSection(text: string, maxTokens: number): { text: string; tokens: number } {
    const tokens = countTokensSync(text)
    if (tokens <= maxTokens) return { text, tokens }

    // 按段落截断，保留完整段落
    const paragraphs = text.split('\n\n')
    let accumulated = ''
    let accTokens = 0
    for (const para of paragraphs) {
        const paraTokens = countTokensSync(para)
        if (accTokens + paraTokens > maxTokens) break
        accumulated += (accumulated ? '\n\n' : '') + para
        accTokens += paraTokens
    }

    return {
        text: accumulated + '\n\n[上下文已截断，仅保留前部分内容]',
        tokens: accTokens,
    }
}

/**
 * 从 DB 构建模块上下文
 *
 * 返回结构化的上下文文本，合并到 system prompt 中
 * 空 section 自动省略
 *
 * 当传入 contextWindow 时启用 token 预算分配：
 * - 总预算 = contextWindow * 0.3
 * - 按优先级依次分配：案件信息(10%) → 材料(40%) → 分析结果(35%) → 记忆(15%)
 * - 高优先级 section 实际使用少于预算时，剩余空间累积给后续 section
 */
export async function buildModuleContext(params: ModuleContextParams): Promise<string> {
    const { caseId, agentName, contextWindow } = params
    const effectiveWindow = contextWindow ?? DEFAULT_CONTEXT_WINDOW
    const budget = allocateBudget(effectiveWindow)

    // 4 个 section 无数据依赖，并行加载
    const [caseInfoSection, materialSection, resultsSection, memorySection] = await Promise.all([
        buildCaseInfoSection(caseId),
        buildMaterialSection(caseId),
        buildCompletedResultsSection(caseId, agentName),
        buildMemorySection(caseId),
    ])

    // 按优先级依次截断，高优先级节省的预算累积给后续 section
    let remaining = budget.totalBudget
    const sections: string[] = []

    // 优先级顺序：案件信息 → 材料 → 分析结果 → 记忆
    const sectionEntries: ReadonlyArray<{ raw: string | null; budget: number }> = [
        { raw: caseInfoSection, budget: budget.caseInfoBudget },
        { raw: materialSection, budget: budget.materialBudget },
        { raw: resultsSection, budget: budget.resultsBudget },
        { raw: memorySection, budget: budget.memoryBudget },
    ]

    for (let i = 0; i < sectionEntries.length; i++) {
        const entry = sectionEntries[i]
        if (!entry.raw) {
            // 此 section 为空，预算全部留给后续
            continue
        }
        // 计算后续 section 的保留预算
        const reservedForLater = sectionEntries
            .slice(i + 1)
            .reduce((sum, s) => sum + s.budget, 0)
        // 可用 = 至少获得自身预算份额，多余部分（前面节省的）也可使用
        // 但需为后续 section 保留基础预算
        const availableTokens = Math.min(remaining, Math.max(entry.budget, remaining - reservedForLater))
        const { text, tokens } = truncateSection(entry.raw, availableTokens)
        if (text) {
            sections.push(text)
            remaining -= tokens
        }
    }

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
