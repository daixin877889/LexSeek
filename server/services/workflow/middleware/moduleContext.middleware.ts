/**
 * 模块对话上下文中间件
 *
 * 在每轮对话前检测上下文变更，仅在有变化时注入增量内容
 * 动态上下文通过 SystemMessage 注入，前端不显示
 *
 * 检测维度：
 * 1. 案件材料（sourceId 列表对比）
 * 2. 长期记忆（hash 对比）
 * 3. 其他模块分析结果（hash 对比）
 * 4. 当前模块分析结果（版本号对比）
 */

import { createMiddleware } from 'langchain'
import { HumanMessage } from '@langchain/core/messages'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { getMaterialsByCaseIdService } from '../../material/material.service'
import {
    getSourceId,
    getMaterialContextService,
    buildMaterialContextMessage,
    buildIncrementalMaterialMessage,
} from '../../material/materialPipeline.service'
import { loadCompletedResultsService } from '../../case/initAnalysis.service'
import { getCaseMemory } from '../context/moduleContextBuilder'

/** 模块上下文注入中间件 */
export const moduleContextMiddleware = (caseId: number, moduleName?: string) => {
    return createMiddleware({
        name: 'ModuleContextMiddleware',
        stateSchema: z.object({
            /** 已注入的材料 sourceId 列表 */
            _injectedSourceIds: z.array(z.number()).default([]),
            /** 上次注入的记忆内容 hash */
            _lastMemoryHash: z.string().nullable().default(null),
            /** 已注入的其他模块结果 hash（moduleName → contentHash） */
            _injectedResultVersions: z.record(z.string(), z.string()).optional().default({}),
            /** 当前模块已注入的分析结果 hash */
            _currentModuleResultHash: z.string().nullable().default(null),
        }),
        beforeAgent: {
            hook: async (state) => {
                try {
                    const sections: string[] = []
                    let newSourceIds = state._injectedSourceIds ?? []
                    let newMemoryHash = state._lastMemoryHash ?? null
                    const newResultVersions: Record<string, string> = { ...((state._injectedResultVersions ?? {}) as Record<string, string>) }
                    let newCurrentHash = state._currentModuleResultHash ?? null

                    // 并发加载 4 种上下文的当前状态
                    const [materials, memory, completedResults] = await Promise.all([
                        getMaterialsByCaseIdService(caseId).catch(() => []),
                        getCaseMemory(caseId).catch(() => null),
                        loadCompletedResultsService(caseId).catch((): Record<string, string> => ({})),
                    ])

                    // 1. 材料增量检测（使用 Set 优化大数据量下的去重性能）
                    const prevSourceIds = state._injectedSourceIds ?? []
                    const currentSourceIds = materials.map(m => getSourceId(m))
                    const isFirstMaterial = prevSourceIds.length === 0
                    const prevSourceIdSet = new Set(prevSourceIds)
                    const newMaterialIds = currentSourceIds.filter(
                        id => !prevSourceIdSet.has(id),
                    )

                    if (isFirstMaterial && materials.length > 0) {
                        // 首轮：全量注入
                        const contextResult = await getMaterialContextService(materials)
                        if (contextResult.mode !== 'empty') {
                            const messageText = buildMaterialContextMessage(contextResult)
                            sections.push(`## 案件材料上下文\n${messageText}`)
                        }
                        newSourceIds = currentSourceIds
                    }
                    else if (newMaterialIds.length > 0) {
                        // 增量：仅新增材料
                        const newSourceIdSet = new Set(newMaterialIds)
                        const newMaterials = materials.filter(m => newSourceIdSet.has(getSourceId(m)))
                        const contextResult = await getMaterialContextService(newMaterials)
                        if (contextResult.mode !== 'empty') {
                            const messageText = buildIncrementalMaterialMessage(contextResult)
                            sections.push(`## 新增案件材料\n${messageText}`)
                        }
                        newSourceIds = currentSourceIds
                    }

                    // 2. 长期记忆变更检测
                    const memoryHash = memory
                        ? createHash('md5').update(memory).digest('hex')
                        : null
                    if (memoryHash !== newMemoryHash) {
                        if (memory) {
                            sections.push(`## 案件基本信息（长期记忆）\n${memory}`)
                        }
                        newMemoryHash = memoryHash
                    }

                    // 3. 其他模块分析结果变更检测
                    const otherResults = moduleName != null
                        ? Object.entries(completedResults).filter(([key]) => key !== moduleName)
                        : Object.entries(completedResults)
                    for (const [key, content] of otherResults) {
                        const contentHash = createHash('md5').update(content).digest('hex')
                        if (newResultVersions[key] !== contentHash) {
                            sections.push(`## ${key} 分析结果\n${content}`)
                            newResultVersions[key] = contentHash
                        }
                    }

                    // 4. 当前模块结果变更检测（首次或内容变化时注入）
                    if (moduleName != null) {
                        const currentModuleResult = completedResults[moduleName]
                        const currentModuleHash = currentModuleResult
                            ? createHash('md5').update(currentModuleResult).digest('hex')
                            : null
                        if (currentModuleHash && currentModuleHash !== newCurrentHash) {
                            sections.push(`## 当前模块已有分析结果（基线）\n${currentModuleResult}`)
                            newCurrentHash = currentModuleHash
                        }
                    }

                    // 无变更则跳过
                    if (sections.length === 0) return

                    // 拼接为 HumanMessage，插入最新 HumanMessage 之前
                    const contextMessage = new HumanMessage({
                        content: sections.join('\n\n'),
                        response_metadata: {
                            injectedBy: `ModuleContextMiddleware:${moduleName ?? 'global'}`,
                            injectedAt: new Date().toISOString(),
                            sectionsCount: sections.length,
                        },
                    })
                    const lastHumanIdx = state.messages.findLastIndex(
                        (m: any) => m._getType?.() === 'human' || m.constructor?.name === 'HumanMessage',
                    )
                    if (lastHumanIdx >= 0) {
                        state.messages.splice(lastHumanIdx, 0, contextMessage)
                    }
                    else {
                        state.messages.push(contextMessage)
                    }

                    logger.info('模块上下文已注入', {
                        caseId,
                        moduleName,
                        sectionsCount: sections.length,
                    })

                    return {
                        _injectedSourceIds: newSourceIds,
                        _lastMemoryHash: newMemoryHash,
                        _injectedResultVersions: newResultVersions,
                        _currentModuleResultHash: newCurrentHash,
                    }
                }
                catch (error) {
                    logger.error('模块上下文注入异常，继续执行 Agent', { caseId, moduleName, error })
                }
            },
        },
    })
}
