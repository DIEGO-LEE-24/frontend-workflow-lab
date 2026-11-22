// Regression tests for the defects found in an outside review of the first version.
// Each block names the defect and reproduces it. They were written before the fixes and failed.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createDraft, issueNotice, markSeen, replyNotice, type Result } from '../src/domain/actions';
import { loadSaved } from '../src/domain/migrate';
import { seedState, type AppState } from '../src/domain/model';
import { unreadCount, visibleFindings, visibleStatusCounts } from '../src/domain/selectors';
import { browserStorage, createStore } from '../src/store/store';
import { App } from '../src/ui/App';

afterEach(cleanup);

const must = (r: Result): AppState => {
  if (!r.ok) throw new Error('expected accepted, got ' + r.reason);
  return r.state;
};
const issuedToAlpha = (from: AppState = seedState()): AppState => must(issueNotice(must(createDraft(from, 'p-inspector', ['f-1', 'f-2'])), 'p-inspector', 'n-3'));
const withSecondAlpha = (): AppState => {
  const s = seedState();
  return { ...s, people: [...s.people, { id: 'p-alpha-2', name: '알파 업체 담당 2', role: 'partner', companyId: 'c-alpha' }] };
};

describe('defect 1: another company could read findings and totals that were not addressed to it', () => {
  it('a partner is given only its own company\'s findings', () => {
    const s = seedState();
    expect(visibleFindings(s, 'p-beta').map((f) => f.id)).toEqual(['f-3']);
    expect(visibleFindings(s, 'p-alpha').map((f) => f.id)).toEqual(['f-1', 'f-2']);
    expect(visibleFindings(s, 'p-inspector')).toHaveLength(3);
    expect(visibleFindings(s, 'nobody')).toHaveLength(0);
  });

  it('counts cover only what the viewer may see', () => {
    const replied = must(replyNotice(issuedToAlpha(), 'p-alpha', 'n-3', 'ok'));
    expect(visibleStatusCounts(replied, 'p-alpha')).toEqual({ draft: 0, issued: 0, replied: 1 });
    expect(visibleStatusCounts(replied, 'p-beta')).toEqual({ draft: 0, issued: 0, replied: 0 });
    const drafted = must(createDraft(seedState(), 'p-inspector', ['f-1']));
    expect(visibleStatusCounts(drafted, 'p-alpha').draft).toBe(0);
    expect(visibleStatusCounts(drafted, 'p-inspector').draft).toBe(1);
  });

  it('on the screen, the other company sees neither the text, nor the card, nor the total', () => {
    const store = createStore(null);
    store.dispatch((s) => createDraft(s, 'p-inspector', ['f-1', 'f-2']));
    store.dispatch((s) => issueNotice(s, 'p-inspector', 'n-3'));
    store.dispatch((s) => replyNotice(s, 'p-alpha', 'n-3', 'ok'));
    render(<App store={store} />);
    fireEvent.click(screen.getByLabelText(/^베타 업체 담당/));
    const page = document.body.textContent ?? '';
    expect(page).not.toContain('통로에 자재가 쌓여 있음');
    expect(page).not.toContain('소화기 앞이 막혀 있음');
    expect(screen.queryByTestId('notice-n-3')).toBeNull();
    expect(screen.getByTestId('counts').textContent).toBe('발행됨 0 · 회신됨 0');
    expect(page).toContain('안전 표지가 떨어져 있음');
  });
});

