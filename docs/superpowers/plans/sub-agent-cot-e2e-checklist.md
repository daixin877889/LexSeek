# SubAgent Chain of Thought · E2E 验收清单

## 路径 A · 单子 Agent 流式 + 结束 1s 自动收起
1. 进入小索案件对话
2. 提问触发一次 `ask_*_expert` 调用
3. 卡片立即出现且自动展开
4. active Step 的 description 随 token 增长（~30ms 刷新，~33 fps）
5. Agent 结束 → 卡片 1 秒后自动收起，下方外部 ToolMessage 完整结论可见
6. 手动点开折叠卡片，各 Step 完整（思考 / 分析 / 调用工具 / 得出结论）

## 路径 B · 用户中途手动展开 → 不被 auto-close
1. 触发子 Agent 调用
2. Agent 结束前 500ms 手动点一下卡片（观察当前展开态）
3. 继续等待 2 秒
4. 卡片应保持用户手动选择的状态，不被 1s timer 强制收起

## 路径 C · 刷新页面后历史回放
1. 在子 Agent 已结束的会话里刷新浏览器
2. 主列表渲染时，子 Agent 卡片（折叠态）出现在对应位置
3. 点开 → 完整思考链可见
4. 网络面板验证：chat.post 响应 body 含 `subThreads` 字段

## 虚拟列表高度回归（关键）
1. 在有多条对话的案件里，滚动到有 ChainOfThought 卡片的位置
2. 手动展开/收起，观察：
   - 卡片高度变化时列表不抖动
   - 上方/下方消息不错位
   - 滚动位置稳定
3. 连续切换多次，确认无高度缓存错位

## 深浅模式 + 主题
1. 默认 Zinc 主题：浅色 / 深色下卡片、Step 图标、徽章均清晰
2. 切到 Violet / Rose / Blue / Green / Orange / Red / Yellow 主题各看一遍
3. 所有状态下语义色保持：思考 violet / 分析 blue / 调用 amber / 结论 emerald

## 失败态
1. 手工制造子 Agent 失败（短时间内超时或抛异常）
2. Header 出现红色"失败：xxx"徽章
3. 最后 active Step 翻 text-destructive 红字
4. 卡片不自动收起，允许用户手动收起

## 并发子 Agent
1. 一个主 Agent 回复里包含多个 ask_*_expert tool_call（顺序或并行）
2. 每个子 Agent 卡片独立展开/收起
3. 同时流式时不卡顿（30fps+）
