import type { Box, GraphIR, Point } from '../types'

function boxesOverlapArea(a: Box, b: Box): number {
  const ox = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  const oy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  return ox * oy
}

function inflate(box: Box, pad: number): Box {
  return {
    x: box.x - pad,
    y: box.y - pad,
    width: box.width + pad * 2,
    height: box.height + pad * 2,
  }
}

function pointToSegmentDist(p: Point, a: Point, b: Point): number {
  const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2
  if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2),
  )
  const projX = a.x + t * (b.x - a.x)
  const projY = a.y + t * (b.y - a.y)
  return Math.hypot(p.x - projX, p.y - projY)
}

/**
 * Automatically places edge labels along their routed paths while avoiding
 * overlapping nodes, previously placed labels, and other edges.
 */
export function placeAllEdgeLabels(graph: GraphIR): void {
  const nodeBoxes: Box[] = []
  for (const node of graph.nodeMap.values()) {
    if (!node.isContainer) {
      nodeBoxes.push({
        x: node.absX,
        y: node.absY,
        width: node.width,
        height: node.height,
      })
    } else {
      if (node.overlayWidth > 0 && node.overlayHeight > 0) {
        nodeBoxes.push({
          x: node.absX + node.containerConfig.paddingX,
          y: node.absY + node.containerConfig.paddingY,
          width: node.overlayWidth,
          height: node.overlayHeight,
        })
      }
      if (node.titleWidth > 0 && node.titleHeight > 0) {
        nodeBoxes.push({
          x: node.absX + node.containerConfig.paddingX,
          y: node.absY + node.containerConfig.paddingY,
          width: node.titleWidth,
          height: node.titleHeight,
        })
      }
    }
  }

  const placedLabelBoxes: Box[] = []

  for (const edge of graph.allEdges) {
    if (!edge.labelHtml || edge.points.length < 2) continue

    const lw = Math.max(edge.labelWidth || 48, 24)
    const lh = Math.max(edge.labelHeight || 22, 16)

    // Generate candidate center positions along segments of edge.points
    const candidates: Array<{ pt: Point; baseScore: number }> = []
    let totalLen = 0
    const segLens: number[] = []
    for (let i = 0; i < edge.points.length - 1; i++) {
      const len = Math.hypot(
        edge.points[i + 1].x - edge.points[i].x,
        edge.points[i + 1].y - edge.points[i].y,
      )
      segLens.push(len)
      totalLen += len
    }

    let accumLen = 0
    for (let i = 0; i < edge.points.length - 1; i++) {
      const p1 = edge.points[i]
      const p2 = edge.points[i + 1]
      const len = segLens[i]
      if (len < 14) {
        accumLen += len
        continue
      }

      // Ensure the label's span along the segment fits within the segment [p1, p2]
      const isHoriz = Math.abs(p1.y - p2.y) < 0.5
      const spanNeeded = isHoriz ? lw : lh
      const halfRatio = Math.min(0.45, (spanNeeded / 2 + 2) / len)
      const ratios =
        halfRatio >= 0.45
          ? // Label is wider than the segment: it cannot fully sit on the wire.
            // Try asymmetric positions so the pill can slide past a source/target
            // node hugging the segment start/end instead of clipping its corner.
            [0.5, 0.6, 0.4, 0.68, 0.32, 0.76, 0.24]
          : [0.5, 0.42, 0.58, 0.35, 0.65].filter(
              (r) => r >= halfRatio && r <= 1 - halfRatio,
            )
      if (ratios.length === 0) ratios.push(0.5)

      for (const t of ratios) {
        const cx = p1.x + (p2.x - p1.x) * t
        const cy = p1.y + (p2.y - p1.y) * t
        const distFromPathMid = Math.abs(accumLen + len * t - totalLen / 2)
        const distFromSegMid = Math.abs(t - 0.5) * len

        // Strongly prefer the center of long segments (`t = 0.5`)
        const baseScore =
          distFromPathMid * 0.1 + distFromSegMid * 2.5 - Math.min(len, 180) * 0.6

        // 1. Directly on segment centerline (clean pill on wire)
        candidates.push({ pt: { x: cx, y: cy }, baseScore })

        // 2. Slightly offset perpendicular to segment
        if (isHoriz) {
          candidates.push({
            pt: { x: cx, y: cy - lh / 2 - 4 },
            baseScore: baseScore + 45,
          })
          candidates.push({
            pt: { x: cx, y: cy + lh / 2 + 4 },
            baseScore: baseScore + 45,
          })
        } else {
          candidates.push({
            pt: { x: cx + lw / 2 + 4, y: cy },
            baseScore: baseScore + 45,
          })
          candidates.push({
            pt: { x: cx - lw / 2 - 4, y: cy },
            baseScore: baseScore + 45,
          })
        }
      }
      accumLen += len
    }

    if (candidates.length === 0) {
      const p0 = edge.points[0]
      const pLast = edge.points[edge.points.length - 1]
      edge.labelX = (p0.x + pLast.x) / 2
      edge.labelY = (p0.y + pLast.y) / 2
      continue
    }

    let bestPt = candidates[0].pt
    let bestCost = Infinity

    for (const cand of candidates) {
      const box: Box = {
        x: cand.pt.x - lw / 2,
        y: cand.pt.y - lh / 2,
        width: lw,
        height: lh,
      }

      let cost = cand.baseScore

      // Prefer staying inside the canvas top/left boundary: unlike the
      // right/bottom edges, the canvas cannot grow in these directions.
      const outLeft = 4 - (cand.pt.x - lw / 2)
      const outTop = 4 - (cand.pt.y - lh / 2)
      if (outLeft > 0) cost += 3000 + outLeft * 50
      if (outTop > 0) cost += 3000 + outTop * 50

      // High penalty for overlapping any node (hard overlap + soft 4px margin)
      for (const nb of nodeBoxes) {
        const hardArea = boxesOverlapArea(box, nb)
        if (hardArea > 0) {
          cost += 20000 + hardArea * 50
        } else {
          const softArea = boxesOverlapArea(box, inflate(nb, 4))
          if (softArea > 0) {
            cost += 300 + softArea * 5
          }
        }
      }

      // Penalty for overlapping any already placed label
      for (const lb of placedLabelBoxes) {
        const area = boxesOverlapArea(inflate(box, 4), lb)
        if (area > 0) {
          cost += 6000 + area * 15
        }
      }

      // Penalty for crossing other edges' segments (skip segments that share an endpoint with this edge)
      const myStart = edge.points[0]
      const myEnd = edge.points[edge.points.length - 1]
      for (const otherEdge of graph.allEdges) {
        if (otherEdge.id === edge.id) continue
        for (let i = 0; i < otherEdge.points.length - 1; i++) {
          const op1 = otherEdge.points[i]
          const op2 = otherEdge.points[i + 1]
          const sharesEndpoint =
            Math.hypot(op1.x - myStart.x, op1.y - myStart.y) < 1 ||
            Math.hypot(op1.x - myEnd.x, op1.y - myEnd.y) < 1 ||
            Math.hypot(op2.x - myStart.x, op2.y - myStart.y) < 1 ||
            Math.hypot(op2.x - myEnd.x, op2.y - myEnd.y) < 1
          if (sharesEndpoint) continue

          const d = pointToSegmentDist(cand.pt, op1, op2)
          if (d < Math.min(lw, lh) / 2 + 2) {
            cost += 500
          }
        }
      }

      if (cost < bestCost) {
        bestCost = cost
        bestPt = cand.pt
      }
    }

    edge.labelX = bestPt.x
    edge.labelY = bestPt.y
    placedLabelBoxes.push(
      inflate(
        {
          x: bestPt.x - lw / 2,
          y: bestPt.y - lh / 2,
          width: lw,
          height: lh,
        },
        4,
      ),
    )
  }
}
