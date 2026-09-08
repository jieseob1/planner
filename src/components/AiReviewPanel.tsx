import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FileText, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import { aiReviewApi, AiReviewApiError, type AiReviewConfig, type AiReviewPeriod, type AiReviewReport, type AiReviewSettings } from '../api/aiReviewApi';
import { createIdempotencyKey } from '../api/plannerApi';
import { useAuth } from '../auth/AuthProvider';
import { useTimeZone } from '../timezone/TimeZoneProvider';
import { toLocalDate } from '../lib/calendarDate';
import type { PeriodRange } from '../domain/periods';
import './AiReviewPanel.css';

const defaultSettings: AiReviewSettings = { consent: false, includeReflections: false, weeklyEnabled: false, monthlyEnabled: false, scheduledTime: '08:00' };
const statusLabels: Record<AiReviewReport['status'], string> = { QUEUED: '대기 중', RUNNING: '작성 중', READY: '완료', FAILED: '실패', UNKNOWN: '결과 확인 필요', CANCELLED: '취소됨' };
const inProgress = (report: AiReviewReport) => report.status === 'QUEUED' || report.status === 'RUNNING';
const errorMessage = (error: unknown) => error instanceof Error ? error.message : '상태를 확인하지 못했습니다. 잠시 후 다시 확인해 주세요.';

export function AiReviewPanel({ range }: { range: PeriodRange }) {
  const { subject } = useAuth();
  const { timeZone } = useTimeZone();
  const [params] = useSearchParams();
  if (!subject || (range.period !== 'week' && range.period !== 'month')) return null;
  // Unmount account/range-specific state before any later response can be displayed.
  return <AiReviewContent key={`${subject}:${timeZone}:${range.period}:${range.startDate}:${params.get('aiReport') ?? ''}`} subject={subject} timeZone={timeZone} range={{ ...range, period: range.period }} />;
}

