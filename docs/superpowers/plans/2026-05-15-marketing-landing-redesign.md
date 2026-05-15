# 营销首页品牌重设计 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 LexSeek 营销首页 `/` 按品牌 logo 渐变配色重设计落地为生产 Vue 代码。

**Architecture:** 在现有 8 主题系统上**增量叠加**一套品牌配色令牌，通过 `.theme-brand` 作用域类挂到营销公开页布局（`baseLayout.vue`），工作台/后台用别的布局不受影响。首页 7 屏拆为 `app/components/landing/` 下 7 个区块组件，导航/页脚抽为 `app/components/general/` 下 2 个组件。

**Tech Stack:** Nuxt 4 + Vue 3 + Tailwind CSS v4 + shadcn-vue + lucide-vue-next。

---

## 验证方式说明

本计划是**展示型页面的视觉重设计**，没有可单测的业务逻辑（唯一逻辑「按钮文案随登录态切换」是一行 `computed`）。按已批准规格文档第 9 节，每个任务的验证方式为：

1. **类型检查**：`bun run typecheck`（即 `nuxi typecheck`，不要用 `tsc`），必须 0 error。
2. **视觉走查**：保持 `bun dev` 运行，浏览器打开 `http://localhost:3000/`，肉眼核对当前区块。
3. **逐屏比对**（Task 10 集中做）：用 chrome-devtools 把实现页面与设计稿 `docs/superpowers/design-reference/marketing/index.html` 并排截图比对，覆盖明/暗 + 桌面/移动。

不写形式化单元测试——项目对展示型页面同样不铺测试，强写「断言渲染了 8 张卡片」类测试是低价值的。

---

## 全局移植规则（每个区块组件任务都适用）

设计稿原型是 React JSX（在 `docs/superpowers/design-reference/marketing/`），移植为 Vue SFC 时统一遵守：

| 维度 | 规则 |
|---|---|
| 文件结构 | `<script setup lang="ts">` + `<template>`；业务组件必须**显式 import**（项目已关目录扫描）。 |
| 样式 | 原型的内联 `style={{}}` → 优先转 Tailwind v4 工具类（含任意值，如 `pt-16`=64px、`rounded-[99px]`、`gap-14`=56px）。多段渐变/复杂阴影可用任意值 `bg-[linear-gradient(...)]`、`shadow-[...]`，或在确实更可读时保留内联 `style`。 |
| 颜色令牌 | 原型 `var(--card)`→`bg-card`、`var(--muted-foreground)`→`text-muted-foreground`、`var(--border)`→`border-border`、`var(--foreground)`→`text-foreground`、`var(--primary)`→`text-primary`/`bg-primary`。这些在 `.theme-brand` 作用域内自动解析为品牌色。 |
| 品牌渐变 | 写死的品牌渐变 hex 保持原值。整体品牌渐变用 `bg-gradient-brand` 工具类（Task 1 注册）；文字渐变用 `bg-gradient-brand bg-clip-text text-transparent`。 |
| 品牌底纹/色调井 | `var(--wash-page)`、`var(--tint-*-bg/-fg)` 用任意值引用，如 `bg-[image:var(--wash-page)]`、`bg-[image:var(--tint-sky-bg)]`、`text-[color:var(--tint-sky-fg)]`。 |
| 响应式 | **丢弃**原型的 `data-resp` + 媒体查询写法，改用 Tailwind 响应式前缀 `sm:`/`md:`/`lg:`。断点对应：原型 1023px→`lg`(1024)、640px→`sm`。 |
| hover | **丢弃**原型的 `data-hover` 写法，改用 Tailwind `hover:` + `transition` 工具类还原同等效果（卡片上浮 `hover:-translate-y-1`、按钮 `active:scale-[0.98]` 等）。 |
| 交互状态 | `React.useState`→`ref()`；`onClick`→`@click`；`.map()`→`v-for` 带 `:key`。 |
| 字体 | **不要**设置 `font-family`，沿用系统字体栈。 |
| 图标 | `lucide-vue-next` 显式 import，禁止 emoji。 |
| 暗色 | 所有颜色走令牌，禁止写死浅色值。 |
| 文案 | 中文文案照设计稿；保留中文标点。 |
| 链接 | 原型的 `href="features.html"` 等 → Nuxt `<NuxtLink to="/features">`；外链/锚点保持。 |

每个区块组件完成后用 `simplify` 技能过一遍。

---

### Task 1: 品牌配色令牌层

**Files:**
- Modify: `app/assets/css/tailwind.css`

- [ ] **Step 1: 在 `@theme static` 块末尾追加品牌渐变**

在 `app/assets/css/tailwind.css` 的 `@theme static { ... }` 块内（第 33 行 `--background-image-gradient-custom-yellow-dark` 之后、第 34 行 `}` 之前）追加：

```css
  /* 品牌渐变（源自 logo：青绿→天蓝→深蓝） */
  --background-image-gradient-brand: linear-gradient(135deg, #1EEDC4 0%, #1E9EED 50%, #090380 100%);
  --background-image-gradient-brand-soft: linear-gradient(97deg, #E0F8F1 0%, #E1F1FE 50%, #E5E4F2 100%);
```

