<template>
  <div>
    <GeneralFileUploader :source="FileSource.IMAGE" :onSuccess="handleUploadSuccess" :onError="handleUploadError" />
  </div>
</template>

<script lang="ts" setup>
definePageMeta({
  title: "云盘空间",
  layout: "dashboard-layout",
});

const handleUploadSuccess = (file: PostSignatureResult) => {
  console.log("上传成功", file);
};

const handleUploadError = (error: Error) => {
  console.log("上传失败", error);
};
</script>

<style></style>
