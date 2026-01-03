/**
 * 调试云盘空间计算问题
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
    // 1. 查询用户 1 的所有文件
    console.log('=== 用户 1 的所有文件 ===')
    const files = await prisma.ossFiles.findMany({
        where: {
            userId: 1,
            deletedAt: null
        },
        select: {
            id: true,
            userId: true,
            fileName: true,
            fileSize: true,
            status: true,
            deletedAt: true
        }
    })
    console.log('文件列表:', files)

    // 2. 查询 status = 1 的文件
    console.log('\n=== status = 1 的文件 ===')
    const uploadedFiles = await prisma.ossFiles.findMany({
        where: {
            userId: 1,
            deletedAt: null,
            status: 1
        },
        select: {
            id: true,
            fileSize: true,
            status: true
        }
    })
    console.log('已上传文件:', uploadedFiles)

    // 3. 聚合查询
    console.log('\n=== 聚合查询 ===')
    const aggregate = await prisma.ossFiles.aggregate({
        where: {
            userId: 1,
            deletedAt: null,
            status: 1
        },
        _sum: {
            fileSize: true
        },
        _count: {
            id: true
        }
    })
    console.log('聚合结果:', aggregate)
    console.log('fileSize 类型:', typeof aggregate._sum.fileSize)
    console.log('fileSize 值:', aggregate._sum.fileSize)
    console.log('Number(fileSize):', Number(aggregate._sum.fileSize || 0))
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect())
