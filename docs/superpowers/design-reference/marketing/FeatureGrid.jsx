// FeatureGrid.jsx — Brand-tinted feature cards (icon wells use mint/sky/navy)

const featureItems = [
  { icon: 'summary',     title: '案情概要生成',         body: '自动分析案件材料，生成简洁明了的案情概要，帮助您快速把握案件要点。', tint: 'mint' },
  { icon: 'chronicle',   title: '案件大事记',           body: '自动整理案件时间线，按时间顺序呈现关键事件，便于您全面了解案件发展过程。', tint: 'sky' },
  { icon: 'cause',       title: '案由确认',             body: '智能识别案件类型和案由，提供法律依据，帮助您准确定位案件性质。', tint: 'sky' },
  { icon: 'claim',       title: '请求权生成与分析',     body: '根据案情自动生成可能的请求权，并提供详细分析和法律依据。', tint: 'navy' },
  { icon: 'defense',     title: '对方抗辩预测',         body: '预测对方可能的抗辩理由和策略，帮助您提前准备应对方案。', tint: 'mint' },
  { icon: 'evidence',    title: '证据清单',             body: '分析并整理案件所需证据清单建议，让您胸有成竹。', tint: 'sky' },
  { icon: 'trend',       title: '判决趋势预测',         body: '案件法律合理性审查、预测判决趋势，助您及时调整诉讼策略。', tint: 'navy' },
  { icon: 'lawyerLetter',title: '律师函生成',           body: '一键生成专业律师函，自定义抬头与签章。', tint: 'sky' },
];

const TINT = {
  mint: { bg: 'var(--tint-mint-bg)', color: 'var(--tint-mint-fg)' },
  sky:  { bg: 'var(--tint-sky-bg)',  color: 'var(--tint-sky-fg)' },
  navy: { bg: 'var(--tint-navy-bg)', color: 'var(--tint-navy-fg)' },
};

function FeatureGrid() {
  return (
    <section data-resp="page-pad" style={{ padding: '80px 16px', background: 'var(--muted)' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 56 }}>
          <p style={{ font: '500 13px/1 var(--font-sans)', color: 'var(--primary)', letterSpacing: '0.08em', textTransform: 'uppercase', margin: '0 0 12px' }}>FEATURES · 核心能力</p>
          <h2 data-resp="section-h2" style={{ font: '700 36px/1.2 var(--font-sans)', letterSpacing: '-0.02em', margin: '0 0 16px' }}>
            强大的功能，<span style={{ background: 'linear-gradient(135deg, #1E9EED, #090380)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>简化您的工作流程</span>
          </h2>
          <p style={{ font: '400 18px/1.6 var(--font-sans)', color: 'var(--muted-foreground)', margin: 0 }}>
            LexSeek 提供全面的案件分析工具，帮助您更高效地处理法律案件
          </p>
        </div>
        <div data-resp="feature-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
          {featureItems.map((f, i) => {
            const t = TINT[f.tint];
            return (
              <div key={i} data-hover="lift" style={{
                position: 'relative',
                background: 'var(--card)',
                borderRadius: 14, padding: 24,
                boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.04)',
                border: '1px solid var(--border)',
              }}>
                <div style={{
                  width: 48, height: 48, borderRadius: 12,
                  background: t.bg, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  marginBottom: 16, position: 'relative', overflow: 'hidden',
                }}>
                  {/* Use mask-image so the SVG inherits the well's colour rather than being a flat-black img */}
                  <div style={{
                    width: 26, height: 26,
                    background: t.color,
                    WebkitMask: `url(../../assets/module-icons/${f.icon}.svg) center / contain no-repeat`,
                    mask: `url(../../assets/module-icons/${f.icon}.svg) center / contain no-repeat`,
                  }} />
                </div>
                <h3 style={{ font: '600 17px/1.3 var(--font-sans)', margin: '0 0 6px' }}>{f.title}</h3>
                <p style={{ font: '400 13.5px/1.65 var(--font-sans)', color: 'var(--muted-foreground)', margin: 0 }}>{f.body}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

window.FeatureGrid = FeatureGrid;
