/**
 * 更新案件基本信息
 *
 * PUT /api/v1/cases/[caseId]
 *
 * 更新案件标题、原告、被告，同步写入 DB、JSONB 和长期记忆三层存储
 */
import { z } from 'zod'
import type { ExtractedCaseInfo } from '#shared/types/case'
import {
    getCaseByIdService,
    validateCaseAccessService,
} from '~~/server/services/case/case.service'
import { saveCaseInfoService } from '~~/server/services/case/caseExtraction.service'

const bodySchema = z.object({
    title: z.string().trim().min(1).max(500).optional(),
    plaintiff: z.array(z.string().trim().min(1)).optional(),
    defendant: z.array(z.string().trim().min(1)).optional(),
}).refine(
    data => data.title !== undefined || data.plaintiff !== undefined || data.defendant !== undefined,
    { message: '至少需要提供一个更新字段' },
)

export default defineEventHandler(async (event) => {
    // 1. 认证
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    // 2. 路由参数
    const caseIdStr = getRouterParam(event, 'caseId')
    const caseId = Number.parseInt(caseIdStr || '', 10)
    if (Number.isNaN(caseId) || caseId <= 0) {
        return resError(event, 400, '无效的案件 ID')
    }

    // 3. 请求体验证
    const body = await readBody(event)
    const result = bodySchema.safeParse(body)
    if (!result.success) {
        return resError(event, 400, result.error.issues[0]?.message ?? '参数校验失败')
    }
    const updates = result.data

    // 4. 去重
    if (updates.plaintiff) updates.plaintiff = [...new Set(updates.plaintiff)]
    if (updates.defendant) updates.defendant = [...new Set(updates.defendant)]

    try {
        // 5. 权限校验
        await validateCaseAccessService(caseId, user.id)

        // 6. 并发读取案件数据和案件类型列表
        const [caseRecord, caseTypes] = await Promise.all([
            getCaseByIdService(caseId, true),
            prisma.caseTypes.findMany({ select: { id: true, name: true } }),
        ])
        if (!caseRecord) {
            return resError(event, 404, '案件不存在')
        }

        // 7. 构造合并后的 ExtractedCaseInfo
        const parseNames = (val: unknown): string[] => {
            if (!Array.isArray(val)) return []
            return val.map((v: any) => typeof v === 'string' ? v : v?.name ?? '').filter(Boolean)
        }

        const base: ExtractedCaseInfo = (caseRecord.extractedInfo as unknown as ExtractedCaseInfo) ?? {
            title: caseRecord.title,
            plaintiff: parseNames(caseRecord.plaintiff),
            defendant: parseNames(caseRecord.defendant),
            caseType: caseRecord.caseType?.name ?? '',
            summary: caseRecord.summary ?? '',
            extraFields: [],
        }

        const merged: ExtractedCaseInfo = {
            ...base,
            ...(updates.title !== undefined ? { title: updates.title } : {}),
            ...(updates.plaintiff !== undefined ? { plaintiff: updates.plaintiff } : {}),
            ...(updates.defendant !== undefined ? { defendant: updates.defendant } : {}),
        }

        // 8. 三层写入
        // M2 废弃：案件基础信息已通过 cases 表 + extractedInfo 足够表示，
        // 不再写 PostgresStore ('cases', caseId, 'basic_info') 避免和案件档案 JSON 重复灌 prompt。
        // 存量数据保留不读，后续观察无引用再清理。
        // await saveCaseInfoService(caseId, merged, caseTypes)

        return resSuccess(event, '更新成功', null)
    }
    catch (error: any) {
        logger.error('更新案件基本信息失败', { caseId, error: error.message })
        if (error.message === '无权访问该案件') {
            return resError(event, 403, error.message)
        }
        return resError(event, 500, '更新失败')
    }
})
