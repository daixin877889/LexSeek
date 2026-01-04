/**
 * 法律内容解析相关类型定义
 */

/**
 * 解析后的条文数据结构
 */
export interface ParsedArticle {
    /** 条文类型：notice(通知)、header(正文头部)、footer(正文尾部)、annex(附件)、l1-l5(各级标题) */
    type: 'notice' | 'header' | 'footer' | 'annex' | 'l1' | 'l2' | 'l3' | 'l4' | 'l5'
    /** 一级标题(编) */
    l1: string | null
    /** 一级标题序号 */
    l1I: number | null
    /** 二级标题(分编) */
    l2: string | null
    /** 二级标题序号 */
    l2I: number | null
    /** 三级标题(章) */
    l3: string | null
    /** 三级标题序号 */
    l3I: number | null
    /** 四级标题(节) */
    l4: string | null
    /** 四级标题序号 */
    l4I: number | null
    /** 五级标题(条) */
    l5: string | null
    /** 五级标题序号 */
    l5I: number | null
    /** 条文内容 */
    content: string | null
}
