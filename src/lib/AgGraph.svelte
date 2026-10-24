<svelte:options
  customElement={{
    tag: 'ag-graph',
    shadow: 'none',
  }}
/>

<script lang="ts">
  import { onMount, tick } from 'svelte'
  import type { GraphEdgeIR, GraphIR, GraphNodeIR } from './types'
  import { parseGraphDSL } from './parser/dsl-parser'
  import { runLayoutEngine } from './layout/layout-engine'
  import { routeAllEdges } from './router/astar-router'
  import { placeAllEdgeLabels } from './router/label-placer'

  let rootWrapEl: HTMLElement | undefined = $state()
  let dslSourceContainerEl: HTMLElement | undefined = $state()

  // Keep `rawGraph` as a plain, non-proxied JS object so Map references and array references stay 100% identical!
  let rawGraph: GraphIR | null = null

  let hasGraph = $state(false)
  let canvasWidth = $state(0)
  let canvasHeight = $state(0)
  let rootPaddingX = $state(24)
  let rootPaddingY = $state(24)
  let rootOverlayHtml = $state('')
  let flatNodes: GraphNodeIR[] = $state.raw([])
  let flatEdges: GraphEdgeIR[] = $state.raw([])
  let layoutReady = $state(false)

  const nodeMeasureEls = new Map<string, HTMLElement>()
  const labelMeasureEls = new Map<string, HTMLElement>()
  let resizeObserver: ResizeObserver | null = null
  let rafId: number | null = null

  function scheduleRelayout() {
    if (rafId !== null) return
    rafId = requestAnimationFrame(() => {
      rafId = null
      performMeasureAndLayout()
    })
  }

  function measureAction(el: HTMLElement, key: { type: 'node' | 'label'; id: string }) {
    if (key.type === 'node') {
      nodeMeasureEls.set(key.id, el)
    } else {
      labelMeasureEls.set(key.id, el)
    }
    resizeObserver?.observe(el)

    return {
      destroy() {
        resizeObserver?.unobserve(el)
        if (key.type === 'node') {
          nodeMeasureEls.delete(key.id)
        } else {
          labelMeasureEls.delete(key.id)
        }
      },
    }
  }

  function collectNodesDepthFirst(nodes: GraphNodeIR[], out: GraphNodeIR[] = []): GraphNodeIR[] {
    for (const n of nodes) {
      out.push(n)
      if (n.children.length > 0) {
        collectNodesDepthFirst(n.children, out)
      }
    }
    return out
  }

  function performMeasureAndLayout() {
    if (!rawGraph) return

    let sizeChanged = !layoutReady

    // Measure intrinsic DOM sizes of nodes, container overlays, and edge labels
    for (const node of rawGraph.nodeMap.values()) {
      const el = nodeMeasureEls.get(node.id)
      if (el) {
        const w = Math.ceil(
          Math.max(el.scrollWidth, el.offsetWidth, el.getBoundingClientRect().width),
        )
        const h = Math.ceil(
          Math.max(el.scrollHeight, el.offsetHeight, el.getBoundingClientRect().height),
        )
        if (node.isContainer) {
          const minW = w > 0 ? w + node.containerConfig.paddingX * 2 : 0
          const minH = h > 0 ? h + node.containerConfig.paddingY * 2 : 0
          if (
            node.intrinsicWidth !== minW ||
            node.intrinsicHeight !== minH ||
            node.overlayWidth !== w ||
            node.overlayHeight !== h
          ) {
            node.intrinsicWidth = minW
            node.intrinsicHeight = minH
            node.overlayWidth = w
            node.overlayHeight = h
            sizeChanged = true
          }
        } else {
          const finalW = Math.max(w, 32)
          const finalH = Math.max(h, 24)
          if (node.intrinsicWidth !== finalW || node.intrinsicHeight !== finalH) {
            node.intrinsicWidth = finalW
            node.intrinsicHeight = finalH
            sizeChanged = true
          }
        }
      }
    }

    for (const edge of rawGraph.allEdges) {
      if (edge.labelHtml) {
        const el = labelMeasureEls.get(edge.id)
        if (el) {
          const w = Math.ceil(
            Math.max(el.scrollWidth, el.offsetWidth, el.getBoundingClientRect().width, 24),
          )
          const h = Math.ceil(
            Math.max(el.scrollHeight, el.offsetHeight, el.getBoundingClientRect().height, 18),
          )
          if (edge.labelWidth !== w || edge.labelHeight !== h) {
            edge.labelWidth = w
            edge.labelHeight = h
            sizeChanged = true
          }
        }
      }
    }

    if (!sizeChanged && layoutReady) return

    // Run Layout -> A* Edge Router -> Label Obstacle Avoidance on the unified `rawGraph`
    runLayoutEngine(rawGraph)
    routeAllEdges(rawGraph)
    placeAllEdgeLabels(rawGraph)

    // Expand canvas if any routed edge or label goes near/beyond the right/bottom boundary
    let maxCanvasX = rawGraph.width
    let maxCanvasY = rawGraph.height
    for (const edge of rawGraph.allEdges) {
      for (const pt of edge.points) {
        maxCanvasX = Math.max(maxCanvasX, pt.x + rawGraph.config.paddingX)
        maxCanvasY = Math.max(maxCanvasY, pt.y + rawGraph.config.paddingY)
      }
      if (edge.labelHtml) {
        maxCanvasX = Math.max(
          maxCanvasX,
          edge.labelX + edge.labelWidth / 2 + rawGraph.config.paddingX,
        )
        maxCanvasY = Math.max(
          maxCanvasY,
          edge.labelY + edge.labelHeight / 2 + rawGraph.config.paddingY,
        )
      }
    }
    if (rawGraph.config.explicitWidth === undefined) {
      rawGraph.width = Math.ceil(maxCanvasX)
    }
    if (rawGraph.config.explicitHeight === undefined) {
      rawGraph.height = Math.ceil(maxCanvasY)
    }

    const updatedNodes = collectNodesDepthFirst(rawGraph.nodes)
    canvasWidth = rawGraph.width
    canvasHeight = rawGraph.height
    rootPaddingX = rawGraph.config.paddingX
    rootPaddingY = rawGraph.config.paddingY
    rootOverlayHtml = rawGraph.overlayHtml
    flatNodes = updatedNodes.map((n) => ({ ...n }))
    flatEdges = rawGraph.allEdges.map((e) => ({ ...e }))
    layoutReady = true
  }

  async function rebuildGraph() {
    if (!dslSourceContainerEl) return

    const ir = parseGraphDSL(dslSourceContainerEl)
    rawGraph = ir
    hasGraph = true
    rootPaddingX = ir.config.paddingX
    rootPaddingY = ir.config.paddingY
    rootOverlayHtml = ir.overlayHtml
    flatNodes = collectNodesDepthFirst(ir.nodes).map((n) => ({ ...n }))
    flatEdges = ir.allEdges.map((e) => ({ ...e }))
    layoutReady = false

    await tick()
    performMeasureAndLayout()
  }

  onMount(() => {
    if (!rootWrapEl || !dslSourceContainerEl) return

    const hostEl = rootWrapEl.parentElement
    if (!hostEl) return

    resizeObserver = new ResizeObserver(() => {
      if (layoutReady) {
        scheduleRelayout()
      }
    })

    // Copy host attributes (direction, gap, gap-x, gap-y, padding, padding-x, padding-y, width, height)
    const syncHostAttrs = () => {
      if (!dslSourceContainerEl) return
      for (const attr of Array.from(hostEl.attributes)) {
        if (attr.name !== 'class' && attr.name !== 'style' && attr.name !== 'id') {
          dslSourceContainerEl.setAttribute(attr.name, attr.value)
        }
      }
    }

    // Move initial user-authored DSL child nodes from <ag-graph> into hidden dslSourceContainerEl
    const moveUserNodesToSource = () => {
      if (!dslSourceContainerEl) return
      for (const node of Array.from(hostEl.childNodes)) {
        if (node === rootWrapEl) continue
        dslSourceContainerEl.appendChild(node)
      }
    }

    syncHostAttrs()
    moveUserNodesToSource()
    rebuildGraph()

    // Watch for dynamic mutations to DSL nodes or host attributes
    const observer = new MutationObserver((mutations) => {
      let shouldRebuild = false
      for (const m of mutations) {
        if (m.target === hostEl && m.type === 'attributes') {
          syncHostAttrs()
          shouldRebuild = true
        } else if (m.target === hostEl && m.type === 'childList') {
          let movedAny = false
          for (const added of Array.from(m.addedNodes)) {
            if (added !== rootWrapEl) {
              dslSourceContainerEl?.appendChild(added)
              movedAny = true
            }
          }
          if (movedAny) shouldRebuild = true
        } else if (dslSourceContainerEl?.contains(m.target)) {
          shouldRebuild = true
        }
      }
      if (shouldRebuild) {
        rebuildGraph()
      }
    })

    observer.observe(hostEl, {
      attributes: true,
      childList: true,
    })
    observer.observe(dslSourceContainerEl, {
      attributes: true,
      childList: true,
      subtree: true,
      characterData: true,
    })

    return () => {
      observer.disconnect()
      resizeObserver?.disconnect()
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  })
</script>

<div class="ag-root-wrap" bind:this={rootWrapEl}>
  <!-- Hidden container holding the original declarative HTML DSL tree -->
  <div
    class="ag-dsl-source"
    bind:this={dslSourceContainerEl}
    style="display: none !important;"
    aria-hidden="true"
  ></div>

  {#if hasGraph}
    <div
      class="ag-canvas"
      class:ag-ready={layoutReady}
      style={layoutReady ? `width: ${canvasWidth}px; height: ${canvasHeight}px;` : ''}
    >
      <!-- Root overlay HTML (starts at root content area (0, 0) i.e. paddingX, paddingY) -->
      {#if rootOverlayHtml}
        <div
          class="ag-root-overlay"
          style="left: {rootPaddingX}px; top: {rootPaddingY}px;"
        >
          {@html rootOverlayHtml}
        </div>
      {/if}

      <!-- Nodes & Containers Layer -->
      <div class="ag-nodes-layer">
        {#each flatNodes as node (node.id)}
          {#if node.isContainer}
            <div
              class="ag-container {node.className}"
              data-node-id={node.id}
              style="{layoutReady
                ? `left: ${node.absX}px; top: ${node.absY}px; width: ${node.width}px; height: ${node.height}px;`
                : ''}; {node.styleText}"
            >
              {#if node.htmlContent}
                <div
                  use:measureAction={{ type: 'node', id: node.id }}
                  class="ag-container-overlay"
                  style="left: {node.containerConfig.paddingX}px; top: {node.containerConfig.paddingY}px;"
                >
                  {@html node.htmlContent}
                </div>
              {/if}
            </div>
          {:else}
            <div
              class="ag-node {node.className}"
              data-node-id={node.id}
              style="{layoutReady
                ? `left: ${node.absX}px; top: ${node.absY}px; width: ${node.width}px; height: ${node.height}px;`
                : ''}; {node.styleText}"
            >
              <div
                use:measureAction={{ type: 'node', id: node.id }}
                class="ag-node-measure"
              >
                {@html node.htmlContent}
              </div>
            </div>
          {/if}
        {/each}
      </div>

      <!-- SVG Edges Layer -->
      <svg
        class="ag-edges-svg"
        width={canvasWidth}
        height={canvasHeight}
        viewBox="0 0 {canvasWidth} {canvasHeight}"
      >
        <defs>
          <marker
            id="ag-arrow"
            viewBox="0 0 10 10"
            refX="8.5"
            refY="5"
            markerWidth="6.5"
            markerHeight="6.5"
            orient="auto-start-reverse"
          >
            <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="currentColor" class="ag-arrow-path" />
          </marker>
        </defs>

        {#if layoutReady}
          {#each flatEdges as edge (edge.id)}
            {#if edge.svgPath}
              <g class="ag-edge-group {edge.className}" data-edge-id={edge.id}>
                <path
                  d={edge.svgPath}
                  class="ag-edge-halo"
                  fill="none"
                />
                <path
                  d={edge.svgPath}
                  class="ag-edge-path ag-line-{edge.line}"
                  style={edge.styleText}
                  fill="none"
                  marker-end="url(#ag-arrow)"
                />
              </g>
            {/if}
          {/each}
        {/if}
      </svg>

      <!-- Edge HTML Labels Layer -->
      <div class="ag-labels-layer">
        {#each flatEdges as edge (edge.id)}
          {#if edge.labelHtml}
            <div
              use:measureAction={{ type: 'label', id: edge.id }}
              class="ag-edge-label {edge.className}"
              data-edge-label={edge.id}
              style="{layoutReady
                ? `left: ${edge.labelX}px; top: ${edge.labelY}px; transform: translate(-50%, -50%);`
                : ''}; {edge.styleText}"
            >
              {@html edge.labelHtml}
            </div>
          {/if}
        {/each}
      </div>
    </div>
  {/if}
</div>