这会生成 `bg-gradient-brand` 与 `bg-gradient-brand-soft` 工具类（与现有 `--background-image-gradient-custom` 同机制）。

- [ ] **Step 2: 在 `:root` 块末尾追加品牌色常量**

在 `:root { ... }` 块内（第 107 行 `--sidebar-ring` 之后、第 108 行 `}` 之前）追加：

```css
  /* 品牌色常量（明暗通用，源自 logo 渐变） */
  --brand-mint: #1EEDC4;
  --brand-sky: #1E9EED;
  --brand-navy: #090380;
  --brand-mint-soft: #E0F8F1;
  --brand-sky-soft: #E1F1FE;
  --brand-navy-soft: #E5E4F2;
```

- [ ] **Step 3: 追加 `.theme-brand` 作用域类**

在 `.theme-yellow.dark { ... }` 块之后（第 268 行之后）、`@layer base` 之前，追加：

```css
/* ==================== Brand 主题（营销公开页作用域，非用户可切换主题） ====================
 * 挂在 baseLayout 根节点。营销页内 --primary 变品牌天蓝，--background/--card 等不动。
 * 工作台/后台用别的布局，拿不到此 class，配色零影响。
 * 暗色用 `.dark .theme-brand` 后代选择器匹配 —— .dark 在 <html>，.theme-brand 在 baseLayout 的 div。
 */
.theme-brand {
  --primary: oklch(0.683 0.158 240);
  --primary-foreground: oklch(0.985 0 0);
  --ring: oklch(0.683 0.158 240);
  --wash-page: linear-gradient(180deg, #FFFFFF 0%, #F2FBFD 35%, #ECF3FE 100%);
  --tint-mint-bg: linear-gradient(135deg, #C8F7EA, #9DEDD3);
  --tint-mint-fg: #0BA47C;
  --tint-sky-bg: linear-gradient(135deg, #CFE9FE, #94CBFA);
  --tint-sky-fg: #0A78D8;
  --tint-navy-bg: linear-gradient(135deg, #D7D5EE, #B0AADE);
  --tint-navy-fg: #5048C0;
}
.dark .theme-brand {
  --primary: oklch(0.755 0.155 230);
  --primary-foreground: oklch(0.145 0 0);
  --ring: oklch(0.755 0.155 230);
  --wash-page: linear-gradient(180deg, #0F1115 0%, #0E1822 50%, #0B0F2A 100%);
  --tint-mint-bg: linear-gradient(135deg, rgba(30,237,196,0.22), rgba(30,237,196,0.1));
  --tint-mint-fg: #5BFCD4;
  --tint-sky-bg: linear-gradient(135deg, rgba(30,158,237,0.26), rgba(30,158,237,0.12));
  --tint-sky-fg: #82CCFF;
  --tint-navy-bg: linear-gradient(135deg, rgba(148,140,255,0.26), rgba(148,140,255,0.12));
  --tint-navy-fg: #BEB8FF;
}
```

- [ ] **Step 4: 验证构建**

Run: `bun run typecheck`
Expected: 0 error（CSS 改动不应引入类型错误）。

启动 `bun dev`，确认终端无 CSS 编译报错、首页仍能打开（此时视觉还没变）。

- [ ] **Step 5: Commit**

```bash
git add app/assets/css/tailwind.css
git commit -m "feat(theme): 新增营销页品牌配色令牌与 .theme-brand 作用域"
```

---

### Task 2: 营销页外壳（导航栏、页脚、布局）

把 `baseLayout.vue` 内联的导航与页脚抽成组件并套新设计，给 `baseLayout` 根节点挂 `.theme-brand`。导航/页脚为所有营销公开页共用。

**Files:**
- Create: `app/components/general/MarketingHeader.vue`
- Create: `app/components/general/MarketingFooter.vue`
- Modify: `app/layouts/baseLayout.vue`

**设计参考：** `docs/superpowers/design-reference/marketing/MarketingNav.jsx`（视觉）、`MarketingFooter.jsx`（视觉）。
**逻辑来源：** 现有 `app/layouts/baseLayout.vue` 第 4-190 行（登录态分支、登出、`maskTel`、`?redirect=`、主题切换器全部保留）。

- [ ] **Step 1: 创建 `MarketingFooter.vue`**

新建 `app/components/general/MarketingFooter.vue`。还原现有页脚内容（`baseLayout.vue` 第 170-190 行），样式套设计稿 `MarketingFooter.jsx`：顶部 `border-t`、`bg-muted/30` 背景、`max-w-[1280px]` 居中、左右两栏（`flex-col md:flex-row`）。左栏版权 + 工信部备案外链，右栏 3 个链接。

```vue
<template>
  <footer class="border-t py-6 bg-muted/30">
    <div class="max-w-[1280px] mx-auto px-4">
      <div class="flex flex-col md:flex-row justify-between items-center gap-4">
        <p class="text-sm text-muted-foreground text-center md:text-left">
          © 2025 上海盛熙律泓教育科技有限公司｜
          <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer"
            class="hover:text-foreground transition-colors">沪ICP备2025118451号</a>
        </p>
        <div class="flex flex-wrap justify-center md:justify-end gap-4">
          <NuxtLink to="/privacy-agreement" class="text-sm text-muted-foreground hover:text-primary transition-colors">隐私政策</NuxtLink>
          <NuxtLink to="/terms-of-use" class="text-sm text-muted-foreground hover:text-primary transition-colors">使用条款</NuxtLink>
          <NuxtLink to="/about/#contact" class="text-sm text-muted-foreground hover:text-primary transition-colors">联系我们</NuxtLink>
        </div>
      </div>
    </div>
  </footer>
</template>

<script setup lang="ts"></script>
```

