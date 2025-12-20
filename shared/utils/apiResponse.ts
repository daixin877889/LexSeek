/**
 * API响应工具类
 */

import { uuidv7 } from './uuid'

/**
 * API基础响应接口
 *
 * 定义API响应的基本结构，包括成功标志、业务码、消息、时间戳和可选的数据字段。
 */
export type ApiBaseResponse = {
    requestId: string;
    success: boolean;
    code: number;
    message: string;
    timestamp: number;
    data?: any;
}

import type { H3Event } from 'h3'
/**
 * 成功响应
 * @param event 事件对象
 * @param message 消息
 * @param data 数据
 * @returns 成功响应
 */
export const resSuccess = (event: H3Event, message: string, data: any): ApiBaseResponse => {
    return {
        requestId: event.context.requestId || uuidv7(),
        success: true,
        code: 0,
        message: message || '操作成功',
        timestamp: Date.now(),
        data: data,
    }
}

/**
 * 失败响应
 * @param event 事件对象
 * @param code 业务码
 * @param message 消息
 * @returns 失败响应
 */
export const resError = (event: H3Event, code: number, message: string): ApiBaseResponse => {
    return {
        requestId: event.context.requestId || uuidv7(),
        success: false,
        code: code,
        message: message,
        timestamp: Date.now(),
        data: null,
    }
}