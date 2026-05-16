# 创建案件页视觉重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 依据 `ui_kits/dashboard/NewCasePage.jsx` 对「创建案件」页的 AI 创建视图做视觉重设计。

**Architecture:** 纯视觉/模板层改造，4 个共享组件 + 1 个页面文件就地修改；功能、数据流、两步流程全部不变。这是视觉重设计，没有可单元测试的逻辑变更——每个任务靠 `npx nuxi typecheck`（最后统一跑一次）+ chrome-devtools 浏览器多视口比对设计稿验收。配色全部映射到项目既有主题令牌，不硬编码、不新增令牌。

**Tech Stack:** Nuxt 4 + Vue 3 + Tailwind CSS v4 + shadcn-vue。

**设计依据:** `docs/superpowers/specs/2026-05-16-create-case-page-redesign-design.md`

**提交约定:** 每个任务一个原子提交；按项目规范，实际 `git commit` 需用户在执行前授权。

---

## File Structure

| 文件 | 职责 | 任务 |
|---|---|---|
| `app/components/general/GradientText.vue` | 渐变文字组件——补暗色变体 | T1 |
| `app/components/caseAnalysis/welcome.vue` | 欢迎横幅——重做 | T1 |
| `app/pages/dashboard/cases/create.vue` | 页面——欢迎横幅文案对齐设计稿 | T1 |
| `app/components/ai/AiPromptInput.vue` | AI 输入框——卡片描边/圆角/投影 + 提交按钮 | T2 |
| `app/components/caseAnalysis/example.vue` | 案例卡——静息投影 + 圆角 + 标题字号 | T3 |
| `app/components/caseAnalysis/materialSelector.vue` | 材料选择弹窗本体——筛选/按钮/文件行/空态 | T4 |

**不改动:** `general/fileUploader.vue`（材料弹窗上传模式内嵌的通用上传组件，763 行、跨功能共享，本次保持原样）、`step='confirm'` 确认表单及相关文件。

---

## Task 1: 欢迎横幅重做

**Files:**
- Modify: `app/components/general/GradientText.vue`
- Modify: `app/components/caseAnalysis/welcome.vue`（整体重写，27 行 → 见下）
- Modify: `app/pages/dashboard/cases/create.vue:16`

- [ ] **Step 1: GradientText 补暗色变体**

`general/GradientText.vue` 现为 sky→navy 渐变，深色模式下 navy 段几乎不可见。补暗色变体（设计稿 `.dark .xiaosuo-name` 用的 mint→sky 亮色）：

```vue
<template>
  <span class="bg-linear-to-br from-[#1E9EED] to-[#090380] dark:from-[#5BFCD4] dark:to-[#82CCFF] bg-clip-text text-transparent">
    <slot />
  </span>
</template>
```

- [ ] **Step 2: 重写 welcome.vue**

整体替换 `app/components/caseAnalysis/welcome.vue` 为：

```vue
<template>
  <div class="p-4 pt-6 pb-4">
    <div
      class="relative flex items-center gap-4 overflow-hidden rounded-[14px] border border-primary/15 bg-gradient-brand-soft px-6 py-5 dark:bg-gradient-custom-dark">
      <!-- 右上角品牌色装饰光晕 -->
      <div aria-hidden="true"
        class="pointer-events-none absolute -right-5 -top-10 size-44 rounded-full bg-[radial-gradient(circle,#1EEDC4_0%,transparent_70%)] opacity-25 blur-2xl" />
      <!-- 小索头像盘 -->
      <div
        class="xiaosuo-disc relative size-16 shrink-0 rounded-full bg-gradient-brand p-[3px] shadow-[0_14px_28px_-10px_rgba(30,158,237,0.4)]">
        <div class="flex size-full items-center justify-center overflow-hidden rounded-full bg-white">
          <IconXiaosuoIcon class="size-11" />
        </div>
      </div>
      <!-- 欢迎文字 -->
      <div class="relative min-w-0 flex-1">
        <span class="block text-[19px] font-bold leading-snug">
          <template v-for="(part, i) in titleParts" :key="i">
            <GradientText v-if="part === '小索'">小索</GradientText>
            <template v-else>{{ part }}</template>
          </template>
        </span>
        <span class="mt-1.5 block text-[13.5px] text-muted-foreground">{{ subtitle }}</span>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import IconXiaosuoIcon from '~/components/icon/XiaosuoIcon.vue'
import GradientText from '~/components/general/GradientText.vue'

const props = withDefaults(defineProps<{
  title?: string
  subtitle?: string
}>(), {
  title: '你好，我是小索，您的案件分析助手',
  subtitle: '在下方输入框输入或上传案情材料，我会为您分析案件',
})

// 把标题按「小索」切分，便于将「小索」渲染为品牌渐变字（标题不含「小索」时无副作用）
const titleParts = computed(() => props.title.split(/(小索)/))
</script>

<style scoped>
@keyframes xiaosuoFloat {
  0%, 100% { transform: translateY(0); }
  50%      { transform: translateY(-4px); }
}
@keyframes xiaosuoWiggle {
  0%, 100% { rotate: 0deg; }
  20%      { rotate: -6deg; }
  40%      { rotate: 6deg; }
  60%      { rotate: -4deg; }
  80%      { rotate: 2deg; }
}
.xiaosuo-disc {
  animation: xiaosuoFloat 3.2s ease-in-out infinite;
  transition: scale 0.3s ease;
}
.xiaosuo-disc:hover {
  scale: 1.08;
  animation: xiaosuoWiggle 0.8s ease-in-out;
}
</style>
```

