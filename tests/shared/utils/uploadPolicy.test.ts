/**
 * 上传策略注册表测试
 *
 * 验证统一策略源覆盖现有上传入口，并保持旧 getFileSourceAccept 结构兼容。
 */

import { describe, expect, it } from 'vitest'
import { FileSource } from '../../../shared/types/file'
import {
    UploadPolicyKey,
    UploadQuotaMode,
    UploadRiskLevel,
} from '../../../shared/types/uploadPolicy'
import { getFileSourceAccept } from '../../../shared/utils/file'
import {
    getAcceptListFromPolicy,
    getPublicUploadPolicy,
    getUploadPolicy,
    listUploadPolicies,
    UPLOAD_POLICIES,
} from '../../../shared/utils/uploadPolicy'

const MB = 1024 * 1024

const findAccept = (policyKey: UploadPolicyKey, extension: string) => {
    const policy = getUploadPolicy(policyKey)
    expect(policy).toBeTruthy()
    return getAcceptListFromPolicy(policy!).find(item => item.name === extension)
}

describe('UPLOAD_POLICIES 上传策略注册表', () => {
    it('每个 UploadPolicyKey 都有完整策略', () => {
        for (const policyKey of Object.values(UploadPolicyKey)) {
            const policy = getUploadPolicy(policyKey)
            expect(policy, policyKey).toBeTruthy()
            expect(policy!.displayName).toBeTruthy()
            expect(policy!.storageSource).toBeTruthy()
            expect(policy!.allowedTypes.length).toBeGreaterThan(0)
            expect(policy!.maxFilesPerRequest).toBeGreaterThan(0)
            expect(policy!.inputModes.length).toBeGreaterThan(0)
            expect(policy!.quotaMode).toBeTruthy()
            expect(policy!.allowedUsages.length).toBeGreaterThan(0)
        }
        expect(listUploadPolicies()).toHaveLength(Object.keys(UPLOAD_POLICIES).length)
    })

    it('case_material 与现有案件材料上传配置一致', () => {
        expect(findAccept(UploadPolicyKey.CASE_MATERIAL, 'pdf')?.maxSize).toBe(180 * MB)
        expect(findAccept(UploadPolicyKey.CASE_MATERIAL, 'doc')?.maxSize).toBe(20 * MB)
        expect(findAccept(UploadPolicyKey.CASE_MATERIAL, 'docx')?.maxSize).toBe(100 * MB)
        expect(findAccept(UploadPolicyKey.CASE_MATERIAL, 'md')?.maxSize).toBe(20 * MB)
        expect(findAccept(UploadPolicyKey.CASE_MATERIAL, 'txt')?.maxSize).toBe(1 * MB)
        expect(findAccept(UploadPolicyKey.CASE_MATERIAL, 'png')?.maxSize).toBe(10 * MB)
        expect(findAccept(UploadPolicyKey.CASE_MATERIAL, 'mp3')?.maxSize).toBe(200 * MB)
        expect(findAccept(UploadPolicyKey.CASE_MATERIAL, 'm4a')?.maxSize).toBe(200 * MB)
        expect(findAccept(UploadPolicyKey.CASE_MATERIAL, 'wav')?.maxSize).toBe(500 * MB)
    })

    it('assistant_attachment 沿用案件材料范围', () => {
        expect(findAccept(UploadPolicyKey.ASSISTANT_ATTACHMENT, 'pdf')?.maxSize).toBe(180 * MB)
        expect(findAccept(UploadPolicyKey.ASSISTANT_ATTACHMENT, 'docx')?.maxSize).toBe(100 * MB)
        expect(findAccept(UploadPolicyKey.ASSISTANT_ATTACHMENT, 'mp3')?.maxSize).toBe(200 * MB)
    })

    it('合同审查原文只允许 docx 100MB', () => {
        const accept = getAcceptListFromPolicy(getUploadPolicy(UploadPolicyKey.CONTRACT_REVIEW_ORIGINAL)!)
        expect(accept.map(item => item.name)).toEqual(['docx'])
        expect(accept[0]?.maxSize).toBe(100 * MB)
    })

    it('私人和全局文书模板只允许 docx 100MB，并区分配额口径', () => {
        const privatePolicy = getUploadPolicy(UploadPolicyKey.DOCUMENT_TEMPLATE_PRIVATE)!
        const globalPolicy = getUploadPolicy(UploadPolicyKey.DOCUMENT_TEMPLATE_GLOBAL)!
        expect(getAcceptListFromPolicy(privatePolicy).map(item => item.name)).toEqual(['docx'])
        expect(getAcceptListFromPolicy(globalPolicy).map(item => item.name)).toEqual(['docx'])
        expect(getAcceptListFromPolicy(privatePolicy)[0]?.maxSize).toBe(100 * MB)
        expect(getAcceptListFromPolicy(globalPolicy)[0]?.maxSize).toBe(100 * MB)
        expect(privatePolicy.quotaMode).toBe(UploadQuotaMode.USER_STORAGE_REQUIRED)
        expect(globalPolicy.quotaMode).toBe(UploadQuotaMode.SYSTEM_STORAGE)
    })

    it('示范案例材料走系统存储', () => {
        const policy = getUploadPolicy(UploadPolicyKey.DEMO_CASE_MATERIAL)!
        expect(policy.storageSource).toBe(FileSource.DEMO_CASE)
        expect(policy.quotaMode).toBe(UploadQuotaMode.SYSTEM_STORAGE)
    })

    it('远程图片代理保留 SVG，但标记为高风险', () => {
        const svg = findAccept(UploadPolicyKey.REMOTE_IMAGE_PROXY, 'svg')
        expect(svg?.mime).toBe('image/svg+xml')
        expect(svg?.riskLevel).toBe(UploadRiskLevel.HIGH)
    })

    it('getFileSourceAccept 保持旧结构兼容', () => {
        const caseAnalysis = getFileSourceAccept(FileSource.CASE_ANALYSIS)[0]
        expect(caseAnalysis?.name).toBe('案件分析')
        expect(caseAnalysis?.accept.some(item => item.name === 'pdf' && item.maxSize === 180 * MB)).toBe(true)
        expect(caseAnalysis?.accept.some(item => item.name === 'docx' && item.mime)).toBe(true)
    })

    it('DOC 默认公开配置保留 md/txt，不误切到 MinerU 窄策略', () => {
        const doc = getFileSourceAccept(FileSource.DOC)[0]
        expect(doc?.accept.some(item => item.name === 'md')).toBe(true)
        expect(doc?.accept.some(item => item.name === 'txt')).toBe(true)
    })

    it('公开策略 DTO 不暴露服务端配额细节', () => {
        const publicPolicy = getPublicUploadPolicy(UploadPolicyKey.CLOUD_DISK_FILE)
        expect(publicPolicy?.source).toBe(FileSource.FILE)
        expect(publicPolicy?.accept.some(item => item.name === 'pdf')).toBe(true)
        expect(publicPolicy).not.toHaveProperty('quotaMode')
    })
})
