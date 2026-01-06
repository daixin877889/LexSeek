# 需求文档

## 简介

将旧项目（`lexseek_web` 和 `lexseekApi`）中的案件分析功能迁移到新的 Nuxt 4 项目中。该功能使用 **SSE（Server-Sent Events）** 实现实时通信，结合 LangGraph 构建 AI 工作流，通过 **@ai-sdk/langchain** 适配器转换流式数据，前端使用 **ai-elements-vue** 组件库构建 AI 交互界面。

核心特点：
1. **Human-in-the-loop（人机协同）**: 通过 `interrupt()` 在关键节点暂停等待用户输入，使用 `Command(resume=...)` 恢复执行
2. **Persistence（持久化）**: 使用 PostgresSaver 作为 checkpointer，保存工作流状态到数据库
3. **Durable Execution（持久执行）**: 工作流在关键点保存进度，支持故障恢复和长时间中断后恢复

## 术语表

- **Case（案件）**: 用户创建的法律案件实体，包含案件基本信息和相关材料
- **Session（会话）**: 案件分析的会话上下文，对应 LangGraph 的 thread_id
- **Material（材料）**: 案件相关的输入材料，包括文本、文档、图片、音频
- **Analysis_Module（分析模块）**: 执行特定分析任务的模块，如案件概要、大事记、诉讼请求等
- **Document_Module（文书模块）**: 生成法律文书的模块，如起诉状、答辩状等
- **LangGraph_Workflow（LangGraph 工作流）**: 基于 LangGraph 构建的 AI 分析流程
- **Human_In_The_Loop（人机协同）**: LangGraph 的中断机制，允许在工作流中暂停等待人工输入
- **Interrupt（中断）**: 使用 `interrupt()` 函数暂停工作流执行，等待用户输入
- **Command（命令）**: 使用 `Command(resume=...)` 恢复工作流执行并传入用户输入
- **Checkpointer（检查点器）**: LangGraph 的持久化组件，保存工作流状态以支持中断和恢复
- **Persistence（持久化）**: LangGraph 的内置持久化层，在每个 super-step 保存检查点
- **Durable_Execution（持久执行）**: 工作流在关键点保存进度，支持暂停后精确恢复
- **Fault_Tolerance（容错）**: 节点失败时可从最后成功的步骤重启，不重复执行已完成的节点
- **Thread（线程）**: LangGraph 中用于跟踪工作流执行历史的标识符
- **Super_Step（超级步骤）**: LangGraph 运行时的执行单元，每个 super-step 后保存检查点
- **SSE_Service（SSE 服务）**: 基于 Server-Sent Events 的实时通信服务
- **AI_SDK_Adapter（AI SDK 适配器）**: @ai-sdk/langchain 提供的适配器，用于转换 LangGraph 流式数据
- **AI_Elements_Vue（AI 元素组件库）**: 用于构建 AI 交互界面的 Vue 组件库

- **Node（节点）**: 工作流中的分析节点，定义分析任务的配置和行为
- **NodeGroup（节点分组）**: 节点的逻辑分组，用于组织和管理相关节点
- **Prompt（提示词）**: 节点使用的 AI 提示词模板，支持版本管理
- **LevelNodeAccess（会员节点权限）**: 控制不同会员级别可以访问哪些分析节点
- **PointRecord（积分记录）**: 用户的积分获取记录，包含积分数量、来源、有效期等
- **PointConsumptionItem（积分消耗项目）**: 定义各功能消耗积分的配置，包含分组、名称、积分数量、折扣等
- **PointConsumptionRecord（积分消耗记录）**: 用户积分消耗的明细记录，关联积分记录和消耗项目

## 需求

### 需求 1：统一的人机协同工作流

**用户故事:** 作为用户，我需要一个统一的案件分析流程，系统在关键节点暂停等待我的确认或输入，以便我能够控制分析过程。

#### 验收标准

1. WHEN 用户创建案件 THEN LangGraph_Workflow SHALL 启动统一的案件分析工作流
2. WHEN 工作流需要用户输入 THEN LangGraph_Workflow SHALL 调用 `interrupt()` 暂停执行并返回中断信息
3. WHEN 用户提交输入 THEN Case_Service SHALL 使用 `Command(resume=...)` 恢复工作流执行
4. WHEN 工作流恢复 THEN LangGraph_Workflow SHALL 从中断点继续执行，不重复已完成的步骤
5. WHILE 工作流执行中 THEN Checkpointer SHALL 在每个 super-step 后持久化工作流状态
6. FOR ALL 中断点 THEN LangGraph_Workflow SHALL 返回 `__interrupt__` 字段包含中断类型和所需数据

