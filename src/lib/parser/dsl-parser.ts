import type {
  ContainerConfig,
  Direction,
  GraphEdgeIR,
  GraphIR,
  GraphNodeIR,
  LineStyle,
  NodePositionSpec,
} from '../types'
import { isAnchorName, parseEndpointRef, resolveAnchorPair } from '../layout/anchor'

interface DefineTemplate {
  name: string
  defaultParams: Record<string, string>
  templateEl: Element
}

const RESERVED_NODE_ATTRS = new Set([
  'id',
  'direction',
  'gap',
  'gap-x',
  'gap-y',
  'padding',
  'padding-x',
  'padding-y',
  'width',
  'height',
  'x',
  'y',
  'target',
  'anchor',
  'dx',
  'dy',
  'class',
  'style',
  'slot',
])

function parseNumAttr(el: Element, name: string): number | undefined {
  const raw = el.getAttribute(name)
  if (raw === null || raw.trim() === '') return undefined
  const num = Number(raw)
  return Number.isFinite(num) ? num : undefined
}

function parseDirectionAttr(el: Element, fallback: Direction): Direction {
  const raw = el.getAttribute('direction')?.toUpperCase()
  if (raw === 'LR' || raw === 'TB' || raw === 'RL' || raw === 'BT') {
    return raw
  }
  return fallback
}

function parseContainerConfig(
  el: Element,
  parentDirection: Direction = 'LR',
  defaultPadding = 16,
): ContainerConfig {
  const direction = parseDirectionAttr(el, parentDirection)
  const gap = parseNumAttr(el, 'gap')
  const gapX = parseNumAttr(el, 'gap-x') ?? gap ?? 48
  const gapY = parseNumAttr(el, 'gap-y') ?? gap ?? 36

  const padding = parseNumAttr(el, 'padding')
  const paddingX = parseNumAttr(el, 'padding-x') ?? padding ?? defaultPadding
  const paddingY = parseNumAttr(el, 'padding-y') ?? padding ?? defaultPadding

  const explicitWidth = parseNumAttr(el, 'width')
  const explicitHeight = parseNumAttr(el, 'height')

  return {
    direction,
    gapX,
    gapY,
    paddingX,
    paddingY,
    explicitWidth,
    explicitHeight,
  }
}

function parsePositionSpec(el: Element): NodePositionSpec {
  const x = parseNumAttr(el, 'x')
  const y = parseNumAttr(el, 'y')
  const dx = parseNumAttr(el, 'dx')
  const dy = parseNumAttr(el, 'dy')
  const targetRaw = el.getAttribute('target')
  const anchorRaw = el.getAttribute('anchor')
  const explicitSelfAnchor = isAnchorName(anchorRaw) ? anchorRaw : undefined

  if (x !== undefined || y !== undefined) {
    return {
      mode: 'absolute',
      x: x ?? 0,
      y: y ?? 0,
      dx,
      dy,
    }
  }

  if (targetRaw && targetRaw.trim() !== '') {
    const parsedTarget = parseEndpointRef(targetRaw)
    const { targetAnchor, selfAnchor } = resolveAnchorPair(
      parsedTarget.anchor,
      explicitSelfAnchor,
    )
    return {
      mode: 'relative',
      targetId: parsedTarget.id,
      targetAnchor,
      selfAnchor,
      dx,
      dy,
    }
  }

  if (explicitSelfAnchor) {
    return {
      mode: 'parent-anchor',
      selfAnchor: explicitSelfAnchor,
      targetAnchor: explicitSelfAnchor,
      dx,
      dy,
    }
  }

  return {
    mode: 'auto',
    dx,
    dy,
  }
}

function interpolateParams(text: string, params: Record<string, string>): string {
  if (!text.includes('$')) return text
  // Sort keys longest-first so $title_sub is replaced before $title
  const keys = Object.keys(params).sort((a, b) => b.length - a.length)
  let out = text
  for (const key of keys) {
    const val = params[key]
    out = out.split(`$${key}`).join(val)
  }
  return out
}

