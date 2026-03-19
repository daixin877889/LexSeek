<template>
  <div class="h-full flex flex-col" style="height: calc(100vh - 48px)">
    <!-- Header 区域 -->
    <div class="h-12 shrink-0 border-b bg-muted/30 text-base font-semibold flex items-center px-4 gap-2">
      <Button variant="ghost" size="icon" class="size-8" @click="goBack">
        <ArrowLeftIcon class="size-4" />
      </Button>
      <div class="flex-1 truncate">{{ "案件分析" }}</div>
      <Badge v-if="caseInfo?.status" variant="secondary" class="text-xs">
        {{ getStatusText(1) }}
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

            <AiElementsConversation>
              <AiElementsConversationContent class="">

                <template v-for="(message, msgIndex) in chat.messages" :key="message.id">
                  <template v-for="(part, partIndex) in message.parts" :key="message.id + ':' + partIndex">
                    <AiElementsMessage :from="message.role">

                      <!-- 思考消息 -->
                      <AiElementsReasoning v-if="part.type === 'reasoning'" :is-streaming="part.state === 'streaming'">
                        <AiElementsReasoningTrigger />
                        <AiElementsReasoningContent :content="part.text" />
                      </AiElementsReasoning>

                      <!-- 文本消息 - 使用 MessageResponse 来渲染 markdown -->
                      <AiElementsMessageContent v-if="part.type === 'text'">
                        <AiElementsMessageResponse :content="part.text" />
                      </AiElementsMessageContent>
                    </AiElementsMessage>
                  </template>
                </template>


              </AiElementsConversationContent>
              <AiElementsConversationScrollButton />
            </AiElementsConversation>


          </div>
          <!-- 任务进度（可折叠） -->
          <Collapsible v-model:open="showTaskList" class="shrink-0 border-t">
            <CollapsibleTrigger
              class="flex items-center justify-between w-full px-4 py-2 hover:bg-muted/50 transition-colors">
              <span class="text-sm font-medium">分析进度</span>
              <Badge variant="outline" class="text-xs">
                {{Todos.filter(todo => todo.status === 'completed').length}}/{{ Todos.length }}
              </Badge>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div class="px-4 pb-3">

                <AiElementsQueue>
                  <AiElementsQueueSection>
                    <AiElementsQueueItem v-for="todo in Todos" :key="todo.id">
                      <!-- <AiElementsQueueItemIndicator :completed="todo.status === 'completed'" />
                      <AiElementsQueueItemContent>{{ todo.title }}</AiElementsQueueItemContent> -->
                      <AiElementsQueueItemContent :completed="todo.status === 'completed'">
                        <AiElementsQueueItemIndicator :completed="todo.status === 'completed'" />
                        {{ todo.title }}
                      </AiElementsQueueItemContent>

                    </AiElementsQueueItem>
                  </AiElementsQueueSection>
                </AiElementsQueue>



                <!-- <CaseTaskList :tasks="tasks" :show-title="false" :show-progress="true" max-height="150px"
                  @task-click="handleTaskClick" /> -->
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
            <!-- <div v-else-if="isComplete" class="text-center mt-2">
              <span class="text-xs text-muted-foreground">分析已完成</span>
            </div> -->
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
import type { TaskItem, AnalysisResult, InterruptData } from "#shared/types/case";
import { CHECKPOINT_TASKS, InterruptType } from "#shared/types/case";
import { ArrowLeftIcon, Loader2Icon, AlertCircleIcon, SendIcon } from "lucide-vue-next";
import { toast } from "vue-sonner";
import { Chat } from '@ai-sdk/vue'
import type { UIMessage } from 'ai'
import { DefaultChatTransport, generateId } from 'ai'

definePageMeta({
  title: "案件分析",
  layout: "dashboard-layout",
});

const route = useRoute();
const router = useRouter();
const sessionId = computed(() => route.params.sessionId as string);

interface QueueTodo {
  id: string
  title: string
  description?: string
  status?: 'pending' | 'in_progress' | 'completed'
}

interface WriteTodos {
  type: string
  toolName: string
  toolCallId: string
  state: string
  input: { todos: { content: string, status: 'pending' | 'in_progress' | 'completed' }[] }
}

const Todos: QueueTodo[] = reactive([])

// 跟踪当前处理的 todos 所在消息 ID，用于多轮对话时清空旧列表
let lastTodosMessageId: string | null = null

// 防抖：避免 deep watch 每个 token 都触发列表更新
let updatePending = false
let pendingWriteTodos: WriteTodos | null = null
let pendingMessageId: string | null = null

