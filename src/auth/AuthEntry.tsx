import { useState } from 'react';
import { ArrowRight, CalendarDays, Check, LockKeyhole } from 'lucide-react';
import { Link } from 'react-router-dom';
import { FocusAlert } from '../components/FocusAlert';
import './auth-entry.css';

interface AuthEntryProps {
  onLogin: () => Promise<void>;
  disabled?: boolean;
  message?: string;
}

export function AuthEntry({ onLogin, disabled = false, message = '' }: AuthEntryProps) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const start = async () => {
    if (busy || disabled) return;
    setBusy(true);
    setFailure('');
    try { await onLogin(); }
    catch { setFailure('로그인을 시작하지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요.'); }
    finally { setBusy(false); }
  };
  return (
    <main className="gtt-signin">
      <header className="gtt-signin__header">
        <Link to="/" className="gtt-signin__brand"><img src="/planner-mark.svg" alt="" />Goals to Today</Link>
        <Link to="/" className="gtt-signin__home">서비스 둘러보기 <ArrowRight size={15} aria-hidden="true" /></Link>
      </header>
      <div className="gtt-signin__layout">
        <section className="gtt-signin__story" aria-labelledby="signin-story-title">
          <span className="gtt-signin__eyebrow">작은 실행이 쌓이는 곳</span>
          <h2 id="signin-story-title">큰 목표도,<br />오늘 한 칸부터.</h2>
          <p>할 일을 적고, 원하는 시간에 놓으세요.<br />목표는 필요할 때 연결하면 됩니다.</p>
          <figure className="gtt-signin__preview">
            <figcaption><span><CalendarDays size={17} aria-hidden="true" /> 나의 하루</span><small>화면 예시</small></figcaption>
            <div className="gtt-signin__sample"><time>09:00</time><div className="gtt-signin__sample-block"><strong>가장 중요한 일에 집중</strong><span>09:00 – 10:00</span></div></div>
            <div className="gtt-signin__sample"><time>10:00</time><div className="gtt-signin__sample-free">비워 둔 시간도 나의 계획</div></div>
            <div className="gtt-signin__sample"><time>11:00</time><div className="gtt-signin__sample-done"><Check size={16} aria-hidden="true" /><span>가볍게 산책하기</span></div></div>
          </figure>
          <p className="gtt-signin__caption">Todo · 캘린더 · 목표를 한 곳에서</p>
        </section>
        <section className="gtt-signin__card" aria-labelledby="auth-title">
          <span className="gtt-signin__welcome">WELCOME BACK</span>
          <h1 id="auth-title">계획을 실행으로 <br />연결하세요</h1>
          <p className="gtt-signin__description">오늘의 할 일부터 시작해 보세요.<br />웹과 앱에서 같은 계획을 이어갈 수 있어요.</p>
          {(failure || message) && <FocusAlert message={failure || message} className="gtt-signin__error" />}
          <button className="gtt-signin__submit" type="button" disabled={busy || disabled} aria-busy={busy} onClick={() => void start()}>
            {busy ? '로그인 페이지를 여는 중…' : '로그인하고 시작하기'}<ArrowRight size={18} aria-hidden="true" />
          </button>
          <p className="gtt-signin__new">처음 오셨나요? 다음 화면에서 회원가입할 수 있어요.</p>
          <div className="gtt-signin__security"><LockKeyhole size={15} aria-hidden="true" /><span>내 계정으로 안전하게 로그인</span></div>
          <div className="gtt-signin__divider" />
          <p className="gtt-signin__choice"><Check size={16} aria-hidden="true" />목표를 만들지 않아도 사용할 수 있어요.</p>
          <p className="gtt-signin__choice"><Check size={16} aria-hidden="true" />일정과 할 일을 자유롭게 관리하세요.</p>
        </section>
      </div>
      <footer className="gtt-signin__footer"><span>한 번에 한 걸음, 오늘부터.</span><nav aria-label="로그인 법적 고지"><Link to="/privacy">개인정보 처리방침</Link><Link to="/terms">이용약관</Link></nav></footer>
    </main>
  );
}
