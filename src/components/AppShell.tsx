import { useEffect, useRef, useState } from 'react';
import { CalendarDays, CheckCircle2, Compass, Flag, Layers3, LogOut, Plus, RotateCcw, Settings, Target } from 'lucide-react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { Modal } from './Modal';
import { SaveStatus } from './SaveStatus';
import { usePlanner } from '../state/PlannerProvider';
import { useAuth } from '../auth/AuthProvider';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';

const navItems = [
  { to: '/today', label: '오늘', contextLabel: '오늘 실행', icon: CheckCircle2 },
  { to: '/planner', label: '계획', contextLabel: '주간 계획', icon: CalendarDays },
  { to: '/goals', label: '목표', contextLabel: '목표와 지표', icon: Target },
  { to: '/review', label: '회고', contextLabel: '주간 회고', icon: Flag },
  { to: '/plans', label: '계획함', contextLabel: '연간·분기 계획', icon: Layers3 }
];

const journeyItems = [
  { to: '/goals', label: '연간·분기 방향', paths: ['/goals'] },
  { to: '/planner', label: '주간 계획', paths: ['/planner'] },
  { to: '/today', label: '오늘 실행', paths: ['/today'] },
  { to: '/review', label: '주간 회고', paths: ['/review'] }
];

export function AppShell() {
  const { hasActivePlan, isOnline, resetPlanner } = usePlanner();
  const { logout } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const pendingCaptureFocus = useRef(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState('');
  const isToday = pathname === '/today';
  const currentNavItem = navItems.find((item) => item.to === pathname)
    ?? (pathname === '/settings' ? { contextLabel: '설정과 연동' } : navItems[0]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });

    if (pathname !== '/today' || !pendingCaptureFocus.current) return;
    pendingCaptureFocus.current = false;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById('quick-capture')?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pathname]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let active = true;
    let removeListener: (() => Promise<void>) | undefined;
    void PushNotifications.addListener('pushNotificationActionPerformed', (event) => {
      const target = event.notification.data?.targetPath;
      if (typeof target === 'string' && target.startsWith('/') && !target.startsWith('//')) navigate(target);
    }).then((handle) => {
      if (!active) void handle.remove();
      else removeListener = handle.remove;
    });
    return () => {
      active = false;
      if (removeListener) void removeListener();
    };
  }, [navigate]);

  const focusQuickCapture = () => {
    if (pathname === '/today') {
      document.getElementById('quick-capture')?.focus();
      return;
    }
    pendingCaptureFocus.current = true;
    navigate('/today');
  };

  const confirmPlannerReset = async () => {
    setResetBusy(true);
    setResetError('');
    const reset = await resetPlanner();
    setResetBusy(false);
    if (!reset) {
      setResetError(isOnline
        ? '서버에서 최신 계획을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.'
        : '오프라인에서는 서버 계획을 안전하게 초기화할 수 없습니다. 연결 후 다시 시도해 주세요.');
      return;
    }
    setResetConfirmOpen(false);
    navigate('/onboarding', { replace: true });
  };

  return (
    <div className={isToday ? 'app-shell app-shell--today' : 'app-shell'}>
      <a className="skip-link" href="#main-content">본문으로 건너뛰기</a>
      <aside className="sidebar" aria-label="Goals to Today">
        <NavLink className="brand" to="/today" aria-label="Goals to Today 오늘로 이동">
          <span className="brand__mark" aria-hidden="true"><Compass size={20} /></span>
          <strong className="brand__name">GOALS TO TODAY</strong>
        </NavLink>

        <nav className="sidebar__nav" aria-label="주 메뉴">
          {navItems.map(({ to, label, contextLabel, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              aria-label={`${label} · ${contextLabel}`}
              className={({ isActive }) => clsx('nav-item', isActive && 'nav-item--active')}
            >
              <Icon size={20} strokeWidth={1.9} aria-hidden="true" />
              <span className="nav-item__copy">
                <strong className="nav-item__label">{label}</strong>
                <small>{contextLabel}</small>
              </span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar__today-footer">
          <NavLink
            to="/settings"
            aria-label="설정 · 설정과 연동"
            className={({ isActive }) => clsx('nav-item', isActive && 'nav-item--active')}
          >
            <Settings size={20} strokeWidth={1.9} aria-hidden="true" />
            <span className="nav-item__copy">
              <strong className="nav-item__label">설정</strong>
              <small>설정과 연동</small>
            </span>
          </NavLink>
          <button
            className="capture-button capture-button--rail"
            type="button"
            onClick={focusQuickCapture}
            aria-label="빠른 수집"
          >
            <Plus size={21} aria-hidden="true" />
            <span>빠른 수집</span>
          </button>
        </div>
      </aside>

      <div className={isToday ? 'app-frame app-frame--today' : 'app-frame'}>
        <header className="top-bar app-topbar">
          <div className="top-bar__context">
            <span className="top-bar__product">GOALS TO TODAY</span>
            <span className="top-bar__separator" aria-hidden="true">/</span>
            <strong>{currentNavItem.contextLabel}</strong>
          </div>
          <div className="top-bar__actions">
            {!isToday && <SaveStatus />}
            <button className="icon-button" type="button" onClick={() => navigate('/settings')} aria-label="설정과 연동">
              <Settings size={16} aria-hidden="true" />
            </button>
            {hasActivePlan ? (
              <button
                className="icon-button shell-reset"
                type="button"
                onClick={() => {
                  setResetError('');
                  setResetConfirmOpen(true);
                }}
                aria-label="현재 계획 초기화"
                aria-haspopup="dialog"
                aria-expanded={resetConfirmOpen}
              >
                <RotateCcw size={16} aria-hidden="true" />
              </button>
            ) : null}
            <button className="icon-button" type="button" onClick={() => void logout()} aria-label="로그아웃">
              <LogOut size={16} aria-hidden="true" />
            </button>
          </div>
        </header>
        {hasActivePlan && !['/plans', '/settings'].includes(pathname) ? (
          <nav className="plan-journey" aria-label="연간 목표에서 주간 회고까지의 계획 흐름">
            {journeyItems.map((item, index) => (
              <NavLink
                key={`${item.to}-${item.label}`}
                to={item.to}
                className={clsx('plan-journey__item', item.paths.includes(pathname) && 'is-active')}
                aria-current={item.paths.includes(pathname) ? 'step' : undefined}
              >
                <span>{index + 1}</span>
                {item.label}
              </NavLink>
            ))}
          </nav>
        ) : null}
        <main id="main-content" className="main-content" tabIndex={-1}>
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
          eyebrow="계획 관리"
          title="현재 계획을 초기화할까요?"
          description="현재 활성 계획과 실행 화면의 목표, 작업, 시간 기록, 회고를 보관하고 새 계획 온보딩으로 이동합니다. 이 작업은 되돌릴 수 없습니다."
          onClose={() => {
            if (!resetBusy) setResetConfirmOpen(false);
          }}
        >
          {resetError ? <p className="form-error" role="alert">{resetError}</p> : null}
          <div className="modal__actions">
            <button
              className="button button--secondary"
              type="button"
              data-autofocus
              disabled={resetBusy}
              onClick={() => setResetConfirmOpen(false)}
            >
              취소
            </button>
            <button className="button button--warning" type="button" disabled={resetBusy} onClick={() => void confirmPlannerReset()}>
              {resetBusy ? '초기화 중…' : '현재 계획 초기화'}
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
