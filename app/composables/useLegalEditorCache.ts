/**
 * 法律编辑器本地缓存 Composable
 * 
 * 提供草稿的本地缓存功能，使用 localStorage 存储
 */

import { useDebounceFn } from '@vueuse/core'

/**
 * 生成缓存键
 * 
 * @param legalId - 法律法规 ID
 * @returns 缓存键
 */
function getCacheKey(legalId: string): string {
    return `legal-editor-draft-${legalId}`
}

/**
 * 使用法律编辑器缓存
 * 
 * @returns 缓存操作函数
 */
export function useLegalEditorCache() {
    /**
     * 保存草稿到缓存（带防抖）
     * 
     * @param legalId - 法律法规 ID
     * @param content - 编辑器内容
     */
    const saveDraftToCache = useDebounceFn((legalId: string, content: string) => {
        try {
            const key = getCacheKey(legalId)
            localStorage.setItem(key, content)
        } catch (error) {
            console.error('保存草稿到缓存失败', { legalId, error })
        }
    }, 1000) // 1秒防抖

    /**
     * 从缓存加载草稿
     * 
     * @param legalId - 法律法规 ID
     * @returns 缓存的内容，如果不存在则返回 null
     */
    const loadDraftFromCache = (legalId: string): string | null => {
        try {
            const key = getCacheKey(legalId)
            const content = localStorage.getItem(key)

            return content
        } catch (error) {
            console.error('从缓存加载草稿失败', { legalId, error })
            return null
        }
    }

    /**
     * 清除指定法律法规的草稿缓存
     * 
     * @param legalId - 法律法规 ID
     */
    const clearDraftCache = (legalId: string) => {
        try {
            const key = getCacheKey(legalId)
            localStorage.removeItem(key)
            console.log('清除草稿缓存', { legalId })
        } catch (error) {
            console.error('清除草稿缓存失败', { legalId, error })
        }
    }

    /**
     * 清除所有法律编辑器的草稿缓存
     */
    const clearAllDraftCaches = () => {
        try {
            const keys = Object.keys(localStorage)
            const draftKeys = keys.filter(key => key.startsWith('legal-editor-draft-'))

            draftKeys.forEach(key => {
                localStorage.removeItem(key)
            })

            console.log('清除所有草稿缓存', { count: draftKeys.length })
        } catch (error) {
            console.error('清除所有草稿缓存失败', { error })
        }
    }

    return {
        saveDraftToCache,
        loadDraftFromCache,
        clearDraftCache,
        clearAllDraftCaches,
    }
}
