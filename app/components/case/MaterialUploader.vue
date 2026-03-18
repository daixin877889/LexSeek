<template>
  <div class="material-uploader flex flex-col gap-4">
    <!-- 材料列表 -->
    <div v-if="materials.length > 0" class="space-y-2">
      <div class="flex items-center justify-between">
        <span class="text-sm text-muted-foreground">已添加 {{ materials.length }} 份材料</span>
        <Button variant="ghost" size="sm" @click="clearAllMaterials" :disabled="isProcessing">
          清空全部
        </Button>
      </div>

      <ScrollArea class="max-h-60">
        <div class="space-y-2 pr-4">
          <div v-for="(material, index) in materials" :key="index"
            class="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
            <!-- 文件图标 -->
            <div class="shrink-0">
              <component :is="getFileIcon(material.type)" class="h-5 w-5 text-muted-foreground" />
            </div>

            <!-- 文件信息 -->
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium truncate">{{ material.name }}</p>
              <div class="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{{ formatByteSize(material.size, 2) }}</span>
                <span>•</span>
                <span>{{ getMaterialTypeName(material.type) }}</span>
                <template v-if="material.status !== 'pending'">
                  <span>•</span>
                  <span :class="{
                    'text-amber-600': material.status === 'processing',
                    'text-green-600': material.status === 'ready',
                    'text-destructive': material.status === 'error',
                  }">
                    {{ getStatusText(material.status) }}
                  </span>
                </template>
              </div>
              <p v-if="material.error" class="text-xs text-destructive mt-1">{{ material.error }}</p>
            </div>

            <!-- 操作按钮 -->
            <Button variant="ghost" size="icon" class="h-8 w-8 shrink-0" @click="removeMaterial(index)"
              :disabled="isProcessing">
              <XIcon class="h-4 w-4" />
            </Button>
          </div>
        </div>
      </ScrollArea>
    </div>

    <!-- 拖拽上传区域 -->
    <div class="relative border-2 border-dashed rounded-lg text-center transition-colors cursor-pointer" :class="[
      isDragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-muted-foreground/50',
      isProcessing ? 'pointer-events-none opacity-50' : '',
    ]" @dragover.prevent="handleDragOver" @dragleave.prevent="handleDragLeave" @drop.prevent="handleDrop"
      @click="triggerFileInput">
      <div class="px-6 py-8 space-y-3">
        <div class="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center">
          <UploadIcon class="h-6 w-6 text-muted-foreground" />
        </div>
        <div class="space-y-1">
          <p class="text-sm font-medium">拖拽文件到此处或点击上传</p>
          <p class="text-xs text-muted-foreground">
            支持 PDF、Word、图片、音频、文本等格式
          </p>
        </div>
      </div>

      <!-- 隐藏的文件输入 -->
      <input ref="fileInputRef" type="file" multiple :accept="acceptTypes" class="hidden" @change="handleFileChange"
        :disabled="isProcessing" />
    </div>

    <!-- 文本输入区域（可选） -->
    <div v-if="showTextInput" class="space-y-2">
      <div class="flex items-center justify-between">
        <Label class="text-sm">或直接输入案情描述</Label>
        <Button v-if="textContent.trim()" variant="ghost" size="sm" @click="addTextMaterial" :disabled="isProcessing">
          <PlusIcon class="h-4 w-4 mr-1" />
          添加为材料
        </Button>
      </div>
      <Textarea v-model="textContent" placeholder="请输入案情描述..." class="min-h-[100px] resize-none"
        :disabled="isProcessing" />
    </div>

    <!-- 操作按钮 -->
    <div class="flex items-center gap-2">
      <Button @click="processAndUpload" :disabled="!canProcess" :loading="isProcessing" class="flex-1">
        <template v-if="isProcessing">
          处理中...
        </template>
        <template v-else>
          <UploadIcon class="h-4 w-4 mr-2" />
          上传材料 ({{ materials.length }})
        </template>
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  UploadIcon,
  XIcon,
  HelpCircleIcon,
  PlusIcon,
  FileTextIcon,
  FileIcon,
  ImageIcon,
  MusicIcon,
} from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { FileSource } from '~~/shared/types/file'
import type { PostSignatureResult } from '~~/shared/types/oss'
import { CaseMaterialType, type MaterialItem, type MaterialStatus, type UploadResult } from '~~/shared/types/material'
import { getExtensionFromFileName } from '~~/shared/utils/file'

/**
 * 组件 Props
 */
interface Props {
  /** 是否显示文本输入区域 */
  showTextInput?: boolean
  /** 是否自动处理文件 */
  autoProcess?: boolean
}

/**
 * 组件事件
 */
const emit = defineEmits<{
  /** 材料上传完成 */
  (e: 'upload-complete', result: UploadResult): void
  /** 材料上传失败 */
  (e: 'upload-error', error: Error): void
  /** 材料列表变化 */
  (e: 'materials-change', materials: MaterialItem[]): void
}>()

