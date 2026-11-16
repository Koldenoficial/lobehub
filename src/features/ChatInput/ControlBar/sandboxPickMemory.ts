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
// The newest pick per agent whose save has landed: an older save that lands
// late must not replace it. Counted on success only, so a newer pick that
// fails leaves an older one that succeeds free to land.
const latestSettled = new Map<string, number>();
// Picks saved before the user id was known, with the workspace they were made
// in; remembered once the id arrives.
const deferredPicks = new Map<string, { pick: SandboxSelection; workspaceId?: string | null }>();

interface PickTarget {
  agentId: string;
  workspaceId?: string | null;
}

/** Who is signed in, and where, when a save lands. */
export interface ActiveScope {
  userId?: string | null;
  workspaceId?: string | null;
}

/**
 * Remember a pick for the user, agent and workspace it was made in, and move
 * the composer's own default there too: a new conversation opened while the
 * save was in flight was seeded from the folder before. That default is kept
 * per agent only, so it moves only while the same user is still active in the
 * same workspace — never into someone else's new conversation.
 */
const rememberPick = (
  { agentId, userId, workspaceId }: PickTarget & { userId: string },
  pick: SandboxSelection,
  active: ActiveScope,
) => {
  const scope = { userId, workspaceId };
  rememberSandboxSelection(scope, agentId, pick);
  if (active.userId !== userId || (active.workspaceId ?? null) !== (workspaceId ?? null)) return;
  refreshSandboxDefaultSelection(
    agentId,
    resolveDefaultSandboxSelection(workspaceId, getRememberedSandboxDirectory(scope, agentId)),
  );
};

/** Mark the start of a pick; the returned number orders it among the agent's picks. */
export const beginSandboxPick = (): number => {
  pickSeq += 1;
  return pickSeq;
};

/**
 * A pick's save landed. Remembered unless a newer pick for the same agent has
 * already landed; held for later when the user is not known yet.
 *
 * `userId` is whoever made the pick; it is only filled in at landing time when
 * nobody was known when the pick began, so a sign-in as someone else in
 * another tab cannot claim it.
 */
export const settleSandboxPick = (
  { agentId, seq, userId, workspaceId }: PickTarget & { seq: number; userId?: string | null },
  pick: SandboxSelection,
  active: ActiveScope,
): void => {
  if ((latestSettled.get(agentId) ?? 0) > seq) return;
  latestSettled.set(agentId, seq);

  if (!userId) {
    deferredPicks.set(agentId, { pick, workspaceId });
    return;
  }

  deferredPicks.delete(agentId);
  rememberPick({ agentId, userId, workspaceId }, pick, active);
};

/** Remember every pick that was waiting for the user id, for the user now known. */
export const flushDeferredSandboxPicks = (active: ActiveScope & { userId: string }): void => {
  for (const [agentId, { pick, workspaceId }] of deferredPicks) {
    rememberPick({ agentId, userId: active.userId, workspaceId }, pick, active);
  }
  deferredPicks.clear();
};
