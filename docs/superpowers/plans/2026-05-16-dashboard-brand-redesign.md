# 工作台首页 + 外壳 品牌改造 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 logo「青绿→天蓝→深蓝」品牌设计延伸到工作台首页与外壳（侧边栏 + 顶栏）。

**Architecture:** 复用营销改版已有的 `.theme-brand` 作用域类——加到 `dashboardLayout.vue` 根节点，整个工作台主色统一为品牌天蓝；侧边栏选中态 / 用户头像 / 首页五区块按设计稿 `ui_kits/dashboard/` 重新着色。不改 shadcn `ui/**`、不改数据接口与交互。

**Tech Stack:** Nuxt 4 + Vue 3 + Tailwind CSS v4 + shadcn-vue + lucide-vue-next

参考：设计文档 `docs/superpowers/specs/2026-05-16-dashboard-brand-redesign-design.md`；设计稿 `~/Downloads/LexSeek UI 重构/ui_kits/dashboard/`。

---

## 文件结构

| 文件 | 责任 |
|---|---|
| `app/assets/css/tailwind.css` | `.theme-brand` 加 `--wash-sidebar`/`--sidebar-ring`；加侧边栏上色规则；更新注释 |
| `app/layouts/dashboardLayout.vue` | 根节点套 `theme-brand`；顶栏改半透明毛玻璃 |
| `app/components/dashboard/navMain.vue` | 侧边栏选中项改渐变竖条 + 渐变底 |
| `app/components/dashboard/navUser.vue` | 侧边栏用户头像改品牌渐变 |
| `app/components/dashboard/navUserRight.vue` | 移动端用户头像改品牌渐变（与上保持一致） |
| `app/pages/dashboard/index.vue` | 首页五区块整页重写套用品牌视觉 |

提交策略：Task 1-4 为「外壳」一次提交；Task 5 为「首页」一次提交。无单元测试（这些文件无测试），验证靠 Task 6 的 `nuxi typecheck` + 浏览器三态实测。

---

## Task 1: 扩展 `.theme-brand` 主题 token

**Files:**
- Modify: `app/assets/css/tailwind.css:282-314`

- [ ] **Step 1: 更新 `.theme-brand` 注释块（282-286 行）**

把原注释（写「营销公开页作用域……工作台/后台拿不到此 class」）替换为：

```css
/* ==================== Brand 主题（作用域类，非用户可切换主题） ====================
 * 挂在 baseLayout（营销 / 认证 / 法律页）与 dashboardLayout（工作台）根节点。
 * 作用域内 --primary 变品牌天蓝，--background/--card 等不动。
 * 后台管理走 admin-layout，拿不到此 class，配色零影响。
 * 暗色用 `.dark .theme-brand` 后代选择器匹配 —— .dark 在 <html>，.theme-brand 在布局 div。
 */
```

- [ ] **Step 2: `.theme-brand` 块加 `--sidebar-ring` 与 `--wash-sidebar`**

在 `.theme-brand { ... }` 内，`--ring` 行之后加：

```css
  --sidebar-ring: oklch(0.683 0.158 240);
  --wash-sidebar: linear-gradient(180deg, #F2FBFD 0%, #FFFFFF 35%, #FFFFFF 100%);
```

- [ ] **Step 3: `.dark .theme-brand` 块加暗色变体**

在 `.dark .theme-brand { ... }` 内，`--ring` 行之后加：

```css
  --sidebar-ring: oklch(0.755 0.155 230);
  --wash-sidebar: linear-gradient(180deg, #0E1822 0%, #0A0E18 50%, #0A0E18 100%);
```

- [ ] **Step 4: 加侧边栏上色规则**

在 `.dark .theme-brand { ... }` 块闭合之后、`@layer base` 之前插入：

```css
/* 工作台侧边栏品牌微光晕 —— 经作用域规则上色，不改 shadcn ui/sidebar 组件 */
.theme-brand [data-sidebar="sidebar"] {
  background-image: var(--wash-sidebar);
}
```

---

## Task 2: 工作台布局套品牌作用域 + 顶栏毛玻璃

**Files:**
- Modify: `app/layouts/dashboardLayout.vue:1-2,22-24,93-95`

- [ ] **Step 1: 根节点包一层 `theme-brand` 作用域**

`<template>` 现在第一个节点是 `<SidebarProvider v-model:open="sidebarOpen">`。在它外面包一层 `display:contents` 的 div（`contents` 不产生布局盒，CSS 变量照常向下级联）：

