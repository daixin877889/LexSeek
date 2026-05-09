# Pinia Store 参考

LexSeek 前端 Pinia store 位于 `app/store/`。

> ⚠️ **store 必须显式 `import`**（自动扫描已关闭，仅 Pinia 的 `defineStore` / `storeToRefs` 保留自动导入）：
>
> ```typescript
> import { useAuthStore } from '~/store/auth'
> import { useAlertDialogStore } from '~/store/alertDialog'
> ```
>
> 详见 [architecture/auto-imports.md](../architecture/auto-imports.md)。

## 概览

| Store | 文件 | 说明 | 风格 |
|-------|------|------|------|
| `useAuthStore` | `auth.ts` | 认证状态 | Composition API |
| `useUserStore` | `user.ts` | 用户信息 | Composition API |
| `usePermissionStore` | `permission.ts` | RBAC 权限 | Options API |
| `useRoleStore` | `role.ts` | 角色管理 | Composition API |
| `useCaseAnalysisStore` | `caseAnalysis.ts` | 案件分析输入状态 | Composition API |
| `useFileStore` | `file.ts` | 文件上传/列表 | Composition API |
| `useAdminMenuStore` | `adminMenu.ts` | Admin 侧边栏菜单 | Composition API |
| `useAlertDialogStore` | `alertDialog.ts` | 全局确认弹框 | Options API |
| `useWxSupportStore` | `wxSupport.ts` | 微信客服二维码 | Options API |

## 详细说明

### useAuthStore

管理登录/注册/登出/重置密码等认证操作。

**状态**：
```typescript
loading: ref(false)           // 操作进行中
error: ref<string | null>     // 错误信息
isAuthenticated: ref(false)   // 是否已登录
```

**方法**：
- `initAuth()`: 从 cookie（`auth_status`，非 httpOnly）读取认证状态
- `login({ phone, password })`: 密码登录，成功后设置 userStore 和认证状态
- `register({ phone, code, name, password, invitedBy? })`: 注册，流程同登录
- `logout()`: 登出，清除用户信息、法律编辑器缓存
- `resetPassword({ phone, code, newPassword })`: 重置密码
- `sendSmsCode({ phone, type })`: 发送短信验证码

**认证机制**：JWT token 由服务端通过 `Set-Cookie` 设置为 httpOnly cookie，前端不直接操作 token。`auth_status` 是非 httpOnly cookie，仅用于客户端判断登录状态。

### useUserStore

管理当前登录用户的信息。

**状态**：
```typescript
userInfo: reactive<SafeUserInfo>({
    id: 0, name: '', username: '', phone: '', email: '',
    roles: [], status: 0, company: '', profile: '', inviteCode: '',
})
pending: ref(false)
fetchError: ref<Error | null>
```

**方法**：
- `initUserInfo()`: SSR 阶段初始化，使用 `useApi` 获取用户信息（支持水合）
- `refreshUserInfo()`: 客户端刷新
- `setUserInfo(info)`: 设置用户信息（`Object.assign` 直接赋值）
- `updateUserProfile(data)`: 更新个人资料（`PUT /api/v1/users/profile`）
- `updateUserPassword(data)`: 修改密码
- `clearUserInfo()`: 清空信息（登出时调用）

**注意**：`initUserInfo` 返回 `{ data, error, status, refresh }`，并设置 `watch` 监听后续变化。这里有一个 mutation 模式（`Object.assign`），是项目中的惯用法。

### usePermissionStore

RBAC 权限管理，使用 Options API 风格。

**状态**：
```typescript
apiPermissions: ApiPermission[]   // API 权限列表（path + method）
routePermissions: string[]        // 路由权限列表
isSuperAdmin: boolean             // 是否超级管理员
initialized: boolean              // 是否已初始化
loading: boolean
```

**Getters**：
- `hasApiPermission(path, method)`: 检查 API 权限（支持 `*` 和 `**` 通配符）
- `hasRoutePermission(route)`: 检查路由权限

**Actions**：
- `initUserPermissions()`: 从 API 加载权限（幂等，已初始化则跳过）
- `refreshPermissions()`: 强制刷新权限
- `clearPermissions()`: 清除权限（登出时）

**路径匹配规则**：`*` 匹配单个路径段，`**` 匹配任意路径段。

### useRoleStore

用户角色管理，支持多角色切换。

**状态**：
```typescript
userRoles: ref<roles[]>([])           // 角色列表
currentRoleIndex: ref(0)               // 当前角色索引
currentRole: computed                   // 当前角色（派生）
currentRoleRouters: ref([])             // 当前角色的路由列表
```

**方法**：
- `initUserRoles()`: SSR 初始化角色列表
- `initUserRouters(roleId)`: SSR 初始化角色路由
- `setCurrentRoleIndex(index)`: 切换角色 -> 自动加载该角色的路由
- `refreshUserRoles()`: 客户端刷新角色列表
- `clearRoleData()`: 清空（登出时）

### useCaseAnalysisStore

