/**
 * 校验并修复 OSS 文件状态（前端兜底链路服务层）
 *
 * 当回调失败导致 ossFiles.status 停在 PENDING 时，由本服务通过 head OSS
 * 直接核对实际状态并修复。
 */
import { OssFileStatus } from '#shared/types/file'
import { createLogger } from '#shared/utils/logger'
import { StorageProviderType } from '~~/server/lib/storage/types'
import { getStorageAdapterService } from '~~/server/services/storage/storage.service'
import {
    findOssFileByIdDao,
    markOssFileUploadedByVerifyDao,
    markOssFileUploadedByCallbackDao,
} from './ossFiles.dao'

const log = createLogger('ossFileVerify')

export type VerifyOssFileResult =
    | { ok: true; status: 'uploaded' }
    | { ok: false; reason: 'forbidden' | 'not_found' | 'already_failed' | 'invalid' }

/**
 * 校验并修复单条 OSS 文件状态
 * - 已 UPLOADED → ok
 * - PENDING + OSS head 命中 → 修复成 UPLOADED 后 ok
 * - PENDING + OSS head=null → not_found
 * - FAILED → already_failed
 * - 不属于该用户 → forbidden
 *
 * 适配器抛异常（OSS 5xx / 网络）会向上抛，由 handler 转 503
 */
export async function verifyAndFixOssFileService(
    fileId: number,
    userId: number
): Promise<VerifyOssFileResult> {
    const file = await findOssFileByIdDao(fileId)

    if (!file) return { ok: false, reason: 'invalid' }
    if (file.userId !== userId) return { ok: false, reason: 'forbidden' }

    if (file.status === OssFileStatus.UPLOADED) {
        return { ok: true, status: 'uploaded' }
    }
    if (file.status === OssFileStatus.FAILED) {
        return { ok: false, reason: 'already_failed' }
    }

    if (!file.filePath) {
        log.error('PENDING 文件缺少 filePath，无法兜底', { fileId })
        return { ok: false, reason: 'invalid' }
    }

    const adapter = await getStorageAdapterService({
        type: StorageProviderType.ALIYUN_OSS,
        userId: file.userId,
    })

    const headResult = await adapter.head(file.filePath)
    if (!headResult) {
        log.info('[verify] head=null', { fileId, filePath: file.filePath })
        return { ok: false, reason: 'not_found' }
    }

    const updated = await markOssFileUploadedByVerifyDao(fileId, {
        auditNote: `verified via head, size=${headResult.size}`,
    })

    if (updated === 0) {
        // 并发：被回调或其他兜底先改了；fresh-read 判断（复用 DAO 自带 deletedAt:null 过滤）
        const fresh = await findOssFileByIdDao(fileId)
        if (fresh && fresh.status === OssFileStatus.UPLOADED) {
            return { ok: true, status: 'uploaded' }
        }
        return { ok: false, reason: 'invalid' }
    }
    return { ok: true, status: 'uploaded' }
}

/** 存储回调核对入参 */
export interface StorageCallbackConfirmInput {
    /** 回调声明的 ossFiles 记录 ID（来自 x:file_id） */
    fileId: number
    /** 回调声明的实际上传对象路径（来自 filename） */
    filePath: string
    /** 回调声明的上传用户 ID（来自 x:user_id） */
    userId: number
    /** 是否加密上传 */
    encrypted: boolean
    /** 加密文件的原始 MIME 类型 */
    originalMimeType: string | null
}

export type StorageCallbackConfirmResult =
    | { ok: true }
    | { ok: false; reason: 'not_found' | 'path_mismatch' | 'user_mismatch' | 'rejected' }

/**
 * 校验存储回调并标记文件为已上传。
 *
 * 验签已确认回调来自存储服务商；本服务进一步把回调声明的对象路径、上传用户
 * 与登记的 ossFiles 记录对账，再通过条件更新（仅 PENDING）防止回调重放。
 * 文件已是 UPLOADED 时视为幂等成功。
 */
export async function confirmOssFileByStorageCallbackService(
    input: StorageCallbackConfirmInput
): Promise<StorageCallbackConfirmResult> {
    const file = await findOssFileByIdDao(input.fileId)
    if (!file) return { ok: false, reason: 'not_found' }
    if (file.filePath !== input.filePath) return { ok: false, reason: 'path_mismatch' }
    if (file.userId !== input.userId) return { ok: false, reason: 'user_mismatch' }

    const updated = await markOssFileUploadedByCallbackDao(input.fileId, {
        encrypted: input.encrypted,
        originalMimeType: input.originalMimeType,
    })
    if (updated > 0) return { ok: true }

    // 条件更新未命中：文件已非 PENDING（回调重放视为幂等成功，其余视为拒绝）
    const fresh = await findOssFileByIdDao(input.fileId)
    if (fresh && fresh.status === OssFileStatus.UPLOADED) return { ok: true }
    return { ok: false, reason: 'rejected' }
}
