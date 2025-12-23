/**
 * 上传文件来源
 */
export enum FileSource {
    /** 文件 */
    FILE = "file",
    /** ASR 识别 */
    ASR = "asr",
    /** 文档 */
    DOC = "doc",
    /** 图片 */
    IMAGE = "image",
    /** 视频 */
    VIDEO = "video",
    /** 案件分析 */
    CASE_ANALYSIS = "caseAnalysis",
}

/**
 * 上传文件来源名称
 */
export const FileSourceName = {
    [FileSource.FILE]: "云盘上传",
    [FileSource.ASR]: "语音识别",
    [FileSource.DOC]: "文档识别",
    [FileSource.IMAGE]: "图片识别",
    [FileSource.VIDEO]: "视频",
    [FileSource.CASE_ANALYSIS]: "案件分析",
}

// 文件来源允许的文件类型及最大大小
export type FileSourceAccept = {
    name: (typeof FileSourceName)[FileSource]
    accept: { name: string, mime: string, maxSize: number }[]
}



/**
 * OSS 文件状态
 */
export enum OssFileStatus {
    /** 未上传 */
    PENDING = 0,
    /** 已上传 */
    UPLOADED = 1,
    /** 上传失败 */
    FAILED = 2,
}

/**
 * 上传文件状态名称
 */
export const OssFileStatusName = {
    [OssFileStatus.PENDING]: "未上传",
    [OssFileStatus.UPLOADED]: "上传完成",
    [OssFileStatus.FAILED]: "上传失败",
}

/**
 * 文件类型
 */
export enum FileType {
    DOC = "文档",
    AUDIO = "音频",
    IMAGE = "图片",
    VIDEO = "视频",
    JSON = "JSON文件",
    OTHER = "其他",
}
