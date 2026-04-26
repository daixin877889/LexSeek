/**
 * Agent Registry 启动钩子
 *
 * 在 Nitro 启动时把 5 个 legacy runner 注册到 agentRegistry。
 * 阶段 2 起替换为 defineDomainAgent 工厂自动注册（届时本 plugin 删除）。
 */

import { registerLegacyRunners } from '~~/server/services/agent-platform/registry/registerLegacyRunners'

export default defineNitroPlugin(() => {
    try {
        registerLegacyRunners()
        logger.info('[agent-registry] 已注册 5 个 legacy runner')
    } catch (err) {
        logger.error('[agent-registry] 注册 legacy runner 失败', err)
        throw err   // 路由没注册成功，应该尽早暴露
    }
})
