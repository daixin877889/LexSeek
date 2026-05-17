/**
 * 上传 Workspace 文件工具
 *
 * 工作流工具层 - 将 per-session workspace 中的文件上传到用户云盘（OSS）
 * 支持配额检查，配额不足时降级到临时公共路径（24h 有效）
 * 拒绝路径遍历、绝对路径、NULL 字节、反斜杠等非法文件名
 */

import { tool } from '@langchain/core/tools'
import { stat as fsStat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { basename, extname, resolve } from 'node:path'
import { z } from 'zod'
import { uploadFileService } from '~~/server/services/storage/storage.service'
import { getDefaultStorageConfigDao } from '~~/server/services/storage/storageConfig.dao'
import { checkStorageQuotaService } from '~~/server/services/membership/userBenefit.service'
import { createOssFileDao } from '~~/server/services/files/ossFiles.dao'
import { WORKSPACE_BASE, resolveWorkspaceDir } from './workspace'
import type { ToolContext, ToolDefinition } from './types'
import { FileSource, OssFileStatus } from '#shared/types/file'
import { StorageProviderType } from '~~/server/lib/storage/types'
import { buildStorageKey } from '~~/server/utils/storagePath'

/** 文件大小上限：50MB */
const MAX_FILE_SIZE = 50 * 1024 * 1024

/** 临时文件有效期：24小时（OSS 生命周期规则需配套配置） */
const TEMP_FILE_TTL_MS = 24 * 60 * 60 * 1000

/** MIME 类型映射表（扩展名 → MIME） */
const MIME_MAP: Record<string, string> = {
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.csv': 'text/csv',
    '.html': 'text/html',
    '.json': 'application/json',
    '.xml': 'application/xml',
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.wav': 'audio/wav',
    '.zip': 'application/zip',
    '.gz': 'application/gzip',
    '.log': 'text/plain',
    '.sh': 'text/x-shellscript',
    '.py': 'text/x-python',
    '.js': 'text/javascript',
    '.ts': 'text/typescript',
}

function inferMimeType(fileName: string): string {
    const ext = extname(fileName).toLowerCase()
    return MIME_MAP[ext] ?? 'application/octet-stream'
}

/** 路径段白名单：字母、数字、下划线、连字符、点、中文（与 writeSkillFile 保持一致） */
const SAFE_PATH_SEGMENT = /^[\w.\-一-鿿]+$/

/**
 * 校验相对路径安全性（支持子目录，与 writeSkillFile 保持一致）
 *
 * @returns 错误描述字符串，无错误返回 null
 */
function validateFilePath(filePath: string): string | null {
    if (filePath.includes('\0')) return 'Error: 路径包含非法字符（NULL 字节）'
    if (filePath.startsWith('/')) return 'Error: 不允许使用绝对路径'
    if (filePath.includes('..')) return 'Error: 不允许路径遍历（..）'
    if (filePath.includes('\\')) return 'Error: 路径不允许包含反斜杠（\\）'
    const segments = filePath.split('/')
    for (const segment of segments) {
        if (!segment) continue
        if (!SAFE_PATH_SEGMENT.test(segment)) {
            return `Error: 路径段 "${segment}" 包含非法字符`
        }
    }
    return null
}

function formatFileCard(fields: {
    fileId: number | string
    fileName: string
    fileSize: number
    mimeType: string
    temporary?: boolean
    expiresAt?: string
}): string {
    const lines = [
        '[file-card]',
        `fileId: ${fields.fileId}`,
        `fileName: ${fields.fileName}`,
        `fileSize: ${fields.fileSize}`,
        `mimeType: ${fields.mimeType}`,
    ]
    if (fields.temporary) {
        lines.push('temporary: true')
        lines.push(`expiresAt: ${fields.expiresAt}`)
    }
    lines.push('[/file-card]')
    return lines.join('\n')
}

/** stat 函数类型（支持注入，便于测试） */
type StatFn = (path: string) => Promise<{ size: number }>

/** 参数 schema（唯一数据源） */
const schema = z.object({
    filePath: z.string().min(1).describe('workspace 中的文件相对路径，支持子目录，如 output.txt 或 subdir/analysis.pdf'),
})

/** 工具定义（单一数据源） */
export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'upload_workspace_file',
    description: '将当前 session workspace 中的文件上传到用户云盘（OSS）。'
        + '调用本工具会自动在 UI 中渲染为可下载的文件卡片，'
        + '**你不需要在回复中重复说明文件信息或嵌入任何 [file-card] 文本**——前端会直接把工具调用本身渲染为文件卡片。'
        + '工具返回值（含 fileId 和元数据）仅供你内部判断成功与否参考。',
    schema,
}

/**
 * 创建上传 workspace 文件工具
 *
 * @param context 工具上下文（包含 userId、caseId、sessionId）
 * @param workspaceBase workspace 根目录（测试时可覆盖，默认 WORKSPACE_BASE）
 * @param statFn stat 函数（测试时可注入，用于模拟文件大小）
 */
