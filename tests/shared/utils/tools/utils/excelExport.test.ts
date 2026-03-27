/**
 * Excel导出工具测试
 *
 * 测试 exportToExcel, exportInterestToExcel, exportCompensationToExcel,
 * exportDelayInterestToExcel 函数
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock xlsx and file-saver
vi.mock('xlsx', () => ({
    utils: {
        book_new: vi.fn(() => ({})),
        json_to_sheet: vi.fn(() => ({})),
        book_append_sheet: vi.fn(),
    },
    write: vi.fn(() => new ArrayBuffer(100)),
}))

vi.mock('file-saver', () => ({
    saveAs: vi.fn(),
}))


import {
    exportToExcel,
    exportInterestToExcel,
    exportCompensationToExcel,
    exportDelayInterestToExcel
} from '#shared/utils/tools/utils/excelExport'
import type { ExcelHeader, InterestExportResult, CompensationExportResult } from '#shared/types/tools'
import * as XLSX from 'xlsx'
import { saveAs } from 'file-saver'

describe('exportToExcel', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('应正确调用 xlsx 创建工作簿', () => {
        const data = [{ name: 'test', value: 100 }]
        const headers: ExcelHeader[] = [
            { key: 'name', title: '名称' },
            { key: 'value', title: '数值' }
        ]

        exportToExcel(data, headers, 'test', 'Sheet1')

        expect(XLSX.utils.book_new).toHaveBeenCalled()
        expect(XLSX.utils.json_to_sheet).toHaveBeenCalled()
        expect(XLSX.utils.book_append_sheet).toHaveBeenCalled()
        expect(XLSX.write).toHaveBeenCalledWith(expect.any(Object), { bookType: 'xlsx', type: 'array' })
        expect(saveAs).toHaveBeenCalledWith(expect.any(Object), 'test.xlsx')
    })

    it('应使用自定义工作表名称', () => {
        const data = [{ a: 1 }]
        const headers: ExcelHeader[] = [{ key: 'a', title: 'A' }]

        exportToExcel(data, headers, 'report', '自定义工作表')

        expect(XLSX.utils.book_append_sheet).toHaveBeenCalledWith(
            expect.any(Object),
            expect.any(Object),
            '自定义工作表'
        )
    })

    it('空数据应正常处理', () => {
        const headers: ExcelHeader[] = [{ key: 'a', title: 'A' }]

        expect(() => exportToExcel([], headers, 'empty')).not.toThrow()
        expect(saveAs).toHaveBeenCalled()
    })
})

describe('exportInterestToExcel', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('应处理含 pbocResult 和 lprResult 的结果', () => {
        const result: InterestExportResult = {
            pbocResult: {
                interestDetails: [{
                    startDate: '2019-01-01',
                    endDate: '2019-08-19',
                    days: 230,
                    rate: 4.35,
                    interest: 2750.5
                }]
            },
            lprResult: {
                interestDetails: [{
                    startDate: '2019-08-20',
                    endDate: '2020-01-01',
                    days: 134,
                    rate: 4.25,
                    adjustedRate: 17.0,
                    interest: 625.3
                }]
            },
            days: 364,
            totalInterest: 3375.8
        }

        expect(() => exportInterestToExcel(result, 'auto')).not.toThrow()
        expect(saveAs).toHaveBeenCalled()
    })

    it('应处理只有单一 interestDetails 的结果', () => {
        const result: InterestExportResult = {
            interestDetails: [{
                startDate: '2020-01-01',
                endDate: '2020-06-30',
                days: 181,
                rate: 4.35,
                interest: 2185.5
            }],
            days: 181,
            totalInterest: 2185.5
        }

        expect(() => exportInterestToExcel(result, 'lpr')).not.toThrow()
        expect(saveAs).toHaveBeenCalled()
    })

    it('应处理空 interestDetails', () => {
        const result: InterestExportResult = {
            days: 0,
            totalInterest: 0
        }

        expect(() => exportInterestToExcel(result, 'custom')).not.toThrow()
    })
})

describe('exportCompensationToExcel', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('应正确导出赔偿金计算结果', () => {
        const result: CompensationExportResult = {
            isCompensation: true,
            startDate: '2020-01-01',
            endDate: '2024-12-31',
            totalYears: 4,
            totalMonths: 11,
            totalDays: 30,
            calculatedYears: 5,
            effectiveMonthlyWage: 8000,
            isArticle40: false,
            lastMonthWage: 0,
            totalAmount: 48000
        }

        expect(() => exportCompensationToExcel(result)).not.toThrow()
        expect(saveAs).toHaveBeenCalled()
        expect(saveAs).toHaveBeenCalledWith(expect.any(Object), expect.stringContaining('赔偿金计算结果'))
    })

    it('应处理经济赔偿金类型', () => {
        const result: CompensationExportResult = {
            isCompensation: false,
            startDate: '2020-01-01',
            endDate: '2024-12-31',
            totalYears: 4,
            totalMonths: 11,
            totalDays: 30,
            calculatedYears: 5,
            effectiveMonthlyWage: 8000,
            isArticle40: true,
            lastMonthWage: 8000,
            totalAmount: 56000
        }

        expect(() => exportCompensationToExcel(result)).not.toThrow()
    })
})

describe('exportDelayInterestToExcel', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('应处理含 interestDetails 的结果', () => {
        const result = {
            interestDetails: [
                {
                    startDate: '2019-01-01',
                    endDate: '2019-08-19',
                    days: 230,
                    rate: 4.35,
                    adjustedRate: 6.525,
                    interest: 4350.5
                },
                {
                    startDate: '2019-08-20',
                    endDate: '2020-01-01',
                    days: 134,
                    rate: 4.25,
                    adjustedRate: 17.0,
                    interest: 2340.2
                }
            ],
            startDate: '2019-01-01',
            endDate: '2020-01-01',
            days: 364,
            totalInterest: 6690.7
        }

        expect(() => exportDelayInterestToExcel(result)).not.toThrow()
        expect(saveAs).toHaveBeenCalled()
    })

    it('应处理空 interestDetails', () => {
        const result = {
            startDate: '2019-01-01',
            endDate: '2019-01-10',
            days: 9,
            totalInterest: 0
        }

        expect(() => exportDelayInterestToExcel(result)).not.toThrow()
    })

    it('应处理旧版 details 格式（跨越2019-08-20）', () => {
        const result = {
            details: [
                '第0项',
                '第1项',
                '跨越2019年8月20日',
                '基准利率阶段：300天',
                '基准利率：4.35%，迟延履行利率：6.525%',
                '利息 = 10000 × 6.525% ÷ 365 × 300 = 536.30元',
                'LPR利率阶段：65天',
                'LPR利率：4.25%，迟延履行利率：17.0%',
                '利息 = 10000 × 17.0% ÷ 365 × 65 = 302.74元'
            ],
            startDate: '2019-01-01',
            endDate: '2019-08-20',
            days: 300,
            totalInterest: 839.04
        }

        expect(() => exportDelayInterestToExcel(result)).not.toThrow()
    })

    it('应处理旧版 details 格式（单一LPR阶段）', () => {
        const result = {
            details: [
                '第一项',
                '第二项',
                'LPR利率阶段',
                'LPR利率：4.25%，迟延履行利率：17.0%'
            ],
            startDate: '2020-01-01',
            endDate: '2020-06-30',
            days: 181,
            totalInterest: 850.5
        }

        expect(() => exportDelayInterestToExcel(result)).not.toThrow()
    })

    it('应处理旧版 details 格式（单一基准利率阶段）', () => {
        // 覆盖 lines 313-315: detail2.includes('LPR') 为 false 的 else 分支
        const result = {
            details: [
                '第一项',
                '第二项',
                '基准利率阶段：180 天',
                '基准利率：4.35%，迟延履行利率：6.525%'
            ],
            startDate: '2018-01-01',
            endDate: '2018-06-30',
            days: 180,
            totalInterest: 326.25
        }

        expect(() => exportDelayInterestToExcel(result)).not.toThrow()
        expect(saveAs).toHaveBeenCalled()
    })

    it('应处理空 details 数组以覆盖 extractNumberFromString 的匹配失败分支', () => {
        // 覆盖 lines 384-385: extractNumberFromString match 失败返回 0 的分支
        const result = {
            details: [],
            startDate: '2020-01-01',
            endDate: '2020-06-30',
            days: 181,
            totalInterest: 0
        }

        expect(() => exportDelayInterestToExcel(result)).not.toThrow()
    })
})

describe('exportDelayInterestToExcel - 边界分支覆盖', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('details 数组长度不足 3 时应触发 line 307 的 ?? 分支', () => {
        // 覆盖 line 307: details[2] ?? '' 当 details 长度不足 3
        const result = {
            details: ['第一项', '第二项'], // 长度只有 2，details[2] 为 undefined
            startDate: '2020-01-01',
            endDate: '2020-06-30',
            days: 181,
            totalInterest: 850.5
        }

        expect(() => exportDelayInterestToExcel(result)).not.toThrow()
        expect(saveAs).toHaveBeenCalled()
    })

    it('getCalculationTypeText 应处理未知类型触发 line 395 的 || 分支', () => {
        // 覆盖 line 395: typeMap[type] || type 当 type 未知
        // 通过调用 exportInterestToExcel 来测试 getCalculationTypeText
        const result: InterestExportResult = {
            interestDetails: [{
                startDate: '2020-01-01',
                endDate: '2020-06-30',
                days: 181,
                rate: 4.35,
                interest: 2185.5
            }],
            days: 181,
            totalInterest: 2185.5
        }

        // 传入未知类型触发 default 分支
        expect(() => exportInterestToExcel(result, 'unknown-type')).not.toThrow()
        expect(saveAs).toHaveBeenCalled()
    })

    it('extractNumberFromString 应处理匹配失败返回 0 的情况', () => {
        // 覆盖 line 384: extractNumberFromString 匹配失败返回 0
        // 创建一个包含无法匹配数字的 details 数组
        const result = {
            details: [
                '第一项',
                '第二项',
                'LPR 利率阶段',
                'LPR 利率：无效格式，迟延履行利率：也是无效格式' // 正则无法匹配
            ],
            startDate: '2020-01-01',
            endDate: '2020-06-30',
            days: 181,
            totalInterest: 0
        }

        expect(() => exportDelayInterestToExcel(result)).not.toThrow()
        expect(saveAs).toHaveBeenCalled()
    })
})

describe('exportDelayInterestToExcel - 额外分支覆盖', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('应处理 interestDetails 中 adjustedRate 为 undefined 的情况（覆盖 line 251）', () => {
        // 覆盖 line 251: detail.adjustedRate || detail.rate 当 adjustedRate 为 undefined
        const result = {
            interestDetails: [{
                startDate: '2020-01-01',
                endDate: '2020-06-30',
                days: 181,
                rate: 4.25,
                adjustedRate: undefined, // 显式设置为 undefined 触发 || 分支
                interest: 850.5
            }],
            startDate: '2020-01-01',
            endDate: '2020-06-30',
            days: 181,
            totalInterest: 850.5
        }

        expect(() => exportDelayInterestToExcel(result)).not.toThrow()
        expect(saveAs).toHaveBeenCalled()
    })

    it('应处理跨越 2019-08-20 的 details 格式中数组元素缺失的情况（覆盖 lines 277-289）', () => {
        // 覆盖 lines 277-289: details[3] ?? '' 等当数组元素不存在
        const result = {
            details: [
                '第 0 项',
                '第 1 项',
                '跨越 2019 年 8 月 20 日'
                // details[3] 到 details[8] 都不存在，触发 ?? '' 分支
            ],
            startDate: '2019-01-01',
            endDate: '2019-12-31',
            days: 365,
            totalInterest: 0
        }

        expect(() => exportDelayInterestToExcel(result)).not.toThrow()
        expect(saveAs).toHaveBeenCalled()
    })

    it('应处理 item 缺少 header.key 对应的属性（覆盖 line 357）', () => {
        // 覆盖 line 357: item[header.key] ?? '' 当 key 不存在
        // 通过创建一个包含不完整数据的 interestDetails 来测试
        const result = {
            interestDetails: [{
                startDate: '2020-01-01',
                endDate: '2020-06-30',
                days: 181,
                rate: 4.25
                // 故意省略 adjustedRate 和 interest 字段
            } as any], // 使用 as any 绕过 TypeScript 检查
            startDate: '2020-01-01',
            endDate: '2020-06-30',
            days: 181,
            totalInterest: 0
        }

        expect(() => exportDelayInterestToExcel(result)).not.toThrow()
        expect(saveAs).toHaveBeenCalled()
    })
})
