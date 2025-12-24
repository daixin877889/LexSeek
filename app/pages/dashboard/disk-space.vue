<template>
  <div>
    <GeneralFileUploader :source="FileSource.FILE" :multiple="true" :autoUpload="true" :onSuccess="handleUploadSuccess" :onError="handleUploadError" />
  </div>
</template>

<script lang="ts" setup>
definePageMeta({
  title: "云盘空间",
  layout: "dashboard-layout",
});

// 上传成功回调
const handleUploadSuccess = (data: Record<string, unknown>[]) => {
  console.log("上传成功", data);
};

// 上传失败回调
const handleUploadError = (error: Error) => {
  console.log("上传失败", error);
};
</script>

<style></style>