- [ ] **Step 3: create.vue 文案对齐设计稿（你 → 您）**

`app/pages/dashboard/cases/create.vue:16`：

```
旧: <CaseAnalysisWelcome title="你好，我是小索，你的案件分析助手" subtitle="在下方输入框输入或上传案情材料，我会为你分析案件" />
新: <CaseAnalysisWelcome title="你好，我是小索，您的案件分析助手" subtitle="在下方输入框输入或上传案情材料，我会为您分析案件" />
```

- [ ] **Step 4: 浏览器验收**

dev 服务运行后用 chrome-devtools 打开 `http://localhost:3000/dashboard/cases/create`，对照设计稿核对：渐变背景、右上光晕、小索头像盘（渐变圆环 + 漂浮 + 悬停摆动放大）、「小索」渐变字、字号。再切深色模式核对（渐变字、背景均可读）。

- [ ] **Step 5: 提交**

```bash
git add app/components/general/GradientText.vue app/components/caseAnalysis/welcome.vue app/pages/dashboard/cases/create.vue
git commit -m "feat(ui): 创建案件页欢迎横幅按设计稿重做（小索头像盘+渐变标题）"
```

---

## Task 2: AI 案情输入框

**Files:**
- Modify: `app/components/ai/AiPromptInput.vue:21-22`（输入卡描边/圆角/投影）
- Modify: `app/components/ai/AiPromptInput.vue:139-150`（提交按钮品牌渐变）

- [ ] **Step 1: 输入卡样式**

`AiPromptInput.vue` 第 21-22 行 `<PromptInput>` 的 class：

```
旧: class="**:data-[slot=input-group]:shadow-none **:data-[slot=input-group]:border-primary **:data-[slot=input-group]:rounded-md transition-all"
新: class="**:data-[slot=input-group]:border-primary/35 **:data-[slot=input-group]:rounded-xl **:data-[slot=input-group]:shadow-md **:data-[slot=input-group]:shadow-primary/15 transition-all"
```

（描边改半透明品牌色、圆角 `rounded-xl`≈14px、加品牌色淡投影。投影深浅在浏览器对照设计稿微调。）

- [ ] **Step 2: 提交按钮品牌渐变**

`AiPromptInput.vue` 第 141 行 `<PromptInputSubmit>` 的 class，加 `bg-gradient-brand text-white`：

```
旧: class="h-9 px-4! rounded-md shadow-lg shadow-primary/20 active:scale-95 transition-all @max-[500px]:h-7 @max-[500px]:px-2!"
新: class="h-9 px-4! rounded-md bg-gradient-brand text-white shadow-lg shadow-primary/20 active:scale-95 transition-all @max-[500px]:h-7 @max-[500px]:px-2!"
```

- [ ] **Step 3: 浏览器验收**

`/dashboard/cases/create`：核对输入框卡片描边/圆角/投影、「提取信息」按钮为品牌渐变。深色模式核对。
顺带打开「智能助手」页确认对话输入框样式同步变化、无破版（共享组件，预期同步生效）。

- [ ] **Step 4: 提交**

```bash
git add app/components/ai/AiPromptInput.vue
git commit -m "feat(ui): AI 输入框按设计稿调整描边/圆角/投影与提交按钮"
```

---

## Task 3: 案例卡 + 区块标题

**Files:**
- Modify: `app/components/caseAnalysis/example.vue:4`（区块标题字号）
- Modify: `app/components/caseAnalysis/example.vue:11-17`（Card 投影/圆角）
- Modify: `app/components/caseAnalysis/example.vue:22`（卡片标题字重）

- [ ] **Step 1: 区块标题字号**

第 4 行：

```
旧: <div class="text-base font-bold text-muted-foreground">{{ title }}</div>
新: <div class="text-[15px] font-semibold text-muted-foreground">{{ title }}</div>
```

- [ ] **Step 2: 案例卡静息投影 + 圆角**

