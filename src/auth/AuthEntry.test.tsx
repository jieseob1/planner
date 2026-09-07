import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AuthEntry } from './AuthEntry';

describe('login entry', () => {
  it('makes goal-free use and the real login action clear', () => {
    render(<MemoryRouter><AuthEntry onLogin={vi.fn()} /></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 1, name: /계획을 실행으로.*연결하세요/ })).toBeVisible();
    expect(screen.getByText('목표를 만들지 않아도 사용할 수 있어요.')).toBeVisible();
    expect(screen.getByRole('link', { name: '개인정보 처리방침' })).toHaveAttribute('href', '/privacy');
  });
  it('does not submit twice and restores the button with an actionable error', async () => {
    let reject!: (reason: Error) => void;
    const onLogin = vi.fn(() => new Promise<void>((_, no) => { reject = no; }));
    render(<MemoryRouter><AuthEntry onLogin={onLogin} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: '로그인하고 시작하기' }));
    const pending = screen.getByRole('button', { name: /여는 중/ });
    expect(pending).toBeDisabled();
    fireEvent.click(pending);
    expect(onLogin).toHaveBeenCalledTimes(1);
    reject(new Error('network'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('다시 시도'));
    expect(screen.getByRole('button', { name: '로그인하고 시작하기' })).toBeEnabled();
  });
  it('does not attempt login with missing provider configuration', () => {
    const onLogin = vi.fn();
    render(<MemoryRouter><AuthEntry onLogin={onLogin} disabled message="로그인 설정 확인 필요" /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: '로그인하고 시작하기' }));
    expect(onLogin).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('로그인 설정 확인 필요');
  });
});
