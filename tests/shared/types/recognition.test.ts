/**
 * 识别类型定义属性测试
 *
 * 测试识别相关枚举值的正确性
 *
 * **Feature: recognition-code-refactor, Property 1: 枚举值正确性**
 * **Validates: Requirements 1.2, 1.3, 1.4, 1.7, 1.8**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import {
    DocRecognitionStatus,
    DocRecognitionStatusText,
    ImageRecognitionStatus,
    ImageRecognitionStatusText,
    AsrRecordStatus,
    AsrRecordStatusText,
    AsrTaskStatus,
    AsrTaskStatusText,
    MineruTaskStatus,
    MineruTaskStatusText,
} from '../../../shared/types/recognition'

/**
 * 预期的枚举值映射
 * 所有识别状态枚举应遵循统一的数值映射：
 * PENDING=0, PROCESSING=1, SUCCESS/COMPLETED=2, FAILED=3
 */
const expectedEnumValues = {
    PENDING: 0,
    PROCESSING: 1,
    SUCCESS_OR_COMPLETED: 2, // SUCCESS 或 COMPLETED
    FAILED: 3,
}

/**
 * 识别状态枚举配置
 * 定义每个枚举及其成功状态的键名（SUCCESS 或 COMPLETED）
 */
const recognitionStatusEnums = [
    {
        name: 'DocRecognitionStatus',
        enum: DocRecognitionStatus,
        successKey: 'SUCCESS',
    },
    {
        name: 'ImageRecognitionStatus',
        enum: ImageRecognitionStatus,
        successKey: 'COMPLETED',
    },
    {
        name: 'AsrRecordStatus',
        enum: AsrRecordStatus,
        successKey: 'SUCCESS',
    },
    {
        name: 'AsrTaskStatus',
        enum: AsrTaskStatus,
        successKey: 'SUCCESS',
    },
    {
        name: 'MineruTaskStatus',
        enum: MineruTaskStatus,
        successKey: 'SUCCESS',
    },
] as const

