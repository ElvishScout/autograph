# AutoGraph (`<ag-graph>`)

AutoGraph 是一个基于 **Svelte 5 + 原生 Web Component (`<ag-graph>`)** 构建的声明式 HTML 流程图与架构图引擎。它允许直接使用类 HTML 的语义化标签（`<node>`、`<group>`、`<edge>`、`<define>`）编写流程图，支持混合布局（全自动拓扑、相对锚点、绝对坐标）、`<define>` 组件化复用、双层缓冲区正交 A* 自动避障布线，并可编译为**零外部依赖的单文件 HTML**。

---

## 核心特性

- **原生 HTML 与 CSS 能力**：Web Component 采用 Light DOM（`shadow: 'none'`），节点内部支持任意 HTML 结构，外部 `<style>` 或全局 CSS 可直接作用于节点、分组与连线。
- **混合布局引擎（Hybrid Layout）**：
  - **全自动拓扑分层**：省略位置属性时，根据 `<edge>` 拓扑自动分层排列；
  - **半自动相对方向定位**：通过 `target="nodeA:right"` 自动按照容器 `gap-x` / `gap-y` 偏移并推断相对锚点；
  - **精确锚点对齐**：通过 `target` + `anchor` + `dx` / `dy` 实现任意两个锚点之间的像素级精确对齐；
  - **绝对坐标定位**：通过 `x`、`y` 直接指定容器内容区内的坐标。
- **`<define>` 组合复用与 `<slot>` 插槽**：支持定义带 `$param` 参数替换与 `<slot name="...">` 插槽的复合容器模板，并通过点号路径（如 `worker1.inbox:top`）支持跨层级穿透连线。
- **双层缓冲区正交 A* 路由**：
  - 90° 纯正交端口引出与圆角折线；
  - 节点与容器标题（Overlay HTML）周围内置硬障碍区与软缓冲区，连线垂直插入端口并自动在通道中心线穿行；
  - 连线胶囊标签自动沿路径搜寻无碰撞位置，避开节点、标题与其他连线。
- **单文件构建产物**：通过 `vite-plugin-singlefile` 一键打包出 `dist/index.html`（示例页）与 `dist/template.html`（仅含运行时与 `<!-- AUTOGRAPH_CONTENT -->` 占位符的单文件模板）。

---

## 快速开始

### 安装依赖与开发

```bash
# 安装依赖
npm install

# 启动本地开发预览
npm run dev

# 类型检查
npm run check

# 构建单文件产物 (dist/index.html 与 dist/template.html)
npm run build
```

---

## HTML DSL 语法规范

在 `<ag-graph>` 标签内直接编写声明式标签：

```html
<ag-graph direction="LR" gap-x="64" gap-y="40" padding="28">
  <node id="start">Client Request</node>
  <node id="auth" target="start:right">Auth &amp; Rate Limit</node>
  <node id="service" target="auth:right">Core Service</node>

  <edge from="start:right" to="auth:left">HTTPS</edge>
  <edge from="auth:right" to="service:left">Verified</edge>
</ag-graph>
```

### 1. 核心标签

| 标签 | 说明 |
| :--- | :--- |
| `<ag-graph>` | 流程图根画布 Web Component，支持容器级布局属性 |
| `<node id="...">` | 基础流程图节点，内容支持任意 HTML，默认根据 DOM 内容自适应宽高 |
| `<group id="...">` | 分组容器节点，自底向上（Bottom-Up）自动包裹内部子节点与内边距 |
| `<edge from="..." to="...">` | 有向正交连线，标签内的 HTML 内容会渲染为避障胶囊标签 |
| `<define name="...">` | 定义可复用的复合容器模板，定义后可直接使用 `<name id="...">` 实例化 |

---

### 2. 标准 9 锚点枚举

`center` | `top` | `bottom` | `left` | `right` | `top-left` | `top-right` | `bottom-left` | `bottom-right`

---

### 3. 容器属性（适用于 `<ag-graph>`、`<group>`、`<define>` 及其实例）

| 属性 | 类型 / 可选值 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `direction` | `"LR" \| "TB" \| "RL" \| "BT"` | `"LR"` | 自动拓扑流向（从左到右 / 从上到下 / 从右到左 / 从下到上） |
| `gap-x` | `number` | `48` | 水平方向默认节点间距（px） |
| `gap-y` | `number` | `36` | 垂直方向默认节点间距（px） |
| `gap` | `number` | — | 同时设置 `gap-x` 和 `gap-y` 的简写（优先级低于显式 `gap-x` / `gap-y`） |
| `padding-x` | `number` | `16`（根画布 `24`） | 容器左右内边距（px） |
| `padding-y` | `number` | `16`（根画布 `24`） | 容器上下内边距（px） |
| `padding` | `number` | — | 同时设置 `padding-x` 和 `padding-y` 的简写 |
| `width` / `height` | `number` | 自适应 | 显式指定容器宽高（px），省略时根据子节点包络盒自动计算 |

