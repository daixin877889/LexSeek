<template>
  <div></div>
</template>

<script lang="ts" setup>
definePageMeta({
  layout: "dashboard-layout",
  title: "账户设置",
  middleware: [
    function () {
      return navigateTo("/dashboard/settings/profile");
    },
  ],
});
</script>

<style></style>
