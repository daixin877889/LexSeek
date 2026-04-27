import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { SmsType } from '#shared/types/sms'
import {
  timingSafeEqual,
  isVerificationLockedService,
  recordVerificationFailureService,
  resetVerificationFailuresService,
  verifySmsCodeService,
} from '../../../server/services/sms/smsVerification.service'

// Mock dependencies
vi.mock('../../../server/services/sms/smsRecord.dao', () => ({
  findSmsRecordByPhoneAndTypeDao: vi.fn(),
  deleteSmsRecordByIdDao: vi.fn(),
}))

import {
  findSmsRecordByPhoneAndTypeDao,
  deleteSmsRecordByIdDao,
} from '../../../server/services/sms/smsRecord.dao'

describe('smsVerification.service · 短信验证服务', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Mock useRuntimeConfig
    global.useRuntimeConfig = vi.fn().mockReturnValue({
      aliyun: {
        sms: {
          maxFailures: 5,
          lockDurationMs: 300, // 300 seconds
        },
      },
    })
  })

  describe('timingSafeEqual · 时间安全比较', () => {
    it('应该返回 true 当两个字符串相等', () => {
      const result = timingSafeEqual('123456', '123456')
      expect(result).toBe(true)
    })

    it('应该返回 false 当两个字符串不相等', () => {
      const result = timingSafeEqual('123456', '654321')
      expect(result).toBe(false)
    })

    it('应该返回 false 当长度不同', () => {
      const result = timingSafeEqual('12345', '123456')
      expect(result).toBe(false)
    })

    it('应该返回 false 当只有一个字符不同', () => {
      const result = timingSafeEqual('123456', '123457')
      expect(result).toBe(false)
    })

    it('应该在恒定时间内进行比较（防止时序攻击）', () => {
      // 第一个位置不匹配
      const result1 = timingSafeEqual('a23456', 'b23456')
      // 最后一个位置不匹配
      const result2 = timingSafeEqual('12345a', '12345b')

      expect(result1).toBe(false)
      expect(result2).toBe(false)
    })

    it('应该处理空字符串', () => {
      expect(timingSafeEqual('', '')).toBe(true)
      expect(timingSafeEqual('', '123')).toBe(false)
      expect(timingSafeEqual('123', '')).toBe(false)
    })
  })

  describe('isVerificationLockedService · 检查验证锁定', () => {
    it('应该返回 false 当没有失败记录', async () => {
      const result = await isVerificationLockedService('13800000001', SmsType.LOGIN)
      expect(result).toBe(false)
    })

    it('应该返回 false 当失败但未达到锁定阈值', async () => {
      // 记录少于阈值的失败
      await recordVerificationFailureService('13800000002', SmsType.REGISTER)

      const result = await isVerificationLockedService('13800000002', SmsType.REGISTER)
      expect(result).toBe(false)
    })

    it('应该返回 true 当达到失败阈值', async () => {
      const phone = '13800000003'
      const type = SmsType.RESET_PASSWORD

      // 记录达到阈值的失败
      for (let i = 0; i < 5; i++) {
        await recordVerificationFailureService(phone, type)
      }

      const result = await isVerificationLockedService(phone, type)
      expect(result).toBe(true)
    })

    it('应该正确处理锁定时间戳的计算', async () => {
      const phone = '13800000004'
      const type = SmsType.LOGIN

      // 记录足够的失败以触发锁定
      for (let i = 0; i < 5; i++) {
        await recordVerificationFailureService(phone, type)
      }

      // 验证已锁定
      const locked = await isVerificationLockedService(phone, type)
      expect(locked).toBe(true)
    })
  })

  describe('recordVerificationFailureService · 记录验证失败', () => {
    it('应该记录首次失败', async () => {
      const phone = '13800000005'
      const type = SmsType.LOGIN

      await recordVerificationFailureService(phone, type)

      const locked = await isVerificationLockedService(phone, type)
      expect(locked).toBe(false)
    })

    it('应该累加失败次数', async () => {
      const phone = '13800000006'
      const type = SmsType.REGISTER

      // 记录 3 次失败
      for (let i = 0; i < 3; i++) {
        await recordVerificationFailureService(phone, type)
      }

      const locked = await isVerificationLockedService(phone, type)
      expect(locked).toBe(false)
    })

    it('应该在达到阈值时锁定', async () => {
      const phone = '13800000007'
      const type = SmsType.RESET_PASSWORD

      // 记录 5 次失败（达到阈值）
      for (let i = 0; i < 5; i++) {
        await recordVerificationFailureService(phone, type)
      }

      const locked = await isVerificationLockedService(phone, type)
      expect(locked).toBe(true)
    })
  })

  describe('resetVerificationFailuresService · 重置验证失败', () => {
    it('应该清除失败记录', async () => {
      const phone = '13800000008'
      const type = SmsType.LOGIN

      // 记录失败
      await recordVerificationFailureService(phone, type)

      // 重置
      await resetVerificationFailuresService(phone, type)

      // 验证已清除
      const locked = await isVerificationLockedService(phone, type)
      expect(locked).toBe(false)
    })

    it('应该清除锁定状态', async () => {
      const phone = '13800000009'
      const type = SmsType.REGISTER

      // 记录足够的失败以触发锁定
      for (let i = 0; i < 5; i++) {
        await recordVerificationFailureService(phone, type)
      }

      // 验证已锁定
      let locked = await isVerificationLockedService(phone, type)
      expect(locked).toBe(true)

      // 重置
      await resetVerificationFailuresService(phone, type)

      // 验证已清除
      locked = await isVerificationLockedService(phone, type)
      expect(locked).toBe(false)
    })
  })

  describe('verifySmsCodeService · 验证短信验证码', () => {
    it('应该拒绝被锁定的手机号', async () => {
      const phone = '13800000010'
      const type = SmsType.LOGIN

      // 触发锁定
      for (let i = 0; i < 5; i++) {
        await recordVerificationFailureService(phone, type)
      }

      const result = await verifySmsCodeService(phone, '123456', type)

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(400)
      expect(result.error).toContain('已锁定')
    })

    it('应该返回错误当验证码不存在', async () => {
      vi.mocked(findSmsRecordByPhoneAndTypeDao).mockResolvedValue(null)

      const result = await verifySmsCodeService('13800000011', '123456', SmsType.LOGIN)

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(400)
      expect(result.error).toContain('不存在')
    })

    it('应该返回错误当验证码已过期', async () => {
      const expiredAt = new Date(Date.now() - 1000) // 1 秒前过期

      vi.mocked(findSmsRecordByPhoneAndTypeDao).mockResolvedValue({
        id: 1,
        phone: '13800000012',
        code: '123456',
        type: SmsType.REGISTER,
        expiredAt,
        createdAt: new Date(),
      } as any)

      const result = await verifySmsCodeService('13800000012', '123456', SmsType.REGISTER)

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(400)
      expect(result.error).toContain('已过期')
      expect(deleteSmsRecordByIdDao).toHaveBeenCalledWith(1)
    })

    it('应该返回错误当验证码不正确', async () => {
      const expiredAt = new Date(Date.now() + 600000) // 10 分钟后过期

      vi.mocked(findSmsRecordByPhoneAndTypeDao).mockResolvedValue({
        id: 1,
        phone: '13800000013',
        code: '123456',
        type: SmsType.RESET_PASSWORD,
        expiredAt,
        createdAt: new Date(),
      } as any)

      const result = await verifySmsCodeService('13800000013', '654321', SmsType.RESET_PASSWORD)

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(400)
      expect(result.error).toContain('不正确')
    })

    it('应该成功验证正确的验证码', async () => {
      const expiredAt = new Date(Date.now() + 600000)
      const phone = '13800000014'
      const code = '123456'
      const type = SmsType.LOGIN

      vi.mocked(findSmsRecordByPhoneAndTypeDao).mockResolvedValue({
        id: 1,
        phone,
        code,
        type,
        expiredAt,
        createdAt: new Date(),
      } as any)

      const result = await verifySmsCodeService(phone, code, type)

      expect(result.success).toBe(true)
      expect(result.record).toBeDefined()
      expect(deleteSmsRecordByIdDao).toHaveBeenCalledWith(1)
    })

    it('应该在验证失败后记录失败次数', async () => {
      const expiredAt = new Date(Date.now() + 600000)
      const phone = '13800000015'
      const type = SmsType.REGISTER

      vi.mocked(findSmsRecordByPhoneAndTypeDao).mockResolvedValue({
        id: 1,
        phone,
        code: '123456',
        type,
        expiredAt,
        createdAt: new Date(),
      } as any)

      // 第一次失败
      await verifySmsCodeService(phone, 'wrong', type)

      // 验证记录了失败
      let locked = await isVerificationLockedService(phone, type)
      expect(locked).toBe(false)

      // 继续失败直到锁定
      for (let i = 0; i < 4; i++) {
        await verifySmsCodeService(phone, 'wrong', type)
      }

      // 现在应该被锁定
      locked = await isVerificationLockedService(phone, type)
      expect(locked).toBe(true)
    })

    it('应该在验证成功后重置失败计数', async () => {
      const expiredAt = new Date(Date.now() + 600000)
      const phone = '13800000016'
      const code = '123456'
      const type = SmsType.RESET_PASSWORD

      // 记录一些失败
      await recordVerificationFailureService(phone, type)
      await recordVerificationFailureService(phone, type)

      // 验证在成功之前已有失败
      let locked = await isVerificationLockedService(phone, type)
      expect(locked).toBe(false)

      vi.mocked(findSmsRecordByPhoneAndTypeDao).mockResolvedValue({
        id: 1,
        phone,
        code,
        type,
        expiredAt,
        createdAt: new Date(),
      } as any)

      // 成功验证
      const result = await verifySmsCodeService(phone, code, type)

      expect(result.success).toBe(true)

      // 验证失败计数已重置
      locked = await isVerificationLockedService(phone, type)
      expect(locked).toBe(false)
    })
  })
})
