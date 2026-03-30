<template>
  <div>

  </div>
</template>

<script lang="ts" setup>
const router = useRouter()
definePageMeta({
  title: "初始化分析",
  layout: "dashboard-layout",
})
onMounted(() => {
  router.back()
})
</script>

<style></style>