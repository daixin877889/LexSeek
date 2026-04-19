# 合同审查 M5 手动验收脚本

> **背景**：chrome-devtools MCP 自 M4 起断开，Playwright 未配置 `playwright.config.ts` 与 browsers，为避免 scope creep，M5 E2E 采用**人工回归**退路。本文档是每次 M5 相关 PR 合并前必跑的手动验收路径，覆盖 spec §12.3 两个 E2E 必跑场景。
> **自动化补齐**登记在 plan "本 plan 不交付（M6+）"。

## 前提

- 开发数据库已启动，`prisma/seed.ts` 已跑（`bun run prisma:generate && bun run prisma:push`）
- `bun dev` 启动（默认 http://localhost:3000）
- 登录任一**非超管**测试账号（确保走用户端 owner-only 校验路径）
- 浏览器侧打开 DevTools → Network 面板（方便观察 SSE / PATCH / rebuild-docx 请求）

---

## 场景 1：粘贴文本 → 审查 → 下载（对应 spec §12.3 粘贴路径）

样本合同文本（直接复制使用，约 500 字，已含出借人 / 借款人 / 利率 / 违约等关键要素，便于 AI 识别立场）：

```
借款合同

出借人：张三（身份证：110101199001010011）
借款人：李四（身份证：110101199202020022）

经双方友好协商，就借款事宜达成如下协议：

一、借款金额：人民币壹拾万元整（¥100,000.00）。
二、借款用途：借款人用于个人周转，不得用于非法活动。
三、借款期限：自 2026 年 4 月 20 日起至 2027 年 4 月 19 日止，共 12 个月。
四、利率：年利率 24%，按月支付利息，本金到期一次性偿还。
五、违约责任：借款人逾期还款的，每日按未还金额的 1% 计算违约金，直至清偿完毕。
六、争议解决：本合同如发生争议，由出借人所在地人民法院管辖。
七、本合同自双方签字之日起生效，一式两份，双方各执一份。

出借人（签字）：                 借款人（签字）：
日期：                            日期：
```

| 步骤 | 操作 | 预期 |
|---|---|---|
| 1 | 浏览器访问 `/dashboard/assistant/contract` | 页面加载，显示"提交屏"（`ContractSourceInput` 的 textarea + 上传区），placeholder 含"粘贴合同全文或上传 .docx" |
| 2 | 将上方样本文本粘贴进 textarea | 文本正常显示；底部"开始审查"按钮变为可点击状态 |
| 3 | 点击"开始审查" | 页面切换到审查屏；顶部状态条显示 loading/状态文案（如"AI 正在识别甲乙方..."） |
| 4 | 等待立场 Dialog 弹出（≤ 30 s） | 标题"选择审查立场"；甲方 Input 显示"张三"（或出借人），乙方 Input 显示"李四"（或借款人）。**若识别失败则 Input 空白**，手填"张三""李四"兜底 |
| 5 | 选中"甲方"立场（对应出借人） | "确认"按钮变为可点击 |
| 6 | 点击"确认" | Dialog 关闭；顶部状态条切换为"AI 正在逐条审查合同条款..."；Network 中可见 `PATCH /api/v1/assistant/contract/reviews/:id/stance` |
| 7 | 等待状态条变"审查完成"（≤ 120 s） | 左侧 docx-preview 区渲染合同全文 + 批注标记（红色竖线 / 右栏批注气泡）；右侧 `RiskListPanel` 出现 ≥ 3 条 Risk 卡片（按 clauseIndex 升序排列），等级标签"高/中/低"可见 |
| 8 | 点击任一风险卡片 | 展开显示"条款原文 / 建议条款 / 法律依据 / 条款分析 / 法律风险 / 修改建议"五模块内容 |
| 9 | 点击底部"下载批注 Word" | 浏览器下载 `.docx` 文件；状态码 200；文件大小 > 10 KB |
| 10 | 用 Microsoft Word（或 WPS / LibreOffice）打开下载文件 | 合同正文完整可见；右栏批注气泡数量 ≈ 风险条数；打开无格式崩坏 / XML 解析错误 |

**验收通过标准**：所有步骤符合预期。任何一步偏离预期 → 阻断 PR 合并，登记 Issue。

---

## 场景 2：上传 .docx → 识别失败 → 编辑 → 重生（对应 spec §12.3 上传路径）

准备：桌面放一份劳动合同 `.docx`（≤ 20 MB，建议主体是"公司 A 与员工 B"，避免模板化甲乙方命名，以便触发 AI 识别失败）。也可以用 `prisma/seeds/contract-samples/` 下的劳动合同样本（如有）。

