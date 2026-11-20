// How many times does a component render when something it does not show changes?
//
// Two components read the same store. One takes the whole state (what a single context value
// gives every consumer). The other selects only the number it shows. The store is then changed
// ten times in a way that does not affect that number.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createDraft, switchViewer } from '../src/domain/actions';
import { createStore, useSelector, type Store } from '../src/store/store';

afterEach(cleanup);

let wholeRenders = 0;
let selectedRenders = 0;

function WholeState({ store }: { store: Store }) {
  const state = useSelector(store, (s) => s);
  wholeRenders += 1;
  return <span>{state.notices.length}</span>;
}

function SelectedValue({ store }: { store: Store }) {
  const count = useSelector(store, (s) => s.notices.length);
  selectedRenders += 1;
  return <span>{count}</span>;
}

describe('render counts', () => {
  it('a component that selects one value does not re-render for unrelated changes', () => {
    wholeRenders = 0;
    selectedRenders = 0;
    const store = createStore(null);
    render(
      <>
        <WholeState store={store} />
        <SelectedValue store={store} />
      </>,
    );
    expect([wholeRenders, selectedRenders]).toEqual([1, 1]);

    const viewers = ['p-alpha', 'p-beta'];
    for (let i = 0; i < 10; i += 1) {
      act(() => void store.dispatch((s) => switchViewer(s, viewers[i % 2]!)));
    }
    expect(wholeRenders).toBe(11);
    expect(selectedRenders).toBe(1);

    act(() => void store.dispatch((s) => switchViewer(s, 'p-inspector')));
    act(() => void store.dispatch((s) => createDraft(s, 'p-inspector', ['f-1'])));
    expect(selectedRenders).toBe(2);
  });

  it('a refused request re-renders neither, because the state object did not change', () => {
    wholeRenders = 0;
    selectedRenders = 0;
    const store = createStore(null);
    render(
      <>
        <WholeState store={store} />
        <SelectedValue store={store} />
      </>,
    );
    act(() => void store.dispatch((s) => createDraft(s, 'p-alpha', ['f-1'])));
    expect([wholeRenders, selectedRenders]).toEqual([1, 1]);
    expect(store.getFailure()?.reason).toBe('not-allowed');
  });
});
