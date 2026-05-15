// Hero.jsx — Brand-forward landing hero
// Soft brand-gradient backdrop + gradient pill badge + dual CTA + framed media well

function Hero({ onCtaClick }) {
  return (
    <section data-resp="page-pad" style={{
      position: 'relative', overflow: 'hidden',
      padding: '64px 16px 80px',
      background: 'var(--wash-page)',
    }}>
      {/* Background brand glow orbs */}
      <div aria-hidden style={{
        position: 'absolute', top: -200, left: -200, width: 600, height: 600, borderRadius: '50%',
        background: 'radial-gradient(circle, #1EEDC4 0%, transparent 70%)',
        opacity: 0.18, filter: 'blur(60px)', pointerEvents: 'none',
      }} />
      <div aria-hidden style={{
        position: 'absolute', bottom: -250, right: -150, width: 700, height: 700, borderRadius: '50%',
        background: 'radial-gradient(circle, #1E9EED 0%, transparent 70%)',
        opacity: 0.22, filter: 'blur(80px)', pointerEvents: 'none',
      }} />

      <div data-resp="hero-grid" style={{
        position: 'relative', zIndex: 1,
        maxWidth: 1200, margin: '0 auto',
        display: 'grid', gridTemplateColumns: '1.05fr 1fr', gap: 56, alignItems: 'center',
      }}>
        <div>
          {/* Brand pill badge */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '5px 12px 5px 5px', borderRadius: 99,
            background: 'color-mix(in srgb, var(--card) 70%, transparent)', backdropFilter: 'blur(8px)',
            border: '1px solid color-mix(in srgb, var(--primary) 18%, transparent)',
            marginBottom: 24, font: '500 13px/1 var(--font-sans)',
          }}>
            <span style={{
              padding: '3px 8px', borderRadius: 99, color: '#fff', font: '600 11px/1 var(--font-sans)',
              background: 'linear-gradient(135deg, #1EEDC4, #1E9EED)',
            }}>NEW</span>
            <span style={{ color: 'var(--foreground)' }}>合同审查 · quote 字符级高亮已上线</span>
          </div>

          <h1 data-resp="hero-h1" style={{
            font: '700 46px/1.15 var(--font-sans)', letterSpacing: '-0.025em',
            margin: '0 0 16px',
          }}>
            专为法律人打造的<br />
            <span style={{
              background: 'linear-gradient(135deg, #1EEDC4 0%, #1E9EED 55%, #090380 100%)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              backgroundClip: 'text', color: 'transparent',
            }}>案情分析与诉讼辅助 AI 平台</span>
          </h1>
          <p style={{
            font: '400 19px/1.65 var(--font-sans)',
            color: 'var(--muted-foreground)', margin: '0 0 32px',
            maxWidth: 500,
          }}>
            LexSeek 帮助律师精炼案件信息，洞悉复杂案情脉络，提供从概要梳理到策略预判的深度分析，助您高效决策，掌控全局。
          </p>
          <div style={{ display: 'flex', gap: 12 }}>
            <button onClick={onCtaClick} data-hover="press" style={{
              padding: '13px 28px', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: 'linear-gradient(135deg, #1E9EED 0%, #090380 100%)', color: '#fff',
              font: '500 16px/1 var(--font-sans)',
              boxShadow: '0 14px 30px -10px rgba(9,3,128,0.45), 0 4px 8px rgba(30,158,237,0.2)',
            }}>免费体验</button>
            <button data-hover="press" style={{
              padding: '13px 28px', borderRadius: 8, cursor: 'pointer',
              background: 'color-mix(in srgb, var(--card) 70%, transparent)', backdropFilter: 'blur(8px)',
              border: '1px solid color-mix(in srgb, var(--primary) 20%, transparent)', color: 'var(--foreground)',
              font: '500 16px/1 var(--font-sans)',
            }}>了解更多</button>
          </div>

          {/* Trust row */}
          <div data-resp="trust-row" style={{
            marginTop: 40, display: 'flex', alignItems: 'center', gap: 24,
            font: '400 13px/1.4 var(--font-sans)', color: 'var(--muted-foreground)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <BrandDot /> 数万律师 · 律所信赖
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <BrandDot /> 案件记忆 · 持续学习
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <BrandDot /> 多模型适配
            </div>
          </div>
        </div>

        {/* Media well — framed with gradient border; source video matches the LexSeek site */}
        <div style={{
          position: 'relative', borderRadius: 18,
          background: 'linear-gradient(135deg, #1EEDC4 0%, #1E9EED 50%, #090380 100%)',
          padding: 2,
          boxShadow: '0 25px 60px -20px rgba(9,3,128,0.4), 0 10px 20px -10px rgba(30,158,237,0.3)',
        }}>
          <div style={{
            background: 'var(--card)', borderRadius: 16, overflow: 'hidden',
            aspectRatio: '16 / 9',
          }}>
            <video
              src="https://lexseek.cn/video/vcr.mp4"
              poster="https://lexseek.cn/video/cover.png"
              controls
              playsInline
              webkit-playsinline="true"
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', background: '#000' }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function BrandDot() {
  return <span style={{
    width: 6, height: 6, borderRadius: 99,
    background: 'linear-gradient(135deg, #1EEDC4, #1E9EED)',
    flexShrink: 0,
  }} />;
}

window.Hero = Hero;
