// Reading what an older build left in the browser.
//
// Version 1 kept no `events` list and marked "seen" with a boolean on the notice. Version 2 records
// who saw it and when. An old save is lifted to the new shape instead of being thrown away.
//
// Two rules:
//   1. Nothing is invented. Version 1 did not keep who saw a notice or when, so the lifted record
//      says "seen, by an unknown person, at an unknown time".
//   2. Nothing half-understood is loaded. Whatever comes out of storage, lifted or not, must pass
//      the same full check before a screen is allowed to read it.

import { STATE_VERSION, seedState, type AppState, type Finding, type Notice, type NoticeEvent, type Person, type Snapshot } from './model';

export type LoadFailure = 'storage-unreadable' | 'not-json' | 'not-an-object' | 'unknown-version' | 'broken-shape';

export type LoadResult =
  | { readonly ok: true; readonly state: AppState; readonly migratedFrom: number | null }
  | { readonly ok: false; readonly state: AppState; readonly reason: LoadFailure };

type Raw = Record<string, unknown>;
const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === 'string' && v !== '';
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const unique = (ids: readonly string[]): boolean => new Set(ids).size === ids.length;

const ROLES: readonly string[] = ['inspector', 'partner', 'observer'];
const STATUSES: readonly string[] = ['draft', 'issued', 'replied'];
const KINDS: readonly string[] = ['issued', 'seen', 'replied'];

function asPerson(v: unknown): Person | null {
  if (!isObject(v) || !isText(v['id']) || !isText(v['name']) || !ROLES.includes(v['role'] as string)) return null;
  const companyId = v['companyId'];
  if (companyId !== null && !isText(companyId)) return null;
  if ((v['role'] === 'partner') !== (companyId !== null)) return null;
  return { id: v['id'], name: v['name'], role: v['role'] as Person['role'], companyId };
}

function asFinding(v: unknown): Finding | null {
  if (!isObject(v) || !isText(v['id']) || !isText(v['companyId']) || typeof v['text'] !== 'string') return null;
  return { id: v['id'], companyId: v['companyId'], text: v['text'] };
}

function asSnapshot(v: unknown, personIds: ReadonlySet<string>): Snapshot | null {
  if (!isObject(v) || !isCount(v['issuedAt']) || !isText(v['issuedBy']) || !isCount(v['dueInDays']) || !Array.isArray(v['findings'])) return null;
  if (!personIds.has(v['issuedBy'])) return null;
  const findings: Finding[] = [];
  for (const f of v['findings']) {
    const finding = asFinding(f);
    if (!finding) return null;
    findings.push(finding);
  }
  if (findings.length === 0) return null;
  return { issuedAt: v['issuedAt'], issuedBy: v['issuedBy'], dueInDays: v['dueInDays'], findings };
}

function asEvent(v: unknown, personIds: ReadonlySet<string>): NoticeEvent | null {
  if (!isObject(v) || !KINDS.includes(v['kind'] as string)) return null;
  const at = v['at'];
  const by = v['by'];
  if (at !== null && !isCount(at)) return null;
  if (by !== null && (!isText(by) || !personIds.has(by))) return null;
  // Only a lifted "seen" may be unknown. An issue or a reply always has an author.
  if ((at === null || by === null) && v['kind'] !== 'seen') return null;
  return { at, by, kind: v['kind'] as NoticeEvent['kind'] };
}

function asNotice(v: unknown, personIds: ReadonlySet<string>, companyIds: ReadonlySet<string>): Notice | null {
  if (!isObject(v) || !isText(v['id']) || !isText(v['companyId']) || !STATUSES.includes(v['status'] as string)) return null;
  if (!companyIds.has(v['companyId'])) return null;
  const findingIds = v['findingIds'];
  if (!Array.isArray(findingIds) || findingIds.length === 0 || !findingIds.every(isText) || !unique(findingIds)) return null;
  if (!Array.isArray(v['events'])) return null;
  const events: NoticeEvent[] = [];
  for (const e of v['events']) {
    const event = asEvent(e, personIds);
    if (!event) return null;
    events.push(event);
  }
  const status = v['status'] as Notice['status'];
  const reply = v['reply'];
  if (reply !== null && typeof reply !== 'string') return null;
  const snapshot = v['snapshot'] === null ? null : asSnapshot(v['snapshot'], personIds);
  if (v['snapshot'] !== null && snapshot === null) return null;
  // The status, the copy made at issue and the reply have to tell the same story.
  if ((status === 'draft') !== (snapshot === null)) return null;
  if ((status === 'replied') !== (reply !== null)) return null;
  if (status === 'draft' && events.length > 0) return null;
  if (snapshot && snapshot.findings.some((f) => f.companyId !== v['companyId'])) return null;
  return { id: v['id'], companyId: v['companyId'], findingIds, status, snapshot, reply, events };
}

