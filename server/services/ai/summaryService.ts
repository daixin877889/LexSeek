import type { BaseChatModel } from '@langchain/core/language_models/chat_models'

export interface GenerateSummaryOptions {
  /** 摘要最大字符数（中文字符计 1） */
  maxChars: number
  /** 自定义 system prompt；默认通用摘要 prompt */
  systemPrompt?: string
}

/**
 * 通用文本摘要 helper。
 * - M2 材料摘要：Haiku 4.5 + maxChars=100
 * - M4 分析摘要：主模型 + maxChars=400
 */
export async function generateSummaryService(
  model: BaseChatModel,
  text: string,
  options: GenerateSummaryOptions,
): Promise<string> {
  const { maxChars, systemPrompt } = options
  const defaultSystemPrompt = `请对下方文本生成一段中文摘要，限制在 ${maxChars} 字以内，保留关键事实、时间、数字，不要加任何开场白或总结语，直接输出摘要正文。`
  const sys = systemPrompt ?? defaultSystemPrompt

  const res = await model.invoke([
    { role: 'system', content: sys },
    { role: 'user', content: text },
  ])
  const raw = typeof res.content === 'string' ? res.content : String(res.content)
  const trimmed = raw.trim()
  return trimmed.length > maxChars ? trimmed.slice(0, maxChars) : trimmed
}
