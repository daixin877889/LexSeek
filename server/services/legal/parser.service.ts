/**
 * 法律内容解析服务
 * 
 * 提供两种解析系统：
 * - 系统一：解析使用 Markdown 标题(#, ##, ###)的文档
 * - 系统二：解析使用中文/阿拉伯数字标题(一、, 1.)的司法解释类文档
 * 
 * 移植自 LexSeek/laws/lawNew/lawSplitting.js
 */

import type { ParsedArticle } from '#shared/types/legal-parser'

/**
 * 将中文数字字符串转换为阿拉伯数字
 * 
 * @param chineseStr - 中文数字字符串，如 "一"、"十二"、"三百五十六"
 * @returns 转换后的阿拉伯数字
 * 
 * @example
 * convertChineseNumberToArabic("一") // 1
 * convertChineseNumberToArabic("十二") // 12
 * convertChineseNumberToArabic("三百五十六") // 356
 */
export function convertChineseNumberToArabic(chineseStr: string): number {
    // 如果已经是阿拉伯数字，直接返回
    if (/^\d+$/.test(chineseStr)) {
        return parseInt(chineseStr, 10)
    }

    // 中文数字字符映射
    const charMap: Record<string, number> = {
        '零': 0, '一': 1, '二': 2, '三': 3, '四': 4,
        '五': 5, '六': 6, '七': 7, '八': 8, '九': 9
    }

    // 单位映射
    const unitMap: Record<string, number> = {
        '十': 10, '百': 100, '千': 1000, '万': 10000, '亿': 100000000
    }

    let total = 0
    let section = 0
    let num = 0

    for (let i = 0; i < chineseStr.length; i++) {
        const char = chineseStr[i]
        if (char in charMap) {
            num = charMap[char]
        } else if (char in unitMap) {
            const unit = unitMap[char]
            if (unit >= 10000) {
                total += (section + num) * unit
                section = 0
            } else {
                section += (num || 1) * unit
            }
            num = 0
        }
    }

    total += section + num
    return total
}

/**
 * 从标题中提取数字（系统一专用）
 * 
 * @param title - 标题文本
 * @param level - 标题级别 (1-5)
 * @returns 提取的数字，如果无法提取则返回 null
 */
function parseMarkdownToNumber(title: string, level: number): number | null {
    // 为每个级别定义多种匹配模式，按优先级排序
    const patterns: Record<number, RegExp[]> = {
        1: [
            /第([一二三四五六七八九十百千万零\d]+)编/,           // 原有格式：第X编
            /([一二三四五六七八九十百千万零]+)、/,               // 中文数字序号：一、二、三、
            /(\d+)[\.\．、]/,                                  // 阿拉伯数字：1. 1、 1．
            /[\(（]([一二三四五六七八九十百千万零]+)[\)）]/,    // 括号中文数字：(一) (二) （一） （二）
            /[\(（](\d+)[\)）]/,                             // 括号阿拉伯数字：(1) (2) （1） （2）
        ],
        2: [
            /第([一二三四五六七八九十百千万零\d]+)分编/,         // 原有格式：第X分编
            /([一二三四五六七八九十百千万零]+)、/,               // 中文数字序号：一、二、三、
            /(\d+)[\.\．、]/,                                  // 阿拉伯数字：1. 1、 1．
            /[\(（]([一二三四五六七八九十百千万零]+)[\)）]/,    // 括号中文数字：(一) (二) （一） （二）
            /[\(（](\d+)[\)）]/,                             // 括号阿拉伯数字：(1) (2) （1） （2）
        ],
        3: [
            /第([一二三四五六七八九十百千万零\d]+)章/,           // 原有格式：第X章
            /([一二三四五六七八九十百千万零]+)、/,               // 中文数字序号：一、二、三、
            /(\d+)[\.\．、]/,                                  // 阿拉伯数字：1. 1、 1．
            /[\(（]([一二三四五六七八九十百千万零]+)[\)）]/,    // 括号中文数字：(一) (二) （一） （二）
            /[\(（](\d+)[\)）]/,                             // 括号阿拉伯数字：(1) (2) （1） （2）
        ],
        4: [
            /第([一二三四五六七八九十百千万零\d]+)节/,           // 原有格式：第X节
            /([一二三四五六七八九十百千万零]+)、/,               // 中文数字序号：一、二、三、
            /(\d+)[\.\．、]/,                                  // 阿拉伯数字：1. 1、 1．
            /[\(（]([一二三四五六七八九十百千万零]+)[\)）]/,    // 括号中文数字：(一) (二) （一） （二）
            /[\(（](\d+)[\)）]/,                             // 括号阿拉伯数字：(1) (2) （1） （2）
        ],
        5: [
            /第([一二三四五六七八九十百千万零\d]+)条/,           // 原有格式：第X条
            /([一二三四五六七八九十百千万零]+)、/,               // 中文数字序号：一、二、三、
            /(\d+)[\.\．、]/,                                  // 阿拉伯数字：1. 1、 1．
            /[\(（]([一二三四五六七八九十百千万零]+)[\)）]/,    // 括号中文数字：(一) (二) （一） （二）
            /[\(（](\d+)[\)）]/,                             // 括号阿拉伯数字：(1) (2) （1） （2）
        ],
    }

    const levelPatterns = patterns[level] || []
    for (const pattern of levelPatterns) {
        const match = title.match(pattern)
        if (match && match[1]) {
            return convertChineseNumberToArabic(match[1])
        }
    }
    return null
}