describe('defect 2: a save with a missing nested field was accepted and broke the screen later', () => {
  const broken = (edit: (s: Record<string, unknown>) => void): string => {
    const s = JSON.parse(JSON.stringify(issuedToAlpha())) as Record<string, unknown>;
    edit(s);
    return JSON.stringify(s);
  };
  const notice0 = (s: Record<string, unknown>) => (s['notices'] as Array<Record<string, unknown>>)[0]!;

  it('refuses a snapshot without its findings', () => {
    const text = broken((s) => { notice0(s)['snapshot'] = { issuedAt: 1, issuedBy: 'p-inspector', dueInDays: 7 }; });
    expect(loadSaved(text)).toMatchObject({ ok: false, reason: 'broken-shape' });
  });

  it('refuses wrong types, an unknown status, and a status that disagrees with the snapshot', () => {
    expect(loadSaved(broken((s) => { notice0(s)['status'] = 'sent'; }))).toMatchObject({ ok: false });
    expect(loadSaved(broken((s) => { notice0(s)['snapshot'] = null; }))).toMatchObject({ ok: false });
    expect(loadSaved(broken((s) => { notice0(s)['findingIds'] = 'f-1'; }))).toMatchObject({ ok: false });
    expect(loadSaved(broken((s) => { s['clock'] = '3'; }))).toMatchObject({ ok: false });
    expect(loadSaved(broken((s) => { s['seq'] = -1; }))).toMatchObject({ ok: false });
    expect(loadSaved(broken((s) => { (s['people'] as Array<Record<string, unknown>>)[0]!['role'] = 'admin'; }))).toMatchObject({ ok: false });
    expect(loadSaved(broken((s) => { (s['findings'] as Array<Record<string, unknown>>)[0]!['text'] = 5; }))).toMatchObject({ ok: false });
  });

  it('refuses ids that do not line up', () => {
    expect(loadSaved(broken((s) => { notice0(s)['companyId'] = 'c-nowhere'; }))).toMatchObject({ ok: false });
    expect(loadSaved(broken((s) => { (notice0(s)['events'] as Array<Record<string, unknown>>)[0]!['by'] = 'ghost'; }))).toMatchObject({ ok: false });
    expect(loadSaved(broken((s) => { (s['notices'] as unknown[]).push(JSON.parse(JSON.stringify(notice0(s)))); }))).toMatchObject({ ok: false });
    // The copy made at issue must hold exactly the findings the notice names (found in a later review).
    const copied = (s: Record<string, unknown>) => (notice0(s)['snapshot'] as { findings: Array<Record<string, unknown>> }).findings;
    expect(loadSaved(broken((s) => { copied(s)[0]!['id'] = 'f-other'; }))).toMatchObject({ ok: false, reason: 'broken-shape' });
    expect(loadSaved(broken((s) => { copied(s).push({ ...copied(s)[0]!, id: 'f-extra' }); }))).toMatchObject({ ok: false, reason: 'broken-shape' });
  });

  it('the screen still opens, from the seed, with a broken save in storage', () => {
    const text = broken((s) => { notice0(s)['snapshot'] = { issuedAt: 1, issuedBy: 'p-inspector', dueInDays: 7 }; });
    const store = createStore({ getItem: () => text, setItem: () => undefined });
    render(<App store={store} />);
    expect(screen.getByRole('status').textContent).toContain('저장된 내용을 읽지 못해');
    expect(screen.getByTestId('counts')).toBeTruthy();
  });

  it('a valid save still loads', () => {
    const s = issuedToAlpha();
    const r = loadSaved(JSON.stringify(s));
    expect(r.ok).toBe(true);
    expect(r.state).toEqual(s);
  });
});

describe('defect 3: lifting an old save invented who saw a notice and when', () => {
  const v1 = () => {
    const s = withSecondAlpha();
    return {
      version: 1, clock: 9, seq: 5, viewerId: 'p-alpha', people: s.people, findings: s.findings,
      notices: [{ id: 'n-3', companyId: 'c-alpha', findingIds: ['f-1'], seen: true, reply: null, snapshot: { issuedAt: 4, issuedBy: 'p-inspector', dueInDays: 7, findings: [s.findings[0]] } }],
    };
  };

  it('records the old flag as seen by an unknown person at an unknown time', () => {
    const r = loadSaved(JSON.stringify(v1()));
    if (!r.ok) throw new Error(r.reason);
    const seen = r.state.notices[0]?.events.filter((e) => e.kind === 'seen');
    expect(seen).toEqual([{ at: null, by: null, kind: 'seen' }]);
  });

  it('does not pick one of two colleagues as the reader, and does not show the notice as unread again', () => {
    const r = loadSaved(JSON.stringify(v1()));
    if (!r.ok) throw new Error(r.reason);
    expect(r.state.notices[0]?.events.some((e) => e.by === 'p-alpha' || e.by === 'p-alpha-2')).toBe(false);
    expect([unreadCount(r.state, 'p-alpha'), unreadCount(r.state, 'p-alpha-2')]).toEqual([0, 0]);
  });

  it('the screen says the reader is unknown', () => {
    const store = createStore({ getItem: () => JSON.stringify(v1()), setItem: () => undefined });
    render(<App store={store} />);
    expect(screen.getByTestId('notice-n-3').textContent).toContain('열람(이전 판의 기록 · 열람자와 시각 미상)');
  });
});