### 需求 2：持久化与持久执行

**用户故事:** 作为系统，我需要持久化工作流状态，以便支持长时间中断、故障恢复和人机协同。

#### 验收标准

1. WHEN 编译工作流 THEN LangGraph_Workflow SHALL 配置 PostgresSaver 作为 checkpointer
2. WHEN 执行工作流 THEN Checkpointer SHALL 在每个 super-step 后保存检查点到数据库
3. WHEN 工作流中断 THEN Checkpointer SHALL 保存当前状态，支持任意时间后恢复（如一周后）
4. IF 节点执行失败 THEN LangGraph_Workflow SHALL 支持从最后成功的步骤重启
5. IF 多个节点并行执行且部分失败 THEN Checkpointer SHALL 保存成功节点的结果，恢复时不重复执行
6. WHEN 恢复工作流 THEN LangGraph_Workflow SHALL 使用 thread_id 加载对应的检查点状态
7. FOR ALL 非确定性操作 THEN LangGraph_Workflow SHALL 包装在 task 中以确保幂等性

### 需求 3：案件创建与材料处理

**用户故事:** 作为用户，我需要创建案件并上传相关材料，以便系统进行分析。

#### 验收标准

1. WHEN 用户请求创建案件 THEN Case_Service SHALL 生成唯一的 sessionId（作为 thread_id）和 caseId
2. WHEN 用户提交案件材料 THEN Case_Service SHALL 验证材料类型（文本/文档/图片/音频）并保存

**文件加密上传：**
3. WHEN 用户选择加密上传 THEN Browser_Service SHALL 在浏览器端使用用户密钥加密文件内容
4. WHEN 加密完成 THEN Browser_Service SHALL 上传加密后的文件到 OSS
5. WHEN 需要处理加密文件 THEN Case_Service SHALL 先解密文件再进行识别处理

**浏览器端识别（md/txt/docx/doc）：**
6. WHEN 材料为 md 或 txt 文件 THEN Browser_Service SHALL 在浏览器端直接读取文本内容
7. WHEN 材料为 docx 或 doc 文件 THEN Browser_Service SHALL 在浏览器端使用 mammoth.js 等库提取文本内容

**服务端识别（PDF/图片/音频）：**
8. WHEN 材料为 PDF 文件 THEN Case_Service SHALL 调用 MinerU API 提交转换任务
9. WHEN MinerU 任务完成 THEN Case_Service SHALL 通过回调接口接收转换结果（Markdown 格式）
10. WHEN 材料为图片类型 THEN Case_Service SHALL 调用 OCR 服务识别图片内容
11. WHEN 材料为音频类型 THEN Case_Service SHALL 调用 ASR 服务转录音频内容

**流程控制：**
12. WHEN 所有材料处理完成 THEN LangGraph_Workflow SHALL 继续执行案情信息检查节点
13. IF 材料处理失败 THEN Case_Service SHALL 返回错误信息并允许用户重试

**材料向量化存储：**
14. WHEN 材料内容处理完成 THEN Material_Service SHALL 将内容进行向量化
15. WHEN 向量化完成 THEN Material_Service SHALL 保存向量到 `case_material_embeddings` 表
16. WHEN 保存向量 THEN Material_Service SHALL 在元数据中记录 caseId、materialId、sessionId

### 需求 3.1：MinerU PDF 转换服务

**用户故事:** 作为系统，我需要集成 MinerU API 进行 PDF 文档转换，以便提取文档内容。

#### 验收标准

1. WHEN 提交 PDF 转换任务 THEN MinerU_Service SHALL 调用 MinerU API `/extract/task` 接口
2. WHEN 提交任务时 THEN MinerU_Service SHALL 支持配置 OCR、公式识别、表格识别、页码范围等参数
3. WHEN 任务提交成功 THEN MinerU_Service SHALL 保存任务记录到数据库
4. WHEN MinerU 转换完成 THEN MinerU_Service SHALL 通过回调接口接收转换结果
5. WHEN 收到回调 THEN MinerU_Service SHALL 下载并解压结果 ZIP 文件
6. WHEN 解压完成 THEN MinerU_Service SHALL 读取 full.md 文件获取 Markdown 内容
7. WHEN Markdown 包含图片 THEN MinerU_Service SHALL 将图片上传到 OSS 并替换路径
8. WHEN 处理完成 THEN MinerU_Service SHALL 更新任务状态并清理临时文件
9. IF 转换失败 THEN MinerU_Service SHALL 记录错误信息并通知调用方