/**
 * 解析 Markdown 标题和内容（系统一辅助函数）
 * 
 * @param headingsText - 包含 Markdown 标题的文本
 * @param initialLevels - 初始层级对象
 * @returns 解析后的条文数组
 */
function parseHeadingsAndContent(
    headingsText: string,
    initialLevels: Omit<ParsedArticle, 'type' | 'content'>
): ParsedArticle[] {
    const jsonResult: ParsedArticle[] = []
    const currentLevels = JSON.parse(JSON.stringify(initialLevels))
    const parts = headingsText.split(/(^#{1,5}\s.*$)/m)

    if (parts.length > 0 && parts[0].trim() === '') {
        parts.shift()
    }

    for (let i = 0; i < parts.length; i += 2) {
        const headingLine = parts[i]
        if (!headingLine) continue

        const trimmedHeadingLine = headingLine.trim()
        const level = (trimmedHeadingLine.match(/^#+/) || [''])[0].length
        const headingText = trimmedHeadingLine.replace(/^#+\s*/, '')

        currentLevels[`l${level}` as keyof typeof currentLevels] = headingText
        currentLevels[`l${level}I` as keyof typeof currentLevels] = parseMarkdownToNumber(headingText, level)

        for (let j = level + 1; j <= 5; j++) {
            currentLevels[`l${j}` as keyof typeof currentLevels] = null
            currentLevels[`l${j}I` as keyof typeof currentLevels] = null
        }

        const contentText = (parts[i + 1] || '').trim()
        jsonResult.push({
            type: `l${level}` as ParsedArticle['type'],
            ...currentLevels,
            content: contentText,
        })
    }
    return jsonResult
}

/**
 * [系统一] 解析使用 Markdown 标题(#)的文档
 * 
 * @param rawText - 包含 Markdown 标题的原始文本
 * @returns 解析后的条文数组
 */
export function parseDocument(rawText: string): ParsedArticle[] {
    // 移除 frontmatter
    const content = rawText.replace(/^\s*---[\s\S]*?---\s*/, '')
    const finalJson: ParsedArticle[] = []
    let preAnnexContent = content
    let annexesContent = ''

    // 初始化层级对象
    const nullLevels: Omit<ParsedArticle, 'type' | 'content'> = {
        l1: null, l1I: null, l2: null, l2I: null, l3: null, l3I: null,
        l4: null, l4I: null, l5: null, l5I: null,
    }

    // 步骤 1: 分离附件
    const firstAnnexIndex = content.search(/\s*>annex<\s*/)
    if (firstAnnexIndex !== -1) {
        preAnnexContent = content.substring(0, firstAnnexIndex).trim()
        annexesContent = content.substring(firstAnnexIndex).trim()
    }

    // 步骤 2: 查找主内容开始位置
    const mainContentStartIndex = preAnnexContent.search(/^#{1,5}\s.*$/m)
    let preambleText = preAnnexContent
    let mainContentText = ''

    if (mainContentStartIndex !== -1) {
        preambleText = preAnnexContent.substring(0, mainContentStartIndex).trim()
        mainContentText = preAnnexContent.substring(mainContentStartIndex).trim()
    }

    // 步骤 3: 处理前言部分（notice 和 header）
    const hasNoticeTag = preambleText.includes('>notice<')
    const hasHeaderTag = preambleText.includes('>header<')

    if (hasNoticeTag || hasHeaderTag) {
        const headerParts = preambleText.split(/\s*>header<\s*/)
        const noticesArea = headerParts[0] || ''

        // 处理 notice 部分
        if (hasNoticeTag) {
            const noticeParts = noticesArea.split(/\s*>notice<\s*/)
            noticeParts.forEach((noticeText, index) => {
                const trimmedContent = noticeText.trim()
                if (trimmedContent) {
                    finalJson.push({ type: 'notice', ...nullLevels, content: trimmedContent, l3I: index + 1 })
                }
            })
        }

        // 处理多个 header
        if (hasHeaderTag) {
            headerParts.slice(1).forEach((headerText, index) => {
                if (headerText.trim()) {
                    finalJson.push({
                        type: 'header',
                        ...nullLevels,
                        content: headerText.trim(),
                        l1I: index + 1
                    })
                }
            })
        }
    } else {
        // 没有标签的情况，整个前言作为 header
        if (preambleText.trim()) {
            finalJson.push({ type: 'header', ...nullLevels, content: preambleText.trim() })
        }
    }

    // 步骤 4: 解析主内容
    if (mainContentText) {
        const mainContentJson = parseHeadingsAndContent(mainContentText, nullLevels)
        finalJson.push(...mainContentJson)
    }

    // 步骤 5: 解析底部内容（footer 和 annex）
    if (annexesContent) {
        if (annexesContent.includes('>footer<')) {
            finalJson.push(...parseBottomContent(annexesContent))
        } else {
            // 兼容旧版本，只有 annex
            finalJson.push(...parseAnnexes(annexesContent))
        }
    }

    return finalJson
}

/**
 * 解析司法解释的核心内容（系统二辅助函数）
 * 
 * @param coreText - 核心内容文本
 * @returns 解析后的条文数组
 */
function parseJudicialCoreContent(coreText: string): ParsedArticle[] {
    const jsonResult: ParsedArticle[] = []
    const currentLevels = { l1: null, l1I: null, l2: null, l2I: null }

    // 正则表达式匹配 "一、" 或 "1." 开头的行
    const parts = coreText.split(/(^[一二三四五六七八九十百千万]+、.*$|^\d+\．.*$)/m)

    if (parts.length > 0 && parts[0].trim() === '') {
        parts.shift()
    }

    for (let i = 0; i < parts.length; i += 2) {
        const headingLine = parts[i]
        if (!headingLine) continue

        const trimmedHeadingLine = headingLine.trim()
        const contentText = (parts[i + 1] || '').trim()
        let level: 1 | 2

        if (/^[一二三四五六七八九十百千万]+、/.test(trimmedHeadingLine)) {
            level = 1
            const match = trimmedHeadingLine.match(/^([一二三四五六七八九十百千万]+)、/)
            currentLevels.l1 = trimmedHeadingLine
            currentLevels.l1I = match ? convertChineseNumberToArabic(match[1]) : null
            currentLevels.l2 = null
            currentLevels.l2I = null
        } else if (/^\d+\．/.test(trimmedHeadingLine)) {
            level = 2
            const match = trimmedHeadingLine.match(/^(\d+)\．/)
            currentLevels.l2 = trimmedHeadingLine
            currentLevels.l2I = match ? parseInt(match[1], 10) : null
        } else {
            continue // 不是有效标题行
        }

        jsonResult.push({
            type: `l${level}`,
            ...currentLevels,
            l3: null, l3I: null, l4: null, l4I: null, l5: null, l5I: null,
            content: contentText,
        })
    }
    return jsonResult
}

/**
 * [系统二] 解析使用中文/阿拉伯数字标题的司法解释类文档
 * 
 * @param rawText - 包含 "一、" 或 "1." 格式标题的原始文本
 * @returns 解析后的条文数组
 */
export function parseJudicialDocument(rawText: string): ParsedArticle[] {
    // 移除 frontmatter
    const content = rawText.replace(/^\s*---[\s\S]*?---\s*/, '')
    const finalJson: ParsedArticle[] = []
    let preAnnexContent = content
    let annexesContent = ''

    // 初始化层级对象（系统二只有两级）
    const nullLevels = { l1: null, l1I: null, l2: null, l2I: null }

    // 步骤 1: 分离附件
    const firstAnnexIndex = content.search(/\s*>annex<\s*/)
    if (firstAnnexIndex !== -1) {
        preAnnexContent = content.substring(0, firstAnnexIndex).trim()
        annexesContent = content.substring(firstAnnexIndex).trim()
    }

    const hasNoticeTag = preAnnexContent.includes('>notice<')
    const hasHeaderTag = preAnnexContent.includes('>header<')

    let coreText = ''
    let headerIndex = 1 // header编号从1开始

    // 步骤 2: 处理前言部分（notice 和 header）
    if (hasNoticeTag || hasHeaderTag) {
        const headerParts = preAnnexContent.split(/\s*>header<\s*/)
        const noticesArea = headerParts[0] || ''

        // 处理notice前的内容作为第一个header（如果有内容的话）
        let preNoticeContent = noticesArea
        if (hasNoticeTag) {
            const noticeParts = noticesArea.split(/\s*>notice<\s*/)
            preNoticeContent = noticeParts[0].trim()

            // 处理 notice 部分
            noticeParts.forEach((noticeText, index) => {
                const trimmedContent = noticeText.trim()
                if (trimmedContent && index > 0) { // 跳过第一个元素（notice前内容）
                    finalJson.push({
                        type: 'notice',
                        ...nullLevels,
                        l3: `公告${index}:`,
                        l3I: index,
                        l4: null, l4I: null, l5: null, l5I: null,
                        content: trimmedContent || null
                    })
                }
            })
        }

        // 从notice前内容中分离核心内容
        const coreContentStartIndex = preNoticeContent.search(/(^[一二三四五六七八九十百千万]+、.*$)/m)
        let purePreNoticeContent = preNoticeContent

        if (coreContentStartIndex !== -1) {
            purePreNoticeContent = preNoticeContent.substring(0, coreContentStartIndex).trim()
            if (!coreText) {
                coreText = preNoticeContent.substring(coreContentStartIndex).trim()
            }
        }

        // 如果notice前有内容，作为第一个header
        if (purePreNoticeContent) {
            const headerLines = purePreNoticeContent.split('\n')
            const firstLine = headerLines[0].trim()
            const remainingContent = headerLines.slice(1).join('\n').trim()

            finalJson.push({
                type: 'header',
                ...nullLevels,
                l3: firstLine,
                l3I: headerIndex++,
                l4: null, l4I: null, l5: null, l5I: null,
                content: remainingContent
            })
        }

        // 处理多个 header标签
        if (hasHeaderTag) {
            headerParts.slice(1).forEach((headerText) => {
                const trimmedText = headerText.trim()

                // 从header内容中分离核心内容
                const coreContentStartIndex = trimmedText.search(/(^[一二三四五六七八九十百千万]+、.*$)/m)
                let pureHeaderText = trimmedText

                if (coreContentStartIndex !== -1) {
                    pureHeaderText = trimmedText.substring(0, coreContentStartIndex).trim()
                    if (!coreText) {
                        coreText = trimmedText.substring(coreContentStartIndex).trim()
                    }
                }

                if (pureHeaderText) {
                    const headerLines = pureHeaderText.split('\n')
                    const firstLine = headerLines[0].trim()
                    const remainingContent = headerLines.slice(1).join('\n').trim()

                    finalJson.push({
                        type: 'header',
                        ...nullLevels,
                        l3: firstLine,
                        l3I: headerIndex++,
                        l4: null, l4I: null, l5: null, l5I: null,
                        content: remainingContent || null
                    })
                }
            })
        }
    } else {
        // 没有任何标签的情况，整个内容作为一个header处理
        const coreContentStartIndex = preAnnexContent.search(/(^[一二三四五六七八九十百千万]+、.*$)/m)
        let headerText = preAnnexContent

        if (coreContentStartIndex !== -1) {
            headerText = preAnnexContent.substring(0, coreContentStartIndex).trim()
            coreText = preAnnexContent.substring(coreContentStartIndex).trim()
        }

        if (headerText) {
            const headerLines = headerText.split('\n')
            const firstLine = headerLines[0].trim()
            const remainingContent = headerLines.slice(1).join('\n').trim()

            finalJson.push({
                type: 'header',
                ...nullLevels,
                l3: firstLine,
                l3I: 1,
                l4: null, l4I: null, l5: null, l5I: null,
                content: remainingContent
            })
        }
    }

    // 步骤 3: 解析核心内容
    if (coreText) {
        const coreContentJson = parseJudicialCoreContent(coreText)
        finalJson.push(...coreContentJson)
    }

    // 步骤 4: 解析并添加底部内容（footer和annex）
    if (annexesContent) {
        if (annexesContent.includes('>footer<')) {
            finalJson.push(...parseBottomContent(annexesContent))
        } else {
            // 兼容旧版本，只有 annex
            finalJson.push(...parseAnnexes(annexesContent))
        }
    }

    return finalJson
}

/**
 * 解析底部内容（footer和annex混合）
 * 
 * @param bottomContent - 底部内容文本
 * @returns 解析后的条文数组
 */
function parseBottomContent(bottomContent: string): ParsedArticle[] {
    const result: ParsedArticle[] = []
    let footerIndex = 1
    let annexIndex = 1

    // 按footer和annex标签分割内容
    const parts = bottomContent.split(/(\s*>(?:footer|annex)<\s*)/)

    let currentContent = ''
    let currentType: 'footer' | 'annex' | null = null

    for (let i = 0; i < parts.length; i++) {
        const part = parts[i]

        if (part.match(/\s*>footer<\s*/)) {
            // 处理前一个内容块
            if (currentContent.trim() && currentType) {
                result.push(createBottomContentItem(
                    currentContent.trim(),
                    currentType,
                    currentType === 'footer' ? footerIndex++ : annexIndex++
                ))
            }
            currentType = 'footer'
            currentContent = ''
        } else if (part.match(/\s*>annex<\s*/)) {
            // 处理前一个内容块
            if (currentContent.trim() && currentType) {
                result.push(createBottomContentItem(
                    currentContent.trim(),
                    currentType,
                    currentType === 'footer' ? footerIndex++ : annexIndex++
                ))
            }
            currentType = 'annex'
            currentContent = ''
        } else {
            // 累积内容
            currentContent += part
        }
    }

    // 处理最后一个内容块
    if (currentContent.trim() && currentType) {
        result.push(createBottomContentItem(
            currentContent.trim(),
            currentType,
            currentType === 'footer' ? footerIndex++ : annexIndex++
        ))
    }

    return result
}

/**
 * 创建底部内容项（footer或annex）
 * 
 * @param content - 内容文本
 * @param type - 类型（footer 或 annex）
 * @param index - 序号
 * @returns 解析后的条文对象
 */
function createBottomContentItem(
    content: string,
    type: 'footer' | 'annex',
    index: number
): ParsedArticle {
    const lines = content.split('\n')
    const firstLine = lines[0].trim()
    const remainingContent = lines.slice(1).join('\n').trim()

    return {
        type,
        l1: null, l1I: null, l2: null, l2I: null,
        l3: firstLine, l3I: index,
        l4: null, l4I: null, l5: null, l5I: null,
        content: remainingContent || null
    }
}

/**
 * 解析附件部分（兼容旧版本）
 * 
 * @param annexesContent - 附件内容文本
 * @returns 解析后的条文数组
 */
function parseAnnexes(annexesContent: string): ParsedArticle[] {
    const annexJson: ParsedArticle[] = []
    const annexParts = annexesContent.split(/\s*>annex<\s*/).filter(p => p.trim())

    annexParts.forEach((annexText, index) => {
        const lines = annexText.trim().split('\n')
        const title = lines.shift() || ''
        const contentWithoutTitle = lines.join('\n').trim()

        annexJson.push({
            type: 'annex',
            l1: null, l1I: null, l2: null, l2I: null,
            l3: title, l3I: index + 1,
            l4: null, l4I: null, l5: null, l5I: null,
            content: contentWithoutTitle
        })
    })

    return annexJson
}

/**
 * 自动选择解析器并解析内容
 * 
 * @param rawText - 原始文本内容
 * @returns 解析后的条文数组
 * @throws 解析失败时抛出错误
 */
export function parseContent(rawText: string): ParsedArticle[] {
    try {
        // 判断是 Markdown 还是普通大纲结构
        if (/^#/m.test(rawText)) {
            return parseDocument(rawText)
        } else {
            return parseJudicialDocument(rawText)
        }
    } catch (error) {
        logger.error('法律内容解析失败', { error })
        throw new Error(`法律内容解析失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
}
