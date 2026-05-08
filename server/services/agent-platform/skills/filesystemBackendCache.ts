/**
 * FilesystemBackend 缓存。
 *
 * deepagents 的 createSkillsMiddleware 接受 backend + sources。
 * 同一组 sources 共用一个 backend 实例避免每次 createAgent 重建。
 *
 * @see docs/superpowers/specs/2026-04-26-ai-infrastructure-unification-design.md §3.5.3
 */

import { FilesystemBackend } from 'deepagents'

const cache = new Map<string, FilesystemBackend>()

/**
 * 按 sources 列表 hash 缓存 FilesystemBackend。
 * sources 自动排序确保顺序无关。
 */
export function getFilesystemBackend(sources: string[]): FilesystemBackend {
    const key = [...sources].sort().join(',')
    let backend = cache.get(key)
    if (!backend) {
        backend = new FilesystemBackend({ rootDir: process.cwd() })
        cache.set(key, backend)
    }
    return backend
}

/**
 * 失效全部 backend 缓存。
 * 调用时机：skill resync 后。
 */
export function invalidateBackendCache(): void {
    cache.clear()
}
