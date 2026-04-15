<script setup lang="ts">
/**
 * 文件下载卡片组件
 *
 * 渲染 AI 消息中嵌入的 [file-card] 标记，提供文件信息展示和一键下载功能。
 * 临时文件显示过期警告和剩余时间。
 */
import {
  FileTextIcon,
  FileSpreadsheetIcon,
  PresentationIcon,
  FileImageIcon,
  FileAudioIcon,
  FileVideoIcon,
  FileArchiveIcon,
  FileIcon,
  DownloadIcon,
  AlertTriangleIcon,
  Loader2Icon,
  BanIcon,
} from 'lucide-vue-next'
import { toast } from 'vue-sonner'

interface Props {
  /** 文件 ID（OSS 数据库 ID，临时文件为 temp_xxx 字符串） */
  fileId: string
  /** 文件名（缺失时从 /api/v1/files/metadata/:id 自动拉取） */
  fileName?: string
  /** 文件大小（字节，缺失或 0 时自动拉取） */
  fileSize?: number
  /** MIME 类型（缺失时自动拉取） */
  mimeType?: string
  /** 是否为临时文件（配额不足时上传到临时路径） */
  temporary?: boolean
  /** 临时文件过期时间（ISO 字符串） */
  expiresAt?: string
}

const props = withDefaults(defineProps<Props>(), {
  fileName: '',
  fileSize: 0,
  mimeType: '',
  temporary: false,
})

// ---- 状态 ----

/** 是否正在下载（请求签名中） */
const downloading = ref(false)
/** 文件是否已被删除（404 时设为 true） */
const deleted = ref(false)

/**
 * 自动拉取的元数据（用于补全 LLM 输出 [file-card]fileId=17[/file-card]
 * 这种缩写格式时缺失的 fileName / fileSize / mimeType）
 */
const fetchedMeta = ref<{ fileName: string, fileSize: number, mimeType: string } | null>(null)

const displayName = computed(() => props.fileName || fetchedMeta.value?.fileName || `文件 ${props.fileId}`)
const displaySize = computed(() => props.fileSize || fetchedMeta.value?.fileSize || 0)
const displayMime = computed(() => props.mimeType || fetchedMeta.value?.mimeType || 'application/octet-stream')

// ---- 文件图标 ----

/** 根据 mimeType 选择合适的文件图标 */
const FileIconComponent = computed(() => {
  const mime = displayMime.value.toLowerCase()
  if (mime.startsWith('image/')) return FileImageIcon
  if (mime.startsWith('audio/')) return FileAudioIcon
  if (mime.startsWith('video/')) return FileVideoIcon
  if (
    mime === 'application/pdf'
    || mime.includes('word')
    || mime.includes('text')
    || mime === 'application/rtf'
  ) return FileTextIcon
  if (mime.includes('spreadsheet') || mime.includes('excel') || mime === 'text/csv') return FileSpreadsheetIcon
  if (mime.includes('presentation') || mime.includes('powerpoint')) return PresentationIcon
  if (mime.includes('zip') || mime.includes('gzip') || mime.includes('tar') || mime.includes('rar')) return FileArchiveIcon
  return FileIcon
})

// ---- 文件大小格式化 ----

