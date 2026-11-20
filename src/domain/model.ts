// The whole app is one plain object. Nothing in here is derived: counts, inbox contents and
// "has the source changed since issue" are computed from it in selectors.ts.

export type Role = 'inspector' | 'partner' | 'observer';

export interface Person {
  readonly id: string;
  readonly name: string;
  readonly role: Role;
  /** Partners belong to one company and may only see and answer that company's notices. */
  readonly companyId: string | null;
}

export interface Finding {
  readonly id: string;
  readonly companyId: string;
  readonly text: string;
}

/** What the recipient was told. Copied at the moment of issue and never edited afterwards. */
export interface Snapshot {
  readonly issuedAt: number;
  readonly issuedBy: string;
  readonly dueInDays: number;
  readonly findings: readonly Finding[];
}

export type NoticeStatus = 'draft' | 'issued' | 'replied';

/** `at` and `by` are null only for a record lifted from an older save that did not keep them.
 *  Unknown stays unknown; nothing is filled in. */
export interface NoticeEvent {
  readonly at: number | null;
  readonly by: string | null;
  readonly kind: 'issued' | 'seen' | 'replied';
}

export interface Notice {
  readonly id: string;
  readonly companyId: string;
  readonly findingIds: readonly string[];
  readonly status: NoticeStatus;
  readonly snapshot: Snapshot | null;
  readonly reply: string | null;
  readonly events: readonly NoticeEvent[];
}

export const STATE_VERSION = 2;

export interface AppState {
  readonly version: typeof STATE_VERSION;
  /** A logical clock. It moves by one on every accepted action, so tests need no real time. */
  readonly clock: number;
  readonly seq: number;
  readonly viewerId: string;
  readonly dueInDays: number;
  readonly people: readonly Person[];
  readonly findings: readonly Finding[];
  readonly notices: readonly Notice[];
}

export function seedState(): AppState {
  return {
    version: STATE_VERSION,
    clock: 1,
    seq: 3,
    viewerId: 'p-inspector',
    dueInDays: 7,
    people: [
      { id: 'p-inspector', name: '점검 담당', role: 'inspector', companyId: null },
      { id: 'p-alpha', name: '알파 업체 담당', role: 'partner', companyId: 'c-alpha' },
      { id: 'p-beta', name: '베타 업체 담당', role: 'partner', companyId: 'c-beta' },
      { id: 'p-observer', name: '참관', role: 'observer', companyId: null },
    ],
    findings: [
      { id: 'f-1', companyId: 'c-alpha', text: '통로에 자재가 쌓여 있음' },
      { id: 'f-2', companyId: 'c-alpha', text: '소화기 앞이 막혀 있음' },
      { id: 'f-3', companyId: 'c-beta', text: '안전 표지가 떨어져 있음' },
    ],
    notices: [],
  };
}
