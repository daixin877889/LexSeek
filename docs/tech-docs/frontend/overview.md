# 前端架构概览

LexSeek 前端基于 Nuxt 4 + Vue 3 + Tailwind CSS v4 + shadcn-vue 构建，采用文件系统路由、多布局嵌套和 CSS 变量驱动的主题系统。

## 页面结构

共 83 个 `.vue` 页面文件，按路由前缀分为三个区域：

### Public 区域（公开页面，无需登录）

| 路由 | 文件 | 说明 |
|------|------|------|
| `/` | `index.vue` | 首页 |
| `/features` | `features.vue` | 产品功能介绍 |
| `/pricing` | `pricing.vue` | 价格方案 |
| `/about` | `about.vue` | 关于我们 |
| `/login` | `login.vue` | 登录 |
| `/register` | `register.vue` | 注册 |
| `/reset-password` | `reset-password.vue` | 重置密码 |
| `/privacy-agreement` | `privacy-agreement.vue` | 隐私政策 |
| `/purchase-agreement` | `purchase-agreement.vue` | 购买协议 |
| `/terms-of-use` | `terms-of-use.vue` | 使用条款 |
| `/403` | `403.vue` | 无权限页面 |
| `/landing/[invitedBy]` | `landing/[invitedBy].vue` | 邀请注册落地页 |

### Dashboard 区域（用户工作台，需要登录）

| 路由分组 | 说明 | 页面数 |
|----------|------|--------|
| `/dashboard` | 工作台首页 | 1 |
| `/dashboard/cases/*` | 案件管理 | 5 |
| `/dashboard/analysis/*` | 分析会话 | 2 |
| `/dashboard/legal/*` | 法律搜索 | 2 |
| `/dashboard/tools/*` | 法律工具 | 10 |
| `/dashboard/membership/*` | 会员中心 | 6 |
| `/dashboard/settings/*` | 账户设置 | 3 |
| `/dashboard/buy/[id]` | 购买页（微信浏览器） | 1 |
| `/dashboard/disk-space` | 云盘空间 | 1 |

### Admin 区域（管理后台，需要管理员权限）

| 路由分组 | 说明 | 页面数 |
|----------|------|--------|
| `/admin` | 管理后台首页 | 1 |
| `/admin/users` | 用户管理 | 1 |
| `/admin/roles/*` | 角色管理 | 4 |
| `/admin/permissions/*` | 权限管理 | 2 |
| `/admin/legal-main/*` | 法律法规管理 | 6 |
| `/admin/models` | 模型管理 | 1 |
| `/admin/model-providers/*` | 模型提供商 | 2 |
| `/admin/model-api-keys` | API Key 管理 | 1 |
| `/admin/nodes/*` | 分析节点管理 | 2 |
| `/admin/node-groups` | 节点分组 | 1 |
| `/admin/prompts/*` | 提示词管理 | 2 |
| `/admin/products` | 商品管理 | 1 |
| `/admin/case-types` | 案件类型 | 1 |
| `/admin/demo-cases` | 示例案件 | 1 |
| `/admin/campaigns` | 活动管理 | 1 |
| `/admin/benefits/*` | 权益管理 | 3 |
| `/admin/redemption-codes/*` | 兑换码管理 | 2 |
| `/admin/point-items` | 积分项目 | 1 |
| `/admin/access` | 访问管理 | 1 |
| `/admin/audit` | 审计日志 | 1 |
| `/admin/asr-tasks` | ASR 任务 | 1 |
| `/admin/mineru-tasks` | MinerU 任务 | 1 |
| `/admin/mineru-tokens` | MinerU Token | 1 |

## 布局系统

共 5 个布局文件，位于 `app/layouts/`：

### 1. baseLayout（公开页面）

- 用于 Public 区域的所有页面
- 顶部导航栏（Logo + 导航菜单 + 登录/用户菜单）
- 底部版权信息
- 响应式设计：桌面端水平菜单，移动端折叠菜单
- Logo 跟随颜色模式切换（深色模式使用白色 Logo）

### 2. dashboardLayout（用户工作台）

- 用于 `/dashboard/*` 路由
- 左侧可折叠侧边栏（`SidebarProvider` + `Sidebar`）
- 支持 `icon` 折叠模式（窄屏 <1024px 自动折叠）
- 页面级 header 隐藏：通过 `useState('hideDashboardHeader')` 控制
- 嵌套布局：根据路由前缀自动切换子布局
  - `/dashboard/settings/*` -> `settingsLayout`
  - `/dashboard/membership/*` -> `membershipLayout`
  - 其他 -> 直接渲染

### 3. admin-layout（管理后台）

- 用于 `/admin/*` 路由
- 左侧侧边栏 + 面包屑导航
- SSR 阶段并行加载菜单数据和权限数据
- 菜单数据根据 RBAC 权限过滤
- 记录侧边栏滚动位置，导航后恢复

### 4. membershipLayout（会员中心子布局）

- 嵌套在 dashboardLayout 内
- 左侧竖直导航标签页：我的会员、兑换会员、我的积分、邀请注册、我的订单
- 右侧内容区域

### 5. settingsLayout（设置子布局）

- 嵌套在 dashboardLayout 内
- 左侧导航：个人资料、安全设置
- 右侧内容区域

## 路由约定

