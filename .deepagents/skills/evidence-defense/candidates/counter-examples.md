# 反例候选池 (阶段 1 产出)

---

## ce01: 拘泥于"三性"审查而忽视证据规则

```yaml
- id: ce01
  title: 拘泥于"三性"审查而忽视证据规则
  type: counter-example
  source_chapter: 第一章 · 证据辩护导论
  source_quote: |
    "辩护人可以通过质疑控方每一项证据的'两力'（证据能力、证明力）、'三性'（合法性、真实性、关联性），进而攻破证据锁链。但不能拘泥于三性，需综合运用证据规则。"
  failure_mode: |
    机械地套用"合法性、真实性、关联性"框架，每项证据都只从这三方面质证，忽视了证据规则的综合运用。
  mechanism: |
    "三性"是起点而非终点。证据规则（如孤证不能定案、口供补强、印证规则等）才是攻破证据锁链的核心武器。只谈三性不谈规则，质证会流于形式。
  warning_signs:
    - 质证意见总是"三性"重复表述
    - 没有援引具体证据规则
    - 法官认为辩护"没有实质内容"
  bound_to:
    - "证据'三性'审查框架"
  tags: [counter-example, methodology, formalism]
```

---

## ce02: 混淆证据能力与证明力

```yaml
- id: ce02
  title: 混淆证据能力与证明力
  type: counter-example
  source_chapter: 第一章 · 证据辩护导论
  source_quote: |
    "证据能力和证明力是两个完全不同的概念。证据能力解决的是证据能否在法庭出示的问题，证明力解决的是证据能证明什么的问题。"
  failure_mode: |
    在质证时混淆"证据能不能用"（证据能力）和"证据能证明多少"（证明力），导致质证重点错误。
  mechanism: |
    证据能力是门槛问题，无证据能力的证据根本不能在法庭出示。证明力是分量问题，有证据能力的证据还需判断证明力大小。先审查证据能力，再审查证明力。
  warning_signs:
    - 辩护意见说"证据证明力不足"但未先质疑证据能力
    - 对明显违法的证据只说"证明力弱"
    - 法庭未采纳排除申请
  bound_to:
    - "证据'三性'审查框架"
    - "非法证据应当排除"
  tags: [counter-example, concept, confusion]
```

---

## ce03: 忽视实物证据的鉴真环节

```yaml
- id: ce03
  title: 忽视实物证据的鉴真环节
  type: counter-example
  source_chapter: 第二章 · 物证、书证
  source_quote: |
    "鉴真主要解决证据的同一性、载体真实性、形式关联性问题，否则不具备证据资格。很多人忽视鉴真，直接进入质证。"
  failure_mode: |
    对物证、书证直接质证其内容真实性、关联性，却未先审查证据来源是否清楚、保管链条是否完整。
  mechanism: |
    鉴真解决的是证据能力问题。来源不明、保管链断裂的证据根本不具备证据资格，不应进入质证程序。不鉴真就质证，等于接受了一个可能被调包或伪造的证据。
  warning_signs:
    - 物证照片无制作说明
    - 扣押时间与鉴定时间间隔长
    - 物证标签位置变化
    - 保管链条记录缺失
  bound_to:
    - "实物证据鉴真框架"
    - "来源不明的物证书证不得作为定案根据"
  tags: [counter-example, physical-evidence, authentication]
```

---

## ce04: 见证人由辅警担任

```yaml
- id: ce04
  title: 见证人由辅警担任
  type: counter-example
  source_chapter: 第二章 · 物证、书证
  source_quote: |
    "下列人员不得担任刑事诉讼活动的见证人...行使勘验、检查、搜查、扣押等刑事诉讼职权的公安、司法机关的工作人员或者其聘用的人员。"
  failure_mode: |
    侦查机关让本单位聘用人员（如辅警、巡防队员）担任见证人，签字见证。
  mechanism: |
    见证人必须与案件无关，辅警作为侦查机关聘用人员，不具备见证资格。其见证的笔录不得作为定案根据。
  warning_signs:
    - 见证人签名与侦查人员同单位
    - 见证人职务写"巡防队员"、"聘用人员"
    - 勘验笔录见证人栏填写不规范
  bound_to:
    - "见证人必须与案件无关"
  tags: [counter-example, procedure, witness]
```

---

## ce05: 辨认前让辨认人见到辨认对象

```yaml
- id: ce05
  title: 辨认前让辨认人见到辨认对象
  type: counter-example
  source_chapter: 第六章 · 勘验、检查、辨认、侦查实验等笔录
  source_quote: |
    "在辨认前，应当向辨认人详细询问被辨认对象的具体特征，避免辨认人见到被辨认对象。"
  failure_mode: |
    在正式辨认程序前，侦查人员让证人见到了嫌疑人照片或本人，污染了辨认结果。
  mechanism: |
    辨认前见到对象会形成心理暗示，辨认人对对象已有印象，无法判断辨认结果是基于原始记忆还是事后接触。辨认笔录不得作为定案根据。
  warning_signs:
    - 辨认前证人已见过嫌疑人
    - 辨认照片是入所照片（有监狱背景）
    - 辨认对象数量不足（未混杂）
  bound_to:
    - "辨认前不得让辨认人见到辨认对象"
    - "辨认笔录审查框架"
  tags: [counter-example, identification, suggestion]
```

---

## ce06: 辨认照片使用入所照片构成暗示

