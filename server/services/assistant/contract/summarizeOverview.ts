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
import { logContextOverflow } from '~~/server/services/workflow/context/contextErrorLogger'

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
    let response
    try {
        response = await model.invoke(prompt)
    } catch (err) {
        logContextOverflow(err, {
            source: 'summarizeOverview',
            modelName: config.modelName,
            sdkType: config.modelSdkType,
            contextWindow: config.modelContextWindow,
            extra: {
                riskCount: risks.length,
                promptLength: prompt.length,
                stance,
                contractType,
            },
        })
        throw err
    }
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
    const riskList = risks.map((r) => {
        const line = `${r.level.toUpperCase()} · ${r.id} · ${r.category} · ${r.problem}`
        return line.length > MAX_RISK_LINE_CHARS ? line.slice(0, MAX_RISK_LINE_CHARS) + '…' : line
    }).join('\n')
    return [
        `你正在帮律师完成${contractType ?? '合同'}审查的"一览视图"（立场=${stance}）。`,
        `以下是我已经逐条分析出的所有风险点（格式："级别 · riskId · 类别 · 问题描述"）：`,
        ``,
        riskList,
        ``,
        `你的任务：**做真正的跨条款归纳**，而不是把原问题复述一遍。具体要求：`,
        ``,
        `1. 识别哪些 risk 本质上是**同一类**问题（相同主题 / 相同法律依据 / 相同后果），`,
        `   将它们**合并成一条要点**。例如 3 条都涉及"试用期约定违法"，就合并为`,
        `   一条"试用期条款多处违法（涵盖 3 条）"，而不是分别列 3 条。`,
        `2. 每条要点写在共性层面（一句话概括"这一类问题是什么、为什么是风险"），`,
        `   不要出现单条 risk 原文，也不要出现"第 X 条"这种具体编号。`,
        `3. 要点挂的 riskId 选**该类问题里最有代表性的那一条**（仅一个 id），`,
        `   用户点击会跳到该条款定位。`,
        `4. 每档（高/中/低）最多 5 条；如果整档都能合并为 1-2 条就只出 1-2 条，`,
        `   避免强行凑数。若某档无风险则输出空数组。`,
        `5. 最后写一段总评（≤ 120 字）：从合同整体合规度/履约风险角度定性，`,
        `   不要重复要点内容。`,
        ``,
        `严格按如下 JSON 输出，不要解释、不要代码块标记：`,
        `{"highlights": {"high":[{"text":"...","riskId":"..."}], "medium":[...], "low":[...]}, "overall":"..."}`,
    ].join('\n')
}