- [ ] **Step 2: 创建 `MarketingHeader.vue`**

新建 `app/components/general/MarketingHeader.vue`。这是现有导航（`baseLayout.vue` 第 4-162 行）的**登录态逻辑 + 登出逻辑全保留**，视觉换成 `MarketingNav.jsx` 设计，移动端菜单从 `Transition` 展开式换成 shadcn-vue `Sheet` 抽屉。

要点：
- 吸顶 `sticky top-0 z-50`、`border-b`、`bg-background/85 backdrop-blur-md`。
- 左侧：`BrandLogo size="md"` + `<h1 translate="no">` 文字标 `LexSeek｜法索 AI`（中间 `｜` 用 `text-muted-foreground font-normal`）+ 桌面导航 4 链接。
- 导航链接选中态（`useRoute().path` 判断）：`text-primary` + `bg-primary/10` 圆角 pill；非选中 `text-foreground hover:bg-primary/5`。
- 右侧：`GeneralThemeToggle`（`ClientOnly` 包裹，沿用现有 `~/components/general/ThemeToggle.vue`）+ 登录态分支。
- 未登录（桌面 `hidden md:flex`）：「登录」文字链接 + 「免费注册」按钮（品牌渐变 `bg-gradient-to-br from-[#1E9EED] to-[#090380] text-white`，链接带 `?redirect=`）。
- 已登录（桌面）：「个人中心」链接 + `DropdownMenu` 用户菜单（沿用现有第 54-83 行结构：用户名、`maskTel(phone)`、个人中心/我的案件/账户设置、登出红色项）。
- 移动端：`<Sheet>` —— `SheetTrigger` 为汉堡按钮（`md:hidden`），`SheetContent side="left"` 内含 logo lockup + 4 导航链接 + 登录态对应 CTA。**必须**含 `<SheetTitle class="sr-only">导航菜单</SheetTitle>` 与 `<SheetDescription class="sr-only">站点导航</SheetDescription>`（shadcn a11y 强制规则）。点链接后关闭抽屉（`ref` 控制 `Sheet` 的 `v-model:open`）。
- `<script setup lang="ts">`：显式 import —— `BrandLogo`、`GeneralThemeToggle`、shadcn `Sheet*`/`DropdownMenu*` 组件、lucide `Menu`/`X`/`User` 图标、`useAuthStore`、`useUserStore`、`maskTel`、`toast`、`resetAllStore`。登出逻辑照搬现有 `handleLogout`（`authStore.logout()` → `toast.success('登出成功')` → `resetAllStore()` → `router.replace('/')`）。

参考现有 shadcn 用法：用 mcp__shadcn 工具或读 `app/components/ui/sheet/`、`app/components/ui/dropdown-menu/` 确认 API。导航链接数据用数组 `[{to:'/',label:'首页'},{to:'/features',label:'产品功能'},{to:'/pricing',label:'价格方案'},{to:'/about',label:'关于我们'}]` + `v-for`。

- [ ] **Step 3: 重构 `baseLayout.vue`**

把 `app/layouts/baseLayout.vue` 收敛为薄壳：

```vue
<template>
  <div class="theme-brand min-h-screen bg-background text-foreground flex flex-col">
    <MarketingHeader />
    <main class="flex-1">
      <slot />
    </main>
    <MarketingFooter />
  </div>
</template>

<script setup lang="ts">
import MarketingHeader from '~/components/general/MarketingHeader.vue'
import MarketingFooter from '~/components/general/MarketingFooter.vue'
</script>
```

删除原 `<script>` 里已迁移进 `MarketingHeader` 的所有导航/登出逻辑。

- [ ] **Step 4: 验证**

Run: `bun run typecheck` → 0 error。

`bun dev`，浏览器开 `http://localhost:3000/`：
- 顶栏为新样式（毛玻璃、品牌渐变「免费注册」按钮），页脚为新样式。
- 导航链接「首页」为选中态（品牌天蓝 pill）。
- 切换暗色模式，导航/页脚跟随翻色。
- 窗口拉窄到 < 768px：桌面菜单消失、出现汉堡，点击从左侧滑出 `Sheet` 抽屉。
- 打开 `/features`（正文还是旧的）确认新外壳也生效、无报错。
- 控制台无 `Missing Description` 等 a11y 告警。

> 此时首页正文仍是旧的 7 屏内联代码，外壳已是新的——属正常过渡态。

- [ ] **Step 5: Commit**

```bash
git add app/components/general/MarketingHeader.vue app/components/general/MarketingFooter.vue app/layouts/baseLayout.vue
git commit -m "feat(ui): 营销页导航与页脚组件化并套品牌新设计"
```

---