```yaml
- id: ce06
  title: 辨认照片使用入所照片构成暗示
  type: counter-example
  source_chapter: 第六章 · 勘验、检查、辨认、侦查实验等笔录
  source_quote: |
    "辨认照片均为现场抓获的参赌人员的入所照片，照片给参与辨认的证人以明显暗示。"
  failure_mode: |
    辨认使用的照片是嫌疑人的入所照片（身穿囚服、在拘留所/看守所背景），而非普通生活照片。
  mechanism: |
    入所照片背景暗示照片中人已被抓获或涉嫌犯罪，会对辨认人形成心理暗示，使其倾向于选择该照片。辨认笔录因程序违法不予采信。
  warning_signs:
    - 辨认照片有看守所背景
    - 照片中人身穿囚服
    - 照片编号或标识有暗示性
  bound_to:
    - "辨认必须混杂进行"
    - "辨认笔录审查框架"
  tags: [counter-example, identification, suggestion]
```

---

## ce07: 鉴定机构无司法鉴定资质

```yaml
- id: ce07
  title: 鉴定机构无司法鉴定资质
  type: counter-example
  source_chapter: 第五章 · 鉴定意见
  source_quote: |
    "鉴定机构无司法鉴定资质，鉴定人专业不对口（昆虫学专家鉴定鸟类）。"
  failure_mode: |
    使用不具备司法鉴定资质的机构进行鉴定，或鉴定人专业领域与鉴定事项不符。
  mechanism: |
    司法鉴定需要专门资质。无资质机构出具的鉴定意见不得作为刑事证据。鉴定人专业不对口（如昆虫学专家鉴定鸟类）违反专业匹配原则。
  warning_signs:
    - 鉴定机构是普通检测机构而非司法鉴定机构
    - 鉴定人专业领域与鉴定事项无关
    - 鉴定意见未附资质证明
  bound_to:
    - "鉴定意见质证框架"
    - "鉴定不得超范围"
  tags: [counter-example, expert-opinion, qualification]
```

---

## ce08: 鉴定超范围（鉴定机构代替法官裁判）

```yaml
- id: ce08
  title: 鉴定超范围（鉴定机构代替法官裁判）
  type: counter-example
  source_chapter: 第五章 · 鉴定意见
  source_quote: |
    "鉴定意见无权，也不能鉴定配件折算的结果...枪支散件是否折算，如何折算是法官裁判事项，绝非鉴定机构的鉴定事项。"
  failure_mode: |
    鉴定意见对超出鉴定范围的事项发表意见，如对枪支散件折算、涉案金额认定等作出判断。
  mechanism: |
    鉴定机构只能就专门性技术问题发表意见，法律适用问题（如折算、金额认定）是法官裁判事项。超范围鉴定的意见不得作为定案根据。
  warning_signs:
    - 鉴定意见包含"折算"、"认定"等法律判断
    - 鉴定结论超出委托事项范围
    - 鉴定意见用"应认定为"表述
  bound_to:
    - "鉴定不得超范围"
    - "鉴定意见质证框架"
  tags: [counter-example, expert-opinion, scope]
```

---

## ce09: 鉴定检材被污染或来源不明

```yaml
- id: ce09
  title: 鉴定检材被污染或来源不明
  type: counter-example
  source_chapter: 第五章 · 鉴定意见
  source_quote: |
    "送检的10只鹦鹉，在5月12日送检前，至少被污染三次，所谓送检鹦鹉是否从谢某福处提取无法确定，即来源不明。"
  failure_mode: |
    检材在送检前被多次转移、分类混养，或扣押至送检间隔过长，导致同一性无法保证。
  mechanism: |
    鉴定的前提是检材来源清楚、保管完整。检材被污染或来源不明，鉴定意见就建立在不可靠的基础上，不得作为定案根据。
  warning_signs:
    - 检材被多次转移
    - 扣押至送检间隔超过正常时间
    - 检材性状发生变化（如颜色、形态）
    - 检材无现场编号标记
  bound_to:
    - "鉴真是证据能力的前提"
    - "鉴定意见质证框架"
  tags: [counter-example, expert-opinion, contamination]
```

---

## ce10: 审计报告代替司法会计鉴定

```yaml
- id: ce10
  title: 审计报告代替司法会计鉴定
  type: counter-example
  source_chapter: 第五章 · 鉴定意见
  source_quote: |
    "审计报告不是司法会计鉴定，依法不能作为案件的鉴定结论。"
  failure_mode: |
    检方提交审计报告而非司法会计鉴定，审计机构不具备司法鉴定资质，审计方法不符合司法鉴定要求。
  mechanism: |
    审计报告与司法会计鉴定性质不同。审计是财务审查，司法会计鉴定是专门性技术鉴定。审计报告不能替代司法会计鉴定作为刑事证据。
  warning_signs:
    - 证据名称为"审计报告"而非"司法会计鉴定意见"
    - 审计机构是会计师事务所而非司法鉴定机构
    - 审计结论使用"可能"、"估计"等模糊表述
  bound_to:
    - "鉴定意见质证框架"
    - "鉴定意见必须明确唯一"
  tags: [counter-example, accounting, distinction]
```

---

## ce11: 口供补强证据仍是口供

```yaml
- id: ce11
  title: 口供补强证据仍是口供
  type: counter-example
  source_chapter: 第十章 · 证据的综合审查与运用
  source_quote: |
    "同案犯口供原则上不能互为补强。"
  failure_mode: |
    用同案犯的口供来补强被告人的口供，或用被告人庭前供述补强庭后供述。
  mechanism: |
    口供补强规则要求补强证据必须是口供以外的其他证据。同案犯口供仍是口供，不能互为补强。否则会出现"口供印证口供"的循环证明。
  warning_signs:
    - 只有同案犯供述印证被告人供述
    - 无物证、书证、鉴定意见等其他证据
    - 案件主要依赖言词证据
  bound_to:
    - "口供补强判断框架"
    - "只有被告人供述不能定罪"
  tags: [counter-example, confession, corroboration]
```

