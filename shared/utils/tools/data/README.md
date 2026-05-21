# shared/utils/tools/data — 办案工具数据层

## 文件职责

| 文件 | 数据类别 | 维护渠道 |
|------|---------|---------|
| lpr.ts | LPR 利率 | 管理后台 /admin/rates/lpr |
| pbocDepositRates.ts | 央行存款基准利率 | 管理后台 /admin/rates/pboc-deposit |
| pbocLoanRates.ts | 央行贷款基准利率 | 管理后台 /admin/rates/pboc-loan |
| feeBrackets.ts | 诉讼费/律师费/仲裁费 档位 | 修改源代码 + 重新部署（法规硬编码） |
| socialInsuranceRates.ts | 5 险 1 金 默认比例 | 修改源代码（各地比例不同，工具仅作参考） |
| overtimeRules.ts | 加班倍率 | 修改源代码（劳动法硬编码） |

## 缓存与刷新机制（仅 LPR / PBOC 三类利率）

- 模块级 `let runtimeCache` 持有当前数据
- 启动时 `server/plugins/rates-cache.ts` 调 service 拉 DB 数据 → setXxxRates
- 客户端通过 `useToolsRates` composable 首次进入工具页时拉取
- 管理后台 CRUD 改库后 service 内部自动 refresh
