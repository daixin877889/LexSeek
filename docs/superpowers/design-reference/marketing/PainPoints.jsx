// PainPoints.jsx — Brand-tinted stat cards with gradient numerals + sky/mint accent strokes

function PainPoints() {
  const items = [
    { stat: '50%', title: '时间浪费', body: '法律专业人士高达一半的工作时间被耗费在重复性的文书审阅和信息检索上。', accent: 'mint' },
    { stat: '75%', title: '经验鸿沟', body: '青年律师的成长和办案质量高度受限于个人经验，行业知识难以标准化传承。', accent: 'sky' },
    { stat: '50%', title: '人才困局', body: '一半的小型律所难以吸引和留住人才，高强度的重复性工作是职业倦怠的主要原因。', accent: 'navy' },
  ];
  const ACCENT = {
    mint: { stroke: 'linear-gradient(90deg, #1EEDC4, #1E9EED)', tint: '#1EEDC4' },
    sky: { stroke: 'linear-gradient(90deg, #1E9EED, #0A4DA8)', tint: '#1E9EED' },
    navy: { stroke: 'linear-gradient(90deg, #0A4DA8, #090380)', tint: '#4A45B0' },
  };
  return (
    <section data-resp="page-pad" style={{ padding: '80px 16px' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <p style={{ font: '500 13px/1 var(--font-sans)', color: 'var(--primary)', letterSpacing: '0.08em', textTransform: 'uppercase', margin: '0 0 12px' }}>THE PROBLEM · 行业痛点</p>
          <h2 data-resp="section-h2" style={{ font: '700 36px/1.2 var(--font-sans)', letterSpacing: '-0.02em', margin: '0 0 16px' }}>
            通用 AI 在法律实务中的<span style={{ background: 'linear-gradient(135deg, #1E9EED, #090380)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>"三大硬伤"</span>
          </h2>
        </div>
        <div data-resp="pain-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, textAlign: 'left' }}>
          {items.map(i => {
            const a = ACCENT[i.accent];
            return (
              <div key={i.title} data-hover="lift" style={{
                position: 'relative', overflow: 'hidden',
                background: 'var(--card)',
                borderRadius: 16, padding: 32, paddingTop: 36,
                boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.04)',
                border: '1px solid var(--border)',
              }}>
                {/* Top stroke */}
                <div aria-hidden style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: a.stroke }} />
                {/* Accent wash — derived from the card surface so it adapts to dark mode */}
                <div aria-hidden style={{
                  position: 'absolute', top: 0, left: 0, right: 0, height: '60%',
                  background: `linear-gradient(180deg, color-mix(in srgb, ${a.tint} 12%, transparent) 0%, transparent 100%)`,
                  pointerEvents: 'none',
                }} />
                <div style={{ position: 'relative' }}>
                  <div style={{
                    font: '700 64px/1 var(--font-sans)', letterSpacing: '-0.04em',
                    background: a.stroke, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
                    marginBottom: 16,
                  }}>{i.stat}</div>
                  <h3 style={{ font: '600 20px/1.3 var(--font-sans)', margin: '0 0 8px' }}>{i.title}</h3>
                  <p style={{ font: '400 14.5px/1.65 var(--font-sans)', color: 'var(--muted-foreground)', margin: 0 }}>{i.body}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

window.PainPoints = PainPoints;
