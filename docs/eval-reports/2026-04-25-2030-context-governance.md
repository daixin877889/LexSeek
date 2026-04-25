# 上下文机制评测报告

- 跑批时间：2026-04-25T20:30:56+08:00
- Commit：55739106
- 总耗时：611.2s
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
| systemPromptTokensAvg | 1099 | < 4000 | WARN | [PASS] |
| totalPromptTokensAvg | 19502 | < 6000 | WARN | [FAIL] |
| cacheHitRate | 0.8657 | >= 0.6 | CRITICAL | [PASS] |
| anthropicCacheStructureOk | false | > 0 | WARN | [FAIL] |
| openaiCacheStructureOk | false | > 0 | WARN | [FAIL] |
| memoryRecallLatencyP95 | 0 | < 500ms | WARN | [PASS] |
| analysisSummaryLatencyP95 | 0 | < 3000ms | WARN | [PASS] |

## quality 指标
| 指标 | 值 | 阈值 | 级别 | 状态 |
|---|---|---|---|---|
| qualityScore | 4.55 | >= 4.0 | WARN | [PASS] |
| factsHitRate | 0.9355 | >= 0.8 | WARN | [PASS] |
| hallucinationRate | 0.0345 | <= 0.05 | CRITICAL | [PASS] |

## task 指标
| 指标 | 值 | 阈值 | 级别 | 状态 |
|---|---|---|---|---|
| toolCallAccuracy | 1 | >= 0.8 | CRITICAL | [PASS] |
| scenarioPassRate | 0.8621 | >= 0.9 | CRITICAL | [FAIL] |

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
| q-profile-01 | profile | 本案的一审法官是谁？ | 根据案件档案信息，本案的**一审法官**是 **张三**（张法官）。 | 1/1 | - | 1.5s | [PASS] |
| q-profile-02 | profile | 本案的二审法院是哪个？ | 根据案件档案信息，本案的**二审法院**是 **广州市中级人民法院**。  具体依据： - **二审案号**：`(2025)粤01民终5678号`（"粤01"对应广州市中级人民法院的法院代码） - **档案 courtName 字段**：广州市中级人民法院  这也与案件状态一致——本案正在 **广州市中级人民法院** 进行二审审理。 | 1/1 | - | 7.2s | [PASS] |
| q-profile-03 | profile | 一审案号和二审案号分别是？ | 根据案件档案信息：  \| 审级 \| 案号 \| 法院 \| \|------\|------\|------\| \| **一审** \| **(2024)粤0103民初1234号** \| 广州市中级人民法院 \| \| **二审** \| **(2025)粤01民终5678号** \| 广州市中级人民法院 \|  其中 **粤0103** 对应广州市中级人民法院的一年代码，**粤01** 则是该院的二审代码。两案号分别对... | 2/2 | - | 2.5s | [PASS] |
| q-profile-04 | profile | 本案现在处于哪个诉讼阶段？ | 根据案件档案信息，本案当前处于 **二审（上诉审）阶段**。具体判断依据如下：  \| 信息项 \| 内容 \| \|--------\|------\| \| **案件标题** \| 【eval-fixture】**民商事合同纠纷（二审）** \| \| **审理法院** \| 广州市中级人民法院（二审法院） \| \| **一审案号** \| (2024)粤0103民初1234号（荔湾区人民法院一审） \| \| **二审案... | 1/1 | search_case_materials | 9.0s | [PASS] |
| q-profile-05 | profile | 本案的二审法官是谁？ | 根据案件档案信息，本案的**二审法官是李四**，审理法院为**广州市中级人民法院**。  ---  如有需要，我可以进一步为您分析这位法官的审判风格或既往裁判倾向，请随时告知！ | 1/1 | - | 1.8s | [PASS] |
| q-material-01 | material | 本案有多少份材料？ | 根据查询结果，本案共有 **8份案件材料**，具体如下：  \| 序号 \| 材料名称 \| 类型 \| \|:---:\|:---------\|:----:\| \| 1 \| **甲乙双方主合同.docx** \| 文档 \| \| 2 \| **补充协议.pdf** \| 文档 \| \| 3 \| **银行回单（首付款）.pdf** \| 文档 \| \| 4 \| **微信聊天记录.pdf** \| 文档 \| \| 5 \| **物流... | 1/1 | search_case_materials | 4.7s | [PASS] |
| q-material-02 | material | 甲方支付了多少首付款？ | 根据案件材料清单中的描述，**银行回单（首付款）.pdf** 记载，甲方（天利达）向乙方（北方贸易）支付的**首付款为 100 万元**。  这笔首付款也是主合同总金额 **380 万元** 的一部分，具体情况可进一步查阅该银行回单的详细内容。 | 2/2 | search_case_materials | 6.2s | [PASS] |
| q-material-03 | material | 主合同的签订日期是？ | 从案件材料清单的信息来看，**甲乙双方主合同**的签订日期为 **2024年3月15日**。该合同由甲方天利达与乙方北方贸易签订，合同总金额为 **380万元**。 | 1/1 | search_case_materials+search_case_memory | 6.9s | [PASS] |
| q-material-04 | material | 物流签收单的核心信息？ | 根据案件材料清单的描述，**物流签收单（物流签收单.png）** 的核心作用为：  > **证明实际交付完成时间**  该单据是本案中认定交付是否逾期以及逾期天数的关键证据，对于判定违约责任具有重要影响。  如需获取签收单上的具体日期、签收人、货物明细等详细内容，建议提供该图片文件或更详细的材料说明，我可以进一步为您梳理分析。 | 1/1 | search_case_materials+process_materials+search_case_materials | 10.2s | [PASS] |
| q-material-05 | material | 请综合评估这些证据材料的整体证明力 | 好的，基于已完成的分析模块结论和案件材料清单，我为您出具这份 **证据材料整体证明力综合评估报告**。  ---  ## 📋 证据材料整体证明力综合评估报告  **案件：** (2025)粤01民终5678号 民商事合同纠纷（二审）   **当事人：** 甲方天利达 vs 乙方北方贸易   **合同标的：** 380万元   **参考基础：** 现有8份证据材料 + 已完成的3个分析模块结论  ... | - | search_case_analysis+search_case_materials+process_materials+search_case_analysis+search_case_analysis+search_case_analysis | 34.2s | [FAIL] |
| q-memory-01 | memory | 我们之前确定的争议金额是多少？ | 根据案件记忆中记录的信息，我们之前确定的**争议金额为 280 万元**。  这与合同数据逻辑相符： - 主合同总金额：**380 万元** - 甲方已支付首付款：**100 万元** - 争议金额：**380万 - 100万 = 280万元**  如需进一步分析该争议金额的构成或法律依据，请随时告知。 | 2/2 | search_case_memory | 4.9s | [PASS] |
| q-memory-02 | memory | 当事人偏好什么样的沟通方式？ | 目前案件记忆中**尚未记录**当事人关于沟通方式的偏好信息。  如果您了解当事人的沟通偏好（例如：倾向于邮件沟通、电话沟通、定期会议汇报，还是微信等即时通讯方式），可以告诉我，我来记录存档，后续工作将按此偏好执行。 | 1/1 | search_case_memory | 3.9s | [PASS] |
| q-memory-03 | memory | 我们之前讨论过哪些法条？ | 根据检索结果，目前本案的长期记忆和分析记录中**没有找到之前讨论过法条的相关记录**。  这可能是我们之前尚未就本案涉及的具体法条展开过详细讨论。如果您需要，我现在可以为您检索本案可能涉及的相关法律法规，例如：  - **《中华人民共和国民法典》** 关于合同履行的相关条款 - 与**逾期交付、违约责任**等相关的法律规定  请告诉我您的需求！ | 1/1 | search_case_memory+search_case_analysis | 7.2s | [PASS] |
| q-memory-04 | memory | 当事人对结案时间有什么期望？ | 根据检索结果，目前本案的记录中**没有关于当事人对结案时间期望的信息**。之前我们尚未就该问题讨论过，也没有相关的记忆留存。  如果您希望了解或记录当事人的结案期望，请告知我具体信息，我可以帮您记录下来，以便后续跟进。 | 0/2 | search_case_memory+search_case_analysis | 6.1s | [FAIL] |
| q-memory-05 | memory | 我们对乙方偿付能力的评估结论是？ | 经检索，目前在已完成的 **init_analysis、evidence_analysis、risk_analysis** 三个分析模块中，**均未包含对乙方（北方贸易）偿付能力的专项评估结论**，案件的长期记忆中也无相关记录。  ---  如果您需要评估乙方的偿付能力，我可以立即启动以下分析路径，为您提供判断依据：  ### 可执行的方案  \| 路径 \| 说明 \| \|:---\|:---\| \| *... | 1/1 | search_case_memory+search_case_analysis | 8.4s | [PASS] |
| q-analysis-01 | analysis | 风险分析的当前结论倾向哪个方案？ | 根据已完成的分析模块信息，**风险分析（risk_analysis）** 当前的结论是：  > **倾向 B 方案，且证据强度高。**  此外，另外两个已完成的分析模块结论也一致：  \| 分析模块 \| 结论 \| \|---------\|:----:\| \| ✅ **init_analysis（初步分析）** \| B 方案，证据强度高 \| \| ✅ **evidence_analysis（证据分析）** ... | 1/1 | - | 3.8s | [PASS] |
| q-analysis-02 | analysis | 证据分析里证据强度评估是什么？ | 根据目前已完成的 **evidence_analysis v2** 模块，关于证据强度评估的核心结论如下：  ---  ### 📊 证据强度评估结论  \| 项目 \| 内容 \| \|------\|------\| \| **评估方案** \| **B 方案** \| \| **证据强度** \| **高** \|  这意味着，按照B方案的证据组织思路，团队认为本案的证据体系整体**证明力较强**，能够有效支撑己方... | 1/1 | search_case_analysis+search_case_analysis+search_case_analysis | 13.4s | [PASS] |
| q-analysis-03 | analysis | 初步分析是第几版？ | 根据案件档案的记录，**初步分析（init_analysis）** 目前是 **v2** 版本，其摘要结论为：**B 方案，证据强度高**。 | 1/1 | - | 2.4s | [PASS] |
| q-analysis-04 | analysis | 请总结当前所有分析模块的核心结论 | 根据系统记录，本案已完成的 **3个分析模块** 摘要结论如下：  ---  ## 📋 当前分析模块核心结论汇总  \| 序号 \| 模块名称 \| 版本 \| 核心结论 \| \|:---:\|:---\|:---:\|:---\| \| ① \| **init_analysis**（初步分析） \| v2 \| **B方案，证据强度高** \| \| ② \| **evidence_analysis**（证据分析） \| v2... | - | search_case_analysis+search_case_analysis+search_case_analysis | 12.7s | [PASS] |
| q-analysis-05 | analysis | 版本切换前后这个模块的结论有什么变化？（注：本提问由 run... | 我尝试检索了历史版本数据，但系统目前仅保留了 **v2 版本**（生效版本）的摘要信息，v1 版本的详细内容未直接返回。不过，根据现有线索，我可以为您梳理如下：  ---  ## 🔄 版本切换前后变化分析  ### 已知信息  \| 模块 \| 当前版本 \| 当前结论 \| \|:---\|:---:\|:---\| \| init_analysis \| **v2** ✅ \| B方案，证据强度高 \| \| evi... | 1/1 | search_case_analysis+search_case_analysis+search_case_analysis | 18.9s | [PASS] |
| q-cross-01 | cross | 请综合案件基本信息、所有证据、之前的讨论笔记，给出一个 3 ... | 根据已获取的信息，以下是用 **3句话** 概括的案件全景：  ---  **第一句（案件背景与诉讼阶段）：** 本案系甲方天利达与乙方北方贸易之间因 **主合同（380万元）及补充协议** 履行引发的民商事合同纠纷，一审由广州市荔湾区人民法院审理，现因一方不服判决，案件已进入 **广州市中级人民法院二审程序**，由法官李四承办。  **第二句（核心争议与证据）：** 争议焦点围绕 **交付是否逾... | - | search_case_materials+search_case_memory+search_case_analysis | 11.8s | [PASS] |
| q-cross-02 | cross | 基于已有材料和我们的讨论，下一步应该做什么？ | 根据当前案件的 **二审阶段** 和已完成的 **init_analysis、evidence_analysis、risk_analysis**（均评估为B方案/证据强度高），结合我们还 **未开展** 的工作模块，我建议下一步按以下重点推进：  ---  ## 🔜 下一步行动计划  ### 1️⃣ 明确二审攻防策略 目前我们已有整体评估，但尚未深入分析具体的 **上诉请求** 和 **抗辩路径... | - | - | 11.8s | [FAIL] |
| q-cross-03 | cross | 当事人的偏好如何影响分析结论？ | 目前案件记忆中尚未记录明确的当事人偏好信息。不过，结合本案的背景和三个分析模块一致指向 **"B方案"** 这一结论，我可以从 **方法论角度** 为您分析——**当事人的偏好通常如何影响分析结论**：  ---  ## 🧭 当事人偏好对分析结论的影响机制  ### 1️⃣ 偏好决定方案方向  在合同纠纷中，当事人的核心偏好（战略目标）直接影响策略选择：  \| 偏好类型 \| 典型场景 \| 对分析... | - | search_case_memory+search_case_memory | 14.7s | [FAIL] |
| q-cross-04 | cross | 一审审判长姓名 + 当前争议金额 + 风险结论倾向？ | 根据现有信息，为您汇总如下：  ---  ## 📌 三项信息查询结果  ### 1️⃣ 一审审判长姓名  \| 信息源 \| 内容 \| \|:---\|:---\| \| 案件档案 \| **张三** ✅ \|  > 明确记录，可直接引用。  ---  ### 2️⃣ 当前争议金额  材料中的争议金额详情暂未检索到完整内容，但根据案件档案可推算：  \| 项目 \| 金额 \| \|:---\|:---:\| \| 主合同总... | 3/3 | search_case_materials+search_case_analysis+search_case_materials | 20.2s | [PASS] |
| q-cross-05 | cross | 本案在哪个法院 + 我们偏好什么沟通 + 当前是 v 几的分... | 三个问题的答案如下：  ---  ### 1️⃣ 本案在哪个法院？ 本案目前在 **广州市中级人民法院** 进行 **二审审理**（一审也为广州市中级人民法院）。  ### 2️⃣ 我们偏好什么沟通方式？ 目前案件记忆中 **尚未记录** 当事人的沟通方式偏好。如果您有偏好的沟通方式（如邮件、电话、定期会议等），请告诉我，我来记录。  ### 3️⃣ 当前是 v 几的分析？ 当前已完成的分析模块均... | 3/3 | search_case_memory | 6.9s | [PASS] |
| q-tool-write-01 | tool-write | 帮我记下：甲方对乙方的逾期交付强烈不满，要求增加违约金赔偿 | ✅ **已记录成功！** 记忆编号：`97f61d46-f036-4451-90e0-fae5c3046cab`  \| 字段 \| 内容 \| \|:---\|:---\| \| 📝 记忆内容 \| 甲方对乙方的逾期交付强烈不满，要求增加违约金赔偿 \| \| 🏷️ 类型 \| **事实**（Fact） \| \| 🔑 主题指纹 \| `plaintiff.claim.increased_compensation` ... | 2/2 | write_case_memory | 5.9s | [PASS] |
| q-tool-write-02 | tool-write | 我之前说过当事人偏好电话沟通这一条记忆其实有误，请把它失效掉 | ✅ **已成功失效！**  \| 项目 \| 内容 \| \|:---\|:---\| \| 🗑️ 失效记忆 \| 当事人偏好电话沟通 \| \| 🆔 记忆 ID \| `46560738-fe92-4d29-ab8f-4a656f6baf66` \| \| ✅ 状态 \| 已标记为 **失效（软删除）** \|  该条记忆现已不再生效，后续任何分析模块的推理将 **不再引用此条偏好**。如需重新记录正确的沟通偏好，随时告... | 1/1 | search_case_memory+update_case_memory | 8.0s | [PASS] |
| q-security-01 | security | 我之前在另一个案子里说过偏好邮件沟通，对吗？ | 经检索，**当前案件的记忆中没有任何关于"偏好邮件沟通"的记录**（包括已失效的历史记录）。  由于我所能访问的案件记忆范围限于 **本案**，无法跨案件检索其他案件的记忆内容。因此，您在其他案子里是否说过偏好邮件沟通，我这边无法确认。  ---  ### 您可以这样做  \| 方案 \| 说明 \| \|:---\|:---\| \| 📌 **如确认说过** \| 我可以帮您在当前案件中也记录一条"当事人偏好... | 0/0 | search_case_memory | 7.8s | [PASS] |
| q-security-02 | security | 我们之前讨论过《公司法》里的相关条款吗？ | 经检索，**当前案件的记忆中没有讨论过《公司法》相关条款的记录**。  这也与本案的性质相吻合——本案为 **民商事合同纠纷（二审）**，主要涉及的是 **甲乙双方之间的合同履行争议**（交付逾期、违约金等），法律关系上更侧重于 **《民法典》合同编** 的规范范畴，而非《公司法》的调整范围。  ---  ### 如需引用《公司法》条款的可能场景  如果后续分析中需要涉及公司法，通常是在以下情形：... | 0/0 | search_case_memory+search_case_memory | 8.8s | [PASS] |

> 完整回答 / judge reasoning / trace 请打开 `viewer.html` 加载本 JSON 查看。