import type {
  AnchorName,
  Box,
  GraphEdgeIR,
  GraphIR,
  GraphNodeIR,
  Point,
} from '../types'
import { getBoxAnchorPoint } from '../layout/anchor'

const HARD_OBSTACLE_MARGIN = 9
const SOFT_BUFFER_MARGIN = 12
const OVERLAY_HARD_MARGIN = 4
const OVERLAY_SOFT_MARGIN = 8
const MAX_STUB_LENGTH = 14
const CORNER_RADIUS = 8
const TURN_PENALTY = 35
const OBSTACLE_CROSS_PENALTY = 10000
const SOFT_BUFFER_PENALTY = 1200
const PARALLEL_SEGMENT_PENALTY = 220

function snapHalf(v: number): number {
  return Math.round(v * 2) / 2
}

/**
 * Returns a strictly orthogonal outward unit normal vector for an edge anchor.
 * Corner anchors (`top-left`, `top-right`, `bottom-left`, `bottom-right`) exit/enter
 * perpendicularly through the top or bottom face so edge segments are 100% orthogonal (never diagonal/acute).
 */
function getEdgeAnchorNormal(anchor: AnchorName): Point {
  switch (anchor) {
    case 'top':
    case 'top-left':
    case 'top-right':
      return { x: 0, y: -1 }
    case 'bottom':
    case 'bottom-left':
    case 'bottom-right':
      return { x: 0, y: 1 }
    case 'left':
      return { x: -1, y: 0 }
    case 'right':
      return { x: 1, y: 0 }
    case 'center':
      return { x: 0, y: 1 }
  }
}

function isAncestorOf(
  ancestorId: string,
  nodeId: string,
  nodeMap: Map<string, GraphNodeIR>,
): boolean {
  let curr = nodeMap.get(nodeId)
  while (curr && curr.parentId) {
    if (curr.parentId === ancestorId) return true
    curr = nodeMap.get(curr.parentId)
  }
  return false
}

function getNodeAbsBox(node: GraphNodeIR): Box {
  return {
    x: node.absX,
    y: node.absY,
    width: node.width,
    height: node.height,
  }
}

/**
 * Selects optimal (fromAnchor, toAnchor) when not explicitly specified on `<edge>`.
 */
function selectBestAnchors(
  fromBox: Box,
  toBox: Box,
  explicitFrom?: AnchorName,
  explicitTo?: AnchorName,
): { fromAnchor: AnchorName; toAnchor: AnchorName } {
  const normFrom = explicitFrom === 'center' ? undefined : explicitFrom
  const normTo = explicitTo === 'center' ? undefined : explicitTo
  if (normFrom && normTo) {
    return { fromAnchor: normFrom, toAnchor: normTo }
  }

  const fromCx = fromBox.x + fromBox.width / 2
  const fromCy = fromBox.y + fromBox.height / 2
  const toCx = toBox.x + toBox.width / 2
  const toCy = toBox.y + toBox.height / 2

  const dx = toCx - fromCx
  const dy = toCy - fromCy

  const gapX =
    dx >= 0
      ? toBox.x - (fromBox.x + fromBox.width)
      : fromBox.x - (toBox.x + toBox.width)
  const gapY =
    dy >= 0
      ? toBox.y - (fromBox.y + fromBox.height)
      : fromBox.y - (toBox.y + toBox.height)

  let autoFrom: AnchorName
  let autoTo: AnchorName

  if (gapX >= gapY && gapX > -10) {
    autoFrom = dx >= 0 ? 'right' : 'left'
    autoTo = dx >= 0 ? 'left' : 'right'
  } else if (gapY > -10) {
    autoFrom = dy >= 0 ? 'bottom' : 'top'
    autoTo = dy >= 0 ? 'top' : 'bottom'
  } else {
    if (Math.abs(dx) >= Math.abs(dy)) {
      autoFrom = dx >= 0 ? 'right' : 'left'
      autoTo = dx >= 0 ? 'left' : 'right'
    } else {
      autoFrom = dy >= 0 ? 'bottom' : 'top'
      autoTo = dy >= 0 ? 'top' : 'bottom'
    }
  }

  return {
    fromAnchor: normFrom ?? autoFrom,
    toAnchor: normTo ?? autoTo,
  }
}

