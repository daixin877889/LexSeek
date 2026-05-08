/**
 * server/api/v1/material/** handler 单元覆盖（4 文件）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../_helpers/handler-test'
import { makeEvent, expectSuccess, expectError } from '../_helpers/handler-test'

vi.mock('~~/server/services/material/material.service', () => ({
    createMaterialService: vi.fn(),
    getMaterialByIdService: vi.fn(),
    getMaterialContentService: vi.fn(),
}))
vi.mock('~~/server/services/material/materialEmbedding.service', () => ({
    searchCaseMaterialsService: vi.fn(),
}))
vi.mock('~~/server/services/material/materialProcess.service', () => ({
    processMaterialService: vi.fn(),
    MaterialProcessError: class MaterialProcessError extends Error {
        code: number
        constructor(code: number, message: string) {
            super(message)
            this.code = code
        }
    },
}))

;(globalThis as any).prisma = {
    cases: { findFirst: vi.fn() },
    ossFiles: { findFirst: vi.fn() },
    documentDrafts: { findFirst: vi.fn() },
}

import {
    createMaterialService,
    getMaterialByIdService,
    getMaterialContentService,
} from '~~/server/services/material/material.service'
import { searchCaseMaterialsService } from '~~/server/services/material/materialEmbedding.service'
import { processMaterialService, MaterialProcessError } from '~~/server/services/material/materialProcess.service'

const mCreate = vi.mocked(createMaterialService)
const mGetById = vi.mocked(getMaterialByIdService)
const mGetContent = vi.mocked(getMaterialContentService)
const mSearch = vi.mocked(searchCaseMaterialsService)
const mProcess = vi.mocked(processMaterialService)

const { default: uploadHandler } = await import('../../../server/api/v1/material/upload.post')
const { default: searchHandler } = await import('../../../server/api/v1/material/search.post')
const { default: contentHandler } = await import('../../../server/api/v1/material/content/[id].get')
const { default: processHandler } = await import('../../../server/api/v1/material/process/[id].post')

describe('POST /api/v1/material/upload', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        ;(globalThis as any).prisma.cases.findFirst.mockResolvedValue({ id: 1, userId: 100 })
        mCreate.mockResolvedValue({
            id: 1, caseId: 1, name: 'A', type: 1, status: 2, ossFileId: null, isEncrypted: false, createdAt: new Date(),
        } as any)
    })

    it('happy path 文本类型', async () => {
        const res: any = await uploadHandler(makeEvent({
            userId: 100, body: { caseId: 1, name: 'A', type: 1, content: '案情' },
        }) as any)
        expectSuccess(res)
    })

    it('文档类型有 ossFileId', async () => {
        ;(globalThis as any).prisma.ossFiles.findFirst.mockResolvedValue({ id: 99, userId: 100 })
        const res: any = await uploadHandler(makeEvent({
            userId: 100, body: { caseId: 1, name: 'A', type: 2, ossFileId: 99 },
        }) as any)
        expectSuccess(res)
    })

    it('未登录 → 401', async () => {
        const res: any = await uploadHandler(makeEvent({ body: {} }) as any)
        expectError(res, 401)
    })

    it('参数非法 → 400', async () => {
        const res: any = await uploadHandler(makeEvent({ userId: 100, body: { caseId: 1 } }) as any)
        expectError(res, 400)
    })

    it('文本类型缺 content → 400 (refine 拦截)', async () => {
        const res: any = await uploadHandler(makeEvent({
            userId: 100, body: { caseId: 1, name: 'A', type: 1 },
        }) as any)
        expectError(res, 400)
    })

    it('案件不属于用户 → 404', async () => {
        ;(globalThis as any).prisma.cases.findFirst.mockResolvedValue(null)
        const res: any = await uploadHandler(makeEvent({
            userId: 100, body: { caseId: 1, name: 'A', type: 1, content: 'x' },
        }) as any)
        expectError(res, 404)
    })

    it('OSS 文件不属于用户 → 404', async () => {
        ;(globalThis as any).prisma.ossFiles.findFirst.mockResolvedValue(null)
        const res: any = await uploadHandler(makeEvent({
            userId: 100, body: { caseId: 1, name: 'A', type: 2, ossFileId: 99 },
        }) as any)
        expectError(res, 404)
    })

    it('service 抛错 → 500', async () => {
        mCreate.mockRejectedValueOnce(new Error('boom'))
        const res: any = await uploadHandler(makeEvent({
            userId: 100, body: { caseId: 1, name: 'A', type: 1, content: 'x' },
        }) as any)
        expectError(res, 500)
    })
})

describe('POST /api/v1/material/search', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        ;(globalThis as any).prisma.cases.findFirst.mockResolvedValue({ id: 1, userId: 100 })
        mSearch.mockResolvedValue([
            { content: 'x', sourceId: 1, sourceName: 'a', score: 0.95, chunkIndex: 0 },
        ] as any)
    })

    it('happy path', async () => {
        const res: any = await searchHandler(makeEvent({
            userId: 100, body: { caseId: 1, query: '违约' },
        }) as any)
        expectSuccess(res, d => expect(d.total).toBe(1))
    })

    it('未登录 → 401', async () => {
        const res: any = await searchHandler(makeEvent({ body: {} }) as any)
        expectError(res, 401)
    })

    it('参数非法 → 400', async () => {
        const res: any = await searchHandler(makeEvent({ userId: 100, body: {} }) as any)
        expectError(res, 400)
    })

    it('案件不存在 → 404', async () => {
        ;(globalThis as any).prisma.cases.findFirst.mockResolvedValue(null)
        const res: any = await searchHandler(makeEvent({
            userId: 100, body: { caseId: 1, query: 'x' },
        }) as any)
        expectError(res, 404)
    })

    it('search 抛错 → 500', async () => {
        mSearch.mockRejectedValueOnce(new Error('vec down'))
        const res: any = await searchHandler(makeEvent({
            userId: 100, body: { caseId: 1, query: 'x' },
        }) as any)
        expectError(res, 500)
    })
})

describe('GET /api/v1/material/content/:id', () => {
    beforeEach(() => vi.clearAllMocks())

    // MaterialStatus: PENDING=1 / PROCESSING=2 / COMPLETED=3 / FAILED=4
    it('happy path（关联 caseId）', async () => {
        mGetById.mockResolvedValue({
            id: 1, caseId: 1, draftId: null, type: 2, status: 3, name: 'A',
        } as any)
        ;(globalThis as any).prisma.cases.findFirst.mockResolvedValue({ id: 1, userId: 100 })
        mGetContent.mockResolvedValue('内容' as any)
        const res: any = await contentHandler(makeEvent({
            userId: 100, params: { id: '1' }, query: {},
        }) as any)
        expectSuccess(res, d => expect(d.content).toBe('内容'))
    })

    it('happy path（关联 draftId）', async () => {
        mGetById.mockResolvedValue({
            id: 1, caseId: null, draftId: 5, type: 2, status: 3, name: 'A',
        } as any)
        ;(globalThis as any).prisma.documentDrafts.findFirst.mockResolvedValue({ id: 5, userId: 100 })
        mGetContent.mockResolvedValue('内容' as any)
        const res: any = await contentHandler(makeEvent({
            userId: 100, params: { id: '1' }, query: {},
        }) as any)
        expectSuccess(res)
    })

    it('detail=true 返回完整字段', async () => {
        mGetById.mockResolvedValue({
            id: 1, caseId: 1, draftId: null, type: 2, status: 3, name: 'A',
            ossFileId: 99, isEncrypted: false, createdAt: new Date(), updatedAt: new Date(),
            fileName: 'f.pdf', fileSize: 100, fileType: 'application/pdf',
        } as any)
        ;(globalThis as any).prisma.cases.findFirst.mockResolvedValue({ id: 1, userId: 100 })
        mGetContent.mockResolvedValue('c' as any)
        const res: any = await contentHandler(makeEvent({
            userId: 100, params: { id: '1' }, query: { detail: 'true' },
        }) as any)
        expectSuccess(res, d => expect(d.file).toBeDefined())
    })

    it('未登录 → 401', async () => {
        const res: any = await contentHandler(makeEvent({ params: { id: '1' }, query: {} }) as any)
        expectError(res, 401)
    })

    it('id 非法 → 400', async () => {
        const res: any = await contentHandler(makeEvent({
            userId: 100, params: { id: 'abc' }, query: {},
        }) as any)
        expectError(res, 400)
    })

    it('材料不存在 → 404', async () => {
        mGetById.mockResolvedValue(null as any)
        const res: any = await contentHandler(makeEvent({
            userId: 100, params: { id: '1' }, query: {},
        }) as any)
        expectError(res, 404)
    })

    it('无访问权限 → 403', async () => {
        mGetById.mockResolvedValue({ id: 1, caseId: 1, draftId: null, type: 2, status: 2 } as any)
        ;(globalThis as any).prisma.cases.findFirst.mockResolvedValue(null)
        const res: any = await contentHandler(makeEvent({
            userId: 100, params: { id: '1' }, query: {},
        }) as any)
        expectError(res, 403)
    })

    it('PENDING 状态非文本 → 400', async () => {
        mGetById.mockResolvedValue({ id: 1, caseId: 1, draftId: null, type: 2, status: 1 } as any)
        ;(globalThis as any).prisma.cases.findFirst.mockResolvedValue({ id: 1, userId: 100 })
        const res: any = await contentHandler(makeEvent({
            userId: 100, params: { id: '1' }, query: {},
        }) as any)
        expectError(res, 400, '尚未处理')
    })

    it('PROCESSING 返回 success + content=null', async () => {
        mGetById.mockResolvedValue({ id: 1, caseId: 1, draftId: null, type: 2, status: 2 } as any)
        ;(globalThis as any).prisma.cases.findFirst.mockResolvedValue({ id: 1, userId: 100 })
        const res: any = await contentHandler(makeEvent({
            userId: 100, params: { id: '1' }, query: {},
        }) as any)
        expectSuccess(res, d => expect(d.content).toBeNull())
    })

    it('FAILED → 500', async () => {
        mGetById.mockResolvedValue({ id: 1, caseId: 1, draftId: null, type: 2, status: 4 } as any)
        ;(globalThis as any).prisma.cases.findFirst.mockResolvedValue({ id: 1, userId: 100 })
        const res: any = await contentHandler(makeEvent({
            userId: 100, params: { id: '1' }, query: {},
        }) as any)
        expectError(res, 500)
    })

    it('service 抛错 → 500', async () => {
        mGetById.mockRejectedValueOnce(new Error('db'))
        const res: any = await contentHandler(makeEvent({
            userId: 100, params: { id: '1' }, query: {},
        }) as any)
        expectError(res, 500)
    })
})

describe('POST /api/v1/material/process/:id', () => {
    beforeEach(() => vi.clearAllMocks())

    it('happy path 已完成', async () => {
        mProcess.mockResolvedValue({ alreadyCompleted: true } as any)
        const res: any = await processHandler(makeEvent({
            userId: 100, params: { id: '1' }, body: {},
        }) as any)
        expectSuccess(res)
        expect(res.message).toContain('无需')
    })

    it('happy path 已成功', async () => {
        mProcess.mockResolvedValue({ alreadyCompleted: false, contentLength: 100 } as any)
        const res: any = await processHandler(makeEvent({
            userId: 100, params: { id: '1' }, body: {},
        }) as any)
        expectSuccess(res)
        expect(res.message).toContain('成功')
    })

    it('happy path 异步提交', async () => {
        mProcess.mockResolvedValue({ alreadyCompleted: false, contentLength: 0 } as any)
        const res: any = await processHandler(makeEvent({
            userId: 100, params: { id: '1' }, body: {},
        }) as any)
        expectSuccess(res)
        expect(res.message).toContain('提交')
    })

    it('未登录 → 401', async () => {
        const res: any = await processHandler(makeEvent({ params: { id: '1' }, body: {} }) as any)
        expectError(res, 401)
    })

    it('id 非法 → 400', async () => {
        const res: any = await processHandler(makeEvent({
            userId: 100, params: { id: 'abc' }, body: {},
        }) as any)
        expectError(res, 400)
    })

    it('MaterialProcessError → 透传 code', async () => {
        mProcess.mockRejectedValueOnce(new MaterialProcessError(403, '无权访问'))
        const res: any = await processHandler(makeEvent({
            userId: 100, params: { id: '1' }, body: {},
        }) as any)
        expectError(res, 403, '无权访问')
    })

    it('普通错误 → 500', async () => {
        mProcess.mockRejectedValueOnce(new Error('boom'))
        const res: any = await processHandler(makeEvent({
            userId: 100, params: { id: '1' }, body: {},
        }) as any)
        expectError(res, 500)
    })

    it('body 缺失 → 用默认 enableEmbedding=true', async () => {
        mProcess.mockResolvedValue({ alreadyCompleted: false, contentLength: 1 } as any)
        const res: any = await processHandler(makeEvent({
            userId: 100, params: { id: '1' }, body: undefined,
        }) as any)
        expectSuccess(res)
    })
})
