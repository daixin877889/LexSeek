# 实现计划：案件分析功能

## 概述

本实现计划按功能模块组织，每个模块完成后都可独立运行和测试。模块间存在依赖关系，需按顺序完成。

## 模块依赖关系

```
模块A: 数据库基础 → 模块B: 后台管理（节点/提示词/权限）→ 模块C: 材料处理
                                                          ↓
模块G: 前端案件分析 ← 模块F: 前端基础服务 ← 模块E: 案件分析API ← 模块D: LangGraph工作流
                                                          ↓
模块H: 后台管理页面                                    模块I: 会员中心积分页面
```

---

## 模块 A：数据库基础设施（无依赖）

**目标**：创建所有数据表，为后续模块提供数据存储基础
**验证方式**：运行 `prisma db push` 成功，可通过 Prisma Studio 查看表结构

- [x] A.1 创建 Prisma 数据模型
  - [x] A.1.1 创建案件相关表
    - 创建 `prisma/models/case.prisma`
    - 定义 cases、caseSessions、caseMaterials、caseAnalyses 表
    - _Requirements: 11.1, 11.2_
  - [x] A.1.2 创建节点与提示词表
    - 创建 `prisma/models/node.prisma`
    - 定义 nodes、nodeGroups、prompts、levelNodeAccess 表
    - _Requirements: 11.4, 11.5_
  - [x] A.1.3 创建示范案例表
    - 在 `prisma/models/case.prisma` 中添加 demoCases 表
    - _Requirements: 18.11_
  - [x] A.1.4 创建材料向量表
    - 在 `prisma/models/case.prisma` 中添加 caseMaterialEmbeddings 表
    - 使用 pgvector 扩展，定义向量索引
    - _Requirements: 3.15_

- [x] A.2 生成 Prisma Client 并验证
  - 运行 `bun prisma generate` 和 `bun prisma db push`
  - 使用 Prisma Studio 验证表结构
  - _Requirements: 11.1_

- [x] A.3 检查点 - 数据库验证
  - 确保所有表创建成功，Prisma Client 可正常使用


---

## 模块 B：后台管理 - 节点/提示词/权限（依赖模块A）

**目标**：实现节点、提示词、权限的完整管理功能（服务层 + API + 前端页面）
**验证方式**：可通过后台页面完成节点创建、提示词配置、权限分配的完整流程

### B.1 节点管理

- [x] B.1.1 实现节点服务
  - 创建 `server/services/node/node.service.ts`
  - 实现节点 CRUD、分组管理
  - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.6, 14.7, 14.8_

- [x] B.1.2 实现节点管理 API
  - GET /api/v1/admin/nodes - 节点列表
  - POST /api/v1/admin/nodes - 创建节点
  - PUT /api/v1/admin/nodes/[id] - 更新节点
  - DELETE /api/v1/admin/nodes/[id] - 删除节点
  - _Requirements: 15.1, 15.2, 15.3, 15.4_

- [x] B.1.3 实现节点分组 API
  - GET /api/v1/admin/node-groups - 分组列表
  - POST /api/v1/admin/node-groups - 创建分组
  - PUT /api/v1/admin/node-groups/[id] - 更新分组
  - _Requirements: 14.6, 14.7_

- [x] B.1.4 实现节点管理页面
  - 创建 `app/pages/admin/nodes/index.vue` - 节点列表
  - 创建 `app/pages/admin/nodes/[id].vue` - 节点详情/编辑
  - _Requirements: 15.1, 15.2, 15.3, 15.4_

- [x] B.1.5 检查点 - 节点管理验证
  - 可通过页面完成节点的增删改查操作

- [x] B.1.6 实现节点分组管理页面
  - 创建 `app/pages/admin/node-groups/index.vue` - 分组列表
  - 支持分组的增删改查操作
  - 显示每个分组下的节点数量
  - _Requirements: 14.6, 14.7_

### B.2 提示词管理

