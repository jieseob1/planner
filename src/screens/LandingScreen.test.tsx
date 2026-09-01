import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { LandingScreen } from './LandingScreen';

const renderLanding = () => render(
  <MemoryRouter>
    <LandingScreen />
  </MemoryRouter>
);

describe('LandingScreen', () => {
  it('explains the plan-to-action value and exposes the real product evidence', () => {
    renderLanding();

    expect(screen.getByRole('heading', { level: 1, name: /오늘 하는 일이.*올해의 목표와 연결되어 있나요/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '장기 계획이 오늘의 행동과 연결됩니다' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '단순한 기록이 아니라 계획을 운영합니다' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '실행과 회고가 하나의 순환을 만듭니다' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Nowline 오늘 실행 화면' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Nowline 목표와 지표 화면' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Nowline 주간 계획 화면' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Nowline 주간 회고 화면' })).toBeInTheDocument();
  });

  it('routes conversion links to the web app and states release availability honestly', () => {
    renderLanding();

    const conversionLinks = screen.getAllByRole('link', { name: '웹앱 바로 시작' });
    expect(conversionLinks).toHaveLength(3);
    conversionLinks.forEach((link) => expect(link).toHaveAttribute('href', '/today'));

    expect(screen.getByText('Google Calendar 공개 연동')).toBeInTheDocument();
    expect(screen.getByText('iOS · Android 정식 앱')).toBeInTheDocument();
    expect(screen.getByText('계정 로그인 · 회원 탈퇴')).toBeInTheDocument();
    expect(screen.getByText('제공 중')).toBeInTheDocument();
    expect(screen.getAllByText('준비 중').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('베타 기간 자동 결제 없음').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('카드 등록 없음').length).toBeGreaterThanOrEqual(1);
  });
});