/** 将字节数转换为人类可读的文件大小字符串 */
function formatFileSize(bytes: number): string {
  if (bytes <= 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

const formattedSize = computed(() => formatFileSize(displaySize.value))

// ---- 临时文件剩余时间 ----

/** 临时文件剩余有效时间，每秒更新 */
const remainingTime = ref('')

function calcRemainingTime(): string {
  if (!props.expiresAt) return ''
  const diffMs = new Date(props.expiresAt).getTime() - Date.now()
  if (diffMs <= 0) return '已过期'

  const hours = Math.floor(diffMs / 3600000)
  const minutes = Math.floor((diffMs % 3600000) / 60000)
  if (hours > 0) return `${hours}小时${minutes}分钟后过期`
  return `${minutes}分钟后过期`
}

let timer: ReturnType<typeof setInterval> | null = null

/** 判断是否为临时文件 ID（不可通过 API 下载，也不能拉元数据） */
const isTemporaryId = computed(() => props.temporary || String(props.fileId).startsWith('temp_'))

/** 元数据是否需要从 API 自动拉取（任一字段缺失，且非临时文件） */
const needsMetaFetch = computed(() =>
  !isTemporaryId.value
  && (!props.fileName || !props.fileSize || !props.mimeType),
)

onMounted(async () => {
  // 临时文件倒计时
  if (props.temporary && props.expiresAt) {
    remainingTime.value = calcRemainingTime()
    timer = setInterval(() => {
      remainingTime.value = calcRemainingTime()
    }, 60000)
  }

  // 元数据补全：LLM 缩写格式 [file-card]fileId=17[/file-card] 没有
  // fileName/fileSize/mimeType，从 API 拉取
  if (needsMetaFetch.value) {
    const numericId = Number(props.fileId)
    if (Number.isInteger(numericId) && numericId > 0) {
      try {
        const meta = await useApiFetch<{ fileName: string, fileSize: number, mimeType: string }>(
          `/api/v1/files/metadata/${numericId}`,
        )
        if (meta) fetchedMeta.value = meta
      } catch {
        // 拉取失败不阻塞渲染，下载时还会再尝试
      }
    }
  }
})

onUnmounted(() => {
  if (timer !== null) clearInterval(timer)
})

// ---- 下载逻辑 ----

async function handleDownload() {
  if (deleted.value || downloading.value) return

  // 临时文件无法通过 fileId API 下载，给予提示
  if (isTemporaryId.value) {
    toast.warning('此文件为临时文件，暂不支持直接下载，请联系管理员')
    return
  }

  const numericId = Number(props.fileId)
  if (!Number.isInteger(numericId) || numericId <= 0) {
    toast.error('无效的文件 ID')
    return
  }

  downloading.value = true
  try {
    const result = await useApiFetch<{ downloadUrl: string; fileName: string }>(
      `/api/v1/files/download/${numericId}`,
    )

    if (!result?.downloadUrl) {
      toast.error('获取下载链接失败')
      return
    }

    // 通过隐藏 <a> 标签触发浏览器下载
    const anchor = document.createElement('a')
    anchor.href = result.downloadUrl
    anchor.download = result.fileName ?? displayName.value
    anchor.style.display = 'none'
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
  } catch (err: any) {
    if (err?.status === 404 || err?.data?.code === 404) {
      deleted.value = true
      toast.error('文件已被删除')
    } else {
      toast.error('下载失败，请稍后重试')
    }
  } finally {
    downloading.value = false
  }
}
</script>

<template>
  <div
    class="my-2 inline-flex w-full max-w-sm flex-col gap-1 rounded-lg border bg-card px-4 py-3 shadow-sm"
    :class="{
      'border-destructive/40 bg-destructive/5': deleted,
      'border-warning/40 bg-warning/5': temporary && !deleted,
    }"
  >
    <!-- 临时文件警告 -->
    <div v-if="temporary && !deleted" class="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
      <AlertTriangleIcon class="size-3 shrink-0" />
      <span>临时文件{{ remainingTime ? `・${remainingTime}` : '' }}</span>
    </div>

    <!-- 文件已删除提示 -->
    <div v-if="deleted" class="flex items-center gap-1.5 text-xs text-destructive">
      <BanIcon class="size-3 shrink-0" />
      <span>文件已被删除</span>
    </div>

    <!-- 主体行：图标 + 文件信息 + 下载按钮 -->
    <div class="flex items-center gap-3">
      <!-- 文件图标 -->
      <div
        class="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10"
        :class="{ 'bg-muted': deleted }"
      >
        <component
          :is="FileIconComponent"
          class="size-5 text-primary"
          :class="{ 'text-muted-foreground': deleted }"
        />
      </div>

      <!-- 文件名 + 大小 -->
      <div class="min-w-0 flex-1">
        <p
          class="truncate text-sm font-medium leading-tight"
          :class="deleted ? 'text-muted-foreground line-through' : 'text-foreground'"
          :title="displayName"
        >
          {{ displayName }}
        </p>
        <p class="mt-0.5 text-xs text-muted-foreground">{{ formattedSize }}</p>
      </div>

      <!-- 下载按钮 -->
      <Button
        v-if="!deleted"
        variant="ghost"
        size="icon"
        class="size-8 shrink-0"
        :disabled="downloading || isTemporaryId"
        :title="isTemporaryId ? '临时文件不支持下载' : '下载文件'"
        @click="handleDownload"
      >
        <Loader2Icon v-if="downloading" class="size-4 animate-spin" />
        <DownloadIcon v-else class="size-4" />
      </Button>
    </div>
  </div>
</template>