**轮询保底机制：**
10. WHEN 任务提交成功 THEN MinerU_Service SHALL 启动定时轮询任务状态
11. WHEN 轮询检测到任务完成 THEN MinerU_Service SHALL 主动获取转换结果
12. WHEN 回调和轮询同时触发 THEN MinerU_Service SHALL 使用幂等机制避免重复处理
13. WHEN 轮询超过最大次数 THEN MinerU_Service SHALL 标记任务为超时失败
14. FOR ALL 轮询任务 THEN MinerU_Service SHALL 使用指数退避策略控制轮询间隔

**积分扣减：**
15. WHEN 用户提交 PDF 转换任务 THEN Point_Service SHALL 检查用户积分是否足够
16. IF 用户积分不足 THEN MinerU_Service SHALL 返回错误并阻止任务提交
17. WHEN PDF 转换成功完成 THEN Point_Service SHALL 扣减对应的积分
18. WHEN 扣减积分 THEN Point_Service SHALL 使用 pdf_parse 消耗项目
19. IF PDF 转换失败 THEN Point_Service SHALL 不扣减积分

### 需求 3.2：ASR 音频转录服务

**用户故事:** 作为系统，我需要集成 ASR 服务进行音频转录，以便提取音频内容。

#### 验收标准

1. WHEN 提交音频转录任务 THEN ASR_Service SHALL 调用 ASR API 提交转录请求
2. WHEN 转录完成 THEN ASR_Service SHALL 获取转录文本结果
3. WHEN 处理完成 THEN ASR_Service SHALL 更新任务状态
4. IF 转录失败 THEN ASR_Service SHALL 记录错误信息并通知调用方

**积分扣减：**
5. WHEN 用户提交音频转录任务 THEN Point_Service SHALL 检查用户积分是否足够
6. IF 用户积分不足 THEN ASR_Service SHALL 返回错误并阻止任务提交
7. WHEN 音频转录成功完成 THEN Point_Service SHALL 扣减对应的积分
8. WHEN 扣减积分 THEN Point_Service SHALL 使用 asr_transcribe 消耗项目
9. IF 音频转录失败 THEN Point_Service SHALL 不扣减积分

### 需求 4：案情信息检查（中断点 1）

**用户故事:** 作为用户，我需要系统检查是否有足够的案情信息进行分析，如果不足则提示我补充。

#### 验收标准

1. WHEN 材料处理完成 THEN LangGraph_Workflow SHALL 执行案情信息检查节点
2. WHEN 检查发现无案情信息 THEN LangGraph_Workflow SHALL 调用 `interrupt()` 暂停并返回提示
3. WHEN 中断返回 THEN SSE_Service SHALL 发送中断事件，提示用户补充案情信息
4. WHEN 用户查看提示 THEN UI_Component SHALL 展示补充案情的交互界面
5. WHEN 用户输入文本案情 THEN UI_Component SHALL 支持直接输入案情描述
6. WHEN 用户上传文档 THEN UI_Component SHALL 支持上传案情相关文档并处理
7. WHEN 用户提交补充信息 THEN Case_Service SHALL 使用 `Command(resume=补充的案情)` 恢复工作流
8. WHEN 工作流恢复 THEN LangGraph_Workflow SHALL 重新检查案情信息是否充足
9. WHILE 案情信息不足 THEN LangGraph_Workflow SHALL 循环执行检查-补充流程
10. WHEN 案情信息充足 THEN LangGraph_Workflow SHALL 继续执行基本信息提取节点

### 需求 5：案件基本信息提取与确认（中断点 2）

**用户故事:** 作为用户，我需要系统自动从材料中提取案件基本信息，并能够修改和确认后继续。

#### 验收标准

1. WHEN 案情信息检查通过 THEN LangGraph_Workflow SHALL 执行基本信息提取节点
2. WHEN 基本信息提取完成 THEN LangGraph_Workflow SHALL 调用 `interrupt()` 暂停并返回提取结果
3. WHEN 中断返回 THEN SSE_Service SHALL 发送中断事件，包含提取的标题、原告、被告等信息
4. WHEN 用户查看提取结果 THEN UI_Component SHALL 以可编辑表单形式展示所有字段
5. WHEN 用户修改字段 THEN UI_Component SHALL 实时更新表单数据
6. WHEN 用户确认信息 THEN Case_Service SHALL 使用 `Command(resume=修改后的数据)` 恢复工作流
7. WHEN 工作流恢复 THEN LangGraph_Workflow SHALL 使用用户确认的数据更新案件记录
8. WHEN 案件记录更新完成 THEN LangGraph_Workflow SHALL 继续执行模块选择节点
9. WHILE 信息提取进行中 THEN SSE_Service SHALL 通过流式输出展示推理过程

