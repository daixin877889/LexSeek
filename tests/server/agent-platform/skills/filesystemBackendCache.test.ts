import { describe, it, expect, beforeEach } from 'vitest'
import {
    getFilesystemBackend,
    invalidateBackendCache,
} from '~~/server/services/agent-platform/skills/filesystemBackendCache'

describe('FilesystemBackendCache', () => {
    beforeEach(() => {
        invalidateBackendCache()
    })

    it('相同 sources 返回同一 backend 实例', () => {
        const a = getFilesystemBackend(['.deepagents/skills/docx'])
        const b = getFilesystemBackend(['.deepagents/skills/docx'])
        expect(a).toBe(b)
    })

    it('不同 sources 返回不同 backend 实例', () => {
        const a = getFilesystemBackend(['.deepagents/skills/docx'])
        const b = getFilesystemBackend(['.deepagents/skills/pptx'])
        expect(a).not.toBe(b)
    })

    it('sources 顺序不影响缓存键（自动排序）', () => {
        const a = getFilesystemBackend(['a', 'b', 'c'])
        const b = getFilesystemBackend(['c', 'b', 'a'])
        expect(a).toBe(b)
    })

    it('invalidateBackendCache 清空缓存', () => {
        const a = getFilesystemBackend(['x'])
        invalidateBackendCache()
        const b = getFilesystemBackend(['x'])
        expect(a).not.toBe(b)
    })
})
