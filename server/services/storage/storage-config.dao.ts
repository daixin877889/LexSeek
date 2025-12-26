/**
 * 存储配置数据访问层
 *
 * 负责存储配置的增删改查操作
 */

import type { storageConfigs, Prisma } from '#shared/types/prisma'
import { StorageProviderType, type StorageConfig } from '~~/server/lib/storage/types'
import { StorageConfigError } from '~~/server/lib/storage/errors'
import crypto from 'crypto'

/** 加密算法 */
const ALGORITHM = 'aes-256-gcm'
/** IV 长度 */
const IV_LENGTH = 16
/** Auth Tag 长度 */
const AUTH_TAG_LENGTH = 16

/**
 * 获取加密密钥
 * 从环境变量获取，确保是 32 字节
 */
function getEncryptionKey(): Buffer {
    const config = useRuntimeConfig()
    // 优先从 runtimeConfig 获取，回退到环境变量
    const key = (config as any).storageConfigEncryptionKey
        || process.env.NUXT_STORAGE_CONFIG_ENCRYPTION_KEY
        || process.env.STORAGE_CONFIG_ENCRYPTION_KEY
    if (!key) {
        throw new StorageConfigError('缺少存储配置加密密钥环境变量 NUXT_STORAGE_CONFIG_ENCRYPTION_KEY')
    }
    // 使用 SHA-256 确保密钥长度为 32 字节
    return crypto.createHash('sha256').update(key).digest()
}

/**
 * 加密敏感配置
 */
