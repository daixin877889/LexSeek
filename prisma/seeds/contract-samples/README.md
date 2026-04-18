# 合同审查样本 .docx

本目录存放合同审查 M2~M5 的测试样本。M1 仅作为 fixture，不进 `seed.ts` 生产逻辑。

| 文件 | 合同类型 |
|---|---|
| labor.docx | 劳动合同 |
| lease.docx | 房屋租赁合同 |
| sale.docx | 买卖合同 |
| service.docx | 服务合同 |
| loan.docx | 借款合同 |

## 约束

1. 全部为脱敏虚构样本，无真实客户信息
2. 明示 `甲方：...` / `乙方：...`（partyDetector 正则路径依赖）
3. 无 `{{占位符}}`
4. 供 M1 冒烟 + M2 docx 子模块单测 + M3 agent 集成测试 + M5 E2E 复用
