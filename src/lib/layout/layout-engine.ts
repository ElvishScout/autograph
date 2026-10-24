import type {
  Box,
  ContainerConfig,
  GraphEdgeIR,
  GraphIR,
  GraphNodeIR,
} from '../types'
import {
  getAnchorDirectionSigns,
  getBoxAnchorPoint,
  getTopLeftFromAnchorPoint,
} from './anchor'

/** Vertical gap between the container title band and the content area (px) */
export const TITLE_CONTENT_GAP = 8

/**
 * Given a scoped node ID (e.g. "w1.proc") and a container prefix (e.g. ""),
 * returns the direct child ID of that container (e.g. "w1").
 */
function resolveDirectChildId(
  scopedNodeId: string,
  containerPrefix: string,
  childMap: Map<string, GraphNodeIR>,
): string | undefined {
  if (childMap.has(scopedNodeId)) return scopedNodeId
  const prefix = containerPrefix ? `${containerPrefix}.` : ''
  if (!scopedNodeId.startsWith(prefix)) return undefined
  const rest = scopedNodeId.slice(prefix.length)
  const dotIdx = rest.indexOf('.')
  if (dotIdx === -1) {
    return childMap.has(scopedNodeId) ? scopedNodeId : undefined
  }
  const topChildId = `${prefix}${rest.slice(0, dotIdx)}`
  return childMap.has(topChildId) ? topChildId : undefined
}

/**
 * Performs automatic Sugiyama-like topological layered layout for `autoNodes`
 * inside a container with `config`.
 *
 * `primarySeed` is the primary-axis cursor start: when siblings were placed
 * with explicit absolute coordinates, auto nodes flow after them along the
 * container's flow direction instead of collapsing back onto the origin.
 */
