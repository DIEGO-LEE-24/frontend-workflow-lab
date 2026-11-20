import { describe, expect, it } from 'vitest';
import { createDraft, editFinding, issueNotice, markSeen, replyNotice, switchViewer, type Result } from '../src/domain/actions';
import { seedState, type AppState } from '../src/domain/model';
import { shownFindings, sourceChangedSinceIssue, statusCounts, unreadCount, visibleNotices } from '../src/domain/selectors';

const INSPECTOR = 'p-inspector';
const ALPHA = 'p-alpha';
const BETA = 'p-beta';
const OBSERVER = 'p-observer';

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

/** Every state used in these tests is frozen all the way down. A transition that edited its
 *  input in place would throw here instead of passing quietly. */
const start = (): AppState => deepFreeze(seedState());
const must = (r: Result): AppState => {
  if (!r.ok) throw new Error('expected the transition to be accepted, got ' + r.reason);
  return deepFreeze(r.state);
};
const reasonOf = (r: Result): string => (r.ok ? 'accepted' : r.reason);

const issuedToAlpha = (): AppState => {
  const drafted = must(createDraft(start(), INSPECTOR, ['f-1', 'f-2']));
  return must(issueNotice(drafted, INSPECTOR, 'n-3'));
};

describe('the flow', () => {
  it('goes draft -> issued -> seen -> replied and records who did what', () => {
    const issued = issuedToAlpha();
    expect(issued.notices[0]?.status).toBe('issued');
    const seen = must(markSeen(issued, ALPHA, 'n-3'));
    const replied = must(replyNotice(seen, ALPHA, 'n-3', '  치웠습니다  '));
    const n = replied.notices[0];
    expect(n?.status).toBe('replied');
    expect(n?.reply).toBe('치웠습니다');
    expect(n?.events.map((e) => e.kind + ':' + e.by)).toEqual(['issued:' + INSPECTOR, 'seen:' + ALPHA, 'replied:' + ALPHA]);
  });

  it('moves the logical clock only when a request is accepted', () => {
    const s = start();
    expect(must(switchViewer(s, ALPHA)).clock).toBe(s.clock + 1);
    const refused = issueNotice(s, ALPHA, 'n-3');
    expect(refused.ok).toBe(false);
    expect(refused.state.clock).toBe(s.clock);
  });
});

describe('a refused request', () => {
  it('returns the very state it was given, with a reason', () => {
    const s = start();
    const r = createDraft(s, ALPHA, ['f-1']);
    expect(r.ok).toBe(false);
    expect(r.state).toBe(s);
    expect(reasonOf(r)).toBe('not-allowed');
  });

  it('tells apart the different reasons for the same button', () => {
    const drafted = must(createDraft(start(), INSPECTOR, ['f-1']));
    const issued = must(issueNotice(drafted, INSPECTOR, 'n-3'));
    expect(reasonOf(issueNotice(drafted, ALPHA, 'n-3'))).toBe('not-allowed');
    expect(reasonOf(issueNotice(drafted, INSPECTOR, 'n-99'))).toBe('not-found');
    expect(reasonOf(issueNotice(issued, INSPECTOR, 'n-3'))).toBe('wrong-status');
    expect(reasonOf(issueNotice(drafted, 'nobody', 'n-3'))).toBe('unknown-actor');
  });

  it('rejects bad input', () => {
    const s = start();
    expect(reasonOf(createDraft(s, INSPECTOR, []))).toBe('empty-input');
    expect(reasonOf(createDraft(s, INSPECTOR, ['f-404']))).toBe('not-found');
    expect(reasonOf(createDraft(s, INSPECTOR, ['f-1', 'f-3']))).toBe('mixed-companies');
    expect(reasonOf(editFinding(s, INSPECTOR, 'f-1', '   '))).toBe('empty-input');
    expect(reasonOf(replyNotice(issuedToAlpha(), ALPHA, 'n-3', ' '))).toBe('empty-input');
  });
});

