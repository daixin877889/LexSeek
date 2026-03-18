/**
 * 开始案件分析
 */
import { z } from 'zod'


// 请求体验证
const streamAnalysisSchema = z.object({
  /** 指定会话 ID（可选，不指定则使用最新会话或创建新会话） */
  sessionId: z.string().optional(),
  /** 是否强制创建新会话 */
  forceNewSession: z.boolean().optional().default(false),
  /** 恢复数据（用于从中断点恢复） */
  resumeData: z.any().optional(),
})



export default defineEventHandler(async (event) => {
  return 'Hello Nitro'
})
