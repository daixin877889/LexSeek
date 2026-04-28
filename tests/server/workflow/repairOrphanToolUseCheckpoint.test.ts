/**
 * repairOrphanToolUseCheckpoint DB 集成路径单元测试
 *
 * **Feature: agent-error-recovery**
 * **Validates: 修复指定 sessionId 关联 thread_id × checkpoint_ns 下最新 checkpoint
 *  的 orphan tool_use；覆盖空数据、无 messages 通道、blob 缺失、JSON 解析失败、
 *  patched 写回路径，以及多 ns / 子 thread 扫描行为**
 *
 * 通过 vi.stubGlobal 注入 prisma mock 拦截 `$queryRaw` / `$executeRaw` tagged
 * template，按 SQL 关键词分发到对应桩函数。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// vi.mock 是 hoisted，工厂函数内不能直接引用顶层变量；用 vi.hoisted 把 mock logger 创建提前
const { mockLogger } = vi.hoisted(() => ({
    mockLogger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}))

vi.mock('#shared/utils/logger', () => ({ logger: mockLogger }))

import { repairOrphanToolUseCheckpoint, type SerializedMessage } from '../../../server/services/workflow/repairOrphanToolUse'

// ==================== Prisma Mock 工具 ====================

interface PrismaMockState {
    /** thread_id 列表查询结果 */
    threads: { thread_id: string }[]
    /** thread_id → checkpoint_ns 列表 */
    namespacesByThread: Record<string, { checkpoint_ns: string }[]>
    /** `${threadId}::${ns}` → checkpoint row（含 channel_versions） */
    checkpointsByScope: Record<string, Array<{ checkpoint: { channel_versions?: Record<string, string | number> } }>>
    /** `${threadId}::${ns}::${version}` → blob row */
    blobsByScopeVersion: Record<string, Array<{ blob: Buffer | null, type: string }>>
    /** 累计 $executeRaw 调用记录 */
    executeRawCalls: Array<{ sqlPart: string, values: unknown[] }>
}

function createMockState(): PrismaMockState {
    return {
        threads: [],
        namespacesByThread: {},
        checkpointsByScope: {},
        blobsByScopeVersion: {},
        executeRawCalls: [],
    }
}

/**
 * 把 tagged template 还原为可识别的字符串，用以判断本次查询查的是哪张表
 */
function joinTemplate(strings: TemplateStringsArray | { raw: readonly string[] } | string[]): string {
    if (Array.isArray(strings)) return strings.join('?')
    if ('raw' in strings) return Array.from(strings.raw).join('?')
    return Array.from(strings as unknown as string[]).join('?')
}

function setupPrismaMock(state: PrismaMockState) {
    const $queryRaw = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = joinTemplate(strings)
        // SELECT DISTINCT thread_id FROM checkpoints WHERE thread_id = ${} OR LIKE ${}
        if (sql.includes('SELECT DISTINCT thread_id')) {
            return state.threads
        }
        // SELECT DISTINCT checkpoint_ns FROM checkpoints WHERE thread_id = ${}
        if (sql.includes('SELECT DISTINCT checkpoint_ns')) {
            const threadId = String(values[0])
            return state.namespacesByThread[threadId] ?? []
        }
        // SELECT checkpoint FROM checkpoints WHERE thread_id = ${} AND checkpoint_ns = ${}
        if (sql.includes('SELECT checkpoint') && sql.includes('FROM checkpoints')) {
            const threadId = String(values[0])
            const ns = String(values[1])
            return state.checkpointsByScope[`${threadId}::${ns}`] ?? []
        }
        // SELECT blob, type FROM checkpoint_blobs ... AND version = ${}
        if (sql.includes('SELECT blob') && sql.includes('checkpoint_blobs')) {
            const threadId = String(values[0])
            const ns = String(values[1])
            const version = String(values[2])
            return state.blobsByScopeVersion[`${threadId}::${ns}::${version}`] ?? []
        }
        return []
    })

    const $executeRaw = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = joinTemplate(strings)
        state.executeRawCalls.push({ sqlPart: sql, values })
        return 1
    })

    return { $queryRaw, $executeRaw }
}

// ==================== 测试辅助：构造 SerializedMessage ====================

function aiToolUse(toolCalls: Array<{ id: string, name?: string }>): SerializedMessage {
    return {
        lc: 1,
        type: 'constructor',
        id: ['langchain_core', 'messages', 'AIMessage'],
        kwargs: {
            content: '',
            tool_calls: toolCalls.map(tc => ({ id: tc.id, name: tc.name ?? 't', args: {}, type: 'tool_call' })),
        },
    }
}

