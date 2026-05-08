/**
 * subject_key 推断服务
 *
 * POST /api/v1/case/memories/by-case/:caseId 用：
 * 用户填了 text 但没填 subjectKey 时，调本服务让 LLM 推断"主体.字段"格式。
 *
 * 失败 fallback null（POST 写入空 subjectKey，不参与版本链）。
 */
import { z } from 'zod'
import { logger } from '#shared/utils/logger'
import { invokeNodeJson } from '~~/server/services/agent-platform/tools/invokeNodeJson'

const subjectInferSchema = z.object({
    subject_key: z.string(),
})

export async function inferSubjectKeyService(text: string): Promise<string | null> {
    try {
        const result = await invokeNodeJson({
            nodeName: 'caseMemorySubjectInfer',
            temperature: 0.0, // 输出确定性优先
            schema: subjectInferSchema,
            buildPrompt: template => template.replace('{{text}}', text),
            errorPrefix: 'caseMemorySubjectInfer',
        })
        const key = result.subject_key.trim()
        return key.length > 0 ? key : null
    } catch (e) {
        logger.warn('subject_key 推断失败，fallback null', {
            error: e instanceof Error ? e.message : String(e),
        })
        return null
    }
}
