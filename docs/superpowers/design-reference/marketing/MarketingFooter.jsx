// MarketingFooter.jsx

function MarketingFooter() {
  return (
    <footer style={{
      borderTop: '1px solid var(--border)',
      padding: '24px 16px',
      background: 'var(--muted)',
    }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
        <p style={{ font: '400 14px/1.4 var(--font-sans)', color: 'var(--muted-foreground)', margin: 0 }}>
          © 2025 上海盛熙律泓教育科技有限公司｜
          <a href="#" style={{ color: 'inherit', textDecoration: 'none' }}>沪ICP备2025118451号</a>
        </p>
        <div style={{ display: 'flex', gap: 16 }}>
          <a href="privacy.html" data-hover="underline" style={{ font: '400 14px/1 var(--font-sans)', color: 'var(--muted-foreground)', textDecoration: 'none' }}>隐私政策</a>
          <a href="terms.html" data-hover="underline" style={{ font: '400 14px/1 var(--font-sans)', color: 'var(--muted-foreground)', textDecoration: 'none' }}>使用条款</a>
          <a href="about.html#contact" data-hover="underline" style={{ font: '400 14px/1 var(--font-sans)', color: 'var(--muted-foreground)', textDecoration: 'none' }}>联系我们</a>
        </div>
      </div>
    </footer>
  );
}

window.MarketingFooter = MarketingFooter;