---

## ce12: 以"印证"为由采信明显矛盾的证据

```yaml
- id: ce12
  title: 以"印证"为由采信明显矛盾的证据
  type: counter-example
  source_chapter: 第十章 · 证据的综合审查与运用
  source_quote: |
    "证据之间相互印证，就是两个以上证据所包含的事实信息得到了相互验证。但印证解决的是真实性，不解决合法性。"
  failure_mode: |
    法官以"证据相互印证"为由采信明显违法取得的证据，忽视了证据合法性审查。
  mechanism: |
    印证解决的是真实性问题（证据内容是否真实），不解决合法性问题（证据是否依法取得）。非法证据即使相互印证也应排除。
  warning_signs:
    - 多份证据内容一致但取证程序违法
    - 法官说"证据相互印证"但未审查合法性
    - 辩护提出非法证据排除但未获支持
  bound_to:
    - "印证规则判断框架"
    - "非法证据应当排除"
  tags: [counter-example, corroboration, legality]
```

---

## ce13: "一对一"证据采信指控方

```yaml
- id: ce13
  title: "一对一"证据采信指控方
  type: counter-example
  source_chapter: 第十章 · 证据的综合审查与运用
  source_quote: |
    "在证据形成'一对一'的情形下...一方言词证据为真的概率只有50%，连优势证据的证明标准都达不到。"
  failure_mode: |
    只有行贿人证词指控受贿，被告人否认，法官采信指控方证词认定犯罪。
  mechanism: |
    "一对一"证据实质上是孤证，连民事标准（51%）都达不到，远低于刑事标准（99%）。根据存疑有利于被告人原则，应直接认定该项事实不存在。
  warning_signs:
    - 只有被害人/行贿人陈述，无其他证据
    - 被告人否认且无自相矛盾
    - 法官采信一方而忽视另一方
  bound_to:
    - "'一对一'证据处理框架"
    - "孤证不能定案"
    - "存疑有利于被告人"
  tags: [counter-example, one-to-one, doubt]
```

---

## ce14: 勘验笔录签名人员未到场

```yaml
- id: ce14
  title: 勘验笔录签名人员未到场
  type: counter-example
  source_chapter: 第六章 · 勘验、检查、辨认、侦查实验等笔录
  source_quote: |
    "扎某在庭审中陈述自己并未到现场进行勘查...公诉机关提交的现场勘查视频资料和证人扎某的询问笔录，均证实扎某并未在现场进行勘查。"
  failure_mode: |
    勘验笔录签名的侦查人员实际未参与勘验，签名是事后补签或代签。
  mechanism: |
    勘验笔录必须由实际参与勘验的人员签名。签名人员未到场意味着笔录真实性无法保证，不得作为定案根据。
  warning_signs:
    - 签名人员与实际勘验人员不符
    - 签名时间与勘验时间矛盾
    - 有证据证明签名人员不在现场
  bound_to:
    - "勘验检查笔录审查框架"
    - "勘验检查必须两人以上持证进行"
  tags: [counter-example, inspection, signature]
```

---

## ce15: 物证保管链断裂

```yaml
- id: ce15
  title: 物证保管链断裂
  type: counter-example
  source_chapter: 第二章 · 物证、书证
  source_quote: |
    "涉案枪形物8月31日被扣押，9月12日鉴定机构受理，中间相隔12天。鉴定的24支枪形物与扣押贴标签的枪形物对比：16支枪形物的标签位置明显不同。"
  failure_mode: |
    物证从扣押到鉴定间隔过长，期间保管记录缺失，物证标签位置变化，无法保证同一性。
  mechanism: |
    保管链断裂意味着物证可能被调包、污染或混入其他物品。同一性无法保证的证据不得作为定案根据。
  warning_signs:
    - 扣押至鉴定间隔过长
    - 物证标签位置变化
    - 保管记录缺失
    - 物证性状发生变化
  bound_to:
    - "实物证据鉴真框架"
    - "来源不明的物证书证不得作为定案根据"
  tags: [counter-example, physical-evidence, custody]
```

---

## ce16: 笔录与录音录像不一致以笔录为准

```yaml
- id: ce16
  title: 笔录与录音录像不一致以笔录为准
  type: counter-example
  source_chapter: 第九章 · 非法证据排除
  source_quote: |
    "讯问笔录记载的内容与讯问录音录像存在实质性差异的，以讯问录音录像为准。"
  failure_mode: |
    当笔录与录像不一致时，法官仍以笔录为准认定被告人供述内容。
  mechanism: |
    同步录音录像比笔录更完整、真实、客观。笔录可能被伪造或选择性记录。实质性差异时应以录像为准。
  warning_signs:
    - 笔录记载"认罪"但录像显示否认
    - 笔录未记载侦查人员威胁、诱导
    - 录像显示疲劳审讯
  bound_to:
    - "讯问笔录与录音录像不一致以录像为准"
    - "同步录音录像运用框架"
  tags: [counter-example, recording, priority]
```

---

## ce17: 非法证据排除程序举证责任倒置

```yaml
- id: ce17
  title: 非法证据排除程序举证责任倒置
  type: counter-example
  source_chapter: 第九章 · 非法证据排除
  source_quote: |
    "被告人和辩护人只需提供非法取证的材料或线索，而无须证明侦查机关取证违法。"
  failure_mode: |
    法官要求被告人证明侦查机关刑讯逼供，举证责任倒置给被告人。
  mechanism: |
    非法证据排除程序中，证明责任在控方。辩方只需提供线索或材料，检察院承担证明取证合法的责任。举证责任不能倒置。
  warning_signs:
    - 法官要求辩方"证明刑讯逼供"
    - 辩方提供线索后未启动调查程序
    - 控方不提供录像或说明
  bound_to:
    - "非法证据排除申请框架"
    - "控方承担证明责任"
  tags: [counter-example, exclusion, burden]
```

