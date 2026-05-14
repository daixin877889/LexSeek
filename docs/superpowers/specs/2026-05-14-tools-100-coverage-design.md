# 办案工具 100% 测试覆盖率 — 设计文档

## 背景

办案工具模块 (`shared/utils/tools/`) 当前测试覆盖率约 88.51% (branches)，存在前置审查发现的多处冗余实现（LPR/央行利率双份数据、按日期查利率 4 处实现、跨利率档分段利息 3-5 处实现、金额分档累进 4 处实现等）。

按用户要求，**先把 100% 覆盖率作为后续重构的"验证基线"建立起来**，重构方案后续讨论，且必须能通过这套测试。

## 范围

11 个 service + 4 个 utils，共 15 个文件：

```
shared/utils/tools/
├── arbitrationFeeService.ts       (已 100%)
├── bankRateService.ts             (差 ~3 行)
├── compensationService.ts         (已 100%)
├── courtFeeService.ts             (差 ~18 行 业务可达)
├── dateCalculatorService.ts       (已 100%)
├── delayInterestService.ts        (差 2 行 防御性)
├── divorcePropertyService.ts      (已 100%)
├── interestService.ts             (差 ~20 行 混合)
├── lawyerFeeService.ts            (差 ~22 行 业务可达)
├── overtimePayService.ts          (已 100%)
├── socialInsuranceService.ts      (已 100%)
└── utils/
    ├── calculator.ts              (差 formatRMB 整函数 + 5 行)
    ├── date.ts                    (差 6 行 防御性 catch)
    ├── excelExport.ts             (差 旧格式解析分支)
    └── validators.ts              (差 3 行)
```

**不在范围内**：UI 页面（.vue）、imageWatermarkService.ts（图片水印工具非计算器）。

## 关键决策

| 决策点 | 选择 |
|--------|------|
| 防御性兜底分支处理 | 用 `/* istanbul ignore next */` 注释标记 |
| 测试断言粒度 | 保持现状（含 36 处 `details.some(d => d.includes(...))`） |
| 范围 | 15 个文件全部推到 100% |
| 重构兼容性 | 重构方案必须想办法兼容这套测试，不允许反过来改测试 |

## 100% 覆盖率定义

四项硬性指标全部 100%：
- statements
- branches
- functions
- lines

**`/* istanbul ignore next */`** 标记的分支不计入覆盖率分母，等价于"已覆盖"。

## 未覆盖代码分类

### A. 防御性兜底（用 istanbul ignore，~22 行）

| 文件 | 行号 | 内容 |
|------|------|------|
| bankRateService.ts | 135 | `?? null` LPR 数组兜底 |
| bankRateService.ts | 163 | `?? null` benchmark 数组兜底 |
| bankRateService.ts | 191 | `?? null` loan 数组兜底 |
| delayInterestService.ts | 190 | `if (!currentRateData) break` 防御性 |
| delayInterestService.ts | 303 | 同上 |
| interestService.ts | 306, 315, 326-328 | LPR 空数组防御 |
| interestService.ts | 890, 903, 978 | 错误处理分支 |
| interestService.ts | 995 | `default: 未知期限` |
| date.ts | 37, 38 | formatDate catch |
| date.ts | 84, 85 | parseDate catch |
| date.ts | 119, 120 | daysBetween catch |

理由：这些分支在合法的业务调用下结构上不可达（数据由模块内常量驱动，或前面的 if 已经做了等价校验）。

### B. 业务可达分支（必须补真实测试，~60 行）

| 文件 | 行号 | 业务场景 |
|------|------|----------|
| courtFeeService.ts | 115-116 | 人格权诽谤案件 (defamation) |
| courtFeeService.ts | 185-186 | 海事行政案件 |
| courtFeeService.ts | 295, 302-307, 327-338 | 申请执行费各金额档位 |
| interestService.ts | 376-377, 479-480 | 利息计算参数边界 |
| interestService.ts | 684-685, 696, 727, 867-868, 936 | LPR/PBOC 计算边界 |
| lawyerFeeService.ts | 172-249 | 律师费各档位 + caseType 组合 |
| lawyerFeeService.ts | 430, 436, 454, 472, 488, 535 | 律师费风险代理 / 政府指导 |
| validators.ts | 90, 97, 98 | isValidDate / isValidDateRange 边界 |
| calculator.ts | formatRMB 整函数 (line 31) | **零覆盖必补** |
| excelExport.ts | 旧格式解析分支 | 旧 details 反序列化 |

## 实施步骤

**阶段 1 · 防御性分支批注（30 分钟）**
1. 按 A 表逐处加 `/* istanbul ignore next */` 或 `/* istanbul ignore else */`
2. 每处注释旁附中文短说明（重构时易判断）
3. 跑 `npx vitest run tests/shared/utils/tools/` 确保 486 个用例全绿

**阶段 2 · 按文件补业务测试（重点工作）**
- 2.1 courtFeeService（最复杂）
- 2.2 interestService
- 2.3 lawyerFeeService
- 2.4 validators
- 2.5 calculator.formatRMB
- 2.6 excelExport

每补完一个文件，跑该文件覆盖率确认到 100%。

**阶段 3 · 全量覆盖率验证**

```bash
npx vitest run tests/shared/utils/tools/ --coverage
```

预期：所有目标文件四项指标显示 100%。

**阶段 4 · 更新 [coverage-exceptions.md](tests/shared/utils/tools/coverage-exceptions.md)**

把"防御性 ignore"和"已补测试"两部分整理写入，作为后续维护和重构时的参考。

**阶段 5 · typecheck + 提交**

```bash
bun run typecheck
git commit -m "test(tools): 办案工具 service/utils 覆盖率推到 100%"
```

## 约束（重构验证基线契约）

1. **不修改 service/utils 源码的业务逻辑**，只加 istanbul 注释 + 源码可执行行不变
2. **保留全部 36 处 `details: string[]` 关键字断言**，重构方案必须兼容
3. **不动 UI 页面（Vue 文件）**
4. **测试断言风格沿用现有**：结构化字段精确比对，文本用关键字匹配
5. **重构后这套测试必须仍能 100% 通过**——这是设计这份基线的根本目的

## 后续

重构方案设计将基于这份测试基线开展，作为独立的下游 spec：
- LPR / 央行利率单一数据源化
- 抽 `applyBrackets()` 替换分档累进 if-else
- 抽 `calculateSegmentedInterest()` 替换跨利率档分段
- 抽 `findRateForDate()` 替换 4 处按日期查利率
- 删除 [delayInterestService.ts:267](shared/utils/tools/delayInterestService.ts:267) 硬编码 LPR=3.85 兜底
- UI 层抽 PageHeader / DateInput / ResultCard
- dayjs 体系迁移

这些都在测试基线建立完成后另起 spec 讨论。