### Task 3: LandingHero 区块

**Files:**
- Create: `app/components/landing/LandingHero.vue`
- Modify: `app/pages/index.vue`

**设计参考：** `docs/superpowers/design-reference/marketing/Hero.jsx`

- [ ] **Step 1: 创建 `LandingHero.vue`**

按全局移植规则把 `Hero.jsx` 移植为 `app/components/landing/LandingHero.vue`。结构：
- `<section>` 背景 `bg-[image:var(--wash-page)]`、`relative overflow-hidden`、padding `pt-16 px-4 pb-20`（移动端可 `pt-12 pb-14`）。
- 两团装饰光晕（`aria-hidden` 的绝对定位 div，径向渐变 + `blur`）。
- 两栏 grid（`lg:grid-cols-[1.05fr_1fr]` gap `lg:gap-14`），移动端单栏堆叠。
- 左栏：NEW 徽章 pill（`rounded-full`、`bg-card/70 backdrop-blur`、`border-primary/20`，内含品牌渐变「NEW」chip + 文字「合同审查 · quote 字符级高亮已上线」）；H1（首行「专为法律人打造的」+ `<br>` + 渐变行「案情分析与诉讼辅助 AI 平台」用 `bg-gradient-brand bg-clip-text text-transparent`）；副文案 `text-muted-foreground`；双按钮；信任行 3 项（小渐变圆点 + 文字）。
- 右栏：视频井——外层 `rounded-[18px] p-0.5 bg-gradient-brand`，内层 `rounded-2xl overflow-hidden aspect-video bg-card`，内嵌 `<video src="https://lexseek.cn/video/vcr.mp4" poster="https://lexseek.cn/video/cover.png" controls playsinline webkit-playsinline class="w-full h-full object-cover">`。
- 主按钮：品牌渐变（`bg-gradient-to-br from-[#1E9EED] to-[#090380] text-white`），文案 `btnText`，`<NuxtLink to="/dashboard/cases/create">`；次按钮「了解更多」`<NuxtLink to="/features">`（`border-primary/20 bg-card/70`）。
- `<script setup lang="ts">`：`import { useAuthStore } from '~/store/auth'`；`const authStore = useAuthStore()`；`const btnText = computed(() => authStore.isAuthenticated ? '开始分析' : '免费体验')`。

- [ ] **Step 2: 接入 `index.vue`**

修改 `app/pages/index.vue`：删除模板里第 3-30 行的旧「英雄区域」`<section>`，在原位置放 `<LandingHero />`。在 `<script setup>` 顶部加 `import LandingHero from '~/components/landing/LandingHero.vue'`。其余旧区块暂不动。

- [ ] **Step 3: 验证**

Run: `bun run typecheck` → 0 error。
浏览器看首页第一屏：品牌底纹、NEW 徽章、渐变标题、双按钮、16:9 视频井渐变描边；切暗色正常；拉窄到移动端两栏堆叠、视频在下方铺满。对照 `Hero.jsx` 走查。

- [ ] **Step 4: 用 `simplify` 技能过一遍 `LandingHero.vue`**

- [ ] **Step 5: Commit**

```bash
git add app/components/landing/LandingHero.vue app/pages/index.vue
git commit -m "feat(ui): 首页 Hero 区块品牌重设计"
```

---

### Task 4: LandingPainPoints 区块

**Files:**
- Create: `app/components/landing/LandingPainPoints.vue`
- Modify: `app/pages/index.vue`

**设计参考：** `docs/superpowers/design-reference/marketing/PainPoints.jsx`

- [ ] **Step 1: 创建 `LandingPainPoints.vue`**

按全局规则移植 `PainPoints.jsx`。结构：
- `<section>` `bg-background`、padding `py-20 px-4`。
- 居中标题区：小标题「THE PROBLEM · 行业痛点」（`text-primary`、`uppercase`、`tracking-[0.08em]`、13px）+ H2「资源受限的"大多数"」（「大多数」三字用品牌渐变文字 clip）。
- 3 列卡片 grid（`md:grid-cols-3` gap 5），移动端单列。每卡 `data` 数组驱动 `v-for`：3 项 `{stat,title,body,accent}`，`accent` 为 `mint`/`sky`/`navy`。
- 卡片：`bg-card rounded-2xl p-8 pt-9 border shadow-sm relative overflow-hidden`，`hover:-translate-y-1 hover:shadow-md transition`；顶部 3px 渐变描边条（accent 对应渐变）；顶部 60% 高度淡色晕（accent 色 12% 透明度→透明）；渐变大数字（64px，accent 渐变 clip）；标题 + 描述。
- 文案沿用现有首页（`index.vue` 第 38-55 行）：50% 时间浪费 / 75% 经验鸿沟 / 50% 人才困局，描述照抄。

- [ ] **Step 2: 接入 `index.vue`**

删除 `index.vue` 模板里旧「痛点」`<section>`（原第 32-58 行），原位置放 `<LandingPainPoints />`；`<script>` 加 `import LandingPainPoints from '~/components/landing/LandingPainPoints.vue'`。

- [ ] **Step 3: 验证**

`bun run typecheck` → 0 error。浏览器看第二屏：3 张统计卡、渐变大数字、顶部渐变条、hover 上浮、暗色正常、移动端单列。对照 `PainPoints.jsx`。

