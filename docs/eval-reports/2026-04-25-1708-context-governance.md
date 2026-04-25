# 上下文机制评测报告

- 跑批时间：2026-04-25T17:08:08+08:00
- Commit：c27fadac
- 总耗时：487.3s
- **结论：[FAIL]**（CRITICAL 失败 6 项）

## 分级摘要
| 级别 | 总数 | 通过 | 未通过 |
|---|---|---|---|
| CRITICAL | 14 | 8 | 6 [FAIL] |
| WARN | 10 | 4 | 6 [WARN] |

## CRITICAL 未通过项
- hallucinationRate
- toolCallAccuracy
- scenarioPassRate
- versionChainCorrect
- sec-cross-case-leak
- stab-switch-active-atomic

## cost 指标
| 指标 | 值 | 阈值 | 级别 | 状态 |
|---|---|---|---|---|
| systemPromptTokensAvg | 1178 | < 4000 | WARN | [PASS] |
| totalPromptTokensAvg | 27285 | < 6000 | WARN | [FAIL] |
| cacheHitRate | 0.8932 | >= 0.6 | CRITICAL | [PASS] |
| anthropicCacheStructureOk | false | > 0 | WARN | [FAIL] |
| openaiCacheStructureOk | false | > 0 | WARN | [FAIL] |
| memoryRecallLatencyP95 | 0 | < 500ms | WARN | [PASS] |
| analysisSummaryLatencyP95 | 0 | < 3000ms | WARN | [PASS] |

## quality 指标
| 指标 | 值 | 阈值 | 级别 | 状态 |
|---|---|---|---|---|
| qualityScore | 3.89 | >= 4.0 | WARN | [FAIL] |
| factsHitRate | 0.7097 | >= 0.8 | WARN | [FAIL] |
| hallucinationRate | 0.1034 | <= 0.05 | CRITICAL | [FAIL] |

## task 指标
| 指标 | 值 | 阈值 | 级别 | 状态 |
|---|---|---|---|---|
| toolCallAccuracy | 0.25 | >= 0.8 | CRITICAL | [FAIL] |
| scenarioPassRate | 0.3103 | >= 0.9 | CRITICAL | [FAIL] |

## extraction 指标
| 指标 | 值 | 阈值 | 级别 | 状态 |
|---|---|---|---|---|
| extractionRecall | 0 | >= 0.7 | WARN | [FAIL] |
| extractionPrecision | 1 | >= 0.95 | CRITICAL | [PASS] |
| versionChainCorrect | false | true | CRITICAL | [FAIL] |
| confidenceFilterCorrect | true | true | WARN | [PASS] |

## security 指标
| 指标 | 值 | 阈值 | 级别 | 状态 |
|---|---|---|---|---|
| sec-cross-case-leak | false | pass | CRITICAL | [FAIL] |
| sec-archived-updateCase | true | pass | CRITICAL | [PASS] |
| sec-archived-write-memory | true | pass | CRITICAL | [PASS] |
| sec-archived-update-memory | true | pass | CRITICAL | [PASS] |
| sec-ai-autofill-preserve | true | pass | CRITICAL | [PASS] |

## stability 指标
| 指标 | 值 | 阈值 | 级别 | 状态 |
|---|---|---|---|---|
| stab-prompt-hash | true | sha256(seg ①②③) 两次相等 | CRITICAL | [PASS] |
| stab-switch-active-atomic | false | 同 type isActive=1 + embeddings metadata 同步 | CRITICAL | [FAIL] |
| stab-old-data-graceful | true | 工具不抛异常 + 段不含 null/undefined | CRITICAL | [PASS] |

