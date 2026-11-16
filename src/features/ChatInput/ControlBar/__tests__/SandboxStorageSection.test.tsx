import { act, fireEvent, render, screen } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  consumePendingSandboxSelection,
  toSandboxTopicMetadata,
} from '@/store/chat/pendingSandboxSelection';

import { getRememberedSandboxDirectory } from '../rememberedSandboxDirectory';
import SandboxStorageSection from '../SandboxStorageSection';
import type { SandboxSelection } from '../useSandboxPlacement';

const AGENT = 'agent-remember';
const OTHER_AGENT = 'agent-other';

const state = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    listeners,
    // Bumped on every change so subscribed components re-render, as the real
    // store would make them.
    notify: () => {
      for (const listener of listeners) listener();
    },
    topicId: null as string | null,
    userId: 'user-a' as string | undefined,
    topics: {} as Record<string, Record<string, unknown>>,
    updateTopicMetadata: vi.fn(),
    version: 0,
  };
});

const useVersion = () =>
  useSyncExternalStore(
    (listener) => {
      state.listeners.add(listener);
      return () => state.listeners.delete(listener);
    },
    () => state.version,
  );

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (s: object) => unknown) => {
    useVersion();
    return selector({
      activeTopicId: state.topicId ?? undefined,
      refreshTopicDetail: vi.fn(),
      topicDataMap: {},
      topicDetailMap: Object.fromEntries(
        Object.entries(state.topics).map(([id, metadata]) => [id, { id, metadata }]),
      ),
      updateTopicMetadata: state.updateTopicMetadata,
      useFetchTopicDetail: vi.fn(),
    });
  },
}));

vi.mock('../../hooks/useTopicId', () => ({
  useTopicId: () => {
    useVersion();
    return state.topicId;
  },
}));
vi.mock('../useSandboxStorageAccess', () => ({
  useSandboxStorageAccess: () => ({ eligible: true, status: 'ready' }),
}));
vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => null,
}));

vi.mock('@/store/user', () => ({
  useUserStore: Object.assign(
    (selector: (s: object) => unknown) => {
      useVersion();
      return selector({ user: { id: state.userId } });
    },
    { getState: () => ({ user: { id: state.userId } }) },
  ),
}));
vi.mock('@/services/sandboxStorage', () => ({
  sandboxStorageService: { getEntitlement: vi.fn() },
}));
vi.mock('@/store/sandbox', () => ({
  sandboxSelectors: { entitlement: () => ({ entitled: true }) },
  useSandboxStore: { getState: () => ({}) },
}));

// The picker's menu is covered by its own tests; here it only names the
// current folder and makes the picks a person would.
vi.mock('../SandboxDrivePicker', () => ({
  default: ({
    onChange,
    value,
  }: {
    onChange: (s: SandboxSelection) => Promise<void>;
    value: SandboxSelection;
  }) => (
    <div>
      <span data-testid="chip">{value.workingDirectory ?? 'temporary'}</span>
      {/* The real picker catches a failed save and says so. */}
      <button onClick={() => onChange({ workingDirectory: 'projects/demo' }).catch(() => {})}>
        pick-folder
      </button>
      <button onClick={() => onChange({ workingDirectory: 'projects/other' }).catch(() => {})}>
        pick-other
      </button>
      <button onClick={() => onChange({}).catch(() => {})}>pick-temporary</button>
    </div>
  ),
}));

beforeEach(() => {
  state.topicId = null;
  state.userId = 'user-a';
  state.topics = {};
  state.updateTopicMetadata.mockReset().mockImplementation(async (id, metadata) => {
    state.topics[id] = { ...state.topics[id], ...metadata };
    commit();
  });
});

afterEach(() => {
  consumePendingSandboxSelection(AGENT);
  consumePendingSandboxSelection(OTHER_AGENT);
  localStorage.clear();
});

const commit = () => {
  state.version += 1;
  state.notify();
};

/** The first send: the pending pick becomes the new topic's metadata. */
const send = (topicId: string) =>
  act(() => {
    state.topics[topicId] = { ...toSandboxTopicMetadata(consumePendingSandboxSelection(AGENT)) };
    state.topicId = topicId;
    commit();
  });