function AiReviewContent({ subject, timeZone, range }: { subject: string; timeZone: string; range: PeriodRange & { period: AiReviewPeriod } }) {
  const [params] = useSearchParams();
  const requestedId = params.get('aiReport');
  const pendingKey = `nowline.ai-review.pending.v1:${encodeURIComponent(subject)}:${range.period}:${range.startDate}`;
  const [pendingId, setPendingId] = useState<string | null>(() => { try { return localStorage.getItem(pendingKey); } catch { return null; } });
  const [config, setConfig] = useState<AiReviewConfig | null>(null);
  const [settings, setSettings] = useState<AiReviewSettings>(defaultSettings);
  const [reports, setReports] = useState<AiReviewReport[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(requestedId);
  const [loading, setLoading] = useState(true);
  const [historyReady, setHistoryReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [pollPaused, setPollPaused] = useState(false);
  const [pollEpoch, setPollEpoch] = useState(0);
  const requestController = useRef<AbortController | null>(null);
  const actionBusy = useRef(false);
  const pendingRef = useRef(pendingId);
  const belongsHere = (report: AiReviewReport) => report.period === range.period && report.startDate === range.startDate;
  const clearPending = () => {
    pendingRef.current = null; setPendingId(null);
    try { localStorage.removeItem(pendingKey); } catch { /* A leftover identifier is reconciled by the next read, never charged again automatically. */ }
  };
  const acceptReports = (items: AiReviewReport[]) => {
    const matches = items.filter(belongsHere);
    setReports(matches); setHistoryReady(true);
    if (pendingRef.current && matches.some(report => report.requestId === pendingRef.current)) clearPending();
  };

  useEffect(() => {
    const controller = new AbortController(); requestController.current = controller;
    const load = async () => {
      const [configResult, reportResult] = await Promise.allSettled([aiReviewApi.config(controller.signal), aiReviewApi.list(range.period, range.startDate, controller.signal)]);
      if (controller.signal.aborted) return;
      if (configResult.status === 'fulfilled') { setConfig(configResult.value); setSettings(configResult.value.settings); }
      else setError(`AI 설정을 불러오지 못했습니다. ${errorMessage(configResult.reason)}`);
      if (reportResult.status === 'fulfilled') {
        const list = reportResult.value.reports.filter(belongsHere);
        acceptReports(list);
        if (requestedId && !list.some(report => report.id === requestedId)) {
          try {
            const linked = await aiReviewApi.get(requestedId, controller.signal);
            if (controller.signal.aborted) return;
            if (belongsHere(linked)) acceptReports([...list, linked]);
            else { setSelectedId(null); setError('이 보고서 링크는 선택한 기간과 일치하지 않습니다.'); }
          } catch (reason) {
            if (!controller.signal.aborted) { setSelectedId(null); setError(`보고서 링크를 열지 못했습니다. ${errorMessage(reason)}`); }
          }
        }
      } else setError(`지난 보고서를 불러오지 못했습니다. ${errorMessage(reportResult.reason)}`);
      if (!controller.signal.aborted) setLoading(false);
    };
    void load();
    return () => { controller.abort(); requestController.current = null; };
    // This component is keyed by subject, range and timezone. Search selection is read at mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeIds = reports.filter(inProgress).map(report => report.id).join(',');
  useEffect(() => {
    if (!activeIds) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const poll = async () => {
      try {
        const result = await aiReviewApi.list(range.period, range.startDate, controller.signal);
        if (controller.signal.aborted) return;
        acceptReports(result.reports);
        attempts++;
        if (result.reports.some(report => belongsHere(report) && inProgress(report))) {
          if (attempts < 24) timer = setTimeout(() => void poll(), 5_000);
          else setPollPaused(true);
        }
      } catch (reason) {
        if (!controller.signal.aborted) { setPollPaused(true); setError(`자동 상태 확인을 멈췄습니다. ${errorMessage(reason)}`); }
      }
    };
    timer = setTimeout(() => void poll(), 5_000);
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
    // Only a changed pending set or explicit refresh starts a new bounded polling session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIds, pollEpoch]);

  const selected = reports.find(report => report.id === selectedId) ?? reports[0];
  const completedPeriod = range.endDate < toLocalDate(new Date(), timeZone);
  const uncertain = reports.some(report => report.status === 'UNKNOWN');
  const hasPending = Boolean(pendingId || activeIds);
  const settingsDirty = Boolean(config && JSON.stringify(settings) !== JSON.stringify(config.settings));
  const canGenerate = config?.configured && config.settings.consent && historyReady && !settingsDirty && completedPeriod && !hasPending && !uncertain;
  const refresh = async () => {
    if (actionBusy.current) return;
    const controller = requestController.current; if (!controller || controller.signal.aborted) return;
    actionBusy.current = true; setBusy(true); setError('');
    try {
      const [nextConfig, result] = await Promise.all([aiReviewApi.config(controller.signal), aiReviewApi.list(range.period, range.startDate, controller.signal)]);
      if (controller.signal.aborted) return;
      setConfig(nextConfig); if (!settingsDirty) setSettings(nextConfig.settings);
      acceptReports(result.reports); setPollPaused(false); setPollEpoch(epoch => epoch + 1);
      setMessage('서버 상태를 다시 확인했습니다. 새 보고서를 생성하지 않았습니다.');
    } catch (reason) { if (!controller.signal.aborted) setError(errorMessage(reason)); }
    finally { if (!controller.signal.aborted) { actionBusy.current = false; setBusy(false); } }
  };
  const saveSettings = async (event: FormEvent) => {
    event.preventDefault(); if (!config || actionBusy.current) return;
    const controller = requestController.current; if (!controller || controller.signal.aborted) return;
    actionBusy.current = true; setBusy(true); setError(''); setMessage('');
    const value = settings.consent ? settings : { ...settings, includeReflections: false, weeklyEnabled: false, monthlyEnabled: false };
    try {
      const saved = await aiReviewApi.settings(value, controller.signal);
      if (controller.signal.aborted) return;
      setSettings(saved); setConfig(previous => previous ? { ...previous, settings: saved } : null);
      setMessage(saved.consent ? 'AI 설정을 저장했습니다. 예약한 보고서만 정해진 시간에 자동 작성합니다.' : 'AI 이용 동의를 철회하고 자동 작성을 껐습니다. 직접 쓴 회고는 유지됩니다.');
    } catch (reason) { if (!controller.signal.aborted) setError(errorMessage(reason)); }
    finally { if (!controller.signal.aborted) { actionBusy.current = false; setBusy(false); } }
  };
  const generate = async () => {
    if (!canGenerate || actionBusy.current) return;
    const controller = requestController.current; if (!controller || controller.signal.aborted) return;
    actionBusy.current = true; setBusy(true); setError(''); setMessage('');
    const requestId = createIdempotencyKey();
    try {
      // Retain only an account-scoped identifier, never raw plans or AI output in browser storage.
      localStorage.setItem(pendingKey, requestId); pendingRef.current = requestId; setPendingId(requestId);
      const report = await aiReviewApi.generate(range.period, range.startDate, requestId, controller.signal);
      if (controller.signal.aborted) return;
      if (!belongsHere(report)) throw new Error('응답 기간이 달라 보고서를 표시하지 않았습니다. 상태를 확인해 주세요.');
      clearPending(); setReports(previous => [report, ...previous.filter(item => item.id !== report.id)]); setSelectedId(report.id);
      setPollPaused(false); setPollEpoch(epoch => epoch + 1); setMessage('보고서 작성 요청을 접수했습니다. 이전 버전은 그대로 보관됩니다.');
    } catch (reason) {
      if (controller.signal.aborted) return;
      // A proxy can return 503 after the application has already enqueued the job.
      // Only our explicit pre-enqueue configuration error proves that no job exists.
      const rejected = reason instanceof AiReviewApiError && (reason.status < 500 || (reason.status === 503 && reason.code === 'ai-not-configured'));
      if (rejected) clearPending();
      setError(`${errorMessage(reason)}${pendingRef.current && !rejected ? ' 접수 여부가 불확실하므로 재생성하지 말고 상태를 확인해 주세요.' : ''}`);
    } finally { if (!controller.signal.aborted) { actionBusy.current = false; setBusy(false); } }
  };

  return <section id="ai-review" className="ai-review-panel" aria-label="AI 기간 보고서">
    <header><div><p className="eyebrow"><Sparkles size={15} /> AI REVIEW · 선택 기능</p><h2>{range.period === 'week' ? '주간' : '월간'} AI 보고서</h2><p>기록에서 패턴과 다음 실험을 제안합니다. 직접 쓴 회고와 목표를 바꾸지 않습니다.</p></div><button type="button" className="button button--secondary button--small" disabled={busy || loading} onClick={() => void refresh()}><RefreshCw size={15} /> 상태 새로고침</button></header>
    {loading && <p role="status">AI 설정과 저장된 보고서를 확인하고 있습니다…</p>}
    {config && !config.configured && <div className="ai-review-notice"><ShieldCheck size={20} /><div><strong>AI 서비스 연결 준비 중입니다.</strong><p>운영자가 AI 공급자와 비용 한도를 설정하면 사용할 수 있습니다. 지금은 AI로 데이터를 보내지 않으며 직접 회고는 계속 사용할 수 있어요.</p></div></div>}
    {config && <details className="ai-review-settings" open={!config.settings.consent && config.configured}>
      <summary>AI 이용 동의와 자동 작성 설정</summary>
      <form onSubmit={saveSettings}>
        <p>선택한 기간의 할 일·목표 제목, 완료 기록, 계획·실행 시간의 필요한 범위를 {config.provider}에 전달합니다. 분석은 틀릴 수 있으며 자동으로 일을 수정하지 않습니다. 정책 버전 {config.policyVersion}.</p>
        <fieldset disabled={busy}>
          <label><input type="checkbox" checked={settings.consent} disabled={!config.configured && !config.settings.consent} onChange={event => setSettings(current => ({ ...current, consent: event.target.checked, ...(!event.target.checked ? { includeReflections: false, weeklyEnabled: false, monthlyEnabled: false } : {}) }))} /> AI 분석을 위한 외부 제공에 동의합니다 (선택)</label>
          <label><input type="checkbox" checked={settings.includeReflections} disabled={!settings.consent || !config.configured} onChange={event => setSettings(current => ({ ...current, includeReflections: event.target.checked }))} /> 직접 쓴 회고 내용도 포함합니다 (추가 선택)</label>
          <label><input type="checkbox" checked={settings.weeklyEnabled} disabled={!settings.consent || !config.configured} onChange={event => setSettings(current => ({ ...current, weeklyEnabled: event.target.checked }))} /> 매주 월요일에 지난주 보고서 자동 작성</label>
          <label><input type="checkbox" checked={settings.monthlyEnabled} disabled={!settings.consent || !config.configured} onChange={event => setSettings(current => ({ ...current, monthlyEnabled: event.target.checked }))} /> 매월 1일에 지난달 보고서 자동 작성</label>
          <label className="ai-review-time">작성 시각<input type="time" required value={settings.scheduledTime} disabled={!settings.consent || !config.configured} onChange={event => setSettings(current => ({ ...current, scheduledTime: event.target.value }))} /><small>{timeZone} 기준</small></label>
        </fieldset>
        <p>자동 작성은 설정을 저장한 뒤 적용됩니다. 동의를 철회하면 예약 작성도 꺼집니다. 이미 외부로 전송된 요청을 되돌리지는 못합니다.</p>
        <button type="submit" className="button button--secondary button--small" disabled={busy || !settingsDirty}>AI 설정 저장</button>
      </form>
    </details>}
    {config?.configured && <div className="ai-review-generate"><div><strong>{range.startDate} — {range.endDate}</strong><p>끝난 기간만 작성 · 월 최대 {config.monthlyReportLimit}회 · {config.model ?? config.provider}</p></div><button type="button" className="button button--primary" disabled={!canGenerate || busy || loading} onClick={() => void generate()}><Sparkles size={16} /> {reports.length ? '새 버전 작성' : 'AI 보고서 작성'}</button>
      {!completedPeriod && <p>아직 끝나지 않은 기간입니다. 지난주 또는 지난달을 선택해 주세요.</p>}
      {!config.settings.consent && <p>위에서 AI 이용 동의를 선택하고 설정을 저장하면 작성할 수 있습니다.</p>}
      {settingsDirty && <p>변경한 AI 설정을 먼저 저장해 주세요.</p>}
    </div>}
    {pendingId && <p className="ai-review-warning" role="status">이전 요청의 접수 상태를 확인해야 합니다. 중복 비용을 막기 위해 새 작성을 잠시 막았습니다. 상태 새로고침으로 확인하고, 계속 남으면 운영자에게 문의해 주세요. 요청 ID: <code>{pendingId}</code></p>}
    {uncertain && <p className="ai-review-warning" role="status">이 기간에 결과가 불확실한 요청이 있습니다. 중복 과금 위험으로 재작성을 막았습니다. 운영자가 결과를 확인해야 합니다.</p>}
    {pollPaused && <p role="status">자동 상태 확인을 멈췄습니다. 서버 작업은 계속될 수 있어요. 상태 새로고침은 새 보고서를 만들지 않습니다.</p>}
    {error && <p className="ai-review-error" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    {reports.length > 0 && <div className="ai-review-versions"><label>저장된 버전<select value={selected?.id ?? ''} onChange={event => setSelectedId(event.target.value)}>{reports.map(report => <option key={report.id} value={report.id}>v{report.version} · {statusLabels[report.status]} · {report.createdAt.slice(0, 10)}</option>)}</select></label><p>새로 작성해도 이전 결과와 당시 근거는 덮어쓰지 않습니다.</p></div>}
    {!loading && reports.length === 0 && <p className="ai-review-empty">아직 이 기간의 AI 보고서가 없습니다. 직접 쓴 회고는 아래에서 계속 관리할 수 있어요.</p>}
    {selected && <SavedAiReport report={selected} />}
  </section>;
}

function SavedAiReport({ report }: { report: AiReviewReport }) {
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const snapshot = report.inputSnapshot;
  const evidenceIds = new Set(snapshot.evidence.map(item => item.id));
  const evidenceAnchor = (id: string) => `ai-${report.id}-evidence-${encodeURIComponent(id)}`;
  const details = (items: { text: string; evidenceIds: string[] }[]) => <ul>{items.map((item, index) => <li key={index}><p>{item.text}</p>{item.evidenceIds.length > 0 && <span className="ai-review-evidence-links">근거: {item.evidenceIds.map(id => evidenceIds.has(id) ? <a key={id} href={`#${evidenceAnchor(id)}`} onClick={() => setEvidenceOpen(true)}>{id}</a> : <span key={id}>확인되지 않은 근거</span>)}</span>}</li>)}</ul>;
  return <article className="ai-review-report" aria-label={`AI 보고서 버전 ${report.version}`}>
    <header><h3><FileText size={17} /> 버전 {report.version} · {statusLabels[report.status]}</h3><a href={`/review?${new URLSearchParams({ period: report.period, date: report.startDate, aiReport: report.id })}#ai-review`}>이 버전 링크</a></header>
    {inProgress(report) && <p role="status">서버에서 보고서를 작성하고 있습니다. 페이지를 닫아도 완료 결과가 보관됩니다.</p>}
    {report.status === 'FAILED' && <p>작성하지 못했습니다. 오류 코드: {report.errorCode ?? '확인 필요'}. 다시 작성하면 별도 요청이며 비용이 발생할 수 있습니다.</p>}
    {report.status === 'UNKNOWN' && <p>외부 응답을 확정하지 못했습니다. 자동 재시도하지 않습니다. 오류 코드: {report.errorCode ?? '확인 필요'}.</p>}
    {report.status === 'CANCELLED' && <p>취소된 보고서입니다. 직접 쓴 회고와 기존 완료 보고서는 유지됩니다.</p>}
    {report.status === 'READY' && report.report && <><p className="ai-review-summary">{report.report.summary}</p><h4>기록에서 발견한 점</h4>{details(report.report.observations)}<h4>다음 기간에 해볼 일</h4>{details(report.report.suggestions)}<p className="ai-review-disclaimer">AI의 제안입니다. 실제 상황과 맞는지 확인하고, 다음 계획에 반영할 내용은 직접 선택해 주세요.</p></>}
    <details className="ai-review-snapshot" open={evidenceOpen} onToggle={event => setEvidenceOpen(event.currentTarget.open)}><summary>작성 당시의 기록과 근거 확인 ({snapshot.evidence.length}개)</summary><p>{snapshot.startDate} — {snapshot.endDate} · {snapshot.timezone} · 수집 시각 {snapshot.capturedAt}</p><dl><div><dt>완료한 일</dt><dd>{snapshot.metrics.completedTasks}개</dd></div><div><dt>계획한 시간</dt><dd>{snapshot.metrics.plannedMinutes}분</dd></div><div><dt>기록한 시간</dt><dd>{Math.round(snapshot.metrics.recordedSeconds / 60)}분</dd></div></dl><ul>{snapshot.evidence.map(item => <li id={evidenceAnchor(item.id)} key={item.id}><strong>{item.title}</strong><small>{item.id} · {item.kind} · {item.date ?? '날짜 없음'}</small><pre>{JSON.stringify(item.details, null, 2)}</pre></li>)}</ul></details>
    <footer>{report.usage ? `토큰 입력 ${report.usage.inputTokens} · 출력 ${report.usage.outputTokens}` : '토큰 사용량 미확정'} · {report.costUsd === null ? '비용 미확정' : `추정 비용 $${report.costUsd}`}<span>작성 시각 {report.createdAt}</span></footer>
  </article>;
}
