# 工具卡 interrupt 内联化 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把所有 `isToolCard=true` 的 interrupt（template_select / stance_select）从模态弹窗改为消息流内联渲染，与已有工具结果卡片体系融合。

**Architecture:** 新建 `useInterruptSnapshot` helper 在 3 个 Panel 中暴露 `resolvedInterrupts` reactive Record；用 `provide/inject` 把 `messageStreamContext`（含 interruptData / resolvedInterrupts / resolveInterrupt）下沉到 `AiToolRenderer`；`AiToolRenderer` 在工具调用对应 isToolCard interrupt 时合并渲染 `InterruptDispatcher`（resumeValue 是否 undefined 自动判定 active/snapshot），resolved 后紧贴下方追加 toolMap 完成态。

**Tech Stack:** Vue 3 + Nuxt 4 + LangGraph SDK + Vitest

---

## File Structure

| 文件 | 改动类型 | 责任 |
|------|---------|------|
| `app/composables/agent-platform/useInterruptSnapshot.ts` | Create | reactive Record + record/clear helper |
| `app/components/InterruptDispatcher.vue` | Modify | 加 `resumeValue` prop 并透传到子组件 |
| `app/components/agents/document/interrupts/TemplateSelectCard.vue` | Modify | 加 `resumeValue` 推导 isSnapshot；移除 intent 引导文字；snapshot 视觉 |
| `app/components/agents/contract/interrupts/StanceSelectCard.vue` | Modify | 加 `resumeValue` 推导 isSnapshot；snapshot 视觉 |
| `app/components/ai/AiToolRenderer.vue` | Modify | inject messageStreamContext；加合并的 interrupt 分支 |
| `app/components/caseDetail/CaseDetailXiaosuo.vue` | Modify | 用 useInterruptSnapshot；resolveInterrupt 内 record；session 切换 clear；provide messageStreamContext；Dialog 加 isToolCard 条件 |
| `app/components/assistant/AssistantChatPanel.vue` | Modify | 同上 |
| `app/components/assistant/contract/ContractReviewPanel.vue` | Modify | 同上 |
| `tests/app/composables/agent-platform/useInterruptSnapshot.test.ts` | Create | record / clear 单测 |
| `tests/app/components/ai/AiToolRenderer.test.ts` | Create | interrupt 分支分发用例 |
| `tests/app/components/agents/document/interrupts/TemplateSelectCard.test.ts` | Modify | 扩展：snapshot 模式 + intent 文字移除 |
| `tests/app/components/agents/contract/interrupts/StanceSelectCard.test.ts` | Modify | 扩展：snapshot 模式 |

---

## Task 1: useInterruptSnapshot helper composable

**Files:**
- Create: `app/composables/agent-platform/useInterruptSnapshot.ts`
- Test: `tests/app/composables/agent-platform/useInterruptSnapshot.test.ts`

### Step 1: 写新建测试

- [ ] **新建文件 `tests/app/composables/agent-platform/useInterruptSnapshot.test.ts`：**

```ts
/**
 * useInterruptSnapshot helper 测试
 *
 * **Feature: interrupt-tool-card-inline / Task 1**
 */
import { describe, it, expect } from 'vitest'
import { nextTick } from 'vue'
import { useInterruptSnapshot } from '~/composables/agent-platform/useInterruptSnapshot'

describe('useInterruptSnapshot', () => {
    it('record() 把 interrupt + resumeValue 写入 reactive Record', () => {
        const { resolvedInterrupts, record } = useInterruptSnapshot()
        const interrupt = { type: 'template_select', toolCallId: 'call_001', payload: 'foo' }

        record(interrupt, { templateId: 11 })

        expect(resolvedInterrupts['call_001']).toBeDefined()
        expect(resolvedInterrupts['call_001']!.interrupt).toEqual(interrupt)
        expect(resolvedInterrupts['call_001']!.resumeValue).toEqual({ templateId: 11 })
        expect(resolvedInterrupts['call_001']!.resolvedAt).toBeInstanceOf(Date)
    })

    it('record() 接受 null resumeValue（用户取消）', () => {
        const { resolvedInterrupts, record } = useInterruptSnapshot()
        const interrupt = { type: 'template_select', toolCallId: 'call_002' }

        record(interrupt, null)

        expect(resolvedInterrupts['call_002']!.resumeValue).toBeNull()
    })

    it('record(null, ...) 跳过不写入', () => {
        const { resolvedInterrupts, record } = useInterruptSnapshot()
        record(null, { templateId: 1 })
        expect(Object.keys(resolvedInterrupts)).toHaveLength(0)
    })

    it('record(interrupt 缺 toolCallId, ...) 跳过不写入', () => {
        const { resolvedInterrupts, record } = useInterruptSnapshot()
        record({ type: 'template_select' } as any, { templateId: 1 })
        expect(Object.keys(resolvedInterrupts)).toHaveLength(0)
    })

    it('record(interrupt 缺 type, ...) 跳过不写入', () => {
        const { resolvedInterrupts, record } = useInterruptSnapshot()
        record({ toolCallId: 'call_003' } as any, { templateId: 1 })
        expect(Object.keys(resolvedInterrupts)).toHaveLength(0)
    })

    it('clear() 清空所有字段', () => {
        const { resolvedInterrupts, record, clear } = useInterruptSnapshot()
        record({ type: 't1', toolCallId: 'a' }, 1)
        record({ type: 't2', toolCallId: 'b' }, 2)
        expect(Object.keys(resolvedInterrupts)).toHaveLength(2)

        clear()

        expect(Object.keys(resolvedInterrupts)).toHaveLength(0)
    })

    it('reactive 触发 Vue 更新', async () => {
        const { resolvedInterrupts, record } = useInterruptSnapshot()
        const calls: number[] = []

        // 用 watch 模拟订阅
        const { watchEffect } = await import('vue')
        const stop = watchEffect(() => {
            calls.push(Object.keys(resolvedInterrupts).length)
        })

        record({ type: 't', toolCallId: 'x' }, 'v')
        await nextTick()

        expect(calls).toEqual([0, 1])
        stop()
    })
})
```

### Step 2: 跑测试确认 RED

- [ ] **运行：**

```bash
npx vitest run tests/app/composables/agent-platform/useInterruptSnapshot.test.ts --reporter=verbose
```

预期：模块 not found（文件还未创建）。

### Step 3: 实现 useInterruptSnapshot

- [ ] **新建文件 `app/composables/agent-platform/useInterruptSnapshot.ts`：**

