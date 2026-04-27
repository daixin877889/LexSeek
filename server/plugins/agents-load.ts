/**
 * Agent 加载插件
 *
 * 在 Nitro 启动时：
 * 1. 命名 import 5 个业务 vertical agent.config，触发 defineDomainAgent 自动注册。
 *    （改用命名 import + 显式引用，避免 esbuild tree-shaking 把纯 side-effect import 当死码移除）
 * 2. 调用 registerLegacyRunners 注册尚未完成阶段 8 迁移的 CASE+ANALYSIS legacy entry。
 *
 * 阶段 8 完成后删除 registerLegacyRunners 调用及相关文件。
 *
 * @see docs/superpowers/plans/2026-04-26-ai-unify-stage-2-factory-and-vertical.md T18
 * @see docs/superpowers/plans/2026-04-26-ai-unify-stage-3-search-law.md Task 7（首次端到端 smoke 暴露 tree-shake 致 vertical 未注册）
 */

import { caseMainAgent } from '~~/server/agents/case-main/agent.config'
import { caseModuleAgent } from '~~/server/agents/case-module/agent.config'
import { legalAssistantAgent } from '~~/server/agents/legal-assistant/agent.config'
import { documentAgent } from '~~/server/agents/document/agent.config'
import { contractAgent } from '~~/server/agents/contract/agent.config'

import { agentRegistry } from '~~/server/services/agent-platform/registry/agentRegistry'
import { registerLegacyRunners } from '~~/server/services/agent-platform/registry/registerLegacyRunners'

export default defineNitroPlugin(() => {
    try {
        // 显式引用 5 个 vertical 导出，确保 Nitro/esbuild 不会将"仅副作用"的 import
        // 当作死码消除。defineDomainAgent 在模块顶层执行 agentRegistry.register，
        // 但这只有在模块真正被求值时才发生。
        const verticals = [
            caseMainAgent,
            caseModuleAgent,
            legalAssistantAgent,
            documentAgent,
            contractAgent,
        ]

        registerLegacyRunners()

        const allEntries = agentRegistry.list()
        logger.info('[agents-load] 业务 vertical 已注册，legacy caseAnalysisV2 已注册', {
            verticalsLoaded: verticals.length,
            registryTotal: allEntries.length,
            registryEntries: allEntries.map(e => ({
                scope: e.scope,
                type: e.type ?? 'null',
                description: e.description,
            })),
        })
    }
    catch (err) {
        logger.error('[agents-load] 注册失败', err)
        throw err
    }
})
