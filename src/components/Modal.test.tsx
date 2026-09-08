import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Modal } from './Modal';

function ModalHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>새 계획</button>
      {open ? (
        <Modal title="새 연간·분기 계획" onClose={() => setOpen(false)}>
          <textarea aria-label="이번 분기 핵심 결과" autoFocus data-autofocus />
        </Modal>
      ) : null}
    </>
  );
}

describe('Modal', () => {
  it('restores focus to the trigger even when a child uses autoFocus', async () => {
    const user = userEvent.setup();
    render(<ModalHarness />);
    const trigger = screen.getByRole('button', { name: '새 계획' });
    await user.click(trigger);
    expect(screen.getByLabelText('이번 분기 핵심 결과')).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(trigger).toHaveFocus();
  });
});

it('keeps keyboard focus inside a dialog including links and collapsed details', async () => {
  const user = userEvent.setup();
  render(<Modal title="도움말" onClose={vi.fn()}><details><summary>자세히</summary><textarea aria-label="숨은 내용" /></details><a href="https://example.test">문의</a></Modal>);
  const close = screen.getByRole('button', { name: '닫기' });
  const link = screen.getByRole('link', { name: '문의' });
  expect(close).toHaveFocus();
  await user.tab({ shift: true });
  expect(link).toHaveFocus();
  await user.tab();
  expect(close).toHaveFocus();
  await user.tab();
  expect(screen.getByText('자세히')).toHaveFocus();
  await user.tab();
  expect(link).toHaveFocus();
});
