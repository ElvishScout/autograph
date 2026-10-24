<script lang="ts">
  const demo1Code = `<ag-graph direction="LR" gap-x="64" gap-y="44" padding="28" title="API 请求处理链路">
  <!-- 全自动拓扑节点 -->
  <node id="start">用户请求</node>
  <node id="auth">身份鉴权</node>
  <node id="gateway">API 网关</node>

  <!-- 半自动 1：在 auth 的右上方（未指定 dx/dy，自动按方向与 gap 推算） -->
  <node id="cache" target="auth:top-right" class="tag-amber">Redis 缓存</node>

  <!-- 半自动 2：只写 target="auth" + anchor="top" -> 自动反推 target 为 auth:bottom！ -->
  <node id="audit" target="auth" anchor="top" class="tag-slate">审计日志</node>

  <!-- 半自动 + 精确混合：在 gateway 右侧（X 半自动留 gap），但 Y 向下精确偏移 14px -->
  <node id="dispatch" target="gateway:right" dy="14" class="tag-blue">核心调度器</node>

  <!-- 只写 anchor 不写 target -> 自动推断相对整个图右上角 -->
  <node id="monitor" anchor="top-right" class="tag-emerald">全局监控探针</node>

  <edge from="start" to="auth">HTTPS</edge>
  <edge from="auth" to="cache" line="dashed">读缓存</edge>
  <edge from="auth" to="audit" line="dotted">异步记录</edge>
  <edge from="auth" to="gateway">通过</edge>
  <edge from="gateway" to="dispatch">路由分发</edge>
  <edge from="dispatch:top" to="monitor:bottom" line="dashed">上报指标</edge>
</ag-graph>`

  const demo2Code = `<ag-graph direction="LR" gap="96" padding="32" title="跨节点绕障布线">
  <node id="a">起点节点 A</node>
  <node id="blocker" target="a:right">中间障碍物节点</node>
  <node id="b" target="blocker:right">终点节点 B</node>
  <node id="c" target="blocker:bottom">下方分支节点 C</node>

  <!-- 直连相隔节点，中间被 blocker 挡住，A* 自动绕行避障，且标签自动避开节点与平行线 -->
  <edge from="a" to="blocker">常规链路</edge>
  <edge from="blocker" to="b">继续执行</edge>
  <edge from="a:top" to="b:top" class="edge-blue">跨节点主干直达 (自动绕障)</edge>
  <edge from="a:bottom" to="b:bottom" line="dashed" class="edge-amber">备用降级通道 (自动绕障)</edge>
  <edge from="a:right" to="c:left">旁路分流</edge>
</ag-graph>`

  const demo3Code = `<ag-graph padding="28" gap-x="72" gap-y="48">
  <!-- 定义可复用组合模板 worker，title 为容器标题（自动预留顶部空间），内部含 <slot> 插槽 -->
  <define name="worker" title="默认服务" padding-x="20" padding-y="22" gap-x="48">
    <node id="in">输入队列</node>
    <node id="proc" target="in:right">
      <slot name="body">默认处理</slot>
    </node>
    <edge from="in" to="proc">消费</edge>
  </define>

  <node id="ingress" class="tag-blue">消息入口网关</node>

  <!-- 实例化组合 w1（本身也是一个容器节点） -->
  <worker id="w1" target="ingress:right" title="订单处理单元">
    <span slot="body"><b>订单校验</b> &amp; 落库</span>
  </worker>

  <!-- 实例化组合 w2，放在 w1 下方 -->
  <worker id="w2" target="w1:bottom" title="账单结算单元">
    <span slot="body"><b>资金清算</b> &amp; 通知</span>
  </worker>

  <node id="sink" target="w1:right" dy="60" class="tag-emerald">数据归档中心</node>

  <!-- 既支持连向组合内部节点 (w1.in / w1.proc)，也支持直接连向组合外框 (w2) -->
  <edge from="ingress" to="w1.in">分发订单</edge>
  <edge from="ingress:bottom" to="w2:left" line="dashed">触发整个结算组</edge>
  <edge from="w1.proc:bottom" to="w2.in:top">跨组内部穿透</edge>
  <edge from="w1.proc:right" to="sink:top">归档成功</edge>
  <edge from="w2.proc:right" to="sink:bottom">清算完成</edge>
</ag-graph>`
</script>