/**
 * Computes distributed port coordinates when multiple edges share the same (nodeId, anchor).
 * Corner anchors (`top-left`, `top-right`, `bottom-left`, `bottom-right`) are placed at the left/right
 * side of the top/bottom edge (inset from the rounded corner) so edges attach at a clean 90° angle.
 */
function getPortPoint(
  box: Box,
  anchor: AnchorName,
  portIndex: number,
  portCount: number,
): Point {
  const offsetRatio = portCount <= 1 ? 0 : (portIndex + 1) / (portCount + 1) - 0.5

  if (anchor === 'top' || anchor === 'bottom') {
    const y = snapHalf(anchor === 'top' ? box.y : box.y + box.height)
    const usableWidth = Math.max(12, box.width * 0.7)
    const x = snapHalf(box.x + box.width / 2 + offsetRatio * usableWidth)
    return { x, y }
  }

  if (anchor === 'top-left' || anchor === 'bottom-left') {
    const y = snapHalf(anchor === 'top-left' ? box.y : box.y + box.height)
    const inset = Math.max(16, Math.min(box.width * 0.22, box.width / 2 - 4))
    const span = Math.max(8, box.width * 0.16)
    const x = snapHalf(box.x + inset + offsetRatio * span)
    return { x, y }
  }

  if (anchor === 'top-right' || anchor === 'bottom-right') {
    const y = snapHalf(anchor === 'top-right' ? box.y : box.y + box.height)
    const inset = Math.max(16, Math.min(box.width * 0.22, box.width / 2 - 4))
    const span = Math.max(8, box.width * 0.16)
    const x = snapHalf(box.x + box.width - inset + offsetRatio * span)
    return { x, y }
  }

  if (anchor === 'left' || anchor === 'right') {
    const x = snapHalf(anchor === 'left' ? box.x : box.x + box.width)
    const usableHeight = Math.max(12, box.height * 0.7)
    const y = snapHalf(box.y + box.height / 2 + offsetRatio * usableHeight)
    return { x, y }
  }

  const base = getBoxAnchorPoint(box, anchor)
  return { x: snapHalf(base.x), y: snapHalf(base.y) }
}

/**
 * Computes adaptive stub length so startStub and endStub NEVER overshoot each other on short edges.
 */
function computeAdaptiveStubLength(
  startPort: Point,
  fromAnchor: AnchorName,
  endPort: Point,
  toAnchor: AnchorName,
): number {
  const n1 = getEdgeAnchorNormal(fromAnchor)
  const n2 = getEdgeAnchorNormal(toAnchor)

  // If the two ports face each other along X or Y, clamp stub length to <= 1/3 of their gap
  if (n1.x !== 0 && n1.x === -n2.x) {
    const axialGap = (endPort.x - startPort.x) * n1.x
    if (axialGap > 0) {
      return Math.min(MAX_STUB_LENGTH, Math.max(4, Math.floor(axialGap / 3)))
    }
  }
  if (n1.y !== 0 && n1.y === -n2.y) {
    const axialGap = (endPort.y - startPort.y) * n1.y
    if (axialGap > 0) {
      return Math.min(MAX_STUB_LENGTH, Math.max(4, Math.floor(axialGap / 3)))
    }
  }

  const directDist = Math.hypot(endPort.x - startPort.x, endPort.y - startPort.y)
  return Math.min(MAX_STUB_LENGTH, Math.max(4, Math.floor(directDist / 3)))
}

function getStubPoint(port: Point, anchor: AnchorName, stubLen: number): Point {
  const normal = getEdgeAnchorNormal(anchor)
  return {
    x: snapHalf(port.x + normal.x * stubLen),
    y: snapHalf(port.y + normal.y * stubLen),
  }
}

