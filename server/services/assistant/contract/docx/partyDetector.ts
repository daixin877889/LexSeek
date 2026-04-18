/**
 * 甲乙方与合同类型识别：先正则，后 LLM 兜底。
 *
 * 返回 source 字段指示命中路径，便于上层埋点与降级判断。
 * spec §7.3：正则 → LLM 兜底 → null 三级降级
 * spec §13 R3：LLM 失败不阻塞整体流程
 */
import { createChatModel } from '~~/server/services/node/chatModelFactory'
import { getValidNodeConfig } from '~~/server/services/node/node.service'

export interface PartyDetectionResult {
    partyA: string | null
    partyB: string | null
    contractType: string | null
    source: 'regex' | 'llm' | 'none'
}

const PARTY_A_REGEX = /甲方[：:]\s*(.+?)(?:[\n。；]|$)/
const PARTY_B_REGEX = /乙方[：:]\s*(.+?)(?:[\n。；]|$)/

// 合同类型枚举为工程侧自决（spec §14 O6），不受 spec 硬约束
const LLM_PROMPT = `请从下面的合同前 1500 字中识别甲方名称、乙方名称、合同类型，以严格 JSON 输出：
{"partyA": "...", "partyB": "...", "contractType": "..."}

要求：
- 三个字段都必须存在
- 无法识别填 null
- 合同类型从 ["劳动合同","租赁合同","买卖合同","服务合同","借款合同","保密协议","其他"] 中选一个
- 只输出 JSON，不要任何解释文字

合同内容：
`

export async function detectParties(paragraphs: string[]): Promise<PartyDetectionResult> {
    const fullText = paragraphs.join('\n')

    const matchA = PARTY_A_REGEX.exec(fullText)
    const matchB = PARTY_B_REGEX.exec(fullText)
    if (matchA && matchB) {
        return {
            partyA: matchA[1].trim(),
            partyB: matchB[1].trim(),
            contractType: null,
            source: 'regex',
        }
    }

    // LLM 失败不抛错，降级为 none（spec §13 R3）
    try {
        const config = await getValidNodeConfig('contractReviewMain')
        const activeKey = config.modelApiKeys.find((k) => k.status === 1)
        if (!activeKey) throw new Error('contractReviewMain 节点无可用 API 密钥（status=1）')

        const model = createChatModel({
            sdkType: config.modelSdkType,
            modelName: config.modelName,
            apiKey: activeKey.apiKey,
            baseUrl: config.modelProviderBaseUrl,
            temperature: 0,
        })
        const preview = fullText.slice(0, 1500)
        const response = await model.invoke(LLM_PROMPT + preview)
        const raw = typeof response.content === 'string' ? response.content : ''
        const jsonMatch = raw.match(/\{[\s\S]*\}/)
        if (!jsonMatch) throw new Error('LLM 未返回 JSON')
        const parsed = JSON.parse(jsonMatch[0])
        return {
            partyA: parsed.partyA ?? null,
            partyB: parsed.partyB ?? null,
            contractType: parsed.contractType ?? null,
            source: 'llm',
        }
    } catch (_err) {
        return { partyA: null, partyB: null, contractType: null, source: 'none' }
    }
}
