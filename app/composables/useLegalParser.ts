/**
 * 法律内容解析 Composable
 * 
 * 提供前端解析法律内容的功能
 */

import type { ParsedArticle } from '#shared/types/legal-parser'

/**
 * 解析状态
 */
export interface ParseState {
    /** 解析后的条文数组 */
    articles: ParsedArticle[]
    /** 解析错误信息 */
    error: string | null
    /** 是否正在解析 */
    parsing: boolean
}

/**
 * 使用法律内容解析器
 * 
 * @returns 解析函数和状态
 */
export function useLegalParser() {
    const parseState = reactive<ParseState>({
        articles: [],
        error: null,
        parsing: false,
    })

    /**
     * 解析法律内容
     * 
     * @param content - 法律内容（Markdown 格式）
     * @returns 解析后的条文数组，失败时返回 null
     */
    const parse = async (content: string): Promise<ParsedArticle[] | null> => {
        if (!content || !content.trim()) {
            parseState.error = '内容不能为空'
            parseState.articles = []
            return null
        }

        parseState.parsing = true
        parseState.error = null

        try {
            // 调用服务端 API 进行解析
            const result = await useApiFetch<ParsedArticle[]>('/api/v1/admin/legal-articles/parse', {
                method: 'POST',
                body: { content },
                showError: false,
            })

            if (!result) {
                parseState.error = '解析失败'
                parseState.articles = []
                return null
            }

            parseState.articles = result
            parseState.error = null

            return result
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : '解析失败'
            parseState.error = errorMessage
            parseState.articles = []

            console.error('[useLegalParser] 解析法律内容失败', error)
            return null
        } finally {
            parseState.parsing = false
        }
    }

    /**
     * 清除解析状态
     */
    const clear = () => {
        parseState.articles = []
        parseState.error = null
        parseState.parsing = false
    }

    return {
        parseState: readonly(parseState),
        parse,
        clear,
    }
}