function inflateBox(box: Box, margin: number): Box {
  return {
    x: box.x - margin,
    y: box.y - margin,
    width: box.width + margin * 2,
    height: box.height + margin * 2,
  }
}

/**
 * Checks whether an axis-aligned segment (p1 -> p2) passes strictly through the interior of `box`.
 */
function segmentIntersectsBox(p1: Point, p2: Point, box: Box): boolean {
  const eps = 0.5
  const bx1 = box.x + eps
  const by1 = box.y + eps
  const bx2 = box.x + box.width - eps
  const by2 = box.y + box.height - eps

  if (bx2 <= bx1 || by2 <= by1) return false

  const minX = Math.min(p1.x, p2.x)
  const maxX = Math.max(p1.x, p2.x)
  const minY = Math.min(p1.y, p2.y)
  const maxY = Math.max(p1.y, p2.y)

  if (Math.abs(p1.y - p2.y) < 0.5) {
    const y = p1.y
    if (y > by1 && y < by2) {
      return Math.max(minX, bx1) < Math.min(maxX, bx2)
    }
    return false
  } else {
    const x = p1.x
    if (x > bx1 && x < bx2) {
      return Math.max(minY, by1) < Math.min(maxY, by2)
    }
    return false
  }
}

function polylineHitsAnyBox(pts: Point[], boxes: Box[]): boolean {
  for (let i = 0; i < pts.length - 1; i++) {
    for (const b of boxes) {
      if (segmentIntersectsBox(pts[i], pts[i + 1], b)) return true
    }
  }
  return false
}

interface RoutedSegment {
  p1: Point
  p2: Point
}

function segmentsOverlap(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
  if (Math.abs(a1.y - a2.y) < 0.5 && Math.abs(b1.y - b2.y) < 0.5) {
    if (Math.abs(a1.y - b1.y) > 4) return false
    const minA = Math.min(a1.x, a2.x)
    const maxA = Math.max(a1.x, a2.x)
    const minB = Math.min(b1.x, b2.x)
    const maxB = Math.max(b1.x, b2.x)
    return Math.max(minA, minB) < Math.min(maxA, maxB) - 1
  }
  if (Math.abs(a1.x - a2.x) < 0.5 && Math.abs(b1.x - b2.x) < 0.5) {
    if (Math.abs(a1.x - b1.x) > 4) return false
    const minA = Math.min(a1.y, a2.y)
    const maxA = Math.max(a1.y, a2.y)
    const minB = Math.min(b1.y, b2.y)
    const maxB = Math.max(b1.y, b2.y)
    return Math.max(minA, minB) < Math.min(maxA, maxB) - 1
  }
  return false
}

function polylineOverlapsExisting(
  pts: Point[],
  existingSegments: RoutedSegment[],
): boolean {
  for (let i = 0; i < pts.length - 1; i++) {
    for (const seg of existingSegments) {
      if (segmentsOverlap(pts[i], pts[i + 1], seg.p1, seg.p2)) return true
    }
  }
  return false
}

/**
 * Simplifies collinear consecutive points and removes any accidental spike/backtrack from a polyline.
 */
function simplifyOrthogonalPath(pts: Point[]): Point[] {
  if (pts.length <= 2) return pts
  const dedup: Point[] = [pts[0]]
  for (let i = 1; i < pts.length; i++) {
    const prev = dedup[dedup.length - 1]
    if (Math.hypot(pts[i].x - prev.x, pts[i].y - prev.y) > 0.5) {
      dedup.push(pts[i])
    }
  }
  if (dedup.length <= 2) return dedup

  const out: Point[] = [dedup[0]]
  for (let i = 1; i < dedup.length - 1; i++) {
    const p0 = out[out.length - 1]
    const p1 = dedup[i]
    const p2 = dedup[i + 1]
    const sameX = Math.abs(p0.x - p1.x) < 0.5 && Math.abs(p1.x - p2.x) < 0.5
    const sameY = Math.abs(p0.y - p1.y) < 0.5 && Math.abs(p1.y - p2.y) < 0.5
    if (!sameX && !sameY) {
      out.push(p1)
    }
  }
  out.push(dedup[dedup.length - 1])
  return out
}