<main class="page">
  <header class="hero-header">
    <h1>AutoGraph — HTML Flow DSL</h1>
    <p>
      基于 Svelte 5 + 原生 Web Component (<code>&lt;ag-graph&gt;</code>) 的声明式流程图引擎：支持全自动/半自动/精确排版、双向 Anchor 推导、正交 A* 自动避障布线与
      <code>&lt;define&gt;</code> 组合复用
    </p>
  </header>

  <!-- 场景 1 -->
  <section class="demo-card">
    <div class="demo-info">
      <h2>1. 混合排版：全自动 + 半自动方向推导 + 精确偏移 + 父容器 Anchor</h2>
      <p>
        同时展示：无坐标全自动分层、<code>target="auth:top-right"</code> 半自动方向、<code>target="auth" anchor="top"</code> 双向反推、<code>target="gateway:right" dy="14"</code> 单轴半自动+单轴精确偏移，以及只写 <code>anchor="top-right"</code> 相对整个画布定位。
      </p>
    </div>

    <div class="demo-preview">
      <ag-graph direction="LR" gap-x="64" gap-y="44" padding="28" title="API 请求处理链路">
        <node id="start">用户请求</node>
        <node id="auth">身份鉴权</node>
        <node id="gateway">API 网关</node>

        <node id="cache" target="auth:top-right" class="tag-amber">Redis 缓存</node>
        <node id="audit" target="auth" anchor="top" class="tag-slate">审计日志</node>
        <node id="dispatch" target="gateway:right" dy="14" class="tag-blue">核心调度器</node>
        <node id="monitor" anchor="top-right" class="tag-emerald">全局监控探针</node>

        <edge from="start" to="auth">HTTPS</edge>
        <edge from="auth" to="cache" line="dashed">读缓存</edge>
        <edge from="auth" to="audit" line="dotted">异步记录</edge>
        <edge from="auth" to="gateway">通过</edge>
        <edge from="gateway" to="dispatch">路由分发</edge>
        <edge from="dispatch:top" to="monitor:bottom" line="dashed">上报指标</edge>
      </ag-graph>
    </div>

    <details class="code-box">
      <summary>查看 HTML DSL 源码</summary>
      <pre><code>{demo1Code}</code></pre>
    </details>
  </section>

  <!-- 场景 2 -->
  <section class="demo-card">
    <div class="demo-info">
      <h2>2. 正交 A* 自动布线 + 节点/平行线/标签自动避障</h2>
      <p>
        当起点与终点之间存在障碍物节点或多条跨节点连线时，路由器自动沿膨胀网格寻路绕开障碍物、错开同边端口，且标签自动挑选无遮挡的直线段放置。
      </p>
    </div>

    <div class="demo-preview">
      <ag-graph direction="LR" gap="96" padding="32" title="跨节点绕障布线">
        <node id="a">起点节点 A</node>
        <node id="blocker" target="a:right">中间障碍物节点</node>
        <node id="b" target="blocker:right">终点节点 B</node>
        <node id="c" target="blocker:bottom">下方分支节点 C</node>

        <edge from="a" to="blocker">常规链路</edge>
        <edge from="blocker" to="b">继续执行</edge>
        <edge from="a:top" to="b:top" class="edge-blue">跨节点主干直达 (自动绕障)</edge>
        <edge from="a:bottom" to="b:bottom" line="dashed" class="edge-amber">备用降级通道 (自动绕障)</edge>
        <edge from="a:right" to="c:left">旁路分流</edge>
      </ag-graph>
    </div>

    <details class="code-box">
      <summary>查看 HTML DSL 源码</summary>
      <pre><code>{demo2Code}</code></pre>
    </details>
  </section>

  <!-- 场景 3 -->
  <section class="demo-card">
    <div class="demo-info">
      <h2>3. <code>&lt;define&gt;</code> 组合定义、容器 <code>title</code>、<code>&lt;slot&gt;</code> 插槽与跨层级穿透连线</h2>
      <p>
        通过 <code>&lt;define name="worker"&gt;</code> 定义组合模板后，直接使用 <code>&lt;worker&gt;</code> 标签实例化；<code>title</code> 是容器属性，渲染在组合顶部标题带并自动为内容预留空间（无需再硬编 <code>y</code> 偏移）；连线既可连向组合整体（<code>to="w2:left"</code>），也可通过点号穿透连向内部子节点（<code>to="w1.in"</code>）。
      </p>
    </div>

    <div class="demo-preview">
      <ag-graph padding="28" gap-x="72" gap-y="48">
        <define name="worker" title="默认服务" padding-x="20" padding-y="22" gap-x="48">
          <node id="in">输入队列</node>
          <node id="proc" target="in:right">
            <slot name="body">默认处理</slot>
          </node>
          <edge from="in" to="proc">消费</edge>
        </define>

        <node id="ingress" class="tag-blue">消息入口网关</node>

        <worker id="w1" target="ingress:right" title="订单处理单元">
          <span slot="body"><b>订单校验</b> &amp; 落库</span>
        </worker>

        <worker id="w2" target="w1:bottom" title="账单结算单元">
          <span slot="body"><b>资金清算</b> &amp; 通知</span>
        </worker>

        <node id="sink" target="w1:right" dy="60" class="tag-emerald">数据归档中心</node>

        <edge from="ingress" to="w1.in">分发订单</edge>
        <edge from="ingress:bottom" to="w2:left" line="dashed">触发整个结算组</edge>
        <edge from="w1.proc:bottom" to="w2.in:top">跨组内部穿透</edge>
        <edge from="w1.proc:right" to="sink:top">归档成功</edge>
        <edge from="w2.proc:right" to="sink:bottom">清算完成</edge>
      </ag-graph>
    </div>

    <details class="code-box">
      <summary>查看 HTML DSL 源码</summary>
      <pre><code>{demo3Code}</code></pre>
    </details>
  </section>