- [x] B.2.1 实现提示词服务
  - 创建 `server/services/node/prompt.service.ts`
  - 实现提示词 CRUD、版本管理、激活/停用、变量渲染
  - _Requirements: 14.9, 14.10, 14.11, 14.12, 14.13, 14.14_

- [x] B.2.2 编写提示词版本属性测试
  - **Property 6: 提示词版本互斥性**
  - **Validates: Requirements 14.12**

- [x] B.2.3 实现提示词管理 API
  - GET /api/v1/admin/prompts - 提示词列表
  - POST /api/v1/admin/prompts - 创建提示词
  - PUT /api/v1/admin/prompts/activate/[id] - 激活提示词
  - GET /api/v1/admin/prompts/versions/[id] - 获取版本历史
  - POST /api/v1/admin/prompts/preview - 预览渲染
  - _Requirements: 15.5, 15.6, 15.7, 15.8_

- [x] B.2.4 实现提示词管理页面
  - 创建 `app/pages/admin/prompts/index.vue` - 提示词列表
  - 创建 `app/pages/admin/prompts/[id].vue` - 提示词编辑
  - _Requirements: 15.5, 15.6, 15.7, 15.8_

- [x] B.2.5 检查点 - 提示词管理验证
  - 可通过页面完成提示词的创建、版本管理、激活操作

### B.3 权限管理

- [x] B.3.1 实现权限服务
  - 创建 `server/services/node/access.service.ts`
  - 实现会员节点权限管理、权限检查、用户可用节点查询
  - _Requirements: 14.15, 14.16, 14.17, 14.18, 14.19_

- [-] B.3.2 编写节点权限属性测试
  - **Property 7: 节点权限访问控制**
  - **Validates: Requirements 14.18**

- [x] B.3.3 实现权限管理 API
  - GET /api/v1/admin/access/matrix - 获取权限矩阵
  - POST /api/v1/admin/access/grant - 授权
  - POST /api/v1/admin/access/revoke - 撤销
  - POST /api/v1/admin/access/batch - 批量更新
  - _Requirements: 15.9, 15.10, 15.11_

- [x] B.3.4 实现权限配置页面
  - 创建 `app/pages/admin/access/index.vue` - 权限矩阵
  - _Requirements: 15.9, 15.10, 15.11_

- [x] B.3.5 检查点 - 权限管理验证
  - 可通过页面完成会员级别与节点的权限配置
  - 页面已优化为纵向列表设计，支持会员级别选择、类型筛选、关键词搜索、全选/全不选

### B.4 积分消耗项目管理

- [x] B.4.1 配置案件分析相关的积分消耗项目
  - 在 pointConsumptionItems 表中添加：pdf_parse、asr_transcribe、各分析模块项目
  - **注意**：积分扣减服务（consumePoints）已实现，直接调用即可
  - _Requirements: 16.2, 16.3, 16.4, 16.5, 3.1.17, 3.2.8_

- [ ]* B.4.2 编写积分扣减属性测试
  - **Property 3: 积分扣减数据一致性**
  - **Property 4: 积分扣减优先级正确性**
  - **Property 5: 积分不足阻止操作**
  - **Validates: Requirements 16.6, 16.7, 16.8, 16.9, 16.15, 16.16**

- [x] B.4.3 实现积分消耗项目管理 API
  - GET /api/v1/admin/point-consumption-items - 列表
  - POST /api/v1/admin/point-consumption-items - 创建
  - PUT /api/v1/admin/point-consumption-items/[id] - 更新
  - DELETE /api/v1/admin/point-consumption-items/[id] - 删除
  - PUT /api/v1/admin/point-consumption-items/status/[id] - 切换状态
  - _Requirements: 17.1-17.9_

- [x] B.4.4 实现积分消耗项目管理页面
  - 创建 `app/pages/admin/point-items/index.vue` - 项目列表
  - 创建 `app/components/admin/point-items/FormDialog.vue` - 创建/编辑对话框
  - _Requirements: 17.1-17.9_

- [x] B.4.5 检查点 - 积分项目管理验证
  - 可通过页面完成积分消耗项目的配置

### B.5 示范案例管理

