import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { expect, it } from 'vitest';
import { AuthContext } from '@/features/platform/auth-context';
import { signedIn } from '@/features/platform/platform-test-fixtures';
import { SecuritySettingsPage } from './SettingsSecurityPages';

it('describes signed-in device management as the current account rather than a demo count', () => {
  render(
    <MemoryRouter>
      <AuthContext.Provider value={signedIn()}>
        <SecuritySettingsPage />
      </AuthContext.Provider>
    </MemoryRouter>,
  );
  expect(screen.getByRole('link', { name: /设备管理/ })).toHaveTextContent(
    '管理当前账号的登录设备与会话',
  );
  expect(screen.queryByText(/\d+ 个演示会话/)).not.toBeInTheDocument();
});
