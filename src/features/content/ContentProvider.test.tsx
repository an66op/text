import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ContentProvider } from './ContentProvider';
import { useContent } from './useContent';

afterEach(() => {
  cleanup();
  localStorage.clear();
});
function StateProbe() {
  const { likes, toggleLike, comments, addComment } = useContent();
  return (
    <>
      <span data-testid="likes">{JSON.stringify(likes)}</span>
      <span data-testid="comments">{JSON.stringify(comments)}</span>
      <button
        onClick={() => {
          toggleLike(1);
          toggleLike(1);
          addComment(1, ' 第一条 ');
          addComment(1, '第二条');
        }}
      >
        修改
      </button>
    </>
  );
}

describe('ContentProvider persistence', () => {
  it('keeps consecutive updates and restores legacy storage after remount', () => {
    const mounted = render(
      <ContentProvider>
        <StateProbe />
      </ContentProvider>,
    );
    act(() => screen.getByRole('button', { name: '修改' }).click());
    expect(screen.getByTestId('likes').textContent).toBe('[]');
    expect(screen.getByTestId('comments').textContent).toBe('{"1":["第一条","第二条"]}');
    expect(JSON.parse(localStorage.getItem('comments') ?? '{}')).toEqual({
      '1': ['第一条', '第二条'],
    });
    mounted.unmount();
    render(
      <ContentProvider>
        <StateProbe />
      </ContentProvider>,
    );
    expect(screen.getByTestId('comments').textContent).toBe('{"1":["第一条","第二条"]}');
  });

  it('recovers invalid persisted collections without crashing consumers', () => {
    localStorage.setItem('likes', JSON.stringify('corrupt'));
    localStorage.setItem('comments', JSON.stringify({ '1': 'corrupt' }));
    render(
      <ContentProvider>
        <StateProbe />
      </ContentProvider>,
    );
    expect(screen.getByTestId('likes').textContent).toBe('[]');
    expect(screen.getByTestId('comments').textContent).toBe('{}');
  });
});
