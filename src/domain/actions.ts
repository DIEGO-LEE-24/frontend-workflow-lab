// State transitions. Every function here is pure: (state, arguments) -> result.
// It never edits the state it was given and never throws for a refused request.
//
// A transition does not answer with "the same state" when it refuses. It answers with a reason,
// so the screen can tell the person why nothing happened:
//   { ok: true,  state: <new state> }
//   { ok: false, state: <the state it was given>, reason: <why> }
//
// Permissions are checked here, not only in the screen. Hiding a button does not stop a call.

import type { AppState, Finding, Notice, NoticeEvent, Person } from './model';

export type Refusal =
  | 'unknown-actor'
  | 'not-allowed'
  | 'not-found'
  | 'wrong-status'
  | 'empty-input'
  | 'mixed-companies'
  | 'other-company';

export type Result =
  | { readonly ok: true; readonly state: AppState }
  | { readonly ok: false; readonly state: AppState; readonly reason: Refusal };

const refuse = (state: AppState, reason: Refusal): Result => ({ ok: false, state, reason });
const accept = (state: AppState): Result => ({ ok: true, state: { ...state, clock: state.clock + 1 } });

const person = (s: AppState, id: string): Person | undefined => s.people.find((p) => p.id === id);
const notice = (s: AppState, id: string): Notice | undefined => s.notices.find((n) => n.id === id);

const replaceNotice = (s: AppState, next: Notice): AppState => ({
  ...s,
  notices: s.notices.map((n) => (n.id === next.id ? next : n)),
});

const withEvent = (n: Notice, event: NoticeEvent): Notice => ({ ...n, events: [...n.events, event] });

export function switchViewer(s: AppState, toId: string): Result {
  if (!person(s, toId)) return refuse(s, 'unknown-actor');
  return accept({ ...s, viewerId: toId });
}

export function createDraft(s: AppState, by: string, findingIds: readonly string[]): Result {
  const actor = person(s, by);
  if (!actor) return refuse(s, 'unknown-actor');
  if (actor.role !== 'inspector') return refuse(s, 'not-allowed');
  if (findingIds.length === 0) return refuse(s, 'empty-input');
  const picked: Finding[] = [];
  for (const id of findingIds) {
    const f = s.findings.find((x) => x.id === id);
    if (!f) return refuse(s, 'not-found');
    picked.push(f);
  }
  const first = picked[0];
  if (!first) return refuse(s, 'empty-input');
  if (picked.some((f) => f.companyId !== first.companyId)) return refuse(s, 'mixed-companies');
  const draft: Notice = {
    id: 'n-' + s.seq,
    companyId: first.companyId,
    findingIds: [...new Set(findingIds)],
    status: 'draft',
    snapshot: null,
    reply: null,
    events: [],
  };
  return accept({ ...s, seq: s.seq + 1, notices: [...s.notices, draft] });
}

export function editFinding(s: AppState, by: string, findingId: string, text: string): Result {
  const actor = person(s, by);
  if (!actor) return refuse(s, 'unknown-actor');
  if (actor.role !== 'inspector') return refuse(s, 'not-allowed');
  const trimmed = text.trim();
  if (trimmed === '') return refuse(s, 'empty-input');
  if (!s.findings.some((f) => f.id === findingId)) return refuse(s, 'not-found');
  return accept({ ...s, findings: s.findings.map((f) => (f.id === findingId ? { ...f, text: trimmed } : f)) });
}

export function issueNotice(s: AppState, by: string, noticeId: string): Result {
  const actor = person(s, by);
  if (!actor) return refuse(s, 'unknown-actor');
  if (actor.role !== 'inspector') return refuse(s, 'not-allowed');
  const n = notice(s, noticeId);
  if (!n) return refuse(s, 'not-found');
  if (n.status !== 'draft') return refuse(s, 'wrong-status');
  // The recipient is shown this copy. Later edits to the findings do not reach it.
  const findings = n.findingIds
    .map((id) => s.findings.find((f) => f.id === id))
    .filter((f): f is Finding => f !== undefined)
    .map((f) => ({ ...f }));
  const issued: Notice = withEvent(
    { ...n, status: 'issued', snapshot: { issuedAt: s.clock, issuedBy: by, dueInDays: s.dueInDays, findings } },
    { at: s.clock, by, kind: 'issued' },
  );
  return accept(replaceNotice(s, issued));
}

function recipient(s: AppState, by: string, noticeId: string): { n: Notice } | { reason: Refusal } {
  const actor = person(s, by);
  if (!actor) return { reason: 'unknown-actor' };
  const n = notice(s, noticeId);
  if (!n) return { reason: 'not-found' };
  if (actor.role !== 'partner') return { reason: 'not-allowed' };
  if (actor.companyId !== n.companyId) return { reason: 'other-company' };
  return { n };
}

export function markSeen(s: AppState, by: string, noticeId: string): Result {
  const r = recipient(s, by, noticeId);
  if ('reason' in r) return refuse(s, r.reason);
  if (r.n.status === 'draft') return refuse(s, 'wrong-status');
  // Seeing the same notice twice is not a second event.
  if (r.n.events.some((e) => e.kind === 'seen' && e.by === by)) return refuse(s, 'wrong-status');
  return accept(replaceNotice(s, withEvent(r.n, { at: s.clock, by, kind: 'seen' })));
}

export function replyNotice(s: AppState, by: string, noticeId: string, text: string): Result {
  const r = recipient(s, by, noticeId);
  if ('reason' in r) return refuse(s, r.reason);
  if (r.n.status !== 'issued') return refuse(s, 'wrong-status');
  const trimmed = text.trim();
  if (trimmed === '') return refuse(s, 'empty-input');
  const replied = withEvent({ ...r.n, status: 'replied', reply: trimmed }, { at: s.clock, by, kind: 'replied' });
  return accept(replaceNotice(s, replied));
}

export const REFUSAL_TEXT: Record<Refusal, string> = {
  'unknown-actor': '누구의 요청인지 알 수 없습니다.',
  'not-allowed': '이 역할로는 할 수 없는 일입니다.',
  'not-found': '대상을 찾지 못했습니다.',
  'wrong-status': '지금 상태에서는 할 수 없는 일입니다.',
  'empty-input': '내용이 비어 있습니다.',
  'mixed-companies': '서로 다른 업체의 지적은 한 통보에 묶을 수 없습니다.',
  'other-company': '다른 업체의 통보입니다.',
};
