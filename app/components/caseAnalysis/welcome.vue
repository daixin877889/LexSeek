<template>
  <div class="p-4 pt-6 pb-4">
    <div
      class="relative flex items-center gap-4 overflow-hidden rounded-[14px] border border-primary/15 bg-gradient-brand-soft px-6 py-5 dark:bg-gradient-brand-soft-dark">
      <!-- 右上角品牌色装饰光晕 -->
      <div aria-hidden="true"
        class="pointer-events-none absolute -right-5 -top-10 size-44 rounded-full bg-[radial-gradient(circle,#1EEDC4_0%,transparent_70%)] opacity-25 blur-2xl" />
      <!-- 小索头像盘 -->
      <div
        class="xiaosuo-disc relative size-16 shrink-0 rounded-full bg-gradient-brand p-[3px] shadow-[0_14px_28px_-10px_rgba(30,158,237,0.4)]">
        <div class="flex size-full items-center justify-center overflow-hidden rounded-full bg-white">
          <IconXiaosuoIcon class="size-11" />
        </div>
      </div>
      <!-- 欢迎文字 -->
      <div class="relative min-w-0 flex-1">
        <span class="block text-[19px] font-bold leading-snug">
          <template v-for="(part, i) in titleParts" :key="i">
            <GradientText v-if="part === '小索'">小索</GradientText>
            <template v-else>{{ part }}</template>
          </template>
        </span>
        <span class="mt-1.5 block text-[13.5px] text-muted-foreground">{{ subtitle }}</span>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import IconXiaosuoIcon from '~/components/icon/XiaosuoIcon.vue'
import GradientText from '~/components/general/GradientText.vue'

const props = withDefaults(defineProps<{
  title?: string
  subtitle?: string
}>(), {
  title: '你好，我是小索，您的案件分析助手',
  subtitle: '在下方输入框输入或上传案情材料，我会为您分析案件',
})

// 把标题按「小索」切分，便于将「小索」渲染为品牌渐变字（标题不含「小索」时无副作用）
const titleParts = computed(() => props.title.split(/(小索)/))
</script>

<style scoped>
@keyframes xiaosuoFloat {
  0%, 100% { transform: translateY(0); }
  50%      { transform: translateY(-4px); }
}
@keyframes xiaosuoWiggle {
  0%, 100% { rotate: 0deg; }
  20%      { rotate: -6deg; }
  40%      { rotate: 6deg; }
  60%      { rotate: -4deg; }
  80%      { rotate: 2deg; }
}
.xiaosuo-disc {
  animation: xiaosuoFloat 3.2s ease-in-out infinite;
  transition: scale 0.3s ease;
}
.xiaosuo-disc:hover {
  scale: 1.08;
  animation: xiaosuoWiggle 0.8s ease-in-out;
}
</style>
