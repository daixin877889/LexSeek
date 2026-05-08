# 原则候选池 (阶段 1 产出)

---

## p01: 据以定案的物证应当是原物

```yaml
- id: p01
  title: 据以定案的物证应当是原物
  type: principle
  source_chapter: 第二章 · 物证、书证
  source_quote: |
    "据以定案的物证应当是原物。原物不便搬运、不易保存、依法应当返还或者依法应当由有关部门保管、处理的，可以拍摄、制作足以反映原物外形和特征的照片、录像、复制品。"
  summary: |
    物证必须是原物，这是最佳证据规则的要求。
    例外情况（五种）：不易搬运、不易保存、依法保管处理、依法返还、保密需要。
    复制品必须与原物核对无误或经鉴定确认真实。
  tags: [principle, physical-evidence, original]
```

---

## p02: 据以定案的书证应当是原件

```yaml
- id: p02
  title: 据以定案的书证应当是原件
  type: principle
  source_chapter: 第二章 · 物证、书证
  source_quote: |
    "据以定案的书证应当是原件。取得原件确有困难的，可以使用副本、复制件。"
  summary: |
    书证必须是原件，复印件可能在原件基础上伪造、变造。
    例外情况（两种）：取得原件确有困难、保密需要不能调取。
    复制件必须附制作过程说明和原件存放地点说明。
  tags: [principle, documentary-evidence, original]
```

---

## p03: 来源不明的物证书证不得作为定案根据

```yaml
- id: p03
  title: 来源不明的物证书证不得作为定案根据
  type: principle
  source_chapter: 第二章 · 物证、书证
  source_quote: |
    "在勘验、检查、搜查过程中提取、扣押的物证、书证，未附笔录或者清单，不能证明物证、书证来源的，不得作为定案的根据。"
  summary: |
    这是强制性排除规则，不可补正。
    来源不明意味着同一性无法保证，可能被调包或伪造。
    辩护人应坚决反对让控方"解释来源"的做法。
  tags: [principle, exclusion, mandatory]
```

---

## p04: 只有被告人供述不能定罪

```yaml
- id: p04
  title: 只有被告人供述不能定罪
  type: principle
  source_chapter: 第十章 · 证据的综合审查与运用
  source_quote: |
    "只有被告人供述，没有其他证据的，不能认定被告人有罪和处以刑罚。"
  summary: |
    这是口供补强规则的核心原则。
    被告人认罪不足以定罪，必须有其他证据印证。
    防止"自证其罪"导致的冤案。
  tags: [principle, confession, corroboration]
```

---

## p05: 孤证不能定案

```yaml
- id: p05
  title: 孤证不能定案
  type: principle
  source_chapter: 第十章 · 证据的综合审查与运用
  source_quote: |
    "孤证不能定案，即单个证据不能单独作为认定案件事实的根据。"
  summary: |
    仅针对对被告人不利的事实，不适用于有利事实。
    何为孤证需实质判断：虽有多份证据，但与主要事实有关联的只有一项。
    常见孤证：只有证人指证、只有被害人陈述。
  tags: [principle, single-evidence, prohibition]
```

---

## p06: 存疑有利于被告人

```yaml
- id: p06
  title: 存疑有利于被告人
  type: principle
  source_chapter: 第十章 · 证据的综合审查与运用
  source_quote: |
    "根据'一对一'证据情况下'事实存疑有利于被告人'之原则..."
  summary: |
    无罪推定的核心体现。
    当证据无法排除合理怀疑时，应作出有利于被告人的认定。
    适用于犯罪金额、违禁品数量等存疑情形（以二者重合部分认定）。
  tags: [principle, presumption, benefit]
```

---

## p07: 控方承担证明责任

```yaml
- id: p07
  title: 控方承担证明责任
  type: principle
  source_chapter: 第十章 · 证据的综合审查与运用
  source_quote: |
    "公诉案件中被告人有罪的举证责任由人民检察院承担。"
  summary: |
    无罪推定原则的直接体现。
    被告人不负自证其罪的责任。
    控方举证不能则承担败诉风险（无罪判决）。
    排除非法证据程序中，控方承担证明取证合法的责任。
  tags: [principle, burden-of-proof, prosecution]
```

---

## p08: 刑事证明标准是排除合理怀疑

```yaml
- id: p08
  title: 刑事证明标准是排除合理怀疑
  type: principle
  source_chapter: 第十章 · 证据的综合审查与运用
  source_quote: |
    "综合全案证据，对所认定事实已排除合理怀疑。"
  summary: |
    刑事证明标准约99%，民事仅51%。
    排除合理怀疑要求：证据无矛盾或矛盾已排除，结论唯一。
    死刑案件要求：排除一切合理怀疑。
    "一对一"证据连民事标准都达不到，直接认定事实不存在。
  tags: [principle, standard-of-proof, criminal]
```