---

## ce18: 传闻证据被采信

```yaml
- id: ce18
  title: 传闻证据被采信
  type: counter-example
  source_chapter: 第一章 · 证据辩护导论
  source_quote: |
    "此案的指控证据主要是言词证据，许多证言系明确表述为'听说'甚至'传说'的传闻证据...明显不具可采性。"
  failure_mode: |
    法官采信证人转述他人所说的证言（"听说"、"传说"），而非证人亲身感知的内容。
  mechanism: |
    传闻证据的真实性无法验证。证人转述他人所说，原说话人未出庭，无法质证。传闻证据不具有可采性。
  warning_signs:
    - 证言用"听说"、"传说"表述
    - 证人陈述非亲身感知的内容
    - 证言无其他证据印证
  bound_to:
    - "传闻证据不可采"
  tags: [counter-example, hearsay, admissibility]
```

---

## ce19: 孤证认定有罪事实

```yaml
- id: ce19
  title: 孤证认定有罪事实
  type: counter-example
  source_chapter: 第十章 · 证据的综合审查与运用
  source_quote: |
    "孤证不能定案，即单个证据不能单独作为认定案件事实的根据。"
  failure_mode: |
    法官以单一证据（如证人证言）认定对被告人不利的事实，无其他证据印证。
  mechanism: |
    孤证不能定案是基本规则。仅针对对被告人不利的事实。虽有多份证据，但与主要事实有关联的只有一项，实质仍是孤证。
  warning_signs:
    - 只有一项证据与主要事实有实质关联
    - 其他证据仅为佐证而非印证
    - 证据之间无法形成证据链
  bound_to:
    - "孤证不能定案"
    - "孤证识别框架"
  tags: [counter-example, single-evidence, prohibition]
```

---

## ce20: 程序瑕疵"补正"后采信

```yaml
- id: ce20
  title: 程序瑕疵"补正"后采信
  type: counter-example
  source_chapter: 第二章 · 物证、书证
  source_quote: |
    "在勘验、检查、搜查过程中提取、扣押的物证、书证，未附笔录或者清单，不能证明物证、书证来源的，不得作为定案的根据。"
  failure_mode: |
    对明显违法的程序瑕疵（如来源不明）允许控方"解释"或"补正"后采信。
  mechanism: |
    某些程序违法是不可补正的强制性排除情形。来源不明的物证书证不得作为定案根据，不能通过事后解释来补正。
  warning_signs:
    - 扣押清单缺失
    - 物证来源无法证明
    - 控方事后提供"情况说明"
  bound_to:
    - "来源不明的物证书证不得作为定案根据"
    - "非法证据应当排除"
  tags: [counter-example, procedure, mandatory-exclusion]
```

---

## ce21: 电子数据未扣押封存原始存储介质

```yaml
- id: ce21
  title: 电子数据未扣押封存原始存储介质
  type: counter-example
  source_chapter: 第七章 · 视听资料、电子数据
  source_quote: |
    "被告人马某寿HUWEILON-ALOO手机未被公安机关扣押、封存，依据《电子数据规定》第8条、第27条的规定，侦查机关未将应当扣押封存的手机进行扣押并以封存状态移送，亦不能补正或作出合理解释，侦查机关在该手机上提取的相关电子数据不得作为定案的根据。"
  failure_mode: |
    应当扣押封存的原始存储介质（如手机）未被扣押封存，电子数据来源无法保证。
  mechanism: |
    电子数据以扣押封存原始存储介质为原则。未扣押封存导致电子数据可能被篡改，同一性无法保证，不得作为定案根据。
  warning_signs:
    - 手机、电脑等未在案
    - 提取笔录未注明原始存储介质去向
    - 未计算完整性校验值
    - 无法证明电子数据来源
  bound_to:
    - "电子数据审查要点"
    - "扣押封存原始存储介质"
  tags: [counter-example, electronic-data, custody]
```

---

## ce22: 电子数据提取仅一人进行

```yaml
- id: ce22
  title: 电子数据提取仅一人进行
  type: counter-example
  source_chapter: 第七章 · 视听资料、电子数据
  source_quote: |
    "涉案微信聊天记录系由经办民警一人提取、整理、汇总，因此制作的聊天记录Excel汇总表不符合法定程序...提取、复制电子数据应由二人以上进行。"
  failure_mode: |
    电子数据提取过程仅由一名侦查人员操作，违反"二人以上"的法定程序。
  mechanism: |
    两人以上取证是相互监督、保障合法性的底线要求。一人取证无法保证过程的客观性，电子数据不得作为定案根据。
  warning_signs:
    - 提取笔录仅一名侦查人员签名
    - 电子数据提取过程仅一人操作
    - 无法提供原始存储介质
  bound_to:
    - "电子数据审查要点"
    - "两人以上取证原则"
  tags: [counter-example, electronic-data, two-person]
```

---

## ce23: 电子数据未计算完整性校验值

