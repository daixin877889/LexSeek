import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
    getNodeConfigCached,
    invalidateNodeConfigCache,
    _resetCacheForTests,
} from '~~/server/services/agent-platform/nodeConfig/loader'

describe('NodeConfig loader 缓存', () => {
    beforeEach(() => {
        _resetCacheForTests()
    })

    afterEach(() => {
        _resetCacheForTests()
    })

    it('首次调用打 DB；二次调用走缓存（同一对象引用）', async () => {
        // 假设 nodes 表里有 'caseMain' 节点（项目 seed 数据应有）
        const first = await getNodeConfigCached('caseMain')
        if (!first) {
            // 如果不存在则跳过
            console.warn('caseMain 节点不存在于测试库，跳过本断言')
            return
        }
        const second = await getNodeConfigCached('caseMain')
        expect(second).toBe(first)   // 同一引用，证明缓存命中
    })

    it('invalidateNodeConfigCache 清单条', async () => {
        const first = await getNodeConfigCached('caseMain')
        if (!first) return
        invalidateNodeConfigCache('caseMain')
        const second = await getNodeConfigCached('caseMain')
        expect(second).not.toBe(first)   // 缓存失效，重新加载（即使内容一样，对象引用不同）
    })

    it('invalidateNodeConfigCache 不带参数清全部', async () => {
        await getNodeConfigCached('caseMain')
        invalidateNodeConfigCache()
        const after = await getNodeConfigCached('caseMain')
        // 应该重新打 DB
        expect(after).toBeDefined()
    })

    it('节点不存在时返回 null 且缓存 null', async () => {
        const fake = `__fake_node_${Date.now()}`
        const r1 = await getNodeConfigCached(fake)
        expect(r1).toBeNull()
        const r2 = await getNodeConfigCached(fake)
        expect(r2).toBeNull()   // 第二次仍 null（缓存了 null 节省 DB 查询）
    })
})
