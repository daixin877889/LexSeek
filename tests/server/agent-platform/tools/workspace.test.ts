/**
 * agent-platform/tools/workspace 单测
 *
 * 验证：
 * - resolveWorkspaceDir：合法/非法 sessionId
 * - cleanExpiredWorkspacesService：删除过期目录、保留新目录、ENOENT 静默
 * - withTimeout：promise 先 resolve / 先 reject / 超时
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { warnSpy, infoSpy, readdirMock, statMock, rmMock } = vi.hoisted(() => ({
    warnSpy: vi.fn(),
    infoSpy: vi.fn(),
    readdirMock: vi.fn(),
    statMock: vi.fn(),
    rmMock: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('#shared/utils/logger', () => ({
    logger: { info: infoSpy, error: vi.fn(), warn: warnSpy, debug: vi.fn() },
}))
;(globalThis as any).logger = { info: infoSpy, error: vi.fn(), warn: warnSpy, debug: vi.fn() }

vi.mock('node:fs/promises', async () => {
    const actual = await vi.importActual<any>('node:fs/promises')
    const overlay = {
        ...actual,
        readdir: (...args: any[]) => readdirMock(...args),
        stat: (...args: any[]) => statMock(...args),
        rm: (...args: any[]) => rmMock(...args),
    }
    return { ...overlay, default: overlay }
})

import {
    resolveWorkspaceDir,
    SESSION_ID_PATTERN,
    cleanExpiredWorkspacesService,
    withTimeout,
} from '~~/server/services/agent-platform/tools/workspace'
import { resolve } from 'node:path'

describe('SESSION_ID_PATTERN / resolveWorkspaceDir', () => {
    it('合法 sessionId 拼接路径', () => {
        const out = resolveWorkspaceDir('/tmp/base', 'abc-123_XYZ')
        expect(out).toBe('/tmp/base/abc-123_XYZ')
    })

    it('非法 sessionId（含路径分隔符）抛错', () => {
        expect(() => resolveWorkspaceDir('/tmp/base', '../etc/passwd')).toThrow(/无效的 sessionId/)
    })

    it('非法 sessionId（含点号）抛错', () => {
        expect(() => resolveWorkspaceDir('/tmp/base', 'a.b')).toThrow(/无效的 sessionId/)
    })

    it('空 sessionId 抛错', () => {
        expect(() => resolveWorkspaceDir('/tmp/base', '')).toThrow()
    })

    it('超长 sessionId 抛错', () => {
        expect(() => resolveWorkspaceDir('/tmp/base', 'a'.repeat(129))).toThrow()
    })

    it('SESSION_ID_PATTERN 直接校验合法值', () => {
        expect(SESSION_ID_PATTERN.test('valid_id-1')).toBe(true)
        expect(SESSION_ID_PATTERN.test('a@b')).toBe(false)
    })
})

describe('cleanExpiredWorkspacesService', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('删除超过 24 小时未活动的目录、保留新目录、跳过非目录条目', async () => {
        const fakeBase = '/tmp/skills-workspace'
        const oldMs = Date.now() - 25 * 3600 * 1000
        const newMs = Date.now()

        readdirMock.mockResolvedValueOnce([
            { name: 'old', isDirectory: () => true },
            { name: 'fresh', isDirectory: () => true },
            { name: 'just_a_file', isDirectory: () => false },
        ])
        statMock.mockImplementation(async (p: string) => ({
            mtimeMs: String(p).endsWith('/old') ? oldMs : newMs,
        }))

        await cleanExpiredWorkspacesService()
        // 仅 old 被 rm 一次
        expect(rmMock).toHaveBeenCalledTimes(1)
        expect(rmMock).toHaveBeenCalledWith(
            resolve(fakeBase, 'old'),
            { recursive: true, force: true },
        )
        expect(infoSpy).toHaveBeenCalledWith('清理过期 skills workspace', { dir: 'old' })
    })

    it('WORKSPACE_BASE 不存在（ENOENT）时静默跳过不打 warn', async () => {
        const enoErr: any = new Error('not found')
        enoErr.code = 'ENOENT'
        readdirMock.mockRejectedValueOnce(enoErr)
        await cleanExpiredWorkspacesService()
        expect(warnSpy).not.toHaveBeenCalled()
    })

    it('其它错误（非 ENOENT）记 warn', async () => {
        const permErr: any = new Error('permission denied')
        permErr.code = 'EACCES'
        readdirMock.mockRejectedValueOnce(permErr)
        await cleanExpiredWorkspacesService()
        expect(warnSpy).toHaveBeenCalledWith(
            'skills workspace 清理失败',
            expect.objectContaining({ error: permErr }),
        )
    })
})

describe('withTimeout', () => {
    it('promise 先 resolve 时返回结果且清理 timer', async () => {
        const out = await withTimeout(Promise.resolve(42), 1000, 'op')
        expect(out).toBe(42)
    })

    it('promise 先 reject 时透传 reject 原因', async () => {
        await expect(withTimeout(Promise.reject(new Error('内部错误')), 1000, 'op'))
            .rejects.toThrow('内部错误')
    })

    it('promise 不 settle 超过 ms 时 reject 超时错误', async () => {
        const neverResolve = new Promise(() => { /* 永不 resolve */ })
        await expect(withTimeout(neverResolve, 30, 'op-slow'))
            .rejects.toThrow(/op-slow.*超时.*0\.03s/)
    })
})
