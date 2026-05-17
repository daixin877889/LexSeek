import { toast } from 'vue-sonner'
import type { Ref } from 'vue'
import type { ContractExportMode, DownloadResponse } from '#shared/types/contract'
import { useApiFetch } from '~/composables/useApiFetch'
import { triggerBrowserDownloadBlob, triggerBrowserDownloadUrl } from '~/utils/browserDownload'

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
            const url = `/api/v1/assistant/contract/reviews/export-pdf/${reviewId.value}`
            const data = await fetcher(url, {
                method: 'POST',
                body: { includeRisks },
                responseType: 'blob',
            })
            if (!(data instanceof Blob)) {
                toast.error('PDF 生成失败')
                return
            }
            // M18：服务端业务失败走 resError → HTTP 200 + JSON 体；ofetch 在 2xx 下不抛错，
            // 把 JSON 错误体也包成 Blob（content-type=application/json）返回。若不校验 MIME，
            // JSON 文本会被当 PDF 存成损坏文件，且 catch 永不触发。成功时必为 application/pdf。
            if (!data.type.includes('application/pdf')) {
                let message = 'PDF 生成失败'
                try {
                    const parsed = JSON.parse(await data.text()) as { message?: string }
                    if (parsed?.message) message = parsed.message
                } catch {
                    // 响应体非 JSON，保留兜底文案
                }
                toast.error(message)
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

    /**
     * 拉取签名 URL，fetch 成 Blob 再触发下载 —— 避免 OSS 自定义域名 / CDN
     * 下 `response-content-disposition` 被忽略导致浏览器 fallback 用 OSS 路径
     * 最后一段当文件名（用户看到 "reviewed-871.docx" 而不是 spec §4.4 的
     * "{合同名}_v{N}_{日期}.docx"）。走 Blob 后文件名由前端 `<a download>`
     * 强绑定，100% 对齐 spec。fetch 失败再回退到 URL 直链。
     */
    async function onDownload(mode: ContractExportMode = 'comment') {
        if (!reviewId.value) return

        const url = `/api/v1/assistant/contract/reviews/download/${reviewId.value}?mode=${mode}`
        const result = await useApiFetch<DownloadResponse>(url, { showError: false })
        if (!result?.downloadUrl) {
            toast.error('下载失败，请稍后重试')
            return
        }

        try {
            const httpResp = await fetch(result.downloadUrl)
            if (!httpResp.ok) throw new Error(`HTTP ${httpResp.status}`)
            triggerBrowserDownloadBlob(await httpResp.blob(), result.filename)
        } catch {
            triggerBrowserDownloadUrl(result.downloadUrl, result.filename)
        }
    }

    return { isExportingPdf, onExportPdf, onDownload }
}
