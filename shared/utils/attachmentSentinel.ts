/**
 * 聊天消息附件 sentinel —— 双端共用的单一数据源。
 *
 * 前端把"用户上传的文件"编码成 message content 前缀：
 *   __ATTACHMENTS__\n[{id,fileName,fileType,fileSize,encrypted}, ...]\n\n正文
 * 写端（chatQueueActions）、前端读端（useMessageParser）、服务端读端（中间件）
 * 都从这里取常量与解析逻辑，禁止各自再抄一份。
 */

/** content sentinel 前缀 */
export const ATTACH_SENTINEL = '__ATTACHMENTS__\n'

/** sentinel 后的轻量附件元数据 */
export interface AttachmentPayloadItem {
  id: number
  fileName: string
  fileType: string
  fileSize: number
  encrypted: boolean
}

function isAttachmentPayloadItem(a: unknown): a is AttachmentPayloadItem {
  return !!a && typeof a === 'object'
    && Number.isInteger((a as AttachmentPayloadItem).id)
    && (a as AttachmentPayloadItem).id > 0
}

/**
 * 解析 message content：分离附件清单与去掉 sentinel 后的正文。
 *
 * 这是唯一的 sentinel 解析核心——前端 useMessageParser 与服务端中间件都基于它，
 * 禁止再各写一份。
 *
 * @returns attachments 附件清单（无附件 / 解析失败为 []）；rawContent 去掉 sentinel 后的正文
 */
export function splitAttachmentSentinel(
  content: string,
): { attachments: AttachmentPayloadItem[]; rawContent: string } {
  if (!content.startsWith(ATTACH_SENTINEL)) {
    return { attachments: [], rawContent: content }
  }
  const newlineIdx = content.indexOf('\n', ATTACH_SENTINEL.length)
  const json = newlineIdx === -1
    ? content.slice(ATTACH_SENTINEL.length)
    : content.slice(ATTACH_SENTINEL.length, newlineIdx)
  const rawContent = newlineIdx === -1
    ? ''
    : content.slice(newlineIdx + 1).replace(/^\n+/, '')
  let attachments: AttachmentPayloadItem[] = []
  try {
    const arr = JSON.parse(json)
    if (Array.isArray(arr)) attachments = arr.filter(isAttachmentPayloadItem)
  } catch {
    // sentinel JSON 解析失败，忽略
  }
  return { attachments, rawContent }
}

/**
 * 解析 message content 里的附件清单。无附件 / 解析失败返回 []。
 */
export function parseAttachments(content: string): AttachmentPayloadItem[] {
  return splitAttachmentSentinel(content).attachments
}

/**
 * 解析 message content，仅返回去重后的 ossFileId 列表。
 */
export function parseAttachmentFileIds(content: string): number[] {
  return [...new Set(parseAttachments(content).map(a => a.id))]
}
