import { useEffect, useState } from 'react';
import { Activity, ArrowLeft, ArrowRight, ExternalLink, RefreshCw, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { adminApi, AdminApiError, type AdminListKind, type AdminOverview, type AdminPage, type AdminRow } from './adminApi';
import { useAdminAccess } from './useAdminAccess';
import './admin.css';

const sections: { key: AdminListKind; label: string; empty: string }[] = [
  { key: 'users', label: '계정', empty: '등록된 계정이 없습니다.' },
  { key: 'sync-failures', label: '캘린더 연결 문제', empty: '현재 캘린더 연결 문제가 없습니다.' },
  { key: 'job-failures', label: '실패·재시도 작업', empty: '실패하거나 재시도 중인 작업이 없습니다.' },
  { key: 'audit', label: '감사 기록', empty: '감사 기록이 없습니다.' }
];
const time = (value: string | null) => value
  ? new Date(value).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '기록 없음';
const statusLabels: Record<string, string> = {
  READY: '연결 정상', PENDING: '대기', SYNCING: '동기화 중', REAUTHORIZE: '재연결 필요', ERROR: '오류',
  DEAD: '최종 실패', ACTIVE: '사용 중', TRIALING: '체험 중', PAST_DUE: '결제 확인 필요', CANCELED: '취소됨', EXPIRED: '만료'
};
const label = (value: string | null) => value ? statusLabels[value] ?? value : '없음';

function Row({ row }: { row: AdminRow }) {
  if ('maskedEmail' in row) return <article className="admin-record">
    <div className="admin-record__heading"><strong>{row.maskedEmail ?? '이메일 없음'}</strong><span className="admin-badge">{row.planCode ?? '플랜 없음'} · {label(row.entitlementStatus)}</span></div>
    <dl><div><dt>가입</dt><dd>{time(row.createdAt)}</dd></div><div><dt>최근 활동</dt><dd>{time(row.lastSeenAt)}</dd></div><div><dt>캘린더</dt><dd>{label(row.syncStatus)}</dd></div><div><dt>탈퇴 요청</dt><dd>{row.deletionRequested ? '있음' : '없음'}</dd></div></dl>
    <Id label="계정 ID" value={row.userId} />
  </article>;
  if ('errorCode' in row) return <article className="admin-record">
    <div className="admin-record__heading"><strong>{label(row.status)}</strong><span className="admin-badge admin-badge--attention">Google Calendar</span></div>
    <dl><div><dt>오류 코드</dt><dd>{row.errorCode ?? '기록 없음'}</dd></div><div><dt>최근 완료</dt><dd>{time(row.lastCompletedAt)}</dd></div><div><dt>상태 변경</dt><dd>{time(row.updatedAt)}</dd></div></dl>
    <Id label="계정 ID" value={row.userId} />
  </article>;
  if ('jobId' in row) return <article className="admin-record">
    <div className="admin-record__heading"><strong>{row.type}</strong><span className={`admin-badge ${row.status === 'DEAD' ? 'admin-badge--attention' : ''}`}>{row.status === 'PENDING' ? '재시도 대기' : label(row.status)}</span></div>
    <dl><div><dt>시도 횟수</dt><dd>{row.attempts}회</dd></div><div><dt>실행 가능 시각</dt><dd>{time(row.availableAt)}</dd></div><div><dt>상태 변경</dt><dd>{time(row.updatedAt)}</dd></div></dl>
    <Id label="작업 ID" value={row.jobId} /><Id label="계정 ID" value={row.userId} />
  </article>;
  return <article className="admin-record">
    <div className="admin-record__heading"><strong>{row.action}</strong><time dateTime={row.occurredAt}>{time(row.occurredAt)}</time></div>
    <dl><div><dt>리비전</dt><dd>{row.revision ?? '없음'}</dd></div></dl>
    <Id label="이벤트 ID" value={row.eventId} /><Id label="계정 ID" value={row.userId} />
  </article>;
}

function Id({ label: title, value }: { label: string; value: string | null }) {
  return <p className="admin-record__id"><span>{title}</span> <code>{value ?? '시스템 작업'}</code></p>;
}

export function AdminScreen() {
  const access = useAdminAccess();
  const { subject } = useAuth();
  const [kind, setKind] = useState<AdminListKind>('users');
  const [page, setPage] = useState(0);
  const [version, setVersion] = useState(0);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [result, setResult] = useState<AdminPage<AdminRow> | null>(null);
  const [overviewError, setOverviewError] = useState('');
  const [listError, setListError] = useState('');
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    setDenied(false); setOverview(null); setResult(null);
  }, [subject]);

  useEffect(() => {
    setOverview(null); setOverviewError('');
    if (access.status !== 'allowed') return;
    const controller = new AbortController();
    void adminApi.overview(controller.signal).then((value) => {
      if (!controller.signal.aborted) setOverview(value);
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      if (error instanceof AdminApiError && (error.status === 401 || error.status === 403)) setDenied(true);
      else setOverviewError(error instanceof AdminApiError ? error.message : '운영 현황을 불러오지 못했습니다.');
    });
    return () => controller.abort();
  }, [access.status, subject, version]);

  useEffect(() => {
    setResult(null); setListError('');
    if (access.status !== 'allowed') return;
    const controller = new AbortController();
    void adminApi.list(kind, page, controller.signal).then((value) => {
      if (!controller.signal.aborted) setResult(value);
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      if (error instanceof AdminApiError && (error.status === 401 || error.status === 403)) setDenied(true);
      else setListError(error instanceof AdminApiError ? error.message : '목록을 불러오지 못했습니다.');
    });
    return () => controller.abort();
  }, [access.status, subject, kind, page, version]);

  const refresh = () => { setDenied(false); access.refresh(); setVersion((value) => value + 1); };
  if (access.status === 'loading') return <section className="admin-screen"><p role="status">관리자 접근 권한을 확인하고 있습니다…</p></section>;
  if (access.status === 'forbidden' || denied) return <section className="admin-screen admin-state" aria-labelledby="admin-denied">
    <ShieldCheck aria-hidden="true" size={30} /><h1 id="admin-denied">관리자 권한이 필요합니다</h1>
    <p>이 계정으로 운영 정보에 접근할 수 없습니다. 권한이 변경되었다면 다시 로그인해 주세요.</p>
    <Link className="admin-button" to="/today">오늘로 돌아가기</Link>
  </section>;
  if (access.status === 'error') return <section className="admin-screen admin-state"><h1>관리자 페이지</h1><p role="alert">접근 권한을 확인하지 못했습니다.</p><button className="admin-button" onClick={refresh}>다시 시도</button></section>;

  const selected = sections.find((section) => section.key === kind)!;
  const cards = overview ? [
    ['전체 계정', overview.accounts, `최근 7일 활동 ${overview.recentAccounts.toLocaleString()}명`],
    ['활성 계획', overview.activePlans, '현재 ACTIVE 상태'],
    ['캘린더 연결', overview.calendarConnections, `연결 문제 ${overview.syncFailures.toLocaleString()}건`],
    ['최종 실패 작업', overview.deadJobs, `재시도 대기 ${overview.retryingJobs.toLocaleString()}건`]
  ] as const : [];

  return <section className="admin-screen" aria-labelledby="admin-title">
    <header className="admin-header"><div><p className="admin-eyebrow"><ShieldCheck size={14} aria-hidden="true" /> OPERATIONS</p><h1 id="admin-title">운영 현황</h1><p>계정과 연동 상태를 한곳에서 확인합니다.</p></div>
      <div className="admin-actions"><button className="admin-button" onClick={refresh}><RefreshCw size={16} aria-hidden="true" />새로고침</button><a className="admin-button admin-button--dark" href="/ops/grafana/" target="_blank" rel="noopener noreferrer">Grafana<ExternalLink size={15} aria-hidden="true" /><span className="admin-sr-only"> (새 창)</span></a></div>
    </header>
    <div className="admin-notice"><Activity size={17} aria-hidden="true" /><span>조회 전용 · 계정 이메일은 일부만 표시됩니다. 모든 시각은 현재 기기 시간대 기준입니다.</span></div>
    {overviewError ? <div className="admin-feedback" role="alert">{overviewError}<button className="admin-button" onClick={refresh}>다시 시도</button></div> : !overview ? <p className="admin-feedback" role="status">운영 현황을 불러오고 있습니다…</p> : <>
      <div className="admin-metrics">{cards.map(([title, count, note]) => <article key={title}><h2>{title}</h2><strong>{count.toLocaleString()}</strong><p>{note}</p></article>)}</div>
      <p className="admin-summary">작업 대기 {overview.queuedJobs.toLocaleString()} · 실행 중 {overview.runningJobs.toLocaleString()} · 알림 실패 {overview.failedNotifications.toLocaleString()} · 최근 24시간 감사 기록 {overview.recentAuditEvents.toLocaleString()}<span>확인 {time(overview.observedAt)}</span></p>
    </>}
    <div className="admin-panel">
      <nav className="admin-sections" aria-label="운영 정보 종류">{sections.map((section) => <button key={section.key} aria-pressed={kind === section.key} onClick={() => { setKind(section.key); setPage(0); }}>{section.label}</button>)}</nav>
      <div className="admin-panel__heading"><h2>{selected.label}</h2><p>최근 순 · 페이지당 20건</p></div>
      <div aria-live="polite" aria-busy={!result && !listError}>
        {listError ? <div className="admin-feedback" role="alert">{listError}<button className="admin-button" onClick={() => setVersion((value) => value + 1)}>목록 다시 시도</button></div>
          : !result ? <p className="admin-feedback" role="status">목록을 불러오고 있습니다…</p>
            : result.items.length === 0 ? <p className="admin-feedback">{page === 0 ? selected.empty : '이 페이지에 더 이상 기록이 없습니다.'}</p>
              : <div className="admin-records">{result.items.map((row) => <Row key={'jobId' in row ? row.jobId : 'eventId' in row ? row.eventId : row.userId} row={row} />)}</div>}
      </div>
      <nav className="admin-pagination" aria-label="목록 페이지"><button className="admin-button" disabled={page === 0 || !result} onClick={() => setPage((value) => value - 1)}><ArrowLeft size={16} aria-hidden="true" />이전</button><span>{page + 1}페이지</span><button className="admin-button" disabled={!result?.hasNext} onClick={() => setPage((value) => value + 1)}>다음<ArrowRight size={16} aria-hidden="true" /></button></nav>
      {result?.limited && <p className="admin-limit">조회 범위에 도달했습니다. 더 오래된 기록은 별도 운영 점검이 필요합니다.</p>}
    </div>
  </section>;
}
