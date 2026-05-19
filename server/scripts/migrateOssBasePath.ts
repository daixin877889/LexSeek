/**
 * OSS 历史文件环境前缀迁移脚本
 *
 * 把 ossFiles 表中未带环境前缀的历史文件，在 OSS 内复制到 {basePath}{filePath}，
 * 并更新 ossFiles.filePath。按环境各跑一次（用对应环境的 .env）。
 *
 * 用法（用 bun run，bun 会自动加载对应环境的 .env）：
 *   bun run server/scripts/migrateOssBasePath.ts                 # dry-run，仅打印待迁移清单
 *   bun run server/scripts/migrateOssBasePath.ts --execute       # 实际复制 + 改库（源对象保留）
 *   bun run server/scripts/migrateOssBasePath.ts --delete-source # 删除已迁移成功的根目录旧对象
 *
 * 依赖环境变量（bun run 从对应环境 .env 自动加载，或已在 shell 注入）：
 *   - DATABASE_URL
 *   - NUXT_STORAGE_BASE_PATH（环境前缀，如 dev/ test/ prod/）
 *   - NUXT_STORAGE_ALIYUN_OSS_*（OSS 凭证；DB 无存储配置时回退用）
 *   - NUXT_STORAGE_CONFIG_ENCRYPTION_KEY（解密 DB 中存储配置所需；缺失会 fail-fast 报错）
 *
 * 生产环境顺序：dry-run → execute → 人工验证 → delete-source
 */
import { fileURLToPath } from 'node:url'
import { normalizeBasePath } from '../utils/storagePath'

/** 单批查询条数 */
const BATCH_SIZE = 200
/** 阿里云 CopyObject 单对象上限 1GB，超过需 multipartUploadCopy，本脚本直接跳过告警 */
const MAX_COPY_SIZE = 1024 * 1024 * 1024

/** 迁移脚本只用到 OSS client 的这几个方法（ali-oss 无 .d.ts，按需结构化定义，避免 any） */
interface OssClientLike {
    getObjectMeta(key: string): Promise<{ res: { headers: Record<string, string | undefined> } }>
    copy(target: string, source: string): Promise<unknown>
    delete(key: string): Promise<unknown>
}

/** 该行是否需要迁移：filePath 非空、basePath 非空、且 filePath 未以 basePath 开头 */
export function needsMigration(filePath: string | null, basePath: string): boolean {
    if (!filePath || !basePath) return false
    return !filePath.startsWith(basePath)
}

/** 旧路径补上环境前缀 */
export function prefixedKey(filePath: string, basePath: string): string {
    return `${basePath}${filePath}`
}

/**
 * 取对象大小（字节）。对象不存在（NoSuchKey / 404）返回 null；
 * 其它错误（网络 / 凭证等）向上抛出，由调用方计入 failed，避免把瞬态错误静默当成「不存在」漏迁。
 *
 * 与 server/lib/oss/headFile.ts 行为等价，但 headFile 每次调用内部都 createOssClient 新建 client；
 * 本脚本逐行批量调用、需复用同一 client，故自写此接收 client 的轻量版。
 */
async function getObjectSize(client: OssClientLike, key: string): Promise<number | null> {
    try {
        const meta = await client.getObjectMeta(key)
        return Number(meta.res.headers['content-length'] ?? 0)
    } catch (err: unknown) {
        const e = err as { code?: string; status?: number }
        if (e?.code === 'NoSuchKey' || e?.status === 404) return null
        throw err
    }
}

/** 解析命令行参数 */
function parseArgs(): { execute: boolean; deleteSource: boolean } {
    const argv = process.argv.slice(2)
    return {
        execute: argv.includes('--execute'),
        deleteSource: argv.includes('--delete-source'),
    }
}