- [ ] **Step 4: 用 `simplify` 技能过一遍组件**

- [ ] **Step 5: Commit**

```bash
git add app/components/landing/LandingPainPoints.vue app/pages/index.vue
git commit -m "feat(ui): 首页行业痛点区块品牌重设计"
```

---

### Task 5: LandingSolutions 区块（保留区块，重做配色）

设计稿无此屏——这是产品方明确要求保留的「一站式智慧法律AI」区块。**不自创新样式**：复用 Task 4/6 的卡片视觉语言（小标题 eyebrow + 渐变 H2 + 色调图标井卡片）。

**Files:**
- Create: `app/components/landing/LandingSolutions.vue`
- Modify: `app/pages/index.vue`

**内容来源：** 现有 `index.vue` 第 60-92 行（3 支柱 + 文案 + 底部 CTA，全部保留）。
**视觉参考：** `docs/superpowers/design-reference/marketing/FeatureGrid.jsx` 的卡片 + 色调井写法。

- [ ] **Step 1: 创建 `LandingSolutions.vue`**

结构：
- `<section>` `bg-muted/30`、padding `py-20 px-4`，`max-w-[1200px]` 居中。
- 居中标题区：小标题「THE SOLUTION · 解决方案」（`text-primary uppercase tracking-[0.08em] text-[13px]`）+ H2「一站式智慧法律AI」（「智慧法律AI」用品牌渐变文字 clip）+ 副文案「我们用一个平台，三大支柱，彻底解决行业痛点，将法律工作化繁为简。」
- 3 列卡片 grid（`md:grid-cols-3` gap 5），移动端单列。`data` 数组 3 项：
  1. `{title:'分析引擎', body:'多模态AI驱动，深度分析案情与合同，提供数据驱动的决策洞见。', icon: Cpu, tint:'mint'}`
  2. `{title:'智能生成系统', body:'一键生成标准化法律文书，将律师从重复性写作中解放，效率倍增。', icon: FileText, tint:'sky'}`
  3. `{title:'协同管理平台', body:'案件、文档、任务云端管理，打破团队信息壁垒，实现无缝协同。(即将上线)', icon: Users, tint:'navy'}`
- 卡片：`bg-card rounded-2xl p-8 border shadow-sm`，`hover:-translate-y-1 hover:shadow-md transition`；左上 48×48 圆角色调图标井（`bg-[image:var(--tint-{tint}-bg)]`，图标 `text-[color:var(--tint-{tint}-fg)]` 26px）；标题 + 描述。
- 底部居中 CTA 按钮：品牌渐变，文案 `btnText`，`<NuxtLink to="/dashboard/cases/create">`。
- `<script setup lang="ts">`：`import { Cpu, FileText, Users } from 'lucide-vue-next'`；`import { useAuthStore } from '~/store/auth'`；`btnText` 同 Task 3 的 `computed`。

- [ ] **Step 2: 接入 `index.vue`**

删除旧「解决方案」`<section>`（原第 60-93 行），原位置放 `<LandingSolutions />`；`<script>` 加 import。

- [ ] **Step 3: 验证**

`bun run typecheck` → 0 error。浏览器看第三屏：muted 背景、3 张支柱卡片配色调图标井、底部渐变按钮、暗色与移动端正常。视觉与痛点/功能屏卡片语言一致。

- [ ] **Step 4: 用 `simplify` 技能过一遍组件**

- [ ] **Step 5: Commit**

```bash
git add app/components/landing/LandingSolutions.vue app/pages/index.vue
git commit -m "feat(ui): 首页解决方案区块品牌重设计"
```

---

### Task 6: LandingFeatures 区块

**Files:**
- Create: `app/components/landing/LandingFeatures.vue`
- Modify: `app/pages/index.vue`

**设计参考：** `docs/superpowers/design-reference/marketing/FeatureGrid.jsx`

- [ ] **Step 1: 创建 `LandingFeatures.vue`**

按全局规则移植 `FeatureGrid.jsx`。结构：
- `<section>` `bg-background`、padding `py-20 px-4`。
- 标题区：小标题「FEATURES · 核心能力」+ H2「强大的功能，简化您的工作流程」（「简化您的工作流程」渐变 clip）+ 副文案「LexSeek 提供全面的案件分析工具，帮助您更高效地处理法律案件」。
- 8 卡片 grid（`grid-cols-2 md:grid-cols-4` gap 4）。`data` 数组 8 项 `{icon,title,body,tint}`，照 `FeatureGrid.jsx` 的 `featureItems`：
  - `summary` 案情概要生成 / mint
  - `chronicle` 案件大事记 / sky
  - `cause` 案由确认 / sky
  - `claim` 请求权生成与分析 / navy
  - `defense` 对方抗辩预测 / mint
  - `evidence` 证据清单 / sky
  - `trend` 判决趋势预测 / navy
  - `lawyerLetter` 律师函生成 / sky
