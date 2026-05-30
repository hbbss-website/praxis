// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { StoredUser } from './types';

afterEach(cleanup);

const mockUser: StoredUser = {
  id: 1,
  uid: 'A00001',
  role: 'admin',
  name: '管理员',
  password_setup_required: false
};

function createMockApi(overrides?: { meStatus?: number; meData?: unknown }) {
  const { meStatus = 200, meData = { user: mockUser } } = overrides ?? {};
  return {
    auth: {
      me: {
        get: vi.fn().mockResolvedValue({ status: meStatus, data: meData })
      },
      logout: {
        post: vi.fn().mockResolvedValue({ status: 200, data: {} })
      }
    }
  };
}

let currentMockApi = createMockApi();

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>();
  return {
    ...actual,
    createApiClient: vi.fn(() => currentMockApi)
  };
});

import { SessionProvider, useSession } from './auth';

function TestConsumer() {
  const session = useSession();
  return (
    <div>
      <div data-testid="loading">{String(session.loading)}</div>
      <div data-testid="user-name">{session.user?.name ?? 'null'}</div>
      <div data-testid="user-role">{session.user?.role ?? 'null'}</div>
      <button data-testid="sign-out" onClick={() => session.signOut()}>退出</button>
    </div>
  );
}

describe('SessionProvider', () => {
  test('shows loading then resolves user on mount', async () => {
    currentMockApi = createMockApi();
    render(
      <SessionProvider>
        <TestConsumer />
      </SessionProvider>
    );
    expect(screen.getByTestId('loading').textContent).toBe('true');
    expect(screen.getByTestId('user-name').textContent).toBe('null');

    await waitFor(() => {
      expect(screen.getByTestId('user-name').textContent).toBe('管理员');
    });
    expect(screen.getByTestId('user-role').textContent).toBe('admin');
    expect(screen.getByTestId('loading').textContent).toBe('false');
  });

  test('handles failed auth /me gracefully', async () => {
    currentMockApi = createMockApi({ meStatus: 401, meData: null });
    render(
      <SessionProvider>
        <TestConsumer />
      </SessionProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });
    expect(screen.getByTestId('user-name').textContent).toBe('null');
  });

  test('signOut clears user', async () => {
    currentMockApi = createMockApi();
    render(
      <SessionProvider>
        <TestConsumer />
      </SessionProvider>
    );
    await waitFor(() => {
      expect(screen.getByTestId('user-name').textContent).toBe('管理员');
    });

    await userEvent.click(screen.getByTestId('sign-out'));

    await waitFor(() => {
      expect(screen.getByTestId('user-name').textContent).toBe('null');
    });
  });

  test('throws error when useSession is used outside provider', () => {
    expect(() => render(<TestConsumer />)).toThrow('Missing session context');
  });
});
