// Reading what an older build left in the browser.
//
// Version 1 kept no `events` list and marked "seen" with a boolean on the notice. Version 2 records
// who saw it and when. An old save is lifted to the new shape instead of being thrown away, and a
// save that cannot be understood is refused with a reason rather than half-loaded.

import { STATE_VERSION, seedState, type AppState, type Notice, type NoticeEvent } from './model';

export type LoadResult =
  | { readonly ok: true; readonly state: AppState; readonly migratedFrom: number | null }
  | { readonly ok: false; readonly state: AppState; readonly reason: 'not-json' | 'not-an-object' | 'unknown-version' | 'broken-shape' };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function liftV1(raw: Record<string, unknown>): AppState | null {
  const notices = raw['notices'];
  const people = raw['people'];
  const findings = raw['findings'];
  if (!Array.isArray(notices) || !Array.isArray(people) || !Array.isArray(findings)) return null;
  const lifted: Notice[] = [];
  for (const n of notices) {
    if (!isObject(n) || typeof n['id'] !== 'string' || typeof n['companyId'] !== 'string') return null;
    const snapshot = isObject(n['snapshot']) ? (n['snapshot'] as unknown as Notice['snapshot']) : null;
    const events: NoticeEvent[] = [];
    if (snapshot) events.push({ at: snapshot.issuedAt, by: snapshot.issuedBy, kind: 'issued' });
    // v1 only knew that somebody at the company had seen it. The first partner of that company is
    // recorded as the reader; the time is unknown, so the issue time is used and nothing is invented.
    if (n['seen'] === true && snapshot) {
      const reader = people.find((p) => isObject(p) && p['role'] === 'partner' && p['companyId'] === n['companyId']);
      if (isObject(reader) && typeof reader['id'] === 'string') events.push({ at: snapshot.issuedAt, by: reader['id'], kind: 'seen' });
    }
    const reply = typeof n['reply'] === 'string' ? n['reply'] : null;
    const status: Notice['status'] = reply !== null ? 'replied' : snapshot ? 'issued' : 'draft';
    lifted.push({
      id: n['id'],
      companyId: n['companyId'],
      findingIds: Array.isArray(n['findingIds']) ? (n['findingIds'] as string[]) : [],
      status,
      snapshot,
      reply,
      events,
    });
  }
  const seed = seedState();
  return {
    version: STATE_VERSION,
    clock: typeof raw['clock'] === 'number' ? raw['clock'] : seed.clock,
    seq: typeof raw['seq'] === 'number' ? raw['seq'] : seed.seq + lifted.length,
    viewerId: typeof raw['viewerId'] === 'string' ? raw['viewerId'] : seed.viewerId,
    dueInDays: typeof raw['dueInDays'] === 'number' ? raw['dueInDays'] : seed.dueInDays,
    people: people as AppState['people'],
    findings: findings as AppState['findings'],
    notices: lifted,
  };
}

function looksLikeV2(raw: Record<string, unknown>): raw is Record<string, unknown> & AppState {
  return (
    typeof raw['clock'] === 'number' &&
    typeof raw['seq'] === 'number' &&
    typeof raw['viewerId'] === 'string' &&
    Array.isArray(raw['people']) &&
    Array.isArray(raw['findings']) &&
    Array.isArray(raw['notices']) &&
    (raw['notices'] as unknown[]).every((n) => isObject(n) && Array.isArray(n['events']))
  );
}

export function loadSaved(text: string | null): LoadResult {
  const fallback = seedState();
  if (text === null) return { ok: true, state: fallback, migratedFrom: null };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, state: fallback, reason: 'not-json' };
  }
  if (!isObject(raw)) return { ok: false, state: fallback, reason: 'not-an-object' };
  if (raw['version'] === STATE_VERSION) {
    if (!looksLikeV2(raw)) return { ok: false, state: fallback, reason: 'broken-shape' };
    if (!(raw.people as AppState['people']).some((p) => p.id === raw.viewerId)) return { ok: false, state: fallback, reason: 'broken-shape' };
    return { ok: true, state: raw, migratedFrom: null };
  }
  if (raw['version'] === 1) {
    const lifted = liftV1(raw);
    if (!lifted) return { ok: false, state: fallback, reason: 'broken-shape' };
    return { ok: true, state: lifted, migratedFrom: 1 };
  }
  return { ok: false, state: fallback, reason: 'unknown-version' };
}