describe('Property 1: 枚举值正确性', () => {
    describe('识别状态枚举数值映射验证', () => {
        it('对于任意识别状态枚举，PENDING 值应为 0', () => {
            // 使用属性测试验证所有枚举的 PENDING 值
            fc.assert(
                fc.property(
                    fc.constantFrom(...recognitionStatusEnums),
                    (enumConfig) => {
                        const enumObj = enumConfig.enum as Record<string, number | string>
                        expect(enumObj.PENDING).toBe(expectedEnumValues.PENDING)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('对于任意识别状态枚举，PROCESSING 值应为 1', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom(...recognitionStatusEnums),
                    (enumConfig) => {
                        const enumObj = enumConfig.enum as Record<string, number | string>
                        expect(enumObj.PROCESSING).toBe(expectedEnumValues.PROCESSING)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('对于任意识别状态枚举，SUCCESS/COMPLETED 值应为 2', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom(...recognitionStatusEnums),
                    (enumConfig) => {
                        const enumObj = enumConfig.enum as Record<string, number | string>
                        const successValue = enumObj[enumConfig.successKey]
                        expect(successValue).toBe(expectedEnumValues.SUCCESS_OR_COMPLETED)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('对于任意识别状态枚举，FAILED 值应为 3', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom(...recognitionStatusEnums),
                    (enumConfig) => {
                        const enumObj = enumConfig.enum as Record<string, number | string>
                        expect(enumObj.FAILED).toBe(expectedEnumValues.FAILED)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('对于任意识别状态枚举，应恰好包含 4 或 5 个数值成员', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom(...recognitionStatusEnums),
                    (enumConfig) => {
                        const enumObj = enumConfig.enum as Record<string, number | string>
                        // TypeScript 枚举会生成双向映射，数值成员数量为 Object.keys 长度的一半
                        const numericValues = Object.values(enumObj).filter(
                            (v) => typeof v === 'number'
                        )
                        // 有些枚举有 4 个状态，有些有 5 个（包含 SUPERSEDED）
                        expect(numericValues.length).toBeGreaterThanOrEqual(4)
                        expect(numericValues.length).toBeLessThanOrEqual(5)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('对于任意识别状态枚举，所有数值应在 [0, 4] 范围内', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom(...recognitionStatusEnums),
                    (enumConfig) => {
                        const enumObj = enumConfig.enum as Record<string, number | string>
                        const numericValues = Object.values(enumObj).filter(
                            (v) => typeof v === 'number'
                        ) as number[]

                        numericValues.forEach((value) => {
                            expect(value).toBeGreaterThanOrEqual(0)
                            expect(value).toBeLessThanOrEqual(4)
                        })
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('对于任意识别状态枚举，数值应连续且不重复', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom(...recognitionStatusEnums),
                    (enumConfig) => {
                        const enumObj = enumConfig.enum as Record<string, number | string>
                        const numericValues = Object.values(enumObj)
                            .filter((v) => typeof v === 'number')
                            .sort((a, b) => (a as number) - (b as number)) as number[]

                        // 验证数值连续：4 个状态为 [0,1,2,3]，5 个状态为 [0,1,2,3,4]
                        const expected = numericValues.length === 5
                            ? [0, 1, 2, 3, 4]
                            : [0, 1, 2, 3]
                        expect(numericValues).toEqual(expected)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('单个枚举详细验证', () => {
        it('DocRecognitionStatus 枚举值应正确', () => {
            expect(DocRecognitionStatus.PENDING).toBe(0)
            expect(DocRecognitionStatus.PROCESSING).toBe(1)
            expect(DocRecognitionStatus.SUCCESS).toBe(2)
            expect(DocRecognitionStatus.FAILED).toBe(3)
        })

        it('ImageRecognitionStatus 枚举值应正确', () => {
            expect(ImageRecognitionStatus.PENDING).toBe(0)
            expect(ImageRecognitionStatus.PROCESSING).toBe(1)
            expect(ImageRecognitionStatus.COMPLETED).toBe(2)
            expect(ImageRecognitionStatus.FAILED).toBe(3)
        })

        it('AsrRecordStatus 枚举值应正确', () => {
            expect(AsrRecordStatus.PENDING).toBe(0)
            expect(AsrRecordStatus.PROCESSING).toBe(1)
            expect(AsrRecordStatus.SUCCESS).toBe(2)
            expect(AsrRecordStatus.FAILED).toBe(3)
        })

        it('AsrTaskStatus 枚举值应正确', () => {
            expect(AsrTaskStatus.PENDING).toBe(0)
            expect(AsrTaskStatus.PROCESSING).toBe(1)
            expect(AsrTaskStatus.SUCCESS).toBe(2)
            expect(AsrTaskStatus.FAILED).toBe(3)
        })

        it('MineruTaskStatus 枚举值应正确', () => {
            expect(MineruTaskStatus.PENDING).toBe(0)
            expect(MineruTaskStatus.PROCESSING).toBe(1)
            expect(MineruTaskStatus.SUCCESS).toBe(2)
            expect(MineruTaskStatus.FAILED).toBe(3)
        })
    })
})


/**
 * Property 2: 文本映射完整性
 *
 * **Feature: recognition-code-refactor, Property 2: 文本映射完整性**
 * **Validates: Requirements 1.6, 5.4**
 *
 * 对于任意识别状态枚举，其对应的文本映射对象应包含该枚举的所有成员，
 * 且每个成员都有非空的中文文本描述。
 */

/**
 * 文本映射配置
 * 定义每个枚举及其对应的文本映射对象
 */
const textMappingConfigs = [
    {
        name: 'DocRecognitionStatus',
        enum: DocRecognitionStatus,
        textMapping: DocRecognitionStatusText,
    },
    {
        name: 'ImageRecognitionStatus',
        enum: ImageRecognitionStatus,
        textMapping: ImageRecognitionStatusText,
    },
    {
        name: 'AsrRecordStatus',
        enum: AsrRecordStatus,
        textMapping: AsrRecordStatusText,
    },
    {
        name: 'AsrTaskStatus',
        enum: AsrTaskStatus,
        textMapping: AsrTaskStatusText,
    },
    {
        name: 'MineruTaskStatus',
        enum: MineruTaskStatus,
        textMapping: MineruTaskStatusText,
    },
] as const

describe('Property 2: 文本映射完整性', () => {
    describe('文本映射覆盖性验证', () => {
        it('对于任意识别状态枚举，其文本映射应包含所有枚举成员', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom(...textMappingConfigs),
                    (config) => {
                        const enumObj = config.enum as Record<string, number | string>
                        const textMapping = config.textMapping as Record<number, string>

                        // 获取枚举的所有数值成员
                        const numericValues = Object.values(enumObj).filter(
                            (v) => typeof v === 'number'
                        ) as number[]

                        // 验证每个枚举值都有对应的文本映射
                        numericValues.forEach((value) => {
                            expect(textMapping).toHaveProperty(String(value))
                        })
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('对于任意识别状态枚举，其文本映射的键数量应与枚举成员数量一致', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom(...textMappingConfigs),
                    (config) => {
                        const enumObj = config.enum as Record<string, number | string>
                        const textMapping = config.textMapping as Record<number, string>

                        // 获取枚举的数值成员数量
                        const numericValues = Object.values(enumObj).filter(
                            (v) => typeof v === 'number'
                        )

                        // 获取文本映射的键数量
                        const mappingKeys = Object.keys(textMapping)

                        expect(mappingKeys.length).toBe(numericValues.length)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('文本内容有效性验证', () => {
        it('对于任意识别状态枚举，其文本映射的每个值都应为非空字符串', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom(...textMappingConfigs),
                    (config) => {
                        const textMapping = config.textMapping as Record<number, string>

                        // 验证每个文本值都是非空字符串
                        Object.values(textMapping).forEach((text) => {
                            expect(typeof text).toBe('string')
                            expect(text.length).toBeGreaterThan(0)
                        })
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('对于任意识别状态枚举，其文本映射的每个值都应包含中文字符', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom(...textMappingConfigs),
                    (config) => {
                        const textMapping = config.textMapping as Record<number, string>

                        // 中文字符正则表达式
                        const chineseRegex = /[\u4e00-\u9fa5]/

                        // 验证每个文本值都包含中文字符
                        Object.values(textMapping).forEach((text) => {
                            expect(chineseRegex.test(text)).toBe(true)
                        })
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('对于任意识别状态枚举，其文本映射的值不应包含前后空白字符', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom(...textMappingConfigs),
                    (config) => {
                        const textMapping = config.textMapping as Record<number, string>

                        // 验证每个文本值没有前后空白
                        Object.values(textMapping).forEach((text) => {
                            expect(text).toBe(text.trim())
                        })
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('单个文本映射详细验证', () => {
        it('DocRecognitionStatusText 应包含所有状态的中文描述', () => {
            expect(DocRecognitionStatusText[DocRecognitionStatus.PENDING]).toBe('待处理')
            expect(DocRecognitionStatusText[DocRecognitionStatus.PROCESSING]).toBe('处理中')
            expect(DocRecognitionStatusText[DocRecognitionStatus.SUCCESS]).toBe('成功')
            expect(DocRecognitionStatusText[DocRecognitionStatus.FAILED]).toBe('失败')
        })

        it('ImageRecognitionStatusText 应包含所有状态的中文描述', () => {
            expect(ImageRecognitionStatusText[ImageRecognitionStatus.PENDING]).toBe('待处理')
            expect(ImageRecognitionStatusText[ImageRecognitionStatus.PROCESSING]).toBe('处理中')
            expect(ImageRecognitionStatusText[ImageRecognitionStatus.COMPLETED]).toBe('已完成')
            expect(ImageRecognitionStatusText[ImageRecognitionStatus.FAILED]).toBe('失败')
        })

        it('AsrRecordStatusText 应包含所有状态的中文描述', () => {
            expect(AsrRecordStatusText[AsrRecordStatus.PENDING]).toBe('待处理')
            expect(AsrRecordStatusText[AsrRecordStatus.PROCESSING]).toBe('处理中')
            expect(AsrRecordStatusText[AsrRecordStatus.SUCCESS]).toBe('成功')
            expect(AsrRecordStatusText[AsrRecordStatus.FAILED]).toBe('失败')
        })

        it('AsrTaskStatusText 应包含所有状态的中文描述', () => {
            expect(AsrTaskStatusText[AsrTaskStatus.PENDING]).toBe('待处理')
            expect(AsrTaskStatusText[AsrTaskStatus.PROCESSING]).toBe('处理中')
            expect(AsrTaskStatusText[AsrTaskStatus.SUCCESS]).toBe('成功')
            expect(AsrTaskStatusText[AsrTaskStatus.FAILED]).toBe('失败')
        })

        it('MineruTaskStatusText 应包含所有状态的中文描述', () => {
            expect(MineruTaskStatusText[MineruTaskStatus.PENDING]).toBe('待处理')
            expect(MineruTaskStatusText[MineruTaskStatus.PROCESSING]).toBe('处理中')
            expect(MineruTaskStatusText[MineruTaskStatus.SUCCESS]).toBe('成功')
            expect(MineruTaskStatusText[MineruTaskStatus.FAILED]).toBe('失败')
        })
    })
})
