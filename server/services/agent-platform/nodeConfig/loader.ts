/**
 * NodeConfig Loader 内存缓存
 *
 * 每次 createAgent 都打 DB 取节点配置成本高，故内存缓存。
 * 配置变更时：本地清 + 经缓存失效总线广播给其它实例。
 * 另带 10min 兜底 TTL，广播万一丢失也能自愈。
 *
 * @see docs/superpowers/specs/2026-05-19-cache-invalidation-design.md
 */

import { getNodeConfigService } from '~~/server/services/node/node.service'
import type { NodeConfig } from '~~/server/services/node/node.service'
import {
    CACHE_NAMES,
    publishInvalidation,
    registerInvalidationHandler,
} from '~~/server/utils/cacheInvalidationBus'

/** 兜底 TTL：10 分钟 */
const CACHE_TTL_MS = 10 * 60 * 1000

interface CacheEntry {
    value: NodeConfig | null
    expiredAt: number
}

const cache = new Map<string, CacheEntry>()

/** 本地清除（不广播）。供失效总线 handler 与本模块复用。 */
function clearLocal(keys?: string[]): void {
    if (!keys || keys.length === 0) {
        cache.clear()
    } else {
        for (const k of keys) cache.delete(k)
    }
}

// 注册到缓存失效总线：收到广播时只清本地（不再二次广播）
registerInvalidationHandler(CACHE_NAMES.NODE_CONFIG, clearLocal)

/**
 * 加载节点配置（带缓存）。
 * 节点不存在时缓存 null，下次仍快速返回。
 * 命中后若超过 TTL，视为未命中并回源。
 */
export async function getNodeConfigCached(nodeName: string): Promise<NodeConfig | null> {
    const entry = cache.get(nodeName)
    if (entry && Date.now() <= entry.expiredAt) {
        return entry.value
    }
    const cfg = await getNodeConfigService(nodeName)
    cache.set(nodeName, { value: cfg, expiredAt: Date.now() + CACHE_TTL_MS })
    return cfg
}

/**
 * 失效缓存。不传参数 = 清全量；传 nodeName = 清单条。
 * 本地立即清 + 经总线广播给其它实例。
 * 由 admin nodes 相关 API、prompts 相关 API、skill resync 调用。
 */
export function invalidateNodeConfigCache(nodeName?: string): void {
    const keys = nodeName ? [nodeName] : undefined
    clearLocal(keys)
    publishInvalidation(CACHE_NAMES.NODE_CONFIG, keys)
}

/** 仅供测试用：重置缓存到初始空状态。生产代码不要调。 */
export function _resetCacheForTests(): void {
    cache.clear()
}