```ts
/**
 * Interrupt 快照 helper
 *
 * 在 3 个 Panel（CaseDetailXiaosuo / AssistantChatPanel / ContractReviewPanel）
 * 各自的 setup 调用，提供 resolvedInterrupts reactive Record + record/clear helper。
 *
 * 数据用途：当用户在 isToolCard=true 的 interrupt 卡片上做出选择/取消后，
 * 把 interrupt payload + resumeValue 按 toolCallId 索引存起来，让消息流里
 * 对应位置的卡片冻结成 snapshot 视觉常驻显示（resolvedInterrupts 仅内存，
 * 切换 session 即清空，不持久化）。
 *
 * @see docs/superpowers/specs/2026-04-29-interrupt-tool-card-inline-design.md
 */

import { reactive } from 'vue'

export interface ResolvedInterruptEntry {
    interrupt: { type: string; toolCallId: string; [key: string]: unknown }
    resumeValue: unknown // null 表示用户取消
    resolvedAt: Date
}

export function useInterruptSnapshot() {
    const resolvedInterrupts = reactive<Record<string, ResolvedInterruptEntry>>({})

    /** 在 panel 的 resolveInterrupt 内调用（在 resumeInterrupt 之前调） */
    function record(
        interruptData: { type?: string; toolCallId?: string; [key: string]: unknown } | null,
        resumeValue: unknown,
    ): void {
        if (!interruptData?.toolCallId || !interruptData.type) return
        resolvedInterrupts[interruptData.toolCallId] = {
            interrupt: interruptData as ResolvedInterruptEntry['interrupt'],
            resumeValue,
            resolvedAt: new Date(),
        }
    }

    /** 切换 session 时调用 */
    function clear(): void {
        for (const k in resolvedInterrupts) {
            delete resolvedInterrupts[k]
        }
    }

    return { resolvedInterrupts, record, clear }
}
```

### Step 4: 跑测试确认 GREEN

- [ ] **再跑：**

```bash
npx vitest run tests/app/composables/agent-platform/useInterruptSnapshot.test.ts --reporter=verbose
```

预期：7/7 PASS。

### Step 5: Commit

- [ ] **commit：**

```bash
git add app/composables/agent-platform/useInterruptSnapshot.ts \
        tests/app/composables/agent-platform/useInterruptSnapshot.test.ts
git commit -m "$(cat <<'EOF'
feat(ui): 新建 useInterruptSnapshot helper

为工具卡 interrupt 内联化提供 reactive Record 数据结构，3 个 Panel
（小索 / 法律助手 / 合同审查）各自调用，存储用户在 interrupt 卡片
上的选择，让消息流里对应位置的卡片冻结成 snapshot 视觉常驻显示。

风格与 useStreamChat 同文件 subThreadsMap / syntheticToolCalls 一致
（reactive<Record<string, T>>），仅内存不持久化，切换 session 即清空。
EOF
)"
```

---

## Task 2: TemplateSelectCard 加 resumeValue 支持 + 移除 intent 文字

**Files:**
- Modify: `app/components/agents/document/interrupts/TemplateSelectCard.vue`
- Test: `tests/app/components/agents/document/interrupts/TemplateSelectCard.test.ts`

### Step 1: 扩展测试（先 RED）

- [ ] **打开 `tests/app/components/agents/document/interrupts/TemplateSelectCard.test.ts`，在文件末尾追加：**

```ts
describe('TemplateSelectCard - snapshot 模式', () => {
    it('resumeValue 非 undefined 时进入 snapshot：所有按钮 disabled', async () => {
        const wrapper = mount(TemplateSelectCard, {
            props: {
                interrupt: {
                    type: 'template_select',
                    toolCallId: 'call_001',
                    recommendations: [{ id: 11, name: '起诉状' }],
                    total: 1,
                },
                onResolve: vi.fn(),
                resumeValue: { templateId: 11 },
            },
        })
        // 提交按钮被隐藏
        expect(wrapper.text()).not.toContain('使用此模板')
        expect(wrapper.text()).not.toContain('取消')
        // 显示已选状态
        expect(wrapper.text()).toContain('已选模板')
        expect(wrapper.text()).toContain('起诉状')
    })

    it('resumeValue=null 时显示已取消', async () => {
        const wrapper = mount(TemplateSelectCard, {
            props: {
                interrupt: {
                    type: 'template_select',
                    toolCallId: 'call_002',
                    recommendations: [{ id: 11, name: '起诉状' }],
                    total: 1,
                },
                onResolve: vi.fn(),
                resumeValue: null,
            },
        })
        expect(wrapper.text()).toContain('已取消')
    })

    it('snapshot 模式下根 div 有 opacity-70 class', async () => {
        const wrapper = mount(TemplateSelectCard, {
            props: {
                interrupt: {
                    type: 'template_select',
                    toolCallId: 'call_003',
                    recommendations: [{ id: 11, name: '起诉状' }],
                    total: 1,
                },
                onResolve: vi.fn(),
                resumeValue: { templateId: 11 },
            },
        })
        expect(wrapper.find('.opacity-70').exists()).toBe(true)
    })

    it('active 模式下不渲染 intent 引导文字', async () => {
        const wrapper = mount(TemplateSelectCard, {
            props: {
                interrupt: {
                    type: 'template_select',
                    toolCallId: 'call_004',
                    intent: '起诉某某拖欠工资',
                    recommendations: [{ id: 11, name: '起诉状' }],
                    total: 1,
                },
                onResolve: vi.fn(),
            },
        })
        // 不再显示「根据「...」为您推荐」前缀
        expect(wrapper.text()).not.toContain('为您推荐')
    })
})
```

### Step 2: 跑测试确认 RED

- [ ] **运行：**

```bash
npx vitest run tests/app/components/agents/document/interrupts/TemplateSelectCard.test.ts --reporter=verbose
```

预期：4 条新增用例 fail（snapshot prop 还不存在 / intent 文字还在）。

### Step 3: 移除 intent 引导文字 + 加 resumeValue prop + isSnapshot 推导

- [ ] **修改 `app/components/agents/document/interrupts/TemplateSelectCard.vue`：**

第一处改动（脚本区，约 line 87-105 附近 `defineProps` 块）：

把：

```ts
const props = defineProps<{
    interrupt: TemplateInterrupt
    onResolve: (value: ResolveValue | null) => Promise<void> | void
}>()
```

改成：

```ts
const props = defineProps<{
    interrupt: TemplateInterrupt
    onResolve?: (value: ResolveValue | null) => Promise<void> | void
    /** snapshot 模式：传入用户之前 resolve 的值；undefined = active 模式 */
    resumeValue?: ResolveValue | null
}>()

const isSnapshot = computed(() => props.resumeValue !== undefined)
```