把模板开头
```vue
<template>
  <SidebarProvider v-model:open="sidebarOpen">
```
改为
```vue
<template>
  <div class="contents theme-brand">
    <SidebarProvider v-model:open="sidebarOpen">
```
并在模板结尾把
```vue
  </SidebarProvider>
</template>
```
改为
```vue
    </SidebarProvider>
  </div>
</template>
```

- [ ] **Step 2: 顶栏 `<header>` 改半透明毛玻璃**

把 `<header>` 的 class 里 `bg-background border-b z-50` 改为 `bg-background/70 backdrop-blur-md border-b z-50`。改后整行：

```vue
        <header
          v-show="!hideDashboardHeader"
          class="flex h-12 shrink-0 items-center justify-between gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12 bg-background/70 backdrop-blur-md border-b z-50">
```

---

## Task 3: 侧边栏选中项渐变竖条 + 渐变底

**Files:**
- Modify: `app/components/dashboard/navMain.vue:5-17`

- [ ] **Step 1: 重写菜单项模板**

把 `<template v-for=...>` 内的 `<SidebarMenuItem>...</SidebarMenuItem>` 整段替换为：

```vue
        <template v-for="item in roleStore.currentRoleRouters.filter((item: any) => item.isMenu && item.groupId === 1)" :key="item.title">
          <SidebarMenuItem
            :class="isActive(item.path) ? 'rounded-md' : ''"
            :style="isActive(item.path) ? activeBgStyle : undefined"
          >
            <span
              v-if="isActive(item.path)"
              aria-hidden="true"
              class="absolute left-0 top-1.5 bottom-1.5 z-10 w-[3px] rounded-full"
              :style="stripeStyle"
            />
            <SidebarMenuButton as-child :tooltip="item.title" :class="[
              'p-4 pt-5 pb-5 text-base',
              isActive(item.path) ? 'font-medium text-primary' : ''
            ]">
              <NuxtLink :to="item.path">
                <component v-if="item.icon" :is="getIcon(item.icon)" />
                <span>{{ item.title }}</span>
              </NuxtLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </template>
```

说明：shadcn `SidebarMenuItem` 渲染为 `<li class="relative">`，竖条可直接绝对定位。

- [ ] **Step 2: `<script setup>` 加两个渐变常量**

在 `navMain.vue` 的 `<script setup>` 内、`const route = useRoute()` 之后加：

```ts
/** 选中项左侧 3px 品牌竖条 */
const stripeStyle = { background: 'linear-gradient(180deg, #1EEDC4, #1E9EED, #090380)' }
/** 选中项淡渐变底（青/蓝低透明 → 透明） */
const activeBgStyle = {
  backgroundImage: 'linear-gradient(90deg, rgba(30,237,196,0.16), rgba(30,158,237,0.16) 60%, transparent)',
}
```

---

## Task 4: 用户头像改品牌渐变

**Files:**
- Modify: `app/components/dashboard/navUser.vue:10-12,29-31`
- Modify: `app/components/dashboard/navUserRight.vue:17-19`

- [ ] **Step 1: `navUser.vue` 两处 `AvatarFallback` 加品牌渐变**

`navUser.vue` 有两处 `<AvatarFallback class="rounded-lg">LS</AvatarFallback>`（触发器内 + 下拉标签内）。两处都改为：

```vue
            <AvatarFallback class="rounded-lg bg-gradient-brand text-white font-semibold">LS</AvatarFallback>
```

- [ ] **Step 2: `navUserRight.vue` 的 `AvatarFallback` 同步**

`navUserRight.vue` 下拉标签内的 `<AvatarFallback class="rounded-lg">LS</AvatarFallback>` 改为：

```vue
          <AvatarFallback class="rounded-lg bg-gradient-brand text-white font-semibold">LS</AvatarFallback>
```

- [ ] **Step 3: 提交「外壳」改动**

```bash
git add app/assets/css/tailwind.css app/layouts/dashboardLayout.vue app/components/dashboard/navMain.vue app/components/dashboard/navUser.vue app/components/dashboard/navUserRight.vue
git commit app/assets/css/tailwind.css app/layouts/dashboardLayout.vue app/components/dashboard/navMain.vue app/components/dashboard/navUser.vue app/components/dashboard/navUserRight.vue -m "feat(ui): 工作台外壳品牌改造——侧边栏/顶栏/用户头像"
```

---

## Task 5: 工作台首页整页重写