- [x] B.5.1 实现示范案例服务
  - 创建 `server/services/case/demoCase.service.ts`
  - 实现示范案例 CRUD
  - _Requirements: 18.7, 18.8, 18.9, 18.10_

- [x] B.5.2 实现示范案例管理 API
  - GET /api/v1/admin/demo-cases - 列表
  - POST /api/v1/admin/demo-cases - 创建
  - PUT /api/v1/admin/demo-cases/[id] - 更新
  - DELETE /api/v1/admin/demo-cases/[id] - 删除
  - PUT /api/v1/admin/demo-cases/status/[id] - 切换状态
  - _Requirements: 18.7, 18.8, 18.9, 18.10_

- [x] B.5.3 实现示范案例管理页面
  - 创建 `app/pages/admin/demo-cases/index.vue` - 案例列表
  - 创建 `app/pages/admin/demo-cases/[id].vue` - 案例编辑
  - _Requirements: 18.7, 18.8, 18.9, 18.10_

- [x] B.5.4 检查点 - 示范案例管理验证
  - 可通过页面完成示范案例的配置

### B.6 模型管理页面

- [x] B.6.1 实现模型管理页面
  - 创建 `app/pages/admin/models/index.vue` - 模型列表
  - **注意**：模型服务和 API 已存在，只需实现前端页面
  - _Requirements: 15.12, 15.13_

- [x] B.6.2 检查点 - 后台管理模块完整验证
  - 确保所有后台管理功能可正常使用


---

## 模块 C：材料处理服务（依赖模块A、B.4）

**目标**：实现材料的上传、处理、向量化、检索功能
**验证方式**：可通过 API 上传材料并获取处理后的内容，可进行材料检索

- [ ] C.1 实现材料服务基础功能
  - 创建 `server/services/material/material.service.ts`
  - 实现材料保存、内容获取
  - _Requirements: 3.1, 3.2_

- [ ] C.2 实现 MinerU PDF 转换服务
  - 创建 `server/services/material/mineru.service.ts`
  - 实现任务提交、回调处理、结果解析
  - 实现轮询保底机制（指数退避策略）
  - 集成积分扣减（pdf_parse 消耗项目）
  - _Requirements: 3.1.1-3.1.19_

- [ ] C.3 实现 OCR 服务集成
  - 创建 `server/services/material/ocr.service.ts`
  - 实现图片内容识别
  - _Requirements: 3.10_

- [ ] C.4 实现 ASR 服务集成
  - 创建 `server/services/material/asr.service.ts`
  - 实现音频内容转录
  - 集成积分扣减（asr_transcribe 消耗项目）
  - _Requirements: 3.2.1-3.2.9_

- [ ] C.5 实现材料向量化服务
  - 创建 `server/services/material/materialEmbedding.service.ts`
  - 复用已有的向量存储服务（`vectorStore.service.ts`）
  - 实现材料内容分块、向量化、存储到 `case_material_embeddings` 表
  - _Requirements: 3.14, 3.15, 3.16_

- [ ] C.6 实现材料检索工具
  - 创建 `server/services/material/materialSearch.tool.ts`
  - 实现向量相似度搜索（仅在当前案件范围内）
  - 返回材料内容片段及来源信息
  - _Requirements: 12.1.1-12.1.4_

- [ ] C.7 实现材料 API
  - POST /api/v1/material/upload - 上传材料
  - POST /api/v1/material/process/[id] - 处理材料
  - GET /api/v1/material/content/[id] - 获取材料内容
  - _Requirements: 3.2, 3.8, 3.10, 3.11_

- [ ] C.8 检查点 - 材料处理验证
  - 可通过 API 上传 PDF/图片/音频并获取处理后的文本内容
  - 可进行材料内容的向量检索

---

## 模块 D：LangGraph 工作流（依赖模块A、B、C）

**目标**：实现完整的案件分析工作流，包含 3 个中断点
**验证方式**：可通过代码测试工作流的执行、中断、恢复功能

