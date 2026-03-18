/**
 * 法律条文层级排序服务
 *
 * 提供法律条文的层级排序算法，支持：
 * - 非层级类型（notice、header、footer、annex）
 * - 层级类型（l1-l5）
 * - 跳级情况（l1→l3、l3→l5）
 * - 深度优先遍历
 */

/** 开发环境日志工具 */
const devLogger = {
    warn: (message: string, ...args: any[]) => {
        if (process.env.NODE_ENV !== 'production') {
            console.warn(`[articleSorting] ${message}`, ...args)
        }
    },
}

/**
 * 条文类型
 */
type ArticleType = 'notice' | 'header' | 'footer' | 'annex' | 'l1' | 'l2' | 'l3' | 'l4' | 'l5'

/**
 * 条文接口（用于排序）
 */
interface Article {
    id: string
    type: string
    l1?: string | null
    l2?: string | null
    l3?: string | null
    l4?: string | null
    l5?: string | null
    order: number | null
    [key: string]: any
}

/**
 * 获取条文的父级路径
 *
 * 父级路径用于确定条文的归属关系。规则如下：
 * - 非层级类型（notice、header、footer、annex）：返回空字符串（顶层）
 * - l1：返回空字符串（顶层）
 * - l2：返回 l1
 * - l3：返回 l1/l2（如果 l2 存在）或 l1（如果只有 l1）
 * - l4：返回 l1/l2/l3
 * - l5：返回 l1/l2/l3/l4（如果 l4 存在）或 l1/l2/l3（跳级）
 *
 * 注意：即使条文有 l1 字段，如果没有对应的 l1 节点，该条文也可能是顶层
 *
 * @param article 条文对象
 * @returns 父级路径字符串
 *
 * @example
 * // 正常层级
 * getParentPath({ type: 'l3', l1: '第一编', l2: '第一分编', l3: '第一章' })
 * // 返回：'第一编/第一分编'
 *
 * @example
 * // 跳级情况（l1 直接包含 l3）
 * getParentPath({ type: 'l3', l1: '第一编', l2: null, l3: '第一章' })
 * // 返回：'第一编'
 *
 * @example
 * // l3 作为顶层（没有 l1 节点）
 * getParentPath({ type: 'l3', l1: '第一编', l2: null, l3: '第一章' })
 * // 如果没有 type='l1' 且 l1='第一编' 的节点，则返回：''
 *
 * @example
 * // 非层级类型
 * getParentPath({ type: 'notice', id: 'abc123' })
 * // 返回：''
 */
export function getParentPath(article: Article): string {
    // 非层级类型都是顶层，父路径为空
    if (['notice', 'header', 'footer', 'annex'].includes(article.type)) {
        return ''
    }

    // l1 是顶层
    if (article.type === 'l1') {
        return ''
    }

    // 层级类型根据 type 确定父路径
    if (article.type === 'l5') {
        // l5 的父级可能是 l4 或 l3（跳级）
        const parts: string[] = []
        if (article.l1) parts.push(article.l1)
        if (article.l2) parts.push(article.l2)
        if (article.l3) parts.push(article.l3)
        if (article.l4) parts.push(article.l4)
        return parts.join('/')
    }

    if (article.type === 'l4') {
        // l4 的父级是 l3
        const parts: string[] = []
        if (article.l1) parts.push(article.l1)
        if (article.l2) parts.push(article.l2)
        if (article.l3) parts.push(article.l3)
        return parts.join('/')
    }

    if (article.type === 'l3') {
        // l3 的父级可能是 l2 或 l1（跳级）
        // 如果 l2 存在，父级是 l1/l2
        // 如果 l2 不存在但 l1 存在，父级是 l1
        // 如果 l1 也不存在，父级是空（顶层）
        const parts: string[] = []
        if (article.l1) parts.push(article.l1)
        if (article.l2) parts.push(article.l2)
        return parts.join('/')
    }

    if (article.type === 'l2') {
        // l2 的父级是 l1
        // 如果 l1 不存在，父级是空（顶层）
        return article.l1 || ''
    }

    // 未知类型，返回空字符串
    return ''
}

/**
 * 获取条文的节点路径
 *
 * 节点路径用于唯一标识条文在层级树中的位置。规则如下：
 * - 非层级类型：使用 `__${type}__${id}` 格式
 * - l1：使用 l1 字段
 * - l2：使用 l1/l2 格式
 * - l3：使用 l1/l2/l3 格式（跳过 null 字段）
 * - l4：使用 l1/l2/l3/l4 格式（跳过 null 字段）
 * - l5：使用 l1/l2/l3/l4/l5 格式（跳过 null 字段）
 *
 * @param article 条文对象
 * @returns 节点路径字符串
 *
 * @example
 * // 正常层级
 * getNodePath({ type: 'l3', l1: '第一编', l2: '第一分编', l3: '第一章' })
 * // 返回：'第一编/第一分编/第一章'
 *
 * @example
 * // 跳级情况
 * getNodePath({ type: 'l3', l1: '第一编', l2: null, l3: '第一章' })
 * // 返回：'第一编/第一章'
 *
 * @example
 * // 非层级类型
 * getNodePath({ type: 'notice', id: 'abc123' })
 * // 返回：'__notice__abc123'
 */
