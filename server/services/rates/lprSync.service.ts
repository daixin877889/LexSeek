/**
 * LPR 自动同步服务
 *
 * 从全国银行间同业拆借中心（chinamoney.com.cn）公开接口拉取最新 LPR 数据，
 * 解析后入库 lpr_rates，并把每次执行结果记入 lpr_sync_logs。
 */

/** chinamoney API 响应结构 */
export interface ChinamoneyLPRResponse {
    head: { rep_code: string; rep_message: string; ts: number }
    data: { endDateCN: string; startDateCN: string; message: string }
    records: ChinamoneyLPRRecord[]
}

export interface ChinamoneyLPRRecord {
    '1Y': string
    '5Y': string
    showDateCN: string // YYYY-MM-DD
    showDateEN: string
}

/**
 * 从 chinamoney 公开接口拉取 LPR 历史
 *
 * @param opts.rangeStart 拉取窗口起始日期
 * @param opts.rangeEnd 拉取窗口结束日期
 * @returns API 返回的 records 数组
 * @throws Error 当 API 返回 rep_code !== '200' 或网络异常
 */
export async function fetchLPRFromChinamoneyService(opts: {
    rangeStart: Date
    rangeEnd: Date
}): Promise<ChinamoneyLPRRecord[]> {
    const fmt = (d: Date) => d.toISOString().slice(0, 10)
    const url = `https://www.chinamoney.com.cn/ags/ms/cm-u-bk-currency/LprHis?lang=CN&strStartDate=${fmt(opts.rangeStart)}&strEndDate=${fmt(opts.rangeEnd)}`

    const response = await $fetch<ChinamoneyLPRResponse>(url, {
        method: 'POST',
        headers: {
            Accept: 'application/json, text/javascript, */*; q=0.01',
            Origin: 'https://www.chinamoney.com.cn',
            Referer: 'https://www.chinamoney.com.cn/r/cms/chinese/chinamoney/html/currency/lpr-shibor-history-download.html',
            'User-Agent':
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
            'X-Requested-With': 'XMLHttpRequest',
        },
        timeout: 30_000,
    })

    if (response.head.rep_code !== '200') {
        throw new Error(`chinamoney API 错误: ${response.head.rep_code} ${response.head.rep_message}`)
    }
    return response.records
}

import {
    createLPRSyncLogDAO,
    updateLPRSyncLogDAO,
    findLatestLPRSyncLogDAO,
} from '~~/server/services/rates/lprSyncLog.dao'
import { createLPRRateService } from '~~/server/services/rates/rates.service'
import { prisma } from '~~/server/utils/db'

export interface SyncLPRResult {
    fetched: number
    inserted: number
    logId: number
}

/**
 * 同步 chinamoney LPR 数据到 lpr_rates 表
 *
 * 流程：1) 写 running log → 2) fetch → 3) 逐条去重后 createLPRRateService → 4) 标记成功
 * 任何步骤失败：catch + 写 failure log + 透传原错误
 *
 * @param opts.triggeredBy 触发方式，cron 任务传 'auto'，管理后台按钮传 'manual'
 * @param opts.operatorId 手动触发时记录 admin user id
 */
export async function syncLPRRatesService(opts: {
    triggeredBy: 'auto' | 'manual'
    operatorId?: number
}): Promise<SyncLPRResult> {
    const startedAt = new Date()
    const rangeEnd = new Date()
    const rangeStart = new Date(Date.now() - 30 * 86400_000)

    const log = await createLPRSyncLogDAO({
        startedAt,
        status: 'running',
        triggeredBy: opts.triggeredBy,
        operatorId: opts.operatorId ?? null,
        rangeStart,
        rangeEnd,
    })

    try {
        const records = await fetchLPRFromChinamoneyService({ rangeStart, rangeEnd })

        let inserted = 0
        for (const r of records) {
            const effectDate = new Date(r.showDateCN)
            const exists = await prisma.lprRates.findUnique({ where: { effectDate } })
            if (exists) continue

            await createLPRRateService({
                effectDate: r.showDateCN,
                oneYear: parseFloat(r['1Y']),
                fiveYear: parseFloat(r['5Y']),
                remark: '自动同步自 chinamoney',
            })
            inserted++
        }

        await updateLPRSyncLogDAO(log.id, {
            finishedAt: new Date(),
            status: 'success',
            fetchedCount: records.length,
            insertedCount: inserted,
        })

        logger.info(`[lpr-sync] 完成：拉到 ${records.length} 条，新增 ${inserted} 条`)
        return { fetched: records.length, inserted, logId: log.id }
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        await updateLPRSyncLogDAO(log.id, {
            finishedAt: new Date(),
            status: 'failure',
            errorMessage: msg,
        })
        logger.error(`[lpr-sync] 失败：${msg}`)
        throw err
    }
}

/** 查询最近一次 LPR 同步状态（管理后台卡片用） */
export async function getLatestLPRSyncStatusService() {
    return findLatestLPRSyncLogDAO()
}
