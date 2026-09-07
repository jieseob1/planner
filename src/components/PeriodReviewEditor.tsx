import { useState, type FormEvent } from 'react';
import { PeriodDraftStatus } from './PeriodDraftStatus';
import { usePeriodDraft } from '../state/usePeriodDraft';
import { usePeriods } from '../state/PeriodProvider';
import { emptyReview, reviewId, type PeriodRange, type PeriodDocument } from '../domain/periods';

export function PeriodReviewEditor({ range }: { range: PeriodRange }) {
  const periods = usePeriods();
  const document = periods?.documents.find(d => d.review?.id === reviewId(range));
  return <ReviewForm key={`${reviewId(range)}:${Boolean(document?.deleted)}`} range={range} document={document} />;
}
function ReviewForm({ range, document }: { range: PeriodRange; document?: PeriodDocument }) {
  const draft = usePeriodDraft(reviewId(range), document?.deleted ? emptyReview(range) : document?.review ?? emptyReview(range), document?.revision ?? 0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const submit = (event: FormEvent) => { event.preventDefault(); void draft.save(); };
  return <form id="period-review-input" tabIndex={-1} className="period-review-editor" onSubmit={submit}>
    <div className="period-section-title"><h2>{range.period === 'day' ? '하루 마무리' : '이번 기간 돌아보기'}</h2><span>세 줄이면 충분해요</span></div>
    <p className="period-hint">모든 항목은 선택이에요. 목표 수치를 갱신하지 않아도 기록할 수 있어요.</p>
    <fieldset disabled={!draft.ready || draft.busy || draft.conflict}>
      <label className="field"><span>잘된 점</span><textarea aria-label="잘된 점" maxLength={4000} value={draft.value.well} onChange={e => draft.edit({ ...draft.value, well: e.target.value })} placeholder="작게라도 잘된 일을 남겨보세요." /></label>
      <label className="field"><span>막힌 점</span><textarea aria-label="막힌 점" maxLength={4000} value={draft.value.blocked} onChange={e => draft.edit({ ...draft.value, blocked: e.target.value })} placeholder="계획과 달랐던 점이 있었나요?" /></label>
      <label className="field"><span>다음에 바꿀 한 가지</span><textarea aria-label="다음에 바꿀 한 가지" maxLength={4000} value={draft.value.change} onChange={e => draft.edit({ ...draft.value, change: e.target.value })} placeholder="다음에는 이렇게 해볼래요." /></label>
      <details><summary>자유 메모</summary><label className="field"><span>이 날짜·기간의 메모</span><textarea aria-label="이 날짜·기간의 메모" maxLength={4000} value={draft.value.note} onChange={e => draft.edit({ ...draft.value, note: e.target.value })} /></label></details>
      <label className="period-check"><input type="checkbox" checked={draft.value.completed} onChange={e => draft.edit({ ...draft.value, completed: e.target.checked })} /> 돌아보기 완료 표시</label>
    </fieldset>
    <PeriodDraftStatus draft={draft} />
    {document && !document.deleted && <button className="button button--secondary" type="button" disabled={draft.busy || draft.conflict} onClick={() => setConfirmDelete(true)}>이 회고 삭제</button>}
    {confirmDelete && <div className="period-conflict" role="alert"><p>이 기간의 회고만 삭제할까요? 할 일·일정·목표는 삭제되지 않습니다.</p><button type="button" onClick={() => setConfirmDelete(false)}>취소</button><button type="button" disabled={draft.busy || draft.conflict} onClick={() => void draft.save(true)}>회고 삭제 확인</button></div>}
    <footer><small>{document?.deleted ? '삭제된 회고입니다. 새로 작성해 저장할 수 있어요.' : document ? `마지막 서버 저장 ${new Date(document.updatedAt).toLocaleString('ko-KR')}` : '작성한 날짜별로 보관됩니다.'}</small><button className="button button--primary" type="submit" disabled={!draft.ready || draft.busy || draft.conflict}>{draft.busy ? '저장 중…' : '기록 저장'}</button></footer>
  </form>;
}
