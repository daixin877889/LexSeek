/**
 * 合同审查总览生成
 *
 * 接收所有风险点，调用 LLM 生成分档要点（highlights）和总评（overall），
 * 返回 ContractOverview 结构。
 *
 * - 0 条风险时直接返回默认，不调 LLM（省 token）
 * - 提示词从 DB 节点 `contractReviewSummarize` 的 system prompt 加载（运营可在后台热更新）
 * - LLM 返回不符合 schema 时抛错，调用方决定降级策略
 */
import { z } from 'zod'
import type { Risk, ContractOverview, Stance } from '#shared/types/contract'
import { createChatModel } from '~~/server/services/node/chatModelFactory'
import { getValidNodeConfig } from '~~/server/services/node/node.service'
import { renderContent } from '~~/server/services/node/prompt.service'
import { logContextOverflow } from '~~/server/services/workflow/context/contextErrorLogger'

const OverviewResponse = z.object({
    highlights: z.object({
        high: z.array(z.object({ text: z.string().max(60), riskId: z.string() })).max(5),
        medium: z.array(z.object({ text: z.string().max(60), riskId: z.string() })).max(5),
        low: z.array(z.object({ text: z.string().max(60), riskId: z.string() })).max(5),
    }),
    overall: z.string().max(120),
})

const NODE_NAME = 'contractReviewSummarize'

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

    const config = await getValidNodeConfig(NODE_NAME)
    const activeKey = config.modelApiKeys.find(k => k.status === 1)
    if (!activeKey) throw new Error(`${NODE_NAME}: 无可用 API 密钥`)

    // 从 DB 加载 system prompt 模板（运营可在 /admin/nodes/:id 里热更）
    const template = config.prompts.find(p => p.type === 'system' && p.status === 1)?.content
    if (!template) {
        throw new Error(`${NODE_NAME}: DB 未配置 system 类型的启用态提示词`)
    }

    const model = createChatModel({
        sdkType: config.modelSdkType,
        modelName: config.modelName,
        apiKey: activeKey.apiKey,
        baseUrl: config.modelProviderBaseUrl,
        temperature: 0.3, // 略放松，让总评自然
    })

    const prompt = renderPromptTemplate(template, risks, stance, contractType)
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

/**
 * 渲染 DB 模板：替换 {{stance}} / {{contractType}} / {{riskList}} 占位符
 *
 * riskList 是长文本（每条 risk 一行），不适合直接放在模板的 variables 字段里——
 * variables 是 JSON 数组只做字段名声明；实际值在调用处拼接好再 renderContent。
 */
function renderPromptTemplate(
    template: string,
    risks: Risk[],
    stance: Stance,
    contractType: string | null,
): string {
    const riskList = risks
        .map(r => `${r.level.toUpperCase()} · ${r.id} · ${r.category} · ${r.problem}`)
        .join('\n')
    const rendered = renderContent(template, {
        stance,
        contractType: contractType ?? '合同',
        riskList,
    })
    const unreplaced = rendered.match(/\{\{(\w+)\}\}/g)
    if (unreplaced) {
        logger.warn('summarizeOverview: 提示词存在未替换的模板变量', {
            unreplacedVars: unreplaced,
        })
    }
    return rendered
}
