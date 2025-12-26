/**
 * 统一回调处理器
 *
 * 根据存储类型分发到对应的回调验证器
 */

import type { H3Event } from 'h3'
import type { StorageConfig } from '../types'
import { StorageProviderType } from '../types'
import type { CallbackData, CallbackVerifyResult, CallbackHandler } from './types'
import { AliyunCallbackValidator } from './validators/aliyun'
import { StorageConfigError } from '../errors'

/** 回调处理器注册表 */
const handlers: Map<StorageProviderType, CallbackHandler> = new Map()

// 注册阿里云回调处理器
handlers.set(StorageProviderType.ALIYUN_OSS, new AliyunCallbackValidator())

/**
 * 获取回调处理器
 */
function getHandler(type: StorageProviderType): CallbackHandler {
    const handler = handlers.get(type)
    if (!handler) {
        throw new StorageConfigError(`不支持的存储类型回调: ${type}`)
    }
    return handler
}

/**
 * 验证回调请求
 */
export async function verifyCallback(
    event: H3Event,
    config: StorageConfig
): Promise<CallbackVerifyResult> {
    const handler = getHandler(config.type)
    return handler.verify(event, config)
}

/**
 * 解析回调数据
 */
export async function parseCallback(
    event: H3Event,
    type: StorageProviderType
): Promise<CallbackData> {
    const handler = getHandler(type)
    return handler.parse(event)
}

/**
 * 注册自定义回调处理器
 */
export function registerCallbackHandler(
    type: StorageProviderType,
    handler: CallbackHandler
): void {
    handlers.set(type, handler)
}