```yaml
- id: ce23
  title: 电子数据未计算完整性校验值
  type: counter-example
  source_chapter: 第七章 · 视听资料、电子数据
  source_quote: |
    "陈某贩卖毒品案中，公安机关从被告人处扣押手机后提取涉案电子数据，制作了勘验检查笔录，但该笔录没有持有人、见证人签章，也没有记载提取过程和内容，取证过程没有录像，也没有计算电子数据完整性校验值。法院认为，该电子数据取证程序存在重大瑕疵，故对该电子数据予以排除。"
  failure_mode: |
    电子数据提取未计算完整性校验值（哈希值），无法保证数据未被篡改。
  mechanism: |
    完整性校验值是电子数据鉴真的核心技术方法。任何一条电子数据有且仅有唯一的哈希值。未计算校验值意味着无法排除篡改可能。
  warning_signs:
    - 提取笔录未记载完整性校验值
    - 未计算电子数据哈希值
    - 无法证明数据完整性
  bound_to:
    - "电子数据审查要点"
    - "完整性校验值"
  tags: [counter-example, electronic-data, hash-value]
```

---

## ce24: 技术侦查措施未经批准或未移送批准文书

```yaml
- id: ce24
  title: 技术侦查措施未经批准或未移送批准文书
  type: counter-example
  source_chapter: 第八章 · 技术调查、侦查证据
  source_quote: |
    "由于公诉机关未提交批准采取技术侦查措施的法律文书，也未提交证明该工作说明所述通话录音中涉及的人员系本案被告人的证据，故法院不予采信。"
  failure_mode: |
    采用技术侦查措施收集的证据未附批准法律文书，或侦查机关拒不提供审批文件。
  mechanism: |
    技术侦查必须经过严格批准程序。未移送批准文书意味着程序合法性无法证明，证据不得作为定案根据。
  warning_signs:
    - 技术侦查证据未附批准文书
    - 侦查机关以"涉密"为由拒绝移送
    - 未证明技术侦查经严格审批
  bound_to:
    - "技术侦查证据审查要点"
    - "技术侦查审批程序"
  tags: [counter-example, technical-investigation, approval]
```

---

## ce25: 技术侦查证据未经当庭质证

```yaml
- id: ce25
  title: 技术侦查证据未经当庭质证
  type: counter-example
  source_chapter: 第八章 · 技术调查、侦查证据
  source_quote: |
    "公安机关通过技术侦查搜集的证据没有经过庭审质证，不能作为定案依据。采取技术调查、侦查措施收集的证据材料，应当经过当庭出示、辨认、质证等法庭调查程序查证。"
  failure_mode: |
    技术侦查收集的证据未经当庭出示、质证即作为定案依据。
  mechanism: |
    技术侦查证据以当庭出示为原则、庭外核实为例外。未经质证意味着辩护方无法对证据的真实性、合法性进行质疑，不得作为定案根据。
  warning_signs:
    - 技术侦查证据未在庭审出示
    - 证据未经辩方质证
    - 法院未组织对技术侦查证据的质证
  bound_to:
    - "技术侦查证据审查要点"
    - "当庭质证原则"
  tags: [counter-example, technical-investigation, cross-examination]
```

---

## ce26: 疲劳审讯获取供述

```yaml
- id: ce26
  title: 疲劳审讯获取供述
  type: counter-example
  source_chapter: 第九章 · 非法证据排除
  source_quote: |
    "曹某明的有罪供述发生于2013年5月23日3时10分至4时2分，之前供述发生于2013年5月22日22时21分至23时5分，系侦查机关剥夺曹某明正常睡眠时间的情况下，采用疲劳审讯的非法方法收集的供述，应予排除。"
  failure_mode: |
    连续讯问超过合理时间，剥夺正常睡眠时间，深夜或凌晨时段长时间审讯。
  mechanism: |
    疲劳审讯是变相肉刑。连续讯问超过12小时，或剥夺正常睡眠时间，属于非法取证方法。由此获取的供述应当排除。
  warning_signs:
    - 连续讯问超过12小时
    - 深夜或凌晨时段讯问
    - 剥夺正常休息时间
    - 讯问时间安排不合理
  bound_to:
    - "非法证据排除申请框架"
    - "变相肉刑"
  tags: [counter-example, illegal-evidence, fatigue-interrogation]
```

---

## ce27: 以威胁方法获取供述

```yaml
- id: ce27
  title: 以威胁方法获取供述
  type: counter-example
  source_chapter: 第九章 · 非法证据排除
  source_quote: |
    "侦查人员威胁孔某文的妻子陈某银，称要通过学校扣押其女儿的毕业证和学位证、搜查其女儿的宿舍、要当着全校师生的面将其女儿带走，陈某银无法忍受而被迫妥协。"
  failure_mode: |
    以抓捕近亲属、损害近亲属合法权益相威胁，迫使嫌疑人供述。
  mechanism: |
    以暴力或严重损害本人及其近亲属合法权益等相威胁，使被告人遭受难以忍受的痛苦而违背意愿作出的供述，应当排除。
  warning_signs:
    - 侦查人员言语威胁近亲属
    - 以抓捕家属相威胁
    - 以损害亲人利益相威胁
  bound_to:
    - "非法证据排除申请框架"
    - "威胁"
  tags: [counter-example, illegal-evidence, threat]
```

---

## ce28: 非法拘禁期间获取供述

```yaml
- id: ce28
  title: 非法拘禁期间获取供述
  type: counter-example
  source_chapter: 第九章 · 非法证据排除
  source_quote: |
    "龚某强被实际强行滞留时间长达52小时，超出法律规定的传唤时间，侦查机关没有提供相应的证据证实在此期间取得的上诉人供述系合法取得的证据，不能排除非法取证的可能性。侦查机关在此期间对龚某强所作笔录应予以排除。"
  failure_mode: |
    在无合法手续的情况下限制人身自由并获取供述，或限制人身自由超过法定时限。
  mechanism: |
    非法拘禁等非法限制人身自由的方法收集的供述，无须以"肉体上或精神上剧烈疼痛或痛苦"为条件，便可直接强制排除。
  warning_signs:
    - 无强制措施手续限制人身自由
    - 限制人身自由超过法定时限
    - 传唤时间超过24小时
  bound_to:
    - "非法证据排除申请框架"
    - "非法拘禁"
  tags: [counter-example, illegal-evidence, illegal-detention]
```