---

### 4. 节点定位属性（适用于 `<node>`、`<group>` 及复合实例）

所有定位属性完全正交，按需组合：

- **`x` / `y`**：相对于父容器内容区左上角 `(0, 0)` 的绝对坐标（px）。
- **`target="nodeId[:targetAnchor]"`**：相对定位的目标节点 ID 及可选目标锚点。
- **`anchor="selfAnchor"`**：自身用于对齐的锚点：
  - **双向反方向推断**：
    - 若指定 `target="a:right"` 且省略 `anchor`，自动推断自身 `anchor="left"`；
    - 若指定 `target="a"` 且指定 `anchor="top"`，自动推断目标为 `target="a:bottom"`。
  - **相对父容器定位**：
    - 若**仅指定 `anchor="top-right"` 而省略 `target`**，则将节点自身锚点对齐到父容器的 `top-right`。
- **`dx` / `dy`**：屏幕坐标系下的像素偏移（`+x` 向右，`-x` 向左，`+y` 向下，`-y` 向上）：
  - 在相对定位（指定了 `target`）中，若省略 `dx` / `dy`，默认取 `|dx| = gap-x`、`|dy| = gap-y`，正负号由目标锚点方位自动决定（例如 `target="a:bottom"` 默认 `dx = 0, dy = +gap-y`）。

---

### 5. 连线属性（`<edge>`）

- **`from="nodeId[:anchor]"`**：起点节点（或容器）ID 与可选出线锚点。
- **`to="nodeId[:anchor]"`**：终点节点（或容器）ID 与可选入线锚点。
- **`line="solid | dashed | dotted"`**：连线样式（默认 `"solid"`）。
- **作用域与点号穿透规则**：
  - 同一个 `<group>` 或 `<define>` 内部引用兄弟节点时，直接使用局部 ID（如 `from="inbox:bottom" to="exec:top"`）；
  - 跨容器或从根级 `<ag-graph>` 引用容器内部子节点时，使用点号限定路径（如 `from="gateway.guard:bottom" to="rag_agent.inbox:top"`）；
  - 也可以直接连向容器整体（如 `from="gateway:bottom" to="orchestrator:top"`）。

---

### 6. `<define>` 组合复用与 `<slot>` 插槽示例

`<define>` 上的非保留属性会作为模板默认参数，在内部文本或属性中通过 `$paramName` 替换；内部 `<slot name="...">` 会被实例传入的 `<... slot="...">` 替换：

```html
<ag-graph direction="LR" gap-x="80" padding="28">
  <define name="agent-pod" role="Agent" direction="TB" gap-y="24" padding="20">
    <div class="pod-badge">$role</div>
    <node id="inbox" y="34">Inbox Queue</node>
    <node id="exec" target="inbox:bottom">
      <slot name="desc">Default Execution</slot>
    </node>
    <edge from="inbox:bottom" to="exec:top"></edge>
  </define>

  <agent-pod id="rag" role="RAG Agent">
    <span slot="desc">Hybrid Search &amp; Rerank</span>
  </agent-pod>

  <agent-pod id="sql" role="SQL Agent" target="rag:right">
    <span slot="desc">NL2SQL &amp; Verification</span>
  </agent-pod>

  <edge from="rag.exec:right" to="sql.inbox:left">Handoff</edge>
</ag-graph>
```

---

## 目录结构

```text
src/
├── lib/
│   ├── AgGraph.svelte          # <ag-graph> Web Component 宿主、DOM 测量与渲染管线
│   ├── types.ts                # 核心 IR 数据结构与类型定义
│   ├── parser/
│   │   └── dsl-parser.ts       # HTML DSL 解析器、<define> 模板展开、$param 与 <slot> 替换
│   ├── layout/
│   │   ├── anchor.ts           # 9 锚点坐标计算、双向锚点推断与方向符号推导
│   │   └── layout-engine.ts    # 自底向上容器尺寸计算与混合布局求解器
│   └── router/
│       ├── astar-router.ts     # Hanan 网格正交 A* 路由器、端口分配与双层缓冲区避障
│       └── label-placer.ts     # 连线标签自动避障布局器
├── App.svelte                  # 开发预览与示例页
├── main.ts                     # 示例页入口 (打包至 dist/index.html)
├── template.ts                 # 纯运行时模板入口 (打包至 dist/template.html)
└── app.css                     # 默认样式变量与基础图层样式
```
