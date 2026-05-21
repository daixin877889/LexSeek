/**
 * CORE-R3：合同审查模块统一的"上传 OSS + 落 ossFiles 行 + 失败清理孤儿"工具。
 *
 * 历史上 contractReview.service.paste / contractReviewVersion /
 * reviewResultPersistence.middleware 三处各自手写 30~40 行同构代码：
 *   uploadFileService + getDefaultStorageConfigDao（Promise.all）
 *   → createOssFileDao
 *   → 失败时 deleteFileService 清孤儿 + logger.warn 容错
 *
 * 这里抽成一个工具函数，调用方只关心后续的 generateSignedUrl / 写
 * reviewedFileId / setCompleted 等业务步骤；上传+落库的孤儿清理由本工具兜底。
 *
 * **注意**：contractReviewRebuild.service.ts 因 P0-4 时序约束
 * （upload → generateSignedUrlService → createOssFileDao → setCompletedAfterRebuildDAO，
 * signedUrl 必须介于 upload 与 createOssFile 之间，见 rebuild service 顶部注释及
 * tests/server/assistant/contract/contractReviewRebuild.service.test.ts:226-239
 * 守门测试）不能用本 util，保留原 inline 实现，参见
 * server/services/assistant/contract/contractReviewRebuild.service.ts:100-156。
 */
import { createOssFileDao } from '~~/server/services/files/ossFiles.dao'
import { uploadFileService, deleteFileService } from '~~/server/services/storage/storage.service'
import { getDefaultStorageConfigDao } from '~~/server/services/storage/storageConfig.dao'
import { StorageProviderType } from '~~/server/lib/storage/types'
import { OssFileStatus, type FileSource } from '#shared/types/file'

export interface UploadAndRegisterOssFileInput {
    /** OSS object key，由调用方经 buildStorageKey 构造，格式如 `{env}/user{id}/caseAnalysis/{uuid}.docx` */
    ossPath: string
    buffer: Buffer
    /** 给 createOssFileDao 用的展示文件名（非 OSS path） */
    fileName: string
    /** mime，例如 DOCX_MIME */
    fileType: string
    userId: number
    /** ossFiles.source 字段，调用方按各自语义透传 */
    source: FileSource
    /** 失败时是否清理 OSS 孤儿（默认 true） */
    cleanupOnError?: boolean
}

export interface UploadAndRegisterOssFileResult {
    uploadName: string
    bucketName: string
    ossFileId: number
}

/**
 * 上传到 OSS 并在 ossFiles 表落库。
 *
 * - 同时跑 uploadFileService + getDefaultStorageConfigDao（Promise.all）
 * - 调 createOssFileDao 落库，返回 { uploadName, bucketName, ossFileId }
 * - 任意步骤抛错且 cleanupOnError=true（默认）→ 调 deleteFileService 清 OSS 孤儿；
 *   清理失败只 logger.warn，不覆盖原始 error；原 error 透传向上抛
 *
 * bucket 名 getDefaultStorageConfigDao 返回 null 时 fallback 空串（保持原 4 处行为）。
 */
export async function uploadAndRegisterOssFile(
    input: UploadAndRegisterOssFileInput,
): Promise<UploadAndRegisterOssFileResult> {
    const {
        ossPath,
        buffer,
        fileName,
        fileType,
        userId,
        source,
        cleanupOnError = true,
    } = input

    let uploadName: string | undefined
    try {
        const [uploadResult, storageConfig] = await Promise.all([
            uploadFileService(ossPath, buffer, {
                contentType: fileType,
                userId,
            }),
            getDefaultStorageConfigDao(StorageProviderType.ALIYUN_OSS, userId),
        ])
        uploadName = uploadResult.name
        const bucketName = storageConfig?.bucket ?? ''

        const ossFileRow = await createOssFileDao({
            userId,
            bucketName,
            fileName,
            filePath: uploadName,
            fileSize: buffer.byteLength,
            fileType,
            source,
            status: OssFileStatus.UPLOADED,
            encrypted: false,
        })

        return {
            uploadName,
            bucketName,
            ossFileId: ossFileRow.id,
        }
    } catch (err) {
        // upload 自身抛错时 uploadName 为 undefined，没有孤儿可清；createOssFile
        // 抛错时 uploadName 已就绪需要清。Promise.resolve(...) 包裹兜底测试中
        // mock 未返回 Promise 的情况（与 4 处旧代码一致）。
        if (cleanupOnError && uploadName) {
            await Promise.resolve(deleteFileService(uploadName, { userId }))
                .catch((cleanupErr) => {
                    logger.warn('uploadAndRegisterOssFile: OSS 孤儿清理失败', {
                        userId,
                        ossPath: uploadName,
                        cleanupErr: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
                    })
                })
        }
        throw err
    }
}
