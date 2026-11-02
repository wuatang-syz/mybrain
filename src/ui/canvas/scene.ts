import type { GraphEdge, GraphNode, Neighborhood, Point } from '../../model/types';
import { edgePath, nodeSize, type GroupLabel, type GroupToggle } from './layout';
import { allowsPort, portKinds, portLabels, type PortSide } from './ports';

const SVG_NS = 'http://www.w3.org/2000/svg';
export class Scene {
  readonly world: HTMLDivElement;
  readonly nodes = new Map<string, HTMLElement>();
  private nodeRecords = new Map<string, GraphNode>();
  private edges: (GraphEdge & { path: SVGPathElement })[] = [];
  private readonly svg: SVGSVGElement;
  private readonly labels: HTMLDivElement;
  private readonly nodeLayer: HTMLDivElement;
  private readonly connector: SVGPathElement;

  constructor(root: HTMLElement) {
    const doc = root.ownerDocument;
    this.world = doc.createElement('div');
    this.world.className = 'brain-world';
    this.svg = doc.createElementNS(SVG_NS, 'svg');
    this.svg.classList.add('brain-edges');
    this.svg.setAttribute('aria-hidden', 'true');
    this.labels = doc.createElement('div');
    this.labels.className = 'brain-labels';
    this.nodeLayer = doc.createElement('div');
    this.nodeLayer.className = 'brain-nodes';
    this.connector = doc.createElementNS(SVG_NS, 'path');
    this.connector.classList.add('brain-connection-preview');
    this.connector.classList.add('is-hidden');
    this.world.append(this.svg, this.labels, this.nodeLayer);
    root.append(this.world);
  }