第二处改动：在 `selectedId` 初始化（约 line 100）后加一条：

把：

```ts
const selectedId = ref<number | null>(recommendations.value[0]?.id ?? null)
```

改成：

```ts
const selectedId = ref<number | null>(
    isSnapshot.value && props.resumeValue?.templateId !== undefined
        ? props.resumeValue.templateId
        : recommendations.value[0]?.id ?? null,
)
```

第三处改动：snapshot 模式下 confirmed 自动 true：

在脚本末尾、`handleSubmit` / `handleCancel` 之前加：

```ts
// snapshot 模式：mount 时即视为 confirmed（复用现有 confirmed 视觉）
if (isSnapshot.value) {
    confirmed.value = true
}
```

### Step 4: 修改模板：移除 intent 文字 + snapshot 视觉

- [ ] **找到 line 252-254 的 intent 引导段（`<p v-if="intentText">...为您推荐：</p>`）整段删除。**

具体定位标记：搜索 `intentText"` 字符串在模板中的 `<p>` 行，删除从 `<p v-if="intentText"` 到 `</p>` 的整段（共 3 行）。

- [ ] **修改根 div（line 246）加 conditional opacity / border：**

把：

```vue
<div class="not-prose my-2 w-full max-w-lg rounded-lg border border-amber-300/60 bg-amber-50/60 p-4 shadow-sm dark:border-amber-700/60 dark:bg-amber-950/30">
```

改成：

```vue
<div
    :class="[
        'not-prose my-2 w-full max-w-lg rounded-lg border p-4 shadow-sm',
        isSnapshot
            ? 'border-muted bg-muted/20 opacity-70 dark:border-muted dark:bg-muted/10'
            : 'border-amber-300/60 bg-amber-50/60 dark:border-amber-700/60 dark:bg-amber-950/30',
    ]"
>
```

- [ ] **隐藏 active-only 元素：搜索框 / 分类下拉 / 浏览全部按钮 / 推荐区折叠按钮。**

把"浏览全部"切换按钮（约 line 310-320）整块包到 `v-if="!isSnapshot"`：

把：

```vue
<button
    v-if="!expanded"
    type="button"
    ...
    @click="toggleExpanded"
>
```

改成：

```vue
<button
    v-if="!expanded && !isSnapshot"
    type="button"
    ...
    @click="toggleExpanded"
>
```

把"展开状态：搜索 + 分类 + 全库列表"区块（约 line 322-455 的外层 `<div v-if="expanded">`）的 `v-if` 加上 `&& !isSnapshot`：

把：

```vue
<div v-if="expanded" class="space-y-3">
```

改成：

```vue
<div v-if="expanded && !isSnapshot" class="space-y-3">
```

把推荐区里的"展开后可折叠"按钮（约 line 258-269）也包到 `v-if="!isSnapshot"`：

把：

```vue
<div v-if="expanded" class="mb-2 flex items-center justify-between text-xs text-muted-foreground">
```

改成：

```vue
<div v-if="expanded && !isSnapshot" class="mb-2 flex items-center justify-between text-xs text-muted-foreground">
```

- [ ] **隐藏底部 active 操作按钮组（约 line 468-486 的 `<div v-if="!confirmed">`）—— snapshot 模式下 confirmed=true，本来就被现有 `v-if="!confirmed"` 隐藏，无需额外改动。**

- [ ] **更新 confirmed 状态显示文本（约 line 459-462）支持取消态：**

把：

```vue
<p v-if="confirmed" class="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
    <CheckCircle2 class="size-3.5" />
    已选模板：{{ selectedTemplateName || '已确认' }}
</p>
```

改成：

```vue
<p v-if="confirmed" class="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
    <CheckCircle2 class="size-3.5" />
    {{ isSnapshot && resumeValue === null ? '已取消' : `已选模板：${selectedTemplateName || '已确认'}` }}
</p>
```

### Step 5: 跑测试确认 GREEN

- [ ] **再跑：**

```bash
npx vitest run tests/app/components/agents/document/interrupts/TemplateSelectCard.test.ts --reporter=verbose
```

预期：原有测试 + 4 条新增用例全 PASS。

### Step 6: 类型检查

- [ ] **跑：**

```bash
bun run typecheck 2>&1 | grep -i "TemplateSelectCard\|TemplateSelect" | head -10
```

预期：无错误（其他预存在错误不在本次范围）。

### Step 7: Commit

- [ ] **commit：**

```bash
git add app/components/agents/document/interrupts/TemplateSelectCard.vue \
        tests/app/components/agents/document/interrupts/TemplateSelectCard.test.ts
git commit -m "$(cat <<'EOF'
feat(ui): TemplateSelectCard 支持 snapshot 模式 + 移除 intent 文字

加 resumeValue 可选 prop，非 undefined 时自动进入 snapshot：
- confirmed 状态自动 true，按钮隐藏
- 根 div 加 opacity-70 + border-muted（在现有 confirmed 视觉之上）
- 隐藏 active-only 元素：搜索 / 分类下拉 / 浏览全部 / 推荐区折叠
- resumeValue=null 显示"已取消"

同步移除原 modal 时代的 intent 引导段（line 252-254）：内联后用户原始
陈述就在消息流上方可见，不重复。
EOF
)"
```

---

## Task 3: StanceSelectCard 加 resumeValue 支持

**Files:**
- Modify: `app/components/agents/contract/interrupts/StanceSelectCard.vue`
- Test: `tests/app/components/agents/contract/interrupts/StanceSelectCard.test.ts`

### Step 1: 扩展测试（先 RED）

- [ ] **打开 `tests/app/components/agents/contract/interrupts/StanceSelectCard.test.ts`，在文件末尾追加：**

