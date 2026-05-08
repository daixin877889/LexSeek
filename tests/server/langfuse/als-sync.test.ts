import { AsyncLocalStorage } from 'node:async_hooks'
import { describe, it, expect } from 'vitest'

describe('Node.js AsyncLocalStorage 同步语义验证', () => {
  it('als.enterWith 后续同步 + await 后均能取到 store（middleware 用法）', async () => {
    const als = new AsyncLocalStorage<{ marker: string }>()
    let captured: string | undefined

    // 包在 als.run 里以避免污染其他测试
    await als.run({ marker: 'outer' }, async () => {
      als.enterWith({ marker: 'enter-with' })
      await Promise.resolve()
      captured = als.getStore()?.marker
    })

    expect(captured).toBe('enter-with')
  })
})
