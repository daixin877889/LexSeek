import { describe, it, expect, vi } from 'vitest'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { generateSummaryService } from '~~/server/services/ai/summaryService'

describe('generateSummaryService', () => {
  it('100 字场景（M2 材料）用 Haiku 4.5 + maxChars=100', async () => {
    const mockModel = {
      invoke: vi.fn().mockResolvedValue({ content: '合同约定甲乙双方在 6 月 1 日前完成交付；违约金 10%' }),
    }
    const res = await generateSummaryService(mockModel as unknown as BaseChatModel, '一份很长的合同文本...', { maxChars: 100 })
    expect(res.length).toBeLessThanOrEqual(100)
    expect(mockModel.invoke).toHaveBeenCalledOnce()
  })

  it('400 字场景（M4 分析）支持自定义 systemPrompt', async () => {
    const mockModel = {
      invoke: vi.fn().mockResolvedValue({ content: '风险等级：中高。主要依据...' }),
    }
    const res = await generateSummaryService(mockModel as unknown as BaseChatModel, '风险评估分析正文...', {
      maxChars: 400,
      systemPrompt: '你是法律助手，对分析报告做 200-400 字的专业摘要',
    })
    expect(res).toContain('风险等级')
    expect(res.length).toBeLessThanOrEqual(400)
  })

  it('模型返回超长时截断到 maxChars', async () => {
    const mockModel = {
      invoke: vi.fn().mockResolvedValue({ content: 'x'.repeat(500) }),
    }
    const res = await generateSummaryService(mockModel as unknown as BaseChatModel, 'text', { maxChars: 100 })
    expect(res.length).toBeLessThanOrEqual(100)
  })

  it('空字符串 text 输入不崩溃', async () => {
    const mockModel = {
      invoke: vi.fn().mockResolvedValue({ content: '无法生成摘要' }),
    }
    const res = await generateSummaryService(mockModel as unknown as BaseChatModel, '', { maxChars: 100 })
    expect(res).toBeDefined()
    expect(typeof res).toBe('string')
  })

  it('模型抛异常时向上传播', async () => {
    const mockModel = {
      invoke: vi.fn().mockRejectedValue(new Error('Model error: rate limited')),
    }
    await expect(
      generateSummaryService(mockModel as unknown as BaseChatModel, 'text', { maxChars: 100 })
    ).rejects.toThrow('Model error: rate limited')
  })
})