/** The one gate every saved state goes through. Returns a rebuilt, fully typed state or null. */
export function validate(raw: unknown): AppState | null {
  if (!isObject(raw) || raw['version'] !== STATE_VERSION) return null;
  if (!isCount(raw['clock']) || !isCount(raw['seq']) || !isCount(raw['dueInDays']) || !isText(raw['viewerId'])) return null;
  if (!Array.isArray(raw['people']) || !Array.isArray(raw['findings']) || !Array.isArray(raw['notices'])) return null;

  const people: Person[] = [];
  for (const p of raw['people']) {
    const person = asPerson(p);
    if (!person) return null;
    people.push(person);
  }
  const personIds = new Set(people.map((p) => p.id));
  if (personIds.size !== people.length || !personIds.has(raw['viewerId'])) return null;

  const findings: Finding[] = [];
  for (const f of raw['findings']) {
    const finding = asFinding(f);
    if (!finding) return null;
    findings.push(finding);
  }
  if (!unique(findings.map((f) => f.id))) return null;
  const companyIds = new Set([...findings.map((f) => f.companyId), ...people.flatMap((p) => (p.companyId ? [p.companyId] : []))]);

  const notices: Notice[] = [];
  for (const n of raw['notices']) {
    const notice = asNotice(n, personIds, companyIds);
    if (!notice) return null;
    // A draft is drawn from the live findings, so every id it names must still exist.
    if (notice.status === 'draft' && !notice.findingIds.every((id) => findings.some((f) => f.id === id && f.companyId === notice.companyId))) return null;
    notices.push(notice);
  }
  if (!unique(notices.map((n) => n.id))) return null;

  return { version: STATE_VERSION, clock: raw['clock'], seq: raw['seq'], viewerId: raw['viewerId'], dueInDays: raw['dueInDays'], people, findings, notices };
}

/** Rewrites a version 1 save into the version 2 shape. It only reshapes; `validate` judges the result. */
function liftV1(raw: Raw): unknown {
  const seed = seedState();
  const notices = Array.isArray(raw['notices']) ? raw['notices'] : null;
  if (!notices) return null;
  const lifted = notices.map((n: unknown) => {
    if (!isObject(n)) return n;
    const snapshot = isObject(n['snapshot']) ? n['snapshot'] : null;
    const reply = typeof n['reply'] === 'string' ? n['reply'] : null;
    const events: unknown[] = [];
    if (snapshot) events.push({ at: snapshot['issuedAt'], by: snapshot['issuedBy'], kind: 'issued' });
    // Version 1 kept only a flag. Who saw it and when is not known, and is recorded as not known.
    if (n['seen'] === true && snapshot) events.push({ at: null, by: null, kind: 'seen' });
    // Version 1 kept the reply text but not its author. The text is carried over as it is, and no
    // "replied" event is made up for it.
    return { id: n['id'], companyId: n['companyId'], findingIds: n['findingIds'], status: reply !== null ? 'replied' : snapshot ? 'issued' : 'draft', snapshot, reply, events };
  });
  return {
    version: STATE_VERSION,
    clock: raw['clock'] ?? seed.clock,
    seq: raw['seq'] ?? seed.seq + lifted.length,
    viewerId: raw['viewerId'] ?? seed.viewerId,
    dueInDays: raw['dueInDays'] ?? seed.dueInDays,
    people: raw['people'],
    findings: raw['findings'],
    notices: lifted,
  };
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
    const state = validate(raw);
    return state ? { ok: true, state, migratedFrom: null } : { ok: false, state: fallback, reason: 'broken-shape' };
  }
  if (raw['version'] === 1) {
    const state = validate(liftV1(raw));
    return state ? { ok: true, state, migratedFrom: 1 } : { ok: false, state: fallback, reason: 'broken-shape' };
  }
  return { ok: false, state: fallback, reason: 'unknown-version' };
}

export const LOAD_FAILURE_TEXT: Record<LoadFailure, string> = {
  'storage-unreadable': '브라우저 저장소를 읽을 수 없습니다',
  'not-json': '저장된 글이 깨져 있습니다',
  'not-an-object': '저장된 내용의 모양이 다릅니다',
  'unknown-version': '알 수 없는 판의 저장본입니다',
  'broken-shape': '저장된 내용 일부가 빠졌거나 서로 맞지 않습니다',
};
