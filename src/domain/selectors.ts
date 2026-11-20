// Everything the screens show that can be worked out from the state is worked out here.
// Nothing in this file is stored, so two screens cannot disagree about a number.
//
// Visibility is decided in one place. A screen never reads `state.findings` or `state.notices`
// directly; it asks what a given person may see.
//   inspector  every finding, every notice including drafts
//   observer   every finding, every notice except drafts
//   partner    only its own company's findings and issued notices

import { issueNotice, markSeen, replyNotice, type Refusal, type Result } from './actions';
import type { AppState, Finding, Notice, Person } from './model';

const personOf = (s: AppState, id: string): Person | undefined => s.people.find((x) => x.id === id);

export const viewer = (s: AppState): Person => {
  const p = personOf(s, s.viewerId);
  if (!p) throw new Error('viewerId does not match a person');
  return p;
};

export function visibleNotices(s: AppState, toId: string): readonly Notice[] {
  const p = personOf(s, toId);
  if (!p) return [];
  if (p.role === 'inspector') return s.notices;
  if (p.role === 'observer') return s.notices.filter((n) => n.status !== 'draft');
  return s.notices.filter((n) => n.status !== 'draft' && n.companyId === p.companyId);
}

export function visibleFindings(s: AppState, toId: string): readonly Finding[] {
  const p = personOf(s, toId);
  if (!p) return [];
  if (p.role === 'partner') return s.findings.filter((f) => f.companyId === p.companyId);
  return s.findings;
}

export function visibleStatusCounts(s: AppState, toId: string): Record<Notice['status'], number> {
  const seen = visibleNotices(s, toId);
  return {
    draft: seen.filter((n) => n.status === 'draft').length,
    issued: seen.filter((n) => n.status === 'issued').length,
    replied: seen.filter((n) => n.status === 'replied').length,
  };
}

/** Reading is per person. A record lifted from an old save says only that somebody at the
 *  company saw it; that counts for everyone there, so nobody is told again about an old notice. */
export const hasSeen = (n: Notice, personId: string): boolean => n.events.some((e) => e.kind === 'seen' && (e.by === personId || e.by === null));

/** Only a recipient can have something unread. It stays unread for a person until that person
 *  opens it, even if a colleague has already replied for the company. */
export function unreadCount(s: AppState, toId: string): number {
  const p = personOf(s, toId);
  if (!p || p.role !== 'partner') return 0;
  return visibleNotices(s, toId).filter((n) => !hasSeen(n, toId)).length;
}

/** What the recipient is shown: the copy made at issue, or the live findings while it is a draft. */
export function shownFindings(s: AppState, n: Notice): readonly Finding[] {
  if (n.snapshot) return n.snapshot.findings;
  return n.findingIds.map((id) => s.findings.find((f) => f.id === id)).filter((f): f is Finding => f !== undefined);
}

/** True when a finding was edited after the notice was issued. The notice still shows the old text. */
export function sourceChangedSinceIssue(s: AppState, n: Notice): boolean {
  if (!n.snapshot) return false;
  return n.snapshot.findings.some((frozen) => s.findings.find((f) => f.id === frozen.id)?.text !== frozen.text);
}

// --- selectors that return lists -------------------------------------------------------------
// A subscribing component re-renders when the selected value is a different reference. A selector
// that builds a new array on every call would therefore re-render on every change. These remember
// the last answer and hand back the same array while their inputs are the same objects.

function remember<A extends readonly unknown[], R>(compute: (...args: A) => R): (...args: A) => R {
  let lastArgs: A | null = null;
  let lastResult: R;
  return (...args: A): R => {
    if (lastArgs && lastArgs.length === args.length && lastArgs.every((a, i) => a === args[i])) return lastResult;
    lastArgs = args;
    lastResult = compute(...args);
    return lastResult;
  };
}

const idsFor = remember((notices: AppState['notices'], people: AppState['people'], toId: string): readonly string[] =>
  visibleNotices({ notices, people } as AppState, toId).map((n) => n.id),
);
export const visibleNoticeIds = (s: AppState): readonly string[] => idsFor(s.notices, s.people, s.viewerId);

const findingsFor = remember((findings: AppState['findings'], people: AppState['people'], toId: string): readonly Finding[] =>
  visibleFindings({ findings, people } as AppState, toId),
);
export const viewerFindings = (s: AppState): readonly Finding[] => findingsFor(s.findings, s.people, s.viewerId);

// --- what a person can do with a notice right now ---------------------------------------------
// The transitions are pure, so the screen can simply ask them. There is no second copy of the
// rules for the screen to drift away from.

export type Availability = { readonly state: 'enabled' } | { readonly state: 'disabled'; readonly reason: Refusal } | { readonly state: 'hidden' };

const NEVER_FOR_THIS_PERSON: readonly Refusal[] = ['not-allowed', 'other-company', 'unknown-actor'];

const availability = (r: Result): Availability => {
  if (r.ok) return { state: 'enabled' };
  return NEVER_FOR_THIS_PERSON.includes(r.reason) ? { state: 'hidden' } : { state: 'disabled', reason: r.reason };
};

export const canIssue = (s: AppState, by: string, noticeId: string): Availability => availability(issueNotice(s, by, noticeId));
export const canMarkSeen = (s: AppState, by: string, noticeId: string): Availability => availability(markSeen(s, by, noticeId));
export const canReply = (s: AppState, by: string, noticeId: string, text: string): Availability => availability(replyNotice(s, by, noticeId, text));
