/**
 * 聊天消息队列纯函数与类型定义
 *
 * 零响应式依赖，100% 可单元测试。
 * 所有函数遵守 immutability：返回新 Map，不 mutate 入参。
 *
 * 详见 spec §4.3 / §4.5 / §5.3。
 */

import type { OssFileItem } from '~/store/file'

export interface QueueItem {
  /** nanoid()，仅用于 UI key 和删除定位 */
  id: string
  /** 原始用户输入文本 */
  text: string
  /**
   * 前瞻性字段：当前两个对话场景均 enable-file-upload=false，
   * 队列结构先行支持，实际派发时暂不传递（详见 spec §5.6）
   */
  files?: OssFileItem[]
  /** 入队时的"深度思考"开关状态 */
  thinking: boolean
  /** Date.now()，用于排序与跨标签同步的时序校验 */
  enqueuedAt: number
}

export type QueuePauseReason = 'stopped' | 'failed' | null

/** 队列容量上限（spec §3 决策） */
export const QUEUE_MAX_SIZE = 5

// ─────────────────────────────────────────────────
// 纯函数：所有操作返回新 Map
// ─────────────────────────────────────────────────

export interface EnqueueResult {
  next: Map<string, QueueItem[]>
  ok: boolean
}

/**
 * 入队：未满时返回新 Map + ok=true，已满时返回原 Map + ok=false
 */
export function enqueueAction(
  current: Map<string, QueueItem[]>,
  sessionId: string,
  item: QueueItem,
): EnqueueResult {
  const existing = current.get(sessionId) ?? []
  if (existing.length >= QUEUE_MAX_SIZE) {
    return { next: current, ok: false }
  }
  const next = new Map(current)
  next.set(sessionId, [...existing, item])
  return { next, ok: true }
}

/**
 * 按 id 删除单条；id 不存在时静默返回新 Map
 */
export function removeAction(
  current: Map<string, QueueItem[]>,
  sessionId: string,
  itemId: string,
): Map<string, QueueItem[]> {
  const existing = current.get(sessionId) ?? []
  const filtered = existing.filter(i => i.id !== itemId)
  const next = new Map(current)
  next.set(sessionId, filtered)
  return next
}

/**
 * 清空指定 session 队列
 */
export function clearAction(
  current: Map<string, QueueItem[]>,
  sessionId: string,
): Map<string, QueueItem[]> {
  const next = new Map(current)
  next.set(sessionId, [])
  return next
}

/**
 * 设置暂停原因
 */
export function pauseAction(
  current: Map<string, Exclude<QueuePauseReason, null>>,
  sessionId: string,
  reason: Exclude<QueuePauseReason, null>,
): Map<string, Exclude<QueuePauseReason, null>> {
  const next = new Map(current)
  next.set(sessionId, reason)
  return next
}

/**
 * 清除暂停标记（统一使用 delete 而非 set null，与 isQueuePaused 的宽松比较 `!= null` 配合）
 */
export function resumeAction(
  current: Map<string, Exclude<QueuePauseReason, null>>,
  sessionId: string,
): Map<string, Exclude<QueuePauseReason, null>> {
  const next = new Map(current)
  next.delete(sessionId)
  return next
}
