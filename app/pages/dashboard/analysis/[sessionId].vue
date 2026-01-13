<template>
  <div class="h-full flex flex-col" style="height: calc(100vh - 48px)">
    <!-- Header 区域 -->
    <div class="h-12 shrink-0 border-b bg-muted/30 text-base font-semibold flex items-center px-4 gap-2">
      <Button variant="ghost" size="icon" class="size-8" @click="goBack">
        <ArrowLeftIcon class="size-4" />
      </Button>
      <div class="flex-1 truncate">{{ caseInfo?.title || "案件分析" }}</div>
      <Badge v-if="caseInfo?.status" variant="secondary" class="text-xs">
        {{ getStatusText(caseInfo.status) }}
      </Badge>
    </div>

    <!-- 加载状态 -->
    <div v-if="isLoading" class="flex-1 flex items-center justify-center">
      <div class="flex flex-col items-center gap-3">
        <Loader2Icon class="size-8 animate-spin text-primary" />
        <span class="text-sm text-muted-foreground">加载案件信息...</span>
      </div>
    </div>

    <!-- 错误状态 -->
    <div v-else-if="loadError" class="flex-1 flex items-center justify-center">
      <div class="flex flex-col items-center gap-3 text-center">
        <AlertCircleIcon class="size-12 text-destructive" />
        <p class="text-sm text-muted-foreground">{{ loadError }}</p>
        <Button variant="outline" size="sm" @click="loadCaseInfo">
          重新加载
        </Button>
      </div>
    </div>

    <!-- 主内容区域 -->
    <ResizablePanelGroup v-else direction="horizontal" class="flex-1 min-h-0">
      <!-- 左侧面板：对话区域 -->
      <ResizablePanel :default-size="50" :min-size="30" class="bg-muted/20">
        <div class="flex flex-col h-full overflow-hidden">
          <!-- 对话消息列表（占据剩余空间） -->
          <div class="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
            <!-- 已完成的消息 -->
            <div v-for="(message, idx) in completedMessages" :key="idx">
              <div class="text-xs text-muted-foreground mb-2">AI 助手</div>
              <AiElementsMessageResponse :content="message" class="prose prose-sm dark:prose-invert max-w-none" />
            </div>

            <!-- 流式文本显示 -->
            <div v-if="streamingText">
              <div class="text-xs text-muted-foreground mb-2">AI 助手</div>
              <AiElementsMessageResponse :content="streamingText" class="prose prose-sm dark:prose-invert max-w-none" />
            </div>

            <!-- 空状态 -->
            <div v-if="completedMessages.length === 0 && !streamingText && !isAnalyzing"
              class="h-full flex items-center justify-center">
              <div class="text-center text-muted-foreground">
                <p class="text-sm">等待开始分析...</p>
              </div>
            </div>
          </div>

          <!-- 任务进度（可折叠） -->
          <Collapsible v-model:open="showTaskList" class="shrink-0 border-t">
            <CollapsibleTrigger
              class="flex items-center justify-between w-full px-4 py-2 hover:bg-muted/50 transition-colors">
              <span class="text-sm font-medium">分析进度</span>
              <Badge variant="outline" class="text-xs">
                {{ completedTaskCount }}/{{ tasks.length }}
              </Badge>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div class="px-4 pb-3">
                <CaseTaskList :tasks="tasks" :show-title="false" :show-progress="true" max-height="150px"
                  @task-click="handleTaskClick" />
              </div>
            </CollapsibleContent>
          </Collapsible>

          <!-- 底部输入区域（固定） -->
          <div class="shrink-0 border-t p-3 bg-background">
            <!-- 中断确认组件 -->
            <CaseInterruptConfirmation v-if="showInterruptConfirmation" :interrupt="currentInterrupt"
              :is-submitting="isSubmittingInterrupt" @submit="handleInterruptSubmit" @cancel="handleInterruptCancel" />

            <!-- 输入框 -->
            <div v-else class="flex items-center gap-2">
              <Textarea v-model="userInput" placeholder="输入补充信息或问题..." class="min-h-[40px] max-h-[120px] resize-none"
                :disabled="isAnalyzing || isComplete" @keydown.enter.exact.prevent="handleSendMessage" />
              <Button size="icon" :disabled="!userInput.trim() || isAnalyzing || isComplete" @click="handleSendMessage">
                <SendIcon class="size-4" />
              </Button>
            </div>

            <!-- 状态提示 -->
            <div v-if="isAnalyzing" class="flex items-center justify-center mt-2">
              <Loader2Icon class="size-4 animate-spin text-primary mr-2" />
              <span class="text-xs text-muted-foreground">AI 正在分析中...</span>
            </div>
            <div v-else-if="isComplete" class="text-center mt-2">
              <span class="text-xs text-muted-foreground">分析已完成</span>
            </div>
          </div>
        </div>
      </ResizablePanel>

      <ResizableHandle with-handle />

      <!-- 右侧面板：分析结果 -->
      <ResizablePanel :default-size="50" :min-size="30">
        <CaseAnalysisResults :results="analysisResults" v-model:active-index="activeResultIndex" :show-regenerate="true"
          :show-copy="true" :is-analyzing="isAnalyzing" class="h-full" @regenerate="handleRegenerate" />
      </ResizablePanel>
    </ResizablePanelGroup>
  </div>
