import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
    validateAudioType,
    simplifyAsrResultService,
    SUPPORTED_AUDIO_TYPES,
} from '~~/server/services/material/asr.service'

describe('ASR 服务 - 工具函数', () => {
    // ==================== SUPPORTED_AUDIO_TYPES ====================
    describe('SUPPORTED_AUDIO_TYPES', () => {
        it('应包含所有预期的音频 MIME 类型', () => {
            const expectedTypes = [
                'audio/mpeg',
                'audio/mp3',
                'audio/wav',
                'audio/x-wav',
                'audio/wave',
                'audio/ogg',
                'audio/flac',
                'audio/x-flac',
                'audio/aac',
                'audio/mp4',
                'audio/x-m4a',
                'audio/webm',
                'audio/amr',
                'audio/opus',
            ]

            for (const type of expectedTypes) {
                expect(SUPPORTED_AUDIO_TYPES).toContain(type)
            }
        })

        it('应为不可变数组（数组引用不变）', () => {
            expect(Array.isArray(SUPPORTED_AUDIO_TYPES)).toBe(true)
            expect(SUPPORTED_AUDIO_TYPES.length).toBe(14)
        })
    })

    // ==================== validateAudioType ====================
    describe('validateAudioType', () => {
        describe('支持的音频类型', () => {
            const supportedTypes = [
                { type: 'audio/mpeg', label: 'MP3 (mpeg)' },
                { type: 'audio/mp3', label: 'MP3' },
                { type: 'audio/wav', label: 'WAV' },
                { type: 'audio/x-wav', label: 'WAV (x-wav)' },
                { type: 'audio/wave', label: 'WAV (wave)' },
                { type: 'audio/ogg', label: 'OGG' },
                { type: 'audio/flac', label: 'FLAC' },
                { type: 'audio/x-flac', label: 'FLAC (x-flac)' },
                { type: 'audio/aac', label: 'AAC' },
                { type: 'audio/mp4', label: 'M4A (mp4)' },
                { type: 'audio/x-m4a', label: 'M4A' },
                { type: 'audio/webm', label: 'WebM' },
                { type: 'audio/amr', label: 'AMR' },
                { type: 'audio/opus', label: 'Opus' },
            ]

            for (const { type, label } of supportedTypes) {
                it(`应接受 ${label} 类型 (${type})`, () => {
                    expect(validateAudioType(type)).toBe(true)
                })
            }
        })

        describe('大小写不敏感', () => {
            it('应接受大写 MIME 类型', () => {
                expect(validateAudioType('AUDIO/MPEG')).toBe(true)
            })

            it('应接受混合大小写 MIME 类型', () => {
                expect(validateAudioType('Audio/Wav')).toBe(true)
            })

            it('应接受大写 AUDIO/MP3', () => {
                expect(validateAudioType('AUDIO/MP3')).toBe(true)
            })

            it('应接受 Audio/FLAC', () => {
                expect(validateAudioType('Audio/FLAC')).toBe(true)
            })
        })

        describe('不支持的类型', () => {
            it('应拒绝视频类型', () => {
                expect(validateAudioType('video/mp4')).toBe(false)
            })

            it('应拒绝图片类型', () => {
                expect(validateAudioType('image/png')).toBe(false)
            })

            it('应拒绝文本类型', () => {
                expect(validateAudioType('text/plain')).toBe(false)
            })

            it('应拒绝 application/octet-stream', () => {
                expect(validateAudioType('application/octet-stream')).toBe(false)
            })

            it('应拒绝空字符串', () => {
                expect(validateAudioType('')).toBe(false)
            })

            it('应拒绝不存在的音频子类型', () => {
                expect(validateAudioType('audio/midi')).toBe(false)
            })

            it('应拒绝格式不正确的 MIME 类型', () => {
                expect(validateAudioType('mp3')).toBe(false)
                expect(validateAudioType('audio')).toBe(false)
            })
        })
    })

    // ==================== simplifyAsrResultService ====================
    describe('simplifyAsrResultService', () => {
        describe('空/无效输入处理', () => {
            it('输入 null 时应返回空结构', () => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const result = simplifyAsrResultService(null as any)
                expect(result).toEqual({
                    file_url: '',
                    properties: {},
                    transcripts: [],
                })
            })

            it('输入 undefined 时应返回空结构', () => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const result = simplifyAsrResultService(undefined as any)
                expect(result).toEqual({
                    file_url: '',
                    properties: {},
                    transcripts: [],
                })
            })
        })

        describe('正常输入处理', () => {
            it('应保留 file_url 和 properties', () => {
                const rawResult = {
                    file_url: 'https://example.com/audio.mp3',
                    properties: {
                        audio_format: 'mp3',
                        original_sampling_rate: 44100,
                        original_duration_in_milliseconds: 60000,
                    },
                    transcripts: [],
                }

                const result = simplifyAsrResultService(rawResult)

                expect(result.file_url).toBe('https://example.com/audio.mp3')
                expect(result.properties).toEqual({
                    audio_format: 'mp3',
                    original_sampling_rate: 44100,
                    original_duration_in_milliseconds: 60000,
                })
            })

            it('应从句子中移除 words 字段', () => {
                const rawResult = {
                    file_url: 'https://example.com/audio.mp3',
                    properties: {},
                    transcripts: [
                        {
                            channel_id: 0,
                            content_duration_in_milliseconds: 5000,
                            sentences: [
                                {
                                    begin_time: 0,
                                    end_time: 2000,
                                    text: '你好世界',
                                    sentence_id: 0,
                                    speaker_id: 0,
                                    words: [
                                        { begin_time: 0, end_time: 1000, text: '你好' },
                                        { begin_time: 1000, end_time: 2000, text: '世界' },
                                    ],
                                },
                            ],
                        },
                    ],
                }

                const result = simplifyAsrResultService(rawResult)
                const sentence = result.transcripts[0]!.sentences[0]!

                // 应只包含 5 个必要字段
                expect(sentence).toEqual({
                    begin_time: 0,
                    end_time: 2000,
                    text: '你好世界',
                    sentence_id: 0,
                    speaker_id: 0,
                })
                // 确认 words 已被移除
                expect(sentence).not.toHaveProperty('words')
            })

            it('应正确处理多个通道和多个句子', () => {
                const rawResult = {
                    file_url: 'https://example.com/audio.mp3',
                    properties: { audio_format: 'wav' },
                    transcripts: [
                        {
                            channel_id: 0,
                            content_duration_in_milliseconds: 10000,
                            sentences: [
                                {
                                    begin_time: 0,
                                    end_time: 3000,
                                    text: '第一句话',
                                    sentence_id: 0,
                                    speaker_id: 0,
                                    words: [{ begin_time: 0, end_time: 3000, text: '第一句话' }],
                                },
                                {
                                    begin_time: 3000,
                                    end_time: 7000,
                                    text: '第二句话',
                                    sentence_id: 1,
                                    speaker_id: 1,
                                    words: [{ begin_time: 3000, end_time: 7000, text: '第二句话' }],
                                },
                            ],
                        },
                        {
                            channel_id: 1,
                            content_duration_in_milliseconds: 5000,
                            sentences: [
                                {
                                    begin_time: 0,
                                    end_time: 5000,
                                    text: '通道二的句子',
                                    sentence_id: 2,
                                    speaker_id: 2,
                                    words: [],
                                },
                            ],
                        },
                    ],
                }

                const result = simplifyAsrResultService(rawResult)

                expect(result.transcripts).toHaveLength(2)
                expect(result.transcripts[0]!.channel_id).toBe(0)
                expect(result.transcripts[0]!.sentences).toHaveLength(2)
                expect(result.transcripts[1]!.channel_id).toBe(1)
                expect(result.transcripts[1]!.sentences).toHaveLength(1)

                // 验证所有句子都没有 words 字段
                for (const transcript of result.transcripts) {
                    for (const sentence of transcript.sentences) {
                        expect(sentence).not.toHaveProperty('words')
                    }
                }
            })

            it('应保留句子的所有必要字段', () => {
                const rawResult = {
                    file_url: 'https://example.com/test.wav',
                    properties: {},
                    transcripts: [
                        {
                            channel_id: 0,
                            content_duration_in_milliseconds: 8000,
                            sentences: [
                                {
                                    begin_time: 1500,
                                    end_time: 4200,
                                    text: '测试文本内容',
                                    sentence_id: 42,
                                    speaker_id: 3,
                                    words: [{ text: '测试' }, { text: '文本' }, { text: '内容' }],
                                    confidence: 0.95,   // 额外字段，应被移除
                                    language: 'zh',     // 额外字段，应被移除
                                },
                            ],
                        },
                    ],
                }

                const result = simplifyAsrResultService(rawResult)
                const sentence = result.transcripts[0]!.sentences[0]!

                expect(sentence.begin_time).toBe(1500)
                expect(sentence.end_time).toBe(4200)
                expect(sentence.text).toBe('测试文本内容')
                expect(sentence.sentence_id).toBe(42)
                expect(sentence.speaker_id).toBe(3)
                // 验证额外字段已被移除
                expect(sentence).not.toHaveProperty('confidence')
                expect(sentence).not.toHaveProperty('language')
                expect(Object.keys(sentence)).toHaveLength(5)
            })

            it('应保留通道级别的 channel_id 和 content_duration_in_milliseconds', () => {
                const rawResult = {
                    file_url: '',
                    properties: {},
                    transcripts: [
                        {
                            channel_id: 7,
                            content_duration_in_milliseconds: 123456,
                            sentences: [],
                        },
                    ],
                }

                const result = simplifyAsrResultService(rawResult)

                expect(result.transcripts[0]!.channel_id).toBe(7)
                expect(result.transcripts[0]!.content_duration_in_milliseconds).toBe(123456)
            })
        })

        describe('边界情况', () => {
            it('transcripts 为空数组时应返回空 transcripts', () => {
                const rawResult = {
                    file_url: 'https://example.com/empty.mp3',
                    properties: { audio_format: 'mp3' },
                    transcripts: [],
                }

                const result = simplifyAsrResultService(rawResult)

                expect(result.transcripts).toEqual([])
                expect(result.file_url).toBe('https://example.com/empty.mp3')
            })

            it('sentences 为空数组时应返回空 sentences', () => {
                const rawResult = {
                    file_url: '',
                    properties: {},
                    transcripts: [
                        {
                            channel_id: 0,
                            content_duration_in_milliseconds: 0,
                            sentences: [],
                        },
                    ],
                }

                const result = simplifyAsrResultService(rawResult)

                expect(result.transcripts).toHaveLength(1)
                expect(result.transcripts[0]!.sentences).toEqual([])
            })

            it('file_url 缺失时应默认为空字符串', () => {
                const rawResult = {
                    properties: {},
                    transcripts: [],
                } as any

                const result = simplifyAsrResultService(rawResult)

                expect(result.file_url).toBe('')
            })

            it('properties 缺失时应默认为空对象', () => {
                const rawResult = {
                    file_url: 'https://example.com/audio.mp3',
                    transcripts: [],
                } as any

                const result = simplifyAsrResultService(rawResult)

                expect(result.properties).toEqual({})
            })

            it('transcripts 缺失时应默认为空数组', () => {
                const rawResult = {
                    file_url: 'https://example.com/audio.mp3',
                    properties: {},
                } as any

                const result = simplifyAsrResultService(rawResult)

                expect(result.transcripts).toEqual([])
            })

            it('句子的 sentences 缺失时应默认为空数组', () => {
                const rawResult = {
                    file_url: '',
                    properties: {},
                    transcripts: [
                        {
                            channel_id: 0,
                            content_duration_in_milliseconds: 0,
                        },
                    ],
                } as any

                const result = simplifyAsrResultService(rawResult)

                expect(result.transcripts[0]!.sentences).toEqual([])
            })

            it('精简后的结果不应与原始对象共享引用', () => {
                const rawSentence = {
                    begin_time: 0,
                    end_time: 1000,
                    text: '测试',
                    sentence_id: 0,
                    speaker_id: 0,
                    words: [{ text: '测试' }],
                }
                const rawResult = {
                    file_url: 'https://example.com/audio.mp3',
                    properties: { audio_format: 'mp3' },
                    transcripts: [
                        {
                            channel_id: 0,
                            content_duration_in_milliseconds: 1000,
                            sentences: [rawSentence],
                        },
                    ],
                }

                const result = simplifyAsrResultService(rawResult)

                // 精简后的句子应该是新对象，没有 words 字段
                expect(result.transcripts[0]!.sentences[0]).not.toBe(rawSentence)
                expect(result.transcripts[0]!.sentences[0]).not.toHaveProperty('words')
                // 原始对象不应被修改
                expect(rawSentence.words).toEqual([{ text: '测试' }])
            })
        })

        describe('数据精简效果验证', () => {
            it('精简后的 JSON 体积应小于原始结果', () => {
                const rawResult = {
                    file_url: 'https://example.com/audio.mp3',
                    properties: { audio_format: 'mp3', original_duration_in_milliseconds: 120000 },
                    transcripts: [
                        {
                            channel_id: 0,
                            content_duration_in_milliseconds: 120000,
                            sentences: Array.from({ length: 50 }, (_, i) => ({
                                begin_time: i * 2000,
                                end_time: (i + 1) * 2000,
                                text: `这是第 ${i + 1} 句话的内容`,
                                sentence_id: i,
                                speaker_id: i % 3,
                                words: Array.from({ length: 10 }, (_, j) => ({
                                    begin_time: i * 2000 + j * 200,
                                    end_time: i * 2000 + (j + 1) * 200,
                                    text: `词${j}`,
                                    word: `词${j}`,
                                    punctuation: j === 9 ? '。' : '',
                                })),
                            })),
                        },
                    ],
                }

                const simplified = simplifyAsrResultService(rawResult)

                const rawSize = JSON.stringify(rawResult).length
                const simplifiedSize = JSON.stringify(simplified).length

                expect(simplifiedSize).toBeLessThan(rawSize)
            })
        })
    })
})