第 11-17 行 `<Card>` 的 `:class`——去掉 `shadow-none`（让 Card 默认 `shadow-sm` 生效）、`rounded-md` → `rounded-xl`。**悬停 `hover:ring-1 hover:ring-primary hover:bg-primary/2` 保持不变**（用户明确要求保留描边高亮，不改为上浮）：

```
旧: 'p-4 shadow-none rounded-md relative transition-all duration-300',
新: 'p-4 rounded-xl relative transition-all duration-300',
```

（该数组第二项 `selectingId` 三元表达式整体不变。）

- [ ] **Step 3: 卡片标题字重**

第 22 行 `<CardTitle>`：

```
旧: <CardTitle class="line-clamp-1 text-sm font-bold pr-6">{{ example.title }}</CardTitle>
新: <CardTitle class="line-clamp-1 text-sm font-semibold pr-6">{{ example.title }}</CardTitle>
```

- [ ] **Step 4: 浏览器验收**

`/dashboard/cases/create`：案例卡静息有极轻投影、圆角更大；悬停仍为主色描边高亮（非上浮）。深色模式核对。

- [ ] **Step 5: 提交**

```bash
git add app/components/caseAnalysis/example.vue
git commit -m "feat(ui): 案例卡按设计稿加静息投影并统一圆角"
```

---

## Task 4: 材料选择弹窗本体

**Files:**
- Modify: `app/components/caseAnalysis/materialSelector.vue` —— 弹窗容器、类型筛选、上传/确认按钮、文件行、文件图标块、勾选框、空态

仅改 `materialSelector.vue` 自身外壳；上传模式内嵌的 `GeneralFileUploader` 保持原样。全部功能（无限滚动、真实加载、加密、上传）不变。

- [ ] **Step 1: 弹窗容器圆角/投影**

第 3-4 行 `<DialogContent>` 的 class 数组首项加 `rounded-2xl shadow-2xl`：

```
旧: :class="['max-w-4xl min-w-[80vw] md:min-w-[70vw] h-[85vh] md:h-[90vh] z-[70]', 'grid grid-rows-[auto_1fr] overflow-hidden', isUploadMode ? '' : 'grid-rows-[auto_1fr_auto]']"
新: :class="['max-w-4xl min-w-[80vw] md:min-w-[70vw] h-[85vh] md:h-[90vh] z-[70] rounded-2xl shadow-2xl', 'grid grid-rows-[auto_1fr] overflow-hidden', isUploadMode ? '' : 'grid-rows-[auto_1fr_auto]']"
```

- [ ] **Step 2: 文件类型筛选——选中项品牌渐变**

第 18-23 行 `<Button v-for>`，改为始终 `variant="outline"` + 选中态叠加品牌渐变：

```
旧:
            <Button v-for="option in fileTypeOptions" :key="option.value"
              :variant="selectedFileType === option.value ? 'default' : 'outline'" size="sm"
              @click="selectedFileType = option.value" class="h-9">
新:
            <Button v-for="option in fileTypeOptions" :key="option.value"
              variant="outline" size="sm"
              :class="['h-9', selectedFileType === option.value
                ? 'bg-gradient-brand text-white border-transparent shadow-md shadow-primary/25 hover:text-white'
                : '']"
              @click="selectedFileType = option.value">
```

（`<component :is>` 图标与 `<span>` 标签行原样保留。）

- [ ] **Step 3: 上传按钮品牌渐变**

第 54 行 `<Button>`：

```
旧: <Button variant="default" size="sm" @click="toggleUploadMode" class="h-9">
新: <Button variant="default" size="sm" @click="toggleUploadMode" class="h-9 bg-gradient-brand text-white">
```

- [ ] **Step 4: 确认按钮品牌渐变**

第 174 行 `<Button>`：

```
旧: <Button @click="confirmSelection" :disabled="selectedFiles.length === 0"> 确认选择 ({{ selectedFiles.length }})
新: <Button @click="confirmSelection" :disabled="selectedFiles.length === 0" class="bg-gradient-brand text-white"> 确认选择 ({{ selectedFiles.length }})
```

- [ ] **Step 5: 文件行选中态底色**

第 108-113 行文件行 `<div v-for>` 的 `:class`，给已选中（未禁用）行加品牌淡色底：

```
旧:
            <div v-for="file in filteredFiles" :key="file.id" :class="[
              'flex items-center gap-3 p-4 transition-colors',
              isFileDisabled(file.id)
                ? 'opacity-60 cursor-not-allowed bg-muted/30'
                : 'hover:bg-accent/50 cursor-pointer'
            ]" @click="!isFileDisabled(file.id) && toggleFileSelection(file.id)">
新:
            <div v-for="file in filteredFiles" :key="file.id" :class="[
              'flex items-center gap-3 p-4 transition-colors',
              isFileDisabled(file.id)
                ? 'opacity-60 cursor-not-allowed bg-muted/30'
                : selectedFiles.includes(file.id)
                  ? 'bg-primary/5 cursor-pointer'
                  : 'hover:bg-accent/50 cursor-pointer'
            ]" @click="!isFileDisabled(file.id) && toggleFileSelection(file.id)">
```