</main>

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: 28px;
  }

  .hero-header {
    border-bottom: 1px solid #e2e8f0;
    padding-bottom: 18px;
  }

  .hero-header h1 {
    margin: 0 0 8px;
    font-size: 28px;
    font-weight: 700;
    color: #0f172a;
  }

  .hero-header p {
    margin: 0;
    font-size: 15px;
    color: #475569;
    line-height: 1.6;
  }

  .demo-card {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 22px 24px;
    box-shadow: 0 1px 3px rgba(15, 23, 42, 0.03);
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .demo-info h2 {
    margin: 0 0 6px;
    font-size: 18px;
    font-weight: 600;
    color: #0f172a;
  }

  .demo-info p {
    margin: 0;
    font-size: 14px;
    color: #475569;
    line-height: 1.55;
  }

  .demo-preview {
    overflow-x: auto;
    padding: 4px 0;
  }

  .code-box {
    border-top: 1px solid #f1f5f9;
    padding-top: 10px;
    font-size: 13px;
  }

  .code-box summary {
    cursor: pointer;
    color: #475569;
    font-weight: 500;
    user-select: none;
  }

  .code-box pre {
    margin: 10px 0 0;
    padding: 14px;
    background: #0f172a;
    color: #e2e8f0;
    border-radius: 8px;
    overflow-x: auto;
    font-size: 12.5px;
    line-height: 1.5;
  }

  /* Custom user classes directly styling Light DOM nodes & edges */
  :global(.tag-blue) {
    background: #eff6ff !important;
    border-color: #2563eb !important;
    color: #1d4ed8 !important;
  }

  :global(.tag-amber) {
    background: #fffbeb !important;
    border-color: #d97706 !important;
    color: #b45309 !important;
  }

  :global(.tag-emerald) {
    background: #ecfdf5 !important;
    border-color: #059669 !important;
    color: #047857 !important;
  }

  :global(.tag-slate) {
    background: #f8fafc !important;
    border-color: #64748b !important;
    color: #334155 !important;
  }

  :global(.edge-blue) {
    color: #2563eb !important;
  }

  :global(.edge-amber) {
    color: #d97706 !important;
  }

  :global(.ag-container-title) {
    font-size: 11px;
    font-weight: 600;
    color: #475569;
    background: #e2e8f0;
    padding: 2px 8px;
    border-radius: 4px;
  }
</style>