export function createTool(context: ToolContext, workspaceBase?: string, statFn?: StatFn) {
    const base = workspaceBase ?? WORKSPACE_BASE
    const workspaceDir = resolveWorkspaceDir(base, context.sessionId)
    const statFile = statFn ?? fsStat

    return tool(
        async ({ filePath: relativePath }) => {
            const pathError = validateFilePath(relativePath)
            if (pathError) return pathError

            const fullPath = resolve(workspaceDir, relativePath)

            // resolve 后二次边界检查，防止意外越界
            if (!fullPath.startsWith(workspaceDir + '/') && fullPath !== workspaceDir) {
                return 'Error: 文件路径不在 workspace 目录内'
            }

            const fileName = basename(relativePath)

            let fileSize: number
            try {
                const statResult = await statFile(fullPath)
                fileSize = statResult.size
            } catch {
                return `Error: 文件不存在或无法访问 - ${relativePath}`
            }

            if (fileSize > MAX_FILE_SIZE) {
                return `Error: 文件超过大小限制（最大 50MB），当前文件大小 ${(fileSize / 1024 / 1024).toFixed(2)}MB`
            }

            const mimeType = inferMimeType(fileName)

            let quotaAllowed = true
            try {
                const quotaCheck = await checkStorageQuotaService(context.userId, fileSize)
                quotaAllowed = quotaCheck.allowed
            } catch (err) {
                // 配额服务异常时降级到临时路径，避免阻塞工作流
                logger.warn('配额检查失败，降级到临时路径:', err)
                quotaAllowed = false
            }

            if (quotaAllowed) {
                return await uploadToUserStorage(context.userId, context.sessionId, fullPath, fileName, fileSize, mimeType)
            }
            return await uploadToTempStorage(context.userId, context.sessionId, fullPath, fileName, fileSize, mimeType)
        },
        {
            name: toolDefinition.name,
            description: toolDefinition.description,
            schema,
        },
    )
}

/**
 * 上传到用户 OSS 目录，并创建 ossFiles 数据库记录
 */
async function uploadToUserStorage(
    userId: number,
    sessionId: string,
    filePath: string,
    fileName: string,
    fileSize: number,
    mimeType: string,
): Promise<string> {
    try {
        const ossPath = buildStorageKey({
            scope: 'user',
            userId,
            source: FileSource.CASE_ANALYSIS,
            subDir: sessionId,
            fileName: `${Date.now()}_${fileName}`,
        })
        const stream = createReadStream(filePath)

        const uploadResult = await uploadFileService(ossPath, stream, { contentType: mimeType, userId })

        // 获取默认存储配置以记录正确的 bucket 名称
        const storageConfig = await getDefaultStorageConfigDao(StorageProviderType.ALIYUN_OSS, userId)
        const bucketName = storageConfig?.bucket ?? ''

        const ossFile = await createOssFileDao({
            userId,
            bucketName,
            fileName,
            filePath: uploadResult.name,
            fileSize,
            fileType: mimeType,
            source: FileSource.CASE_ANALYSIS,
            status: OssFileStatus.UPLOADED,
            encrypted: false,
        })

        logger.info('workspace 文件已上传到用户云盘:', { userId, ossFileId: ossFile.id, fileName, ossPath: uploadResult.name })

        return formatFileCard({ fileId: ossFile.id, fileName, fileSize, mimeType })
    } catch (err) {
        logger.error('上传 workspace 文件到用户云盘失败:', err)
        return `Error: 文件上传失败 - ${err instanceof Error ? err.message : '未知错误'}`
    }
}

/**
 * 配额不足时，上传到临时公共路径（24h 有效）
 * 此路径文件不纳入用户配额统计，需在 OSS 侧配置对应生命周期规则自动清理
 */
async function uploadToTempStorage(
    userId: number,
    sessionId: string,
    filePath: string,
    fileName: string,
    fileSize: number,
    mimeType: string,
): Promise<string> {
    try {
        const timestamp = Date.now()
        const ossPath = buildStorageKey({
            scope: 'temp',
            source: FileSource.CASE_ANALYSIS,
            subDir: sessionId,
            fileName: `${timestamp}_${fileName}`,
        })
        const stream = createReadStream(filePath)

        await uploadFileService(ossPath, stream, { contentType: mimeType })

        const expiresAt = new Date(timestamp + TEMP_FILE_TTL_MS).toISOString()

        logger.warn('workspace 文件已上传到临时路径（用户配额不足）:', { userId, fileName, ossPath, expiresAt })

        return formatFileCard({ fileId: `temp_${timestamp}`, fileName, fileSize, mimeType, temporary: true, expiresAt })
    } catch (err) {
        logger.error('上传 workspace 文件到临时路径失败:', err)
        return `Error: 文件上传失败 - ${err instanceof Error ? err.message : '未知错误'}`
    }
}
