import type { OssConfig, DeleteResult } from '~~/shared/types/oss'
import { createOssClient } from './client'
import { OssDeleteError } from './errors'

/**
 * 删除 OSS 文件
 * @param config OSS 配置
 * @param objectPath 文件路径或路径数组
 * @returns 删除结果
 */
export async function deleteFile(
    config: OssConfig,
    objectPath: string | string[]
): Promise<DeleteResult> {
    const { client } = await createOssClient(config)

    try {
        const paths = Array.isArray(objectPath) ? objectPath : [objectPath]

        if (paths.length === 1) {
            // 单个文件删除
            await client.delete(paths[0])
        } else {
            // 批量删除
            await client.deleteMulti(paths, { quiet: true })
        }

        // 返回删除结果（OSS 删除不存在的文件不会报错）
        return {
            deleted: paths
        }
    } catch (error: any) {
        throw new OssDeleteError(error.message)
    }
}
