# 上下文机制评测报告

- 跑批时间：2026-04-25T16:06:34+08:00
- Commit：f5c20bba
- 总耗时：308.9s
- **结论：[FAIL]**（CRITICAL 失败 5 项）

## 分级摘要
| 级别 | 总数 | 通过 | 未通过 |
|---|---|---|---|
| CRITICAL | 14 | 9 | 5 [FAIL] |
| WARN | 10 | 4 | 6 [WARN] |

## CRITICAL 未通过项
- hallucinationRate
- toolCallAccuracy
- scenarioPassRate
- versionChainCorrect
- sec-cross-case-leak

## cost 指标
| 指标 | 值 | 阈值 | 级别 | 状态 |
|---|---|---|---|---|
| systemPromptTokensAvg | 887 | < 4000 | WARN | [PASS] |
| totalPromptTokensAvg | 28081 | < 6000 | WARN | [FAIL] |
| cacheHitRate | 0.9535 | >= 0.6 | CRITICAL | [PASS] |
| anthropicCacheStructureOk | false | > 0 | WARN | [FAIL] |
| openaiCacheStructureOk | false | > 0 | WARN | [FAIL] |
| memoryRecallLatencyP95 | 0 | < 500ms | WARN | [PASS] |
| analysisSummaryLatencyP95 | 0 | < 3000ms | WARN | [PASS] |

## quality 指标
| 指标 | 值 | 阈值 | 级别 | 状态 |
|---|---|---|---|---|
| qualityScore | 3.24 | >= 4.0 | WARN | [FAIL] |
| factsHitRate | 0.5161 | >= 0.8 | WARN | [FAIL] |
| hallucinationRate | 0.069 | <= 0.05 | CRITICAL | [FAIL] |

## task 指标
| 指标 | 值 | 阈值 | 级别 | 状态 |
|---|---|---|---|---|
| toolCallAccuracy | 0.25 | >= 0.8 | CRITICAL | [FAIL] |
| scenarioPassRate | 0.1724 | >= 0.9 | CRITICAL | [FAIL] |

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
| stab-switch-active-atomic | true | 同 type isActive=1 + embeddings metadata 同步 | CRITICAL | [PASS] |
| stab-old-data-graceful | true | 工具不抛异常 + 段不含 null/undefined | CRITICAL | [PASS] |

