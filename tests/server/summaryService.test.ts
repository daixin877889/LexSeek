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
      systemPrompt: '你是通用问答，对分析报告做 200-400 字的专业摘要',
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

  it('content 是 Anthropic content blocks 数组时仅拼接 type=text，避免 [object Object] bug', async () => {
    // 历史 bug：旧实现 String(array) → '[object Object],[object Object]'
    // 修复：只拼 type==='text' 的块，排除 thinking / reasoning 等
    const mockModel = {
      invoke: vi.fn().mockResolvedValue({
        content: [
          { type: 'thinking', thinking: '内部思考不该进摘要' },
          { type: 'text', text: '风险等级：高。' },
          { type: 'text', text: '关键依据：合同第 5 条。' },
        ],
      }),
    }
    const res = await generateSummaryService(mockModel as unknown as BaseChatModel, '正文', { maxChars: 100 })
    expect(res).toBe('风险等级：高。关键依据：合同第 5 条。')
    expect(res).not.toContain('[object Object]')
    expect(res).not.toContain('内部思考')
  })

  it('content 数组没有 type=text 块时返回空字符串而非崩溃', async () => {
    const mockModel = {
      invoke: vi.fn().mockResolvedValue({
        content: [{ type: 'thinking', thinking: '只有思考' }],
      }),
    }
    const res = await generateSummaryService(mockModel as unknown as BaseChatModel, '正文', { maxChars: 100 })
    expect(res).toBe('')
  })
})