- [ ] D.1 配置 PostgresSaver 检查点器
  - 创建 `server/services/workflow/checkpointer.ts`
  - 配置 PostgresSaver 连接数据库
  - _Requirements: 2.1, 2.2, 11.3_

- [ ] D.2 实现工作流状态定义
  - 创建 `server/services/workflow/state.ts`
  - 定义工作流状态类型和初始状态
  - _Requirements: 1.1_

- [ ] D.3 实现材料处理节点
  - 创建 `server/services/workflow/nodes/materialProcess.ts`
  - 实现材料内容聚合
  - _Requirements: 3.12, 3.13_

- [ ] D.4 实现案情信息检查节点（中断点1）
  - 创建 `server/services/workflow/nodes/caseInfoCheck.ts`
  - 实现案情信息检查和 interrupt() 中断
  - 支持循环检查-补充流程
  - _Requirements: 4.1, 4.2, 4.3, 4.7, 4.8, 4.9, 4.10_

- [ ] D.5 实现基本信息提取节点（中断点2）
  - 创建 `server/services/workflow/nodes/extractInfo.ts`
  - 实现信息提取和 interrupt() 中断
  - 支持用户修改提取结果
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9_

- [ ] D.6 实现模块选择节点（中断点3）
  - 创建 `server/services/workflow/nodes/moduleSelect.ts`
  - 实现模块列表返回和 interrupt() 中断
  - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [ ] D.7 实现分析任务节点
  - 创建 `server/services/workflow/nodes/analysisTask.ts`
  - 实现模块执行、流式输出、结果保存
  - 集成材料检索工具（`search_case_materials`）
  - 集成法律检索工具（已有 `searchLaw.tool.ts`）
  - _Requirements: 6.1-6.7, 12.5_

- [ ] D.8 组装完整工作流
  - 创建 `server/services/workflow/caseAnalysis.workflow.ts`
  - 使用 StateGraph 组装所有节点，配置 checkpointer
  - _Requirements: 1.1, 1.5, 1.6, 12.1, 12.2_

- [ ]* D.9 编写工作流属性测试
  - **Property 1: 工作流中断-恢复往返一致性**
  - **Property 2: 检查点持久化完整性**
  - **Validates: Requirements 1.3, 1.4, 2.2, 2.3, 2.6**

- [ ] D.10 检查点 - 工作流验证
  - 可通过代码测试工作流的完整执行流程
  - 可测试中断和恢复功能


---

## 模块 E：案件分析 API（依赖模块D）

**目标**：实现案件分析的完整 API，包括 SSE 流式通信
**验证方式**：可通过 API 创建案件、启动分析、恢复工作流

- [ ] E.1 实现案件服务
  - 创建 `server/services/case/case.service.ts`
  - 实现案件创建、获取、更新、会话管理
  - _Requirements: 3.1, 3.2, 5.6, 5.7, 8.3, 8.4, 8.5_

- [ ] E.2 实现分析结果服务
  - 创建 `server/services/case/analysis.service.ts`
  - 实现分析结果保存、版本管理、历史查询
  - _Requirements: 8.1, 8.2, 9.6, 9.7_

- [ ] E.3 实现 SSE 服务端
  - 创建 `server/services/sse/sse.service.ts`
  - 实现 SSE 连接管理、流式数据发送
  - _Requirements: 7.1, 7.2_

- [ ] E.4 实现 AI SDK 适配器集成
  - 创建 `server/services/sse/adapter.ts`
  - 使用 @ai-sdk/langchain 的 toUIMessageStream 转换流式数据
  - _Requirements: 12.3, 12.4_

- [ ] E.5 实现中断事件处理
  - 在 SSE 服务中处理 __interrupt__ 字段
  - _Requirements: 7.4, 7.5_

- [ ] E.6 实现案件分析 API
  - POST /api/v1/case/create - 创建案件
  - POST /api/v1/case/resume/[sessionId] - 恢复工作流
  - GET /api/v1/case/state/[sessionId] - 获取工作流状态
  - GET /api/v1/case/[caseId] - 获取案件信息
  - POST /api/v1/case/analysis/stream/[caseId] - SSE 流式分析
  - _Requirements: 1.3, 3.1, 9.1, 9.3_

