<template>
    <Dialog v-model:open="open">
        <DialogContent class="w-full h-full md:min-w-[70vw] md:h-[80vh] flex flex-col"
            @interactOutside="(e) => e.preventDefault()">
            <DialogHeader>
                <DialogTitle class="flex items-center gap-2">
                    <component :is="getFileIcon(fileType)" :class="['size-5', getFileIconColor(fileType)]" />
                    {{ fileName }}
                    <!-- 图像类型标签 -->
                    <Badge v-if="imageType" variant="secondary" class="ml-2">
                        {{ imageType === 'doc' ? '文档类图片' : '照片类图片' }}
                    </Badge>
                </DialogTitle>
                <DialogDescription>{{ isImageFile ? '图像识别结果预览' : '文档识别结果预览' }}</DialogDescription>
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

                <!-- 图像预览：显示原始图片 + 识别结果 -->
                <div v-else-if="isImageFile" class="h-full overflow-y-auto">
                    <Tabs default-value="recognition" class="h-full flex flex-col">
                        <TabsList class="mx-4 mt-2">
                            <TabsTrigger value="recognition">识别结果</TabsTrigger>
                            <TabsTrigger value="original">原始图片</TabsTrigger>
                        </TabsList>

                        <!-- 识别结果标签页 -->
                        <TabsContent value="recognition" class="flex-1 overflow-y-auto px-4 mt-2">
                            <ClientOnly>
                                <MarkstreamVue :content="renderedMarkdown" :is-dark="isDark" />
                                <template #fallback>
                                    <div class="flex items-center justify-center py-8">
                                        <Loader2Icon class="size-6 animate-spin text-muted-foreground" />
                                    </div>
                                </template>
                            </ClientOnly>
                        </TabsContent>

                        <!-- 原始图片标签页 -->
                        <TabsContent value="original" class="flex-1 overflow-y-auto px-4 mt-2">
                            <div class="flex items-center justify-center min-h-full py-4">
                                <img v-if="originalImageUrl" :src="originalImageUrl" :alt="fileName"
                                    class="max-w-full h-auto rounded-md shadow-lg" />
                                <div v-else class="text-sm text-muted-foreground">
                                    无法加载原始图片
                                </div>
                            </div>
                        </TabsContent>
                    </Tabs>
                </div>

                <!-- 文档预览：只显示 Markdown 内容 -->
                <div v-else class="h-full overflow-y-auto px-1">
                    <ClientOnly>
                        <MarkstreamVue :content="renderedMarkdown" :is-dark="isDark" />
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
import MarkstreamVue, { enableMermaid, setDefaultI18nMap } from 'markstream-vue'
import 'markstream-vue/index.css'
import { getFileIcon, getFileIconColor } from '~/utils/file'
import { getExtensionFromFileName, IMAGE_EXTENSIONS } from '~~/shared/utils/file'

// 启用 Mermaid 渲染（传入 mermaid 模块的动态导入函数）
enableMermaid(() => import('mermaid'))

// 配置中文国际化
setDefaultI18nMap({
    'common.copy': '复制',
    'common.copied': '已复制',
    'common.expand': '展开',
    'common.collapse': '收起',
    'common.preview': '预览',
    'common.source': '源码',
})

// Props
const props = defineProps<{
    /** OSS 文件 ID */
    ossFileId: number
    /** 文件名 */
    fileName: string
    /** 文件类型 */
    fileType: string
    /** 是否加密 */
    encrypted?: boolean
}>()

// 弹框状态
const open = defineModel<boolean>('open', { default: false })

// 状态
const loading = ref(false)
const error = ref<string | null>(null)

// 渲染内容（服务端已替换图片占位符为签名 URL）
const renderedMarkdown = ref('')

// 图像类型（仅图像识别有此字段）
const imageType = ref<'doc' | 'photo' | null>(null)

// 原始图片 URL（用于图像预览）
const originalImageUrl = ref<string | null>(null)

// 是否有内容
const hasContent = computed(() => !!renderedMarkdown.value)

// 判断是否为图片文件
const isImageFile = computed(() => {
    const ext = getExtensionFromFileName(props.fileName)
    return IMAGE_EXTENSIONS.includes(ext)
})

/**
 * 获取图片的 MIME 类型
 */
const getImageMimeType = (fileName: string): string => {
    const ext = getExtensionFromFileName(fileName)
    const mimeMap: Record<string, string> = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp',
        heic: 'image/heic',
        heif: 'image/heif',
    }
    return mimeMap[ext] || 'image/jpeg'
}

// 获取当前主题是否为暗色模式
const { isDark } = useColorMode()

// 本地文件缓存
const { getCachedFile, cacheFile } = useLocalFileCache()

/**
 * 加载原始图片
 */
async function loadOriginalImage(): Promise<string | null> {
    try {
        // 1. 先尝试从本地缓存获取
        const cached = await getCachedFile(props.ossFileId)
        if (cached) {
            const mimeType = getImageMimeType(props.fileName)
            const blob = new Blob([cached], { type: mimeType })
            return URL.createObjectURL(blob)
        }

        // 2. 获取下载 URL
        const signedUrlResponse = await useApiFetch<Array<{
            ossFileId: number
            downloadUrl: string
        }>>('/api/v1/files/oss/download-url', {
            method: 'POST',
            body: {
                ossFileIds: [props.ossFileId],
            },
            showError: false,
        })

        if (!signedUrlResponse || signedUrlResponse.length === 0) {
            return null
        }

        const downloadUrl = signedUrlResponse[0]?.downloadUrl
        if (!downloadUrl) {
            return null
        }

        // 3. 直接返回下载 URL
        return downloadUrl
    } catch (e) {
        console.error('加载原始图片失败:', e)
        return null
    }
}

/**
 * 加载识别内容
 */
async function loadContent() {
    loading.value = true
    error.value = null
    renderedMarkdown.value = ''
    imageType.value = null
    originalImageUrl.value = null

    try {
        // 调用状态检查 API 获取识别结果
        // 服务端已将图片占位符替换为 OSS 签名 URL
        const response = await useApiFetch<{
            recognized: boolean
            status?: number
            recordType?: 'doc' | 'image'
            record?: {
                imageType?: 'doc' | 'photo'
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

        // 如果是图像识别，保存图像类型
        if (response.recordType === 'image' && response.record.imageType) {
            imageType.value = response.record.imageType
        }

        // 如果是图片文件，加载原始图片（支持加密文件）
        if (isImageFile.value) {
            originalImageUrl.value = await loadOriginalImage()
        }
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
