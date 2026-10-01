import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ShoppingBag, LogOut, Menu, X, ChevronDown, Bell, Search, Store } from 'lucide-react';
import { useStore } from '../lib/storeContext';
import { navigation } from '../lib/navigation';
import './Workspace.css';

export const Brand = () => (
  <span className="brand">
    <span className="brand-mark">
      <ShoppingBag size={25} strokeWidth={1.7} />
    </span>
    <span>
      suki<span className="brand-dot">.</span>
    </span>
  </span>
);
export default function Layout() {
  const { user, data, logout } = useStore(),
    [open, setOpen] = useState(false),
    [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 900px)').matches),
    [query, setQuery] = useState(''),
    navigate = useNavigate(),
    location = useLocation();
  const sidebar = useRef(null);
  const menu = useRef(null);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 900px)');
    const resize = () => {
      setMobile(media.matches);
      setOpen(false);
    };
    media.addEventListener('change', resize);
    return () => media.removeEventListener('change', resize);
  }, []);
  useEffect(() => {
    if (!mobile || !open) return;
    const node = sidebar.current;
    const trigger = menu.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    node.scrollTop = 0;
    const controls = () => [...node.querySelectorAll('a[href], button:not(:disabled)')];
    controls()[0]?.focus({ preventScroll: true });
    const handleKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
      }
      if (event.key === 'Tab') {
        const items = controls();
        const first = items[0],
          last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKey);
      if (window.matchMedia('(max-width: 900px)').matches) trigger?.focus({ preventScroll: true });
    };
  }, [mobile, open]);
  const nav = navigation.filter((n) => n.roles.includes(user.role));
  const current = navigation.find((n) => n.path === location.pathname);
  const low = data.products.filter(
    (p) => p.active && p.stock <= (p.min_stock ?? data.settings.low_stock_threshold),
  ).length;
  const initials = user.name
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('');
  return (
    <div className="app-shell">
      {mobile && open && (
        <button
          className="sidebar-backdrop"
          aria-hidden="true"
          tabIndex={-1}
          onClick={() => setOpen(false)}
        />
      )}
      <aside
        ref={sidebar}
        id="store-navigation"
        className={`sidebar ${open ? 'open' : ''}`}
        inert={mobile && !open}
        aria-hidden={mobile && !open ? true : undefined}
        role={mobile ? 'dialog' : undefined}
        aria-modal={mobile && open ? true : undefined}
        aria-label="Store navigation"
      >
        <div className="sidebar-brand">
          <Brand />
          <button
            className="mobile-only icon-button"
            onClick={() => setOpen(false)}
            aria-label="Close navigation"
          >
            <X />
          </button>
        </div>
        <div className="store-switch">
          <span className="store-icon">
            <Store size={20} />
          </span>
          <div>
            <strong>{data.settings.name}</strong>
            <small>Main store</small>
          </div>
          <ChevronDown size={15} />
        </div>
        <nav>
          {['WORKSPACE', 'MANAGEMENT', 'INSIGHTS & ADMIN'].map(
            (group) =>
              nav.some((n) => n.group === group) && (
                <div className="nav-group" key={group}>
                  <span className="nav-label">{group}</span>
                  {nav
                    .filter((n) => n.group === group)
                    .map(({ path, label, icon: Icon }) => (
                      <NavLink
                        key={path}
                        to={path}
                        end={path === '/'}
                        onClick={() => setOpen(false)}
                      >
                        <Icon size={19} strokeWidth={1.7} />
                        <span>{label}</span>
                        {path === '/inventory' && low > 0 && <em>{low}</em>}
                      </NavLink>
                    ))}
                </div>
              ),
          )}
        </nav>
        <div className="sidebar-bottom">
          <button className="logout" onClick={logout}>
            <LogOut size={17} />
            Sign out
          </button>
          <span className="sidebar-version">
            SUKI POS <i /> V1.0
          </span>
        </div>
      </aside>
      <div className="main-wrap" inert={mobile && open}>
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              ref={menu}
              className="icon-button mobile-only"
              onClick={() => setOpen(true)}
              aria-label="Open navigation"
              aria-expanded={open}
              aria-controls="store-navigation"
            >
              <Menu />
            </button>
            <span>Workspace</span>
            <span className="breadcrumb-slash">/</span>
            <strong>{current?.label || 'My account'}</strong>
          </div>
          <div className="topbar-actions">
            <form
              className="quick-search"
              onSubmit={(e) => {
                e.preventDefault();
                navigate(
                  `${user.role === 'cashier' ? '/pos' : '/products'}?q=${encodeURIComponent(query)}`,
                );
                setQuery('');
              }}
            >
              <Search size={16} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Find a product"
                placeholder="Find a product…"
              />
              <kbd>↵</kbd>
            </form>
            {user.role !== 'cashier' && (
              <button
                className="notification-button"
                aria-label={`${low} stock alerts`}
                onClick={() => navigate('/inventory?status=low')}
              >
                <Bell size={20} />
                {low > 0 && <i />}
              </button>
            )}
            <span className="topbar-divider" />
            <button
              aria-label="My account"
              className="profile"
              onClick={() => navigate('/account')}
            >
              <span className="avatar">{initials}</span>
              <span>
                <strong>{user.name.split(' ')[0]}</strong>
                <small>
                  {
                    {
                      admin: 'Store owner',
                      manager: 'Manager',
                      cashier: 'Cashier',
                      inventory: 'Inventory staff',
                    }[user.role]
                  }
                </small>
              </span>
              <ChevronDown size={14} />
            </button>
          </div>
        </header>
        <main className={location.pathname === '/pos' ? 'main-content pos-main' : 'main-content'}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
