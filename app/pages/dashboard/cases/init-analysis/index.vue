<template>
  <div />
</template>

<script lang="ts" setup>
definePageMeta({
  title: '初始化分析',
  layout: 'dashboard-layout',
})

const router = useRouter()
onMounted(() => {
  router.back()
})
</script>