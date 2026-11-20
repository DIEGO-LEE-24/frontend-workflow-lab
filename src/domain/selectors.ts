// Everything the screens show that can be worked out from the state is worked out here.
// Nothing in this file is stored, so two screens cannot disagree about a number.

import type { AppState, Finding, Notice, Person } from './model';

export const viewer = (s: AppState): Person => {
  const p = s.people.find((x) => x.id === s.viewerId);
  if (!p) throw new Error('viewerId does not match a person');
  return p;
};

/** A draft is visible to inspectors only. An issued notice is visible to its company and to staff. */
export function visibleNotices(s: AppState, toId: string): readonly Notice[] {
  const p = s.people.find((x) => x.id === toId);
  if (!p) return [];
  if (p.role === 'inspector') return s.notices;
  if (p.role === 'observer') return s.notices.filter((n) => n.status !== 'draft');
  return s.notices.filter((n) => n.status !== 'draft' && n.companyId === p.companyId);
}

/** Only the recipient can have something unread. The person who issued a notice, or someone
 *  watching, can see it but is not waiting to read it. */
export function unreadCount(s: AppState, toId: string): number {
  const p = s.people.find((x) => x.id === toId);
  if (!p || p.role !== 'partner') return 0;
  return visibleNotices(s, toId).filter((n) => n.status === 'issued' && !n.events.some((e) => e.kind === 'seen' && e.by === toId)).length;
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

export const statusCounts = (s: AppState): Record<Notice['status'], number> => ({
  draft: s.notices.filter((n) => n.status === 'draft').length,
  issued: s.notices.filter((n) => n.status === 'issued').length,
  replied: s.notices.filter((n) => n.status === 'replied').length,
});
