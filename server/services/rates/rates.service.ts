/**
 * 利率服务层
 *
 * 职责：
 * 1. 把 Prisma Decimal 转 number、Date 转 YYYY-MM-DD 字符串（让 API / 缓存只持有 plain 数据）
 * 2. 增删改后自动刷新 shared/utils/tools/data/ 模块级缓存
 */
import type { LPRRate, DepositRate, LoanRate } from '#shared/types/tools'
import { decimalToNumberUtils } from '#shared/utils/decimalToNumber'
import {
    getLPRRates, setLPRRates,
    setDepositRates,
    setLoanRates,
} from '#shared/utils/tools/data'
import type { lprRates, pbocDepositRates, pbocLoanRates } from '~~/generated/prisma/client'
import {
    findAllLPRRatesDAO, createLPRRateDAO, updateLPRRateDAO, softDeleteLPRRateDAO,
    findAllPBOCDepositRatesDAO, createPBOCDepositRateDAO, updatePBOCDepositRateDAO, softDeletePBOCDepositRateDAO,
    findAllPBOCLoanRatesDAO, createPBOCLoanRateDAO, updatePBOCLoanRateDAO, softDeletePBOCLoanRateDAO,
} from '~~/server/services/rates/rates.dao'

// ============ 内部转换 ============

function toLPRRate(row: lprRates): LPRRate {
    return {
        date: row.effectDate.toISOString().slice(0, 10),
        oneYear: decimalToNumberUtils(row.oneYear),
        fiveYear: decimalToNumberUtils(row.fiveYear),
    }
}

function toPBOCDepositRate(row: pbocDepositRates): DepositRate {
    return {
        date: row.effectDate.toISOString().slice(0, 10),
        demand: decimalToNumberUtils(row.demand),
        threeMonths: decimalToNumberUtils(row.threeMonths),
        sixMonths: decimalToNumberUtils(row.sixMonths),
        oneYear: decimalToNumberUtils(row.oneYear),
        twoYear: decimalToNumberUtils(row.twoYear),
        threeYear: decimalToNumberUtils(row.threeYear),
        fiveYear: decimalToNumberUtils(row.fiveYear),
    }
}

function toPBOCLoanRate(row: pbocLoanRates): LoanRate {
    return {
        date: row.effectDate.toISOString().slice(0, 10),
        sixMonths: decimalToNumberUtils(row.sixMonths),
        oneYear: decimalToNumberUtils(row.oneYear),
        oneToFiveYear: decimalToNumberUtils(row.oneToFiveYear),
        fiveYear: decimalToNumberUtils(row.fiveYear),
    }
}

// ============ LPR 内部缓存刷新 ============

async function refreshLPRCacheService(): Promise<LPRRate[]> {
    const rows = await findAllLPRRatesDAO()
    const list = rows.map(toLPRRate)
    setLPRRates(list)
    return list
}

// ============ LPR Service ============

export interface CreateLPRRateInput {
    effectDate: string
    oneYear: number
    fiveYear: number
    remark?: string
}

export interface UpdateLPRRateInput {
    effectDate?: string
    oneYear?: number
    fiveYear?: number
    remark?: string
}

export async function listLPRRatesService(): Promise<LPRRate[]> {
    const rows = await findAllLPRRatesDAO()
    return rows.map(toLPRRate)
}

export async function createLPRRateService(input: CreateLPRRateInput) {
    const created = await createLPRRateDAO({
        effectDate: new Date(input.effectDate),
        oneYear: input.oneYear,
        fiveYear: input.fiveYear,
        remark: input.remark ?? null,
    })
    await refreshLPRCacheService()
    return { id: created.id, ...toLPRRate(created), remark: created.remark }
}

export async function updateLPRRateService(id: number, input: UpdateLPRRateInput) {
    const data: Record<string, unknown> = {}
    if (input.effectDate !== undefined) data.effectDate = new Date(input.effectDate)
    if (input.oneYear !== undefined) data.oneYear = input.oneYear
    if (input.fiveYear !== undefined) data.fiveYear = input.fiveYear
    if (input.remark !== undefined) data.remark = input.remark
    const updated = await updateLPRRateDAO(id, data)
    await refreshLPRCacheService()
    return { id: updated.id, ...toLPRRate(updated), remark: updated.remark }
}

export async function deleteLPRRateService(id: number): Promise<void> {
    await softDeleteLPRRateDAO(id)
    await refreshLPRCacheService()
}

// ============ PBOC Deposit 内部缓存刷新 ============

