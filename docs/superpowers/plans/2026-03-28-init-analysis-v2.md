# 初始化分析工作流切换 + UI 重构 实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 init-analysis 从旧的 initAnalysis.executor 切换到 caseAnalysisV2 工作流，并将前端改为 AiChat 双面板布局。

**Architecture:** 后端：修改 caseAnalysisV2.workflow.ts 添加模块追踪 state 字段，新建 executor 封装函数，Worker 路由切换。前端：init-analysis 页面改为 AiChat 双面板（左消息流 + 右案件信息/分析结果），useInitAnalysis composable 小幅适配，新增 CaseInfoCard 组件。

**Tech Stack:** Nuxt 4, Vue 3, TypeScript, LangGraph, @langchain/vue

**Spec:** `docs/superpowers/specs/2026-03-28-init-analysis-v2-design.md`

**并行关系:** Task 1-2 是后端改动，必须顺序执行。Task 3 是前端新组件，可与 Task 1-2 并行。Task 4-5 依赖 Task 1-2 完成。Task 6 最后执行。

---

## 文件结构

### 修改

| 文件 | 职责 |
|------|------|
| `server/services/workflow/caseAnalysisV2.workflow.ts` | WorkflowState 添加追踪字段，createAnalysisNode 返回值更新 |
| `server/services/agent/agentWorker.ts` | session.type===2 路由改为调用 v2 executor |
| `server/api/v1/case/init-analysis.post.ts` | resume 分支去除 completedResults |
| `app/pages/dashboard/cases/init-analysis/[sessionId].vue` | 重写为 AiChat 双面板 |
| `app/composables/useInitAnalysis.ts` | 添加 currentStreamingModule computed，导出 streamMessages |

### 新增

| 文件 | 职责 |
|------|------|
| `server/services/workflow/caseAnalysisV2.executor.ts` | 封装 getCaseAnalysisWorkflow 调用，返回 SSE stream |
| `app/components/initAnalysis/CaseInfoCard.vue` | 案件基本信息 + 材料列表卡片 |

---

## Task 1: caseAnalysisV2.workflow.ts 添加模块追踪字段

**Files:**
- Modify: `server/services/workflow/caseAnalysisV2.workflow.ts`

- [ ] **Step 1: WorkflowState 添加追踪字段**

在 `WorkflowState` 的 `llmCalls` 后添加：

```typescript
/** 各模块分析结果（merge reducer：合并到同一对象） */
result: new ReducedValue(
    z.record(z.string(), z.string()).default({}),
    { reducer: (a, b) => ({ ...a, ...b }) }
),
/** 当前正在执行的模块名 */
lastExecutedModule: z.string().default(''),
/** 最近执行的模块结果 */
lastExecutedResult: z.string().default(''),
/** 最近执行的模块标题 */
lastExecutedTitle: z.string().default(''),
/** 失败的模块信息 */
failedModules: new ReducedValue(
    z.record(z.string(), z.string()).default({}),
    { reducer: (a, b) => ({ ...a, ...b }) }
),
```

- [ ] **Step 2: 重写 createAnalysisNode 函数**

将 `createAnalysisNode` 的第二个参数从 `defaultPrompt` 改为 `moduleTitle`。成功时提取 resultText 并返回追踪字段，失败时返回 failedModules：

