/**
 * runSkillCommand 工具单测
 *
 * 验证：
 * - 参数校验：NULL 字节
 * - 命令映射：pandoc / markitdown / libreoffice 三类
 * - 平台分支：darwin（裸跑）/ linux（unshare 可用 / 不可用）
 * - execFile 错误：ENOENT / 一般错误
 * - 超时：execFile 同步 throw 时返回错误字符串
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { execFileMock, warnSpy } = vi.hoisted(() => ({
    execFileMock: vi.fn(),
    warnSpy: vi.fn(),
}))

vi.mock('node:child_process', async () => {
    const actual = await vi.importActual<any>('node:child_process')
    const overlay = { ...actual, execFile: (...args: any[]) => execFileMock(...args) }
    return { ...overlay, default: overlay }
})
vi.mock('#shared/utils/logger', () => ({
    logger: { info: vi.fn(), error: vi.fn(), warn: warnSpy, debug: vi.fn() },
}))
;(globalThis as any).logger = { info: vi.fn(), error: vi.fn(), warn: warnSpy, debug: vi.fn() }

import { createTool } from '~~/server/services/agent-platform/tools/runSkillCommand.tool'
import { _resetUnshareDetection } from '~~/server/services/agent-platform/tools/runSkillScript.tool'

const baseCtx = { userId: 1, sessionId: 'sess-cmd-1' } as any

beforeEach(() => {
    vi.clearAllMocks()
    _resetUnshareDetection()
})

describe('runSkillCommand 参数校验', () => {
    it('args 含 NULL 字节返回错误', async () => {
        const t = createTool(baseCtx)
        const out: any = await t.invoke({ command: 'pandoc' as any, args: ['file.md', 'a\0b'] })
        const text = typeof out === 'string' ? out : out.content
        expect(text).toMatch(/NULL 字节/)
    })
})

describe('runSkillCommand 执行路径（darwin）', () => {
    it('pandoc：成功路径返回 stdout', async () => {
        execFileMock.mockImplementation((_bin: string, _args: any, _opts: any, cb: any) => {
            cb(null, '<html>...', '')
        })
        const t = createTool(baseCtx)
        const out: any = await t.invoke({ command: 'pandoc' as any, args: ['input.md', '-o', 'output.html'] })
        const text = typeof out === 'string' ? out : out.content
        expect(text).toBe('<html>...')
        // darwin 走裸跑：第一个参数是命令本身
        expect(execFileMock.mock.calls[0][0]).toBe('pandoc')
    })

    it('markitdown：包装为 python3 -m markitdown', async () => {
        execFileMock.mockImplementation((bin: string, args: any, _opts: any, cb: any) => {
            cb(null, `${bin}|${args.join(',')}`, '')
        })
        const t = createTool(baseCtx)
        const out: any = await t.invoke({ command: 'markitdown' as any, args: ['file.pptx'] })
        const text = typeof out === 'string' ? out : out.content
        expect(text).toMatch(/^python3\|-m,markitdown,file\.pptx$/)
    })

    it('libreoffice：自动注入 --headless', async () => {
        execFileMock.mockImplementation((bin: string, args: any, _opts: any, cb: any) => {
            cb(null, `${bin}|${args.join(',')}`, '')
        })
        const t = createTool(baseCtx)
        const out: any = await t.invoke({
            command: 'libreoffice' as any,
            args: ['--convert-to', 'pdf', 'file.docx'],
        })
        const text = typeof out === 'string' ? out : out.content
        expect(text).toContain('libreoffice|--headless,--convert-to,pdf,file.docx')
    })

    it('stderr 非空时合并 stdout + stderr', async () => {
        execFileMock.mockImplementation((_bin: string, _args: any, _opts: any, cb: any) => {
            cb(null, 'main', 'warning')
        })
        const t = createTool(baseCtx)
        const out: any = await t.invoke({ command: 'pandoc' as any, args: ['x.md'] })
        const text = typeof out === 'string' ? out : out.content
        expect(text).toBe('main\n[stderr]: warning')
    })

    it('ENOENT 时返回友好的安装提示', async () => {
        const err: any = new Error('not found')
        err.code = 'ENOENT'
        execFileMock.mockImplementation((_bin: string, _args: any, _opts: any, cb: any) => {
            cb(err, '', '')
        })
        const t = createTool(baseCtx)
        const out: any = await t.invoke({ command: 'libreoffice' as any, args: ['x.docx'] })
        const text = typeof out === 'string' ? out : out.content
        expect(text).toMatch(/libreoffice 未安装/)
    })

    it('一般错误返回 exit code + stderr', async () => {
        const err: any = new Error('exit')
        err.code = 1
        execFileMock.mockImplementation((_bin: string, _args: any, _opts: any, cb: any) => {
            cb(err, '', 'parse error')
        })
        const t = createTool(baseCtx)
        const out: any = await t.invoke({ command: 'pandoc' as any, args: ['bad.md'] })
        const text = typeof out === 'string' ? out : out.content
        expect(text).toBe('Error (exit 1): parse error')
    })

    it('execFile 同步 throw 被 withTimeout 捕获返回错误字符串', async () => {
        execFileMock.mockImplementationOnce(() => { throw new Error('boom') })
        const t = createTool(baseCtx)
        const out: any = await t.invoke({ command: 'pandoc' as any, args: ['x.md'] })
        const text = typeof out === 'string' ? out : out.content
        expect(text).toMatch(/Error.*boom/)
    })
})

describe('runSkillCommand 执行路径（linux）', () => {
    it('linux + unshare 不可用 → 返回错误提示', async () => {
        const original = process.platform
        Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
        try {
            execFileMock.mockImplementationOnce((_bin: string, _args: any, _opts: any, cb: any) => {
                cb(new Error('command not found'), '', '')
            })
            const t = createTool(baseCtx)
            const out: any = await t.invoke({ command: 'pandoc' as any, args: ['x.md'] })
            const text = typeof out === 'string' ? out : out.content
            expect(text).toMatch(/unshare 不可用/)
        } finally {
            Object.defineProperty(process, 'platform', { value: original, configurable: true })
        }
    })

    it('linux + unshare 可用 → 通过 unshare 包装执行', async () => {
        const original = process.platform
        Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
        try {
            // 第一次：hasUnshare 探测成功
            execFileMock.mockImplementationOnce((_bin: string, _args: any, _opts: any, cb: any) => {
                cb(null, 'ok', '')
            })
            // 第二次：实际命令执行
            execFileMock.mockImplementationOnce((bin: string, args: any, _opts: any, cb: any) => {
                cb(null, `${bin}|${args.join(',')}`, '')
            })
            const t = createTool(baseCtx)
            const out: any = await t.invoke({ command: 'pandoc' as any, args: ['file.md', '-o', 'file.html'] })
            const text = typeof out === 'string' ? out : out.content
            expect(text).toMatch(/^unshare\|-rn,pandoc/)
            expect(text).toContain('file.md')
        } finally {
            Object.defineProperty(process, 'platform', { value: original, configurable: true })
        }
    })
})
