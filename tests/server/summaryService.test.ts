import { describe, it, expect, vi } from 'vitest'
import { generateSummaryService } from '~~/server/services/ai/summaryService'

describe('generateSummaryService', () => {
  it('100 字场景（M2 材料）用 Haiku 4.5 + maxChars=100', async () => {
    const mockModel = {
      invoke: vi.fn().mockResolvedValue({ content: '合同约定甲乙双方在 6 月 1 日前完成交付；违约金 10%' }),
    }
    const res = await generateSummaryService(mockModel as any, '一份很长的合同文本...', { maxChars: 100 })
    expect(res.length).toBeLessThanOrEqual(100)
    expect(mockModel.invoke).toHaveBeenCalledOnce()
  })

  it('400 字场景（M4 分析）支持自定义 systemPrompt', async () => {
    const mockModel = {
      invoke: vi.fn().mockResolvedValue({ content: '风险等级：中高。主要依据...' }),
    }
    const res = await generateSummaryService(mockModel as any, '风险评估分析正文...', {
      maxChars: 400,
      systemPrompt: '你是法律助手，对分析报告做 200-400 字的专业摘要',
    })
    expect(res).toContain('风险等级')
  })

  it('模型返回超长时截断到 maxChars', async () => {
    const mockModel = {
      invoke: vi.fn().mockResolvedValue({ content: 'x'.repeat(500) }),
    }
    const res = await generateSummaryService(mockModel as any, 'text', { maxChars: 100 })
    expect(res.length).toBeLessThanOrEqual(100)
  })
})
