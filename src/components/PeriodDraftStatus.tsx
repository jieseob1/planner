import type { usePeriodDraft } from '../state/usePeriodDraft';
export function PeriodDraftStatus({ draft }: { draft: Pick<ReturnType<typeof usePeriodDraft>, 'compare' | 'dirty' | 'stored' | 'message' | 'conflict' | 'keepDraft'> }) {
  const latest = draft.compare();
  return <div className="period-draft-status">
    {draft.dirty && <small>{draft.stored ? '이 기기에 입력 보관 중 · 서버 저장 전' : '기기 보관 실패 · 이 화면을 닫지 마세요'}</small>}
    {draft.message && <p role={draft.conflict ? 'alert' : 'status'}>{draft.message}</p>}
    {draft.conflict && <div className="period-conflict">
      <strong>최신 서버 내용과 비교</strong>
      {latest ? <>
        <p>{latest.deleted ? '서버에서는 삭제된 기록입니다.' : `서버 수정: ${latest.updatedAt}`}</p>
        <pre>{JSON.stringify(latest.goal ?? latest.review, null, 2)}</pre>
        <p>내 입력은 위 편집기에 남아 있습니다. 아래 선택 후에도 저장 버튼으로 확정해야 합니다.</p>
        <button type="button" className="button button--secondary" onClick={draft.keepDraft}>비교 완료 · 내 입력 선택</button>
      </> : <p>최신 기록을 확인하지 못했습니다. 입력을 보관한 채 다시 불러와 주세요.</p>}
    </div>}
  </div>;
}
