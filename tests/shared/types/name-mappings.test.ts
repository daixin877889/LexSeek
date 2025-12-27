/**
 * 名称映射测试
 *
 * 测试枚举值与名称映射的一致性
 *
 * **Feature: shared-types**
 * **Validates: Requirements 1.2, 2.2**
 */

import { describe, it, expect } from 'vitest'

// 导入枚举和名称映射
import { FileSource, FileSourceName, OssFileStatus, OssFileStatusName, FileType, FileTypeName } from '../../../shared/types/file'
import { PointRecordSourceType, PointRecordSourceTypeName, PointConsumptionItemStatus, PointConsumptionItemStatusName, PointConsumptionRecordStatus, PointConsumptionRecordStatusName } from '../../../shared/types/point.types'

describe('FileSourceName 文件来源名称映射', () => {
    it('FILE 应映射到云盘上传', () => {
        expect(FileSourceName[FileSource.FILE]).toBe('云盘上传')
    })

    it('ASR 应映射到语音识别', () => {
        expect(FileSourceName[FileSource.ASR]).toBe('语音识别')
    })

    it('DOC 应映射到文档识别', () => {
        expect(FileSourceName[FileSource.DOC]).toBe('文档识别')
    })

    it('IMAGE 应映射到图片识别', () => {
        expect(FileSourceName[FileSource.IMAGE]).toBe('图片识别')
    })

    it('VIDEO 应映射到视频', () => {
        expect(FileSourceName[FileSource.VIDEO]).toBe('视频')
    })

    it('CASE_ANALYSIS 应映射到案件分析', () => {
        expect(FileSourceName[FileSource.CASE_ANALYSIS]).toBe('案件分析')
    })

    it('所有 FileSource 枚举值都应有对应的名称', () => {
        Object.values(FileSource).forEach(source => {
            expect(FileSourceName[source]).toBeDefined()
            expect(typeof FileSourceName[source]).toBe('string')
        })
    })
})

describe('OssFileStatusName OSS 文件状态名称映射', () => {
    it('PENDING 应映射到未上传', () => {
        expect(OssFileStatusName[OssFileStatus.PENDING]).toBe('未上传')
    })

    it('UPLOADED 应映射到上传完成', () => {
        expect(OssFileStatusName[OssFileStatus.UPLOADED]).toBe('上传完成')
    })

    it('FAILED 应映射到上传失败', () => {
        expect(OssFileStatusName[OssFileStatus.FAILED]).toBe('上传失败')
    })

    it('所有 OssFileStatus 枚举值都应有对应的名称', () => {
        const statusValues = Object.values(OssFileStatus).filter(v => typeof v === 'number') as number[]
        statusValues.forEach(status => {
            expect(OssFileStatusName[status]).toBeDefined()
            expect(typeof OssFileStatusName[status]).toBe('string')
        })
    })
})

describe('FileTypeName 文件类型名称映射', () => {
    it('DOC 应映射到文档', () => {
        expect(FileTypeName[FileType.DOC]).toBe('文档')
    })

    it('AUDIO 应映射到音频', () => {
        expect(FileTypeName[FileType.AUDIO]).toBe('音频')
    })

    it('IMAGE 应映射到图片', () => {
        expect(FileTypeName[FileType.IMAGE]).toBe('图片')
    })

    it('VIDEO 应映射到视频', () => {
        expect(FileTypeName[FileType.VIDEO]).toBe('视频')
    })

    it('JSON 应映射到 JSON文件', () => {
        expect(FileTypeName[FileType.JSON]).toBe('JSON文件')
    })

    it('OTHER 应映射到其他', () => {
        expect(FileTypeName[FileType.OTHER]).toBe('其他')
    })

    it('所有 FileType 枚举值都应有对应的名称', () => {
        Object.values(FileType).forEach(type => {
            expect(FileTypeName[type]).toBeDefined()
            expect(typeof FileTypeName[type]).toBe('string')
        })
    })
})

