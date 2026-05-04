import type { H3Event } from 'h3'
import { describe, it, expect, vi } from 'vitest'

// vitest 直接 import middleware 时拿不到 nitro 自动注入的 defineEventHandler，hoisted stub
vi.stubGlobal('defineEventHandler', (fn: (e: H3Event) => unknown) => fn)

const { getLangfuseContext } = await import('~~/server/lib/langfuse/context')
const langfuseContextMiddleware = (await import('~~/server/middleware/04.langfuseContext')).default

function makeFakeEvent(opts: {
  requestId?: string
  userId?: number
} = {}): H3Event {
  return {
    context: {
      requestId: opts.requestId,
      auth: opts.userId !== undefined
        ? { user: { id: opts.userId } }
        : undefined,
    },
  } as unknown as H3Event
}

describe('04.langfuseContext middleware', () => {
  it('从 event.context.requestId / auth.user.id enterWith ALS', () => {
    const event = makeFakeEvent({ requestId: 'req-A', userId: 7 })
    langfuseContextMiddleware(event)
    const ctx = getLangfuseContext()
    expect(ctx?.requestId).toBe('req-A')
    expect(ctx?.userId).toBe(7)
  })

  it('未鉴权时 userId 为 undefined（公开 API）', () => {
    const event = makeFakeEvent({ requestId: 'req-B' })
    langfuseContextMiddleware(event)
    const ctx = getLangfuseContext()
    expect(ctx?.requestId).toBe('req-B')
    expect(ctx?.userId).toBeUndefined()
  })
})