- 卡片：`bg-card rounded-[14px] p-6 border shadow-sm`，`hover:-translate-y-1 hover:shadow-md transition`；48×48 圆角色调图标井；标题 + 描述。
- **图标**：用 `module_icon` SVG（项目 `public/images/module_icon/` 已有全部 15 个），经 CSS `mask` 上色为色调井前景色——图标元素 `26×26`，样式 `background-color: var(--tint-{tint}-fg)`、`mask: url(/images/module_icon/{icon}.svg) center/contain no-repeat`（`-webkit-mask` 同写）。可用内联 `:style` 绑定。
- 描述文案照 `FeatureGrid.jsx` 的 `body` 字段。

- [ ] **Step 2: 接入 `index.vue`**

删除旧「功能简介区」`<section>`（原第 95-158 行），原位置放 `<LandingFeatures />`；`<script>` 加 import。

- [ ] **Step 3: 验证**

`bun run typecheck` → 0 error。浏览器看第四屏：8 张功能卡、领域图标随色调井上色（不是死黑）、桌面 4 列 / 平板移动 2 列、hover、暗色正常。对照 `FeatureGrid.jsx`。

- [ ] **Step 4: 用 `simplify` 技能过一遍组件**

- [ ] **Step 5: Commit**

```bash
git add app/components/landing/LandingFeatures.vue app/pages/index.vue
git commit -m "feat(ui): 首页核心功能区块品牌重设计"
```

---

### Task 7: LandingWorkflow 区块

**Files:**
- Create: `app/components/landing/LandingWorkflow.vue`
- Modify: `app/pages/index.vue`

**设计参考：** `docs/superpowers/design-reference/marketing/WorkflowSteps.jsx`

- [ ] **Step 1: 创建 `LandingWorkflow.vue`**

按全局规则移植 `WorkflowSteps.jsx`。结构：
- `<section>` `bg-muted/30`、padding `py-20 px-4`。
- 标题区：小标题「HOW IT WORKS」+ H2「简单三步，完成案件分析」（「完成案件分析」渐变 clip）。
- 桌面 grid `lg:grid-cols-[1fr_auto_1fr_auto_1fr]`：3 张步骤卡 + 卡间 2 个连接箭头；移动端单列堆叠、隐藏箭头（`hidden lg:flex`）。
- `data` 3 项 `{n,title,body,tint}`：`01` 输入案情 mint、`02` AI 分析 sky、`03` 获取结果 navy。文案照 `WorkflowSteps.jsx`。
- 步骤卡：`bg-card rounded-[18px] p-7 border shadow-sm relative overflow-hidden min-h-[220px]`，`hover:-translate-y-1` 等；左上柔光晕（`aria-hidden` 绝对定位径向渐变 + blur）；右上大号编号水印（64px、`tint` 渐变 clip、`opacity-70`）；56×56 圆角色调图标井（图标用 lucide：`01`→`FilePlus`、`02`→`Cpu`、`03`→`CheckCircle2`，26px）；标题 + 描述。
- 连接箭头：`WorkflowSteps.jsx` 里 `StepConnector` 的渐变虚线 + 箭头 SVG，可原样内联该 `<svg>`。
- `<script setup lang="ts">`：`import { FilePlus, Cpu, CheckCircle2 } from 'lucide-vue-next'`。

- [ ] **Step 2: 接入 `index.vue`**

删除旧「工作流程」`<section>`（原第 160-203 行），原位置放 `<LandingWorkflow />`；`<script>` 加 import。

- [ ] **Step 3: 验证**

`bun run typecheck` → 0 error。浏览器看第五屏：3 张步骤卡、编号水印、柔光、卡间渐变箭头；移动端单列且无箭头；暗色正常。对照 `WorkflowSteps.jsx`。

- [ ] **Step 4: 用 `simplify` 技能过一遍组件**

- [ ] **Step 5: Commit**

```bash
git add app/components/landing/LandingWorkflow.vue app/pages/index.vue
git commit -m "feat(ui): 首页三步流程区块品牌重设计"
```

---

### Task 8: LandingTools 区块

**Files:**
- Create: `app/components/landing/LandingTools.vue`
- Modify: `app/pages/index.vue`

**视觉参考：** `docs/superpowers/design-reference/marketing/ToolsGrid.jsx`（仅取标题区 + 卡片 + 天蓝色调井的视觉）。
**内容来源：** 现有 `index.vue` 第 206-291 行——**保留现有 10 个工具卡、跳转链接、图标、文案**，只换视觉。

- [ ] **Step 1: 创建 `LandingTools.vue`**