```ts
describe('StanceSelectCard - snapshot 模式', () => {
    it('resumeValue 非 undefined 时按钮 disabled，显示已选立场', async () => {
        const wrapper = mount(StanceSelectCard, {
            props: {
                interrupt: {
                    type: 'stance_select',
                    toolCallId: 'call_001',
                    fileName: '合同.docx',
                },
                onResolve: vi.fn(),
                resumeValue: { stance: 'partyA', partyA: '甲公司', partyB: '乙公司' },
            },
        })
        expect(wrapper.text()).toContain('甲方')
        expect(wrapper.findAll('button').filter(b => b.text() === '使用此立场').length).toBe(0)
    })

    it('resumeValue=null 时显示已取消', async () => {
        const wrapper = mount(StanceSelectCard, {
            props: {
                interrupt: {
                    type: 'stance_select',
                    toolCallId: 'call_002',
                    fileName: '合同.docx',
                },
                onResolve: vi.fn(),
                resumeValue: null,
            },
        })
        expect(wrapper.text()).toContain('已取消')
    })

    it('snapshot 模式下根 div 有 opacity-70 class', async () => {
        const wrapper = mount(StanceSelectCard, {
            props: {
                interrupt: {
                    type: 'stance_select',
                    toolCallId: 'call_003',
                    fileName: '合同.docx',
                },
                onResolve: vi.fn(),
                resumeValue: { stance: 'partyB' },
            },
        })
        expect(wrapper.find('.opacity-70').exists()).toBe(true)
    })
})
```

### Step 2: 跑测试确认 RED

- [ ] **运行：**

```bash
npx vitest run tests/app/components/agents/contract/interrupts/StanceSelectCard.test.ts --reporter=verbose
```

预期：3 条新增用例 fail。

### Step 3: 加 resumeValue prop + isSnapshot

- [ ] **修改 `app/components/agents/contract/interrupts/StanceSelectCard.vue` 脚本区 defineProps 块（约 line 38-42）：**

把：

```ts
const props = defineProps<{
    interrupt: StanceInterrupt
    onResolve: (value: StanceResolveValue | null) => Promise<void> | void
}>()
```

改成：

```ts
const props = defineProps<{
    interrupt: StanceInterrupt
    onResolve?: (value: StanceResolveValue | null) => Promise<void> | void
    /** snapshot 模式：传入用户之前 resolve 的值；undefined = active 模式 */
    resumeValue?: StanceResolveValue | null
}>()

const isSnapshot = computed(() => props.resumeValue !== undefined)
```

### Step 4: snapshot 模式下初始化已选立场 + confirmed=true

- [ ] **找到 stance / partyA / partyB 这几个 ref 的初始化处（约 line 50 附近），改成：**

把（具体行号可能略有不同，搜索 `const stance = ref` 找定位）：

```ts
const stance = ref<...>('...')
// ...partyA / partyB ref...
const confirmed = ref(false)
```

在 `confirmed = ref(false)` 之后加初始化逻辑：

```ts
// snapshot 模式：mount 时即视为 confirmed，立场初始化为 resumeValue
if (isSnapshot.value && props.resumeValue) {
    if (props.resumeValue.stance) stance.value = props.resumeValue.stance
    if (props.resumeValue.partyA !== undefined) partyA.value = props.resumeValue.partyA ?? ''
    if (props.resumeValue.partyB !== undefined) partyB.value = props.resumeValue.partyB ?? ''
    confirmed.value = true
}
```

> **注意：** 实施时 `partyA` / `partyB` 的实际变量名可能不同，先 grep `const partyA` / `const partyB` 找到真实声明再加。如果模板里没有这些 ref，跳过对应行。

### Step 5: 模板根 div 加 conditional class

- [ ] **找到根 div（约 line 92）：**

把：

```vue
<div class="not-prose my-2 w-full max-w-md rounded-lg border border-amber-300/60 bg-amber-50/60 p-4 shadow-sm dark:border-amber-700/60 dark:bg-amber-950/30">
```

改成：

```vue
<div
    :class="[
        'not-prose my-2 w-full max-w-md rounded-lg border p-4 shadow-sm',
        isSnapshot
            ? 'border-muted bg-muted/20 opacity-70 dark:border-muted dark:bg-muted/10'
            : 'border-amber-300/60 bg-amber-50/60 dark:border-amber-700/60 dark:bg-amber-950/30',
    ]"
>
```

### Step 6: 加"已取消"显示

- [ ] **找到 confirmed 状态显示区（搜索 `v-if="confirmed"` 或类似，约 line 153-160 附近）：**

如果当前已有"已选立场：xxx"文本，改成支持取消态：

```vue
<p v-if="confirmed" class="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
    <CheckCircle2 class="size-3.5" />
    {{ isSnapshot && resumeValue === null ? '已取消' : `已选立场：${stanceLabel}` }}
</p>
```

> 实施时具体的 `stanceLabel` 变量名以代码现状为准（搜索 confirmed 段附近的现有"已选"文本）。

### Step 7: 跑测试确认 GREEN

- [ ] **再跑：**

```bash
npx vitest run tests/app/components/agents/contract/interrupts/StanceSelectCard.test.ts --reporter=verbose
```

预期：原有测试 + 3 条新增用例全 PASS。

### Step 8: Commit

- [ ] **commit：**

```bash
git add app/components/agents/contract/interrupts/StanceSelectCard.vue \
        tests/app/components/agents/contract/interrupts/StanceSelectCard.test.ts
git commit -m "$(cat <<'EOF'
feat(ui): StanceSelectCard 支持 snapshot 模式

加 resumeValue 可选 prop，非 undefined 时自动进入 snapshot：
- confirmed 状态自动 true，按钮被隐藏
- 根 div 加 opacity-70 + border-muted
- 立场 / 甲乙方初始化为 resumeValue
- resumeValue=null 显示"已取消"

与 TemplateSelectCard 设计一致，配合 useInterruptSnapshot 在消息流
内联展示用户的立场选择历史。
EOF
)"
```

---

## Task 4: InterruptDispatcher 加 resumeValue 透传

**Files:**
- Modify: `app/components/InterruptDispatcher.vue`

无需新建测试（透传逻辑由 AiToolRenderer 测试间接覆盖）。

### Step 1: 加 prop

- [ ] **修改 `app/components/InterruptDispatcher.vue` 第 24-28 行 `defineProps` 块：**

把：

```ts
const props = defineProps<{
    /** 中断数据，必含 type 字段；type 用于查注册表 */
    interrupt: { type?: string;[key: string]: unknown } | null
    isSubmitting?: boolean
}>()
```

改成：

```ts
const props = defineProps<{
    /** 中断数据，必含 type 字段；type 用于查注册表 */
    interrupt: { type?: string;[key: string]: unknown } | null
    isSubmitting?: boolean
    /** snapshot 模式专用；undefined = active；中断卡（isToolCard=false）忽略此 prop */
    resumeValue?: unknown
}>()
```

### Step 2: 模板透传到工具卡

- [ ] **修改 `app/components/InterruptDispatcher.vue` 第 75-80 行模板的工具卡分支：**

把：

```vue
<component
    :is="HandlerComponent"
    v-else-if="isToolCard"
    :interrupt="interrupt"
    :on-resolve="handleResolve"
/>
```

