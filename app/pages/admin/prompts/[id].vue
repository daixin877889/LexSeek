<template>
        <div class="space-y-6">
            <!-- 页面标题和操作 -->
            <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div class="flex items-center gap-4">
                    <Button variant="ghost" size="icon" @click="navigateTo('/admin/prompts')">
                        <ArrowLeft class="h-4 w-4" />
                    </Button>
                    <div>
                        <h1 class="text-2xl md:text-3xl font-bold mb-1">提示词详情</h1>
                        <p class="text-muted-foreground text-sm">查看和编辑提示词配置</p>
                    </div>
                </div>
                <div class="flex gap-2">
                    <Button v-if="prompt?.status !== 1" variant="outline" @click="handleActivate" :disabled="loading">
                        <CheckCircle class="h-4 w-4 mr-2" />
                        激活此版本
                    </Button>
                    <Button variant="outline" @click="versionDialogRef?.open(promptId)">
                        <History class="h-4 w-4 mr-2" />
                        版本历史
                    </Button>
                    <Button variant="destructive" @click="deleteDialogOpen = true" :disabled="loading">
                        <Trash2 class="h-4 w-4 mr-2" />
                        删除
                    </Button>
                </div>
            </div>

            <!-- 加载状态 -->
            <div v-if="loading" class="flex justify-center py-12">
                <Loader2 class="h-10 w-10 animate-spin text-muted-foreground" />
            </div>

            <!-- 提示词不存在 -->
            <div v-else-if="!prompt" class="flex flex-col items-center justify-center py-12 text-center">
                <AlertCircle class="h-12 w-12 text-muted-foreground/50 mb-4" />
                <h3 class="text-lg font-medium mb-1">提示词不存在</h3>
                <p class="text-muted-foreground text-sm mb-4">该提示词可能已被删除</p>
                <Button @click="navigateTo('/admin/prompts')">返回列表</Button>
            </div>

            <!-- 提示词详情 -->
            <template v-else>
                <!-- 基本信息卡片 -->
                <Card>
                    <CardHeader>
                        <div class="flex items-center justify-between">
                            <CardTitle>基本信息</CardTitle>
                            <Badge :variant="prompt.status === 1 ? 'default' : 'secondary'">
                                {{ prompt.status === 1 ? '生效中' : '未生效' }}
                            </Badge>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div class="space-y-1">
                                <Label class="text-muted-foreground">提示词名称</Label>
                                <p class="font-mono">{{ prompt.name }}</p>
                            </div>
                            <div class="space-y-1">
                                <Label class="text-muted-foreground">提示词标题</Label>
                                <p>{{ prompt.title || '-' }}</p>
                            </div>
                            <div class="space-y-1">
                                <Label class="text-muted-foreground">提示词类型</Label>
                                <Badge :variant="getTypeVariant(prompt.type)">
                                    {{ getTypeLabel(prompt.type) }}
                                </Badge>
                            </div>
                            <div class="space-y-1">
                                <Label class="text-muted-foreground">版本号</Label>
                                <p class="font-mono">{{ prompt.version }}</p>
                            </div>
                            <div class="space-y-1">
                                <Label class="text-muted-foreground">关联节点</Label>
                                <NuxtLink v-if="prompt.node" :to="`/admin/nodes/${prompt.nodeId}`"
                                    class="text-primary hover:underline">
                                    {{ prompt.node.title || prompt.node.name }}
                                </NuxtLink>
                                <p v-else>-</p>
                            </div>
                            <div class="space-y-1">
                                <Label class="text-muted-foreground">更新时间</Label>
                                <p>{{ formatDate(prompt.updatedAt) }}</p>
                            </div>
                            <div class="col-span-full space-y-1">
                                <Label class="text-muted-foreground">变量列表</Label>
                                <div v-if="promptVariables.length" class="flex flex-wrap gap-2">
                                    <Badge v-for="(v, index) in promptVariables" :key="index" variant="outline">
                                        {{ formatVariable(v) }}
                                    </Badge>
                                </div>
                                <p v-else class="text-muted-foreground">暂无变量</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <!-- 提示词内容卡片 -->
                <Card>
                    <CardHeader>
                        <div class="flex items-center justify-between">
                            <CardTitle>提示词内容</CardTitle>
                            <Button variant="outline" size="sm" @click="formDialogRef?.openEdit(prompt)">
                                <Pencil class="h-4 w-4 mr-2" />
                                编辑内容
                            </Button>
                        </div>
                        <CardDescription>编辑内容将创建新版本，不会覆盖当前版本</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div class="rounded-md border bg-muted/50 p-4">
                            <pre class="whitespace-pre-wrap text-sm font-mono">{{ prompt.content }}</pre>
                        </div>
                    </CardContent>
                </Card>

                <!-- 预览渲染卡片 -->
                <Card>
                    <CardHeader>
                        <CardTitle>预览渲染</CardTitle>
                        <CardDescription>输入测试变量值，预览渲染后的提示词内容</CardDescription>
                    </CardHeader>
                    <CardContent class="space-y-4">
                        <!-- 变量输入 -->
                        <div v-if="promptVariables.length" class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div v-for="v in promptVariables" :key="v" class="space-y-2">
                                <Label>{{ formatVariable(v) }}</Label>
                                <Textarea v-model="previewVariables[v]" :placeholder="getPlaceholder(v)" rows="2" />
                            </div>
                        </div>
                        <div v-else class="text-muted-foreground text-sm">
                            该提示词没有变量，无需预览渲染
                        </div>

                        <!-- 预览按钮 -->
                        <div v-if="promptVariables.length" class="flex gap-2">
                            <Button @click="handlePreview" :disabled="previewing">
                                <Loader2 v-if="previewing" class="h-4 w-4 mr-2 animate-spin" />
                                <Eye v-else class="h-4 w-4 mr-2" />
                                预览渲染
                            </Button>
                            <Button variant="outline" @click="clearPreview">
                                清空
                            </Button>
                        </div>

                        <!-- 预览结果 -->
                        <div v-if="previewResult" class="space-y-2">
                            <Label class="text-muted-foreground">渲染结果</Label>
                            <div class="rounded-md border bg-background p-4">
                                <pre class="whitespace-pre-wrap text-sm font-mono">{{ previewResult }}</pre>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </template>
        </div>

        <!-- 编辑对话框 -->
        <AdminPromptsPromptFormDialog ref="formDialogRef" @success="loadPrompt" />

        <!-- 版本历史对话框 -->
        <AdminPromptsVersionHistoryDialog ref="versionDialogRef" @activate="handleActivateVersion" />

        <!-- 删除确认对话框 -->
        <AlertDialog v-model:open="deleteDialogOpen">
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>确认删除</AlertDialogTitle>
                    <AlertDialogDescription>
                        确定要删除提示词「{{ prompt?.title || prompt?.name }}」吗？此操作不可撤销。
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>取消</AlertDialogCancel>
                    <AlertDialogAction @click="confirmDelete" :disabled="deleting">
                        <Loader2 v-if="deleting" class="h-4 w-4 mr-2 animate-spin" />
                        确认删除
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
</template>

