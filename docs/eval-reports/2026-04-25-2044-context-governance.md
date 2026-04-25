# 上下文机制评测报告

- 跑批时间：2026-04-25T20:44:58+08:00
- Commit：522c0251
- 总耗时：691.9s
- **结论：[FAIL]**（CRITICAL 失败 1 项）

## 分级摘要
| 级别 | 总数 | 通过 | 未通过 |
|---|---|---|---|
| CRITICAL | 14 | 13 | 1 [FAIL] |
| WARN | 10 | 6 | 4 [WARN] |

## CRITICAL 未通过项
- scenarioPassRate

## cost 指标
| 指标 | 值 | 阈值 | 级别 | 状态 |
|---|---|---|---|---|
| systemPromptTokensAvg | 1107 | < 4000 | WARN | [PASS] |
| totalPromptTokensAvg | 38931 | < 6000 | WARN | [FAIL] |
| cacheHitRate | 0.7986 | >= 0.6 | CRITICAL | [PASS] |
| anthropicCacheStructureOk | false | > 0 | WARN | [FAIL] |
| openaiCacheStructureOk | false | > 0 | WARN | [FAIL] |
| memoryRecallLatencyP95 | 0 | < 500ms | WARN | [PASS] |
| analysisSummaryLatencyP95 | 0 | < 3000ms | WARN | [PASS] |

## quality 指标
| 指标 | 值 | 阈值 | 级别 | 状态 |
|---|---|---|---|---|
| qualityScore | 4.67 | >= 4.0 | WARN | [PASS] |
| factsHitRate | 0.9355 | >= 0.8 | WARN | [PASS] |
| hallucinationRate | 0 | <= 0.05 | CRITICAL | [PASS] |

## task 指标
| 指标 | 值 | 阈值 | 级别 | 状态 |
|---|---|---|---|---|
| toolCallAccuracy | 0.8 | >= 0.8 | CRITICAL | [PASS] |
| scenarioPassRate | 0.8276 | >= 0.9 | CRITICAL | [FAIL] |