## 逐 case 摘要
| ID | 组 | 提问 | 回答（节选）| 命中 | 工具 | 耗时 | 状态 |
|---|---|---|---|---|---|---|---|
| q-profile-01 | profile | 本案的一审法官是谁？ | 这个问题我已经尝试过多次解析材料，确实查不到。如果您知道一审法官的姓名，直接告诉我，我来记录完善案件信息即可。 | 0/1 | process_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials+ask_defense_expert+search_case_materials+process_materials+ask_caseInfoCheck_expert+search_case_materials+search_case_materials | 2.5s | [FAIL] |
| q-profile-02 | profile | 本案的二审法院是哪个？ | 同样，材料未解析，系统中查不到二审法院的信息。如果您知道，直接告诉我即可。 | 0/1 | process_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials+ask_defense_expert+search_case_materials+process_materials+ask_caseInfoCheck_expert+search_case_materials+search_case_materials | 1.8s | [FAIL] |
| q-profile-03 | profile | 一审案号和二审案号分别是？ | 同样，材料未解析，查不到。如果您手头有相关信息，直接告诉我即可：  - **一审案号**：_______________ - **二审案号**：_______________ | 0/2 | process_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials+ask_defense_expert+search_case_materials+process_materials+ask_caseInfoCheck_expert+search_case_materials+search_case_materials | 2.4s | [FAIL] |
| q-profile-04 | profile | 本案现在处于哪个诉讼阶段？ | 本案目前处于 **二审阶段**。 | 1/1 | process_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials | 1.9s | [PASS] |
| q-profile-05 | profile | 本案的二审法官是谁？ | 目前所有材料内容均为空，且无任何二审法律文书（开庭传票、裁定书等），**无法确认二审法官信息**。如有相关文件，请上传后我来提取。 | 0/1 | process_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials | 1.8s | [FAIL] |
| q-material-01 | material | 本案有多少份材料？ | 本案共有 **8份材料**，这个之前已经确认过多次了 ✅  需要我再列一遍材料清单吗？ | 1/1 | process_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials+ask_defense_expert+search_case_materials+process_materials+ask_caseInfoCheck_expert+search_case_materials+search_case_materials | 1.8s | [PASS] |
| q-material-02 | material | 甲方支付了多少首付款？ | 系统中确实查不到，**《银行回单（首付款）.pdf》** 未解析出内容。如果您知道首付款金额，告诉我即可。 | 0/2 | process_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials+ask_defense_expert+search_case_materials+process_materials+ask_caseInfoCheck_expert+search_case_materials+search_case_materials | 2.1s | [FAIL] |
| q-material-03 | material | 主合同的签订日期是？ | 材料内容尚未加载，**无法提取**。请上传主合同原文。 | 0/1 | process_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials | 1.7s | [FAIL] |
| q-material-04 | material | 物流签收单的核心信息？ | 材料内容尚未加载，**无法提取**。请上传物流签收单图片原文。 | 1/1 | process_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials | 1.7s | [PASS] |
| q-material-05 | material | 请综合评估这些证据材料的整体证明力 | ---  # 📋 证据材料整体证明力综合评估  **评估基准**：二审民商事合同纠纷 \| 8份证据材料 \| 内容尚未解析出具体文字，基于材料类型、名称及案件背景进行专业推断  ---  ## 总体评级：⭐⭐⭐⭐ **证据强度「高」**  证据链完整覆盖**合同成立 → 我方履约 → 对方违约 → 损失计算**四大待证事实，两大薄弱环节补强后可升至「极高」。  ---  ## 一、逐份证据证明力分... | - | search_case_materials+search_case_materials+search_case_materials+search_case_materials | 19.7s | [PASS] |
| q-memory-01 | memory | 我们之前确定的争议金额是多少？ | 系统中没有记录，材料未解析查不到。如果您记得，告诉我即可。 | 0/2 | process_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials+ask_defense_expert+search_case_materials+process_materials+ask_caseInfoCheck_expert+search_case_materials+search_case_materials | 2.2s | [FAIL] |
| q-memory-02 | memory | 当事人偏好什么样的沟通方式？ | 已记录的信息：**您（代理律师）**偏好电话沟通，不太喜欢邮件 ✅  但**当事人（天利达科技集团有限公司）**的沟通偏好系统中暂无记录。请问公司方面有特定的沟通方式或对接人吗？ | 1/1 | process_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials+ask_defense_expert+search_case_materials+process_materials+ask_caseInfoCheck_expert+search_case_materials+search_case_materials | 4.9s | [FAIL] |
| q-memory-03 | memory | 我们之前讨论过哪些法条？ | 此前讨论的核心法条汇总如下：  **实体法——民法典合同编（约20条）：** - **第509条**（全面履行）、**第525/526条**（履行抗辩权） - **第543条**（合同变更）、**第563/564条**（解除权） - **第577条**（违约责任）、**第584/585条**（损害赔偿与违约金调减） - **第591/592条**（减损规则/双方违约）、**第621条**（质量异议... | 1/1 | process_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials | 3.8s | [FAIL] |
| q-memory-04 | memory | 当事人对结案时间有什么期望？ | 没有相关记录，所有材料及讨论记录中均未涉及当事人对结案时间的期望。如您知晓，请告知。 | 0/2 | process_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials | 2.3s | [FAIL] |
| q-memory-05 | memory | 我们对乙方偿付能力的评估结论是？ | ---  # 💰 乙方偿付能力综合评估  **评估来源**：抗辩分析团队（defense_expert）专项分析  ---  ## 总体判断：偿付能力存在较高不确定性  乙方不会轻易全额偿付，将沿 **三条路径** 全力压缩偿付义务：  ---  ## 🔴 三条核心抗辩路径  \| 路径 \| 抗辩策略 \| 法律依据 \| 风险等级 \| \| :--- \| :--- \| :--- \| :---: \| ... | 1/1 | search_case_materials+search_case_materials+search_case_materials+search_case_materials | 10.7s | [FAIL] |
| q-analysis-01 | analysis | 风险分析的当前结论倾向哪个方案？ | **风险分析（risk_analysis v2）当前结论：倾向 B 方案，证据强度高。**  与此前多次确认的一致 ✅ | 1/1 | process_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials+ask_defense_expert+search_case_materials+process_materials+ask_caseInfoCheck_expert+search_case_materials+search_case_materials | 1.8s | [FAIL] |
| q-analysis-02 | analysis | 证据分析里证据强度评估是什么？ | 证据强度评估是衡量全案证据 **能否扎实支撑我方主张** 的综合评分，从 **合法性、真实性、关联性、完整性** 四个维度评定。  **本案结论：证据强度 高 ✅**，银行回单和庭审笔录极强，微信聊天记录和物流签收单需补强。 | 1/1 | process_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials | 2.1s | [FAIL] |
| q-analysis-03 | analysis | 初步分析是第几版？ | **v2**（第 2 版），结论：倾向 **B 方案**，证据强度 **高**。 | 1/1 | process_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials | 1.6s | [FAIL] |
| q-analysis-04 | analysis | 请总结当前所有分析模块的核心结论 | ---  # 📊 所有分析模块核心结论汇总  ## 一、案情信息检查（caseInfoCheck）  \| 维度 \| 结论 \| \| :--- \| :--- \| \| **信息充分性** \| ❌ **不充分** — 8份文件已识别但内容均为空（[暂无内容]） \| \| **缺失信息** \| 当事人信息、案件事实描述、争议焦点、法律关系类型、一审/二审案号、法院名称、一审法官姓名等 \| \| **建议** ... | - | search_case_materials+search_case_materials+search_case_materials+search_case_materials | 16.8s | [FAIL] |
| q-analysis-05 | analysis | 版本切换前后这个模块的结论有什么变化？（注：本提问由 run... | ---  # 🔄 版本切换前后结论变化对比  ## 旧版（legacy_analysis）vs 新版（v2）  \| 对比维度 \| 旧版（v1 / legacy） \| 新版（v2） \| 变化程度 \| \| :--- \| :--- \| :--- \| :---: \| \| **结论倾向** \| ❌ **结论模糊，无明显倾向** \| ✅ **明确倾向B方案（对我方有利）** \| 🔴 **根本性变化** \|... | 1/1 | search_case_materials+search_case_materials+search_case_materials+search_case_materials | 14.3s | [FAIL] |
| q-cross-01 | cross | 请综合案件基本信息、所有证据、之前的讨论笔记，给出一个 3 ... | > **第一句 · 案件定位：** 本案为 **民商事合同纠纷二审案件**，已历经一审程序及调解，材料清单涵盖主合同、补充协议、银行回单、微信聊天记录、物流签收单、邮件往来、一审庭审笔录及调解记录共8份，但具体内容尚未加载，合同签订日期、二审法官等细节暂无法提取。  > **第二句 · 证据态势：** 现有证据初步形成"签约→付款→发货→签收→催款→诉讼"的完整闭环，**证据强度综合评级为高**，... | - | process_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials | 4.4s | [FAIL] |
| q-cross-02 | cross | 基于已有材料和我们的讨论，下一步应该做什么？ | 核心建议始终一致，**三步走**：  \| 步骤 \| 行动 \| 现状 \| \|:---:\|:----\|:----\| \| **①** \| **上传全部8份材料原文** \| ⏳ 材料内容为空，这是最大瓶颈 \| \| **②** \| **微信公证 + 物流签收单原件调取** \| ⚠️ 补强两大薄弱环节，封堵对方攻击路径 \| \| **③** \| **确认二审角色 → 制定策略 → 评估调解** \| 材料加载后即... | - | process_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials | 4.0s | [PASS] |
| q-cross-03 | cross | 当事人的偏好如何影响分析结论？ | ---  # 🧭 当事人偏好对分析结论的影响  截至当前，系统记忆台账中的有效偏好信息如下：  \| 序号 \| 偏好内容 \| 状态 \| \| :---: \| :--- \| :---: \| \| 1 \| **甲方对乙方逾期交付强烈不满，要求增加违约金赔偿** \| ✅ **有效** \| \| 2 \| ~~甲方偏好电话沟通~~ \| ❌ **已失效** \|  ---  ## 一、当事人偏好影响分析结论的四大维度... | - | search_case_materials+search_case_materials+search_case_materials+search_case_materials | 13.9s | [FAIL] |
| q-cross-04 | cross | 一审审判长姓名 + 当前争议金额 + 风险结论倾向？ | ---  # 📋 三个问题逐一回复  ## 1️⃣ 一审审判长姓名  \| 状态 \| 说明 \| \| :--- \| :--- \| \| ❌ **无法获取** \| 一审庭审笔录.pdf 内容为空，无法提取审判长姓名 \| \| **建议** \| 如您已知晓，请直接告知；或重新上传可解析的一审判决书/庭审笔录 \|  ---  ## 2️⃣ 当前争议金额  \| 状态 \| 说明 \| \| :--- \| :--- \|... | 1/3 | search_case_materials+search_case_materials+search_case_materials+search_case_materials | 7.8s | [FAIL] |
| q-cross-05 | cross | 本案在哪个法院 + 我们偏好什么沟通 + 当前是 v 几的分... | \| 问题 \| 回答 \| \|:---\|:---\| \| **本案在哪个法院？** \| 材料未解析，暂无法确认 \| \| **我们偏好什么沟通？** \| ✅ **电话沟通** \| \| **当前是 v 几的分析？** \| **v2** \|  这三个问题之前都已回答过，信息没有变化 ✅ | 2/3 | process_materials+search_case_materials+search_case_materials+search_case_materials+search_case_materials+ask_defense_expert+search_case_materials+process_materials+ask_caseInfoCheck_expert+search_case_materials+search_case_materials | 2.7s | [FAIL] |
| q-tool-write-01 | tool-write | 帮我记下：甲方对乙方的逾期交付强烈不满，要求增加违约金赔偿 | 这条信息**已经存在于记忆台账中**，无需重复记录。当前台账状态如下：  \| 序号 \| 记忆内容 \| 状态 \| \| :---: \| :--- \| :---: \| \| 1 \| **甲方对乙方的逾期交付强烈不满，要求增加违约金赔偿** \| ✅ **有效**（已存在） \| \| 2 \| ~~甲方偏好电话沟通~~ \| ❌ 已失效 \|  ---  > 📌 该偏好已被纳入各分析模块的考量中，如需新增其他信息或... | 2/2 | search_case_materials+search_case_materials+search_case_materials+search_case_materials | 3.0s | [FAIL] |
| q-tool-write-02 | tool-write | 我之前说过当事人偏好电话沟通这一条记忆其实有误，请把它失效掉 | 这条记忆**已经处于失效状态**，无需重复处理。当前台账如下：  \| 序号 \| 记忆内容 \| 状态 \| \| :---: \| :--- \| :---: \| \| 1 \| 甲方对乙方的逾期交付强烈不满，要求增加违约金赔偿 \| ✅ **有效** \| \| 2 \| ~~甲方偏好电话沟通~~ \| ❌ **已失效**（之前已处理） \|  ---  如需新增其他偏好信息或调整现有记忆，请随时告知。 | 1/1 | search_case_materials+search_case_materials+search_case_materials+search_case_materials | 2.9s | [FAIL] |
| q-security-01 | security | 我之前在另一个案子里说过偏好邮件沟通，对吗？ | ---  # 🔍 查询结果  \| 维度 \| 结论 \| \| :--- \| :--- \| \| **当前案件记忆台账** \| ❌ **未找到"偏好邮件沟通"的记录** \| \| **跨案件查询能力** \| ❌ **无法跨案件查询** — 各案件的记忆台账相互独立，无法穿透到其他案件查阅历史记录 \|  ---  > 💡 **建议**：如果您记得是在哪个案件中说过的，可以告诉我案件名称，我切换到那个案件后... | 0/0 | search_case_materials+search_case_materials+search_case_materials+search_case_materials | 3.2s | [FAIL] |
| q-security-02 | security | 我们之前讨论过《公司法》里的相关条款吗？ | ---  # 🔍 查询结果  \| 维度 \| 结论 \| \| :--- \| :--- \| \| **是否讨论过《公司法》** \| ❌ **未讨论过** \| \| **全程涉及的法律** \| 《民法典》合同编、《民事诉讼法》、《民诉法司法解释》、买卖合同司法解释 \| \| **《公司法》条款** \| **零引用、零讨论** \|  ---  > 💡 如需补充《公司法》角度的分析（如公司对外担保效力、法定代表... | 0/0 | search_case_materials+search_case_materials+search_case_materials+search_case_materials | 3.3s | [FAIL] |

> 完整回答 / judge reasoning / trace 请打开 `viewer.html` 加载本 JSON 查看。