async function refreshPBOCDepositCacheService(): Promise<DepositRate[]> {
    const rows = await findAllPBOCDepositRatesDAO()
    const list = rows.map(toPBOCDepositRate)
    setDepositRates(list)
    return list
}

// ============ PBOC Deposit Service ============

export interface CreatePBOCDepositRateInput {
    effectDate: string
    demand: number
    threeMonths: number
    sixMonths: number
    oneYear: number
    twoYear: number
    threeYear: number
    fiveYear: number
    remark?: string
}
export type UpdatePBOCDepositRateInput = Partial<CreatePBOCDepositRateInput>

export async function listPBOCDepositRatesService(): Promise<DepositRate[]> {
    return (await findAllPBOCDepositRatesDAO()).map(toPBOCDepositRate)
}

export async function createPBOCDepositRateService(input: CreatePBOCDepositRateInput) {
    const created = await createPBOCDepositRateDAO({
        effectDate: new Date(input.effectDate),
        demand: input.demand,
        threeMonths: input.threeMonths,
        sixMonths: input.sixMonths,
        oneYear: input.oneYear,
        twoYear: input.twoYear,
        threeYear: input.threeYear,
        fiveYear: input.fiveYear,
        remark: input.remark ?? null,
    })
    await refreshPBOCDepositCacheService()
    return { id: created.id, ...toPBOCDepositRate(created), remark: created.remark }
}

export async function updatePBOCDepositRateService(id: number, input: UpdatePBOCDepositRateInput) {
    const data: Record<string, unknown> = {}
    if (input.effectDate !== undefined) data.effectDate = new Date(input.effectDate)
    for (const k of ['demand', 'threeMonths', 'sixMonths', 'oneYear', 'twoYear', 'threeYear', 'fiveYear', 'remark'] as const) {
        if (input[k] !== undefined) data[k] = input[k]
    }
    const updated = await updatePBOCDepositRateDAO(id, data)
    await refreshPBOCDepositCacheService()
    return { id: updated.id, ...toPBOCDepositRate(updated), remark: updated.remark }
}

export async function deletePBOCDepositRateService(id: number): Promise<void> {
    await softDeletePBOCDepositRateDAO(id)
    await refreshPBOCDepositCacheService()
}

// ============ PBOC Loan 内部缓存刷新 ============

async function refreshPBOCLoanCacheService(): Promise<LoanRate[]> {
    const rows = await findAllPBOCLoanRatesDAO()
    const list = rows.map(toPBOCLoanRate)
    setLoanRates(list)
    return list
}

// ============ PBOC Loan Service ============

export interface CreatePBOCLoanRateInput {
    effectDate: string
    sixMonths: number
    oneYear: number
    oneToFiveYear: number
    fiveYear: number
    remark?: string
}
export type UpdatePBOCLoanRateInput = Partial<CreatePBOCLoanRateInput>

export async function listPBOCLoanRatesService(): Promise<LoanRate[]> {
    return (await findAllPBOCLoanRatesDAO()).map(toPBOCLoanRate)
}

export async function createPBOCLoanRateService(input: CreatePBOCLoanRateInput) {
    const created = await createPBOCLoanRateDAO({
        effectDate: new Date(input.effectDate),
        sixMonths: input.sixMonths,
        oneYear: input.oneYear,
        oneToFiveYear: input.oneToFiveYear,
        fiveYear: input.fiveYear,
        remark: input.remark ?? null,
    })
    await refreshPBOCLoanCacheService()
    return { id: created.id, ...toPBOCLoanRate(created), remark: created.remark }
}

export async function updatePBOCLoanRateService(id: number, input: UpdatePBOCLoanRateInput) {
    const data: Record<string, unknown> = {}
    if (input.effectDate !== undefined) data.effectDate = new Date(input.effectDate)
    for (const k of ['sixMonths', 'oneYear', 'oneToFiveYear', 'fiveYear', 'remark'] as const) {
        if (input[k] !== undefined) data[k] = input[k]
    }
    const updated = await updatePBOCLoanRateDAO(id, data)
    await refreshPBOCLoanCacheService()
    return { id: updated.id, ...toPBOCLoanRate(updated), remark: updated.remark }
}

export async function deletePBOCLoanRateService(id: number): Promise<void> {
    await softDeletePBOCLoanRateDAO(id)
    await refreshPBOCLoanCacheService()
}

// ============ 启动一次性全量刷新（plugin 调用） ============

export async function refreshAllRatesCacheService(): Promise<void> {
    await Promise.all([
        refreshLPRCacheService(),
        refreshPBOCDepositCacheService(),
        refreshPBOCLoanCacheService(),
    ])
}

// re-export 供 plugin 用
export { getLPRRates }
