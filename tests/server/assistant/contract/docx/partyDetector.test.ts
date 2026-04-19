import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createChatModel } from '~~/server/services/node/chatModelFactory'
import { getValidNodeConfig } from '~~/server/services/node/node.service'
import { detectParties } from '~~/server/services/assistant/contract/docx/partyDetector'
import { parseContractDocx } from '~~/server/services/assistant/contract/docx/parser'

const SAMPLES = ['labor', 'lease', 'sale', 'service', 'loan'] as const
const SAMPLE_DIR = join(__dirname, '../../../../../prisma/seeds/contract-samples')

vi.mock('~~/server/services/node/chatModelFactory', () => ({
    createChatModel: vi.fn(),
}))
vi.mock('~~/server/services/node/node.service', () => ({
    getValidNodeConfig: vi.fn(),
}))

/**
 * mock 对象形状与真实 NodeConfig 接口一致：
 * - prompts: NodePromptConfig[]（非 prompt）
 * - modelSdkType: SdkType
 * - modelApiKeys: NodeApiKeyConfig[]
 */
function mockContractReviewNodeConfig() {
    vi.mocked(getValidNodeConfig).mockResolvedValue({
        id: 1,
        name: 'contractReviewMain',
        title: '合同审查主节点',
        description: '',
        type: 'main',
        prompts: [],
        modelId: 1,
        modelName: 'deepseek-chat',
        modelType: 'chat',
        modelStatus: 1,
        modelSdkType: 'openai',
        modelProviderId: 1,
        modelProviderName: 'DeepSeek',
        modelProviderBaseUrl: 'https://api.deepseek.com/v1',
        modelProviderDescription: '',
        modelApiKeys: [{ id: 1, apiKey: 'sk-xxx', status: 1 }],
        tools: [],
        outputSchema: null,
    } as Awaited<ReturnType<typeof getValidNodeConfig>>)
}

beforeEach(() => {
    vi.clearAllMocks()
})

describe('detectParties (regex path)', () => {
    it.each(SAMPLES)('%s.docx 正则直接命中甲乙方（不调 LLM）', async (name) => {
        const buf = await readFile(join(SAMPLE_DIR, `${name}.docx`))
        const { paragraphs } = await parseContractDocx(buf)
        const result = await detectParties(paragraphs)
        expect(result.partyA).not.toBeNull()
        expect(result.partyB).not.toBeNull()
        expect(result.source).toBe('regex')
        expect(createChatModel).not.toHaveBeenCalled()
    })

    it('5 份样本正则命中率 ≥ 80%（spec §12.1 硬要求）', async () => {
        let hit = 0
        for (const name of SAMPLES) {
            const buf = await readFile(join(SAMPLE_DIR, `${name}.docx`))
            const { paragraphs } = await parseContractDocx(buf)
            const result = await detectParties(paragraphs)
            if (result.source === 'regex' && result.partyA && result.partyB) hit++
        }
        expect(hit / SAMPLES.length).toBeGreaterThanOrEqual(0.8)
    })

    it('括号包围写法「出租方（甲方）：」应识别为正则命中', async () => {
        const paragraphs = [
            '房屋租赁合同',
            '出租方（甲方）：王小明（身份证号：110101198501011234）',
            '承租方（乙方）：李四（身份证号：310101199001015678）',
            '一、租赁房屋：上海市徐汇区。',
        ]
        const result = await detectParties(paragraphs)
        expect(result.source).toBe('regex')
        expect(result.partyA).toContain('王小明')
        expect(result.partyB).toContain('李四')
    })

    it('正文识别到甲乙方时，应忽略签章行「甲方：（签字）」', async () => {
        const paragraphs = [
            '劳动合同',
            '甲方（用人单位）：上海诺达科技有限公司',
            '乙方（劳动者）：张三',
            '一、合同期限。',
            '甲方：（签章）  乙方：（签名）',
        ]
        const result = await detectParties(paragraphs)
        expect(result.source).toBe('regex')
        expect(result.partyA).toContain('上海诺达科技有限公司')
        expect(result.partyB).toContain('张三')
    })

    it('仅存在签章行时，正则不应返回签章占位符', async () => {
        const paragraphs = [
            '协议',
            '正文略',
            '甲方：（签字）  乙方：（签字）',
        ]
        const result = await detectParties(paragraphs)
        // 无有效甲乙方 → 应进入 LLM/none 分支，不能把"（签字）"当正经名字返回
        expect(result.source).not.toBe('regex')
    })
})

