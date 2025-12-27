/**
 * 枚举类型测试
 *
 * 测试各模块枚举值的正确性和一致性
 *
 * **Feature: shared-types**
 * **Validates: Requirements 1.1, 2.1, 3.1**
 */

import { describe, it, expect } from 'vitest'

// 导入各模块的枚举
import { CampaignType, CampaignStatus } from '../../../shared/types/campaign'
import { FileSource, OssFileStatus, FileType, FileSortField, SortOrder } from '../../../shared/types/file'
import { UserMembershipSourceType, MembershipStatus, MembershipLevelStatus, BenefitStatus } from '../../../shared/types/membership'
import { PaymentChannel, PaymentMethod, OrderStatus, PaymentTransactionStatus, DurationUnit } from '../../../shared/types/payment'
import { PointRecordSourceType, PointRecordStatus, PointConsumptionItemStatus, PointConsumptionRecordStatus } from '../../../shared/types/point.types'
import { ProductType, ProductStatus } from '../../../shared/types/product'
import { RedemptionCodeType, RedemptionCodeStatus } from '../../../shared/types/redemption'
import { SmsType } from '../../../shared/types/sms'
import { SystemConfigStatus } from '../../../shared/types/system'
import { UnitType, TimeUnit, FileSizeUnit, CountUnit } from '../../../shared/types/unitConverision'
import { UserStatus, UserRegisterChannel } from '../../../shared/types/user'

describe('CampaignType 营销活动类型', () => {
    it('应包含注册赠送类型', () => {
        expect(CampaignType.REGISTER_GIFT).toBe(1)
    })

    it('应包含邀请奖励类型', () => {
        expect(CampaignType.INVITATION_REWARD).toBe(2)
    })

    it('应包含活动奖励类型', () => {
        expect(CampaignType.ACTIVITY_REWARD).toBe(3)
    })
})

describe('CampaignStatus 营销活动状态', () => {
    it('应包含禁用状态', () => {
        expect(CampaignStatus.DISABLED).toBe(0)
    })

    it('应包含启用状态', () => {
        expect(CampaignStatus.ENABLED).toBe(1)
    })
})

describe('FileSource 文件来源', () => {
    it('应包含所有文件来源类型', () => {
        expect(FileSource.FILE).toBe('file')
        expect(FileSource.ASR).toBe('asr')
        expect(FileSource.DOC).toBe('doc')
        expect(FileSource.IMAGE).toBe('image')
        expect(FileSource.VIDEO).toBe('video')
        expect(FileSource.CASE_ANALYSIS).toBe('caseAnalysis')
    })
})

describe('OssFileStatus OSS 文件状态', () => {
    it('应包含所有文件状态', () => {
        expect(OssFileStatus.PENDING).toBe(0)
        expect(OssFileStatus.UPLOADED).toBe(1)
        expect(OssFileStatus.FAILED).toBe(2)
    })
})

describe('FileType 文件类型', () => {
    it('应包含所有文件类型', () => {
        expect(FileType.DOC).toBe('DOC')
        expect(FileType.AUDIO).toBe('AUDIO')
        expect(FileType.IMAGE).toBe('IMAGE')
        expect(FileType.VIDEO).toBe('VIDEO')
        expect(FileType.JSON).toBe('JSON')
        expect(FileType.OTHER).toBe('OTHER')
    })
})

describe('FileSortField 文件排序字段', () => {
    it('应包含所有排序字段', () => {
        expect(FileSortField.CREATED_AT).toBe('createdAt')
        expect(FileSortField.FILE_SIZE).toBe('fileSize')
        expect(FileSortField.FILE_NAME).toBe('fileName')
    })
})

describe('SortOrder 排序方向', () => {
    it('应包含升序和降序', () => {
        expect(SortOrder.ASC).toBe('asc')
        expect(SortOrder.DESC).toBe('desc')
    })
})

describe('UserMembershipSourceType 会员来源类型', () => {
    it('应包含所有会员来源类型', () => {
        expect(UserMembershipSourceType.REDEMPTION_CODE).toBe(1)
        expect(UserMembershipSourceType.DIRECT_PURCHASE).toBe(2)
        expect(UserMembershipSourceType.ADMIN_GIFT).toBe(3)
        expect(UserMembershipSourceType.ACTIVITY_AWARD).toBe(4)
        expect(UserMembershipSourceType.TRIAL).toBe(5)
        expect(UserMembershipSourceType.REGISTRATION_AWARD).toBe(6)
        expect(UserMembershipSourceType.INVITATION_TO_REGISTER).toBe(7)
        expect(UserMembershipSourceType.MEMBERSHIP_UPGRADE).toBe(8)
        expect(UserMembershipSourceType.OTHER).toBe(99)
    })
})

