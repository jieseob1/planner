import { Capacitor } from '@capacitor/core';
import { Link, Navigate } from 'react-router-dom';
import goalsDesktop from '../../docs/screenshots/goals-desktop.jpg';
import plannerDesktop from '../../docs/screenshots/planner-desktop.jpg';
import reviewDesktop from '../../docs/screenshots/review-desktop.jpg';
import todayDesktop from '../../docs/screenshots/today-desktop.jpg';
import todayMobile from '../../docs/screenshots/today-mobile.jpg';
import '../landing.css';

const planSteps = [
  { label: '1년 방향', title: '시장에 증명할 백엔드 역량과 수익 기반 만들기', meta: '2026.01—12' },
  { label: '분기 결과', title: '기술 글 6개 발행', meta: '2 / 6편 · 33%' },
  { label: '다음 행동', title: '기술 글 3편 초안', meta: '예상 40분' },
  { label: '주간 시간 배치', title: '화요일 19:30 글 초안', meta: '1시간 30분 블록' },
  { label: '오늘 할 일', title: '기술 글 3편 초안 · TOP 3 중 2번', meta: '지금 시작 · 40분' }
];

const operatingFeatures = [
  ['계획 상태 확인', '변화 정체, 시간 위험, 수치 갱신 필요, 근거 없음을 결과별 상태로 표시합니다.'],
  ['진행률 확인', '현재값과 목표값 기준으로 계산합니다. 값이 없으면 0이 아니라 측정값 없음으로 씁니다.'],
  ['완료 · 미완료 구분', '완료 근거와 실제 소요 시간을 함께 남기고, 이월 횟수를 그대로 보여줍니다.'],
  ['다음 기간으로 목표 인계', '주간 리뷰에서 고른 다음 주 TOP 3가 다음 주 Planner로 그대로 넘어갑니다.'],
  ['계획별 실행 결과 확인', '결과마다 필요 시간, 계획 시간, 실제 시간을 같은 줄에서 비교합니다.'],
  ['계획 변경 근거', '계획과 결과의 상태를 보관해 무엇을 유지하고 바꿨는지 다시 확인할 수 있습니다.']
];

const reviewSteps = [
  ['01', '계획 수립', '분기 결과와 필요 시간을 정합니다.'],
  ['02', '오늘 실행', 'TOP 3를 한 번에 하나씩 기록합니다.'],
  ['03', '진행률 확인', '계획 시간과 실제 시간을 비교합니다.'],
  ['04', '주간 리뷰', '수치, 방해 요인, 다음 주 TOP 3를 정리합니다.'],
  ['05', '다음 계획 조정', '유지 · 축소 · 기한 연장 · 중단을 결정합니다.']
];

const comparisonRows = [
  ['주된 쓰임', '기록과 정리', '오늘의 완료', '시간 약속', '계획 운영'],
  ['장기 계획 관리', '가능하지만 실행과 분리됨', '제한적', '제한적', '지원'],
  ['오늘 할 일 관리', '수동 관리', '지원', '일정 중심', '지원'],
  ['상위 목표 연결', '수동 연결', '제한적', '미지원', '지원'],
  ['주간 리뷰', '직접 작성', '제한적', '미지원', '지원'],
  ['미완료 목표 인계', '수동 복사', '단순 반복', '일정 이동', '검토 후 인계'],
  ['계획 진행률', '수동 계산', '완료 개수 중심', '미지원', '계획 계층별 확인'],
  ['실행 결과의 다음 계획 반영', '수동 작업', '제한적', '미지원', '지원']
];