| 步骤 | 操作 | 预期 |
|---|---|---|
| 1 | 访问 `/dashboard/assistant/contract`（干净会话，URL 无 `?reviewId=`） | 回到提交屏 |
| 2 | 点击上传区或拖入劳动合同 `.docx` | 文件被接受；预览进入"已选文件"态 |
| 3 | 点击"开始审查" | 切到审查屏；Network 中可见 `POST /api/v1/assistant/contract/reviews`（上传 → 解析 → 识别） |
| 4 | 等立场 Dialog 弹出（≤ 30 s） | **预期甲方 / 乙方 Input 为空白**（AI 识别失败兜底路径）。若 AI 命中则人工清空 |
| 5 | 手填：甲方 Input = "XX科技有限公司"，乙方 Input = "员工本人" | Input 接受输入；"确认"按钮可点击 |
| 6 | 选中"乙方"立场，点击"确认" | Dialog 关闭；进入审查中态 |
| 7 | 等状态条变"审查完成"（≤ 120 s） | 右侧 `RiskListPanel` ≥ 3 条 Risk |
| 8 | 点击任一风险卡片底部"编辑" | 弹出 `RiskEditDialog`；所有字段（category / level / clauseText / analysis / risk / suggestion / suggestedClauseText / legalBasis）可编辑 |
| 9 | 将 level 从"中"改为"高"，点击"保存" | Dialog 关闭；该卡片的等级标签变红色"高"；顶部出现脏标记提示（或"重新生成批注 Word"按钮变为启用态） |
| 10 | （可选）点击另一条"删除" → AlertDialog 二次确认 → "删除" | 该卡片从列表移除；剩余条数 −1；Network 中可见 `PATCH /api/v1/assistant/contract/reviews/:id`（body 仅含 `risks`，无 `summary`） |
| 11 | 点击"新增风险" | 弹出 Dialog（空白表单）；填写 category / clauseIndex / clauseText / analysis / risk / suggestion / level='medium'；保存 | 列表新增 1 条卡片，按 clauseIndex 升序排到正确位置 |
| 12 | 点击"重新生成批注 Word" | 按钮变为"批注生成中..."并禁用；顶部出现"批注正在重新生成..."条状提示；所有编辑/新增/删除按钮禁用 |
| 13 | 等待（≤ 60 s）直至重生完成 | 条状提示消失；左侧 docx-preview 刷新为新版批注；"下载批注 Word"按钮重新可用；Network 中可见 `POST /api/v1/assistant/contract/reviews/:id/rebuild-docx` 返回 200 |
| 14 | 点击"下载批注 Word" | 下载新 `.docx`；文件名 / ETag 与场景 1 下载的**不同**（OSS 新对象） |
| 15 | Word 打开新文件 | 被编辑的那条风险对应的批注内容已更新；被删除的条目不再出现；新增的条目批注正确插入 |

**验收通过标准**：所有步骤符合预期。

---

## 负路径抽查（冒烟）

- **放弃立场**：场景 1 步骤 4 Dialog 弹出后点"取消" → 整个审查回滚，页面回到提交屏；再次提交同文本可重新走流程
- **非 owner 访问**：场景 1 完成后复制 URL `?reviewId=xxx` → 退出登录换另一账号访问 → 应返回 403（后端 owner-only 校验）
- **PATCH 拒绝 summary**：浏览器 DevTools Console 里执行 `fetch('/api/v1/assistant/contract/reviews/<id>', { method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ summary: 'hack' })}).then(r=>r.json()).then(console.log)` → 返回 400，message 含"summary"

---

## 验收覆盖 → spec §12.3 映射

| spec §12.3 要求 | 本文档步骤 |
|---|---|
| 粘贴 1000 字借款合同 | 场景 1 步骤 2 |
| AI 识别出借人/借款人 | 场景 1 步骤 4 |
| 选出借人立场 | 场景 1 步骤 5-6 |
| 生成风险清单 | 场景 1 步骤 7 |
| 下载批注 Word + 验证有效 | 场景 1 步骤 9-10 |
| 上传劳动合同 | 场景 2 步骤 2-3 |
| AI 识别失败 → 空白 Input 手填 | 场景 2 步骤 4-5 |
| 选乙方立场 | 场景 2 步骤 6 |
| 编辑某条 Risk level | 场景 2 步骤 8-9 |
| 重新生成批注 Word | 场景 2 步骤 12-13 |
| 下载新文件 | 场景 2 步骤 14-15 |

---

## 问题上报

任一步骤失败时：
1. 保存 Network 面板 HAR 与浏览器 Console 截图
2. 记录失败步骤编号 + 实际观察结果
3. 在 Issue 区登记（标题前缀：`[contract-m5-manual-validation]`）
4. 阻断当前 PR 合并直至复查修复