function cloneAndExpandTemplate(
  templateEl: Element,
  instanceEl: Element,
  defaultParams: Record<string, string>,
): Element {
  const params: Record<string, string> = { ...defaultParams }
  for (const attr of Array.from(instanceEl.attributes)) {
    if (!RESERVED_NODE_ATTRS.has(attr.name.toLowerCase())) {
      params[attr.name] = attr.value
    }
  }

  // Collect slotted elements from instanceEl
  const slotMap = new Map<string, Node[]>()
  for (const child of Array.from(instanceEl.children)) {
    const slotName = child.getAttribute('slot')
    if (slotName) {
      const list = slotMap.get(slotName) ?? []
      const clonedChild = child.cloneNode(true) as Element
      clonedChild.removeAttribute('slot')
      list.push(clonedChild)
      slotMap.set(slotName, list)
    }
  }

  const clone = templateEl.cloneNode(true) as Element

  // 1. Replace <slot name="..."> in clone
  const slots = Array.from(clone.querySelectorAll('slot'))
  for (const slotEl of slots) {
    const name = slotEl.getAttribute('name') || 'default'
    const provided = slotMap.get(name)
    if (provided && provided.length > 0) {
      const frag = document.createDocumentFragment()
      for (const node of provided) {
        frag.appendChild(node.cloneNode(true))
      }
      slotEl.replaceWith(frag)
    } else {
      // Replace <slot> with its fallback children
      const frag = document.createDocumentFragment()
      while (slotEl.firstChild) {
        frag.appendChild(slotEl.firstChild)
      }
      slotEl.replaceWith(frag)
    }
  }

  // 2. Interpolate $param in all attributes and text nodes inside clone
  const walker = document.createTreeWalker(
    clone,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
  )
  let current: Node | null = walker.currentNode
  while (current) {
    if (current.nodeType === Node.ELEMENT_NODE) {
      const el = current as Element
      for (const attr of Array.from(el.attributes)) {
        if (attr.value.includes('$')) {
          el.setAttribute(attr.name, interpolateParams(attr.value, params))
        }
      }
    } else if (current.nodeType === Node.TEXT_NODE) {
      if (current.nodeValue && current.nodeValue.includes('$')) {
        current.nodeValue = interpolateParams(current.nodeValue, params)
      }
    }
    current = walker.nextNode()
  }

  return clone
}

function normalizeTagName(el: Element): string {
  const raw = el.tagName.toLowerCase()
  return raw.startsWith('ag-') ? raw.slice(3) : raw
}

function prefixLocalRef(rawRef: string, scopePrefix: string): string {
  if (!scopePrefix) return rawRef
  return `${scopePrefix}.${rawRef}`
}

