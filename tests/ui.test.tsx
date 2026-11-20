import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createDraft } from '../src/domain/actions';
import { createStore } from '../src/store/store';
import { App } from '../src/ui/App';

afterEach(cleanup);

const setup = () => {
  const store = createStore(null);
  render(<App store={store} />);
  return store;
};
const viewAs = (name: string) => fireEvent.click(screen.getByLabelText(new RegExp('^' + name)));
const pick = (id: string) => fireEvent.click(screen.getByLabelText(id + ' 고르기'));
const click = (name: string, within_: HTMLElement = document.body) => fireEvent.click(within(within_).getByRole('button', { name }));

describe('the screen', () => {
  it('lets one person issue and another person see and answer', () => {
    setup();
    pick('f-1');
    pick('f-2');
    click('고른 지적으로 통보 초안 만들기');
    const card = () => screen.getByTestId('notice-n-3');
    expect(card().textContent).toContain('초안');
    click('발행', card());
    expect(card().textContent).toContain('발행됨');
    expect(screen.getByLabelText('읽지 않은 통보 1건')).toBeTruthy();

    viewAs('알파 업체 담당');
    click('열람 확인', card());
    expect(screen.queryByLabelText('읽지 않은 통보 1건')).toBeNull();
    fireEvent.change(screen.getByLabelText('n-3 회신 내용'), { target: { value: '치웠습니다' } });
    click('회신', card());
    expect(card().textContent).toContain('회신: 치웠습니다');
    expect(card().textContent).toContain('발행(p-inspector) → 열람(p-alpha) → 회신(p-alpha)');
    expect(screen.getByTestId('counts').textContent).toBe('발행됨 0 · 회신됨 1');
  });

  it('a request that is refused anyway (a stale screen, a direct call) says why', () => {
    const store = setup();
    act(() => void store.dispatch((s) => createDraft(s, 'p-alpha', ['f-1'])));
    expect(screen.getByRole('alert').textContent).toContain('이 역할로는 할 수 없는 일입니다.');
    expect(screen.getByTestId('counts').textContent).toBe('초안 0 · 발행됨 0 · 회신됨 0');
    click('닫기');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says beforehand why a button cannot be pressed, with a different sentence per reason', () => {
    setup();
    const create = () => screen.getByRole('button', { name: '고른 지적으로 통보 초안 만들기' }) as HTMLButtonElement;
    expect(create().disabled).toBe(true);
    expect(document.getElementById('draft-why')?.textContent).toBe('지적을 하나 이상 고르세요.');
    pick('f-1');
    expect(create().disabled).toBe(false);
    pick('f-3');
    expect(create().disabled).toBe(true);
    expect(document.getElementById('draft-why')?.textContent).toBe('서로 다른 업체의 지적은 한 통보에 묶을 수 없습니다.');
  });

  it('offers each person only the actions that person could ever take', () => {
    setup();
    pick('f-1');
    click('고른 지적으로 통보 초안 만들기');
    const card = () => screen.getByTestId('notice-n-3');
    const names = () => within(card()).queryAllByRole('button').map((b) => b.textContent + ((b as HTMLButtonElement).disabled ? '(꺼짐)' : ''));
    expect(names()).toEqual(['발행']);
    click('발행', card());
    expect(names()).toEqual(['발행(꺼짐)']);
    viewAs('알파 업체 담당');
    expect(names()).toEqual(['열람 확인', '회신(꺼짐)']);
    expect(screen.queryByLabelText('f-1 고르기')).toBeNull();
    viewAs('참관');
    expect(names()).toEqual([]);
  });

  it('hides another company\'s notice and keeps the issued text after the finding is edited', () => {
    setup();
    pick('f-1');
    click('고른 지적으로 통보 초안 만들기');
    click('발행', screen.getByTestId('notice-n-3'));
    const field = screen.getByLabelText('f-1 내용');
    fireEvent.change(field, { target: { value: '통로를 비웠음' } });
    fireEvent.blur(field);
    const card = screen.getByTestId('notice-n-3');
    expect(card.textContent).toContain('통로에 자재가 쌓여 있음');
    expect(card.textContent).toContain('발행 뒤에 지적 내용이 바뀌었습니다.');

    viewAs('베타 업체 담당');
    expect(screen.queryByTestId('notice-n-3')).toBeNull();
    expect(screen.getByText('보이는 통보가 없습니다.')).toBeTruthy();
  });
});
