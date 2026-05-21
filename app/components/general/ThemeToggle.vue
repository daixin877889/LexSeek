<template>
    <!-- 主题切换按钮 -->
    <Button
        variant="ghost"
        size="icon"
        class="h-9 w-9"
        :aria-label="resolvedMode === 'light' ? '切换到深色模式' : '切换到浅色模式'"
        :title="resolvedMode === 'light' ? '切换到深色模式' : '切换到浅色模式'"
        @click="toggleDark"
    >
        <!-- 亮色模式图标 -->
        <Sun v-if="resolvedMode === 'light'" class="h-5 w-5" />
        <!-- 暗色模式图标 -->
        <Moon v-else class="h-5 w-5" />
    </Button>
</template>

<script lang="ts" setup>
import { Sun, Moon } from "lucide-vue-next";
import { useColorMode } from '~/composables/useColorMode'

// 颜色模式
const { resolvedMode, toggleDark } = useColorMode();
</script>
