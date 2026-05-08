/**
 * FilesystemBackend 缓存。
 *
 * deepagents 的 createSkillsMiddleware 接受 backend + sources。
 * 同一组 (sources, allowedSkillNames) 共用一个 backend 实例避免每次 createAgent 重建。
 *
 * @see docs/superpowers/specs/2026-04-26-ai-infrastructure-unification-design.md §3.5.3
 */

import { FilesystemBackend } from 'deepagents'
import { AllowlistedFilesystemBackend } from './allowlistedFilesystemBackend'

const cache = new Map<string, FilesystemBackend>()

/**
 * 按 (sources, allowedSkillNames) 缓存 backend 实例。
 * sources 与 allowed 集合都自动排序确保顺序无关。
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
    let backend = cache.get(key)
    if (!backend) {
        backend = new AllowlistedFilesystemBackend({
            rootDir: process.cwd(),
            skillParentDirs: new Set(sortedSources),
            allowedSkillNames: new Set(sortedAllowed),
        })
        cache.set(key, backend)
    }
    return backend
}

/**
 * 失效全部 backend 缓存。
 * 调用时机：skill resync 后、status 切换后。
 */
export function invalidateBackendCache(): void {
    cache.clear()
}