**Files:**
- Modify: `app/pages/dashboard/index.vue`（整文件替换）

- [ ] **Step 1: 用以下内容整体替换 `app/pages/dashboard/index.vue`**

```vue
<template>
  <div class="p-4 md:p-6 lg:p-8 w-full">
    <!-- 分析次数限制提示 -->
    <div v-if="showAnalysisLimits" class="w-full p-4 mb-4 bg-primary/10 border border-primary/20 rounded-lg flex items-center justify-between">
      <p class="text-sm text-foreground">
        您正在使用的是 <strong class="text-primary">{{ dashboardData?.membership?.levelName ?? '免费版' }}</strong>，今日可用分析次数 <strong>{{ 0 }} / {{ 10 }}</strong> ，本月可用分析次数 <strong>{{ 0 }} / {{ 100 }}</strong>。
      </p>
      <Button variant="default" size="sm">立即升级</Button>
    </div>

    <!-- 活动横幅 -->
    <button
      type="button"
      class="relative mb-8 w-full overflow-hidden rounded-xl bg-gradient-brand px-5 py-3.5 text-left text-white shadow-[0_10px_25px_-10px_rgba(9,3,128,0.4)] transition hover:brightness-105"
      @click="wxSupportStore.showQrCode()"
    >
      <span aria-hidden="true" class="pointer-events-none absolute -top-8 right-16 size-36 rounded-full bg-white/[0.08]" />
      <span aria-hidden="true" class="pointer-events-none absolute top-2.5 -right-5 size-16 rounded-full bg-white/[0.06]" />
      <span class="relative flex items-center justify-between gap-4">
        <span class="flex items-center gap-3.5">
          <span class="inline-flex shrink-0 items-center rounded-full bg-white px-3 py-[5px] text-[11px] font-bold tracking-[0.08em] text-[#0A4DA8]">限时活动</span>
          <span class="text-[15px] font-semibold leading-snug">联系客服可领取 7 天延长使用兑换码</span>
        </span>
        <span class="hidden shrink-0 items-center gap-1 rounded-md bg-white/95 px-4 py-2 text-[13px] font-semibold text-[#0A4DA8] sm:inline-flex">
          点此联系客服
          <ArrowRight class="size-3.5" />
        </span>
      </span>
    </button>

    <!-- 欢迎语 -->
    <div class="mb-8">
      <h1 class="mb-2 text-3xl font-bold tracking-tight text-foreground">
        欢迎回来，<GradientText>{{ userStore.userInfo?.name || '' }}</GradientText>
      </h1>
      <p class="text-muted-foreground">查看您的案件分析概览和最近活动 · 今天是 {{ today }}</p>
    </div>

    <!-- 数据概览卡片 -->
    <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 mb-8">
      <component
        :is="stat.to ? NuxtLinkComp : 'div'"
        v-for="stat in stats"
        :key="stat.label"
        :to="stat.to"
        class="group block rounded-xl border border-border bg-card p-6 shadow-sm transition hover:-translate-y-1 hover:border-primary/30 hover:shadow-md"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="mb-1 text-sm font-medium text-muted-foreground">{{ stat.label }}</p>
            <h3 class="truncate text-3xl font-bold text-card-foreground">{{ stat.value }}</h3>
          </div>
          <div :class="['flex size-10 shrink-0 items-center justify-center rounded-[10px]', TINTS[stat.tint]]">
            <component :is="stat.icon" class="size-[22px]" />
          </div>
        </div>
        <div class="mt-4">
          <p v-if="stat.trend" class="flex items-center gap-1 text-[12.5px] font-medium text-green-600">
            <TrendingUp class="size-3.5" />
            <span>{{ stat.trend }}</span>
          </p>
          <p v-else-if="stat.sub" class="text-[12.5px] font-medium text-muted-foreground">{{ stat.sub }}</p>
        </div>
      </component>
    </div>

    <!-- 快速操作 -->
    <div class="mb-8">
      <h2 class="mb-4 text-xl font-semibold text-foreground">快速操作</h2>
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <component
          :is="action.to ? NuxtLinkComp : 'button'"
          v-for="action in QUICK_ACTIONS"
          :key="action.title"
          :to="action.to"
          :type="action.to ? undefined : 'button'"
          class="flex items-center gap-4 rounded-xl border border-border bg-card p-4 text-left shadow-sm transition hover:-translate-y-1 hover:border-primary/30 hover:shadow-md"
          @click="action.action === 'help' && wxSupportStore.showQrCode()"
        >
          <div :class="['flex size-10 shrink-0 items-center justify-center rounded-[10px]', TINTS[action.tint]]">
            <component :is="action.icon" class="size-5" />
          </div>
          <div>
            <h3 class="font-medium text-foreground">{{ action.title }}</h3>
            <p class="mt-0.5 text-sm text-muted-foreground">{{ action.body }}</p>
          </div>
        </component>
      </div>
    </div>

    <!-- 最新案件 -->
    <div class="mb-8">
      <div class="mb-4 flex items-center justify-between">
        <h2 class="text-xl font-semibold text-foreground">最新案件</h2>
        <NuxtLink to="/dashboard/cases" class="text-sm font-medium text-primary hover:underline">查看全部</NuxtLink>
      </div>
      <div class="flex flex-col gap-3">
        <NuxtLink
          v-for="c in dashboardData?.recentCases"
          :key="c.id"
          :to="`/dashboard/cases/${c.id}`"
          class="block rounded-lg border border-border bg-card p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
        >
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0 flex-1">
              <h3 class="mb-1.5 truncate font-medium text-foreground">{{ c.title }}</h3>
              <div class="flex items-center gap-3">
                <span class="text-sm text-muted-foreground">{{ c.date }}</span>
                <span class="inline-flex items-center rounded px-2 py-0.5 text-xs font-normal bg-secondary text-secondary-foreground">{{ c.type }}</span>
                <span v-if="c.status === 'in_progress'" class="inline-flex items-center rounded border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 text-xs font-normal text-blue-600 dark:text-blue-400">进行中</span>
                <span v-else class="inline-flex items-center rounded border border-green-500/20 bg-green-500/10 px-2 py-0.5 text-xs font-normal text-green-600 dark:text-green-400">已完成</span>
              </div>
            </div>
            <ExternalLink class="size-4 shrink-0 text-muted-foreground" />
          </div>
        </NuxtLink>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import type { Component } from 'vue'
import type { DashboardResponse } from '#shared/types/dashboard'
import {
  FileText,
  BarChart3,
  Coins,
  Crown,
  FilePlus,
  FolderOpen,
  HelpCircle,
  TrendingUp,
  ExternalLink,
  ArrowRight,
} from "lucide-vue-next";
import dayjs from 'dayjs'
import { useApi } from '~/composables/useApi'
import { useUserStore } from '~/store/user'
import { useWxSupportStore } from '~/store/wxSupport'
import GradientText from '~/components/general/GradientText.vue'

definePageMeta({
  title: "工作台",
  layout: "dashboard-layout",
  userMenu: { group: 'home', title: '首页', icon: 'Home', order: 0 },
});

const userStore = useUserStore();
const wxSupportStore = useWxSupportStore();

const { data: dashboardData } = await useApi<DashboardResponse>('/api/v1/dashboard')

// 暂时隐藏，等 API 支持后再启用
const showAnalysisLimits = false;

// 动态组件：可点击的卡片用 NuxtLink，其余用原生元素
const NuxtLinkComp = resolveComponent('NuxtLink')

const today = dayjs().format('YYYY 年 M 月 D 日')

type Tint = 'sky' | 'mint' | 'navy' | 'amber'

/** 品牌四色淡彩图标块 —— bg/fg 取自 .theme-brand 的 --tint-* token */
const TINTS: Record<Tint, string> = {
  sky: 'bg-[image:var(--tint-sky-bg)] text-[color:var(--tint-sky-fg)]',
  mint: 'bg-[image:var(--tint-mint-bg)] text-[color:var(--tint-mint-fg)]',
  navy: 'bg-[image:var(--tint-navy-bg)] text-[color:var(--tint-navy-fg)]',
  amber: 'bg-[image:var(--tint-amber-bg)] text-[color:var(--tint-amber-fg)]',
}

interface StatItem {
  label: string
  value: string | number
  icon: Component
  tint: Tint
  trend?: string
  sub?: string
  to?: string
}

const stats = computed<StatItem[]>(() => [
  {
    label: '总案件数',
    value: dashboardData.value?.statistics.totalCases ?? 0,
    icon: FileText,
    tint: 'sky',
    trend: `+${dashboardData.value?.statistics.caseIncrease ?? 0} 本月`,
  },
  {
    label: '分析次数',
    value: dashboardData.value?.statistics.totalAnalysis ?? 0,
    icon: BarChart3,
    tint: 'mint',
    trend: `+${dashboardData.value?.statistics.analysisIncrease ?? 0} 本月`,
  },
  {
    label: '可用积分',
    value: dashboardData.value?.points.remaining ?? 0,
    icon: Coins,
    tint: 'navy',
    sub: `购买: ${dashboardData.value?.points.purchasePoint ?? 0}，赠送: ${dashboardData.value?.points.otherPoint ?? 0}`,
    to: '/dashboard/membership/point',
  },
  {
    label: '会员等级',
    value: dashboardData.value?.membership?.levelName ?? '免费版',
    icon: Crown,
    tint: 'amber',
    sub: `有效期至：${dashboardData.value?.membership?.expiresAt ?? '-'}`,
    to: '/dashboard/membership',
  },
])

interface QuickAction {
  icon: Component
  title: string
  body: string
  tint: Tint
  to?: string
  action?: 'help'
}

const QUICK_ACTIONS: QuickAction[] = [
  { icon: FilePlus, title: '创建案件', body: '分析新的案件', tint: 'sky', to: '/dashboard/cases/create' },
  { icon: FolderOpen, title: '我的案件', body: '查看所有案件', tint: 'mint', to: '/dashboard/cases' },
  { icon: Crown, title: '会员中心', body: '管理套餐和积分', tint: 'amber', to: '/dashboard/membership' },
  { icon: HelpCircle, title: '获取帮助', body: '联系客服支持', tint: 'navy', action: 'help' },
]
</script>
```

