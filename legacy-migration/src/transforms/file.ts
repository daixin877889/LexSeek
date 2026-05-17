import type { LOssFile } from '../legacyTypes'

/** §8.1 oss_files：直拷（旧 createdAt/updatedAt 可空、新库也可空）；新增 encrypted=false、originalMimeType=null */
export function transformOssFile(o: LOssFile) {
  return {
    id: o.id,
    userId: o.userId,
    bucketName: o.bucketName,
    fileName: o.fileName,
    filePath: o.filePath,
    fileSize: o.fileSize,
    fileType: o.fileType,
    fileMd5: o.fileMd5,
    source: o.source,
    status: o.status,
    encrypted: false,
    originalMimeType: null,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    deletedAt: o.deletedAt,
  }
}
