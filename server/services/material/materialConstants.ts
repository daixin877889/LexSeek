/**
 * 材料识别服务共享常量和工具函数
 *
 * 用于 OCR、ASR、MinerU 识别服务的公共配置和工具
 */

/** 轮询配置接口 */
export interface PollingConfig {
    initialDelay: number
    backoffFactor: number
    maxDelay: number
    maxRetries: number
}

/** 默认轮询配置 */
export const DEFAULT_POLLING_CONFIG: PollingConfig = {
    initialDelay: 1000,
    backoffFactor: 1.5,
    maxDelay: 30000,
    maxRetries: 50,
}

/**
 * 计算退避延迟
 * @param retryCount 重试次数
 * @param config 轮询配置
 */
export function calculateBackoffDelay(
    retryCount: number,
    config: PollingConfig = DEFAULT_POLLING_CONFIG
): number {
    const delay = config.initialDelay * Math.pow(config.backoffFactor, retryCount)
    return Math.min(delay, config.maxDelay)
}

/**
 * 已存在任务的任务 ID 标记
 * 用于标识文件已被处理，无需重新提交任务
 */
export const EXISTING_TASK_ID = 'existing'