</template>

<script lang="ts" setup>
import type { TaskItem, TaskStatus, AnalysisResult, InterruptData } from "#shared/types/case";
import { CHECKPOINT_TASKS, InterruptType } from "#shared/types/case";
import { ArrowLeftIcon, Loader2Icon, AlertCircleIcon, SendIcon } from "lucide-vue-next";
import { toast } from "vue-sonner";

definePageMeta({
  title: "案件分析",
  layout: "dashboard-layout",
});

const route = useRoute();
const router = useRouter();
const sessionId = computed(() => route.params.sessionId as string);

// 页面状态
const isLoading = ref(true);
const loadError = ref<string | null>(null);
const isSubmittingInterrupt = ref(false);
const showTaskList = ref(false);
const isAnalyzing = ref(false);
const isComplete = ref(false);

// 用户输入
const userInput = ref("");

// 案件信息
const caseInfo = ref<{
  id: number;
  title: string;
  status: number;
  caseTypeId: number;
  caseTypeName?: string;
} | null>(null);

// 任务清单
const tasks = ref<TaskItem[]>([]);

// 消息
const completedMessages = ref<string[]>([]);
const streamingText = ref("");

// 分析结果
const analysisResults = ref<AnalysisResult[]>([]);
const activeResultIndex = ref(0);

// 中断状态
const currentInterrupt = ref<InterruptData | null>(null);
const showInterruptConfirmation = computed(() => currentInterrupt.value !== null);

// AbortController
let abortController: AbortController | null = null;

const completedTaskCount = computed(() => tasks.value.filter((t) => t.status === "completed").length);

function getStatusText(status: number): string {
  const statusMap: Record<number, string> = { 1: "进行中", 2: "已完成", 3: "已关闭" };
  return statusMap[status] || "未知";
}

function initializeTasks() {
  tasks.value = CHECKPOINT_TASKS.map((task) => ({
    ...task,
    status: "pending" as TaskStatus,
  }));
}

/**
 * 解析 AI SDK Data Stream Protocol SSE 格式
 * 格式: data: {"type":"text-delta","id":"...","delta":"..."}
 *
 * @see https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol
 */
function parseUIMessageChunk(line: string): { type: string; data: unknown } | null {
  // 跳过空行和 SSE 注释（以 : 开头）
  if (!line || line.startsWith(":")) return null;

  // AI SDK Data Stream Protocol 使用标准 SSE 格式
  // 每行以 "data: " 开头，后跟 JSON 对象
  if (line.startsWith("data: ")) {
    const jsonStr = line.slice(6); // 移除 "data: " 前缀

    try {
      const parsed = JSON.parse(jsonStr);

      // 解析后的对象包含 type 字段
      if (parsed && typeof parsed === "object" && "type" in parsed) {
        return { type: parsed.type, data: parsed };
      }

      // 如果没有 type 字段，作为通用数据返回
      return { type: "data", data: parsed };
    } catch {
      // JSON 解析失败，返回原始内容
      return { type: "raw", data: jsonStr };
    }
  }

  // 兼容旧格式（类型:内容）
  const colonIndex = line.indexOf(":");
  if (colonIndex > 0 && colonIndex < 3) {
    const type = line.slice(0, colonIndex);
    const content = line.slice(colonIndex + 1);

    try {
      switch (type) {
        case "0": // text-delta
          return { type: "text-delta", data: JSON.parse(content) };
        case "2": // data
          return { type: "data", data: JSON.parse(content) };
        case "9": // error
          return { type: "error", data: JSON.parse(content) };
        case "d": // finish
          return { type: "finish", data: JSON.parse(content) };
        default:
          return { type, data: content };
      }
    } catch {
      return { type, data: content };
    }
  }

  return null;
}