```typescript
function createAnalysisNode(agentName: string, moduleTitle: string): GraphNode<typeof WorkflowState> {
    return async (state) => {
        const node = await caseAnalysisAgent(agentName, {
            sessionId: state.sessionId,
            prompt: state.prompt ?? undefined,
            userId: state.userId,
            caseId: state.caseId,
        })

        const messages = state.messages.length > 0
            ? state.messages
            : [new HumanMessage(state.prompt ?? moduleTitle)]

        try {
            // 传入 per-module thread_id 确保每个模块 Agent 使用独立的 checkpoint 线程
            // caseAnalysisAgent 返回的 ReactAgent 内部使用 checkpointer，需要唯一 thread_id 隔离模块状态
            // 与旧 initAnalysis.executor.ts 第 159-168 行行为一致
            const response = await node.invoke(
                { messages },
                { configurable: { thread_id: `${state.sessionId}_${agentName}` } }
            )

            // 从最后一条消息提取 resultText
            const lastMsg = response.messages?.[response.messages.length - 1]
            let resultText = ''
            if (lastMsg) {
                const content = lastMsg.content
                if (typeof content === 'string') {
                    resultText = content
                } else if (Array.isArray(content)) {
                    resultText = content
                        .filter((c: any) => c.type === 'text')
                        .map((c: any) => c.text)
                        .join('\n')
                }
            }

            return {
                messages: response.messages,
                result: { [agentName]: resultText },
                lastExecutedModule: agentName,
                lastExecutedResult: resultText,
                lastExecutedTitle: moduleTitle,
            }
        } catch (error: any) {
            // 标记 IN_PROGRESS 记录为失败
            try {
                const nodeInfo = await getNodeByNameService(agentName)
                if (nodeInfo) {
                    const record = await findAnalysisBySessionAndNodeDao(
                        state.sessionId, nodeInfo.id, AnalysisStatus.IN_PROGRESS
                    )
                    if (record) await markAnalysisFailedById(record.id)
                }
            } catch (cleanupError) {
                logger.error('标记分析失败异常', { agentName, cleanupError })
            }

            logger.error(`分析模块 ${agentName} 执行失败`, {
                sessionId: state.sessionId,
                error: error.message,
            })

            return {
                messages: [],
                failedModules: { [agentName]: error.message },
                lastExecutedModule: agentName,
                lastExecutedResult: '',
                lastExecutedTitle: moduleTitle,
            }
        }
    }
}
```

- [ ] **Step 3: 更新 graph.addNode 调用的参数**

第 135 行 `module.title || module.name` 保持不变（已与新签名兼容）。

- [ ] **Step 4: Commit**

```bash
git add server/services/workflow/caseAnalysisV2.workflow.ts
git commit -m "feat(workflow): caseAnalysisV2 添加模块追踪字段和 resultText 提取"
```

---

## Task 2: 新建 executor + Worker 路由切换

**Files:**
- Create: `server/services/workflow/caseAnalysisV2.executor.ts`
- Modify: `server/services/agent/agentWorker.ts`
- Modify: `server/api/v1/case/init-analysis.post.ts`

- [ ] **Step 1: 创建 caseAnalysisV2.executor.ts**

```typescript
/**
 * caseAnalysisV2 工作流执行器
 *
 * 封装 getCaseAnalysisWorkflow() 调用，返回 SSE ReadableStream
 * 与 initAnalysis.executor 的 startInitAnalysis 接口兼容
 */

import { getCaseAnalysisWorkflow } from './caseAnalysisV2.workflow'

export interface CaseAnalysisV2Params {
    caseId: number
    sessionId: string
    userId: number
    selectedModules: string[]
    command?: unknown
}

export async function startCaseAnalysisV2(params: CaseAnalysisV2Params): Promise<ReadableStream> {
    const workflow = await getCaseAnalysisWorkflow()

    const streamConfig = {
        configurable: { thread_id: params.sessionId },
        streamMode: ['values', 'messages', 'updates'] as const,
        version: 'v2' as const,
        subgraphs: true,
        encoding: 'text/event-stream' as const,
    }

    if (params.command) {
        const { Command } = await import('@langchain/langgraph')
        return workflow.stream(
            new Command({ resume: params.command }),
            streamConfig,
        )
    }

    return workflow.stream(
        {
            userId: params.userId,
            caseId: params.caseId,
            sessionId: params.sessionId,
            selectedModules: params.selectedModules,
        },
        streamConfig,
    )
}
```

- [ ] **Step 2: 修改 agentWorker.ts 路由**

将 `agentWorker.ts` 第 142-152 行的 `session?.type === 2` 分支改为：

```typescript
if (session?.type === 2) {
    // 初始化分析：caseAnalysisV2 工作流
    const { startCaseAnalysisV2 } = await import('../workflow/caseAnalysisV2.executor')
    stream = await startCaseAnalysisV2({
        sessionId: run.sessionId,
        userId: run.userId,
        caseId: run.caseId,
        selectedModules: input.selectedModules ?? [],
        command: input.command,
    })
}
```

- [ ] **Step 3: init-analysis.post.ts 去除 completedResults**

