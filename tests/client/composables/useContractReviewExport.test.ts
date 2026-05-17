/**
 * useContractReviewExport · onExportPdf 测试
 *
 * 回归 M18：export-pdf 用 $fetch + responseType:'blob'。服务端业务失败走 resError
 * → HTTP 200 + JSON 体；ofetch 在 2xx 下不抛错，把 JSON 错误体也包成 Blob 返回。
 * 旧实现只判 `data instanceof Blob` → JSON 文本被当 PDF 存成损坏文件，catch 永不触发。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const { toastMock, downloadMock, mockFetch } = vi.hoisted(() => ({
    toastMock: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
    downloadMock: { triggerBrowserDownloadBlob: vi.fn(), triggerBrowserDownloadUrl: vi.fn() },
    mockFetch: vi.fn(),
}))

vi.stubGlobal('$fetch', mockFetch)
vi.mock('vue-sonner', () => ({ toast: toastMock }))
vi.mock('~/utils/browserDownload', () => downloadMock)

import { useContractReviewExport } from '~/composables/useContractReviewExport'

describe('useContractReviewExport · onExportPdf (M18)', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('成功：服务端返回 application/pdf Blob → 触发下载 + success toast', async () => {
        mockFetch.mockResolvedValueOnce(
            new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], { type: 'application/pdf' }),
        )
        const { onExportPdf } = useContractReviewExport(ref(8))
        await onExportPdf(true)
        expect(downloadMock.triggerBrowserDownloadBlob).toHaveBeenCalledOnce()
        expect(toastMock.success).toHaveBeenCalledWith('PDF 已下载')
        expect(toastMock.error).not.toHaveBeenCalled()
    })

    it('M18 回归：resError 的 JSON 错误体被包成 application/json Blob → 不下载，error toast 取 message', async () => {
        const errorBody = JSON.stringify({ code: 403, success: false, message: '无权导出该合同审查' })
        mockFetch.mockResolvedValueOnce(new Blob([errorBody], { type: 'application/json' }))
        const { onExportPdf } = useContractReviewExport(ref(8))
        await onExportPdf(true)
        // 不能把 JSON 错误体当 PDF 下载成损坏文件
        expect(downloadMock.triggerBrowserDownloadBlob).not.toHaveBeenCalled()
        expect(toastMock.success).not.toHaveBeenCalled()
        expect(toastMock.error).toHaveBeenCalledWith('无权导出该合同审查')
    })

    it('M18：JSON 错误体缺 message 字段时用兜底文案', async () => {
        mockFetch.mockResolvedValueOnce(new Blob(['{}'], { type: 'application/json' }))
        const { onExportPdf } = useContractReviewExport(ref(8))
        await onExportPdf(false)
        expect(downloadMock.triggerBrowserDownloadBlob).not.toHaveBeenCalled()
        expect(toastMock.error).toHaveBeenCalledWith('PDF 生成失败')
    })

    it('reviewId 为 null 时直接返回，不发请求', async () => {
        const { onExportPdf } = useContractReviewExport(ref<number | null>(null))
        await onExportPdf(true)
        expect(mockFetch).not.toHaveBeenCalled()
    })
})