---

## p09: 非法证据应当排除

```yaml
- id: p09
  title: 非法证据应当排除
  type: principle
  source_chapter: 第九章 · 非法证据排除
  source_quote: |
    "采用刑讯逼供等非法方法收集的犯罪嫌疑人、被告人供述和采用暴力、威胁等非法方法收集的证人证言、被害人陈述，应当予以排除。"
  summary: |
    非法取证破坏证据合法性，应当排除不得作为定案根据。
    包括：刑讯逼供、威胁、引诱、欺骗、非法拘禁等。
    排除后仍可就证据合法性提出异议。
  tags: [principle, exclusion, illegal]
```

---

## p10: 讯问笔录与录音录像不一致以录像为准

```yaml
- id: p10
  title: 讯问笔录与录音录像不一致以录像为准
  type: principle
  source_chapter: 第九章 · 非法证据排除
  source_quote: |
    "讯问笔录记载的内容与讯问录音录像存在实质性差异的，以讯问录音录像为准。"
  summary: |
    同步录音录像是最优证据，比笔录更完整、真实、客观。
    实质性差异：影响定罪量刑的内容差异。
    辩护人应详细观看录像，形成文字稿对比笔录。
  tags: [principle, recording, priority]
```

---

## p11: 勘验检查必须两人以上持证进行

```yaml
- id: p11
  title: 勘验检查必须两人以上持证进行
  type: principle
  source_chapter: 第六章 · 勘验、检查、辨认、侦查实验等笔录
  source_quote: |
    "侦查人员执行勘验、检查，必须持有人民检察院或者公安机关的证明文件。"
  summary: |
    勘验检查主体合法性要求：
    - 必须≥二人
    - 必须持《刑事案件现场勘查证》
    - 必须是侦查人员（非辅警）
    无证勘验、一人勘验的笔录不得作为定案根据。
  tags: [principle, inspection, procedure]
```

---

## p12: 见证人必须与案件无关

```yaml
- id: p12
  title: 见证人必须与案件无关
  type: principle
  source_chapter: 第二章 · 物证、书证
  source_quote: |
    "下列人员不得担任刑事诉讼活动的见证人...行使勘验、检查、搜查、扣押等刑事诉讼职权的公安、司法机关的工作人员或者其聘用的人员。"
  summary: |
    见证人适格要求：
    - 与案件无关
    - 具有辨别和表达能力
    - 不是公安司法机关工作人员或聘用人员（如辅警）
    辅警担任见证人的笔录不得作为定案根据。
  tags: [principle, witness, qualification]
```

---

## p13: 辨认必须混杂进行

```yaml
- id: p13
  title: 辨认必须混杂进行
  type: principle
  source_chapter: 第六章 · 勘验、检查、辨认、侦查实验等笔录
  source_quote: |
    "辨认犯罪嫌疑人时，被辨认的人数不得少于七人；对犯罪嫌疑人照片进行辨认的，不得少于十人的照片。辨认物品时，混杂的同类物品不得少于五件。"
  summary: |
    辨认数量要求：
    - 人辨认≥7人
    - 照片辨认≥10张
    - 物品辨认≥5件
    未混杂或数量不足的辨认笔录不得作为定案根据。
  tags: [principle, identification, quantity]
```

---

## p14: 辨认必须个别进行

```yaml
- id: p14
  title: 辨认必须个别进行
  type: principle
  source_chapter: 第六章 · 勘验、检查、辨认、侦查实验等笔录
  source_quote: |
    "几名辨认人对同一辨认对象进行辨认时，应当由辨认人个别进行。"
  summary: |
    防止辨认人相互影响、串通。
    多人辨认同一对象时必须逐一单独进行。
    集体辨认的笔录不得作为定案根据。
  tags: [principle, identification, individual]
```

---

## p15: 辨认前不得让辨认人见到辨认对象

```yaml
- id: p15
  title: 辨认前不得让辨认人见到辨认对象
  type: principle
  source_chapter: 第六章 · 勘验、检查、辨认、侦查实验等笔录
  source_quote: |
    "在辨认前，应当向辨认人详细询问被辨认对象的具体特征，避免辨认人见到被辨认对象。"
  summary: |
    辨认前见到对象会污染辨认结果的真实性。
    辨认程序必须先询问特征，再进行混杂辨认。
    违反此规则的辨认笔录不得作为定案根据。
  tags: [principle, identification, contamination]
```

---

## p16: 鉴定意见必须明确唯一

```yaml
- id: p16
  title: 鉴定意见必须明确唯一
  type: principle
  source_chapter: 第五章 · 鉴定意见
  source_quote: |
    "司法会计鉴定意见结论要明确、唯一，不能出现'可能'、'推断'、'估计'等模棱两可的表述。"
  summary: |
    鉴定意见不能模糊、推测。
    必须给出确定的结论，不能是"可能"、"推断"。
    模糊鉴定意见不得作为定案根据。
  tags: [principle, expert-opinion, certainty]
```

