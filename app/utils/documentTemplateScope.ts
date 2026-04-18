/**
 * documentTemplateScope 工具
 *
 * 文书模板"归属"（scope）相关的纯函数：
 * - 徽章文案 / 样式映射
 * - 列表中的私人模板配额计数
 *
 * 背景：我的文书模板页走混合视图（global + 当前用户的 user），
 * 需要在列表展示归属标签，并从混合列表中正确计算私人模板配额。
 */

/** 模板 scope 字段的业务取值（Prisma 层类型是 string） */
export type DocumentTemplateScope = 'global' | 'user'

/** 徽章视觉映射结果 */
export interface ScopeBadge {
    label: string
    variant: 'default' | 'secondary'
}

/**
 * 根据 scope 返回徽章文案与变体。
 * 未知值回退到"全局"（容错，避免页面崩溃）。
 * 入参使用 string 以兼容 Prisma 生成的字段类型。
 */
export function getScopeBadge(scope: string): ScopeBadge {
    if (scope === 'user') {
        return { label: '我的', variant: 'default' }
    }
    return { label: '全局', variant: 'secondary' }
}

/**
 * 统计列表中 scope='user' 的条目数量。
 *
 * 用途：混合视图下后端返回的 total 是"global + user"之和，
 * 配额提示仍需以"我的"模板数量为准。
 */
export function countUserScopeTemplates(
    list: ReadonlyArray<{ scope: string }>,
): number {
    return list.filter(t => t.scope === 'user').length
}
