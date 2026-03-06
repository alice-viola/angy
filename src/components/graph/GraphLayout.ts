import type { GraphNode, GraphEdge } from './GraphTypes';

// ── Force-directed spring-embedder layout ────────────────────────────────

export class GraphLayout {
  // Coulomb repulsion constant
  private repulsionForce = 500;
  // Hooke's spring constant
  private springForce = 0.01;
  // Natural spring rest length
  private springLength = 150;
  // Velocity damping per step
  private damping = 0.9;
  // Convergence threshold — stop when all velocities below this
  private minVelocity = 0.1;

  // Boundary padding (keeps nodes in view)
  private boundaryPadding = 40;
  private viewWidth = 800;
  private viewHeight = 600;

  // Type-clustering bias forces
  private clusterStrength = 0.3;

  // ── Public API ─────────────────────────────────────────────────────────

  setViewSize(width: number, height: number): void {
    this.viewWidth = width;
    this.viewHeight = height;
  }

  /** Run N iterations of force simulation. */
  runSimulation(nodes: GraphNode[], edges: GraphEdge[], iterations: number): void {
    for (let i = 0; i < iterations; i++) {
      const moving = this.step(nodes, edges);
      if (!moving) break;
    }
  }

  /** Single step of the force simulation. Returns true if still moving. */
  step(nodes: GraphNode[], edges: GraphEdge[]): boolean {
    if (nodes.length === 0) return false;

    // Build adjacency lookup
    const edgeMap = new Map<string, string[]>();
    for (const e of edges) {
      let srcList = edgeMap.get(e.source);
      if (!srcList) { srcList = []; edgeMap.set(e.source, srcList); }
      srcList.push(e.target);

      let tgtList = edgeMap.get(e.target);
      if (!tgtList) { tgtList = []; edgeMap.set(e.target, tgtList); }
      tgtList.push(e.source);
    }

    // Accumulate forces per node
    const fx = new Float64Array(nodes.length);
    const fy = new Float64Array(nodes.length);

    // 1. Coulomb repulsion between ALL node pairs
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[j].x - nodes[i].x;
        const dy = nodes[j].y - nodes[i].y;
        const distSq = dx * dx + dy * dy;
        const dist = Math.sqrt(distSq) || 1;
        const force = this.repulsionForce / distSq;
        const forceX = (dx / dist) * force;
        const forceY = (dy / dist) * force;
        fx[i] -= forceX;
        fy[i] -= forceY;
        fx[j] += forceX;
        fy[j] += forceY;
      }
    }

    // 2. Hooke's spring attraction along edges
    const nodeIndex = new Map<string, number>();
    for (let i = 0; i < nodes.length; i++) {
      nodeIndex.set(nodes[i].id, i);
    }

    for (const edge of edges) {
      const si = nodeIndex.get(edge.source);
      const ti = nodeIndex.get(edge.target);
      if (si === undefined || ti === undefined) continue;

      const dx = nodes[ti].x - nodes[si].x;
      const dy = nodes[ti].y - nodes[si].y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const displacement = dist - this.springLength;
      const force = this.springForce * displacement;
      const forceX = (dx / dist) * force;
      const forceY = (dy / dist) * force;

      fx[si] += forceX;
      fy[si] += forceY;
      fx[ti] -= forceX;
      fy[ti] -= forceY;
    }

    // 3. Type-clustering bias
    const cx = this.viewWidth / 2;
    const cy = this.viewHeight / 2;

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];

      if (node.type === 'agent') {
        // Agents tend toward the left side
        fx[i] += (cx * 0.35 - node.x) * this.clusterStrength * 0.01;
      } else if (node.type === 'file') {
        // Files tend toward the right side
        fx[i] += (cx * 1.65 - node.x) * this.clusterStrength * 0.01;
      } else if (node.type === 'tool' && node.parentNodeId) {
        // Tool nodes orbit their parent agent
        const pi = nodeIndex.get(node.parentNodeId);
        if (pi !== undefined) {
          const parent = nodes[pi];
          const dx = parent.x - node.x;
          const dy = parent.y - node.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          // Pull toward parent with an ideal orbit radius of ~80px
          const orbitRadius = 80;
          const displacement = dist - orbitRadius;
          fx[i] += (dx / dist) * displacement * 0.02;
          fy[i] += (dy / dist) * displacement * 0.02;
        }
      } else if (node.type === 'checkpoint' && node.parentNodeId) {
        // Checkpoint nodes sit near their parent agent, slightly below
        const pi = nodeIndex.get(node.parentNodeId);
        if (pi !== undefined) {
          const parent = nodes[pi];
          const dx = parent.x - node.x;
          const dy = (parent.y + 100) - node.y; // offset below parent
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const orbitRadius = 60;
          const displacement = dist - orbitRadius;
          fx[i] += (dx / dist) * displacement * 0.03;
          fy[i] += (dy / dist) * displacement * 0.03;
        }
      }

      // 4. Boundary forces — soft repulsion from edges
      const pad = this.boundaryPadding;
      if (node.x < pad) fx[i] += (pad - node.x) * 0.1;
      if (node.x > this.viewWidth - pad) fx[i] -= (node.x - (this.viewWidth - pad)) * 0.1;
      if (node.y < pad) fy[i] += (pad - node.y) * 0.1;
      if (node.y > this.viewHeight - pad) fy[i] -= (node.y - (this.viewHeight - pad)) * 0.1;

      // Gentle centering force to prevent drift
      fx[i] += (cx - node.x) * 0.001;
      fy[i] += (cy - node.y) * 0.001;
    }

    // 5. Apply forces, damping, and update positions
    let maxVelocity = 0;

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node.pinned) continue;

      node.vx = (node.vx + fx[i]) * this.damping;
      node.vy = (node.vy + fy[i]) * this.damping;

      // Clamp velocity to prevent explosions
      const speed = Math.sqrt(node.vx * node.vx + node.vy * node.vy);
      if (speed > 50) {
        node.vx = (node.vx / speed) * 50;
        node.vy = (node.vy / speed) * 50;
      }

      node.x += node.vx;
      node.y += node.vy;

      maxVelocity = Math.max(maxVelocity, speed);
    }

    return maxVelocity > this.minVelocity;
  }

  /** Initialize position for a new node (burst from parent or random placement). */
  initializePosition(node: GraphNode, parentNode?: GraphNode): void {
    if (parentNode) {
      // Burst outward from parent with slight random offset
      const angle = Math.random() * Math.PI * 2;
      const distance = 60 + Math.random() * 40;
      node.x = parentNode.x + Math.cos(angle) * distance;
      node.y = parentNode.y + Math.sin(angle) * distance;
    } else {
      // Random position within center region
      const cx = this.viewWidth / 2;
      const cy = this.viewHeight / 2;
      const spread = Math.min(this.viewWidth, this.viewHeight) * 0.3;
      node.x = cx + (Math.random() - 0.5) * spread;
      node.y = cy + (Math.random() - 0.5) * spread;
    }
    node.vx = 0;
    node.vy = 0;
  }
}
