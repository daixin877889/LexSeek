<template>
    <Dialog v-model:open="open">
        <DialogContent class="w-full max-h-[85vh] md:min-w-[80vw] flex flex-col overflow-hidden p-0 z-[80]"
            overlay-class="z-[75]" @open-auto-focus.prevent
            @interactOutside="(e) => e.preventDefault()">
            <DialogHeader class="px-6 pt-6 pb-4 border-b shrink-0">
                <DialogTitle class="flex items-center gap-2">
                    <FileAudioIcon class="size-5 text-purple-500" />
                    {{ fileName }}
                </DialogTitle>
                <DialogDescription>音频识别结果预览</DialogDescription>
            </DialogHeader>

            <!-- 内容区域 -->
            <div class="flex-1 overflow-hidden px-4 pb-4">
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
                    <FileAudioIcon class="size-12 text-muted-foreground/50 mb-4" />
                    <p class="text-sm text-muted-foreground">该音频尚未识别</p>
                </div>

                <!-- 音频可视化组件 -->
                <AudioVisualization
                    v-else
                    :asr-data="asrData"
                    :audio-url="audioUrl"
                    :material-title="fileName"
                    :asr-record-id="asrRecordId ?? undefined"
                    class="h-full"
                    @speaker-updated="handleSpeakerUpdated"
                />
            </div>
        </DialogContent>
    </Dialog>
</template>

<script lang="ts" setup>
import { Loader2Icon, AlertCircleIcon, FileAudioIcon } from 'lucide-vue-next'
import AudioVisualization from '~/components/general/audio/AudioVisualization.vue'
import { getExtensionFromFileName } from '~~/shared/utils/file'
import { useApiFetch } from '~/composables/useApiFetch'
import { useLocalFileCache } from '~/composables/useLocalFileCache'

// Props
const props = defineProps<{
    /** OSS 文件 ID */
    ossFileId: number
    /** 文件名 */
    fileName: string
    /** 是否加密 */
    encrypted?: boolean
}>()

// 弹框状态
const open = defineModel<boolean>('open', { default: false })

// 状态
const loading = ref(false)
const error = ref<string | null>(null)

// ASR 数据
const asrData = ref<any>(null)
const audioUrl = ref<string>('')
const asrRecordId = ref<number | null>(null)

// 是否有内容
const hasContent = computed(() => !!asrData.value && asrData.value.status === 2)

// 本地文件缓存
const { getCachedFile, cacheFile } = useLocalFileCache()

/**
 * 获取音频的 MIME 类型
 */
const getAudioMimeType = (fileName: string): string => {
    const ext = getExtensionFromFileName(fileName)
    const mimeMap: Record<string, string> = {
        mp3: 'audio/mpeg',
        wav: 'audio/wav',
        m4a: 'audio/mp4',
        aac: 'audio/aac',
        flac: 'audio/flac',
        ogg: 'audio/ogg',
        webm: 'audio/webm',
        amr: 'audio/amr',
        opus: 'audio/opus',
    }
    return mimeMap[ext] || 'audio/mpeg'
}

/**
 * 加载音频 URL
 */
async function loadAudioUrl(): Promise<string | null> {
    try {
        // 1. 先尝试从本地缓存获取
        const cached = await getCachedFile(props.ossFileId)
        if (cached) {
            const mimeType = getAudioMimeType(props.fileName)
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
        console.error('加载音频文件失败:', e)
        return null
    }
}

/**
 * 加载识别内容
 */
async function loadContent() {
    loading.value = true
    error.value = null
    asrData.value = null
    audioUrl.value = ''
    asrRecordId.value = null

    try {
        // 1. 获取 ASR 识别记录（通过 ossFileId 查询）
        const response = await useApiFetch<{
            id: number
            ossFileId: number
            status: number
            audioUrl?: string
            audioDuration?: number
            speakers?: Array<{ id: number; name: string; color?: string }>
            result?: any
        }>(`/api/v1/recognition/audio/by-oss-file/${props.ossFileId}`, {
            showError: false,
        })

        if (!response) {
            error.value = '获取识别结果失败'
            return
        }

        // 2. 检查识别状态
        if (response.status !== 2) {
            // 未识别成功
            asrData.value = { status: response.status }
            return
        }

        // 3. 构建 ASR 数据（适配 AudioVisualization 组件格式）
        asrRecordId.value = response.id

        // API 返回的 result 已经是处理好的句子数组
        asrData.value = {
            id: response.id,
            status: response.status,
            result: response.result || [],
            audioDuration: response.audioDuration,
            speakers: response.speakers || [],
        }

        // 4. 加载音频 URL
        const url = await loadAudioUrl()
        if (url) {
            audioUrl.value = url
        } else {
            // 如果无法加载本地音频，尝试使用服务端返回的 URL
            audioUrl.value = response.audioUrl || ''
        }
    } catch (e) {
        error.value = e instanceof Error ? e.message : '加载失败'
    } finally {
        loading.value = false
    }
}

/**
 * 处理说话人更新事件
 */
function handleSpeakerUpdated() {
    // 说话人信息已在组件内部更新，无需额外处理
    console.log('说话人信息已更新')
}

// 监听弹框打开，加载内容
watch(open, (isOpen) => {
    if (isOpen) {
        // 移除当前焦点，避免 aria-hidden 警告
        if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur()
        }
        loadContent()
    }
}, { immediate: true })

// 暴露方法
defineExpose({
    loadContent,
})
</script>

<style scoped>
/* 确保音频可视化组件正常显示 */
</style>
