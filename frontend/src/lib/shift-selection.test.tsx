// @vitest-environment happy-dom
import type { PointerEvent } from 'react';
import { describe, expect, test } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useShiftMultiSelect } from './shift-selection';

function shiftEvent() {
  return { shiftKey: true } as PointerEvent<Element>;
}

describe('useShiftMultiSelect', () => {
  const ids = [1, 2, 3, 4, 5];

  test('selects a single item without shift', () => {
    const { result } = renderHook(() => useShiftMultiSelect());
    const next = result.current.updateSelection(ids, [], 1, true);
    expect(next).toEqual([1]);
  });

  test('deselects a single item without shift', () => {
    const { result } = renderHook(() => useShiftMultiSelect());
    const next = result.current.updateSelection(ids, [1, 2, 3], 2, false);
    expect(next).toEqual([1, 3]);
  });

  test('selects a range with shift key', () => {
    const { result } = renderHook(() => useShiftMultiSelect());
    result.current.updateSelection(ids, [], 1, true);
    result.current.captureShiftKey(shiftEvent());
    const next = result.current.updateSelection(ids, [1], 4, true);
    expect(next).toEqual([1, 2, 3, 4]);
  });

  test('selects range in reverse order', () => {
    const { result } = renderHook(() => useShiftMultiSelect());
    result.current.updateSelection(ids, [], 4, true);
    result.current.captureShiftKey(shiftEvent());
    const next = result.current.updateSelection(ids, [4], 1, true);
    expect(next).toEqual([1, 2, 3, 4]);
  });

  test('deselects a range with shift key', () => {
    const { result } = renderHook(() => useShiftMultiSelect());
    result.current.updateSelection(ids, [1, 2, 3, 4, 5], 1, true);
    result.current.captureShiftKey(shiftEvent());
    const next = result.current.updateSelection(ids, [1, 2, 3, 4, 5], 4, false);
    expect(next).toEqual([5]);
  });

  test('resetSelectionAnchor clears anchor', () => {
    const { result } = renderHook(() => useShiftMultiSelect());
    result.current.updateSelection(ids, [], 1, true);
    result.current.resetSelectionAnchor();
    result.current.captureShiftKey(shiftEvent());
    const next = result.current.updateSelection(ids, [1], 4, true);
    expect(next).toEqual([1, 4]);
  });
});
