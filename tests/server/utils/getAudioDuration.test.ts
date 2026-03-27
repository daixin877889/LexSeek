/**
 * 音频时长获取工具测试
 *
 * 测试 server/utils/getAudioDuration.ts 中的音频时长获取功能
 *
 * **Feature: utilities**
 */

import { describe, it, expect, vi } from 'vitest'
import { getAudioDuration } from '../../../server/utils/getAudioDuration'

describe('getAudioDuration - 音频时长获取', () => {
    it('应抛出错误当 URL 无法访问', async () => {
        await expect(
            getAudioDuration('https://localhost:99999/nonexistent.mp3')
        ).rejects.toThrow()
    })

    it('应抛出错误当 URL 格式无效', async () => {
        await expect(
            getAudioDuration('not-a-valid-url')
        ).rejects.toThrow()
    })

    it('应抛出错误当 HTTP 状态码非 200', async () => {
        // 使用一个会返回 404 的 URL
        await expect(
            getAudioDuration('https://httpbin.org/status/404')
        ).rejects.toThrow()
    })

    it('URL 参数必须为非空字符串', async () => {
        await expect(getAudioDuration('')).rejects.toThrow()
    })

    it('非 HTTP URL 应抛出错误', async () => {
        await expect(
            getAudioDuration('ftp://example.com/audio.mp3')
        ).rejects.toThrow()
    })
})