改成：

```vue
<component
    :is="HandlerComponent"
    v-else-if="isToolCard"
    :interrupt="interrupt"
    :on-resolve="handleResolve"
    :resume-value="resumeValue"
/>
```

中断卡分支（line 81-88）不动——`resumeValue` 不传给中断卡，中断卡忽略它。

### Step 3: 类型检查

- [ ] **跑：**

```bash
bun run typecheck 2>&1 | grep -i "InterruptDispatcher" | head -5
```

预期：无错误。

### Step 4: Commit

- [ ] **commit：**

```bash
git add app/components/InterruptDispatcher.vue
git commit -m "$(cat <<'EOF'
feat(ui): InterruptDispatcher 加 resumeValue prop 透传

为 snapshot 模式工具卡（TemplateSelectCard / StanceSelectCard）
透传 resumeValue。中断卡（isToolCard=false）忽略此 prop。
EOF
)"
```

---

## Task 5: AiToolRenderer 加合并的 interrupt 分支

**Files:**
- Modify: `app/components/ai/AiToolRenderer.vue`
- Test: `tests/app/components/ai/AiToolRenderer.test.ts`

### Step 1: 写新建测试（先 RED）

- [ ] **新建 `tests/app/components/ai/AiToolRenderer.test.ts`：**

```ts
/**
 * AiToolRenderer interrupt 分支分发测试
 *
 * **Feature: interrupt-tool-card-inline / Task 5**
 */
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref, reactive, defineComponent, h } from 'vue'
import AiToolRenderer from '~/components/ai/AiToolRenderer.vue'
import { globalInterruptRegistry } from '~/composables/agent-platform/interruptRegistry'

// stub 一个工具卡 + 一个中断卡用于测试派发
const StubToolCard = defineComponent({
    props: ['interrupt', 'resumeValue'],
    setup(props) {
        return () => h('div', {
            class: 'stub-tool-card',
            'data-mode': props.resumeValue !== undefined ? 'snapshot' : 'active',
        }, JSON.stringify(props))
    },
})

const StubResultCard = defineComponent({
    props: ['toolName', 'output'],
    setup(props) {
        return () => h('div', { class: 'stub-result-card' }, props.toolName)
    },
})

beforeAll(() => {
    globalInterruptRegistry.register('stub_tool_select', StubToolCard, { isToolCard: true })
})

function makeContext(opts: {
    interruptData?: any
    resolvedInterrupts?: Record<string, any>
}) {
    return {
        interruptData: ref(opts.interruptData ?? null),
        resolvedInterrupts: reactive(opts.resolvedInterrupts ?? {}),
        resolveInterrupt: vi.fn(),
    }
}

describe('AiToolRenderer - interrupt 分支', () => {
    it('active interrupt 命中 toolCallId → 渲染 InterruptDispatcher（active 模式）', () => {
        const ctx = makeContext({
            interruptData: { type: 'stub_tool_select', toolCallId: 'call_x' },
        })
        const wrapper = mount(AiToolRenderer, {
            props: {
                toolCall: {
                    id: 'call_x',
                    name: 'stub_tool',
                    args: {},
                    state: 'input-available',
                },
                toolMap: { stub_tool: StubResultCard },
            },
            global: {
                provide: { messageStreamContext: ctx },
            },
        })
        const card = wrapper.find('.stub-tool-card')
        expect(card.exists()).toBe(true)
        expect(card.attributes('data-mode')).toBe('active')
        expect(wrapper.find('.stub-result-card').exists()).toBe(false)
    })

    it('resolved interrupt + tool 已完成 → 同时渲染 snapshot + 完成态', () => {
        const ctx = makeContext({
            resolvedInterrupts: {
                call_x: {
                    interrupt: { type: 'stub_tool_select', toolCallId: 'call_x' },
                    resumeValue: { picked: 1 },
                    resolvedAt: new Date(),
                },
            },
        })
        const wrapper = mount(AiToolRenderer, {
            props: {
                toolCall: {
                    id: 'call_x',
                    name: 'stub_tool',
                    args: {},
                    result: { ok: true },
                    state: 'output-available',
                },
                toolMap: { stub_tool: StubResultCard },
            },
            global: { provide: { messageStreamContext: ctx } },
        })
        const card = wrapper.find('.stub-tool-card')
        expect(card.exists()).toBe(true)
        expect(card.attributes('data-mode')).toBe('snapshot')
        expect(wrapper.find('.stub-result-card').exists()).toBe(true)
    })

    it('resolved interrupt + tool 未完成（用户取消） → 仅渲染 snapshot', () => {
        const ctx = makeContext({
            resolvedInterrupts: {
                call_x: {
                    interrupt: { type: 'stub_tool_select', toolCallId: 'call_x' },
                    resumeValue: null,
                    resolvedAt: new Date(),
                },
            },
        })
        const wrapper = mount(AiToolRenderer, {
            props: {
                toolCall: {
                    id: 'call_x',
                    name: 'stub_tool',
                    args: {},
                    state: 'input-available',
                },
                toolMap: { stub_tool: StubResultCard },
            },
            global: { provide: { messageStreamContext: ctx } },
        })
        expect(wrapper.find('.stub-tool-card').exists()).toBe(true)
        expect(wrapper.find('.stub-result-card').exists()).toBe(false)
    })

    it('普通工具（非 isToolCard interrupt）→ 走 toolMap 默认分支', () => {
        const ctx = makeContext({})
        const wrapper = mount(AiToolRenderer, {
            props: {
                toolCall: {
                    id: 'call_y',
                    name: 'stub_tool',
                    args: {},
                    state: 'output-available',
                    result: {},
                },
                toolMap: { stub_tool: StubResultCard },
            },
            global: { provide: { messageStreamContext: ctx } },
        })
        expect(wrapper.find('.stub-tool-card').exists()).toBe(false)
        expect(wrapper.find('.stub-result-card').exists()).toBe(true)
    })

    it('messageStreamContext 未 provide 时 → 不影响普通工具渲染（向后兼容）', () => {
        const wrapper = mount(AiToolRenderer, {
            props: {
                toolCall: {
                    id: 'call_z',
                    name: 'stub_tool',
                    args: {},
                    state: 'output-available',
                    result: {},
                },
                toolMap: { stub_tool: StubResultCard },
            },
        })
        expect(wrapper.find('.stub-result-card').exists()).toBe(true)
    })
})
```

### Step 2: 跑测试确认 RED

- [ ] **运行：**

```bash
npx vitest run tests/app/components/ai/AiToolRenderer.test.ts --reporter=verbose
```

