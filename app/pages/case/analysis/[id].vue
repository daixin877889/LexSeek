<script setup lang="ts">
/**
 * 案件分析主页面
 *
 * 组装所有案件分析组件，实现完整的分析流程：
 * - 材料上传与处理
 * - 案情信息检查（中断点1）
 * - 基本信息确认（中断点2）
 * - 模块选择（中断点3）
 * - 分析任务执行
 * - 结果展示与导出
 *
 * @see Requirements 1.1, 9.1, 9.2, 9.3
 * @see design.md - 案件分析主页面
 */
import type { TaskItem, TaskStatus } from '#shared/types/case'
import type { MessageItem } from '~/components/case/ConversationList.vue'
import type { UploadResult, MaterialItem } from '#shared/types/material'
import type { ExportFormat } from '~/components/case/FloatingActions.vue'
import type { CreateCaseResult } from '~/components/case/DemoCaseList.vue'
import {
    type AnalysisResult,
    SSEMessageType,
    InterruptType,
    WorkflowPhase,
} from '~/composables/useCaseAnalysis'
import { CHECKPOINT_TASKS, INTERRUPT_TASK_MAP } from '#shared/types/case'
import { MaterialType } from '#shared/types/material'
import {
    ArrowLeftIcon,
    SunIcon,
    MoonIcon,
    Loader2Icon,
    SparklesIcon,
    SendIcon,
    PlusIcon,
    XIcon,
    CheckIcon,
    FileTextIcon,
    FileIcon,
    ImageIcon,
    MusicIcon,
} from 'lucide-vue-next'
import { toast } from 'vue-sonner'

// 页面元信息
definePageMeta({
    layout: "dashboard-layout",
    title: '案件分析',
})

// 路由参数
const route = useRoute()
const router = useRouter()
const caseId = computed(() => Number(route.params.id))

// 主题切换
const colorMode = useColorMode()
const isDark = computed(() => colorMode.colorMode.value === 'dark')
const toggleTheme = () => {
    colorMode.setColorMode(isDark.value ? 'light' : 'dark')
}

// 案件分析 composable
const {
    state: analysisState,
    startAnalysis,
    resumeWorkflow,
    stopAnalysis,
} = useCaseAnalysis()

// 组件引用
const splitLayoutRef = ref<InstanceType<typeof import('~/components/case/SplitLayout.vue').default> | null>(null)
const floatingActionsRef = ref<InstanceType<typeof import('~/components/case/FloatingActions.vue').default> | null>(null)

// 案件信息
const caseInfo = ref<{
    id: number
    title: string
    status: string
    sessionId?: string
    caseTypeName?: string
} | null>(null)

// 页面状态
const isLoadingCase = ref(true)
const isSubmittingInterrupt = ref(false)
const showDemoCases = ref(false)

// 任务清单
const tasks = ref<TaskItem[]>([])

// 对话消息列表
const messages = ref<MessageItem[]>([])

// 分析结果
const analysisResults = ref<AnalysisResult[]>([])
const activeResultIndex = ref(0)

// 导出状态
const isExporting = ref(false)
const exportingFormat = ref<ExportFormat | null>(null)

// 初始状态输入区域
const inputText = ref('')
const uploadedMaterials = ref<MaterialItem[]>([])
const fileInputRef = ref<HTMLInputElement | null>(null)
const isSubmitting = ref(false)

// 支持的文件类型
const acceptFileTypes = computed(() => {
    return [
        // 文档
        '.pdf', '.doc', '.docx', '.md', '.txt',
        // 图片
        '.jpg', '.jpeg', '.png', '.gif', '.webp',
        // 音频
        '.mp3', '.wav', '.m4a', '.aac',
    ].join(',')
})

// 所有材料是否就绪
const allMaterialsReady = computed(() => {
    return uploadedMaterials.value.length > 0 &&
        uploadedMaterials.value.every(m => m.status === 'ready' || m.status === 'uploaded')
})

