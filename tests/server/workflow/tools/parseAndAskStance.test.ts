// tests/server/workflow/tools/parseAndAskStance.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// mock 外部依赖：DAO / OSS / parser / partyDetector / interrupt
vi.mock('~~/server/agents/contract/contractReview.dao', () => ({
    getContractReviewDAO: vi.fn(),
    updateContractReviewDAO: vi.fn(),
}))
vi.mock('~~/server/services/files/ossFiles.dao', () => ({
    findOssFileByIdDao: vi.fn(),
}))
vi.mock('~~/server/services/storage/storage.service', () => ({
    downloadFileService: vi.fn(),
}))
vi.mock('~~/server/agents/contract/docx', () => ({
    parseContractDocx: vi.fn(),
    detectParties: vi.fn(),
}))
vi.mock('@langchain/langgraph', async () => {
    const actual = await vi.importActual<any>('@langchain/langgraph')
    return {
        ...actual,
        interrupt: vi.fn(),
    }
})

import { createTool as parseAndAskStanceCreateTool } from '~~/server/services/workflow/tools/parseAndAskStance.tool'
import {
    getContractReviewDAO,
    updateContractReviewDAO,
} from '~~/server/agents/contract/contractReview.dao'
import { findOssFileByIdDao } from '~~/server/services/files/ossFiles.dao'
import { downloadFileService } from '~~/server/services/storage/storage.service'
import { parseContractDocx, detectParties } from '~~/server/agents/contract/docx'
import { interrupt } from '@langchain/langgraph'

describe('parseAndAskStance createTool', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('成功路径：下载 → 解析 → interrupt → 置 awaiting_stance → 恢复 → 置 reviewing → 返回上下文', async () => {
        ;(getContractReviewDAO as any).mockResolvedValueOnce({ id: 1, userId: 7, originalFileId: 99 })
        ;(findOssFileByIdDao as any).mockResolvedValueOnce({ id: 99, filePath: 'users/7/a.docx' })
        ;(downloadFileService as any).mockResolvedValueOnce(Buffer.from('fake'))
        ;(parseContractDocx as any).mockResolvedValueOnce({ paragraphs: ['P0', 'P1'], rawXml: '<xml/>', bodyParagraphs: ['P0', 'P1'], bodyParagraphIndex: [0, 1] })
        ;(detectParties as any).mockResolvedValueOnce({
            partyA: '甲', partyB: '乙', contractType: '劳动合同', source: 'regex',
        })
        ;(interrupt as any).mockReturnValueOnce({
            stance: 'partyA', partyA: '甲（编辑后）', partyB: undefined,
        })
        ;(updateContractReviewDAO as any).mockResolvedValue({})

        const tool = parseAndAskStanceCreateTool({ userId: 7, sessionId: 's1', reviewId: 1 })
        const result: any = await tool.invoke({})

        expect(interrupt).toHaveBeenCalledWith(expect.objectContaining({
            type: 'awaiting_stance', reviewId: 1, partyA: '甲', partyB: '乙', contractType: '劳动合同',
        }))
        expect(updateContractReviewDAO).toHaveBeenNthCalledWith(1, 1, {
            contractType: '劳动合同', partyA: '甲', partyB: '乙', status: 'awaiting_stance',
        })
        expect(updateContractReviewDAO).toHaveBeenNthCalledWith(2, 1, {
            stance: 'partyA', partyA: '甲（编辑后）', partyB: '乙', status: 'reviewing',
        })
        expect(result.stance).toBe('partyA')
        expect(result.stanceLabel).toBe('甲方')
        expect(result.stanceFocus).toContain('延长付款期限')
        expect(result.paragraphs).toEqual(['P0', 'P1'])
    })

    it('reviewId 缺失 → 抛错', async () => {
        const tool = parseAndAskStanceCreateTool({ userId: 7, sessionId: 's1' })
        await expect(tool.invoke({})).rejects.toThrow(/reviewId 缺失/)
    })

    it('OSS 文件找不到 → 抛错', async () => {
        ;(getContractReviewDAO as any).mockResolvedValueOnce({ id: 1, userId: 7, originalFileId: 99 })
        ;(findOssFileByIdDao as any).mockResolvedValueOnce(null)
        const tool = parseAndAskStanceCreateTool({ userId: 7, sessionId: 's1', reviewId: 1 })
        await expect(tool.invoke({})).rejects.toThrow(/OSS file 99 not found/)
    })

    it('用户未编辑甲乙方（resume.partyA/B 为 undefined）→ 继承识别值', async () => {
        ;(getContractReviewDAO as any).mockResolvedValueOnce({ id: 1, userId: 7, originalFileId: 99 })
        ;(findOssFileByIdDao as any).mockResolvedValueOnce({ id: 99, filePath: 'p' })
        ;(downloadFileService as any).mockResolvedValueOnce(Buffer.from('x'))
        ;(parseContractDocx as any).mockResolvedValueOnce({ paragraphs: ['a'], rawXml: '<x/>', bodyParagraphs: ['a'], bodyParagraphIndex: [0] })
        ;(detectParties as any).mockResolvedValueOnce({
            partyA: '原甲', partyB: '原乙', contractType: null, source: 'llm',
        })
        ;(interrupt as any).mockReturnValueOnce({ stance: 'neutral' })
        ;(updateContractReviewDAO as any).mockResolvedValue({})

        const tool = parseAndAskStanceCreateTool({ userId: 7, sessionId: 's1', reviewId: 1 })
        const result: any = await tool.invoke({})
        expect(result.partyA).toBe('原甲')
        expect(result.partyB).toBe('原乙')
        expect(result.stance).toBe('neutral')
    })
})
