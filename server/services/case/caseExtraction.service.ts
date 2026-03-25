/**
 * 案件信息提取存储服务
 *
 * 三层存储：DB 固定字段 + JSONB + PostgresStore 长期记忆
 */

import type { ExtractedCaseInfo } from '#shared/types/case'
import { getStore } from '../workflow/checkpointer'

/**
 * 三层存储：DB 固定字段 + JSONB + PostgresStore 长期记忆
 *
 * @param caseId 案件 ID
 * @param confirmedData 用户确认的提取结果
 * @param caseTypes 案件类型列表（用于匹配 caseTypeId）
 */
export async function saveCaseInfoService(
    caseId: number,
    confirmedData: ExtractedCaseInfo,
    caseTypes: Array<{ id: number; name: string }>,
): Promise<void> {
    // 1. caseType 匹配
    const matchedType = caseTypes.find(t => t.name === confirmedData.caseType)
    if (!matchedType) {
        logger.warn('caseType 未匹配 case_types 表', {
            caseId,
            caseType: confirmedData.caseType,
        })
    }

    // 2. DB 固定字段 + JSONB
    await prisma.cases.update({
        where: { id: caseId },
        data: {
            title: confirmedData.title,
            plaintiff: confirmedData.plaintiff,
            defendant: confirmedData.defendant,
            summary: confirmedData.summary,
            extractedInfo: confirmedData as any,
            ...(matchedType ? { caseTypeId: matchedType.id } : {}),
        },
    })

    // 3. 长期记忆（PostgresStore）
    const store = await getStore()
    await store.put(['cases', String(caseId)], 'basic_info', {
        text: formatCaseInfo(confirmedData),
        ...confirmedData,
    })
}

/**
 * 将 ExtractedCaseInfo 格式化为 LLM 友好的文本
 */
export function formatCaseInfo(data: ExtractedCaseInfo): string {
    const lines: string[] = [
        `案件名称：${data.title}`,
        `原告：${data.plaintiff.join('、')}`,
        `被告：${data.defendant.join('、')}`,
        `案件类型：${data.caseType}`,
        `概述：${data.summary}`,
    ]

    for (const field of data.extraFields) {
        lines.push(`${field.title}：${field.value}`)
    }

    return lines.join('\n')
}