---

## ce29: 重复性供述未一并排除

```yaml
- id: ce29
  title: 重复性供述未一并排除
  type: counter-example
  source_chapter: 第九章 · 非法证据排除
  source_quote: |
    "阮某山在侦查机关的第三次供述无法排除受非法取证影响而作出的与第一、二次的重复性供述，应当排除。采用刑讯逼供方法使被告人作出供述，之后被告人受该刑讯逼供行为影响而作出的与该供述相同的重复性供述，应当一并排除。"
  failure_mode: |
    排除最初几份非法供述后，后续的重复性供述未一并排除。
  mechanism: |
    刑讯逼供、威胁给嫌疑人心理造成的威慑仍然存在，嫌疑人仍会被迫继续作不真实的供述。除非刑讯逼供的影响已消除，重复性供述应一并排除。
  warning_signs:
    - 供述时间在刑讯逼供之后
    - 供述内容与刑讯所得供述相同
    - 未更换讯问人员
    - 未告知权利和认罪后果
  bound_to:
    - "非法证据排除申请框架"
    - "重复性供述"
  tags: [counter-example, illegal-evidence, repeated-confession]
```

---

## ce30: 在规定办案场所外讯问获取供述

```yaml
- id: ce30
  title: 在规定办案场所外讯问获取供述
  type: counter-example
  source_chapter: 第九章 · 非法证据排除
  source_quote: |
    "李某某反映，2017年9月4日侦查人员违法将其从看守所外提至公安局办公室...犯罪嫌疑人被送交看守所羁押以后，侦查人员对其进行讯问，应当在看守所内进行。在规定的办案场所之外获得的供述应当排除。"
  failure_mode: |
    犯罪嫌疑人被羁押后讯问不在看守所讯问室进行，而是外提至其他场所讯问。
  mechanism: |
    犯罪嫌疑人被送交看守所羁押后，讯问应当在看守所内进行。外提讯问破坏了看守所的监督机制，容易发生非法取证。
  warning_signs:
    - 讯问地点非看守所讯问室
    - 外提讯问无合法理由
    - 讯问笔录记载地点异常
  bound_to:
    - "非法证据排除申请框架"
    - "办案场所"
  tags: [counter-example, illegal-evidence, interrogation-location]
```

---

## ce31: 未依法录音录像或录音录像选择性录制

```yaml
- id: ce31
  title: 未依法录音录像或录音录像选择性录制
  type: counter-example
  source_chapter: 第九章 · 非法证据排除
  source_quote: |
    "应当对讯问过程录音录像的案件没有提供讯问录音录像，或者讯问录音录像存在选择性录制、剪接、删改等情形，现有证据不能排除以非法方法收集证据的，对有关证据应当予以排除。"
  failure_mode: |
    应当录音录像的案件没有提供录音录像，或录音录像存在选择性录制、剪辑、删改。
  mechanism: |
    同步录音录像制度是保障讯问合法性的重要措施。应当录音录像的案件没有录像，或录像不完整、被剪辑，推定存在非法取证情形。
  warning_signs:
    - 应当录像的案件未提供录像
    - 录像存在剪辑、删改痕迹
    - 录像不完整或有选择性录制
    - 录像与笔录不符
  bound_to:
    - "非法证据排除申请框架"
    - "同步录音录像运用框架"
  tags: [counter-example, illegal-evidence, selective-recording]
```

---

## ce32: 指定居所监视居住违法适用

```yaml
- id: ce32
  title: 指定居所监视居住违法适用
  type: counter-example
  source_chapter: 第九章 · 非法证据排除
  source_quote: |
    "第二被告人在某基地106房间被监视居住108天，处在0.6平方米的地方一个月，身体不得自由活动；108天未出房间，见不到太阳，不让刷牙；全天24小时有办案人员开灯陪护，经常半夜以'睡觉姿势不对'等理由叫醒；强迫服用不明药物。"
  failure_mode: |
    指定居所不具备正常生活、休息条件，24小时开灯陪护，强迫服药，变相刑讯。
  mechanism: |
    指定的居所应当具备正常的生活、休息条件。不具备正常生活条件的指居场所是变相办案场所，易发生刑讯逼供等非法取证。
  warning_signs:
    - 指居场所面积过小
    - 无法正常休息、见阳光
    - 办案人员24小时陪护
    - 强迫服药
  bound_to:
    - "非法证据排除申请框架"
    - "指定居所监视居住"
  tags: [counter-example, illegal-evidence, designated-residence]
```

---

## ce33: 控方错误主张证明责任

```yaml
- id: ce33
  title: 控方错误主张证明责任
  type: counter-example
  source_chapter: 第十章 · 证据的综合审查与运用
  source_quote: |
    "有的检察官会说，你说你无罪，拿证据来证明。这是完全错误的说法。证明责任由控方承担，被告人不负证明自己无罪的责任。控方必须排除合理怀疑地证明犯罪。"
  failure_mode: |
    检察官或法官错误地将证明责任转移给被告人，要求被告人证明自己无罪。
  mechanism: |
    无罪推定原则下，证明责任由控方承担。被告人不承担证明自己无罪的责任。举证责任倒置违反基本法律原则。
  warning_signs:
    - 检察官要求辩方举证证明无罪
    - 法官要求辩方举证
    - 指控证据不足时要求辩方解释
  bound_to:
    - "证明责任分配规则"
    - "无罪推定"
  tags: [counter-example, burden-of-proof, presumption]
```

