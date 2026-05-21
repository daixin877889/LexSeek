/**
 * server/api/v1/callback/** handler 单元覆盖（2 文件）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../_helpers/handler-test'
import { makeEvent } from '../_helpers/handler-test'

vi.mock('~~/server/services/material/mineruResult.service', () => ({
    processMineruResultService: vi.fn(),
}))
vi.mock('~~/server/services/material/mineru.dao', () => ({
    findDocRecognitionByOssFileIdDao: vi.fn(),
    updateDocRecognitionRecordDao: vi.fn(),
}))
vi.mock('~~/server/services/material/mineruTask.service', () => ({
    getMineruTaskByTaskIdService: vi.fn(),
    isMineruTaskProcessedService: vi.fn(),
}))
vi.mock('~~/server/services/material/mineru.service', () => ({
    processConversionResultService: vi.fn(),
    completeConversionService: vi.fn(),
    failConversionService: vi.fn(),
}))

;(globalThis as any).prisma = {
    mineruTasks: {
        findFirst: vi.fn(),
        update: vi.fn(),
    },
}

import { processMineruResultService } from '~~/server/services/material/mineruResult.service'
import { findDocRecognitionByOssFileIdDao, updateDocRecognitionRecordDao } from '~~/server/services/material/mineru.dao'
import { getMineruTaskByTaskIdService, isMineruTaskProcessedService } from '~~/server/services/material/mineruTask.service'
import {
    processConversionResultService,
    completeConversionService,
    failConversionService,
} from '~~/server/services/material/mineru.service'

const mProcessResult = vi.mocked(processMineruResultService)
const mFindDocRec = vi.mocked(findDocRecognitionByOssFileIdDao)
const mUpdateDocRec = vi.mocked(updateDocRecognitionRecordDao)
const mGetTaskByTaskId = vi.mocked(getMineruTaskByTaskIdService)
const mIsProcessed = vi.mocked(isMineruTaskProcessedService)
const mProcessConv = vi.mocked(processConversionResultService)
const mCompleteConv = vi.mocked(completeConversionService)
const mFailConv = vi.mocked(failConversionService)

const { default: batchHandler } = await import('../../../server/api/v1/callback/mineru-batch.post')
const { default: mineruHandler } = await import('../../../server/api/v1/callback/mineru.post')

describe('POST /api/v1/callback/mineru-batch', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        ;(globalThis as any).prisma.mineruTasks.findFirst.mockResolvedValue({
            id: 1, status: 1, /* PROCESSING=1 */
            taskRawData: { seed: 'seed-x' },
        })
        ;(globalThis as any).prisma.mineruTasks.update.mockResolvedValue({})
    })

    it('happy path：done 状态文件成功处理', async () => {
        const content = JSON.stringify({
            batch_id: 'B1',
            extract_result: [
                { data_id: '99_100', state: 'done', full_zip_url: 'https://x.zip', file_name: 'a.pdf' },
            ],
        })
        const res: any = await batchHandler(makeEvent({
            body: { checksum: 'cs', content },
        }) as any)
        expect(res.code).toBe('SUCCESS')
        expect(mProcessResult).toHaveBeenCalled()
    })

    it('failed 状态 → 更新任务为 FAILED', async () => {
        const content = JSON.stringify({
            batch_id: 'B1',
            files: [{ data_id: '99_100', state: 'failed', err_msg: 'OOM' }],
        })
        mFindDocRec.mockResolvedValue({ id: 5 } as any)
        const res: any = await batchHandler(makeEvent({
            body: { checksum: 'cs', content },
        }) as any)
        expect(res.code).toBe('SUCCESS')
        expect(mUpdateDocRec).toHaveBeenCalled()
    })

    it('Zod 失败 → FAIL', async () => {
        const res: any = await batchHandler(makeEvent({ body: {} }) as any)
        expect(res.code).toBe('FAIL')
    })

    it('content JSON 解析失败 → FAIL', async () => {
        const res: any = await batchHandler(makeEvent({
            body: { checksum: 'cs', content: 'not-json' },
        }) as any)
        expect(res.code).toBe('FAIL')
    })

    it('content 缺 batch_id → FAIL', async () => {
        const content = JSON.stringify({ files: [] })
        const res: any = await batchHandler(makeEvent({
            body: { checksum: 'cs', content },
        }) as any)
        expect(res.code).toBe('FAIL')
    })

    it('data_id 格式错误 → 跳过此文件，继续 SUCCESS', async () => {
        const content = JSON.stringify({
            batch_id: 'B', extract_result: [{ data_id: 'invalid', state: 'done' }],
        })
        const res: any = await batchHandler(makeEvent({
            body: { checksum: 'cs', content },
        }) as any)
        expect(res.code).toBe('SUCCESS')
    })

    it('未找到任务 → 跳过，继续 SUCCESS', async () => {
        ;(globalThis as any).prisma.mineruTasks.findFirst.mockResolvedValue(null)
        const content = JSON.stringify({
            batch_id: 'B', extract_result: [{ data_id: '99_100', state: 'done', full_zip_url: 'u' }],
        })
        const res: any = await batchHandler(makeEvent({
            body: { checksum: 'cs', content },
        }) as any)
        expect(res.code).toBe('SUCCESS')
    })

    it('任务已完成 → 跳过幂等', async () => {
        ;(globalThis as any).prisma.mineruTasks.findFirst.mockResolvedValue({
            id: 1, status: 2, /* SUCCESS=2 */
        })
        const content = JSON.stringify({
            batch_id: 'B', extract_result: [{ data_id: '99_100', state: 'done', full_zip_url: 'u' }],
        })
        const res: any = await batchHandler(makeEvent({
            body: { checksum: 'cs', content },
        }) as any)
        expect(res.code).toBe('SUCCESS')
        expect((globalThis as any).prisma.mineruTasks.update).not.toHaveBeenCalled()
    })

    it('done 但缺 download_url → 跳过', async () => {
        const content = JSON.stringify({
            batch_id: 'B', extract_result: [{ data_id: '99_100', state: 'done' }],
        })
        const res: any = await batchHandler(makeEvent({
            body: { checksum: 'cs', content },
        }) as any)
        expect(res.code).toBe('SUCCESS')
        expect((globalThis as any).prisma.mineruTasks.update).not.toHaveBeenCalled()
    })

    it('processMineruResult 抛错 → 不影响整体 SUCCESS', async () => {
        mProcessResult.mockRejectedValueOnce(new Error('zip'))
        const content = JSON.stringify({
            batch_id: 'B', extract_result: [{ data_id: '99_100', state: 'done', full_zip_url: 'u' }],
        })
        const res: any = await batchHandler(makeEvent({
            body: { checksum: 'cs', content },
        }) as any)
        expect(res.code).toBe('SUCCESS')
    })

    it('readBody 抛错 → FAIL', async () => {
        const res: any = await batchHandler({ __body: undefined } as any)
        expect(res.code).toBe('FAIL')
    })

    it('整体 catch 异常 → FAIL', async () => {
        ;(globalThis as any).prisma.mineruTasks.update.mockRejectedValueOnce(new Error('db'))
        const content = JSON.stringify({
            batch_id: 'B', extract_result: [{ data_id: '99_100', state: 'failed', err_msg: 'x' }],
        })
        // doc record null 直接路过；但 update 在前一段抛错——重新构造一次正常的 done 流程
        ;(globalThis as any).prisma.mineruTasks.update.mockRejectedValue(new Error('db'))
        const content2 = JSON.stringify({
            batch_id: 'B', extract_result: [{ data_id: '99_100', state: 'done', full_zip_url: 'u' }],
        })
        const res: any = await batchHandler(makeEvent({
            body: { checksum: 'cs', content: content2 },
        }) as any)
        expect(res.code).toBe('FAIL')
    })
})

describe('POST /api/v1/callback/mineru', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('单文件回调已废弃：任何请求都返回 FAIL', async () => {
        const res: any = await mineruHandler(makeEvent({
            body: { task_id: 'T1', state: 'done', result: { download_url: 'u' } },
        }) as any)
        expect(res.code).toBe('FAIL')
        expect(res.message).toContain('/api/v1/callback/mineru-batch')
    })

    it('废弃接口不再触发旧单文件处理链路', async () => {
        const res: any = await mineruHandler(makeEvent({
            body: { task_id: 'T1', state: 'failed', err_msg: '内核挂' },
        }) as any)
        expect(res.code).toBe('FAIL')
        expect(mIsProcessed).not.toHaveBeenCalled()
        expect(mGetTaskByTaskId).not.toHaveBeenCalled()
        expect(mProcessConv).not.toHaveBeenCalled()
        expect(mCompleteConv).not.toHaveBeenCalled()
        expect(mFailConv).not.toHaveBeenCalled()
    })
})
