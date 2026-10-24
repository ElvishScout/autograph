export type AnchorName =
  | 'center'
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'

export type Direction = 'LR' | 'TB' | 'RL' | 'BT'

export type LineStyle = 'solid' | 'dashed' | 'dotted'

export interface Point {
  x: number
  y: number
}

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export interface ContainerConfig {
  direction: Direction
  gapX: number
  gapY: number
  paddingX: number
  paddingY: number
  explicitWidth?: number
  explicitHeight?: number
  /** Container title HTML rendered in a dedicated band above the content area */
  titleHtml?: string
}

export interface NodePositionSpec {
  mode: 'auto' | 'absolute' | 'relative' | 'parent-anchor'
  /** Explicit x (in absolute mode) */
  x?: number
  /** Explicit y (in absolute mode) */
  y?: number
  /** Target node ID (in relative mode) */
  targetId?: string
  /** Target anchor (explicit or inferred) */
  targetAnchor?: AnchorName
  /** Self anchor (explicit or inferred) */
  selfAnchor?: AnchorName
  /** Explicit dx (undefined if not specified in DSL) */
  dx?: number
  /** Explicit dy (undefined if not specified in DSL) */
  dy?: number
}

export interface GraphNodeIR {
  /** Scoped unique ID, e.g. "w1.proc" */
  id: string
  /** Local ID within parent container, e.g. "proc" */
  localId: string
  /** Parent container ID (undefined for root-level nodes) */
  parentId?: string
  /** Whether this node is a group / composite container */
  isContainer: boolean
  /** Container config (valid when isContainer is true) */
  containerConfig: ContainerConfig
  /** Positioning rules parsed from DSL */
  positionSpec: NodePositionSpec
  /** Raw overlay HTML inside this node or container */
  htmlContent: string
  /** Preserved class name from DSL element */
  className: string
  /** Preserved inline style from DSL element */
  styleText: string
  /** Child nodes (for group or instantiated <define> composite) */
  children: GraphNodeIR[]
  /** Internal edges declared inside this container */
  edges: GraphEdgeIR[]
  /** Measured intrinsic size of htmlContent (or explicit size) */
  intrinsicWidth: number
  intrinsicHeight: number
  /** Measured size of container overlay HTML (e.g. group/define badge) at (paddingX, paddingY) */
  overlayWidth: number
  overlayHeight: number
  /** Measured size of the container title band (0 when no title) */
  titleWidth: number
  titleHeight: number
  /** Computed local position relative to parent content area (0, 0) */
  x: number
  y: number
  /** Computed final size */
  width: number
  height: number
  /** Computed absolute position in root canvas coordinates */
  absX: number
  absY: number
}

export interface GraphEdgeIR {
  id: string
  fromId: string
  fromAnchor?: AnchorName
  toId: string
  toAnchor?: AnchorName
  line: LineStyle
  labelHtml: string
  className: string
  styleText: string
  /** Measured label dimensions */
  labelWidth: number
  labelHeight: number
  /** Computed route points in root canvas coordinates */
  points: Point[]
  /** SVG path string (with rounded orthogonal corners) */
  svgPath: string
  /** Computed label center position in root canvas coordinates */
  labelX: number
  labelY: number
}

export interface GraphIR {
  config: ContainerConfig
  /** Root level overlay HTML (non-DSL elements directly inside <ag-graph>) */
  overlayHtml: string
  /** Measured size of the root canvas title band (0 when no title) */
  titleWidth: number
  titleHeight: number
  nodes: GraphNodeIR[]
  edges: GraphEdgeIR[]
  /** Flat map of all nodes by scoped ID */
  nodeMap: Map<string, GraphNodeIR>
  /** All edges flattened across all levels */
  allEdges: GraphEdgeIR[]
  /** Computed total canvas dimensions */
  width: number
  height: number
}
