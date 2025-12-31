<template>
    <!-- 空状态组件 -->
    <div class="bg-card rounded-lg p-8 border text-center">
        <FolderX class="h-12 w-12 text-muted-foreground mx-auto mb-4" />
        <h3 class="text-lg font-medium mb-2">暂无案件</h3>
        <p class="text-muted-foreground mb-4">
            {{ hasFilters ? '没有符合筛选条件的案件' : '您还没有创建任何案件分析' }}
        </p>
        <div class="flex flex-col sm:flex-row gap-3 justify-center">
            <Button v-if="hasFilters" variant="outline" @click="emit('reset')">
                <RotateCcw class="h-4 w-4 mr-2" />
                重置筛选
            </Button>
            <NuxtLink to="/dashboard/analysis">
                <Button>
                    <Plus class="h-4 w-4 mr-2" />
                    新建分析
                </Button>
            </NuxtLink>
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