describe('defect 4: storage that throws on read stopped the app from starting', () => {
  const blocked = { getItem: (): string | null => { throw new Error('SecurityError'); }, setItem: (): void => { throw new Error('SecurityError'); } };

  it('starts from the seed in memory and says so', () => {
    const store = createStore(blocked);
    expect(store.loaded).toMatchObject({ ok: false, reason: 'storage-unreadable' });
    expect(store.getState()).toEqual(seedState());
    expect(store.dispatch((s) => createDraft(s, 'p-inspector', ['f-1'])).ok).toBe(true);
  });

  it('also when merely touching window.localStorage throws (found by the browser check)', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new Error('SecurityError'); } });
    try {
      const store = createStore(browserStorage());
      expect(store.loaded).toMatchObject({ ok: false, reason: 'storage-unreadable' });
      expect(store.dispatch((s) => createDraft(s, 'p-inspector', ['f-1'])).ok).toBe(true);
    } finally {
      if (original) Object.defineProperty(window, 'localStorage', original);
    }
  });

  it('the screen opens', () => {
    render(<App store={createStore(blocked)} />);
    expect(screen.getByRole('status').textContent).toContain('저장된 내용을 읽지 못해');
  });
});

describe('rule: a reply implies the replier has seen the notice', () => {
  it('replying without pressing "seen" records seen then replied, never replied then seen', () => {
    const replied = must(replyNotice(issuedToAlpha(), 'p-alpha', 'n-3', 'ok'));
    expect(replied.notices[0]?.events.map((e) => e.kind + ':' + e.by)).toEqual(['issued:p-inspector', 'seen:p-alpha', 'replied:p-alpha']);
    expect(markSeen(replied, 'p-alpha', 'n-3')).toMatchObject({ ok: false, reason: 'wrong-status' });
  });
});

describe('rule: reading is per person, answering is per company', () => {
  it('a colleague who has not opened the notice still has it unread after someone else replied', () => {
    const issued = issuedToAlpha(withSecondAlpha());
    expect([unreadCount(issued, 'p-alpha'), unreadCount(issued, 'p-alpha-2')]).toEqual([1, 1]);
    const replied = must(replyNotice(issued, 'p-alpha', 'n-3', 'ok'));
    expect([unreadCount(replied, 'p-alpha'), unreadCount(replied, 'p-alpha-2')]).toEqual([0, 1]);
    const seenByBoth = must(markSeen(replied, 'p-alpha-2', 'n-3'));
    expect(unreadCount(seenByBoth, 'p-alpha-2')).toBe(0);
    expect(seenByBoth.notices[0]?.events.map((e) => e.kind + ':' + e.by)).toEqual(['issued:p-inspector', 'seen:p-alpha', 'replied:p-alpha', 'seen:p-alpha-2']);
  });

  it('a company answers once: the colleague cannot send a second reply', () => {
    const replied = must(replyNotice(issuedToAlpha(withSecondAlpha()), 'p-alpha', 'n-3', 'ok'));
    expect(replyNotice(replied, 'p-alpha-2', 'n-3', 'again')).toMatchObject({ ok: false, reason: 'wrong-status' });
  });
});