<script setup lang="ts">
import { ArrowLeft, Loader2, AlertCircle, Pencil, Trash2, History, CheckCircle, Eye } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import dayjs from 'dayjs'
import type { PromptWithRelations } from '#shared/types/node'

definePageMeta({ layout: 'admin-layout', title: '提示词详情' })

const route = useRoute()
const promptId = computed(() => Number(route.params.id))

// 组件引用
const formDialogRef = ref<InstanceType<typeof import('~/components/admin/prompts/PromptFormDialog.vue').default> | null>(null)
const versionDialogRef = ref<InstanceType<typeof import('~/components/admin/prompts/VersionHistoryDialog.vue').default> | null>(null)

// 状态
const loading = ref(false)
const deleting = ref(false)
const previewing = ref(false)
const prompt = ref<PromptWithRelations | null>(null)
const deleteDialogOpen = ref(false)
const previewVariables = ref<Record<string, string>>({})
const previewResult = ref('')

// 计算属性：变量列表
const promptVariables = computed(() => {
    if (!prompt.value?.variables || !Array.isArray(prompt.value.variables)) return []
    return prompt.value.variables.filter((v): v is string => typeof v === 'string')
})

// 格式化日期
const formatDate = (date: string | Date | null | undefined) => {
    if (!date) return '-'
    return dayjs(date).format('YYYY-MM-DD HH:mm')
}

// 格式化变量显示
const formatVariable = (v: string) => {
    return `\{\{${v}\}\}`
}

// 获取变量输入框的占位符
const getPlaceholder = (v: string) => {
    return `输入 ${v} 的值`
}

// 提示词类型标签
const getTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
        system: '系统提示词',
        user: '用户提示词',
        assistant: '助手提示词',
    }
    return labels[type] || type
}

// 提示词类型样式
const getTypeVariant = (type: string) => {
    const variants: Record<string, 'default' | 'secondary' | 'outline'> = {
        system: 'default',
        user: 'secondary',
        assistant: 'outline',
    }
    return variants[type] || 'default'
}

// 加载提示词详情
const loadPrompt = async () => {
    loading.value = true
    try {
        const data = await useApiFetch<PromptWithRelations>(`/api/v1/admin/prompts/${promptId.value}`)
        if (data) {
            prompt.value = data
            // 初始化预览变量
            previewVariables.value = {}
            promptVariables.value.forEach(v => {
                previewVariables.value[v] = ''
            })
        }
    } finally {
        loading.value = false
    }
}

// 激活提示词
const handleActivate = async () => {
    if (!prompt.value) return
    const result = await useApiFetch(`/api/v1/admin/prompts/activate/${prompt.value.id}`, { method: 'PUT' })
    if (result !== null) {
        toast.success('激活成功')
        loadPrompt()
    }
}

// 从版本历史激活
const handleActivateVersion = async (versionPromptId: number) => {
    const result = await useApiFetch(`/api/v1/admin/prompts/activate/${versionPromptId}`, { method: 'PUT' })
    if (result !== null) {
        toast.success('激活成功')
        // 如果激活的是其他版本，跳转到该版本
        if (versionPromptId !== promptId.value) {
            navigateTo(`/admin/prompts/${versionPromptId}`)
        } else {
            loadPrompt()
        }
    }
}

// 预览渲染
const handlePreview = async () => {
    if (!prompt.value) return
    previewing.value = true
    try {
        const data = await useApiFetch<{ renderedContent: string }>('/api/v1/admin/prompts/preview', {
            method: 'POST',
            body: {
                content: prompt.value.content,
                variables: previewVariables.value,
            }
        })
        if (data) {
            previewResult.value = data.renderedContent
        }
    } finally {
        previewing.value = false
    }
}

// 清空预览
const clearPreview = () => {
    promptVariables.value.forEach(v => {
        previewVariables.value[v] = ''
    })
    previewResult.value = ''
}

// 删除提示词
const confirmDelete = async () => {
    if (!prompt.value) return
    deleting.value = true
    try {
        const result = await useApiFetch(`/api/v1/admin/prompts/${prompt.value.id}`, { method: 'DELETE' })
        if (result !== null) {
            toast.success('删除成功')
            navigateTo('/admin/prompts')
        }
    } finally {
        deleting.value = false
    }
}

onMounted(() => {
    loadPrompt()
})
</script>
