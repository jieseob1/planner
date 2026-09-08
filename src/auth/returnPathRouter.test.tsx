import { act, render, screen } from '@testing-library/react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, it } from 'vitest';
import { replaceAuthLocation } from './returnPath';

afterEach(() => window.history.replaceState({}, '', '/'));

it('updates BrowserRouter after a callback without retaining OAuth code in history', () => {
  window.history.replaceState({ idx: 2 }, '', '/auth/callback?code=private&state=random');
  render(<BrowserRouter><Routes><Route path="/admin" element={<h1>운영 관리</h1>} /><Route path="*" element={<p>인증 중</p>} /></Routes></BrowserRouter>);
  expect(screen.getByText('인증 중')).toBeInTheDocument();
  act(() => replaceAuthLocation('/admin'));
  expect(screen.getByRole('heading', { name: '운영 관리' })).toBeInTheDocument();
  expect(window.location.pathname).toBe('/admin');
  expect(window.location.search).toBe('');
  expect(window.history.state.idx).toBe(2);
});
