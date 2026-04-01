<script lang="ts" setup>
import { BotIcon, XIcon, SendIcon } from 'lucide-vue-next'
import { useMediaQuery } from '@vueuse/core'

const isOpen = defineModel<boolean>({ default: false })

const isMobile = useMediaQuery('(max-width: 767px)')
const inputText = ref('')

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

const messages = ref<ChatMessage[]>([
  { role: 'assistant', content: '你好！我是小索，你的案件 AI 助手。有什么我可以帮你的吗？' },
])

function sendMessage() {
  const text = inputText.value.trim()
  if (!text) return

  messages.value = [
    ...messages.value,
    { role: 'user', content: text },
  ]
  inputText.value = ''

  setTimeout(() => {
    messages.value = [
      ...messages.value,
      { role: 'assistant', content: '功能开发中，敬请期待！' },
    ]
  }, 500)
}
</script>

<template>
  <!-- 桌面端：悬浮按钮 + 弹窗 -->
  <template v-if="!isMobile">
    <div class="absolute bottom-4 right-4 z-20">
      <Transition
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="opacity-0 scale-95 translate-y-2"
        enter-to-class="opacity-100 scale-100 translate-y-0"
        leave-active-class="transition duration-150 ease-in"
        leave-from-class="opacity-100 scale-100 translate-y-0"
        leave-to-class="opacity-0 scale-95 translate-y-2"
      >
        <div
          v-if="isOpen"
          class="absolute bottom-14 right-0 w-[380px] h-[500px] bg-background border rounded-xl shadow-xl flex flex-col overflow-hidden"
        >
          <div class="shrink-0 h-10 flex items-center justify-between px-3 border-b bg-muted/30">
            <div class="flex items-center gap-2 text-sm font-medium">
              <BotIcon class="size-4 text-primary" />
              小索 · AI 助手
            </div>
            <Button variant="ghost" size="icon" class="size-6" @click="isOpen = false">
              <XIcon class="size-3.5" />
            </Button>
          </div>

          <div class="flex-1 overflow-y-auto p-3 space-y-3">
            <div
              v-for="(msg, i) in messages"
              :key="i"
              :class="[
                'text-sm rounded-lg px-3 py-2 max-w-[85%]',
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground ml-auto'
                  : 'bg-muted'
              ]"
            >
              {{ msg.content }}
            </div>
          </div>

          <div class="shrink-0 p-2 border-t">
            <div class="flex gap-2">
              <input
                v-model="inputText"
                class="flex-1 h-8 px-3 text-sm bg-muted rounded-md border-0 outline-none focus:ring-1 focus:ring-primary"
                placeholder="输入消息..."
                @keydown.enter="sendMessage"
              />
              <Button size="icon" class="size-8 shrink-0" :disabled="!inputText.trim()" @click="sendMessage">
                <SendIcon class="size-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </Transition>

      <Button
        size="icon"
        class="size-12 rounded-full shadow-lg"
        :variant="isOpen ? 'default' : 'outline'"
        @click="isOpen = !isOpen"
      >
        <BotIcon class="size-5" />
      </Button>
    </div>
  </template>

  <!-- 移动端：底部 Sheet -->
  <template v-else>
    <Sheet v-model:open="isOpen">
      <SheetContent side="bottom" class="h-[90vh] flex flex-col p-0">
        <SheetHeader class="shrink-0 px-4 pt-4 pb-2">
          <SheetTitle class="flex items-center gap-2 text-sm">
            <BotIcon class="size-4 text-primary" />
            小索 · AI 助手
          </SheetTitle>
        </SheetHeader>

        <div class="flex-1 overflow-y-auto px-4 space-y-3">
          <div
            v-for="(msg, i) in messages"
            :key="i"
            :class="[
              'text-sm rounded-lg px-3 py-2 max-w-[85%]',
              msg.role === 'user'
                ? 'bg-primary text-primary-foreground ml-auto'
                : 'bg-muted'
            ]"
          >
            {{ msg.content }}
          </div>
        </div>

        <div class="shrink-0 p-4 border-t pb-[env(safe-area-inset-bottom)]">
          <div class="flex gap-2">
            <input
              v-model="inputText"
              class="flex-1 h-9 px-3 text-sm bg-muted rounded-md border-0 outline-none focus:ring-1 focus:ring-primary"
              placeholder="输入消息..."
              @keydown.enter="sendMessage"
            />
            <Button size="icon" class="size-9 shrink-0" :disabled="!inputText.trim()" @click="sendMessage">
              <SendIcon class="size-4" />
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  </template>
</template>
