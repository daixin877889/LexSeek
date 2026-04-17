/**
 * assistant 域服务内部类型 & Zod schema
 *
 * 提供 DAO 写入路径的 Zod 前置校验，确保 userId 为正整数、title 长度受限等。
 * 参见 spec §4.10。
 */

import { z } from 'zod'

/** 创建 assistant 会话输入 */
export const CreateAssistantSessionSchema = z.object({
    userId: z.number().int().positive(),
    title: z.string().max(200).optional(),
})

export type CreateAssistantSessionInput = z.infer<typeof CreateAssistantSessionSchema>

/** 重命名 assistant 会话输入 */
export const UpdateAssistantSessionSchema = z.object({
    sessionId: z.string().min(1),
    userId: z.number().int().positive(),
    title: z.string().min(1).max(200).optional(),
})

export type UpdateAssistantSessionInput = z.infer<typeof UpdateAssistantSessionSchema>

/** 列表分页参数 */
export const ListAssistantSessionsSchema = z.object({
    userId: z.number().int().positive(),
    page: z.number().int().positive().default(1),
    pageSize: z.number().int().positive().max(100).default(20),
})

export type ListAssistantSessionsInput = z.infer<typeof ListAssistantSessionsSchema>
