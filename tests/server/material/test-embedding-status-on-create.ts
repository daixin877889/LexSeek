/**
 * 测试材料创建时 embedding_status 的设置
 */

import { PrismaClient } from '../../../generated/prisma/client'

const prisma = new PrismaClient()

const CaseMaterialType = {
    DOCUMENT: 2,
    IMAGE: 3,
    AUDIO: 4,
}

async function test() {
    try {
        console.log('开始测试...')

        const testCase = await prisma.cases.create({
            data: {
                title: '测试案件 - embedding_status',
                userId: 137,
                caseTypeId: 1,
                status: 1,
            },
        })
        console.log(`✓ 创建测试案件: ${testCase.id}`)

        const materials = [
            { type: CaseMaterialType.DOCUMENT, name: '测试文档', ossFileId: 1 },
            { type: CaseMaterialType.IMAGE, name: '测试图片', ossFileId: 3 },
            { type: CaseMaterialType.AUDIO, name: '测试音频', ossFileId: 2 },
        ]

        const { batchAddCaseMaterialsDAO } = await import('../../../server/services/case/caseMaterial.dao')

        const materialDataList = []
        for (const material of materials) {
            const ossFile = await prisma.ossFiles.findFirst({
                where: { id: material.ossFileId, deletedAt: null },
            })

            if (!ossFile) {
                throw new Error(`OSS 文件 ${material.ossFileId} 不存在`)
            }

            let embeddingStatus: 'pending' | 'completed' = 'pending'

            if (material.type === CaseMaterialType.DOCUMENT) {
                const docRecord = await prisma.docRecognitionRecords.findFirst({
                    where: { ossFileId: material.ossFileId, status: 2, deletedAt: null },
                    select: { vectorIds: true },
                })
                if (docRecord && docRecord.vectorIds) {
                    embeddingStatus = 'completed'
                }
            } else if (material.type === CaseMaterialType.IMAGE) {
                const imageRecord = await prisma.imageRecognitionRecords.findFirst({
                    where: { ossFileId: material.ossFileId, status: 2, deletedAt: null },
                    select: { vectorIds: true },
                })
                if (imageRecord && imageRecord.vectorIds) {
                    embeddingStatus = 'completed'
                }
            } else if (material.type === CaseMaterialType.AUDIO) {
                const audioRecord = await prisma.asrRecords.findFirst({
                    where: { ossFileId: material.ossFileId, status: 2, deletedAt: null },
                    select: { vectorIds: true },
                })
                if (audioRecord && audioRecord.vectorIds) {
                    embeddingStatus = 'completed'
                }
            }

            materialDataList.push({
                name: material.name,
                type: material.type,
                ossFileId: material.ossFileId,
                isEncrypted: ossFile.encrypted || false,
                status: 1,
                embeddingStatus,
            })
        }

        await batchAddCaseMaterialsDAO(testCase.id, materialDataList)
        console.log('✓ 添加材料完成')

        const createdMaterials = await prisma.caseMaterials.findMany({
            where: { caseId: testCase.id },
            select: { id: true, name: true, type: true, ossFileId: true, embeddingStatus: true },
        })

        console.log('\n材料 embedding_status 状态：')
        for (const material of createdMaterials) {
            console.log(`  - ${material.name} (type=${material.type}, ossFileId=${material.ossFileId}): ${material.embeddingStatus}`)
        }

        const allCompleted = createdMaterials.every(m => m.embeddingStatus === 'completed')

        if (allCompleted) {
            console.log('\n✅ 测试通过：所有材料的 embedding_status 都是 completed')
        } else {
            console.log('\n❌ 测试失败：部分材料的 embedding_status 不是 completed')
            process.exit(1)
        }

        await prisma.caseMaterials.deleteMany({ where: { caseId: testCase.id } })
        await prisma.caseSessions.deleteMany({ where: { caseId: testCase.id } })
        await prisma.cases.delete({ where: { id: testCase.id } })
        console.log('✓ 清理测试数据完成')

    } catch (error) {
        console.error('测试失败：', error)
        process.exit(1)
    } finally {
        await prisma.$disconnect()
    }
}

test()
