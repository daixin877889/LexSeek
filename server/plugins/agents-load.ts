/**
 * Agent 加载插件
 *
 * 在 Nitro 启动时命名 import 6 个业务 vertical agent.config，触发 defineDomainAgent 自动注册。
 * 改用命名 import + 显式引用，避免 esbuild tree-shaking 把纯 side-effect import 当死码移除。
 *
 * 阶段 8 后 case-analysis 也以 vertical 形态注册（替代 registerLegacyRunners 临时垫片）。
 *
 * @see docs/superpowers/plans/2026-04-26-ai-unify-stage-2-factory-and-vertical.md T18
 * @see docs/superpowers/plans/2026-04-27-ai-unify-stage-8-case-analysis-skills.md Task 3
 */

import { caseMainAgent } from '~~/server/agents/case-main/agent.config'
import { caseModuleAgent } from '~~/server/agents/case-module/agent.config'
import { legalAssistantAgent } from '~~/server/agents/legal-assistant/agent.config'
import { documentAgent } from '~~/server/agents/document/agent.config'
import { contractAgent } from '~~/server/agents/contract/agent.config'
import { caseAnalysisAgent } from '~~/server/agents/case-analysis/agent.config'

import { agentRegistry } from '~~/server/services/agent-platform/registry/agentRegistry'

export default defineNitroPlugin(() => {
    try {
        // 显式引用 6 个 vertical 导出，确保 Nitro/esbuild 不会将"仅副作用"的 import
        // 当作死码消除。defineDomainAgent 在模块顶层执行 agentRegistry.register，
        // 但这只有在模块真正被求值时才发生。
        const verticals = [
            caseMainAgent,
            caseModuleAgent,
            legalAssistantAgent,
            documentAgent,
            contractAgent,
            caseAnalysisAgent,
        ]

        const allEntries = agentRegistry.list()
        logger.info('[agents-load] 业务 vertical 已注册', {
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