describe('PointRecordSourceTypeName 积分记录来源类型名称映射', () => {
    it('MEMBERSHIP_GIFT 应映射到购买会员赠送', () => {
        expect(PointRecordSourceTypeName[PointRecordSourceType.MEMBERSHIP_GIFT]).toBe('购买会员赠送')
    })

    it('DIRECT_PURCHASE 应映射到直接购买', () => {
        expect(PointRecordSourceTypeName[PointRecordSourceType.DIRECT_PURCHASE]).toBe('直接购买')
    })

    it('EXCHANGE_CODE_GIFT 应映射到兑换码赠送', () => {
        expect(PointRecordSourceTypeName[PointRecordSourceType.EXCHANGE_CODE_GIFT]).toBe('兑换码赠送')
    })

    it('POINT_EXCHANGE 应映射到积分兑换', () => {
        expect(PointRecordSourceTypeName[PointRecordSourceType.POINT_EXCHANGE]).toBe('积分兑换')
    })

    it('ACTIVITY_REWARD 应映射到活动奖励', () => {
        expect(PointRecordSourceTypeName[PointRecordSourceType.ACTIVITY_REWARD]).toBe('活动奖励')
    })

    it('REFERRAL_REGISTER 应映射到推荐注册', () => {
        expect(PointRecordSourceTypeName[PointRecordSourceType.REFERRAL_REGISTER]).toBe('推荐注册')
    })

    it('REGISTER_GIFT 应映射到注册赠送', () => {
        expect(PointRecordSourceTypeName[PointRecordSourceType.REGISTER_GIFT]).toBe('注册赠送')
    })

    it('INVITATION_TO_REGISTER 应映射到邀请注册赠送', () => {
        expect(PointRecordSourceTypeName[PointRecordSourceType.INVITATION_TO_REGISTER]).toBe('邀请注册赠送')
    })

    it('MEMBERSHIP_UPGRADE_COMPENSATION 应映射到会员升级补偿', () => {
        expect(PointRecordSourceTypeName[PointRecordSourceType.MEMBERSHIP_UPGRADE_COMPENSATION]).toBe('会员升级补偿')
    })

    it('OTHER 应映射到其他', () => {
        expect(PointRecordSourceTypeName[PointRecordSourceType.OTHER]).toBe('其他')
    })

    it('所有 PointRecordSourceType 枚举值都应有对应的名称', () => {
        const typeValues = Object.values(PointRecordSourceType).filter(v => typeof v === 'number') as number[]
        typeValues.forEach(type => {
            expect(PointRecordSourceTypeName[type]).toBeDefined()
            expect(typeof PointRecordSourceTypeName[type]).toBe('string')
        })
    })
})

describe('PointConsumptionItemStatusName 积分消耗项目状态名称映射', () => {
    it('DISABLED 应映射到禁用', () => {
        expect(PointConsumptionItemStatusName[PointConsumptionItemStatus.DISABLED]).toBe('禁用')
    })

    it('ENABLED 应映射到启用', () => {
        expect(PointConsumptionItemStatusName[PointConsumptionItemStatus.ENABLED]).toBe('启用')
    })

    it('所有状态值都应有对应的名称', () => {
        const statusValues = Object.values(PointConsumptionItemStatus).filter(v => typeof v === 'number') as number[]
        statusValues.forEach(status => {
            expect(PointConsumptionItemStatusName[status]).toBeDefined()
            expect(typeof PointConsumptionItemStatusName[status]).toBe('string')
        })
    })
})

describe('PointConsumptionRecordStatusName 积分消耗记录状态名称映射', () => {
    it('INVALID 应映射到无效', () => {
        expect(PointConsumptionRecordStatusName[PointConsumptionRecordStatus.INVALID]).toBe('无效')
    })

    it('PRE_DEDUCT 应映射到预扣', () => {
        expect(PointConsumptionRecordStatusName[PointConsumptionRecordStatus.PRE_DEDUCT]).toBe('预扣')
    })

    it('SETTLED 应映射到已结算', () => {
        expect(PointConsumptionRecordStatusName[PointConsumptionRecordStatus.SETTLED]).toBe('已结算')
    })

    it('所有状态值都应有对应的名称', () => {
        const statusValues = Object.values(PointConsumptionRecordStatus).filter(v => typeof v === 'number') as number[]
        statusValues.forEach(status => {
            expect(PointConsumptionRecordStatusName[status]).toBeDefined()
            expect(typeof PointConsumptionRecordStatusName[status]).toBe('string')
        })
    })
})

describe('Property: 名称映射完整性', () => {
    it('所有名称映射都应返回非空字符串', () => {
        // FileSourceName
        Object.values(FileSource).forEach(source => {
            const name = FileSourceName[source]
            expect(name).toBeDefined()
            expect(name.length).toBeGreaterThan(0)
        })

        // FileTypeName
        Object.values(FileType).forEach(type => {
            const name = FileTypeName[type]
            expect(name).toBeDefined()
            expect(name.length).toBeGreaterThan(0)
        })
    })
})
