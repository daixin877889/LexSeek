/**
 * memorySubjectInfer 服务测试
 *
 * **Feature: case-memory-extension**
 * **Validates: spec §3.3 POST API subject_key 推断**
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { inferSubjectKeyService } from '~~/server/services/memory/memorySubjectInfer.service'

vi.mock('~~/server/services/agent-platform/tools/invokeNodeJson', () => ({
    invokeNodeJson: vi.fn(),
}))

import { invokeNodeJson } from '~~/server/services/agent-platform/tools/invokeNodeJson'

describe('inferSubjectKeyService', () => {
    beforeEach(() => vi.clearAllMocks())

    it('节点返回 subject_key 时直接返回', async () => {
        vi.mocked(invokeNodeJson).mockResolvedValueOnce({ subject_key: 'plaintiff.address' })
        const result = await inferSubjectKeyService('原告住北京朝阳')
        expect(result).toBe('plaintiff.address')
    })

    it('节点抛错时返回 null（POST API 走 fallback）', async () => {
        vi.mocked(invokeNodeJson).mockRejectedValueOnce(new Error('LLM down'))
        const result = await inferSubjectKeyService('某事实')
        expect(result).toBeNull()
    })

    it('节点返回空字符串时返回 null', async () => {
        vi.mocked(invokeNodeJson).mockResolvedValueOnce({ subject_key: '' })
        const result = await inferSubjectKeyService('某事实')
        expect(result).toBeNull()
    })
})
