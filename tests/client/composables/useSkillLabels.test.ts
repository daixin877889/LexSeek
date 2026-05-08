/**
 * useSkillLabels composable 测试
 *
 * **Feature: skills-chinese-name**
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

let mockApiResponse: Array<{ name: string; label: string }> | null = null
let apiCallCount = 0

vi.mock('~/composables/useApiFetch', () => ({
    useApiFetch: vi.fn(async () => {
        apiCallCount++
        return mockApiResponse
    }),
}))

describe('useSkillLabels', () => {
    beforeEach(() => {
        mockApiResponse = null
        apiCallCount = 0
        // 清模块级缓存
        vi.resetModules()
    })

    it('多个组件并发挂载只触发一次 API 请求', async () => {
        mockApiResponse = [
            { name: 'foo', label: '富欧' },
            { name: 'bar', label: '巴' },
        ]
        const { useSkillLabels } = await import('~/composables/useSkillLabels')

        // 模拟 3 个组件同时调用
        const a = useSkillLabels()
        const b = useSkillLabels()
        const c = useSkillLabels()
        // 等 onMounted / load() 微任务执行
        await new Promise(r => setTimeout(r, 0))
        await new Promise(r => setTimeout(r, 0))

        expect(apiCallCount).toBe(1)
        expect(a.label('foo')).toBe('富欧')
        expect(b.label('bar')).toBe('巴')
    })

    it('label 命中映射返回 label，未命中兜底返回 name', async () => {
        mockApiResponse = [{ name: 'foo', label: '富欧' }]
        const { useSkillLabels } = await import('~/composables/useSkillLabels')

        const { label } = useSkillLabels()
        await new Promise(r => setTimeout(r, 0))
        await new Promise(r => setTimeout(r, 0))

        expect(label('foo')).toBe('富欧')
        expect(label('not_in_map')).toBe('not_in_map')
    })

    it('API 返回 null 时兜底空表，label 全部 fallback name', async () => {
        mockApiResponse = null
        const { useSkillLabels } = await import('~/composables/useSkillLabels')

        const { label } = useSkillLabels()
        await new Promise(r => setTimeout(r, 0))
        await new Promise(r => setTimeout(r, 0))

        expect(label('foo')).toBe('foo')
    })
})