- [ ] E.7 实现示范案例前台 API
  - GET /api/v1/demo-cases - 获取示范案例列表
  - POST /api/v1/demo-cases/create-case/[id] - 使用示范案例创建案件
  - _Requirements: 18.1, 18.2, 18.4, 18.5_

- [ ] E.8 检查点 - API 验证
  - 可通过 API 完成案件创建、分析启动、工作流恢复
  - 可通过 SSE 接收流式分析结果

---

## 模块 F：前端基础服务（依赖模块E）

**目标**：实现前端的文件处理、SSE 客户端等基础服务
**验证方式**：可在浏览器中读取文件内容、建立 SSE 连接

- [ ] F.1 实现文件读取服务
  - 创建 `app/composables/useFileReader.ts`
  - 实现 md/txt 直接读取、docx/doc 使用 mammoth.js 提取
  - _Requirements: 3.6, 3.7_

- [ ]* F.2 编写文件读取属性测试
  - **Property 8: 材料内容提取完整性**
  - **Validates: Requirements 3.6, 3.7**

- [ ] F.3 实现文件加密服务
  - 创建 `app/composables/useFileEncrypt.ts`
  - 实现浏览器端文件加密
  - _Requirements: 3.3, 3.4_

- [ ] F.4 实现 SSE 客户端 composable
  - 创建 `app/composables/useCaseAnalysis.ts`
  - 集成 AI SDK 的 useChat hook
  - _Requirements: 7.1, 7.2, 7.3_

- [ ] F.5 实现中断事件处理
  - 解析 __interrupt__ 字段，触发对应 UI 交互
  - _Requirements: 7.4, 7.5_

- [ ] F.6 检查点 - 前端基础服务验证
  - 可在浏览器中读取各类文件内容
  - 可建立 SSE 连接并接收消息


---

## 模块 G：前端案件分析页面（依赖模块F）

**目标**：实现完整的案件分析前端页面
**验证方式**：可在浏览器中完成完整的案件分析流程

- [ ] G.1 实现材料上传组件
  - 创建 `app/components/case/MaterialUploader.vue`
  - 支持多种文件类型上传、加密选项
  - _Requirements: 3.2, 3.3_

- [ ] G.2 实现任务清单组件
  - 创建 `app/components/case/TaskList.vue`
  - 展示分析步骤：案情检查、基本信息确认、模块选择、各分析模块
  - 支持待处理、进行中、已完成三种状态
  - 点击已完成任务跳转到对应结果
  - _Requirements: 10.8-10.20_

- [ ] G.3 实现对话消息列表组件
  - 创建 `app/components/case/ConversationList.vue`
  - 使用 ai-elements-vue 的 Conversation、Message 组件
  - _Requirements: 10.1, 10.4_

- [ ] G.4 实现 AI 响应组件
  - 创建 `app/components/case/AIResponse.vue`
  - 使用 MessageResponse、Reasoning、Tool 组件
  - _Requirements: 10.2, 10.3, 10.5, 10.6_

- [ ] G.5 实现中断确认组件
  - 创建 `app/components/case/InterruptConfirmation.vue`
  - 使用 Confirmation 组件处理中断交互
  - 支持案情补充（中断点1）、基本信息编辑（中断点2）、模块选择（中断点3）
  - _Requirements: 10.7, 4.4, 4.5, 4.6, 5.4, 5.5_

- [ ] G.6 实现分析结果展示组件
  - 创建 `app/components/case/AnalysisResults.vue`
  - 支持模块切换、重新生成
  - _Requirements: 8.1, 8.2, 8.3_

- [ ] G.7 实现自适应布局组件
  - 创建 `app/components/case/SplitLayout.vue`
  - 实现全宽/分栏布局切换、可拖拽分割线
  - 支持关闭/展开结果区域
  - _Requirements: 19.1-19.11, 19.20_

