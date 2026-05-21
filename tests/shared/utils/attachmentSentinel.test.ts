import { describe, it, expect } from 'vitest'
import { ATTACH_SENTINEL, parseAttachmentFileIds, splitAttachmentSentinel } from '#shared/utils/attachmentSentinel'

describe('parseAttachmentFileIds', () => {
  it('从带 sentinel 的内容解析出 ossFileId 列表', () => {
    const content = `${ATTACH_SENTINEL}${JSON.stringify([
      { id: 11, fileName: 'a.jpg', fileType: 'image/jpeg', fileSize: 1, encrypted: false },
      { id: 22, fileName: 'b.pdf', fileType: 'application/pdf', fileSize: 2, encrypted: false },
    ])}\n\n请看图片`
    expect(parseAttachmentFileIds(content)).toEqual([11, 22])
  })

  it('无 sentinel 时返回空数组', () => {
    expect(parseAttachmentFileIds('普通文本')).toEqual([])
  })

  it('sentinel 后 JSON 畸形时返回空数组', () => {
    expect(parseAttachmentFileIds(`${ATTACH_SENTINEL}{不是数组`)).toEqual([])
  })

  it('过滤掉非正整数 id', () => {
    const content = `${ATTACH_SENTINEL}${JSON.stringify([
      { id: 5 }, { id: 0 }, { id: -1 }, { id: 'x' }, {},
    ])}`
    expect(parseAttachmentFileIds(content)).toEqual([5])
  })
})

describe('splitAttachmentSentinel', () => {
  it('分离附件清单与去 sentinel 后的正文', () => {
    const content = `${ATTACH_SENTINEL}${JSON.stringify([
      { id: 3, fileName: 'c.jpg', fileType: 'image/jpeg', fileSize: 1, encrypted: false },
    ])}\n\n正文内容`
    const r = splitAttachmentSentinel(content)
    expect(r.attachments.map(a => a.id)).toEqual([3])
    expect(r.rawContent).toBe('正文内容')
  })

  it('无 sentinel 时 attachments 为空、rawContent 原样返回', () => {
    expect(splitAttachmentSentinel('普通文本')).toEqual({ attachments: [], rawContent: '普通文本' })
  })
})
