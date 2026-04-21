/**
 * 合同审查总览生成
 *
 * 接收所有风险点，调用 LLM 生成分档要点（highlights）和总评（overall），
 * 返回 ContractOverview 结构。
 *
 * - 0 条风险时直接返回默认，不调 LLM（省 token）
 * - LLM 返回不符合 schema 时抛错，调用方决定降级策略
 */
import { z } from 'zod'
import type { Risk, ContractOverview, Stance } from '#shared/types/contract'
import { createChatModel } from '~~/server/services/node/chatModelFactory'
import { getValidNodeConfig } from '~~/server/services/node/node.service'

const OverviewResponse = z.object({
    highlights: z.object({
        high: z.array(z.object({ text: z.string().max(60), riskId: z.string() })).max(5),
        medium: z.array(z.object({ text: z.string().max(60), riskId: z.string() })).max(5),
        low: z.array(z.object({ text: z.string().max(60), riskId: z.string() })).max(5),
    }),
    overall: z.string().max(120),
})

export async function summarizeOverview(
    risks: Risk[],
    stance: Stance,
    contractType: string | null,
): Promise<ContractOverview> {
    if (risks.length === 0) {
        return {
            highlights: { high: [], medium: [], low: [] },
            overall: '本合同未识别到明显风险。',
        }
    }

    const config = await getValidNodeConfig('contractReviewMain')
    const activeKey = config.modelApiKeys.find(k => k.status === 1)
    if (!activeKey) throw new Error('summarizeOverview: 无可用 API 密钥')

    const model = createChatModel({
        sdkType: config.modelSdkType,
        modelName: config.modelName,
        apiKey: activeKey.apiKey,
        baseUrl: config.modelProviderBaseUrl,
        temperature: 0.3, // 略放松，让总评自然
    })

    const prompt = buildPrompt(risks, stance, contractType)
    const response = await model.invoke(prompt)
    const content = typeof response.content === 'string' ? response.content : ''

    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
        logger.warn('summarizeOverview: LLM 未返回 JSON', {
            riskCount: risks.length,
            rawContent: content.slice(0, 200),
        })
        throw new Error('summarizeOverview: LLM 未返回 JSON')
    }

    let rawJson: unknown
    try {
        rawJson = JSON.parse(jsonMatch[0])
    } catch (err) {
        logger.warn('summarizeOverview: JSON.parse 失败', {
            riskCount: risks.length,
            raw: jsonMatch[0].slice(0, 200),
            err,
        })
        throw new Error('summarizeOverview: JSON 解析失败')
    }

    const parsed = OverviewResponse.safeParse(rawJson)
    if (!parsed.success) {
        logger.warn('summarizeOverview: schema 校验失败', {
            riskCount: risks.length,
            issue: parsed.error.issues[0]?.message,
        })
        throw new Error(`summarizeOverview schema 校验失败: ${parsed.error.issues[0]?.message}`)
    }

    return parsed.data
}

function buildPrompt(risks: Risk[], stance: Stance, contractType: string | null): string {
    const riskList = risks.map(r => `${r.level.toUpperCase()} · ${r.id} · ${r.category} · ${r.problem}`).join('\n')
    return [
        `我刚完成一份${contractType ?? '合同'}的风险审查（立场=${stance}）。以下是所有风险点：`,
        riskList,
        ``,
        `请按"高/中/低"三档输出分档要点（每条 ≤ 60 字，挂原 risk 的 id），再写一段总评（≤ 120 字）。`,
        `严格按如下 JSON 输出，不要解释：`,
        `{"highlights": {"high":[{"text":"...","riskId":"..."}], "medium":[...], "low":[...]}, "overall":"..."}`,
    ].join('\n')
}