// 是否可以提交
const canSubmit = computed(() => {
    const hasMaterials = uploadedMaterials.value.length > 0 && allMaterialsReady.value
    const hasText = inputText.value.trim().length > 0
    return (hasMaterials || hasText) && !isSubmitting.value
})

// 是否有分析结果
const hasResults = computed(() => analysisResults.value.length > 0)

// 当前中断数据
const currentInterrupt = computed(() => analysisState.value.currentInterrupt)

// 是否显示材料上传器（初始状态或案情补充中断）
const showMaterialUploader = computed(() => {
    // 如果没有案件信息，显示上传器
    if (!caseInfo.value) return true
    // 如果是案情信息检查中断，显示上传器
    if (currentInterrupt.value?.type === InterruptType.CASE_INFO_CHECK) return true
    return false
})

// 是否显示中断确认组件
const showInterruptConfirmation = computed(() => {
    return analysisState.value.isInterrupted && currentInterrupt.value !== null
})

/**
 * 加载案件信息
 */
async function loadCaseInfo() {
    if (!caseId.value || caseId.value === 0) {
        // 新案件，显示示范案例
        isLoadingCase.value = false
        showDemoCases.value = true
        return
    }

    isLoadingCase.value = true

    try {
        const data = await useApiFetch<{
            id: number
            title: string
            status: string
            sessionId?: string
            caseTypeName?: string
        }>(`/api/v1/case/${caseId.value}`)

        if (data) {
            caseInfo.value = data
            // 初始化任务清单
            initializeTasks()
            // 如果有会话，尝试恢复
            if (data.sessionId) {
                await startAnalysis({
                    caseId: caseId.value,
                    sessionId: data.sessionId,
                })
            }
        }
    } catch (error) {
        logger.error('加载案件信息失败:', error)
        toast.error('加载案件信息失败')
    } finally {
        isLoadingCase.value = false
    }
}

/**
 * 初始化任务清单
 */
function initializeTasks() {
    tasks.value = CHECKPOINT_TASKS.map(task => ({
        ...task,
        status: 'pending' as TaskStatus,
    }))
}

/**
 * 处理材料上传完成
 */
async function handleMaterialUploadComplete(result: UploadResult) {
    if (!caseId.value || caseId.value === 0) {
        // 需要先创建案件
        toast.error('请先选择或创建案件')
        return
    }

    // 启动分析流程
    await startAnalysis({
        caseId: caseId.value,
        resumeData: {
            materials: result.materials,
            encrypted: result.encrypted,
        },
    })
}

/**
 * 处理材料上传错误
 */
function handleMaterialUploadError(error: Error) {
    toast.error(error.message || '材料上传失败')
}

/**
 * 处理中断提交
 */
async function handleInterruptSubmit(data: unknown) {
    isSubmittingInterrupt.value = true

    try {
        await resumeWorkflow(data)
    } catch (error) {
        const message = error instanceof Error ? error.message : '提交失败'
        toast.error(message)
    } finally {
        isSubmittingInterrupt.value = false
    }
}

/**
 * 处理中断取消
 */
function handleInterruptCancel() {
    // 取消当前分析
    stopAnalysis()
    toast.info('已取消当前操作')
}

/**
 * 处理任务点击
 */
function handleTaskClick(task: TaskItem) {
    // 如果任务已完成且有结果ID，跳转到结果
    if (task.status === 'completed' && task.resultId !== undefined) {
        const index = analysisResults.value.findIndex(r => r.nodeId === task.resultId)
        if (index >= 0) {
            activeResultIndex.value = index
            // 确保结果区域展开
            splitLayoutRef.value?.expandRightPanel()
        }
    }
}

/**
 * 处理结果导航
 */
function handleNavigateToResult(resultId: number) {
    const index = analysisResults.value.findIndex(r => r.nodeId === resultId)
    if (index >= 0) {
        activeResultIndex.value = index
        splitLayoutRef.value?.expandRightPanel()
    }
}

/**
 * 处理重新生成
 */
