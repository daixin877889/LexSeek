<template>
    <!-- 空状态组件 -->
    <div class="relative overflow-hidden bg-card/50 backdrop-blur-sm rounded-2xl p-12 border border-dashed border-2 text-center group">
        <!-- 背景装饰 -->
        <div class="absolute -top-12 -right-12 h-24 w-24 bg-primary/5 rounded-full blur-2xl group-hover:bg-primary/10 transition-colors"></div>
        <div class="absolute -bottom-12 -left-12 h-24 w-24 bg-blue-500/5 rounded-full blur-2xl group-hover:bg-blue-500/10 transition-colors"></div>
        
        <div class="relative">
            <div class="inline-flex h-20 w-20 items-center justify-center rounded-full bg-muted/50 mb-6 group-hover:scale-110 transition-transform duration-300">
                <FolderX class="h-10 w-10 text-muted-foreground/60" />
            </div>
            
            <h3 class="text-xl font-bold mb-2 text-foreground">暂无案件记录</h3>
            <p class="text-muted-foreground max-w-sm mx-auto mb-8 text-sm leading-relaxed">
                {{ hasFilters ? '没有找到符合当前筛选条件的案件。尝试调整筛选条件或搜索关键词。' : '开启您的法律发现之旅，通过 AI 分析案件详情，获取深度法律洞见。' }}
            </p>
            
            <div class="flex flex-col sm:flex-row gap-4 justify-center">
                <Button v-if="hasFilters" variant="outline" class="rounded-full px-6" @click="emit('reset')">
                    <RotateCcw class="h-4 w-4 mr-2" />
                    清空筛选
                </Button>
                <NuxtLink to="/dashboard/cases/create">
                    <Button class="rounded-full px-8 shadow-lg shadow-primary/20">
                        <Plus class="h-4 w-4 mr-2" />
                        立即创建新分析
                    </Button>
                </NuxtLink>
            </div>
        </div>
    </div>
</template>

<script lang="ts" setup>
import { FolderX, RotateCcw, Plus } from "lucide-vue-next";

// ==================== Props ====================

defineProps<{
    hasFilters?: boolean;
}>();

// ==================== Emits ====================

const emit = defineEmits<{
    reset: [];
}>();
</script>