export function getNodePath(article: Article): string {
    // 非层级类型使用 id 作为唯一标识
    if (['notice', 'header', 'footer', 'annex'].includes(article.type)) {
        return `__${article.type}__${article.id}`
    }

    // 层级类型使用完整路径
    const parts: string[] = []

    if (article.type === 'l5') {
        if (article.l1) parts.push(article.l1)
        if (article.l2) parts.push(article.l2)
        if (article.l3) parts.push(article.l3)
        if (article.l4) parts.push(article.l4)
        if (article.l5) parts.push(article.l5)
        return parts.join('/')
    }

    if (article.type === 'l4') {
        if (article.l1) parts.push(article.l1)
        if (article.l2) parts.push(article.l2)
        if (article.l3) parts.push(article.l3)
        if (article.l4) parts.push(article.l4)
        return parts.join('/')
    }

    if (article.type === 'l3') {
        if (article.l1) parts.push(article.l1)
        if (article.l2) parts.push(article.l2)
        if (article.l3) parts.push(article.l3)
        return parts.join('/')
    }

    if (article.type === 'l2') {
        if (article.l1) parts.push(article.l1)
        if (article.l2) parts.push(article.l2)
        return parts.join('/')
    }

    if (article.type === 'l1') {
        return article.l1 || ''
    }

    // 未知类型，使用 id
    return article.id
}

/**
 * 按层级结构排序条文
 *
 * 使用树形递归排序算法，支持复杂的层级结构和跳级情况。
 * 特别处理：如果某个节点的父节点不存在，则将其视为顶层节点。
 *
 * 算法步骤：
 * 1. 验证并过滤无效条文
 * 2. 收集所有存在的节点路径
 * 3. 遍历所有条文，计算父级路径
 * 4. 如果父级路径不存在（父节点不在条文列表中），则将其视为顶层（父路径改为空字符串）
 * 5. 按父级路径分组
 * 6. 在每个组内按 order 排序（null 视为 0）
 * 7. 从根节点（空路径）开始深度优先遍历
 * 8. 返回排序后的列表
 *
 * 时间复杂度：O(n log n)，其中 n 是条文数量
 * 空间复杂度：O(n)
 *
 * @param articles 未排序的条文列表
 * @returns 排序后的条文列表
 *
 * @example
 * const articles = [
 *   { id: '1', type: 'notice', order: 1 },
 *   { id: '2', type: 'l1', l1: '第一编', order: 2 },
 *   { id: '3', type: 'l3', l1: '第一编', l2: null, l3: '第一章', order: 1 },
 * ]
 * const sorted = sortArticlesByHierarchy(articles)
 * // 返回：[notice, l1, l3]（按层级和 order 排序）
 */
export function sortArticlesByHierarchy(articles: Article[]): Article[] {
    // 处理空输入
    if (!articles || articles.length === 0) {
        return []
    }

    // 验证输入并过滤无效条文
    const validArticles = articles.filter(article => {
        const hasId = !!article.id
        const hasType = !!article.type

        if (!hasId || !hasType) {
            devLogger.warn('跳过无效条文：缺少 id 或 type 字段', { hasId, hasType, article })
            return false
        }

        const validTypes: ArticleType[] = ['notice', 'header', 'footer', 'annex', 'l1', 'l2', 'l3', 'l4', 'l5']
        const isValidType = validTypes.includes(article.type as ArticleType)

        if (!isValidType) {
            devLogger.warn(`跳过无效条文：未知类型 ${article.type}`, article)
            return false
        }

        return true
    })

    // 如果所有条文都无效，返回空数组
    if (validArticles.length === 0) {
        return []
    }

    // 步骤 1：收集所有存在的节点路径
    const existingPaths = new Set<string>()
    for (const article of validArticles) {
        const nodePath = getNodePath(article)
        existingPaths.add(nodePath)
    }

    // 步骤 2：按父级路径分组（如果父路径不存在，则视为顶层）
    const grouped = new Map<string, Article[]>()
    for (const article of validArticles) {
        let parentPath = getParentPath(article)

        // 如果父路径不为空，但父节点不存在，则该节点是顶层
        if (parentPath !== '' && !existingPaths.has(parentPath)) {
            parentPath = ''
        }

        if (!grouped.has(parentPath)) {
            grouped.set(parentPath, [])
        }
        grouped.get(parentPath)!.push(article)
    }

    // 步骤 3：在每个组内按 order 排序
    for (const group of grouped.values()) {
        group.sort((a, b) => (a.order || 0) - (b.order || 0))
    }

    // 步骤 4 & 5：深度优先遍历
    const result: Article[] = []

    /**
     * 深度优先遍历辅助函数
     * @param parentPath 父级路径
     */
    const visit = (parentPath: string) => {
        const children = grouped.get(parentPath) || []
        for (const child of children) {
            // 添加当前节点到结果
            result.push(child)

            // 递归访问子节点
            const childPath = getNodePath(child)
            visit(childPath)
        }
    }

    // 从根节点（空路径）开始遍历
    visit('')

    return result
}