清理以下 3 处 `completedResults` 引用：
1. resume 分支：`loadCompletedResultsService` 调用和 enqueueRunService 中的 `completedResults` 参数
2. 新建 session 分支：同样的 `loadCompletedResultsService` 调用和 `completedResults` 参数
3. `loadCompletedResultsService` 的 import 语句

同时清理 `agentWorker.ts` 第 134 行 input 类型声明中的 `completedResults` 字段。

- [ ] **Step 4: Commit**

```bash
git add server/services/workflow/caseAnalysisV2.executor.ts server/services/agent/agentWorker.ts server/api/v1/case/init-analysis.post.ts
git commit -m "feat(workflow): 切换 init-analysis Worker 到 caseAnalysisV2 工作流"
```

---

## Task 3: 新增 CaseInfoCard 组件

**Files:**
- Create: `app/components/initAnalysis/CaseInfoCard.vue`

- [ ] **Step 1: 创建组件**

```vue
<template>
  <div class="space-y-4 p-4">
    <!-- 案件基本信息 -->
    <div v-if="caseInfo" class="space-y-3">
      <h3 class="text-sm font-medium text-muted-foreground">案件信息</h3>
      <div class="space-y-2 text-sm">
        <div class="flex gap-2">
          <span class="shrink-0 text-muted-foreground">标题</span>
          <span class="font-medium">{{ caseInfo.title }}</span>
        </div>
        <div v-if="caseInfo.caseType" class="flex gap-2">
          <span class="shrink-0 text-muted-foreground">类型</span>
          <Badge variant="secondary">{{ caseInfo.caseType.name }}</Badge>
        </div>
        <div v-if="plaintiffText" class="flex gap-2">
          <span class="shrink-0 text-muted-foreground">原告</span>
          <span>{{ plaintiffText }}</span>
        </div>
        <div v-if="defendantText" class="flex gap-2">
          <span class="shrink-0 text-muted-foreground">被告</span>
          <span>{{ defendantText }}</span>
        </div>
      </div>
    </div>

    <!-- 材料列表 -->
    <div v-if="materials.length > 0" class="space-y-3">
      <h3 class="text-sm font-medium text-muted-foreground">案件材料 ({{ materials.length }})</h3>
      <div class="space-y-1.5">
        <div v-for="m in materials" :key="m.id"
          class="flex items-center gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer hover:bg-muted/50 transition-colors"
          @click="openPreview(m)">
          <component :is="getFileIcon(m.fileType)" :class="['size-4 shrink-0', getFileIconColor(m.fileType)]" />
          <span class="flex-1 truncate">{{ m.name }}</span>
        </div>
      </div>
    </div>

    <!-- 文档预览弹框 -->
    <CaseAnalysisDocPreviewDialog v-if="previewFile && !isAudioFile(previewFile.name)"
      v-model:open="previewDialogOpen" :oss-file-id="previewFile.ossFileId" :file-name="previewFile.name"
      :file-type="previewFile.fileType" :encrypted="false" />

    <!-- 音频预览弹框 -->
    <CaseAnalysisAudioPreviewDialog v-if="previewFile && isAudioFile(previewFile.name)"
      v-model:open="audioPreviewDialogOpen" :oss-file-id="previewFile.ossFileId" :file-name="previewFile.name"
      :encrypted="false" />
  </div>
</template>

<script lang="ts" setup>
import { getFileIcon, getFileIconColor } from '~/utils/file'
import { isAudioFile } from '~~/shared/utils/fileType'

const props = defineProps<{
  caseId: number
}>()

interface CaseInfoData {
  title: string
  caseType?: { name: string }
  plaintiff?: Array<{ name: string }>
  defendant?: Array<{ name: string }>
  materials: Array<{ id: number; name: string; fileType: string; ossFileId: number }>
}

const caseInfo = ref<CaseInfoData | null>(null)
const materials = computed(() => caseInfo.value?.materials ?? [])

const plaintiffText = computed(() =>
  caseInfo.value?.plaintiff?.map(p => p.name).join('、') ?? ''
)
const defendantText = computed(() =>
  caseInfo.value?.defendant?.map(d => d.name).join('、') ?? ''
)

// 预览
const previewDialogOpen = ref(false)
const audioPreviewDialogOpen = ref(false)
const previewFile = ref<{ ossFileId: number; name: string; fileType: string } | null>(null)

function openPreview(m: { id: number; name: string; fileType: string; ossFileId: number }) {
  previewFile.value = m
  if (isAudioFile(m.name)) {
    audioPreviewDialogOpen.value = true
  } else {
    previewDialogOpen.value = true
  }
}

// 加载案件信息
async function loadCaseInfo() {
  const data = await useApiFetch<CaseInfoData>(`/api/v1/case/${props.caseId}`)
  if (data) caseInfo.value = data
}

watch(() => props.caseId, (id) => {
  if (id > 0) loadCaseInfo()
}, { immediate: true })
</script>
```

