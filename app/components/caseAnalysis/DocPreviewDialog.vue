<template>
    <Dialog v-model:open="open">
        <DialogContent class="w-full h-full md:min-w-[70vw] md:h-[80vh] flex flex-col">
            <DialogHeader>
                <DialogTitle class="flex items-center gap-2">
                    <component :is="getFileIcon(fileType)" :class="['size-5', getFileIconColor(fileType)]" />
                    {{ fileName }}
                </DialogTitle>
                <DialogDescription>文档识别结果预览</DialogDescription>
            </DialogHeader>

            <!-- 内容区域 -->
            <div class="flex-1 overflow-hidden">
                <!-- 加载状态 -->
                <div v-if="loading" class="flex items-center justify-center h-full">
                    <Loader2Icon class="size-8 animate-spin text-muted-foreground" />
                </div>

                <!-- 错误状态 -->
                <div v-else-if="error" class="flex flex-col items-center justify-center h-full text-center">
                    <AlertCircleIcon class="size-12 text-destructive mb-4" />
                    <p class="text-sm text-muted-foreground">{{ error }}</p>
                    <Button variant="outline" size="sm" class="mt-4" @click="loadContent">
                        重试
                    </Button>
                </div>

                <!-- 未识别状态 -->
                <div v-else-if="!hasContent" class="flex flex-col items-center justify-center h-full text-center">
                    <FileTextIcon class="size-12 text-muted-foreground/50 mb-4" />
                    <p class="text-sm text-muted-foreground">该文件尚未识别</p>
                </div>

                <!-- Markdown 内容展示 -->
                <div v-else class="h-full overflow-y-auto px-1">
                    <ClientOnly>
                        <MarkstreamVue :content="renderedMarkdown" />
                        <template #fallback>
                            <div class="flex items-center justify-center py-8">
                                <Loader2Icon class="size-6 animate-spin text-muted-foreground" />
                            </div>
                        </template>
                    </ClientOnly>
                </div>
            </div>

            <DialogFooter>
                <Button variant="outline" @click="open = false">关闭</Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
</template>

<script lang="ts" setup>
import { Loader2Icon, AlertCircleIcon, FileTextIcon } from 'lucide-vue-next'
import MarkstreamVue from 'markstream-vue'
import 'markstream-vue/index.css'
import { getFileIcon, getFileIconColor } from '~/utils/file'

// Props
const props = defineProps<{
    /** OSS 文件 ID */
    ossFileId: number
    /** 文件名 */
    fileName: string
    /** 文件类型 */
    fileType: string
}>()

// 弹框状态
const open = defineModel<boolean>('open', { default: false })

// 状态
const loading = ref(false)
const error = ref<string | null>(null)

// 渲染内容（服务端已替换图片占位符为签名 URL）
const renderedMarkdown = ref('')

// 是否有内容
const hasContent = computed(() => !!renderedMarkdown.value)

/**
 * 加载识别内容
 */
async function loadContent() {
    loading.value = true
    error.value = null
    renderedMarkdown.value = ''

    try {
        // 调用状态检查 API 获取识别结果
        // 服务端已将图片占位符替换为 OSS 签名 URL
        const response = await useApiFetch<{
            recognized: boolean
            status?: number
            record?: {
                htmlContent?: string | null
                markdownContent?: string | null
            }
        }>(`/api/v1/recognition/doc/status/${props.ossFileId}`, {
            showError: false,
        })

        if (!response) {
            error.value = '获取识别结果失败'
            return
        }

        // 检查是否已识别（status === 2 表示成功）
        if (!response.recognized || !response.record) {
            // 未识别，显示未识别状态
            return
        }

        // 直接使用服务端返回的内容（已替换图片占位符）
        renderedMarkdown.value = response.record.markdownContent || ''
    } catch (e) {
        error.value = e instanceof Error ? e.message : '加载失败'
    } finally {
        loading.value = false
    }
}

// 监听弹框打开，加载内容
// 使用 immediate: true 确保组件首次挂载时如果 open 为 true 也能触发加载
watch(open, (isOpen) => {
    if (isOpen) {
        loadContent()
    }
}, { immediate: true })

// 暴露方法
defineExpose({
    loadContent,
})
</script>

<style scoped>
/* 确保图片在预览中正常显示 */
:deep(img) {
    max-width: 100%;
    height: auto;
}
</style>
