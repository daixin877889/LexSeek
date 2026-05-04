/**
 * Langfuse 业务上下文（AsyncLocalStorage）
 *
 * - withLangfuseContext(patch, fn): 包裹一段异步代码；patch 增量合入当前上下文（业务节点用）
 * - enterLangfuseContext(patch): 同步进入 ALS（仅供 H3 middleware 用——middleware 是顺序执行的、
 *     没有 callback 包裹结构，必须用 enterWith 而非 run）
 * - getLangfuseContext(): 同步取当前上下文，无则 undefined
 *
 * 同步语义：modelProxy 在 invoke 拦截器内同步读 ALS，行为见 als-sync.test.ts
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import type { LangfuseTraceContext } from './types'

const storage = new AsyncLocalStorage<LangfuseTraceContext>()

export function getLangfuseContext(): LangfuseTraceContext | undefined {
  return storage.getStore()
}

export async function withLangfuseContext<T>(
  patch: Partial<LangfuseTraceContext>,
  fn: () => Promise<T>,
): Promise<T> {
  const merged = mergeContext(storage.getStore(), patch)
  return storage.run(merged, fn)
}

export function enterLangfuseContext(patch: Partial<LangfuseTraceContext>): void {
  const merged = mergeContext(storage.getStore(), patch)
  storage.enterWith(merged)
}

function mergeContext(
  current: LangfuseTraceContext | undefined,
  patch: Partial<LangfuseTraceContext>,
): LangfuseTraceContext {
  return {
    requestId: '',
    ...current,
    ...stripUndefined(patch),
  }
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  const out = {} as Partial<T>
  for (const [k, v] of Object.entries(obj) as Array<[keyof T, T[keyof T]]>) {
    if (v !== undefined) out[k] = v
  }
  return out
}
