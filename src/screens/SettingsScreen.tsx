import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, CheckCircle2, RefreshCw, ShieldCheck, Unlink } from 'lucide-react';
import {
  googleCalendarApi,
  type CalendarDirection,
  type GoogleCalendarInfo,
  type GoogleCalendarStatus
} from '../api/googleCalendarApi';
import { AccountSettingsSections } from '../components/AccountSettingsSections';
import { FocusAlert } from '../components/FocusAlert';

const directionLabels: Record<CalendarDirection, string> = {
  BIDIRECTIONAL: '양방향 — Nowline과 Google 변경을 모두 반영',
  IMPORT_ONLY: '가져오기만 — Google 일정을 Nowline에 표시',
  EXPORT_ONLY: '내보내기만 — Nowline 시간 블록을 Google에 생성'
};

const syncLabels: Record<GoogleCalendarStatus['syncStatus'], string> = {
  DISCONNECTED: '연결 안 됨',
  PENDING: '동기화 대기 중',
  SYNCING: '동기화 중',
  READY: '동기화 정상',
  REAUTHORIZE: '권한 재연결 필요',
  ERROR: '최근 동기화 실패'
};

export function SettingsScreen() {
  const [status, setStatus] = useState<GoogleCalendarStatus | null>(null);
  const [calendars, setCalendars] = useState<GoogleCalendarInfo[]>([]);
  const [calendarId, setCalendarId] = useState('');
  const [direction, setDirection] = useState<CalendarDirection>('BIDIRECTIONAL');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const next = await googleCalendarApi.status();
      setStatus(next);
      setCalendarId(next.calendarId ?? '');
      setDirection(next.direction);
      if (next.connected) setCalendars(await googleCalendarApi.calendars());
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '연동 상태를 불러오지 못했습니다.');
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('calendar') === 'connected') {
      setNotice('Google Calendar 연결을 완료했습니다. 첫 동기화를 준비하고 있습니다.');
      window.history.replaceState({}, '', '/settings');
    }
    void load();
  }, [load]);

  useEffect(() => {
    if (!status || !['PENDING', 'SYNCING'].includes(status.syncStatus)) return;
    const timer = window.setInterval(() => void load(), 2500);
    return () => window.clearInterval(timer);
  }, [load, status]);

  const connect = async () => {
    setBusy(true);
    try {
      const response = await googleCalendarApi.connect('/settings');
      window.location.assign(response.authorizationUrl);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Google 연결을 시작하지 못했습니다.');
      setBusy(false);
    }
  };

  const save = async () => {
    if (!calendarId) return;
    setBusy(true);
    try {
      setStatus(await googleCalendarApi.settings(calendarId, direction));
      setNotice('연동 설정을 저장했습니다. 변경된 기준으로 다시 동기화합니다.');
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '연동 설정을 저장하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const sync = async () => {
    setBusy(true);
    try {
      await googleCalendarApi.sync();
      setStatus((current) => current ? { ...current, syncStatus: 'PENDING' } : current);
      setNotice('동기화를 요청했습니다. 다른 기기에서 바뀐 내용도 안전하게 순서대로 반영됩니다.');
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '동기화를 요청하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm('Google Calendar 연결과 저장된 연동 토큰을 삭제할까요?')) return;
    setBusy(true);
    try {
      await googleCalendarApi.disconnect();
      setCalendars([]);
      setNotice('Google Calendar 연결과 저장된 토큰을 삭제했습니다.');
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '연결을 해제하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen settings-screen">
      <header className="screen-header">
        <div>
          <p className="eyebrow">SETTINGS & INTEGRATIONS</p>
          <h1>설정과 연동</h1>
          <p>일정을 이중 입력하지 않도록 외부 캘린더와 동기화 방향을 직접 통제합니다.</p>
        </div>
      </header>

      {notice && <div className="inline-success" role="status">{notice}</div>}
      {error && <FocusAlert message={error} />}

      <section className="settings-card" aria-labelledby="google-calendar-title">
        <div className="settings-card__heading">
          <span className="settings-card__icon"><CalendarDays size={22} aria-hidden="true" /></span>
          <div>
            <h2 id="google-calendar-title">Google Calendar</h2>
            <p>일정은 암호화된 장기 토큰과 Google 증분 동기화 토큰으로 처리됩니다.</p>
          </div>
          {status?.connected && (
            <span className={`integration-state integration-state--${status.syncStatus.toLowerCase()}`}>
              {status.syncStatus === 'READY' && <CheckCircle2 size={15} aria-hidden="true" />}
              {syncLabels[status.syncStatus]}
            </span>
          )}
        </div>

        {!status ? <p role="status">연동 상태를 확인하고 있습니다…</p> : !status.configured ? (
          <div className="integration-empty">
            <ShieldCheck size={24} aria-hidden="true" />
            <div>
              <strong>운영 Google OAuth 자격 증명이 필요합니다</strong>
              <p>서버 운영 환경에 Client ID, Client Secret, 토큰 암호화 키와 HTTPS 콜백 주소를 설정하면 연결 버튼이 열립니다.</p>
            </div>
          </div>
        ) : !status.connected ? (
          <div className="integration-empty">
            <div>
              <strong>아직 연결된 캘린더가 없습니다</strong>
              <p>일정 조회·수정 범위만 요청하며, 언제든 연결과 저장 토큰을 삭제할 수 있습니다.</p>
            </div>
            <button className="button button--primary" type="button" disabled={busy} onClick={() => void connect()}>
              Google Calendar 연결
            </button>
          </div>
        ) : (
          <div className="integration-settings">
            <div className="integration-account">
              <span>연결 계정</span>
              <strong>{status.accountEmail ?? 'Google 기본 캘린더'}</strong>
              <small>마지막 완료 {status.lastSyncCompletedAt ? new Date(status.lastSyncCompletedAt).toLocaleString('ko-KR') : '아직 없음'}</small>
            </div>
            <div className="form-grid__columns">
              <label className="field">
                동기화할 캘린더
                <select value={calendarId} onChange={(event) => setCalendarId(event.target.value)}>
                  {calendars.map((calendar) => (
                    <option key={calendar.id} value={calendar.id}>{calendar.summary}{calendar.primary ? ' · 기본' : ''}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                동기화 방향
                <select value={direction} onChange={(event) => setDirection(event.target.value as CalendarDirection)}>
                  {(Object.keys(directionLabels) as CalendarDirection[]).map((value) => (
                    <option key={value} value={value}>{directionLabels[value]}</option>
                  ))}
                </select>
              </label>
            </div>
            {status.lastErrorCode && <p className="field-error">최근 오류: {status.lastErrorCode}</p>}
            <div className="settings-card__actions">
              <button className="button button--primary" type="button" disabled={busy || !calendarId} onClick={() => void save()}>설정 저장</button>
              <button className="button button--secondary" type="button" disabled={busy} onClick={() => void sync()}><RefreshCw size={16} aria-hidden="true" /> 지금 동기화</button>
              <button className="button button--ghost" type="button" disabled={busy} onClick={() => void disconnect()}><Unlink size={16} aria-hidden="true" /> 연결 해제</button>
            </div>
          </div>
        )}
      </section>
      <AccountSettingsSections />
    </div>
  );
}