function layoutAutoNodes(
  autoNodes: GraphNodeIR[],
  containerPrefix: string,
  allEdges: GraphEdgeIR[],
  config: ContainerConfig,
  primarySeed = 0,
): void {
  if (autoNodes.length === 0) return

  const autoMap = new Map<string, GraphNodeIR>()
  for (const n of autoNodes) {
    autoMap.set(n.id, n)
  }

  // Build adjacency among autoNodes based on allEdges
  const adj = new Map<string, Set<string>>()
  const inDegree = new Map<string, number>()
  for (const n of autoNodes) {
    adj.set(n.id, new Set())
    inDegree.set(n.id, 0)
  }

  for (const edge of allEdges) {
    const u = resolveDirectChildId(edge.fromId, containerPrefix, autoMap)
    const v = resolveDirectChildId(edge.toId, containerPrefix, autoMap)
    if (u && v && u !== v) {
      const neighbors = adj.get(u)!
      if (!neighbors.has(v)) {
        neighbors.add(v)
        inDegree.set(v, (inDegree.get(v) ?? 0) + 1)
      }
    }
  }

  // Assign topological ranks (longest-path layering with cycle breaking)
  const rank = new Map<string, number>()
  const visited = new Set<string>()
  const queue: string[] = []

  for (const n of autoNodes) {
    if ((inDegree.get(n.id) ?? 0) === 0) {
      queue.push(n.id)
      rank.set(n.id, 0)
    }
  }

  while (queue.length > 0) {
    const u = queue.shift()!
    visited.add(u)
    const r = rank.get(u) ?? 0
    for (const v of adj.get(u) ?? []) {
      const nextRank = Math.max(rank.get(v) ?? 0, r + 1)
      rank.set(v, nextRank)
      const deg = (inDegree.get(v) ?? 1) - 1
      inDegree.set(v, deg)
      if (deg === 0 && !visited.has(v)) {
        queue.push(v)
      }
    }
  }

  // Handle any remaining nodes in cycles
  for (const n of autoNodes) {
    if (!rank.has(n.id)) {
      let maxPredRank = -1
      for (const [u, neighbors] of adj.entries()) {
        if (neighbors.has(n.id) && rank.has(u)) {
          maxPredRank = Math.max(maxPredRank, rank.get(u)!)
        }
      }
      rank.set(n.id, maxPredRank + 1)
    }
  }

  // Group nodes by rank
  const layers = new Map<number, GraphNodeIR[]>()
  let maxRank = 0
  for (const n of autoNodes) {
    const r = rank.get(n.id) ?? 0
    maxRank = Math.max(maxRank, r)
    const list = layers.get(r) ?? []
    list.push(n)
    layers.set(r, list)
  }

  // Barycenter ordering within each layer to minimize edge crossings
  const orderInLayer = new Map<string, number>()
  for (let r = 0; r <= maxRank; r++) {
    const layer = layers.get(r) ?? []
    if (r > 0) {
      layer.sort((a, b) => {
        const predsA: number[] = []
        const predsB: number[] = []
        for (const [u, neighbors] of adj.entries()) {
          if (neighbors.has(a.id) && orderInLayer.has(u)) predsA.push(orderInLayer.get(u)!)
          if (neighbors.has(b.id) && orderInLayer.has(u)) predsB.push(orderInLayer.get(u)!)
        }
        const avgA =
          predsA.length > 0 ? predsA.reduce((s, v) => s + v, 0) / predsA.length : 999
        const avgB =
          predsB.length > 0 ? predsB.reduce((s, v) => s + v, 0) / predsB.length : 999
        return avgA - avgB
      })
    }
    layer.forEach((n, idx) => orderInLayer.set(n.id, idx))
  }

  const isHorizontal = config.direction === 'LR' || config.direction === 'RL'
  const isReversed = config.direction === 'RL' || config.direction === 'BT'

  // Compute primary axis thickness and secondary axis span for each layer
  const layerPrimarySize: number[] = []
  const layerSecondarySize: number[] = []
  let maxSecondarySpan = 0

  for (let r = 0; r <= maxRank; r++) {
    const layer = layers.get(r) ?? []
    if (layer.length === 0) {
      layerPrimarySize.push(0)
      layerSecondarySize.push(0)
      continue
    }
    if (isHorizontal) {
      const pSize = Math.max(...layer.map((n) => n.width))
      const sSize =
        layer.reduce((sum, n) => sum + n.height, 0) +
        Math.max(0, layer.length - 1) * config.gapY
      layerPrimarySize.push(pSize)
      layerSecondarySize.push(sSize)
      maxSecondarySpan = Math.max(maxSecondarySpan, sSize)
    } else {
      const pSize = Math.max(...layer.map((n) => n.height))
      const sSize =
        layer.reduce((sum, n) => sum + n.width, 0) +
        Math.max(0, layer.length - 1) * config.gapX
      layerPrimarySize.push(pSize)
      layerSecondarySize.push(sSize)
      maxSecondarySpan = Math.max(maxSecondarySpan, sSize)
    }
  }

  // Assign coordinates
  const orderedRanks: number[] = []
  for (let r = 0; r <= maxRank; r++) orderedRanks.push(r)
  if (isReversed) orderedRanks.reverse()

  let primaryCursor = primarySeed
  for (const r of orderedRanks) {
    const layer = layers.get(r) ?? []
    const pSize = layerPrimarySize[r]
    const sSize = layerSecondarySize[r]
    let secondaryCursor = (maxSecondarySpan - sSize) / 2

    for (const n of layer) {
      const extraDx = n.positionSpec.dx ?? 0
      const extraDy = n.positionSpec.dy ?? 0
      if (isHorizontal) {
        n.x = primaryCursor + (pSize - n.width) / 2 + extraDx
        n.y = secondaryCursor + extraDy
        secondaryCursor += n.height + config.gapY
      } else {
        n.x = secondaryCursor + extraDx
        n.y = primaryCursor + (pSize - n.height) / 2 + extraDy
        secondaryCursor += n.width + config.gapX
      }
    }

    primaryCursor += pSize + (isHorizontal ? config.gapX : config.gapY)
  }
}

/**
 * Bottom-up layout for a single container (either `<ag-graph>`, `<group>`, or a `<define>` composite).
 *
 * `titleOffsetY` reserves a band at the top of the content area for the container
 * title; all children are shifted down by it after positioning. `titleWidth`
 * keeps auto-width containers wide enough to fit their title.
 */
