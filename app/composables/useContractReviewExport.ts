import { toast } from 'vue-sonner'
import type { Ref } from 'vue'
import type { DownloadResponse } from '#shared/types/contract'

/**
 * 合同审查的文件导出动作（PDF 导出 + 批注版 docx 下载）。
 *
 * 抽出自 useContractReview，独立于 stream / risk / stage 状态，仅依赖 reviewId。
 */
export function useContractReviewExport(reviewId: Ref<number | null>) {
    const isExportingPdf = ref(false)

    /**
     * 导出 PDF。
     * - 入口 toast.info 提示生成中
     * - 成功：Blob → createObjectURL → <a download> 触发浏览器保存
     * - 失败：解析 e.data.message，fallback 固定文案
     */
    async function onExportPdf(includeRisks: boolean) {
        if (!reviewId.value) return
        isExportingPdf.value = true
        toast.info('正在生成 PDF...')
        try {
            // 后端返回 PDF 二进制流（非 JSON envelope），绕开 useApiFetch。
            // Nitro 强类型路由推断在 responseType:'blob' 下深度展开会触发 TS2589，
            // 因此把 $fetch 窄化为纯函数签名后调用，运行时不受影响。
            type BlobFetch = (url: string, opts: Record<string, unknown>) => Promise<unknown>
            const fetcher = $fetch as unknown as BlobFetch
            const url = `/api/v1/assistant/contract/reviews/${reviewId.value}/export-pdf`
            const data = await fetcher(url, {
                method: 'POST',
                body: { includeRisks },
                responseType: 'blob',
            })
            if (!(data instanceof Blob)) {
                toast.error('PDF 生成失败')
                return
            }
            triggerBrowserDownloadBlob(data, `contract-review-${reviewId.value}.pdf`)
            toast.success('PDF 已下载')
        } catch (e: unknown) {
            const msg = (e as { data?: { message?: string } })?.data?.message ?? 'PDF 生成失败'
            toast.error(msg)
        } finally {
            isExportingPdf.value = false
        }
    }

    /** 拉取签名 URL 并通过隐藏 <a download> 触发浏览器下载 */
    async function onDownload() {
        if (!reviewId.value) return

        const result = await useApiFetch<DownloadResponse>(
            `/api/v1/assistant/contract/reviews/${reviewId.value}/download`,
            { showError: false },
        )
        if (!result?.downloadUrl) {
            toast.error('下载失败，请稍后重试')
            return
        }

        // 必须传 filename，否则浏览器会用 URL 最后一段（rebuild-xxx-uuid.docx）当文件名
        triggerBrowserDownloadUrl(result.downloadUrl, result.filename)
    }

    return { isExportingPdf, onExportPdf, onDownload }
}