### 需求 6：分析模块选择（中断点 3）

**用户故事:** 作为用户，我需要选择要执行的分析模块，系统在我确认后开始分析。

#### 验收标准

1. WHEN 基本信息确认完成 THEN LangGraph_Workflow SHALL 执行模块选择节点
2. WHEN 模块选择节点执行 THEN LangGraph_Workflow SHALL 调用 `interrupt()` 返回可用模块列表
3. WHEN 中断返回 THEN SSE_Service SHALL 发送中断事件，包含分析模块和文书模块列表
4. WHEN 返回模块列表 THEN Case_Service SHALL 包含模块名称、积分消耗、折扣信息、用户权限状态
5. IF 用户积分不足 THEN UI_Component SHALL 提示用户充值
6. IF 用户会员等级不足 THEN UI_Component SHALL 提示用户升级会员
7. WHEN 用户选择模块并确认 THEN Case_Service SHALL 使用 `Command(resume=选择的模块)` 恢复工作流
8. WHEN 工作流恢复 THEN LangGraph_Workflow SHALL 继续执行分析任务节点

### 需求 6：分析任务执行

**用户故事:** 作为用户，我需要系统执行选定的分析任务，并实时展示分析过程。

#### 验收标准

1. WHEN 模块选择确认完成 THEN LangGraph_Workflow SHALL 按顺序执行选定的分析模块
2. WHEN 模块开始执行 THEN SSE_Service SHALL 发送任务开始事件
3. WHILE 模块执行中 THEN SSE_Service SHALL 通过流式输出发送推理过程和内容
4. WHEN 模块调用工具 THEN SSE_Service SHALL 发送工具调用状态和结果
5. WHEN 模块执行完成 THEN SSE_Service SHALL 发送任务结束事件并保存分析结果
6. WHEN 所有模块执行完成 THEN Case_Service SHALL 扣减用户积分并记录消费日志
7. IF 分析过程出错 THEN LangGraph_Workflow SHALL 保存错误状态，支持从失败点重试

### 需求 7：SSE 流式通信

**用户故事:** 作为前端应用，我需要通过 SSE 接收后端的流式数据，以便实时展示 AI 分析过程和中断事件。

#### 验收标准

1. WHEN 用户发起分析请求 THEN SSE_Service SHALL 建立与后端的 SSE 连接
2. WHEN SSE 连接成功 THEN SSE_Service SHALL 开始接收流式数据
3. WHEN 收到流式数据 THEN SSE_Service SHALL 通过 AI SDK 的 useChat hook 处理数据
4. WHEN 收到中断事件 THEN SSE_Service SHALL 解析 `__interrupt__` 字段并触发对应的 UI 交互
5. WHEN 用户提交中断响应 THEN SSE_Service SHALL 发送 `Command(resume=...)` 请求恢复工作流
6. WHEN SSE 连接断开 THEN SSE_Service SHALL 显示错误提示并允许用户重试
7. WHEN 分析完成 THEN SSE_Service SHALL 自动关闭连接并清理资源

### 需求 8：分析结果展示与重新生成

**用户故事:** 作为用户，我需要查看分析结果，并能够对结果进行重新生成。

#### 验收标准

1. WHEN 分析完成 THEN UI_Component SHALL 展示各模块的分析结果
2. WHEN 用户切换模块 THEN UI_Component SHALL 显示对应模块的详细内容
3. WHEN 用户请求重新生成 THEN Case_Service SHALL 启动新的工作流执行指定模块
4. WHEN 重新生成时 THEN Case_Service SHALL 允许用户提供额外提示和选择材料
5. WHEN 分析结果更新 THEN Case_Service SHALL 保存新版本并保留历史记录

### 需求 9：历史记录与工作流恢复

**用户故事:** 作为用户，我需要查看案件的历史分析记录，并能够恢复未完成的工作流。

#### 验收标准

