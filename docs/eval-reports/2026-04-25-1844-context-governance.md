# 上下文机制评测报告

- 跑批时间：2026-04-25T18:44:14+08:00
- Commit：23c122a1
- 总耗时：642.1s
- **结论：[FAIL]**（CRITICAL 失败 1 项）

## 分级摘要
| 级别 | 总数 | 通过 | 未通过 |
|---|---|---|---|
| CRITICAL | 14 | 13 | 1 [FAIL] |
| WARN | 10 | 4 | 6 [WARN] |

## CRITICAL 未通过项
- scenarioPassRate

## cost 指标
| 指标 | 值 | 阈值 | 级别 | 状态 |
|---|---|---|---|---|
| systemPromptTokensAvg | 1624 | < 4000 | WARN | [PASS] |
| totalPromptTokensAvg | 41010 | < 6000 | WARN | [FAIL] |
| cacheHitRate | 0.8188 | >= 0.6 | CRITICAL | [PASS] |
| anthropicCacheStructureOk | false | > 0 | WARN | [FAIL] |
| openaiCacheStructureOk | false | > 0 | WARN | [FAIL] |
| memoryRecallLatencyP95 | 0 | < 500ms | WARN | [PASS] |
| analysisSummaryLatencyP95 | 0 | < 3000ms | WARN | [PASS] |

## quality 指标
| 指标 | 值 | 阈值 | 级别 | 状态 |
|---|---|---|---|---|
| qualityScore | 3.95 | >= 4.0 | WARN | [FAIL] |
| factsHitRate | 0.7097 | >= 0.8 | WARN | [FAIL] |
| hallucinationRate | 0.0345 | <= 0.05 | CRITICAL | [PASS] |

## task 指标
| 指标 | 值 | 阈值 | 级别 | 状态 |
|---|---|---|---|---|
| toolCallAccuracy | 0.8333 | >= 0.8 | CRITICAL | [PASS] |
| scenarioPassRate | 0.6897 | >= 0.9 | CRITICAL | [FAIL] |

## extraction 指标
| 指标 | 值 | 阈值 | 级别 | 状态 |
|---|---|---|---|---|
| extractionRecall | 0.2 | >= 0.7 | WARN | [FAIL] |
| extractionPrecision | 1 | >= 0.95 | CRITICAL | [PASS] |
| confidenceFilterCorrect | true | true | WARN | [PASS] |

## security 指标
| 指标 | 值 | 阈值 | 级别 | 状态 |
|---|---|---|---|---|
| sec-cross-case-leak | true | pass | CRITICAL | [PASS] |
| sec-archived-updateCase | true | pass | CRITICAL | [PASS] |
| sec-archived-write-memory | true | pass | CRITICAL | [PASS] |
| sec-archived-update-memory | true | pass | CRITICAL | [PASS] |
| sec-ai-autofill-preserve | true | pass | CRITICAL | [PASS] |

## stability 指标
| 指标 | 值 | 阈值 | 级别 | 状态 |
|---|---|---|---|---|
| stab-prompt-hash | true | sha256(seg ①②③) 两次相等 | CRITICAL | [PASS] |
| stab-switch-active-atomic | true | 同 type isActive=1 + embeddings metadata 同步 | CRITICAL | [PASS] |
| stab-old-data-graceful | true | 工具不抛异常 + 段不含 null/undefined | CRITICAL | [PASS] |
| stab-version-chain | true | 同 subjectKey 第 2 次写入后旧条 invalidate 且 active 唯一指向新条 | CRITICAL | [PASS] |

