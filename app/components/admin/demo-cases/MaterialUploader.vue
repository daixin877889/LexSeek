<template>
  <div class="space-y-2">
    <div class="flex items-center justify-between">
      <Label>预设文件材料</Label>
      <Button variant="outline" size="sm" @click="fileInputRef?.click()" :disabled="uploading">
        <Plus class="h-4 w-4 mr-1" />
        添加文件
      </Button>
      <input ref="fileInputRef" type="file" multiple class="hidden" @change="onFilePick" />
    </div>

    <div v-if="modelValue.length === 0 && uploadingFiles.length === 0"
      class="text-sm text-muted-foreground py-4 text-center border rounded-md">
      暂无预设材料，点击上方按钮添加
    </div>

    <div v-else class="space-y-2">
      <div v-for="(material, idx) in modelValue" :key="material.sourceOssFileId"
        class="flex items-center gap-2 p-2 border rounded-md">
        <FileIcon class="h-4 w-4 shrink-0" />
        <span class="flex-1 truncate text-sm">{{ material.name }}</span>
        <Badge :variant="getBadgeVariant(recognitionStatus.get(material.sourceOssFileId))">
          {{ getBadgeLabel(recognitionStatus.get(material.sourceOssFileId)) }}
        </Badge>
        <Button variant="ghost" size="icon" @click="removeMaterial(idx)">
          <X class="h-4 w-4" />
        </Button>
      </div>

      <div v-for="f in uploadingFiles" :key="f.id"
        class="flex items-center gap-2 p-2 border rounded-md bg-muted/30">
        <Loader2 class="h-4 w-4 animate-spin shrink-0" />
        <span class="flex-1 truncate text-sm">{{ f.file.name }}</span>
        <span class="text-xs">{{ f.progress }}%</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Plus, X, FileIcon, Loader2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { FileSource } from '#shared/types/file'
import type { DemoCaseFileMaterial } from '#shared/types/case'

const modelValue = defineModel<DemoCaseFileMaterial[]>({ required: true })

const fileInputRef = ref<HTMLInputElement | null>(null)
const uploadingFiles = ref<Array<{ id: string; file: File; progress: number }>>([])
const recognitionStatus = ref<Map<number, 'recognizing' | 'success' | 'error' | null>>(new Map())
const uploading = computed(() => uploadingFiles.value.length > 0)

const fileStore = useFileStore()
const { detectMimeType, validateFile, uploadToOSS } = useBatchUpload()

async function onFilePick(event: Event) {
  const input = event.target as HTMLInputElement
  const files = input.files ? Array.from(input.files) : []
  input.value = ''
  if (files.length === 0) return

  const scenes = await fileStore.getUploadConfig(FileSource.DEMO_CASE)
  const currentScene = scenes?.[0] ?? null

  for (const file of files) {
    const v = validateFile(file, currentScene)
    if (!v.valid) {
      toast.error(`文件 "${file.name}" ${v.message}`)
      continue
    }
    const id = `upload_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
    const state = reactive({ id, file, progress: 0 })
    uploadingFiles.value.push(state)

    try {
      const signatures = await fileStore.getBatchPresignedUrls({
        source: FileSource.DEMO_CASE,
        files: [{ originalFileName: file.name, fileSize: file.size, mimeType: detectMimeType(file) }],
        encrypted: false,
      })
      const signature = signatures?.[0]
      if (!signature) throw new Error('获取签名失败')

      const data = await uploadToOSS(file, signature, (p: number) => { state.progress = p })
      const ossFileId = (data.fileId || data.id) as number

      // 追加到 modelValue
      const mat: DemoCaseFileMaterial = {
        name: file.name,
        type: inferTypeFromMime(detectMimeType(file)),
        sourceOssFileId: ossFileId,
      }
      modelValue.value = [...modelValue.value, mat]

      // 触发识别
      recognitionStatus.value.set(ossFileId, 'recognizing')
      const result = await useApiFetch<{ results: Array<{ ossFileId: number; status: string }> }>(
        '/api/v1/recognition/start',
        { method: 'POST', body: { ossFileIds: [ossFileId] }, showError: false },
      )
      if (result?.results?.[0]) {
        const s = result.results[0].status
        recognitionStatus.value.set(
          ossFileId,
          s === 'completed' ? 'success' : s === 'failed' ? 'error' : 'recognizing',
        )
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '上传失败')
    } finally {
      uploadingFiles.value = uploadingFiles.value.filter(f => f.id !== id)
    }
  }
}

function inferTypeFromMime(mime: string): 2 | 3 | 4 {
  if (mime.startsWith('image/')) return 3
  if (mime.startsWith('audio/')) return 4
  return 2
}

function removeMaterial(idx: number) {
  const mat = modelValue.value[idx]
  if (!mat) return
  modelValue.value = modelValue.value.filter((_, i) => i !== idx)
  recognitionStatus.value.delete(mat.sourceOssFileId)
}

function getBadgeVariant(s: 'recognizing' | 'success' | 'error' | null | undefined) {
  if (s === 'success') return 'default' as const
  if (s === 'error') return 'destructive' as const
  return 'secondary' as const
}

function getBadgeLabel(s: 'recognizing' | 'success' | 'error' | null | undefined) {
  if (s === 'success') return '已识别'
  if (s === 'error') return '识别失败'
  if (s === 'recognizing') return '识别中'
  return '未识别'
}

/** 回显识别状态：对 modelValue 中每个 sourceOssFileId 查询当前状态 */
async function refreshRecognitionStatus() {
  for (const mat of modelValue.value) {
    try {
      const r = await useApiFetch<{ recognized: boolean; status: number }>(
        `/api/v1/recognition/status/${mat.sourceOssFileId}`,
        { showError: false },
      )
      if (r) {
        recognitionStatus.value.set(
          mat.sourceOssFileId,
          r.recognized ? 'success' : r.status === 3 ? 'error' : 'recognizing',
        )
      }
    } catch { /* 忽略 */ }
  }
}

watch(modelValue, refreshRecognitionStatus, { immediate: true })
</script>