---

## p17: 鉴定不得超范围

```yaml
- id: p17
  title: 鉴定不得超范围
  type: principle
  source_chapter: 第五章 · 鉴定意见
  source_quote: |
    "鉴定事项超出该鉴定机构业务范围、技术条件的...不得作为定案的根据。"
  summary: |
    超范围鉴定情形：
    - 鉴定事项超出机构业务范围
    - 痕迹鉴定专家鉴定物品是否枪支（应由枪支鉴定专家）
    - 鉴定意见对枪支散件折算（法官裁判事项）
    超范围鉴定的意见不得作为定案根据。
  tags: [principle, expert-opinion, scope]
```

---

## p18: 证据未经当庭质证不得作为定案根据

```yaml
- id: p18
  title: 证据未经当庭质证不得作为定案根据
  type: principle
  source_chapter: 第十章 · 证据的综合审查与运用
  source_quote: |
    "证据未经当庭出示、辨认、质证等法庭调查程序查证属实，不得作为定案的根据。"
  summary: |
    证据必须经过当庭质证程序。
    例外：庭外核实（技术侦查证据、不影响定罪量刑的非关键证据）。
    辩护人应要求当庭出示物证原件、核对证据原件。
  tags: [principle, cross-examination, procedure]
```

---

## p19: 传闻证据不可采

```yaml
- id: p19
  title: 传闻证据不可采
  type: principle
  source_chapter: 第一章 · 证据辩护导论
  source_quote: |
    "此案的指控证据主要是言词证据，许多证言系明确表述为'听说'甚至'传说'的传闻证据...明显不具可采性。"
  summary: |
    传闻证据：证人转述他人所说而非亲身感知的内容。
    传闻证据真实性无法验证，不具有可采性。
    辩护人应识别"听说"、"传说"等表述并提出排除。
  tags: [principle, hearsay, exclusion]
```

---

## p20: 意见证据不可采

```yaml
- id: p20
  title: 意见证据不可采
  type: principle
  source_chapter: 第一章 · 证据辩护导论
  source_quote: |
    "猜测性的意见证据，明显不具可采性。"
  summary: |
    意见证据：证人的猜测、推断而非事实陈述。
    证人只能陈述感知的事实，不能发表意见。
    辩护人应识别"我认为"、"大概"等表述并提出排除。
  tags: [principle, opinion, exclusion]
```

---

## p21: 客观证据优于主观证据

```yaml
- id: p21
  title: 客观证据优于主观证据
  type: principle
  source_chapter: 第一章 · 证据辩护导论
  source_quote: |
    "证据规则主要是关于证据能力和证明力的规则，如客观证据优于主观证据。"
  summary: |
    实物证据（物证、书证、鉴定意见）优于言词证据。
    当言词证据与客观证据矛盾时，以客观证据为依据。
    辩护人应优先寻找客观证据来打破言词证据链条。
  tags: [principle, evidence-weight, priority]
```

---

## p22: 鉴真是证据能力的前提

```yaml
- id: p22
  title: 鉴真是证据能力的前提
  type: principle
  source_chapter: 第二章 · 物证、书证
  source_quote: |
    "鉴真主要解决证据的同一性、载体真实性、形式关联性问题，否则不具备证据资格。"
  summary: |
    实物证据必须先鉴真才能进入质证程序。
    鉴真解决"证据能力"问题，不是"证明力"问题。
    未通过鉴真的证据不得在法庭出示。
  tags: [principle, authentication, admissibility]
```

---

## p23: 物证必须全面收集

```yaml
- id: p23
  title: 物证必须全面收集
  type: principle
  source_chapter: 第二章 · 物证、书证
  source_quote: |
    "侦查机关应当全面、客观、及时收集与案件有关的证据。"
  summary: |
    全面收集包括有罪证据和无罪、罪轻证据。
    应当提取而未提取的物证可能导致事实存疑。
    辩护人可申请调取未收集的无罪、罪轻证据。
  tags: [principle, collection, comprehensive]
```

---

## p24: 证据必须及时收集

```yaml
- id: p24
  title: 证据必须及时收集
  type: principle
  source_chapter: 第六章 · 勘验、检查、辨认、侦查实验等笔录
  source_quote: |
    "公安机关对具备勘验、检查条件的刑事案件现场，应当及时进行勘验、检查。"
  summary: |
    延迟收集可能导致物证灭失、现场被破坏。
    勘验不及时的照片、鉴定意见可能不被采信。
    辩护人应审查收集时间与案发时间的关系。
  tags: [principle, collection, timeliness]
```