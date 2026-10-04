import { randomUUID } from 'node:crypto';

// Only disposable, local-auth test stacks may execute this mutating journey.
export async function exercisePlannerSync(browser, desktop, frontendUrl) {
  if (!['localhost', '127.0.0.1'].includes(new URL(frontendUrl).hostname)) throw new Error('Sync test requires an isolated localhost stack');
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mobile = await context.newPage();
  const date = '2026-10-11';
  const title = `두 기기 QA ${randomUUID().slice(0, 8)}`;
  const saved = page => page.getByText('서버에 저장됨', { exact: true }).waitFor({ timeout: 15000 });
  const row = (page, name) => page.getByRole('button', { name: `${name} 수정`, exact: true });
  const create = async (page, name) => {
    await page.getByLabel('빠른 메모', { exact: true }).fill(name);
    await page.getByLabel('빠른 메모', { exact: true }).press('Enter');
  };
  const change = async (page, name, fields) => {
    await row(page, name).click();
    for (const [label, value] of Object.entries(fields)) await page.getByLabel(label, { exact: true }).fill(value);
    await page.getByRole('button', { name: '변경 저장', exact: true }).click();
  };
  const remove = async (page, name) => {
    await row(page, name).click();
    await page.getByRole('button', { name: '할 일 삭제', exact: true }).click();
    await page.getByRole('button', { name: '할 일과 연결 기록 삭제', exact: true }).click();
  };
  const latencies = [];
  const replicated = async (action, assertion) => {
    const start = performance.now();
    await action();
    await assertion();
    const ms = Math.round(performance.now() - start);
    latencies.push(ms);
    if (ms > 2000) throw new Error(`Visible-device sync exceeded 2 seconds: ${ms}ms`);
  };
  try {
    await Promise.all([desktop.goto(`${frontendUrl}/today?date=${date}`), mobile.goto(`${frontendUrl}/today?date=${date}`)]);
    await Promise.all([saved(desktop), saved(mobile)]);
    await replicated(() => create(desktop, title), () => row(mobile, title).waitFor());
    await saved(desktop);
    await desktop.getByRole('button', { name: `${title} 시간 지정`, exact: true }).click();
    await desktop.getByLabel('시작', { exact: true }).selectOption('1080');
    await desktop.getByLabel('종료', { exact: true }).selectOption('1200');
    await replicated(() => desktop.getByRole('button', { name: '시간 저장', exact: true }).click(), () => mobile.getByRole('complementary', { name: '선택한 날짜의 할 일' }).getByText('18:00–20:00', { exact: true }).waitFor());
    await saved(desktop);
    await desktop.getByRole('button', { name: `${title} 시간 지정`, exact: true }).click();
    await desktop.getByLabel('시작', { exact: true }).selectOption('1140');
    await desktop.getByLabel('종료', { exact: true }).selectOption('1260');
    await replicated(() => desktop.getByRole('button', { name: '시간 저장', exact: true }).click(), () => mobile.getByRole('complementary', { name: '선택한 날짜의 할 일' }).getByText('19:00–21:00', { exact: true }).waitFor());
    await saved(desktop);
    await replicated(() => desktop.getByRole('button', { name: `${title} 완료 처리`, exact: true }).click(), () => mobile.getByRole('button', { name: `${title} 완료 취소`, exact: true }).waitFor());
    await saved(desktop);
    await replicated(() => desktop.getByRole('button', { name: '완료 실행 취소', exact: true }).click(), () => mobile.getByRole('button', { name: `${title} 완료 처리`, exact: true }).waitFor());
    console.log(`Two-session visible updates ${latencies.join(', ')}ms`);
    await Promise.all([create(desktop, `${title} A`), create(mobile, `${title} B`)]);
    await Promise.all([row(desktop, `${title} B`).waitFor(), row(mobile, `${title} A`).waitFor(), saved(desktop), saved(mobile)]);
    if (await desktop.getByText('서버 저장 충돌', { exact: true }).count() || await mobile.getByText('서버 저장 충돌', { exact: true }).count()) throw new Error('Disjoint simultaneous additions must merge');
    console.log('Two-session simultaneous additions preserved');

    // Force an actual same-field race, plus an unrelated local note to preserve.
    await context.setOffline(true);
    await change(mobile, title, { '할 일 제목': `${title} 내 초안`, '메모': '충돌 선택 후에도 보존할 메모' });
    await change(desktop, title, { '할 일 제목': `${title} 서버 제목` });
    await saved(desktop);
    await context.setOffline(false);
    await mobile.getByText('서버 저장 충돌', { exact: true }).waitFor();
    await mobile.getByRole('button', { name: '변경 비교', exact: true }).click();
    const dialog = mobile.getByRole('dialog');
    if (await dialog.getByRole('button', { name: '선택 항목 병합', exact: true }).isEnabled()) throw new Error('Real conflicts require an explicit field choice');
    await dialog.getByRole('radio', { name: /서버 내용/ }).check();
    await dialog.getByRole('button', { name: '선택 항목 병합', exact: true }).click();
    await saved(mobile);
    await row(mobile, `${title} 서버 제목`).click();
    if (await mobile.getByLabel('메모', { exact: true }).inputValue() !== '충돌 선택 후에도 보존할 메모') throw new Error('Field merge lost the unrelated local draft');
    await mobile.getByRole('button', { name: '취소', exact: true }).click();
    await desktop.reload(); await saved(desktop);
    await row(desktop, `${title} 서버 제목`).click();
    if (await desktop.getByLabel('메모', { exact: true }).inputValue() !== '충돌 선택 후에도 보존할 메모') throw new Error('Merged data did not survive server reload');
    await desktop.getByRole('button', { name: '취소', exact: true }).click();
    await replicated(() => remove(desktop, `${title} A`), () => row(mobile, `${title} A`).waitFor({ state: 'hidden' }));
    await saved(desktop);
    await context.setOffline(true);
    await change(mobile, `${title} B`, { '메모': '삭제와 경합한 수정 초안' });
    await remove(desktop, `${title} B`); await saved(desktop);
    await context.setOffline(false);
    await mobile.getByText('서버 저장 충돌', { exact: true }).waitFor();
    await mobile.getByRole('button', { name: '변경 비교', exact: true }).click();
    await mobile.getByRole('dialog').getByRole('radio', { name: /서버 내용/ }).check();
    await mobile.getByRole('button', { name: '선택 항목 병합', exact: true }).click();
    await saved(mobile);
    if (await row(mobile, `${title} B`).count()) throw new Error('Deleted task was silently resurrected');
    await desktop.getByRole('button', { name: `${title} 서버 제목 날짜 변경`, exact: true }).click();
    await desktop.getByLabel('할 일 날짜', { exact: true }).fill('2026-10-12');
    await replicated(() => desktop.getByRole('button', { name: '이 날짜로 이동', exact: true }).click(), () => row(mobile, `${title} 서버 제목`).waitFor({ state: 'hidden' }));
    await Promise.all([desktop.goto(`${frontendUrl}/today?date=2026-10-12`), mobile.goto(`${frontendUrl}/today?date=2026-10-12`)]);
    await Promise.all([row(desktop, `${title} 서버 제목`).waitFor(), row(mobile, `${title} 서버 제목`).waitFor()]);
    await mobile.getByRole('complementary', { name: '선택한 날짜의 할 일' }).getByText('19:00–21:00', { exact: true }).waitFor();
    console.log(`Two independent browser sessions: create/time/edit/complete/undo ${latencies.join(', ')}ms; simultaneous edits, offline reconnect, explicit field conflict, and reload passed`);
    return latencies;
  } finally { await context.close(); }
}
