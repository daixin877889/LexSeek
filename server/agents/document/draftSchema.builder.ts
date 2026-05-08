/**
 * 动态 Zod schema 构造器
 *
 * 根据占位符列表构造文书草稿的验证 schema。
 * 占位符去重后，每个占位符映射到 values 对象中的 string | null 字段。
 */
import { z } from 'zod'
import type { Placeholder } from '#shared/types/document'

export function buildDraftSchema(placeholders: Placeholder[]): z.ZodObject<any> {
  // 占位符去重
  const uniqueNames = [...new Set(placeholders.map(p => p.name))]

  // 为每个占位符构建 Zod 字段
  const valuesShape: Record<string, z.ZodType> = {}
  for (const name of uniqueNames) {
    valuesShape[name] = z
      .string()
      .nullable()
      .describe(`占位符 {{${name}}} 的填充值，若无法推断则返回 null`)
  }

  // 返回包含 values 和可选 suggestions、aiTitle 的 schema
  return z.object({
    values: z.object(valuesShape).describe('按模板占位符填充的键值对'),
    suggestions: z
      .record(z.string(), z.string())
      .optional()
      .describe('字段填充依据或建议（key = 占位符名称）'),
    aiTitle: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('AI 推断的文书标题（10~30 字），用于列表/顶栏识别；非文书正文内容'),
  })
}
