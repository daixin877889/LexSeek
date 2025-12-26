<template>
  <div></div>
</template>

<script lang="ts" setup>
definePageMeta({
  layout: "dashboard-layout",
  title: "会员中心",
  middleware: [
    function () {
      return navigateTo("/dashboard/membership/level");
    },
  ],
});
</script>

<style></style>
