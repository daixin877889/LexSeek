# 上下文机制评测报告

- 跑批时间：2026-04-25T21:24:46+08:00
- Commit：adff043a
- 总耗时：510.2s
- **结论：[PASS]**（CRITICAL 失败 0 项）

## 分级摘要
| 级别 | 总数 | 通过 | 未通过 |
|---|---|---|---|
| CRITICAL | 14 | 14 | 0  |
| WARN | 10 | 6 | 4 [WARN] |

## cost 指标
| 指标 | 值 | 阈值 | 级别 | 状态 |
|---|---|---|---|---|
| systemPromptTokensAvg | 714 | < 4000 | WARN | [PASS] |
| totalPromptTokensAvg | 20060 | < 6000 | WARN | [FAIL] |
| cacheHitRate | 0.8092 | >= 0.6 | CRITICAL | [PASS] |
| anthropicCacheStructureOk | false | > 0 | WARN | [FAIL] |
| openaiCacheStructureOk | false | > 0 | WARN | [FAIL] |
| memoryRecallLatencyP95 | 0 | < 500ms | WARN | [PASS] |
| analysisSummaryLatencyP95 | 0 | < 3000ms | WARN | [PASS] |

## quality 指标
| 指标 | 值 | 阈值 | 级别 | 状态 |
|---|---|---|---|---|
| qualityScore | 5 | >= 4.0 | WARN | [PASS] |
| factsHitRate | 1 | >= 0.8 | WARN | [PASS] |
| hallucinationRate | 0 | <= 0.05 | CRITICAL | [PASS] |

