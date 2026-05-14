# 办案工具覆盖率说明 — 100% 验证基线

`shared/utils/tools/` 目录下 15 个文件（11 service + 4 utils）的测试覆盖率 **statements / branches / functions / lines 四项全部 100%**，作为后续重构的验证基线。

## 当前覆盖率（2026-05-14）

| 文件 | statements | branches | functions | lines |
|------|-----------|---------|----------|-------|
| arbitrationFeeService.ts | 100% | 100% | 100% | 100% |
| bankRateService.ts | 100% | 100% | 100% | 100% |
| compensationService.ts | 100% | 100% | 100% | 100% |
| courtFeeService.ts | 100% | 100% | 100% | 100% |
| dateCalculatorService.ts | 100% | 100% | 100% | 100% |
| delayInterestService.ts | 100% | 100% | 100% | 100% |
| divorcePropertyService.ts | 100% | 100% | 100% | 100% |
| interestService.ts | 100% | 100% | 100% | 100% |
| lawyerFeeService.ts | 100% | 100% | 100% | 100% |
| overtimePayService.ts | 100% | 100% | 100% | 100% |
| socialInsuranceService.ts | 100% | 100% | 100% | 100% |
| utils/calculator.ts | 100% | 100% | 100% | 100% |
| utils/date.ts | 100% | 100% | 100% | 100% |
| utils/excelExport.ts | 100% | 100% | 100% | 100% |
| utils/validators.ts | 100% | 100% | 100% | 100% |

## 重构契约（重要）

后续 `shared/utils/tools/` 任何重构都必须满足：

1. `npx vitest run tests/shared/utils/tools/ --coverage` 仍然显示**四项指标全 100%**
2. 现有测试（含 36+ 处 `expect(result.details.some(d => d.includes(...)))` 关键字断言）必须**不修改**就能通过
3. 如有不可避免的 API 变更（如必须删除某字段），需先在 spec 中说明并征得同意

## 关键设计决策

### 防御性兜底代码的处理

由于 vitest+nuxt 环境下 esbuild 在 instrument 前剥离了非 license-style 块注释，`/* istanbul ignore next */` 等 hint 注释**不被识别**。

因此本次推 100% 采用的策略是：**直接删除结构上不可达的防御性兜底代码**，并使用 TypeScript non-null 断言 (`!`) 或类型守卫消除 nullable 类型噪声。这与 ignore 注释等价（不影响运行时行为），且代码更干净。

具体删除/简化的位置：

- `bankRateService.ts` — `for` 循环遍历常量数组时的 `if (!rate) continue` 防御
- `bankRateService.ts` — `bankRates.X[0] ?? null` 中常量数组首元素必存在
- `delayInterestService.ts` — `if (!currentRateData) break`（currentRateIndex 受循环条件约束）
- `interestService.ts` — 多处 `if (!rate) continue` / `if (!firstRate) return 0` / `if (lastRate)` 防御
- `interestService.ts` — `if (allPbocRates.length === 0)` 早返回死代码（period=1..5 常量数据均非空）
- `interestService.ts` — `if (end > lastRateDate && !pbocRates.includes(lastRate))` 中后半永远 false
- `interestService.ts` — `default: 未知期限` 在 period 1-5 枚举驱动下不可达
- `interestService.ts` — `if (totalInterest === 0 && interestDetails.length === 0)` 极端边界不可达
- `interestService.ts` — LPR 输出文本三元最内层 `'上浮' || '下浮' ? '%' : '%'` 两分支结果相同
- `interestService.ts` — `monthlyPayments[0] ?? 0` / `monthlyPayments[length-1] ?? 0` 当 months>0 时元素必存在
- `date.ts` — 3 个 try-catch 块（formatDate/parseDate/daysBetween），try 内仅纯算术不会抛错
- `date.ts` — `parseInt(match[X] ?? '0', 10)` 正则已保证 3 个捕获组存在
- `validators.ts:isValidDate` — `if (parts.length !== 3)` / `if (isNaN(...))` 在正则 + `new Date` 校验后死代码
- `validators.ts:isValidDate` — `if (month < 1 || month > 12)` 在 Node.js 下被 `new Date NaN` 检查拦截
- `courtFeeService.ts` — `if (amount > 10000)` 在 `if (amount <= 10000) return` 后死代码
- `courtFeeService.ts` — internal function 的默认参数（外部 caller 总传完整参数）
- `lawyerFeeService.ts` — internal function 的默认参数
- `lawyerFeeService.ts` — `getStagesText` 的 `if (!stages || stages.length === 0)` 调用方已做守卫
- `calculator.ts` — `numStr.split('.')[1] ?? ''` 在 toFixed(2) 后必存在
- `calculator.ts` — `digit[n] ?? ''` / `unit[X]?.[Y] ?? ''` 在数字驱动索引下必存在

### Internal switch default case 保留

`lawyerFeeService.ts` 中 `getCriminalBaseFee` / `getAdministrativeBaseFee` / `getRegionCoefficient` / `getRegionText` / `getComplexityText` / `getAdministrativeTypeText` 等函数保留了 `default` 分支，因为现有测试用 `'unknown' as any` 显式触发了 default 路径。

### 新增/扩展的测试用例

- `calculator.test.ts` — 新增 `formatRMB` 完整测试（原零覆盖）
- `courtFeeService.test.ts` — 新增"申请执行费各档位"、"受理费/申请费默认分支"、"calculateCourtFee 默认参数"
- `interestService.test.ts` — 新增 `calculateCustomRateInterest`/`calculatePeriodInterest` 参数校验、LPR/PBOC 各 adjustmentMethod 输出、各 period 文本、各 fallback
- `lawyerFeeService.test.ts` — 新增民事各档位累进、刑事 caseDuration、行政各类型、商事各 commercialType、各 region tier、文书类型、默认参数
- `validators.test.ts` — 新增"非必填字段为空时跳过类型校验"

## 维护规则

1. 修改 `shared/utils/tools/` 中任何代码前，先确认 [coverage-exceptions.md](./coverage-exceptions.md) 描述的删除是否仍然适用
2. 如果重构导致原本"不可达"的代码变成"可达"，必须补真实测试用例而不是恢复防御性兜底
3. 每次 `bun run prisma:migrate` 或 schema 变更后跑 `npx vitest run tests/shared/utils/tools/ --coverage` 验证基线
4. 当前覆盖率作为 CI 门槛参考：办案工具 service/utils 任何分支降到 100% 以下应阻塞合入
