import { useEffect, useRef, useState } from 'react';
import { CalendarDays, CheckCircle2, Compass, Flag, Plus, RotateCcw, Target } from 'lucide-react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { Modal } from './Modal';
import { SaveStatus } from './SaveStatus';
import { usePlanner } from '../state/PlannerProvider';

const navItems = [
  { to: '/today', label: '오늘', desktopLabel: 'Today', contextLabel: '오늘 실행', icon: CheckCircle2 },
  { to: '/planner', label: '계획', desktopLabel: 'Planner', contextLabel: '주간 계획', icon: CalendarDays },
  { to: '/goals', label: '목표', desktopLabel: 'Goals', contextLabel: '목표와 지표', icon: Target },
  { to: '/review', label: '회고', desktopLabel: 'Review', contextLabel: '주간 회고', icon: Flag }
];

export function AppShell() {
  const { resetDemo } = usePlanner();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const pendingCaptureFocus = useRef(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const currentNavItem = navItems.find((item) => item.to === pathname) ?? navItems[0];

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });

    if (pathname !== '/today' || !pendingCaptureFocus.current) return;
    pendingCaptureFocus.current = false;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById('quick-capture')?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pathname]);

  const focusQuickCapture = () => {
    if (pathname === '/today') {
      document.getElementById('quick-capture')?.focus();
      return;
    }
    pendingCaptureFocus.current = true;
    navigate('/today');
  };

  const confirmDemoReset = () => {
    resetDemo();
    setResetConfirmOpen(false);
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">본문으로 건너뛰기</a>
      <aside className="sidebar" aria-label="Nowline">
        <NavLink className="brand" to="/today" aria-label="Nowline 오늘로 이동">
          <span className="brand__mark" aria-hidden="true"><Compass size={20} /></span>
          <strong className="brand__name">NOWLINE</strong>
        </NavLink>

        <nav className="sidebar__nav" aria-label="주 메뉴">
          {navItems.map(({ to, desktopLabel, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              aria-label={desktopLabel}
              className={({ isActive }) => clsx('nav-item', isActive && 'nav-item--active')}
            >
              <Icon size={20} strokeWidth={1.9} aria-hidden="true" />
              <span className="nav-item__label">{desktopLabel}</span>
            </NavLink>
          ))}
        </nav>

        <button
          className="capture-button capture-button--rail"
          type="button"
          onClick={focusQuickCapture}
          aria-label="빠른 수집"
        >
          <Plus size={21} aria-hidden="true" />
          <span>Capture</span>
        </button>
      </aside>

      <div className="app-frame">
        <header className="top-bar app-topbar">
          <div className="top-bar__context">
            <span className="top-bar__product">NOWLINE</span>
            <span className="top-bar__separator" aria-hidden="true">/</span>
            <strong>{currentNavItem.contextLabel}</strong>
          </div>
          <div className="top-bar__actions">
            <SaveStatus />
            <button
              className="icon-button shell-reset"
              type="button"
              onClick={() => setResetConfirmOpen(true)}
              aria-label="데모 초기화"
              aria-haspopup="dialog"
              aria-expanded={resetConfirmOpen}
            >
              <RotateCcw size={16} aria-hidden="true" />
            </button>
          </div>
        </header>
        <main id="main-content" className="main-content">
          <Outlet />
        </main>
      </div>

      <nav className="bottom-nav" aria-label="모바일 주 메뉴">
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} className={({ isActive }) => clsx('bottom-nav__item', isActive && 'bottom-nav__item--active')}>
            <Icon size={20} aria-hidden="true" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      <button className="capture-fab" type="button" onClick={focusQuickCapture} aria-label="빠른 수집">
        <Plus size={25} aria-hidden="true" />
      </button>

      {resetConfirmOpen ? (
        <Modal
          title="데모 데이터를 초기화할까요?"
          description="이 브라우저·기기에 저장한 목표, 작업, 시간 기록과 회고를 삭제하고 처음 제공된 데모 데이터로 되돌립니다. 이 작업은 되돌릴 수 없습니다."
          onClose={() => setResetConfirmOpen(false)}
        >
          <div className="modal__actions">
            <button
              className="button button--secondary"
              type="button"
              data-autofocus
              onClick={() => setResetConfirmOpen(false)}
            >
              취소
            </button>
            <button className="button button--warning" type="button" onClick={confirmDemoReset}>
              기기 데이터 초기화
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
