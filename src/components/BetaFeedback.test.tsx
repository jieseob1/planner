import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { BetaFeedback, betaReportTemplate } from './BetaFeedback';

describe('beta feedback', () => {
  it('does not automatically attach records, location query or credentials', () => {
    const report = betaReportTemplate('오류 신고', '재현 설명', 'Asia/Seoul');
    expect(report).toContain('재현 설명');
    expect(report).toContain('Asia/Seoul');
    expect(report).not.toContain('localStorage');
    expect(report).not.toContain('Bearer');
  });
  it('copies an explicit report without sending it, and keeps entered text after closing', async () => {
    const user = userEvent.setup();
    const copy = vi.spyOn(navigator.clipboard, 'writeText');
    render(<MemoryRouter><BetaFeedback timeZone="Asia/Seoul" /></MemoryRouter>);
    expect(screen.queryByRole('link', { name: '백오피스 열기' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '문제 신고 · 개선 제안' }));
    expect(screen.getByRole('button', { name: '신고 내용 복사' })).toBeDisabled();
    await user.type(screen.getByLabelText('어떤 상황이었나요?'), '시간 변경이 안 됩니다');
    await user.click(screen.getByRole('button', { name: '신고 내용 복사' }));
    expect(copy).toHaveBeenCalledWith(expect.stringContaining('시간 변경이 안 됩니다'));
    expect(screen.getByRole('status')).toHaveTextContent('아직 전송되지는 않았습니다');
    expect(screen.getByRole('link', { name: '공개 문의 창 열기' })).toHaveAttribute('href', 'https://github.com/jieseob1/planner/issues/new');
    await user.click(screen.getAllByRole('button', { name: '닫기' })[0]);
    await user.click(screen.getByRole('button', { name: '문제 신고 · 개선 제안' }));
    expect(screen.getByLabelText('어떤 상황이었나요?')).toHaveValue('시간 변경이 안 됩니다');
  });
  it('exposes operator destinations only after allowed discovery', () => {
    render(<MemoryRouter><BetaFeedback timeZone="Asia/Seoul" adminAllowed /></MemoryRouter>);
    expect(screen.getByRole('link', { name: '백오피스 열기' })).toHaveAttribute('href', '/admin');
    expect(screen.getByRole('link', { name: 'Grafana 열기' })).toHaveAttribute('href', '/ops/grafana/');
  });
});
