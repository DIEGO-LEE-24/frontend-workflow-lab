import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
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
    expect(screen.getByTestId('counts').textContent).toBe('초안 0 · 발행됨 0 · 회신됨 1');
  });

  it('says why when a request is refused, instead of doing nothing', () => {
    setup();
    viewAs('알파 업체 담당');
    pick('f-1');
    click('고른 지적으로 통보 초안 만들기');
    expect(screen.getByRole('alert').textContent).toContain('이 역할로는 할 수 없는 일입니다.');
    expect(screen.getByTestId('counts').textContent).toBe('초안 0 · 발행됨 0 · 회신됨 0');
    click('닫기');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('gives a different message for a different reason', () => {
    setup();
    click('고른 지적으로 통보 초안 만들기');
    expect(screen.getByRole('alert').textContent).toContain('내용이 비어 있습니다.');
    pick('f-1');
    pick('f-3');
    click('고른 지적으로 통보 초안 만들기');
    expect(screen.getByRole('alert').textContent).toContain('서로 다른 업체의 지적은 한 통보에 묶을 수 없습니다.');
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