async function handleRegenerate(_result: AnalysisResult) {
    // TODO: 实现重新生成逻辑
    toast.info('重新生成功能开发中')
}

/**
 * 处理导出
 */
async function handleExport(format: ExportFormat) {
    if (analysisResults.value.length === 0) {
        toast.warning('暂无分析结果可导出')
        return
    }

    isExporting.value = true
    exportingFormat.value = format

    try {
        // TODO: 实现导出逻辑
        await new Promise(resolve => setTimeout(resolve, 1500))
        toast.success(`导出 ${format.toUpperCase()} 成功`)
        floatingActionsRef.value?.setExportComplete(format)
    } catch (error) {
        toast.error('导出失败')
    } finally {
        isExporting.value = false
        exportingFormat.value = null
    }
}

/**
 * 处理结果导航
 */
function handleResultNavigate(index: number) {
    activeResultIndex.value = index
}

/**
 * 处理示范案例创建成功
 */
function handleDemoCaseCreated(result: CreateCaseResult) {
    // 跳转到新创建的案件
    router.push(`/case/analysis/${result.caseId}`)
}

/**
 * 处理示范案例创建失败
 */
function handleDemoCaseError(error: Error) {
    toast.error(error.message || '创建案件失败')
}

/**
 * 获取材料图标
 */
function getMaterialIcon(type: MaterialType) {
    switch (type) {
        case MaterialType.TEXT:
            return FileTextIcon
        case MaterialType.DOCUMENT:
            return FileIcon
        case MaterialType.IMAGE:
            return ImageIcon
        case MaterialType.AUDIO:
            return MusicIcon
        default:
            return FileIcon
    }
}

/**
 * 检测文件的材料类型
 */
function detectMaterialType(file: File): MaterialType {
    const mimeType = file.type.toLowerCase()
    const ext = file.name.split('.').pop()?.toLowerCase() || ''

    // 图片类型
    if (mimeType.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
        return MaterialType.IMAGE
    }

    // 音频类型
    if (mimeType.startsWith('audio/') || ['mp3', 'wav', 'm4a', 'aac'].includes(ext)) {
        return MaterialType.AUDIO
    }

    // 文档类型
    return MaterialType.DOCUMENT
}

/**
 * 触发文件上传
 */
function triggerFileUpload() {
    fileInputRef.value?.click()
}

/**
 * 处理文件选择
 */
async function handleFileSelect(event: Event) {
    const target = event.target as HTMLInputElement
    const files = target.files

    if (!files || files.length === 0) return

    for (const file of files) {
        // 检查是否已存在
        const exists = uploadedMaterials.value.some(
            m => m.name === file.name && m.size === file.size
        )
        if (exists) continue

        const materialType = detectMaterialType(file)

        const material: MaterialItem = {
            name: file.name,
            type: materialType,
            size: file.size,
            file,
            status: 'ready',
            needServerProcess: true,
            mimeType: file.type || 'application/octet-stream',
        }

        uploadedMaterials.value.push(material)
    }

    // 重置文件输入
    if (target) {
        target.value = ''
    }
}

/**
 * 处理材料点击
 */
function handleMaterialClick(_material: MaterialItem) {
    // TODO: 可以实现预览功能
}

/**
 * 移除材料
 */
function removeMaterial(index: number) {
    uploadedMaterials.value.splice(index, 1)
}

/**
 * 处理提交
 */
async function handleSubmit() {
    if (!canSubmit.value) return

    isSubmitting.value = true

    try {
        // 如果有文本输入，添加为文本材料
        if (inputText.value.trim()) {
            uploadedMaterials.value.push({
                name: `文本材料_${Date.now()}`,
                type: MaterialType.TEXT,
                size: new Blob([inputText.value]).size,
                content: inputText.value,
                status: 'ready',
                needServerProcess: false,
            })
        }

        // 调用材料上传完成处理
        await handleMaterialUploadComplete({
            materials: uploadedMaterials.value,
            encrypted: false,
        })
    } catch (error) {
        const message = error instanceof Error ? error.message : '提交失败'
        toast.error(message)
    } finally {
        isSubmitting.value = false
    }
}

