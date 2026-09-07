import type { UIAnchor } from '../types';

/** Insets work for negative and centered offsets too; CSS/Yoga padding cannot represent those. */
export function anchorInsets(anchor: UIAnchor) {
  return {
    left: anchor.h === 'right' ? 0 : anchor.offsetX,
    right: anchor.h === 'left' ? 0 : anchor.h === 'center' ? -anchor.offsetX : anchor.offsetX,
    top: anchor.v === 'bottom' ? 0 : anchor.offsetY,
    bottom: anchor.v === 'top' ? 0 : anchor.v === 'middle' ? -anchor.offsetY : anchor.offsetY,
  };
}