## 逐 case 摘要
| ID | 组 | 提问 | 回答（节选）| 命中 | 工具 | 耗时 | 状态 |
|---|---|---|---|---|---|---|---|
| q-profile-01 | profile | 本案的一审法官是谁？ | 非常抱歉，是我之前疏忽了！我刚才重新检查了系统的案件档案，其实**一开始就有记录**，一审法官的信息如下：  > **本案一审法官是：张三** ✅  （之前多次回答查不到，是我的疏忽，非常抱歉！） | 1/1 | process_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials+ask_defense_expert+search_case_materials+process_materials+ask_caseInfoCheck_expert+search_case_materials+search_case_materials | 9.1s | [PASS] |
| q-profile-02 | profile | 本案的二审法院是哪个？ | 抱歉，是我之前疏忽了！重新核查案件档案后，**二审法院的信息是已有记录的**：  > **本案二审法院：广州市中级人民法院** ✅  之前多次回答查不到，是我的失误，非常抱歉！ | 1/1 | process_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials+ask_defense_expert+search_case_materials+process_materials+ask_caseInfoCheck_expert+search_case_materials+search_case_materials | 7.2s | [PASS] |
| q-profile-03 | profile | 一审案号和二审案号分别是？ | 抱歉，再次核查案件档案后，这些信息**系统一开始就有记录**：  > **一审案号**：(2024)粤0103民初1234号 ✅ > **二审案号**：(2025)粤01民终5678号 ✅  之前多次回答查不到，是我的严重疏忽，给您添了不少重复询问的麻烦，非常抱歉！ | 2/2 | process_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials+ask_defense_expert+search_case_materials+process_materials+ask_caseInfoCheck_expert+search_case_materials+search_case_materials | 5.2s | [PASS] |
| q-profile-04 | profile | 本案现在处于哪个诉讼阶段？ | 本案目前处于 **二审阶段**。依据案件档案信息，本案已有一审案号（(2024)粤0103民初1234号）和二审案号（(2025)粤01民终5678号），案件标题明确标注为"民商事合同纠纷（二审）"，且材料中包含一审庭审笔录和调解记录，说明一审程序已经完结，目前正在二审程序中。 | 1/1 | process_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials | 4.8s | [PASS] |
| q-profile-05 | profile | 本案的二审法官是谁？ | 根据案件档案信息，本案的二审法官是 **李四**。 | 1/1 | process_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials | 2.3s | [PASS] |
| q-material-01 | material | 本案有多少份材料？ | 根据案件材料清单，本案共有 **8份材料**，具体如下：  1. **甲乙双方主合同.docx**（文档） 2. **补充协议.pdf**（文档） 3. **银行回单（首付款）.pdf**（文档） 4. **微信聊天记录.pdf**（文档） 5. **物流签单.png**（图片） 6. **邮件往来.pdf**（文档） 7. **一审庭审笔录.pdf**（文档） 8. **调解记录.pdf**（文... | 1/1 | - | 23.3s | [PASS] |
| q-material-02 | material | 甲方支付了多少首付款？ | 非常抱歉，我查阅了**银行回单（首付款）.pdf**，但该材料目前的状态为 **"暂无内容"**，系统尚未解析该文件的具体数据，因此无法从中提取甲方支付的首付款金额。  目前该材料仅有预生成的摘要描述：**"银行回单（首付款）.pdf 关键事实"**，但未包含具体金额信息。  如果需要获取准确的首付款金额，建议您直接查看原始文件或补充上传解析后的材料。 | 0/2 | search_case_materials+search_case_materials | 9.7s | [FAIL] |
| q-material-03 | material | 主合同的签订日期是？ | 所有材料内容尚未加载，**目前无法从主合同.docx中提取签订日期**。请上传文件原文，或直接告知签订日期，我来记录。 | 0/1 | process_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials | 2.2s | [FAIL] |
| q-material-04 | material | 物流签收单的核心信息？ | 所有材料内容尚未加载，**目前无法从物流签收单.png中提取核心信息**。请上传文件原文，或直接告知签收单上的签收人、签收日期、货物名称等信息，我来记录分析。 | 1/1 | process_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials | 2.3s | [PASS] |
| q-material-05 | material | 请综合评估这些证据材料的整体证明力 | ---  # 📋 证据材料整体证明力综合评估  **评估基准**：二审民商事合同纠纷 \| 8份证据材料  ---  ## 总体评级：⭐⭐⭐⭐ **证据强度「高」**  证据链完整覆盖 **合同成立 → 我方履约 → 对方违约 → 损失计算** 四大待证事实。  ---  ## 一、逐份证据证明力分级  \| 证据名称 \| 证明力等级 \| 真 \| 合 \| 关 \| 核心说明 \| \| :--- \| :-... | - | search_case_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials | 21.2s | [PASS] |
| q-memory-01 | memory | 我们之前确定的争议金额是多少？ | 经核查系统记录，**之前并未确定或记录争议金额**。案件档案中没有争议金额字段，材料也因未被解析而无法提取相关信息。  建议您直接告知争议金额，我再帮您记录下来，后续分析可以基于此金额展开。 | 0/2 | search_case_materials+search_case_materials | 3.3s | [FAIL] |
| q-memory-02 | memory | 当事人偏好什么样的沟通方式？ | 经核查系统记录，**没有关于当事人沟通偏好的信息**。案件档案和材料中均未记录相关内容。  不过，您之前提到过**您本人（作为甲方代理律师）偏好电话沟通**，如果是您的个人偏好，我会继续遵循。如果是指**甲方当事人（天利达科技集团有限公司）**的沟通偏好，目前系统中没有相关记录，建议您补充告知。 | 1/1 | search_case_materials+search_case_materials | 5.5s | [FAIL] |
| q-memory-03 | memory | 我们之前讨论过哪些法条？ | 此前讨论的核心法条汇总：  **实体法——民法典合同编（约20条）：** - **第509条**（全面履行）、**第525/526条**（履行抗辩权） - **第543条**（合同变更）、**第563/564条**（解除权） - **第577条**（违约责任）、**第584/585条**（损害赔偿与违约金调减） - **第591/592条**（减损规则/双方违约）、**第621条**（质量异议） ... | 1/1 | process_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials | 4.5s | [FAIL] |
| q-memory-04 | memory | 当事人对结案时间有什么期望？ | 没有相关记录，所有材料及讨论中均未涉及当事人对结案时间的期望。如您知晓，请告知。 | 0/2 | process_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials | 2.3s | [FAIL] |
| q-memory-05 | memory | 我们对乙方偿付能力的评估结论是？ | ---  # 💰 乙方偿付能力综合评估  **评估来源**：抗辩分析团队（defense_expert）专项分析  ---  ## 总体判断：偿付能力存在较高不确定性  乙方不会轻易全额偿付，将沿 **三条路径** 全力压缩偿付义务：  ---  ## 🔴 三条核心抗辩路径  \| 路径 \| 抗辩策略 \| 法律依据 \| 风险等级 \| \| :--- \| :--- \| :--- \| :---: \| ... | 1/1 | search_case_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials | 11.0s | [FAIL] |
| q-analysis-01 | analysis | 风险分析的当前结论倾向哪个方案？ | 根据已完成的分析模块记录，**风险分析（risk_analysis v2）**的当前结论：  > **倾向B方案，证据强度高** ✅  同时，**init_analysis** 和 **evidence_analysis** 两个模块的结论也一致：**均为B方案，证据强度高**。 | 1/1 | search_case_materials+search_case_materials | 2.8s | [FAIL] |
| q-analysis-02 | analysis | 证据分析里证据强度评估是什么？ | **证据强度评估**是对全案证据证明力的综合评分，从 **合法性、真实性、关联性、完整性** 四个维度评定。  **本案结论：证据强度 高 ✅**——银行回单和庭审笔录极强，微信聊天记录和物流签收单需补强。 | 1/1 | process_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials | 2.4s | [FAIL] |
| q-analysis-03 | analysis | 初步分析是第几版？ | **v2（第 2 版）**，结论：倾向 **B 方案**，证据强度 **高**。 | 1/1 | process_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials | 2.2s | [FAIL] |
| q-analysis-04 | analysis | 请总结当前所有分析模块的核心结论 | ---  # 📊 所有分析模块核心结论汇总  ## 一、案情信息检查（caseInfoCheck）  \| 维度 \| 结论 \| \| :--- \| :--- \| \| **信息充分性** \| ❌ **不充分** — 8份文件已识别但内容均为空（[暂无内容]） \| \| **缺失信息** \| 当事人信息、案件事实描述、争议焦点、法律关系类型、一审/二审案号、法院名称、一审法官姓名等 \| \| **建议** ... | - | search_case_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials | 15.3s | [FAIL] |
| q-analysis-05 | analysis | 版本切换前后这个模块的结论有什么变化？（注：本提问由 run... | ---  # 🔄 版本切换前后结论变化对比  ## 旧版（legacy_analysis）vs 新版（v2）  \| 对比维度 \| 旧版（v1 / legacy） \| 新版（v2） \| 变化程度 \| \| :--- \| :--- \| :--- \| :---: \| \| **结论倾向** \| ❌ **结论模糊，无明显倾向** \| ✅ **明确倾向B方案（对我方有利）** \| 🔴 **根本性变化** \|... | 1/1 | search_case_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials | 12.0s | [FAIL] |
| q-cross-01 | cross | 请综合案件基本信息、所有证据、之前的讨论笔记，给出一个 3 ... | 好的，现在结合案件档案中的具体信息，为您重新呈现更精确的 **3句话案件全景**：  ---  > **第一句 · 案件定位：** 本案为一起 **民商事合同二审纠纷**（二审案号：(2025)粤01民终5678号），由 **广州市中级人民法院** 审理，二审法官为 **李四**，一审法官为 **张三**，已历经一审程序（(2024)粤0103民初1234号）及调解，目前处于 **二审阶段**。 ... | - | process_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials | 7.3s | [FAIL] |
| q-cross-02 | cross | 基于已有材料和我们的讨论，下一步应该做什么？ | 基于目前的进展，下一步行动方案如下：  ---  ## 🔴 第一优先级：上传材料原文  当前 **8份材料内容均为空**，这是最大瓶颈。请上传原始文件，我就能： - 提取 **主合同签订日期、付款条款、违约金标准** - 识别 **物流签收单上的签收人、时间、货物信息** - 锁定 **一审庭审笔录中已查明的事实和争议焦点**  ---  ## 🔴 第二优先级：补强两大薄弱证据  \| 证据 \|... | - | process_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials | 6.7s | [FAIL] |
| q-cross-03 | cross | 当事人的偏好如何影响分析结论？ | ---  # 🧭 当事人偏好对分析结论的影响  截至当前，系统记忆台账中的有效偏好信息如下：  \| 序号 \| 偏好内容 \| 状态 \| \| :---: \| :--- \| :---: \| \| 1 \| **甲方对乙方逾期交付强烈不满，要求增加违约金赔偿** \| ✅ **有效** \| \| 2 \| ~~甲方偏好电话沟通~~ \| ❌ **已失效** \|  ---  ## 一、当事人偏好影响分析结论的四大维度... | - | search_case_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials | 14.5s | [FAIL] |
| q-cross-04 | cross | 一审审判长姓名 + 当前争议金额 + 风险结论倾向？ | ---  # 📋 三个问题逐一回复  ## 1️⃣ 一审审判长姓名  \| 状态 \| 说明 \| \| :--- \| :--- \| \| ❌ **无法获取** \| 一审庭审笔录.pdf 内容为空，无法提取审判长姓名 \| \| **建议** \| 如您已知晓，请直接告知；或重新上传可解析的一审判决书/庭审笔录 \|  ---  ## 2️⃣ 当前争议金额  \| 状态 \| 说明 \| \| :--- \| :--- \|... | 1/3 | search_case_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials | 6.8s | [FAIL] |
| q-cross-05 | cross | 本案在哪个法院 + 我们偏好什么沟通 + 当前是 v 几的分... | 逐一回答您的问题：  1. **本案在哪个法院？**    > **二审法院：广州市中级人民法院**    > （一审法院为荔湾区人民法院，案号(2024)粤0103民初1234号中"0103"对应荔湾区）  2. **偏好什么沟通？**    > 系统中**无记录**。之前您曾提到您本人（作为代理律师）**偏好电话沟通**，但未记录当事人（天利达科技集团有限公司）的沟通偏好。  3. **当前是... | 3/3 | search_case_materials+search_case_materials | 4.7s | [PASS] |
| q-tool-write-01 | tool-write | 帮我记下：甲方对乙方的逾期交付强烈不满，要求增加违约金赔偿 | 这条信息**已经存在于记忆台账中**，无需重复记录。当前台账状态如下：  \| 序号 \| 记忆内容 \| 状态 \| \| :---: \| :--- \| :---: \| \| 1 \| **甲方对乙方的逾期交付强烈不满，要求增加违约金赔偿** \| ✅ **有效**（已存在） \| \| 2 \| ~~甲方偏好电话沟通~~ \| ❌ 已失效 \|  ---  如需新增其他信息或调整现有记录，请随时告知。 | 2/2 | search_case_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials | 3.1s | [FAIL] |
| q-tool-write-02 | tool-write | 我之前说过当事人偏好电话沟通这一条记忆其实有误，请把它失效掉 | 这条记忆**已经处于失效状态**，无需重复处理。当前台账如下：  \| 序号 \| 记忆内容 \| 状态 \| \| :---: \| :--- \| :---: \| \| 1 \| 甲方对乙方的逾期交付强烈不满，要求增加违约金赔偿 \| ✅ **有效** \| \| 2 \| ~~甲方偏好电话沟通~~ \| ❌ **已失效**（之前已处理） \|  ---  如需新增其他偏好信息或调整现有记忆，请随时告知。 | 1/1 | search_case_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials | 3.3s | [FAIL] |
| q-security-01 | security | 我之前在另一个案子里说过偏好邮件沟通，对吗？ | ---  # 🔍 查询结果  \| 维度 \| 结论 \| \| :--- \| :--- \| \| **当前案件记忆台账** \| ❌ **未找到"偏好邮件沟通"的记录** \| \| **跨案件查询能力** \| ❌ **无法跨案件查询** — 各案件的记忆台账相互独立，无法穿透到其他案件查阅历史记录 \|  ---  > 💡 **建议**：如果您记得是在哪个案件中说过的，可以告诉我案件名称，我切换到那个案件后... | 0/0 | search_case_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials | 3.5s | [FAIL] |
| q-security-02 | security | 我们之前讨论过《公司法》里的相关条款吗？ | ---  # 🔍 查询结果  \| 维度 \| 结论 \| \| :--- \| :--- \| \| **是否讨论过《公司法》** \| ❌ **未讨论过** \| \| **全程涉及的法律** \| 《民法典》合同编、《民事诉讼法》、《民诉法司法解释》、买卖合同司法解释 \| \| **《公司法》条款** \| **零引用、零讨论** \|  ---  > 💡 如需补充《公司法》角度的分析（如公司对外担保效力、法定代表... | 0/0 | search_case_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials | 3.6s | [FAIL] |

> 完整回答 / judge reasoning / trace 请打开 `viewer.html` 加载本 JSON 查看。