/**
 * 存储适配器工厂
 *
 * 负责创建和缓存适配器实例
 */

import type { StorageAdapter, StorageConfig, StorageProviderType } from './types'
import { StorageConfigError } from './errors'
import { AliyunOssAdapter } from './adapters/aliyun-oss'
import { QiniuAdapter } from './adapters/qiniu'
import { TencentCosAdapter } from './adapters/tencent-cos'
import { isAliyunOssConfig, isQiniuConfig, isTencentCosConfig } from './types'

/** 适配器构造函数类型 */
type AdapterConstructor = new (config: StorageConfig) => StorageAdapter

/**
 * 存储适配器工厂
 * 使用单例模式管理适配器实例
 */
export class StorageFactory {
    /** 适配器实例缓存，key 为配置的唯一标识 */
    private static adapters: Map<string, StorageAdapter> = new Map()

    /** 自定义适配器注册表 */
    private static customAdapters: Map<StorageProviderType, AdapterConstructor> = new Map()

    /**
     * 生成配置的唯一标识
     * 用于缓存适配器实例
     */
    private static generateConfigKey(config: StorageConfig): string {
        // 使用配置 ID 或配置内容的哈希作为 key
        if (config.id) {
            return `${config.type}:${config.id}`
        }
        // 没有 ID 时，使用配置内容生成 key
        return `${config.type}:${config.bucket}:${config.region}`
    }

    /**
     * 获取适配器实例
     * 如果缓存中存在则返回缓存的实例，否则创建新实例
     *
     * @param config 存储配置
     * @returns 适配器实例
     * @throws StorageConfigError 配置无效时抛出
     */
    static getAdapter(config: StorageConfig): StorageAdapter {
        const key = this.generateConfigKey(config)

        // 检查缓存
        const cached = this.adapters.get(key)
        if (cached) {
            return cached
        }

        // 创建新适配器
        const adapter = this.createAdapter(config)
        this.adapters.set(key, adapter)

        return adapter
    }

    /**
     * 创建适配器实例
     *
     * @param config 存储配置
     * @returns 适配器实例
     * @throws StorageConfigError 不支持的配置类型时抛出
     */
    private static createAdapter(config: StorageConfig): StorageAdapter {
        // 检查是否有自定义适配器
        const customConstructor = this.customAdapters.get(config.type)
        if (customConstructor) {
            return new customConstructor(config)
        }

        // 使用内置适配器
        if (isAliyunOssConfig(config)) {
            return new AliyunOssAdapter(config)
        }

        if (isQiniuConfig(config)) {
            return new QiniuAdapter(config)
        }

        if (isTencentCosConfig(config)) {
            return new TencentCosAdapter(config)
        }

        throw new StorageConfigError(`不支持的存储类型: ${(config as StorageConfig).type}`)
    }

    /**
     * 注册自定义适配器
     * 允许扩展支持其他存储服务商
     *
     * @param type 适配器类型
     * @param constructor 适配器构造函数
     */
    static registerAdapter(type: StorageProviderType, constructor: AdapterConstructor): void {
        this.customAdapters.set(type, constructor)
    }

    /**
     * 取消注册自定义适配器
     *
     * @param type 适配器类型
     */
    static unregisterAdapter(type: StorageProviderType): void {
        this.customAdapters.delete(type)
    }

    /**
     * 清除适配器缓存
     *
     * @param configKey 配置标识（可选，不传则清除所有）
     */
    static clearCache(configKey?: string): void {
        if (configKey) {
            this.adapters.delete(configKey)
        } else {
            this.adapters.clear()
        }
    }

    /**
     * 根据配置 ID 清除缓存
     *
     * @param configId 配置 ID
     */
    static clearCacheByConfigId(configId: number): void {
        // 遍历所有缓存，删除匹配的项
        // 缓存 key 格式: type:configId 或 type:bucket:region
        for (const [key] of this.adapters) {
            // 检查 key 是否包含配置 ID（格式为 type:id）
            const parts = key.split(':')
            if (parts.length >= 2 && parts[1] === String(configId)) {
                this.adapters.delete(key)
            }
        }
    }

    /**
     * 获取缓存的适配器数量
     * 主要用于测试
     */
    static getCacheSize(): number {
        return this.adapters.size
    }

    /**
     * 检查配置是否已缓存
     *
     * @param config 存储配置
     */
    static isCached(config: StorageConfig): boolean {
        const key = this.generateConfigKey(config)
        return this.adapters.has(key)
    }
}