/**
 * 返回上一页
 */
function goBack() {
    router.back()
}

// 监听分析状态变化，更新任务清单
watch(
    () => analysisState.value.currentPhase,
    (phase) => {
        if (!phase) return

        // 根据阶段更新任务状态
        const phaseTaskMap: Record<WorkflowPhase, string> = {
            [WorkflowPhase.MATERIAL_PROCESS]: '',
            [WorkflowPhase.CASE_INFO_CHECK]: 'case-info-check',
            [WorkflowPhase.EXTRACT_INFO]: 'basic-info-confirm',
            [WorkflowPhase.MODULE_SELECT]: 'module-select',
            [WorkflowPhase.ANALYSIS_TASK]: '',
            [WorkflowPhase.COMPLETE]: '',
        }

        const taskId = phaseTaskMap[phase]
        if (taskId) {
            // 将之前的任务标记为完成
            tasks.value.forEach(task => {
                if (task.id !== taskId && task.status === 'active') {
                    task.status = 'completed'
                }
            })
            // 将当前任务标记为进行中
            const currentTask = tasks.value.find(t => t.id === taskId)
            if (currentTask) {
                currentTask.status = 'active'
            }
        }
    }
)

// 监听中断状态，更新任务清单
watch(
    () => analysisState.value.isInterrupted,
    (isInterrupted) => {
        if (isInterrupted && currentInterrupt.value) {
            const taskId = INTERRUPT_TASK_MAP[currentInterrupt.value.type]
            if (taskId) {
                const task = tasks.value.find(t => t.id === taskId)
                if (task) {
                    task.status = 'active'
                }
            }
        }
    }
)

// 监听分析结果变化
watch(
    () => analysisState.value.analysisResults,
    (results) => {
        if (results && results.length > 0) {
            analysisResults.value = results
        }
    },
    { deep: true }
)

// 监听消息变化，转换为 MessageItem 格式
watch(
    () => analysisState.value.messages,
    (sseMessages) => {
        // 将 SSE 消息转换为对话消息
        const newMessages: MessageItem[] = []

        for (const msg of sseMessages) {
            if (msg.type === SSEMessageType.TEXT_COMPLETE) {
                newMessages.push({
                    id: `msg-${msg.timestamp || Date.now()}`,
                    role: 'assistant',
                    content: msg.message,
                    timestamp: msg.timestamp,
                    rawMessage: msg,
                })
            }
        }

        if (newMessages.length > 0) {
            messages.value = newMessages
        }
    },
    { deep: true }
)

// 页面加载时获取案件信息
onMounted(() => {
    loadCaseInfo()
})

// 页面卸载时停止分析
onUnmounted(() => {
    stopAnalysis()
})
</script>

