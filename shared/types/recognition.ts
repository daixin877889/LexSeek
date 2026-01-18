/**
 * 识别相关类型定义
 *
 * 包含文档识别、图片识别、音频识别的状态枚举和类型定义
 */

// ==================== 文档识别 ====================

/** 文档识别状态枚举 */
export enum DocRecognitionStatus {
    /** 待处理 */
    PENDING = 0,
    /** 处理中 */
    PROCESSING = 1,
    /** 成功 */
    SUCCESS = 2,
    /** 失败 */
    FAILED = 3,
}

/** 文档识别状态文本映射 */
export const DocRecognitionStatusText: Record<DocRecognitionStatus, string> = {
    [DocRecognitionStatus.PENDING]: '待处理',
    [DocRecognitionStatus.PROCESSING]: '处理中',
    [DocRecognitionStatus.SUCCESS]: '成功',
    [DocRecognitionStatus.FAILED]: '失败',
}

// ==================== 图片识别 ====================

/** 图片识别状态枚举 */
export enum ImageRecognitionStatus {
    /** 待处理 */
    PENDING = 0,
    /** 处理中 */
    PROCESSING = 1,
    /** 已完成 */
    COMPLETED = 2,
    /** 失败 */
    FAILED = 3,
}

/** 图片识别状态文本映射 */
export const ImageRecognitionStatusText: Record<ImageRecognitionStatus, string> = {
    [ImageRecognitionStatus.PENDING]: '待处理',
    [ImageRecognitionStatus.PROCESSING]: '处理中',
    [ImageRecognitionStatus.COMPLETED]: '已完成',
    [ImageRecognitionStatus.FAILED]: '失败',
}

/** 图片类型枚举 */
export enum ImageType {
    /** 文档 */
    DOC = 'doc',
    /** 照片 */
    PHOTO = 'photo',
}

// ==================== 音频识别 ====================

/** ASR 识别记录状态枚举 */
export enum AsrRecordStatus {
    /** 待处理 */
    PENDING = 0,
    /** 处理中 */
    PROCESSING = 1,
    /** 成功 */
    SUCCESS = 2,
    /** 失败 */
    FAILED = 3,
}

/** ASR 识别记录状态文本映射 */
export const AsrRecordStatusText: Record<AsrRecordStatus, string> = {
    [AsrRecordStatus.PENDING]: '待处理',
    [AsrRecordStatus.PROCESSING]: '处理中',
    [AsrRecordStatus.SUCCESS]: '成功',
    [AsrRecordStatus.FAILED]: '失败',
}

/** ASR 任务状态枚举 */
export enum AsrTaskStatus {
    /** 待处理 */
    PENDING = 0,
    /** 处理中 */
    PROCESSING = 1,
    /** 成功 */
    SUCCESS = 2,
    /** 失败 */
    FAILED = 3,
    /** 已被替代（重试后的旧任务） */
    SUPERSEDED = 4,
}

/** ASR 任务状态文本映射 */
export const AsrTaskStatusText: Record<AsrTaskStatus, string> = {
    [AsrTaskStatus.PENDING]: '待处理',
    [AsrTaskStatus.PROCESSING]: '处理中',
    [AsrTaskStatus.SUCCESS]: '成功',
    [AsrTaskStatus.FAILED]: '失败',
    [AsrTaskStatus.SUPERSEDED]: '已被替代',
}

// ==================== MinerU 任务 ====================

/** MinerU 任务状态枚举 */
export enum MineruTaskStatus {
    /** 待处理 */
    PENDING = 0,
    /** 处理中 */
    PROCESSING = 1,
    /** 成功 */
    SUCCESS = 2,
    /** 失败 */
    FAILED = 3,
    /** 已被替代（重试后的旧任务） */
    SUPERSEDED = 4,
}

/** MinerU 任务状态文本映射 */
export const MineruTaskStatusText: Record<MineruTaskStatus, string> = {
    [MineruTaskStatus.PENDING]: '待处理',
    [MineruTaskStatus.PROCESSING]: '处理中',
    [MineruTaskStatus.SUCCESS]: '成功',
    [MineruTaskStatus.FAILED]: '失败',
    [MineruTaskStatus.SUPERSEDED]: '已被替代',
}
