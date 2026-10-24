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
 */
function layoutAutoNodes(
  autoNodes: GraphNodeIR[],
  containerPrefix: string,
  allEdges: GraphEdgeIR[],
  config: ContainerConfig,
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

  let primaryCursor = 0
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
 */
function layoutContainer(
  children: GraphNodeIR[],
  containerPrefix: string,
  config: ContainerConfig,
  allEdges: GraphEdgeIR[],
  globalNodeMap: Map<string, GraphNodeIR>,
  intrinsicWidth: number,
  intrinsicHeight: number,
): { width: number; height: number } {
  // 1. Recursively layout any child containers first (Bottom-Up)
  for (const child of children) {
    if (child.isContainer && child.children.length > 0) {
      const childSize = layoutContainer(
        child.children,
        child.id,
        child.containerConfig,
        allEdges,
        globalNodeMap,
        child.intrinsicWidth,
        child.intrinsicHeight,
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

  // 3. Layout auto nodes
  layoutAutoNodes(autoNodes, containerPrefix, allEdges, config)

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

  // Determine content box width & height
  const contentWidth =
    config.explicitWidth !== undefined
      ? Math.max(0, config.explicitWidth - config.paddingX * 2)
      : maxX
  const contentHeight =
    config.explicitHeight !== undefined
      ? Math.max(0, config.explicitHeight - config.paddingY * 2)
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

  const finalMaxX =
    children.length > 0 ? Math.max(contentWidth, ...children.map((n) => n.x + n.width)) : contentWidth
  const finalMaxY =
    children.length > 0
      ? Math.max(contentHeight, ...children.map((n) => n.y + n.height))
      : contentHeight

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
      computeAbsoluteCoordinates(
        node.children,
        node.absX + node.containerConfig.paddingX,
        node.absY + node.containerConfig.paddingY,
      )
    }
  }
}

export function runLayoutEngine(graph: GraphIR): void {
  const rootSize = layoutContainer(
    graph.nodes,
    '',
    graph.config,
    graph.allEdges,
    graph.nodeMap,
    0,
    0,
  )
  graph.width = rootSize.width
  graph.height = rootSize.height

  computeAbsoluteCoordinates(
    graph.nodes,
    graph.config.paddingX,
    graph.config.paddingY,
  )
}