function layoutContainer(
  children: GraphNodeIR[],
  containerPrefix: string,
  config: ContainerConfig,
  allEdges: GraphEdgeIR[],
  globalNodeMap: Map<string, GraphNodeIR>,
  intrinsicWidth: number,
  intrinsicHeight: number,
  titleOffsetY = 0,
  titleWidth = 0,
): { width: number; height: number } {
  // 1. Recursively layout any child containers first (Bottom-Up)
  for (const child of children) {
    if (child.isContainer && child.children.length > 0) {
      const childTitleOffsetY =
        child.titleHeight > 0 ? child.titleHeight + TITLE_CONTENT_GAP : 0
      const childSize = layoutContainer(
        child.children,
        child.id,
        child.containerConfig,
        allEdges,
        globalNodeMap,
        child.intrinsicWidth,
        child.intrinsicHeight,
        childTitleOffsetY,
        child.titleWidth,
      )
      child.width = child.containerConfig.explicitWidth ?? childSize.width
      child.height = child.containerConfig.explicitHeight ?? childSize.height
    } else {
      child.width =
        child.containerConfig.explicitWidth ?? Math.max(child.intrinsicWidth, 40)
      child.height =
        child.containerConfig.explicitHeight ?? Math.max(child.intrinsicHeight, 28)
    }
  }

  // 2. Partition children by positioning mode
  const autoNodes = children.filter((c) => c.positionSpec.mode === 'auto')
  const absNodes = children.filter((c) => c.positionSpec.mode === 'absolute')
  const relNodes = children.filter((c) => c.positionSpec.mode === 'relative')
  const parentAnchorNodes = children.filter(
    (c) => c.positionSpec.mode === 'parent-anchor',
  )

  // 3. Layout auto nodes. Explicitly positioned ABSOLUTE siblings extend the
  // flow origin so auto nodes continue after them instead of collapsing onto
  // the content origin and overlapping them. (Relative siblings are excluded:
  // they are already chained to their targets, and seeding from them would
  // push unrelated auto nodes far away.)
  const isHorizontalFlow = config.direction === 'LR' || config.direction === 'RL'
  let primarySeed = 0
  if (autoNodes.length > 0 && absNodes.length > 0) {
    if (isHorizontalFlow) {
      primarySeed = Math.max(0, ...absNodes.map((n) => n.x + n.width)) + config.gapX
    } else {
      primarySeed = Math.max(0, ...absNodes.map((n) => n.y + n.height)) + config.gapY
    }
  }
  layoutAutoNodes(autoNodes, containerPrefix, allEdges, config, primarySeed)

  // 4. Layout absolute nodes
  for (const n of absNodes) {
    n.x = (n.positionSpec.x ?? 0) + (n.positionSpec.dx ?? 0)
    n.y = (n.positionSpec.y ?? 0) + (n.positionSpec.dy ?? 0)
  }

  // 5. Layout relative (target + anchor) nodes in dependency order
  const placed = new Set<string>([
    ...autoNodes.map((n) => n.id),
    ...absNodes.map((n) => n.id),
  ])

  const childMap = new Map<string, GraphNodeIR>()
  for (const c of children) childMap.set(c.id, c)

  /**
   * Computes a target node's bounding box in the current container's local content coordinate space.
   * Supports referencing a direct sibling ("a") or a nested node inside a placed sibling ("w1.proc").
   */
  function getTargetBoxInContainer(targetId: string): Box | undefined {
    const direct = childMap.get(targetId)
    if (direct) {
      return { x: direct.x, y: direct.y, width: direct.width, height: direct.height }
    }
    const targetNode = globalNodeMap.get(targetId)
    if (!targetNode) return undefined

    // Walk up from targetNode to its ancestor that is a direct child of current container
    let curr: GraphNodeIR | undefined = targetNode
    let offsetX = 0
    let offsetY = 0
    while (curr && !childMap.has(curr.id)) {
      offsetX += curr.x
      offsetY += curr.y
      const parentNode: GraphNodeIR | undefined = curr.parentId
        ? globalNodeMap.get(curr.parentId)
        : undefined
      if (parentNode) {
        offsetX += parentNode.containerConfig.paddingX
        offsetY += parentNode.containerConfig.paddingY
      }
      curr = parentNode
    }
    if (curr && childMap.has(curr.id)) {
      return {
        x: curr.x + offsetX,
        y: curr.y + offsetY,
        width: targetNode.width,
        height: targetNode.height,
      }
    }
    return undefined
  }

  let progress = true
  const remainingRel = [...relNodes]
  while (remainingRel.length > 0 && progress) {
    progress = false
    for (let i = remainingRel.length - 1; i >= 0; i--) {
      const node = remainingRel[i]
      const targetId = node.positionSpec.targetId!
      const topSiblingId = resolveDirectChildId(targetId, containerPrefix, childMap)
      if (!topSiblingId || placed.has(topSiblingId)) {
        const targetBox = getTargetBoxInContainer(targetId)
        if (targetBox) {
          const targetAnchor = node.positionSpec.targetAnchor ?? 'center'
          const selfAnchor = node.positionSpec.selfAnchor ?? 'center'
          const targetPt = getBoxAnchorPoint(targetBox, targetAnchor)
          const signs = getAnchorDirectionSigns(targetAnchor)
          const resolvedDx =
            node.positionSpec.dx !== undefined
              ? node.positionSpec.dx
              : signs.signX * config.gapX
          const resolvedDy =
            node.positionSpec.dy !== undefined
              ? node.positionSpec.dy
              : signs.signY * config.gapY

          const desiredAnchorPt = {
            x: targetPt.x + resolvedDx,
            y: targetPt.y + resolvedDy,
          }
          const topLeft = getTopLeftFromAnchorPoint(
            desiredAnchorPt,
            node.width,
            node.height,
            selfAnchor,
          )
          node.x = topLeft.x
          node.y = topLeft.y
        }
        placed.add(node.id)
        remainingRel.splice(i, 1)
        progress = true
      }
    }
  }

  // Fallback for any cyclic relative nodes
  for (const node of remainingRel) {
    const targetBox = getTargetBoxInContainer(node.positionSpec.targetId!) ?? {
      x: 0,
      y: 0,
      width: 100,
      height: 50,
    }
    const targetAnchor = node.positionSpec.targetAnchor ?? 'center'
    const selfAnchor = node.positionSpec.selfAnchor ?? 'center'
    const targetPt = getBoxAnchorPoint(targetBox, targetAnchor)
    const signs = getAnchorDirectionSigns(targetAnchor)
    const resolvedDx =
      node.positionSpec.dx !== undefined
        ? node.positionSpec.dx
        : signs.signX * config.gapX
    const resolvedDy =
      node.positionSpec.dy !== undefined
        ? node.positionSpec.dy
        : signs.signY * config.gapY
    const topLeft = getTopLeftFromAnchorPoint(
      { x: targetPt.x + resolvedDx, y: targetPt.y + resolvedDy },
      node.width,
      node.height,
      selfAnchor,
    )
    node.x = topLeft.x
    node.y = topLeft.y
  }

  // 6. Normalize coordinates of non-parent-anchor nodes so minimum (x, y) starts at >= 0
  const nonParentNodes = children.filter((c) => c.positionSpec.mode !== 'parent-anchor')
  let minX = 0
  let minY = 0
  let maxX = Math.max(0, intrinsicWidth - config.paddingX * 2)
  let maxY = Math.max(0, intrinsicHeight - config.paddingY * 2)

  if (nonParentNodes.length > 0) {
    minX = Math.min(...nonParentNodes.map((n) => n.x))
    minY = Math.min(...nonParentNodes.map((n) => n.y))
    // Only shift negative coordinates (unless absolute positive coords were specified)
    const shiftX = minX < 0 ? -minX : 0
    const shiftY = minY < 0 ? -minY : 0
    if (shiftX !== 0 || shiftY !== 0) {
      for (const n of nonParentNodes) {
        n.x += shiftX
        n.y += shiftY
      }
    }
    maxX = Math.max(maxX, ...nonParentNodes.map((n) => n.x + n.width))
    maxY = Math.max(maxY, ...nonParentNodes.map((n) => n.y + n.height))
  }

  // Ensure content area is large enough for parent-anchor nodes as well
  for (const pn of parentAnchorNodes) {
    maxX = Math.max(maxX, pn.width)
    maxY = Math.max(maxY, pn.height)
  }

  // Determine content box width & height (the title band eats into the
  // explicit-height budget, since it sits at the top of the content area)
  const contentWidth =
    config.explicitWidth !== undefined
      ? Math.max(0, config.explicitWidth - config.paddingX * 2)
      : maxX
  const contentHeight =
    config.explicitHeight !== undefined
      ? Math.max(0, config.explicitHeight - config.paddingY * 2 - titleOffsetY)
      : maxY

  // 7. Place parent-anchor nodes (only `anchor` specified without `target` -> relative to parent container)
  if (parentAnchorNodes.length > 0) {
    const parentContentBox: Box = {
      x: 0,
      y: 0,
      width: contentWidth,
      height: contentHeight,
    }
    for (const node of parentAnchorNodes) {
      const anchor = node.positionSpec.selfAnchor ?? 'center'
      const targetPt = getBoxAnchorPoint(parentContentBox, anchor)
      const dx = node.positionSpec.dx ?? 0
      const dy = node.positionSpec.dy ?? 0
      const topLeft = getTopLeftFromAnchorPoint(
        { x: targetPt.x + dx, y: targetPt.y + dy },
        node.width,
        node.height,
        anchor,
      )
      node.x = topLeft.x
      node.y = topLeft.y
    }

    // Re-normalize if any parent-anchor node went outside [0, contentWidth/Height]
    const allMinX = Math.min(0, ...children.map((n) => n.x))
    const allMinY = Math.min(0, ...children.map((n) => n.y))
    if (allMinX < 0 || allMinY < 0) {
      for (const n of children) {
        n.x -= allMinX
        n.y -= allMinY
      }
    }
  }

  // 8. Account for the title band: child coordinates stay in content space
  // (computeAbsoluteCoordinates already offsets them below the title); only the
  // total-size bookkeeping adds the band back in.
  const contentExtentX =
    children.length > 0 ? Math.max(...children.map((n) => n.x + n.width)) : 0
  const contentExtentY =
    children.length > 0 ? Math.max(...children.map((n) => n.y + n.height)) : 0

  const finalMaxX = Math.max(contentWidth, contentExtentX, titleWidth)
  const finalMaxY = Math.max(
    contentHeight + titleOffsetY,
    titleOffsetY,
    contentExtentY + titleOffsetY,
  )

  // Warn when an explicit container size cannot hold its laid-out content
  // (previously children just overflowed silently)
  if (config.explicitWidth !== undefined && finalMaxX > contentWidth + 0.5) {
    console.error(
      `[autograph] Container "${containerPrefix || '<root>'}" is too narrow: ` +
        `explicit width ${config.explicitWidth}px (content area ${contentWidth}px) ` +
        `but content needs ${Math.ceil(finalMaxX)}px. Children overflow.`,
    )
  }
  if (config.explicitHeight !== undefined) {
    const availableHeight = config.explicitHeight - config.paddingY * 2
    if (finalMaxY > availableHeight + 0.5) {
      console.error(
        `[autograph] Container "${containerPrefix || '<root>'}" is too short: ` +
          `explicit height ${config.explicitHeight}px (content area ${availableHeight}px) ` +
          `but content needs ${Math.ceil(finalMaxY)}px. Children overflow.`,
      )
    }
  }

  const totalWidth =
    config.explicitWidth ?? Math.ceil(finalMaxX + config.paddingX * 2)
  const totalHeight =
    config.explicitHeight ?? Math.ceil(finalMaxY + config.paddingY * 2)

  return { width: totalWidth, height: totalHeight }
}

