import { setLPRRates, setDepositRates, setLoanRates, getLPRRates, getDepositRates, getLoanRates } from '#shared/utils/tools/data'
import { useApiFetch } from '~/composables/useApiFetch'
import type { LPRRate, DepositRate, LoanRate } from '#shared/types/tools'

let loaded = false
let loadingPromise: Promise<void> | null = null

/**
 * 进入任意计算器页面前调用一次。
 * - 已加载：直接返回当前缓存
 * - 加载中：复用同一个 Promise
 * - 未加载：并行拉三类利率，写入 shared 缓存
 */
export function useToolsRates() {
  async function ensureLoaded(): Promise<void> {
    if (loaded) return
    if (loadingPromise) return loadingPromise
    loadingPromise = (async () => {
      try {
        const [lpr, deposit, loan] = await Promise.all([
          useApiFetch<LPRRate[]>('/api/v1/tools/rates/lpr', { method: 'GET' }),
          useApiFetch<DepositRate[]>('/api/v1/tools/rates/pboc-deposit', { method: 'GET' }),
          useApiFetch<LoanRate[]>('/api/v1/tools/rates/pboc-loan', { method: 'GET' }),
        ])
        if (lpr) setLPRRates(lpr)
        if (deposit) setDepositRates(deposit)
        if (loan) setLoanRates(loan)
        loaded = true
      } catch (err) {
        console.error('[useToolsRates] 加载利率失败，使用默认值', err)
      } finally {
        loadingPromise = null
      }
    })()
    return loadingPromise
  }

  return {
    ensureLoaded,
    getLPR: getLPRRates,
    getPBOCDeposit: getDepositRates,
    getPBOCLoan: getLoanRates,
  }
}
