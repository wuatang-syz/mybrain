import {afterEach, expect, it, vi} from 'vitest';
import {WorldSelection} from '../src/world/selection';

afterEach(() => vi.useRealTimers());

it('runs focus and note opening once after a single click', () => {
  vi.useFakeTimers();
  const actions = {select: vi.fn(), locate: vi.fn(), activate: vi.fn()};
  const selection = new WorldSelection(actions);
  selection.click('note');
  expect(actions.select).toHaveBeenCalledExactlyOnceWith('note');
  expect(actions.locate).not.toHaveBeenCalled();
  vi.advanceTimersByTime(350);
  expect(actions.locate).toHaveBeenCalledExactlyOnceWith('note');
  expect(actions.activate).not.toHaveBeenCalled();
});

it('enters on a double click without running the pending single-click action', () => {
  vi.useFakeTimers();
  const actions = {select: vi.fn(), locate: vi.fn(), activate: vi.fn()};
  const selection = new WorldSelection(actions);
  selection.click('note');
  vi.advanceTimersByTime(150);
  selection.click('note');
  vi.advanceTimersByTime(350);
  expect(actions.activate).toHaveBeenCalledExactlyOnceWith('note');
  expect(actions.locate).not.toHaveBeenCalled();
});