const updateTodos = (inputTodos: WriteTodos) => {
  inputTodos.input.todos.forEach((item, index) => {
    if (index < Todos.length) {
      // 原地更新属性，避免替换整个对象触发列表重新渲染
      const todo = Todos[index]
      if (todo) {
        todo.title = item.content
        todo.status = item.status
      }
    } else {
      Todos.push({
        id: String(index),
        title: item.content,
        status: item.status
      })
    }
  })
}


const testMessages: any = reactive([
  {
    "parts": [
      {
        "type": "text",
        "text": "开始分析"
      }
    ],
    "id": "AxH8Uw9F19bgBhxx",
    "role": "user"
  },
  {
    "id": "Xajomp9zHhwsLEt5",
    "role": "assistant",
    "parts": [
      {
        "type": "step-start"
      },
      {
        "type": "reasoning",
        "text": "用户提供了一个关于二手车买卖合同纠纷的详细案例。原告（买家）与被告（卖家，宝马官方二手车）之间产生了争议。用户很可能希望我以专业律师的身份，分析这个案件的法律问题，评估原告的诉求是否合理，并提供法律建议。也可能需要起草法律文书，比如律师函或起诉状。\n\n首先，我需要梳理一下案件事实和时间线：\n- 2021年5月：原告在宝马官方二手车网站看中一辆宝马330Li xDrive，总价37万。5月22日支付1万元定金。5月29日支付首付款18.3万元并签订合同，约定6月5日提车。\n- 2021年6月3日：被告告知因售价过低无法开票，需走集团流程申请。提车日期推迟至6月8日。\n- 2021年6月7日：被告告知合格证已被使用，无法开具发票，需与厂家沟通。后又称税务系统升级导致无法开票，无具体解决时间。\n- 2021年6月11日：双方协商暂时退还18.8万元，保留5000元定金，合同继续履行。\n- 2021年7月10日：原告到店咨询，被告仍无法给出提车时间和具体原因。原告提出7月16日前必须提车，否则中止合同，并要求双倍返还定金（根据民法典第587条），同时赔偿41天的用车损失。被告只同意退车，不接受赔偿。\n- 2021年7月24日：被告拒绝双倍返还定金和赔偿用车损失，只愿支付5000-8000元赔偿。\n\n接下来，我需要分析其中的法律问题：\n1. 定金罚则：根据民法典第587条，收受定金的一方不履行债务，致使不能实现合同目的的，应当双倍返还定金。本案中，原告支付了1万元定金，合同约定6月5日提车。被告因自身原因（无法开票）导致无法按时交车，构成违约。原告在7月10日提出新的履行期限（7月16日），并明确告知若无法履行将中止合同，适用定金罚则。这符合法律规定。\n2. 用车损失：原告要求赔偿从6月5日到7月16日共41天的用车损失。这属于因被告违约造成的实际损失，可能包括交通费、租赁替代车辆的费用等。原告需要提供证据证明损失的实际发生和具体金额。\n3. 合同中止：原告提出若7月16日前无法提车则中止合同。这符合民法典第563条关于预期违约的规定，当一方明确表示或以行为表明不履行主要债务时，另一方可以解除合同。\n4. 被告的抗辩：被告声称无法开票是由于售价过低、合格证被使用、税务系统升级等原因。但这些都属于被告自身或第三方原因，不能作为免责事由。根据民法典第577条，当事人一方不履行合同义务或者履行合同义务不符合约定的，应当承担继续履行、采取补救措施或者赔偿损失等违约责任。\n5. 赔偿金额：被告只愿支付5000-8000元赔偿，这远低于原告的双倍定金（2万元）和用车损失。双方差距较大。\n\n现在，我需要考虑用户的具体需求。用户可能希望我：\n- 提供法律意见，分析原告的胜诉可能性。\n- 起草一份律师函，正式向被告主张权利。\n- 起草起诉状，准备诉讼。\n- 计算具体的赔偿金额。\n\n我应该先询问用户的具体需求，但作为律师，我可以主动提供全面的分析。考虑到这是一个复杂的案件，涉及多个步骤（分析法律问题、评估证据、计算损失、起草文书等），使用`write_todos`工具来管理任务是比较合适的。这样可以确保不遗漏任何环节，并向用户展示清晰的进度。\n\n那么，我将创建以下待办事项：\n1. 梳理案件事实与时间线。\n2. 分析法律问题与适用法规。\n3. 评估原告的诉求与证据。\n4. 计算可能的赔偿金额。\n5. 起草律师函（或根据用户需求调整）。\n6. 提供后续行动建议。\n\n在创建待办事项后，我将立即开始第一项任务：梳理案件事实与时间线。我会标记为“进行中”。然后，我将基于已有信息进行分析，并逐步完成其他任务。过程中可能会根据用户反馈调整任务列表。\n\n现在，开始创建待办事项。",
        "state": "streaming"
      },
      {
        "type": "dynamic-tool",
        "toolName": "write_todos",
        "toolCallId": "call_00_OziafNxoXL2QgScPlQTyXDcu",
        "state": "input-streaming",
        "input": {
          "todos": [
            {
              "content": "梳理案件事实与时间线，整理关键证据点",
              "status": "in_progress"
            },
            {
              "content": "分析法律问题与适用法规（民法典定金罚则、违约责任、合同解除等）",
              "status": "pending"
            },
            {
              "content": "评估原告的诉求合理性及证据充分性",
              "status": "pending"
            },
            {
              "content": "计算可能的赔偿金额（双倍定金、用车损失等）",
              "status": "pending"
            },
            {
              "content": "起草律师函或法律意见书",
              "status": "pending"
            },
            {
              "content": "提供后续行动建议（协商、调解、诉讼等）",
              "status": "pending"
            }
          ]
        }
      },
      {
        "type": "step-start"
      },
      {
        "type": "reasoning",
        "text": "现在，我开始梳理案件事实与时间线。我将以更清晰的方式呈现，并标注关键法律事实。",
        "state": "streaming"
      },
      {
        "type": "text",
        "text": "根据您提供的信息，我已梳理本案基本事实与时间线如下：\n\n### **案件事实梳理**\n\n| 时间 | 事件 | 关键事实与法律意义 |\n| :--- | :--- | :--- |\n| **2021年5月** | 原告在宝马官方二手车网站看中**宝马3系长轴距版 330Li xDrive**，车辆状态为**未上牌**，总价**37万元**。 | 合同标的物明确，属于新车或准新车（未上牌）。 |\n| **2021年5月22日** | 原告缴纳**1万元定金**。 | 成立定金合同，适用定金罚则（《民法典》第586、587条）。 |\n| **2021年5月29日** | 原告到店支付**首付款18.3万元**，并**签订合同**，约定**2021年6月5日提车**。 | 主合同成立并生效，履行期限明确。 |\n| **2021年6月3日** | 被告告知因**售价过低，无法开票**，需走集团流程申请，提车日改至**6月8日**。 | **第一次违约**，单方变更合同履行期限。原因系被告内部或定价问题，不构成法定免责事由。 |\n| **2021年6月7日** | 被告再次告知**合格证已被使用，无法开具发票**，后称因**税务系统升级**，无具体解决时间。 | **第二次违约**，且无法提供确定解决方案，构成迟延履行。 |\n| **2021年6月11日** | 双方协商：暂时退还**18.8万元**，保留**5000元定金**，合同继续履行。 | 原告作出让步，同意变更部分履行方式，但未放弃追究违约责任的权利。 |\n| **2021年7月10日** | 原告到店咨询，被告仍无法给出提车时间与原因。原告提出**最后履行期限（7月16日）**，并声明若无法提车则**中止合同**，并要求：<br>1. 双倍返还定金（依据《民法典》第587条）；<br>2. 赔偿**41天（6月5日-7月16日）的用车损失**。 | 原告给予被告**合理宽限期**，并行使**不安抗辩权**或提出**预期违约**的主张。此为明确的催告与权利主张。 |\n| **2021年7月24日** | 被告拒绝双倍返还定金、拒绝赔偿用车损失，只愿支付**5000-8000元赔偿**。 | 双方未能达成和解，被告的赔偿方案远低于法定标准，争议进入僵局。 |\n\n### **初步证据清单（根据现有陈述推断）**\n1. **定金支付凭证**（1万元）\n2. **首付款支付凭证**（18.3万元）\n3. **书面购车合同**（约定车型、价款、交付日期为2021年6月5日）\n4. **双方沟通记录**（关于无法开票、延期、协商退款等，微信、短信或邮件）\n5. **2021年6月11日部分退款记录**（18.8万元）\n6. **2021年7月10日及7月24日协商的沟通记录**（原告提出最终要求及被告拒绝赔偿的记录）\n\n---\n**当前任务状态更新：** 事实梳理完成，将转入法律分析。<｜end▁of▁thinking｜>",
        "state": "streaming"
      },
      {
        "type": "dynamic-tool",
        "toolName": "write_todos",
        "toolCallId": "call_00_soGRppYWLGt1uSWS3WhXNOJJ",
        "state": "input-streaming",
        "input": {
          "todos": [
            {
              "content": "梳理案件事实与时间线，整理关键证据点",
              "status": "completed"
            },
            {
              "content": "分析法律问题与适用法规（民法典定金罚则、违约责任、合同解除等）",
              "status": "in_progress"
            },
            {
              "content": "评估原告的诉求合理性及证据充分性",
              "status": "pending"
            },
            {
              "content": "计算可能的赔偿金额（双倍定金、用车损失等）",
              "status": "pending"
            },
            {
              "content": "起草律师函或法律意见书",
              "status": "pending"
            },
            {
              "content": "提供后续行动建议（协商、调解、诉讼等）",
              "status": "pending"
            }
          ]
        }
      },
      {
        "type": "step-start"
      },
      {
        "type": "reasoning",
        "text": "接下来，我将分析法律问题与适用法规。这包括民法典中关于定金、违约责任、合同解除等条款。我将引用具体法条，并结合本案事实进行分析。同时，我也会考虑相关司法解释和司法实践。现在，开始撰写分析部分。",
        "state": "streaming"
      },
      {
        "type": "text",
        "text": "**案件事实与时间线梳理**\n\n| 时间 | 事件 | 法律性质 |\n|------|------|----------|\n| 2021年5月 | 原告在宝马官方二手车网站看中宝马330Li xDrive，总价37万 | 要约邀请/要约 |\n| 2021年5月22日 | 原告支付1万元定金 | 定金合同成立 |\n| 2021年5月29日 | 原告支付首付款18.3万元并签订正式合同，约定2021年6月5日提车 | 主合同成立，履行期限确定 |\n| 2021年6月3日 | 被告告知“售价过低无法开票”，需走集团流程，提车日推迟至6月8日 | 第一次违约（迟延履行） |\n| 2021年6月7日 | 被告告知“合格证已被使用，无法开具发票”，后称“税务系统升级”，无解决时间 | 第二次违约（履行不能风险） |\n| 2021年6月11日 | 双方协商：暂时退还18.8万元，保留5000定金，合同继续履行 | 合同变更（部分退款，保留定金） |\n| 2021年7月10日 | 原告到店咨询，被告仍无法给出提车时间与原因；原告提出“7月16日前提车，否则中止合同，并要求双倍定金+41天用车损失” | 原告行使不安抗辩权/设定最终履行期限 |\n| 2021年7月24日 | 被告拒绝双倍定金与用车损失，只愿支付5000-8000元赔偿 | 被告拒绝承担法定违约责任 |\n\n**关键证据点**\n1. 定金支付凭证（1万元）\n2. 购车合同（约定价款、交车日期）\n3. 首付款支付凭证（18.3万元）\n4. 被告多次延期/无法履行的沟通记录（微信、短信、邮件等）\n5. 2021年6月11日部分退款18.8万元的记录\n6. 2021年7月10日原告提出最终期限的沟通记录\n7. 2021年7月24日协商赔偿的沟通记录\n\n---\n\n## **二、法律问题与适用法规分析**\n\n### **1. 定金罚则适用性（《民法典》第587条）**\n> **第五百八十七条** 债务人履行债务的，定金应当抵作价款或者收回。给付定金的一方不履行债务或者履行债务不符合约定，致使不能实现合同目的的，无权请求返还定金；**收受定金的一方不履行债务或者履行债务不符合约定，致使不能实现合同目的的，应当双倍返还定金。**\n\n**适用分析**：\n- 原告已支付1万元定金，合同目的为“2021年6月5日提车”。\n- 被告因自身原因（无法开票）导致无法按期交车，已构成“履行债务不符合约定”。\n- 2021年7月10日原告设定最终履行期限（7月16日），属于给予被告额外宽限期。宽限期届满后被告仍无法履行，合同目的已不能实现。\n- **结论**：被告作为收受定金的一方，应双倍返还定金（即2万元）。\n\n### **2. 违约责任的承担（《民法典》第577条、第584条）**\n> **第五百七十七条** 当事人一方不履行合同义务或者履行合同义务不符合约定的，应当承担继续履行、采取补救措施或者赔偿损失等违约责任。  \n> **第五百八十四条** 当事人一方不履行合同义务或者履行合同义务不符合约定，造成对方损失的，损失赔偿额应当相当于因违约所造成的损失，包括合同履行后可以获得的利益；但是，不得超过违约方订立合同时预见到或者应当预见到的因违约可能造成的损失。\n\n**适用分析**：\n- 被告的违约行为包括：迟延履行（6月5日未交车）、经催告后在宽限期内仍不履行（7月16日前未交车）。\n- 原告的损失包括：\n  - **实际损失**：41天的用车损失（如交通费、租车费等）。\n  - **可得利益损失**：车辆使用价值（但需举证）。\n- 被告声称“售价过低”“合格证已被使用”“税务系统升级”等，均属其自身或第三方原因，**不构成法定免责事由**（《民法典》第590条规定的不可抗力除外）。\n\n### **3. 合同解除权的行使（《民法典》第563条）**\n> **第五百六十三条** 有下列情形之一的，当事人可以解除合同：  \n> （一）因不可抗力致使不能实现合同目的；  \n> （二）在履行期限届满前，当事人一方明确表示或者以自己的行为表明不履行主要债务；  \n> （三）当事人一方迟延履行主要债务，经催告后在合理期限内仍未履行；  \n> （四）当事人一方迟延履行债务或者有其他违约行为致使不能实现合同目的；  \n> ……\n\n**适用分析**：\n- 被告迟延履行主要债务（交车），经原告催告（7月10日设定7月16日为最终期限）后仍未履行，原告有权解除合同。\n- 原告在7月10日提出的“中止合同”实质为解除合同的意思表示。\n\n### **4. 部分退款后的定金效力**\n- 2021年6月11日双方协商“暂时退还18.8万元，保留5000定金”。该行为可解释为：\n  - 原1万元定金中，5000元仍作为担保合同履行的定金，其余5000元转为预付款（已退还）。\n  - **法律效果**：保留的5000元仍适用定金罚则。若因被告原因导致合同解除，被告应双倍返还该5000元（即1万元）。\n\n### **5. 被告的赔偿方案（5000-8000元）是否合理**\n- 被告提出的赔偿金额远低于法定标准（双倍定金1万元+用车损失）。\n- 该方案无法律依据，属于试图以较低成本了结纠纷，原告不宜接受。\n\n---<｜end▁of▁thinking｜>",
        "state": "streaming"
      },
      {
        "type": "dynamic-tool",
        "toolName": "write_todos",
        "toolCallId": "call_00_Jwcr95a5rERvl5wMVFGHegUD",
        "state": "input-streaming",
        "input": {
          "todos": [
            {
              "content": "梳理案件事实与时间线，整理关键证据点",
              "status": "completed"
            },
            {
              "content": "分析法律问题与适用法规（民法典定金罚则、违约责任、合同解除等）",
              "status": "completed"
            },
            {
              "content": "评估原告的诉求合理性及证据充分性",
              "status": "in_progress"
            },
            {
              "content": "计算可能的赔偿金额（双倍定金、用车损失等）",
              "status": "pending"
            },
            {
              "content": "起草律师函或法律意见书",
              "status": "pending"
            },
            {
              "content": "提供后续行动建议（协商、调解、诉讼等）",
              "status": "pending"
            }
          ]
        }
      },
      {
        "type": "step-start"
      },
      {
        "type": "reasoning",
        "text": "现在评估原告的诉求合理性及证据充分性。这包括分析原告提出的双倍定金返还、用车损失赔偿等诉求是否合理，以及需要哪些证据来支持。同时，也要考虑被告可能的抗辩理由。现在开始撰写评估部分。",
        "state": "streaming"
      },
      {
        "type": "dynamic-tool",
        "toolName": "write_todos",
        "toolCallId": "call_00_hgX2TkikRZbtJDdL04EPpMIC",
        "state": "input-streaming",
        "input": {
          "todos": [
            {
              "content": "梳理案件事实与时间线，整理关键证据点",
              "status": "completed"
            },
            {
              "content": "分析法律问题与适用法规（民法典定金罚则、违约责任、合同解除等）",
              "status": "completed"
            },
            {
              "content": "评估原告的诉求合理性及证据充分性",
              "status": "completed"
            },
            {
              "content": "计算可能的赔偿金额（双倍定金、用车损失等）",
              "status": "in_progress"
            },
            {
              "content": "起草律师函或法律意见书",
              "status": "pending"
            },
            {
              "content": "提供后续行动建议（协商、调解、诉讼等）",
              "status": "pending"
            }
          ]
        }
      },
      {
        "type": "step-start"
      },
      {
        "type": "reasoning",
        "text": "接下来计算可能的赔偿金额。这包括双倍定金（1万元定金，双倍即2万元）和用车损失（41天）。用车损失的计算需要依据，例如当地汽车租赁市场价格或实际产生的交通费用。我将提供一个估算范围。现在开始计算。",
        "state": "streaming"
      },
      {
        "type": "dynamic-tool",
        "toolName": "write_todos",
        "toolCallId": "call_00_8mCta0jvbOeZBEvBNAGglvId",
        "state": "input-streaming",
        "input": {
          "todos": [
            {
              "content": "梳理案件事实与时间线，整理关键证据点",
              "status": "completed"
            },
            {
              "content": "分析法律问题与适用法规（民法典定金罚则、违约责任、合同解除等）",
              "status": "completed"
            },
            {
              "content": "评估原告的诉求合理性及证据充分性",
              "status": "completed"
            },
            {
              "content": "计算可能的赔偿金额（双倍定金、用车损失等）",
              "status": "completed"
            },
            {
              "content": "起草律师函或法律意见书",
              "status": "in_progress"
            },
            {
              "content": "提供后续行动建议（协商、调解、诉讼等）",
              "status": "pending"
            }
          ]
        }
      },
      {
        "type": "step-start"
      },
      {
        "type": "reasoning",
        "text": "现在开始起草律师函。律师函需要正式、专业，包含案件事实、法律分析、具体诉求和最后通牒。我将根据之前分析的内容来撰写。完成后，再提供后续行动建议。",
        "state": "streaming"
      },
      {
        "type": "dynamic-tool",
        "toolName": "write_todos",
        "toolCallId": "call_00_7k8Gx5VrSedpywHP9Fk1AA2R",
        "state": "input-streaming",
        "input": {
          "todos": [
            {
              "content": "梳理案件事实与时间线，整理关键证据点",
              "status": "completed"
            },
            {
              "content": "分析法律问题与适用法规（民法典定金罚则、违约责任、合同解除等）",
              "status": "completed"
            },
            {
              "content": "评估原告的诉求合理性及证据充分性",
              "status": "completed"
            },
            {
              "content": "计算可能的赔偿金额（双倍定金、用车损失等）",
              "status": "completed"
            },
            {
              "content": "起草律师函或法律意见书",
              "status": "completed"
            },
            {
              "content": "提供后续行动建议（协商、调解、诉讼等）",
              "status": "in_progress"
            }
          ]
        }
      },
      {
        "type": "step-start"
      },
      {
        "type": "reasoning",
        "text": "现在提供后续行动建议，包括协商、调解、诉讼等选项，并分析每种方式的利弊。同时，提醒用户注意诉讼时效（三年）和证据收集。现在开始撰写建议部分。",
        "state": "streaming"
      },
      {
        "type": "dynamic-tool",
        "toolName": "write_todos",
        "toolCallId": "call_00_mwOeJbIE7igjDm9h2qj9sw45",
        "state": "input-streaming",
        "input": {
          "todos": [
            {
              "content": "梳理案件事实与时间线，整理关键证据点",
              "status": "completed"
            },
            {
              "content": "分析法律问题与适用法规（民法典定金罚则、违约责任、合同解除等）",
              "status": "completed"
            },
            {
              "content": "评估原告的诉求合理性及证据充分性",
              "status": "completed"
            },
            {
              "content": "计算可能的赔偿金额（双倍定金、用车损失等）",
              "status": "completed"
            },
            {
              "content": "起草律师函或法律意见书",
              "status": "completed"
            },
            {
              "content": "提供后续行动建议（协商、调解、诉讼等）",
              "status": "completed"
            }
          ]
        }
      },
      {
        "type": "step-start"
      },
      {
        "type": "reasoning",
        "text": "现在，我将把所有分析内容整合成一份完整的法律意见，呈现给用户。这包括事实梳理、法律分析、诉求评估、赔偿计算、律师函草稿和后续建议。我会以清晰、专业的方式组织内容。\n\n首先，我需要确认一下，用户是否希望我以特定格式（如Word文档）提供，还是直接在此处呈现。考虑到目前的环境，我直接在此处提供详细分析。\n\n现在，开始输出最终的法律分析报告。",
        "state": "streaming"
      },
      {
        "type": "text",
        "text": "## **案件事实与时间线梳理**\n\n| 时间 | 事件 | 关键事实与证据点 |\n| :--- | :--- | :--- |\n| **2021年5月** | 原告在宝马官方二手车网站看中车辆（宝马3系长轴距版 330Li xDrive），总价37万。 | 车辆状态为“未上牌”。此为网络展示证据。 |\n| **2021年5月22日** | 原告支付 **1万元定金**。 | 支付凭证、定金收据是关键证据。 |\n| **2021年5月29日** | 原告支付首付款 **18.3万元**，并**签订购车合同**，约定 **2021年6月5日提车**。 | 购车合同、首付款支付凭证是核心证据。合同应明确交车时间、违约责任。 |\n| **2021年6月3日** | 被告通知：售价过低，无法开票，需走集团流程。双方同意将提车日改为 **6月8日**。 | 被告首次违约。沟通记录（微信、短信、邮件）是证明被告承认无法按时履约的证据。 |\n| **2021年6月7日** | 被告再次通知：合格证已被使用，无法开票。后又称税务系统升级导致，无解决时间。 | 被告违约事由多次变更，证明其根本无履约能力或诚意。 |\n| **2021年6月11日** | 双方协商：被告暂时退还18.8万元，**保留5000元定金**，合同继续履行。 | 此协议至关重要，表明：1) 合同未解除；2) 5000元定金性质仍为“定金”，适用定金罚则。 |\n| **2021年7月10日** | 原告到店，被告仍无法给出解决方案。原告提出最后通牒：**7月16日前提车**，否则中止合同，并主张双倍定金及41天用车损失。 | 原告行使了《民法典》规定的“催告”和“合理期限”权利。此沟通记录是主张解除合同及违约责任的关键。 |\n| **2021年7月24日** | 被告拒绝双倍定金及用车损失赔偿，仅愿赔偿5000-8000元。 | 双方协商破裂，被告明确拒绝承担法定违约责任。 |\n\n---\n\n## **法律问题分析与适用法规**\n\n**核心法律争议：** 被告迟延履行且经催告后在合理期限内仍未履行，原告是否有权解除合同并要求双倍返还定金及赔偿损失？\n\n**1. 关于定金罚则（《民法典》第587条）**\n- **法条**：“债务人履行债务的，定金应当抵作价款或者收回。给付定金的一方不履行债务或者履行债务不符合约定，致使不能实现合同目的的，无权请求返还定金；收受定金的一方不履行债务或者履行债务不符合约定，致使不能实现合同目的的，应当双倍返还定金。”\n- **适用分析**：\n  - 本案定金为 **1万元**，后经协商变更为 **5000元**。这5000元在法律性质上仍属“定金”。\n  - 被告作为收受定金方，因自身原因（无法开票）导致无法按期交车，已构成违约。在原告给予宽限期（至7月16日）后，被告仍无法履行，**致使原告购车的合同目的完全无法实现**。\n  - 因此，被告的行为完全符合“收受定金的一方不履行债务，致使不能实现合同目的”的情形，原告有权要求其 **双倍返还定金**（即5000元×2 = 1万元）。\n\n**2. 关于合同解除（《民法典》第563条）**\n- **法条**：有下列情形之一的，当事人可以解除合同：（三）当事人一方迟延履行主要债务，经催告后在合理期限内仍未履行。\n- **适用分析**：\n  - 被告的交车义务是合同的主要债务。\n  - 原告在7月10日明确要求被告在7月16日前履行，这构成了合法的“催告”并给予了“合理期限”。\n  - 被告在7月24日明确表示无法按此期限履行，原告因此取得合同的法定解除权。原告可以书面通知被告解除合同。\n\n**3. 关于违约损害赔偿（《民法典》第584条）**\n- **法条**：“当事人一方不履行合同义务或者履行合同义务不符合约定，造成对方损失的，损失赔偿额应当相当于因违约所造成的损失，包括合同履行后可以获得的利益；但是，不得超过违约一方订立合同时预见到或者应当预见到的因违约可能造成的损失。”\n- **适用分析**：\n  - 原告主张的“用车损失”属于因被告违约造成的 **实际损失**。由于被告迟延交车，原告在本应有车使用的41天内，不得不寻求其他交通方式，产生了额外的费用或损失。\n  - 该损失是被告在订立合同时应当预见到的（购买车辆就是为了使用）。原告需要提供证据证明该损失的 **具体计算依据**（如租赁同档次车辆的市场日租金）。\n\n**4. 关于被告的抗辩理由**\n- 被告提出的“售价过低无法开票”、“合格证已使用”、“税务系统升级”等理由，均属于其 **自身经营风险或与第三方之间的纠纷**，不能对抗作为善意买家的原告。根据合同相对性原则，被告应向原告承担违约责任后，再向其过错方追偿。\n\n---\n\n## **原告诉求合理性及证据充分性评估**\n\n| 原告诉求 | 法律依据 | 合理性评估 | 所需关键证据 |\n| :--- | :--- | :--- | :--- |\n| **1. 解除《购车合同》** | 《民法典》第563条 | **完全合理**。被告根本违约，合同目的已无法实现。 | 1. 《购车合同》原件<br>2. 证明被告违约及原告催告的沟通记录（微信/短信/邮件/录音）<br>3. 7月24日被告拒绝履行的沟通记录。 |\n| **2. 双倍返还定金（1万元）** | 《民法典》第587条 | **完全合理**。事实清楚，法律适用明确。 | 1. 1万元定金支付凭证<br>2. 6月11日协议中“保留5000元定金”的书面或记录证据<br>3. 证明被告违约导致合同目的落空的证据。 |\n| **3. 赔偿41天用车损失** | 《民法典》第584条 | **合理，但需量化证明**。损失客观存在，但金额需有依据。 | 1. 当地汽车租赁市场关于同档次（宝马3系）车辆日租金的官方报价或市场公允价证明。<br>2. 原告因无车使用实际产生的额外交通费用票据（如打车、租车发票）。<br>*建议以市场日租金为计算标准更具说服力。* |\n| **4. 返还已支付的首付款18.3万元** | 《民法典》第566条 | **完全合理**。合同解除后，被告收取的购车款应予返还。 | 18.3万元的首付款支付凭证。 |\n\n**证据链完整性评估：** 从现有描述看，原告的证据链较为完整，关键在于将 **所有沟通记录**（尤其是能证明被告承认违约、原告进行催告的记录）进行 **公证或完整保存**。书面合同和付款凭证是基础，沟通记录是证明违约过程和原告已尽催告义务的核心。\n\n---\n\n## **赔偿金额计算参考**\n\n1.  **定金罚则部分**：5000元 × 2 = **10,000元**。\n2.  **用车损失部分（估算）**：\n    - 需以证据证明的日损失金额为准。可参考事发地（如北京、上海）2021年宝马3系同档次车辆的日均租赁费用。\n    - 假设市场公允日租金为 **600元/天**（此为示例，需举证），则41天的损失为：600元/天 × 41天 = **24,600元**。\n    - 如果原告能提供实际租车或产生额外交通费用的票据，则以票据金额为准。\n3.  **款项返还部分**：**183,000元**（首付款）。\n4.  **总计被告应支付/返还金额**：10,000（双倍定金） + 24,600（用车损失） + 183,000（首付款） = **217,600元**。\n    *注：此计算未包含可能主张的利息损失（资金占用费）。*\n\n**与被告方案对比**：被告仅愿支付5000-8000元，远低于法定最低赔偿额（双倍定金1万元），更未覆盖原告的实际损失，该方案显失公平，不应接受。\n\n---\n\n## **律师函（草案）**\n\n**致：[被告公司全称]**\n**发函人：[原告姓名] 代理律师**\n**日期：2021年7月[ ]日**\n**事由：关于贵司严重违反《车辆买卖合同》事宜的正式催告与索赔函**\n\n尊敬的[被告公司负责人",
        "state": "streaming"
      }
    ]
  }
])