async function main() {
    // ---- 脚本引导：独立运行不在 Nitro 运行时，先挂全局依赖再动态 import 服务层 ----
    const { prisma } = await import('../utils/db')
    const { logger: sharedLogger } = await import('../../shared/utils/logger/index')

    const g = globalThis as Record<string, unknown>
    // 显式挂全局 prisma：storageConfig.dao.ts 引用全局 prisma，而 db.ts 仅在
    // NODE_ENV!=='production' 时挂全局；本脚本含生产全环境运行，必须自己挂。
    g.prisma = prisma
    g.logger = sharedLogger
    g.useRuntimeConfig = () => ({
        storage: {
            basePath: process.env.NUXT_STORAGE_BASE_PATH || '',
            callbackUrl: process.env.NUXT_STORAGE_CALLBACK_URL || '',
            defaultType: process.env.NUXT_STORAGE_DEFAULT_TYPE || 'aliyun_oss',
            aliyunOss: {
                accessKeyId: process.env.NUXT_STORAGE_ALIYUN_OSS_ACCESS_KEY_ID || '',
                accessKeySecret: process.env.NUXT_STORAGE_ALIYUN_OSS_ACCESS_KEY_SECRET || '',
                bucket: process.env.NUXT_STORAGE_ALIYUN_OSS_BUCKET || '',
                region: process.env.NUXT_STORAGE_ALIYUN_OSS_REGION || '',
                customDomain: process.env.NUXT_STORAGE_ALIYUN_OSS_CUSTOM_DOMAIN || '',
            },
        },
    })

    // 全局依赖就绪后再动态 import 服务层
    const { StorageProviderType, isAliyunOssConfig } = await import('../lib/storage/types')
    const { getDefaultStorageConfigDao } = await import('../services/storage/storageConfig.dao')
    const { createOssClient } = await import('../lib/oss/client')

    const { execute, deleteSource } = parseArgs()
    const basePath = normalizeBasePath(process.env.NUXT_STORAGE_BASE_PATH)
    if (!basePath) {
        sharedLogger.error('未设置 NUXT_STORAGE_BASE_PATH，无环境前缀可迁移，退出')
        process.exit(1)
    }
    const mode = deleteSource ? 'delete-source' : execute ? 'execute' : 'dry-run'
    sharedLogger.info(`OSS 迁移启动 | 环境前缀=${basePath} | 模式=${mode}`)

    // ---- 建一次 OSS client，全程复用 ----
    const storageConfig = await getDefaultStorageConfigDao(StorageProviderType.ALIYUN_OSS)
    if (!storageConfig || !isAliyunOssConfig(storageConfig)) {
        sharedLogger.error('未找到阿里云 OSS 存储配置，退出')
        process.exit(1)
    }
    const { client } = (await createOssClient({
        accessKeyId: storageConfig.accessKeyId,
        accessKeySecret: storageConfig.accessKeySecret,
        bucket: storageConfig.bucket,
        region: storageConfig.region,
        customDomain: storageConfig.customDomain,
        sts: storageConfig.sts,
    })) as { client: OssClientLike }

    let cursor = 0
    let scanned = 0, hit = 0, done = 0, skipped = 0, failed = 0

    for (;;) {
        const rows = await prisma.ossFiles.findMany({
            where: { id: { gt: cursor } },
            orderBy: { id: 'asc' },
            take: BATCH_SIZE,
            select: { id: true, filePath: true },
        })
        if (rows.length === 0) break
        cursor = rows[rows.length - 1]!.id

        for (const row of rows) {
            scanned++
            const filePath = row.filePath

            if (deleteSource) {
                // 删源模式：filePath 已是带前缀的新路径，反推旧路径并删除
                if (!filePath || !filePath.startsWith(basePath)) continue
                const oldKey = filePath.slice(basePath.length)
                if (!oldKey) continue
                hit++
                try {
                    const oldSize = await getObjectSize(client, oldKey)
                    if (oldSize === null) { skipped++; continue }
                    const newSize = await getObjectSize(client, filePath)
                    if (newSize === null) {
                        sharedLogger.warn(`新对象不存在，保留源对象 id=${row.id} ${filePath}`)
                        skipped++
                        continue
                    }
                    await client.delete(oldKey)
                    done++
                    sharedLogger.info(`已删除源对象 id=${row.id} ${oldKey}`)
                } catch (err) {
                    failed++
                    sharedLogger.error(`删除源对象失败 id=${row.id} ${oldKey}:`, err)
                }
                continue
            }

            // 迁移模式（dry-run / execute）
            if (!needsMigration(filePath, basePath)) continue
            hit++
            const oldKey = filePath as string
            const newKey = prefixedKey(oldKey, basePath)
            try {
                const size = await getObjectSize(client, oldKey)
                if (size === null) {
                    sharedLogger.warn(`源对象不存在，跳过 id=${row.id} ${oldKey}`)
                    skipped++
                    continue
                }
                if (size > MAX_COPY_SIZE) {
                    sharedLogger.warn(`对象 >1GB 跳过（需 multipartUploadCopy）id=${row.id} ${oldKey}`)
                    skipped++
                    continue
                }
                if (!execute) {
                    sharedLogger.info(`[dry-run] 待迁移 id=${row.id}: ${oldKey} -> ${newKey}`)
                    continue
                }
                await client.copy(newKey, oldKey)
                await prisma.ossFiles.update({ where: { id: row.id }, data: { filePath: newKey } })
                done++
                sharedLogger.info(`已迁移 id=${row.id}: ${oldKey} -> ${newKey}`)
            } catch (err) {
                failed++
                sharedLogger.error(`迁移失败 id=${row.id} ${oldKey}:`, err)
            }
        }
    }

    sharedLogger.info(
        `迁移结束 | 模式=${mode} 扫描=${scanned} 命中=${hit} 完成=${done} 跳过=${skipped} 失败=${failed}`,
    )
    await prisma.$disconnect()
}

// 仅当作为脚本直接运行时执行 main（被测试 import 时不执行）
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
    main().catch((err) => {
        console.error('迁移脚本异常:', err)
        process.exit(1)
    })
}
