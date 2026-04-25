# 上下文机制评测报告

- 跑批时间：2026-04-25T21:08:50+08:00
- Commit：3022919c
- 总耗时：524.1s
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
| systemPromptTokensAvg | 719 | < 4000 | WARN | [PASS] |
| totalPromptTokensAvg | 22097 | < 6000 | WARN | [FAIL] |
| cacheHitRate | 0.8596 | >= 0.6 | CRITICAL | [PASS] |
| anthropicCacheStructureOk | false | > 0 | WARN | [FAIL] |
| openaiCacheStructureOk | false | > 0 | WARN | [FAIL] |
| memoryRecallLatencyP95 | 0 | < 500ms | WARN | [PASS] |
| analysisSummaryLatencyP95 | 0 | < 3000ms | WARN | [PASS] |

## quality 指标
| 指标 | 值 | 阈值 | 级别 | 状态 |
|---|---|---|---|---|
| qualityScore | 4.32 | >= 4.0 | WARN | [PASS] |
| factsHitRate | 0.871 | >= 0.8 | WARN | [PASS] |
| hallucinationRate | 0 | <= 0.05 | CRITICAL | [PASS] |

## task 指标
| 指标 | 值 | 阈值 | 级别 | 状态 |
|---|---|---|---|---|
| toolCallAccuracy | 1 | >= 0.8 | CRITICAL | [PASS] |
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
| q-profile-01 | profile | 本案的一审法官是谁？ | 根据案件档案信息，本案的一审法官是 **张三**。 | 1/1 | - | 1.6s | [PASS] |
| q-profile-02 | profile | 本案的二审法院是哪个？ | 根据案件档案信息，本案的二审法院是 **广州市中级人民法院**，二审案号为 **(2025)粤01民终5678号**，由 **李四** 法官审理。 | 1/1 | - | 1.7s | [PASS] |
| q-profile-03 | profile | 一审案号和二审案号分别是？ | 根据案件档案信息：  \| 审级 \| 案号 \| \|------\|------\| \| **一审** \| **(2024)粤0103民初1234号** \| \| **二审** \| **(2025)粤01民终5678号** \|  一审由 **张三** 法官审理，二审由 **李四** 法官审理，二审法院为 **广州市中级人民法院**。 | 2/2 | - | 3.1s | [PASS] |
| q-profile-04 | profile | 本案现在处于哪个诉讼阶段？ | 根据案件档案信息，本案目前处于 **二审阶段**。  具体来看：  - **案件标题**：民商事合同纠纷（**二审**） - **二审案号**：(2025)粤01民终5678号 - **二审法院**：广州市中级人民法院 - **二审法官**：李四 - **一审法院**：广州市中级人民法院（一审案号：(2024)粤0103民初1234号） - **一审法官**：张三  本案已经过一审审理（一审案号：... | 1/1 | - | 5.2s | [PASS] |
| q-profile-05 | profile | 本案的二审法官是谁？ | 根据案件档案信息，本案的二审法官是 **李四**，由广州市中级人民法院负责审理二审程序。 | 1/1 | - | 1.4s | [PASS] |
| q-material-01 | material | 本案有多少份材料？ | 本案共有 **8 份案件材料**，具体清单如下：  \| 序号 \| 材料名称 \| 文件类型 \| \|:----:\|---------\|:--------:\| \| 1 \| **甲乙双方主合同.docx** \| 文档 \| \| 2 \| **补充协议.pdf** \| 文档 \| \| 3 \| **银行回单（首付款）.pdf** \| 文档 \| \| 4 \| **微信聊天记录.pdf** \| 文档 \| \| 5 \| **... | 1/1 | search_case_materials | 5.5s | [PASS] |
| q-material-02 | material | 甲方支付了多少首付款？ | 根据案件材料信息，甲方（天利达）向乙方（北方贸易）支付了 **100 万元** 首付款，该笔款项的凭证为 **银行回单（首付款）.pdf**。 | 2/2 | - | 2.2s | [PASS] |
| q-material-03 | material | 主合同的签订日期是？ | 根据案件材料清单中的记载，主合同（即**甲方天利达与乙方北方贸易签订的主合同**）的签订日期是 **2024年3月15日**，合同总金额为380万元。 | 1/1 | search_case_materials+process_materials | 7.2s | [PASS] |
| q-material-04 | material | 物流签收单的核心信息？ | 根据案件材料清单的描述，**物流签收单**（物流签收单.png，图片格式）的核心作用是——**证明实际交付完成时间**。  不过，目前该材料的详细内容尚未被加载解析，暂时无法从中提取出具体的签收日期、签收人、货物明细等更详细的信息。  如果您需要，我可以尝试通过以下方式进一步获取信息： 1. **查看其他材料**——比如搜索微信聊天记录、邮件往来或一审庭审笔录中是否提及实际交付日期，可能会有相关线... | 1/1 | search_case_materials+search_case_materials+search_case_materials | 13.9s | [PASS] |
| q-material-05 | material | 请综合评估这些证据材料的整体证明力 | 好的，我已全面掌握案件信息和材料清单。下面基于案件档案、8份材料清单以及已有的分析成果，为您出具综合证明力评估报告。  ---  ## 📋 综合证据证明力评估报告  **案件信息**：民商事合同纠纷（二审）\| 广州市中级人民法院 \| (2024)粤0103民初1234号 → (2025)粤01民终5678号  ---  ### 一、证据材料全景概览  本案共有 **8份证据材料**，可分为以下三... | - | search_case_analysis+search_case_materials+process_materials+search_case_analysis+search_case_materials | 45.7s | [PASS] |
| q-memory-01 | memory | 我们之前确定的争议金额是多少？ | 根据之前的记录，本案的**争议金额为 280 万元**。  结合案件材料来看，甲乙双方主合同总金额为 **380 万元**，甲方已支付首付款 **100 万元**，剩余 **280 万元** 即为争议金额。 | 2/2 | search_case_memory | 5.4s | [PASS] |
| q-memory-02 | memory | 当事人偏好什么样的沟通方式？ | 目前尚未记录当事人关于沟通方式偏好的信息。如果您与当事人有过相关沟通，或希望我记录下来，可以告诉我，我会将其写入案件记忆以便后续参考。 | 0/1 | search_case_memory | 3.7s | [FAIL] |
| q-memory-03 | memory | 我们之前讨论过哪些法条？ | 根据案件记忆检索，目前**还没有讨论过具体的法条内容**。回顾我们之前的交流，主要涉及的是案件基本事实信息的确认：  1. ✅ 诉讼阶段（二审） 2. ✅ 二审法官（李四） 3. ✅ 主合同签订日期（2024年3月15日） 4. ✅ 物流签收单的作用（证明实际交付完成时间）  如果您希望针对本案进行法条分析，我可以安排子 Agent 为您做以下工作，例如：  - 🔍 **请求权基础分析**——检... | 1/1 | search_case_memory+search_case_memory | 8.9s | [PASS] |
| q-memory-04 | memory | 当事人对结案时间有什么期望？ | 根据案件记忆检索，目前**没有关于当事人对结案时间期望的记录**，我们之前尚未讨论过这方面的内容。  如果您已经了解当事人的想法，可以告诉我，我来帮您记录下来，后续生成文书或安排工作时可以作为参考。例如：  > **示例**：当事人希望"在X月X日前结案"或"尽快结案，不设硬性期限"  您这边有相关信息吗？ | 1/2 | search_case_memory | 4.9s | [FAIL] |
| q-memory-05 | memory | 我们对乙方偿付能力的评估结论是？ | 感谢您的提问。我全面检索了本案已有的分析模块和案件记忆，情况如下：  ---  ## 关于乙方偿付能力评估的现状  ### 📋 已有分析结论  本案已完成的三项分析模块摘要：  \| 分析模块 \| 结论 \| \|---------\|:----:\| \| **init_analysis v2** \| B 方案，证据强度高 \| \| **evidence_analysis v2** \| B 方案，证据强度高... | 1/1 | search_case_analysis+search_case_memory+search_case_analysis+search_case_analysis+search_case_analysis+search_case_materials | 28.3s | [PASS] |
| q-analysis-01 | analysis | 风险分析的当前结论倾向哪个方案？ | 根据已完成的 **risk_analysis（风险评估）v2** 结论，当前倾向 **B 方案**，且评估认为**证据强度高**。 | 1/1 | - | 2.3s | [PASS] |
| q-analysis-02 | analysis | 证据分析里证据强度评估是什么？ | 根据案件档案的记录，**证据分析（evidence_analysis）模块**的评估结论摘要为：  > **B 方案，证据强度高。** ✅  不过，该模块的详细分析报告内容目前暂时未能检索到具体细节。如果您想了解该评估的完整内容，我可以安排子 Agent **重新进行证据分析**，为您详细梳理：  1. **各项证据的合法性、真实性、关联性** 2. **证据链完整性评估** 3. **证据强度评... | 1/1 | search_case_analysis+search_case_analysis | 8.8s | [PASS] |
| q-analysis-03 | analysis | 初步分析是第几版？ | 根据案件档案记录，**初步分析（init_analysis）** 是 **第2版（v2）**，其摘要为：  > **B 方案，证据强度高。** | 1/1 | - | 2.3s | [PASS] |
| q-analysis-04 | analysis | 请总结当前所有分析模块的核心结论 | 已全面检索，结合案件档案中的信息及我们此前的讨论，以下是当前所有分析模块的核心结论总结：  ---  ## 📊 全部分析模块核心结论总结  ### 案件基本信息  \| 项目 \| 内容 \| \|:----\|:------\| \| **案由** \| 民商事合同纠纷（二审） \| \| **案件编号** \| (2024)粤0103民初1234号 → (2025)粤01民终5678号 \| \| **审理法院** ... | - | search_case_analysis+search_case_analysis+search_case_analysis | 20.5s | [PASS] |
| q-analysis-05 | analysis | 版本切换前后这个模块的结论有什么变化？（注：本提问由 run... | 好的，我基于当前系统中能检索到的信息给您答复。  从案件档案中可以看到，当前三个分析模块均为 **v2 版本**，摘要结论如下：  ---  ## 当前版本（v2）各模块结论  \| 模块 \| 版本 \| 结论 \| \|:----\|:---:\|:----:\| \| **init_analysis** \| v2 \| **B 方案，证据强度高** \| \| **evidence_analysis** \| v2 ... | 1/1 | search_case_analysis+search_case_analysis+search_case_analysis+search_case_analysis+search_case_memory+search_case_analysis | 27.6s | [PASS] |
| q-cross-01 | cross | 请综合案件基本信息、所有证据、之前的讨论笔记，给出一个 3 ... | 根据现有信息，为您提炼案件全景如下：  ---  **📋 案件全景（三句话）**  > **第一句 · 案件基本格局**：本案系天利达公司（甲方）与北方贸易公司（乙方）之间的民商事合同纠纷，主合同于2024年3月15日签订、总金额380万元，经补充协议延长交付期30日，目前案件已进入二审阶段，由广州市中级人民法院李四法官审理。 > > **第二句 · 核心争议与证据**：争议焦点围绕交付逾期及争... | - | search_case_materials+search_case_memory | 12.3s | [FAIL] |
| q-cross-02 | cross | 基于已有材料和我们的讨论，下一步应该做什么？ | 好问题！我来梳理一下当前的工作进展和可推进的方向。  ---  ## 📊 当前完成度  \| 模块 \| 状态 \| \|------\|:----:\| \| ✅ 初步分析（init_analysis v2） \| 已完成 \| \| ✅ 证据分析（evidence_analysis v2） \| 已完成 \| \| ✅ 风险评估（risk_analysis v2） \| 已完成 \| \| ❌ **请求权预分析** \| 未... | - | - | 14.6s | [FAIL] |
| q-cross-03 | cross | 当事人的偏好如何影响分析结论？ | 根据全面检索，当前案件记忆中 **暂无任何当事人偏好的记录**。具体情况如下：  ---  ## 当前状态：当事人偏好记录为空  \| 检索范围 \| 结果 \| \|:--------\|:----:\| \| 偏好记忆（preference） \| ❌ 无记录 \| \| 事实记忆（fact） \| ❌ 未涉及当事人偏好 \| \| 对话要点（dialogue_note） \| ❌ 无相关记录 \|  ### 因此，目前无... | - | search_case_memory+search_case_memory+search_case_memory | 14.2s | [FAIL] |
| q-cross-04 | cross | 一审审判长姓名 + 当前争议金额 + 风险结论倾向？ | 基于案件档案及已有信息，为您汇总如下：  ---  ## 三项信息汇总  \| 序号 \| 问题 \| 答案 \| \|:---:\|:----\|:----:\| \| **①** \| **一审审判长姓名** \| **张三** \| \| **②** \| **当前争议金额** \| 合同总金额 **380万元**，甲方已付首付款 **100万元**，剩余款项双方存在争议（具体争议金额待核实） \| \| **③** \| *... | 2/3 | search_case_materials+search_case_analysis+search_case_materials | 17.7s | [PASS] |
| q-cross-05 | cross | 本案在哪个法院 + 我们偏好什么沟通 + 当前是 v 几的分... | 好的，逐一回答您的问题：  ### 1️⃣ 本案在哪个法院？ - **二审法院**：**广州市中级人民法院** - **一审法院**：**广州市荔湾区人民法院**（案号 "(2024)粤0103民初1234号" 中 "0103" 即该院代码）  目前案件在 **广州市中级人民法院** 审理。  ### 2️⃣ 我们偏好什么沟通？ 目前**尚未记录**任何关于沟通方式的偏好信息。如有需要，您可以告诉... | 2/3 | search_case_memory | 10.2s | [PASS] |
| q-tool-write-01 | tool-write | 帮我记下：甲方对乙方的逾期交付强烈不满，要求增加违约金赔偿 | 已记录成功 ✅  > **记忆内容**：甲方对乙方的逾期交付强烈不满，要求增加违约金赔偿 > **记忆类型**：案件事实（fact） > **主题标签**：plaintiff.demand.damages  这条信息已写入案件长期记忆，后续在进行风险分析、策略建议等环节时，系统会自动参考此偏好。如需修改或补充，随时告诉我。 | 2/2 | write_case_memory | 6.2s | [PASS] |
| q-tool-write-02 | tool-write | 我之前说过当事人偏好电话沟通这一条记忆其实有误，请把它失效掉 | 已处理完成 ✅  > **已失效的记忆**：当事人偏好电话沟通 > **记忆ID**：46560738-fe92-4d29-ab8f-4a656f6baf66 > **当前状态**：已标记为失效，后续分析中不再引用此条信息  如果您有正确的联系方式偏好需要记录，也随时可以告诉我。 | 1/1 | search_case_memory+update_case_memory | 8.8s | [PASS] |
| q-security-01 | security | 我之前在另一个案子里说过偏好邮件沟通，对吗？ | 在当前案件的记忆中，未找到您说过"偏好邮件沟通"的相关记录。  需要说明的是，我目前只能检索**当前案件**（本案：民商事合同纠纷二审）的记忆数据，**无法跨案件**查询其他案子的记忆内容。因此，无法确认您在另一个案件中是否提到过偏好邮件沟通。  如果您记得是在哪个案件中说过的，可以将该案件信息提供给我，届时再做进一步查证。或者，如果您现在需要记录这条偏好到当前案件，也请随时告诉我。 | 0/0 | search_case_memory | 7.0s | [PASS] |
| q-security-02 | security | 我们之前讨论过《公司法》里的相关条款吗？ | 根据检索，当前案件的记忆中 **没有找到关于《公司法》条款的讨论记录**。  结合本案案由为 **民商事合同纠纷（二审）**，争议焦点主要集中在合同履行、交付逾期和违约金方面，尚未涉及《公司法》相关条款的讨论。如果您需要就《公司法》相关规定进行分析，随时可以启动。 | 0/0 | search_case_memory | 5.3s | [PASS] |

> 完整回答 / judge reasoning / trace 请打开 `viewer.html` 加载本 JSON 查看。