// ==================== 服务层函数测试 ====================

// 模拟全局自动导入
const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
}
;(globalThis as any).logger = mockLogger

;(globalThis as any).prisma = {
    ossFiles: {
        findFirst: vi.fn(),
        create: vi.fn().mockResolvedValue({ id: 100 }),
    },
}

;(globalThis as any).useRuntimeConfig = vi.fn().mockReturnValue({
    storage: {
        aliyunOss: {
            bucket: 'test-bucket',
        },
    },
})

// 模拟全局枚举（Nuxt 自动导入）
;(globalThis as any).AsrRecordStatus = {
    PENDING: 0,
    PROCESSING: 1,
    SUCCESS: 2,
    FAILED: 3,
}
;(globalThis as any).AsrTaskStatus = {
    PENDING: 0,
    PROCESSING: 1,
    SUCCESS: 2,
    FAILED: 3,
    SUPERSEDED: 4,
}

// 模拟所有外部依赖
vi.mock('~~/server/services/material/asrTask.service', () => ({
    createAsrTaskService: vi.fn(),
    updateAsrTaskService: vi.fn(),
    getAsrTaskByTaskIdService: vi.fn(),
    getPendingAsrTasksService: vi.fn().mockResolvedValue([]),
    isAsrTaskProcessedService: vi.fn().mockResolvedValue(false),
}))

