# minimax-pdf

一个 Claude 技能，用于创建和编辑视觉效果精美的 PDF。  
三个路由。一个设计系统。令牌从内容分析流经每个渲染器。

## 快速开始

```bash
bash scripts/make.sh check   # 验证依赖
bash scripts/make.sh fix     # 自动安装缺失的依赖
bash scripts/make.sh demo    # → demo.pdf
```

---

## 路由 A：CREATE — 生成新的 PDF

```bash
bash scripts/make.sh run \
  --title   "Q3 策略评估" \
  --type    "proposal" \
  --author  "策略团队" \
  --date    "2025 年 10 月" \
  --content content.json \
  --out     report.pdf
```

**`--type` 选项：**

| 类型 | 调色板 | 封面样式 | Google 字体（封面） |
|---|---|---|---|
| `report` | 深墨，青色强调 | `fullbleed` | Playfair Display / IBM Plex Sans |
| `proposal` | 近黑色，琥珀色强调 | `split` | Syne / Nunito Sans |
| `resume` | 白色，海军蓝强调 | `typographic` | DM Serif Display / DM Sans |
| `portfolio` | 深紫色，珊瑚色强调 | `atmospheric` | Fraunces / Inter |
| `academic` | 温暖白色，海军蓝强调 | `typographic` | EB Garamond / Source Sans 3 |
| `general` | 深石板灰，蓝色强调 | `fullbleed` | Outfit / Outfit |
| `minimal` | 近白色，红色强调 | `minimal` | Cormorant Garamond / Jost |
| `stripe` | 深海军蓝，琥珀色强调 | `stripe` | Barlow Condensed / Barlow |
| `diagonal` | 深蓝色，青色强调 | `diagonal` | Montserrat / Montserrat |
| `frame` | 温暖米色，棕色强调 | `frame` | Cormorant / Crimson Pro |
| `editorial` | 白色，红色强调 | `editorial` | Bebas Neue / Libre Franklin |
| `magazine` | 温暖亚麻色，深海军蓝强调 | `magazine` | Playfair Display / EB Garamond |
| `darkroom` | 深海军蓝，钢蓝强调 | `darkroom` | Playfair Display / EB Garamond |
| `terminal` | 近黑色，霓虹绿强调 | `terminal` | Space Mono |
| `poster` | 白色，近黑色强调 | `poster` | Barlow Condensed / Courier Prime |

**content.json 块类型：**

```json
[
  {"type": "h1",      "text": "部分标题"},
  {"type": "h2",      "text": "小节"},
  {"type": "h3",      "text": "子小节"},
  {"type": "body",    "text": "段落。支持 <b>加粗</b> 和 <i>斜体</i>。"},
  {"type": "bullet",  "text": "无序列表项"},
  {"type": "numbered","text": "有序列表项 — 计数器在列表之间自动重置"},
  {"type": "callout", "text": "关键洞察或突出的发现"},
  {"type": "table",
    "headers": ["列 A", "列 B"],
    "rows":    [["a", "b"], ["c", "d"]]
  },
  {"type": "image",   "path": "chart.png", "caption": "图 1：可选标题"},
  {"type": "code",    "text": "def hello():\n    print('world')"},
  {"type": "math",    "text": "\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}", "label": "(1)"},
  {"type": "divider"},
  {"type": "caption", "text": "表 1：独立标题标签"},
  {"type": "pagebreak"},
  {"type": "spacer",  "pt": 16}
]
```

---

## 路由 B：FILL — 填充现有 PDF 中的表单字段

```bash
# 查看 PDF 有哪些字段
bash scripts/make.sh fill --input form.pdf --inspect

# 填充字段
bash scripts/make.sh fill \
  --input  form.pdf \
  --out    filled.pdf \
  --values '{"FirstName": "Jane", "Agree": "true", "Country": "US"}'

# 或从 JSON 文件
bash scripts/make.sh fill --input form.pdf --out filled.pdf --data values.json
```

字段值规则：
- `text` → 任何字符串
- `checkbox` → `"true"` 或 `"false"`
- `dropdown` → 必须与 `--inspect` 显示的选择值匹配
- `radio` → 必须与 `--inspect` 显示的单选值匹配

---

## 路由 C：REFORMAT — 对现有文档应用设计

```bash
bash scripts/make.sh reformat \
  --input  source.md \
  --title  "年度报告" \
  --type   "report" \
  --author "研究团队" \
  --out    output.pdf
```

支持的输入：`.md` `.txt` `.pdf` `.json`

---

## 架构

