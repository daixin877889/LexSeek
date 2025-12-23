/**
 * 单位类型
 */
export enum UnitType {
    /** 时间 */
    TIME = 1,
    /** 文件大小 */
    FILE_SIZE = 2,
    /** 次数 */
    COUNT = 3,
}

/**
 * 时间单位类型
 */
export enum TimeUnit {
    /** 毫秒 */
    MILLISECOND = "毫秒",
    /** 秒 */
    SECOND = "秒",
    /** 分钟 */
    MINUTE = "分钟",
    /** 小时 */
    HOUR = "小时",
    /** 天 */
    DAY = "天",
    /** 月 */
    MONTH = "月",
}

/**
 * 文件尺寸单位类型
 */
export enum FileSizeUnit {
    /** 字节 */
    BYTE = "Byte",
    /** 千字节 */
    KB = "KB",
    /** 兆字节 */
    MB = "MB",
    /** 吉字节 */
    GB = "GB",
    /** 太字节 */
    TB = "TB",
}

/**
 * 次数单位类型
 */
export enum CountUnit {
    /** 次 */
    COUNT = "次",
}