结构：
- `<section>` `bg-background`、padding `py-20 px-4`。
- 标题区：小标题「UTILITY TOOLS」+ H2「专业办案工具」（「办案工具」渐变 clip）+ 副文案「丰富的计算工具集合，帮助您精确计算各类费用和数据，提升办案效率」。
- 10 卡片 grid `grid-cols-2 md:grid-cols-3 lg:grid-cols-5` gap 4。`data` 数组照现有 10 项，每项 `{to,icon,title,body}`：
  - `/dashboard/tools/interest` CalculatorIcon 利息计算 / 计算各类借款、欠款的利息
  - `/dashboard/tools/court-fee` LitigationIcon 诉讼费用 / 计算诉讼案件的诉讼费用
  - `/dashboard/tools/lawyer-fee` MoneyBagIcon 律师费计算 / 计算律师费用
  - `/dashboard/tools/delay-interest` ClockIcon 延迟履行利息 / 计算延迟履行的利息
  - `/dashboard/tools/bank-rate` BadgePercentIcon 银行利率查询 / 查询银行的最新利率
  - `/dashboard/tools/date-calculator` CalendarIcon 日期推算 / 计算特定日期间隔或推算日期
  - `/dashboard/tools/compensation` MoneyIcon 赔偿计算器 / 计算各类赔偿金额
  - `/dashboard/tools/overtime` BriefcaseIcon 加班计算 / 计算加班费用
  - `/dashboard/tools/divorce-property` HeartHandshakeIcon 离婚财产分割 / 离婚财产分割计算
  - `/dashboard/tools/social-insurance` ShieldIcon 社保追缴 / 计算社保追缴金额
- 卡片为 `<NuxtLink :to>`：`bg-card rounded-xl p-6 border shadow-sm flex flex-col items-center text-center`，`hover:-translate-y-1 hover:shadow-md transition group`；48×48 圆角天蓝色调井（`bg-[image:var(--tint-sky-bg)] text-[color:var(--tint-sky-fg)]`），图标 `group-hover:scale-110 transition`；标题 + 描述。
- `<script setup lang="ts">`：`import { Calculator as CalculatorIcon, Clock as ClockIcon, BadgePercent as BadgePercentIcon, Calendar as CalendarIcon, Briefcase as BriefcaseIcon, HeartHandshake as HeartHandshakeIcon, Shield as ShieldIcon } from 'lucide-vue-next'`；自定义图标 `import LitigationIcon from '~/components/icons/Litigation.vue'`、`import MoneyBagIcon from '~/components/icons/MoneyBag.vue'`、`import MoneyIcon from '~/components/icons/MoneyIcon.vue'`。图标用 `<component :is>` 渲染，统一尺寸（井内约 24-28px）。

> 注意：自定义图标 `Litigation.vue` 等用 `currentColor`，放进色调井后给图标元素加 `text-[color:var(--tint-sky-fg)]` 即可着色。

- [ ] **Step 2: 接入 `index.vue`**

删除旧「办案工具」`<section>`（原第 205-292 行），原位置放 `<LandingTools />`；`<script>` 加 import。

- [ ] **Step 3: 验证**

`bun run typecheck` → 0 error。浏览器看第六屏：10 张工具卡、天蓝色调图标井、hover 图标放大、点击跳转对应 `/dashboard/tools/*`；桌面 5 列 / 平板 3 列 / 移动 2 列；暗色正常。

- [ ] **Step 4: 用 `simplify` 技能过一遍组件**

- [ ] **Step 5: Commit**

```bash
git add app/components/landing/LandingTools.vue app/pages/index.vue
git commit -m "feat(ui): 首页办案工具区块品牌重设计"
```

---

### Task 9: LandingCta 区块 + index.vue 收尾

**Files:**
- Create: `app/components/landing/LandingCta.vue`
- Modify: `app/pages/index.vue`

**设计参考：** `docs/superpowers/design-reference/marketing/CTASection.jsx`

- [ ] **Step 1: 创建 `LandingCta.vue`**

按全局规则移植 `CTASection.jsx`。结构：
- `<section>` 满幅品牌渐变背景 `bg-gradient-brand`、`text-white`、`relative overflow-hidden`、padding `py-20 px-4`。
- 装饰：两团模糊光晕 + 右下角淡 mono logo 水印（用项目 `/logo-white.svg`，`opacity-[0.08]`）。
- 居中内容：磨砂白圆盘（80×80，`rounded-full bg-white/95`，投影）内嵌彩色 logo（`/logo.svg`，48×48）；H2「立即开始使用 <span translate="no">LexSeek</span>」；副文案「加入成千上万的法律专业人士，体验法律 AI 辅助案件分析带来的效率提升」；双按钮——主按钮白底深蓝字（`bg-white text-[#0A4DA8]`，文案 `btnText`，`<NuxtLink to="/dashboard/cases/create">`），次按钮磨砂边框（`bg-white/15 border-white/30 text-white`，「了解更多」`<NuxtLink to="/features">`）。
- `<script setup lang="ts">`：`useAuthStore` + `btnText` computed。

- [ ] **Step 2: 接入 `index.vue` 并清理**

修改 `app/pages/index.vue`：删除旧「号召行动」`<section>`（原第 294-308 行），原位置放 `<LandingCta />`。

此时 `index.vue` 模板应只剩 7 个区块组件。整理 `<script setup>`：
- 删除所有旧的 lucide 与自定义图标 import（`FileTextIcon`/`CalendarIcon`/`GavelIcon`/`EvidenceIcon` 等——它们已随各区块组件迁走）。
- 保留：`definePageMeta`、`useSiteSeo` 调用及其 import（`useSiteSeo`、`softwareApplicationLd`、`siteUrl`）。
- 删除不再使用的 `useAuthStore` import 与 `btnText`（已下沉到各区块组件）。
- 7 个区块组件 import 齐全。

最终 `index.vue` 形态：

