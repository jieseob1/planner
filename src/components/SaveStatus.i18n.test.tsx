import { act, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { setLanguage } from '../i18n';
import { SaveStatus } from './SaveStatus';
vi.mock('../state/PlannerProvider', () => ({ usePlanner: () => ({ saveStatus: 'saved', retrySync: vi.fn() }) }));
it('updates existing save-status copy when language changes without reloading planner state', () => {
  render(<SaveStatus />);
  expect(screen.getByRole('status')).toHaveTextContent('서버에 저장됨');
  act(() => setLanguage('en', false));
  expect(screen.getByRole('status')).toHaveTextContent('Saved on server');
  act(() => setLanguage('es', false));
  expect(screen.getByRole('status')).toHaveTextContent('Guardado en el servidor');
});
