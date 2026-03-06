import type { GraphNode, GraphEdge } from './GraphTypes';

// ── Canvas 2D rendering engine for the agent graph ───────────────────────

// Node style constants
const AGENT_RADIUS = 24;
const TOOL_WIDTH = 40;
const TOOL_HEIGHT = 24;
const FILE_SIZE = 20;
const MILESTONE_RADIUS = 20;
const VALIDATION_RADIUS = 14;
const CHECKPOINT_RADIUS = 16;

// Colors
const STATUS_COLORS: Record<string, string> = {
  idle: '#6b7280',
  working: '#14b8a6',
  done: '#22c55e',
  error: '#ef4444',
  blocked: '#f59e0b',
};
const TOOL_COLOR = '#3b82f6';
const FILE_COLOR = '#a855f7';
const CHECKPOINT_COLOR = '#22c55e';
const GHOST_COLOR = '#6c7086';

// Edge styles
const EDGE_COLORS: Record<string, string> = {
  delegation: '#cba6f7',
  'tool-call': '#89b4fa',
  'file-touch': '#45475a',
  'peer-message': '#f9e2af',
  validation: '#22c55e',
  checkpoint: '#22c55e',
};

const FONT_SANS = '"Inter", -apple-system, sans-serif';
const FONT_MONO = '"JetBrains Mono", monospace';