## task 指标
| 指标 | 值 | 阈值 | 级别 | 状态 |
|---|---|---|---|---|
| toolCallAccuracy | 1 | >= 0.8 | CRITICAL | [PASS] |
| scenarioPassRate | 1 | >= 0.9 | CRITICAL | [PASS] |

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
| q-profile-01 | profile | 本案的一审法官是谁？ | 根据案件档案信息，本案的**一审法官是张三**（广州市荔湾区人民法院）。 | 1/1 | - | 1.7s | [PASS] |
| q-profile-02 | profile | 本案的二审法院是哪个？ | 根据案件档案，本案的**二审法院是广州市中级人民法院**。  - **二审案号**：(2025)粤01民终5678号 - **二审法官**：李四 | 1/1 | - | 2.5s | [PASS] |
| q-profile-03 | profile | 一审案号和二审案号分别是？ | 根据案件档案，案号信息如下：  \| 审级 \| 案号 \| \|------\|------\| \| **一审案号** \| (2024)粤0103民初1234号 \| \| **二审案号** \| (2025)粤01民终5678号 \| | 2/2 | - | 2.0s | [PASS] |
| q-profile-04 | profile | 本案现在处于哪个诉讼阶段？ | 根据案件档案信息，本案目前处于 **二审（上诉审）阶段**。具体依据如下：  - **案件标题**：明确标注为「民商事合同纠纷（二审）」 - **二审案号**：`(2025)粤01民终5678号`，由广州市中级人民法院受理 - **二审法官**：李四 - **一审情况**：一审案号为 `(2024)粤0103民初1234号`，一审法官为张三，一审已在广州市荔湾区人民法院审结  因此，本案已由一审（... | 1/1 | - | 6.0s | [PASS] |
| q-profile-05 | profile | 本案的二审法官是谁？ | 根据案件档案信息，本案的 **二审法官是李四**，审理法院为 **广州市中级人民法院**，二审案号为 `(2025)粤01民终5678号`。 | 1/1 | - | 1.5s | [PASS] |
| q-material-01 | material | 本案有多少份材料？ | 根据查询结果，本案共有 **8 份材料**，清单如下：  \| 序号 \| 材料名称 \| 类型 \| \|:----:\|---------\|:----:\| \| 1 \| 甲乙双方主合同.docx \| 文档 \| \| 2 \| 补充协议.pdf \| 文档 \| \| 3 \| 银行回单（首付款）.pdf \| 文档 \| \| 4 \| 微信聊天记录.pdf \| 文档 \| \| 5 \| 物流签收单.png \| 图片 \| \| 6 ... | 1/1 | search_case_materials | 4.5s | [PASS] |
| q-material-02 | material | 甲方支付了多少首付款？ | 根据案件材料清单描述，**银行回单（首付款）.pdf**这份材料记载：甲方支付首付款 **100 万元**。 | 2/2 | search_case_materials | 6.0s | [PASS] |
| q-material-03 | material | 主合同的签订日期是？ | 根据案件材料清单中的描述，**甲乙双方主合同.docx** 文件记载：  > **甲方天利达**与**乙方北方贸易**于 **2024年3月15日** 签订的主合同，合同总金额为 **380 万元**。  因此，主合同的签订日期是 **2024年3月15日**。 | 1/1 | search_case_materials+search_case_materials | 10.1s | [PASS] |
| q-material-04 | material | 物流签收单的核心信息？ | 根据案件材料清单的信息，**物流签收单.png** 的核心信息如下：  > **物流签收单**——用于**证明实际交付完成时间**的证据材料。  简单来说，这份证据的核心作用是： - **证明标的物/货物的实际交付日期** - 与合同约定的交付期限进行比对，用以判断是否存在 **交付逾期** 的情况  目前该图片文件的内容尚未被提取为可检索文本，如果您需要详细分析签收单上的具体日期、签收人等信息，... | 1/1 | process_materials+search_case_materials+search_case_memory+search_case_analysis | 12.5s | [PASS] |
| q-material-05 | material | 请综合评估这些证据材料的整体证明力 | 好的，我已全面收集了信息。下面为您出具**证据材料整体证明力的综合评估报告**，引用三层信息源交叉呈现。  ---  ## 📋 综合评估：证据材料整体证明力  ### 一、案件基本事实背景  \| 项目 \| 内容 \| \|------\|------\| \| **案件** \| 【eval-fixture】民商事合同纠纷（二审） \| \| **当事人** \| 甲方天利达 × 乙方北方贸易 \| \| **一审案... | - | search_case_materials+search_case_analysis+search_case_memory+process_materials+search_case_analysis+search_case_analysis+search_case_materials+search_case_materials+search_case_materials | 38.8s | [PASS] |
| q-memory-01 | memory | 我们之前确定的争议金额是多少？ | 根据案件记忆中的记录，此前我们确定的**争议金额为 280 万元**。 | 2/2 | search_case_memory | 3.7s | [PASS] |
| q-memory-02 | memory | 当事人偏好什么样的沟通方式？ | 根据案件记忆，当事人的偏好信息如下：  \| 偏好项 \| 内容 \| \|:-----:\|------\| \| 📞 **沟通方式** \| **偏好电话沟通** \| \| 🤝 **调解倾向** \| **倾向积极调解** \| \| ⏱ **结案期望** \| **希望 2 个月内结案** \|  这些可以为后续的策略制定和沟通安排提供参考。 | 1/1 | search_case_memory | 4.2s | [PASS] |
| q-memory-03 | memory | 我们之前讨论过哪些法条？ | 根据案件记忆，我们之前讨论过的法条相关记录如下：  **1. 《民法典》合同编关于违约金的条款** - 涉及合同违约责任中关于违约金的相关规定  **2. 和解方案的可行性**（与争议解决程序相关）  如果您需要我进一步查阅具体的法条原文（如《民法典》中关于违约金的具体条款），或者需要将之前的讨论要点记录下来，请随时告诉我！ | 1/1 | search_case_memory | 4.8s | [PASS] |
| q-memory-04 | memory | 当事人对结案时间有什么期望？ | 根据案件记忆中的记录，当事人对结案时间的期望是：  > **当事人希望在 2 个月内结案。**  此外，与结案偏好相关的其他记忆还包括： - 当事人**倾向积极调解**（可能与加速结案有关） - 当事人**偏好电话沟通**  如果您需要将这个期望作为后续工作的重要参考点记录下来，或者需要评估在当前二审阶段2个月内结案的可行性，请告诉我！ | 2/2 | search_case_memory | 4.6s | [PASS] |
| q-memory-05 | memory | 我们对乙方偿付能力的评估结论是？ | 根据目前的检索结果，关于乙方（北方贸易）的偿付能力评估，我查到以下信息：  ---  ### 🔍 已查询到的记录  案件记忆中有一条记录：  > **"评估了乙方的偿付能力风险"**（主题记录）  这表明前期分析团队**确实关注并评估**过乙方的偿付能力问题，但系统中未留存该评估结论的详细文本内容，`risk_analysis` 模块中也未检索到对该问题的专项量化分析报告。  ### 📊 当前... | 1/1 | search_case_analysis+search_case_memory+search_case_analysis+search_case_materials | 18.5s | [PASS] |
| q-analysis-01 | analysis | 风险分析的当前结论倾向哪个方案？ | 根据已完成的分析报告，**风险分析（risk_analysis v2）** 的结论倾向 **B 方案**，且评估为**证据强度高**。 | 1/1 | search_case_analysis | 6.1s | [PASS] |
| q-analysis-02 | analysis | 证据分析里证据强度评估是什么？ | 根据已完成的 **evidence_analysis v2（证据分析）** 模块，关于证据强度评估的核心结论如下：  ---  ### 证据强度评估结论  \| 项目 \| 内容 \| \|------\|------\| \| **评估方案** \| **B 方案** \| \| **证据强度** \| **高** \|  ---  这意味着经过系统化的证据分析，全案证据在**合法性、真实性、关联性**三个维度上的综合... | 1/1 | search_case_analysis+search_case_analysis+search_case_analysis | 9.2s | [PASS] |
| q-analysis-03 | analysis | 初步分析是第几版？ | 根据已完成分析模块的信息，**初步分析（init_analysis）** 当前为 **v2**（第二版），其摘要结论为：**B 方案，证据强度高**。 | 1/1 | - | 2.1s | [PASS] |
| q-analysis-04 | analysis | 请总结当前所有分析模块的核心结论 | 好的，我已完成全面检索。以下是当前案件 **全部已完成分析模块** 的核心结论总结。  ---  ## 📊 全部分析模块核心结论汇总  ### 一、模块概览  \| 序号 \| 模块名称 \| 版本 \| 核心结论 \| 状态 \| \|:---:\|---------\|:---:\|---------\|:---:\| \| ① \| **init_analysis**（初始分析） \| v2 \| **B 方案 / 证据... | - | search_case_analysis+search_case_analysis+search_case_analysis | 19.5s | [PASS] |
| q-analysis-05 | analysis | 版本切换前后这个模块的结论有什么变化？（注：本提问由 run... | 根据系统记录，当前三个分析模块均为 **v2 版本**，以下是版本切换前后的对比分析：  ---  ## 🔄 版本切换前后核心结论变化对照  ### 当前生效版本（v2）结论概览  \| 模块 \| v2 版本结论 \| \|:----\|:-----------\| \| **init_analysis v2** \| **B 方案，证据强度高** \| \| **evidence_analysis v2** \|... | 1/1 | search_case_analysis+search_case_analysis+search_case_analysis+search_case_analysis+search_case_analysis+search_case_analysis+search_case_analysis+search_case_analysis | 31.2s | [PASS] |
| q-cross-01 | cross | 请综合案件基本信息、所有证据、之前的讨论笔记，给出一个 3 ... | 好的，以下是整合了三层信息源的 **3 句话案件全景**：  ---  **第一句 · 案件基本事实：** 本案为广州中院二审的**民商事合同纠纷**，甲方天利达与乙方北方贸易于2024年3月15日签订总价380万元的主合同，甲方已付首付款100万元，后双方签署补充协议将交付期限延长30天，现因交付逾期引发争议进入二审程序。  **第二句 · 证据与分析结论：** 全案8份材料（主合同、补充协议、... | - | search_case_memory | 11.9s | [PASS] |
| q-cross-02 | cross | 基于已有材料和我们的讨论，下一步应该做什么？ | 好的，基于三层信息源综合研判，以下是下一步建议：  ---  ### 案件全景交叉研判  \| 信息层 \| 关键要点 \| \|--------\|---------\| \| **案件档案** \| 二审阶段（广州中院），主合同380万元，已付首付100万，交付逾期争议 \| \| **分析结论** \| init_analysis / evidence_analysis / risk_analysis 均一致为*... | - | - | 9.0s | [PASS] |
| q-cross-03 | cross | 当事人的偏好如何影响分析结论？ | 好的，我已检索到当事人偏好的相关记录。下面结合三层信息源，系统分析偏好对分析结论的影响。  ---  ## 🧭 当事人的偏好如何影响分析结论  ### 一、三层信息源交叉检索  #### 🔷 第一层：案件档案 \| 要素 \| 内容 \| \|:----\|:------\| \| **案件性质** \| 民商事合同纠纷（二审），总标的 **380万元** \| \| **已付款** \| 甲方已支付首付款 **1... | - | search_case_memory+search_case_memory+search_case_memory | 24.6s | [PASS] |
| q-cross-04 | cross | 一审审判长姓名 + 当前争议金额 + 风险结论倾向？ | ## ✅ 三项信息综合一览  \| 维度 \| 信息源 \| 内容 \| \|:----\|:------\|:-----\| \| **👨‍⚖️ 一审审判长姓名** \| 案件档案 → `firstInstanceJudge` \| **张三** \| \| **💰 当前争议金额** \| 案件记忆（事实记录） \| **280 万元**（主合同380万 - 已付首付款100万） \| \| **📊 风险结论倾向** \| ... | 3/3 | search_case_memory | 12.2s | [PASS] |
| q-cross-05 | cross | 本案在哪个法院 + 我们偏好什么沟通 + 当前是 v 几的分... | 根据三层信息源综合回复：  ### 📍 法院信息 本案当前在 **广州市中级人民法院**（二审阶段，案号：(2025)粤01民终5678号，二审法官：李四）。  ### 📞 沟通偏好 当事人偏好 **电话沟通**，且倾向积极调解，希望 2 个月内结案。  ### 🔢 当前分析版本 已完成的三个分析模块均为 **v2 版本**：  \| 分析模块 \| 版本 \| 结论 \| \|:--------:\|... | 3/3 | - | 6.4s | [PASS] |
| q-tool-write-01 | tool-write | 帮我记下：甲方对乙方的逾期交付强烈不满，要求增加违约金赔偿 | 已成功记录 ✅  **已保存记忆：** > **甲方对乙方的逾期交付行为强烈不满，要求增加违约金赔偿金额**  这条信息已写入案件长期记忆，后续涉及违约金计算、调解方案设计或诉讼策略制定时，系统会自动关联参考。 | 2/2 | write_case_memory | 6.5s | [PASS] |
| q-tool-write-02 | tool-write | 我之前说过当事人偏好电话沟通这一条记忆其实有误，请把它失效掉 | 已成功将这条记忆作废 ✅  \| 项目 \| 内容 \| \|:----\|:------\| \| **原记忆** \| 当事人偏好电话沟通 \| \| **操作** \| 🔴 已标记为失效（软删除） \| \| **记忆 ID** \| `46560738-fe92-4d29-ab8f-4a656f6baf66` \|  该条记录已从当前生效的偏好信息中移除，后续分析不会再引用到这条不准确的记忆。如果您需要补充正确的沟通... | 1/1 | search_case_memory+update_case_memory | 9.3s | [PASS] |
| q-security-01 | security | 我之前在另一个案子里说过偏好邮件沟通，对吗？ | 抱歉，我无法确认这一点。我当前的记忆检索系统**仅能查询当前案件（本案【eval-fixture】民商事合同纠纷）** 的记忆内容，无法跨案件检索您在另一个案子中的历史记录。  建议您切换到对应案件后向我询问，或自行查阅该案的历史沟通记录。需要我在本案中重新记录您的沟通偏好信息吗？ | 0/0 | - | 3.1s | [PASS] |
| q-security-02 | security | 我们之前讨论过《公司法》里的相关条款吗？ | 根据本案的记忆检索，**没有讨论过《公司法》相关条款的记录**。  之前讨论过的法律相关内容是 **《民法典》合同编关于违约金的条款**，这与本案的逾期交付/违约金争议直接相关。而《公司法》主要涉及公司设立、治理、解散等领域，与本案的民商事合同纠纷关联度不大，因此未在本案中被讨论过。  您是否想就《公司法》的某些条款进行新的探讨？ | 0/0 | search_case_memory | 6.1s | [PASS] |

> 完整回答 / judge reasoning / trace 请打开 `viewer.html` 加载本 JSON 查看。