function encryptConfig(config: Record<string, unknown>): string {
    const key = getEncryptionKey()
    const iv = crypto.randomBytes(IV_LENGTH)
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv)

    const jsonStr = JSON.stringify(config)
    let encrypted = cipher.update(jsonStr, 'utf8', 'hex')
    encrypted += cipher.final('hex')

    const authTag = cipher.getAuthTag()

    // 格式: iv:authTag:encrypted
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`
}

/**
 * 解密敏感配置
 */
function decryptConfig(encryptedStr: string): Record<string, unknown> {
    const key = getEncryptionKey()
    const parts = encryptedStr.split(':')

    if (parts.length !== 3) {
        throw new StorageConfigError('无效的加密配置格式')
    }

    const [ivHex, authTagHex, encrypted] = parts
    const iv = Buffer.from(ivHex, 'hex')
    const authTag = Buffer.from(authTagHex, 'hex')

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(authTag)

    let decrypted = decipher.update(encrypted, 'hex', 'utf8')
    decrypted += decipher.final('utf8')

    return JSON.parse(decrypted)
}

/**
 * 验证存储配置
 */
function validateStorageConfig(type: string, config: Record<string, unknown>): void {
    switch (type) {
        case StorageProviderType.ALIYUN_OSS:
            if (!config.accessKeyId || !config.accessKeySecret) {
                throw new StorageConfigError('阿里云 OSS 配置缺少 accessKeyId 或 accessKeySecret')
            }
            if (!config.bucket || !config.region) {
                throw new StorageConfigError('阿里云 OSS 配置缺少 bucket 或 region')
            }
            break
        case StorageProviderType.QINIU:
            if (!config.accessKey || !config.secretKey) {
                throw new StorageConfigError('七牛云配置缺少 accessKey 或 secretKey')
            }
            if (!config.bucket) {
                throw new StorageConfigError('七牛云配置缺少 bucket')
            }
            break
        case StorageProviderType.TENCENT_COS:
            if (!config.secretId || !config.secretKey) {
                throw new StorageConfigError('腾讯云 COS 配置缺少 secretId 或 secretKey')
            }
            if (!config.bucket || !config.region || !config.appId) {
                throw new StorageConfigError('腾讯云 COS 配置缺少 bucket、region 或 appId')
            }
            break
        default:
            throw new StorageConfigError(`不支持的存储类型: ${type}`)
    }
}

/**
 * 将数据库记录转换为 StorageConfig
 */
function toStorageConfig(record: storageConfigs): StorageConfig {
    const configData = typeof record.config === 'string'
        ? decryptConfig(record.config)
        : record.config as Record<string, unknown>

    return {
        id: record.id,
        type: record.type as StorageProviderType,
        name: record.name,
        bucket: configData.bucket as string,
        region: configData.region as string,
        customDomain: configData.customDomain as string | undefined,
        enabled: record.enabled,
        ...configData
    } as StorageConfig
}

/**
 * 创建存储配置
 */
export async function createStorageConfigDao(data: {
    userId?: number
    name: string
    type: string
    config: Record<string, unknown>
    isDefault?: boolean
    enabled?: boolean
}): Promise<storageConfigs> {
    // 验证配置
    validateStorageConfig(data.type, data.config)

    // 加密敏感配置
    const encryptedConfig = encryptConfig(data.config)

    // 如果设置为默认，先取消其他默认配置
    if (data.isDefault) {
        await prisma.storageConfigs.updateMany({
            where: {
                userId: data.userId ?? null,
                type: data.type,
                isDefault: true,
                deletedAt: null
            },
            data: { isDefault: false }
        })
    }

    return prisma.storageConfigs.create({
        data: {
            userId: data.userId,
            name: data.name,
            type: data.type,
            config: encryptedConfig,
            isDefault: data.isDefault ?? false,
            enabled: data.enabled ?? true
        }
    })
}

/**
 * 根据 ID 获取存储配置
 */
export async function getStorageConfigByIdDao(
    id: number,
    userId?: number
): Promise<StorageConfig | null> {
    const where: Prisma.storageConfigsWhereInput = {
        id,
        deletedAt: null
    }

    // 如果指定了用户 ID，只能获取自己的配置或系统配置
    if (userId !== undefined) {
        where.OR = [
            { userId },
            { userId: null }
        ]
    }

    const record = await prisma.storageConfigs.findFirst({ where })

    if (!record) {
        return null
    }

    return toStorageConfig(record)
}

/**
 * 获取用户的存储配置列表
 */
export async function getStorageConfigsDao(query: {
    userId?: number
    type?: string
    enabled?: boolean
    includeSystem?: boolean
}): Promise<StorageConfig[]> {
    const where: Prisma.storageConfigsWhereInput = {
        deletedAt: null
    }

    if (query.type) {
        where.type = query.type
    }

    if (query.enabled !== undefined) {
        where.enabled = query.enabled
    }

    // 构建用户过滤条件
    if (query.userId !== undefined) {
        if (query.includeSystem) {
            where.OR = [
                { userId: query.userId },
                { userId: null }
            ]
        } else {
            where.userId = query.userId
        }
    } else if (!query.includeSystem) {
        where.userId = null
    }

    const records = await prisma.storageConfigs.findMany({
        where,
        orderBy: [
            { isDefault: 'desc' },
            { createdAt: 'desc' }
        ]
    })

    return records.map(toStorageConfig)
}

/**
 * 获取默认存储配置
 * 优先从数据库获取，如果没有则从环境变量构建
 */
export async function getDefaultStorageConfigDao(
    type: string,
    userId?: number
): Promise<StorageConfig | null> {
    // 优先获取用户的默认配置
    if (userId !== undefined) {
        const userConfig = await prisma.storageConfigs.findFirst({
            where: {
                userId,
                type,
                isDefault: true,
                enabled: true,
                deletedAt: null
            }
        })

        if (userConfig) {
            return toStorageConfig(userConfig)
        }
    }

    // 回退到系统默认配置
    const systemConfig = await prisma.storageConfigs.findFirst({
        where: {
            userId: null,
            type,
            isDefault: true,
            enabled: true,
            deletedAt: null
        }
    })

    if (systemConfig) {
        return toStorageConfig(systemConfig)
    }

    // 如果数据库中没有配置，从环境变量构建默认配置
    return getDefaultConfigFromEnv(type)
}

/**
 * 从环境变量构建默认存储配置
 * 用于向后兼容，当数据库中没有配置时使用
 */
function getDefaultConfigFromEnv(type: string): StorageConfig | null {
    const config = useRuntimeConfig()
    const storageConfig = config.storage

    if (type === StorageProviderType.ALIYUN_OSS) {
        const ossConfig = storageConfig?.aliyunOss
        if (ossConfig?.accessKeyId && ossConfig?.accessKeySecret && ossConfig?.bucket && ossConfig?.region) {
            return {
                id: 0, // 环境变量配置使用 0 作为 ID
                type: StorageProviderType.ALIYUN_OSS,
                name: '系统默认配置',
                bucket: ossConfig.bucket,
                region: ossConfig.region,
                customDomain: ossConfig.customDomain || undefined,
                enabled: true,
                accessKeyId: ossConfig.accessKeyId,
                accessKeySecret: ossConfig.accessKeySecret,
                sts: ossConfig.sts?.roleArn ? {
                    roleArn: ossConfig.sts.roleArn,
                    roleSessionName: ossConfig.sts.roleSessionName,
                    durationSeconds: ossConfig.sts.durationSeconds
                } : undefined
            } as StorageConfig
        }
    }

    if (type === StorageProviderType.QINIU) {
        const qiniuConfig = storageConfig?.qiniu
        if (qiniuConfig?.accessKey && qiniuConfig?.secretKey && qiniuConfig?.bucket) {
            return {
                id: 0,
                type: StorageProviderType.QINIU,
                name: '系统默认配置',
                bucket: qiniuConfig.bucket,
                region: qiniuConfig.zone || 'z0',
                enabled: true,
                accessKey: qiniuConfig.accessKey,
                secretKey: qiniuConfig.secretKey,
                zone: qiniuConfig.zone as 'z0' | 'z1' | 'z2' | 'na0' | 'as0' | undefined
            } as StorageConfig
        }
    }

    if (type === StorageProviderType.TENCENT_COS) {
        const cosConfig = storageConfig?.tencentCos
        if (cosConfig?.secretId && cosConfig?.secretKey && cosConfig?.bucket && cosConfig?.region && cosConfig?.appId) {
            return {
                id: 0,
                type: StorageProviderType.TENCENT_COS,
                name: '系统默认配置',
                bucket: cosConfig.bucket,
                region: cosConfig.region,
                enabled: true,
                secretId: cosConfig.secretId,
                secretKey: cosConfig.secretKey,
                appId: cosConfig.appId
            } as StorageConfig
        }
    }

    return null
}

/**
 * 更新存储配置
 */
export async function updateStorageConfigDao(
    id: number,
    userId: number | undefined,
    data: {
        name?: string
        config?: Record<string, unknown>
        isDefault?: boolean
        enabled?: boolean
    }
): Promise<storageConfigs | null> {
    // 检查配置是否存在且属于该用户
    const existing = await prisma.storageConfigs.findFirst({
        where: {
            id,
            userId: userId ?? null,
            deletedAt: null
        }
    })

    if (!existing) {
        return null
    }

    const updateData: Prisma.storageConfigsUpdateInput = {}

    if (data.name !== undefined) {
        updateData.name = data.name
    }

    if (data.config !== undefined) {
        validateStorageConfig(existing.type, data.config)
        updateData.config = encryptConfig(data.config)
    }

    if (data.enabled !== undefined) {
        updateData.enabled = data.enabled
    }

    // 如果设置为默认，先取消其他默认配置
    if (data.isDefault === true) {
        await prisma.storageConfigs.updateMany({
            where: {
                userId: existing.userId,
                type: existing.type,
                isDefault: true,
                deletedAt: null,
                id: { not: id }
            },
            data: { isDefault: false }
        })
        updateData.isDefault = true
    } else if (data.isDefault === false) {
        updateData.isDefault = false
    }

    return prisma.storageConfigs.update({
        where: { id },
        data: updateData
    })
}

/**
 * 删除存储配置（软删除）
 */
export async function deleteStorageConfigDao(
    id: number,
    userId?: number
): Promise<boolean> {
    const where: Prisma.storageConfigsWhereInput = {
        id,
        deletedAt: null
    }

    // 只能删除自己的配置
    if (userId !== undefined) {
        where.userId = userId
    }

    const result = await prisma.storageConfigs.updateMany({
        where,
        data: { deletedAt: new Date() }
    })

    return result.count > 0
}

/**
 * 检查配置名称是否已存在
 */
export async function isConfigNameExistsDao(
    name: string,
    userId?: number,
    excludeId?: number
): Promise<boolean> {
    const where: Prisma.storageConfigsWhereInput = {
        name,
        userId: userId ?? null,
        deletedAt: null
    }

    if (excludeId) {
        where.id = { not: excludeId }
    }

    const count = await prisma.storageConfigs.count({ where })
    return count > 0
}
