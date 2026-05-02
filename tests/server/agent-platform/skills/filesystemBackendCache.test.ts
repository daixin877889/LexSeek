import { describe, it, expect, beforeEach } from 'vitest'
import {
    getFilesystemBackend,
    invalidateBackendCache,
} from '~~/server/services/agent-platform/skills/filesystemBackendCache'

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
})