```vue
<template>
  <div>
    <LandingHero />
    <LandingPainPoints />
    <LandingSolutions />
    <LandingFeatures />
    <LandingWorkflow />
    <LandingTools />
    <LandingCta />
  </div>
</template>

<script setup lang="ts">
import LandingHero from '~/components/landing/LandingHero.vue'
import LandingPainPoints from '~/components/landing/LandingPainPoints.vue'
import LandingSolutions from '~/components/landing/LandingSolutions.vue'
import LandingFeatures from '~/components/landing/LandingFeatures.vue'
import LandingWorkflow from '~/components/landing/LandingWorkflow.vue'
import LandingTools from '~/components/landing/LandingTools.vue'
import LandingCta from '~/components/landing/LandingCta.vue'
import { useSiteSeo } from '~/composables/useSiteSeo'
import { softwareApplicationLd } from '#shared/utils/seo/jsonLd'

definePageMeta({
  layout: 'base-layout',
  title: '首页',
})

const { siteUrl } = useRuntimeConfig().public.seo
useSiteSeo({
  title: '法律 AI 案件分析平台 - 律师专属 AI 工作台',
  description: 'LexSeek 法索 AI 是专为法律人打造的多模态 AI 精细化案件分析工具，告别低效梳理、专注精准判断：AI 案情分析、请求权分析、合同审查、起诉状/答辩状生成、利息/诉讼费计算等一站式办案工具。注册即享 7 天旗舰版免费试用。',
  path: '/',
  keywords: ['法律AI', '律师AI助手', '案件分析', 'AI律师', '诉讼辅助', '合同审查AI', '法律文书AI', '法律科技', '办案工具', 'LexSeek', '法索AI'],
  ogImage: '/og/home.png',
  jsonLd: softwareApplicationLd(siteUrl),
})
</script>
```

- [ ] **Step 3: 验证**

Run: `bun run typecheck` → 0 error（确认无「未使用变量/import」遗留）。
浏览器看完整首页 7 屏从上到下连贯、背景明暗交替（底纹→白→muted→白→muted→白→渐变）、CTA 区品牌渐变 + 磨砂 logo；暗色正常。

- [ ] **Step 4: 用 `simplify` 技能过一遍 `LandingCta.vue` 与 `index.vue`**

- [ ] **Step 5: Commit**

```bash
git add app/components/landing/LandingCta.vue app/pages/index.vue
git commit -m "feat(ui): 首页行动号召区块品牌重设计并完成首页装配"
```

---

### Task 10: 全页验收

**Files:** 无新增/修改（除非走查发现问题需回修）。

- [ ] **Step 1: 类型检查**

Run: `bun run typecheck`
Expected: 0 error。

- [ ] **Step 2: chrome-devtools 逐屏比对**

`bun dev` 运行中。用 chrome-devtools MCP：
- 打开 `http://localhost:3000/`，从上到下截图 7 屏。
- 打开设计稿 `docs/superpowers/design-reference/marketing/index.html`（`file://` 方式）作为对照。
- 逐屏比对：Hero、痛点、解决方案、功能、流程、工具、CTA——间距、配色、渐变、圆角、阴影是否一致。
- 切暗色模式（点顶栏主题切换），重复 7 屏走查。
- 视口改 375px（移动端）：Hero 单栏、网格降列、流程无箭头、顶栏汉堡 + `Sheet` 抽屉开合正常。
- 检查控制台无报错、无 a11y 告警。

- [ ] **Step 3: 回归检查**

- 顶栏登录态：未登录显示「登录/免费注册」，已登录显示「个人中心 + 用户菜单」，登出可用。
- 主按钮文案：未登录「免费体验」、已登录「开始分析」。
- 工具卡 10 个链接跳转正确。
- 页脚 3 个链接（隐私政策/使用条款/联系我们）可达。
- 打开 `/features`、`/pricing`、`/about` 确认新导航/页脚正常、无报错（正文仍是旧版属预期）。

- [ ] **Step 4: 走查发现的问题就地回修**

如发现与设计稿偏差或回归问题，定位到对应组件修复，重跑 Step 1-3。

- [ ] **Step 5: Commit（如有回修）**

```bash
git add -A
git commit -m "fix(ui): 首页重设计验收走查问题修复"
```

---

## 自检清单（计划完成时已核对）

- **规格覆盖**：规格文档 7 屏 → Task 3-9 一一对应；令牌层 → Task 1；导航/页脚 → Task 2；暗色/响应式 → 各 Task 验证步骤；验收 → Task 10。无遗漏。
- **占位符**：无 TBD/TODO；移植类任务以「仓库内设计参考文件 + 全局移植规则 + 逐项要点」给出完整指令，非占位。
- **命名一致**：组件名 `Landing{Hero,PainPoints,Solutions,Features,Workflow,Tools,Cta}` 全程一致；作用域类 `.theme-brand`、令牌 `--tint-*`/`--wash-page`、工具类 `bg-gradient-brand` 跨任务一致；`btnText` computed 在 Hero/Solutions/Cta 三处定义一致。

## 收尾备注

- `docs/superpowers/design-reference/` 为本次实施的临时设计参考，功能上线后可删除。
- 后续任务（不在本计划内）：功能/价格/关于等页正文改版、工作台与登录页品牌化。
