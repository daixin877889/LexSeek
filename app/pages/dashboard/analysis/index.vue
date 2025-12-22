<template>
  <div></div>
</template>

<script lang="ts" setup>
definePageMeta({
  title: "案件分析",
  layout: "dashboard-layout",
  middleware: [
    function () {
      return navigateTo("/dashboard/analysis/agent");
    },
  ],
});
</script>

<style></style>
