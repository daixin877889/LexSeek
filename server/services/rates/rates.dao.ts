/**
 * 利率数据访问层
 *
 * 提供 LPR / PBOC 存款 / PBOC 贷款 三类利率的 CRUD（含软删除）。
 */
import type { Prisma } from '#shared/types/prisma'
import type {
    lprRates,
    pbocDepositRates,
    pbocLoanRates,
} from '~~/generated/prisma/client'
import { prisma } from '~~/server/utils/db'

type PrismaClient = typeof prisma

// ============ LPR ============

export async function findAllLPRRatesDAO(tx?: PrismaClient): Promise<lprRates[]> {
    return (tx ?? prisma).lprRates.findMany({
        where: { deletedAt: null },
        orderBy: { effectDate: 'desc' },
    })
}

export async function createLPRRateDAO(
    data: Prisma.lprRatesCreateInput,
    tx?: PrismaClient
): Promise<lprRates> {
    return (tx ?? prisma).lprRates.create({ data })
}

export async function updateLPRRateDAO(
    id: number,
    data: Prisma.lprRatesUpdateInput,
    tx?: PrismaClient
): Promise<lprRates> {
    return (tx ?? prisma).lprRates.update({ where: { id }, data })
}

export async function softDeleteLPRRateDAO(id: number, tx?: PrismaClient): Promise<lprRates> {
    return (tx ?? prisma).lprRates.update({
        where: { id },
        data: { deletedAt: new Date() },
    })
}

// ============ PBOC Deposit ============

export async function findAllPBOCDepositRatesDAO(tx?: PrismaClient): Promise<pbocDepositRates[]> {
    return (tx ?? prisma).pbocDepositRates.findMany({
        where: { deletedAt: null },
        orderBy: { effectDate: 'desc' },
    })
}

export async function createPBOCDepositRateDAO(
    data: Prisma.pbocDepositRatesCreateInput,
    tx?: PrismaClient
): Promise<pbocDepositRates> {
    return (tx ?? prisma).pbocDepositRates.create({ data })
}

export async function updatePBOCDepositRateDAO(
    id: number,
    data: Prisma.pbocDepositRatesUpdateInput,
    tx?: PrismaClient
): Promise<pbocDepositRates> {
    return (tx ?? prisma).pbocDepositRates.update({ where: { id }, data })
}

export async function softDeletePBOCDepositRateDAO(
    id: number,
    tx?: PrismaClient
): Promise<pbocDepositRates> {
    return (tx ?? prisma).pbocDepositRates.update({
        where: { id },
        data: { deletedAt: new Date() },
    })
}

// ============ PBOC Loan ============

export async function findAllPBOCLoanRatesDAO(tx?: PrismaClient): Promise<pbocLoanRates[]> {
    return (tx ?? prisma).pbocLoanRates.findMany({
        where: { deletedAt: null },
        orderBy: { effectDate: 'desc' },
    })
}

export async function createPBOCLoanRateDAO(
    data: Prisma.pbocLoanRatesCreateInput,
    tx?: PrismaClient
): Promise<pbocLoanRates> {
    return (tx ?? prisma).pbocLoanRates.create({ data })
}

export async function updatePBOCLoanRateDAO(
    id: number,
    data: Prisma.pbocLoanRatesUpdateInput,
    tx?: PrismaClient
): Promise<pbocLoanRates> {
    return (tx ?? prisma).pbocLoanRates.update({ where: { id }, data })
}

export async function softDeletePBOCLoanRateDAO(
    id: number,
    tx?: PrismaClient
): Promise<pbocLoanRates> {
    return (tx ?? prisma).pbocLoanRates.update({
        where: { id },
        data: { deletedAt: new Date() },
    })
}
