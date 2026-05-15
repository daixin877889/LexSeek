// useTheme.jsx — Shared dark-mode hook + toggle button (used by every UI kit).
//
// Adds/removes `.dark` on <html> and persists choice to localStorage.
// Initial value comes from localStorage (key: 'lexseek-theme'), then
// from the system `prefers-color-scheme` query as a fallback.

function useTheme() {
  const [theme, setTheme] = React.useState(() => {
    if (typeof window === 'undefined') return 'light';
    const stored = localStorage.getItem('lexseek-theme');
    if (stored === 'dark' || stored === 'light') return stored;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  React.useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
    localStorage.setItem('lexseek-theme', theme);
  }, [theme]);
  return [theme, () => setTheme(t => (t === 'dark' ? 'light' : 'dark'))];
}

function ThemeToggle({ theme, onToggle, size = 36 }) {
  const isDark = theme === 'dark';
  return (
    <button
      onClick={onToggle}
      title={isDark ? '切换到浅色' : '切换到深色'}
      aria-label="切换主题"
      style={{
        width: size, height: size, padding: 0,
        background: 'transparent', border: 'none', cursor: 'pointer', borderRadius: 8,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--muted-foreground)',
        transition: 'background 0.15s, color 0.15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--muted)'; e.currentTarget.style.color = 'var(--foreground)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--muted-foreground)'; }}
    >
      {isDark
        ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
        : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>}
    </button>
  );
}

Object.assign(window, { useTheme, ThemeToggle });
