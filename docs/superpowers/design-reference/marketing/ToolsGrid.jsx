// ToolsGrid.jsx — 10 calculator/utility tools tile grid
// Mirrors the "专业办案工具" section in app/pages/index.vue

const tools = [
  { icon: 'calc',     title: '利息计算',     body: '计算各类借款、欠款的利息' },
  { icon: 'gavel',    title: '诉讼费用',     body: '计算诉讼案件的诉讼费用' },
  { icon: 'money',    title: '律师费计算',   body: '计算律师费用' },
  { icon: 'clock',    title: '延迟履行利息', body: '计算延迟履行的利息' },
  { icon: 'percent',  title: '银行利率查询', body: '查询银行的最新利率' },
  { icon: 'calendar', title: '日期推算',     body: '计算特定日期间隔或推算日期' },
  { icon: 'coin',     title: '赔偿计算器',   body: '计算各类赔偿金额' },
  { icon: 'briefcase',title: '加班计算',     body: '计算加班费用' },
  { icon: 'heart',    title: '离婚财产分割', body: '离婚财产分割计算' },
  { icon: 'shield',   title: '社保追缴',     body: '计算社保追缴金额' },
];

function ToolIcon({ kind }) {
  const p = { width: 28, height: 28, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };
  switch (kind) {
    case 'calc':      return <svg {...p}><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="10" y2="10"/><line x1="14" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="10" y2="14"/><line x1="14" y1="14" x2="16" y2="14"/><line x1="8" y1="18" x2="10" y2="18"/><line x1="14" y1="18" x2="16" y2="18"/></svg>;
    case 'gavel':     return <svg {...p}><path d="m14 13-7.5 7.5a2.12 2.12 0 0 1-3-3L11 10"/><path d="m16 16 6-6"/><path d="m8 8 6-6"/><path d="m9 7 8 8"/><path d="m21 11-8-8"/></svg>;
    case 'money':     return <svg {...p}><path d="M3 7c0-1.1.9-2 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9h.01M18 15h.01"/></svg>;
    case 'clock':     return <svg {...p}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>;
    case 'percent':   return <svg {...p}><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>;
    case 'calendar':  return <svg {...p}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>;
    case 'coin':      return <svg {...p}><circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/><path d="m16.71 13.88.7.71-2.82 2.82"/></svg>;
    case 'briefcase': return <svg {...p}><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>;
    case 'heart':     return <svg {...p}><path d="M11 17a4 4 0 0 1-8 0 4 4 0 0 1 8 0z"/><path d="M21 17a4 4 0 0 1-8 0 4 4 0 0 1 8 0z"/><path d="m12 14 5-5-2-2-3 3-3-3-2 2 5 5z"/></svg>;
    case 'shield':    return <svg {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>;
    default: return null;
  }
}

function ToolsGrid() {
  return (
    <section style={{ padding: '80px 16px', background: 'var(--muted)' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <p style={{ font: '500 13px/1 var(--font-sans)', color: 'var(--primary)', letterSpacing: '0.08em', textTransform: 'uppercase', margin: '0 0 12px' }}>UTILITY TOOLS</p>
          <h2 style={{ font: '700 36px/1.2 var(--font-sans)', letterSpacing: '-0.02em', margin: '0 0 16px' }}>
            专业<span style={{ background: 'linear-gradient(135deg, #1E9EED, #090380)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>办案工具</span>
          </h2>
          <p style={{ font: '400 16px/1.6 var(--font-sans)', color: 'var(--muted-foreground)', margin: 0 }}>
            丰富的计算工具集合，帮助您精确计算各类费用和数据，提升办案效率
          </p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16 }}>
          {tools.map((t, i) => (
            <a key={i} href="#" style={{
              background: 'var(--card)', textDecoration: 'none', color: 'inherit',
              borderRadius: 12, padding: 24,
              border: '1px solid var(--border)',
              boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.04)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center',
              transition: 'all 0.2s',
            }}>
              <div style={{
                width: 48, height: 48, borderRadius: 12, marginBottom: 14,
                background: 'var(--tint-sky-bg)', color: 'var(--tint-sky-fg)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <ToolIcon kind={t.icon} />
              </div>
              <h3 style={{ font: '600 15px/1.3 var(--font-sans)', margin: '0 0 4px' }}>{t.title}</h3>
              <p style={{ font: '400 12.5px/1.5 var(--font-sans)', color: 'var(--muted-foreground)', margin: 0 }}>{t.body}</p>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

window.ToolsGrid = ToolsGrid;