案件分析页面的输入状态管理（跨组件共享）。

**状态**：
```typescript
promptText: ref('')          // 输入框文本
promptFilesCount: ref(0)     // 附件数量
hasPromptInput: computed     // 是否有输入内容
```

**方法**：
- `updatePromptState(text, filesCount)`: 由 `PromptInputWatcher` 组件调用
- `resetPromptState()`: 重置输入状态

**用途**：让页面其他区域（如导航守卫）能感知到用户是否有未提交的输入。

### useFileStore

文件上传和文件列表管理。

**状态**：
```typescript
loading: ref(false)
error: ref<string | null>
fileList: ref<OssFileItem[]>([])
pagination: ref({ page: 1, pageSize: 30, total: 0, totalPages: 0 })
```

**方法**：
- `getUploadConfig(source?)`: 获取上传场景配置（允许的文件类型和大小限制）
- `getPresignedUrl(params)`: 获取单文件预签名 URL
- `getBatchPresignedUrls(params)`: 批量获取预签名 URL
- `fetchFileList(params)`: 非 SSR 场景获取文件列表
- `syncFileListData(data)`: 同步文件列表数据（SSR 场景使用）
- `buildFileListQuery(params)`: 构建查询参数（过滤空值）
- `resetFileList()`: 重置列表状态

**接口类型**：
- `OssFileItem`: 文件列表项（id, fileName, fileSize, fileType, encrypted, url 等）
- `PresignedUrlParams`: 预签名参数（source, originalFileName, mimeType, encrypted 等）

### useAdminMenuStore

Admin 侧边栏菜单数据和 UI 状态管理。

**状态**：
```typescript
rawRouters: ref([])             // 原始路由数据
isLoading: ref(false)
collapsedIds: ref<Set<string>>  // 折叠的菜单 ID
activeId: ref('')               // 当前激活菜单路径
scrollPosition: ref(0)          // 侧边栏滚动位置
menuGroups: computed            // 分组后的菜单数据（带权限过滤）
```

**方法**：
- `setRawRouters(data)`: 设置菜单原始数据（SSR 阶段由 layout 调用）
- `fetchMenuData()`: 客户端回退加载（有缓存则跳过）
- `toggleSubmenu(id)`: 切换子菜单展开/折叠
- `setActive(path)` / `setScrollPosition(pos)`: 设置 UI 状态

**菜单分组**：根据 `menuGroup` 字段分组，按 `menuGroupSort` 排序，菜单项按 `sort` 排序。通过 `usePermissionStore` 过滤无权限的菜单。

**图标解析**：支持 `lucideIcons.LayoutDashboardIcon` 格式的图标名映射。

### useAlertDialogStore

全局确认对话框状态管理。

```typescript
const alertDialog = useAlertDialogStore()

alertDialog.showDialog({
    title: '确认删除',
    message: '删除后不可恢复，确认继续？',
    type: 'error',
    onConfirm: () => { /* 执行删除 */ },
    onCancel: () => { /* 取消 */ },
})

// 便捷方法
alertDialog.showSuccessDialog({ ... })
alertDialog.showErrorDialog({ ... })
```

**状态**：`isVisible`, `title`, `message`, `type`, `confirmText`, `cancelText`, `showCancel`, `zIndex`

**注意**：`zIndex` 默认 600，可自定义。

### useWxSupportStore

微信客服二维码弹窗控制。

```typescript
const wxStore = useWxSupportStore()
wxStore.showQrCode()            // 显示默认二维码
wxStore.showQrCode('/custom.jpg') // 自定义二维码
wxStore.hideQrCode()
wxStore.toggleQrCode()
```

**状态**：`isVisible: boolean`, `qrcode: string`（默认 `/images/mpwxcode.jpg`）

## Store 生命周期

### 初始化顺序

在 dashboard 布局的 middleware 中按以下顺序初始化：

1. `authStore.initAuth()` -> 从 cookie 恢复认证状态
2. `userStore.initUserInfo()` -> SSR 获取用户信息
3. `roleStore.initUserRoles()` -> SSR 获取角色列表

Admin 布局在 layout 组件中并行初始化：

```typescript
const [menuResult, permResult] = await Promise.all([
    useFetch('/api/v1/admin/menu-routers'),
    useFetch('/api/v1/users/permissions'),
])
```

### 登出清理

登出时需要重置所有 store 状态，通过 `resetAllStore()` 工具函数统一调用：
- `authStore`: 清除认证状态
- `userStore`: 清空用户信息
- `roleStore`: 清空角色数据
- `permissionStore`: 清除权限
- `caseAnalysisStore`: 重置输入状态
- `fileStore`: 重置文件列表

### SSR 注意事项

- 使用 `useApi`（基于 `useFetch`）的 store 方法支持 SSR 水合
- 使用 `useApiFetch`（基于 `$fetch`）的方法仅客户端可用
- SSR 阶段需要通过 `useRequestHeaders(['cookie'])` 转发认证 cookie