export class GraphRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private animFrameId: number | null = null;
  private dirty = true;
  private time = 0;

  private nodes: GraphNode[] = [];
  private edges: GraphEdge[] = [];

  private zoom = 1;
  private panX = 0;
  private panY = 0;

  private hoveredNodeId: string | null = null;
  private selectedNodeId: string | null = null;

  // Time slice — nodes with turnId > currentTurn are rendered as grey/transparent ghosts
  private currentTurn = Infinity;
  private maxTurn = 0;

  // Node index for quick lookup during hit testing
  private nodeById = new Map<string, GraphNode>();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get canvas 2d context');
    this.ctx = ctx;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────

  start(): void {
    if (this.animFrameId !== null) return;
    const loop = () => {
      this.time += 16; // ~60fps time accumulator
      if (this.dirty) {
        this.render();
        this.dirty = this.hasAnimatedElements();
      }
      this.animFrameId = requestAnimationFrame(loop);
    };
    this.animFrameId = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  markDirty(): void {
    this.dirty = true;
  }

  // ── Data ─────────────────────────────────────────────────────────────

  setData(nodes: GraphNode[], edges: GraphEdge[]): void {
    this.nodes = nodes;
    this.edges = edges;
    this.nodeById.clear();
    for (const n of nodes) {
      this.nodeById.set(n.id, n);
    }
    this.dirty = true;
  }

  setTransform(zoom: number, panX: number, panY: number): void {
    this.zoom = zoom;
    this.panX = panX;
    this.panY = panY;
    this.dirty = true;
  }

  // ── Interaction state ────────────────────────────────────────────────

  setHoveredNode(id: string | null): void {
    if (this.hoveredNodeId !== id) {
      this.hoveredNodeId = id;
      this.dirty = true;
    }
  }

  setSelectedNode(id: string | null): void {
    if (this.selectedNodeId !== id) {
      this.selectedNodeId = id;
      this.dirty = true;
    }
  }

  setCurrentTurn(turn: number, max: number): void {
    this.currentTurn = turn;
    this.maxTurn = max;
    this.dirty = true;
  }

  /** Check if a node is within the current time slice. */
  private isInTimeSlice(node: GraphNode): boolean {
    if (this.currentTurn >= this.maxTurn) return true;
    return node.turnId === undefined || node.turnId <= this.currentTurn;
  }

  /** Check if an edge is within the current time slice. */
  private isEdgeInTimeSlice(edge: GraphEdge): boolean {
    if (this.currentTurn >= this.maxTurn) return true;
    return edge.turnId === undefined || edge.turnId <= this.currentTurn;
  }

  // ── Hit testing ──────────────────────────────────────────────────────

  hitTest(screenX: number, screenY: number): GraphNode | null {
    // Convert screen coords to world coords
    const worldX = (screenX - this.panX) / this.zoom;
    const worldY = (screenY - this.panY) / this.zoom;

    // Iterate in reverse so topmost nodes (drawn last) are hit first
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const node = this.nodes[i];
      const dx = worldX - node.x;
      const dy = worldY - node.y;

      switch (node.type) {
        case 'agent': {
          if (dx * dx + dy * dy <= AGENT_RADIUS * AGENT_RADIUS) return node;
          break;
        }
        case 'tool': {
          const hw = TOOL_WIDTH / 2;
          const hh = TOOL_HEIGHT / 2;
          if (Math.abs(dx) <= hw && Math.abs(dy) <= hh) return node;
          break;
        }
        case 'file': {
          // Diamond hit test: |dx|/s + |dy|/s <= 1
          if (Math.abs(dx) / FILE_SIZE + Math.abs(dy) / FILE_SIZE <= 1) return node;
          break;
        }
        case 'validation': {
          if (dx * dx + dy * dy <= VALIDATION_RADIUS * VALIDATION_RADIUS) return node;
          break;
        }
        case 'milestone': {
          if (dx * dx + dy * dy <= MILESTONE_RADIUS * MILESTONE_RADIUS) return node;
          break;
        }
        case 'checkpoint': {
          if (dx * dx + dy * dy <= CHECKPOINT_RADIUS * CHECKPOINT_RADIUS) return node;
          break;
        }
      }
    }

    return null;
  }

  // ── Rendering ────────────────────────────────────────────────────────

  private render(): void {
    const { ctx, canvas } = this;
    const dpr = window.devicePixelRatio || 1;

    // Clear
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);

    // Apply view transform
    ctx.save();
    ctx.translate(this.panX, this.panY);
    ctx.scale(this.zoom, this.zoom);

    // Draw edges first (below nodes)
    for (const edge of this.edges) {
      this.drawEdge(edge);
    }

    // Draw nodes on top
    for (const node of this.nodes) {
      this.drawNode(node);
    }

    ctx.restore();
  }

  // ── Edge drawing ─────────────────────────────────────────────────────

  private drawEdge(edge: GraphEdge): void {
    const src = this.nodeById.get(edge.source);
    const tgt = this.nodeById.get(edge.target);
    if (!src || !tgt) return;

    const { ctx } = this;
    ctx.save();

    // Grey/transparent for out-of-slice edges
    if (!this.isEdgeInTimeSlice(edge)) {
      ctx.globalAlpha = 0.2;
    }

    const color = EDGE_COLORS[edge.type] || '#6c7086';
    const isConnectedToHover =
      this.hoveredNodeId !== null &&
      (edge.source === this.hoveredNodeId || edge.target === this.hoveredNodeId);
    const lwBoost = isConnectedToHover ? 2 : 0;

    if (isConnectedToHover) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
    }

    switch (edge.type) {
      case 'delegation': {
        // Slight glow on delegation edges
        ctx.shadowColor = color;
        ctx.shadowBlur = 4;
        ctx.strokeStyle = color;
        ctx.lineWidth = 3 + lwBoost;
        this.drawBezierEdge(src, tgt);
        ctx.shadowBlur = 0;
        this.drawArrowhead(src, tgt, color);
        break;
      }
      case 'tool-call': {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5 + lwBoost;
        if (edge.animated) {
          ctx.setLineDash([6, 4]);
          ctx.lineDashOffset = -(this.time * 0.05);
        }
        this.drawStraightEdge(src, tgt);
        this.drawArrowhead(src, tgt, color);
        break;
      }
      case 'file-touch': {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1 + lwBoost;
        ctx.setLineDash([2, 4]);
        this.drawStraightEdge(src, tgt);
        break;
      }
      case 'peer-message': {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2 + lwBoost;
        ctx.setLineDash([8, 4]);
        this.drawStraightEdge(src, tgt);
        // Bidirectional arrows
        this.drawArrowhead(src, tgt, color);
        this.drawArrowhead(tgt, src, color);
        break;
      }
      case 'validation': {
        const pass = edge.label !== 'fail';
        const vColor = pass ? '#22c55e' : '#ef4444';
        ctx.strokeStyle = vColor;
        ctx.lineWidth = 2 + lwBoost;
        this.drawStraightEdge(src, tgt);
        this.drawArrowhead(src, tgt, vColor);
        break;
      }
      case 'checkpoint': {
        ctx.strokeStyle = CHECKPOINT_COLOR;
        ctx.lineWidth = 2 + lwBoost;
        this.drawStraightEdge(src, tgt);
        this.drawArrowhead(src, tgt, CHECKPOINT_COLOR);
        break;
      }
    }

    ctx.restore();
  }

  private drawBezierEdge(src: GraphNode, tgt: GraphNode): void {
    const { ctx } = this;
    const dx = tgt.x - src.x;
    const dy = tgt.y - src.y;
    const cx1 = src.x + dx * 0.4;
    const cy1 = src.y;
    const cx2 = tgt.x - dx * 0.4;
    const cy2 = tgt.y;

    ctx.beginPath();
    ctx.moveTo(src.x, src.y);
    ctx.bezierCurveTo(cx1, cy1 + dy * 0.1, cx2, cy2 - dy * 0.1, tgt.x, tgt.y);
    ctx.stroke();
  }

  private drawStraightEdge(src: GraphNode, tgt: GraphNode): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(src.x, src.y);
    ctx.lineTo(tgt.x, tgt.y);
    ctx.stroke();
  }

  private drawArrowhead(src: GraphNode, tgt: GraphNode, color: string): void {
    const { ctx } = this;
    const angle = Math.atan2(tgt.y - src.y, tgt.x - src.x);
    const size = 8;
    // Position arrowhead slightly before target center
    const tipX = tgt.x - Math.cos(angle) * 16;
    const tipY = tgt.y - Math.sin(angle) * 16;

    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(
      tipX - Math.cos(angle - Math.PI / 6) * size,
      tipY - Math.sin(angle - Math.PI / 6) * size,
    );
    ctx.lineTo(
      tipX - Math.cos(angle + Math.PI / 6) * size,
      tipY - Math.sin(angle + Math.PI / 6) * size,
    );
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // ── Node drawing ─────────────────────────────────────────────────────

  private drawNode(node: GraphNode): void {
    const isHovered = node.id === this.hoveredNodeId;
    const isSelected = node.id === this.selectedNodeId;
    const inSlice = this.isInTimeSlice(node);
    const { ctx } = this;

    if (!inSlice) {
      ctx.save();
      ctx.globalAlpha = 0.25;
    }

    switch (node.type) {
      case 'agent': this.drawAgentNode(node, isHovered, isSelected, inSlice); break;
      case 'tool': this.drawToolNode(node, isHovered, isSelected, inSlice); break;
      case 'file': this.drawFileNode(node, isHovered, isSelected, inSlice); break;
      case 'validation': this.drawValidationNode(node, isHovered, isSelected, inSlice); break;
      case 'milestone': this.drawMilestoneNode(node, isHovered, isSelected, inSlice); break;
      case 'checkpoint': this.drawCheckpointNode(node, isHovered, isSelected, inSlice); break;
    }

    if (!inSlice) {
      ctx.restore();
    }
  }

  private drawAgentNode(node: GraphNode, hovered: boolean, selected: boolean, inSlice = true): void {
    const { ctx } = this;
    const status = node.status || 'idle';
    const color = inSlice ? (STATUS_COLORS[status] || STATUS_COLORS.idle) : GHOST_COLOR;

    ctx.save();

    // Always-on subtle drop shadow
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;

    // Glow effect for hover
    if (hovered) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 20;
      ctx.shadowOffsetY = 0;
    }

    // Pulsing ring for 'working' status
    if (status === 'working' && inSlice) {
      const prevAlpha = ctx.globalAlpha;
      const pulse = Math.sin(this.time * 0.004) * 0.3 + 0.7;
      ctx.beginPath();
      ctx.arc(node.x, node.y, AGENT_RADIUS + 6, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.globalAlpha = prevAlpha * pulse * 0.4;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.globalAlpha = prevAlpha;
      this.dirty = true;
    }

    // Main circle with radial gradient
    ctx.beginPath();
    ctx.arc(node.x, node.y, AGENT_RADIUS, 0, Math.PI * 2);
    if (inSlice) {
      const grad = ctx.createRadialGradient(
        node.x - 4, node.y - 4, 2,
        node.x, node.y, AGENT_RADIUS,
      );
      grad.addColorStop(0, this.lightenColor(color, 40));
      grad.addColorStop(1, color);
      ctx.fillStyle = grad;
    } else {
      ctx.fillStyle = GHOST_COLOR;
    }
    ctx.fill();

    // Inner ring highlight
    ctx.beginPath();
    ctx.arc(node.x, node.y, AGENT_RADIUS - 3, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Selected outline
    if (selected) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, AGENT_RADIUS, 0, Math.PI * 2);
      ctx.strokeStyle = '#cdd6f4';
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    // First letter icon inside the circle
    const letter = (node.label || 'A').charAt(0).toUpperCase();
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold 14px ${FONT_SANS}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter, node.x, node.y);

    // Label below
    ctx.fillStyle = inSlice ? '#cdd6f4' : '#585b70';
    ctx.font = `11px ${FONT_MONO}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(this.truncateLabel(node.label, 14), node.x, node.y + AGENT_RADIUS + 6);

    ctx.restore();
  }

  private drawToolNode(node: GraphNode, hovered: boolean, selected: boolean, inSlice = true): void {
    const { ctx } = this;
    const hw = TOOL_WIDTH / 2;
    const hh = TOOL_HEIGHT / 2;
    const r = 6;
    const baseColor = inSlice ? TOOL_COLOR : GHOST_COLOR;

    ctx.save();

    // Always-on subtle shadow
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 5;
    ctx.shadowOffsetY = 2;

    if (hovered) {
      ctx.shadowColor = baseColor;
      ctx.shadowBlur = 16;
      ctx.shadowOffsetY = 0;
    }

    // Rounded rect path
    this.roundedRectPath(node.x - hw, node.y - hh, TOOL_WIDTH, TOOL_HEIGHT, r);

    // Linear gradient fill
    if (inSlice) {
      const grad = ctx.createLinearGradient(node.x - hw, node.y - hh, node.x + hw, node.y + hh);
      grad.addColorStop(0, TOOL_COLOR);
      grad.addColorStop(1, this.darkenColor(TOOL_COLOR, 30));
      ctx.fillStyle = grad;
    } else {
      ctx.fillStyle = GHOST_COLOR;
    }
    ctx.fill();

    // Inner border highlight
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    ctx.stroke();

    if (selected) {
      ctx.strokeStyle = '#cdd6f4';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    // Tool name inside
    ctx.fillStyle = '#ffffff';
    ctx.font = `9px ${FONT_MONO}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.truncateLabel(node.toolName || node.label, 7), node.x, node.y);

    ctx.restore();
  }

  private drawFileNode(node: GraphNode, hovered: boolean, selected: boolean, inSlice = true): void {
    const { ctx } = this;
    const s = FILE_SIZE;
    const baseColor = inSlice ? FILE_COLOR : GHOST_COLOR;

    ctx.save();

    // Always-on subtle shadow
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 5;
    ctx.shadowOffsetY = 2;

    if (hovered) {
      ctx.shadowColor = baseColor;
      ctx.shadowBlur = 16;
      ctx.shadowOffsetY = 0;
    }

    // Diamond (rotated square)
    ctx.beginPath();
    ctx.moveTo(node.x, node.y - s);
    ctx.lineTo(node.x + s, node.y);
    ctx.lineTo(node.x, node.y + s);
    ctx.lineTo(node.x - s, node.y);
    ctx.closePath();

    // Gradient fill
    if (inSlice) {
      const grad = ctx.createLinearGradient(node.x - s, node.y - s, node.x + s, node.y + s);
      grad.addColorStop(0, this.lightenColor(FILE_COLOR, 25));
      grad.addColorStop(1, FILE_COLOR);
      ctx.fillStyle = grad;
    } else {
      ctx.fillStyle = GHOST_COLOR;
    }
    ctx.fill();

    // Thin stroke border
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.stroke();

    if (selected) {
      ctx.strokeStyle = '#cdd6f4';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    // Filename label below
    const filename = node.filePath ? node.filePath.split('/').pop() || node.label : node.label;
    ctx.fillStyle = inSlice ? '#a6adc8' : '#585b70';
    ctx.font = `10px ${FONT_MONO}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(this.truncateLabel(filename, 16), node.x, node.y + s + 4);

    ctx.restore();
  }

  private drawValidationNode(node: GraphNode, hovered: boolean, selected: boolean, inSlice = true): void {
    const { ctx } = this;
    const pass = node.status !== 'error';
    const rawColor = pass ? '#22c55e' : '#ef4444';
    const color = inSlice ? rawColor : GHOST_COLOR;
    const r = VALIDATION_RADIUS;

    ctx.save();

    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 5;
    ctx.shadowOffsetY = 2;

    if (hovered) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 16;
      ctx.shadowOffsetY = 0;
    }

    // Octagon
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const angle = (Math.PI * 2 * i) / 8 - Math.PI / 8;
      const px = node.x + Math.cos(angle) * r;
      const py = node.y + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();

    if (inSlice) {
      const grad = ctx.createRadialGradient(node.x, node.y, 1, node.x, node.y, r);
      grad.addColorStop(0, this.lightenColor(rawColor, 30));
      grad.addColorStop(1, rawColor);
      ctx.fillStyle = grad;
    } else {
      ctx.fillStyle = GHOST_COLOR;
    }
    ctx.fill();

    // Inner highlight
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.stroke();

    if (selected) {
      ctx.strokeStyle = '#cdd6f4';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    // Checkmark or X icon inside
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    if (pass) {
      ctx.beginPath();
      ctx.moveTo(node.x - 5, node.y);
      ctx.lineTo(node.x - 1, node.y + 4);
      ctx.lineTo(node.x + 6, node.y - 4);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(node.x - 4, node.y - 4);
      ctx.lineTo(node.x + 4, node.y + 4);
      ctx.moveTo(node.x + 4, node.y - 4);
      ctx.lineTo(node.x - 4, node.y + 4);
      ctx.stroke();
    }

    // Label below
    ctx.fillStyle = inSlice ? '#a6adc8' : '#585b70';
    ctx.font = `10px ${FONT_SANS}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(this.truncateLabel(node.label, 14), node.x, node.y + r + 4);

    ctx.restore();
  }

  private drawMilestoneNode(node: GraphNode, hovered: boolean, selected: boolean, inSlice = true): void {
    const { ctx } = this;
    const pass = node.status !== 'error';
    const r = MILESTONE_RADIUS;
    const rawColor = pass ? '#22c55e' : '#ef4444';

    ctx.save();

    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;

    if (hovered) {
      ctx.shadowColor = inSlice ? rawColor : GHOST_COLOR;
      ctx.shadowBlur = 20;
      ctx.shadowOffsetY = 0;
    }

    if (pass) {
      this.drawStar(node.x, node.y, 5, r, r * 0.45);
    } else {
      this.drawXShape(node.x, node.y, r);
    }

    if (inSlice) {
      const grad = ctx.createRadialGradient(node.x, node.y, 1, node.x, node.y, r);
      grad.addColorStop(0, this.lightenColor(rawColor, 35));
      grad.addColorStop(1, rawColor);
      ctx.fillStyle = grad;
    } else {
      ctx.fillStyle = GHOST_COLOR;
    }
    ctx.fill();

    // Inner highlight
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.stroke();

    if (selected) {
      ctx.strokeStyle = '#cdd6f4';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    // Label below
    ctx.fillStyle = inSlice ? '#cdd6f4' : '#585b70';
    ctx.font = `11px ${FONT_SANS}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(this.truncateLabel(node.label, 14), node.x, node.y + r + 6);

    ctx.restore();
  }

  private drawCheckpointNode(node: GraphNode, hovered: boolean, selected: boolean, inSlice = true): void {
    const { ctx } = this;
    const r = CHECKPOINT_RADIUS;
    const baseColor = inSlice ? CHECKPOINT_COLOR : GHOST_COLOR;

    ctx.save();

    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 5;
    ctx.shadowOffsetY = 2;

    if (hovered) {
      ctx.shadowColor = baseColor;
      ctx.shadowBlur = 20;
      ctx.shadowOffsetY = 0;
    }

    // Outer circle with gradient
    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
    if (inSlice) {
      const grad = ctx.createRadialGradient(node.x - 2, node.y - 2, 1, node.x, node.y, r);
      grad.addColorStop(0, this.lightenColor(CHECKPOINT_COLOR, 30));
      grad.addColorStop(1, CHECKPOINT_COLOR);
      ctx.fillStyle = grad;
    } else {
      ctx.fillStyle = GHOST_COLOR;
    }
    ctx.fill();

    // Inner highlight ring
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.stroke();

    if (selected) {
      ctx.strokeStyle = '#cdd6f4';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    // Git-commit icon: inner circle with vertical lines extending out
    const innerR = 5;
    const lineLen = 7;

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(node.x, node.y - innerR - lineLen);
    ctx.lineTo(node.x, node.y - innerR);
    ctx.moveTo(node.x, node.y + innerR);
    ctx.lineTo(node.x, node.y + innerR + lineLen);
    ctx.stroke();

    // Inner circle (hollow)
    ctx.beginPath();
    ctx.arc(node.x, node.y, innerR, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Label below
    const label = node.commitHash
      ? node.commitHash.slice(0, 7)
      : node.label;
    ctx.fillStyle = inSlice ? '#a6e3a1' : '#585b70';
    ctx.font = `10px ${FONT_MONO}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(this.truncateLabel(label, 14), node.x, node.y + r + 4);

    ctx.restore();
  }

  // ── Shape helpers ────────────────────────────────────────────────────

  private drawStar(cx: number, cy: number, points: number, outerR: number, innerR: number): void {
    const { ctx } = this;
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const r = i % 2 === 0 ? outerR : innerR;
      const angle = (Math.PI * i) / points - Math.PI / 2;
      const px = cx + Math.cos(angle) * r;
      const py = cy + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  private drawXShape(cx: number, cy: number, size: number): void {
    const { ctx } = this;
    const arm = size * 0.3;
    ctx.beginPath();
    // Draw a thick X as a polygon
    ctx.moveTo(cx - arm, cy - size);
    ctx.lineTo(cx + arm, cy - size);
    ctx.lineTo(cx + arm, cy - arm);
    ctx.lineTo(cx + size, cy - arm);
    ctx.lineTo(cx + size, cy + arm);
    ctx.lineTo(cx + arm, cy + arm);
    ctx.lineTo(cx + arm, cy + size);
    ctx.lineTo(cx - arm, cy + size);
    ctx.lineTo(cx - arm, cy + arm);
    ctx.lineTo(cx - size, cy + arm);
    ctx.lineTo(cx - size, cy - arm);
    ctx.lineTo(cx - arm, cy - arm);
    ctx.closePath();
  }

  private roundedRectPath(x: number, y: number, w: number, h: number, r: number): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  private hasAnimatedElements(): boolean {
    for (const edge of this.edges) {
      if (edge.animated) return true;
    }
    for (const node of this.nodes) {
      if (node.type === 'agent' && node.status === 'working') return true;
    }
    return false;
  }

  private truncateLabel(text: string, maxLen: number): string {
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen - 1) + '\u2026';
  }

  /** Lighten a hex color by a given amount (0-255). */
  private lightenColor(hex: string, amount: number): string {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = Math.min(255, ((num >> 16) & 0xff) + amount);
    const g = Math.min(255, ((num >> 8) & 0xff) + amount);
    const b = Math.min(255, (num & 0xff) + amount);
    return `rgb(${r},${g},${b})`;
  }

  /** Darken a hex color by a given amount (0-255). */
  private darkenColor(hex: string, amount: number): string {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = Math.max(0, ((num >> 16) & 0xff) - amount);
    const g = Math.max(0, ((num >> 8) & 0xff) - amount);
    const b = Math.max(0, (num & 0xff) - amount);
    return `rgb(${r},${g},${b})`;
  }
}