<template>
    <div class="flex flex-col h-screen bg-background">
        <!-- 顶部导航栏 -->
        <header
            class="flex items-center justify-between h-14 px-4 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div class="flex items-center gap-3">
                <!-- 返回按钮 -->
                <Button variant="ghost" size="icon" @click="goBack">
                    <ArrowLeftIcon class="size-5" />
                </Button>

                <!-- 案件标题 -->
                <div class="flex items-center gap-2">
                    <h1 class="text-lg font-semibold truncate max-w-[300px]">
                        {{ caseInfo?.title || '新案件分析' }}
                    </h1>
                    <Badge v-if="caseInfo?.status" variant="secondary" class="text-xs">
                        {{ caseInfo.status }}
                    </Badge>
                </div>
            </div>

            <div class="flex items-center gap-2">


            </div>
        </header>

        <!-- 主内容区域 -->
        <main class="flex-1 overflow-hidden relative">
            <!-- 加载状态 -->
            <div v-if="isLoadingCase" class="flex items-center justify-center h-full">
                <div class="flex flex-col items-center gap-3">
                    <Loader2Icon class="size-8 animate-spin text-primary" />
                    <span class="text-sm text-muted-foreground">加载案件信息...</span>
                </div>
            </div>

            <!-- 初始状态（新案件时显示） -->
            <div v-else-if="showDemoCases && !caseInfo" class="h-full flex flex-col overflow-auto">
                <!-- 欢迎消息区域 -->
                <div class="p-6 pb-4">
                    <!-- 欢迎消息 - 大字体突出显示 -->
                    <div
                        class="w-full inline-flex items-center gap-4 px-5 py-4 bg-gradient-custom dark:bg-gradient-custom-dark rounded-md">
                        <!-- AI 头像 -->
                        <img src="/logo-gradient.svg" alt="小索" class="size-14 shrink-0" />
                        <!-- 欢迎文字 -->
                        <div class="flex flex-col gap-1">
                            <span class="text-xl font-bold">你好，我是小索，你的案件分析助手</span>
                            <span class="text-muted-foreground">在下方输入框输入你的案件信息，我会为你分析案件</span>
                        </div>
                    </div>
                </div>

                <!-- 输入框容器 -->
                <div class="px-6">
                    <div class="border rounded-md bg-background overflow-hidden">
                        <!-- 顶部：标题和文件列表 -->
                        <div class="p-4">
                            <h3 class="font-semibold mb-4">上传案件材料</h3>

                            <!-- 文件卡片列表 -->
                            <div class="flex flex-wrap gap-3 mb-4">
                                <!-- 已上传的文件卡片 -->
                                <div v-for="(material, index) in uploadedMaterials" :key="index"
                                    class="relative group flex items-center gap-2 px-3 py-2 bg-muted/50 rounded-lg border cursor-pointer hover:border-primary/30 transition-colors"
                                    @click="handleMaterialClick(material)">
                                    <!-- 文件图标 -->
                                    <component :is="getMaterialIcon(material.type)"
                                        class="size-4 text-muted-foreground shrink-0" />
                                    <!-- 文件名 -->
                                    <span class="text-sm truncate max-w-[120px]">{{ material.name }}</span>
                                    <!-- 状态指示 -->
                                    <Loader2Icon v-if="material.status === 'processing'"
                                        class="size-3 animate-spin text-primary shrink-0" />
                                    <CheckIcon v-else-if="material.status === 'ready'"
                                        class="size-3 text-green-500 shrink-0" />
                                    <!-- 删除按钮 -->
                                    <button
                                        class="absolute -top-1.5 -right-1.5 size-5 rounded-full bg-destructive text-destructive-foreground opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                                        @click.stop="removeMaterial(index)">
                                        <XIcon class="size-3" />
                                    </button>
                                </div>

                                <!-- 添加文件按钮 - 更大的尺寸 -->
                                <button
                                    class="flex flex-col items-center justify-center w-[68px] h-[68px] border-2 border-dashed rounded-lg text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                                    @click="triggerFileUpload">
                                    <PlusIcon class="size-6" />
                                </button>
                            </div>

                            <!-- 隐藏的文件输入 -->
                            <input ref="fileInputRef" type="file" multiple :accept="acceptFileTypes" class="hidden"
                                @change="handleFileSelect" />
                        </div>

                        <!-- 底部：输入框和提交按钮 -->
                        <div class="flex items-end gap-2 px-4 pb-4">
                            <!-- 输入框 -->
                            <Textarea v-model="inputText" placeholder="支持文本、文档、音频、图片 四种材料类型。"
                                class="flex-1 min-h-[44px] max-h-[120px] resize-none border-0 focus-visible:ring-0 p-0 shadow-none bg-transparent"
                                @keydown.enter.exact.prevent="handleSubmit" />
                            <!-- 提交按钮 -->
                            <Button :disabled="!canSubmit" :loading="isSubmitting" @click="handleSubmit"
                                class="shrink-0">
                                <SendIcon class="size-4 mr-1.5" />
                                法索一下
                            </Button>
                        </div>
                    </div>
                </div>

                <!-- 示范案例区域 -->
                <div v-if="uploadedMaterials.length === 0 && !inputText.trim()" class="px-6 py-4">
                    <div class="flex items-center gap-2 mb-4">
                        <SparklesIcon class="size-4 text-amber-500" />
                        <span class="text-sm text-muted-foreground">或者你可以点击下方案例体验分析流程</span>
                    </div>

                    <!-- 示范案例卡片 -->
                    <CaseDemoCaseList :show-title="false" :show-cover="false" :columns="2" layout="grid"
                        @case-created="handleDemoCaseCreated" @case-error="handleDemoCaseError" />
                </div>
            </div>

            <!-- 分析页面主体 -->
            <CaseSplitLayout v-else ref="splitLayoutRef" :has-results="hasResults" class="h-full">
                <!-- 左侧：工作流对话区域 -->
                <template #conversation>
                    <div class="flex flex-col h-full">
                        <!-- 任务清单（可折叠） -->
                        <Collapsible class="border-b">
                            <CollapsibleTrigger
                                class="flex items-center justify-between w-full px-4 py-3 hover:bg-muted/50 transition-colors">
                                <span class="text-sm font-medium">分析进度</span>
                                <Badge variant="outline" class="text-xs">
                                    {{tasks.filter(t => t.status === 'completed').length}}/{{ tasks.length }}
                                </Badge>
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                                <div class="px-4 pb-4">
                                    <CaseTaskList :tasks="tasks" :show-title="false" :show-progress="true"
                                        max-height="200px" @task-click="handleTaskClick"
                                        @navigate-to-result="handleNavigateToResult" />
                                </div>
                            </CollapsibleContent>
                        </Collapsible>

                        <!-- 对话消息列表 -->
                        <div class="flex-1 overflow-hidden">
                            <CaseConversationList :messages="messages" :streaming-text="analysisState.streamingText"
                                :reasoning-text="analysisState.reasoningText" :is-loading="analysisState.isLoading"
                                empty-title="开始案件分析" empty-description="上传案件材料后，AI 将帮助您分析案件" class="h-full" />
                        </div>

                        <!-- 底部交互区域 -->
                        <div class="border-t p-4">
                            <!-- 中断确认组件 -->
                            <CaseInterruptConfirmation v-if="showInterruptConfirmation" :interrupt="currentInterrupt"
                                :is-submitting="isSubmittingInterrupt" @submit="handleInterruptSubmit"
                                @cancel="handleInterruptCancel" />

                            <!-- 材料上传器（案情补充时显示） -->
                            <CaseMaterialUploader v-else-if="showMaterialUploader && caseInfo" ref="materialUploaderRef"
                                :enable-encryption="true" :show-text-input="true"
                                @upload-complete="handleMaterialUploadComplete"
                                @upload-error="handleMaterialUploadError" />

                            <!-- 分析完成提示 -->
                            <div v-else-if="analysisState.isComplete" class="text-center py-4">
                                <p class="text-sm text-muted-foreground">分析已完成，查看右侧结果</p>
                            </div>

                            <!-- 加载状态 -->
                            <div v-else-if="analysisState.isLoading" class="flex items-center justify-center py-4">
                                <Loader2Icon class="size-5 animate-spin text-primary mr-2" />
                                <span class="text-sm text-muted-foreground">AI 正在分析中...</span>
                            </div>
                        </div>
                    </div>
                </template>

                <!-- 右侧：分析结果区域 -->
                <template #results>
                    <CaseAnalysisResults :results="analysisResults" v-model:active-index="activeResultIndex"
                        :show-regenerate="true" :show-copy="true" class="h-full" @regenerate="handleRegenerate" />
                </template>
            </CaseSplitLayout>
        </main>

        <!-- 浮动操作按钮 -->
        <CaseFloatingActions ref="floatingActionsRef" :results="analysisResults" :active-index="activeResultIndex"
            :visible="hasResults" :is-exporting="isExporting" :exporting-format="exportingFormat" @export="handleExport"
            @navigate="handleResultNavigate" @update:active-index="activeResultIndex = $event" />
    </div>
</template>
