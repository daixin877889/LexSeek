/**
 * 删除 OSS 文件
 * 
 * 软删除用户的文件记录
 */

export default defineEventHandler(async (event) => {
    try {
        const user = event.context.auth.user

        // 获取文件 ID
        const id = getRouterParam(event, 'id')
        const fileId = z.coerce.number({ message: '文件 ID 必须为数字' }).parse(id)

        // 查找文件记录
        const file = await findOssFileByIdDao(fileId)
        if (!file) {
            return resError(event, 404, '文件不存在')
        }

        // 验证文件所有权
        if (file.userId !== user.id) {
            return resError(event, 403, '无权删除此文件')
        }

        // 软删除文件
        await deleteFileDao(fileId)

        return resSuccess(event, '删除文件成功', null)
    } catch (error) {
        return resError(event, 400, parseErrorMessage(error, '删除文件失败'))
    }
})
