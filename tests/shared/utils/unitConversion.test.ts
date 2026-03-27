/**
 * unitConversion 单位转换工具测试
 *
 * 测试时间、文件大小、次数单位转换功能
 *
 * **Feature: unit-conversion**
 * **Validates: 单位换算功能**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { TimeUnit, FileSizeUnit, CountUnit } from '../../../shared/types/unitConverision'
import {
    timeUnitToMs,
    fileSizeUnitToBytes,
    formatByteSize,
    countUnitToCount,
} from '../../../shared/utils/unitConverision'

describe('timeUnitToMs 时间单位转换', () => {
    it('毫秒应保持不变', () => {
        expect(timeUnitToMs(1000, TimeUnit.MILLISECOND)).toBe(1000)
        expect(timeUnitToMs(0, TimeUnit.MILLISECOND)).toBe(0)
    })

    it('秒转毫秒应正确', () => {
        expect(timeUnitToMs(1, TimeUnit.SECOND)).toBe(1000)
        expect(timeUnitToMs(5, TimeUnit.SECOND)).toBe(5000)
        expect(timeUnitToMs(0.5, TimeUnit.SECOND)).toBe(500)
    })

    it('分钟转毫秒应正确', () => {
        expect(timeUnitToMs(1, TimeUnit.MINUTE)).toBe(60000)
        expect(timeUnitToMs(5, TimeUnit.MINUTE)).toBe(300000)
    })

    it('小时转毫秒应正确', () => {
        expect(timeUnitToMs(1, TimeUnit.HOUR)).toBe(3600000)
        expect(timeUnitToMs(2, TimeUnit.HOUR)).toBe(7200000)
    })

    it('天转毫秒应正确', () => {
        expect(timeUnitToMs(1, TimeUnit.DAY)).toBe(86400000)
        expect(timeUnitToMs(7, TimeUnit.DAY)).toBe(604800000)
    })

    it('月转毫秒应正确', () => {
        expect(timeUnitToMs(1, TimeUnit.MONTH)).toBe(2592000000)
        expect(timeUnitToMs(2, TimeUnit.MONTH)).toBe(5184000000)
    })

    it('跨单位转换应正确', () => {
        expect(timeUnitToMs(1, TimeUnit.SECOND, TimeUnit.MINUTE)).toBeCloseTo(0.01667, 4)
        expect(timeUnitToMs(60000, TimeUnit.MILLISECOND, TimeUnit.MINUTE)).toBeCloseTo(1, 4)
        expect(timeUnitToMs(1, TimeUnit.HOUR, TimeUnit.SECOND)).toBeCloseTo(3600, 2)
    })

    it('默认输出单位为毫秒', () => {
        expect(timeUnitToMs(5, TimeUnit.SECOND)).toBe(5000)
    })

    it('相同单位转换应不变', () => {
        expect(timeUnitToMs(5, TimeUnit.SECOND, TimeUnit.SECOND)).toBe(5)
        expect(timeUnitToMs(100, TimeUnit.MILLISECOND, TimeUnit.MILLISECOND)).toBe(100)
        expect(timeUnitToMs(2, TimeUnit.MINUTE, TimeUnit.MINUTE)).toBe(2)
    })

    it('Property: 整数秒转毫秒往返应一致', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 100 }),
                (value) => {
                    const ms = timeUnitToMs(value, TimeUnit.SECOND)
                    const back = timeUnitToMs(ms, TimeUnit.MILLISECOND, TimeUnit.SECOND)
                    expect(back).toBeCloseTo(value, 2)
                }
            ),
            { numRuns: 50, seed: 12345 }
        )
    })
})

describe('fileSizeUnitToBytes 文件大小转换', () => {
    it('字节应保持不变', () => {
        expect(fileSizeUnitToBytes(1024, FileSizeUnit.BYTE)).toBe(1024)
        expect(fileSizeUnitToBytes(0, FileSizeUnit.BYTE)).toBe(0)
    })

    it('KB 转字节应正确', () => {
        expect(fileSizeUnitToBytes(1, FileSizeUnit.KB)).toBe(1024)
        expect(fileSizeUnitToBytes(5, FileSizeUnit.KB)).toBe(5120)
    })

    it('MB 转字节应正确', () => {
        expect(fileSizeUnitToBytes(1, FileSizeUnit.MB)).toBe(1048576)
        expect(fileSizeUnitToBytes(2, FileSizeUnit.MB)).toBe(2097152)
    })

    it('GB 转字节应正确', () => {
        expect(fileSizeUnitToBytes(1, FileSizeUnit.GB)).toBe(1073741824)
    })

    it('TB 转字节应正确', () => {
        expect(fileSizeUnitToBytes(1, FileSizeUnit.TB)).toBe(1099511627776)
    })

    it('跨单位转换应正确', () => {
        expect(fileSizeUnitToBytes(1, FileSizeUnit.MB, FileSizeUnit.KB)).toBeCloseTo(1024, 2)
        expect(fileSizeUnitToBytes(1024, FileSizeUnit.KB, FileSizeUnit.MB)).toBeCloseTo(1, 2)
        expect(fileSizeUnitToBytes(1, FileSizeUnit.GB, FileSizeUnit.MB)).toBeCloseTo(1024, 2)
    })

    it('小数转换应正确', () => {
        expect(fileSizeUnitToBytes(0.5, FileSizeUnit.KB, FileSizeUnit.BYTE)).toBeCloseTo(512, 0)
    })

    it('相同单位转换应不变', () => {
        expect(fileSizeUnitToBytes(100, FileSizeUnit.KB, FileSizeUnit.KB)).toBe(100)
        expect(fileSizeUnitToBytes(5, FileSizeUnit.MB, FileSizeUnit.MB)).toBe(5)
    })

    it('Property: KB 转字节往返应一致', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 100 }),
                (value) => {
                    const bytes = fileSizeUnitToBytes(value, FileSizeUnit.KB)
                    const back = fileSizeUnitToBytes(bytes, FileSizeUnit.BYTE, FileSizeUnit.KB)
                    expect(back).toBeCloseTo(value, 0)
                }
            ),
            { numRuns: 50, seed: 12345 }
        )
    })
})

describe('formatByteSize 字节大小格式化', () => {
    it('零应返回 0 Bytes', () => {
        expect(formatByteSize(0)).toBe('0 Bytes')
    })

    it('小于 1KB 应返回 Bytes', () => {
        expect(formatByteSize(512)).toBe('512 Bytes')
        expect(formatByteSize(1)).toBe('1 Bytes')
    })

    it('1KB 及以上应返回 KB', () => {
        expect(formatByteSize(1024)).toBe('1 KB')
        expect(formatByteSize(1536)).toBe('1.5 KB')
        expect(formatByteSize(2048)).toBe('2 KB')
    })

    it('1MB 及以上应返回 MB', () => {
        expect(formatByteSize(1048576)).toBe('1 MB')
        expect(formatByteSize(1572864)).toBe('1.5 MB')
    })

    it('1GB 及以上应返回 GB', () => {
        expect(formatByteSize(1073741824)).toBe('1 GB')
        expect(formatByteSize(2147483648)).toBe('2 GB')
    })

    it('1TB 及以上应返回 TB', () => {
        expect(formatByteSize(1099511627776)).toBe('1 TB')
    })

    it('toFixed 参数应控制小数位数', () => {
        expect(formatByteSize(1536, 1)).toBe('1.5 KB')
        expect(formatByteSize(1536, 2)).toBe('1.5 KB')
    })

    it('null 应返回 0 Bytes', () => {
        expect(formatByteSize(null)).toBe('0 Bytes')
    })

    it('undefined 应返回 0 Bytes', () => {
        expect(formatByteSize(undefined)).toBe('0 Bytes')
    })

    it('NaN 应返回 0 Bytes', () => {
        expect(formatByteSize(NaN)).toBe('0 Bytes')
    })

    it('Property: 非负数格式化应返回有效字符串', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 0, max: 1000000000 }),
                (bytes) => {
                    const result = formatByteSize(bytes)
                    expect(typeof result).toBe('string')
                    expect(result.length).toBeGreaterThan(0)
                }
            ),
            { numRuns: 100, seed: 12345 }
        )
    })
})

describe('countUnitToCount 次数单位转换', () => {
    it('默认输出应为 COUNT', () => {
        expect(countUnitToCount(10, CountUnit.COUNT)).toBe(10)
        expect(countUnitToCount(0, CountUnit.COUNT)).toBe(0)
    })

    it('相同单位转换应不变', () => {
        expect(countUnitToCount(100, CountUnit.COUNT, CountUnit.COUNT)).toBe(100)
    })
})
