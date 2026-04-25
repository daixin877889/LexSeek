---
name: minimax-pdf
description: >
  当 PDF 需要考虑视觉效果和品牌设计时使用此技能。
  创建（从零开始生成）："生成一份 PDF"、"生成一份报告"、"写一份提案"、
  "制作简历"、"漂亮的 PDF"、"专业文档"、"封面"、"精美 PDF"、"可交付客户的文档"。
  填充（完成表单字段）："填写表单"、"填充这份 PDF"、
  "完成表单字段"、"向 PDF 写入数值"、"这份 PDF 有哪些字段"。
  重新格式化（对现有文档应用设计）："重新格式化文档"、"应用我们的样式"、
  "将 Markdown/文本转换为 PDF"、"让文档看起来更好看"、"重新设计这份 PDF"。
  本技能使用基于令牌的设计系统：颜色、排版和间距由文档类型决定，
  并贯穿每一页。输出可直接用于打印。
  当外观很重要时优先使用此技能，而不仅仅是需要任何 PDF 输出。
license: MIT
metadata:
  version: "1.0"
  category: document-generation
---

# minimax-pdf

一项技能，三个任务。

## 在执行创建或重新格式化任务前，先阅读 `design/design.md`

---

## 任务路由表

| 用户需求 | 路由 | 使用的脚本 |
|---|---|---|
| 从零开始生成一份新 PDF | **创建（CREATE）** | `palette.py` → `cover.py` → `render_cover.js` → `render_body.py` → `merge.py` |
| 填充或完成现有 PDF 的表单字段 | **填充（FILL）** | `fill_inspect.py` → `fill_write.py` |
| 重新格式化或重新设计现有文档 | **重新格式化（REFORMAT）** | `reformat_parse.py` → 然后执行完整创建流程 |

**规则：** 当不确定选择创建还是重新格式化时，问一下用户是否已有现成的文档。有 → 选择重新格式化。没有 → 选择创建。

---

## 路由 A：创建（CREATE）

完整流程：内容 → 设计令牌 → 封面 → 正文 → 合并后的 PDF

```bash
bash scripts/make.sh run \
  --title "Q3 策略评估" --type proposal \
  --author "策略团队" --date "2025 年 10 月" \
  --accent "#2D5F8A" \
  --content content.json --out report.pdf
```

**文档类型：** `report`（报告）· `proposal`（提案）· `resume`（简历）· `portfolio`（作品集）· `academic`（学术）· `general`（通用）· `minimal`（极简）· `stripe`（条纹）· `diagonal`（对角）· `frame`（边框）· `editorial`（编辑）· `magazine`（杂志）· `darkroom`（暗房）· `terminal`（终端）· `poster`（海报）

| 类型 | 封面样式 | 视觉设计 |
|---|---|---|
| `report`（报告） | 满出血 | 深色背景、点阵网格、Playfair Display 字体 |
| `proposal`（提案） | 分割 | 左侧面板 + 右侧几何形状、Syne 字体 |
| `resume`（简历） | 排版风格 | 首词超大、DM Serif Display 字体 |
| `portfolio`（作品集） | 大气 | 近黑色背景、径向发光、Fraunces 字体 |
| `academic`（学术） | 排版风格 | 浅色背景、古典衬线、EB Garamond 字体 |
| `general`（通用） | 满出血 | 深灰色、Outfit 字体 |
| `minimal`（极简） | 极简 | 白色 + 单条 8px 强调条、Cormorant Garamond 字体 |
| `stripe`（条纹） | 条纹 | 3 条粗水平彩色条、Barlow Condensed 字体 |
| `diagonal`（对角） | 对角 | SVG 角切割、深浅分割、Montserrat 字体 |
| `frame`（边框） | 边框 | 内嵌边框、角部装饰、Cormorant 字体 |
| `editorial`（编辑） | 编辑 | 虚影字母、全大写标题、Bebas Neue 字体 |
| `magazine`（杂志） | 杂志 | 温暖的米色背景、居中堆叠、英雄图像、Playfair Display 字体 |
| `darkroom`（暗房） | 暗房 | 深蓝色背景、居中堆叠、灰度图像、Playfair Display 字体 |
| `terminal`（终端） | 终端 | 近黑色、网格线、等宽字体、霓虹绿 |
| `poster`（海报） | 海报 | 白色背景、粗边栏、超大标题、Barlow Condensed 字体 |

**封面额外选项**（通过 `--abstract`、`--cover-image` 注入）：
- `--abstract "文本"` — 封面上的摘要文本块（杂志/暗房类型）
- `--cover-image "url"` — 英雄图像的 URL/路径（杂志、暗房、海报类型）

**颜色覆盖 — 始终根据文档内容选择：**
- `--accent "#HEX"` — 覆盖强调色；`accent_lt` 会自动通过向白色亮化而衍生
- `--cover-bg "#HEX"` — 覆盖封面背景颜色

**强调色选择指南：**

你对强调色有创意决定权。从文档的语义背景选择 — 标题、行业、用途、受众 — 而不是泛泛的"安全"选择。强调色出现在分节线、标注框、表格标题和封面上，它承载了文档的视觉身份。