- [ ] **Step 2: 提交「首页」改动**

```bash
git add app/pages/dashboard/index.vue
git commit app/pages/dashboard/index.vue -m "feat(ui): 工作台首页品牌改造——横幅/数据卡/快速操作/最新案件"
```

---

## Task 6: 类型检查与浏览器验收

**Files:** 无（仅验证）

- [ ] **Step 1: 类型检查**

Run: `npx nuxi typecheck 2>&1 | grep -E 'dashboard|tailwind|navMain|navUser' || echo "工作台相关文件无类型错误"`
Expected: 「工作台相关文件无类型错误」，或仅出现与本次无关的既有报错。如本次改动文件报错，修复后重新检查。

- [ ] **Step 2: 启动 dev server 并用 chrome-devtools 实测**

打开 `/dashboard`（已登录态），逐项核对：
- 亮色：侧边栏微光晕背景；当前菜单项左侧渐变竖条 + 淡渐变底；用户头像品牌渐变「LS」；顶栏半透明；活动横幅品牌渐变 + 装饰光晕；欢迎语名字渐变 + 当天日期；4 数据卡品牌淡彩图标块、悬停上浮；4 快速操作淡彩；最新案件状态徽章配色正确、悬停上浮。
- 暗色：顶栏「外观模式」切深色，上述全部在暗色下正常、无糊。
- 移动端（窄屏）：侧边栏收起为抽屉，顶栏 logo/汉堡菜单正常。
- 控制台无报错。