/**
 * 从 data 消息中提取分析结果
 * LangGraph 流式输出的 values 模式会包含完整状态
 * 
 * AI SDK toUIMessageStream 转换后的数据格式可能是：
 * 1. 直接的状态对象 { analysisResults: [...] }
 * 2. 数组格式 [{ analysisResults: [...] }]
 * 3. 嵌套在 data 字段中
 */
function extractAnalysisResultsFromData(data: unknown): AnalysisResult[] {
  if (!data || typeof data !== "object") return [];

  const dataObj = data as Record<string, unknown>;

  // 检查是否直接包含 analysisResults
  if ("analysisResults" in dataObj) {
    const results = dataObj.analysisResults;
    if (Array.isArray(results) && results.length > 0) {
      return results as AnalysisResult[];
    }
  }

  // 检查是否是数组格式（LangGraph values 模式输出）
  if (Array.isArray(data)) {
    for (const item of data) {
      if (item && typeof item === "object" && "analysisResults" in item) {
        const results = (item as Record<string, unknown>).analysisResults;
        if (Array.isArray(results) && results.length > 0) {
          return results as AnalysisResult[];
        }
      }
    }
  }

  // 检查嵌套的 data 字段
  if ("data" in dataObj && dataObj.data && typeof dataObj.data === "object") {
    return extractAnalysisResultsFromData(dataObj.data);
  }

  return [];
}

/**
 * 启动分析流程
 */
