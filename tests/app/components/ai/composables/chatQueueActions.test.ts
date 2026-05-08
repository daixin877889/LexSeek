import { describe, it, expect } from 'vitest'
import {
  buildAttachmentsPayload,
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

describe('chatQueueActions / buildAttachmentsPayload', () => {
  function makeFile(over: Partial<{ id: number; fileName: string; fileType: string; fileSize: number; encrypted: boolean }> = {}) {
    return {
      id: 101,
      fileName: 'a.pdf',
      fileType: 'application/pdf',
      fileSize: 1024,
      encrypted: false,
      source: 1,
      sourceName: '案件分析',
      status: 1,
      statusName: '正常',
      createdAt: '2026-04-01T00:00:00Z',
      ...over,
    }
  }

  it('无 files 时返回原始 trim 文本，无 additionalKwargs', () => {
    const result = buildAttachmentsPayload('  你好  ', undefined)
    expect(result.content).toBe('你好')
    expect(result.additionalKwargs).toBeUndefined()
  })

  it('files 为空数组也视作无附件', () => {
    const result = buildAttachmentsPayload('hi', [])
    expect(result.content).toBe('hi')
    expect(result.additionalKwargs).toBeUndefined()
  })

  it('附件 + 文本：sentinel 在前文本在后', () => {
    const result = buildAttachmentsPayload('请分析', [makeFile() as any])
    expect(result.content.startsWith('__ATTACHMENTS__\n')).toBe(true)
    expect(result.content.endsWith('请分析')).toBe(true)
    expect(result.additionalKwargs?.attachments).toHaveLength(1)
    expect(result.additionalKwargs?.attachments?.[0]).toMatchObject({
      id: 101,
      fileName: 'a.pdf',
      fileType: 'application/pdf',
      fileSize: 1024,
      encrypted: false,
    })
  })

  it('附件 + 空文本：sentinel 单独构成 content', () => {
    const result = buildAttachmentsPayload('', [makeFile() as any])
    expect(result.content.startsWith('__ATTACHMENTS__\n')).toBe(true)
    expect(result.content).not.toMatch(/\n\n.+$/)
  })

  it('多附件 attachments 数组保序', () => {
    const files = [
      makeFile({ id: 1, fileName: 'a.pdf' }),
      makeFile({ id: 2, fileName: 'b.png' }),
      makeFile({ id: 3, fileName: 'c.mp3' }),
    ] as any[]
    const result = buildAttachmentsPayload('多文件', files)
    expect(result.additionalKwargs?.attachments).toHaveLength(3)
    expect(result.additionalKwargs?.attachments?.map((f: any) => f.id)).toEqual([1, 2, 3])
  })

  it('attachments payload 仅保留 5 个轻量字段，不携带 OssFileItem 其他字段', () => {
    const result = buildAttachmentsPayload('', [makeFile({ id: 99 }) as any])
    const att = result.additionalKwargs?.attachments?.[0]
    expect(Object.keys(att ?? {}).sort()).toEqual(
      ['encrypted', 'fileName', 'fileSize', 'fileType', 'id'].sort(),
    )
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