function humanMsg(content: string): SerializedMessage {
    return {
        lc: 1,
        type: 'constructor',
        id: ['langchain_core', 'messages', 'HumanMessage'],
        kwargs: { content },
    }
}

// ==================== 测试 ====================

describe('repairOrphanToolUseCheckpoint DB 集成', () => {
    let state: PrismaMockState

    beforeEach(() => {
        state = createMockState()
        vi.stubGlobal('prisma', setupPrismaMock(state))
        mockLogger.info.mockClear()
        mockLogger.warn.mockClear()
        mockLogger.error.mockClear()
        mockLogger.debug.mockClear()
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('查不到任何 thread 时直接返回 fixed=0 / parseFailures=0', async () => {
        state.threads = []

        const result = await repairOrphanToolUseCheckpoint('session-empty', '中断')

        expect(result).toEqual({ fixed: 0, parseFailures: 0 })
    })

    it('thread 存在但 ns 列表为空时返回 0', async () => {
        state.threads = [{ thread_id: 'session-A' }]
        state.namespacesByThread = { 'session-A': [] }

        const result = await repairOrphanToolUseCheckpoint('session-A', '中断')

        expect(result).toEqual({ fixed: 0, parseFailures: 0 })
    })

    it('checkpoints 表无最新 checkpoint 时该 scope 跳过', async () => {
        state.threads = [{ thread_id: 'session-B' }]
        state.namespacesByThread = { 'session-B': [{ checkpoint_ns: '' }] }
        state.checkpointsByScope = { 'session-B::': [] } // 空数组

        const result = await repairOrphanToolUseCheckpoint('session-B', '中断')

        expect(result).toEqual({ fixed: 0, parseFailures: 0 })
        expect(state.executeRawCalls).toHaveLength(0)
    })

    it('checkpoint 缺少 messages channel_version 时跳过该 scope', async () => {
        state.threads = [{ thread_id: 'session-C' }]
        state.namespacesByThread = { 'session-C': [{ checkpoint_ns: '' }] }
        state.checkpointsByScope = {
            'session-C::': [{ checkpoint: { channel_versions: {} } }],
        }

        const result = await repairOrphanToolUseCheckpoint('session-C', '中断')

        expect(result).toEqual({ fixed: 0, parseFailures: 0 })
    })

    it('checkpoint.channel_versions 为 undefined 时跳过', async () => {
        state.threads = [{ thread_id: 'session-CC' }]
        state.namespacesByThread = { 'session-CC': [{ checkpoint_ns: '' }] }
        state.checkpointsByScope = {
            'session-CC::': [{ checkpoint: {} }],
        }

        const result = await repairOrphanToolUseCheckpoint('session-CC', '中断')
        expect(result).toEqual({ fixed: 0, parseFailures: 0 })
    })

    it('messages blob 不存在时跳过', async () => {
        state.threads = [{ thread_id: 'session-D' }]
        state.namespacesByThread = { 'session-D': [{ checkpoint_ns: '' }] }
        state.checkpointsByScope = {
            'session-D::': [{ checkpoint: { channel_versions: { messages: '5' } } }],
        }
        state.blobsByScopeVersion = { 'session-D::::5': [] }

        const result = await repairOrphanToolUseCheckpoint('session-D', '中断')
        expect(result).toEqual({ fixed: 0, parseFailures: 0 })
    })

    it('messages blob.type 不是 json 时跳过', async () => {
        state.threads = [{ thread_id: 'session-E' }]
        state.namespacesByThread = { 'session-E': [{ checkpoint_ns: '' }] }
        state.checkpointsByScope = {
            'session-E::': [{ checkpoint: { channel_versions: { messages: '5' } } }],
        }
        state.blobsByScopeVersion = {
            'session-E::::5': [{ blob: Buffer.from('[]'), type: 'msgpack' }],
        }

        const result = await repairOrphanToolUseCheckpoint('session-E', '中断')
        expect(result).toEqual({ fixed: 0, parseFailures: 0 })
    })

    it('blob 字段为 null 时跳过', async () => {
        state.threads = [{ thread_id: 'session-EN' }]
        state.namespacesByThread = { 'session-EN': [{ checkpoint_ns: '' }] }
        state.checkpointsByScope = {
            'session-EN::': [{ checkpoint: { channel_versions: { messages: '5' } } }],
        }
        state.blobsByScopeVersion = {
            'session-EN::::5': [{ blob: null, type: 'json' }],
        }

        const result = await repairOrphanToolUseCheckpoint('session-EN', '中断')
        expect(result).toEqual({ fixed: 0, parseFailures: 0 })
    })

    it('JSON 解析失败时返回 parseFailures=1 且 logger.error 被调用', async () => {
        state.threads = [{ thread_id: 'session-F' }]
        state.namespacesByThread = { 'session-F': [{ checkpoint_ns: '' }] }
        state.checkpointsByScope = {
            'session-F::': [{ checkpoint: { channel_versions: { messages: '7' } } }],
        }
        state.blobsByScopeVersion = {
            'session-F::::7': [{ blob: Buffer.from('not json {'), type: 'json' }],
        }

        const result = await repairOrphanToolUseCheckpoint('session-F', '中断')
        expect(result).toEqual({ fixed: 0, parseFailures: 1 })
        expect(mockLogger.error).toHaveBeenCalled()
    })

    it('JSON 解析后不是数组时跳过（parseFailed=false）', async () => {
        state.threads = [{ thread_id: 'session-G' }]
        state.namespacesByThread = { 'session-G': [{ checkpoint_ns: '' }] }
        state.checkpointsByScope = {
            'session-G::': [{ checkpoint: { channel_versions: { messages: '8' } } }],
        }
        // 反序列化结果是 object 而不是 array
        state.blobsByScopeVersion = {
            'session-G::::8': [{ blob: Buffer.from('{"foo":"bar"}'), type: 'json' }],
        }

        const result = await repairOrphanToolUseCheckpoint('session-G', '中断')
        expect(result).toEqual({ fixed: 0, parseFailures: 0 })
    })

    it('JSON blob 含尾部 null bytes 时正常 strip 后解析', async () => {
        state.threads = [{ thread_id: 'session-H' }]
        state.namespacesByThread = { 'session-H': [{ checkpoint_ns: '' }] }
        state.checkpointsByScope = {
            'session-H::': [{ checkpoint: { channel_versions: { messages: '9' } } }],
        }
        const messages: SerializedMessage[] = [
            humanMsg('hi'),
            aiToolUse([{ id: 'call_1' }]),
        ]
        // 在末尾添加 null bytes 模拟 langgraph-checkpoint-postgres 行为
        const json = JSON.stringify(messages) + '   '
        state.blobsByScopeVersion = {
            'session-H::::9': [{ blob: Buffer.from(json, 'utf8'), type: 'json' }],
        }

        const result = await repairOrphanToolUseCheckpoint('session-H', '执行被打断')
        expect(result).toEqual({ fixed: 1, parseFailures: 0 })
        expect(state.executeRawCalls).toHaveLength(1)
        expect(state.executeRawCalls[0].sqlPart).toContain('UPDATE checkpoint_blobs')
    })

    it('messages 为空数组（无 orphan）时不写回 blob', async () => {
        state.threads = [{ thread_id: 'session-I' }]
        state.namespacesByThread = { 'session-I': [{ checkpoint_ns: '' }] }
        state.checkpointsByScope = {
            'session-I::': [{ checkpoint: { channel_versions: { messages: '10' } } }],
        }
        const json = JSON.stringify([humanMsg('hi')])
        state.blobsByScopeVersion = {
            'session-I::::10': [{ blob: Buffer.from(json), type: 'json' }],
        }

        const result = await repairOrphanToolUseCheckpoint('session-I', '中断')
        expect(result).toEqual({ fixed: 0, parseFailures: 0 })
        expect(state.executeRawCalls).toHaveLength(0)
    })

    it('修复成功时把 patched 写回相同 version 的 blob 并 logger.info', async () => {
        state.threads = [{ thread_id: 'session-J' }]
        state.namespacesByThread = { 'session-J': [{ checkpoint_ns: '' }] }
        state.checkpointsByScope = {
            'session-J::': [{ checkpoint: { channel_versions: { messages: '11' } } }],
        }
        const messages: SerializedMessage[] = [
            humanMsg('start'),
            aiToolUse([{ id: 'call_1', name: 'search_law' }]),
        ]
        state.blobsByScopeVersion = {
            'session-J::::11': [{ blob: Buffer.from(JSON.stringify(messages)), type: 'json' }],
        }

        const result = await repairOrphanToolUseCheckpoint('session-J', '执行超时')
        expect(result).toEqual({ fixed: 1, parseFailures: 0 })
        // 验证 UPDATE 调用并确认 version 是 '11'
        expect(state.executeRawCalls).toHaveLength(1)
        const updateCall = state.executeRawCalls[0]
        expect(updateCall.sqlPart).toContain('UPDATE checkpoint_blobs')
        // values: [patchedBuffer, threadId, checkpointNs, versionStr]
        expect(updateCall.values[1]).toBe('session-J')
        expect(updateCall.values[2]).toBe('')
        expect(updateCall.values[3]).toBe('11')
        // 写回的 buffer 应包含合成的 ToolMessage
        const writtenBlob = updateCall.values[0] as Buffer
        const written = JSON.parse(writtenBlob.toString('utf8')) as SerializedMessage[]
        expect(written).toHaveLength(3)
        expect(written[2]!.id[2]).toBe('ToolMessage')
        expect(written[2]!.kwargs.tool_call_id).toBe('call_1')
        expect(written[2]!.kwargs.content).toBe('工具执行被中断：执行超时')
        expect(mockLogger.info).toHaveBeenCalled()
    })

    it('多个 thread × 多个 ns 时累加 fixed 数', async () => {
        // 主 thread 1 个 ns + 子 thread 1 个 ns，两个都有 1 个 orphan
        state.threads = [
            { thread_id: 'session-K' },
            { thread_id: 'session-K_sub_search' },
        ]
        state.namespacesByThread = {
            'session-K': [{ checkpoint_ns: '' }, { checkpoint_ns: 'claim:abc' }],
            'session-K_sub_search': [{ checkpoint_ns: '' }],
        }
        state.checkpointsByScope = {
            'session-K::': [{ checkpoint: { channel_versions: { messages: '1' } } }],
            'session-K::claim:abc': [{ checkpoint: { channel_versions: { messages: '1' } } }],
            'session-K_sub_search::': [{ checkpoint: { channel_versions: { messages: '1' } } }],
        }
        const orphan = JSON.stringify([humanMsg('q'), aiToolUse([{ id: 'call_x' }])])
        state.blobsByScopeVersion = {
            'session-K::::1': [{ blob: Buffer.from(orphan), type: 'json' }],
            'session-K::claim:abc::1': [{ blob: Buffer.from(orphan), type: 'json' }],
            'session-K_sub_search::::1': [{ blob: Buffer.from(orphan), type: 'json' }],
        }

        const result = await repairOrphanToolUseCheckpoint('session-K', '中断')
        expect(result).toEqual({ fixed: 3, parseFailures: 0 })
        expect(state.executeRawCalls).toHaveLength(3)
    })

    it('messages version 为数字类型时也能正确转 string 并查询 blob', async () => {
        state.threads = [{ thread_id: 'session-L' }]
        state.namespacesByThread = { 'session-L': [{ checkpoint_ns: '' }] }
        state.checkpointsByScope = {
            // version 是数字 42
            'session-L::': [{ checkpoint: { channel_versions: { messages: 42 } } }],
        }
        const messages = [humanMsg('q'), aiToolUse([{ id: 'call_z' }])]
        state.blobsByScopeVersion = {
            'session-L::::42': [{ blob: Buffer.from(JSON.stringify(messages)), type: 'json' }],
        }

        const result = await repairOrphanToolUseCheckpoint('session-L', '崩溃')
        expect(result).toEqual({ fixed: 1, parseFailures: 0 })
    })

    it('多个 ns 中部分 parseFailed 时累加 parseFailures 而不影响其他成功修复', async () => {
        state.threads = [{ thread_id: 'session-M' }]
        state.namespacesByThread = {
            'session-M': [{ checkpoint_ns: 'good' }, { checkpoint_ns: 'bad' }],
        }
        state.checkpointsByScope = {
            'session-M::good': [{ checkpoint: { channel_versions: { messages: '1' } } }],
            'session-M::bad': [{ checkpoint: { channel_versions: { messages: '1' } } }],
        }
        state.blobsByScopeVersion = {
            'session-M::good::1': [{
                blob: Buffer.from(JSON.stringify([humanMsg('q'), aiToolUse([{ id: 'call_a' }])])),
                type: 'json',
            }],
            'session-M::bad::1': [{ blob: Buffer.from('not json'), type: 'json' }],
        }

        const result = await repairOrphanToolUseCheckpoint('session-M', '中断')
        expect(result.fixed).toBe(1)
        expect(result.parseFailures).toBe(1)
    })
})