---

## ce34: 孤证认定有罪

```yaml
- id: ce34
  title: 孤证认定有罪
  type: counter-example
  source_chapter: 第十章 · 证据的综合审查与运用
  source_quote: |
    "孤证不能定案，即单个证据不能单独作为认定案件事实的根据。有的案件只有一个证人证言，没有其他证据印证，就认定犯罪。"
  failure_mode: |
    以单一证据（如证人证言）认定有罪事实，无其他证据印证。
  mechanism: |
    孤证不能定案是基本证据规则。单个证据的真实性无法自我验证，必须有其他证据印证才能认定。仅凭孤证定案违反证据规则。
  warning_signs:
    - 定案仅依据单一证据
    - 关键事实仅有孤证证明
    - 缺少印证证据
  bound_to:
    - "孤证不能定案规则"
    - "证据印证规则"
  tags: [counter-example, single-evidence, corroboration]
```

---

## ce35: 口供未经补强定案

```yaml
- id: ce35
  title: 口供未经补强定案
  type: counter-example
  source_chapter: 第十章 · 证据的综合审查与运用
  source_quote: |
    "口供补强规则要求口供必须有其他证据补强才能定案。仅有口供，没有其他证据补强，不能定案。被告人供述需要补强，不能单独作为定案依据。"
  failure_mode: |
    被告人供述未经其他证据补强即作为定案唯一依据。
  mechanism: |
    口供补强规则要求补强证据必须是口供以外的其他证据。仅有口供定案会出现"口供印证口供"的循环证明，违反证据规则。
  warning_signs:
    - 定案仅依据口供
    - 口供无其他证据印证
    - 关键事实仅靠口供证明
  bound_to:
    - "口供补强规则"
    - "只有被告人供述不能定罪"
  tags: [counter-example, confession, corroboration]
```

---

## ce36: 证明标准未达到排除合理怀疑

```yaml
- id: ce36
  title: 证明标准未达到排除合理怀疑
  type: counter-example
  source_chapter: 第十章 · 证据的综合审查与运用
  source_quote: |
    "证明标准是'排除合理怀疑'，即证据证明案件事实需达到99%的程度。如果存在合理怀疑，就不能认定有罪。'可能性大'不是刑事证明标准。"
  failure_mode: |
    证据证明程度未达到法定标准，仍存在合理怀疑即认定有罪。
  mechanism: |
    刑事证明标准是"排除合理怀疑"，远高于民事标准（优势证据）。仅达到"可能"、"可能性大"的程度即认定有罪，违反证明标准。
  warning_signs:
    - 案件存在未解释的疑点
    - 证据之间存在矛盾
    - 关键事实不确定
    - 证明程度仅为"可能"
  bound_to:
    - "证明标准运用"
    - "排除合理怀疑"
  tags: [counter-example, standard-of-proof, reasonable-doubt]
```

---

## ce37: "一对一"证据矛盾时认定有罪

```yaml
- id: ce37
  title: "一对一"证据矛盾时认定有罪
  type: counter-example
  source_chapter: 第十章 · 证据的综合审查与运用
  source_quote: |
    "在一对一证据，即只有被告人供述和被害人陈述或证人证言，两者相互矛盾的情况下，此时应存疑有利于被告人，不能认定有罪。"
  failure_mode: |
    被告人供述与被害人陈述或证人证言矛盾，无其他证据印证，却认定有罪。
  mechanism: |
    "一对一"证据实质是孤证，双方说法不一致，无法判断孰真孰假。连民事标准（51%）都达不到，远低于刑事标准。应存疑有利于被告人。
  warning_signs:
    - 供述与证言一对一矛盾
    - 无其他证据印证
    - 双方说法不一致
    - 无法判断孰真孰假
  bound_to:
    - "一对一证据处理"
    - "存疑有利于被告"
  tags: [counter-example, one-to-one, doubt]
```

---

## ce38: 间接证据定案不符合五条件

```yaml
- id: ce38
  title: 间接证据定案不符合五条件
  type: counter-example
  source_chapter: 第十章 · 证据的综合审查与运用
  source_quote: |
    "间接证据定案必须同时符合五个条件：证据已查证属实；证据之间相互印证，不存在无法排除的矛盾和合理怀疑；全案证据形成完整的证据链条；证据证明体系足以排除其他可能性；运用证据进行的推理符合逻辑和经验。缺少任何一个条件，都不能定案。"
  failure_mode: |
    仅凭间接证据定案但不满足五项法定条件。
  mechanism: |
    间接证据定案要求更高。必须同时满足五个条件才能定案。缺少任一条件意味着证据体系不完整或有疑点，不能认定有罪。
  warning_signs:
    - 间接证据未查证属实
    - 证据之间存在矛盾
    - 证据链条不完整
    - 未排除其他可能性
    - 推理不符合逻辑或经验
  bound_to:
    - "间接证据定案规则"
    - "证据链条"
  tags: [counter-example, indirect-evidence, chain]
```

---

## ce39: 勘验笔录倒签时间

```yaml
- id: ce39
  title: 勘验笔录倒签时间
  type: counter-example
  source_chapter: 第二章 · 物证、书证
  source_quote: |
    "深圳市检察院补充侦查提纲第11点，要求侦查机关补充扣押物品对应的提取笔录。此后补充的《提取笔录》时间倒签为2017年2月18日。"
  failure_mode: |
    补正程序违法，事后倒签时间制作虚假笔录。
  mechanism: |
    勘验笔录应当现场制作、现场签字。事后倒签时间是为了掩盖程序违法，属于伪造证据。此类笔录不具有真实性，不得作为定案根据。
  warning_signs:
    - 提取笔录时间与实际提取时间不符
    - 笔录系事后补充制作
    - 时间倒签
  bound_to:
    - "勘验检查笔录审查要点"
    - "笔录现场制作"
  tags: [counter-example, inspection-record, backdating]
```

