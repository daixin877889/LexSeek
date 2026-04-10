/**
 * 音频时长获取工具补充覆盖率测试
 *
 * 使用 mock 覆盖正常路径和流关闭逻辑
 *
 * **Feature: utilities**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock music-metadata
vi.mock('music-metadata', () => ({
    parseWebStream: vi.fn(),
}))

describe('getAudioDuration 补充覆盖率', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.restoreAllMocks()
    })

    it('成功获取音频时长并关闭流', async () => {
        const { parseWebStream } = await import('music-metadata')
        const mockCancel = vi.fn().mockResolvedValue(undefined)
        const mockBody = {
            locked: false,
            cancel: mockCancel,
        }

        // Mock fetch
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            headers: new Headers({
                'content-type': 'audio/mpeg',
                'content-length': '1024000',
            }),
            body: mockBody,
        }))

        vi.mocked(parseWebStream).mockResolvedValue({
            format: { duration: 180.5 },
            common: {},
            native: {},
            quality: { warnings: [] },
        } as any)

        const { getAudioDuration } = await import('~~/server/utils/getAudioDuration')

        const duration = await getAudioDuration('https://example.com/audio.mp3')
        expect(duration).toBe(180.5)
        expect(mockCancel).toHaveBeenCalled()
    })

    it('无 content-length 头应正常处理', async () => {
        const { parseWebStream } = await import('music-metadata')
        const mockBody = {
            locked: false,
            cancel: vi.fn().mockResolvedValue(undefined),
        }

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            headers: new Headers({ 'content-type': 'audio/mpeg' }),
            body: mockBody,
        }))

        vi.mocked(parseWebStream).mockResolvedValue({
            format: { duration: 60.0 },
            common: {},
            native: {},
            quality: { warnings: [] },
        } as any)

        const { getAudioDuration } = await import('~~/server/utils/getAudioDuration')
        const duration = await getAudioDuration('https://example.com/audio.mp3')
        expect(duration).toBe(60.0)
    })

    it('parseWebStream 失败时关闭流并重新抛出', async () => {
        const { parseWebStream } = await import('music-metadata')
        const mockCancel = vi.fn().mockResolvedValue(undefined)
        const mockBody = {
            locked: false,
            cancel: mockCancel,
        }

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            headers: new Headers({ 'content-type': 'audio/mpeg' }),
            body: mockBody,
        }))

        vi.mocked(parseWebStream).mockRejectedValue(new Error('解析失败'))

        const { getAudioDuration } = await import('~~/server/utils/getAudioDuration')
        await expect(getAudioDuration('https://example.com/audio.mp3')).rejects.toThrow('解析失败')
        expect(mockCancel).toHaveBeenCalled()
    })

    it('body.locked 为 true 时不尝试关闭流', async () => {
        const { parseWebStream } = await import('music-metadata')
        const mockCancel = vi.fn()
        const mockBody = {
            locked: true,
            cancel: mockCancel,
        }

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            headers: new Headers({ 'content-type': 'audio/mpeg' }),
            body: mockBody,
        }))

        vi.mocked(parseWebStream).mockResolvedValue({
            format: { duration: 90.0 },
            common: {},
            native: {},
            quality: { warnings: [] },
        } as any)

        const { getAudioDuration } = await import('~~/server/utils/getAudioDuration')
        const duration = await getAudioDuration('https://example.com/audio.mp3')
        expect(duration).toBe(90.0)
        expect(mockCancel).not.toHaveBeenCalled()
    })

    it('无 duration 返回 undefined', async () => {
        const { parseWebStream } = await import('music-metadata')
        const mockBody = {
            locked: false,
            cancel: vi.fn().mockResolvedValue(undefined),
        }

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            headers: new Headers({ 'content-type': 'audio/mpeg' }),
            body: mockBody,
        }))

        vi.mocked(parseWebStream).mockResolvedValue({
            format: {},
            common: {},
            native: {},
            quality: { warnings: [] },
        } as any)

        const { getAudioDuration } = await import('~~/server/utils/getAudioDuration')
        const duration = await getAudioDuration('https://example.com/audio.mp3')
        expect(duration).toBeUndefined()
    })
})