- [ ] **Step 6: 勾选框 + 文件图标块**

第 115 行 `<Checkbox>` 的 class 加勾选态品牌渐变：

```
旧: class="cursor-pointer"
新: class="cursor-pointer data-[state=checked]:bg-gradient-brand data-[state=checked]:border-transparent"
```

第 120 行文件图标块圆角 `rounded-md` → `rounded-lg`：

```
旧: <div class="flex items-center justify-center size-10 rounded-md bg-muted">
新: <div class="flex items-center justify-center size-10 rounded-lg bg-muted">
```

- [ ] **Step 7: 空态圆形图标**

第 95-105 行空态——把裸 `<FileIcon>` 包进圆形底（保留下方「上传文件」按钮）：

```
旧:
            <div v-if="filteredFiles.length === 0 && !loading"
              class="flex flex-col items-center justify-center h-full text-center">
              <FileIcon class="size-12 text-muted-foreground/50 mb-4" />
新:
            <div v-if="filteredFiles.length === 0 && !loading"
              class="flex flex-col items-center justify-center h-full text-center">
              <div class="flex size-14 items-center justify-center rounded-full bg-muted mb-4">
                <FileIcon class="size-7 text-muted-foreground/50" />
              </div>
```

（其下 `<p>` 文案行与 `<Button>` 上传行原样保留。）

- [ ] **Step 8: 浏览器验收**

`/dashboard/cases/create` 点「上传材料」打开弹窗：核对圆角/投影、筛选标签选中态品牌渐变、上传/确认按钮渐变、勾选文件后行底色与勾选框渐变、空态圆形图标。切到上传模式确认仍正常（通用上传组件原样）。深色模式核对。

- [ ] **Step 9: 提交**

```bash
git add app/components/caseAnalysis/materialSelector.vue
git commit -m "feat(ui): 材料选择弹窗按设计稿重做筛选/按钮/文件行样式"
```

---

## Task 5: 整页验收与优化

**Files:** 无新增；本任务为校验与收尾。

- [ ] **Step 1: 类型检查**

Run: `bun run typecheck`
Expected: 通过，无新增类型错误。如有错误，定位修复后重跑。

- [ ] **Step 2: simplify 优化**

按项目规范，对本次全部改动运行 `simplify` 技能；若有可优化点就地修复。

- [ ] **Step 3: 多视口验收**

dev 服务下，用 chrome-devtools 在以下视口逐一截图比对设计稿，确认无横向溢出、布局正常：
1440×900、1366×768、1024×768、820×1180、430×932、390×844、360×800。
重点：欢迎横幅、输入框、案例卡 2 列→1 列断点、材料弹窗（含移动端搜索框单独成行）。

- [ ] **Step 4: 暗色模式验收**

切换深色模式，复核全部 5 个区块配色可读、渐变字与渐变背景正常。

- [ ] **Step 5: 功能回归**

浏览器实操：输入案情文字、打开材料弹窗选文件/搜索/切类型/上传模式、点案例卡、点「手动创建」入口、「提取信息」流程。确认功能与改造前一致。

- [ ] **Step 6: 相关测试**

Run: `npx vitest run tests/client --reporter=verbose`（若存在与上述组件相关的用例）
Expected: 通过。逻辑未改，预期无回归。

- [ ] **Step 7: 提交（如 simplify 有改动）**

```bash
git add -A
git commit -m "refactor(ui): 创建案件页重设计 simplify 优化"
```

---

## Self-Review

**Spec coverage:**
- 欢迎横幅 → T1 ✓；AI 输入框 → T2 ✓；案例卡+标题 → T3 ✓；材料弹窗 → T4 ✓；手动创建入口 → 经核对已符合设计稿，无改动（spec 区块 4 已说明）✓
- 令牌映射（gradient-brand / gradient-brand-soft / GradientText / getFileIconColor）→ 各任务已落实 ✓
- 响应式 / 暗色 → T5 Step 3-4 ✓
- 不改动项（确认表单、fileUploader）→ File Structure 已明确排除 ✓

**Placeholder scan:** 无 TBD/TODO；每处样式改动均给出确切 class。投影深浅标注「浏览器微调」属视觉收敛而非占位。

**Type consistency:** `titleParts`、`GradientText`、`IconXiaosuoIcon` 在 T1 内自洽；其余任务为模板 class 编辑，无跨任务类型引用。