vi.mock('~~/server/services/material/asr.dao', () => ({
    createAsrRecordDao: vi.fn(),
    findAsrRecordByOssFileIdDao: vi.fn(),
    findAsrRecordByIdDao: vi.fn(),
    findAsrRecordsByOssFileIdsDao: vi.fn().mockResolvedValue([]),
    findAsrRecordsByTaskIdDao: vi.fn().mockResolvedValue([]),
    updateAsrRecordDao: vi.fn(),
    updateAsrRecordsByTaskIdDao: vi.fn(),
}))

vi.mock('~~/server/services/storage/storage.service', () => ({
    generateSignedUrlService: vi.fn().mockResolvedValue('https://example.com/signed-audio.mp3'),
    uploadFileService: vi.fn().mockResolvedValue({ etag: 'test-etag' }),
    deleteFileService: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('~~/server/services/point/pointConsumption.service', () => ({
    checkPointsService: vi.fn(),
    consumePointsService: vi.fn().mockResolvedValue(undefined),
    preDeductPointsService: vi.fn(),
    settlePointsService: vi.fn().mockResolvedValue(undefined),
    rollbackPreDeductService: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('~~/server/services/node/node.service', () => ({
    getValidNodeConfig: vi.fn(),
    getNodeConfigService: vi.fn(),
}))

vi.mock('~~/server/services/material/materialEmbedding.service', () => ({
    embedAudioService: vi.fn().mockResolvedValue({
        ids: ['vec-1', 'vec-2'],
        lastEmbeddingAt: new Date().toISOString(),
        chunkCount: 2,
    }),
    formatAsrResultForEmbedding: vi.fn().mockReturnValue('格式化的文本'),
}))

vi.mock('~~/server/services/material/materialConstants', () => ({
    calculateBackoffDelay: vi.fn().mockReturnValue(100),
    DEFAULT_POLLING_CONFIG: {
        initialDelay: 100,
        backoffFactor: 1.5,
        maxDelay: 1000,
        maxRetries: 3,
    },
}))

vi.mock('ofetch', () => ({
    $fetch: vi.fn(),
}))

vi.mock('uuid', () => ({
    v7: vi.fn().mockReturnValue('mock-uuid-v7'),
}))

// getAudioDuration 是 Nuxt 自动导入的全局函数
;(globalThis as any).getAudioDuration = vi.fn()

describe('ASR 服务 - 服务层函数', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    // ==================== submitAsrTaskService ====================
    describe('submitAsrTaskService', () => {
        it('节点配置获取失败时应返回错误', async () => {
            const { getValidNodeConfig } = await import('~~/server/services/node/node.service')
            vi.mocked(getValidNodeConfig).mockRejectedValue(new Error('ASR 节点未配置'))

            const { submitAsrTaskService } = await import('~~/server/services/material/asr.service')
            const result = await submitAsrTaskService(1, 1)

            expect(result.success).toBe(false)
            expect(result.error).toContain('ASR 节点未配置')
        })

        it('OSS 文件不存在时应返回错误', async () => {
            const { getValidNodeConfig } = await import('~~/server/services/node/node.service')
            vi.mocked(getValidNodeConfig).mockResolvedValue({
                modelApiKeys: [{ apiKey: 'test-key' }],
                modelName: 'paraformer-v2',
                modelProviderBaseUrl: 'https://dashscope.aliyuncs.com/api/v1',
                modelSdkType: 'openai',
                name: 'audioRecognition',
                prompts: [],
            } as any)

            ;(globalThis as any).prisma.ossFiles.findFirst = vi.fn().mockResolvedValue(null)

            const { submitAsrTaskService } = await import('~~/server/services/material/asr.service')
            const result = await submitAsrTaskService(999, 1)

            expect(result.success).toBe(false)
            expect(result.error).toBe('文件不存在')
        })

        it('不支持的音频类型应返回错误', async () => {
            const { getValidNodeConfig } = await import('~~/server/services/node/node.service')
            vi.mocked(getValidNodeConfig).mockResolvedValue({
                modelApiKeys: [{ apiKey: 'test-key' }],
                modelName: 'paraformer-v2',
                modelProviderBaseUrl: 'https://dashscope.aliyuncs.com/api/v1',
                modelSdkType: 'openai',
                name: 'audioRecognition',
                prompts: [],
            } as any)

            ;(globalThis as any).prisma.ossFiles.findFirst = vi.fn().mockResolvedValue({
                id: 1,
                filePath: 'audio/test.txt',
                fileType: 'text/plain',
            })

            const { findAsrRecordByOssFileIdDao } = await import('~~/server/services/material/asr.dao')
            vi.mocked(findAsrRecordByOssFileIdDao).mockResolvedValue(null)

            const { submitAsrTaskService } = await import('~~/server/services/material/asr.service')
            const result = await submitAsrTaskService(1, 1)

            expect(result.success).toBe(false)
            expect(result.error).toContain('不支持')
        })

        it('已有成功识别记录时应直接返回成功', async () => {
            const { getValidNodeConfig } = await import('~~/server/services/node/node.service')
            vi.mocked(getValidNodeConfig).mockResolvedValue({
                modelApiKeys: [{ apiKey: 'test-key' }],
                modelName: 'paraformer-v2',
                modelProviderBaseUrl: 'https://dashscope.aliyuncs.com/api/v1',
                modelSdkType: 'openai',
                name: 'audioRecognition',
                prompts: [],
            } as any)

            ;(globalThis as any).prisma.ossFiles.findFirst = vi.fn().mockResolvedValue({
                id: 1,
                filePath: 'audio/test.mp3',
                fileType: 'audio/mp3',
            })

            const { findAsrRecordByOssFileIdDao } = await import('~~/server/services/material/asr.dao')
            vi.mocked(findAsrRecordByOssFileIdDao).mockResolvedValue({
                id: 10,
                status: 2, // AsrRecordStatus.SUCCESS
                asrTasksId: 5,
            } as any)

            const { submitAsrTaskService } = await import('~~/server/services/material/asr.service')
            const result = await submitAsrTaskService(1, 1)

            expect(result.success).toBe(true)
            expect(result.task?.taskId).toBe('existing')
        })

        it('积分预扣失败时应返回错误', async () => {
            const { getValidNodeConfig } = await import('~~/server/services/node/node.service')
            vi.mocked(getValidNodeConfig).mockResolvedValue({
                modelApiKeys: [{ apiKey: 'test-key' }],
                modelName: 'paraformer-v2',
                modelProviderBaseUrl: 'https://dashscope.aliyuncs.com/api/v1',
                modelSdkType: 'openai',
                name: 'audioRecognition',
                prompts: [],
            } as any)

            ;(globalThis as any).prisma.ossFiles.findFirst = vi.fn().mockResolvedValue({
                id: 1,
                filePath: 'audio/test.mp3',
                fileType: 'audio/mp3',
            })

            const { findAsrRecordByOssFileIdDao } = await import('~~/server/services/material/asr.dao')
            vi.mocked(findAsrRecordByOssFileIdDao).mockResolvedValue(null)

            ;(globalThis as any).getAudioDuration = vi.fn().mockResolvedValue(120) // 2 分钟

            const { preDeductPointsService } = await import('~~/server/services/point/pointConsumption.service')
            vi.mocked(preDeductPointsService).mockRejectedValue(new Error('积分不足'))

            const { submitAsrTaskService } = await import('~~/server/services/material/asr.service')
            const result = await submitAsrTaskService(1, 1)

            expect(result.success).toBe(false)
            expect(result.error).toContain('积分不足')
        })

        it('成功提交任务时应返回任务记录', async () => {
            const { getValidNodeConfig } = await import('~~/server/services/node/node.service')
            vi.mocked(getValidNodeConfig).mockResolvedValue({
                modelApiKeys: [{ apiKey: 'test-key' }],
                modelName: 'paraformer-v2',
                modelProviderBaseUrl: 'https://dashscope.aliyuncs.com/api/v1',
                modelSdkType: 'openai',
                name: 'audioRecognition',
                prompts: [],
            } as any)

            ;(globalThis as any).prisma.ossFiles.findFirst = vi.fn().mockResolvedValue({
                id: 1,
                filePath: 'audio/test.mp3',
                fileType: 'audio/mp3',
            })

            const { findAsrRecordByOssFileIdDao } = await import('~~/server/services/material/asr.dao')
            vi.mocked(findAsrRecordByOssFileIdDao).mockResolvedValue(null)

            ;(globalThis as any).getAudioDuration = vi.fn().mockResolvedValue(120)

            const { preDeductPointsService } = await import('~~/server/services/point/pointConsumption.service')
            vi.mocked(preDeductPointsService).mockResolvedValue({ batchId: 'batch-123' } as any)

            const { $fetch } = await import('ofetch')
            vi.mocked($fetch).mockResolvedValue({
                output: { task_id: 'asr-task-001', task_status: 'PENDING' },
            })

            const { createAsrTaskService } = await import('~~/server/services/material/asrTask.service')
            const mockTask = { id: 1, taskId: 'asr-task-001', status: 1 }
            vi.mocked(createAsrTaskService).mockResolvedValue(mockTask as any)

            const { submitAsrTaskService } = await import('~~/server/services/material/asr.service')
            const result = await submitAsrTaskService(1, 1)

            expect(result.success).toBe(true)
            expect(result.task).toEqual(mockTask)
            expect(createAsrTaskService).toHaveBeenCalledWith(
                expect.objectContaining({
                    taskId: 'asr-task-001',
                    status: 1, // AsrTaskStatus.PROCESSING
                })
            )
        })

        it('ASR API 返回错误码时应返回失败', async () => {
            const { getValidNodeConfig } = await import('~~/server/services/node/node.service')
            vi.mocked(getValidNodeConfig).mockResolvedValue({
                modelApiKeys: [{ apiKey: 'test-key' }],
                modelName: 'paraformer-v2',
                modelProviderBaseUrl: 'https://dashscope.aliyuncs.com/api/v1',
                modelSdkType: 'openai',
                name: 'audioRecognition',
                prompts: [],
            } as any)

            ;(globalThis as any).prisma.ossFiles.findFirst = vi.fn().mockResolvedValue({
                id: 1,
                filePath: 'audio/test.mp3',
                fileType: 'audio/mp3',
            })

            const { findAsrRecordByOssFileIdDao } = await import('~~/server/services/material/asr.dao')
            vi.mocked(findAsrRecordByOssFileIdDao).mockResolvedValue(null)

            ;(globalThis as any).getAudioDuration = vi.fn().mockResolvedValue(60)

            const { preDeductPointsService } = await import('~~/server/services/point/pointConsumption.service')
            vi.mocked(preDeductPointsService).mockResolvedValue({ batchId: 'batch-456' } as any)

            const { $fetch } = await import('ofetch')
            vi.mocked($fetch).mockResolvedValue({
                code: 'InvalidParameter',
                message: '参数无效',
            })

            const { submitAsrTaskService } = await import('~~/server/services/material/asr.service')
            const result = await submitAsrTaskService(1, 1)

            expect(result.success).toBe(false)
            expect(result.error).toContain('参数无效')
        })
    })

    // ==================== processTranscriptionResultService ====================
    describe('processTranscriptionResultService', () => {
        it('转录结果为空时应返回失败', async () => {
            const { $fetch } = await import('ofetch')
            vi.mocked($fetch).mockResolvedValue(null)

            const { processTranscriptionResultService } = await import('~~/server/services/material/asr.service')
            const result = await processTranscriptionResultService('task-1', 'https://example.com/result.json')

            expect(result.success).toBe(false)
            expect(result.error).toContain('为空')
        })

        it('成功处理转录结果时应返回精简数据', async () => {
            const { $fetch } = await import('ofetch')
            const rawResponse = {
                file_url: 'https://example.com/audio.mp3',
                properties: {
                    original_duration_in_milliseconds: 120000,
                    audio_format: 'mp3',
                },
                transcripts: [
                    {
                        channel_id: 0,
                        content_duration_in_milliseconds: 120000,
                        sentences: [
                            {
                                begin_time: 0,
                                end_time: 5000,
                                text: '你好世界',
                                sentence_id: 0,
                                speaker_id: 0,
                                words: [{ text: '你好' }, { text: '世界' }],
                            },
                        ],
                    },
                ],
            }
            vi.mocked($fetch).mockResolvedValue(rawResponse)

            const { processTranscriptionResultService } = await import('~~/server/services/material/asr.service')
            const result = await processTranscriptionResultService('task-2', 'https://example.com/result.json', 1)

            expect(result.success).toBe(true)
            expect(result.text).toBeDefined()
            expect(result.duration).toBe(120) // 120000ms -> 120s
            expect(result.speakers).toBeDefined()
            expect(result.speakers!.length).toBeGreaterThanOrEqual(1)
            // 精简后的结果不应包含 words
            expect(result.result?.transcripts[0]?.sentences[0]).not.toHaveProperty('words')
        })

        it('下载转录结果失败时应返回错误', async () => {
            const { $fetch } = await import('ofetch')
            vi.mocked($fetch).mockRejectedValue(new Error('网络错误'))

            const { processTranscriptionResultService } = await import('~~/server/services/material/asr.service')
            const result = await processTranscriptionResultService('task-3', 'https://example.com/bad.json')

            expect(result.success).toBe(false)
            expect(result.error).toBeDefined()
        })

        it('上传原始 JSON 到 OSS 失败不应影响主流程', async () => {
            const { $fetch } = await import('ofetch')
            const rawResponse = {
                file_url: 'https://example.com/audio.mp3',
                properties: { original_duration_in_milliseconds: 60000 },
                transcripts: [{
                    channel_id: 0,
                    content_duration_in_milliseconds: 60000,
                    sentences: [{
                        begin_time: 0, end_time: 3000, text: '测试',
                        sentence_id: 0, speaker_id: 0,
                    }],
                }],
            }
            vi.mocked($fetch).mockResolvedValue(rawResponse)

            // 让 prisma.ossFiles.create 抛出异常（模拟 OSS 上传失败）
            ;(globalThis as any).prisma.ossFiles.create = vi.fn().mockRejectedValue(new Error('OSS 上传失败'))

            const { processTranscriptionResultService } = await import('~~/server/services/material/asr.service')
            const result = await processTranscriptionResultService('task-4', 'https://example.com/result.json', 1)

            // 主流程应仍然成功
            expect(result.success).toBe(true)
            expect(result.text).toBeDefined()
        })
    })

    // ==================== completeTranscriptionService ====================
    describe('completeTranscriptionService', () => {
        it('任务不存在时应抛出错误', async () => {
            const { getAsrTaskByTaskIdService } = await import('~~/server/services/material/asrTask.service')
            vi.mocked(getAsrTaskByTaskIdService).mockResolvedValue(null)

            const { completeTranscriptionService } = await import('~~/server/services/material/asr.service')

            await expect(completeTranscriptionService('nonexistent', {
                success: true, text: '测试', result: {},
            })).rejects.toThrow('任务不存在')
        })

        it('任务数据不完整时应抛出错误', async () => {
            const { getAsrTaskByTaskIdService } = await import('~~/server/services/material/asrTask.service')
            vi.mocked(getAsrTaskByTaskIdService).mockResolvedValue({
                id: 1,
                taskId: 'task-1',
                taskRawData: {}, // 缺少 ossFileId 和 userId
            } as any)

            const { completeTranscriptionService } = await import('~~/server/services/material/asr.service')

            await expect(completeTranscriptionService('task-1', {
                success: true, text: '测试', result: {},
            })).rejects.toThrow('任务数据不完整')
        })

        it('成功完成转录时应更新任务状态、创建记录并结算积分', async () => {
            const { getAsrTaskByTaskIdService, updateAsrTaskService } = await import('~~/server/services/material/asrTask.service')
            vi.mocked(getAsrTaskByTaskIdService).mockResolvedValue({
                id: 1,
                taskId: 'task-complete',
                taskRawData: {
                    ossFileId: 10,
                    userId: 1,
                    audioUrl: 'https://example.com/audio.mp3',
                    preDeductBatchId: 'batch-789',
                    audioDuration: 120,
                },
            } as any)

            const { findAsrRecordByOssFileIdDao, createAsrRecordDao } = await import('~~/server/services/material/asr.dao')
            vi.mocked(findAsrRecordByOssFileIdDao).mockResolvedValue(null)
            vi.mocked(createAsrRecordDao).mockResolvedValue({ id: 20, ossFileId: 10, userId: 1 } as any)

            const { settlePointsService } = await import('~~/server/services/point/pointConsumption.service')

            const { completeTranscriptionService } = await import('~~/server/services/material/asr.service')
            await completeTranscriptionService('task-complete', {
                success: true,
                text: '转录结果文本',
                duration: 120,
                speakers: [{ id: 0, name: '说话人 1' }],
                result: { transcripts: [] },
            })

            expect(updateAsrTaskService).toHaveBeenCalledWith(1, expect.objectContaining({
                status: 2, // AsrTaskStatus.SUCCESS
            }))
            expect(createAsrRecordDao).toHaveBeenCalledWith(expect.objectContaining({
                userId: 1,
                ossFileId: 10,
                status: 2, // AsrRecordStatus.SUCCESS
            }))
            expect(settlePointsService).toHaveBeenCalledWith('batch-789', 2) // 120s -> 2 min
        })

        it('已存在识别记录时应更新而非创建', async () => {
            const { getAsrTaskByTaskIdService } = await import('~~/server/services/material/asrTask.service')
            vi.mocked(getAsrTaskByTaskIdService).mockResolvedValue({
                id: 1,
                taskId: 'task-update',
                taskRawData: {
                    ossFileId: 10,
                    userId: 1,
                    audioUrl: 'https://example.com/audio.mp3',
                    preDeductBatchId: 'batch-update',
                    audioDuration: 60,
                },
            } as any)

            const { findAsrRecordByOssFileIdDao, updateAsrRecordDao, createAsrRecordDao } = await import('~~/server/services/material/asr.dao')
            vi.mocked(findAsrRecordByOssFileIdDao).mockResolvedValue({ id: 20, ossFileId: 10 } as any)
            vi.mocked(updateAsrRecordDao).mockResolvedValue({ id: 20 } as any)

            const { completeTranscriptionService } = await import('~~/server/services/material/asr.service')
            await completeTranscriptionService('task-update', {
                success: true, text: '更新文本', duration: 60, result: {},
            })

            expect(updateAsrRecordDao).toHaveBeenCalled()
            expect(createAsrRecordDao).not.toHaveBeenCalled()
        })

        it('积分结算失败不应影响转录结果保存', async () => {
            const { getAsrTaskByTaskIdService } = await import('~~/server/services/material/asrTask.service')
            vi.mocked(getAsrTaskByTaskIdService).mockResolvedValue({
                id: 1,
                taskId: 'task-settle-fail',
                taskRawData: {
                    ossFileId: 10,
                    userId: 1,
                    audioUrl: 'https://example.com/audio.mp3',
                    preDeductBatchId: 'batch-fail',
                    audioDuration: 60,
                },
            } as any)

            const { findAsrRecordByOssFileIdDao, createAsrRecordDao } = await import('~~/server/services/material/asr.dao')
            vi.mocked(findAsrRecordByOssFileIdDao).mockResolvedValue(null)
            vi.mocked(createAsrRecordDao).mockResolvedValue({ id: 30, ossFileId: 10, userId: 1 } as any)

            const { settlePointsService } = await import('~~/server/services/point/pointConsumption.service')
            vi.mocked(settlePointsService).mockRejectedValue(new Error('结算服务不可用'))

            const { completeTranscriptionService } = await import('~~/server/services/material/asr.service')
            // 不应抛出错误
            await completeTranscriptionService('task-settle-fail', {
                success: true, text: '文本', duration: 60, result: {},
            })

            expect(createAsrRecordDao).toHaveBeenCalled()
        })
    })

    // ==================== failTranscriptionService ====================
    describe('failTranscriptionService', () => {
        it('任务不存在时应静默返回', async () => {
            const { getAsrTaskByTaskIdService } = await import('~~/server/services/material/asrTask.service')
            vi.mocked(getAsrTaskByTaskIdService).mockResolvedValue(null)

            const { failTranscriptionService } = await import('~~/server/services/material/asr.service')
            // 不应抛出错误
            await failTranscriptionService('nonexistent', '测试失败')
        })

        it('失败时应更新任务状态并回滚积分', async () => {
            const { getAsrTaskByTaskIdService, updateAsrTaskService } = await import('~~/server/services/material/asrTask.service')
            vi.mocked(getAsrTaskByTaskIdService).mockResolvedValue({
                id: 1,
                taskId: 'task-fail',
                taskRawData: {
                    preDeductBatchId: 'batch-rollback',
                    tempFilePath: null,
                },
            } as any)

            const { rollbackPreDeductService } = await import('~~/server/services/point/pointConsumption.service')

            const { failTranscriptionService } = await import('~~/server/services/material/asr.service')
            await failTranscriptionService('task-fail', '转录失败')

            expect(updateAsrTaskService).toHaveBeenCalledWith(1, expect.objectContaining({
                status: 3, // AsrTaskStatus.FAILED
            }))
            expect(rollbackPreDeductService).toHaveBeenCalledWith('batch-rollback')
        })

        it('失败时应清理临时文件', async () => {
            const { getAsrTaskByTaskIdService } = await import('~~/server/services/material/asrTask.service')
            vi.mocked(getAsrTaskByTaskIdService).mockResolvedValue({
                id: 1,
                taskId: 'task-fail-temp',
                taskRawData: {
                    preDeductBatchId: null,
                    tempFilePath: 'temp/audio.mp3',
                },
            } as any)

            const { deleteFileService } = await import('~~/server/services/storage/storage.service')

            const { failTranscriptionService } = await import('~~/server/services/material/asr.service')
            await failTranscriptionService('task-fail-temp', '失败')

            expect(deleteFileService).toHaveBeenCalledWith('temp/audio.mp3')
        })

        it('积分回滚失败不应影响主流程', async () => {
            const { getAsrTaskByTaskIdService, updateAsrTaskService } = await import('~~/server/services/material/asrTask.service')
            vi.mocked(getAsrTaskByTaskIdService).mockResolvedValue({
                id: 1,
                taskId: 'task-rollback-fail',
                taskRawData: {
                    preDeductBatchId: 'batch-error',
                    tempFilePath: null,
                },
            } as any)

            const { rollbackPreDeductService } = await import('~~/server/services/point/pointConsumption.service')
            vi.mocked(rollbackPreDeductService).mockRejectedValue(new Error('回滚服务异常'))

            const { failTranscriptionService } = await import('~~/server/services/material/asr.service')
            // 不应抛出错误
            await failTranscriptionService('task-rollback-fail', '失败')

            expect(updateAsrTaskService).toHaveBeenCalled()
        })
    })

    // ==================== pollAsrTaskStatusService ====================
    describe('pollAsrTaskStatusService', () => {
        it('任务已处理时应直接返回 true', async () => {
            const { isAsrTaskProcessedService } = await import('~~/server/services/material/asrTask.service')
            vi.mocked(isAsrTaskProcessedService).mockResolvedValue(true)

            const { pollAsrTaskStatusService } = await import('~~/server/services/material/asr.service')
            const result = await pollAsrTaskStatusService('already-done')

            expect(result).toBe(true)
        })

        it('节点配置获取失败时应返回 false', async () => {
            const { isAsrTaskProcessedService } = await import('~~/server/services/material/asrTask.service')
            vi.mocked(isAsrTaskProcessedService).mockResolvedValue(false)

            const { getValidNodeConfig } = await import('~~/server/services/node/node.service')
            vi.mocked(getValidNodeConfig).mockRejectedValue(new Error('无可用节点'))

            const { pollAsrTaskStatusService } = await import('~~/server/services/material/asr.service')
            const result = await pollAsrTaskStatusService('task-no-config')

            expect(result).toBe(false)
        })

        it('任务状态为 FAILED 时应标记失败并返回 true', async () => {
            const { isAsrTaskProcessedService } = await import('~~/server/services/material/asrTask.service')
            vi.mocked(isAsrTaskProcessedService).mockResolvedValue(false)

            const { getValidNodeConfig } = await import('~~/server/services/node/node.service')
            vi.mocked(getValidNodeConfig).mockResolvedValue({
                modelApiKeys: [{ apiKey: 'test-key' }],
                modelName: 'paraformer-v2',
                modelProviderBaseUrl: 'https://dashscope.aliyuncs.com/api/v1',
                modelSdkType: 'openai',
                name: 'audioRecognition',
                prompts: [],
            } as any)

            const { $fetch } = await import('ofetch')
            vi.mocked($fetch).mockResolvedValue({
                output: {
                    task_id: 'task-poll-fail',
                    task_status: 'FAILED',
                },
                message: '任务执行失败',
            })

            const { getAsrTaskByTaskIdService } = await import('~~/server/services/material/asrTask.service')
            vi.mocked(getAsrTaskByTaskIdService).mockResolvedValue({
                id: 1, taskId: 'task-poll-fail', taskRawData: { preDeductBatchId: null },
            } as any)

            const { pollAsrTaskStatusService } = await import('~~/server/services/material/asr.service')
            const result = await pollAsrTaskStatusService('task-poll-fail')

            expect(result).toBe(true)
        })

        it('任务仍在处理中时应返回 false', async () => {
            const { isAsrTaskProcessedService } = await import('~~/server/services/material/asrTask.service')
            vi.mocked(isAsrTaskProcessedService).mockResolvedValue(false)

            const { getValidNodeConfig } = await import('~~/server/services/node/node.service')
            vi.mocked(getValidNodeConfig).mockResolvedValue({
                modelApiKeys: [{ apiKey: 'test-key' }],
                modelName: 'paraformer-v2',
                modelProviderBaseUrl: 'https://dashscope.aliyuncs.com/api/v1',
                modelSdkType: 'openai',
                name: 'audioRecognition',
                prompts: [],
            } as any)

            const { $fetch } = await import('ofetch')
            vi.mocked($fetch).mockResolvedValue({
                output: {
                    task_id: 'task-running',
                    task_status: 'RUNNING',
                },
            })

            const { pollAsrTaskStatusService } = await import('~~/server/services/material/asr.service')
            const result = await pollAsrTaskStatusService('task-running')

            expect(result).toBe(false)
        })
    })

    // ==================== transcribeAudioService ====================
    describe('transcribeAudioService', () => {
        it('提交失败时应直接返回失败结果', async () => {
            const { getValidNodeConfig } = await import('~~/server/services/node/node.service')
            vi.mocked(getValidNodeConfig).mockRejectedValue(new Error('节点不可用'))

            const { transcribeAudioService } = await import('~~/server/services/material/asr.service')
            const result = await transcribeAudioService(1, 1)

            expect(result.success).toBe(false)
        })
    })

    // ==================== embedAsrRecordService ====================
    describe('embedAsrRecordService', () => {
        it('记录不存在时应返回失败', async () => {
            const { findAsrRecordByIdDao } = await import('~~/server/services/material/asr.dao')
            vi.mocked(findAsrRecordByIdDao).mockResolvedValue(null)

            const { embedAsrRecordService } = await import('~~/server/services/material/asr.service')
            const result = await embedAsrRecordService(999, 1)

            expect(result.success).toBe(false)
            expect(result.error).toContain('不存在')
        })

        it('记录状态非成功时应返回失败', async () => {
            const { findAsrRecordByIdDao } = await import('~~/server/services/material/asr.dao')
            vi.mocked(findAsrRecordByIdDao).mockResolvedValue({
                id: 1,
                status: 1, // PROCESSING
                result: null,
            } as any)

            const { embedAsrRecordService } = await import('~~/server/services/material/asr.service')
            const result = await embedAsrRecordService(1, 1)

            expect(result.success).toBe(false)
            expect(result.error).toContain('状态不正确')
        })

        it('识别结果为空时应返回失败', async () => {
            const { findAsrRecordByIdDao } = await import('~~/server/services/material/asr.dao')
            vi.mocked(findAsrRecordByIdDao).mockResolvedValue({
                id: 1,
                status: 2, // SUCCESS
                result: null,
            } as any)

            const { embedAsrRecordService } = await import('~~/server/services/material/asr.service')
            const result = await embedAsrRecordService(1, 1)

            expect(result.success).toBe(false)
            expect(result.error).toContain('没有识别结果')
        })

        it('成功向量化时应更新记录并返回结果', async () => {
            const { findAsrRecordByIdDao, updateAsrRecordDao } = await import('~~/server/services/material/asr.dao')
            vi.mocked(findAsrRecordByIdDao).mockResolvedValue({
                id: 1,
                status: 2, // SUCCESS
                ossFileId: 10,
                result: {
                    transcripts: [{
                        channel_id: 0,
                        content_duration_in_milliseconds: 5000,
                        sentences: [{
                            begin_time: 0, end_time: 5000, text: '你好',
                            sentence_id: 0, speaker_id: 0,
                        }],
                    }],
                },
                speakers: [{ id: 0, name: '说话人 1' }],
            } as any)

            ;(globalThis as any).prisma.ossFiles.findFirst = vi.fn().mockResolvedValue({
                id: 10,
                fileName: 'test_audio.mp3',
            })

            const { embedAsrRecordService } = await import('~~/server/services/material/asr.service')
            const result = await embedAsrRecordService(1, 1)

            expect(result.success).toBe(true)
            expect(result.vectorIds).toBeDefined()
            expect(result.chunkCount).toBeDefined()
            expect(updateAsrRecordDao).toHaveBeenCalledWith(1, expect.objectContaining({
                vectorIds: expect.any(Array),
                lastEmbeddingAt: expect.any(Date),
            }), undefined)
        })

        it('向量化异常时应返回失败但不抛出', async () => {
            const { findAsrRecordByIdDao } = await import('~~/server/services/material/asr.dao')
            vi.mocked(findAsrRecordByIdDao).mockResolvedValue({
                id: 1,
                status: 2,
                ossFileId: 10,
                result: {
                    transcripts: [{
                        channel_id: 0,
                        content_duration_in_milliseconds: 5000,
                        sentences: [{ begin_time: 0, end_time: 5000, text: '测试', sentence_id: 0, speaker_id: 0 }],
                    }],
                },
                speakers: null,
            } as any)

            ;(globalThis as any).prisma.ossFiles.findFirst = vi.fn().mockResolvedValue({ id: 10, fileName: 'audio.mp3' })

            const { embedAudioService } = await import('~~/server/services/material/materialEmbedding.service')
            vi.mocked(embedAudioService).mockRejectedValue(new Error('向量化服务不可用'))

            const { embedAsrRecordService } = await import('~~/server/services/material/asr.service')
            const result = await embedAsrRecordService(1, 1)

            expect(result.success).toBe(false)
            expect(result.error).toContain('向量化')
        })
    })

    // ==================== getAsrRecordByOssFileIdService ====================
    describe('查询函数', () => {
        it('getAsrRecordByOssFileIdService 应委托给 DAO', async () => {
            const { findAsrRecordByOssFileIdDao } = await import('~~/server/services/material/asr.dao')
            const mockRecord = { id: 1, ossFileId: 10 } as any
            vi.mocked(findAsrRecordByOssFileIdDao).mockResolvedValue(mockRecord)

            const { getAsrRecordByOssFileIdService } = await import('~~/server/services/material/asr.service')
            const result = await getAsrRecordByOssFileIdService(10)

            expect(result).toEqual(mockRecord)
            expect(findAsrRecordByOssFileIdDao).toHaveBeenCalledWith(10)
        })

        it('getAsrRecordsByOssFileIdsService 应委托给 DAO', async () => {
            const { findAsrRecordsByOssFileIdsDao } = await import('~~/server/services/material/asr.dao')
            const mockRecords = [{ id: 1 }, { id: 2 }] as any[]
            vi.mocked(findAsrRecordsByOssFileIdsDao).mockResolvedValue(mockRecords)

            const { getAsrRecordsByOssFileIdsService } = await import('~~/server/services/material/asr.service')
            const result = await getAsrRecordsByOssFileIdsService([10, 20])

            expect(result).toEqual(mockRecords)
            expect(findAsrRecordsByOssFileIdsDao).toHaveBeenCalledWith([10, 20])
        })

        it('getAsrRecordByIdService 应委托给 DAO', async () => {
            const { findAsrRecordByIdDao } = await import('~~/server/services/material/asr.dao')
            const mockRecord = { id: 1 } as any
            vi.mocked(findAsrRecordByIdDao).mockResolvedValue(mockRecord)

            const { getAsrRecordByIdService } = await import('~~/server/services/material/asr.service')
            const result = await getAsrRecordByIdService(1)

            expect(result).toEqual(mockRecord)
            expect(findAsrRecordByIdDao).toHaveBeenCalledWith(1)
        })
    })
})
