/**
 * 甲乙方与合同类型识别：先正则，后 LLM 兜底。
 *
 * 返回 source 字段指示命中路径，便于上层埋点与降级判断。
 * spec §7.3：正则 → LLM 兜底 → null 三级降级
 * spec §13 R3：LLM 失败不阻塞整体流程
 */
import { createChatModel } from '~~/server/services/node/chatModelFactory'
import { getValidNodeConfig } from '~~/server/services/node/node.service'
import { CONTRACT_TYPE_OPTIONS } from '#shared/types/contract'

export interface PartyDetectionResult {
    partyA: string | null
    partyB: string | null
    contractType: string | null
    source: 'regex' | 'llm' | 'none'
}

const PARTY_A_PATTERN = /(?:（|\()?甲方(?:（[^）]*）|\([^)]*\))?(?:）|\))?[：:]\s*(.+?)(?:[\n。；]|$)/g
const PARTY_B_PATTERN = /(?:（|\()?乙方(?:（[^）]*）|\([^)]*\))?(?:）|\))?[：:]\s*(.+?)(?:[\n。；]|$)/g

// 跳过 "甲方：（签字）" 这类签章占位符与同行双主体被非贪婪吞并的残片
const SIGNATURE_PLACEHOLDER_REGEX = /^[\s（(]*(?:签字|签名|签章|盖章|公章|代表|手印)[）)\s]*$/
const CONTAINS_OTHER_PARTY_REGEX = /甲方[：:]|乙方[：:]/

function pickValidCandidate(fullText: string, pattern: RegExp): string | null {
    // 每次 new 正则，避免模块级 /g 正则的 lastIndex 在并发请求间共享
    for (const match of fullText.matchAll(new RegExp(pattern.source, 'g'))) {
        const raw = match[1]?.trim() ?? ''
        if (!raw) continue
        if (SIGNATURE_PLACEHOLDER_REGEX.test(raw)) continue
        if (CONTAINS_OTHER_PARTY_REGEX.test(raw)) continue
        return raw
    }
    return null
}

// 合同类型枚举为工程侧自决（spec §14 O6），不受 spec 硬约束。
// 枚举集中在 #shared/types/contract 里（DB 不做 enum 约束，prompt 只是提示 LLM）
const LLM_PROMPT = `请从下面的合同前 1500 字中识别甲方名称、乙方名称、合同类型，以严格 JSON 输出：
{"partyA": "...", "partyB": "...", "contractType": "..."}

要求：
- 三个字段都必须存在
- 无法识别填 null
- 合同类型从 [${CONTRACT_TYPE_OPTIONS.map(t => `"${t}"`).join(',')}] 中选一个
- 只输出 JSON，不要任何解释文字

合同内容：
`

export async function detectParties(paragraphs: string[]): Promise<PartyDetectionResult> {
    const fullText = paragraphs.join('\n')

    const matchA = pickValidCandidate(fullText, PARTY_A_PATTERN)
    const matchB = pickValidCandidate(fullText, PARTY_B_PATTERN)
    if (matchA && matchB) {
        return {
            partyA: matchA,
            partyB: matchB,
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
