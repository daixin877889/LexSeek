<template>
  <div class="m-4">
    <div class="p-4 pt-2 shadow-none rounded-md border">
      <!-- 分析模块选择区域 -->
      <div v-if="analysisModules.length > 0" class="flex justify-between items-center mb-3">
        <h3 class="text-base font-medium">案件分析任务</h3>

        <!-- 全选功能 -->
        <div>
          <Button variant="ghost" size="sm" @click="handleAnalysisSelectAll" :disabled="!hasAnyAnalysisEditableTask"
            class="text-xs flex items-center gap-1 h-8">
            <span v-if="isAllAnalysisSelected">取消全选</span>
            <span v-else>全选</span>
          </Button>
        </div>
      </div>

      <!-- 模块列表 -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
        <div v-for="(task, index) in analysisModules" :key="task.name || index"
          class="flex items-center p-3 border rounded-md transition-colors"
          :class="task.available !== false ? 'cursor-pointer hover:bg-accent/50' : 'cursor-not-allowed opacity-60'"
          @click="handleAnalysisBoxClick(index, $event)">
          <div class="items-top flex gap-x-2 w-full">
            <Checkbox :id="`analysis-task-${props.id}-${index}`" :model-value="task.selected"
              :disabled="task.available === false" @update:model-value="() => handleAnalysisToggle(index)" />
            <div class="flex items-center justify-between leading-none flex-1 gap-2">
              <label :for="`analysis-task-${props.id}-${index}`" class="text-sm font-medium leading-none"
                :class="task.available !== false ? 'cursor-pointer' : 'cursor-not-allowed'">
                {{ task.title }}
              </label>
              <div class="flex items-center gap-2 shrink-0">
                <span v-if="task.available">
                  <span class="text-xs text-muted-foreground" v-if="task.discount && task.discount === 1">{{
                    task.pointAmount }} 积分</span>
                  <span class="text-xs text-muted-foreground" v-else>
                    <span class="line-through opacity-70 text-[#999999]">{{ task.pointAmount }}</span>
                    <span class="font-bold text-xs text-primary ml-1">{{ Math.ceil(task.pointAmount * task.discount) }}
                      积分</span>
                  </span>
                </span>
                <span v-if="task.available === false" class="text-xs bg-red-50 text-red-500 px-2 py-0.5 rounded"> 无权限
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
const props = defineProps<{
  id: string;
}>();

const analysisModules = ref([
  {
    name: "法律咨询",
    title: "案件分析",
    description: "案件分析",
    selected: false,
    available: true,
    discount: 0.5,
    pointAmount: 100,
  },
  {
    name: "法律咨询",
    title: "案件分析",
    description: "案件分析",
    selected: false,
    available: true,
    discount: 1,
    pointAmount: 100,
  },
  {
    name: "法律咨询",
    title: "案件分析",
    description: "案件分析",
    selected: false,
    available: true,
    discount: 1,
    pointAmount: 100,
  },
  {
    name: "法律咨询",
    title: "案件分析",
    description: "案件分析",
    selected: false,
    available: true,
    discount: 1,
    pointAmount: 100,
  },
  {
    name: "法律咨询",
    title: "案件分析",
    description: "案件分析",
    selected: false,
    available: false,
    discount: 1,
    pointAmount: 100,
  },
]);

// 切换任务选择状态
const handleAnalysisToggle = (index: number) => {
  if (analysisModules.value[index]) {
    analysisModules.value[index].selected = !analysisModules.value[index].selected;
  }
};

// 全选/取消全选
const handleAnalysisSelectAll = () => {
  const allSelected = isAllAnalysisSelected.value;
  analysisModules.value.forEach((task) => {
    if (task.available) {
      task.selected = !allSelected;
    }
  });
};

// 是否已经全选（只检查可用的任务）
const isAllAnalysisSelected = computed(() => {
  const availableTasks = analysisModules.value.filter((task) => task.available);
  if (availableTasks.length === 0) return false;
  return availableTasks.every((task) => task.selected);
});

// 是否可以选择任务
const hasAnyAnalysisEditableTask = computed(() => {
  return analysisModules.value.some((task) => task.available);
});

// 点击任务
const handleAnalysisBoxClick = (index: number, event: MouseEvent) => {
  if (analysisModules.value[index] && analysisModules.value[index].available) {
    analysisModules.value[index].selected = !analysisModules.value[index].selected;
  }
};
</script>

<style></style>