- [ ] G.8 实现浮动操作按钮
  - 创建 `app/components/case/FloatingActions.vue`
  - 实现导出按钮（Word/PDF/Markdown）和导航菜单
  - _Requirements: 19.12-19.15_

- [ ] G.9 实现示范案例展示组件
  - 创建 `app/components/case/DemoCaseList.vue`
  - 展示示范案例列表，支持点击创建案件
  - _Requirements: 18.1, 18.2, 18.3_

- [ ] G.10 实现案件分析主页面
  - 创建 `app/pages/case/[id]/analysis.vue`
  - 组装所有组件，实现完整分析流程
  - 集成任务清单、自适应布局、示范案例
  - _Requirements: 1.1, 9.1, 9.2, 9.3_

- [ ] G.11 实现移动端适配
  - 在主页面添加移动端视图切换
  - 实现底部切换标签和滑动动画
  - _Requirements: 19.16-19.19_

- [ ] G.12 检查点 - 案件分析端到端验证
  - 可在浏览器中完成完整的案件分析流程
  - 包括材料上传、案情检查、信息提取、模块选择、分析执行

---

## 模块 H：会员中心积分页面（依赖模块B.4）

**目标**：实现会员中心的积分展示和消费记录页面
**验证方式**：可在会员中心查看积分信息和消费记录

- [ ] H.1 实现积分概览组件
  - 创建 `app/components/user/PointOverview.vue`
  - 展示总积分、已使用、剩余可用
  - **注意**：调用已有 API `/api/v1/points/info`
  - _Requirements: 16.6_

- [ ] H.2 实现积分消费记录列表
  - 创建 `app/components/user/PointConsumptionRecords.vue`
  - 展示消费记录列表，关联消耗项目信息
  - **注意**：调用已有 API `/api/v1/points/usage`
  - _Requirements: 16.11, 16.12, 16.13_

- [ ] H.3 集成到会员中心页面
  - 更新 `app/pages/user/points.vue`
  - 整合积分概览和消费记录
  - _Requirements: 16.6, 16.13_

- [ ] H.4 检查点 - 会员中心积分验证
  - 可在会员中心查看积分信息和消费记录

---

## 模块 I：最终集成验证

- [ ] I.1 全功能端到端测试
  - 测试完整的案件分析流程
  - 测试后台管理功能
  - 测试会员中心积分功能
  - 确保所有功能正常工作

- [ ] I.2 检查点 - 全功能验证
  - 确保所有功能正常工作，所有测试通过，如有问题请询问用户


---

## 注意事项

### 模块执行顺序

1. **模块 A** → 必须首先完成，为所有后续模块提供数据存储
2. **模块 B** → 依赖 A，完成后可独立使用后台管理功能
3. **模块 C** → 依赖 A 和 B.4（积分配置），完成后可独立测试材料处理
4. **模块 D** → 依赖 A、B、C，完成后可通过代码测试工作流
5. **模块 E** → 依赖 D，完成后可通过 API 测试案件分析
6. **模块 F** → 依赖 E，完成后可测试前端基础服务
7. **模块 G** → 依赖 F，完成后可进行完整的前端测试
8. **模块 H** → 依赖 B.4，可与模块 C-G 并行开发

### 已有服务复用

- 积分服务（`server/services/point/`）已完整实现，包括 FIFO 扣减逻辑
- 积分 API（`/api/v1/points/*`）已实现，前端直接调用即可
- 模型服务（`server/services/model/`）已实现
- 文件存储服务（`server/services/files/` 和 `server/lib/oss/`）已实现
- 向量存储服务（`server/services/legal/vectorStore.service.ts`）已实现

### API 开发规范

- 所有 API 必须使用 `resSuccess(event, message, data)` / `resError(event, code, message)` 封装响应
- 用户认证使用 `event.context.auth?.user`
- 参数验证使用 zod
- params 参数必须在路径最末尾

### 测试任务说明

- 任务标记 `*` 的为可选属性测试任务
- 属性测试使用 fast-check 库
- 每个属性测试至少运行 100 次迭代