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
import { prisma } from '~~/server/utils/db'
import {
    findOssFileByIdDao,
    markOssFileUploadedByVerifyDao,
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
        // 并发：被回调或其他兜底先改了；fresh-read 判断
        const fresh = await prisma.ossFiles.findFirst({
            where: { id: fileId },
            select: { status: true },
        })
        if (fresh && fresh.status === OssFileStatus.UPLOADED) {
            return { ok: true, status: 'uploaded' }
        }
        return { ok: false, reason: 'invalid' }
    }
    return { ok: true, status: 'uploaded' }
}