- [ ] **Step 2: Commit**

```bash
git add app/components/initAnalysis/CaseInfoCard.vue
git commit -m "feat(ui): 新增 CaseInfoCard 案件信息卡片组件"
```

---

## Task 4: useInitAnalysis composable 适配

**Files:**
- Modify: `app/composables/useInitAnalysis.ts`

- [ ] **Step 1: 添加 currentStreamingModule computed**

在 `watch(values)` 之后添加：

```typescript
// 推断当前正在执行的模块（selectedModules 中第一个未完成的）
const currentStreamingModule = computed(() => {
  if (phase.value !== 'running') return null
  const v = values.value
  return selectedModules.value.find(m =>
    !v?.result?.[m] && !v?.failedModules?.[m]
  ) ?? null
})
```

- [ ] **Step 2: 在 watch(values) 中用 currentStreamingModule 替代旧的 streaming 检测**

将第 87-94 行的 `lastExecutedModule` streaming 逻辑改为：

```typescript
// 当前执行中的模块（基于 selectedModules 顺序推断）
const streaming = currentStreamingModule.value
if (streaming && !updated[streaming]?.content) {
  updated[streaming] = {
    ...updated[streaming],
    name: streaming,
    status: 'streaming',
    content: '',
  }
}
```

- [ ] **Step 3: 导出 stream.messages 供页面使用**

在 return 中添加：

```typescript
streamMessages: computed(() => stream.messages),
```

- [ ] **Step 4: 导出 currentStreamingModule**

```typescript
return {
  // ...existing exports
  currentStreamingModule,
  streamMessages: computed(() => stream.messages),
}
```

- [ ] **Step 5: Commit**

```bash
git add app/composables/useInitAnalysis.ts
git commit -m "refactor(composable): useInitAnalysis 适配 caseAnalysisV2 state，添加 streaming 推断"
```

---

## Task 5: init-analysis 页面重写为 AiChat 双面板

**Files:**
- Modify: `app/pages/dashboard/cases/init-analysis/[sessionId].vue`

- [ ] **Step 1: 重写页面模板**

```vue
<template>
  <AiChat
    title="初始化分析"
    :messages="streamMessages"
    :loading="isLoading"
    :show-prompt="false"
    :show-task-queue="false"
    class="h-full"
    @back="goBack"
  >
    <template #message-list>
      <!-- 固定状态栏 -->
      <InitAnalysisPipelineProgress
        v-if="phase !== 'select'"
        :modules="activeModules"
        :module-states="moduleStates"
        class="sticky top-0 z-10 bg-background border-b"
      />

      <!-- 阶段一：模块选择 -->
      <div v-if="phase === 'select'" class="p-4">
        <InitAnalysisModuleSelector
          v-model="selectedModules"
          @start="startAnalysis"
          @skip="navigateTo(`/dashboard/cases/${caseId}`)"
        />
      </div>

      <!-- 阶段二/三：分析进度 -->
      <template v-else>
        <div class="flex-1 min-h-0 overflow-y-auto px-4 py-6 space-y-6">
          <!-- 积分不足中断卡片 -->
          <InitAnalysisInsufficientPointsCard
            v-if="interruptData"
            :is-member="interruptData.data?.isMember ?? false"
            :available-points="interruptData.data?.availablePoints"
            :required-points="interruptData.data?.requiredPoints"
            :reason="interruptData.data?.reason"
            @resume="resumeWorkflow"
          />

          <!-- 按模块分组渲染 -->
          <template v-for="mod in activeModules" :key="mod.name">
            <InitAnalysisModuleResult
              :module="mod"
              :state="getModuleState(mod.name)"
              :messages="getModuleMessages(mod.name)"
              @retry="retryModule"
            />
          </template>

          <!-- 完成后操作 -->
          <div v-if="phase === 'complete'" class="flex justify-center py-8">
            <Button size="lg" @click="navigateTo(`/dashboard/cases/${caseId}`)">
              进入案件详情
            </Button>
          </div>
        </div>
      </template>
    </template>

    <template #right-panel>
      <!-- 案件信息卡片 -->
      <InitAnalysisCaseInfoCard v-if="caseId > 0" :case-id="caseId" />

      <!-- 分析结果（从 values.result 实时获取） -->
      <div v-if="completedResults.length > 0" class="p-4 space-y-3">
        <h3 class="text-sm font-medium text-muted-foreground">分析结果</h3>
        <CaseAnalysisResults
          :results="completedResults"
        />
      </div>
    </template>
  </AiChat>
</template>
```

