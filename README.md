# frontend-workflow-lab

> **English summary.** A small React + TypeScript app for one question: how do you keep a multi-step
> workflow (draft → issue → seen → reply) correct on the client? State is one plain object changed only by
> pure transitions that return `{ ok, state }` or `{ ok: false, state, reason }`, so a refused click can say
> why. Permissions are checked inside the transitions, not only by hiding buttons. A notice keeps a copy of
> what was issued, so later edits do not rewrite what the recipient was told. Screens subscribe with
> selectors and do not re-render for unrelated changes. An older saved shape is lifted, not discarded.
> It runs in one browser with a role switcher; there is no server and no real delivery between people.

한 사람이 통보를 발행하고 다른 사람이 열람하고 회신하는 흐름을, 화면 쪽에서 어떻게 틀리지 않게 만들 것인가를 다룬 작은 예제입니다.

팀 프로젝트의 화면 시안에서 쓴 설계 원칙을 그 프로젝트의 코드 없이 혼자 볼 수 있는 크기로 다시 만든 것입니다. 제품의 소스가 아니며 코드를 공유하지 않습니다.

**범위.** 서버가 없습니다. 한 브라우저에서 "보는 사람"을 바꿔 가며 확인하는 예제이고, 사람 사이의 실제 전송과 동기화는 다루지 않습니다.

## 실행

```
npm install
npm run dev      # 화면
npm test         # 시험 46개
npm run build    # 형 검사 + 빌드
```

화면에서 해 볼 것: 지적 두 개를 고르고 초안을 만든 뒤 발행 → "알파 업체 담당"으로 바꿔 열람 확인과 회신 → "베타 업체 담당"으로 바꾸면 그 통보가 보이지 않음. 업체 담당인 채로 초안을 만들려고 하면 왜 안 되는지가 화면에 나옵니다.

## 설계

### 1. 상태는 객체 하나, 바꾸는 것은 순수 함수뿐 (`src/domain/actions.ts`)

상태를 바꾸는 함수는 `(상태, 인자) → 결과`이고 받은 상태를 고치지 않습니다. 시험은 모든 상태를 깊게 얼린 채 돌리므로, 제자리에서 고치는 코드가 있으면 통과하지 못합니다.

### 2. 거절은 "같은 상태"가 아니라 까닭과 함께 돌려준다

처음에는 거절할 때 받은 상태를 그대로 돌려주는 방식을 생각했습니다. 그러면 화면은 "아무 일도 일어나지 않았다"만 알 수 있고, 권한이 없어서인지 내용이 비어서인지 이미 발행돼서인지 구분하지 못합니다.

```ts
type Result =
  | { ok: true; state: AppState }
  | { ok: false; state: AppState; reason: Refusal };
```

거절 까닭은 일곱 가지이고(`not-allowed` · `wrong-status` · `empty-input` · `mixed-companies` · `other-company` · `not-found` · `unknown-actor`), 화면은 그 까닭을 문장으로 보여 줍니다. 그래서 이 예제는 권한이 없는 사람에게도 단추를 숨기지 않습니다.

### 3. 권한은 상태 함수가 검사한다

단추를 숨기는 것은 권한 검사가 아닙니다. 다섯 개 함수를 네 역할로 부른 20가지 경우를 모두 시험합니다. 다른 업체의 통보를 열람하거나 회신하려는 경우는 `other-company`로 따로 거절합니다.

이것은 화면 쪽의 한 겹입니다. 서버가 있는 제품에서는 서버가 권한을 검사해야 하고, 이 검사가 그것을 대신하지 않습니다.

### 4. 발행한 순간의 내용을 따로 얼려 둔다

발행할 때 지적 내용을 복사해 통보에 붙입니다. 그 뒤에 지적을 고쳐도 받은 사람에게 보이는 통보는 발행 당시 그대로이고, 원본이 바뀌었다는 사실만 표시합니다.

### 5. 계산할 수 있는 값은 저장하지 않는다 (`src/domain/selectors.ts`)

상태별 건수, 읽지 않은 통보 수, 누구에게 무엇이 보이는지는 저장하지 않고 상태에서 계산합니다. 두 화면이 서로 다른 숫자를 보일 수 없습니다.

### 6. 화면은 필요한 값만 구독한다 (`src/store/store.ts`)

컨텍스트 하나에 상태 전체를 넣으면 값 하나가 바뀔 때 그것을 읽는 화면이 모두 다시 그려집니다. 여기서는 `useSyncExternalStore`와 선택 함수로 구독합니다. `tests/render.test.tsx`가 횟수를 셉니다.

| 상태를 10번 바꿈 (보여 주는 값과 무관한 변경) | 다시 그린 횟수 |
|---|---|
| 상태 전체를 읽는 컴포넌트 | 10 |
| 값 하나를 고른 컴포넌트 | 0 |

거절된 요청은 상태 객체가 그대로라 둘 다 다시 그리지 않습니다.

### 7. 옛 저장본은 버리지 않고 올린다 (`src/domain/migrate.ts`)

1판은 "열람했는가"를 참·거짓 하나로 저장했고 2판은 누가 언제 봤는지를 이력으로 남깁니다. 1판 저장본을 읽으면 이력으로 바꿔 올리며, 알 수 없는 시각은 지어내지 않고 발행 시각을 씁니다. 이해할 수 없는 저장본은 반쯤 읽지 않고 까닭과 함께 거절한 뒤 처음 상태로 엽니다.

## 시험

| 파일 | 수 | 확인하는 것 |
|---|---|---|
| `tests/actions.test.ts` | 31 | 흐름 · 거절 까닭 · 잘못된 입력 · 역할별 권한 20가지 · 발행본 보존 · 파생 값 |
| `tests/migrate.test.ts` | 9 | 1판 저장본 올리기 · 깨진 저장본 거절 · 새로고침 뒤 상태 유지 · 저장소가 막혔을 때 |
| `tests/ui.test.tsx` | 4 | 화면을 눌러 끝까지 가는 흐름 · 거절 까닭 표시 · 다른 업체에 안 보임 |
| `tests/render.test.tsx` | 2 | 다시 그리는 횟수 |

시험이 실제로 잡아내는지는 코드를 일부러 망가뜨려 확인했습니다.

- 발행 함수에서 역할 검사를 빼면 46개 중 4개가 실패합니다.
- 통보가 발행본 대신 지금 원본을 보이게 바꾸면 2개가 실패합니다.

시험을 쓰다가 결함 하나를 찾았습니다. 읽지 않은 통보 수를 "보이는 통보 가운데 내가 열람하지 않은 것"으로 계산했더니, 통보를 발행한 사람과 참관하는 사람에게도 읽지 않은 통보가 1건으로 나왔습니다. 받는 사람만 세도록 고치고 그 경우를 시험에 넣었습니다.

## 한계

- 서버가 없어 여러 사람이 동시에 고치는 경우, 전송 실패, 순서 뒤바뀜을 다루지 않습니다.
- 화면 시험은 jsdom에서 돕니다. 실제 브라우저의 배치와 접근성은 확인하지 않습니다.
- 선택 함수가 매번 새 배열을 만들면 구독의 이점이 사라집니다. 여기서는 문자열이나 원시 값으로 골라 피했고, 규모가 커지면 기억해 두는 선택 함수가 필요합니다.
- 저장본을 올리는 코드는 1판 → 2판 한 단계뿐입니다.
