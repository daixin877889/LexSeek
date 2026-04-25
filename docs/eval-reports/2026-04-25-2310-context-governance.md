# 上下文机制评测报告

- 跑批时间：2026-04-25T23:10:45+08:00
- Commit：c0fc715d
- 总耗时：528.9s
- **结论：[PASS]**（CRITICAL 失败 0 项）

## 分级摘要
| 级别 | 总数 | 通过 | 未通过 |
|---|---|---|---|
| CRITICAL | 14 | 14 | 0  |
| WARN | 10 | 10 | 0  |

## cost 指标
| 指标 | 值 | 阈值 | 级别 | 状态 |
|---|---|---|---|---|
| systemPromptTokensAvg | 808 | < 4000 | WARN | [PASS] |
| totalPromptTokensAvg | 9715 | < 10000 | WARN | [PASS] |
| cacheHitRate | 0.8607 | >= 0.6 | CRITICAL | [PASS] |
| anthropicCacheStructureOk | true | > 0 | WARN | [PASS] |
| openaiCacheStructureOk | false | n/a（本次未触发 openai 协议） | WARN | [PASS] |
| memoryRecallLatencyP95 | 0 | < 500ms | WARN | [PASS] |
| analysisSummaryLatencyP95 | 0 | < 3000ms | WARN | [PASS] |

## quality 指标
| 指标 | 值 | 阈值 | 级别 | 状态 |
|---|---|---|---|---|
| qualityScore | 4.76 | >= 4.0 | WARN | [PASS] |
| factsHitRate | 0.9677 | >= 0.8 | WARN | [PASS] |
| hallucinationRate | 0 | <= 0.05 | CRITICAL | [PASS] |

## task 指标
| 指标 | 值 | 阈值 | 级别 | 状态 |
|---|---|---|---|---|
| toolCallAccuracy | 1 | >= 0.8 | CRITICAL | [PASS] |
| scenarioPassRate | 0.9655 | >= 0.9 | CRITICAL | [PASS] |

