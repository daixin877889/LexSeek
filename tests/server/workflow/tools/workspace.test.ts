import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { withTimeout } from '../../../../server/services/workflow/tools/workspace'

describe('withTimeout 通用兜底超时', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('Promise 正常 resolve 应返回值', async () => {
    const p = new Promise<string>((resolve) => { setTimeout(() => resolve('ok'), 100) })
    const wrapped = withTimeout(p, 1000, '测试')
    await vi.advanceTimersByTimeAsync(100)
    await expect(wrapped).resolves.toBe('ok')
  })

  it('Promise 超过 ms 未完成应抛带 label 的超时错误', async () => {
    const never = new Promise<string>(() => {})
    const wrapped = withTimeout(never, 35_000, '脚本 test.cjs')
    const assertion = expect(wrapped).rejects.toThrow('脚本 test.cjs 执行超时（35s）')
    await vi.advanceTimersByTimeAsync(35_001)
    await assertion
  })
})