| 应用领域 | 推荐的强调色范围 |
|---|---|
| 法律/合规/金融 | 深海军蓝 `#1C3A5E`、炭灰 `#2E3440`、石板灰 `#3D4C5E` |
| 医疗/保健 | 青绿 `#2A6B5A`、清爽绿 `#3A7D6A` |
| 技术/工程 | 钢蓝 `#2D5F8A`、靛蓝 `#3D4F8A` |
| 环境/可持续性 | 森林绿 `#2E5E3A`、橄榄色 `#4A5E2A` |
| 创意/艺术/文化 | 酒红 `#6B2A35`、李紫 `#5A2A6B`、土红 `#8A3A2A` |
| 学术/研究 | 深青 `#2A5A6B`、图书馆蓝 `#2A4A6B` |
| 企业/中性 | 石板灰 `#3D4A5A`、石墨灰 `#444C56` |
| 奢侈/高端 | 暖黑 `#1A1208`、深青铜 `#4A3820` |

**规则：** 选择一个有品味的设计师会为这份特定文档选择的颜色 — 而不是该类型的默认色。柔和的、不饱和的色调效果最好；避免鲜艳的原色。不确定时，选择更深和更中性的色调。

**content.json 中的块类型：**

| 块类型 | 用途 | 关键字段 |
|---|---|---|
| `h1` | 部分标题 + 强调线 | `text` |
| `h2` | 小节标题 | `text` |
| `h3` | 子小节（加粗） | `text` |
| `body` | 两端对齐段落；支持 `<b>` `<i>` 标记 | `text` |
| `bullet` | 无序列表项（• 前缀） | `text` |
| `numbered` | 有序列表项 — 遇到非编号块时计数器自动重置 | `text` |
| `callout` | 带强调左边栏的高亮信息框 | `text` |
| `table` | 数据表 — 强调标题、交替行色 | `headers`、`rows`、`col_widths`?、`caption`? |
| `image` | 嵌入图像，按列宽缩放 | `path`/`src`、`caption`? |
| `figure` | 带自动编号的"图 N："标题的图像 | `path`/`src`、`caption`? |
| `code` | 等宽代码块，左侧有强调边框 | `text`、`language`? |
| `math` | 数学公式显示 — 通过 matplotlib 的 LaTeX 语法 | `text`、`label`?、`caption`? |
| `chart` | 柱状/折线/饼图，用 matplotlib 渲染 | `chart_type`、`labels`、`datasets`、`title`?、`x_label`?、`y_label`?、`caption`?、`figure`? |
| `flowchart` | 通过 matplotlib 绘制的节点和边的流程图 | `nodes`、`edges`、`caption`?、`figure`? |
| `bibliography` | 编号参考文献列表，悬挂缩进 | `items` [{id, text}]、`title`? |
| `divider` | 强调色全宽分割线 | — |
| `caption` | 小标签文本 | `text` |
| `pagebreak` | 强制分页 | — |
| `spacer` | 垂直空白 | `pt`（默认 12） |

**图表/流程图 JSON 示例：**
```json
{"type":"chart","chart_type":"bar","labels":["Q1","Q2","Q3","Q4"],
 "datasets":[{"label":"收入","values":[120,145,132,178]}],"caption":"季度结果"}

{"type":"flowchart",
 "nodes":[{"id":"s","label":"开始","shape":"oval"},
          {"id":"p","label":"处理","shape":"rect"},
          {"id":"d","label":"是否有效?","shape":"diamond"},
          {"id":"e","label":"结束","shape":"oval"}],
 "edges":[{"from":"s","to":"p"},{"from":"p","to":"d"},
          {"from":"d","to":"e","label":"是"},{"from":"d","to":"p","label":"否"}]}

{"type":"bibliography","items":[
  {"id":"1","text":"作者（年份）。标题。出版社。"}]}
```

---

## 路由 B：填充（FILL）

在现有 PDF 中填充表单字段，不改变布局或设计。

```bash
# 第一步：检查
python3 scripts/fill_inspect.py --input form.pdf

# 第二步：填充
python3 scripts/fill_write.py --input form.pdf --out filled.pdf \
  --values '{"FirstName": "Jane", "Agree": "true", "Country": "US"}'
```

| 字段类型 | 值格式 |
|---|---|
| `text`（文本） | 任何字符串 |
| `checkbox`（复选框） | `"true"` 或 `"false"` |
| `dropdown`（下拉菜单） | 必须与检查输出中的选项值匹配 |
| `radio`（单选按钮） | 必须与单选值匹配（通常以 `/` 开头） |

始终先运行 `fill_inspect.py` 以获得确切的字段名称。

---

## 路由 C：重新格式化（REFORMAT）

解析现有文档 → content.json → 创建流程

```bash
bash scripts/make.sh reformat \
  --input source.md --title "我的报告" --type report --out output.pdf
```

**支持的输入格式：** `.md` `.txt` `.pdf` `.json`

---

## 环境

```bash
bash scripts/make.sh check   # 验证所有依赖
bash scripts/make.sh fix     # 自动安装缺失的依赖
bash scripts/make.sh demo    # 生成示例 PDF
```

| 工具 | 使用场景 | 安装方法 |
|---|---|---|
| Python 3.9+ | 所有 `.py` 脚本 | 系统级 |
| `reportlab` | `render_body.py` | `pip install reportlab` |
| `pypdf` | 填充、合并、重新格式化 | `pip install pypdf` |
| Node.js 18+ | `render_cover.js` | 系统级 |
| `playwright` + Chromium | `render_cover.js` | `npm install -g playwright && npx playwright install chromium` |