function BrowserShot({
  src,
  alt,
  address,
  caption,
  eager = false
}: {
  src: string;
  alt: string;
  address: string;
  caption: string;
  eager?: boolean;
}) {
  return (
    <figure className="landing-browser-shot">
      <div className="landing-browser-shot__bar"><span>{address}</span></div>
      <img src={src} alt={alt} loading={eager ? 'eager' : 'lazy'} />
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

function SectionHeading({
  id,
  eyebrow,
  number,
  title,
  description,
  quote
}: {
  id?: string;
  eyebrow: string;
  number: string;
  title: string;
  description: string;
  quote: string;
}) {
  return (
    <div className="landing-section-heading">
      <div className="landing-section-heading__meta">
        <span>{eyebrow}</span>
        <span>{number}</span>
      </div>
      <h2 id={id}>{title}</h2>
      <div className="landing-section-heading__body">
        <p>{description}</p>
        <blockquote>{quote}</blockquote>
      </div>
    </div>
  );
}

export function LandingScreen() {
  if (Capacitor.isNativePlatform()) return <Navigate to="/today" replace />;

  return (
    <div id="top" className="landing-page">
      <a className="landing-skip-link" href="#landing-main">본문으로 건너뛰기</a>
      <header className="landing-header">
        <div className="landing-container landing-header__inner">
          <a className="landing-brand" href="#top" aria-label="Goals to Today 랜딩 페이지 처음으로 이동">
            <img src="/nowline-mark.jpg" alt="" aria-hidden="true" />
            <strong>GOALS TO TODAY</strong>
          </a>
          <nav className="landing-nav" aria-label="랜딩 페이지 메뉴">
            <a href="#value-1">특장점</a>
            <a href="#compare">도구 비교</a>
            <a href="#values">핵심 가치</a>
          </nav>
          <Link className="landing-button landing-button--primary landing-header__cta" to="/today">웹앱 바로 시작</Link>
        </div>
      </header>

      <main id="landing-main">
        <section className="landing-hero" aria-labelledby="landing-title">
          <div className="landing-container">
            <p className="landing-kicker">개인 실행 플래너 · 베타</p>
            <h1 id="landing-title">오늘 하는 일이 <br />올해의 목표와 연결되어 있나요?</h1>
            <p className="landing-hero__lead">Goals to Today는 장기 목표를 오늘 실행할 수 있는 단위로 연결합니다. 1년 방향에서 시작해 분기 결과, 다음 행동, 주간 시간 배치, 오늘의 실행까지 같은 줄기 안에서 관리합니다.</p>
            <div className="landing-actions">
              <Link className="landing-button landing-button--primary" to="/today">웹앱 바로 시작</Link>
              <a className="landing-button landing-button--secondary" href="#value-1">제품 화면 먼저 보기</a>
            </div>
            <ul className="landing-assurances" aria-label="무료 베타 안내">
              <li>베타 기간 자동 결제 없음</li>
              <li>카드 등록 없음</li>
              <li>데이터 내보내기와 삭제 지원</li>
            </ul>
            <BrowserShot
              src={todayDesktop}
              alt="Goals to Today 오늘 실행 화면"
              address="goalstotoday.com/today"
              caption="오늘 실행 화면 — 계획 1시간 30분과 실제 기록을 나란히 두고, 3회 이월된 항목을 먼저 처리하게 합니다."
              eager
            />
            <div className="landing-coming-soon" role="note">
              <span>준비 중</span>
              <p>Google Calendar 공개 연동과 iOS · Android 정식 앱은 준비 중입니다. 지금은 웹과 PWA에서 사용합니다.</p>
            </div>
          </div>
        </section>

        <section id="value-1" className="landing-section landing-section--ruled" aria-labelledby="value-1-title">
          <div className="landing-container">
            <SectionHeading
              id="value-1-title"
              eyebrow="VALUE 01 · 방향을 잃지 않는다"
              number="특장점 1"
              title="장기 계획이 오늘의 행동과 연결됩니다"
              description="일반적인 메모나 투두 앱에서는 연간 목표와 오늘 할 일이 서로 분리됩니다. Goals to Today에서는 계획 계층이 하나로 연결되어, 오늘 하는 일이 어떤 장기 목표를 위한 것인지 항상 확인할 수 있습니다."
              quote="“Goals to Today는 장기 목표를 오늘 실행할 수 있는 단위로 연결합니다.”"
            />

            <div className="landing-lineage" aria-label="계획 계층 실제 데이터 예시">
              <p className="landing-lineage__label">계획 계층 · 실제 데이터 예시</p>
              <ol>
                {planSteps.map((step, index) => (
                  <li key={step.label} className={index === planSteps.length - 1 ? 'is-current' : undefined}>
                    <span className="landing-lineage__dot" aria-hidden="true" />
                    <small>{step.label}</small>
                    <strong>{step.title}</strong>
                    <span>{step.meta}</span>
                  </li>
                ))}
              </ol>
            </div>

            <div className="landing-proof-grid landing-proof-grid--split">
              <BrowserShot
                src={goalsDesktop}
                alt="Goals to Today 목표와 지표 화면"
                address="goalstotoday.com/goals"
                caption="목표와 지표 화면 — 1년 방향과 현재 분기가 한 줄로 이어지고, 분기 결과마다 현재값·목표값·다음 점검일이 붙습니다."
              />
              <figure className="landing-phone-shot">
                <img src={todayMobile} alt="Goals to Today 오늘 실행 모바일 화면" loading="lazy" />
                <figcaption>오늘 실행 화면 — 할 일마다 상위 결과가 붙어 있어, 지금 하는 일이 어느 목표의 일인지 바로 보입니다.</figcaption>
              </figure>
            </div>
          </div>
        </section>

        <section className="landing-section landing-section--ruled" aria-labelledby="value-2-title">
          <div className="landing-container">
            <SectionHeading
              id="value-2-title"
              eyebrow="VALUE 02 · 계획이 실행으로 이어진다"
              number="특장점 2"
              title="단순한 기록이 아니라 계획을 운영합니다"
              description="Goals to Today의 계획은 한 번 작성하고 방치하는 문서가 아닙니다. 필요 시간과 가용 시간을 비교하고, 남은 용량을 경고하고, 계획을 다시 확정하는 과정이 제품 안에 있습니다."
              quote="“계획은 작성하는 순간보다, 운영하는 과정이 더 중요합니다.”"
            />
            <div className="landing-operation-grid">
              {operatingFeatures.map(([title, description]) => (
                <article key={title}>
                  <h3>{title}</h3>
                  <p>{description}</p>
                </article>
              ))}
            </div>
            <BrowserShot
              src={plannerDesktop}
              alt="Goals to Today 주간 계획 화면"
              address="goalstotoday.com/planner"
              caption="주간 계획 화면 — 계획된 용량과 결과에 필요한 시간을 비교해 계획과 현실의 차이를 먼저 말합니다."
            />
          </div>
        </section>

        <section className="landing-section landing-section--ruled" aria-labelledby="value-3-title">
          <div className="landing-container">
            <SectionHeading
              id="value-3-title"
              eyebrow="VALUE 03 · 실행할수록 계획이 정확해진다"
              number="특장점 5"
              title="실행과 회고가 하나의 순환을 만듭니다"
              description="일반적인 투두 앱이 완료 여부에서 끝난다면, Goals to Today는 실행 결과를 다음 계획에 반영합니다. 주간 리뷰에서 정리한 수치와 방해 요인, 다음 주 TOP 3가 다음 주 계획의 출발점이 됩니다."
              quote="“완료 체크에서 끝나지 않는 계획 관리.”"
            />
            <ol className="landing-cycle">
              {reviewSteps.map(([number, title, description], index) => (
                <li key={number} className={index === reviewSteps.length - 1 ? 'is-current' : undefined}>
                  <small>{number}</small>
                  <strong>{title}</strong>
                  <span>{description}</span>
                </li>
              ))}
            </ol>
            <div className="landing-cycle__return"><span>06 · 다시 실행</span> — 조정한 계획이 곧 다음 주 오늘 할 일이 됩니다</div>
            <p className="landing-cycle__result">실행 결과가 다음 주의 계획을 더 정확하게 만듭니다.</p>
            <BrowserShot
              src={reviewDesktop}
              alt="Goals to Today 주간 회고 화면"
              address="goalstotoday.com/review"
              caption="주간 회고 화면 — 결과 수치 갱신, 방해 요인, 다음 주 TOP 3, 계획 확정이 하나의 흐름으로 이어집니다."
            />
          </div>
        </section>

        <section className="landing-advantages" aria-labelledby="advantages-title">
          <div className="landing-container">
            <p className="landing-kicker">특장점 3 · 4 · 6 · 7</p>
            <h2 id="advantages-title">계획을 계속 쓰게 만드는 네 가지</h2>
            <div className="landing-advantages__grid">
              <article>
                <small>특장점 3</small>
                <h3>계획과 실행 사이의 이유를 잃지 않습니다</h3>
                <p>오늘 할 일을 보면서 왜 해야 하는지, 어떤 주간 목표와 연결되는지, 어떤 분기 결과에 기여하는지, 완료하면 계획이 얼마나 진행되는지 확인할 수 있습니다.</p>
                <div className="landing-context-example">
                  <span>할 일에 붙는 맥락</span>
                  <strong>백엔드 포트폴리오 완성 › Redis Streams 배포 › 장애 복구 흐름 다이어그램 작성</strong>
                  <small>1시간 30분 · 완료 시 결과 진행률 2/4단계 → 3/4단계</small>
                </div>
                <blockquote>“해야 할 일뿐 아니라, 해야 하는 이유까지 관리하세요.”</blockquote>
              </article>
              <article>
                <small>특장점 4</small>
                <h3>미완료 항목도 다음 계획의 근거가 됩니다</h3>
                <p>완료하지 못한 일을 삭제하거나 무조건 다음 날로 넘기지 않습니다. 이월된 항목은 몇 번 밀렸는지 함께 보여주고, 검토한 뒤 다음 처리를 고르게 합니다.</p>
                <div className="landing-rollover-example">
                  <strong>3회 이월 · 장애 복구 흐름 다이어그램 작성</strong>
                  <span>그대로 미루기보다 범위를 줄이거나 날짜를 바꾸거나 중단을 결정하세요.</span>
                </div>
                <ul className="landing-choice-list" aria-label="미완료 항목 처리 선택지">
                  {['다음 주로 인계', '일정 변경', '우선순위 변경', '계획에서 제외', '상위 목표 재검토'].map((choice) => <li key={choice}>{choice}</li>)}
                </ul>
                <blockquote>“하지 못한 일도 다음 계획을 더 정확하게 만드는 데이터가 됩니다.”</blockquote>
              </article>
              <article>
                <small>특장점 6</small>
                <h3>여러 갈래의 계획을 함께 관리합니다</h3>
                <p>업무, 개인 프로젝트, 건강, 학습처럼 서로 다른 갈래를 상위 목표로 나눠 관리하고, 오늘 화면에서는 실제로 해야 할 일만 한곳에서 확인합니다.</p>
                <ul className="landing-plan-list">
                  <li><span>개인 서비스 출시</span><strong>결과 2개</strong></li>
                  <li><span>이직 준비</span><strong>결과 1개</strong></li>
                  <li><span>운동과 건강</span><strong>결과 1개</strong></li>
                  <li><span>외국어 학습</span><strong>결과 1개</strong></li>
                </ul>
                <blockquote>“계획은 나누고, 오늘의 실행은 한곳에서 관리하세요.”</blockquote>
              </article>
              <article>
                <small>특장점 7</small>
                <h3>내 데이터를 내가 통제합니다</h3>
                <p>기록은 기기에 먼저 저장되고 서버와 동기화됩니다. 무엇을 가져가고 무엇을 지울지는 사용자가 결정합니다.</p>
                <ul className="landing-control-list">
                  {['사용자별 데이터 분리', '데이터 내보내기', '계획과 기록 전체 삭제', '계정 로그인과 회원 탈퇴', '베타 기간 자동 결제 없음', '카드 등록 없음'].map((item) => <li key={item}>{item}</li>)}
                </ul>
                <blockquote>“내 계획과 기록은 언제든 내보내고 삭제할 수 있습니다.”</blockquote>
              </article>
            </div>
          </div>
        </section>

        <section id="compare" className="landing-section landing-section--ruled landing-comparison" aria-labelledby="compare-title">
          <div className="landing-container">
            <div className="landing-comparison__intro">
              <div>
                <p className="landing-kicker">도구 비교</p>
                <h2 id="compare-title">쓰는 목적이 다릅니다</h2>
              </div>
              <p>메모 도구는 생각을 남기고, 투두 앱은 오늘의 완료를 돕고, 캘린더는 약속한 시간을 지킵니다. Goals to Today는 그중 어느 것도 대체하지 않고, 장기 계획을 오늘의 실행으로 옮기고 그 결과를 다음 계획에 반영하는 구간을 맡습니다.</p>
            </div>
            <p className="landing-scroll-hint">표를 좌우로 움직여 비교할 수 있습니다.</p>
            <div className="landing-table-scroll" tabIndex={0} aria-label="도구 특성 비교표, 가로 스크롤 가능">
              <table>
                <thead>
                  <tr><th scope="col">구분</th><th scope="col">메모 · 문서 도구</th><th scope="col">일반 투두 앱</th><th scope="col">캘린더</th><th scope="col">Goals to Today</th></tr>
                </thead>
                <tbody>
                  {comparisonRows.map((row) => (
                    <tr key={row[0]}>{row.map((cell, index) => index === 0 ? <th key={cell} scope="row">{cell}</th> : <td key={`${row[0]}-${cell}-${index}`}>{cell}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="landing-comparison__note">각 도구의 일반적인 사용 목적을 기준으로 정리했습니다. 특정 제품의 기능 범위는 버전과 설정에 따라 다를 수 있습니다.</p>
          </div>
        </section>

        <section id="values" className="landing-values" aria-labelledby="values-title">
          <div className="landing-container">
            <p className="landing-kicker">핵심 가치</p>
            <h2 id="values-title">Goals to Today가 남기는 세 가지</h2>
            <ol>
              <li><small>01</small><h3>방향을 잃지 않는다</h3><p>장기 목표와 오늘 할 일이 연결되어 지금 하는 일의 목적을 확인할 수 있습니다.</p></li>
              <li><small>02</small><h3>계획이 실행으로 이어진다</h3><p>분기 · 주간 계획을 오늘 실행할 수 있는 단위로 구체화합니다.</p></li>
              <li><small>03</small><h3>실행할수록 계획이 정확해진다</h3><p>완료 · 미완료 결과와 주간 리뷰를 다음 계획에 반영합니다.</p></li>
            </ol>
          </div>
        </section>

        <section id="start" className="landing-final-cta" aria-labelledby="start-title">
          <div className="landing-container landing-final-cta__grid">
            <div>
              <p className="landing-kicker">지금 시작</p>
              <h2 id="start-title">이번 주의 첫 한 줄부터 연결해 보세요</h2>
              <p>하나의 결과, 하나의 다음 행동, 하나의 시간 블록으로 시작합니다. 설치 없이 웹에서 바로 사용할 수 있습니다.</p>
              <div className="landing-final-cta__action">
                <Link className="landing-button landing-button--primary" to="/today">웹앱 바로 시작</Link>
                <span>카드 등록 없음 · 베타 기간 자동 결제 없음</span>
              </div>
            </div>
            <div className="landing-release-list" aria-label="현재 제공 및 준비 중인 기능">
              <p>출시 상태</p>
              <dl>
                <div><dt>Google Calendar 공개 연동</dt><dd>준비 중</dd></div>
                <div><dt>iOS · Android 정식 앱</dt><dd>준비 중</dd></div>
                <div><dt>계정 로그인 · 회원 탈퇴</dt><dd>제공 중</dd></div>
              </dl>
            </div>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-container landing-footer__inner">
          <a className="landing-brand" href="#top" aria-label="Goals to Today 랜딩 페이지 처음으로 이동">
            <img src="/nowline-mark.jpg" alt="" aria-hidden="true" />
            <strong>GOALS TO TODAY</strong>
          </a>
          <p>연간 방향에서 오늘 한 줄까지 이어지는 개인 실행 플래너 · 베타</p>
          <nav aria-label="서비스 정책"><Link to="/privacy">개인정보 처리방침</Link><Link to="/terms">이용약관</Link></nav>
        </div>
      </footer>
    </div>
  );
}