// 派生状态
const isAnalyzing = ref(false)
const isComplete = ref(false)

// 正确的用法：直接使用 chat 实例
const chat = new Chat<UIMessage>({
  id: sessionId.value,
  generateId,
  transport: new DefaultChatTransport({
    api: '/api/v1/case/analysis/stream/' + sessionId.value,
  }),
  onData: (data) => {
    console.log('onData 触发:', data)
    console.log('onData - messages:', chat.messages)
  },
  onFinish: (data) => {
    console.log('onFinish 触发:', data)
    console.log('onFinish - messages:', chat.messages)
  },
  onError: (error) => {
    toast.error('分析失败：' + error.message)
    console.error('[analysis] stream error', error)
  }
})

// 从 chat 实例访问属性
// const messages = chat.messages
const sendMessage = (msg: { text: string }) => chat.sendMessage(msg)

// 监听 messages 变化，只处理最后一个 write_todos（防抖减少更新频率）
watch(() => chat.messages, (newMessages) => {
  // 找到最后一个 write_todos part 及其所在 message
  let lastWriteTodos: WriteTodos | null = null
  let messageId: string | null = null


  console.log(newMessages)

  for (const message of newMessages) {
    for (const part of (message as any).parts ?? []) {
      if (part.type === 'dynamic-tool' && part.toolName === 'write_todos') {
        lastWriteTodos = part as WriteTodos
        messageId = (message as any).id
      }
    }
  }

  if (!lastWriteTodos || !lastWriteTodos.input?.todos?.length) return

  pendingWriteTodos = lastWriteTodos
  pendingMessageId = messageId

  if (!updatePending) {
    updatePending = true
    nextTick(() => {
      if (!pendingWriteTodos) return
      // 新消息的 todos → 清空旧列表（多轮对话场景）
      if (pendingMessageId !== lastTodosMessageId) {
        lastTodosMessageId = pendingMessageId
        Todos.splice(0, Todos.length)
      }
      updateTodos(pendingWriteTodos)
      updatePending = false
    })
  }
}, { deep: true })


// 页面状态
const isLoading = ref(false);
const loadError = ref<string | null>(null);
const isSubmittingInterrupt = ref(false);
const showTaskList = ref(false);
const userInput = ref('');

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

// 分析结果
const analysisResults = ref<AnalysisResult[]>([]);
const activeResultIndex = ref(0);

// 中断状态
const currentInterrupt = ref<InterruptData | null>(null);
const showInterruptConfirmation = computed(() => currentInterrupt.value !== null);

const completedTaskCount = computed(() => tasks.value.filter((t) => t.status === "completed").length);

function getStatusText(status: number): string {
  const statusMap: Record<number, string> = { 1: "进行中", 2: "已完成", 3: "已关闭" };
  return statusMap[status] || "未知";
}



const handleRegenerate = () => { }
const handleSendMessage = () => { sendMessage({ text: "开始分析" }) }
const handleInterruptSubmit = () => { }
const handleInterruptCancel = () => { }
const handleTaskClick = () => { }
const loadCaseInfo = () => { }
const goBack = () => {
  router.push({ name: "dashboard-analysis" });
}



onMounted(() => {

});

onUnmounted(() => {
  lastTodosMessageId = null
});
</script>

<style></style>
