import { useState } from 'react';
import { REFUSAL_TEXT, createDraft, editFinding, issueNotice, markSeen, replyNotice, switchViewer } from '../domain/actions';
import type { Notice } from '../domain/model';
import { shownFindings, sourceChangedSinceIssue, statusCounts, unreadCount, viewer, visibleNotices } from '../domain/selectors';
import { useFailure, useSelector, type Store } from '../store/store';

const STATUS_TEXT: Record<Notice['status'], string> = { draft: '초안', issued: '발행됨', replied: '회신됨' };
const EVENT_TEXT = { issued: '발행', seen: '열람', replied: '회신' } as const;

export function App({ store }: { store: Store }) {
  return (
    <main className="app">
      <h1>통보 흐름 실습실</h1>
      <p className="note">
        한 브라우저에서 보는 사람을 바꿔 가며 초안 → 발행 → 열람 → 회신을 따라가 보는 예제입니다. 서버가 없으며, 사람 사이의 실제 전송은 다루지
        않습니다.
      </p>
      <RoleSwitcher store={store} />
      <FailureBanner store={store} />
      <Counts store={store} />
      <Findings store={store} />
      <Notices store={store} />
    </main>
  );
}

function RoleSwitcher({ store }: { store: Store }) {
  const people = useSelector(store, (s) => s.people);
  const viewerId = useSelector(store, (s) => s.viewerId);
  return (
    <fieldset>
      <legend>보는 사람</legend>
      {people.map((p) => (
        <label key={p.id}>
          <input type="radio" name="viewer" checked={p.id === viewerId} onChange={() => store.dispatch((s) => switchViewer(s, p.id))} />
          {p.name}
          <Unread store={store} personId={p.id} />
        </label>
      ))}
    </fieldset>
  );
}

function Unread({ store, personId }: { store: Store; personId: string }) {
  const n = useSelector(store, (s) => unreadCount(s, personId));
  return n > 0 ? <span className="badge" aria-label={'읽지 않은 통보 ' + n + '건'}>{n}</span> : null;
}

function FailureBanner({ store }: { store: Store }) {
  const failure = useFailure(store);
  if (!failure) return null;
  return (
    <p role="alert" className="failure">
      {REFUSAL_TEXT[failure.reason]} <button onClick={() => store.clearFailure()}>닫기</button>
    </p>
  );
}

function Counts({ store }: { store: Store }) {
  const draft = useSelector(store, (s) => statusCounts(s).draft);
  const issued = useSelector(store, (s) => statusCounts(s).issued);
  const replied = useSelector(store, (s) => statusCounts(s).replied);
  return (
    <p data-testid="counts">
      초안 {draft} · 발행됨 {issued} · 회신됨 {replied}
    </p>
  );
}

function Findings({ store }: { store: Store }) {
  const findings = useSelector(store, (s) => s.findings);
  const me = useSelector(store, viewer);
  const [picked, setPicked] = useState<readonly string[]>([]);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  return (
    <section aria-label="지적">
      <h2>지적</h2>
      <ul>
        {findings.map((f) => (
          <li key={f.id}>
            <label>
              <input type="checkbox" checked={picked.includes(f.id)} onChange={() => toggle(f.id)} aria-label={f.id + ' 고르기'} />
              <code>{f.companyId}</code>
            </label>
            <input
              aria-label={f.id + ' 내용'}
              defaultValue={f.text}
              key={f.text}
              onBlur={(e) => {
                if (e.target.value !== f.text) store.dispatch((s) => editFinding(s, me.id, f.id, e.target.value));
              }}
            />
          </li>
        ))}
      </ul>
      {/* The button is shown to every role on purpose. The transition refuses, and the banner says why. */}
      <button
        onClick={() => {
          const r = store.dispatch((s) => createDraft(s, me.id, picked));
          if (r.ok) setPicked([]);
        }}
      >
        고른 지적으로 통보 초안 만들기
      </button>
    </section>
  );
}

function Notices({ store }: { store: Store }) {
  const viewerId = useSelector(store, (s) => s.viewerId);
  const ids = useSelector(store, (s) => visibleNotices(s, s.viewerId).map((n) => n.id).join(','));
  return (
    <section aria-label="통보">
      <h2>통보</h2>
      {ids === '' ? <p>보이는 통보가 없습니다.</p> : ids.split(',').map((id) => <NoticeCard key={id} store={store} noticeId={id} viewerId={viewerId} />)}
    </section>
  );
}

function NoticeCard({ store, noticeId, viewerId }: { store: Store; noticeId: string; viewerId: string }) {
  const notice = useSelector(store, (s) => s.notices.find((n) => n.id === noticeId));
  const shown = useSelector(store, (s) => {
    const n = s.notices.find((x) => x.id === noticeId);
    return n ? shownFindings(s, n).map((f) => f.text).join('\n') : '';
  });
  const changed = useSelector(store, (s) => {
    const n = s.notices.find((x) => x.id === noticeId);
    return n ? sourceChangedSinceIssue(s, n) : false;
  });
  const [text, setText] = useState('');
  if (!notice) return null;
  return (
    <article data-testid={'notice-' + notice.id}>
      <h3>
        {notice.id} · {notice.companyId} · {STATUS_TEXT[notice.status]}
      </h3>
      <ul>
        {shown.split('\n').map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
      {notice.snapshot && <p className="note">발행 당시의 내용입니다. 회신 기한 {notice.snapshot.dueInDays}일.</p>}
      {changed && <p className="note">발행 뒤에 지적 내용이 바뀌었습니다. 이 통보는 발행 당시 내용 그대로입니다.</p>}
      {notice.reply !== null && <p>회신: {notice.reply}</p>}
      <p className="note">이력: {notice.events.length === 0 ? '없음' : notice.events.map((e) => EVENT_TEXT[e.kind] + '(' + e.by + ')').join(' → ')}</p>
      <div className="row">
        <button onClick={() => store.dispatch((s) => issueNotice(s, viewerId, notice.id))}>발행</button>
        <button onClick={() => store.dispatch((s) => markSeen(s, viewerId, notice.id))}>열람 확인</button>
        <input aria-label={notice.id + ' 회신 내용'} value={text} onChange={(e) => setText(e.target.value)} />
        <button
          onClick={() => {
            const r = store.dispatch((s) => replyNotice(s, viewerId, notice.id, text));
            if (r.ok) setText('');
          }}
        >
          회신
        </button>
      </div>
    </article>
  );
}
