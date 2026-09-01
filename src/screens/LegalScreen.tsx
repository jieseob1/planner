import { Link } from 'react-router-dom';

export function PrivacyScreen() {
  return (
    <main className="legal-page">
      <article>
        <p className="eyebrow">NOWLINE</p>
        <h1>개인정보 처리방침</h1>
        <p className="legal-page__updated">시행일: 2026년 9월 1일 · 정책 버전 2026-09-01</p>
        <p>Nowline은 연간·분기 계획을 실행 일정과 기록으로 관리하기 위해 필요한 정보만 처리하며, 광고 추적이나 개인정보 판매를 하지 않습니다.</p>
        <h2>처리하는 정보와 목적</h2>
        <ul>
          <li>로그인 식별자, 이메일, 표시 이름: 계정 인증과 기기 간 동기화</li>
          <li>목표, 작업, 일정, 실행 시간, 회고와 변경 이력: 사용자가 요청한 계획 관리 기능 제공</li>
          <li>Google 캘린더 OAuth 토큰과 이벤트 연결 정보: 사용자가 켠 캘린더 동기화 제공. 토큰은 서버에서 암호화 저장</li>
          <li>웹·앱 푸시 토큰과 알림 이력: 사용자가 켠 리마인더 전송. 토큰은 서버에서 암호화 저장</li>
          <li>짧게 보관되는 요청 제한 식별값과 오류·성능 기록: 보안, 장애 대응, 서비스 안정성 확보</li>
        </ul>
        <h2>외부 처리자</h2>
        <p>선택한 로그인 제공자, Google Calendar API, Apple Push Notification service 및 Firebase Cloud Messaging에 기능 수행에 필요한 정보만 전송합니다. Google 연동은 설정에서 언제든 해제할 수 있습니다.</p>
        <h2>보관과 삭제</h2>
        <p>계정 데이터는 계정을 유지하는 동안 보관합니다. 설정의 데이터 내보내기로 사본을 받을 수 있고, 계정 삭제를 실행하면 계획·이력·연동 토큰·알림 기기를 함께 삭제합니다. 법령상 보관 의무가 있는 경우에만 해당 기간 동안 별도 보호합니다.</p>
        <h2>이용자의 권리와 문의</h2>
        <p>설정에서 열람용 내보내기, 연동 해제, 알림 해제, 계정 삭제를 직접 수행할 수 있습니다. 추가 문의는 <a href="https://github.com/jieseob1/planner/issues">프로젝트 문의 창구</a>로 보내 주세요.</p>
        <p><Link to="/today">Nowline으로 돌아가기</Link></p>
      </article>
    </main>
  );
}

export function TermsScreen() {
  return (
    <main className="legal-page">
      <article>
        <p className="eyebrow">NOWLINE</p>
        <h1>이용약관</h1>
        <p className="legal-page__updated">시행일: 2026년 9월 1일 · 정책 버전 2026-09-01</p>
        <h2>서비스</h2>
        <p>Nowline은 목표, 작업, 시간 블록, 실행 기록, 회고를 관리하고 사용자가 선택하면 외부 캘린더와 알림을 연결하는 도구입니다.</p>
        <h2>계정과 이용자의 책임</h2>
        <p>이용자는 본인 계정을 안전하게 관리하고 적법한 내용만 저장해야 합니다. 타인의 권리를 침해하거나 서비스 안정성을 해치는 자동화·공격·우회 사용은 허용되지 않습니다.</p>
        <h2>데이터와 외부 연동</h2>
        <p>저장한 콘텐츠의 권리는 이용자에게 있습니다. Google 캘린더 등 외부 서비스의 장애·정책 변경은 Nowline이 통제할 수 없으며, 중요한 일정은 원본 서비스에서도 확인해야 합니다.</p>
        <h2>변경·중단과 책임 범위</h2>
        <p>보안이나 운영상 필요한 경우 기능을 변경하거나 일시 중단할 수 있습니다. 고의 또는 중대한 과실이 없는 한 간접 손해에 대한 책임은 관련 법령이 허용하는 범위에서 제한됩니다. 소비자에게 강행 적용되는 권리는 제한하지 않습니다.</p>
        <h2>해지와 문의</h2>
        <p>이용자는 설정에서 언제든 계정을 삭제할 수 있습니다. 문의는 <a href="https://github.com/jieseob1/planner/issues">프로젝트 문의 창구</a>로 보내 주세요.</p>
        <p><Link to="/today">Nowline으로 돌아가기</Link></p>
      </article>
    </main>
  );
}
