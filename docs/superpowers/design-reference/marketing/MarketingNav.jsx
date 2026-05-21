// MarketingNav.jsx — Top navigation with brand-active underline + theme toggle + mobile drawer trigger

const MARKETING_LINKS = [
  { to: 'index.html',    key: '/',         label: '首页' },
  { to: 'features.html', key: '/features', label: '产品功能' },
  { to: 'pricing.html',  key: '/pricing',  label: '价格方案' },
  { to: 'about.html',    key: '/about',    label: '关于我们' },
];

function MarketingNav({ current = '/', theme, onToggleTheme, onMobileMenu }) {
  return (
    <header style={{
      borderBottom: '1px solid var(--border)',
      position: 'sticky', top: 0, zIndex: 10,
      background: 'color-mix(in srgb, var(--background) 85%, transparent)',
      backdropFilter: 'blur(12px)',
    }}>
      <div style={{
        maxWidth: 1280, margin: '0 auto',
        padding: '14px 16px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 36 }}>
          <a href="index.html" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: 'inherit' }}>
            <img src="../../assets/logo.svg" alt="LexSeek" style={{ height: 30 }} />
            <h1 translate="no" style={{ font: '700 19px/1 var(--font-sans)', margin: 0 }}>
              LexSeek<span style={{ color: 'var(--muted-foreground)', fontWeight: 400, margin: '0 6px' }}>｜</span>法索 AI
            </h1>
          </a>
          <nav data-resp="nav-links">
            <ul style={{ display: 'flex', gap: 6, listStyle: 'none', margin: 0, padding: 0 }}>
              {MARKETING_LINKS.map(l => {
                const active = current === l.key;
                return (
                  <li key={l.key}>
                    <a href={l.to} data-hover="nav" style={{
                      position: 'relative', display: 'block',
                      padding: '8px 14px', borderRadius: 6,
                      font: active ? '600 14px/1 var(--font-sans)' : '500 14px/1 var(--font-sans)',
                      color: active ? 'var(--primary)' : 'var(--foreground)',
                      background: active ? 'color-mix(in srgb, var(--primary) 10%, transparent)' : 'transparent',
                      textDecoration: 'none',
                    }}>{l.label}</a>
                  </li>
                );
              })}
            </ul>
          </nav>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          {/* Desktop-only auth CTAs */}
          <a href="../auth/index.html" data-resp="nav-cta" data-hover="underline" style={{ font: '500 14px/1 var(--font-sans)', color: 'var(--foreground)', textDecoration: 'none', padding: '8px 14px' }}>登录</a>
          <a href="../auth/index.html" data-resp="nav-cta" data-hover="press" style={{
            padding: '8px 18px',
            background: 'linear-gradient(135deg, #1E9EED 0%, #090380 100%)',
            color: '#fff', fontSize: 14, borderRadius: 6, textDecoration: 'none', fontWeight: 500,
            boxShadow: '0 6px 16px -6px rgba(9,3,128,0.4)',
          }}>免费注册</a>
          {/* Mobile-only hamburger */}
          <button data-resp="mobile-hamburger" data-hover="icon-btn" onClick={onMobileMenu} aria-label="打开菜单" style={{
            width: 36, height: 36, padding: 0,
            background: 'transparent', border: 'none', cursor: 'pointer', borderRadius: 8,
            alignItems: 'center', justifyContent: 'center', color: 'var(--muted-foreground)',
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          </button>
        </div>
      </div>
    </header>
  );
}

function MarketingMobileDrawer({ open, onClose, current = '/' }) {
  React.useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  return (
    <React.Fragment>
      <div className="dashboard-drawer-backdrop" data-open={open} onClick={onClose} aria-hidden={!open} />
      <aside className="dashboard-drawer" data-open={open} role="dialog" aria-label="导航菜单" style={{ background: 'var(--background)' }}>
        <button className="dashboard-drawer-close" onClick={onClose} aria-label="关闭菜单">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        <div style={{ padding: '20px 20px 12px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src="../../assets/logo.svg" alt="" style={{ height: 28 }} />
            <span translate="no" style={{ font: '700 16px/1 var(--font-sans)' }}>
              LexSeek<span style={{ color: 'var(--muted-foreground)', fontWeight: 400, margin: '0 5px' }}>｜</span><span style={{ fontWeight: 600 }}>法索 AI</span>
            </span>
          </div>
        </div>
        <nav style={{ flex: 1, padding: '12px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {MARKETING_LINKS.map(l => {
            const active = current === l.key;
            return (
              <a key={l.key} href={l.to} data-hover="nav" style={{
                padding: '12px 14px', borderRadius: 8, textDecoration: 'none',
                font: active ? '600 15px/1 var(--font-sans)' : '500 15px/1 var(--font-sans)',
                color: active ? 'var(--primary)' : 'var(--foreground)',
                background: active ? 'color-mix(in srgb, var(--primary) 10%, transparent)' : 'transparent',
              }}>{l.label}</a>
            );
          })}
        </nav>
        <div style={{ padding: 16, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <a href="../auth/index.html" style={{
            padding: '11px 16px', borderRadius: 8, textAlign: 'center',
            border: '1px solid var(--border)', color: 'var(--foreground)',
            font: '500 14px/1 var(--font-sans)', textDecoration: 'none',
          }}>登录</a>
          <a href="../auth/index.html" data-hover="press" style={{
            padding: '11px 16px', borderRadius: 8, textAlign: 'center',
            background: 'linear-gradient(135deg, #1E9EED 0%, #090380 100%)', color: '#fff',
            font: '600 14px/1 var(--font-sans)', textDecoration: 'none',
            boxShadow: '0 8px 20px -8px rgba(9,3,128,0.4)',
          }}>免费注册</a>
        </div>
      </aside>
    </React.Fragment>
  );
}

Object.assign(window, { MarketingNav, MarketingMobileDrawer });