export function parseGraphDSL(rootEl: Element): GraphIR {
  const defines = new Map<string, DefineTemplate>()
  const nodeMap = new Map<string, GraphNodeIR>()
  const allEdges: GraphEdgeIR[] = []
  let autoNodeSeq = 1
  let autoEdgeSeq = 1

  const rootConfig = parseContainerConfig(rootEl, 'LR', 24)

  // First pass at root: register all <define> blocks
  for (const child of Array.from(rootEl.children)) {
    const tag = normalizeTagName(child)
    if (tag === 'define') {
      const name = (child.getAttribute('name') || child.getAttribute('id') || '')
        .trim()
        .toLowerCase()
      if (name) {
        const defaultParams: Record<string, string> = {}
        for (const attr of Array.from(child.attributes)) {
          const attrName = attr.name.toLowerCase()
          if (attrName !== 'name' && attrName !== 'id') {
            defaultParams[attr.name] = attr.value
          }
        }
        defines.set(name, {
          name,
          defaultParams,
          templateEl: child,
        })
      }
    }
  }

  function parseContainerChildren(
    containerEl: Element,
    scopePrefix: string,
    parentDirection: Direction,
  ): {
    nodes: GraphNodeIR[]
    edges: GraphEdgeIR[]
    overlayHtml: string
  } {
    const nodes: GraphNodeIR[] = []
    const edges: GraphEdgeIR[] = []
    const overlayParts: string[] = []

    for (const childNode of Array.from(containerEl.childNodes)) {
      if (childNode.nodeType === Node.TEXT_NODE) {
        const text = childNode.textContent?.trim()
        if (text) {
          overlayParts.push(childNode.textContent!)
        }
        continue
      }

      if (childNode.nodeType !== Node.ELEMENT_NODE) continue
      const el = childNode as Element
      const tag = normalizeTagName(el)

      if (tag === 'define') {
        continue
      }

      if (tag === 'edge') {
        const rawFrom = el.getAttribute('from') || ''
        const rawTo = el.getAttribute('to') || ''
        const parsedFrom = parseEndpointRef(rawFrom)
        const parsedTo = parseEndpointRef(rawTo)
        if (!parsedFrom.id || !parsedTo.id) continue

        const lineAttr = el.getAttribute('line')?.toLowerCase()
        const line: LineStyle =
          lineAttr === 'dashed' || lineAttr === 'dotted' ? lineAttr : 'solid'

        const edgeIR: GraphEdgeIR = {
          id: el.getAttribute('id') || `edge_${autoEdgeSeq++}`,
          fromId: prefixLocalRef(parsedFrom.id, scopePrefix),
          fromAnchor: parsedFrom.anchor,
          toId: prefixLocalRef(parsedTo.id, scopePrefix),
          toAnchor: parsedTo.anchor,
          line,
          labelHtml: el.innerHTML.trim(),
          className: el.getAttribute('class') || '',
          styleText: el.getAttribute('style') || '',
          labelWidth: 0,
          labelHeight: 0,
          points: [],
          svgPath: '',
          labelX: 0,
          labelY: 0,
        }
        edges.push(edgeIR)
        allEdges.push(edgeIR)
        continue
      }

      const defineTpl = defines.get(tag)
      if (tag === 'node' || tag === 'group' || defineTpl) {
        const localId = el.getAttribute('id') || `node_${autoNodeSeq++}`
        const scopedId = prefixLocalRef(localId, scopePrefix)
        const posSpec = parsePositionSpec(el)
        if (posSpec.mode === 'relative' && posSpec.targetId) {
          posSpec.targetId = prefixLocalRef(posSpec.targetId, scopePrefix)
        }

        if (defineTpl) {
          // Composite instance created from <define>
          const expandedEl = cloneAndExpandTemplate(
            defineTpl.templateEl,
            el,
            defineTpl.defaultParams,
          )
          // Merge container config: instance attributes override define template attributes
          const tplConfig = parseContainerConfig(defineTpl.templateEl, parentDirection, 16)
          const instConfig = parseContainerConfig(el, tplConfig.direction, tplConfig.paddingX)
          const containerConfig: ContainerConfig = {
            direction: el.hasAttribute('direction') ? instConfig.direction : tplConfig.direction,
            gapX:
              el.hasAttribute('gap-x') || el.hasAttribute('gap')
                ? instConfig.gapX
                : tplConfig.gapX,
            gapY:
              el.hasAttribute('gap-y') || el.hasAttribute('gap')
                ? instConfig.gapY
                : tplConfig.gapY,
            paddingX:
              el.hasAttribute('padding-x') || el.hasAttribute('padding')
                ? instConfig.paddingX
                : tplConfig.paddingX,
            paddingY:
              el.hasAttribute('padding-y') || el.hasAttribute('padding')
                ? instConfig.paddingY
                : tplConfig.paddingY,
            explicitWidth: instConfig.explicitWidth ?? tplConfig.explicitWidth,
            explicitHeight: instConfig.explicitHeight ?? tplConfig.explicitHeight,
          }

          const inner = parseContainerChildren(
            expandedEl,
            scopedId,
            containerConfig.direction,
          )

          // Also collect non-slotted normal HTML children directly inside instanceEl if any
          for (const instChild of Array.from(el.children)) {
            if (!instChild.hasAttribute('slot')) {
              const instChildTag = normalizeTagName(instChild)
              if (
                instChildTag !== 'node' &&
                instChildTag !== 'group' &&
                instChildTag !== 'edge' &&
                !defines.has(instChildTag)
              ) {
                inner.overlayHtml += instChild.outerHTML
              }
            }
          }

          const nodeIR: GraphNodeIR = {
            id: scopedId,
            localId,
            parentId: scopePrefix || undefined,
            isContainer: true,
            containerConfig,
            positionSpec: posSpec,
            htmlContent: inner.overlayHtml,
            className: [
              defineTpl.templateEl.getAttribute('class') || '',
              el.getAttribute('class') || '',
            ]
              .filter(Boolean)
              .join(' '),
            styleText: [
              defineTpl.templateEl.getAttribute('style') || '',
              el.getAttribute('style') || '',
            ]
              .filter(Boolean)
              .join('; '),
            children: inner.nodes,
            edges: inner.edges,
            intrinsicWidth: 0,
            intrinsicHeight: 0,
            overlayWidth: 0,
            overlayHeight: 0,
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            absX: 0,
            absY: 0,
          }
          nodes.push(nodeIR)
          nodeMap.set(scopedId, nodeIR)
        } else if (tag === 'group') {
          const containerConfig = parseContainerConfig(el, parentDirection, 16)
          const inner = parseContainerChildren(el, scopedId, containerConfig.direction)
          const nodeIR: GraphNodeIR = {
            id: scopedId,
            localId,
            parentId: scopePrefix || undefined,
            isContainer: true,
            containerConfig,
            positionSpec: posSpec,
            htmlContent: inner.overlayHtml,
            className: el.getAttribute('class') || '',
            styleText: el.getAttribute('style') || '',
            children: inner.nodes,
            edges: inner.edges,
            intrinsicWidth: 0,
            intrinsicHeight: 0,
            overlayWidth: 0,
            overlayHeight: 0,
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            absX: 0,
            absY: 0,
          }
          nodes.push(nodeIR)
          nodeMap.set(scopedId, nodeIR)
        } else {
          // Regular <node> (can also contain nested <node> if someone uses <node> as a container, or pure HTML)
          const containerConfig = parseContainerConfig(el, parentDirection, 12)
          const hasGraphChildren = Array.from(el.children).some((c) => {
            const ct = normalizeTagName(c)
            return ct === 'node' || ct === 'group' || ct === 'edge' || defines.has(ct)
          })

          if (hasGraphChildren) {
            const inner = parseContainerChildren(el, scopedId, containerConfig.direction)
            const nodeIR: GraphNodeIR = {
              id: scopedId,
              localId,
              parentId: scopePrefix || undefined,
              isContainer: true,
              containerConfig,
              positionSpec: posSpec,
              htmlContent: inner.overlayHtml,
              className: el.getAttribute('class') || '',
              styleText: el.getAttribute('style') || '',
              children: inner.nodes,
              edges: inner.edges,
              intrinsicWidth: 0,
              intrinsicHeight: 0,
              overlayWidth: 0,
              overlayHeight: 0,
              x: 0,
              y: 0,
              width: 0,
              height: 0,
              absX: 0,
              absY: 0,
            }
            nodes.push(nodeIR)
            nodeMap.set(scopedId, nodeIR)
          } else {
            const nodeIR: GraphNodeIR = {
              id: scopedId,
              localId,
              parentId: scopePrefix || undefined,
              isContainer: false,
              containerConfig,
              positionSpec: posSpec,
              htmlContent: el.innerHTML,
              className: el.getAttribute('class') || '',
              styleText: el.getAttribute('style') || '',
              children: [],
              edges: [],
              intrinsicWidth: 0,
              intrinsicHeight: 0,
              overlayWidth: 0,
              overlayHeight: 0,
              x: 0,
              y: 0,
              width: 0,
              height: 0,
              absX: 0,
              absY: 0,
            }
            nodes.push(nodeIR)
            nodeMap.set(scopedId, nodeIR)
          }
        }
        continue
      }

      // Any other regular HTML element (e.g. <div>, <style>, <h3>) goes into overlayHtml
      overlayParts.push(el.outerHTML)
    }

    return {
      nodes,
      edges,
      overlayHtml: overlayParts.join(''),
    }
  }

  const rootParsed = parseContainerChildren(rootEl, '', rootConfig.direction)

  return {
    config: rootConfig,
    overlayHtml: rootParsed.overlayHtml,
    nodes: rootParsed.nodes,
    edges: rootParsed.edges,
    nodeMap,
    allEdges,
    width: rootConfig.explicitWidth ?? 0,
    height: rootConfig.explicitHeight ?? 0,
  }
}
