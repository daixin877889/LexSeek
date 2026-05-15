// WorkflowSteps.jsx — Three workflow stages, each with its own brand-tinted card,
// faint number watermark, glow halo, and chevron arrows between cards.

function WorkflowSteps() {
  const steps = [
    {
      n: '01', icon: 'plus',  tint: 'mint',
      title: '输入案情',
      body: '输入或上传案件材料，包括事实描述、证据材料等关键信息。',
    },
    {
      n: '02', icon: 'cpu',   tint: 'sky',
      title: 'AI 分析',
      body: '我们的 AI 系统会自动分析案情，提取关键信息，生成分析结果。',
    },
    {
      n: '03', icon: 'check', tint: 'navy',
      title: '获取结果',
      body: '查看分析结果，包括案情概要、大事记、案由、请求权分析等内容。',
    },
  ];

  const iconSvg = (kind) => {
    const p = { width: 26, height: 26, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };
    if (kind === 'plus')  return <svg {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>;
    if (kind === 'cpu')   return <svg {...p}><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="2" x2="9" y2="4"/><line x1="15" y1="2" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="22"/><line x1="15" y1="20" x2="15" y2="22"/><line x1="20" y1="9" x2="22" y2="9"/><line x1="20" y1="14" x2="22" y2="14"/><line x1="2" y1="9" x2="4" y2="9"/><line x1="2" y1="14" x2="4" y2="14"/></svg>;
    return <svg {...p}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>;
  };

  const TINT = {
    mint: { bg: 'var(--tint-mint-bg)', fg: 'var(--tint-mint-fg)', glow: 'rgba(30,237,196,0.18)' },
    sky:  { bg: 'var(--tint-sky-bg)',  fg: 'var(--tint-sky-fg)',  glow: 'rgba(30,158,237,0.18)' },
    navy: { bg: 'var(--tint-navy-bg)', fg: 'var(--tint-navy-fg)', glow: 'rgba(80,72,192,0.18)' },
  };

  return (
    <section data-resp="page-pad" style={{ padding: '80px 16px', background: 'var(--background)' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 56 }}>
          <p style={{ font: '500 13px/1 var(--font-sans)', color: 'var(--primary)', letterSpacing: '0.08em', textTransform: 'uppercase', margin: '0 0 12px' }}>HOW IT WORKS</p>
          <h2 data-resp="section-h2" style={{ font: '700 36px/1.2 var(--font-sans)', letterSpacing: '-0.02em', margin: '0 0 16px' }}>
            简单三步，<span style={{ background: 'linear-gradient(135deg, #1EEDC4, #1E9EED)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>完成案件分析</span>
          </h2>
        </div>

        <div data-resp="workflow-grid" style={{
          display: 'grid', gridTemplateColumns: '1fr auto 1fr auto 1fr',
          gap: 0, alignItems: 'center',
        }}>
          {steps.map((s, i) => (
            <React.Fragment key={s.n}>
              <StepCard step={s} tint={TINT[s.tint]} iconSvg={iconSvg(s.icon)} />
              {i < steps.length - 1 && <div data-resp="workflow-arrow"><StepConnector /></div>}
            </React.Fragment>
          ))}
        </div>
      </div>
    </section>
  );
}

function StepCard({ step, tint, iconSvg }) {
  return (
    <div data-hover="lift" style={{
      position: 'relative', overflow: 'hidden',
      background: 'var(--card)',
      borderRadius: 18, padding: '32px 28px 28px',
      border: '1px solid var(--border)',
      boxShadow: '0 1px 2px 0 rgba(0,0,0,0.04)',
      minHeight: 220,
    }}>
      {/* Soft halo behind icon */}
      <div aria-hidden style={{
        position: 'absolute', top: -60, left: -60, width: 200, height: 200, borderRadius: '50%',
        background: `radial-gradient(circle, ${tint.glow} 0%, transparent 70%)`,
        filter: 'blur(30px)', pointerEvents: 'none',
      }} />

      {/* Big faint number watermark */}
      <div aria-hidden style={{
        position: 'absolute', top: 14, right: 18,
        font: '800 64px/1 var(--font-sans)', letterSpacing: '-0.04em',
        background: tint.bg, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
        opacity: 0.7, pointerEvents: 'none',
      }}>{step.n}</div>

      {/* Icon tile */}
      <div style={{
        position: 'relative',
        width: 56, height: 56, borderRadius: 14,
        background: tint.bg, color: tint.fg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 20,
      }}>{iconSvg}</div>

      <h3 style={{ position: 'relative', font: '600 22px/1.3 var(--font-sans)', margin: '0 0 8px' }}>{step.title}</h3>
      <p style={{ position: 'relative', font: '400 14.5px/1.65 var(--font-sans)', color: 'var(--muted-foreground)', margin: 0 }}>{step.body}</p>
    </div>
  );
}

function StepConnector() {
  return (
    <div aria-hidden style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      width: 56, color: 'var(--muted-foreground)', opacity: 0.5,
    }}>
      <svg width="36" height="14" viewBox="0 0 36 14" fill="none">
        <path d="M0 7 L30 7" stroke="url(#stepLineGrad)" strokeWidth="1.5" strokeDasharray="3 3" />
        <path d="M26 2 L34 7 L26 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <defs>
          <linearGradient id="stepLineGrad" x1="0" y1="0" x2="36" y2="0" gradientUnits="userSpaceOnUse">
            <stop stopColor="#1EEDC4" />
            <stop offset="1" stopColor="#1E9EED" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}

window.WorkflowSteps = WorkflowSteps;