  render(snapshot: Neighborhood, labels: GroupLabel[], toggles: GroupToggle[] = []): void {
    const doc = this.world.ownerDocument;
    this.nodeLayer.replaceChildren();
    this.svg.replaceChildren();
    this.labels.replaceChildren();
    this.nodes.clear();
    this.nodeRecords = new Map(snapshot.nodes.map(node => [node.id, node]));
    this.edges = snapshot.edges.map(edge => {
      const path = doc.createElementNS(SVG_NS, 'path');
      path.classList.add('brain-edge', `brain-edge-${edge.kind}`);
      if (edge.kind === 'hierarchy') {
        const parent = snapshot.nodes.find(node => node.id === edge.source);
        path.classList.add(parent?.zone === 'parent' ? 'brain-edge-parent' : 'brain-edge-child');
      }
      path.dataset.kind = edge.kind;
      path.dataset.source = edge.source;
      path.dataset.target = edge.target;
      this.svg.append(path);
      return { ...edge, path };
    });
    this.svg.append(this.connector);
    for (const toggle of toggles) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'brain-group-toggle';
      button.dataset.groupKey = toggle.key;
      button.setAttribute('aria-expanded', String(toggle.expanded));
      button.textContent = toggle.expanded ? '收起' : `展开另外 ${toggle.hidden} 个`;
      Object.assign(button.style, {left: `${toggle.x}px`, top: `${toggle.y}px`});
      this.labels.append(button);
    }
    for (const label of labels) {
      const element = doc.createElement('div');
      element.className = `brain-zone-label brain-zone-label-${label.kind}`;
      element.textContent = label.text;
      element.title = label.text;
      Object.assign(element.style, { left: `${label.x}px`, top: `${label.y}px` });
      this.labels.append(element);
    }
    for (const node of snapshot.nodes) {
      const element = doc.createElement('div');
      element.className = `brain-node brain-node-${node.zone}`;
      element.dataset.nodeId = node.id;
      if (snapshot.root === node.id) element.classList.add('is-global-root');
      const shared = node.groupParents.map(id => snapshot.parents.find(parent => parent.id === id)?.title ?? id);
      const dragHint = node.zone === 'focus' ? '从连接端点拖出创建或整理关系' : '';
      element.title = [node.title, node.id, snapshot.root === node.id ? '全局根节点' :
        '',
        dragHint, shared.length ? `共同父级：${shared.join('、')}` : '', ...node.issues].filter(Boolean).join('\n');
      const body = doc.createElement('button');
      body.type = 'button';
      body.className = 'brain-node-body';
      body.dataset.action = node.zone === 'outer' ? 'open-note' : 'focus';
      body.setAttribute('aria-label', `${node.zone === 'outer' ? '打开笔记：' : node.zone === 'focus' ? '当前中心：' : '以此为中心：'}${node.title}`);
      if (node.zone === 'outer') {
        const dot = doc.createElement('span');
        dot.className = 'brain-node-dot';
        dot.setAttribute('aria-hidden', 'true');
        const degree = snapshot.edges.filter(edge => edge.source === node.id || edge.target === node.id).length;
        element.style.setProperty('--brain-dot-size', `${10 + Math.min(8, Math.sqrt(degree) * 2)}px`);
        body.append(dot);

      }
      const title = doc.createElement('span');
      title.className = 'brain-node-title';
      title.textContent = node.title;
      body.append(title);
      const connect = doc.createElement('button');
      connect.type = 'button';
      connect.dataset.action = 'connect';
      connect.className = 'brain-node-connect brain-source-connect';
      connect.title = `从「${node.title}」拖出连接`;
      connect.setAttribute('aria-label', `从「${node.title}」拖出连接`);
      if (node.issues.length && node.zone !== 'outer') {
        element.classList.add('has-issue');
        const issue = doc.createElement('span');
        issue.className = 'brain-node-issue';
        issue.textContent = '!';
        issue.setAttribute('aria-label', node.issues.join('；'));
        element.append(issue);
      }
      const size = nodeSize(node);
      Object.assign(element.style, { width: `${size.width}px`, height: `${size.height}px` });
      element.append(body);
      const sides: PortSide[] = node.zone === 'outer' ? ['right'] : (Object.keys(portKinds) as PortSide[]).filter(side => allowsPort(node, side));
      for (const side of sides) {
        const gate = connect.cloneNode(true) as HTMLButtonElement;
        gate.className = `brain-node-connect ${node.zone === 'outer' ? 'brain-source-connect' : 'brain-relation-port'} brain-gate-${side}`;
        gate.dataset.port = side;
        if (node.zone !== 'outer') {
          gate.title = `连接端点：${portLabels[side]}（接入时）`;
          gate.setAttribute('aria-label', `「${node.title}」的${portLabels[side]}连接端点`);
        }
        element.append(gate);
      }
      this.nodes.set(node.id, element);
      this.nodeLayer.append(element);
    }
  }

  position(positions: Record<string, Point>): void {
    for (const [id, element] of this.nodes) {
      const point = positions[id];
      if (point) element.style.transform = `translate(${point.x}px, ${point.y}px) translate(-50%, -50%)`;
    }
    for (const edge of this.edges) {
      const source = positions[edge.source];
      const target = positions[edge.target];
      const sourceNode = this.nodeRecords.get(edge.source);
      const targetNode = this.nodeRecords.get(edge.target);
      if (source && target && sourceNode && targetNode) edge.path.setAttribute('d', edgePath(source, target, sourceNode, targetNode, edge.kind));
    }
  }

  highlight(id?: string): void {
    this.world.classList.toggle('has-highlight', Boolean(id));
    const related = new Set([id]);
    for (const edge of this.edges) {
      const active = edge.source === id || edge.target === id;
      edge.path.classList.toggle('is-highlighted', active);
      if (active) { related.add(edge.source); related.add(edge.target); }
    }
    for (const [nodeId, element] of this.nodes) element.classList.toggle('is-highlighted', related.has(nodeId));
  }

  connect(source?: Point, target?: Point, sourceSide?: PortSide, targetSide?: PortSide): void {
    this.connector.classList.toggle('is-hidden', !source || !target);
    if (source && target) {
      const bend = Math.max(60, Math.min(180, Math.hypot(target.x - source.x, target.y - source.y) * .4));
      const control = (point: Point, side?: PortSide): Point => ({
        x: point.x + (side === 'left' ? -bend : side === 'right' ? bend : 0),
        y: point.y + (side === 'top' ? -bend : side === 'bottom' ? bend : 0),
      });
      const a = control(source, sourceSide), b = control(target, targetSide);
      this.connector.setAttribute('d', `M ${source.x} ${source.y} C ${a.x} ${a.y}, ${b.x} ${b.y}, ${target.x} ${target.y}`);
    }
  }
}
