import { describe, expect, it } from 'vitest';
import { createDraft, issueNotice, markSeen } from '../src/domain/actions';
import { loadSaved } from '../src/domain/migrate';
import { seedState } from '../src/domain/model';
import { unreadCount } from '../src/domain/selectors';
import { STORAGE_KEY, createStore, type StorageLike } from '../src/store/store';

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
}

const v1Save = () => {
  const seed = seedState();
  return {
    version: 1,
    clock: 9,
    seq: 5,
    viewerId: 'p-alpha',
    people: seed.people,
    findings: seed.findings,
    notices: [
      { id: 'n-3', companyId: 'c-alpha', findingIds: ['f-1'], seen: true, reply: null, snapshot: { issuedAt: 4, issuedBy: 'p-inspector', dueInDays: 7, findings: [seed.findings[0]] } },
      { id: 'n-4', companyId: 'c-beta', findingIds: ['f-3'], seen: false, reply: null, snapshot: null },
    ],
  };
};

describe('loading a save', () => {
  it('starts from the seed when nothing is saved', () => {
    const r = loadSaved(null);
    expect(r.ok).toBe(true);
    expect(r.state).toEqual(seedState());
  });

  it('lifts a version 1 save without dropping notices', () => {
    const r = loadSaved(JSON.stringify(v1Save()));
    if (!r.ok) throw new Error(r.reason);
    expect(r.migratedFrom).toBe(1);
    expect(r.state.version).toBe(2);
    expect(r.state.notices.map((n) => n.id + ':' + n.status)).toEqual(['n-3:issued', 'n-4:draft']);
    expect(r.state.viewerId).toBe('p-alpha');
    expect(r.state.clock).toBe(9);
  });

  it('turns the old "seen" flag into an event, so the lifted notice is not unread again', () => {
    const r = loadSaved(JSON.stringify(v1Save()));
    if (!r.ok) throw new Error(r.reason);
    expect(r.state.notices[0]?.events.map((e) => e.kind + ':' + e.by)).toEqual(['issued:p-inspector', 'seen:p-alpha']);
    expect(unreadCount(r.state, 'p-alpha')).toBe(0);
  });

  it('keeps the copy made at issue exactly as it was saved', () => {
    const saved = v1Save();
    const r = loadSaved(JSON.stringify(saved));
    if (!r.ok) throw new Error(r.reason);
    expect(r.state.notices[0]?.snapshot).toEqual(saved.notices[0]?.snapshot);
  });

  it('refuses what it cannot understand, with a reason, and falls back to the seed', () => {
    expect(loadSaved('{not json')).toMatchObject({ ok: false, reason: 'not-json' });
    expect(loadSaved('[1,2]')).toMatchObject({ ok: false, reason: 'not-an-object' });
    expect(loadSaved(JSON.stringify({ version: 99 }))).toMatchObject({ ok: false, reason: 'unknown-version' });
    expect(loadSaved(JSON.stringify({ version: 2, notices: 'x' }))).toMatchObject({ ok: false, reason: 'broken-shape' });
    expect(loadSaved(JSON.stringify({ version: 1, notices: [{ id: 3 }], people: [], findings: [] }))).toMatchObject({ ok: false, reason: 'broken-shape' });
    expect(loadSaved('{not json').state).toEqual(seedState());
  });

  it('refuses a version 2 save whose viewer is not one of its people', () => {
    const broken = { ...seedState(), viewerId: 'ghost' };
    expect(loadSaved(JSON.stringify(broken))).toMatchObject({ ok: false, reason: 'broken-shape' });
  });
});

describe('reloading the page', () => {
  it('a second store reading the same storage sees what the first one did', () => {
    const storage = memoryStorage();
    const first = createStore(storage);
    first.dispatch((s) => createDraft(s, 'p-inspector', ['f-1']));
    first.dispatch((s) => issueNotice(s, 'p-inspector', 'n-3'));
    first.dispatch((s) => markSeen(s, 'p-alpha', 'n-3'));
    const second = createStore(storage);
    expect(second.getState()).toEqual(first.getState());
    expect(second.getState().notices[0]?.events).toHaveLength(2);
  });

  it('a refused request is not written to storage', () => {
    const storage = memoryStorage();
    const store = createStore(storage);
    store.dispatch((s) => createDraft(s, 'p-alpha', ['f-1']));
    expect(storage.data[STORAGE_KEY]).toBeUndefined();
    expect(store.getFailure()?.reason).toBe('not-allowed');
  });

  it('keeps working from memory when storage throws', () => {
    const store = createStore({ getItem: () => null, setItem: () => { throw new Error('quota'); } });
    const r = store.dispatch((s) => createDraft(s, 'p-inspector', ['f-1']));
    expect(r.ok).toBe(true);
    expect(store.getState().notices).toHaveLength(1);
  });
});