预期：5 条用例 fail（新分支还未实现）。

### Step 3: 修改 AiToolRenderer 加 inject 上下文

- [ ] **修改 `app/components/ai/AiToolRenderer.vue` 脚本区，在第 49 行 `subAgentAccess` inject 之后追加：**

```ts
// messageStreamContext：interrupt 内联化用，由 panel 层 provide
interface MessageStreamContext {
    interruptData: { value: { type?: string; toolCallId?: string; [key: string]: unknown } | null }
    resolvedInterrupts: Record<string, {
        interrupt: { type: string; toolCallId: string; [key: string]: unknown }
        resumeValue: unknown
        resolvedAt: Date
    }>
    resolveInterrupt: (value: unknown) => void
}
const messageStreamContext = inject<MessageStreamContext | null>('messageStreamContext', null)

const resolvedEntry = computed(() => {
    return messageStreamContext?.resolvedInterrupts[props.toolCall.id] ?? null
})

const isInterruptToolCardCall = computed(() => {
    const active = messageStreamContext?.interruptData.value
    if (active?.toolCallId === props.toolCall.id
        && active.type
        && globalInterruptRegistry.isToolCard(active.type)) {
        return true
    }
    return !!resolvedEntry.value
})
```

> 同时把 `globalInterruptRegistry` import 加到顶部 import 区：
> `import { globalInterruptRegistry } from '~/composables/agent-platform/interruptRegistry'`

> 同时把 `InterruptDispatcher` import 加到顶部 import 区：
> `import InterruptDispatcher from '~/components/InterruptDispatcher.vue'`

### Step 4: 修改模板加合并的 interrupt 分支

- [ ] **修改 `app/components/ai/AiToolRenderer.vue` 模板（第 65-105 行）：在 `<template>` 标签内最前面、所有现有 `<component>` 之前插入：**

把：

```vue
<template>
  <!-- 用户自定义工具优先 -->
  <component
    v-if="toolMap?.[toolCall.name]"
    :is="toolMap[toolCall.name]"
    ...
  />
```

改成：

```vue
<template>
  <!-- interrupt 工具卡（active 或 resolved）：合并为一条分支，靠 resumeValue 自动判定 -->
  <template v-if="isInterruptToolCardCall">
    <InterruptDispatcher
      :interrupt="resolvedEntry?.interrupt ?? messageStreamContext?.interruptData.value ?? null"
      :resume-value="resolvedEntry?.resumeValue"
      @submit="(v) => messageStreamContext?.resolveInterrupt(v)"
      @cancel="() => messageStreamContext?.resolveInterrupt(null)"
    />
    <component
      v-if="resolvedEntry && toolCall.state === 'output-available' && toolMap?.[toolCall.name]"
      :is="toolMap[toolCall.name]"
      :tool-name="toolCall.name"
      :input="toolCall.args"
      :output="toolCall.result"
      :state="toolCall.state"
    />
  </template>
  <!-- 用户自定义工具优先 -->
  <component
    v-else-if="toolMap?.[toolCall.name]"
    :is="toolMap[toolCall.name]"
    ...
  />
```

> **注意 v-if → v-else-if**：原有的第一个 `<component v-if="toolMap?.[toolCall.name]">` 必须改成 `v-else-if`，否则两个分支会并存渲染。

### Step 5: 跑测试确认 GREEN

- [ ] **再跑：**

```bash
npx vitest run tests/app/components/ai/AiToolRenderer.test.ts --reporter=verbose
```

预期：5/5 PASS。

### Step 6: 类型检查

- [ ] **跑：**

```bash
bun run typecheck 2>&1 | grep -i "AiToolRenderer" | head -5
```

预期：无错误。

### Step 7: Commit

- [ ] **commit：**

```bash
git add app/components/ai/AiToolRenderer.vue \
        tests/app/components/ai/AiToolRenderer.test.ts
git commit -m "$(cat <<'EOF'
feat(ui): AiToolRenderer 加 interrupt 内联分支

inject messageStreamContext，对工具调用：
- active interrupt 命中 toolCallId 且 isToolCard=true 时，渲染
  InterruptDispatcher（active 模式，传 interruptData）
- resolved 历史命中 toolCallId 时，渲染 InterruptDispatcher（snapshot
  模式，传 resumeValue）；toolCall 已完成时同时追加 toolMap 完成态
- 普通工具（非 isToolCard / 未触发 interrupt）：现状不变

向后兼容：messageStreamContext 未 provide 时跳过新分支，原有 toolMap
分发不受影响。
EOF
)"
```

---

## Task 6: 3 个 Panel 集成 + Dialog 条件化

**Files:**
- Modify: `app/components/caseDetail/CaseDetailXiaosuo.vue`
- Modify: `app/components/assistant/AssistantChatPanel.vue`
- Modify: `app/components/assistant/contract/ContractReviewPanel.vue`

无新建测试（该层逻辑由 dev 端到端验证）。

### Step 1: CaseDetailXiaosuo —— 加 useInterruptSnapshot + provide + record/clear

- [ ] **修改 `app/components/caseDetail/CaseDetailXiaosuo.vue` 脚本区（约 line 14-22 的 import 块附近）追加：**

```ts
import { provide, watch } from 'vue'
import { useInterruptSnapshot } from '~/composables/agent-platform/useInterruptSnapshot'
```

（如果 provide / watch 已经被其它代码 import，跳过）。

- [ ] **在脚本里 `interruptData` 解构之后追加：**

```ts
const { resolvedInterrupts, record: recordResolved, clear: clearResolved } = useInterruptSnapshot()

provide('messageStreamContext', {
    interruptData,
    resolvedInterrupts,
    resolveInterrupt,
})

// session 切换时清空快照：xiaosuoChat.currentSessionId 变化即清
watch(() => props.xiaosuoChat.currentSessionId.value, () => {
    clearResolved()
})
```

- [ ] **在现有 `resolveInterrupt` 函数（约 line 97-104）的 `props.xiaosuoChat.resumeInterrupt(...)` 调用**之前**插入一行：**

把：

```ts
async function resolveInterrupt(value: unknown) {
    const tcId = (interruptData.value as { toolCallId?: unknown } | null)?.toolCallId
    if (typeof tcId === 'string' && tcId) {
        props.xiaosuoChat.resumeInterrupt({ [tcId]: value })
    } else {
        props.xiaosuoChat.resumeInterrupt(value)
    }
}
```

改成：

