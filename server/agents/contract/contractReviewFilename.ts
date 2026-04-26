/**
 * 合同审查导出 docx 文件名统一构造工具。
 *
 * spec §4.4 规定：`{合同名}_{版本号或"工作区"}_{日期}.docx`
 *   - 合同名：原始合同 OSS 文件名（去 .docx 后缀）
 *   - 版本号：`v{maxVersionNo}`；maxVersionNo=0 时显示为 `工作区`
 *   - 日期：YYYY-MM-DD
 *
 * 工作区下载、重生批注、历史版本下载三处共用此逻辑。
 */
export function buildContractReviewFilename(opts: {
    /** 原始合同 ossFile.fileName（可能为 null/undefined，兜底"合同审查"） */
    originalFileName: string | null | undefined
    /** 版本号。<=0 或 null 时显示"工作区" */
    versionNumber: number | null
    /** 可注入当前日期（便于测试）；不传用 new Date() */
    now?: Date
}): string {
    const baseName = (opts.originalFileName ?? '合同审查').replace(/\.docx$/i, '')
    const versionLabel = opts.versionNumber && opts.versionNumber > 0
        ? `v${opts.versionNumber}`
        : '工作区'
    const dateStr = (opts.now ?? new Date()).toISOString().slice(0, 10)
    return `${baseName}_${versionLabel}_${dateStr}.docx`
}

/**
 * 把 filename 编成 OSS signed URL 的 response-content-disposition 参数。
 * RFC 5987，让 OSS 在返回对象时覆盖存储的默认 Content-Disposition。
 */
export function buildContentDispositionForFilename(filename: string): string {
    return `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
}
