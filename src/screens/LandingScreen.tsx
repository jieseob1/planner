import { Capacitor } from '@capacitor/core';
import { ArrowRight, CalendarClock, Check, CircleAlert, Play, Target } from 'lucide-react';
import { Link, Navigate } from 'react-router-dom';
import goalsDesktop from '../../docs/screenshots/goals-desktop.jpg';
import plannerDesktop from '../../docs/screenshots/planner-desktop.jpg';
import reviewDesktop from '../../docs/screenshots/review-desktop.jpg';
import todayDesktop from '../../docs/screenshots/today-desktop.jpg';
import '../landing.css';

const howItWorks = [
  ['01', '분기에 낼 결과를 적습니다', '“기술 글 6개 발행”처럼 완료 여부를 확인할 수 있는 결과 하나를 정합니다.'],
  ['02', '결과를 주간 시간에 배치합니다', '필요 시간과 가용 시간을 비교하고, 이번 주 빈 시간에 다음 행동을 놓습니다.'],
  ['03', '오늘은 한 가지만 끝냅니다', '오늘 화면은 배치된 블록 중 지금 시작할 하나를 가장 먼저 보여줍니다.']
];

const values = [
  ['장기 계획이 오늘의 행동과 연결됩니다', '모든 작업에 연간 방향과 분기 결과가 붙어 있어 지금 하는 일의 이유를 잃지 않습니다.'],
  ['단순한 기록이 아니라 계획을 운영합니다', '시간이 부족하면 계획하는 순간에 알려주고 범위 축소·기한 연장·중단을 결정하게 합니다.'],
  ['실행과 회고가 하나의 순환을 만듭니다', '완료와 미완료, 실제 시간을 다음 주 TOP 3와 계획에 다시 반영합니다.']
];