---

## ce40: 鉴定检材同一性无法保证

```yaml
- id: ce40
  title: 鉴定检材同一性无法保证
  type: counter-example
  source_chapter: 第五章 · 鉴定意见
  source_quote: |
    "扣押清单上没有保管人，11天后才送检，没有任何物证交接清单，物证由谁保管，如何交接，鉴定的气瓶是不是扣押的气瓶，无从查证，同一性无法保证。"
  failure_mode: |
    物证扣押后保管链条断裂，送检材料与扣押物证不一致。
  mechanism: |
    鉴定意见的前提是检材来源清楚、同一性确定。保管人不明、交接记录缺失、送检间隔过长，导致检材同一性无法保证，鉴定意见不得作为定案根据。
  warning_signs:
    - 扣押清单无保管人签名
    - 送检时间间隔过长
    - 缺少物证交接清单
    - 无法证明送检材料与扣押物证同一
  bound_to:
    - "鉴定意见质证要点"
    - "检材鉴真"
  tags: [counter-example, expert-opinion, authentication]
```

---

## ce41: 鉴定依据内部文件未公开

```yaml
- id: ce41
  title: 鉴定依据内部文件未公开
  type: counter-example
  source_chapter: 第五章 · 鉴定意见
  source_quote: |
    "鉴定意见依据的《枪支性能的检验方法》（FSSBPSB-JF-09-HJ-2014）系鉴定机构内部文件，未经公开，也无法从公开渠道获得，属于尚未公布的规定。"
  failure_mode: |
    鉴定依据为鉴定机构内部文件，未向社会公开，无法从公开渠道获取。
  mechanism: |
    鉴定依据应当是公开的规定、文件、标准或规范。内部文件未经公布，当事人无法知悉和质疑，不得作为鉴定依据。
  warning_signs:
    - 鉴定依据编号为内部编码
    - 无法从公开渠道获取鉴定依据
    - 鉴定依据非国家标准或行业标准
  bound_to:
    - "鉴定意见质证要点"
    - "鉴定依据公开"
  tags: [counter-example, expert-opinion, internal-standard]
```

---

## ce42: 抽样数量严重不足

```yaml
- id: ce42
  title: 抽样数量严重不足
  type: counter-example
  source_chapter: 第五章 · 鉴定意见
  source_quote: |
    "根据《抽样方案》，309个气瓶，考虑5%的不合格率，应当随机选择50个样品进行鉴定。而送检照片显示，侦查机关送检了5个气瓶1个消音器。5个气瓶，不到309个气瓶的2%，抽检数量严重不客观。"
  failure_mode: |
    抽样数量远低于统计抽样规范要求，无法保证鉴定结论的代表性。
  mechanism: |
    大量检材的鉴定应当按照统计抽样方案进行抽样。抽样数量严重不足意味着鉴定结论可能不适用于全部检材，鉴定意见不具有科学性。
  warning_signs:
    - 抽样数量远低于标准
    - 未考虑不合格率
    - 抽样非随机抽取
    - 抽样比例过低
  bound_to:
    - "鉴定意见质证要点"
    - "抽样方案"
  tags: [counter-example, expert-opinion, sampling]
```

---

## ce43: 仅凭照片进行分子生物学鉴定

```yaml
- id: ce43
  title: 仅凭照片进行分子生物学鉴定
  type: counter-example
  source_chapter: 第五章 · 鉴定意见
  source_quote: |
    "公安机关五次送检都是通过邮件方式发送鹦鹉照片，并未提供鹦鹉活体，而鉴定意见中所列活体，只是对鹦鹉扣押状态的记载。稍有常识的人都知道，DNA鉴定需要进行生物取样、测序等基本工作，根本无法通过照片进行DNA鉴定。"
  failure_mode: |
    仅凭照片而非实物检材进行DNA分子鉴定。
  mechanism: |
    分子生物学鉴定需要生物检材进行取样和测序。仅凭照片无法提取生物组织进行DNA检测，鉴定意见虚假。
  warning_signs:
    - 送检材料仅为照片
    - 鉴定声称进行DNA检验但无生物检材
    - 送检方式为邮件发送图片
  bound_to:
    - "鉴定意见质证要点"
    - "检材真实性"
  tags: [counter-example, expert-opinion, DNA, fake]
```

---

## ce44: 勘验未及时进行导致证据灭失

```yaml
- id: ce44
  title: 勘验未及时进行导致证据灭失
  type: counter-example
  source_chapter: 第六章 · 勘验、检查、辨认、侦查实验等笔录
  source_quote: |
    "公安机关未及时对现场进行勘验，无现场勘验笔录，两辆车被砸前的毁损情况未查，鉴定机构鉴定时的现场勘验系案发后第三天作出，勘验时的车辆毁损部位是否全部是某平此次犯罪时砸坏的部位存疑。"
  failure_mode: |
    案发后未立即进行勘验，导致现场证据灭失或变化。
  mechanism: |
    勘验检查应当及时进行。未及时勘验导致现场状况变化，无法还原案发时的情况，相关证据的真实性存疑。
  warning_signs:
    - 勘验时间距案发时间较长
    - 未在案发后第一时间勘验
    - 现场状况已发生变化
  bound_to:
    - "勘验检查笔录审查要点"
    - "勘验及时性"
  tags: [counter-example, inspection, timeliness]
```