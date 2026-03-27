/**
 * phone 工具函数测试
 *
 * 测试手机号和电话号码脱敏功能
 *
 * **Feature: phone-utils**
 * **Validates: 电话号码脱敏功能**
 */

import { describe, it, expect } from 'vitest'
import { maskPhone, maskTel, validatePhone } from '../../../shared/utils/phone'

describe('maskPhone 手机号脱敏', () => {
    it('标准手机号应正确脱敏', () => {
        expect(maskPhone('13812345678')).toBe('138****5678')
        expect(maskPhone('13900000000')).toBe('139****0000')
        expect(maskPhone('19912345678')).toBe('199****5678')
    })

    it('各种运营商号段应正确脱敏', () => {
        // 中国移动
        expect(maskPhone('13400000001')).toBe('134****0001')
        expect(maskPhone('14700000002')).toBe('147****0002')
        expect(maskPhone('15000000003')).toBe('150****0003')
        expect(maskPhone('15800000004')).toBe('158****0004')
        expect(maskPhone('17800000005')).toBe('178****0005')
        // 中国联通
        expect(maskPhone('13000000006')).toBe('130****0006')
        expect(maskPhone('13100000007')).toBe('131****0007')
        expect(maskPhone('14500000008')).toBe('145****0008')
        expect(maskPhone('15500000009')).toBe('155****0009')
        expect(maskPhone('18600000010')).toBe('186****0010')
        // 中国电信
        expect(maskPhone('13300000011')).toBe('133****0011')
        expect(maskPhone('15300000012')).toBe('153****0012')
        expect(maskPhone('17700000013')).toBe('177****0013')
        expect(maskPhone('18000000014')).toBe('180****0014')
        // 虚拟运营商
        expect(maskPhone('17000000015')).toBe('170****0015')
    })

    it('null 和 undefined 应返回原值', () => {
        expect(maskPhone(null as any)).toBe(null)
        expect(maskPhone(undefined as any)).toBe(undefined)
    })

    it('空字符串应返回空字符串', () => {
        expect(maskPhone('')).toBe('')
    })

    it('非字符串应返回原值', () => {
        expect(maskPhone(12345678901 as any)).toBe(12345678901)
        expect(maskPhone({} as any)).toStrictEqual({})
    })

    it('非法格式手机号应返回原值', () => {
        // 太短
        expect(maskPhone('138123456')).toBe('138123456')
        // 太长
        expect(maskPhone('138123456789')).toBe('138123456789')
        // 以0开头
        expect(maskPhone('013812345678')).toBe('013812345678')
        // 以2开头
        expect(maskPhone('22812345678')).toBe('22812345678')
        // 包含字母
        expect(maskPhone('138abcd5678')).toBe('138abcd5678')
        // 固定电话
        expect(maskPhone('010-12345678')).toBe('010-12345678')
    })
})

describe('maskTel 通用电话号码脱敏', () => {
    it('手机号应正确脱敏', () => {
        expect(maskTel('13812345678')).toBe('138****5678')
        expect(maskTel('19912345678')).toBe('199****5678')
    })

    it('普通固定电话应正确脱敏', () => {
        // 固定电话格式: 区号-号码(7-8位), 只脱敏区号后的4位
        expect(maskTel('010-12345678')).toBe('010-****5678')
        expect(maskTel('021-87654321')).toBe('021-****4321')
    })

    it('带分机号的固定电话应正确脱敏', () => {
        expect(maskTel('010-12345678-123')).toBe('010-12345678-123')
    })

    it('国际电话号码应正确脱敏', () => {
        // 正则只替换国家代码+区号后的4位数字
        expect(maskTel('+86-13812345678')).toBe('+86-****2345678')
        // +1-2125551234: 正则替换 +1-2125 和最后的 1234 → +1-****551234
        expect(maskTel('+1-2125551234')).toBe('+1-****551234')
    })

    it('null 和 undefined 应返回原值', () => {
        expect(maskTel(null as any)).toBe(null)
        expect(maskTel(undefined as any)).toBe(undefined)
    })

    it('空字符串应返回空字符串', () => {
        expect(maskTel('')).toBe('')
    })

    it('不支持格式的电话应返回原值', () => {
        expect(maskTel('12345')).toBe('12345')
        expect(maskTel('abcdefg')).toBe('abcdefg')
    })
})

describe('validatePhone 手机号验证', () => {
    it('标准手机号应返回 true', () => {
        expect(validatePhone('13812345678')).toBe(true)
        expect(validatePhone('13900000000')).toBe(true)
        expect(validatePhone('19912345678')).toBe(true)
        expect(validatePhone('16600000000')).toBe(true)
    })

    it('各种号段应返回 true', () => {
        // 移动
        expect(validatePhone('13400000001')).toBe(true)
        expect(validatePhone('14700000002')).toBe(true)
        expect(validatePhone('15000000003')).toBe(true)
        // 联通
        expect(validatePhone('13000000004')).toBe(true)
        expect(validatePhone('13100000005')).toBe(true)
        expect(validatePhone('15500000006')).toBe(true)
        expect(validatePhone('18600000007')).toBe(true)
        // 电信
        expect(validatePhone('13300000008')).toBe(true)
        expect(validatePhone('15300000009')).toBe(true)
        expect(validatePhone('17700000010')).toBe(true)
        expect(validatePhone('18000000011')).toBe(true)
        // 广电
        expect(validatePhone('19200000000')).toBe(true)
    })

    it('不正确格式应返回 false', () => {
        // 太短
        expect(validatePhone('138123456')).toBe(false)
        // 太长
        expect(validatePhone('138123456789')).toBe(false)
        // 以1开头但第二位不是3-9
        expect(validatePhone('10000000000')).toBe(false)
        expect(validatePhone('10200000000')).toBe(false)
        // 以0开头
        expect(validatePhone('013800000000')).toBe(false)
        // 非数字
        expect(validatePhone('138abcd5678')).toBe(false)
        expect(validatePhone('138 1234 5678')).toBe(false)
        // 固定电话
        expect(validatePhone('010-12345678')).toBe(false)
    })

    it('边界值应正确处理', () => {
        // 13800000000 - 10位数
        expect(validatePhone('13800000000')).toBe(true)
        // 19999999999 - 最大值
        expect(validatePhone('19999999999')).toBe(true)
    })
})
