import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { paths } from '@/shared/config/paths';
import PageHeader from './PageHeader';

function DetailPage() {
  const { pathname } = useLocation();
  return (
    <>
      <PageHeader title="动态详情" backTo={paths.world} />
      <output aria-label="当前页面地址">{pathname}</output>
    </>
  );
}

function TestApp({ initialPath }: { initialPath: string }) {
  return (
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route
          path={paths.moments}
          element={
            <>
              <h1>动态</h1>
              <Link to={paths.post(1)}>打开动态</Link>
            </>
          }
        />
        <Route path="/world/posts/:postId" element={<DetailPage />} />
        <Route path={paths.world} element={<h1>世界</h1>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('page header return navigation', () => {
  it('returns to Activity when the post detail was opened from Activity', () => {
    render(<TestApp initialPath={paths.moments} />);
    fireEvent.click(screen.getByRole('link', { name: '打开动态' }));

    expect(screen.getByLabelText('当前页面地址')).toHaveTextContent('/world/posts/1');
    fireEvent.click(screen.getByRole('button', { name: '返回' }));

    expect(screen.getByRole('heading', { name: '动态' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '世界' })).not.toBeInTheDocument();
  });

  it('uses the fallback route when the detail URL is opened directly', () => {
    render(<TestApp initialPath={paths.post(1)} />);
    fireEvent.click(screen.getByRole('button', { name: '返回' }));

    expect(screen.getByRole('heading', { name: '世界' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '动态' })).not.toBeInTheDocument();
  });

  it('uses the fallback when a replaced browser entry has no previous app page', () => {
    vi.spyOn(window.history, 'state', 'get').mockReturnValue({ idx: 0 });
    render(
      <MemoryRouter initialEntries={[{ pathname: paths.post(1), key: 'replaced-entry' }]}>
        <Routes>
          <Route path="/world/posts/:postId" element={<DetailPage />} />
          <Route path={paths.world} element={<h1>世界</h1>} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    expect(screen.getByRole('heading', { name: '世界' })).toBeInTheDocument();
  });
});
