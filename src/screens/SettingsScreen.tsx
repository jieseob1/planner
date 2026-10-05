import { tr, useLocale } from '../i18n';
import { LanguageSettings } from '../i18n/LanguageSettings';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarDays, CheckCircle2, LogIn, RefreshCw, ShieldCheck, Unlink } from 'lucide-react';
import {
  googleCalendarApi,
  type CalendarDirection,
  type GoogleCalendarInfo,
  type GoogleCalendarStatus
} from '../api/googleCalendarApi';
import { AccountSettingsSections } from '../components/AccountSettingsSections';
import { FocusAlert } from '../components/FocusAlert';
import { useAuth } from '../auth/AuthProvider';
import { useTimeZone } from '../timezone/TimeZoneProvider';
import { formatInstantInTimeZone } from '../lib/calendarDate';
import { BetaFeedback } from '../components/BetaFeedback';
import { useAdminAccess } from '../admin/useAdminAccess';

const directionLabels = (): Record<CalendarDirection, string> => ({
  BIDIRECTIONAL: tr("양방향 — Goals to Today와 Google 변경을 모두 반영"),
  IMPORT_ONLY: tr("가져오기만 — Google 일정을 Goals to Today에 표시"),
  EXPORT_ONLY: tr("내보내기만 — Goals to Today 시간 블록을 Google에 생성")
});

const syncLabels = (): Record<GoogleCalendarStatus['syncStatus'], string> => ({
  DISCONNECTED: tr("연결 안 됨"),
  PENDING: tr("동기화 대기 중"),
  SYNCING: tr("동기화 중"),
  READY: tr("동기화 정상"),
  REAUTHORIZE: tr("권한 재연결 필요"),
  ERROR: tr("최근 동기화 실패")
});

const errorMessage = (reason: unknown, fallback: string) => (
  reason instanceof Error ? reason.message : fallback
);

const isAbortError = (reason: unknown) => (
  reason instanceof Error && reason.name === 'AbortError'
);

const requiresLogin = (message: string) => /\((401|403)\)|unauthori[sz]ed|forbidden|인증이? 필요|로그인/i.test(message);

