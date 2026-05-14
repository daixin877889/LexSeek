import type { Component } from 'vue'

/**
 * lucide-vue-next 图标名（字符串）
 *
 * 运行时由 `getAdminIcon()` 在 `~/utils/lucideIcons` 中查表；未知名跳过 + logger.warn。
 * 不在类型层硬约束 lucide 实际导出名 — 否则 shared/ 需反向引用 `~/utils`（违反层次）。
 */
export type LucideIconName = string

/** 写在 page 的 `definePageMeta.userMenu` 里 */
export interface UserMenuRouteMeta {
  /** 归属分组 id，对应 userMenuGroups.id */
  group: string
  /** 菜单显示文案；不写则 fallback 到 `meta.title` */
  title?: string
  /** lucide 图标名 */
  icon: LucideIconName
  /** 分组内排序（asc） */
  order: number
  /** 角色 code 白名单；不写或空数组 = 所有登录用户可见 */
  roles?: string[]
}

/** 中央骨架里的分组定义 */
export interface UserMenuGroup {
  /** home / membership / settings ... */
  id: string
  /** 不写 = 独立平铺、不显示灰色小标题（home 用） */
  title?: string
  /** 分组之间的排序 */
  order: number
}

/** 动作 handler 字面量集合 — 扩展时往这里加 */
export type UserMenuActionHandler = 'logout'

/** 中央骨架里的动作项 — 永远在末尾、分隔线下方 */
export interface UserMenuActionItem {
  id: string
  title: string
  icon: LucideIconName
  /** 危险样式（红色） */
  danger?: boolean
  order: number
  roles?: string[]
  handler: UserMenuActionHandler
}

/** composable 输出给组件渲染的扁平节点 */
export type UserMenuRenderNode =
  | { kind: 'group-header'; id: string; title: string }
  | { kind: 'route'; path: string; title: string; icon: Component }
  | { kind: 'separator'; id: string }
  | { kind: 'action'; id: string; title: string; icon: Component; danger: boolean; onClick: () => void | Promise<void> }
