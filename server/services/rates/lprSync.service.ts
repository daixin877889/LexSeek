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
