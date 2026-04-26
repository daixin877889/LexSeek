/**
 * Agent 加载插件
 *
 * 在 Nitro 启动时：
 * 1. 副作用 import 5 个业务 vertical agent.config，触发 defineDomainAgent 自动注册。
 * 2. 调用 registerLegacyRunners 注册尚未完成阶段 8 迁移的 CASE+ANALYSIS legacy entry。
 *
 * 阶段 8 完成后删除 registerLegacyRunners 调用及相关文件。
 *
 * @see docs/superpowers/plans/2026-04-26-ai-unify-stage-2-factory-and-vertical.md T18
 */

import '~~/server/agents/case-main/agent.config'
import '~~/server/agents/case-module/agent.config'
import '~~/server/agents/legal-assistant/agent.config'
import '~~/server/agents/document/agent.config'
import '~~/server/agents/contract/agent.config'

import { registerLegacyRunners } from '~~/server/services/agent-platform/registry/registerLegacyRunners'

export default defineNitroPlugin(() => {
    try {
        registerLegacyRunners()
        logger.info('[agents-load] 业务 vertical 已注册，legacy caseAnalysisV2 已注册')
    }
    catch (err) {
        logger.error('[agents-load] 注册失败', err)
        throw err
    }
})
