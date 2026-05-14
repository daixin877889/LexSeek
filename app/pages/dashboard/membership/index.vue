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
  userMenu: { group: 'membership', title: '我的会员', icon: 'Crown', order: 1 },
});
</script>

<style></style>
