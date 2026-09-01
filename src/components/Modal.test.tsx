import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
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
