# 上下文机制评测报告

- 跑批时间：2026-04-25T22:36:34+08:00
- Commit：f5db37ff
- 总耗时：491.5s
- **结论：[PASS]**（CRITICAL 失败 0 项）

## 分级摘要
| 级别 | 总数 | 通过 | 未通过 |
|---|---|---|---|
| CRITICAL | 14 | 14 | 0  |
| WARN | 10 | 8 | 2 [WARN] |

## cost 指标
| 指标 | 值 | 阈值 | 级别 | 状态 |
|---|---|---|---|---|
| systemPromptTokensAvg | 811 | < 4000 | WARN | [PASS] |
| totalPromptTokensAvg | 9780 | < 6000 | WARN | [FAIL] |
| cacheHitRate | 0.8479 | >= 0.6 | CRITICAL | [PASS] |
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
| extractionRecall | 1 | >= 0.7 | WARN | [PASS] |
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
| q-profile-01 | profile | 本案的一审法官是谁？ | 根据案件档案信息，本案的一审承办法官为 **张三**。  （补充：二审承办法官为 **李四**。） | 1/1 | - | 2.2s | [PASS] |
| q-profile-02 | profile | 本案的二审法院是哪个？ | 根据案件档案，本案的 **二审法院是广州市中级人民法院**。  - 二审案号：(2025)粤01民终5678号 - 二审承办法官：李四  （注：本案一审法院同为广州市中级人民法院，案号为(2024)粤0103民初1234号。） | 1/1 | - | 2.8s | [PASS] |
| q-profile-03 | profile | 一审案号和二审案号分别是？ | 根据案件档案，案号信息如下：  \| 审级 \| 案号 \| \|------\|------\| \| **一审** \| (2024)粤0103民初1234号 \| \| **二审** \| (2025)粤01民终5678号 \| | 2/2 | - | 2.3s | [PASS] |
| q-profile-04 | profile | 本案现在处于哪个诉讼阶段？ | 根据案件档案信息，本案目前已进入**二审阶段**：  \| 项目 \| 内容 \| \|------\|------\| \| **一审案号** \| (2024)粤0103民初1234号 \| \| **一审法官** \| 张三 \| \| **二审案号** \| **(2025)粤01民终5678号** \| \| **二审法官** \| **李四** \| \| **案件状态** \| 4（二审审理中） \| \| **审理法院** ... | 1/1 | - | 6.2s | [PASS] |
| q-profile-05 | profile | 本案的二审法官是谁？ | 根据案件档案信息，本案的**二审法官是李四**，审理法院为**广州市中级人民法院**。 | 1/1 | - | 1.6s | [PASS] |
| q-material-01 | material | 本案有多少份材料？ | 本案目前共有 **8 份材料**，具体清单如下：  \| 序号 \| 材料名称 \| 类型 \| \|:----:\|----------\|:----:\| \| 1 \| 甲乙双方主合同.docx \| 文档 \| \| 2 \| 补充协议.pdf \| 文档 \| \| 3 \| 银行回单（首付款）.pdf \| 文档 \| \| 4 \| 微信聊天记录.pdf \| 文档 \| \| 5 \| 物流签收单.png \| 图片 \| \| 6 \| ... | 1/1 | search_case_materials | 4.9s | [PASS] |
| q-material-02 | material | 甲方支付了多少首付款？ | 根据案件材料清单中的 **银行回单（首付款）.pdf**，甲方支付的 **首付款为 100 万元**。 | 2/2 | - | 1.9s | [PASS] |
| q-material-03 | material | 主合同的签订日期是？ | 根据案件材料清单中的记录，**甲方天利达与乙方北方贸易于2024年3月15日签订**了主合同，合同总金额为380万元。 | 1/1 | search_case_materials+search_case_materials+search_case_materials+process_materials | 10.5s | [PASS] |
| q-material-04 | material | 物流签收单的核心信息？ | 根据案件材料清单的记录，**物流签收单.png** 的核心作用是 **证明实际交付完成时间**。  由于该文件为图片格式（.png），目前系统中尚未提取其文字内容。如果您需要我进一步处理该图片以提取具体信息（如实际签收日期、收货人签字等），我可以先调用相关工具来识别和读取图片中的内容。需要我这样做吗？ | 1/1 | search_case_materials | 7.9s | [PASS] |
| q-material-05 | material | 请综合评估这些证据材料的整体证明力 | 好的，信息已全面收集完毕。以下是我为您出具的 **《证据材料整体证明力综合评估报告》**，融合了案件档案、已完成分析模块结论、案件记忆以及8份材料清单的全景分析。  ---  ## 📋 证据材料整体证明力综合评估报告  ### 一、案件基本信息  \| 项目 \| 内容 \| \|---\|---\| \| **案号** \| 一审：(2024)粤0103民初1234号 → 二审：(2025)粤01民终5678... | - | search_case_materials+search_case_memory+search_case_analysis+search_case_analysis+process_materials+search_case_analysis+search_case_analysis+search_case_analysis+search_case_analysis+search_case_analysis+search_case_materials+search_case_materials+search_case_materials+search_case_materials+search_case_analysis+search_case_analysis+search_case_memory+search_law+search_law+search_law+search_law | 73.2s | [PASS] |
| q-memory-01 | memory | 我们之前确定的争议金额是多少？ | 根据我们此前记录的案件事实，**争议金额为 280 万元**（主合同总金额 380 万元 - 已付首付款 100 万元）。 | 2/2 | search_case_memory | 4.5s | [PASS] |
| q-memory-02 | memory | 当事人偏好什么样的沟通方式？ | 根据案件记忆记录，**当事人偏好电话沟通**。 | 1/1 | search_case_memory | 3.6s | [PASS] |
| q-memory-03 | memory | 我们之前讨论过哪些法条？ | 根据案件记忆，我们之前在讨论中涉及过以下法条相关内容：  1. **《民法典》合同编关于违约金的条款** — 曾就此进行过讨论 2. **和解方案的可行性** — 属于程序性讨论  目前记忆中没有更具体的法条细节记录。需要我结合本案的合同纠纷性质，为您检索与本案可能相关的具体法条（如《民法典》第577条关于违约责任、第584条关于损害赔偿、第585条关于违约金等规定）吗？ | 1/1 | search_case_memory | 6.2s | [PASS] |
| q-memory-04 | memory | 当事人对结案时间有什么期望？ | 根据案件记忆，当事人对结案时间的期望是：**希望2个月内结案**。  此外，当事人在整体策略上还倾向于**积极调解**，并偏好**电话沟通**方式。如果本案目前处于二审阶段，2个月内结案的时间要求相对较紧，结合当事人倾向调解的意愿，您可以考虑向当事人建议通过法院主持调解的方式加快结案进程。需要我进一步分析可行性方案吗？ | 2/2 | search_case_memory | 4.7s | [PASS] |
| q-memory-05 | memory | 我们对乙方偿付能力的评估结论是？ | 根据已有信息，我来为您梳理关于乙方偿付能力的评估结论。  ---  ## 乙方（北方贸易）偿付能力评估结论  ### 已记录的信息  \| 信息来源 \| 内容 \| \|---\|---\| \| **案件记忆（topic）** \| ✅ 已对乙方的偿付能力风险进行过评估 \| \| **风险分析 v2** \| B方案，整体证据强度高 \| \| **调解记录** \| 法院曾主持调解，侧面反映双方对偿付问题有争议 \| ... | 1/1 | search_case_memory+search_case_analysis+search_case_analysis+search_case_memory+search_case_materials+search_case_materials | 27.1s | [PASS] |
| q-analysis-01 | analysis | 风险分析的当前结论倾向哪个方案？ | 根据已完成的分析模块记录，**风险分析 v2** 的当前结论倾向 **B 方案**，且证据强度评级为 **高**。 | 1/1 | search_case_analysis | 4.7s | [PASS] |
| q-analysis-02 | analysis | 证据分析里证据强度评估是什么？ | 根据已完成的分析模块记录，**evidence_analysis v2** 对本案证据强度的评估结论为：  > **B 方案，证据强度高。**   即分析团队认为本案的证据整体强度较高，采用了B方案的分析路径。如需了解更详细的证据分组、每份证据的证明力评价等具体分析细节，我可以调用证据专家工具进一步深挖分析。需要我这样做吗？ | 1/1 | search_case_analysis+search_case_analysis | 7.9s | [PASS] |
| q-analysis-03 | analysis | 初步分析是第几版？ | 根据已完成分析模块的记录，**初步分析（init_analysis）是 v2 版本**，其结论为 **B 方案，证据强度高**。 | 1/1 | - | 2.1s | [PASS] |
| q-analysis-04 | analysis | 请总结当前所有分析模块的核心结论 | 好的，以下是当前所有已完成分析模块的核心结论总结。  ---  ## 📊 全部分析模块核心结论汇总  ### 已完成的模块（共3个）  \| 序号 \| 模块名称 \| 版本 \| 核心结论 \| 状态 \| \|:---:\|:---\|:---:\|:---\|:---:\| \| ① \| **初始分析**（init_analysis） \| **v2** \| **B方案 / 证据强度高** ✅ \| ✅ 已生效 \| \|... | - | search_case_analysis+search_case_analysis+search_case_analysis+search_case_analysis+search_case_analysis | 24.4s | [PASS] |
| q-analysis-05 | analysis | 版本切换前后这个模块的结论有什么变化？（注：本提问由 run... | 好问题！我尝试检索了旧版本（v1）的详细数据，系统当前仅保留生效版本（v2）的完整内容。不过基于现有信息，我来为您梳理版本切换前后的结论变化。  ---  ## 🔄 版本切换前后分析模块结论对比  ### 当前生效版本（v2）—— 切换后  \| 模块 \| 结论 \| \|:---\|---:\| \| **初始分析** v2 \| **B方案 / 证据强度高** ✅ \| \| **证据分析** v2 \| **... | 1/1 | search_case_analysis+search_case_analysis+search_case_analysis+search_case_analysis+search_case_analysis+search_case_analysis+search_case_analysis+search_case_analysis+search_case_memory | 38.0s | [PASS] |
| q-cross-01 | cross | 请综合案件基本信息、所有证据、之前的讨论笔记，给出一个 3 ... | 以下是根据**案件档案 + 分析结论 + 讨论笔记**三层信息综合形成的案件全景：  ---  **第一层·基本事实与诉讼进程：** 本案为甲方天利达与乙方北方贸易之间380万元的主合同纠纷，一审案号(2024)粤0103民初1234号（法官张三），现已上诉至广州市中级人民法院进入二审程序，二审案号(2025)粤01民终5678号（法官李四），核心争议焦点围绕交付逾期及违约责任。  **第二层·证... | - | search_case_memory+search_case_materials | 13.6s | [PASS] |
| q-cross-02 | cross | 基于已有材料和我们的讨论，下一步应该做什么？ | 基于**案件档案、分析结论、当事人意愿**三层信息综合判断，我建议**下一步行动方案**如下：  ---  **核心建议：利用证据优势，主动推进调解，争取2个月内结案。**  原因有三：  ① **案件档案层面**——本案已进入二审（广州中院，法官李四），诉讼周期已较长，继续对抗审理意味着时间与诉讼成本的双重消耗。  ② **分析结论层面**——三项分析模块（初步分析v2、证据分析v2、风险分析v... | - | search_case_analysis | 11.1s | [PASS] |
| q-cross-03 | cross | 当事人的偏好如何影响分析结论？ | 好的！以下是当事人偏好如何影响各分析模块结论的全景分析。  ---  ## 🧩 当事人偏好全景  我已检索到 **4条明确的当事人偏好记录**：  \| # \| 偏好内容 \| 类型 \| 影响方向 \| \|:---:\|:---\|---:\|:---:\| \| ① \| **倾向积极调解** \| 策略偏好 \| 追求非对抗性解决 \| \| ② \| **希望2个月内结案** \| 时间偏好 \| 追求快速结案，不接受长... | - | search_case_memory+search_case_memory+search_case_memory+search_case_memory+search_case_memory+search_case_memory | 36.3s | [PASS] |
| q-cross-04 | cross | 一审审判长姓名 + 当前争议金额 + 风险结论倾向？ | ## 📋 三要素综合速查  \| 要素 \| 信息 \| 来源 \| \|:---\|---:\|:---:\| \| **① 一审审判长姓名** \| **张三** \| 案件档案 `firstInstanceJudge` \| \| **② 当前争议金额** \| **280 万元** \| 案件记忆（已记录） \| \| **③ 风险结论倾向** \| **B方案 / 证据强度高 ✅** \| 风险分析 v2 \|  ---  ... | 3/3 | - | 7.7s | [PASS] |
| q-cross-05 | cross | 本案在哪个法院 + 我们偏好什么沟通 + 当前是 v 几的分... | 根据案件档案、已完成分析模块和案件记忆，综合回答如下：  ---  ### 📍 本案管辖法院 本案一审和二审均在 **广州市中级人民法院**。  ### 📞 沟通偏好 根据案件记忆，**当事人偏好电话沟通**。  ### 🔄 当前分析版本 目前已完成的三大核心分析模块均为 **v2 版本**：  \| 分析模块 \| 当前版本 \| 结论倾向 \| \|----------\|:--------:\|:-... | 3/3 | - | 5.6s | [PASS] |
| q-tool-write-01 | tool-write | 帮我记下：甲方对乙方的逾期交付强烈不满，要求增加违约金赔偿 | ✅ **已记录！** 记忆内容如下：  > **甲方对乙方逾期交付45天表示强烈不满，要求增加违约金赔偿**（主题指纹：`plaintiff.attitude.liquidated_damages`）  这条信息将与现有记忆联动——此前已讨论过 **《民法典》合同编关于违约金的条款**，以及 **乙方逾期交货45天** 的事实，结合甲方最新的强硬态度，后续在调解谈判或诉讼策略中可作为重要参考。 | 2/2 | write_case_memory | 6.4s | [PASS] |
| q-tool-write-02 | tool-write | 我之前说过当事人偏好电话沟通这一条记忆其实有误，请把它失效掉 | ✅ **已失效！** 以下记忆已被标记为作废：  > ~~当事人偏好电话沟通~~ ❌（已失效）  该条记忆已从有效记忆中移除，后续分析将不再引用此偏好信息。如需重新添加正确的偏好记录，随时告诉我！ | 1/1 | search_case_memory+update_case_memory | 8.8s | [PASS] |
| q-security-01 | security | 我之前在另一个案子里说过偏好邮件沟通，对吗？ | 在当前案件的记忆记录中，**没有查到**您提及过"偏好邮件沟通"的相关记录。  当前案件中与沟通偏好有关的记忆只有一条：  - ~~当事人偏好电话沟通~~ ❌（已由您刚才确认有误，已失效）  由于我只能检索当前案件的记忆，您在**另一个案子**里是否提过偏好邮件沟通，我这边无法跨案件查询到。如果您在其他案件中有相关记录，需要我在当前案件中重新补录一条正确的沟通偏好，随时告诉我！ | 0/0 | search_case_memory | 7.2s | [PASS] |
| q-security-02 | security | 我们之前讨论过《公司法》里的相关条款吗？ | **没有讨论过。** 当前案件的记忆中，之前讨论的法律条款主要集中在：  - ✅ **《民法典》合同编** — 关于违约金的条款（有记录） - 《公司法》相关条款 — **未发现相关讨论记录 ❌**  本案是 **民商事合同纠纷**，核心涉及的是合同违约和交付逾期问题，法律适用也以《民法典》合同编为主，与《公司法》的关联度较低。如果您需要了解《公司法》中的相关规定，我可以随时帮您检索。 | 0/0 | search_case_memory | 5.6s | [PASS] |

> 完整回答 / judge reasoning / trace 请打开 `viewer.html` 加载本 JSON 查看。