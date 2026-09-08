import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Modal } from './Modal';
import './BetaFeedback.css';

const ISSUE_URL = 'https://github.com/jieseob1/planner/issues/new';

export function betaReportTemplate(category: string, description: string, timeZone: string): string {
  return `베타 피드백\n유형: ${category}\n시간대: ${timeZone}\n\n재현 방법 / 기대한 동작 / 실제 동작\n${description.trim()}\n\n※ 공개 전에 할 일 제목, 이메일, 토큰 등 개인정보를 지워 주세요.`;
}

export function BetaFeedback({ adminAllowed = false, timeZone }: { adminAllowed?: boolean; timeZone: string }) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState('오류 신고');
  const [description, setDescription] = useState('');
  const [notice, setNotice] = useState('');
  const template = betaReportTemplate(category, description, timeZone);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(template);
      setNotice('복사했습니다. 공개 문의 창에서 개인정보를 확인한 뒤 붙여 넣어 주세요. 아직 전송되지는 않았습니다.');
    } catch {
      setNotice('자동 복사가 안 됩니다. 아래 신고 내용을 직접 선택해 복사해 주세요.');
    }
  };
  return (
    <section className="beta-support" aria-labelledby="beta-support-title">
      <div>
        <p className="eyebrow">BETA · 함께 개선하고 있어요</p>
        <h2 id="beta-support-title">도움이 필요하신가요?</h2>
        <p>할 일만 적어도 괜찮아요. 시간표에 배치하고, 하루를 돌아본 뒤 필요할 때 목표를 연결하세요.</p>
      </div>
      <div className="beta-support__actions">
        <button className="button button--secondary" type="button" onClick={() => { setNotice(''); setOpen(true); }}>문제 신고 · 개선 제안</button>
        {adminAllowed && <><Link className="button button--secondary" to="/admin">백오피스 열기</Link><a className="button button--secondary" href="/ops/grafana/" target="_blank" rel="noreferrer">Grafana 열기</a></>}
      </div>
      {open && <Modal className="beta-feedback-modal" title="베타 피드백" eyebrow="직접 확인한 내용만 공유" description="작성한 내용은 자동 수집하거나 전송하지 않습니다. 문의 창은 GitHub 공개 게시판이므로 개인 기록과 인증 정보는 적지 마세요." onClose={() => setOpen(false)}>
        <label className="field">유형<select value={category} onChange={(event) => setCategory(event.target.value)}><option>오류 신고</option><option>사용성 개선</option><option>기능 제안</option></select></label>
        <label className="field">어떤 상황이었나요?<textarea maxLength={2000} rows={5} value={description} onChange={(event) => { setDescription(event.target.value); setNotice(''); }} placeholder="예: 월간 일정에서 날짜를 바꾸고 저장했는데…" /></label>
        <details><summary>복사할 내용 확인</summary><textarea aria-label="신고 내용" readOnly rows={8} value={template} /></details>
        <p role="status">{notice}</p>
        <div className="modal__actions">
          <button className="button button--secondary" type="button" onClick={() => setOpen(false)}>닫기</button>
          <button className="button button--primary" type="button" disabled={!description.trim()} onClick={() => void copy()}>신고 내용 복사</button>
          <a className="button button--secondary" href={ISSUE_URL} target="_blank" rel="noreferrer">공개 문의 창 열기</a>
        </div>
      </Modal>}
    </section>
  );
}
