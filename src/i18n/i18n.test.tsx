import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { accountApi } from '../api/accountApi';
import { PlannerApiError } from '../api/plannerApi';
import { TimeBlockSheet } from '../components/TimeBlockSheet';
import { plannerSaveProblem } from '../state/saveProblem';
import { LanguageSelector } from './LanguageSelector';
import { LanguageSettings } from './LanguageSettings';
import { detectLanguage, getLanguage, i18n, LANGUAGE_STORAGE_KEY, localizeApiDetail, setLanguage, supportedLanguage, tr, formatNumber } from './index';
import { formatDateOnly, formatDateRange } from './format';
import { validationMessages } from './validation';

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); act(() => setLanguage('ko', false)); });

describe('internationalization', () => {
  it('prefers an explicit device choice, then supported browser languages, with English fallback', () => {
    expect(detectLanguage({ getItem: () => 'es' }, ['ko-KR'])).toBe('es');
    expect(detectLanguage({ getItem: () => 'broken' }, ['fr-FR', 'en-GB'])).toBe('en');
    expect(detectLanguage(undefined, ['fr-FR', 'es-MX', 'ko-KR'])).toBe('es');
    expect(detectLanguage(undefined, ['ja-JP'])).toBe('en');
    expect(detectLanguage({ getItem: () => { throw new Error('blocked'); } }, ['ko-KR'])).toBe('ko');
    expect(supportedLanguage('KO_kr')).toBe('ko');
    expect(supportedLanguage(null)).toBeNull();
  });
  it('switches accessible controls and document language without reloading', () => {
    render(<LanguageSelector />);
    fireEvent.change(screen.getByRole('combobox', { name: '언어' }), { target: { value: 'en' } });
    expect(document.documentElement.lang).toBe('en');
    expect(document.title).toContain('Turn goals');
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en');
    fireEvent.change(screen.getByRole('combobox', { name: 'Language' }), { target: { value: 'es' } });
    expect(screen.getByRole('combobox', { name: 'Idioma' })).toHaveValue('es');
    expect(document.documentElement.lang).toBe('es');
  });
  it('still works when storage is blocked and synchronizes other tabs without persistence writes', () => {
    const writes = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    act(() => setLanguage('en'));
    expect(getLanguage()).toBe('en');
    writes.mockClear();
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: LANGUAGE_STORAGE_KEY, newValue: 'es' })));
    expect(getLanguage()).toBe('es');
    expect(writes).not.toHaveBeenCalled();
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'planner', newValue: 'ko' })));
    expect(getLanguage()).toBe('es');
  });
  it.each(['en', 'es'] as const)('has complete trusted validation translations and plural forms in %s', language => {
    setLanguage(language, false);
    for (const [key] of validationMessages) {
      expect(i18n.exists(key)).toBe(true);
      expect(tr(key)).not.toMatch(/[가-힣]/);
    }
    expect(tr('tasks', { count: 1 })).toBe(language === 'en' ? '1 task' : '1 tarea');
    expect(tr('tasks', { count: 2 })).toBe(language === 'en' ? '2 tasks' : '2 tareas');
    expect(formatDateOnly('2026-12-31')).toContain(language === 'en' ? 'December 31, 2026' : '31 de diciembre de 2026');
    expect(formatDateRange('2026-12-31', '2027-01-02')).not.toMatch(/[가-힣]/);
    expect(formatNumber(12345.5)).toBe(language === 'en' ? '12,345.5' : '12.345,5');
  });
  it.each(['en', 'es'] as const)('keeps an open event draft and civil dates/exact minutes unchanged in %s', language => {
    const onSave = vi.fn();
    render(<TimeBlockSheet tasks={[]} initialTitle="오늘" initialMode="event" initialDate="2026-12-31" initialDay="thu" initialStartMinutes={1403} initialDurationMinutes={37} onSave={onSave} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('일정 제목'), { target: { value: '내 미저장 초안 — mañana' } });
    act(() => setLanguage(language));
    const title = screen.getByLabelText(tr('일정 제목'));
    expect(title).toHaveValue('내 미저장 초안 — mañana');
    expect(screen.getByLabelText(tr('일정 날짜'))).toHaveValue('2026-12-31');
    expect(screen.getByLabelText(tr('시작'))).toHaveValue('1403');
    expect(screen.getByLabelText(tr('종료'))).toHaveValue('1440');
    fireEvent.submit(title.closest('form')!);
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ mode: 'event', title: '내 미저장 초안 — mañana', date: '2026-12-31', day: 'thu', startMinutes: 1403, durationMinutes: 37 }));
  });
  it('localizes allowlisted validation without leaking rejected values or changing machine fields', () => {
    setLanguage('es', false);
    const problem = plannerSaveProblem(new PlannerApiError(400, 'bad', {
      code: 'validation-failed', detail: 'secret payload', errors: [
        { field: 'tasks[0].title', message: 'must not be blank', rejectedValue: 'private' },
        { field: 'tasks[0].estimateMinutes', message: 'must be greater than or equal to 15' }
      ]
    }), true);
    expect(problem?.errors[0]).toEqual({ field: 'tasks[0].title', label: 'Tareas elemento 1 · Título', message: 'Este campo no puede estar vacío.' });
    expect(problem?.errors[1].message).toContain('mayor o igual que 15');
    expect(JSON.stringify(problem)).not.toMatch(/private|secret|[가-힣]/);
    expect(localizeApiDetail('서버 내부 새 오류', 'Try again')).toBe('Try again');
  });
  it('only persists language when explicitly saving account language', async () => {
    const save = vi.spyOn(accountApi, 'saveLanguage').mockResolvedValue({ timezone: 'America/New_York', locale: 'es-ES', dailyReminderEnabled: true, dailyReminderTime: '09:15', blockReminderMinutes: 37 });
    render(<LanguageSettings />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'es' } });
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar idioma de la cuenta' }));
    await waitFor(() => expect(save).toHaveBeenCalledExactlyOnceWith('es-ES'));
    expect(await screen.findByRole('status')).toHaveTextContent('Idioma de la cuenta guardado');
  });
  it('preserves device language when account-language persistence fails', async () => {
    vi.spyOn(accountApi, 'saveLanguage').mockRejectedValue(new Error('offline'));
    render(<LanguageSettings />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'en' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save account language' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save account language');
    expect(getLanguage()).toBe('en');
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en');
  });
});