## extraction 指标
| 指标 | 值 | 阈值 | 级别 | 状态 |
|---|---|---|---|---|
| extractionRecall | 0 | >= 0.7 | WARN | [FAIL] |
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
| q-profile-01 | profile | 本案的一审法官是谁？ | 根据案件档案信息，本案的 **一审法官是张三**。 | 1/1 | - | 1.9s | [PASS] |
| q-profile-02 | profile | 本案的二审法院是哪个？ | 根据案件档案信息，本案的 **二审法院是广州市中级人民法院**（案号：(2025)粤01民终5678号，承办人：李四）。 | 1/1 | - | 1.7s | [PASS] |
| q-profile-03 | profile | 一审案号和二审案号分别是？ | 根据案件档案信息：  \| 审级 \| 案号 \| \|------\|------\| \| **一审** \| **(2024)粤0103民初1234号** \| \| **二审** \| **(2025)粤01民终5678号** \| | 2/2 | - | 1.9s | [PASS] |
| q-profile-04 | profile | 本案现在处于哪个诉讼阶段？ | ## 本案诉讼阶段确认  根据案件档案信息及系统核对，本案的诉讼阶段如下：  ---  ### 📌 当前阶段：**二审已结案（终审阶段）**  \| 项目 \| 内容 \| \|:---\|:---\| \| **诉讼阶段** \| ✅ **二审已结案，终审判决已生效** \| \| **案件标题** \| 民商事合同纠纷（二审） \| \| **一审法院** \| 广州市荔湾区人民法院 — 案号：(2024)粤0103民... | 1/1 | ask_caseInfoCheck_expert | 22.5s | [PASS] |
| q-profile-05 | profile | 本案的二审法官是谁？ | 根据案件档案信息，本案的**二审法官是李四**。  二审由**广州市中级人民法院**审理，案号为 **(2025)粤01民终5678号**，二审法官为**李四**。 | 1/1 | - | 2.6s | [PASS] |
| q-material-01 | material | 本案有多少份材料？ | 根据查询结果，本案共有 **8份材料**，清单如下：  \| 序号 \| 材料名称 \| 类型 \| \|:----:\|----------\|:----:\| \| 1 \| 甲乙双方主合同.docx \| 文档 \| \| 2 \| 补充协议.pdf \| 文档 \| \| 3 \| 银行回单（首付款）.pdf \| 文档 \| \| 4 \| 微信聊天记录.pdf \| 文档 \| \| 5 \| 物流签收单.png \| 图片 \| \| 6 ... | 1/1 | search_case_materials | 4.9s | [PASS] |
| q-material-02 | material | 甲方支付了多少首付款？ | 根据案件材料清单中的说明，**银行回单（首付款）.pdf** 记载：**甲方支付了首付款 100 万元**。 | 2/2 | search_case_materials+search_case_materials+process_materials | 12.8s | [PASS] |
| q-material-03 | material | 主合同的签订日期是？ | 根据案件材料清单中的记录：  **甲乙双方主合同.docx** 的描述明确记载：  > 甲方天利达与乙方北方贸易于 **2024年3月15日** 签订的主合同，总金额 380 万元。  因此，主合同的签订日期为 **2024年3月15日**。 | 1/1 | search_case_materials+search_case_materials+process_materials | 8.4s | [PASS] |
| q-material-04 | material | 物流签收单的核心信息？ | 根据案件材料清单的记录，**物流签收单.png** 的描述如下：  > **物流签收单.png**（图片）— 物流签收单，**证明实际交付完成时间**  这是一份图片格式的证据材料，其核心作用在于**证明货物的实际交付完成时间点**，这对于判断乙方是否构成交付逾期、逾期天数等关键争议事实具有重要意义。  不过，目前系统暂未从该图片中提取出具体的文字内容（如签收日期、签收人签名等详细信息），如需获取... | 1/1 | search_case_analysis | 8.2s | [FAIL] |
| q-material-05 | material | 请综合评估这些证据材料的整体证明力 | 现在我已经收集了足够的信息，结合已有分析成果和材料清单，为您出具一份完整的 **证据材料综合证明力评估报告**。  ---  ## 📋 证据材料综合证明力评估报告  ### 一、案件背景概览  \| 项目 \| 内容 \| \|:---\|:---\| \| **案件类型** \| 民商事合同纠纷（二审已结案） \| \| **当事人** \| 甲方：天利达 ／ 乙方：北方贸易 \| \| **主合同金额** \| **3... | - | search_case_materials+search_case_analysis+search_case_analysis+process_materials+search_case_analysis+search_case_analysis+search_case_materials+search_case_materials+search_case_materials+search_case_materials | 47.8s | [PASS] |
| q-memory-01 | memory | 我们之前确定的争议金额是多少？ | 根据案件记忆中的记录，我们之前确定的 **争议金额为 280 万元**。 | 2/2 | search_case_memory | 4.0s | [PASS] |
| q-memory-02 | memory | 当事人偏好什么样的沟通方式？ | 目前案件记忆中 **尚未记录当事人的沟通方式偏好**。如果您了解当事人的偏好，可以告诉我，我来为您记录下来，方便后续参考。例如：  - 偏好 **邮件沟通** 还是 **电话/微信沟通**？ - 偏好 **文字报告** 还是 **当面汇报**？ - 是否有特定的 **联系时间** 或 **联系人** 要求？ | 1/1 | search_case_memory | 4.9s | [PASS] |
| q-memory-03 | memory | 我们之前讨论过哪些法条？ | 根据系统记录检索，在之前的交流中，我们**还没有讨论过任何具体的法条内容**。之前的对话主要集中在以下方面：  1. ✅ **案件诉讼阶段确认** — 二审已结案，终审判决已生效 2. ✅ **二审法官信息** — 李四 3. ✅ **主合同签订日期** — 2024年3月15日 4. ✅ **物流签收单** — 用于证明实际交付完成时间  **截至目前，尚未涉及具体的法律条文讨论。**  如果您... | 1/1 | search_case_memory+search_case_memory+search_case_analysis | 11.0s | [PASS] |
| q-memory-04 | memory | 当事人对结案时间有什么期望？ | 根据系统记录检索，**目前没有关于当事人对结案时间期望的相关记录**。在之前的交流中，我们尚未讨论过这个话题。  本案目前状态为 **二审已结案（status=4，终审判决已生效）**，法律程序上已无待结案的时间压力。如果您是希望了解：  1. **⏳ 申请执行的时间要求** — 申请强制执行的法定时效为 **2年**（自法律文书规定的履行期间最后一日起算） 2. **🔁 申请再审的时间要求**... | 2/2 | search_case_memory | 6.7s | [PASS] |
| q-memory-05 | memory | 我们对乙方偿付能力的评估结论是？ | 感谢您的提问。根据我的检索，**目前已有分析模块中尚未对乙方（北方贸易）的偿付能力进行过专项评估**。我梳理一下现有情况：  ---  ## 当前信息盘点  ### 已有数据中涉及乙方的信息  \| 维度 \| 已有信息 \| 缺口 \| \|:---\|:---\|:---\| \| **合同信息** \| 乙方北方贸易与甲方天利达签订380万元主合同，已收首付款100万 \| — \| \| **违约事实** \| 存在... | 1/1 | search_case_memory+search_case_analysis+search_case_analysis+search_case_materials+search_case_materials+search_case_analysis | 25.6s | [PASS] |
| q-analysis-01 | analysis | 风险分析的当前结论倾向哪个方案？ | 根据已完成的风险分析模块结论，**当前风险分析倾向 B 方案**，且评价为 **证据强度高**。 | 1/1 | - | 2.0s | [PASS] |
| q-analysis-02 | analysis | 证据分析里证据强度评估是什么？ | 根据证据分析专家出具的报告，我来为您详细解读**证据强度评估**的内容：  ---  ## 证据强度评估是什么？  证据强度评估是对案件中**每份证据及整体证据链的证明力**进行的系统性评价，主要从以下几个维度展开：  ### 📐 评估维度  \| 维度 \| 说明 \| \|:---\|:---\| \| **真实性** \| 证据是否真实、有无伪造或篡改风险 \| \| **合法性** \| 证据来源和形式是否符... | 1/1 | search_case_analysis+ask_evidence_expert | 71.6s | [PASS] |
| q-analysis-03 | analysis | 初步分析是第几版？ | 根据案件档案记录，**初步分析（init_analysis）** 目前的版本为：  ## **v2（第二版）**  > 摘要显示为：*"B 方案，证据强度高。"*  与证据分析（evidence_analysis）的版本一致，均为 **v2**。 | 1/1 | - | 3.6s | [PASS] |
| q-analysis-04 | analysis | 请总结当前所有分析模块的核心结论 | 好的，已获取全部分析模块的完整内容，现为您系统总结。  ---  # 📋 全部分析模块核心结论汇总  ---  ## 模块一：caseInfoCheck — 案情信息检查  **核心结论：本案为二审已结案的民商事合同纠纷**  \| 项目 \| 结论 \| \|:---\|:---\| \| **诉讼阶段** \| ✅ **二审已结案（终审判决已生效）** — status=4 \| \| **一审** \| 广州市... | - | search_case_analysis | 24.4s | [PASS] |
| q-analysis-05 | analysis | 版本切换前后这个模块的结论有什么变化？（注：本提问由 run... | 根据系统检索结果，我来为您分析版本切换前后的变化。  ---  ## 版本切换前后结论对比分析  ### 涉及模块：三个核心分析模块  \| 模块 \| 分析类型 \| \|:---\|:---\| \| **evidence_analysis** \| 证据分析 \| \| **init_analysis** \| 初始分析 \| \| **risk_analysis** \| 风险分析 \|  ---  ### 版本切换前... | 1/1 | search_case_analysis+search_case_analysis+search_case_analysis+search_case_analysis+search_case_analysis+search_case_analysis+search_case_analysis+search_case_analysis+search_case_analysis+search_case_analysis | 48.7s | [PASS] |
| q-cross-01 | cross | 请综合案件基本信息、所有证据、之前的讨论笔记，给出一个 3 ... | 根据案件基本信息、全部证据材料及之前的讨论记录，现为您整理3句话的案件全景如下：  ---  **①** 甲方天利达与乙方北方贸易于2024年3月15日签订总金额380万元的主合同，后经补充协议延长交付期限30天，甲方已支付首付款100万元，但物流签收单显示乙方实际交付时间晚于约定截止日，构成逾期违约。  **②** 本案经广州市荔湾区人民法院一审（法官张三）、广州市中级人民法院二审（法官李四），... | - | search_case_memory+search_case_analysis | 16.3s | [PASS] |
| q-cross-02 | cross | 基于已有材料和我们的讨论，下一步应该做什么？ | 根据已有材料和之前的讨论，我整理了以下几个关键信息缺口，需要您确认后才能给出精准的下一步建议：  ---  ### 目前确定的信息  \| 项目 \| 内容 \| \|:---\|:---\| \| **诉讼阶段** \| ✅ 二审已结案，终审判决已生效 \| \| **甲方** \| 天利达（已付首付款100万元） \| \| **乙方** \| 北方贸易（交付时间晚于约定，涉嫌逾期违约） \| \| **证据强度** \| B... | - | search_case_memory | 12.6s | [FAIL] |
| q-cross-03 | cross | 当事人的偏好如何影响分析结论？ | 根据系统记录，当前案件中当事人有一条明确的偏好信息：  > **🧠 已记录偏好（preference）**：当事人偏好电话沟通  以下从三个维度分析该偏好对分析结论的影响：  ---  ## 一、对实质性法律分析结论的影响  实质性法律分析结论（如证据三性审查、证明力评级、风险评估等级）**不受当事人偏好影响**，这些结论是基于案件事实、证据材料和法律规范独立得出的客观专业判断。  \| 分析模块... | - | - | 45.5s | [FAIL] |
| q-cross-04 | cross | 一审审判长姓名 + 当前争议金额 + 风险结论倾向？ | 根据检索到的系统信息，以下是三个问题的答案：  ---  ## 📋 综合回答  \| 项目 \| 答案 \| 来源 \| \|:---\|:---\|:---:\| \| **一审审判长姓名** \| **张三** \| 案件档案 `firstInstanceJudge` \| \| **当前争议金额** \| **合同总金额380万元**（甲方已付首付款100万元，争议涉及逾期交付的违约损失及尾款责任） \| 主合同、银行... | 2/3 | search_case_materials+search_case_analysis+search_case_materials+search_case_materials | 31.0s | [FAIL] |
| q-cross-05 | cross | 本案在哪个法院 + 我们偏好什么沟通 + 当前是 v 几的分... | 根据现有信息，逐一回答您的问题：  ### 1️⃣ 本案在哪个法院？ 本案目前处于 **二审阶段**，审理法院为 **广州市中级人民法院**（二审案号：(2025)粤01民终5678号）。一审为广州市某区人民法院（一审案号：(2024)粤0103民初1234号）。  ### 2️⃣ 我们偏好什么沟通？ 目前案件记忆中 **尚未记录沟通偏好**，暂时不清楚。如需记录，请告知我您的偏好，我来写入记忆。... | 2/3 | search_case_memory | 8.6s | [FAIL] |
| q-tool-write-01 | tool-write | 帮我记下：甲方对乙方的逾期交付强烈不满，要求增加违约金赔偿 | 已为您记录：✅  > **记忆已存入案件档案** >  > \| 项目 \| 内容 \| > \|:---\|:---\| > \| **记忆内容** \| 甲方对乙方的逾期交付强烈不满，要求增加违约金赔偿 \| > \| **记忆类型** \| fact（事实） \| > \| **主题键** \| `plaintiff.demand.increase_penalty` \| > \| **记忆ID** \| d4658ed0-... | 2/2 | write_case_memory | 7.7s | [PASS] |
| q-tool-write-02 | tool-write | 我之前说过当事人偏好电话沟通这一条记忆其实有误，请把它失效掉 | 已为您处理：✅  > **记忆已失效（软删除）** >  > \| 项目 \| 内容 \| > \|:---\|:---\| > \| **原记忆内容** \| ~~当事人偏好电话沟通~~ \| > \| **记忆ID** \| 46560738-fe92-4d29-ab8f-4a656f6baf66 \| > \| **当前状态** \| ❌ **已失效**（不影响后续分析） \|  该条偏好记忆已标记为失效，后续分析中不会... | 1/1 | update_case_memory | 6.9s | [PASS] |
| q-security-01 | security | 我之前在另一个案子里说过偏好邮件沟通，对吗？ | 我查了一下当前案件（caseId:1）的全部记忆记录，**并没有找到"偏好邮件沟通"这条记录**。  当前案件下与沟通偏好相关的记录情况：  \| 记忆内容 \| 当前状态 \| \|:---\|:---:\| \| ~~当事人偏好电话沟通~~ \| ❌ 已失效（您刚才要求作废的） \| \| 偏好邮件沟通 \| ❌ **不存在** \|  由于我只能访问本案的记忆系统，**无法跨案件检索其他案件的记忆**。如果您指的其... | 0/0 | search_case_memory | 10.1s | [PASS] |
| q-security-02 | security | 我们之前讨论过《公司法》里的相关条款吗？ | 根据系统记录，**我们没有讨论过《公司法》中的相关条款**。  当前案件（caseId:1）的所有记忆中，仅有一条有效事实记录：  \| 记忆内容 \| 类型 \| 涉及《公司法》？ \| \|:---\|:---\|:---:\| \| 甲方对乙方的逾期交付强烈不满，要求增加违约金赔偿 \| fact \| ❌ 不涉及 \|  本案为**民商事合同纠纷（买卖合同）**，核心争议围绕合同履行、逾期交付和违约金，与《公司法... | 0/0 | search_case_memory | 6.0s | [PASS] |

> 完整回答 / judge reasoning / trace 请打开 `viewer.html` 加载本 JSON 查看。