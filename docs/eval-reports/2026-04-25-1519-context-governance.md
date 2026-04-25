# 上下文机制评测报告

- 跑批时间：2026-04-25T15:19:40+08:00
- Commit：227975aa
- 总耗时：103.7s
- **结论：[FAIL]**（CRITICAL 失败 6 项）

## 分级摘要
| 级别 | 总数 | 通过 | 未通过 |
|---|---|---|---|
| CRITICAL | 14 | 8 | 6 [FAIL] |
| WARN | 10 | 5 | 5 [WARN] |

## CRITICAL 未通过项
- cacheHitRate
- toolCallAccuracy
- scenarioPassRate
- versionChainCorrect
- sec-archived-write-memory
- sec-archived-update-memory

## cost 指标
| 指标 | 值 | 阈值 | 级别 | 状态 |
|---|---|---|---|---|
| systemPromptTokensAvg | 893 | < 4000 | WARN | [PASS] |
| totalPromptTokensAvg | 0 | < 6000 | WARN | [PASS] |
| cacheHitRate | 0 | >= 0.6 | CRITICAL | [FAIL] |
| anthropicCacheStructureOk | false | > 0 | WARN | [FAIL] |
| openaiCacheStructureOk | false | > 0 | WARN | [FAIL] |
| memoryRecallLatencyP95 | 0 | < 500ms | WARN | [PASS] |
| analysisSummaryLatencyP95 | 0 | < 3000ms | WARN | [PASS] |

## quality 指标
| 指标 | 值 | 阈值 | 级别 | 状态 |
|---|---|---|---|---|
| qualityScore | 0.52 | >= 4.0 | WARN | [FAIL] |
| factsHitRate | 0 | >= 0.8 | WARN | [FAIL] |
| hallucinationRate | 0 | <= 0.05 | CRITICAL | [PASS] |

## task 指标
| 指标 | 值 | 阈值 | 级别 | 状态 |
|---|---|---|---|---|
| toolCallAccuracy | 0 | >= 0.8 | CRITICAL | [FAIL] |
| scenarioPassRate | 0.069 | >= 0.9 | CRITICAL | [FAIL] |

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
| sec-cross-case-leak | true | pass | CRITICAL | [PASS] |
| sec-archived-updateCase | true | pass | CRITICAL | [PASS] |
| sec-archived-write-memory | false | pass | CRITICAL | [FAIL] |
| sec-archived-update-memory | false | pass | CRITICAL | [FAIL] |
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
| q-profile-01 | profile | 本案的一审法官是谁？ |  | 0/1 | - | 0.1s | [FAIL] |
| q-profile-02 | profile | 本案的二审法院是哪个？ |  | 0/1 | - | 0.1s | [FAIL] |
| q-profile-03 | profile | 一审案号和二审案号分别是？ |  | 0/2 | - | 0.1s | [FAIL] |
| q-profile-04 | profile | 本案现在处于哪个诉讼阶段？ |  | 0/1 | - | 0.0s | [FAIL] |
| q-profile-05 | profile | 本案的二审法官是谁？ |  | 0/1 | - | 0.0s | [FAIL] |
| q-material-01 | material | 本案有多少份材料？ |  | 0/1 | - | 0.0s | [FAIL] |
| q-material-02 | material | 甲方支付了多少首付款？ |  | 0/2 | - | 0.0s | [FAIL] |
| q-material-03 | material | 主合同的签订日期是？ |  | 0/1 | - | 0.0s | [FAIL] |
| q-material-04 | material | 物流签收单的核心信息？ |  | 0/1 | - | 0.0s | [FAIL] |
| q-material-05 | material | 请综合评估这些证据材料的整体证明力 |  | - | - | 0.0s | [FAIL] |
| q-memory-01 | memory | 我们之前确定的争议金额是多少？ |  | 0/2 | - | 0.1s | [FAIL] |
| q-memory-02 | memory | 当事人偏好什么样的沟通方式？ |  | 0/1 | - | 0.0s | [FAIL] |
| q-memory-03 | memory | 我们之前讨论过哪些法条？ |  | 0/1 | - | 0.0s | [FAIL] |
| q-memory-04 | memory | 当事人对结案时间有什么期望？ |  | 0/2 | - | 0.0s | [FAIL] |
| q-memory-05 | memory | 我们对乙方偿付能力的评估结论是？ |  | 0/1 | - | 0.0s | [FAIL] |
| q-analysis-01 | analysis | 风险分析的当前结论倾向哪个方案？ |  | 0/1 | - | 0.0s | [FAIL] |
| q-analysis-02 | analysis | 证据分析里证据强度评估是什么？ |  | 0/1 | - | 0.0s | [FAIL] |
| q-analysis-03 | analysis | 初步分析是第几版？ |  | 0/1 | - | 0.0s | [FAIL] |
| q-analysis-04 | analysis | 请总结当前所有分析模块的核心结论 |  | - | - | 0.0s | [FAIL] |
| q-analysis-05 | analysis | 版本切换前后这个模块的结论有什么变化？（注：本提问由 run... |  | 0/1 | - | 0.1s | [FAIL] |
| q-cross-01 | cross | 请综合案件基本信息、所有证据、之前的讨论笔记，给出一个 3 ... |  | - | - | 0.0s | [FAIL] |
| q-cross-02 | cross | 基于已有材料和我们的讨论，下一步应该做什么？ |  | - | - | 0.0s | [FAIL] |
| q-cross-03 | cross | 当事人的偏好如何影响分析结论？ |  | - | - | 0.1s | [FAIL] |
| q-cross-04 | cross | 一审审判长姓名 + 当前争议金额 + 风险结论倾向？ |  | 0/3 | - | 0.1s | [FAIL] |
| q-cross-05 | cross | 本案在哪个法院 + 我们偏好什么沟通 + 当前是 v 几的分... |  | 0/3 | - | 0.0s | [FAIL] |
| q-tool-write-01 | tool-write | 帮我记下：甲方对乙方的逾期交付强烈不满，要求增加违约金赔偿 |  | 0/2 | - | 0.0s | [FAIL] |
| q-tool-write-02 | tool-write | 我之前说过当事人偏好电话沟通这一条记忆其实有误，请把它失效掉 |  | 0/1 | - | 0.0s | [FAIL] |
| q-security-01 | security | 我之前在另一个案子里说过偏好邮件沟通，对吗？ |  | 0/0 | - | 0.0s | [PASS] |
| q-security-02 | security | 我们之前讨论过《公司法》里的相关条款吗？ |  | 0/0 | - | 0.0s | [PASS] |

> 完整回答 / judge reasoning / trace 请打开 `viewer.html` 加载本 JSON 查看。