function ProductShot({
  src,
  alt,
  label,
  caption,
  primary = false
}: {
  src: string;
  alt: string;
  label: string;
  caption: string;
  primary?: boolean;
}) {
  return (
    <figure className={primary ? 'landing-product-shot landing-product-shot--primary' : 'landing-product-shot'}>
      <div className="landing-product-shot__bar">
        <i /><i /><i />
        <span>Goals to Today · {label}</span>
      </div>
      <img src={src} alt={alt} loading={primary ? 'eager' : 'lazy'} />
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

export function LandingScreen() {
  if (Capacitor.isNativePlatform()) return <Navigate to="/today" replace />;

  return (
    <div id="top" className="landing-page landing-page--intuitive">
      <a className="landing-skip-link" href="#landing-main">본문으로 건너뛰기</a>
      <header className="landing-header">
        <div className="landing-container landing-header__inner">
          <a className="landing-brand" href="#top" aria-label="Goals to Today 랜딩 페이지 처음으로 이동">
            <img src="/planner-mark.svg" alt="" aria-hidden="true" />
            <strong>Goals to Today</strong>
            <span>BETA</span>
          </a>
          <nav className="landing-nav" aria-label="랜딩 페이지 메뉴">
            <a href="#how">사용 방법</a>
            <a href="#values">핵심 가치</a>
            <a href="#trust">출시 상태</a>
          </nav>
          <Link className="landing-button landing-button--primary landing-header__cta" to="/today">웹앱 바로 시작</Link>
        </div>
      </header>

      <main id="landing-main">
        <section className="landing-hero landing-hero--concise" aria-labelledby="landing-title">
          <div className="landing-container">
            <p className="landing-flow-chip">연간 방향 → 분기 결과 → 주간 계획 → 오늘 실행 → 주간 회고</p>
            <h1 id="landing-title">
              <span>오늘 하는 일이 올해의 목표와 연결되어 있나요?</span>
              1년짜리 목표를<br />오늘 끝낼 한 줄로 내려보냅니다.
            </h1>
            <p className="landing-hero__lead">Goals to Today는 결과를 주간 시간표에 배치하고, 남은 시간이 부족하면 계획하는 순간에 알려줍니다.</p>
            <div className="landing-actions">
              <Link className="landing-button landing-button--primary" to="/today">웹앱 바로 시작</Link>
              <a className="landing-button landing-button--secondary" href="#product-demo">제품 화면 둘러보기</a>
            </div>
            <ul className="landing-assurances" aria-label="무료 베타 안내">
              <li>베타 기간 자동 결제 없음</li>
              <li>카드 등록 없음</li>
              <li>데이터 내보내기와 삭제 지원</li>
            </ul>

            <div id="product-demo" className="landing-demo" aria-label="실제 제품 화면 예시">
              <ProductShot
                primary
                src={todayDesktop}
                alt="Goals to Today 오늘 실행 화면"
                label="오늘 실행"
                caption="오늘의 가장 중요한 한 가지와 바로 이어갈 시간이 한 화면에서 보입니다."
              />
              <aside className="landing-demo__focus">
                <p>오늘의 가장 중요한 한 가지</p>
                <span>백엔드 포트폴리오 완성 › Redis Streams 배포</span>
                <strong>장애 복구 흐름 다이어그램 작성</strong>
                <small>예상 1시간 30분 · 3회 이월</small>
                <button type="button" disabled><Play size={17} fill="currentColor" /> 지금 시작</button>
              </aside>
            </div>
          </div>
        </section>

        <section id="how" className="landing-section landing-section--compact" aria-labelledby="how-title">
          <div className="landing-container">
            <p className="landing-kicker">HOW IT WORKS</p>
            <h2 id="how-title">세 번만 정하면 오늘 할 일이 정해집니다.</h2>
            <ol className="landing-how-list">
              {howItWorks.map(([number, title, description]) => (
                <li key={number}>
                  <span>{number}</span>
                  <div><h3>{title}</h3><p>{description}</p></div>
                </li>
              ))}
            </ol>

            <div className="landing-proof-grid landing-proof-grid--three">
              <article>
                <div className="landing-proof-grid__icon"><Target size={19} /></div>
                <h3>할 일마다 상위 목표가 붙어 있습니다</h3>
                <p>연간 방향 › 분기 결과 › 다음 행동의 연결이 작업 줄마다 보입니다.</p>
                <ProductShot src={goalsDesktop} alt="Goals to Today 목표와 지표 화면" label="목표" caption="연간 방향과 분기 결과를 카드로 확인합니다." />
              </article>
              <article>
                <div className="landing-proof-grid__icon"><CircleAlert size={19} /></div>
                <h3>시간이 부족하면 계획할 때 알려줍니다</h3>
                <p>초과 시간을 숫자로 보여주고 범위 축소·연장·중단 선택지를 함께 제공합니다.</p>
                <ProductShot src={plannerDesktop} alt="Goals to Today 주간 계획 화면" label="주간 계획" caption="필요 시간과 가용 시간을 비교해 배치합니다." />
              </article>
              <article>
                <div className="landing-proof-grid__icon"><CalendarClock size={19} /></div>
                <h3>회고가 다음 주 계획으로 이어집니다</h3>
                <p>주간 회고에서 선택한 TOP 3가 다음 주 계획의 시작점이 됩니다.</p>
                <ProductShot src={reviewDesktop} alt="Goals to Today 주간 회고 화면" label="주간 회고" caption="감상문 대신 다음 행동을 결정합니다." />
              </article>
            </div>
          </div>
        </section>

        <section id="values" className="landing-section landing-values landing-values--concise" aria-labelledby="values-title">
          <div className="landing-container">
            <p className="landing-kicker">핵심 가치</p>
            <h2 id="values-title">Goals to Today가 남기는 세 가지</h2>
            <div className="landing-values__grid">
              {values.map(([title, description], index) => (
                <article key={title}>
                  <span>0{index + 1}</span>
                  <h3>{title}</h3>
                  <p>{description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="landing-section landing-tool-purpose" aria-labelledby="compare-title">
          <div className="landing-container landing-tool-purpose__grid">
            <div>
              <p className="landing-kicker">도구 비교</p>
              <h2 id="compare-title">쓰는 목적이 다릅니다</h2>
            </div>
            <p>메모는 생각을 남기고, 투두 앱은 오늘의 완료를 돕고, 캘린더는 시간을 지킵니다. Goals to Today는 장기 계획을 오늘 실행으로 옮기고 그 결과를 다음 계획에 반영하는 구간을 맡습니다.</p>
          </div>
        </section>

        <section id="trust" className="landing-final-cta landing-final-cta--concise" aria-labelledby="start-title">
          <div className="landing-container landing-final-cta__grid">
            <div>
              <p className="landing-kicker">지금 시작</p>
              <h2 id="start-title">이번 주의 첫 한 줄부터 연결해 보세요</h2>
              <p>하나의 결과, 하나의 다음 행동, 하나의 시간 블록으로 시작합니다.</p>
              <Link className="landing-button landing-button--primary" to="/today">웹앱 바로 시작</Link>
            </div>
            <dl className="landing-release-list" aria-label="현재 제공 및 준비 중인 기능">
              <div><dt>웹 · PWA</dt><dd><Check size={14} /> 사용 가능</dd></div>
              <div><dt>계정 로그인 · 회원 탈퇴</dt><dd><Check size={14} /> 제공 중</dd></div>
              <div><dt>Google Calendar 공개 연동</dt><dd>준비 중</dd></div>
              <div><dt>iOS · Android 정식 앱</dt><dd>준비 중</dd></div>
            </dl>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-container landing-footer__inner">
          <span>Goals to Today · 베타</span>
          <nav aria-label="서비스 정책"><Link to="/privacy">개인정보 처리방침</Link><Link to="/terms">이용약관</Link></nav>
          <a href="#top">맨 위로 <ArrowRight size={14} /></a>
        </div>
      </footer>
    </div>
  );
}