```
SKILL.md                      ← Claude 入口点，路由表
design/design.md              ← 美学系统（在创建/重新格式化前阅读）
scripts/
  make.sh                     ← 统一 CLI
  palette.py                  ← 元数据 → tokens.json       [CREATE, REFORMAT]
  cover.py                    ← tokens.json → cover.html     [CREATE, REFORMAT]
  render_cover.js             ← cover.html → cover.pdf       [CREATE, REFORMAT]
  render_body.py              ← tokens + content → body.pdf  [CREATE, REFORMAT]
  merge.py                    ← cover + body → final.pdf     [CREATE, REFORMAT]
  fill_inspect.py             ← PDF → 字段列表             [FILL]
  fill_write.py               ← PDF + values → 已填充 PDF    [FILL]
  reformat_parse.py           ← doc → content.json           [REFORMAT]
```

设计令牌（`tokens.json`）从 `palette.py` 流向每个渲染器 — 封面和正文在视觉上总是一致的。

## 依赖

| 工具 | 使用者 | 安装 |
|---|---|---|
| Python 3.9+ | 所有 `.py` 脚本 | 系统级 |
| `reportlab` | `render_body.py` | `pip install reportlab` |
| `pypdf` | 填充、合并、重新格式化 | `pip install pypdf` |
| Node.js 18+ | `render_cover.js` | 系统级 |
| `playwright` + Chromium | `render_cover.js` | `npm install -g playwright && npx playwright install chromium` |

## 许可证

MIT

## 文档类型

| `--type` | 气质 | 封面样式 | 封面字体 |
|---|---|---|---|
| `report` | 权威 | `fullbleed` | Playfair Display / IBM Plex Sans |
| `proposal` | 自信 | `split` | Syne / Nunito Sans |
| `resume` | 清洁 | `typographic` | DM Serif Display / DM Sans |
| `portfolio` | 表现力 | `atmospheric` | Fraunces / Inter |
| `academic` | 学术 | `typographic` | EB Garamond / Source Sans 3 |
| `general` | 中立 | `fullbleed` | Outfit |
| `minimal` | 克制 | `minimal` | Cormorant Garamond / Jost |
| `stripe` | 大胆 | `stripe` | Barlow Condensed / Barlow |
| `diagonal` | 动态 | `diagonal` | Montserrat |
| `frame` | 经典 | `frame` | Cormorant / Crimson Pro |
| `editorial` | 编辑 | `editorial` | Bebas Neue / Libre Franklin |

封面字体在渲染时通过 Google Fonts `@import` 加载 — 没有本地缓存。
正文页面总是通过 ReportLab 使用系统字体（Times / Helvetica）。

## content.json 模式

```json
[
  {"type": "h1",      "text": "部分标题"},
  {"type": "h2",      "text": "小节"},
  {"type": "h3",      "text": "子小节"},
  {"type": "body",    "text": "段落文本。支持 <b>加粗</b> 和 <i>斜体</i>。"},
  {"type": "bullet",  "text": "无序列表项"},
  {"type": "numbered","text": "有序列表项 — 自动编号，计数器在列表之间重置"},
  {"type": "callout", "text": "突出的洞察或关键发现"},
  {"type": "table",
    "headers": ["列 A", "列 B", "列 C"],
    "rows":    [["row1a", "row1b", "row1c"], ["row2a", "row2b", "row2c"]]
  },
  {"type": "image",   "path": "chart.png", "caption": "图 1：按季度销售"},
  {"type": "code",    "text": "SELECT * FROM users\nWHERE active = 1;"},
  {"type": "math",    "text": "\\sigma = \\sqrt{\\frac{1}{N}\\sum_{i=1}^N (x_i - \\mu)^2}", "label": "(2)"},
  {"type": "divider"},
  {"type": "caption", "text": "表 2：独立标签"},
  {"type": "pagebreak"},
  {"type": "spacer",  "pt": 16}
]
```

## 架构

```
SKILL.md                  ← Claude 入口点，仅路由
design/design.md          ← 美学系统（在运行任何脚本前阅读）
scripts/
  make.sh                 ← 统一 CLI：check / fix / run / demo
  palette.py              ← 内容元数据 → tokens.json
  cover.py                ← tokens.json → cover.html
  render_cover.js         ← cover.html → cover.pdf  (Playwright)
  render_body.py          ← tokens.json + content.json → body.pdf  (ReportLab)
  merge.py                ← cover.pdf + body.pdf → final.pdf + QA 报告
```

设计令牌（颜色、排版、间距）由 `palette.py` 写入一次，并由所有下游脚本使用。这保证了封面和正文之间的视觉一致性，无需任何手动协调。

## 依赖

| 工具 | 用途 | 安装 |
|---|---|---|
| Python 3.9+ | palette、cover、render_body、merge | 系统级 |
| `reportlab` | 正文页面渲染 | `pip install reportlab` |
| `pypdf` | 合并 PDF | `pip install pypdf` |
| Node.js 18+ | 封面渲染 | 系统级 |
| `playwright` | 封面的无头 Chromium | `npm install -g playwright && npx playwright install chromium` |

运行 `bash scripts/make.sh check` 一次性验证所有内容。  
运行 `bash scripts/make.sh fix` 自动安装缺失的内容。

## 许可证

MIT
