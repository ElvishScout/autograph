import type { AnchorName, Box, Point } from '../types'

const VALID_ANCHORS = new Set<AnchorName>([
  'center',
  'top',
  'bottom',
  'left',
  'right',
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
])

export function isAnchorName(val: string | null | undefined): val is AnchorName {
  return !!val && VALID_ANCHORS.has(val as AnchorName)
}

const OPPOSITE_ANCHOR_MAP: Record<AnchorName, AnchorName> = {
  center: 'center',
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
  'top-left': 'bottom-right',
  'top-right': 'bottom-left',
  'bottom-left': 'top-right',
  'bottom-right': 'top-left',
}

/**
 * Returns the opposite anchor name (used for bidirectional inference between target:anchor and self anchor).
 */
export function getOppositeAnchor(anchor: AnchorName): AnchorName {
  return OPPOSITE_ANCHOR_MAP[anchor]
}

/**
 * Resolves the pair (targetAnchor, selfAnchor) given optional explicit inputs:
 * - Both specified -> use both as-is
 * - Only targetAnchor specified -> selfAnchor = opposite(targetAnchor)
 * - Only selfAnchor specified -> targetAnchor = opposite(selfAnchor)
 * - Neither specified -> both 'center'
 */
export function resolveAnchorPair(
  explicitTargetAnchor?: AnchorName,
  explicitSelfAnchor?: AnchorName,
): { targetAnchor: AnchorName; selfAnchor: AnchorName } {
  if (explicitTargetAnchor && explicitSelfAnchor) {
    return { targetAnchor: explicitTargetAnchor, selfAnchor: explicitSelfAnchor }
  }
  if (explicitTargetAnchor && !explicitSelfAnchor) {
    return {
      targetAnchor: explicitTargetAnchor,
      selfAnchor: getOppositeAnchor(explicitTargetAnchor),
    }
  }
  if (!explicitTargetAnchor && explicitSelfAnchor) {
    return {
      targetAnchor: getOppositeAnchor(explicitSelfAnchor),
      selfAnchor: explicitSelfAnchor,
    }
  }
  return { targetAnchor: 'center', selfAnchor: 'center' }
}

/**
 * Infers the default (dx, dy) signs from the resolved targetAnchor when dx or dy is omitted.
 * - Horizontal: contains 'right' -> +1, contains 'left' -> -1, otherwise -> 0
 * - Vertical: contains 'bottom' -> +1, contains 'top' -> -1, otherwise -> 0
 */
export function getAnchorDirectionSigns(targetAnchor: AnchorName): {
  signX: -1 | 0 | 1
  signY: -1 | 0 | 1
} {
  let signX: -1 | 0 | 1 = 0
  let signY: -1 | 0 | 1 = 0

  if (targetAnchor.includes('right')) signX = 1
  else if (targetAnchor.includes('left')) signX = -1

  if (targetAnchor.includes('bottom')) signY = 1
  else if (targetAnchor.includes('top')) signY = -1

  return { signX, signY }
}

/**
 * Returns the (x, y) coordinates of an anchor on a given box.
 */
export function getBoxAnchorPoint(box: Box, anchor: AnchorName): Point {
  const { x, y, width, height } = box
  const cx = x + width / 2
  const cy = y + height / 2
  const r = x + width
  const b = y + height

  switch (anchor) {
    case 'center':
      return { x: cx, y: cy }
    case 'top':
      return { x: cx, y }
    case 'bottom':
      return { x: cx, y: b }
    case 'left':
      return { x, y: cy }
    case 'right':
      return { x: r, y: cy }
    case 'top-left':
      return { x, y }
    case 'top-right':
      return { x: r, y }
    case 'bottom-left':
      return { x, y: b }
    case 'bottom-right':
      return { x: r, y: b }
  }
}

/**
 * Given the world/local coordinates where `selfAnchor` of a box (with `width`, `height`) should be placed,
 * returns the top-left (x, y) of that box.
 */
export function getTopLeftFromAnchorPoint(
  anchorPoint: Point,
  width: number,
  height: number,
  selfAnchor: AnchorName,
): Point {
  const localOffset = getBoxAnchorPoint({ x: 0, y: 0, width, height }, selfAnchor)
  return {
    x: anchorPoint.x - localOffset.x,
    y: anchorPoint.y - localOffset.y,
  }
}

/**
 * Normalizes a target/from/to string like "w1.proc:right" into { id: "w1.proc", anchor: "right" }
 */
export function parseEndpointRef(raw: string | null | undefined): {
  id: string
  anchor?: AnchorName
} {
  if (!raw) return { id: '' }
  const trimmed = raw.trim()
  const colonIdx = trimmed.lastIndexOf(':')
  if (colonIdx === -1) {
    return { id: trimmed }
  }
  const id = trimmed.slice(0, colonIdx).trim()
  const anchorStr = trimmed.slice(colonIdx + 1).trim()
  if (isAnchorName(anchorStr)) {
    return { id, anchor: anchorStr }
  }
  return { id: trimmed }
}

/**
 * Returns the outward unit normal vector for an anchor on a node boundary.
 */
export function getAnchorNormal(anchor: AnchorName): Point {
  switch (anchor) {
    case 'top':
      return { x: 0, y: -1 }
    case 'bottom':
      return { x: 0, y: 1 }
    case 'left':
      return { x: -1, y: 0 }
    case 'right':
      return { x: 1, y: 0 }
    case 'top-left':
      return { x: -1, y: -1 }
    case 'top-right':
      return { x: 1, y: -1 }
    case 'bottom-left':
      return { x: -1, y: 1 }
    case 'bottom-right':
      return { x: 1, y: 1 }
    case 'center':
      return { x: 0, y: 0 }
  }
}
