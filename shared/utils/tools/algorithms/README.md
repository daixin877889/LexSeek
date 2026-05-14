# algorithms — 办案工具纯函数算法层

本目录包含 4 个与业务领域无关的纯函数算法，供各 service 按需组合调用。

## 模块一览

| 文件 | 导出 | 用途 |
|------|------|------|
| `applyBrackets.ts` | `applyBrackets(amount, brackets)` | 通用阶梯累进公式（诉讼费 / 律师费 / 仲裁费） |
| `calculateSegmentedInterest.ts` | `calculateSegmentedInterest(input)` | 分段利息计算（跨利率调整点自动拆段） |
| `findRateForDate.ts` | `findRateForDate(rates, target)` | 按日期查利率（降序数组二分语义查找） |
| `roundToCents.ts` | `roundToCents(value)` | 四舍五入到分（Decimal.js 避免浮点误差） |
| `index.ts` | 全部重导出 | 统一出口，`import { ... } from './algorithms'` |

## 使用约定

1. **从 index 导入**：业务 service 统一 `import { applyBrackets, roundToCents } from './algorithms'`，不直接引用子文件。
2. **纯函数**：算法层不依赖外部状态、数据库、环境变量，仅依赖入参。
3. **数组顺序**：
   - `applyBrackets` 的 `brackets` 须按 `upper` 升序，末档 `upper=Infinity`。
   - `findRateForDate` 的 `rates` 须按 `date` **降序**（新→旧）排列。
4. **精度**：涉及金额输出时在 service 层统一用 `roundToCents` 收尾，中间计算过程保持浮点精度。

## 当前调用方

| service | 使用的算法 |
|---------|-----------|
| `courtFeeService.ts` | `applyBrackets`（财产案件受理费） |
| `lawyerFeeService.ts` | `applyBrackets`（民事案件律师费阶梯） |
| `arbitrationFeeService.ts` | `applyBrackets`（基础仲裁费） |
| `interestService.ts` | `roundToCents`（利息收尾精度） |
| `delayInterestService.ts` | `roundToCents`（迟延履行利息收尾精度） |