1. WHEN 用户进入已有案件 THEN Case_Service SHALL 加载对应 thread_id 的工作流状态
2. IF 工作流处于中断状态 THEN UI_Component SHALL 显示中断点对应的交互界面
3. WHEN 用户继续中断的工作流 THEN Case_Service SHALL 使用 `Command(resume=...)` 恢复执行
4. IF 工作流处于错误状态 THEN UI_Component SHALL 显示错误信息并提供重试选项
5. WHEN 用户选择重试 THEN LangGraph_Workflow SHALL 从最后成功的检查点恢复执行
6. WHEN 加载历史消息 THEN UI_Component SHALL 恢复之前的分析状态和结果
7. WHEN 用户查看历史版本 THEN Case_Service SHALL 返回指定版本的分析结果

### 需求 10：AI 界面组件集成

**用户故事:** 作为前端应用，我需要使用 ai-elements-vue 组件库构建 AI 交互界面，以便提供良好的用户体验。

#### 验收标准

1. WHEN 展示对话消息 THEN UI_Component SHALL 使用 Message 组件区分用户和 AI 消息
2. WHEN 展示推理过程 THEN UI_Component SHALL 使用 Reasoning 组件展示可折叠的思考过程
3. WHEN 展示工具调用 THEN UI_Component SHALL 使用 Tool 组件展示工具输入和输出
4. WHEN 展示对话列表 THEN UI_Component SHALL 使用 Conversation 组件实现自动滚动
5. WHEN 展示 AI 响应内容 THEN UI_Component SHALL 使用 MessageResponse 组件渲染 Markdown
6. WHEN 流式输出进行中 THEN UI_Component SHALL 使用 Loader/Shimmer 组件展示加载状态
7. WHEN 收到中断事件 THEN UI_Component SHALL 使用 Confirmation 组件展示确认界面

**任务清单功能：**
8. WHEN 分析流程开始 THEN UI_Component SHALL 展示任务清单组件
9. WHEN 展示任务清单 THEN UI_Component SHALL 包含所有分析步骤：案情检查、基本信息确认、模块选择、各分析模块
10. WHEN 任务清单初始化 THEN UI_Component SHALL 显示所有任务为待处理状态
11. WHEN 工作流进入中断点1（案情检查）THEN UI_Component SHALL 更新对应任务为进行中状态
12. WHEN 用户完成中断点1 THEN UI_Component SHALL 更新对应任务为已完成状态
13. WHEN 工作流进入中断点2（基本信息确认）THEN UI_Component SHALL 更新对应任务为进行中状态
14. WHEN 用户完成中断点2 THEN UI_Component SHALL 更新对应任务为已完成状态
15. WHEN 工作流进入中断点3（模块选择）THEN UI_Component SHALL 更新对应任务为进行中状态
16. WHEN 用户选择模块后 THEN UI_Component SHALL 动态添加选中的分析模块到任务清单
17. WHEN 分析模块开始执行 THEN UI_Component SHALL 更新对应模块任务为进行中状态
18. WHEN 分析模块执行完成 THEN UI_Component SHALL 更新对应模块任务为已完成状态
19. WHEN 任务状态变化 THEN UI_Component SHALL 使用不同图标和颜色区分待处理、进行中、已完成状态
20. WHEN 用户点击已完成任务 THEN UI_Component SHALL 滚动到对应的分析结果区域

### 需求 11：数据持久化与检查点

**用户故事:** 作为系统，我需要持久化案件数据、分析结果和工作流状态，以便支持人机协同和故障恢复。

#### 验收标准

1. WHEN 案件创建 THEN Database_Service SHALL 保存案件基本信息到 `cases` 表
2. WHEN 会话创建 THEN Database_Service SHALL 保存会话信息到 `caseSessions` 表
3. WHEN 工作流状态变化 THEN Checkpointer SHALL 保存检查点到数据库（使用 PostgresSaver）
4. WHEN 材料上传 THEN Database_Service SHALL 保存材料信息到 `caseMaterials` 表
5. WHEN 分析完成 THEN Database_Service SHALL 保存分析结果到 `caseAnalysis` 表
6. WHEN 积分消耗 THEN Database_Service SHALL 记录消费日志
7. FOR ALL 检查点 THEN Checkpointer SHALL 支持通过 thread_id 恢复工作流状态

### 需求 12：LangGraph 工作流与 AI SDK 适配器集成

**用户故事:** 作为系统，我需要集成 LangGraph 工作流引擎，并通过 @ai-sdk/langchain 适配器转换流式数据，以便前端能够正确消费。

#### 验收标准

