<script setup lang="ts">
/**
 * 通用法律助手 - 会话列表组件
 *
 * 展示当前用户的 assistant 会话（scope=assistant），
 * 支持新建 / 重命名 / 软删 / 选中（v-model:selectedId）。
 *
 * - 数据接口：/api/v1/assistant/sessions (GET/POST/PATCH/DELETE)
 * - useApiFetch 会自动提取响应的 data 字段，故直接使用返回值
 * - 类型参见 #shared/types/assistant
 *
 * 参见 spec §8.3.2。
 */
import { PlusIcon, Trash2Icon, PencilIcon, CheckIcon, XIcon } from 'lucide-vue-next'
import type {
  AssistantSession,
  AssistantSessionListResponse,
  CreateAssistantSessionResponse,
} from '#shared/types/assistant'

const selectedId = defineModel<string | null>('selectedId')

const sessions = ref<AssistantSession[]>([])
const loading = ref(false)
const creating = ref(false)

/** 内联重命名状态 */
const renamingId = ref<string | null>(null)
const renameInput = ref('')

async function loadSessions() {
  loading.value = true
  try {
    const res = await useApiFetch<AssistantSessionListResponse>(
      '/api/v1/assistant/sessions',
      { query: { pageSize: 100 } },
    )
    if (res) sessions.value = res.list ?? []
  } finally {
    loading.value = false
  }
}

async function createSession() {
  if (creating.value) return
  creating.value = true
  try {
    const res = await useApiFetch<CreateAssistantSessionResponse>(
      '/api/v1/assistant/sessions',
      { method: 'POST', body: {} },
    )
    if (res?.sessionId) {
      selectedId.value = res.sessionId
      await loadSessions()
    }
  } finally {
    creating.value = false
  }
}

function startRename(session: AssistantSession, e: Event) {
  e.stopPropagation()
  renamingId.value = session.sessionId
  renameInput.value = session.title ?? ''
}

function cancelRename(e?: Event) {
  e?.stopPropagation()
  renamingId.value = null
  renameInput.value = ''
}

async function confirmRename(session: AssistantSession, e: Event) {
  e.stopPropagation()
  const next = renameInput.value.trim()
  // 空 / 未变化 → 直接取消
  if (!next || next === (session.title ?? '')) {
    cancelRename()
    return
  }
  const res = await useApiFetch<{ sessionId: string; title: string }>(
    `/api/v1/assistant/sessions/${session.sessionId}`,
    { method: 'PATCH', body: { title: next } },
  )
  cancelRename()
  if (res) await loadSessions()
}

async function deleteSession(session: AssistantSession, e: Event) {
  e.stopPropagation()
  const label = session.title ?? '未命名对话'
  if (!window.confirm(`确定删除"${label}"？`)) return
  const res = await useApiFetch<{ sessionId: string }>(
    `/api/v1/assistant/sessions/${session.sessionId}`,
    { method: 'DELETE' },
  )
  if (res) {
    // 当前选中项被删时清空选择
    if (selectedId.value === session.sessionId) selectedId.value = null
    await loadSessions()
  }
}

function handleSelect(session: AssistantSession) {
  if (renamingId.value) return
  selectedId.value = session.sessionId
}

onMounted(loadSessions)

defineExpose({ refresh: loadSessions })
</script>

<template>
  <div class="flex h-full flex-col border-r bg-background">
    <!-- 新建按钮 -->
    <div class="p-3 border-b">
      <Button
        class="w-full justify-start gap-2"
        size="sm"
        :disabled="creating"
        @click="createSession"
      >
        <PlusIcon class="size-4" />
        新对话
      </Button>
    </div>

    <!-- 列表区 -->
    <div class="flex-1 overflow-y-auto">
      <!-- loading 骨架 -->
      <div v-if="loading && sessions.length === 0" class="p-3 space-y-2">
        <div
          v-for="i in 4"
          :key="i"
          class="h-8 rounded-md bg-muted animate-pulse"
        />
      </div>

      <!-- 空状态 -->
      <div
        v-else-if="sessions.length === 0"
        class="p-4 text-sm text-muted-foreground text-center"
      >
        暂无会话，点击上方「新对话」开始
      </div>

      <!-- 列表 -->
      <ul v-else class="py-1">
        <li
          v-for="s in sessions"
          :key="s.sessionId"
          class="group flex items-center gap-1 px-3 py-2 cursor-pointer hover:bg-accent hover:text-accent-foreground transition-colors"
          :class="{ 'bg-accent text-accent-foreground': selectedId === s.sessionId }"
          @click="handleSelect(s)"
        >
          <!-- 重命名态 -->
          <template v-if="renamingId === s.sessionId">
            <input
              v-model="renameInput"
              class="flex-1 min-w-0 text-sm bg-background border rounded px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-primary"
              autofocus
              @click.stop
              @keyup.enter="confirmRename(s, $event)"
              @keyup.escape="cancelRename($event)"
            >
            <button
              type="button"
              class="shrink-0 size-6 rounded flex items-center justify-center hover:bg-primary/10 hover:text-primary"
              title="确认"
              @click="confirmRename(s, $event)"
            >
              <CheckIcon class="size-3" />
            </button>
            <button
              type="button"
              class="shrink-0 size-6 rounded flex items-center justify-center hover:bg-destructive/10 hover:text-destructive"
              title="取消"
              @click="cancelRename($event)"
            >
              <XIcon class="size-3" />
            </button>
          </template>

          <!-- 正常态 -->
          <template v-else>
            <span class="flex-1 truncate text-sm">{{ s.title ?? '未命名对话' }}</span>
            <button
              type="button"
              class="opacity-0 group-hover:opacity-100 size-6 rounded flex items-center justify-center hover:bg-background"
              title="重命名"
              @click="startRename(s, $event)"
            >
              <PencilIcon class="size-3" />
            </button>
            <button
              type="button"
              class="opacity-0 group-hover:opacity-100 size-6 rounded flex items-center justify-center hover:bg-destructive/10 hover:text-destructive"
              title="删除"
              @click="deleteSession(s, $event)"
            >
              <Trash2Icon class="size-3" />
            </button>
          </template>
        </li>
      </ul>
    </div>
  </div>
</template>
