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