/** "New topic" in the sidebar. */
const openNewConversation = () =>
  act(() => {
    state.topicId = null;
    commit();
  });

describe('SandboxStorageSection — T-14158', () => {
  it('starts the next new conversation in the folder picked in the last one', async () => {
    render(<SandboxStorageSection agentId={AGENT} />);
    // A first conversation starts at the drive's root.
    expect(screen.getByTestId('chip').textContent).toBe('.');

    send('topic-1');
    await act(async () => fireEvent.click(screen.getByText('pick-folder')));
    expect(state.updateTopicMetadata).toHaveBeenCalledWith(
      'topic-1',
      expect.objectContaining({ sandboxWorkingDirectory: 'projects/demo' }),
    );
    expect(screen.getByTestId('chip').textContent).toBe('projects/demo');

    // "New topic": previously this went back to the root every time.
    openNewConversation();
    expect(screen.getByTestId('chip').textContent).toBe('projects/demo');

    // And the conversation it creates is born there, still marked as a default
    // nobody picked for it, so a project conversation can take its checkout.
    send('topic-2');
    expect(state.topics['topic-2']).toMatchObject({
      sandboxSeeded: true,
      sandboxWorkingDirectory: 'projects/demo',
    });
  });

  it('goes back to the root after the temporary sandbox is picked on purpose', async () => {
    render(<SandboxStorageSection agentId={AGENT} />);
    await act(async () => fireEvent.click(screen.getByText('pick-folder')));
    send('topic-1');

    await act(async () => fireEvent.click(screen.getByText('pick-temporary')));

    openNewConversation();
    expect(screen.getByTestId('chip').textContent).toBe('.');
  });

  it('does not remember a pick that failed to save', async () => {
    render(<SandboxStorageSection agentId={AGENT} />);
    send('topic-1');
    state.updateTopicMetadata.mockRejectedValueOnce(new Error('offline'));

    await act(async () => {
      fireEvent.click(screen.getByText('pick-folder'));
    });

    openNewConversation();
    expect(screen.getByTestId('chip').textContent).toBe('.');
  });

  it('carries a folder whose save finished after a new conversation opened', async () => {
    render(<SandboxStorageSection agentId={AGENT} />);
    await send('topic-1');

    let finishSave!: () => void;
    state.updateTopicMetadata.mockImplementationOnce(
      (id, metadata) =>
        new Promise<void>((resolve) => {
          finishSave = () => {
            state.topics[id] = { ...state.topics[id], ...metadata };
            resolve();
          };
        }),
    );
    await act(async () => fireEvent.click(screen.getByText('pick-folder')));

    // "New topic" while the save is still in flight: seeded from the old memory.
    openNewConversation();
    expect(screen.getByTestId('chip').textContent).toBe('.');

    await act(async () => finishSave());
    expect(screen.getByTestId('chip').textContent).toBe('projects/demo');
  });

  // Cold boot: the picker can be ready before the signed-in user is known.
  it('remembers a pick saved before the user id arrived', async () => {
    state.userId = undefined;
    render(<SandboxStorageSection agentId={AGENT} />);
    await send('topic-1');
    await act(async () => fireEvent.click(screen.getByText('pick-folder')));

    act(() => {
      state.userId = 'user-a';
      commit();
    });

    openNewConversation();
    expect(screen.getByTestId('chip').textContent).toBe('projects/demo');
  });

  it('keeps a pick saved before the user id arrived with the agent it was made for', async () => {
    state.userId = undefined;
    const view = render(<SandboxStorageSection agentId={AGENT} />);
    await send('topic-1');
    await act(async () => fireEvent.click(screen.getByText('pick-folder')));

    // Moved to another agent's new conversation before the user id loads.
    openNewConversation();
    view.rerender(<SandboxStorageSection agentId={OTHER_AGENT} />);
    act(() => {
      state.userId = 'user-a';
      commit();
    });

    expect(screen.getByTestId('chip').textContent).toBe('.');
    view.rerender(<SandboxStorageSection agentId={AGENT} />);
    expect(screen.getByTestId('chip').textContent).toBe('projects/demo');
  });

  it('does not let an older save that lands late replace a newer pick', async () => {
    render(<SandboxStorageSection agentId={AGENT} />);
    await send('topic-1');

    let finishFirst!: () => void;
    state.updateTopicMetadata.mockImplementationOnce(
      (id, metadata) =>
        new Promise<void>((resolve) => {
          finishFirst = () => {
            state.topics[id] = { ...state.topics[id], ...metadata };
            resolve();
          };
        }),
    );
    await act(async () => fireEvent.click(screen.getByText('pick-folder')));
    await act(async () => fireEvent.click(screen.getByText('pick-other')));
    await act(async () => finishFirst());

    openNewConversation();
    expect(screen.getByTestId('chip').textContent).toBe('projects/other');
  });

  it('keeps pick ordering when the composer remounts during a save', async () => {
    const first = render(<SandboxStorageSection agentId={AGENT} />);
    await send('topic-1');

    let finishFirst!: () => void;
    state.updateTopicMetadata.mockImplementationOnce(
      (id, metadata) =>
        new Promise<void>((resolve) => {
          finishFirst = () => {
            state.topics[id] = { ...state.topics[id], ...metadata };
            resolve();
          };
        }),
    );
    await act(async () => fireEvent.click(screen.getByText('pick-folder')));
    first.unmount();

    render(<SandboxStorageSection agentId={AGENT} />);
    await act(async () => fireEvent.click(screen.getByText('pick-other')));
    await act(async () => finishFirst());

    openNewConversation();
    expect(screen.getByTestId('chip').textContent).toBe('projects/other');
  });

  it('keeps an older pick that succeeds after a newer one failed', async () => {
    render(<SandboxStorageSection agentId={AGENT} />);
    await send('topic-1');

    let finishFirst!: () => void;
    state.updateTopicMetadata
      .mockImplementationOnce(
        (id, metadata) =>
          new Promise<void>((resolve) => {
            finishFirst = () => {
              state.topics[id] = { ...state.topics[id], ...metadata };
              resolve();
            };
          }),
      )
      .mockRejectedValueOnce(new Error('offline'));
    await act(async () => fireEvent.click(screen.getByText('pick-folder')));
    await act(async () => fireEvent.click(screen.getByText('pick-other')));
    await act(async () => finishFirst());

    openNewConversation();
    expect(screen.getByTestId('chip').textContent).toBe('projects/demo');
  });

  it('remembers a pick for whoever made it, even if another user signs in meanwhile', async () => {
    render(<SandboxStorageSection agentId={AGENT} />);
    await send('topic-1');

    let finishSave!: () => void;
    state.updateTopicMetadata.mockImplementationOnce(
      (id, metadata) =>
        new Promise<void>((resolve) => {
          finishSave = () => {
            state.topics[id] = { ...state.topics[id], ...metadata };
            resolve();
          };
        }),
    );
    await act(async () => fireEvent.click(screen.getByText('pick-folder')));
    act(() => {
      state.userId = 'user-b';
      commit();
    });
    await act(async () => finishSave());

    expect(getRememberedSandboxDirectory({ userId: 'user-b' }, AGENT)).toBeUndefined();
    expect(getRememberedSandboxDirectory({ userId: 'user-a' }, AGENT)).toEqual({
      workingDirectory: 'projects/demo',
    });
  });

  it("never moves another user's new conversation to a folder picked before they signed in", async () => {
    render(<SandboxStorageSection agentId={AGENT} />);
    await send('topic-1');

    let finishSave!: () => void;
    state.updateTopicMetadata.mockImplementationOnce(
      (id, metadata) =>
        new Promise<void>((resolve) => {
          finishSave = () => {
            state.topics[id] = { ...state.topics[id], ...metadata };
            resolve();
          };
        }),
    );
    await act(async () => fireEvent.click(screen.getByText('pick-folder')));
    act(() => {
      state.userId = 'user-b';
      commit();
    });
    openNewConversation();
    expect(screen.getByTestId('chip').textContent).toBe('.');

    await act(async () => finishSave());
    expect(screen.getByTestId('chip').textContent).toBe('.');
  });

  it("keeps a user's pick when another user's newer pick for the same agent lands first", async () => {
    render(<SandboxStorageSection agentId={AGENT} />);
    await send('topic-1');

    let finishFirst!: () => void;
    state.updateTopicMetadata.mockImplementationOnce(
      (id, metadata) =>
        new Promise<void>((resolve) => {
          finishFirst = () => {
            state.topics[id] = { ...state.topics[id], ...metadata };
            resolve();
          };
        }),
    );
    await act(async () => fireEvent.click(screen.getByText('pick-folder')));
    act(() => {
      state.userId = 'user-b';
      commit();
    });
    await act(async () => fireEvent.click(screen.getByText('pick-other')));
    await act(async () => finishFirst());

    expect(getRememberedSandboxDirectory({ userId: 'user-a' }, AGENT)).toEqual({
      workingDirectory: 'projects/demo',
    });
    expect(getRememberedSandboxDirectory({ userId: 'user-b' }, AGENT)).toEqual({
      workingDirectory: 'projects/other',
    });
  });

  it('keeps the order of two picks made before the user id arrived', async () => {
    state.userId = undefined;
    render(<SandboxStorageSection agentId={AGENT} />);
    await send('topic-1');

    let finishFirst!: () => void;
    state.updateTopicMetadata.mockImplementationOnce(
      (id, metadata) =>
        new Promise<void>((resolve) => {
          finishFirst = () => {
            state.topics[id] = { ...state.topics[id], ...metadata };
            resolve();
          };
        }),
    );
    await act(async () => fireEvent.click(screen.getByText('pick-folder')));
    // The newer pick lands first and waits for the user id, which then arrives.
    await act(async () => fireEvent.click(screen.getByText('pick-other')));
    act(() => {
      state.userId = 'user-a';
      commit();
    });
    // The older save lands last.
    await act(async () => finishFirst());

    openNewConversation();
    expect(screen.getByTestId('chip').textContent).toBe('projects/other');
  });

  it("drops a blank conversation's pick when the tab switches to another user", async () => {
    render(<SandboxStorageSection agentId={AGENT} />);
    await act(async () => fireEvent.click(screen.getByText('pick-folder')));
    expect(screen.getByTestId('chip').textContent).toBe('projects/demo');

    act(() => {
      state.userId = 'user-b';
      commit();
    });

    expect(screen.getByTestId('chip').textContent).toBe('.');
  });

  it('keeps a newer deferred pick when an older save lands right after the user id', async () => {
    state.userId = undefined;
    render(<SandboxStorageSection agentId={AGENT} />);
    await send('topic-1');

    let finishFirst!: () => void;
    state.updateTopicMetadata.mockImplementationOnce(
      (id, metadata) =>
        new Promise<void>((resolve) => {
          finishFirst = () => {
            state.topics[id] = { ...state.topics[id], ...metadata };
            resolve();
          };
        }),
    );
    await act(async () => fireEvent.click(screen.getByText('pick-folder')));
    // The newer pick lands first and waits for the user id.
    await act(async () => fireEvent.click(screen.getByText('pick-other')));
    // The id becomes readable, and the older save lands before any effect runs.
    state.userId = 'user-a';
    await act(async () => finishFirst());

    expect(getRememberedSandboxDirectory({ userId: 'user-a' }, AGENT)).toEqual({
      workingDirectory: 'projects/other',
    });
  });

  it("does not move another user's blank conversation when a locked write finishes after the switch", async () => {
    let releaseLock!: () => void;
    const request = vi.fn(
      (_name: string, callback: () => unknown) =>
        new Promise((resolve) => {
          releaseLock = () => resolve(callback());
        }),
    );
    vi.stubGlobal('navigator', { ...navigator, locks: { request } });

    try {
      render(<SandboxStorageSection agentId={AGENT} />);
      await send('topic-1');
      await act(async () => fireEvent.click(screen.getByText('pick-folder')));

      // The write waits for the lock; the tab switches to another user meanwhile.
      act(() => {
        state.userId = 'user-b';
        commit();
      });
      openNewConversation();
      expect(screen.getByTestId('chip').textContent).toBe('.');

      await act(async () => releaseLock());
      expect(screen.getByTestId('chip').textContent).toBe('.');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