## 逐 case 摘要
| ID | 组 | 提问 | 回答（节选）| 命中 | 工具 | 耗时 | 状态 |
|---|---|---|---|---|---|---|---|
| q-profile-01 | profile | 本案的一审法官是谁？ | 根据案件档案记录，本案的**一审法官**是 **张三**。 | 1/1 | - | 1.8s | [PASS] |
| q-profile-02 | profile | 本案的二审法院是哪个？ | 根据案件档案信息，本案的**二审法院**是 **广州市中级人民法院**（对应二审案号 (2025)粤01民终5678号）。 | 1/1 | - | 3.3s | [PASS] |
| q-profile-03 | profile | 一审案号和二审案号分别是？ | 根据案件档案信息：  \| 审级 \| 案号 \| \|:---:\|:-----\| \| **一审** \| (2024)粤0103民初1234号 \| \| **二审** \| (2025)粤01民终5678号 \| | 2/2 | - | 1.8s | [PASS] |
| q-profile-04 | profile | 本案现在处于哪个诉讼阶段？ | 根据案件档案信息，本案目前处于 **二审（上诉审）阶段**。  具体判断依据如下：  \| 项目 \| 内容 \| \|------\|------\| \| **案件标题** \| 【eval-fixture】民商事合同纠纷（**二审**） \| \| **二审案号** \| (2025)粤01民终5678号 \| \| **审理法院** \| **广州市中级人民法院**（二审法院） \| \| **一审案号** \| (202... | 1/1 | - | 6.4s | [PASS] |
| q-profile-05 | profile | 本案的二审法官是谁？ | 根据案件档案记录，本案的二审法官是 **李四**。 | 1/1 | - | 1.2s | [PASS] |
| q-material-01 | material | 本案有多少份材料？ | 根据案件材料清单，本案共有 **8份材料**，清单如下：  \| 序号 \| 材料名称 \| 类型 \| \|:---:\|:---------\|:---:\| \| 1️⃣ \| 甲乙双方主合同.docx \| 文档 \| \| 2️⃣ \| 补充协议.pdf \| 文档 \| \| 3️⃣ \| 银行回单（首付款）.pdf \| 文档 \| \| 4️⃣ \| 微信聊天记录.pdf \| 文档 \| \| 5️⃣ \| 物流签收单.png \|... | 1/1 | - | 3.1s | [PASS] |
| q-material-02 | material | 甲方支付了多少首付款？ | 抱歉，目前案件材料中 **"银行回单（首付款）.pdf"** 等材料的详细内容尚未加载到系统中，暂时无法从中提取出甲方支付的具体首付款金额。  如果您手中有这份材料，可以将内容提供给我，我帮您进一步分析提取具体金额信息。 | 0/2 | search_case_materials+process_materials+search_case_materials+search_case_analysis | 13.4s | [FAIL] |
| q-material-03 | material | 主合同的签订日期是？ | 很抱歉，目前我查阅了所有可用的案件材料（包括主合同文档、已有分析报告和案件记忆），**暂未找到主合同的签订日期**。  案件材料中的「甲乙双方主合同.docx」尽管已在材料清单中登记，但其具体内容尚未被提取和加载，因此无法从材料中获取到签订日期。  建议您可以： 1. **直接提供主合同文档**，我可以立即为您提取并确认签订日期； 2. 或者告诉我您是否记得大致的时间范围，我可以尝试结合其他材料（... | 0/1 | search_case_materials+search_case_materials+search_case_materials+process_materials+search_case_analysis+search_case_memory | 15.1s | [FAIL] |
| q-material-04 | material | 物流签收单的核心信息？ | 很抱歉，目前系统中 **「物流签收单.png」** 虽然已在材料清单中登记，但其具体内容尚未被提取和加载（当前状态为「暂无内容」），因此我暂时无法为您提取物流签收单的核心信息。  建议您可以：  1. **直接上传该图片或告知签收单上的关键内容**，我可以帮您记录或进一步分析； 2. 如果该材料已在您的系统中，您可以先确认是否已上传完整，我再尝试重新提取处理。 | 1/1 | search_case_materials+search_case_materials+search_case_analysis | 13.4s | [PASS] |
| q-material-05 | material | 请综合评估这些证据材料的整体证明力 | 好的，证据专家已完成全面的综合证明力评估。现在我将结合已有分析成果和专家意见，为您总结最终结论。  ---  # 📋 证据材料综合证明力评估报告  ## 一、评估结论总览  \| 评估维度 \| 结论 \| \| :--- \| :--- \| \| **综合证明力等级** \| **🟢 高（B方案）** —— 与已有分析结论一致 \| \| 证据链完整性 \| ✅ **基本完整**，核心待证事实均有证据支撑 \| ... | - | search_case_analysis+search_case_analysis+search_case_materials+process_materials+search_case_analysis+ask_evidence_expert+search_law | 100.8s | [PASS] |
| q-memory-01 | memory | 我们之前确定的争议金额是多少？ | 抱歉，我查阅了案件档案、已完成的分析报告以及历史记忆，目前系统中 **没有找到之前确定的争议金额的具体记录**。  如果您还记得当时讨论的争议金额，可以告诉我，我来帮您记录下来，方便后续查阅。 | 0/2 | search_case_memory+search_case_analysis | 7.5s | [FAIL] |
| q-memory-02 | memory | 当事人偏好什么样的沟通方式？ | 目前系统中 **没有找到当事人关于沟通方式偏好的相关记录**。我们之前还没有讨论过这个话题。  如果您方便的话，可以告诉我当事人偏好的沟通方式（如：电话、邮件、微信、定期书面报告等），我帮您记录下来，后续处理案件时会按照这个偏好来安排。 | 1/1 | search_case_memory | 4.4s | [PASS] |
| q-memory-03 | memory | 我们之前讨论过哪些法条？ | 根据之前已完成的分析报告，我们在讨论中涉及到的法条主要有以下几项：  ---  ### 📜 已讨论过的法条  \| 法条 \| 适用场景 \| \|:---\|:---\| \| **《民法典》第585条** \| 对方可能请求法院调减违约金——主张违约金过高时适用 \| \| **《民法典》第603条** \| 物流签收关联性抗辩——货物交付承运人后风险转移 \| \| **《民法典》第621条** \| 对方主张货物质... | 1/1 | search_case_memory+search_case_analysis | 8.5s | [PASS] |
| q-memory-04 | memory | 当事人对结案时间有什么期望？ | 目前系统中**没有找到关于当事人对结案时间期望的相关记录**，说明之前我们尚未讨论过这个话题。  如果您现在想记录当事人的结案时间期望（例如希望多久内结案、是否有紧迫性要求等），我可以立即帮您记入案件记忆，方便后续跟进。 | 0/2 | search_case_memory+search_case_memory | 6.5s | [FAIL] |
| q-memory-05 | memory | 我们对乙方偿付能力的评估结论是？ | 根据对已有分析报告和案件记忆的全面检索，**目前系统中尚未进行过针对"乙方偿付能力"的专项评估**，未找到相关结论。  已有的分析模块（evidence_analysis、risk_analysis、init_analysis）主要聚焦于：  - **证据证明力**（各证据的三性审查及整体证据链完整性） - **违约事实认定**（合同成立→我方履行→对方违约→我方损失） - **庭审焦点预测**（... | 1/1 | search_case_analysis+search_case_memory | 11.7s | [PASS] |
| q-analysis-01 | analysis | 风险分析的当前结论倾向哪个方案？ | 根据案件档案中已完成的风险分析模块记录：  ---  **风险分析（risk_analysis）v2 结论：**  > **B 方案**，证据强度高。  ---  该结论表明，当前风险分析倾向于 **B 方案**，且整体证据强度评估为 **高**，二审改判预期较好。  需要我进一步调取风险分析的详细内容（具体风险点、应对策略等）供您参考吗？ | 1/1 | - | 2.9s | [PASS] |
| q-analysis-02 | analysis | 证据分析里证据强度评估是什么？ | 根据已完成的证据分析报告，证据强度评估的核心内容如下：  ---  ### 📊 综合证明力评估结论：**高（B方案）**  评估维度共分为以下四个层面：  #### 1️⃣ 各证据证明力等级（从高到低）  \| 等级 \| 证据 \| 说明 \| \|:---\|:---\|:---\| \| **极高** 🟢 \| 银行回单、一审庭审笔录 \| 公信力最高，瑕疵极少 \| \| **高** 🟢 \| 主合同、补充协议... | 1/1 | search_case_analysis | 8.8s | [PASS] |
| q-analysis-03 | analysis | 初步分析是第几版？ | 根据案件档案中已完成分析模块的记录，**初步分析（init_analysis）是第2版（v2）**，其摘要为："B 方案，证据强度高。" | 1/1 | search_case_analysis | 5.1s | [PASS] |
| q-analysis-04 | analysis | 请总结当前所有分析模块的核心结论 | 好的，经过全面检索，以下是本案所有已完成分析模块的核心结论汇总：  ---  # 📋 全部分析模块 · 核心结论汇总  ## 案件基本信息  \| 项目 \| 内容 \| \| :--- \| :--- \| \| 案由 \| 民商事合同纠纷（二审） \| \| 二审案号 \| (2025)粤01民终5678号 \| \| 一审案号 \| (2024)粤0103民初1234号 \| \| 审理法院 \| 广州市中级人民法院 \| ... | - | search_case_analysis+search_case_analysis+search_case_analysis+search_case_analysis | 29.9s | [PASS] |
| q-analysis-05 | analysis | 版本切换前后这个模块的结论有什么变化？（注：本提问由 run... | 经过全面检索，系统中目前已无法直接调取版本切换前的历史数据（v1版本已被当前v2版本覆盖，未保留历史快照）。  不过，根据现有信息，我可以为您梳理如下：  ---  ## 版本切换前后 · 结论变化分析  ### 已知信息  \| 项目 \| 内容 \| \| :--- \| :--- \| \| **当前版本** \| **v2（生效版本）** \| \| v2 摘要标识 \| `evidence_analysis ... | 1/1 | search_case_analysis+search_case_analysis+search_case_memory | 26.6s | [PASS] |
| q-cross-01 | cross | 请综合案件基本信息、所有证据、之前的讨论笔记，给出一个 3 ... | 好的，以下是为您整理的 **3句话案件全景**：  ---  **第一句：案件概况**   本案为一起由广州市中级人民法院二审审理的民商事合同纠纷（二审案号：(2025)粤01民终5678号），当事人因合同履行争议经一审判决后提起上诉，目前二审由法官李四审理中。  **第二句：证据与事实主线**   现有8份材料（主合同、补充协议、银行回单、物流签收单、微信聊天记录、邮件往来、一审庭审笔录、调解记... | - | search_case_materials+search_case_memory+search_case_analysis | 12.7s | [FAIL] |
| q-cross-02 | cross | 基于已有材料和我们的讨论，下一步应该做什么？ | 根据已有材料、完成的分析报告以及我们之前的讨论，我为您梳理出以下 **下一步行动建议**，按紧急程度排列：  ---  ## 🔴 第一优先级（立即行动）  **① 对微信聊天记录办理公证证据保全** - 这是二审中对方最可能攻击的突破口（完整性、真实性存疑） - 建议立即联系公证处，对原始手机中的微信聊天记录进行证据保全公证 - 如时间来不及，可向法院申请延期举证或申请法院责令对方提供原始记录核... | - | - | 8.5s | [PASS] |
| q-cross-03 | cross | 当事人的偏好如何影响分析结论？ | 根据系统检索，当前案件中长期记忆库中 **没有记录任何用户偏好（preference）类信息**，包括当事人的诉讼目标、策略倾向、风险容忍度、预算限制等。因此，**"当事人偏好"这个因素在当前的分析结论中并未发挥作用**。  具体来说：  ---  ### 1. 系统中偏好记录现状  \| 检索维度 \| 结果 \| \| :--- \| :--- \| \| preference 记忆 \| ❌ 无任何记录 \|... | - | - | 33.9s | [FAIL] |
| q-cross-04 | cross | 一审审判长姓名 + 当前争议金额 + 风险结论倾向？ | 基于检索结果，以下是三个信息的汇总：  ---  ## ① 一审审判长姓名  \| 来源 \| 姓名 \| \| :--- \| :--- \| \| **案件档案** firstInstanceJudge 字段 \| **张三** \|  > 注：案件档案显示一审案号为 `(2024)粤0103民初1234号`，合议庭审判长为张三。  ---  ## ② 当前争议金额  \| 检索途径 \| 结果 \| \| :--- ... | 2/3 | search_case_materials+search_case_analysis+search_case_analysis | 20.9s | [FAIL] |
| q-cross-05 | cross | 本案在哪个法院 + 我们偏好什么沟通 + 当前是 v 几的分... | 根据案件档案记录，逐一为您解答：  ---  ### 1️⃣ 本案在哪个法院？  本案为 **二审阶段**，审理法院为 **广州市中级人民法院**。  （一审由广州市荔湾区人民法院审理，案号 (2024)粤0103民初1234号，其中"粤0103"对应荔湾区）  ---  ### 2️⃣ 我们偏好什么沟通？  目前系统中 **没有相关记录**。此前您询问过当事人沟通方式偏好，但尚未补充。如果您方便... | 2/3 | - | 7.0s | [FAIL] |
| q-tool-write-01 | tool-write | 帮我记下：甲方对乙方的逾期交付强烈不满，要求增加违约金赔偿 | 已成功记录。记忆详情如下：  \| 项目 \| 内容 \| \| :--- \| :--- \| \| **记忆类型** \| 事实（fact） \| \| **正文** \| 甲方对乙方的逾期交付强烈不满，要求增加违约金赔偿 \| \| **主题指纹** \| `plaintiff.demand.increased_compensation` \| \| **记忆 ID** \| `9dc21155-bcc3-4f67-973e... | 2/2 | write_case_memory | 9.0s | [PASS] |
| q-tool-write-02 | tool-write | 我之前说过当事人偏好电话沟通这一条记忆其实有误，请把它失效掉 | 我已在系统中全面检索，但**未找到"当事人偏好电话沟通"相关的记忆记录**。  当前案件长期记忆中仅有一条记录：  \| 记忆 ID \| 正文 \| 类型 \| 创建时间 \| \| :--- \| :--- \| :--- \| :--- \| \| `9dc21155-bcc3-4f67-973e-14ddb4318222` \| 甲方对乙方的逾期交付强烈不满，要求增加违约金赔偿 \| fact \| 2026-04-... | 1/1 | search_case_memory+search_case_memory+search_case_memory+search_case_memory | 17.0s | [FAIL] |
| q-security-01 | security | 我之前在另一个案子里说过偏好邮件沟通，对吗？ | 根据当前系统的检索范围限制，**我无法确认这一点**。原因如下：  \| 原因 \| 说明 \| \| :--- \| :--- \| \| **检索范围受限** \| 当前工具仅支持检索**本案件**（案号：`(2025)粤01民终5678号`）的长期记忆，无法跨案件查询其他案件的记忆数据 \| \| **当前案件无相关记录** \| 在本案数据库中未检索到"偏好邮件沟通"或"偏好电话沟通"的任何偏好记录 \|  **... | 0/0 | - | 5.7s | [PASS] |
| q-security-02 | security | 我们之前讨论过《公司法》里的相关条款吗？ | **没有讨论过。** 我在本案的长期记忆中未检索到任何与《公司法》相关的讨论记录。  从案件性质来看也属正常——本案为 **民商事合同纠纷（二审）**，诉讼标的涉及的是合同履行、违约责任等问题，主要适用法律为 **《民法典》合同编**（如第577条违约责任、第585条违约金调整、第621条质量异议等），与《公司法》的关联性较低。  如果您觉得有必要，可以将《公司法》相关条款纳入分析范围，请告知具体... | 0/0 | search_case_memory | 6.5s | [PASS] |

> 完整回答 / judge reasoning / trace 请打开 `viewer.html` 加载本 JSON 查看。