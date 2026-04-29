/**
 * 甲乙方与合同类型识别：先正则，后 LLM 兜底。
 *
 * 返回 source 字段指示命中路径，便于上层埋点与降级判断。
 * spec §7.3：正则 → LLM 兜底 → null 三级降级
 * spec §13 R3：LLM 失败不阻塞整体流程
 */
import { z } from 'zod'
import { CONTRACT_TYPE_OPTIONS } from '#shared/types/contract'
import { invokeNodeJson } from '~~/server/services/agent-platform/tools/invokeNodeJson'

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

const llmResultSchema = z.object({
    partyA: z.string().nullable(),
    partyB: z.string().nullable(),
    contractType: z.string().nullable(),
})

export async function detectParties(paragraphs: string[]): Promise<PartyDetectionResult> {
    const fullText = paragraphs.join('\n')

    const matchA = pickValidCandidate(fullText, PARTY_A_PATTERN)
    const matchB = pickValidCandidate(fullText, PARTY_B_PATTERN)
    if (matchA && matchB) {
        return { partyA: matchA, partyB: matchB, contractType: null, source: 'regex' }
    }

    try {
        const preview = fullText.slice(0, 1500)
        const result = await invokeNodeJson({
            nodeName: 'contractPartyDetect',
            temperature: 0,
            schema: llmResultSchema,
            buildPrompt: (template) => {
                const rendered = template.replace('{{contractTypeOptions}}', CONTRACT_TYPE_OPTIONS.map(t => `- ${t}`).join('\n'))
                return `${rendered}\n\n合同内容：\n${preview}`
            },
            errorPrefix: 'contractPartyDetect',
        })
        return {
            partyA: result.partyA ?? null,
            partyB: result.partyB ?? null,
            contractType: result.contractType ?? null,
            source: 'llm',
        }
    } catch (_err) {
        return { partyA: null, partyB: null, contractType: null, source: 'none' }
    }
}
