/**
 * 回调处理器类型定义
 */

import type { H3Event } from 'h3'
import type { StorageConfig } from '../types'

/**
 * 统一回调数据结构
 */
export interface CallbackData {
    /** 文件路径 */
    filePath: string
    /** 文件大小（字节） */
    fileSize: number
    /** MIME 类型 */
    mimeType: string
    /** 自定义变量 */
    customVars: Record<string, string>
    /** 原始回调数据 */
    rawData: unknown
}

/**
 * 回调验证结果
 */
export interface CallbackVerifyResult {
    /** 是否验证通过 */
    valid: boolean
    /** 错误信息（验证失败时） */
    error?: string
}

/**
 * 回调处理器接口
 */
export interface CallbackHandler {
    /**
     * 验证回调请求
     * @param event H3 事件对象
     * @param config 存储配置
     * @returns 验证结果
     */
    verify(event: H3Event, config: StorageConfig): Promise<CallbackVerifyResult>

    /**
     * 解析回调数据
     * @param event H3 事件对象
     * @returns 统一的回调数据
     */
    parse(event: H3Event): Promise<CallbackData>
}

/**
 * 阿里云 OSS 回调请求头
 */
export interface AliyunCallbackHeaders {
    /** 授权信息 */
    authorization: string
    /** 公钥 URL（Base64 编码） */
    'x-oss-pub-key-url': string
    /** 请求 URI */
    'x-oss-request-id'?: string
}

/**
 * 阿里云 OSS 回调请求体
 */
export interface AliyunCallbackBody {
    /** 文件名（完整路径） */
    filename: string
    /** 文件大小 */
    size: string | number
    /** MIME 类型 */
    mimeType: string
    /** 其他自定义变量 */
    [key: string]: string | number | undefined
}