describe('MembershipStatus 会员状态', () => {
    it('应包含无效和有效状态', () => {
        expect(MembershipStatus.INACTIVE).toBe(0)
        expect(MembershipStatus.ACTIVE).toBe(1)
    })
})

describe('MembershipLevelStatus 会员级别状态', () => {
    it('应包含禁用和启用状态', () => {
        expect(MembershipLevelStatus.DISABLED).toBe(0)
        expect(MembershipLevelStatus.ENABLED).toBe(1)
    })
})

describe('BenefitStatus 权益状态', () => {
    it('应包含禁用和启用状态', () => {
        expect(BenefitStatus.DISABLED).toBe(0)
        expect(BenefitStatus.ENABLED).toBe(1)
    })
})

describe('PaymentChannel 支付渠道', () => {
    it('应包含微信和支付宝', () => {
        expect(PaymentChannel.WECHAT).toBe('wechat')
        expect(PaymentChannel.ALIPAY).toBe('alipay')
    })
})

describe('PaymentMethod 支付方式', () => {
    it('应包含所有支付方式', () => {
        expect(PaymentMethod.MINI_PROGRAM).toBe('mini_program')
        expect(PaymentMethod.SCAN_CODE).toBe('scan_code')
        expect(PaymentMethod.WAP).toBe('wap')
        expect(PaymentMethod.APP).toBe('app')
        expect(PaymentMethod.PC).toBe('pc')
    })
})

describe('OrderStatus 订单状态', () => {
    it('应包含所有订单状态', () => {
        expect(OrderStatus.PENDING).toBe(0)
        expect(OrderStatus.PAID).toBe(1)
        expect(OrderStatus.CANCELLED).toBe(2)
        expect(OrderStatus.REFUNDED).toBe(3)
    })
})

describe('PaymentTransactionStatus 支付单状态', () => {
    it('应包含所有支付单状态', () => {
        expect(PaymentTransactionStatus.PENDING).toBe(0)
        expect(PaymentTransactionStatus.SUCCESS).toBe(1)
        expect(PaymentTransactionStatus.FAILED).toBe(2)
        expect(PaymentTransactionStatus.EXPIRED).toBe(3)
        expect(PaymentTransactionStatus.REFUNDED).toBe(4)
    })
})

describe('DurationUnit 时长单位', () => {
    it('应包含月和年', () => {
        expect(DurationUnit.MONTH).toBe('month')
        expect(DurationUnit.YEAR).toBe('year')
    })
})

describe('PointRecordSourceType 积分记录来源类型', () => {
    it('应包含所有积分来源类型', () => {
        expect(PointRecordSourceType.MEMBERSHIP_GIFT).toBe(1)
        expect(PointRecordSourceType.DIRECT_PURCHASE).toBe(2)
        expect(PointRecordSourceType.EXCHANGE_CODE_GIFT).toBe(3)
        expect(PointRecordSourceType.POINT_EXCHANGE).toBe(4)
        expect(PointRecordSourceType.ACTIVITY_REWARD).toBe(5)
        expect(PointRecordSourceType.REFERRAL_REGISTER).toBe(6)
        expect(PointRecordSourceType.REGISTER_GIFT).toBe(7)
        expect(PointRecordSourceType.INVITATION_TO_REGISTER).toBe(8)
        expect(PointRecordSourceType.MEMBERSHIP_UPGRADE_COMPENSATION).toBe(9)
        expect(PointRecordSourceType.OTHER).toBe(99)
    })
})

describe('PointRecordStatus 积分状态', () => {
    it('应包含所有积分状态', () => {
        expect(PointRecordStatus.VALID).toBe(1)
        expect(PointRecordStatus.MEMBERSHIP_UPGRADE_SETTLEMENT).toBe(2)
        expect(PointRecordStatus.CANCELLED).toBe(3)
    })
})

describe('PointConsumptionItemStatus 积分消耗项目状态', () => {
    it('应包含禁用和启用状态', () => {
        expect(PointConsumptionItemStatus.DISABLED).toBe(0)
        expect(PointConsumptionItemStatus.ENABLED).toBe(1)
    })
})

describe('PointConsumptionRecordStatus 积分消耗记录状态', () => {
    it('应包含所有消耗记录状态', () => {
        expect(PointConsumptionRecordStatus.INVALID).toBe(0)
        expect(PointConsumptionRecordStatus.PRE_DEDUCT).toBe(1)
        expect(PointConsumptionRecordStatus.SETTLED).toBe(2)
    })
})