### 文件系统路由

Nuxt 4 基于文件系统自动生成路由：

```
app/pages/
├── index.vue                     -> /
├── login.vue                     -> /login
├── dashboard/
│   ├── index.vue                 -> /dashboard
│   ├── cases/
│   │   ├── index.vue             -> /dashboard/cases
│   │   ├── create.vue            -> /dashboard/cases/create
│   │   ├── [id].vue              -> /dashboard/cases/:id
│   │   └── init-analysis/
│   │       ├── index.vue         -> /dashboard/cases/init-analysis
│   │       └── [sessionId].vue   -> /dashboard/cases/init-analysis/:sessionId
```

### 动态路由

- `[id].vue` -> 单参数动态路由，通过 `useRoute().params.id` 获取
- `[sessionId].vue` -> 语义化参数名
- `[invitedBy].vue` -> 邀请人标识

### definePageMeta

每个页面通过 `definePageMeta` 声明元数据：

```typescript
definePageMeta({
  layout: 'dashboard',       // 选择布局（对应 layouts/ 文件名）
  title: '我的案件',          // 面包屑和标题栏
  icon: 'Briefcase',         // 侧边栏图标名
  middleware: ['auth'],      // 路由中间件（可选）
})
```

布局名映射规则：
- `'base'` -> `baseLayout.vue`
- `'dashboard'` -> `dashboardLayout.vue`
- `'admin-layout'` -> `admin-layout.vue`

## 深色模式和主题系统

### 双层架构

主题系统分为两层：

1. **颜色模式（Color Mode）**：`light` / `dark` / `system`
2. **主题色（Theme Color）**：8 种预设主题色

### 颜色模式

由 `useColorMode` composable 管理：

- 存储在 `localStorage`（key: `color-mode`）
- 通过 `<html>` 标签的 `dark` class 控制
- SSR 时默认 `light`，客户端 hydration 后从 localStorage 恢复
- `nuxt.config.ts` 内联脚本在页面加载前应用，避免闪烁

### 主题色

由 `useTheme` composable 管理，8 种可选主题：

| 名称 | 标签 | CSS 类 |
|------|------|--------|
| zinc | 默认 | 无（默认） |
| rose | 玫瑰 | `theme-rose` |
| blue | 蓝色 | `theme-blue` |
| green | 绿色 | `theme-green` |
| orange | 橙色 | `theme-orange` |
| red | 红色 | `theme-red` |
| violet | 紫色 | `theme-violet` |
| yellow | 黄色 | `theme-yellow` |

### CSS 变量体系

定义在 `app/assets/css/tailwind.css`：

```css
/* 基础变量层：Tailwind v4 的 @theme inline */
@theme inline {
  --color-primary: var(--primary);
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  /* ...sidebar、chart 等 20+ 语义化变量 */
}

/* 默认主题（Zinc）的 :root 定义 */
:root {
  --primary: oklch(0.205 0 0);
  --background: oklch(1 0 0);
  /* ... */
}

/* 深色模式覆盖 */
.dark {
  --primary: oklch(0.922 0 0);
  --background: oklch(0.145 0 0);
  /* ... */
}

/* 主题色覆盖（只修改 primary 和 ring） */
.theme-blue {
  --primary: oklch(0.546 0.245 262.881);
  --ring: oklch(0.546 0.245 262.881);
}
```

每个主题色还定义了对应的渐变背景变量（`--background-image-gradient-custom-*`），明暗模式各一套。

### 变量应用方式

组件中直接使用语义化 Tailwind 类：

```html
<div class="bg-background text-foreground">
  <button class="bg-primary text-primary-foreground">按钮</button>
  <div class="border-border bg-card text-card-foreground">卡片</div>
</div>
```

深色模式通过 `@custom-variant dark (&:is(.dark *))` 声明，Tailwind 自动处理。

## 自动导入

前端代码无需手动 import 以下内容（Nuxt 自动导入）：

| 类别 | 示例 |
|------|------|
| Vue 响应式 API | `ref`, `reactive`, `computed`, `watch`, `onMounted` |
| Nuxt composables | `useFetch`, `useState`, `useRuntimeConfig`, `navigateTo` |
| 路由 | `useRoute`, `useRouter` |
| Pinia stores | `useAuthStore`, `useUserStore` 等 |
| 自定义 composables | `useApi`, `useApiFetch`, `useTheme` 等 |
| 组件 | `app/components/` 下的所有组件 |

类型需要手动导入：

```typescript
import type { CaseDetailInfo } from '#shared/types/case'
```

## 组件命名约定

组件按文件路径驼峰拼接命名使用：

```
app/components/
├── general/
│   └── ThemeToggle.vue          -> <GeneralThemeToggle />
├── dashboard/
│   ├── NavMain.vue              -> <DashboardNavMain />
│   └── LogoBox.vue              -> <DashboardLogoBox />
├── caseDetail/
│   └── CaseDetailOverview.vue   -> <CaseDetailCaseDetailOverview /> 或短路径
└── ui/                          -> shadcn-vue 组件，禁止修改
    ├── button/
    │   └── Button.vue           -> <Button />
    └── sidebar/
        └── Sidebar.vue          -> <Sidebar />
```

shadcn-vue 组件是特例，直接使用组件名（无目录前缀）。
