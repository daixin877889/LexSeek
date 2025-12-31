<template>
    <!-- 主题切换按钮 -->
    <DropdownMenu>
        <DropdownMenuTrigger as-child>
            <Button variant="ghost" size="icon" class="h-9 w-9">
                <!-- 亮色模式图标 -->
                <Sun v-if="resolvedMode === 'light'" class="h-5 w-5" />
                <!-- 暗色模式图标 -->
                <Moon v-else class="h-5 w-5" />
                <span class="sr-only">切换主题</span>
            </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="w-48">
            <!-- 外观模式 -->
            <DropdownMenuLabel class="text-xs text-muted-foreground">外观模式</DropdownMenuLabel>
            <DropdownMenuItem @click="setColorMode('light')">
                <Sun class="mr-2 h-4 w-4" />
                <span>浅色</span>
                <Check v-if="colorMode === 'light'" class="ml-auto h-4 w-4" />
            </DropdownMenuItem>
            <DropdownMenuItem @click="setColorMode('dark')">
                <Moon class="mr-2 h-4 w-4" />
                <span>深色</span>
                <Check v-if="colorMode === 'dark'" class="ml-auto h-4 w-4" />
            </DropdownMenuItem>
            <DropdownMenuItem @click="setColorMode('system')">
                <Monitor class="mr-2 h-4 w-4" />
                <span>跟随系统</span>
                <Check v-if="colorMode === 'system'" class="ml-auto h-4 w-4" />
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            <!-- 主题色 -->
            <DropdownMenuLabel class="text-xs text-muted-foreground">主题色</DropdownMenuLabel>
            <div class="grid grid-cols-4 gap-1 p-2">
                <button v-for="theme in themeColors" :key="theme.name"
                    class="flex h-8 w-8 items-center justify-center rounded-md border-2 transition-colors hover:scale-110"
                    :class="[
                        themeColor === theme.name
                            ? 'border-foreground'
                            : 'border-transparent hover:border-muted-foreground/50'
                    ]" :title="theme.label" @click="setThemeColor(theme.name)">
                    <span class="h-5 w-5 rounded-full" :style="{ backgroundColor: theme.color }" />
                </button>
            </div>
        </DropdownMenuContent>
    </DropdownMenu>
</template>

<script lang="ts" setup>
import { Sun, Moon, Monitor, Check } from "lucide-vue-next";

// 颜色模式
const { colorMode, resolvedMode, setColorMode } = useColorMode();

// 主题色
const { themeColor, themeColors, setThemeColor } = useTheme();
</script>
