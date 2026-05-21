/**
 * OSS object key 构造工具
 *
 * 统一约定：{env}/{owner}/{source}/[{subDir}/]{filename}
 * - {env}    环境前缀，来自 runtimeConfig.storage.basePath（dev/ test/ prod/），空则不加
 * - {owner}  user{id} | system | temp
 * - {source} FileSource 枚举值
 * - {subDir} 可选二级目录（前后不带斜杠）
 *
 * 仅供 Nitro 运行时（API handler / Service / 中间件 / Agent 工具）调用——依赖
 * useRuntimeConfig()。独立运行的维护脚本不要用本函数。
 */
import type { FileSource } from '#shared/types/file'

export type StorageScope = 'user' | 'system' | 'temp'

export interface StoragePathParams {
    scope: StorageScope
    /** scope='user' 时必填 */
    userId?: number
    source: FileSource
    /** 可选二级目录，前后不带斜杠 */
    subDir?: string
}

/** 规范化环境前缀：空值 → ''；非空 → 保证以 / 结尾。纯函数，便于单测。 */
export function normalizeBasePath(raw: string | null | undefined): string {
    if (!raw) return ''
    return raw.endsWith('/') ? raw : `${raw}/`
}

/** 取环境前缀（从 runtimeConfig 读取并规范化） */
function getBasePath(): string {
    return normalizeBasePath(useRuntimeConfig().storage.basePath)
}

/** owner 段：user{id} / system / temp */
function resolveOwner(scope: StorageScope, userId?: number): string {
    if (scope === 'user') {
        if (userId == null) {
            throw new Error('[storagePath] scope=user 时 userId 必填')
        }
        return `user${userId}`
    }
    return scope
}

/** 构造目录（末尾带 /），供预签名上传流程使用 */
export function buildStorageDir(params: StoragePathParams): string {
    const owner = resolveOwner(params.scope, params.userId)
    const sub = params.subDir ? `${params.subDir}/` : ''
    return `${getBasePath()}${owner}/${params.source}/${sub}`
}

/** 构造完整 object key（含 {env} 前缀） */
export function buildStorageKey(params: StoragePathParams & { fileName: string }): string {
    return `${buildStorageDir(params)}${params.fileName}`
}
