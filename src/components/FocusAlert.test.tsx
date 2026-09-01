import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FocusAlert } from './FocusAlert';

describe('FocusAlert', () => {
  it('moves focus to a newly rendered error so keyboard users hear recovery guidance', () => {
    render(<FocusAlert message="Google Calendar 권한을 다시 연결해 주세요." />);

    expect(screen.getByRole('alert')).toHaveFocus();
  });

  it('moves focus back when the error changes after another failed attempt', () => {
    const { rerender } = render(<FocusAlert message="첫 번째 오류" />);
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();

    rerender(<FocusAlert message="두 번째 오류" />);

    expect(screen.getByRole('alert')).toHaveFocus();
    outside.remove();
  });
});
