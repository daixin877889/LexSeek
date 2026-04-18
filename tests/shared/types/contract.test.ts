import { describe, it, expectTypeOf } from 'vitest'
import type {
    RiskLevel,
    Stance,
    ContractReviewStatus,
    Risk,
    CreateReviewRequest,
    CreateReviewResponse,
    StanceRequest,
    PatchReviewRequest,
    RebuildDocxResponse,
    DownloadResponse,
} from '#shared/types/contract'

describe('shared/types/contract', () => {
    it('导出基础联合类型', () => {
        expectTypeOf<RiskLevel>().toEqualTypeOf<'high' | 'medium' | 'low'>()
        expectTypeOf<Stance>().toEqualTypeOf<'partyA' | 'partyB' | 'neutral'>()
        expectTypeOf<ContractReviewStatus>().toEqualTypeOf<
            'pending' | 'reviewing' | 'awaiting_stance' | 'completed' | 'failed'
        >()
    })

    it('Risk 形状正确', () => {
        const sample: Risk = {
            id: 'uuid-1',
            clauseIndex: 3,
            clauseText: '条款原文',
            level: 'high',
            category: '付款',
            problem: '付款周期过长',
            analysis: '分析文本',
            risk: '法律风险',
            suggestion: '改为 30 日内',
            suggestedClauseText: '甲方应在收到发票后 30 日内付款',
        }
        expectTypeOf(sample).toMatchTypeOf<Risk>()
    })

    it('API 请求响应类型可用', () => {
        const req: CreateReviewRequest = { sourceType: 'paste', text: '合同文本' }
        const resp: CreateReviewResponse = { reviewId: 1, sessionId: 's-1' }
        const stance: StanceRequest = { stance: 'partyA', partyA: '甲方', partyB: '乙方' }
        const patch: PatchReviewRequest = { risks: [] }
        const rebuild: RebuildDocxResponse = { reviewedFileId: 1, downloadUrl: 'https://x' }
        const download: DownloadResponse = { downloadUrl: 'https://y' }

        expectTypeOf(req).toMatchTypeOf<CreateReviewRequest>()
        expectTypeOf(resp).toMatchTypeOf<CreateReviewResponse>()
        expectTypeOf(stance).toMatchTypeOf<StanceRequest>()
        expectTypeOf(patch).toMatchTypeOf<PatchReviewRequest>()
        expectTypeOf(rebuild).toMatchTypeOf<RebuildDocxResponse>()
        expectTypeOf(download).toMatchTypeOf<DownloadResponse>()
    })
})