1. WHEN 创建工作流 THEN LangGraph_Workflow SHALL 使用 StateGraph 定义统一的案件分析流程
2. WHEN 编译工作流 THEN LangGraph_Workflow SHALL 配置 PostgresSaver 作为 checkpointer
3. WHEN LangGraph 产生流式输出 THEN AI_SDK_Adapter SHALL 使用 toUIMessageStream 转换为 AI SDK 格式
4. WHEN 返回流式响应 THEN AI_SDK_Adapter SHALL 使用 createUIMessageStreamResponse 创建 SSE 响应
5. WHEN 工具调用 THEN LangGraph_Workflow SHALL 执行法律检索、材料检索等工具
6. WHEN 流程出错 THEN LangGraph_Workflow SHALL 捕获错误并通过流式响应通知前端
7. FOR ALL 分析结果 THEN LangGraph_Workflow SHALL 以 Markdown 格式输出

### 需求 12.1：案件材料检索工具

**用户故事:** 作为系统，我需要提供案件材料检索工具，以便 AI 在分析过程中能够检索相关材料内容。

#### 验收标准

**向量检索：**
1. WHEN 执行材料检索 THEN Material_Search_Tool SHALL 使用查询参数进行向量相似度搜索
2. WHEN 检索材料 THEN Material_Search_Tool SHALL 仅在当前案件的材料范围内搜索
3. WHEN 返回检索结果 THEN Material_Search_Tool SHALL 返回材料内容片段
4. FOR ALL 检索结果 THEN Material_Search_Tool SHALL 包含材料来源信息（materialId、materialName）

### 需求 13：工作流节点管理

**用户故事:** 作为管理员，我需要管理工作流中的分析节点，包括节点配置、提示词管理和会员权限控制，以便灵活配置分析功能。

#### 验收标准

**节点管理：**
1. WHEN 管理员访问节点管理页面 THEN Admin_UI SHALL 展示所有节点列表，包含名称、标题、类型、优先级、关联模型等信息
2. WHEN 管理员创建节点 THEN Node_Service SHALL 保存节点信息到 `nodes` 表
3. WHEN 管理员编辑节点 THEN Node_Service SHALL 更新节点的名称、标题、描述、类型、优先级、模型、工具列表等
4. WHEN 管理员删除节点 THEN Node_Service SHALL 软删除节点（设置 deletedAt）
5. WHEN 管理员查看节点详情 THEN Admin_UI SHALL 展示节点关联的提示词列表和会员权限配置

**节点分组管理：**
6. WHEN 管理员创建节点分组 THEN Node_Service SHALL 保存分组信息到 `nodeGroups` 表
7. WHEN 管理员编辑节点分组 THEN Node_Service SHALL 更新分组名称和描述
8. WHEN 管理员将节点分配到分组 THEN Node_Service SHALL 更新节点的 groupId 字段

**提示词管理：**
9. WHEN 管理员查看节点提示词 THEN Admin_UI SHALL 展示该节点所有提示词及其版本
10. WHEN 管理员创建提示词 THEN Prompt_Service SHALL 保存提示词到 `prompts` 表，自动生成版本号
11. WHEN 管理员编辑提示词 THEN Prompt_Service SHALL 创建新版本而非覆盖原版本
12. WHEN 管理员激活提示词版本 THEN Prompt_Service SHALL 将该版本设为生效状态，同类型其他版本设为未生效
13. WHEN 管理员查看提示词历史 THEN Admin_UI SHALL 展示该提示词的所有历史版本
14. FOR ALL 提示词 THEN Prompt_Service SHALL 支持变量占位符（如 {{caseInfo}}、{{materials}}）

**会员节点权限管理：**
15. WHEN 管理员配置会员节点权限 THEN Admin_UI SHALL 展示会员级别与节点的权限矩阵
16. WHEN 管理员授权会员级别访问节点 THEN Access_Service SHALL 创建 `levelNodeAccess` 记录
17. WHEN 管理员撤销会员级别节点权限 THEN Access_Service SHALL 软删除对应的权限记录
18. WHEN 用户执行分析任务 THEN Case_Service SHALL 根据用户会员级别过滤可用节点
19. FOR ALL 节点权限变更 THEN Access_Service SHALL 记录操作日志

### 需求 15：后台管理界面

**用户故事:** 作为管理员，我需要一个后台管理界面来管理案件分析相关的配置，以便维护系统运行。

#### 验收标准

**节点管理页面：**
1. WHEN 管理员访问节点列表 THEN Admin_UI SHALL 支持按名称、类型、分组筛选和分页
2. WHEN 管理员点击新建节点 THEN Admin_UI SHALL 展示节点创建表单
3. WHEN 管理员点击编辑节点 THEN Admin_UI SHALL 展示节点编辑表单，预填现有数据
4. WHEN 管理员点击删除节点 THEN Admin_UI SHALL 弹出确认对话框

