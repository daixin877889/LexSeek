<template>
  <div class="px-4 flex size-full flex-col justify-end">
    <PromptInputProvider @submit="handleSubmit">
      <PromptInput global-drop multiple class="[&_[data-slot=input-group]]:shadow-none [&_[data-slot=input-group]]:border-primary [&_[data-slot=input-group]]:rounded-md">
        <!-- 头部 -->
        <PromptInputHeader>
          <PromptInputAttachments>
            <template #default="{ file }">
              <PromptInputAttachment :file="file" />
            </template>
          </PromptInputAttachments>
        </PromptInputHeader>
        <!-- 中间部分 -->
        <PromptInputBody>
          <PromptInputTextarea ref="textareaRef" placeholder="请输入案情信息或者上传案情材料，支持上传 文本、文档、音频、图片 四种材料。" class="min-h-32" />
        </PromptInputBody>
        <!-- 底部 -->
        <PromptInputFooter class="border-t border-muted-foreground/20 border-dashed">
          <!-- 工具栏 -->
          <PromptInputTools>
            <PromptInputButton variant="ghost" @click="selectMaterial">
              <Paperclip class="text-muted-foreground" :size="16" />
              案情材料
            </PromptInputButton>
            <span class="text-muted-foreground text-xs"> </span>
          </PromptInputTools>
          <!-- 附件上传 -->
          <div class="flex items-center gap-2">
            <!-- 提交按钮 -->
            <PromptInputSubmit class="h-9 px-4! rounded-md" :status="status" size="xs">
              <SendHorizontal class="size-4" />
              <span class="ml-1.5">法索一下</span>
            </PromptInputSubmit>
          </div>
        </PromptInputFooter>
      </PromptInput>
    </PromptInputProvider>
    <CaseAnalysisMaterialSelector ref="materialSelectorRef" @filesSelected="handleFilesSelected" />
  </div>
</template>

<script lang="ts" setup>
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { ModelSelector, ModelSelectorContent, ModelSelectorEmpty, ModelSelectorGroup, ModelSelectorInput, ModelSelectorItem, ModelSelectorList, ModelSelectorLogo, ModelSelectorLogoGroup, ModelSelectorName, ModelSelectorTrigger } from "@/components/ai-elements/model-selector";
import { PromptInput, PromptInputAttachment, PromptInputAttachments, PromptInputBody, PromptInputButton, PromptInputCommand, PromptInputCommandEmpty, PromptInputCommandGroup, PromptInputCommandInput, PromptInputCommandItem, PromptInputCommandList, PromptInputCommandSeparator, PromptInputFooter, PromptInputHeader, PromptInputHoverCard, PromptInputHoverCardContent, PromptInputHoverCardTrigger, PromptInputProvider, PromptInputSubmit, PromptInputTab, PromptInputTabBody, PromptInputTabItem, PromptInputTabLabel, PromptInputTextarea, PromptInputTools } from "@/components/ai-elements/prompt-input";
import { AtSignIcon, CheckIcon, FilesIcon, GlobeIcon, ImageIcon, Paperclip, SendHorizontal, RulerIcon } from "lucide-vue-next";

// 案情材料选择器引用
const materialSelectorRef = ref<{ openDialog: () => void; closeDialog: () => void } | null>(null);

// 选择的文件
const selectedFiles = ref<OssFileItem[]>([]);

// 处理文件选择
function handleFilesSelected(files: OssFileItem[]) {
  selectedFiles.value = files;
  console.log(selectedFiles.value);
}

const status = ref<"submitted" | "streaming" | "ready" | "error">("ready");
const textareaRef = ref<HTMLTextAreaElement | null>(null);

function handleSubmit(message: PromptInputMessage) {
  // const hasText = !!message.text;
  // const hasAttachments = !!message.files?.length;

  // if (!hasText && !hasAttachments) {
  //   return;
  // }

  status.value = "submitted";

  // // eslint-disable-next-line no-console
  console.log("Submitting message:", message);

  // setTimeout(() => {
  //   status.value = "streaming";
  // }, SUBMITTING_TIMEOUT);

  // setTimeout(() => {
  //   status.value M "ready";
  // }, STREAMING_TIMEOUT);
}

onMounted(() => {
  // 使用 nextTick 确保子组件完全挂载后再调用
  nextTick(() => {
    selectMaterial();
  });
});

function selectMaterial() {
  materialSelectorRef.value?.openDialog();
}
</script>

<style></style>
