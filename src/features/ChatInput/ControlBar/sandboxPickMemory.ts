import { refreshSandboxDefaultSelection } from '@/store/chat/pendingSandboxSelection';

import { resolveDefaultSandboxSelection } from './defaultSandboxSelection';
import {
  getRememberedSandboxDirectory,
  rememberSandboxSelection,
} from './rememberedSandboxDirectory';
import type { SandboxSelection } from './useSandboxPlacement';

/**
 * The bookkeeping between a pick and its memory, kept per agent at module
 * level rather than in a component: the composer can unmount while a save is
 * in flight and mount again on the same agent, and neither the ordering of
 * picks nor a pick still waiting for the user id may be lost in between.
 */

let pickSeq = 0;
// The latest pick per agent: an older save that lands late must not replace a
// newer choice.
const latestPick = new Map<string, number>();
// Picks saved before the user id was known, with the workspace they were made
// in; remembered once the id arrives.
const deferredPicks = new Map<string, { pick: SandboxSelection; workspaceId?: string | null }>();

interface PickTarget {
  agentId: string;
  workspaceId?: string | null;
}

/**
 * Remember a pick for the agent and workspace it was made in, and move the
 * composer's own default there too: a new conversation opened while the save
 * was in flight was seeded from the folder before.
 */
const rememberPick = (
  { agentId, userId, workspaceId }: PickTarget & { userId: string },
  pick: SandboxSelection,
) => {
  const scope = { userId, workspaceId };
  rememberSandboxSelection(scope, agentId, pick);
  refreshSandboxDefaultSelection(
    agentId,
    resolveDefaultSandboxSelection(workspaceId, getRememberedSandboxDirectory(scope, agentId)),
  );
};

/** Mark the start of a pick; the returned number settles it. */
export const beginSandboxPick = (agentId: string): number => {
  pickSeq += 1;
  latestPick.set(agentId, pickSeq);
  return pickSeq;
};

/**
 * A pick's save landed. Remembered unless a newer pick for the same agent has
 * started since; held for later when the user is not known yet.
 */
export const settleSandboxPick = (
  { agentId, seq, userId, workspaceId }: PickTarget & { seq: number; userId?: string | null },
  pick: SandboxSelection,
): void => {
  if (latestPick.get(agentId) !== seq) return;

  if (!userId) {
    deferredPicks.set(agentId, { pick, workspaceId });
    return;
  }

  deferredPicks.delete(agentId);
  rememberPick({ agentId, userId, workspaceId }, pick);
};

/** Remember every pick that was waiting for the user id. */
export const flushDeferredSandboxPicks = (userId: string): void => {
  for (const [agentId, { pick, workspaceId }] of deferredPicks) {
    rememberPick({ agentId, userId, workspaceId }, pick);
  }
  deferredPicks.clear();
};