export function SettingsScreen() {
  useLocale();
  const adminAccess = useAdminAccess();
  const { reauthenticate } = useAuth();
  const { error: timeZoneError, loading: timeZoneLoading, refreshTimeZone, source: timeZoneSource, timeZone } = useTimeZone();
  const [status, setStatus] = useState<GoogleCalendarStatus | null>(null);
  const [calendars, setCalendars] = useState<GoogleCalendarInfo[]>([]);
  const [calendarId, setCalendarId] = useState('');
  const [direction, setDirection] = useState<CalendarDirection>('BIDIRECTIONAL');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const loadAbortRef = useRef<AbortController | null>(null);
  const disconnectingRef = useRef(false);

  const load = useCallback(async (announceLoading = true) => {
    if (disconnectingRef.current) return;
    if (loadAbortRef.current) {
      if (!announceLoading) return;
      loadAbortRef.current.abort();
    }
    const controller = new AbortController();
    loadAbortRef.current = controller;
    if (announceLoading) {
      setLoading(true);
      setError('');
    }
    try {
      const next = await googleCalendarApi.status(controller.signal);
      const nextCalendars = next.connected ? await googleCalendarApi.calendars(controller.signal) : [];
      if (controller.signal.aborted) return;
      setStatus(next);
      setCalendarId(next.calendarId ?? '');
      setDirection(next.direction);
      setCalendars(nextCalendars);
      setError('');
    } catch (reason) {
      if (isAbortError(reason)) return;
      setStatus(null);
      setCalendars([]);
      setError(errorMessage(reason, tr("연동 상태를 불러오지 못했습니다.")));
    } finally {
      if (loadAbortRef.current === controller) {
        loadAbortRef.current = null;
        if (announceLoading) setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('calendar') === 'connected') {
      setNotice(tr("Google Calendar 연결을 완료했습니다. 첫 동기화를 준비하고 있습니다."));
      window.history.replaceState({}, '', '/settings');
    }
    void load();
    return () => loadAbortRef.current?.abort();
  }, [load]);

  useEffect(() => {
    if (!status || !['PENDING', 'SYNCING'].includes(status.syncStatus)) return;
    const timer = window.setInterval(() => void load(false), 2500);
    return () => window.clearInterval(timer);
  }, [load, status]);

  const recoverAuthentication = async () => {
    setBusy(true);
    setError('');
    try {
      await reauthenticate();
      await load();
    } catch (reason) {
      setError(errorMessage(reason, tr("다시 로그인하지 못했습니다.")));
    } finally {
      setBusy(false);
    }
  };

  const connect = async () => {
    setBusy(true);
    setNotice('');
    setError('');
    try {
      const response = await googleCalendarApi.connect('/settings');
      window.location.assign(response.authorizationUrl);
    } catch (reason) {
      setError(errorMessage(reason, tr("Google 연결을 시작하지 못했습니다.")));
      setBusy(false);
    }
  };

  const save = async () => {
    if (!calendarId) return;
    setBusy(true);
    setNotice('');
    setError('');
    try {
      setStatus(await googleCalendarApi.settings(calendarId, direction));
      setNotice(tr("연동 설정을 저장했습니다. 변경된 기준으로 다시 동기화합니다."));
      setError('');
    } catch (reason) {
      setError(errorMessage(reason, tr("연동 설정을 저장하지 못했습니다.")));
    } finally {
      setBusy(false);
    }
  };

  const sync = async () => {
    setBusy(true);
    setNotice('');
    setError('');
    try {
      await googleCalendarApi.sync();
      setStatus((current) => current ? { ...current, syncStatus: 'PENDING' } : current);
      setNotice(tr("동기화를 요청했습니다. 다른 기기에서 바뀐 내용도 안전하게 순서대로 반영됩니다."));
      setError('');
    } catch (reason) {
      setError(errorMessage(reason, tr("동기화를 요청하지 못했습니다.")));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm(tr("Google Calendar 연결과 저장된 연동 토큰을 삭제할까요?"))) return;
    disconnectingRef.current = true;
    loadAbortRef.current?.abort();
    setBusy(true);
    setNotice('');
    setError('');
    try {
      await googleCalendarApi.disconnect();
      setCalendars([]);
      setNotice(tr("Google Calendar 연결과 저장된 토큰을 삭제했습니다."));
      disconnectingRef.current = false;
      await load();
    } catch (reason) {
      setError(errorMessage(reason, tr("연결을 해제하지 못했습니다.")));
    } finally {
      disconnectingRef.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="screen settings-screen">
      <header className="screen-header">
        <div>
          <p className="eyebrow">{tr("SETTINGS & INTEGRATIONS")}</p>
          <h1>{tr("설정과 연동")}</h1>
          <p>{tr("일정을 이중 입력하지 않도록 외부 캘린더와 동기화 방향을 직접 통제합니다.")}</p>
        </div>
      </header>
      <LanguageSettings />

      <section className="settings-card" aria-labelledby="calendar-timezone-title">
        <div className="settings-card__heading">
          <span className="settings-card__icon"><CalendarDays size={22} aria-hidden="true" /></span>
          <div>
            <h2 id="calendar-timezone-title">{tr("일정 계산 기준")}</h2>
            <p>{tr("Today·Planner·실행 기록을 같은 IANA 시간대에서 날짜와 주차로 계산합니다.")}</p>
          </div>
        </div>
        <div aria-live="polite">
          <strong>{timeZone}</strong>
          <p className="settings-hint">
            {timeZoneLoading
              ? tr("계정 시간대를 확인하는 동안 기기 시간대를 임시로 사용합니다.")
              : timeZoneSource === 'account'
                ? tr("계정 설정을 기준으로 사용 중입니다.")
                : tr("계정 설정을 불러오지 못해 기기 시간대를 사용 중입니다.")}
          </p>
        </div>
        {timeZoneError ? (
          <div className="settings-card__feedback">
            <FocusAlert message={timeZoneError} />
            <button className="button button--secondary" type="button" onClick={() => void refreshTimeZone()}>
              <RefreshCw size={16} aria-hidden="true" /> {tr("시간대 다시 불러오기")}</button>
          </div>
        ) : null}
      </section>

      <section className="settings-card" aria-labelledby="google-calendar-title">
        <div className="settings-card__heading">
          <span className="settings-card__icon"><CalendarDays size={22} aria-hidden="true" /></span>
          <div>
            <h2 id="google-calendar-title">Google Calendar</h2>
            <p>{tr("일정은 암호화된 장기 토큰과 Google 증분 동기화 토큰으로 처리됩니다.")}</p>
          </div>
          {status?.connected && (
            <span className={`integration-state integration-state--${status.syncStatus.toLowerCase()}`}>
              {status.syncStatus === 'READY' && <CheckCircle2 size={15} aria-hidden="true" />}
              {syncLabels()[status.syncStatus]}
            </span>
          )}
        </div>

        {notice ? <div className="inline-success" role="status">{notice}</div> : null}
        {error && status ? (
          <div className="settings-card__feedback">
            <FocusAlert message={error} />
            <div className="settings-card__feedback-actions">
              <button className="button button--secondary" type="button" onClick={() => void load()}>
                <RefreshCw size={16} aria-hidden="true" /> {tr("상태 다시 확인")}</button>
              {requiresLogin(error) ? (
                <button className="button button--primary" type="button" disabled={busy} onClick={() => void recoverAuthentication()}>
                  <LogIn size={16} aria-hidden="true" /> {tr("다시 로그인")}</button>
              ) : null}
            </div>
          </div>
        ) : null}
        {loading ? <p role="status">{tr("연동 상태를 확인하고 있습니다…")}</p> : error && !status ? (
          <div className="settings-card__feedback">
            <FocusAlert message={error} />
            <p>{tr("Google Calendar 카드만 불러오지 못했습니다. 다른 설정은 계속 사용할 수 있습니다.")}</p>
            <div className="settings-card__feedback-actions">
              <button className="button button--secondary" type="button" onClick={() => void load()}>
                <RefreshCw size={16} aria-hidden="true" /> {tr("다시 시도")}</button>
              {requiresLogin(error) ? (
                <button className="button button--primary" type="button" disabled={busy} onClick={() => void recoverAuthentication()}>
                  <LogIn size={16} aria-hidden="true" /> {tr("다시 로그인")}</button>
              ) : null}
            </div>
          </div>
        ) : !status ? <p className="settings-hint">{tr("Google Calendar 상태 정보가 없습니다.")}</p> : !status.configured ? (
          <div className="integration-empty">
            <ShieldCheck size={24} aria-hidden="true" />
            <div>
              <strong>{tr("운영 Google OAuth 자격 증명이 필요합니다")}</strong>
              <p>{tr("서버 운영 환경에 Client ID, Client Secret, 토큰 암호화 키와 HTTPS 콜백 주소를 설정하면 연결 버튼이 열립니다.")}</p>
            </div>
          </div>
        ) : status.syncStatus === 'REAUTHORIZE' ? (
          <div className="integration-empty integration-empty--warning">
            <div>
              <strong>{tr("Google 권한을 다시 연결해야 합니다")}</strong>
              <p>{tr("기존 일정은 지우지 않습니다. Google 권한을 갱신한 뒤 중단된 동기화를 이어갑니다.")}</p>
            </div>
            <button className="button button--primary" type="button" disabled={busy} onClick={() => void connect()}>
              {tr("Google 권한 다시 연결")}</button>
          </div>
        ) : !status.connected ? (
          <div className="integration-empty">
            <div>
              <strong>{tr("아직 연결된 캘린더가 없습니다")}</strong>
              <p>{tr("일정 조회·수정 범위만 요청하며, 언제든 연결과 저장 토큰을 삭제할 수 있습니다.")}</p>
            </div>
            <button className="button button--primary" type="button" disabled={busy} onClick={() => void connect()}>
              {tr("Google Calendar 연결")}</button>
          </div>
        ) : (
          <div className="integration-settings">
            <div className="integration-account">
              <span>{tr("연결 계정")}</span>
              <strong>{status.accountEmail ?? tr("Google 기본 캘린더")}</strong>
              <small>{tr("마지막 완료")}{' '}{status.lastSyncCompletedAt ? formatInstantInTimeZone(status.lastSyncCompletedAt, timeZone) : tr("아직 없음")}</small>
            </div>
            <div className="form-grid__columns">
              <label className="field">
                {tr("동기화할 캘린더")}<select value={calendarId} onChange={(event) => setCalendarId(event.target.value)}>
                  {calendars.map((calendar) => (
                    <option key={calendar.id} value={calendar.id}>{calendar.summary}{calendar.primary ? tr(" · 기본") : ''}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                {tr("동기화 방향")}<select value={direction} onChange={(event) => setDirection(event.target.value as CalendarDirection)}>
                  {(Object.keys(directionLabels()) as CalendarDirection[]).map((value) => (
                    <option key={value} value={value}>{directionLabels()[value]}</option>
                  ))}
                </select>
              </label>
            </div>
            {status.lastErrorCode && <p className="field-error">{tr("최근 오류:")}{' '}{status.lastErrorCode}</p>}
            <div className="settings-card__actions">
              <button className="button button--primary" type="button" disabled={busy || !calendarId} onClick={() => void save()}>{tr("설정 저장")}</button>
              <button className="button button--secondary" type="button" disabled={busy} onClick={() => void sync()}><RefreshCw size={16} aria-hidden="true" /> {' '}{tr("지금 동기화")}</button>
              <button className="button button--ghost" type="button" disabled={busy} onClick={() => void disconnect()}><Unlink size={16} aria-hidden="true" /> {' '}{tr("연결 해제")}</button>
            </div>
          </div>
        )}
      </section>
      <AccountSettingsSections />
      <BetaFeedback adminAllowed={adminAccess.status === 'allowed'} timeZone={timeZone} />
    </div>
  );
}