/**
 * Computes root-canvas absolute coordinates (absX, absY) for all nodes recursively.
 */
function computeAbsoluteCoordinates(
  children: GraphNodeIR[],
  originX: number,
  originY: number,
): void {
  for (const node of children) {
    node.absX = originX + node.x
    node.absY = originY + node.y
    if (node.isContainer && node.children.length > 0) {
      const childTitleOffsetY =
        node.titleHeight > 0 ? node.titleHeight + TITLE_CONTENT_GAP : 0
      computeAbsoluteCoordinates(
        node.children,
        node.absX + node.containerConfig.paddingX,
        node.absY + node.containerConfig.paddingY + childTitleOffsetY,
      )
    }
  }
}

export function runLayoutEngine(graph: GraphIR): void {
  const rootTitleOffsetY = graph.titleHeight > 0 ? graph.titleHeight + TITLE_CONTENT_GAP : 0
  const rootSize = layoutContainer(
    graph.nodes,
    '',
    graph.config,
    graph.allEdges,
    graph.nodeMap,
    0,
    0,
    rootTitleOffsetY,
    graph.titleWidth,
  )
  graph.width = rootSize.width
  graph.height = rootSize.height

  computeAbsoluteCoordinates(
    graph.nodes,
    graph.config.paddingX,
    graph.config.paddingY + rootTitleOffsetY,
  )
}