const props = withDefaults(defineProps<Props>(), {
  showTextInput: true,
  autoProcess: true,
})

// Stores
const fileStore = useFileStore()

// Composables
const { readFile } = useFileReader()
const uploadWorker = useFileUploadWorker()

// 状态
const materials = ref<MaterialItem[]>([])
const textContent = ref('')
const isProcessing = ref(false)
const isDragOver = ref(false)
const fileInputRef = ref<HTMLInputElement | null>(null)

// 支持的文件类型
const acceptTypes = computed(() => {
  return [
    // 文档
    '.pdf', '.doc', '.docx', '.md', '.txt',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/markdown',
    'text/plain',
    // 图片
    '.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif',
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/heic',
    'image/heif',
    // 音频
    '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac',
    'audio/mpeg',
    'audio/wav',
    'audio/mp4',
    'audio/aac',
    'audio/ogg',
    'audio/flac',
  ].join(',')
})

// 是否可以处理
const canProcess = computed(() => {
  return materials.value.length > 0 && !isProcessing.value
})

/**
 * 获取文件图标
 */
const getFileIcon = (type: CaseMaterialType) => {
  switch (type) {
    case CaseMaterialType.CASE_CONTENT:
      return FileTextIcon
    case CaseMaterialType.DOCUMENT:
      return FileIcon
    case CaseMaterialType.IMAGE:
      return ImageIcon
    case CaseMaterialType.AUDIO:
      return MusicIcon
    default:
      return FileIcon
  }
}

/**
 * 获取材料类型名称
 */
const getMaterialTypeName = (type: CaseMaterialType): string => {
  switch (type) {
    case CaseMaterialType.CASE_CONTENT:
      return '文本'
    case CaseMaterialType.DOCUMENT:
      return '文档'
    case CaseMaterialType.IMAGE:
      return '图片'
    case CaseMaterialType.AUDIO:
      return '音频'
    default:
      return '未知'
  }
}

/**
 * 获取状态文本
 */
const getStatusText = (status: MaterialStatus): string => {
  switch (status) {
    case 'pending':
      return '待处理'
    case 'processing':
      return '处理中'
    case 'ready':
      return '已就绪'
    case 'uploaded':
      return '已上传'
    case 'error':
      return '处理失败'
    default:
      return ''
  }
}

/**
 * 检测文件的材料类型
 */
const detectMaterialType = (file: File): CaseMaterialType => {
  const mimeType = file.type.toLowerCase()
  const ext = getExtensionFromFileName(file.name)

  // 图片类型
  if (mimeType.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif'].includes(ext)) {
    return CaseMaterialType.IMAGE
  }

  // 音频类型
  if (mimeType.startsWith('audio/') || ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'].includes(ext)) {
    return CaseMaterialType.AUDIO
  }

  // 文档类型（包括 PDF 和可浏览器端处理的文档）
  return CaseMaterialType.DOCUMENT
}

/**
 * 检查文件是否需要服务端处理
 * PDF、图片、音频需要服务端处理
 * md/txt/docx/doc 可以在浏览器端处理
 */
const needsServerProcessing = (file: File): boolean => {
  const ext = getExtensionFromFileName(file.name)
  const mimeType = file.type.toLowerCase()

  // 浏览器端可处理的文件类型
  const browserProcessable = ['md', 'mkd', 'txt', 'docx', 'doc']

  if (browserProcessable.includes(ext)) {
    return false
  }

  // PDF、图片、音频需要服务端处理
  if (mimeType === 'application/pdf' || ext === 'pdf') {
    return true
  }

  if (mimeType.startsWith('image/')) {
    return true
  }

  if (mimeType.startsWith('audio/')) {
    return true
  }

  return true
}

/**
 * 处理文件选择
 */
const handleFileChange = async (event: Event) => {
  const target = event.target as HTMLInputElement
  const files = target.files

  if (!files || files.length === 0) return

  await addFiles(Array.from(files))

  // 重置文件输入
  if (target) {
    target.value = ''
  }
}

/**
 * 添加文件到材料列表
 */
const addFiles = async (files: File[]) => {
  for (const file of files) {
    // 检查是否已存在
    const exists = materials.value.some(
      m => m.name === file.name && m.size === file.size
    )
    if (exists) continue

    const materialType = detectMaterialType(file)
    const needServerProcess = needsServerProcessing(file)

    const material: MaterialItem = {
      name: file.name,
      type: materialType,
      size: file.size,
      file,
      status: 'pending',
      needServerProcess,
      mimeType: file.type || mime.getType(file.name.split('.').pop() || '') || 'application/octet-stream',
    }

    materials.value.push(material)

    // 如果启用自动处理且是浏览器端可处理的文件，立即处理
    if (props.autoProcess && !needServerProcess) {
      await processBrowserFile(material)
    }
  }

  emit('materials-change', materials.value)
}

/**
 * 处理浏览器端可处理的文件（md/txt/docx/doc）
 */
