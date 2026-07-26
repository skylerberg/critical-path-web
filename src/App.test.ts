import { fetchMock, jsonResponse } from './api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import App from './App.svelte';
import { board } from './lib/board.svelte';
import { projects } from './lib/projects.svelte';
import { realtime } from './lib/realtime.svelte';
import { router } from './lib/router.svelte';
import { session } from './lib/session.svelte';
import { users } from './lib/users.svelte';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  constructor(public url: string) {}
  send(): void {}
  close(): void {}
}

vi.stubGlobal('WebSocket', FakeWebSocket);

const me = { id: 'u-me', email: 'me@example.com', name: 'Me', avatar_url: null };

beforeEach(() => {
  fetchMock.mockReset();
  localStorage.clear();
  sessionStorage.clear();
  session.user = null;
  session.status = 'unknown';
  board.reset();
  projects.reset();
  users.reset();
  router.beforeNavigate = undefined;
  router.navigate('/', { replace: true });
});

afterEach(() => {
  realtime.disconnect();
});

describe('App shell', () => {
  it('wraps authed routes in a full-height shell with a scrolling content region', async () => {
    localStorage.setItem('cp.token', 't');
    fetchMock.mockImplementation(async (input) => {
      const { pathname } = new URL((input as Request).url);
      if (pathname === '/api/auth/me') {
        return jsonResponse(200, me);
      }
      if (pathname === '/api/projects') {
        return jsonResponse(200, { projects: [] });
      }
      return jsonResponse(200, { users: [] });
    });

    render(App);

    await screen.findByRole('heading', { name: 'Projects' });

    const shell = screen.getAllByRole('navigation')[0]!.parentElement!;
    expect(shell).toHaveClass('flex', 'h-full', 'flex-col', 'lg:block', 'lg:h-auto', 'lg:pl-56');
    expect(shell.className).not.toMatch(/pb-16|dvh/);

    const scroller = shell.lastElementChild!;
    expect(scroller).toHaveClass('min-h-0', 'flex-1', 'overflow-y-auto', 'lg:overflow-visible');
    // Nav must stay first in the DOM: tab order for the sidebar and the bar depends on it.
    expect(
      shell.querySelector('nav')!.compareDocumentPosition(scroller) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('gives public routes the same height chain without the shell chrome', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, { users: [] }));

    render(App);

    await screen.findByRole('button', { name: 'Log in' });

    expect(session.status).toBe('anon');
    expect(screen.queryAllByRole('navigation')).toHaveLength(0);

    const main = screen.getByRole('main');
    expect(main.parentElement!.className).toBe('h-full');
    expect(main.parentElement!.parentElement!.className).toBe('h-full');
    expect(main).toHaveClass('min-h-full');
    expect(main.className).not.toMatch(/dvh/);
  });
});
