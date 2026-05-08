/**
 * 案件信息提取存储服务
 *
 * 三层存储：DB 固定字段 + JSONB + PostgresStore 长期记忆
 */

import { z } from 'zod'
import type { ExtractedCaseInfo } from '#shared/types/case'
import type { caseTypes } from '~~/generated/prisma/client'

/**
 * AI 案件信息抽取结果的 Zod schema
 *
 * 用于校验 LLM 结构化输出与用户确认后的最终提取结果。
 * 除 title 外均可选（LLM 材料未提及时应留空，不得编造）。
 */
export const CaseExtractionSchema = z.object({
    title: z.string().describe('案件标题'),
    plaintiff: z.array(z.string()).optional().describe('原告列表'),
    defendant: z.array(z.string()).optional().describe('被告列表'),
    caseType: z.string().optional().describe('案件类型（必须匹配 case_types 表）'),
    summary: z.string().optional().describe('案件概述'),
    extraFields: z
        .array(
            z.object({
                name: z.string(),
                title: z.string(),
                value: z.string(),
            }),
        )
        .optional()
        .describe('扩展字段（根据案件类型动态抽取的额外信息）'),
    courtName: z.string().optional().describe('法院名称，如"北京市朝阳区人民法院"'),
    firstInstanceCaseNo: z.string().optional().describe('一审案件编号，如"(2023)京0105民初12345号"'),
    secondInstanceCaseNo: z.string().optional().describe('二审案件编号，如"(2024)京03民终6789号"'),
    firstInstanceJudge: z.string().optional().describe('一审法官姓名'),
    secondInstanceJudge: z.string().optional().describe('二审法官姓名'),
})

/**
 * 抽取 prompt 追加段：法院 / 案号 / 法官 5 字段说明
 *
 * 供 extract API 在拼接 systemPrompt 时追加。DB 中的 prompt 模板无需改动，
 * 运行时动态追加即可保证材料中提及这些字段时 LLM 会一并输出。
 */
export const CASE_COURT_FIELDS_PROMPT_APPENDIX = `
## 法院 / 案号 / 法官（M1 新增 5 字段，均可选）
- 法院名称（courtName）：如材料提及审理法院，填入
- 一审/二审案件编号（firstInstanceCaseNo / secondInstanceCaseNo）：格式通常为"(YYYY)XXX民初/民终 XXXXX号"
- 一审/二审法官姓名（firstInstanceJudge / secondInstanceJudge）：如材料提及审判长或承办法官，填入
以上 5 字段均可选，材料未提及则留空（不要编造）。
`.trim()

/**
 * 写入案件基础信息：cases 表固定字段 + extractedInfo JSONB
 *
 * M2 spec §0.5 / §2.6：废弃 PostgresStore('cases', caseId, 'basic_info')
 * 冗余写入——cases 表 + extractedInfo 已足够表示案件档案，避免与
 * caseProfile JSON 重复灌入 prompt。
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
