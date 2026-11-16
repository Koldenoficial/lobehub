'use client';

import { memo, useCallback, useEffect } from 'react';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import SafeBoundary from '@/components/ErrorBoundary';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { useTopicId } from '../hooks/useTopicId';
import SandboxDrivePicker from './SandboxDrivePicker';
import {
  beginSandboxPick,
  flushDeferredSandboxPicks,
  settleSandboxPick,
} from './sandboxPickMemory';
import { type SandboxSelection, useSandboxPlacement } from './useSandboxPlacement';
import { useSandboxStorageAccess } from './useSandboxStorageAccess';
import { useSeedDefaultSelection } from './useSeedDefaultSelection';

interface SandboxStorageSectionProps {
  agentId: string;
}

/**
 * The working directory of a cloud-sandbox run — the counterpart of
 * `WorkingDirectorySection`, which covers runs on a machine, and shaped the
 * same way: one chip that always names the slot, whose menu holds every place
 * the run could work.
 *
 * Nothing chosen means a temporary sandbox, cleaned up with the session; a
 * folder on the drive keeps its files, and a repository starts from a checkout.
 * A plan with a drive starts each new conversation in the folder the agent's
 * last conversation was put in, or on its default folder rather than nothing.
 *
 * A plan without a drive still gets the chip: the temporary sandbox is
 * everyone's, and the way to a plan is a row in the same menu rather than a
 * different control.
 */
const SandboxStorageSectionInner = memo<SandboxStorageSectionProps>(({ agentId }) => {
  const { eligible, status } = useSandboxStorageAccess(agentId);
  const workspaceId = useActiveWorkspaceId();
  const userId = useUserStore(userProfileSelectors.userId);
  const { projectId, selection, setSelection, topicId } = useSandboxPlacement(
    agentId,
    useTopicId(),
  );
  // Picks waiting for the user id are remembered once it arrives.
  useEffect(() => {
    if (userId) flushDeferredSandboxPicks(userId);
  }, [userId]);

  // Every pick that lands is remembered for the next conversation, which would
  // otherwise start back at the drive's root. A failed write is not. The user
  // is the one who made the pick; only when nobody was known yet is the id
  // read again when the save lands, since it can arrive in the meantime.
  const pick = useCallback(
    async (next: SandboxSelection) => {
      const seq = beginSandboxPick();
      const pickedBy = userProfileSelectors.userId(useUserStore.getState());
      await setSelection(next);
      settleSandboxPick(
        {
          agentId,
          seq,
          userId: pickedBy ?? userProfileSelectors.userId(useUserStore.getState()),
          workspaceId,
        },
        next,
      );
    },
    [agentId, setSelection, workspaceId],
  );
  useSeedDefaultSelection(agentId, {
    eligible,
    entitled: status === 'ready',
    hasTopic: !!topicId,
  });

  if (status === 'hidden') return null;

  return (
    <SandboxDrivePicker
      entitled={status === 'ready'}
      projectId={projectId}
      topicId={topicId}
      value={selection}
      onChange={pick}
    />
  );
});

SandboxStorageSectionInner.displayName = 'SandboxStorageSectionInner';

const SandboxStorageSection = memo<SandboxStorageSectionProps>(({ agentId }) => (
  <SafeBoundary minHeight={22} resetKeys={[agentId]}>
    <SandboxStorageSectionInner agentId={agentId} />
  </SafeBoundary>
));

SandboxStorageSection.displayName = 'SandboxStorageSection';

export default SandboxStorageSection;