```ts
async function resolveInterrupt(value: unknown) {
    recordResolved(interruptData.value, value)
    const tcId = (interruptData.value as { toolCallId?: unknown } | null)?.toolCallId
    if (typeof tcId === 'string' && tcId) {
        props.xiaosuoChat.resumeInterrupt({ [tcId]: value })
    } else {
        props.xiaosuoChat.resumeInterrupt(value)
    }
}
```

### Step 2: CaseDetailXiaosuo —— Dialog 加 isToolCard 条件

- [ ] **在脚本里加 computed：**

```ts
import { globalInterruptRegistry } from '~/composables/agent-platform/interruptRegistry'

const isCurrentInterruptToolCard = computed(() => {
    const t = interruptData.value?.type
    return typeof t === 'string' && globalInterruptRegistry.isToolCard(t)
})
```

> 注意：`globalInterruptRegistry` 可能已被本文件的另一个 import 块导入，跳过重复。

- [ ] **修改 Dialog 块（line 269）：**

把：

```vue
<Dialog :open="!!interruptData" @update:open="() => {}">
```

改成：

```vue
<Dialog :open="!!interruptData && !isCurrentInterruptToolCard" @update:open="() => {}">
```

### Step 3: AssistantChatPanel —— 同步改造

- [ ] **修改 `app/components/assistant/AssistantChatPanel.vue` 脚本区追加：**

```ts
import { provide, watch, computed } from 'vue'
import { useInterruptSnapshot } from '~/composables/agent-platform/useInterruptSnapshot'
import { globalInterruptRegistry } from '~/composables/agent-platform/interruptRegistry'

const { resolvedInterrupts, record: recordResolved, clear: clearResolved } = useInterruptSnapshot()

provide('messageStreamContext', {
    interruptData,
    resolvedInterrupts,
    resolveInterrupt,
})

const isCurrentInterruptToolCard = computed(() => {
    const t = interruptData.value?.type
    return typeof t === 'string' && globalInterruptRegistry.isToolCard(t)
})
```

> 适配实际现有 import 块，已经导入的不重复。

- [ ] **找到 session 切换调用处（搜索 `switchSession` / `init` / `currentSessionId` 触发点），在那里调 `clearResolved()`。如果有 watch sessionId，加进去：**

```ts
watch(() => /* 当前 sessionId 来源 */, () => {
    clearResolved()
})
```

> 实施时具体的 sessionId ref 路径以代码现状为准（grep `currentSessionId` 在 AssistantChatPanel）。

- [ ] **修改 `resolveInterrupt`（line 159-166），在 `resumeInterrupt(...)` 之前插入 `recordResolved(interruptData.value, value)`。**

把：

```ts
async function resolveInterrupt(value: unknown) {
    const tcId = (interruptData.value as { toolCallId?: unknown } | null)?.toolCallId
    if (typeof tcId === 'string' && tcId) {
        resumeInterrupt({ [tcId]: value })
    } else {
        resumeInterrupt(value)
    }
}
```

改成：

```ts
async function resolveInterrupt(value: unknown) {
    recordResolved(interruptData.value, value)
    const tcId = (interruptData.value as { toolCallId?: unknown } | null)?.toolCallId
    if (typeof tcId === 'string' && tcId) {
        resumeInterrupt({ [tcId]: value })
    } else {
        resumeInterrupt(value)
    }
}
```

- [ ] **Dialog 块（line 196）：**

把：

```vue
<Dialog :open="!!interruptData" @update:open="() => {}">
```

改成：

```vue
<Dialog :open="!!interruptData && !isCurrentInterruptToolCard" @update:open="() => {}">
```

### Step 4: ContractReviewPanel —— 同步改造

- [ ] **修改 `app/components/assistant/contract/ContractReviewPanel.vue` 脚本区追加：**

```ts
import { provide, watch, computed } from 'vue'
import { useInterruptSnapshot } from '~/composables/agent-platform/useInterruptSnapshot'
import { globalInterruptRegistry } from '~/composables/agent-platform/interruptRegistry'

const { resolvedInterrupts, record: recordResolved, clear: clearResolved } = useInterruptSnapshot()

const interruptData = computed(() => contractAgent.streamChat.interruptData.value)

function resolveInterrupt(value: unknown) {
    recordResolved(interruptData.value, value)
    contractAgent.resumeInterrupt(value)
}

provide('messageStreamContext', {
    interruptData,
    resolvedInterrupts,
    resolveInterrupt,
})

const isCurrentInterruptToolCard = computed(() => {
    const t = interruptData.value?.type
    return typeof t === 'string' && globalInterruptRegistry.isToolCard(t)
})

watch(() => props.reviewId, () => {
    clearResolved()
})
```

> ContractReviewPanel 之前没有独立 `resolveInterrupt` 函数（line 539-540 直接 inline `(v) => contractAgent.resumeInterrupt(v)`）。这次新增 `resolveInterrupt` 来统一 record + resume。具体 `interruptData` 的引用来源以代码现状为准（grep `interruptData` 看是 `streamChat.interruptData` 还是别的）。

- [ ] **修改 Dialog 块（line 523）+ 内部 InterruptDispatcher 调用方式（line 539-540）：**

原 line 537-540 类似：

```vue
<InterruptDispatcher
    :interrupt="interruptData"
    :is-submitting="false"
    @submit="(v) => contractAgent.resumeInterrupt(v)"
    @cancel="() => contractAgent.resumeInterrupt(null)"
/>
```

改成：

```vue
<InterruptDispatcher
    :interrupt="interruptData"
    :is-submitting="false"
    @submit="resolveInterrupt"
    @cancel="() => resolveInterrupt(null)"
/>
```

外层 Dialog（line 523）：

把：

```vue
<Dialog ... :open="..." @update:open="...">
```

改成（具体 `:open` 表达式视实际而定，加上 `&& !isCurrentInterruptToolCard`）：

```vue
<Dialog ... :open="原表达式 && !isCurrentInterruptToolCard" @update:open="...">
```

### Step 5: dev 启动 + 类型检查

- [ ] **启动 dev server 后台：**

```bash
bun dev
```

- [ ] **跑类型检查：**

```bash
bun run typecheck 2>&1 | grep -iE "CaseDetailXiaosuo|AssistantChatPanel|ContractReviewPanel" | head -10
```

预期：无错误（其它预存在错误不在本次范围）。

### Step 6: Commit

- [ ] **commit（3 个 Panel 一起，主题一致）：**

