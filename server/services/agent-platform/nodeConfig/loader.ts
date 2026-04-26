/**
 * NodeConfig Loader 内存缓存
 *
 * 阶段 2 引入：每次 createAgent 都打 DB 取节点配置成本高。
 * 内存缓存配置变更时主动失效（admin patch API 调 invalidate）。
 *
 * @see docs/superpowers/specs/2026-04-26-ai-infrastructure-unification-design.md §3.1 §3.5.6
 */

import { getNodeConfigService } from '~~/server/services/node/node.service'
import type { NodeConfig } from '~~/server/services/node/node.service'

const cache = new Map<string, NodeConfig | null>()

/**
 * 加载节点配置（带缓存）。
 * 节点不存在时缓存 null，下次仍快速返回。
 */
export async function getNodeConfigCached(nodeName: string): Promise<NodeConfig | null> {
    if (cache.has(nodeName)) {
        return cache.get(nodeName)!
    }
    const cfg = await getNodeConfigService(nodeName)
    cache.set(nodeName, cfg)
    return cfg
}

/**
 * 失效缓存。不传参数 = 清全量；传 nodeName = 清单条。
 * 由 admin nodes patch API + skill resync 调用。
 */
export function invalidateNodeConfigCache(nodeName?: string): void {
    if (nodeName === undefined) {
        cache.clear()
    } else {
        cache.delete(nodeName)
    }
}

/** 仅供测试用：重置缓存到初始空状态。生产代码不要调。 */
export function _resetCacheForTests(): void {
    cache.clear()
}
