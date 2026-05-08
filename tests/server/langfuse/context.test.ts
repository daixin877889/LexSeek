import { describe, it, expect } from 'vitest'
import { getLangfuseContext, withLangfuseContext } from '~~/server/lib/langfuse/context'

describe('Langfuse ALS context', () => {
  it('在 with 包裹外取不到上下文', () => {
    expect(getLangfuseContext()).toBeUndefined()
  })

  it('在 with 包裹内能取到完整上下文', async () => {
    const captured = await withLangfuseContext(
      { requestId: 'req-1', userId: 42, vertical: 'case-analysis' },
      async () => getLangfuseContext(),
    )
    expect(captured).toMatchObject({
      requestId: 'req-1',
      userId: 42,
      vertical: 'case-analysis',
    })
  })

  it('嵌套调用时内层增量补字段，不覆盖外层', async () => {
    const captured = await withLangfuseContext(
      { requestId: 'req-1', userId: 42, vertical: 'case-analysis' },
      async () => withLangfuseContext(
        { caseId: 100, vertical: 'init-analysis' },
        async () => getLangfuseContext(),
      ),
    )
    expect(captured).toMatchObject({
      requestId: 'req-1',
      userId: 42,
      vertical: 'init-analysis', // 内层覆盖
      caseId: 100, // 内层补字段
    })
  })

  it('patch 中的 undefined 字段不应擦除已有值', async () => {
    const captured = await withLangfuseContext(
      { requestId: 'req-1', userId: 42 },
      async () => withLangfuseContext(
        { userId: undefined, caseId: 100 },
        async () => getLangfuseContext(),
      ),
    )
    expect(captured?.userId).toBe(42)
    expect(captured?.caseId).toBe(100)
  })
})
