import { useState } from 'react';
import { REFUSAL_TEXT, createDraft, editFinding, issueNotice, markSeen, replyNotice, switchViewer, type Refusal } from '../domain/actions';
import { LOAD_FAILURE_TEXT } from '../domain/migrate';
import type { AppState, Notice, NoticeEvent } from '../domain/model';
import {
  canIssue,
  canMarkSeen,
  canReply,
  shownFindings,
  sourceChangedSinceIssue,
  unreadCount,
  viewer,
  viewerFindings,
  visibleNoticeIds,
  visibleStatusCounts,
  type Availability,
} from '../domain/selectors';
import { useFailure, useSelector, type Store } from '../store/store';

const STATUS_TEXT: Record<Notice['status'], string> = { draft: '초안', issued: '발행됨', replied: '회신됨' };
const EVENT_TEXT: Record<NoticeEvent['kind'], string> = { issued: '발행', seen: '열람', replied: '회신' };

const eventText = (e: NoticeEvent): string =>
  e.by === null || e.at === null ? EVENT_TEXT[e.kind] + '(이전 판의 기록 · 열람자와 시각 미상)' : EVENT_TEXT[e.kind] + '(' + e.by + ')';

export function App({ store }: { store: Store }) {
  return (
    <main className="app">
      <h1>통보 흐름 실습실</h1>
      <p className="note">
        한 브라우저에서 보는 사람을 바꿔 가며 초안 → 발행 → 열람 → 회신을 따라가 보는 예제입니다. 서버가 없으며, 사람 사이의 실제 전송은 다루지
        않습니다.
      </p>
      <LoadNotice store={store} />
      <RoleSwitcher store={store} />
      <FailureBanner store={store} />
      <Counts store={store} />
      <Findings store={store} />
      <Notices store={store} />
    </main>
  );
}

/** Shown once per page load when the saved state could not be used. */
function LoadNotice({ store }: { store: Store }) {
  const loaded = store.loaded;
  if (loaded.ok) {
    return loaded.migratedFrom === null ? null : (
      <p role="status" className="note">
        이전 판({loaded.migratedFrom})의 저장본을 지금 모양으로 올려서 열었습니다.
      </p>
    );
  }
  return (
    <p role="status" className="failure">
      저장된 내용을 읽지 못해 처음 상태로 엽니다. 까닭: {LOAD_FAILURE_TEXT[loaded.reason]}.
    </p>
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
  return n > 0 ? (
    <span className="badge" aria-label={'읽지 않은 통보 ' + n + '건'}>
      {n}
    </span>
  ) : null;
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

/** Totals of what the viewer may see. A partner is not told how many drafts exist. */
function Counts({ store }: { store: Store }) {
  const isInspector = useSelector(store, (s) => viewer(s).role === 'inspector');
  const draft = useSelector(store, (s) => visibleStatusCounts(s, s.viewerId).draft);
  const issued = useSelector(store, (s) => visibleStatusCounts(s, s.viewerId).issued);
  const replied = useSelector(store, (s) => visibleStatusCounts(s, s.viewerId).replied);
  return (
    <p data-testid="counts">
      {isInspector ? '초안 ' + draft + ' · ' : ''}발행됨 {issued} · 회신됨 {replied}
    </p>
  );
}

function Findings({ store }: { store: Store }) {
  const findings = useSelector(store, viewerFindings);
  const me = useSelector(store, viewer);
  const [picked, setPicked] = useState<readonly string[]>([]);
  const canWrite = me.role === 'inspector';
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  // Asked of the transition itself, with what is picked right now.
  const draftCheck = useSelector(store, (s) => {
    const r = createDraft(s, s.viewerId, picked);
    return r.ok ? '' : r.reason;
  });
  return (
    <section aria-label="지적">
      <h2>지적</h2>
      {findings.length === 0 && <p>보이는 지적이 없습니다.</p>}
      <ul>
        {findings.map((f) => (
          <li key={f.id}>
            {canWrite ? (
              <>
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
              </>
            ) : (
              <span>{f.text}</span>
            )}
          </li>
        ))}
      </ul>
      {canWrite && (
        <p>
          <button
            disabled={draftCheck !== ''}
            aria-describedby="draft-why"
            onClick={() => {
              const r = store.dispatch((s) => createDraft(s, me.id, picked));
              if (r.ok) setPicked([]);
            }}
          >
            고른 지적으로 통보 초안 만들기
          </button>{' '}
          <small id="draft-why">{draftCheck === '' ? '' : draftCheck === 'empty-input' ? '지적을 하나 이상 고르세요.' : REFUSAL_TEXT[draftCheck]}</small>
        </p>
      )}
    </section>
  );
}

function Notices({ store }: { store: Store }) {
  const viewerId = useSelector(store, (s) => s.viewerId);
  const ids = useSelector(store, visibleNoticeIds);
  return (
    <section aria-label="통보">
      <h2>통보</h2>
      {ids.length === 0 ? <p>보이는 통보가 없습니다.</p> : ids.map((id) => <NoticeCard key={id} store={store} noticeId={id} viewerId={viewerId} />)}
    </section>
  );
}

/** One action of a notice: not rendered when this person can never do it, and disabled with the
 *  reason beside it when it is only the current state that prevents it. */
function ActionButton({ label, availability, onClick }: { label: string; availability: Availability; onClick: () => void }) {
  if (availability.state === 'hidden') return null;
  if (availability.state === 'enabled') return <button onClick={onClick}>{label}</button>;
  return (
    <>
      <button disabled>{label}</button>
      <small>{REFUSAL_TEXT[availability.reason]}</small>
    </>
  );
}

const ENABLED: Availability = { state: 'enabled' };
const HIDDEN: Availability = { state: 'hidden' };
const DISABLED = Object.fromEntries(Object.keys(REFUSAL_TEXT).map((reason) => [reason, { state: 'disabled', reason }])) as Record<Refusal, Availability>;

/** An availability is built fresh on every read. Handing React one shared object per outcome keeps
 *  the subscription from re-rendering when the outcome has not changed. */
function useAvailability(store: Store, ask: (s: AppState) => Availability): Availability {
  return useSelector(store, (s) => {
    const a = ask(s);
    return a.state === 'disabled' ? DISABLED[a.reason] : a.state === 'enabled' ? ENABLED : HIDDEN;
  });
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
  const issue = useAvailability(store, (s) => canIssue(s, viewerId, noticeId));
  const seen = useAvailability(store, (s) => canMarkSeen(s, viewerId, noticeId));
  const reply = useAvailability(store, (s) => canReply(s, viewerId, noticeId, text));
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
      <p className="note">이력: {notice.events.length === 0 ? '없음' : notice.events.map(eventText).join(' → ')}</p>
      <div className="row">
        <ActionButton label="발행" availability={issue} onClick={() => store.dispatch((s) => issueNotice(s, viewerId, notice.id))} />
        <ActionButton label="열람 확인" availability={seen} onClick={() => store.dispatch((s) => markSeen(s, viewerId, notice.id))} />
        {reply.state !== 'hidden' && !(reply.state === 'disabled' && reply.reason === 'wrong-status') && (
          <input aria-label={notice.id + ' 회신 내용'} value={text} onChange={(e) => setText(e.target.value)} />
        )}
        <ActionButton
          label="회신"
          availability={reply}
          onClick={() => {
            const r = store.dispatch((s) => replyNotice(s, viewerId, notice.id, text));
            if (r.ok) setText('');
          }}
        />
      </div>
    </article>
  );
}