const processBrowserFile = async (material: MaterialItem) => {
  if (!material.file) return

  try {
    material.status = 'processing'

    const result = await readFile(material.file)
    material.content = result.content
    material.status = 'ready'
  } catch (error) {
    material.status = 'error'
    material.error = error instanceof Error ? error.message : '文件读取失败'
    logger.error('处理文件失败:', material.name, error)
  }
}

/**
 * 添加文本材料
 */
const addTextMaterial = () => {
  if (!textContent.value.trim()) return

  const material: MaterialItem = {
    name: `文本材料_${Date.now()}`,
    type: CaseMaterialType.CASE_CONTENT,
    size: new Blob([textContent.value]).size,
    content: textContent.value,
    status: 'ready',
    needServerProcess: false,
  }

  materials.value.push(material)
  textContent.value = ''

  emit('materials-change', materials.value)
}

/**
 * 移除材料
 */
const removeMaterial = (index: number) => {
  materials.value.splice(index, 1)
  emit('materials-change', materials.value)
}

/**
 * 清空所有材料
 */
const clearAllMaterials = () => {
  materials.value = []
  emit('materials-change', materials.value)
}

/**
 * 触发文件选择
 */
const triggerFileInput = () => {
  fileInputRef.value?.click()
}

/**
 * 处理拖拽进入
 */
const handleDragOver = (event: DragEvent) => {
  if (isProcessing.value) return
  event.preventDefault()
  isDragOver.value = true
}

/**
 * 处理拖拽离开
 */
const handleDragLeave = (event: DragEvent) => {
  if (isProcessing.value) return
  event.preventDefault()
  isDragOver.value = false
}

/**
 * 处理文件拖放
 */
const handleDrop = async (event: DragEvent) => {
  if (isProcessing.value) return
  event.preventDefault()
  isDragOver.value = false

  const files = event.dataTransfer?.files
  if (!files || files.length === 0) return

  await addFiles(Array.from(files))
}

/**
 * 上传单个文件到 OSS
 */
const uploadFileToOSS = async (
  material: MaterialItem,
  signature: PostSignatureResult
): Promise<Record<string, unknown>> => {
  if (!material.file) {
    throw new Error('文件不存在')
  }

  return new Promise((resolve, reject) => {
    uploadWorker.upload(material.file, signature, {
      onProgress: () => {
        // 可以在这里更新进度
      },
      onSuccess: (data) => {
        resolve(data)
      },
      onError: (error) => {
        reject(error)
      },
    })
  })
}

/**
 * 处理并上传所有材料
 */
const processAndUpload = async () => {
  if (!canProcess.value) return

  isProcessing.value = true

  try {
    // 1. 处理所有待处理的浏览器端文件
    const pendingBrowserFiles = materials.value.filter(
      m => m.status === 'pending' && !m.needServerProcess && m.file
    )

    for (const material of pendingBrowserFiles) {
      await processBrowserFile(material)
    }

    // 2. 获取需要上传的文件（需要服务端处理的文件）
    const filesToUpload = materials.value.filter(
      m => m.needServerProcess && m.file && m.status !== 'uploaded'
    )

    if (filesToUpload.length > 0) {
      // 批量获取签名
      const filesInfo = filesToUpload.map(m => ({
        originalFileName: m.name,
        fileSize: m.size,
        mimeType: m.mimeType || 'application/octet-stream',
      }))

      const signatures = await fileStore.getBatchPresignedUrls({
        source: FileSource.CASE_ANALYSIS,
        files: filesInfo,
        encrypted: false,
      })

      if (!signatures || signatures.length !== filesToUpload.length) {
        throw new Error(fileStore.error || '获取上传签名失败')
      }

      // 上传文件
      for (let i = 0; i < filesToUpload.length; i++) {
        const material = filesToUpload[i]!
        const signature = signatures[i]!

        try {
          material.status = 'processing'
          const result = await uploadFileToOSS(material, signature)
          material.ossFileId = result.id as number
          material.status = 'uploaded'
        } catch (error) {
          material.status = 'error'
          material.error = error instanceof Error ? error.message : '上传失败'
          logger.error('上传文件失败:', material.name, error)
        }
      }
    }

    // 3. 检查是否有错误
    const hasError = materials.value.some(m => m.status === 'error')
    if (hasError) {
      const errorCount = materials.value.filter(m => m.status === 'error').length
      throw new Error(`${errorCount} 个文件处理失败`)
    }

    // 4. 发送完成事件
    emit('upload-complete', {
      materials: materials.value,
    })

    toast.success('材料上传成功')
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    emit('upload-error', err)
    toast.error(err.message)
  } finally {
    isProcessing.value = false
  }
}

/**
 * 获取材料列表
 */
const getMaterials = () => materials.value

/**
 * 重置组件状态
 */
const reset = () => {
  materials.value = []
  textContent.value = ''
  isProcessing.value = false
}

// 暴露方法
defineExpose({
  getMaterials,
  reset,
  addFiles,
  addTextMaterial,
  processAndUpload,
})
</script>

<style scoped>
.material-uploader {
  /* 组件样式 */
}
</style>
