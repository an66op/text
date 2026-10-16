import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { isStringArray } from '@/shared/lib/storage';
import { useLocalStorage } from './useLocalStorage';

const defaults = ['默认组织'];

function externalWrite(key: string, value: string | null) {
  const oldValue = localStorage.getItem(key);
  if (value === null) localStorage.removeItem(key);
  else localStorage.setItem(key, value);
  window.dispatchEvent(
    new StorageEvent('storage', { key, newValue: value, oldValue, storageArea: localStorage }),
  );
}

describe('shared persisted state', () => {
  beforeEach(() => localStorage.clear());

  it('persists functional updates and restores the latest value on remount', () => {
    const first = renderHook(() => useLocalStorage('joined', defaults, isStringArray));
    act(() => first.result.current[1]((previous) => [...previous, '摄影社']));

    expect(first.result.current[0]).toEqual(['默认组织', '摄影社']);
    expect(JSON.parse(localStorage.getItem('joined') ?? 'null')).toEqual(['默认组织', '摄影社']);

    first.unmount();
    const second = renderHook(() => useLocalStorage('joined', defaults, isStringArray));
    expect(second.result.current[0]).toEqual(['默认组织', '摄影社']);
  });

  it('synchronizes external tab updates while ignoring other feature keys', () => {
    const { result } = renderHook(() => useLocalStorage('joined', defaults, isStringArray));
    act(() => externalWrite('profile', JSON.stringify({ name: '其他变化' })));
    expect(result.current[0]).toEqual(defaults);

    act(() => externalWrite('joined', JSON.stringify(['旅行社', '阅读社'])));
    expect(result.current[0]).toEqual(['旅行社', '阅读社']);
  });

  it('recovers when another tab removes or corrupts this feature data', () => {
    localStorage.setItem('joined', JSON.stringify(['摄影社']));
    const { result } = renderHook(() => useLocalStorage('joined', defaults, isStringArray));

    act(() => externalWrite('joined', '["旅行社", 42]'));
    expect(result.current[0]).toEqual(defaults);

    act(() => externalWrite('joined', JSON.stringify(['阅读社'])));
    expect(result.current[0]).toEqual(['阅读社']);

    act(() => externalWrite('joined', null));
    expect(result.current[0]).toEqual(defaults);
  });

  it('resets to the fallback when another tab clears local storage', () => {
    localStorage.setItem('joined', JSON.stringify(['摄影社']));
    const { result } = renderHook(() => useLocalStorage('joined', defaults, isStringArray));

    act(() => {
      localStorage.clear();
      window.dispatchEvent(new StorageEvent('storage', { key: null, storageArea: localStorage }));
    });

    expect(result.current[0]).toEqual(defaults);
  });

  it('saves a form update even when the page unmounts in the same event', () => {
    function Form({ finish }: { finish: () => void }) {
      const [, save] = useLocalStorage('page-draft', 'draft');
      return (
        <button
          onClick={() => {
            save('');
            finish();
          }}
        >
          发布
        </button>
      );
    }
    function App() {
      const [editing, setEditing] = useState(true);
      return editing ? <Form finish={() => setEditing(false)} /> : <p>完成</p>;
    }
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '发布' }));
    expect(screen.getByText('完成')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('page-draft') ?? 'null')).toBe('');
  });

  it('applies consecutive functional updates without losing an earlier update', () => {
    const { result } = renderHook(() => useLocalStorage('joined', defaults, isStringArray));
    act(() => {
      result.current[1]((previous) => [...previous, '摄影社']);
      result.current[1]((previous) => [...previous, '阅读社']);
    });
    expect(result.current[0]).toEqual(['默认组织', '摄影社', '阅读社']);
    expect(JSON.parse(localStorage.getItem('joined') ?? 'null')).toEqual(result.current[0]);
  });
});
