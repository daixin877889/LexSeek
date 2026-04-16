<script lang="ts" setup>
/**
 * Session 列表 Popover 组件
 *
 * 小索和模块对话共用的 session 列表弹出层。
 * 支持切换、重命名、删除 session 和新建 session。
 */
import { ChevronDownIcon, Trash2Icon, PlusIcon, CheckIcon, PencilIcon } from 'lucide-vue-next'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'

dayjs.extend(relativeTime)
dayjs.locale('zh-cn')

export interface SessionItem {
  sessionId: string
  title: string
  updatedAt: string
}

const props = withDefaults(defineProps<{
  sessions: SessionItem[]
  currentId: string | null
  loading?: boolean
  /** 标题前缀（如"小索"或模块中文名），由 UI 动态拼接，不存入数据库 */
  titlePrefix?: string
}>(), {
  loading: false,
  titlePrefix: '',
})

const emit = defineEmits<{
  select: [sessionId: string]
  create: []
  delete: [sessionId: string]
  rename: [sessionId: string, title: string]
}>()

const open = ref(false)

// 内联重命名状态
const renamingId = ref<string | null>(null)
const renameInput = ref('')

function startRename(session: SessionItem, e: Event) {
  e.stopPropagation()
  renamingId.value = session.sessionId
  renameInput.value = session.title
}

function confirmRename(sessionId: string, e: Event) {
  e.stopPropagation()
  const title = renameInput.value.trim()
  if (title && title !== props.sessions.find(s => s.sessionId === sessionId)?.title) {
    emit('rename', sessionId, title)
  }
  renamingId.value = null
}

function cancelRename(e?: Event) {
  e?.stopPropagation()
  renamingId.value = null
}

function handleSelect(sessionId: string) {
  if (renamingId.value) return
  emit('select', sessionId)
  open.value = false
}

function handleDelete(sessionId: string, e: Event) {
  e.stopPropagation()
  emit('delete', sessionId)
}

function handleCreate() {
  open.value = false
  emit('create')
}

// 当前 session 标题（用于 trigger 按钮显示），拼接前缀
const currentTitle = computed(() => {
  const session = props.sessions.find(s => s.sessionId === props.currentId)
  const title = session?.title ?? '新对话'
  return props.titlePrefix ? `${props.titlePrefix} - ${title}` : title
})
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <button
        class="flex items-center gap-1 min-w-0 font-medium hover:text-primary transition-colors outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0"
        :disabled="loading"
      >
        <span class="truncate">{{ currentTitle }}</span>
        <ChevronDownIcon class="size-3.5 shrink-0" />
      </button>
    </PopoverTrigger>
    <PopoverContent class="w-64 p-0 z-[70]" align="start">
      <!-- session 列表 -->
      <div class="max-h-60 overflow-y-auto">
        <div
          v-for="session in sessions"
          :key="session.sessionId"
          class="flex items-center gap-1 px-2 py-1.5 hover:bg-muted cursor-pointer text-sm"
          :class="{ 'bg-muted/50': session.sessionId === currentId }"
          @click="handleSelect(session.sessionId)"
        >
          <!-- 重命名输入框 -->
          <template v-if="renamingId === session.sessionId">
            <input
              v-model="renameInput"
              class="flex-1 min-w-0 text-sm bg-background border rounded px-1 py-0.5 outline-none focus:ring-1 focus:ring-primary"
              autofocus
              @keyup.enter="confirmRename(session.sessionId, $event)"
              @keyup.escape="cancelRename($event)"
              @click.stop
            />
            <button
              class="shrink-0 p-0.5 rounded hover:bg-primary/10 hover:text-primary"
              @click="confirmRename(session.sessionId, $event)"
            >
              <CheckIcon class="size-3" />
            </button>
          </template>
          <!-- 正常显示 -->
          <template v-else>
            <span class="truncate flex-1">{{ session.title }}</span>
            <span class="shrink-0 text-xs text-muted-foreground">{{ dayjs(session.updatedAt).fromNow() }}</span>
            <button
              class="shrink-0 p-0.5 rounded hover:bg-accent hover:text-accent-foreground"
              @click="startRename(session, $event)"
            >
              <PencilIcon class="size-2.5" />
            </button>
            <button
              class="shrink-0 p-0.5 rounded hover:bg-destructive/10 hover:text-destructive"
              @click="handleDelete(session.sessionId, $event)"
            >
              <Trash2Icon class="size-2.5" />
            </button>
          </template>
        </div>
      </div>

      <!-- 新建 session 按钮 -->
      <div class="border-t p-1">
        <button
          class="w-full flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-muted rounded-sm transition-colors"
          @click="handleCreate"
        >
          <PlusIcon class="size-3.5" />
          新建对话
        </button>
      </div>
    </PopoverContent>
  </Popover>
</template>