- [ ] **Step 2: 重写页面脚本**

```typescript
<script lang="ts" setup>
import type { AnalysisResult } from '#shared/types/case'

definePageMeta({
  title: "初始化分析",
  layout: "dashboard-layout",
})

const route = useRoute()
const router = useRouter()
const sessionId = computed(() => route.params.sessionId as string)

const {
  phase,
  caseId,
  selectedModules,
  moduleStates,
  activeModules,
  isLoading,
  interrupt,
  values,
  streamMessages,
  getModuleState,
  getModuleMessages,
  loadStatus,
  startAnalysis,
  resumeWorkflow,
  retryModule,
} = useInitAnalysis(sessionId)

// 从 values.result 转换为 AnalysisResult[] 供右侧面板显示
const completedResults = computed<AnalysisResult[]>(() => {
  const result = values.value?.result
  if (!result) return []
  return Object.entries(result)
    .filter(([_, content]) => !!content)
    .map(([moduleName, content]) => {
      const mod = activeModules.value.find(m => m.name === moduleName)
      return {
        nodeId: 0,
        moduleName,
        moduleTitle: mod?.title ?? moduleName,
        content: content as string,
        analyzedAt: new Date().toISOString(),
      }
    })
})

// LangGraph interrupt 数据
const interruptData = computed(() => {
  const raw = interrupt.value
  if (!raw) return null
  const first = Array.isArray(raw) ? raw[0] : raw
  const val = first?.value ?? first
  if (val?.type === "insufficient_points") return val
  return null
})

const goBack = () => {
  router.push({ name: "dashboard-cases" })
}

onMounted(() => {
  loadStatus()
})
</script>
```

注意：Task 4 Step 3 已将 `values` 添加到 composable 的 return 中，页面脚本可直接解构使用。

- [ ] **Step 3: 在 useInitAnalysis 中导出 values**

在 `useInitAnalysis.ts` 的 return 中确认 `values` 已导出（当前第 56 行已定义 `const values = computed(...)` 但未在 return 中导出）。

在 return 中添加 `values`。

- [ ] **Step 4: 验证页面**

Run: `bun dev`，访问 `/dashboard/cases/init-analysis/[sessionId]`，验证：
1. 模块选择阶段正常显示
2. 右侧面板显示案件信息
3. 分析进度正常（状态栏 + 模块结果）

- [ ] **Step 5: Commit**

```bash
git add app/pages/dashboard/cases/init-analysis/[sessionId].vue app/composables/useInitAnalysis.ts
git commit -m "feat(cases): init-analysis 页面改为 AiChat 双面板布局"
```

---

## Task 6: 端到端验证

- [ ] **Step 1: 类型检查**

```bash
npx nuxi typecheck
```

- [ ] **Step 2: 完整流程测试**

| 场景 | 预期 |
|------|------|
| 进入 init-analysis 页面 | 显示模块选择器 + 右侧案件信息 |
| 选择模块并开始分析 | 状态栏固定在顶部，左侧显示模块分析过程 |
| 模块完成 | 右侧实时追加分析结果 |
| 模块失败 | 状态栏显示失败，可重试 |
| 页面刷新重连 | 恢复已完成的模块状态 |
| 全部完成 | 显示"进入案件详情"按钮 |

- [ ] **Step 3: 修复问题并提交**

```bash
git add -A
git commit -m "fix(cases): 修复 init-analysis 工作流切换端到端测试发现的问题"
```