describe('permissions are enforced by the transitions, for every role', () => {
  const issued = issuedToAlpha();
  const drafted = must(createDraft(start(), INSPECTOR, ['f-1']));
  const cases: Array<[string, (by: string) => Result, Record<string, string>]> = [
    ['createDraft', (by) => createDraft(start(), by, ['f-1']), { [INSPECTOR]: 'accepted', [ALPHA]: 'not-allowed', [BETA]: 'not-allowed', [OBSERVER]: 'not-allowed' }],
    ['editFinding', (by) => editFinding(start(), by, 'f-1', 'x'), { [INSPECTOR]: 'accepted', [ALPHA]: 'not-allowed', [BETA]: 'not-allowed', [OBSERVER]: 'not-allowed' }],
    ['issueNotice', (by) => issueNotice(drafted, by, 'n-3'), { [INSPECTOR]: 'accepted', [ALPHA]: 'not-allowed', [BETA]: 'not-allowed', [OBSERVER]: 'not-allowed' }],
    ['markSeen', (by) => markSeen(issued, by, 'n-3'), { [INSPECTOR]: 'not-allowed', [ALPHA]: 'accepted', [BETA]: 'other-company', [OBSERVER]: 'not-allowed' }],
    ['replyNotice', (by) => replyNotice(issued, by, 'n-3', 'ok'), { [INSPECTOR]: 'not-allowed', [ALPHA]: 'accepted', [BETA]: 'other-company', [OBSERVER]: 'not-allowed' }],
  ];
  for (const [name, call, expected] of cases) {
    for (const [by, outcome] of Object.entries(expected)) {
      it(name + ' by ' + by + ' -> ' + outcome, () => {
        expect(reasonOf(call(by))).toBe(outcome);
      });
    }
  }

  it('a partner cannot act on a draft even of its own company', () => {
    expect(reasonOf(markSeen(drafted, ALPHA, 'n-3'))).toBe('wrong-status');
    expect(reasonOf(replyNotice(drafted, ALPHA, 'n-3', 'ok'))).toBe('wrong-status');
  });
});

describe('the copy made at issue', () => {
  it('does not change when the finding is edited afterwards', () => {
    const issued = issuedToAlpha();
    const edited = must(editFinding(issued, INSPECTOR, 'f-1', '통로를 비웠음'));
    const n = edited.notices[0];
    if (!n) throw new Error('notice missing');
    expect(shownFindings(edited, n).map((f) => f.text)).toEqual(['통로에 자재가 쌓여 있음', '소화기 앞이 막혀 있음']);
    expect(edited.findings.find((f) => f.id === 'f-1')?.text).toBe('통로를 비웠음');
    expect(sourceChangedSinceIssue(edited, n)).toBe(true);
    expect(sourceChangedSinceIssue(issued, issued.notices[0]!)).toBe(false);
  });

  it('a draft shows the live text until it is issued', () => {
    const drafted = must(createDraft(start(), INSPECTOR, ['f-1']));
    const edited = must(editFinding(drafted, INSPECTOR, 'f-1', '고친 내용'));
    expect(shownFindings(edited, edited.notices[0]!).map((f) => f.text)).toEqual(['고친 내용']);
  });
});

describe('derived values', () => {
  it('a draft is invisible to partners; an issued notice is visible only to its company', () => {
    const drafted = must(createDraft(start(), INSPECTOR, ['f-1']));
    expect(visibleNotices(drafted, ALPHA)).toHaveLength(0);
    const issued = must(issueNotice(drafted, INSPECTOR, 'n-3'));
    expect(visibleNotices(issued, ALPHA)).toHaveLength(1);
    expect(visibleNotices(issued, BETA)).toHaveLength(0);
    expect(visibleNotices(issued, OBSERVER)).toHaveLength(1);
  });

  it('unread goes 1 -> 0 on seeing, and seeing twice is refused rather than counted twice', () => {
    const issued = issuedToAlpha();
    expect(unreadCount(issued, ALPHA)).toBe(1);
    expect([unreadCount(issued, INSPECTOR), unreadCount(issued, OBSERVER), unreadCount(issued, BETA)]).toEqual([0, 0, 0]);
    const seen = must(markSeen(issued, ALPHA, 'n-3'));
    expect(unreadCount(seen, ALPHA)).toBe(0);
    expect(reasonOf(markSeen(seen, ALPHA, 'n-3'))).toBe('wrong-status');
    expect(seen.notices[0]?.events.filter((e) => e.kind === 'seen')).toHaveLength(1);
  });

  it('status counts follow the notices', () => {
    const issued = issuedToAlpha();
    expect(statusCounts(issued)).toEqual({ draft: 0, issued: 1, replied: 0 });
    const replied = must(replyNotice(issued, ALPHA, 'n-3', 'ok'));
    expect(statusCounts(replied)).toEqual({ draft: 0, issued: 0, replied: 1 });
  });
});
