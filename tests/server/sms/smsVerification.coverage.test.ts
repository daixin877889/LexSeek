/**
 * 短信验证服务补充覆盖率测试
 *
 * 覆盖 verifySmsCodeService 的完整流程（验证成功、锁定机制、过期验证码）
 *
 * **Feature: sms-module**
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import {
    testPrisma,
    connectTestDb,
    disconnectTestDb,
    TEST_USER_PHONE_PREFIX,
} from '../membership/test-db-helper'
import {
    createSmsRecordDao,
    findSmsRecordByPhoneAndTypeDao,
    deleteSmsRecordByIdDao,
} from '../../../server/services/sms/smsRecord.dao'
import {
    timingSafeEqual,
    isVerificationLockedService,
    recordVerificationFailureService,
    resetVerificationFailuresService,
    getVerificationFailureRecord,
    clearAllVerificationFailures,
} from '../../../server/services/sms/smsVerification.service'
import { SmsType } from '../../../shared/types/sms'

const createdSmsRecordIds: string[] = []

// verifySmsCodeService 内部依赖自动导入的全局函数，
// 我们需要将 DAO 函数 stub 到全局
vi.stubGlobal('findSmsRecordByPhoneAndTypeDao', findSmsRecordByPhoneAndTypeDao)
vi.stubGlobal('deleteSmsRecordByIdDao', deleteSmsRecordByIdDao)

// 导入 verifySmsCodeService（在全局 stub 之后）
const { verifySmsCodeService } = await import(
    '../../../server/services/sms/smsVerification.service'
)

describe('短信验证服务补充覆盖率', () => {
    beforeAll(async () => {
        await connectTestDb()
    })

    afterAll(async () => {
        await disconnectTestDb()
    })

    beforeEach(() => {
        clearAllVerificationFailures()
    })

    afterEach(async () => {
        if (createdSmsRecordIds.length > 0) {
            await testPrisma.smsRecords.deleteMany({
                where: { id: { in: createdSmsRecordIds } },
            })
            createdSmsRecordIds.length = 0
        }
        clearAllVerificationFailures()
    })

    describe('verifySmsCodeService - 完整流程', () => {
        it('验证成功应删除记录并重置失败计数', async () => {
            const phone = `${TEST_USER_PHONE_PREFIX}${Date.now().toString().slice(-8)}`
            const code = '888888'
            const codeExpireMs = 5 * 60 * 1000

            const record = await createSmsRecordDao(phone, SmsType.LOGIN, code, codeExpireMs)
            createdSmsRecordIds.push(record.id)

            // 先记录一次失败（确保成功后会被重置）
            await recordVerificationFailureService(phone, SmsType.LOGIN)

            const result = await verifySmsCodeService(phone, code, SmsType.LOGIN)

            expect(result.success).toBe(true)
            expect(result.record).toBeDefined()
            expect(result.record!.code).toBe(code)

            // 验证记录已被删除
            const found = await findSmsRecordByPhoneAndTypeDao(phone, SmsType.LOGIN)
            expect(found).toBeNull()

            // 失败计数已重置
            const failRecord = getVerificationFailureRecord(phone, SmsType.LOGIN)
            expect(failRecord).toBeUndefined()

            // 从追踪列表移除（已被 service 删除）
            const idx = createdSmsRecordIds.indexOf(record.id)
            if (idx >= 0) createdSmsRecordIds.splice(idx, 1)
        })

        it('验证码不存在应返回失败', async () => {
            const phone = `${TEST_USER_PHONE_PREFIX}${Date.now().toString().slice(-8)}`

            const result = await verifySmsCodeService(phone, '123456', SmsType.LOGIN)

            expect(result.success).toBe(false)
            expect(result.error).toContain('验证码不存在')
            expect(result.errorCode).toBe(400)
        })

        it('过期的验证码应返回失败并删除记录', async () => {
            const phone = `${TEST_USER_PHONE_PREFIX}${Date.now().toString().slice(-8)}`
            const code = '999999'

            // 创建已过期的验证码（过期时间设为 1ms）
            const record = await createSmsRecordDao(phone, SmsType.LOGIN, code, 1)
            createdSmsRecordIds.push(record.id)

            // 等待过期
            await new Promise(r => setTimeout(r, 10))

            const result = await verifySmsCodeService(phone, code, SmsType.LOGIN)

            expect(result.success).toBe(false)
            expect(result.error).toContain('过期')

            // 从追踪列表移除（已被 service 删除）
            const idx = createdSmsRecordIds.indexOf(record.id)
            if (idx >= 0) createdSmsRecordIds.splice(idx, 1)
        })

        it('验证码不正确应记录失败', async () => {
            const phone = `${TEST_USER_PHONE_PREFIX}${Date.now().toString().slice(-8)}`
            const code = '777777'
            const codeExpireMs = 5 * 60 * 1000

            const record = await createSmsRecordDao(phone, SmsType.LOGIN, code, codeExpireMs)
            createdSmsRecordIds.push(record.id)

            const result = await verifySmsCodeService(phone, '000000', SmsType.LOGIN)

            expect(result.success).toBe(false)
            expect(result.error).toContain('不正确')

            // 验证失败计数增加
            const failRecord = getVerificationFailureRecord(phone, SmsType.LOGIN)
            expect(failRecord).toBeDefined()
            expect(failRecord!.count).toBe(1)
        })

        it('被锁定时应直接返回失败', async () => {
            const phone = `${TEST_USER_PHONE_PREFIX}${Date.now().toString().slice(-8)}`
            const codeExpireMs = 5 * 60 * 1000

            const record = await createSmsRecordDao(phone, SmsType.LOGIN, '111111', codeExpireMs)
            createdSmsRecordIds.push(record.id)

            // 多次失败触发锁定（默认 5 次）
            for (let i = 0; i < 5; i++) {
                await recordVerificationFailureService(phone, SmsType.LOGIN)
            }

            const locked = await isVerificationLockedService(phone, SmsType.LOGIN)
            expect(locked).toBe(true)

            const result = await verifySmsCodeService(phone, '111111', SmsType.LOGIN)
            expect(result.success).toBe(false)
            expect(result.error).toContain('锁定')
        })
    })

    describe('锁定过期场景', () => {
        it('锁定过期后应自动解除', async () => {
            const phone = `${TEST_USER_PHONE_PREFIX}${Date.now().toString().slice(-8)}`

            // 触发锁定
            for (let i = 0; i < 5; i++) {
                await recordVerificationFailureService(phone, SmsType.REGISTER)
            }

            let locked = await isVerificationLockedService(phone, SmsType.REGISTER)
            expect(locked).toBe(true)

            // 清除后解除
            clearAllVerificationFailures()
            locked = await isVerificationLockedService(phone, SmsType.REGISTER)
            expect(locked).toBe(false)
        })
    })

    describe('失败计数递增', () => {
        it('多次验证失败应累计计数', async () => {
            const phone = `${TEST_USER_PHONE_PREFIX}${Date.now().toString().slice(-8)}`
            const codeExpireMs = 5 * 60 * 1000

            const record = await createSmsRecordDao(phone, SmsType.LOGIN, '555555', codeExpireMs)
            createdSmsRecordIds.push(record.id)

            // 3 次验证错误
            await verifySmsCodeService(phone, '000001', SmsType.LOGIN)
            await verifySmsCodeService(phone, '000002', SmsType.LOGIN)
            await verifySmsCodeService(phone, '000003', SmsType.LOGIN)

            const failRecord = getVerificationFailureRecord(phone, SmsType.LOGIN)
            expect(failRecord).toBeDefined()
            expect(failRecord!.count).toBe(3)
        })
    })

    describe('timingSafeEqual 补充', () => {
        it('相同长度但不同内容应返回 false', () => {
            expect(timingSafeEqual('abcdef', 'abcdeg')).toBe(false)
        })

        it('特殊字符比较', () => {
            expect(timingSafeEqual('!@#$%^', '!@#$%^')).toBe(true)
            expect(timingSafeEqual('!@#$%^', '!@#$%&')).toBe(false)
        })

        it('数字字符串比较', () => {
            expect(timingSafeEqual('123456', '123456')).toBe(true)
            expect(timingSafeEqual('123456', '123457')).toBe(false)
        })
    })
})
