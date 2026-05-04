import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { buildLangfuseTopLevelConfig } from '~~/server/lib/langfuse'

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
 *
 * 调用方均已外层 withLangfuseContext 注入 vertical / userId / caseId 等上下文，
 * 这里把 langfuseHandler 显式注入到 model.invoke 的 RunnableConfig.callbacks，
 * 让裸 model 调用也能产生 generation span（modelProxy 不再注入 callbacks，避免
 * 在 chain 内调用时把 LangGraph 的 StreamMessagesHandler 挤掉）。
 */
export async function generateSummaryService(
  model: BaseChatModel,
  text: string,
  options: GenerateSummaryOptions,
): Promise<string> {
  const { maxChars, systemPrompt } = options
  const defaultSystemPrompt = `请对下方文本生成一段中文摘要，限制在 ${maxChars} 字以内，保留关键事实、时间、数字，不要加任何开场白或总结语，直接输出摘要正文。`
  const sys = systemPrompt ?? defaultSystemPrompt

  const res = await model.invoke(
    [
      { role: 'system', content: sys },
      { role: 'user', content: text },
    ],
    buildLangfuseTopLevelConfig(),
  )
  // content 三种形态：
  //   1. string                       （OpenAI / DeepSeek 标准）
  //   2. Array<{type:'text',text}>    （Anthropic content blocks）
  //   3. Array<含 thinking/reasoning> （只取 type==='text' 部分，排除思考块）
  // 历史 bug：`String(array)` 在数组形态下会输出 `[object Object],[object Object]`，
  // 该 summary 直接进 DB 与前端摘要卡片，必须显式提取 text 块再拼接。
  const raw = typeof res.content === 'string'
    ? res.content
    : Array.isArray(res.content)
      ? res.content
          .filter((b: any) => b && typeof b === 'object' && b.type === 'text' && typeof b.text === 'string')
          .map((b: any) => b.text)
          .join('')
      : String(res.content)
  const trimmed = raw.trim()
  return trimmed.length > maxChars ? trimmed.slice(0, maxChars) : trimmed
}
