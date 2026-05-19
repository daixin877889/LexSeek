/**
 * FilesystemBackend 缓存。
 *
 * deepagents 的 createSkillsMiddleware 接受 backend + sources。
 * 同一组 (sources, allowedSkillNames) 共用一个 backend 实例避免每次 createAgent 重建。
 * skill resync / status 切换时：本地清 + 经缓存失效总线广播。另带 10min 兜底 TTL。
 *
 * @see docs/superpowers/specs/2026-05-19-cache-invalidation-design.md
 */

import { FilesystemBackend } from 'deepagents'
import { AllowlistedFilesystemBackend } from './allowlistedFilesystemBackend'
import {
    CACHE_NAMES,
    publishInvalidation,
    registerInvalidationHandler,
} from '~~/server/utils/cacheInvalidationBus'

/** 兜底 TTL：10 分钟 */
const CACHE_TTL_MS = 10 * 60 * 1000

interface CacheEntry {
    value: FilesystemBackend
    expiredAt: number
}

const cache = new Map<string, CacheEntry>()

/** 本地清除（不广播）。filesystemBackend 一向全清。 */
function clearLocal(): void {
    cache.clear()
}

// 注册到缓存失效总线：收到广播时只清本地
registerInvalidationHandler(CACHE_NAMES.FILESYSTEM_BACKEND, clearLocal)

/**
 * 按 (sources, allowedSkillNames) 缓存 backend 实例。
 * sources 与 allowed 集合都自动排序确保顺序无关。
 * 命中后若超过 TTL，视为未命中并重建。
 *
 * @param sources skill 父目录列表
 * @param allowedSkillNames 节点允许的 skill 子目录名集合（即 status=ENABLED 且与节点关联）
 */
export function getFilesystemBackend(
    sources: string[],
    allowedSkillNames: Set<string>,
): FilesystemBackend {
    const sortedSources = [...sources].sort()
    const sortedAllowed = [...allowedSkillNames].sort()
    const key = `${sortedSources.join(',')}::${sortedAllowed.join('|')}`
    const entry = cache.get(key)
    if (entry && Date.now() <= entry.expiredAt) {
        return entry.value
    }
    const backend = new AllowlistedFilesystemBackend({
        rootDir: process.cwd(),
        skillParentDirs: new Set(sortedSources),
        allowedSkillNames: new Set(sortedAllowed),
    })
    cache.set(key, { value: backend, expiredAt: Date.now() + CACHE_TTL_MS })
    return backend
}

/**
 * 失效全部 backend 缓存。本地立即清 + 经总线广播给其它实例。
 * 调用时机：skill resync 后、status 切换后。
 */
export function invalidateBackendCache(): void {
    clearLocal()
    publishInvalidation(CACHE_NAMES.FILESYSTEM_BACKEND)
}
