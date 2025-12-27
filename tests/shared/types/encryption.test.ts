/**
 * 加密类型定义测试
 *
 * 测试自定义错误类的行为
 *
 * **Feature: encryption-types**
 * **Validates: Requirements 6.1, 6.2**
 */

import { describe, it, expect } from 'vitest'
import {
    IdentityNotUnlockedError,
    IdentityMismatchError,
    FileCorruptedError,
    InvalidAgeFileError,
    WrongPasswordError,
} from '../../../shared/types/encryption'

describe('IdentityNotUnlockedError 私钥未解锁错误', () => {
    it('应正确设置错误名称', () => {
        const error = new IdentityNotUnlockedError()
        expect(error.name).toBe('IdentityNotUnlockedError')
    })

    it('应正确设置错误消息', () => {
        const error = new IdentityNotUnlockedError()
        expect(error.message).toBe('私钥未解锁，请先输入加密密码')
    })

    it('应继承自 Error', () => {
        const error = new IdentityNotUnlockedError()
        expect(error).toBeInstanceOf(Error)
    })
})

describe('IdentityMismatchError 私钥不匹配错误', () => {
    it('应正确设置错误名称', () => {
        const error = new IdentityMismatchError()
        expect(error.name).toBe('IdentityMismatchError')
    })

    it('应正确设置错误消息', () => {
        const error = new IdentityMismatchError()
        expect(error.message).toBe('私钥不匹配，无法解密此文件')
    })

    it('应继承自 Error', () => {
        const error = new IdentityMismatchError()
        expect(error).toBeInstanceOf(Error)
    })
})

describe('FileCorruptedError 文件损坏错误', () => {
    it('应正确设置错误名称', () => {
        const error = new FileCorruptedError()
        expect(error.name).toBe('FileCorruptedError')
    })

    it('应正确设置错误消息', () => {
        const error = new FileCorruptedError()
        expect(error.message).toBe('文件已损坏，无法解密')
    })

    it('应继承自 Error', () => {
        const error = new FileCorruptedError()
        expect(error).toBeInstanceOf(Error)
    })
})

describe('InvalidAgeFileError 无效 age 文件错误', () => {
    it('应正确设置错误名称', () => {
        const error = new InvalidAgeFileError()
        expect(error.name).toBe('InvalidAgeFileError')
    })

    it('应正确设置错误消息', () => {
        const error = new InvalidAgeFileError()
        expect(error.message).toBe('无效的加密文件格式')
    })

    it('应继承自 Error', () => {
        const error = new InvalidAgeFileError()
        expect(error).toBeInstanceOf(Error)
    })
})

describe('WrongPasswordError 密码错误', () => {
    it('应正确设置错误名称', () => {
        const error = new WrongPasswordError()
        expect(error.name).toBe('WrongPasswordError')
    })

    it('应正确设置错误消息', () => {
        const error = new WrongPasswordError()
        expect(error.message).toBe('加密密码错误，请重试')
    })

    it('应继承自 Error', () => {
        const error = new WrongPasswordError()
        expect(error).toBeInstanceOf(Error)
    })
})

describe('Property: 所有加密错误都应继承自 Error', () => {
    it('所有错误类型都应有正确的继承链', () => {
        const errors = [
            new IdentityNotUnlockedError(),
            new IdentityMismatchError(),
            new FileCorruptedError(),
            new InvalidAgeFileError(),
            new WrongPasswordError(),
        ]

        errors.forEach(error => {
            expect(error).toBeInstanceOf(Error)
            expect(error.name).toBeDefined()
            expect(error.message).toBeDefined()
            expect(typeof error.name).toBe('string')
            expect(typeof error.message).toBe('string')
        })
    })
})
