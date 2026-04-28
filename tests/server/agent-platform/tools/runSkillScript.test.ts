/**
 * runSkillScript 工具单测
 *
 * 验证：
 * - 安全校验：skillName/scriptName/action 非法字符 / args key 非法 / args value 过长
 * - 扩展名映射：不支持的扩展名返回错误
 * - _workspace 路径模式 + 普通 skill 路径模式
 * - 平台分支：darwin（裸跑）/ linux（unshare）
 * - hasUnshare 缓存命中
 * - execFile：成功 / err.code=ENOENT / err.code=MODULE_NOT_FOUND / 一般错误
 * - 超时分支：withTimeout 抛错时返回错误字符串
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { execFileMock, warnSpy, getPlatformReturn } = vi.hoisted(() => ({
    execFileMock: vi.fn(),
    warnSpy: vi.fn(),
    getPlatformReturn: { v: 'darwin' as NodeJS.Platform },
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

import {
    createTool,
    getPlatform,
    hasUnshare,
    _resetUnshareDetection,
} from '~~/server/services/agent-platform/tools/runSkillScript.tool'

const baseCtx = { userId: 1, sessionId: 'sess-1' } as any

beforeEach(() => {
    vi.clearAllMocks()
    _resetUnshareDetection()
})

describe('getPlatform', () => {
    it('返回 process.platform', () => {
        expect(['darwin', 'linux', 'win32', 'freebsd', 'sunos', 'aix', 'openbsd', 'cygwin', 'haiku', 'netbsd', 'android']).toContain(getPlatform())
    })
})

describe('hasUnshare', () => {
    it('execFile 成功时缓存 true 并复用', async () => {
        execFileMock.mockImplementation((_bin: string, _args: any, _opts: any, cb: any) => {
            cb(null, 'ok', '')
        })
        expect(await hasUnshare()).toBe(true)
        expect(await hasUnshare()).toBe(true)
        // 仅探测一次（缓存命中）
        expect(execFileMock).toHaveBeenCalledTimes(1)
    })

    it('execFile 失败时缓存 false', async () => {
        execFileMock.mockImplementation((_bin: string, _args: any, _opts: any, cb: any) => {
            cb(new Error('command not found'), '', '')
        })
        expect(await hasUnshare()).toBe(false)
        expect(await hasUnshare()).toBe(false)
        expect(execFileMock).toHaveBeenCalledTimes(1)
    })
})

describe('createTool 参数校验', () => {
    it('skillName 非法字符返回错误', async () => {
        const t = createTool(baseCtx)
        const out: any = await t.invoke({ skillName: 'a/b', scriptName: 'x.cjs', action: 'run' })
        const text = typeof out === 'string' ? out : out.content
        expect(text).toContain('非法字符')
    })

    it('args key 不符合白名单返回错误', async () => {
        const t = createTool(baseCtx)
        const out: any = await t.invoke({
            skillName: 'lex',
            scriptName: 'x.cjs',
            action: 'run',
            args: { '0bad': 'v' }, // 数字开头不符合 SAFE_ARG_KEY
        })
        const text = typeof out === 'string' ? out : out.content
        expect(text).toMatch(/参数名.*非法/)
    })

    it('args value 超长返回错误', async () => {
        const t = createTool(baseCtx)
        const out: any = await t.invoke({
            skillName: 'lex',
            scriptName: 'x.cjs',
            action: 'run',
            args: { q: 'x'.repeat(5000) },
        })
        const text = typeof out === 'string' ? out : out.content
        expect(text).toContain('过长')
    })

    it('不支持的扩展名返回错误', async () => {
        const t = createTool(baseCtx)
        const out: any = await t.invoke({
            skillName: 'lex',
            scriptName: 'x.exe',
            action: 'run',
        })
        const text = typeof out === 'string' ? out : out.content
        expect(text).toMatch(/不支持的脚本类型/)
    })
})

describe('createTool 执行路径', () => {
    it('darwin：成功路径返回 stdout', async () => {
        execFileMock.mockImplementation((_bin: string, _args: any, _opts: any, cb: any) => {
            cb(null, '执行成功', '')
        })
        const t = createTool(baseCtx, '/tmp/skills')
        const out: any = await t.invoke({
            skillName: 'lex',
            scriptName: 'x.cjs',
            action: 'run',
            args: { query: 'hello' },
        })
        const text = typeof out === 'string' ? out : out.content
        expect(text).toBe('执行成功')
        // darwin 走裸跑 → 第 0 个参数应为 'node'
        expect(execFileMock.mock.calls[0][0]).toBe('node')
        expect(warnSpy).toHaveBeenCalledWith(
            '开发环境未启用 skill 子进程外网隔离',
            expect.any(Object),
        )
    })

    it('darwin：stdout + stderr 时合并返回', async () => {
        execFileMock.mockImplementation((_bin: string, _args: any, _opts: any, cb: any) => {
            cb(null, 'main output', 'warn line')
        })
        const t = createTool(baseCtx, '/tmp/skills')
        const out: any = await t.invoke({
            skillName: 'lex',
            scriptName: 'x.cjs',
            action: 'run',
        })
        const text = typeof out === 'string' ? out : out.content
        expect(text).toBe('main output\n[stderr]: warn line')
    })

    it('darwin：err.code=ENOENT 返回脚本不存在', async () => {
        const err: any = new Error('not found')
        err.code = 'ENOENT'
        execFileMock.mockImplementation((_bin: string, _args: any, _opts: any, cb: any) => {
            cb(err, '', '')
        })
        const t = createTool(baseCtx, '/tmp/skills')
        const out: any = await t.invoke({
            skillName: 'lex',
            scriptName: 'x.cjs',
            action: 'run',
        })
        const text = typeof out === 'string' ? out : out.content
        expect(text).toMatch(/脚本不存在.*lex\/scripts\/x\.cjs/)
    })

    it('darwin：MODULE_NOT_FOUND 也视为脚本不存在', async () => {
        const err: any = new Error('Cannot find module')
        err.code = 'MODULE_NOT_FOUND'
        execFileMock.mockImplementation((_bin: string, _args: any, _opts: any, cb: any) => {
            cb(err, '', '')
        })
        const t = createTool(baseCtx, '/tmp/skills')
        const out: any = await t.invoke({
            skillName: 'lex',
            scriptName: 'x.cjs',
            action: 'run',
        })
        const text = typeof out === 'string' ? out : out.content
        expect(text).toMatch(/脚本不存在/)
    })

    it('darwin：stderr 含 "Cannot find module" 也视为脚本不存在', async () => {
        const err: any = new Error('exit 1')
        err.code = 1
        execFileMock.mockImplementation((_bin: string, _args: any, _opts: any, cb: any) => {
            cb(err, '', 'Error: Cannot find module ...')
        })
        const t = createTool(baseCtx, '/tmp/skills')
        const out: any = await t.invoke({
            skillName: 'lex',
            scriptName: 'x.cjs',
            action: 'run',
        })
        const text = typeof out === 'string' ? out : out.content
        expect(text).toMatch(/脚本不存在/)
    })

    it('darwin：一般执行错误返回 exit code + stderr', async () => {
        const err: any = new Error('failed')
        err.code = 1
        execFileMock.mockImplementation((_bin: string, _args: any, _opts: any, cb: any) => {
            cb(err, '', 'syntax error')
        })
        const t = createTool(baseCtx, '/tmp/skills')
        const out: any = await t.invoke({
            skillName: 'lex',
            scriptName: 'x.cjs',
            action: 'run',
        })
        const text = typeof out === 'string' ? out : out.content
        expect(text).toMatch(/Error \(exit 1\): syntax error/)
    })

    it('_workspace 模式：脚本路径基于 workspaceDir', async () => {
        execFileMock.mockImplementation((_bin: string, args: any, _opts: any, cb: any) => {
            // args[0] 是 scriptPath（_workspace 模式下应包含 sessionId）
            cb(null, args[0], '')
        })
        const t = createTool(baseCtx)
        const out: any = await t.invoke({
            skillName: '_workspace',
            scriptName: 'tmp.cjs',
            action: 'go',
        })
        const text = typeof out === 'string' ? out : out.content
        expect(text).toContain('/sess-1/tmp.cjs')
    })

    it('linux + unshare 不可用 → 返回错误提示', async () => {
        // 通过 Object.defineProperty 改 process.platform → getPlatform 直接读
        const original = process.platform
        Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
        try {
            // 模拟 unshare 探测失败
            execFileMock.mockImplementationOnce((_bin: string, _args: any, _opts: any, cb: any) => {
                cb(new Error('not found'), '', '')
            })
            const t = createTool(baseCtx, '/tmp/skills')
            const out: any = await t.invoke({
                skillName: 'lex',
                scriptName: 'x.cjs',
                action: 'run',
            })
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
            // 第二次：实际脚本执行
            execFileMock.mockImplementationOnce((bin: string, args: any, _opts: any, cb: any) => {
                cb(null, `${bin} ${args.join(' ')}`, '')
            })
            const t = createTool(baseCtx, '/tmp/skills')
            const out: any = await t.invoke({
                skillName: 'lex',
                scriptName: 'x.cjs',
                action: 'run',
            })
            const text = typeof out === 'string' ? out : out.content
            expect(text).toMatch(/^unshare /)
            expect(text).toContain('-rn')
            expect(text).toContain('node')
        } finally {
            Object.defineProperty(process, 'platform', { value: original, configurable: true })
        }
    })

    it('execFile 同步 throw 时被 withTimeout 捕获并返回错误字符串', async () => {
        execFileMock.mockImplementationOnce(() => { throw new Error('synchronous boom') })
        const t = createTool(baseCtx, '/tmp/skills')
        const out: any = await t.invoke({
            skillName: 'lex',
            scriptName: 'x.cjs',
            action: 'run',
        })
        const text = typeof out === 'string' ? out : out.content
        expect(text).toMatch(/Error.*synchronous boom/)
    })

    it('路径逃逸：skillName 含 .. 时返回脚本不存在（经过 SAFE_NAME 校验后还需 startsWith 兜底）', async () => {
        // SAFE_NAME 允许字母数字下划线点连字符；".." 是合法的 SAFE_NAME（只含点号）
        // 此时 resolve(SKILLS_ROOT, '..', 'scripts', 'x.cjs') 会逃逸到上级目录
        const t = createTool(baseCtx, '/tmp/skills/lex')
        const out: any = await t.invoke({
            skillName: '..',
            scriptName: 'x.cjs',
            action: 'run',
        })
        const text = typeof out === 'string' ? out : out.content
        expect(text).toMatch(/脚本不存在/)
    })
})
