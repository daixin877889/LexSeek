/**
 * 获取单个 OSS 文件的元数据（不生成下载链接，开销轻）
 *
 * GET /api/v1/files/metadata/:fileId
 *
 * 用途：FileCard 组件在 [file-card] 块缺失字段时（LLM 缩写格式）
 * 自动拉取文件名、大小、mimeType。仅允许文件所有者访问。
 */

import { decimalToNumberUtils } from '#shared/utils/decimalToNumber'

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const rawId = getRouterParam(event, 'fileId')
    const fileId = rawId ? Number(rawId) : NaN
    if (!rawId || !Number.isInteger(fileId) || fileId <= 0) {
        return resError(event, 400, '无效的文件ID')
    }

    const ossFile = await prisma.ossFiles.findFirst({
        where: { id: fileId, deletedAt: null },
        select: {
            id: true,
            userId: true,
            fileName: true,
            fileSize: true,
            fileType: true,
        },
    })

    if (!ossFile) return resError(event, 404, '文件不存在')
    if (ossFile.userId !== user.id) return resError(event, 403, '无权限访问该文件')

    return resSuccess(event, '获取文件元数据成功', {
        fileId: ossFile.id,
        fileName: ossFile.fileName,
        fileSize: decimalToNumberUtils(ossFile.fileSize),
        mimeType: ossFile.fileType,
    })
})