async function startAnalysis(options?: { resumeData?: unknown }) {
  if (!caseInfo.value) return;

  if (abortController) {
    abortController.abort();
  }
  abortController = new AbortController();

  isAnalyzing.value = true;
  streamingText.value = "";

  try {
    const response = await fetch(`/api/v1/case/analysis/stream/${caseInfo.value.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: sessionId.value,
        resumeData: options?.resumeData,
      }),
      signal: abortController.signal,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `请求失败: ${response.status}`);
    }

    if (!response.body) {
      throw new Error("响应体为空");
    }

    // 读取 SSE 流
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;

        const chunk = parseUIMessageChunk(trimmedLine);
        if (!chunk) continue;

        // 处理不同类型的消息
        switch (chunk.type) {
          case "text-delta": {
            // AI SDK Data Stream Protocol: text-delta 包含 delta 字段
            const deltaData = chunk.data as { delta?: string; id?: string };
            if (deltaData.delta) {
              streamingText.value += deltaData.delta;
            }
            break;
          }

          case "text-start":
            // 文本块开始，可以用于初始化
            break;

          case "text-end":
            // 文本块结束
            break;

          case "data": {
            // 数据消息，可能包含中断信息或分析结果
            const dataPayload = chunk.data as Record<string, unknown>;

            // 检查中断信息
            if (dataPayload?.__interrupt__) {
              handleInterruptData(dataPayload.__interrupt__);
            }

            // 尝试从 data 中提取分析结果
            const results = extractAnalysisResultsFromData(dataPayload);
            if (results.length > 0) {
              analysisResults.value = results;
              console.log("[SSE] 提取到分析结果:", results.length, "条");
            }
            break;
          }

          case "finish-step":
          case "finish-message":
          case "finish":
            // 消息完成
            if (streamingText.value) {
              completedMessages.value.push(streamingText.value);
              streamingText.value = "";
            }
            break;

          case "error": {
            // 错误消息
            const errorData = chunk.data as { message?: string } | string;
            const errorMsg = typeof errorData === "string"
              ? errorData
              : errorData?.message || "分析过程中发生错误";
            toast.error(errorMsg);
            break;
          }

          default: {
            // 其他类型的消息，也尝试提取分析结果
            if (chunk.data && typeof chunk.data === "object") {
              const results = extractAnalysisResultsFromData(chunk.data);
              if (results.length > 0) {
                analysisResults.value = results;
                console.log("[SSE] 从", chunk.type, "提取到分析结果:", results.length, "条");
              }
            }
          }
        }
      }
    }

    // 流结束
    if (streamingText.value) {
      completedMessages.value.push(streamingText.value);
      streamingText.value = "";
    }

    isAnalyzing.value = false;

    if (!currentInterrupt.value) {
      isComplete.value = true;
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return;
    }

    console.error("分析失败:", error);
    const message = error instanceof Error ? error.message : "分析失败";
    toast.error(message);
    isAnalyzing.value = false;
  }
}

/**
 * 处理中断数据
 */
function handleInterruptData(interruptData: unknown) {
  if (!Array.isArray(interruptData) || interruptData.length === 0) return;

  const interrupt = interruptData[0] as {
    value: Record<string, unknown>;
    resumable: boolean;
    ns?: string[];
  };

  if (!interrupt?.value) return;

  // 从命名空间中提取节点名称
  const node = interrupt.ns?.[0]?.split(":")?.[0] || "unknown";

  // 从 interrupt.value 中提取 type 和 message，其余作为 data
  const { type, message, ...restData } = interrupt.value;

  currentInterrupt.value = {
    type: type as InterruptType,
    message: (message as string) || "",
    data: restData as Record<string, unknown>,
    resumable: interrupt.resumable ?? true,
    node,
  };

  isAnalyzing.value = false;
}

async function loadCaseInfo() {
  if (!sessionId.value) {
    loadError.value = "无效的会话 ID";
    isLoading.value = false;
    return;
  }

  isLoading.value = true;
  loadError.value = null;

  try {
    const data = await useApiFetch<{
      case: {
        id: number;
        title: string;
        status: number;
        caseTypeId: number;
        caseTypeName?: string;
      };
      session: {
        id: number;
        sessionId: string;
        status: number;
      };
    }>(`/api/v1/case/session/${sessionId.value}`);

    if (!data) {
      throw new Error("案件不存在");
    }

    caseInfo.value = data.case;
    initializeTasks();
    isLoading.value = false;

    // 检查 sessionStorage 中的材料数据
    const storedMaterials = sessionStorage.getItem(`analysis_materials_${sessionId.value}`);
    if (storedMaterials) {
      sessionStorage.removeItem(`analysis_materials_${sessionId.value}`);
      const materialData = JSON.parse(storedMaterials);
      await startAnalysis({ resumeData: materialData });
    } else {
      await startAnalysis();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "加载案件信息失败";
    loadError.value = message;
    isLoading.value = false;
    toast.error(message);
  }
}

async function handleInterruptSubmit(data: unknown) {
  isSubmittingInterrupt.value = true;

  try {
    currentInterrupt.value = null;
    await startAnalysis({ resumeData: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "提交失败";
    toast.error(message);
  } finally {
    isSubmittingInterrupt.value = false;
  }
}

function handleInterruptCancel() {
  currentInterrupt.value = null;
  isAnalyzing.value = false;
  toast.info("已取消当前操作");
}

function handleTaskClick(task: TaskItem) {
  if (task.status === "completed" && task.resultId !== undefined) {
    const index = analysisResults.value.findIndex((r) => r.nodeId === task.resultId);
    if (index >= 0) {
      activeResultIndex.value = index;
    }
  }
}

async function handleRegenerate(_result: AnalysisResult) {
  toast.info("重新生成功能开发中");
}

/**
 * 发送用户消息
 */
async function handleSendMessage() {
  const message = userInput.value.trim();
  if (!message || isAnalyzing.value || isComplete.value) return;

  // 清空输入框
  userInput.value = "";

  // 添加用户消息到已完成消息列表
  completedMessages.value.push(`**用户**: ${message}`);

  // 发送消息继续分析
  await startAnalysis({ resumeData: message });
}

function goBack() {
  router.push("/dashboard/analysis");
}

function stopAnalysis() {
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
  isAnalyzing.value = false;
}

onMounted(() => {
  loadCaseInfo();
});

onUnmounted(() => {
  stopAnalysis();
});
</script>

<style></style>
