import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
    getFilesystemBackend,
    invalidateBackendCache,
} from '~~/server/services/agent-platform/skills/filesystemBackendCache'
import { dispatchInvalidationMessage } from '~~/server/utils/cacheInvalidationBus'

describe('FilesystemBackendCache', () => {
    beforeEach(() => {
        invalidateBackendCache()
    })

    it('相同 sources 与 allowedSkillNames 返回同一 backend 实例', () => {
        const a = getFilesystemBackend(['.deepagents/skills/docx'], new Set(['skill_a']))
        const b = getFilesystemBackend(['.deepagents/skills/docx'], new Set(['skill_a']))
        expect(a).toBe(b)
    })

    it('不同 sources 返回不同 backend 实例', () => {
        const a = getFilesystemBackend(['.deepagents/skills/docx'], new Set(['skill_a']))
        const b = getFilesystemBackend(['.deepagents/skills/pptx'], new Set(['skill_a']))
        expect(a).not.toBe(b)
    })

    it('sources 顺序不影响缓存键（自动排序）', () => {
        const a = getFilesystemBackend(['a', 'b', 'c'], new Set(['x']))
        const b = getFilesystemBackend(['c', 'b', 'a'], new Set(['x']))
        expect(a).toBe(b)
    })

    it('invalidateBackendCache 清空缓存', () => {
        const a = getFilesystemBackend(['x'], new Set(['skill_a']))
        invalidateBackendCache()
        const b = getFilesystemBackend(['x'], new Set(['skill_a']))
        expect(a).not.toBe(b)
    })

    it('不同 allowedSkillNames 返回不同 backend 实例', () => {
        const a = getFilesystemBackend(['x'], new Set(['skill_a']))
        const b = getFilesystemBackend(['x'], new Set(['skill_b']))
        expect(a).not.toBe(b)
    })

    it('allowedSkillNames 顺序不影响缓存键', () => {
        const a = getFilesystemBackend(['x'], new Set(['a', 'b', 'c']))
        const b = getFilesystemBackend(['x'], new Set(['c', 'b', 'a']))
        expect(a).toBe(b)
    })

    it('缓存项超过 10min TTL 后重建实例', () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        try {
            const t0 = new Date('2026-05-19T00:00:00Z')
            vi.setSystemTime(t0)
            const a = getFilesystemBackend(['x'], new Set(['skill_a']))
            vi.setSystemTime(new Date(t0.getTime() + 11 * 60 * 1000))
            const b = getFilesystemBackend(['x'], new Set(['skill_a']))
            expect(a).not.toBe(b)   // TTL 过期，重建
        } finally {
            vi.useRealTimers()
        }
    })

    it('收到 filesystemBackend 失效广播时清空缓存', () => {
        const a = getFilesystemBackend(['x'], new Set(['skill_a']))
        dispatchInvalidationMessage(JSON.stringify({ cacheName: 'filesystemBackend' }))
        const b = getFilesystemBackend(['x'], new Set(['skill_a']))
        expect(a).not.toBe(b)
    })
})