**提示词管理页面：**
5. WHEN 管理员访问提示词列表 THEN Admin_UI SHALL 按节点分组展示提示词
6. WHEN 管理员编辑提示词 THEN Admin_UI SHALL 提供 Markdown 编辑器和变量插入功能
7. WHEN 管理员切换提示词版本 THEN Admin_UI SHALL 展示版本对比功能
8. WHEN 管理员测试提示词 THEN Admin_UI SHALL 支持输入测试变量并预览渲染结果

**权限配置页面：**
9. WHEN 管理员访问权限配置 THEN Admin_UI SHALL 展示会员级别与节点的权限矩阵表格
10. WHEN 管理员勾选/取消权限 THEN Admin_UI SHALL 实时保存权限变更
11. WHEN 管理员批量配置权限 THEN Admin_UI SHALL 支持按会员级别或节点批量操作

**模型管理页面：**
12. WHEN 管理员访问模型列表 THEN Admin_UI SHALL 展示可用的 AI 模型配置
13. WHEN 管理员配置模型 THEN Admin_UI SHALL 支持设置模型名称、API 配置、参数等

### 需求 16：积分扣减系统

**用户故事:** 作为系统，我需要在用户执行分析任务时扣减积分，并记录消费明细，以便实现按量计费。

#### 验收标准

**积分消耗项目管理：**
1. WHEN 管理员访问积分消耗项目列表 THEN Admin_UI SHALL 展示所有消耗项目，包含分组、名称、单位、积分数量、折扣等
2. WHEN 管理员创建消耗项目 THEN Point_Service SHALL 保存项目到 `pointConsumptionItems` 表
3. WHEN 管理员编辑消耗项目 THEN Point_Service SHALL 更新项目的名称、描述、积分数量、折扣等
4. WHEN 管理员禁用消耗项目 THEN Point_Service SHALL 设置项目状态为禁用
5. FOR ALL 消耗项目 THEN Point_Service SHALL 支持按分组（group）组织管理

**积分扣减流程：**
6. WHEN 用户执行分析任务 THEN Point_Service SHALL 检查用户可用积分是否足够
7. IF 用户积分不足 THEN Point_Service SHALL 返回错误并阻止任务执行
8. WHEN 积分足够 THEN Point_Service SHALL 按积分记录到期时间顺序依次扣减
9. WHEN 扣减积分 THEN Point_Service SHALL 更新 `pointRecords` 表的 used 和 remaining 字段
10. WHEN 扣减完成 THEN Point_Service SHALL 创建 `pointConsumptionRecords` 记录

**积分消耗记录：**
11. WHEN 创建消耗记录 THEN Point_Service SHALL 记录用户ID、积分记录ID、消耗项目ID、消耗数量
12. WHEN 创建消耗记录 THEN Point_Service SHALL 记录关联的业务资源ID（如 caseAnalysisId）
13. FOR ALL 消耗记录 THEN Point_Service SHALL 支持按用户、消耗项目、业务资源查询

**积分计算规则：**
14. WHEN 计算实际扣减积分 THEN Point_Service SHALL 应用消耗项目的折扣（discount）
15. WHEN 用户有多条积分记录 THEN Point_Service SHALL 优先扣减即将到期的积分
16. FOR ALL 积分操作 THEN Point_Service SHALL 在数据库事务中执行以保证一致性

### 需求 17：积分消耗项目后台管理

**用户故事:** 作为管理员，我需要管理积分消耗项目的配置，以便灵活调整各功能的积分消耗。

#### 验收标准

**列表页面：**
1. WHEN 管理员访问消耗项目列表 THEN Admin_UI SHALL 支持按分组、名称、状态筛选
2. WHEN 管理员查看列表 THEN Admin_UI SHALL 展示分组、名称、描述、单位、积分数量、折扣、状态
3. WHEN 管理员点击分组标签 THEN Admin_UI SHALL 筛选显示该分组下的所有项目

**创建/编辑页面：**
4. WHEN 管理员创建消耗项目 THEN Admin_UI SHALL 提供表单输入分组、名称、描述、单位、积分数量、折扣
5. WHEN 管理员编辑消耗项目 THEN Admin_UI SHALL 预填现有数据并支持修改
6. WHEN 管理员设置折扣 THEN Admin_UI SHALL 验证折扣值在 0-1 之间