- [ ] **Step 3: 回归核对**

- 活动横幅点击弹出联系客服二维码。
- 数据卡「可用积分」「会员等级」点击跳转；「总案件数」「分析次数」不可点。
- 快速操作 4 项跳转 / 弹二维码正确。
- 最新案件每行跳对应案件详情；「查看全部」跳案件列表。
- 侧边栏折叠按钮、各菜单跳转正常。
- 抽查一个工作台子页（如 `/dashboard/cases`）：主色已变品牌天蓝，布局无错乱。
- 后台 `/admin` 配色不受影响（保持 Zinc）。

- [ ] **Step 4: 用 `simplify` 技能复查本次改动并修整**

---

## 自检

**Spec 覆盖**：主题机制（Task 2）、token 扩展（Task 1）、侧边栏（Task 1 背景 / Task 3 选中态 / Task 4 头像）、顶栏（Task 2）、首页五区块（Task 5）、暗色（各 Task 同步）、3 处设计出入决策（Task 5 已按「不加铃铛 / 不加副文 / 不加小索卡」落实）、后台不受影响（Task 2 机制保证）——全部覆盖。

**占位符**：无 TBD / TODO；每步含完整代码或精确指令。

**类型一致**：`Tint` 联合类型贯穿 `TINTS` / `StatItem` / `QuickAction`；`stats` 为 `computed<StatItem[]>`；`Component` 显式从 `vue` 导入；`NuxtLinkComp` 经 `resolveComponent` 取得，用于数据卡 / 快速操作的动态根元素。
