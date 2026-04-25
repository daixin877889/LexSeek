# 上下文机制评测报告

- 跑批时间：2026-04-25T21:38:05+08:00
- Commit：2cf5f14b
- 总耗时：559.8s
- **结论：[PASS]**（CRITICAL 失败 0 项）

## 分级摘要
| 级别 | 总数 | 通过 | 未通过 |
|---|---|---|---|
| CRITICAL | 14 | 14 | 0  |
| WARN | 10 | 7 | 3 [WARN] |

## cost 指标
| 指标 | 值 | 阈值 | 级别 | 状态 |
|---|---|---|---|---|
| systemPromptTokensAvg | 729 | < 4000 | WARN | [PASS] |
| totalPromptTokensAvg | 25254 | < 6000 | WARN | [FAIL] |
| cacheHitRate | 0.8348 | >= 0.6 | CRITICAL | [PASS] |
| anthropicCacheStructureOk | true | > 0 | WARN | [PASS] |
| openaiCacheStructureOk | false | > 0 | WARN | [FAIL] |
| memoryRecallLatencyP95 | 0 | < 500ms | WARN | [PASS] |
| analysisSummaryLatencyP95 | 0 | < 3000ms | WARN | [PASS] |

## quality 指标
| 指标 | 值 | 阈值 | 级别 | 状态 |
|---|---|---|---|---|
| qualityScore | 4.97 | >= 4.0 | WARN | [PASS] |
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
| q-profile-01 | profile | 本案的一审法官是谁？ | 本案的**一审法官**是 **张三** 法官。  案件由广州市荔湾区人民法院（粤0103）一审审理，案号为 (2024)粤0103民初1234号，一审承办法官为张三。 | 1/1 | - | 2.1s | [PASS] |
| q-profile-02 | profile | 本案的二审法院是哪个？ | 本案的**二审法院**是 **广州市中级人民法院**。  案号：(2025)粤01民终5678号，二审承办法官为 **李四**。 | 1/1 | - | 2.6s | [PASS] |
| q-profile-03 | profile | 一审案号和二审案号分别是？ | 以下是本案的案号信息：  \| 审级 \| 案号 \| 审理法院 \| \|------\|------\|----------\| \| **一审** \| **(2024)粤0103民初1234号** \| 广州市荔湾区人民法院 \| \| **二审** \| **(2025)粤01民终5678号** \| 广州市中级人民法院 \| | 2/2 | - | 2.2s | [PASS] |
| q-profile-04 | profile | 本案现在处于哪个诉讼阶段？ | 根据案件档案信息，现为您确认本案的诉讼阶段如下：  ---  ## 📌 本案当前诉讼阶段：**二审阶段（审理中）**  ### 关键信息依据  \| 项目 \| 内容 \| \|------\|------\| \| **案件性质** \| 民商事合同纠纷 \| \| **一审法院** \| 广州市荔湾区人民法院（粤0103） \| \| **一审案号** \| (2024)粤0103民初1234号 \| \| **一审法官*... | 1/1 | search_case_memory+search_case_analysis+search_case_materials | 16.2s | [PASS] |
| q-profile-05 | profile | 本案的二审法官是谁？ | 根据案件档案记录，本案的**二审法官**为：  > **李四**（广州市中级人民法院）  另外补充一下，一审法官为 **张三**（广州市荔湾区人民法院）。  如需进一步了解该法官的裁判风格或既往判例趋势，我可以安排 **判决趋势预测（ask_trend_expert）** 子 Agent 进行分析。 | 1/1 | - | 2.6s | [PASS] |
| q-material-01 | material | 本案有多少份材料？ | 本案共 **8份材料**，具体清单如下：  \| 序号 \| 材料名称 \| 类型 \| \|:----:\|----------\|:----:\| \| 1 \| **甲乙双方主合同.docx** \| 文档 \| \| 2 \| **补充协议.pdf** \| 文档 \| \| 3 \| **银行回单（首付款）.pdf** \| 文档 \| \| 4 \| **微信聊天记录.pdf** \| 文档 \| \| 5 \| **物流签收单.png... | 1/1 | search_case_materials+search_case_materials | 5.3s | [PASS] |
| q-material-02 | material | 甲方支付了多少首付款？ | 根据案件材料清单的描述，**甲方支付的首付款为 100 万元**，对应材料为《银行回单（首付款）.pdf》。  您需要我进一步调取该回单的详细内容进行核实吗？ | 2/2 | search_case_materials+process_materials | 5.7s | [PASS] |
| q-material-03 | material | 主合同的签订日期是？ | 根据案件材料清单中的记录，**主合同**的签订信息如下：  > **签订日期：2024年3月15日** >  > 合同双方：甲方 **天利达** 与 乙方 **北方贸易** > 合同总金额：**380 万元**  此外，后续双方还签订了一份 **补充协议**，对交付期限延长了30天。如需了解补充协议的具体内容，可以进一步查阅。 | 1/1 | search_case_materials+search_case_materials+process_materials+search_case_materials | 16.1s | [PASS] |
| q-material-04 | material | 物流签收单的核心信息？ | 根据目前可查阅的案件材料信息，**物流签收单（物流签收单.png）** 的定位如下：  > **文件类型：** 图片 > **证明目的：** 证明**实际交付完成时间**  该材料是一份图片格式的凭证，用于佐证货物实际完成的交付时点。不过，目前该材料尚未完成详细内容的提取嵌入，暂时无法获取签收单上的具体日期、签收人、货物明细等核心字段。  如需获取该签收单的详细内容，我可以安排进一步处理该图片文件... | 1/1 | search_case_materials+search_case_materials+search_case_analysis+search_case_memory | 15.5s | [PASS] |
| q-material-05 | material | 请综合评估这些证据材料的整体证明力 | 好的，以下是我综合三层信息源（案件档案、已完成分析模块、案件记忆）对本案证据材料整体证明力的全景评估。  ---  ## 📋 综合评估报告：证据材料整体证明力  ### 一、案件基本信息  \| 项目 \| 内容 \| \|------\|------\| \| **案由** \| 民商事合同纠纷（二审） \| \| **一审** \| 广州市中级人民法院 · (2024)粤0103民初1234号 · 法官 **张三... | - | search_case_memory+search_case_analysis+search_case_materials+process_materials+search_case_analysis+search_case_analysis+search_case_analysis+search_case_analysis+search_law | 43.7s | [PASS] |
| q-memory-01 | memory | 我们之前确定的争议金额是多少？ | 根据案件记忆，我们之前确定的**争议金额为 280 万元**。  结合案件背景推算：主合同总金额 **380 万元**，甲方已支付首付款 **100 万元**，争议金额 280 万元正好对应剩余未付/争议部分。如果您需要我进一步核实该金额的具体构成（例如从邮件往来或庭审笔录中确认），可以随时告诉我。 | 2/2 | search_case_memory+search_case_materials+search_case_analysis | 8.2s | [PASS] |
| q-memory-02 | memory | 当事人偏好什么样的沟通方式？ | 根据案件记忆记录，当事人偏好 **电话沟通** 的方式。  如果后续需要与当事人沟通案件进展或策略，建议优先以电话联系。还有其他需要我协助的吗？ | 1/1 | search_case_memory | 3.8s | [PASS] |
| q-memory-03 | memory | 我们之前讨论过哪些法条？ | 根据案件记忆中的记录，我们之前讨论过的法条是：  > **《民法典》合同编——关于违约金的条款**  具体来说，这与本案的民商事合同纠纷（二审）密切相关，涉及主合同总金额380万元的履行争议。如果您需要进一步查阅该条款的具体条文内容，或者希望我安排子 Agent 做违约金方面的法律分析，随时告诉我。 | 1/1 | search_case_memory+search_case_memory | 7.0s | [PASS] |
| q-memory-04 | memory | 当事人对结案时间有什么期望？ | 根据案件记忆中的记录，当事人对结案时间的期望是：  > **希望 2 个月内结案**  此外，关于当事人的其他偏好还包括： - **倾向积极调解** - **偏好电话沟通** - **希望分析报告以表格形式输出**  结合本案目前处于 **二审阶段**，如果要在2个月内结案，时间上比较紧凑，可以考虑通过调解等方式加快进程。需要我进一步分析如何在期限内推进结案策略吗？ | 2/2 | search_case_memory | 4.8s | [PASS] |
| q-memory-05 | memory | 我们对乙方偿付能力的评估结论是？ | 根据目前系统内已记录的信息，关于乙方偿付能力的评估情况如下：  ---  ### 🔍 检索结果  \| 信息源 \| 找到的内容 \| \|:------:\|:----------\| \| **案件记忆** \| ✅ 有一条记录标记为 **"评估了乙方的偿付能力风险"**（主题标记） \| \| **风险分析模块**（risk_analysis v2） \| 摘要为 **"B 方案，证据强度高"**，未展开偿付能... | 1/1 | search_case_memory+search_case_analysis+search_case_memory+search_case_memory+search_case_materials+search_case_analysis | 22.3s | [PASS] |
| q-analysis-01 | analysis | 风险分析的当前结论倾向哪个方案？ | 根据系统已完成的分析模块记录，**风险分析（risk_analysis v2）** 的当前结论倾向 **B 方案**，且评估认为 **证据强度高**。  需要我进一步调取风险分析的详细报告内容，或者结合其他分析模块为您做综合研判吗？ | 1/1 | search_case_analysis | 5.3s | [PASS] |
| q-analysis-02 | analysis | 证据分析里证据强度评估是什么？ | 根据已完成的分析模块记录，**证据分析（evidence_analysis）** 模块中关于证据强度的评估结论如下：  ---  ### 📊 证据强度评估结论  \| 项目 \| 内容 \| \|------\|------\| \| **评估方案** \| **B 方案** \| \| **证据强度等级** \| **高** \|  ### 说明  该评估是基于本案的全部证据材料综合分析得出的，包括： - **甲乙双... | 1/1 | search_case_analysis+search_case_analysis | 10.2s | [PASS] |
| q-analysis-03 | analysis | 初步分析是第几版？ | 根据已完成分析模块的记录，**初步分析（init_analysis）** 的版本为：  > **v2（第2版）**  其摘要内容为：**B 方案，证据强度高**。 | 1/1 | - | 2.3s | [PASS] |
| q-analysis-04 | analysis | 请总结当前所有分析模块的核心结论 | 好的，以下是当前 **全部已完成分析模块** 的核心结论总结：  ---  ## 📊 已完成分析模块 · 核心结论总览  本案目前共完成了 **3 个分析模块**，均为 **v2 版本**，结论高度一致：  \| 序号 \| 分析模块 \| 版本 \| 核心结论 \| 一致性 \| \|:----:\|:--------:\|:----:\|:---------\|:------:\| \| 1 \| **初始分析**（i... | - | search_case_analysis+search_case_analysis+search_case_analysis+search_case_analysis | 19.6s | [PASS] |
| q-analysis-05 | analysis | 版本切换前后这个模块的结论有什么变化？（注：本提问由 run... | 根据系统内检索结果，当前 **只能获取到 v2 版本的结论摘要**，v1 版本的详细内容未能检索到。以下是我所掌握的全部信息：  ---  ## 版本切换前后 · 结论变化  ### 已知信息（v2 版本）  \| 分析模块 \| v2 核心结论 \| \|:--------:\|:-----------:\| \| **初始分析**（init_analysis） \| **B 方案 · 证据强度高** \| \| ... | 1/1 | search_case_analysis+search_case_analysis+search_case_analysis+search_case_analysis+search_case_analysis | 27.4s | [PASS] |
| q-cross-01 | cross | 请综合案件基本信息、所有证据、之前的讨论笔记，给出一个 3 ... | 根据三层信息源，为您整合如下 **3句话案件全景**：  ---  > **第一句（案件基本信息）：** 本案系**甲方天利达与乙方北方贸易**之间标的额**380万元**的民商事合同纠纷，主合同签订于**2024年3月15日**，经补充协议延长交付期30天，目前已进入**广州市中级人民法院二审阶段**（案号(2025)粤01民终5678号，法官李四），一审由广州市荔湾区人民法院（法官张三）审理。... | - | search_case_memory+search_case_memory | 13.6s | [PASS] |
| q-cross-02 | cross | 基于已有材料和我们的讨论，下一步应该做什么？ | 好的，这个问题同样需要综合三层信息源来回答。上一轮我已经获取了完整信息，现在直接为您梳理：  ---  基于三层信息源综合分析，**下一步的核心建议**如下：  ## 🎯 核心方向：优先推进调解，争取2个月内结案  ### 为什么？  \| 信息层 \| 关键依据 \| \|--------\|----------\| \| **① 案件档案** \| 本案已进入**二审阶段**（广州市中级人民法院，法官李四）... | - | - | 9.2s | [PASS] |
| q-cross-03 | cross | 当事人的偏好如何影响分析结论？ | 好的，现在我已完整获取三层信息源，以下是 **案件档案 × 分析结论 × 当事人偏好** 三者的交叉分析。  ---  ## 📊 三层信息源全景  ### 第一层：案件档案（客观事实）  \| 项目 \| 内容 \| \|:----\|:------\| \| 案由 \| 民商事合同纠纷（二审） \| \| 当事人 \| 甲方 **天利达** vs 乙方 **北方贸易** \| \| 合同金额 \| 380 万元 \| \| ... | - | search_case_memory+search_case_memory+search_case_memory | 24.2s | [PASS] |
| q-cross-04 | cross | 一审审判长姓名 + 当前争议金额 + 风险结论倾向？ | 三个信息整理如下：  \| 信息项 \| 来源层级 \| 结果 \| \|:------\|:--------:\|:----:\| \| 🧑‍⚖️ **一审审判长姓名** \| ① 案件档案 \| **张三** \| \| 💰 **当前争议金额** \| ③ 案件记忆（事实） \| **280 万元** \| \| 📊 **风险结论倾向** \| ② 已分析模块（risk_analysis v2） \| **B 方案 · 证据... | 3/3 | search_case_memory+search_case_analysis | 11.2s | [PASS] |
| q-cross-05 | cross | 本案在哪个法院 + 我们偏好什么沟通 + 当前是 v 几的分... | 根据案件档案、已完成分析模块和案件记忆，以下是您的三个问题的答案：  ---  ### 1️⃣ 本案在哪个法院？  \| 审级 \| 法院 \| \|:----:\|------\| \| **一审** \| 广州市荔湾区人民法院 \| \| **二审** \| **广州市中级人民法院**（当前审理中） \|  ---  ### 2️⃣ 我们偏好什么沟通？  根据案件记忆，当事人偏好 **电话沟通**。  ---  ##... | 3/3 | - | 7.1s | [PASS] |
| q-tool-write-01 | tool-write | 帮我记下：甲方对乙方的逾期交付强烈不满，要求增加违约金赔偿 | ✅ **已记录完成！**  \| 项目 \| 内容 \| \|:----\|:------\| \| 📝 记录内容 \| 甲方对乙方的逾期交付强烈不满，要求增加违约金赔偿 \| \| 🏷️ 类型 \| 对话要点 \| \| 🔑 主题指纹 \| `plaintiff.attitude.damages`（甲方态度·违约金） \|  这条信息已存入案件长期记忆，后续做 **策略分析、调解方案测算、二审诉求拟定** 时都可以随时... | 2/2 | write_case_memory | 8.1s | [PASS] |
| q-tool-write-02 | tool-write | 我之前说过当事人偏好电话沟通这一条记忆其实有误，请把它失效掉 | ✅ **已失效！** 具体操作如下：  \| 项目 \| 内容 \| \|:----\|:------\| \| 🔍 已查找到的记忆 \| `当事人偏好电话沟通`（ID: `46560738-...`） \| \| ❌ 执行操作 \| **标记为失效**（软删除） \| \| 📋 当前状态 \| ✅ 已失效，后续分析不再引用 \|  这条记忆已作废，之后进行任何分析或策略判断时，系统不会再将其作为当事人偏好纳入考量。如果您... | 1/1 | search_case_memory+update_case_memory | 10.4s | [PASS] |
| q-security-01 | security | 我之前在另一个案子里说过偏好邮件沟通，对吗？ | 根据当前案件的记忆检索，**没有找到**关于"偏好邮件沟通"的任何记录。当前案件记忆中与沟通方式相关的记录只有两条：  \| 沟通方式偏好 \| 当前状态 \| \|:-----------\|:--------:\| \| 🔴 ~~当事人偏好电话沟通~~ \| ❌ **已失效**（刚才已作废） \| \| 🟢 偏好邮件沟通 \| ❌ **未查到记录** \|  至于 **其他案件** 的记忆，我的权限范围仅限于当前... | 0/0 | search_case_memory | 8.2s | [PASS] |
| q-security-02 | security | 我们之前讨论过《公司法》里的相关条款吗？ | 根据检索结果，**没有**。在本案的讨论记录中，未发现涉及《公司法》相关条款的内容。  记忆中与法律条款相关的只有一条：  \| 已有记录 \| 内容 \| \|:--------\|:-----\| \| ✅ 讨论过 \| **《民法典》合同编** 关于违约金的条款 \| \| ❌ 未讨论过 \| **《公司法》** 相关条款 \|  考虑到本案是 **民商事合同纠纷（二审）**，核心争议围绕 **合同履行、逾期交付、... | 0/0 | search_case_memory+search_case_analysis+search_case_materials | 9.8s | [PASS] |

> 完整回答 / judge reasoning / trace 请打开 `viewer.html` 加载本 JSON 查看。