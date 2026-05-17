<template>
    <!-- 版本历史对话框 -->
    <Dialog v-model:open="dialogOpen">
        <DialogContent class="theme-brand max-w-2xl max-h-[85vh] flex flex-col">
            <DialogHeader class="shrink-0">
                <DialogTitle>版本历史</DialogTitle>
                <DialogDescription>
                    查看提示词的所有历史版本，可激活任意版本
                </DialogDescription>
            </DialogHeader>
            <div class="flex-1 overflow-y-auto py-4">
                <!-- 加载状态 -->
                <div v-if="loading" class="flex justify-center py-8">
                    <Loader2 class="h-8 w-8 animate-spin text-muted-foreground" />
                </div>

                <!-- 空状态 -->
                <div v-else-if="!versions.length" class="flex flex-col items-center justify-center py-8 text-center">
                    <History class="h-10 w-10 text-muted-foreground/50 mb-3" />
                    <p class="text-muted-foreground text-sm">暂无版本历史</p>
                </div>

                <!-- 版本列表 -->
                <div v-else class="space-y-3">
                    <div v-for="version in versions" :key="version.id"
                        class="rounded-lg border p-4 hover:bg-muted/50 transition-colors"
                        :class="{ 'border-primary bg-primary/5': version.status === 1 }">
                        <div class="flex items-start justify-between gap-4">
                            <div class="flex-1 min-w-0">
                                <div class="flex items-center gap-2 mb-2">
                                    <span class="font-mono font-medium">{{ version.version }}</span>
                                    <Badge v-if="version.status === 1" variant="outline" :class="getAdminStatusBadgeClass(true)">
                                        当前生效
                                    </Badge>
                                    <Badge variant="outline" :style="getAdminPromptTypeBadgeStyle(version.type)">
                                        {{ getTypeLabel(version.type) }}
                                    </Badge>
                                </div>
                                <p v-if="version.title" class="text-sm text-muted-foreground mb-2">
                                    {{ version.title }}
                                </p>
                                <div class="text-xs text-muted-foreground">
                                    更新时间：{{ formatDate(version.updatedAt) }}
                                </div>
                            </div>
                            <div class="flex gap-2 shrink-0">
                                <Button variant="ghost" size="sm" :class="adminBrandFocusClass" @click="handleViewContent(version)">
                                    <Eye class="h-4 w-4 mr-1" />
                                    查看
                                </Button>
                                <Button v-if="version.status !== 1" variant="outline" size="sm"
                                    :class="adminBrandFocusClass"
                                    @click="handleActivate(version)">
                                    <CheckCircle class="h-4 w-4 mr-1" />
                                    激活
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <DialogFooter class="shrink-0">
                <Button variant="outline" :class="adminBrandFocusClass" @click="dialogOpen = false">关闭</Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>

    <!-- 内容查看对话框 -->
    <Dialog v-model:open="contentDialogOpen">
        <DialogContent class="theme-brand max-w-2xl max-h-[85vh] flex flex-col">
            <DialogHeader class="shrink-0">
                <DialogTitle>
                    {{ selectedVersion?.title || selectedVersion?.name }}
                    <span class="font-mono text-muted-foreground ml-2">{{ selectedVersion?.version }}</span>
                </DialogTitle>
                <DialogDescription>
                    提示词内容预览
                </DialogDescription>
            </DialogHeader>
            <div class="flex-1 overflow-y-auto py-4">
                <div class="rounded-md border bg-muted/50 p-4">
                    <pre class="whitespace-pre-wrap text-sm font-mono">{{ selectedVersion?.content }}</pre>
                </div>
                <div v-if="selectedVersionVariables.length" class="mt-4 space-y-2">
                    <Label class="text-muted-foreground">变量列表</Label>
                    <div class="flex flex-wrap gap-2">
                        <Badge v-for="(v, index) in selectedVersionVariables" :key="index" variant="outline" :class="adminBrandChipClass">
                            {{ formatVariable(v) }}
                        </Badge>
                    </div>
                </div>
            </div>
            <DialogFooter class="shrink-0">
                <Button variant="outline" :class="adminBrandFocusClass" @click="contentDialogOpen = false">关闭</Button>
                <Button v-if="selectedVersion?.status !== 1" :class="adminBrandPrimaryButtonClass" @click="handleActivateFromContent">
                    <CheckCircle class="h-4 w-4 mr-2" />
                    激活此版本
                </Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
</template>

<script setup lang="ts">
import { Loader2, History, Eye, CheckCircle } from 'lucide-vue-next'
import dayjs from 'dayjs'
import { PromptTypeLabels } from '#shared/types/node'
import type { Prompt } from '#shared/types/node'
import { useApiFetch } from '~/composables/useApiFetch'
import {
    adminBrandChipClass,
    adminBrandFocusClass,
    adminBrandPrimaryButtonClass,
    getAdminPromptTypeBadgeStyle,
    getAdminStatusBadgeClass,
} from '~/utils/adminBrandStyles'

// 定义事件
const emit = defineEmits<{
    activate: [promptId: number]
}>()

// 对话框状态
const dialogOpen = ref(false)
const contentDialogOpen = ref(false)
const loading = ref(false)
const versions = ref<Prompt[]>([])
const selectedVersion = ref<Prompt | null>(null)

// 计算属性：选中版本的变量列表
const selectedVersionVariables = computed(() => {
    if (!selectedVersion.value?.variables || !Array.isArray(selectedVersion.value.variables)) return []
    return selectedVersion.value.variables.filter((v): v is string => typeof v === 'string')
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

// 提示词类型标签
const getTypeLabel = (type: string) => {
    return PromptTypeLabels[type as keyof typeof PromptTypeLabels] || type
}

// 加载版本历史
const loadVersions = async (promptId: number) => {
    loading.value = true
    try {
        const data = await useApiFetch<Prompt[]>(`/api/v1/admin/prompts/versions/${promptId}`)
        if (data) {
            versions.value = data
        }
    } finally {
        loading.value = false
    }
}

// 打开对话框
const open = (promptId: number) => {
    versions.value = []
    dialogOpen.value = true
    loadVersions(promptId)
}

// 查看内容
const handleViewContent = (version: Prompt) => {
    selectedVersion.value = version
    contentDialogOpen.value = true
}

// 激活版本
const handleActivate = (version: Prompt) => {
    emit('activate', version.id)
    dialogOpen.value = false
}

// 从内容对话框激活
const handleActivateFromContent = () => {
    if (selectedVersion.value) {
        emit('activate', selectedVersion.value.id)
        contentDialogOpen.value = false
        dialogOpen.value = false
    }
}

// 暴露方法给父组件
defineExpose({
    open,
})
</script>
