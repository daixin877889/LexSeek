import type { UserMenuGroup, UserMenuActionItem } from '#shared/types/userMenu'

/**
 * 分组骨架 — 决定分组顺序与标题
 *
 * 不写 `title` 表示该组下的项目独立平铺、不显示灰色小标题（home 用）。
 */
export const userMenuGroups: UserMenuGroup[] = [
  { id: 'home',       order: 0  },
  { id: 'membership', title: '会员中心', order: 10 },
  { id: 'settings',   title: '账户设置', order: 20 },
]

/**
 * 动作项 — 永远在末尾、分隔线下方
 *
 * `icon` 走字符串名（lucide-vue-next），由 `getAdminIcon()` 运行时解析。
 * `handler` 走字符串字面量 — composable 内 handlerMap 绑实际函数。
 */
export const userMenuActions: UserMenuActionItem[] = [
  { id: 'logout', title: '退出登录', icon: 'LogOut', danger: true, order: 100, handler: 'logout' },
]
