import type { LOssFile } from '../legacyTypes'

/**
 * §8.1 oss_files：直拷；新增 encrypted=false、originalMimeType=null。
 * source：被 case_materials 引用的文件（用户上传的案件材料）旧来源标签为
 * doc/image/asr，与新产品 caseAnalysis 体系不一致——统一改为 caseAnalysis，
 * 否则新产品材料选择器（按 source 过滤）看不到迁移来的材料。其余文件保留原 source。
 */
export function transformOssFile(o: LOssFile, materialOssFileIds: Set<number>) {
  return {
    id: o.id,
    userId: o.userId,
    bucketName: o.bucketName,
    fileName: o.fileName,
    filePath: o.filePath,
    fileSize: o.fileSize,
    fileType: o.fileType,
    fileMd5: o.fileMd5,
    source: materialOssFileIds.has(o.id) ? 'caseAnalysis' : o.source,
    status: o.status,
    encrypted: false,
    originalMimeType: null,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    deletedAt: o.deletedAt,
  }
}
