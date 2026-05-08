import { describe, it, expect } from 'vitest'
import {
  enqueueAction,
  removeAction,
  clearAction,
  pauseAction,
  resumeAction,
  QUEUE_MAX_SIZE,
  type QueueItem,
} from '~/composables/chatQueueActions'

function makeItem(text = '测试'): QueueItem {
  return {
    id: Math.random().toString(36).slice(2),
    text,
    thinking: false,
    enqueuedAt: Date.now(),
  }
}

describe('chatQueueActions / enqueueAction', () => {
  it('队列未满时添加成功', () => {
    const before = new Map<string, QueueItem[]>([['sess-a', []]])
    const { next, ok } = enqueueAction(before, 'sess-a', makeItem('你好'))
    expect(ok).toBe(true)
    expect(next.get('sess-a')).toHaveLength(1)
    expect(before.get('sess-a')).toHaveLength(0) // 旧 Map 未被 mutate
  })

  it('队列满时返回 false 且 Map 不变', () => {
    const full = new Map([['sess-a', Array.from({ length: QUEUE_MAX_SIZE }, () => makeItem())]])
    const { next, ok } = enqueueAction(full, 'sess-a', makeItem('第六'))
    expect(ok).toBe(false)
    expect(next).toBe(full)
  })

  it('未存在 session 自动创建空队列', () => {
    const before = new Map<string, QueueItem[]>()
    const { next, ok } = enqueueAction(before, 'new-sess', makeItem('首条'))
    expect(ok).toBe(true)
    expect(next.get('new-sess')).toHaveLength(1)
  })

  it('不同 session 相互隔离', () => {
    const before = new Map([['sess-a', [makeItem('A')]]])
    const { next } = enqueueAction(before, 'sess-b', makeItem('B'))
    expect(next.get('sess-a')).toHaveLength(1)
    expect(next.get('sess-b')).toHaveLength(1)
  })

  it('入队顺序正确（FIFO 队尾追加）', () => {
    const a = makeItem('first')
    const b = makeItem('second')
    const before = new Map<string, QueueItem[]>([['sess-a', [a]]])
    const { next } = enqueueAction(before, 'sess-a', b)
    expect(next.get('sess-a')).toEqual([a, b])  // a 在前，b 在后（FIFO 队尾追加）
  })
})

describe('chatQueueActions / removeAction', () => {
  it('按 id 删除', () => {
    const a = makeItem('a')
    const b = makeItem('b')
    const before = new Map([['sess-a', [a, b]]])
    const next = removeAction(before, 'sess-a', a.id)
    expect(next.get('sess-a')).toEqual([b])
  })

  it('id 不存在不报错且 Map 不变', () => {
    const before = new Map([['sess-a', [makeItem('a')]]])
    const next = removeAction(before, 'sess-a', 'not-exist')
    expect(next.get('sess-a')).toHaveLength(1)
  })
})

describe('chatQueueActions / clearAction', () => {
  it('只清当前 session', () => {
    const before = new Map([
      ['sess-a', [makeItem('a')]],
      ['sess-b', [makeItem('b')]],
    ])
    const next = clearAction(before, 'sess-a')
    expect(next.get('sess-a')).toEqual([])
    expect(next.get('sess-b')).toHaveLength(1)
  })
})

describe('chatQueueActions / pauseAction & resumeAction', () => {
  it('pauseAction 写入原因', () => {
    const before = new Map<string, 'stopped' | 'failed'>()
    const next = pauseAction(before, 'sess-a', 'stopped')
    expect(next.get('sess-a')).toBe('stopped')
  })

  it('resumeAction 从 Map 中删除暂停标记', () => {
    const before = new Map<string, 'stopped' | 'failed'>([['sess-a', 'failed']])
    const next = resumeAction(before, 'sess-a')
    expect(next.has('sess-a')).toBe(false)
  })
})