**状态管理：**
7. WHEN 管理员启用/禁用项目 THEN Admin_UI SHALL 切换项目状态并实时生效
8. WHEN 项目被禁用 THEN Point_Service SHALL 阻止使用该项目进行积分扣减

**数据统计：**
9. WHEN 管理员查看消耗项目 THEN Admin_UI SHALL 展示该项目的累计消耗次数和积分总量

### 需求 18：示范案例功能

**用户故事:** 作为用户，我需要在分析页面看到示范案例，以便快速了解系统功能并体验分析流程。

#### 验收标准

**示范案例展示：**
1. WHEN 用户进入案件分析页面 THEN UI_Component SHALL 在页面下方展示示范案例列表
2. WHEN 展示示范案例 THEN UI_Component SHALL 显示案例标题、简介、案件类型等信息
3. WHEN 用户未创建案件时 THEN UI_Component SHALL 突出显示示范案例引导用户体验

**示范案例分析：**
4. WHEN 用户点击示范案例 THEN Case_Service SHALL 使用预设的案例材料创建新案件
5. WHEN 创建示范案件 THEN Case_Service SHALL 标记该案件为示范案件（isDemo=true）
6. WHEN 分析示范案件 THEN Case_Service SHALL 正常执行分析流程

**示范案例管理：**
7. WHEN 管理员访问示范案例管理 THEN Admin_UI SHALL 展示所有示范案例列表
8. WHEN 管理员创建示范案例 THEN Admin_UI SHALL 支持上传案例材料和配置案例信息
9. WHEN 管理员编辑示范案例 THEN Admin_UI SHALL 支持修改案例标题、简介、材料等
10. WHEN 管理员设置案例状态 THEN Admin_UI SHALL 支持启用/禁用示范案例
11. FOR ALL 示范案例 THEN Database_Service SHALL 保存到 `demoCases` 表

### 需求 19：分析页面自适应布局

**用户故事:** 作为用户，我需要分析页面根据分析进度自动调整布局，以便在不同阶段获得最佳的交互体验。

#### 验收标准

**初始全宽布局：**
1. WHEN 用户开始分析且无分析结果时 THEN UI_Component SHALL 全宽展示工作流对话区域
2. WHEN 工作流对话进行中 THEN UI_Component SHALL 保持全宽布局以便用户专注于交互

**左右分栏布局：**
3. WHEN 产生第一个分析结果 THEN UI_Component SHALL 自动切换为左右分栏布局
4. WHEN 分栏布局时 THEN UI_Component SHALL 左侧展示工作流消息，右侧展示分析结果
5. WHEN 用户切换分析模块 THEN UI_Component SHALL 在右侧更新对应模块的分析结果

**分栏宽度调整：**
6. WHEN 分栏布局时 THEN UI_Component SHALL 在中间显示可拖拽的分割线
7. WHEN 用户拖拽分割线 THEN UI_Component SHALL 实时调整左右两侧的宽度比例
8. WHEN 用户释放分割线 THEN UI_Component SHALL 保存当前宽度比例到本地存储

**结果区域控制：**
9. WHEN 分栏布局时 THEN UI_Component SHALL 在右侧区域显示关闭按钮
10. WHEN 用户点击关闭按钮 THEN UI_Component SHALL 收起右侧结果区域，恢复全宽布局
11. WHEN 结果区域关闭后 THEN UI_Component SHALL 显示展开按钮以便重新打开

**导航与导出功能：**
12. WHEN 有分析结果时 THEN UI_Component SHALL 在右下角显示浮动操作按钮
13. WHEN 用户点击导出按钮 THEN UI_Component SHALL 展示导出选项（Word、PDF、Markdown）
14. WHEN 用户点击导航按钮 THEN UI_Component SHALL 展示分析结果模块导航菜单
15. WHEN 用户选择导航项 THEN UI_Component SHALL 滚动到对应的分析结果区域

**移动端适配：**
16. WHEN 在移动端访问 THEN UI_Component SHALL 默认显示工作流消息视图
17. WHEN 移动端有分析结果时 THEN UI_Component SHALL 显示底部切换标签
18. WHEN 用户点击切换标签 THEN UI_Component SHALL 在工作流消息和分析结果之间切换
19. WHEN 移动端切换视图 THEN UI_Component SHALL 使用滑动动画过渡

**布局切换动画：**
20. WHEN 布局从全宽切换到分栏 THEN UI_Component SHALL 使用平滑过渡动画