```bash
git add app/components/caseDetail/CaseDetailXiaosuo.vue \
        app/components/assistant/AssistantChatPanel.vue \
        app/components/assistant/contract/ContractReviewPanel.vue
git commit -m "$(cat <<'EOF'
feat(ui): 3 Panel 集成 useInterruptSnapshot + Dialog 条件化

CaseDetailXiaosuo / AssistantChatPanel / ContractReviewPanel 三处：
- 各自调 useInterruptSnapshot()，在 resolveInterrupt 内 record，
  session 切换时 clear
- provide('messageStreamContext', { interruptData, resolvedInterrupts,
  resolveInterrupt })，让 AiToolRenderer 直接 inject
- Dialog 加 !isCurrentInterruptToolCard 条件，仅 isToolCard=false 的
  中断卡走模态；isToolCard=true 走消息流内联

ContractReviewPanel 新增显式 resolveInterrupt 函数包装 record +
resumeInterrupt，统一 3 个 Panel 的协议。
EOF
)"
```

---

## Task 7: 端到端集成验证

**Files:** 无（手动验证 + 全量回归）

### Step 1: 跑全套单测

- [ ] **运行：**

```bash
npx vitest run \
  tests/app/composables/agent-platform/useInterruptSnapshot.test.ts \
  tests/app/components/ai/AiToolRenderer.test.ts \
  tests/app/components/agents/document/interrupts/TemplateSelectCard.test.ts \
  tests/app/components/agents/contract/interrupts/StanceSelectCard.test.ts \
  --reporter=default
```

预期：全部 PASS（含本次扩展的所有用例）。

### Step 2: 端到端冒烟（小索文书）

- [ ] **dev server 已启动（Task 6 Step 5），打开浏览器：**

操作步骤：
1. 进入有材料的案件（如 `/dashboard/cases/1046?focus=xiaosuo`）
2. 在小索说"帮我起草一份起诉状"
3. **预期**：弹出 TemplateSelectCard **不再是模态**（无 backdrop 遮挡），卡片直接出现在消息流里 AI 消息之后，对话上下文可见
4. 选择"民事起诉状"，点"使用此模板"
5. **预期**：卡片冻结成"已选模板：民事起诉状（公民提起民事诉讼用）" 灰色快照，按钮消失，下方继续追加 LLM 流式输出 + DraftDocumentCard 完成态
6. 输入框在 step 3-4 期间应是 disabled，step 5 之后恢复可用

### Step 3: 端到端冒烟（合同审查立场选择）

- [ ] **同 dev server，操作：**

1. 上传一份合同 docx 到法律助手或合同审查页面
2. 触发合同审查，**预期**：StanceSelectCard 内联出现（非模态），可看到对话流上下文
3. 选"甲方"，提交
4. **预期**：卡片冻结快照"已选立场：甲方"，下方继续审查流程

### Step 4: 端到端冒烟（中断卡仍走模态——回归保护）

- [ ] **测试 `case_info_check` 仍走 Dialog：**

1. 新建一个**信息不全的案件**（仅标题，无当事人 / 案由）
2. 触发案件分析或类似流程，应弹出 case_info_check 中断卡
3. **预期**：仍是**模态弹窗**（与改造前一致），有 backdrop 遮挡

> 这一步是关键回归保护——确保 isToolCard=false 的中断卡未受影响。

### Step 5: 完成后立即 kill dev server

- [ ] **手动操作完成后立即 kill：**

```bash
# 找 dev pid
ps aux | grep "nuxi.*dev\|bun dev" | grep -v grep
# kill -9 对应 pid
kill -9 <pid>
```

或者如果用 `Bash run_in_background` 启动：调对应 background task 的 stop。

### Step 6: 总收尾 commit（如果有补充修复）

- [ ] **如果 step 1-4 暴露任何 follow-up 问题（如视觉调优、文案修订），加单独 commit：**

```bash
git add <files>
git commit -m "fix(ui): align interrupt inline visuals (follow-up)"
```

无需补充则跳过。

---

## Self-Review

**1. Spec coverage：**

- §模块 1（useInterruptSnapshot）—— Task 1 全 5 步：已覆盖
- §模块 2（AiToolRenderer 分支）—— Task 5 全 7 步：已覆盖
- §模块 3（messageStreamContext provide / inject）—— Task 5 Step 3 + Task 6 Step 1/3/4：已覆盖
- §模块 4（InterruptDispatcher resumeValue）—— Task 4 全 4 步：已覆盖
- §模块 5（TemplateSelectCard / StanceSelectCard）—— Task 2 / Task 3：已覆盖
- §模块 6（3 个 Panel）—— Task 6 全 6 步：已覆盖
- §视觉 / §边界 / §测试覆盖 / §文件清单：均有任务对应

**2. Placeholder 检查：** 无 TBD / TODO / "类似 Task N" / "添加适当错误处理"等占位符。所有代码块都是完整可执行内容。Task 3 / Task 6 中标注 "实施时以代码现状为准 / 具体行号可能略有不同" 的位置都给了 grep 关键字让实施者定位。

**3. 类型一致性：**

- `ResolvedInterruptEntry` 结构在 Task 1 / Task 5 / Task 6 / spec 完全一致
- `useInterruptSnapshot` 返回类型 `{ resolvedInterrupts, record, clear }` 在 Task 1 定义、Task 6 使用一致
- `messageStreamContext` 三个字段（interruptData / resolvedInterrupts / resolveInterrupt）在 spec / Task 5 / Task 6 一致
- `resumeValue` prop 类型在 InterruptDispatcher / TemplateSelectCard / StanceSelectCard 一致（unknown / 各自 ResolveValue | null）

**4. 已知不确定项：**

- ContractReviewPanel 当前实现可能与 spec 描述行号略有偏差（line 511-540 区域），实施时 grep 关键字定位
- StanceSelectCard 内 `partyA` / `partyB` ref 可能不存在或不叫这个名字，Task 3 Step 4 已注明实施时 grep 验证

---

## Execution Handoff

Plan 已保存到 `docs/superpowers/plans/2026-04-29-interrupt-tool-card-inline.md`。

由于改动跨 8 个源文件 + 4 个测试文件，每个 Task 之间有强依赖（如 Task 5 依赖 Task 1 / Task 4），但 Task 1-4 内部可独立完成。两种执行选项：

**1. Subagent-Driven** —— 每个 Task 派独立子 agent 执行，主线在 Task 间做 review。优势：并行 + 隔离；劣势：每次起 agent 有 overhead。

**2. Inline Execution** —— 在当前 session 顺序执行，每 Task 跑完做 checkpoint。优势：上下文连续；劣势：单线程长。

按 `superpowers:executing-plans` 流程：Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6 → Task 7。