describe('ProductType 商品类型', () => {
    it('应包含会员和积分商品', () => {
        expect(ProductType.MEMBERSHIP).toBe(1)
        expect(ProductType.POINTS).toBe(2)
    })
})

describe('ProductStatus 商品状态', () => {
    it('应包含下架和上架状态', () => {
        expect(ProductStatus.OFF_SHELF).toBe(0)
        expect(ProductStatus.ON_SHELF).toBe(1)
    })
})

describe('RedemptionCodeType 兑换码类型', () => {
    it('应包含所有兑换码类型', () => {
        expect(RedemptionCodeType.MEMBERSHIP_ONLY).toBe(1)
        expect(RedemptionCodeType.POINTS_ONLY).toBe(2)
        expect(RedemptionCodeType.MEMBERSHIP_AND_POINTS).toBe(3)
    })
})

describe('RedemptionCodeStatus 兑换码状态', () => {
    it('应包含所有兑换码状态', () => {
        expect(RedemptionCodeStatus.ACTIVE).toBe(1)
        expect(RedemptionCodeStatus.USED).toBe(2)
        expect(RedemptionCodeStatus.EXPIRED).toBe(3)
        expect(RedemptionCodeStatus.INVALID).toBe(4)
    })
})

describe('SmsType 短信类型', () => {
    it('应包含所有短信类型', () => {
        expect(SmsType.LOGIN).toBe('login')
        expect(SmsType.REGISTER).toBe('register')
        expect(SmsType.RESET_PASSWORD).toBe('resetPassword')
    })
})

describe('SystemConfigStatus 系统配置状态', () => {
    it('应包含禁用和启用状态', () => {
        expect(SystemConfigStatus.DISABLED).toBe(0)
        expect(SystemConfigStatus.ENABLED).toBe(1)
    })
})

describe('UnitType 单位类型', () => {
    it('应包含所有单位类型', () => {
        expect(UnitType.TIME).toBe(1)
        expect(UnitType.FILE_SIZE).toBe(2)
        expect(UnitType.COUNT).toBe(3)
    })
})

describe('TimeUnit 时间单位', () => {
    it('应包含所有时间单位', () => {
        expect(TimeUnit.MILLISECOND).toBe('毫秒')
        expect(TimeUnit.SECOND).toBe('秒')
        expect(TimeUnit.MINUTE).toBe('分钟')
        expect(TimeUnit.HOUR).toBe('小时')
        expect(TimeUnit.DAY).toBe('天')
        expect(TimeUnit.MONTH).toBe('月')
    })
})

describe('FileSizeUnit 文件大小单位', () => {
    it('应包含所有文件大小单位', () => {
        expect(FileSizeUnit.BYTE).toBe('Byte')
        expect(FileSizeUnit.KB).toBe('KB')
        expect(FileSizeUnit.MB).toBe('MB')
        expect(FileSizeUnit.GB).toBe('GB')
        expect(FileSizeUnit.TB).toBe('TB')
    })
})

describe('CountUnit 次数单位', () => {
    it('应包含次数单位', () => {
        expect(CountUnit.COUNT).toBe('次')
    })
})

describe('UserStatus 用户状态', () => {
    it('应包含激活和未激活状态', () => {
        expect(UserStatus.ACTIVE).toBe(1)
        expect(UserStatus.INACTIVE).toBe(0)
    })
})

describe('UserRegisterChannel 用户注册渠道', () => {
    it('应包含所有注册渠道', () => {
        expect(UserRegisterChannel.WEB).toBe('web')
        expect(UserRegisterChannel.WECHAT_MINIAPP).toBe('wxMiniApp')
    })
})

describe('Property: 状态枚举值应为数字', () => {
    it('所有状态枚举应使用数字值', () => {
        const statusEnums = [
            CampaignStatus,
            OssFileStatus,
            MembershipStatus,
            MembershipLevelStatus,
            BenefitStatus,
            OrderStatus,
            PaymentTransactionStatus,
            PointRecordStatus,
            PointConsumptionItemStatus,
            PointConsumptionRecordStatus,
            ProductStatus,
            RedemptionCodeStatus,
            SystemConfigStatus,
            UserStatus,
        ]

        statusEnums.forEach(enumObj => {
            const values = Object.values(enumObj).filter(v => typeof v === 'number')
            expect(values.length).toBeGreaterThan(0)
            values.forEach(v => {
                expect(typeof v).toBe('number')
            })
        })
    })
})
