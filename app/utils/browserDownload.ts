/**
 * 触发浏览器下载的通用工具。
 *
 * 所有需要"拿到签名 URL / Blob 后让浏览器弹起保存对话框"的场景统一走这里，
 * 避免各处重复创建隐藏 <a download> 的 DOM 代码。
 */

/** 用签名 URL 触发下载（filename 留空则由后端 Content-Disposition 决定文件名） */
export function triggerBrowserDownloadUrl(url: string, filename = '') {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
}

/** 用 Blob 触发下载；内部自动 createObjectURL 并在结束后 revoke */
export function triggerBrowserDownloadBlob(blob: Blob, filename: string) {
    const objUrl = URL.createObjectURL(blob)
    try {
        triggerBrowserDownloadUrl(objUrl, filename)
    } finally {
        URL.revokeObjectURL(objUrl)
    }
}
