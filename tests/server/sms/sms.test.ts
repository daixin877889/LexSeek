/**
 * 短信验证码模块测试
 *
 * 测试短信验证码 DAO 和验证服务功能
 *
 * **Feature: sms-module**
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4**
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import * as fc from 'fast-check'
import {
    testPrisma,
    connectTestDb,
    disconnectTestDb,
    TEST_USER_PHONE_PREFIX,
} from '../membership/test-db-helper'

// 导入实际的业务函数
import {
    createSmsRecordDao,
    findSmsRecordByPhoneAndTypeDao,
    deleteSmsRecordByIdDao,
} from '../../../server/services/sms/smsRecord.dao'

import {
    verifySmsCode,
    timingSafeEqual,
    isVerificationLocked,
    recordVerificationFailure,
    resetVerificationFailures,
    getVerificationFailureRecord,
    clearAllVerificationFailures,
} from '../../../server/services/sms/smsVerification.service'

// 导入短信类型枚举
import { SmsType } from '../../../shared/types/sms'

// 测试数据追踪
const createdSmsRecordIds: string[] = []

describe('短信验证码模块测试', () => {
    beforeAll(async () => {
        await connectTestDb()
    })

    afterAll(async () => {
        await disconnectTestDb()
    })

    beforeEach(() => {
        // 清除验证失败记录
        clearAllVerificationFailures()
    })

    afterEach(async () => {
        // 清理测试数据
        if (createdSmsRecordIds.length > 0) {
            await testPrisma.smsRecords.deleteMany({
                where: { id: { in: createdSmsRecordIds } },
            })
            createdSmsRecordIds.length = 0
        }

        // 清除验证失败记录
        clearAllVerificationFailures()
    })

    describe('短信验证码 DAO 测试', () => {
        describe('createSmsRecordDao - 创建短信验证码', () => {
            it('应能创建短信验证码记录', async () => {
                const timestamp = Date.now()
                const phone = `${TEST_USER_PHONE_PREFIX}${String(timestamp).slice(-8)}`
                const code = '123456'
                const codeExpireMs = 5 * 60 * 1000 // 5分钟

                const record = await createSmsRecordDao(phone, SmsType.LOGIN, code, codeExpireMs)
                createdSmsRecordIds.push(record.id)

                expect(record).toBeDefined()
                expect(record.phone).toBe(phone)
                expect(record.code).toBe(code)
                expect(record.type).toBe(SmsType.LOGIN)
                expect(record.expiredAt.getTime()).toBeGreaterThan(Date.now())
            })

            it('应能创建不同类型的验证码', async () => {
                const timestamp = Date.now()
                const phone = `${TEST_USER_PHONE_PREFIX}${String(timestamp).slice(-8)}`
                const codeExpireMs = 5 * 60 * 1000

                // 登录验证码
                const loginRecord = await createSmsRecordDao(phone, SmsType.LOGIN, '111111', codeExpireMs)
                createdSmsRecordIds.push(loginRecord.id)
                expect(loginRecord.type).toBe(SmsType.LOGIN)

                // 注册验证码
                const registerRecord = await createSmsRecordDao(phone, SmsType.REGISTER, '222222', codeExpireMs)
                createdSmsRecordIds.push(registerRecord.id)
                expect(registerRecord.type).toBe(SmsType.REGISTER)

                // 重置密码验证码
                const resetRecord = await createSmsRecordDao(phone, SmsType.RESET_PASSWORD, '333333', codeExpireMs)
                createdSmsRecordIds.push(resetRecord.id)
                expect(resetRecord.type).toBe(SmsType.RESET_PASSWORD)
            })
        })

        describe('findSmsRecordByPhoneAndTypeDao - 查询短信验证码', () => {
            it('应能通过手机号和类型查询验证码', async () => {
                const timestamp = Date.now()
                const phone = `${TEST_USER_PHONE_PREFIX}${String(timestamp).slice(-8)}`
                const code = '654321'
                const codeExpireMs = 5 * 60 * 1000

                const created = await createSmsRecordDao(phone, SmsType.LOGIN, code, codeExpireMs)
                createdSmsRecordIds.push(created.id)

                const found = await findSmsRecordByPhoneAndTypeDao(phone, SmsType.LOGIN)

                expect(found).not.toBeNull()
                expect(found?.phone).toBe(phone)
                expect(found?.code).toBe(code)
            })

            it('查询不存在的记录应返回 null', async () => {
                const found = await findSmsRecordByPhoneAndTypeDao('19900000000', SmsType.LOGIN)
                expect(found).toBeNull()
            })

            it('不同类型的验证码应独立查询', async () => {
                const timestamp = Date.now()
                const phone = `${TEST_USER_PHONE_PREFIX}${String(timestamp).slice(-8)}`
                const codeExpireMs = 5 * 60 * 1000

                // 创建登录验证码
                const loginRecord = await createSmsRecordDao(phone, SmsType.LOGIN, '111111', codeExpireMs)
                createdSmsRecordIds.push(loginRecord.id)

                // 创建注册验证码
                const registerRecord = await createSmsRecordDao(phone, SmsType.REGISTER, '222222', codeExpireMs)
                createdSmsRecordIds.push(registerRecord.id)

                // 查询登录验证码
                const foundLogin = await findSmsRecordByPhoneAndTypeDao(phone, SmsType.LOGIN)
                expect(foundLogin?.code).toBe('111111')

                // 查询注册验证码
                const foundRegister = await findSmsRecordByPhoneAndTypeDao(phone, SmsType.REGISTER)
                expect(foundRegister?.code).toBe('222222')
            })
        })

        describe('deleteSmsRecordByIdDao - 删除短信验证码', () => {
            it('应能删除验证码记录', async () => {
                const timestamp = Date.now()
                const phone = `${TEST_USER_PHONE_PREFIX}${String(timestamp).slice(-8)}`
                const codeExpireMs = 5 * 60 * 1000

                const record = await createSmsRecordDao(phone, SmsType.LOGIN, '123456', codeExpireMs)

                // 删除
                const result = await deleteSmsRecordByIdDao(record.id)
                expect(result).toBe(true)

                // 验证已删除
                const found = await findSmsRecordByPhoneAndTypeDao(phone, SmsType.LOGIN)
                expect(found).toBeNull()
            })
        })
    })

    describe('时间安全字符串比较测试', () => {
        it('相同字符串应返回 true', () => {
            expect(timingSafeEqual('123456', '123456')).toBe(true)
            expect(timingSafeEqual('', '')).toBe(true)
            expect(timingSafeEqual('abc', 'abc')).toBe(true)
        })

        it('不同字符串应返回 false', () => {
            expect(timingSafeEqual('123456', '654321')).toBe(false)
            expect(timingSafeEqual('abc', 'abd')).toBe(false)
            expect(timingSafeEqual('short', 'longer')).toBe(false)
        })

        it('长度不同的字符串应返回 false', () => {
            expect(timingSafeEqual('12345', '123456')).toBe(false)
            expect(timingSafeEqual('1234567', '123456')).toBe(false)
        })
    })

    describe('验证失败锁定机制测试', () => {
        it('初始状态不应被锁定', async () => {
            const phone = `${TEST_USER_PHONE_PREFIX}00000001`
            const locked = await isVerificationLocked(phone, SmsType.LOGIN)
            expect(locked).toBe(false)
        })

        it('记录验证失败应增加失败计数', async () => {
            const phone = `${TEST_USER_PHONE_PREFIX}00000002`

            await recordVerificationFailure(phone, SmsType.LOGIN)

            const record = getVerificationFailureRecord(phone, SmsType.LOGIN)
            expect(record).toBeDefined()
            expect(record?.count).toBe(1)
        })

        it('重置失败计数应清除记录', async () => {
            const phone = `${TEST_USER_PHONE_PREFIX}00000003`

            await recordVerificationFailure(phone, SmsType.LOGIN)
            await recordVerificationFailure(phone, SmsType.LOGIN)

            let record = getVerificationFailureRecord(phone, SmsType.LOGIN)
            expect(record?.count).toBe(2)

            await resetVerificationFailures(phone, SmsType.LOGIN)

            record = getVerificationFailureRecord(phone, SmsType.LOGIN)
            expect(record).toBeUndefined()
        })
    })

    describe('Property: 时间安全比较对称性', () => {
        it('比较结果应与参数顺序无关', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 0, maxLength: 20 }),
                    fc.string({ minLength: 0, maxLength: 20 }),
                    (a, b) => {
                        const result1 = timingSafeEqual(a, b)
                        const result2 = timingSafeEqual(b, a)
                        expect(result1).toBe(result2)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('Property: 时间安全比较自反性', () => {
        it('任意字符串与自身比较应返回 true', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 0, maxLength: 50 }),
                    (s) => {
                        expect(timingSafeEqual(s, s)).toBe(true)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('Property: 验证码 CRUD 往返一致性', () => {
        it('创建的验证码应能被正确查询到', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.stringMatching(/^[0-9]{6}$/), // 6位数字验证码
                    fc.constantFrom(SmsType.LOGIN, SmsType.REGISTER, SmsType.RESET_PASSWORD),
                    async (code, type) => {
                        const timestamp = Date.now()
                        const random = Math.floor(Math.random() * 10000)
                        const phone = `${TEST_USER_PHONE_PREFIX}${String(timestamp).slice(-4)}${String(random).padStart(4, '0')}`
                        const codeExpireMs = 5 * 60 * 1000

                        // 创建
                        const record = await createSmsRecordDao(phone, type, code, codeExpireMs)
                        createdSmsRecordIds.push(record.id)

                        // 查询
                        const found = await findSmsRecordByPhoneAndTypeDao(phone, type)

                        // 验证
                        expect(found).not.toBeNull()
                        expect(found?.code).toBe(code)
                        expect(found?.type).toBe(type)
                    }
                ),
                { numRuns: 10 }
            )
        })
    })
})