/**
 * Converts orthogonal points to an SVG path with rounded corners.
 */
export function buildRoundedOrthogonalSvgPath(
  pts: Point[],
  radius = CORNER_RADIUS,
): string {
  if (pts.length === 0) return ''
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`
  const parts: string[] = [`M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`]

  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1]
    const curr = pts[i]
    const next = pts[i + 1]

    const v1x = curr.x - prev.x
    const v1y = curr.y - prev.y
    const len1 = Math.hypot(v1x, v1y)

    const v2x = next.x - curr.x
    const v2y = next.y - curr.y
    const len2 = Math.hypot(v2x, v2y)

    const r = Math.min(radius, len1 / 2, len2 / 2)
    if (r < 1) {
      parts.push(`L ${curr.x.toFixed(1)} ${curr.y.toFixed(1)}`)
      continue
    }

    const startX = curr.x - (v1x / len1) * r
    const startY = curr.y - (v1y / len1) * r
    const endX = curr.x + (v2x / len2) * r
    const endY = curr.y + (v2y / len2) * r

    parts.push(`L ${startX.toFixed(1)} ${startY.toFixed(1)}`)
    parts.push(
      `Q ${curr.x.toFixed(1)} ${curr.y.toFixed(1)} ${endX.toFixed(1)} ${endY.toFixed(1)}`,
    )
  }

  const last = pts[pts.length - 1]
  parts.push(`L ${last.x.toFixed(1)} ${last.y.toFixed(1)}`)
  return parts.join(' ')
}

/**
 * Orthogonal Hanan-Grid A* search between `startStub` and `endStub`, avoiding `obstacles`.
 */
function findOrthogonalPathAStar(
  startPort: Point,
  fromAnchor: AnchorName,
  startStub: Point,
  endStub: Point,
  endPort: Point,
  toAnchor: AnchorName,
  hardObstacles: Box[],
  softBuffers: Box[],
  srcBox: Box,
  dstBox: Box,
  existingSegments: RoutedSegment[],
  nudgeShift: number,
): Point[] {
  const n1 = getEdgeAnchorNormal(fromAnchor)
  const n2 = getEdgeAnchorNormal(toAnchor)
  const srcStubDist = Math.max(
    Math.abs(startStub.x - startPort.x),
    Math.abs(startStub.y - startPort.y),
  )
  const dstStubDist = Math.max(
    Math.abs(endStub.x - endPort.x),
    Math.abs(endStub.y - endPort.y),
  )
  // During the routing body (startStub -> endStub), srcBox and dstBox also have a buffer halo
  // clamped to < stubDist so startStub and endStub lie cleanly outside their own buffers.
  const srcHardBuffer = inflateBox(
    srcBox,
    Math.max(2, Math.min(HARD_OBSTACLE_MARGIN, srcStubDist - 2)),
  )
  const dstHardBuffer = inflateBox(
    dstBox,
    Math.max(2, Math.min(HARD_OBSTACLE_MARGIN, dstStubDist - 2)),
  )
  const allHardBoxes = [...hardObstacles, srcBox, dstBox]
  const allMidRouteBuffers = [
    ...softBuffers,
    inflateBox(srcBox, Math.max(2, Math.min(SOFT_BUFFER_MARGIN, srcStubDist - 1))),
    inflateBox(dstBox, Math.max(2, Math.min(SOFT_BUFFER_MARGIN, dstStubDist - 1))),
  ]

  // Fast-path 1: Straight line if ports are aligned and face each other without obstacles or buffer intrusion
  const isHorizFacing =
    n1.x !== 0 &&
    n1.x === -n2.x &&
    Math.abs(startPort.y - endPort.y) < 1 &&
    (endPort.x - startPort.x) * n1.x > 0
  const isVertFacing =
    n1.y !== 0 &&
    n1.y === -n2.y &&
    Math.abs(startPort.x - endPort.x) < 1 &&
    (endPort.y - startPort.y) * n1.y > 0

  if (isHorizFacing || isVertFacing) {
    const directLine = isHorizFacing
      ? [startPort, { x: endPort.x, y: startPort.y }]
      : [startPort, { x: startPort.x, y: endPort.y }]
    if (
      !polylineHitsAnyBox(directLine, allHardBoxes) &&
      !polylineHitsAnyBox(directLine, softBuffers)
    ) {
      return directLine
    }
  }

  // Fast-path 2: Clean Z-shape if ports face each other and midpoint Z-path is obstacle-free AND buffer-free
  if (n1.x !== 0 && n1.x === -n2.x && (endStub.x - startStub.x) * n1.x >= 0) {
    const midX = snapHalf((startStub.x + endStub.x) / 2)
    const midBridge = [
      { x: startStub.x, y: startPort.y },
      { x: midX, y: startPort.y },
      { x: midX, y: endPort.y },
      { x: endStub.x, y: endPort.y },
    ]
    const zPath = simplifyOrthogonalPath([
      startPort,
      { x: midX, y: startPort.y },
      { x: midX, y: endPort.y },
      endPort,
    ])
    if (
      !polylineHitsAnyBox(zPath, allHardBoxes) &&
      !polylineHitsAnyBox(midBridge, allMidRouteBuffers) &&
      !polylineOverlapsExisting(zPath, existingSegments)
    ) {
      return zPath
    }
  }
  if (n1.y !== 0 && n1.y === -n2.y && (endStub.y - startStub.y) * n1.y >= 0) {
    const midY = snapHalf((startStub.y + endStub.y) / 2)
    const midBridge = [
      { x: startPort.x, y: startStub.y },
      { x: startPort.x, y: midY },
      { x: endPort.x, y: midY },
      { x: endPort.x, y: endStub.y },
    ]
    const zPath = simplifyOrthogonalPath([
      startPort,
      { x: startPort.x, y: midY },
      { x: endPort.x, y: midY },
      endPort,
    ])
    if (
      !polylineHitsAnyBox(zPath, allHardBoxes) &&
      !polylineHitsAnyBox(midBridge, allMidRouteBuffers) &&
      !polylineOverlapsExisting(zPath, existingSegments)
    ) {
      return zPath
    }
  }

  const xSet = new Set<number>()
  const ySet = new Set<number>()

  const addCoord = (x: number, y: number) => {
    xSet.add(Math.round(x * 2) / 2)
    ySet.add(Math.round(y * 2) / 2)
  }

  addCoord(startPort.x, startPort.y)
  addCoord(startStub.x, startStub.y)
  addCoord(endStub.x, endStub.y)
  addCoord(endPort.x, endPort.y)
  addCoord((startStub.x + endStub.x) / 2, (startStub.y + endStub.y) / 2)
  if (nudgeShift !== 0) {
    addCoord(
      (startStub.x + endStub.x) / 2 + nudgeShift,
      (startStub.y + endStub.y) / 2 + nudgeShift,
    )
  }

  const gridBoxes = [
    ...hardObstacles,
    ...allMidRouteBuffers,
    inflateBox(srcBox, HARD_OBSTACLE_MARGIN),
    inflateBox(dstBox, HARD_OBSTACLE_MARGIN),
  ]
  for (const b of gridBoxes) {
    addCoord(b.x, b.y)
    addCoord(b.x + b.width, b.y + b.height)
    if (nudgeShift !== 0) {
      addCoord(b.x + nudgeShift, b.y + nudgeShift)
      addCoord(b.x + b.width + nudgeShift, b.y + b.height + nudgeShift)
    }
  }

  const xs = Array.from(xSet).sort((a, b) => a - b)
  const ys = Array.from(ySet).sort((a, b) => a - b)

  const midXs: number[] = []
  for (let i = 0; i < xs.length - 1; i++) {
    if (xs[i + 1] - xs[i] > 16) {
      midXs.push(Math.round(((xs[i] + xs[i + 1]) / 2) * 2) / 2)
    }
  }
  const midYs: number[] = []
  for (let i = 0; i < ys.length - 1; i++) {
    if (ys[i + 1] - ys[i] > 16) {
      midYs.push(Math.round(((ys[i] + ys[i + 1]) / 2) * 2) / 2)
    }
  }

  for (const mx of midXs) xSet.add(mx)
  for (const my of midYs) ySet.add(my)

  const gridX = Array.from(xSet).sort((a, b) => a - b)
  const gridY = Array.from(ySet).sort((a, b) => a - b)

  const nx = gridX.length
  const ny = gridY.length

  const findIdx = (arr: number[], val: number): number => {
    let best = 0
    let bestDiff = Infinity
    for (let i = 0; i < arr.length; i++) {
      const d = Math.abs(arr[i] - val)
      if (d < bestDiff) {
        bestDiff = d
        best = i
      }
    }
    return best
  }

  const startIx = findIdx(gridX, startStub.x)
  const startIy = findIdx(gridY, startStub.y)
  const endIx = findIdx(gridX, endStub.x)
  const endIy = findIdx(gridY, endStub.y)

  // Direction encoding: 0=none, 1=right, 2=left, 3=down, 4=up
  const stateKey = (ix: number, iy: number, dir: number) => (ix * ny + iy) * 5 + dir

  const gScore = new Map<number, number>()
  const parentMap = new Map<number, number>()

  interface OpenItem {
    key: number
    ix: number
    iy: number
    dir: number
    g: number
    f: number
  }

  const open: OpenItem[] = []
  const h = (ix: number, iy: number) =>
    Math.abs(gridX[ix] - gridX[endIx]) + Math.abs(gridY[iy] - gridY[endIy])

  let initDir = 0
  if (Math.abs(startStub.x - startPort.x) > Math.abs(startStub.y - startPort.y)) {
    initDir = startStub.x >= startPort.x ? 1 : 2
  } else if (Math.abs(startStub.y - startPort.y) > 0.1) {
    initDir = startStub.y >= startPort.y ? 3 : 4
  }

  const startKey = stateKey(startIx, startIy, initDir)
  gScore.set(startKey, 0)
  open.push({
    key: startKey,
    ix: startIx,
    iy: startIy,
    dir: initDir,
    g: 0,
    f: h(startIx, startIy),
  })

  const dirs = [
    { d: 1, dx: 1, dy: 0 },
    { d: 2, dx: -1, dy: 0 },
    { d: 3, dx: 0, dy: 1 },
    { d: 4, dx: 0, dy: -1 },
  ]

  let bestEndKey = -1

  while (open.length > 0) {
    let minIdx = 0
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[minIdx].f) minIdx = i
    }
    const curr = open[minIdx]
    open.splice(minIdx, 1)

    if (curr.ix === endIx && curr.iy === endIy) {
      bestEndKey = curr.key
      break
    }

    if (curr.g > (gScore.get(curr.key) ?? Infinity)) continue

    const p1: Point = { x: gridX[curr.ix], y: gridY[curr.iy] }

    for (const step of dirs) {
      // Prevent 180-degree immediate reversal
      if (
        (curr.dir === 1 && step.d === 2) ||
        (curr.dir === 2 && step.d === 1) ||
        (curr.dir === 3 && step.d === 4) ||
        (curr.dir === 4 && step.d === 3)
      ) {
        continue
      }

      const nix = curr.ix + step.dx
      const niy = curr.iy + step.dy
      if (nix < 0 || nix >= nx || niy < 0 || niy >= ny) continue

      const p2: Point = { x: gridX[nix], y: gridY[niy] }
      const dist = Math.abs(p2.x - p1.x) + Math.abs(p2.y - p1.y)

      let penalty = 0
      // Hard obstacles (other nodes + 14px margin, plus srcBox/dstBox + 10px margin during mid-routing)
      for (const obs of hardObstacles) {
        if (segmentIntersectsBox(p1, p2, obs)) {
          penalty += OBSTACLE_CROSS_PENALTY
        }
      }
      if (
        segmentIntersectsBox(p1, p2, srcHardBuffer) ||
        segmentIntersectsBox(p1, p2, dstHardBuffer)
      ) {
        penalty += OBSTACLE_CROSS_PENALTY
      }

      // Soft buffer zone around all nodes (including srcBox and dstBox during startStub -> endStub routing)
      for (const buf of allMidRouteBuffers) {
        if (segmentIntersectsBox(p1, p2, buf)) {
          penalty += SOFT_BUFFER_PENALTY + dist * 3
        }
      }

      for (const seg of existingSegments) {
        if (segmentsOverlap(p1, p2, seg.p1, seg.p2)) {
          penalty += PARALLEL_SEGMENT_PENALTY
        }
      }

      const turnCost = curr.dir !== 0 && curr.dir !== step.d ? TURN_PENALTY : 0
      const tentativeG = curr.g + dist + turnCost + penalty
      const nKey = stateKey(nix, niy, step.d)

      if (tentativeG < (gScore.get(nKey) ?? Infinity)) {
        gScore.set(nKey, tentativeG)
        parentMap.set(nKey, curr.key)
        open.push({
          key: nKey,
          ix: nix,
          iy: niy,
          dir: step.d,
          g: tentativeG,
          f: tentativeG + h(nix, niy),
        })
      }
    }
  }

  const gridPath: Point[] = []
  if (bestEndKey !== -1) {
    let currKey: number | undefined = bestEndKey
    while (currKey !== undefined) {
      const stateWithoutDir = Math.floor(currKey / 5)
      const iy = stateWithoutDir % ny
      const ix = Math.floor(stateWithoutDir / ny)
      gridPath.push({ x: gridX[ix], y: gridY[iy] })
      currKey = parentMap.get(currKey)
    }
    gridPath.reverse()
  } else {
    const midX = (startStub.x + endStub.x) / 2
    gridPath.push(
      startStub,
      { x: midX, y: startStub.y },
      { x: midX, y: endStub.y },
      endStub,
    )
  }

  return simplifyOrthogonalPath([startPort, ...gridPath, endPort])
}

export function routeAllEdges(graph: GraphIR): void {
  const allNodes = Array.from(graph.nodeMap.values())

  const resolvedAnchors = new Map<
    string,
    { fromAnchor: AnchorName; toAnchor: AnchorName }
  >()
  const portGroups = new Map<
    string,
    Array<{ edge: GraphEdgeIR; isFrom: boolean; otherPt: Point }>
  >()

  for (const edge of graph.allEdges) {
    const srcNode = graph.nodeMap.get(edge.fromId)
    const dstNode = graph.nodeMap.get(edge.toId)
    if (!srcNode || !dstNode) continue

    const srcBox = getNodeAbsBox(srcNode)
    const dstBox = getNodeAbsBox(dstNode)

    const { fromAnchor, toAnchor } = selectBestAnchors(
      srcBox,
      dstBox,
      edge.fromAnchor,
      edge.toAnchor,
    )
    resolvedAnchors.set(edge.id, { fromAnchor, toAnchor })

    const fromKey = `${srcNode.id}:${fromAnchor}`
    const toKey = `${dstNode.id}:${toAnchor}`

    const fromList = portGroups.get(fromKey) ?? []
    fromList.push({
      edge,
      isFrom: true,
      otherPt: getBoxAnchorPoint(dstBox, toAnchor),
    })
    portGroups.set(fromKey, fromList)

    const toList = portGroups.get(toKey) ?? []
    toList.push({
      edge,
      isFrom: false,
      otherPt: getBoxAnchorPoint(srcBox, fromAnchor),
    })
    portGroups.set(toKey, toList)
  }

  const edgePortIndex = new Map<string, { index: number; count: number }>()
  for (const [key, items] of portGroups.entries()) {
    const anchor = key.split(':')[1] as AnchorName
    if (anchor === 'top' || anchor === 'bottom') {
      items.sort((a, b) => a.otherPt.x - b.otherPt.x)
    } else if (anchor === 'left' || anchor === 'right') {
      items.sort((a, b) => a.otherPt.y - b.otherPt.y)
    }
    items.forEach((item, idx) => {
      const tag = `${item.edge.id}:${item.isFrom ? 'from' : 'to'}`
      edgePortIndex.set(tag, { index: idx, count: items.length })
    })
  }

  const existingSegments: RoutedSegment[] = []
  let edgeIdx = 0

  for (const edge of graph.allEdges) {
    const srcNode = graph.nodeMap.get(edge.fromId)
    const dstNode = graph.nodeMap.get(edge.toId)
    if (!srcNode || !dstNode) {
      edge.points = []
      edge.svgPath = ''
      continue
    }

    const srcBox = getNodeAbsBox(srcNode)
    const dstBox = getNodeAbsBox(dstNode)
    const { fromAnchor, toAnchor } = resolvedAnchors.get(edge.id)!

    const fromPortMeta = edgePortIndex.get(`${edge.id}:from`) ?? { index: 0, count: 1 }
    const toPortMeta = edgePortIndex.get(`${edge.id}:to`) ?? { index: 0, count: 1 }

    const startPort = getPortPoint(
      srcBox,
      fromAnchor,
      fromPortMeta.index,
      fromPortMeta.count,
    )
    const endPort = getPortPoint(dstBox, toAnchor, toPortMeta.index, toPortMeta.count)

    const stubLen = computeAdaptiveStubLength(
      startPort,
      fromAnchor,
      endPort,
      toAnchor,
    )
    const startStub = getStubPoint(startPort, fromAnchor, stubLen)
    const endStub = getStubPoint(endPort, toAnchor, stubLen)

    const hardObstacles: Box[] = []
    const softBuffers: Box[] = []
    for (const node of allNodes) {
      // Container overlay HTML (such as group/define title badges like "SQL Agent") is ALWAYS an obstacle,
      // even when the container itself is an ancestor of srcNode or dstNode.
      if (node.isContainer && node.overlayWidth > 0 && node.overlayHeight > 0) {
        const overlayBox: Box = {
          x: node.absX + node.containerConfig.paddingX,
          y: node.absY + node.containerConfig.paddingY,
          width: node.overlayWidth,
          height: node.overlayHeight,
        }
        hardObstacles.push(inflateBox(overlayBox, OVERLAY_HARD_MARGIN))
        softBuffers.push(inflateBox(overlayBox, OVERLAY_SOFT_MARGIN))
      }

      if (node.id === srcNode.id || node.id === dstNode.id) continue
      if (
        isAncestorOf(node.id, srcNode.id, graph.nodeMap) ||
        isAncestorOf(node.id, dstNode.id, graph.nodeMap)
      ) {
        continue
      }
      if (
        isAncestorOf(srcNode.id, node.id, graph.nodeMap) ||
        isAncestorOf(dstNode.id, node.id, graph.nodeMap)
      ) {
        continue
      }
      const rawBox = getNodeAbsBox(node)
      hardObstacles.push(inflateBox(rawBox, HARD_OBSTACLE_MARGIN))
      softBuffers.push(inflateBox(rawBox, SOFT_BUFFER_MARGIN))
    }

    const nudgeShift =
      edgeIdx % 2 === 0
        ? Math.floor(edgeIdx / 2) * 8
        : -Math.ceil(edgeIdx / 2) * 8
    edgeIdx++

    const points = findOrthogonalPathAStar(
      startPort,
      fromAnchor,
      startStub,
      endStub,
      endPort,
      toAnchor,
      hardObstacles,
      softBuffers,
      srcBox,
      dstBox,
      existingSegments,
      nudgeShift,
    )

    edge.points = points
    edge.svgPath = buildRoundedOrthogonalSvgPath(points, CORNER_RADIUS)

    for (let i = 0; i < points.length - 1; i++) {
      existingSegments.push({ p1: points[i], p2: points[i + 1] })
    }
  }
}