describe('detectParties (LLM fallback path)', () => {
    it('正则未命中时调 model，返回合法 JSON', async () => {
        mockContractReviewNodeConfig()
        const mockInvoke = vi.fn().mockResolvedValue({
            content: '{"partyA":"某科技公司","partyB":"张三","contractType":"咨询合同"}',
        })
        vi.mocked(createChatModel).mockReturnValue({ invoke: mockInvoke } as any)
        const paragraphs = ['合同正文', '约定双方合作事宜', '本合同一式两份。']
        const result = await detectParties(paragraphs)
        expect(result.partyA).toBe('某科技公司')
        expect(result.partyB).toBe('张三')
        expect(result.contractType).toBe('咨询合同')
        expect(result.source).toBe('llm')
        expect(mockInvoke).toHaveBeenCalled()
    })

    it('LLM 返回非法 JSON 时 partyA/partyB/contractType 置 null', async () => {
        mockContractReviewNodeConfig()
        vi.mocked(createChatModel).mockReturnValue({
            invoke: vi.fn().mockResolvedValue({ content: '抱歉我不能识别' }),
        } as any)
        const result = await detectParties(['无甲乙方字样', '正文'])
        expect(result.partyA).toBeNull()
        expect(result.partyB).toBeNull()
        expect(result.contractType).toBeNull()
        expect(result.source).toBe('none')
    })

    it('LLM 抛错时 partyA/partyB/contractType 置 null（不阻塞整体流程，spec §13 R3）', async () => {
        mockContractReviewNodeConfig()
        vi.mocked(createChatModel).mockReturnValue({
            invoke: vi.fn().mockRejectedValue(new Error('network error')),
        } as any)
        const result = await detectParties(['无甲乙方字样', '正文'])
        expect(result.partyA).toBeNull()
        expect(result.partyB).toBeNull()
        expect(result.contractType).toBeNull()
        expect(result.source).toBe('none')
    })

    it('无可用 API 密钥（status!==1）→ 捕获后降级 none', async () => {
        vi.mocked(getValidNodeConfig).mockResolvedValue({
            id: 1,
            name: 'contractReviewMain',
            title: '合同审查主节点',
            description: '',
            type: 'main',
            prompts: [],
            modelId: 1,
            modelName: 'deepseek-chat',
            modelType: 'chat',
            modelStatus: 1,
            modelSdkType: 'openai',
            modelProviderId: 1,
            modelProviderName: 'DeepSeek',
            modelProviderBaseUrl: 'https://api.deepseek.com/v1',
            modelProviderDescription: '',
            modelApiKeys: [{ id: 1, apiKey: 'sk-xxx', status: 0 }],
            tools: [],
            outputSchema: null,
        } as Awaited<ReturnType<typeof getValidNodeConfig>>)
        const result = await detectParties(['无甲乙方字样'])
        expect(result.source).toBe('none')
        expect(createChatModel).not.toHaveBeenCalled()
    })

    it('LLM 返回非字符串 content → 降级 none', async () => {
        mockContractReviewNodeConfig()
        vi.mocked(createChatModel).mockReturnValue({
            invoke: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: '不是字符串' }] }),
        } as any)
        const result = await detectParties(['无甲乙方字样'])
        expect(result.source).toBe('none')
    })

    it('LLM 返回 JSON 但字段缺失 → partyA/partyB/contractType 各自 ?? null 回填', async () => {
        mockContractReviewNodeConfig()
        vi.mocked(createChatModel).mockReturnValue({
            invoke: vi.fn().mockResolvedValue({ content: '{}' }),
        } as any)
        const result = await detectParties(['无甲乙方字样'])
        expect(result.partyA).toBeNull()
        expect(result.partyB).toBeNull()
        expect(result.contractType).toBeNull()
        expect(result.source).toBe('llm')
    })
})
