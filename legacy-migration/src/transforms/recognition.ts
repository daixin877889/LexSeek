import type { LAsrRecord, LAsrTask, LDocRecognition, LImageRecognition } from '../legacyTypes'
import { tsFallback } from './helpers'

/** §8.1 asr_tasks：新增 isEncrypted=false */
export function transformAsrTask(o: LAsrTask, migratedAt: Date) {
  const ts = tsFallback(o.createdAt, o.updatedAt, migratedAt)
  return {
    id: o.id,
    taskId: o.taskId,
    status: o.status,
    isEncrypted: false,
    taskRawData: o.taskRawData ?? undefined,
    result: o.result ?? undefined,
    createdAt: ts.createdAt,
    updatedAt: ts.updatedAt,
    deletedAt: o.deletedAt,
  }
}

/** §8.1 asr_records：新增 tempFilePath=null；vectorIds 重置 []、lastEmbeddingAt 重置 null */
export function transformAsrRecord(o: LAsrRecord, migratedAt: Date) {
  const ts = tsFallback(o.createdAt, o.updatedAt, migratedAt)
  return {
    id: o.id,
    userId: o.userId,
    ossFileId: o.ossFileId,
    asrTasksId: o.asrTasksId,
    status: o.status,
    audioUrl: o.audioUrl,
    audioDuration: o.audioDuration,
    result: o.result ?? undefined,
    jsonOssFileId: o.jsonOssFileId,
    tempFilePath: null,
    speakers: o.speakers ?? undefined,
    keywords: o.keywords ?? undefined,
    summary: o.summary,
    vectorIds: [],
    lastEmbeddingAt: null,
    lastEditAt: o.lastEditAt,
    createdAt: ts.createdAt,
    updatedAt: ts.updatedAt,
    deletedAt: o.deletedAt,
  }
}

/** §8.1 doc_recognition_records：vectorIds 重置 []、lastEmbeddingAt 重置 null */
export function transformDocRecognition(o: LDocRecognition, migratedAt: Date) {
  const ts = tsFallback(o.createdAt, o.updatedAt, migratedAt)
  return {
    id: o.id,
    userId: o.userId,
    ossFileId: o.ossFileId,
    status: o.status,
    htmlContent: o.htmlContent,
    markdownContent: o.markdownContent,
    keywords: o.keywords ?? undefined,
    summary: o.summary,
    vectorIds: [],
    lastEmbeddingAt: null,
    lastEditAt: o.lastEditAt,
    createdAt: ts.createdAt,
    updatedAt: ts.updatedAt,
    deletedAt: o.deletedAt,
  }
}

/** §8.1 image_recognition_records：同上；imageType 字段 100→50，preflight 已扫长度 */
export function transformImageRecognition(o: LImageRecognition, migratedAt: Date) {
  const ts = tsFallback(o.createdAt, o.updatedAt, migratedAt)
  return {
    id: o.id,
    userId: o.userId,
    ossFileId: o.ossFileId,
    status: o.status,
    imageType: o.imageType,
    htmlContent: o.htmlContent,
    markdownContent: o.markdownContent,
    keywords: o.keywords ?? undefined,
    summary: o.summary,
    vectorIds: [],
    lastEmbeddingAt: null,
    lastEditAt: o.lastEditAt,
    createdAt: ts.createdAt,
    updatedAt: ts.updatedAt,
    deletedAt: o.deletedAt,
  }
}
