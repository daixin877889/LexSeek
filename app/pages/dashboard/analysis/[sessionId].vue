<template>
  <AiChat title="案件分析" v-model:panel-mode="panelMode" v-model:thinking="thinkingEnabled" :messages="displayMessages"
    :loading="stream.isLoading" :show-prompt="true" :show-task-queue="true" :todos="todos" :show-tool-interrupt="true"
    :prompt-disabled="isComplete" prompt-placeholder="输入补充信息或问题..." class="h-full" style="height: calc(100vh - 48px)"
    @submit="handlePromptSubmit" @tool-confirm="handleToolConfirm" @tool-reject="handleToolReject" @back="goBack">
    <template #right-panel>
      <CaseAnalysisResults :results="analysisResults" v-model:active-index="activeResultIndex" :show-regenerate="true"
        :show-copy="true" :is-analyzing="stream.isLoading" @regenerate="handleRegenerate" />
    </template>
    <template #empty>
      <CaseAnalysisWelcome />
    </template>
  </AiChat>

  <!-- 统一中断处理器 -->
  <CaseInterruptHandler :interrupt-data="stream.interruptData.value" @resume="resumeWorkflow" />
</template>

<script lang="ts" setup>
import { provide } from 'vue'
import type { AnalysisResult } from "#shared/types/case";
import type { AiPromptSubmitData } from "~/components/ai/AiPromptInput.vue";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { useTaskQueueParser } from "~/components/ai/composables/useTaskQueueParser";
import AiChat from '~/components/ai/AiChat.vue'
import CaseAnalysisResults from '~/components/case/AnalysisResults.vue'
import CaseInterruptHandler from '~/components/case/interrupt/InterruptHandler.vue'
import CaseAnalysisWelcome from '~/components/caseAnalysis/welcome.vue'
import { useApiFetch } from '~/composables/useApiFetch'
import { useStreamChat } from '~/composables/useStreamChat'

definePageMeta({
  title: "案件分析",
  layout: "dashboard-layout",
});

const route = useRoute();
const router = useRouter();
const sessionId = computed(() => route.params.sessionId as string);

// 派生状态
const isComplete = ref(false);
const thinkingEnabled = ref(route.query.thinking !== "false");
const panelMode = ref<"left" | "right" | "both">("both");

// 加载线程历史状态
const threadHistory = await useApiFetch<{
  values: Record<string, unknown>;
  threadId: string;
  subAgentThreads?: Array<{
    toolCallId: string;
    agentName: string;
    threadId: string;
    messages: Record<string, unknown>[];
  }>;
}>(`/api/v1/cases/analysis/thread/${sessionId.value}`, {
  showError: false,
});

const stream = useStreamChat({
  apiUrl: "/api/v1/cases/analysis/chat",
  threadId: sessionId.value,
  initialValues: threadHistory?.values ?? undefined,
  initialSubThreads: threadHistory?.subAgentThreads ?? undefined,
});

// 向子组件注入子 Agent 数据访问（供 AiToolRenderer 渲染 ask_*_expert 工具）
provide('subAgentAccess', { subThreadsMap: stream.subThreadsMap })

/** 将原始字典格式消息转为 BaseMessage 实例 */
function coerceRawMessages(rawMessages: any[]): any[] {
  return rawMessages.map((m: any) => {
    if (m.type === "human")
      return new HumanMessage({ content: m.content, id: m.id });
    if (m.type === "ai")
      return new AIMessage({
        content: m.content,
        id: m.id,
        tool_calls: m.tool_calls,
      });
    if (m.type === "tool")
      return new ToolMessage({
        content: m.data?.content ?? m.content,
        tool_call_id: m.data?.tool_call_id ?? m.tool_call_id,
        id: m.data?.id ?? m.id,
      });
    return m;
  });
}

// 历史消息 fallback
const historyMessages = computed(() => {
  const rawMessages = threadHistory?.values?.messages;
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) return [];
  return coerceRawMessages(rawMessages);
});

// 流式消息：补充 stream.values 中的 ToolMessage
const streamMessages = computed(() => {
  const lcMessages = stream.messages.value as any[];
  const rawMessages = (stream.values.value as any)?.messages;

  if (!Array.isArray(lcMessages) || lcMessages.length === 0) {
    if (!Array.isArray(rawMessages) || rawMessages.length === 0) return [];
    return coerceRawMessages(rawMessages);
  }

  if (!Array.isArray(rawMessages)) return lcMessages;

  const result = [...lcMessages];
  const existingIds = new Set(result.map((m: any) => m.id).filter(Boolean));

  for (const raw of rawMessages) {
    if (raw.type === "tool" && !existingIds.has(raw.id)) {
      const aiIdx = result.findLastIndex(
        (m: any) =>
          AIMessage.isInstance(m) &&
          (m as any).tool_calls?.some(
            (tc: any) => tc.id === raw.tool_call_id,
          ),
      );
      const insertAt = aiIdx >= 0 ? aiIdx + 1 : result.length;
      const toolMsg = new ToolMessage({
        content: raw.content,
        tool_call_id: raw.tool_call_id,
        id: raw.id,
      });
      result.splice(insertAt, 0, toolMsg);
      if (raw.id) existingIds.add(raw.id);
    }
  }

  return result;
});

// 最终用于渲染的消息列表
const displayMessages = computed(() =>
  streamMessages.value.length > 0 || stream.isLoading.value
    ? streamMessages.value
    : historyMessages.value,
);

// 任务队列解析
const { todos } = useTaskQueueParser(displayMessages)

// 分析结果
const analysisResults = ref<AnalysisResult[]>([]);
const activeResultIndex = ref(0);

/** 处理 prompt 提交 */
async function handlePromptSubmit(data: AiPromptSubmitData) {
  if (stream.isLoading.value || isComplete.value) return;

  const text = data.text || "开始分析";

  const currentMsgDicts =
    streamMessages.value.length > 0
      ? streamMessages.value.map((m: any) =>
        typeof m.toDict === "function" ? m.toDict() : m,
      )
      : (threadHistory?.values?.messages as any[] ?? []);

  stream.submit(
    { messages: [{ type: "human", content: text }] },
    {
      optimisticValues: () => ({
        messages: [...currentMsgDicts, { type: "human", content: text }],
      }),
    },
  );
}

const handleRegenerate = () => { };

/** 工具中断确认 */
function handleToolConfirm(data: any) {
  stream.submit(undefined, {
    command: { resume: { action: "approve", data } },
  });
}

/** 工具中断拒绝 */
function handleToolReject() {
  stream.submit(undefined, {
    command: { resume: { action: "reject" } },
  });
}

/** 积分充值后恢复 */
function resumeWorkflow() {
  stream.submit(
    { messages: [] } as any,
    { command: { resume: { action: 'continue' } } },
  )
}

const goBack = () => {
  router.push({ name: "dashboard-analysis" });
};

// 页面进入时检查活跃 run，自动重连（包括 interrupted 状态）
onMounted(async () => {
  try {
    const activeRun = await useApiFetch<{ run: { id: string; status: string } | null }>(
      `/api/v1/cases/analysis/runs/current/${sessionId.value}`,
      { showError: false },
    )
    if (
      activeRun?.run &&
      ['pending', 'running', 'interrupted'].includes(activeRun.run.status)
    ) {
      stream.submit({ messages: [] })
    }
  } catch {
    // 查询失败时静默忽略
  }
})
</script>