## extraction 指标
| 指标 | 值 | 阈值 | 级别 | 状态 |
|---|---|---|---|---|
| extractionRecall | 0.8 | >= 0.7 | WARN | [PASS] |
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
| q-profile-01 | profile | 本案的一审法官是谁？ | 根据案件档案，本案的 **一审法官是张三**，审理法院为广州市荔湾区人民法院。 | 1/1 | - | 2.3s | [PASS] |
| q-profile-02 | profile | 本案的二审法院是哪个？ | 根据案件档案，本案的**二审法院是广州市中级人民法院**，二审案号为 **(2025)粤01民终5678号**，二审法官为 **李四**。 | 1/1 | - | 2.3s | [PASS] |
| q-profile-03 | profile | 一审案号和二审案号分别是？ | 根据案件档案：  \| 审级 \| 案号 \| \|------\|------\| \| **一审** \| **(2024)粤0103民初1234号**（广州市荔湾区人民法院） \| \| **二审** \| **(2025)粤01民终5678号**（广州市中级人民法院） \| | 2/2 | - | 2.7s | [PASS] |
| q-profile-04 | profile | 本案现在处于哪个诉讼阶段？ | 您好！让我先调取案件档案信息来确认目前的诉讼阶段。  根据案件档案，可以为您梳理如下：  ---  ### 📋 案件基本信息  \| 项目 \| 内容 \| \|------\|------\| \| **案件名称** \| 【eval-fixture】民商事合同纠纷（二审） \| \| **一审案号** \| (2024)粤0103民初1234号 \| \| **一审法院** \| 广州市中级人民法院 \| \| **一审法... | 1/1 | - | 7.0s | [PASS] |
| q-profile-05 | profile | 本案的二审法官是谁？ | 根据案件档案信息，本案的**二审法官是李四**。  二审案号为 **(2025)粤01民终5678号**，已指定李四法官承办。如有其他问题，欢迎继续提问！ | 1/1 | - | 1.9s | [PASS] |
| q-material-01 | material | 本案有多少份材料？ | 根据查询结果，本案目前共有 **8份材料**，具体清单如下：  \| 序号 \| 材料名称 \| 类型 \| \|:---:\|---------\|:----:\| \| 1 \| 甲乙双方主合同.docx \| 文档 \| \| 2 \| 补充协议.pdf \| 文档 \| \| 3 \| 银行回单（首付款）.pdf \| 文档 \| \| 4 \| 微信聊天记录.pdf \| 文档 \| \| 5 \| 物流签收单.png \| 图片 \| \| ... | 1/1 | search_case_materials | 5.5s | [PASS] |
| q-material-02 | material | 甲方支付了多少首付款？ | 根据案件材料清单中的 **《银行回单（首付款）.pdf》** 记载，甲方支付的首付款金额为 **100万元**。 | 2/2 | search_case_materials+search_case_materials | 9.9s | [PASS] |
| q-material-03 | material | 主合同的签订日期是？ | 根据案件记忆中的记录，**甲乙双方主合同的签订日期为：2024年3月15日（2024-03-15）**。  此外，从案件材料清单中也可以看到，**甲方天利达**与**乙方北方贸易**签订的主合同总金额为 **380万元**。如需了解合同其他细节，欢迎继续提问！ | 1/1 | search_case_materials+search_case_materials+search_case_materials+process_materials+search_case_memory | 14.0s | [PASS] |
| q-material-04 | material | 物流签收单的核心信息？ | 根据案件材料清单的描述，**物流签收单.png** 是一份图片格式的材料，其核心作用是 **证明实际交付完成时间**。  由于该材料是图片文件（.png），目前系统中尚未提取出其中的具体文字内容。不过，从材料清单中我们可以关联到以下背景：  - **主合同**于 **2024年3月15日**签订，金额 **380万元** - **补充协议**涉及 **交付期限延长30天** - 另有 **微信聊天... | 1/1 | search_case_memory+search_case_materials+process_materials+search_case_analysis+search_case_analysis | 20.5s | [PASS] |
| q-material-05 | material | 请综合评估这些证据材料的整体证明力 | 好的，信息已收集齐全。下面我为您出具一份 **三源综合评估报告**，从案件档案事实、已完成分析模块结论、案件记忆三个维度交叉分析证据材料的整体证明力。  ---  ## 📋 证据材料综合证明力评估报告  ### 一、案件基本背景  \| 项目 \| 内容 \| \|------\|------\| \| **案由** \| 民商事合同纠纷（二审） \| \| **审理法院** \| 广州市中级人民法院（二审） \| \|... | - | process_materials+search_case_materials+search_case_analysis+search_case_memory+search_case_analysis+search_case_analysis+search_law+search_case_analysis+search_law | 46.8s | [PASS] |
| q-memory-01 | memory | 我们之前确定的争议金额是多少？ | 根据案件记忆记录，我们之前确定的**争议金额为 280 万元**。  交叉验证来看，主合同总金额为 **380 万元**，甲方已支付首付款 **100 万元**，差额恰好为 **280 万元**，与记忆中的争议金额一致。 | 2/2 | search_case_memory | 6.6s | [PASS] |
| q-memory-02 | memory | 当事人偏好什么样的沟通方式？ | 根据案件记忆中的记录，当事人的沟通偏好是：**电话沟通**。 | 1/1 | search_case_memory | 4.0s | [PASS] |
| q-memory-03 | memory | 我们之前讨论过哪些法条？ | 根据案件记忆中的记录，我们之前讨论过以下内容：  ---  ### 📜 已讨论过的法条/法律议题  \| 序号 \| 讨论内容 \| 记忆类型 \| \|:---:\|:---------\|:--------:\| \| 1️⃣ \| **《民法典》合同编关于违约金的条款** \| 对话要点 \| \| 2️⃣ \| **和解方案的可行性**（涉及相关法律依据） \| 对话要点 \|  ---  ### 🔗 关联补充  结... | 1/1 | search_case_memory | 6.0s | [PASS] |
| q-memory-04 | memory | 当事人对结案时间有什么期望？ | 根据案件记忆中的记录，当事人对结案时间的期望如下：  ---  ### ⏱ 当事人的结案期望  \| 项目 \| 内容 \| \|:---:\|:------\| \| **期望结案时间** \| **2个月内** \| \| **沟通偏好** \| 电话沟通 \| \| **调解倾向** \| 积极调解 \|  ---  ### 📌 综合分析建议  考虑到本案目前处于 **二审阶段**，且当事人希望 **2个月内结案**，... | 2/2 | search_case_memory+search_case_memory | 8.1s | [PASS] |
| q-memory-05 | memory | 我们对乙方偿付能力的评估结论是？ | 根据目前系统内的信息，关于乙方（北方贸易）的偿付能力，我查到以下情况：  ---  ## 关于乙方偿付能力的评估结论  ### 已掌握的信息  \| 信息来源 \| 内容 \| \|---------\|------\| \| 📌 **案件记忆** \| 有一条记录显示"评估了乙方的偿付能力风险"（过往讨论已涉及此话题） \| \| 📌 **风险分析 v2** \| 整体结论为 **"B方案，证据强度高"** \| ... | 1/1 | search_case_analysis+search_case_memory+search_case_analysis+search_case_analysis+search_case_memory+search_case_materials | 19.9s | [PASS] |
| q-analysis-01 | analysis | 风险分析的当前结论倾向哪个方案？ | 根据已完成的风险分析模块，**risk_analysis v2** 的当前结论倾向 **B方案**，且证据强度评估为 **高**。 | 1/1 | - | 2.3s | [PASS] |
| q-analysis-02 | analysis | 证据分析里证据强度评估是什么？ | 根据系统中已完成的**证据分析模块**的结论，情况如下：  ---  ### 📊 证据强度评估结论  \| 项目 \| 内容 \| \|:---:\|:------\| \| **分析版本** \| evidence_analysis v2 \| \| **结论方案** \| **B 方案** \| \| **证据强度** \| **高** ✅ \|  ---  ### 📋 整体分析全景  结合案件档案和其他已完成分析模块... | 1/1 | search_case_analysis+search_case_analysis | 12.2s | [PASS] |
| q-analysis-03 | analysis | 初步分析是第几版？ | 根据系统记录，**初步分析（init_analysis）是第 2 版（v2）**，结论为 **B 方案，证据强度高**。  与证据分析（v2）和风险分析（v2）同为最新版本，结论一致。 | 1/1 | - | 2.5s | [PASS] |
| q-analysis-04 | analysis | 请总结当前所有分析模块的核心结论 | 好的，以下是当前所有已完成分析模块的核心结论汇总：  ---  ## 📊 所有分析模块核心结论总览  本案已完成 **3个分析模块**，均为 v2 版本，结论高度一致。  ### 一、各模块核心结论  \| 序号 \| 分析模块 \| 版本 \| 核心结论 \| 关键词 \| \|:---:\|---------\|:---:\|---------\|:------\| \| ① \| **初始分析**（init_anal... | - | search_case_analysis+search_case_analysis+search_case_analysis+search_case_analysis+search_case_analysis+search_case_analysis+search_case_analysis+search_case_analysis+search_case_analysis+search_case_memory | 30.1s | [PASS] |
| q-analysis-05 | analysis | 版本切换前后这个模块的结论有什么变化？（注：本提问由 run... | 感谢您的提示。我通过检索系统内的历史版本数据来对比分析。  根据系统信息，当前各分析模块均已更新至 **v2 版本**。关于版本切换前后的变化，我梳理如下：  ---  ## 📋 版本切换前后结论变化对比  ### 三个模块的版本演变总览  \| 分析模块 \| 切换前（v1） \| 切换后（v2·当前生效） \| 变化 \| \|---------\|:-----------:\|:-------------... | 1/1 | search_case_analysis+search_case_analysis+search_case_analysis+search_case_analysis+search_case_analysis+search_case_analysis+search_case_analysis+search_case_memory | 37.6s | [PASS] |
| q-cross-01 | cross | 请综合案件基本信息、所有证据、之前的讨论笔记，给出一个 3 ... | 根据案件档案、所有分析模块结论和讨论笔记，为您整合如下：  ---  ### 📋 案件全景（3句话）  **第一句（基本信息与事实）**：本案为甲（天利达）乙（北方贸易）双方 **380万元主合同**、**争议金额280万元**的民商事合同纠纷，已由广州市中级人民法院一审（张三法官）审结，现进入 **二审阶段**（李四法官），核心争议围绕 **交付逾期**（原约定交付期限经补充协议延长30天后，... | - | search_case_memory | 13.4s | [PASS] |
| q-cross-02 | cross | 基于已有材料和我们的讨论，下一步应该做什么？ | 基于已掌握的全部信息，为您梳理下一步行动建议：  ---  ### 🧭 下一步行动全景建议  **当前坐标定位：** - **阶段**：二审审理中（李四法官） - **核心事实**：主合同380万、补充协议延期30天、争议金额280万、实际交付逾期争议 - **证据强度**：高 ✅（B方案） - **当事人偏好**：2个月内结案、积极调解、电话沟通 - **已讨论**：违约金条款、和解方案可行性... | - | search_case_analysis | 11.7s | [PASS] |
| q-cross-03 | cross | 当事人的偏好如何影响分析结论？ | 好的，现在我结合 **三层信息源** 来综合分析当事人的偏好如何影响各分析结论。  ---  ## 🧭 三层信息交叉分析  ### 第一层：案件档案基础事实  \| 项目 \| 内容 \| \|------\|------\| \| **案由** \| 民商事合同纠纷（二审） \| \| **当事人** \| 甲方天利达 vs 乙方北方贸易 \| \| **合同金额** \| **380万元** \| \| **已付首付款**... | - | search_case_memory+search_case_memory | 23.1s | [PASS] |
| q-cross-04 | cross | 一审审判长姓名 + 当前争议金额 + 风险结论倾向？ | 根据三层信息源整合如下：  ---  ## 🔍 三源交叉查询结果  \| 问题 \| 信息源 \| 答案 \| \|:----\|:------\|:----\| \| **① 一审审判长姓名** \| 📄 **案件档案** \| **张三**（一审案号：(2024)粤0103民初1234号） \| \| **② 当前争议金额** \| 📝 **案件记忆** \| **280万元** \| \| **③ 风险结论倾向** \|... | 3/3 | - | 9.4s | [PASS] |
| q-cross-05 | cross | 本案在哪个法院 + 我们偏好什么沟通 + 当前是 v 几的分... | 好的，这是一个综合查询，我为您整合三层信息来回答：  ### 1️⃣ 本案在哪个法院？  根据**案件档案**，本案由 **广州市中级人民法院** 审理（二审阶段）。  ### 2️⃣ 我们偏好什么沟通方式？  根据**案件记忆**，当事人偏好 **电话沟通**。  ### 3️⃣ 当前是 v 几的分析？  根据**已完成的分析模块**，当前所有分析均为 **v2** 版本：  \| 分析模块 \| ... | 3/3 | - | 5.8s | [PASS] |
| q-tool-write-01 | tool-write | 帮我记下：甲方对乙方的逾期交付强烈不满，要求增加违约金赔偿 | 已记录 ✅  **记忆摘要**：甲方对乙方逾期交付强烈不满，要求增加违约金赔偿  这条信息已存入案件长期记忆，后续在做策略分析、调解方案设计或诉讼请求调整时，会自动关联参考。如需进一步测算违约金的合理增额或评估法院支持力度，随时告诉我。 | 2/2 | write_case_memory | 6.4s | [PASS] |
| q-tool-write-02 | tool-write | 我之前说过当事人偏好电话沟通这一条记忆其实有误，请把它失效掉 | 已完成 ✅  **"当事人偏好电话沟通"** 这条记忆已作废，后续分析将不再引用该偏好信息。  目前案件记忆中仍保留的有效偏好记录： - **当事人倾向积极调解** - **当事人希望2个月内结案**  还有其他需要调整或记录的内容吗？ | 0/1 | search_case_memory+update_case_memory | 10.3s | [FAIL] |
| q-security-01 | security | 我之前在另一个案子里说过偏好邮件沟通，对吗？ | 在当前案件的记忆中，**没有查到"偏好邮件沟通"的相关记录**。本案已有的沟通偏好类记录是：  - ~~当事人偏好电话沟通~~（**已作废**）  所以，这应该是**另一个案件**中的记录，我无法跨案件查询其他案件的记忆。如果您记得是在哪个案子里说的，我可以帮您切换到那个案件去核实。 | 0/0 | search_case_memory | 7.6s | [PASS] |
| q-security-02 | security | 我们之前讨论过《公司法》里的相关条款吗？ | 根据案件记忆检索，**没有讨论过《公司法》的相关条款**。  本案中先前讨论的重点是：  \| 已讨论内容 \| 法律依据 \| \|-----------\|---------\| \| ✅ 违约金条款 \| 《**民法典**》合同编 \| \| ✅ 和解方案可行性 \| — \|  本案属于**民商事合同纠纷**，核心法律依据为《民法典》合同编，与《公司法》关联度不高。如果您需要援引《公司法》的某一具体条款来分析本案... | 0/0 | search_case_memory | 5.7s | [PASS] |

> 完整回答 / judge reasoning / trace 请打开 `viewer.html` 加载本 JSON 查看。