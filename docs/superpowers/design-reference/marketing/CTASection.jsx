// CTASection.jsx — Full brand gradient backdrop with floating logo mark

function CTASection() {
  return (
    <section data-resp="page-pad" style={{
      position: 'relative', overflow: 'hidden',
      padding: '80px 16px',
      background: 'linear-gradient(135deg, #1EEDC4 0%, #1E9EED 50%, #090380 100%)',
      color: '#fff',
    }}>
      {/* Decorative blurred orbs */}
      <div aria-hidden style={{
        position: 'absolute', top: -100, left: '20%', width: 400, height: 400, borderRadius: '50%',
        background: '#1EEDC4', opacity: 0.25, filter: 'blur(80px)', pointerEvents: 'none',
      }} />
      <div aria-hidden style={{
        position: 'absolute', bottom: -100, right: '15%', width: 350, height: 350, borderRadius: '50%',
        background: '#090380', opacity: 0.4, filter: 'blur(80px)', pointerEvents: 'none',
      }} />
      {/* Faded logo backdrop */}
      <img src="../../assets/logo-mono.svg" alt="" aria-hidden style={{
        position: 'absolute', bottom: -120, right: -60, width: 420, height: 420,
        color: '#fff', opacity: 0.08, pointerEvents: 'none',
      }} />

      <div style={{ position: 'relative', zIndex: 1, maxWidth: 920, margin: '0 auto', textAlign: 'center' }}>
        {/* Logo with frosted pedestal — keeps mark legible against the gradient */}
        <div style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 80, height: 80, borderRadius: '50%',
          background: 'rgba(255,255,255,0.95)',
          marginBottom: 24,
          boxShadow: '0 10px 30px -8px rgba(0,0,0,0.3)',
        }}>
          <img src="../../assets/logo.svg" alt="" style={{ width: 48, height: 48 }} />
        </div>
        <h2 data-resp="section-h2" style={{ font: '700 40px/1.15 var(--font-sans)', letterSpacing: '-0.025em', margin: '0 0 16px' }}>
          立即开始使用 <span translate="no">LexSeek</span>
        </h2>
        <p style={{
          font: '400 20px/1.55 var(--font-sans)', opacity: 0.92, margin: '0 0 36px',
          maxWidth: 640, marginLeft: 'auto', marginRight: 'auto',
        }}>
          加入成千上万的法律专业人士，体验法律 AI 辅助案件分析带来的效率提升
        </p>
        <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button data-hover="press" style={{
            padding: '14px 32px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: '#fff', color: '#0A4DA8',
            font: '500 16px/1 var(--font-sans)',
            boxShadow: '0 10px 25px -5px rgba(0,0,0,0.3)',
          }}>免费体验</button>
          <button data-hover="press" style={{
            padding: '14px 32px', borderRadius: 8, cursor: 'pointer',
            background: 'rgba(255,255,255,0.12)', backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255,255,255,0.3)', color: '#fff',
            font: '500 16px/1 var(--font-sans)',
          }}>了解更多</button>
        </div>
      </div>
    </section>
  );
}

window.CTASection = CTASection;
