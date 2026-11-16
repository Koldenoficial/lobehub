import { getComposioAppByIdentifier, getLobehubSkillProviderById } from '@lobechat/const';
import { Avatar, Center, Icon } from '@lobehub/ui';
import { McpIcon } from '@lobehub/ui/icons';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import { ConnectorSourceType } from '@/database/schemas';
import { useToolStore } from '@/store/tool';
import type { ConnectorWithTools } from '@/store/tool/slices/connector/types';

const ICON_SIZE = { large: 40, middle: 28 } as const;

const styles = stylex.create({
  tile: {
    backgroundColor: cssVar.colorBgContainer,
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    borderStyle: 'solid',
    borderWidth: 1,
    flex: 'none',
    height: 48,
    overflow: 'hidden',
    width: 48,
  },
  tileLarge: {
    borderRadius: cssVar.borderRadiusLG,
    height: 64,
    width: 64,
  },
});

interface ConnectorDetailIconProps {
  connector: Pick<ConnectorWithTools, 'identifier' | 'name' | 'sourceType'>;
  /** `large` heads the detail page; `middle` sits in denser layouts. */
  size?: keyof typeof ICON_SIZE;
}

/**
 * The same brand mark the list row shows, so the detail page reads as the
 * row it was opened from.
 */
const ConnectorDetailIcon = memo<ConnectorDetailIconProps>(({ connector, size = 'middle' }) => {
  const iconSize = ICON_SIZE[size];
  const builtinAvatar = useToolStore((s) =>
    connector.sourceType === ConnectorSourceType.builtin
      ? s.builtinTools?.find((tool) => tool.identifier === connector.identifier)?.avatar
      : undefined,
  );
  const brand =
    getComposioAppByIdentifier(connector.identifier) ??
    getLobehubSkillProviderById(connector.identifier);

  const renderIcon = () => {
    if (builtinAvatar) return <Avatar avatar={builtinAvatar} size={iconSize} />;
    if (brand) {
      if (typeof brand.icon === 'string')
        return <Avatar alt={brand.label} avatar={brand.icon} size={iconSize} />;
      return <Icon fill={'currentColor'} icon={brand.icon} size={iconSize} />;
    }
    return <Icon icon={McpIcon} size={iconSize} />;
  };

  return (
    <Center {...stylex.props(styles.tile, size === 'large' && styles.tileLarge)}>
      {renderIcon()}
    </Center>
  );
});

ConnectorDetailIcon.displayName = 'ConnectorDetailIcon';

export default ConnectorDetailIcon;
