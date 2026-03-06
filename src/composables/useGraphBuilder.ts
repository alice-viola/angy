import { useGraphStore } from '../stores/graph';
import { getDatabase, useSessionsStore } from '../stores/sessions';
import { engineBus } from '../engine/EventBus';
import type { GraphNode, GraphEdge } from '../components/graph/GraphTypes';
import { DelegationStatus } from '../engine/types';
import type { AgentStatus, SessionInfo } from '../engine/types';

// ── useGraphBuilder ──────────────────────────────────────────────────────
//
// Builds the agent graph from database history (replay mode)
// and subscribes to live engine events for real-time updates.

export function useGraphBuilder() {
  const graphStore = useGraphStore();

  // ── Replay mode: reconstruct graph from DB ───────────────────────────

  async function buildFromHistory(rootSessionId: string): Promise<void> {
    graphStore.clear();

    const db = getDatabase();
    const allSessions = await db.loadSessions();

    // Build lookup maps
    const sessionById = new Map<string, SessionInfo>();
    const childrenMap = new Map<string, string[]>();
    for (const s of allSessions) {
      sessionById.set(s.sessionId, s);
      if (s.parentSessionId) {
        const list = childrenMap.get(s.parentSessionId) ?? [];
        list.push(s.sessionId);
        childrenMap.set(s.parentSessionId, list);
      }
    }

    // Collect all sessions in the tree rooted at rootSessionId (BFS)
    const treeSessions: SessionInfo[] = [];
    const queue = [rootSessionId];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);

      const session = sessionById.get(id);
      if (!session) continue;
      treeSessions.push(session);

      const children = childrenMap.get(id) ?? [];
      for (const childId of children) {
        queue.push(childId);
      }
    }

    let globalTurnOffset = 0;

    // Create agent nodes + delegation edges
    for (const session of treeSessions) {
      const agentNode: GraphNode = {
        id: `agent:${session.sessionId}`,
        type: 'agent',
        label: session.title || session.mode || 'agent',
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        pinned: false,
        sessionId: session.sessionId,
        status: session.delegationStatus === DelegationStatus.Completed ? 'done'
          : session.delegationStatus === DelegationStatus.Failed ? 'error'
          : session.delegationStatus === DelegationStatus.Running ? 'working'
          : 'idle',
        turnId: 0,
        timestamp: session.createdAt,
        parentNodeId: session.parentSessionId
          ? `agent:${session.parentSessionId}`
          : undefined,
      };
      graphStore.addNode(agentNode);

      // Delegation edge from parent to child
      if (session.parentSessionId && visited.has(session.parentSessionId)) {
        const edge: GraphEdge = {
          id: `delegation:${session.parentSessionId}->${session.sessionId}`,
          source: `agent:${session.parentSessionId}`,
          target: `agent:${session.sessionId}`,
          type: 'delegation',
          label: session.delegationTask ?? session.mode,
          turnId: 0,
          timestamp: session.createdAt,
        };
        graphStore.addEdge(edge);
      }
    }

    // File node deduplication
    const fileNodes = new Map<string, string>(); // filePath -> nodeId

    // Process messages and file changes for each session
    for (const session of treeSessions) {
      const messages = await db.loadMessages(session.sessionId);
      const agentNodeId = `agent:${session.sessionId}`;
      let toolIndex = 0;

      for (const msg of messages) {
        // Track turn range
        if (msg.turnId > globalTurnOffset) globalTurnOffset = msg.turnId;

        // Tool-use messages → create tool nodes
        if (msg.toolName) {
          const toolNodeId = `tool:${session.sessionId}:${msg.turnId}:${toolIndex++}`;

          let toolInput: Record<string, any> | undefined;
          if (msg.toolInput) {
            try {
              toolInput = JSON.parse(msg.toolInput);
            } catch {
              // malformed JSON, skip
            }
          }

          const toolNode: GraphNode = {
            id: toolNodeId,
            type: 'tool',
            label: msg.toolName,
            x: 0,
            y: 0,
            vx: 0,
            vy: 0,
            pinned: false,
            toolName: msg.toolName,
            toolInput,
            turnId: msg.turnId,
            timestamp: msg.timestamp,
            parentNodeId: agentNodeId,
          };
          graphStore.addNode(toolNode);

          // Agent → tool edge
          const toolEdge: GraphEdge = {
            id: `tool-call:${agentNodeId}->${toolNodeId}`,
            source: agentNodeId,
            target: toolNodeId,
            type: 'tool-call',
            label: msg.toolName,
            turnId: msg.turnId,
            timestamp: msg.timestamp,
          };
          graphStore.addEdge(toolEdge);

          // Extract file_path from toolInput → create/link file nodes
          if (toolInput) {
            const filePath = toolInput.file_path || toolInput.path || toolInput.filePath;
            if (filePath && typeof filePath === 'string') {
              let fileNodeId = fileNodes.get(filePath);
              if (!fileNodeId) {
                fileNodeId = `file:${filePath}`;
                const fileNode: GraphNode = {
                  id: fileNodeId,
                  type: 'file',
                  label: filePath.split('/').pop() || filePath,
                  x: 0,
                  y: 0,
                  vx: 0,
                  vy: 0,
                  pinned: false,
                  filePath,
                  turnId: msg.turnId,
                  timestamp: msg.timestamp,
                };
                graphStore.addNode(fileNode);
                fileNodes.set(filePath, fileNodeId);
              }

              // Tool → file edge
              const fileEdge: GraphEdge = {
                id: `file-touch:${toolNodeId}->${fileNodeId}`,
                source: toolNodeId,
                target: fileNodeId,
                type: 'file-touch',
                turnId: msg.turnId,
                timestamp: msg.timestamp,
              };
              graphStore.addEdge(fileEdge);
            }
          }
        }
      }

      // Load file_changes → update file nodes with line counts
      const fileChanges = await db.loadFileChanges(session.sessionId);
      for (const fc of fileChanges) {
        if (fc.turnId > globalTurnOffset) globalTurnOffset = fc.turnId;

        const fileNodeId = fileNodes.get(fc.filePath);
        if (fileNodeId) {
          const existing = graphStore.nodes.get(fileNodeId);
          graphStore.updateNode(fileNodeId, {
            linesAdded: (existing?.linesAdded ?? 0) + fc.linesAdded,
            linesRemoved: (existing?.linesRemoved ?? 0) + fc.linesRemoved,
          });
        } else {
          // File change with no corresponding tool node — create the file node
          const newFileNodeId = `file:${fc.filePath}`;
          const fileNode: GraphNode = {
            id: newFileNodeId,
            type: 'file',
            label: fc.filePath.split('/').pop() || fc.filePath,
            x: 0,
            y: 0,
            vx: 0,
            vy: 0,
            pinned: false,
            filePath: fc.filePath,
            linesAdded: fc.linesAdded,
            linesRemoved: fc.linesRemoved,
            turnId: fc.turnId,
          };
          graphStore.addNode(fileNode);
          fileNodes.set(fc.filePath, newFileNodeId);
        }
      }
    }

    // Set turn range for timeline scrubber
    graphStore.maxTurn = globalTurnOffset;
    graphStore.currentTurn = globalTurnOffset;
    graphStore.isLive = false;
  }

  // ── Live mode: subscribe to events and update graph ──────────────────

  function startLiveGraph(rootSessionId: string): () => void {
    graphStore.isLive = true;

    // Ensure root agent node exists
    if (!graphStore.nodes.has(`agent:${rootSessionId}`)) {
      graphStore.addNode({
        id: `agent:${rootSessionId}`,
        type: 'agent',
        label: 'root',
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        pinned: false,
        sessionId: rootSessionId,
        status: 'working',
        turnId: 0,
      });
    }

    // File node deduplication for live mode
    const liveFileNodes = new Map<string, string>();

    // Track placeholder delegation nodes awaiting real session IDs
    const pendingDelegations: string[] = [];  // placeholder node IDs in order

    // Track live tool call index per session
    const liveToolIndex = new Map<string, number>();

    // Collect existing file nodes
    for (const node of graphStore.nodes.values()) {
      if (node.type === 'file' && node.filePath) {
        liveFileNodes.set(node.filePath, node.id);
      }
    }

    // ── Event handlers ────────────────────────────────────────────────

    function onStatusChanged(e: { agentId: string; status: AgentStatus; activity: string }) {
      const nodeId = `agent:${e.agentId}`;
      if (graphStore.nodes.has(nodeId)) {
        graphStore.updateNode(nodeId, { status: e.status });
      }
    }

    function onFileChanged(e: { sessionId: string; filePath: string; diff: any }) {
      const turnId = graphStore.maxTurn + 1;
      graphStore.maxTurn = turnId;
      graphStore.currentTurn = turnId;

      const agentNodeId = `agent:${e.sessionId}`;

      // Create a tool node for this file operation
      const idx = liveToolIndex.get(e.sessionId) ?? 0;
      liveToolIndex.set(e.sessionId, idx + 1);
      const toolName = e.diff?.linesRemoved > 0 ? 'Edit' : 'Write';
      const toolNodeId = `tool:${e.sessionId}:${turnId}:${idx}`;
      graphStore.addNode({
        id: toolNodeId,
        type: 'tool',
        label: toolName,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        pinned: false,
        toolName,
        toolInput: { file_path: e.filePath },
        turnId,
        parentNodeId: agentNodeId,
      });

      // Agent → tool edge
      graphStore.addEdge({
        id: `tool-call:${agentNodeId}->${toolNodeId}`,
        source: agentNodeId,
        target: toolNodeId,
        type: 'tool-call',
        label: toolName,
        turnId,
        animated: true,
      });

      let fileNodeId = liveFileNodes.get(e.filePath);
      if (!fileNodeId) {
        fileNodeId = `file:${e.filePath}`;
        graphStore.addNode({
          id: fileNodeId,
          type: 'file',
          label: e.filePath.split('/').pop() || e.filePath,
          x: 0,
          y: 0,
          vx: 0,
          vy: 0,
          pinned: false,
          filePath: e.filePath,
          linesAdded: e.diff?.linesAdded ?? 0,
          linesRemoved: e.diff?.linesRemoved ?? 0,
          turnId,
        });
        liveFileNodes.set(e.filePath, fileNodeId);
      } else {
        const existing = graphStore.nodes.get(fileNodeId);
        graphStore.updateNode(fileNodeId, {
          linesAdded: (existing?.linesAdded ?? 0) + (e.diff?.linesAdded ?? 0),
          linesRemoved: (existing?.linesRemoved ?? 0) + (e.diff?.linesRemoved ?? 0),
          turnId,
        });
      }

      // Tool → file edge
      graphStore.addEdge({
        id: `file-touch:${toolNodeId}->${fileNodeId}`,
        source: toolNodeId,
        target: fileNodeId,
        type: 'file-touch',
        turnId,
        animated: true,
      });
    }

    function onDelegationStarted(e: { role: string; task: string }) {
      const turnId = graphStore.maxTurn + 1;
      graphStore.maxTurn = turnId;
      graphStore.currentTurn = turnId;

      // Create a placeholder child agent node
      // The real sessionId will be filled when session:created fires
      const childNodeId = `agent:delegation-${turnId}`;
      graphStore.addNode({
        id: childNodeId,
        type: 'agent',
        label: `${e.role}: ${e.task.substring(0, 40)}`,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        pinned: false,
        status: 'working',
        turnId,
        parentNodeId: `agent:${rootSessionId}`,
      });

      // Delegation edge
      graphStore.addEdge({
        id: `delegation:${rootSessionId}->${childNodeId}`,
        source: `agent:${rootSessionId}`,
        target: childNodeId,
        type: 'delegation',
        label: e.role,
        turnId,
        animated: true,
      });

      pendingDelegations.push(childNodeId);
    }

    function onSessionCreated(e: { sessionId: string }) {
      // Match a pending placeholder delegation node to the real session
      if (pendingDelegations.length === 0) return;

      const placeholderId = pendingDelegations.shift()!;
      const placeholder = graphStore.nodes.get(placeholderId);
      if (!placeholder) return;

      const realNodeId = `agent:${e.sessionId}`;

      // Remove the placeholder and re-add with real ID
      graphStore.removeNode(placeholderId);

      graphStore.addNode({
        ...placeholder,
        id: realNodeId,
        sessionId: e.sessionId,
      });

      // Re-create the delegation edge with the real target
      graphStore.addEdge({
        id: `delegation:${rootSessionId}->${realNodeId}`,
        source: `agent:${rootSessionId}`,
        target: realNodeId,
        type: 'delegation',
        label: placeholder.label,
        turnId: placeholder.turnId ?? 0,
        animated: true,
      });
    }

    function onSessionFinished(e: { sessionId: string; exitCode: number }) {
      const nodeId = `agent:${e.sessionId}`;
      if (graphStore.nodes.has(nodeId)) {
        const turnId = graphStore.maxTurn + 1;
        graphStore.maxTurn = turnId;
        graphStore.currentTurn = turnId;

        graphStore.updateNode(nodeId, {
          status: e.exitCode === 0 ? 'done' : 'error',
        });

        // Add milestone node
        const milestoneId = `milestone:${e.sessionId}:${turnId}`;
        graphStore.addNode({
          id: milestoneId,
          type: 'milestone',
          label: e.exitCode === 0 ? 'done' : 'failed',
          status: e.exitCode === 0 ? 'done' : 'error',
          x: 0,
          y: 0,
          vx: 0,
          vy: 0,
          pinned: false,
          turnId,
          parentNodeId: nodeId,
        });
      }
    }

    // Subscribe to events
    engineBus.on('agent:statusChanged', onStatusChanged);
    engineBus.on('diff:fileChanged', onFileChanged);
    engineBus.on('orchestrator:delegationStarted', onDelegationStarted);
    engineBus.on('session:created', onSessionCreated);
    engineBus.on('session:finished', onSessionFinished);

    // Return cleanup function
    return () => {
      engineBus.off('agent:statusChanged', onStatusChanged);
      engineBus.off('diff:fileChanged', onFileChanged);
      engineBus.off('orchestrator:delegationStarted', onDelegationStarted);
      engineBus.off('session:created', onSessionCreated);
      engineBus.off('session:finished', onSessionFinished);
    };
  }

  // ── Multi-session mode: build graph from ALL sessions ────────────────

  async function buildMultiSessionGraph(): Promise<void> {
    graphStore.clear();

    const sessionsStore = useSessionsStore();
    const db = getDatabase();
    // Use workspace-filtered sessions from the store instead of raw DB
    const allSessions = Array.from(sessionsStore.sessions.values());

    // Build lookup maps
    const sessionById = new Map<string, SessionInfo>();
    const childrenMap = new Map<string, string[]>();
    for (const s of allSessions) {
      sessionById.set(s.sessionId, s);
      if (s.parentSessionId) {
        const list = childrenMap.get(s.parentSessionId) ?? [];
        list.push(s.sessionId);
        childrenMap.set(s.parentSessionId, list);
      }
    }

    // Find root sessions (no parent, or parent not in our set)
    const roots = allSessions.filter(
      (s) => !s.parentSessionId || !sessionById.has(s.parentSessionId),
    );

    let globalTurnOffset = 0;
    const fileNodes = new Map<string, string>(); // filePath -> nodeId

    // Process each tree with a distinct groupIndex
    for (let groupIndex = 0; groupIndex < roots.length; groupIndex++) {
      const root = roots[groupIndex];

      // BFS to collect tree
      const treeSessions: SessionInfo[] = [];
      const queue = [root.sessionId];
      const visited = new Set<string>();

      while (queue.length > 0) {
        const id = queue.shift()!;
        if (visited.has(id)) continue;
        visited.add(id);

        const session = sessionById.get(id);
        if (!session) continue;
        treeSessions.push(session);

        const children = childrenMap.get(id) ?? [];
        for (const childId of children) {
          queue.push(childId);
        }
      }

      // Create agent nodes + delegation edges for this tree
      for (const session of treeSessions) {
        const agentNode: GraphNode = {
          id: `agent:${session.sessionId}`,
          type: 'agent',
          label: session.title || session.mode || 'agent',
          x: 0,
          y: 0,
          vx: 0,
          vy: 0,
          pinned: false,
          sessionId: session.sessionId,
          status: session.delegationStatus === DelegationStatus.Completed ? 'done'
            : session.delegationStatus === DelegationStatus.Failed ? 'error'
            : session.delegationStatus === DelegationStatus.Running ? 'working'
            : 'idle',
          turnId: 0,
          timestamp: session.createdAt,
          parentNodeId: session.parentSessionId
            ? `agent:${session.parentSessionId}`
            : undefined,
          groupIndex,
        };
        graphStore.addNode(agentNode);

        if (session.parentSessionId && visited.has(session.parentSessionId)) {
          const edge: GraphEdge = {
            id: `delegation:${session.parentSessionId}->${session.sessionId}`,
            source: `agent:${session.parentSessionId}`,
            target: `agent:${session.sessionId}`,
            type: 'delegation',
            label: session.delegationTask ?? session.mode,
            turnId: 0,
            timestamp: session.createdAt,
          };
          graphStore.addEdge(edge);
        }
      }

      // Process messages and file changes for each session in this tree
      for (const session of treeSessions) {
        const messages = await db.loadMessages(session.sessionId);
        const agentNodeId = `agent:${session.sessionId}`;
        let toolIndex = 0;

        for (const msg of messages) {
          if (msg.turnId > globalTurnOffset) globalTurnOffset = msg.turnId;

          if (msg.toolName) {
            const toolNodeId = `tool:${session.sessionId}:${msg.turnId}:${toolIndex++}`;

            let toolInput: Record<string, any> | undefined;
            if (msg.toolInput) {
              try {
                toolInput = JSON.parse(msg.toolInput);
              } catch {
                // malformed JSON, skip
              }
            }

            const toolNode: GraphNode = {
              id: toolNodeId,
              type: 'tool',
              label: msg.toolName,
              x: 0,
              y: 0,
              vx: 0,
              vy: 0,
              pinned: false,
              toolName: msg.toolName,
              toolInput,
              turnId: msg.turnId,
              timestamp: msg.timestamp,
              parentNodeId: agentNodeId,
              groupIndex,
            };
            graphStore.addNode(toolNode);

            const toolEdge: GraphEdge = {
              id: `tool-call:${agentNodeId}->${toolNodeId}`,
              source: agentNodeId,
              target: toolNodeId,
              type: 'tool-call',
              label: msg.toolName,
              turnId: msg.turnId,
              timestamp: msg.timestamp,
            };
            graphStore.addEdge(toolEdge);

            if (toolInput) {
              const filePath = toolInput.file_path || toolInput.path || toolInput.filePath;
              if (filePath && typeof filePath === 'string') {
                let fileNodeId = fileNodes.get(filePath);
                if (!fileNodeId) {
                  fileNodeId = `file:${filePath}`;
                  const fileNode: GraphNode = {
                    id: fileNodeId,
                    type: 'file',
                    label: filePath.split('/').pop() || filePath,
                    x: 0,
                    y: 0,
                    vx: 0,
                    vy: 0,
                    pinned: false,
                    filePath,
                    turnId: msg.turnId,
                    timestamp: msg.timestamp,
                    groupIndex,
                  };
                  graphStore.addNode(fileNode);
                  fileNodes.set(filePath, fileNodeId);
                }

                const fileEdge: GraphEdge = {
                  id: `file-touch:${toolNodeId}->${fileNodeId}`,
                  source: toolNodeId,
                  target: fileNodeId,
                  type: 'file-touch',
                  turnId: msg.turnId,
                  timestamp: msg.timestamp,
                };
                graphStore.addEdge(fileEdge);
              }
            }
          }
        }

        const fileChanges = await db.loadFileChanges(session.sessionId);
        for (const fc of fileChanges) {
          if (fc.turnId > globalTurnOffset) globalTurnOffset = fc.turnId;

          const fileNodeId = fileNodes.get(fc.filePath);
          if (fileNodeId) {
            const existing = graphStore.nodes.get(fileNodeId);
            graphStore.updateNode(fileNodeId, {
              linesAdded: (existing?.linesAdded ?? 0) + fc.linesAdded,
              linesRemoved: (existing?.linesRemoved ?? 0) + fc.linesRemoved,
            });
          } else {
            const newFileNodeId = `file:${fc.filePath}`;
            const fileNode: GraphNode = {
              id: newFileNodeId,
              type: 'file',
              label: fc.filePath.split('/').pop() || fc.filePath,
              x: 0,
              y: 0,
              vx: 0,
              vy: 0,
              pinned: false,
              filePath: fc.filePath,
              linesAdded: fc.linesAdded,
              linesRemoved: fc.linesRemoved,
              turnId: fc.turnId,
              groupIndex,
            };
            graphStore.addNode(fileNode);
            fileNodes.set(fc.filePath, newFileNodeId);
          }
        }
      }
    }

    graphStore.maxTurn = globalTurnOffset;
    graphStore.currentTurn = globalTurnOffset;
    graphStore.isLive = false;
  }

  // ── Live multi-session mode: subscribe to events across all sessions ──

  function startLiveMultiGraph(): () => void {
    graphStore.isLive = true;

    const liveFileNodes = new Map<string, string>();
    const liveToolIndex = new Map<string, number>();

    // Collect existing file nodes
    for (const node of graphStore.nodes.values()) {
      if (node.type === 'file' && node.filePath) {
        liveFileNodes.set(node.filePath, node.id);
      }
    }

    function onStatusChanged(e: { agentId: string; status: AgentStatus; activity: string }) {
      const nodeId = `agent:${e.agentId}`;
      if (graphStore.nodes.has(nodeId)) {
        graphStore.updateNode(nodeId, { status: e.status });
      }
    }

    function onFileChanged(e: { sessionId: string; filePath: string; diff: any }) {
      const turnId = graphStore.maxTurn + 1;
      graphStore.maxTurn = turnId;
      graphStore.currentTurn = turnId;

      const agentNodeId = `agent:${e.sessionId}`;

      // Inherit groupIndex from the agent node if it exists
      const agentNode = graphStore.nodes.get(agentNodeId);
      const groupIndex = agentNode?.groupIndex;

      const idx = liveToolIndex.get(e.sessionId) ?? 0;
      liveToolIndex.set(e.sessionId, idx + 1);
      const toolName = e.diff?.linesRemoved > 0 ? 'Edit' : 'Write';
      const toolNodeId = `tool:${e.sessionId}:${turnId}:${idx}`;
      graphStore.addNode({
        id: toolNodeId,
        type: 'tool',
        label: toolName,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        pinned: false,
        toolName,
        toolInput: { file_path: e.filePath },
        turnId,
        parentNodeId: agentNodeId,
        groupIndex,
      });

      graphStore.addEdge({
        id: `tool-call:${agentNodeId}->${toolNodeId}`,
        source: agentNodeId,
        target: toolNodeId,
        type: 'tool-call',
        label: toolName,
        turnId,
        animated: true,
      });

      let fileNodeId = liveFileNodes.get(e.filePath);
      if (!fileNodeId) {
        fileNodeId = `file:${e.filePath}`;
        graphStore.addNode({
          id: fileNodeId,
          type: 'file',
          label: e.filePath.split('/').pop() || e.filePath,
          x: 0,
          y: 0,
          vx: 0,
          vy: 0,
          pinned: false,
          filePath: e.filePath,
          linesAdded: e.diff?.linesAdded ?? 0,
          linesRemoved: e.diff?.linesRemoved ?? 0,
          turnId,
          groupIndex,
        });
        liveFileNodes.set(e.filePath, fileNodeId);
      } else {
        const existing = graphStore.nodes.get(fileNodeId);
        graphStore.updateNode(fileNodeId, {
          linesAdded: (existing?.linesAdded ?? 0) + (e.diff?.linesAdded ?? 0),
          linesRemoved: (existing?.linesRemoved ?? 0) + (e.diff?.linesRemoved ?? 0),
          turnId,
        });
      }

      graphStore.addEdge({
        id: `file-touch:${toolNodeId}->${fileNodeId}`,
        source: toolNodeId,
        target: fileNodeId,
        type: 'file-touch',
        turnId,
        animated: true,
      });
    }

    function onDelegationStarted(e: { role: string; task: string; parentSessionId?: string }) {
      const turnId = graphStore.maxTurn + 1;
      graphStore.maxTurn = turnId;
      graphStore.currentTurn = turnId;

      // Determine parent agent node — use parentSessionId if available
      const parentNodeId = e.parentSessionId
        ? `agent:${e.parentSessionId}`
        : undefined;

      // Inherit groupIndex from parent
      const parentNode = parentNodeId ? graphStore.nodes.get(parentNodeId) : undefined;
      const groupIndex = parentNode?.groupIndex;

      const childNodeId = `agent:delegation-${turnId}`;
      graphStore.addNode({
        id: childNodeId,
        type: 'agent',
        label: `${e.role}: ${e.task.substring(0, 40)}`,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        pinned: false,
        status: 'working',
        turnId,
        parentNodeId,
        groupIndex,
      });

      if (parentNodeId) {
        graphStore.addEdge({
          id: `delegation:${parentNodeId}->${childNodeId}`,
          source: parentNodeId,
          target: childNodeId,
          type: 'delegation',
          label: e.role,
          turnId,
          animated: true,
        });
      }
    }

    function onSessionCreated(e: { sessionId: string; parentSessionId?: string }) {
      const realNodeId = `agent:${e.sessionId}`;

      // If the agent node already exists (from replay), just update it
      if (graphStore.nodes.has(realNodeId)) {
        graphStore.updateNode(realNodeId, { status: 'working' });
        return;
      }

      // Try to match a pending delegation placeholder
      // Look for placeholder agent nodes (id starts with 'agent:delegation-') without a sessionId
      let matched = false;
      for (const node of graphStore.nodes.values()) {
        if (node.type === 'agent' && node.id.startsWith('agent:delegation-') && !node.sessionId) {
          const placeholderId = node.id;

          graphStore.removeNode(placeholderId);
          graphStore.addNode({
            ...node,
            id: realNodeId,
            sessionId: e.sessionId,
          });

          // Re-create delegation edge with real target
          if (node.parentNodeId) {
            graphStore.addEdge({
              id: `delegation:${node.parentNodeId}->${realNodeId}`,
              source: node.parentNodeId,
              target: realNodeId,
              type: 'delegation',
              label: node.label,
              turnId: node.turnId ?? 0,
              animated: true,
            });
          }

          matched = true;
          break;
        }
      }

      // If no placeholder matched, create a new agent node
      if (!matched) {
        const parentNodeId = e.parentSessionId
          ? `agent:${e.parentSessionId}`
          : undefined;
        const parentNode = parentNodeId ? graphStore.nodes.get(parentNodeId) : undefined;

        graphStore.addNode({
          id: realNodeId,
          type: 'agent',
          label: 'agent',
          x: 0,
          y: 0,
          vx: 0,
          vy: 0,
          pinned: false,
          sessionId: e.sessionId,
          status: 'working',
          turnId: graphStore.maxTurn,
          parentNodeId,
          groupIndex: parentNode?.groupIndex,
        });

        if (parentNodeId) {
          graphStore.addEdge({
            id: `delegation:${parentNodeId}->${realNodeId}`,
            source: parentNodeId,
            target: realNodeId,
            type: 'delegation',
            turnId: graphStore.maxTurn,
            animated: true,
          });
        }
      }
    }

    function onSessionFinished(e: { sessionId: string; exitCode: number }) {
      const nodeId = `agent:${e.sessionId}`;
      if (graphStore.nodes.has(nodeId)) {
        const turnId = graphStore.maxTurn + 1;
        graphStore.maxTurn = turnId;
        graphStore.currentTurn = turnId;

        graphStore.updateNode(nodeId, {
          status: e.exitCode === 0 ? 'done' : 'error',
        });

        const agentNode = graphStore.nodes.get(nodeId);
        const milestoneId = `milestone:${e.sessionId}:${turnId}`;
        graphStore.addNode({
          id: milestoneId,
          type: 'milestone',
          label: e.exitCode === 0 ? 'done' : 'failed',
          status: e.exitCode === 0 ? 'done' : 'error',
          x: 0,
          y: 0,
          vx: 0,
          vy: 0,
          pinned: false,
          turnId,
          parentNodeId: nodeId,
          groupIndex: agentNode?.groupIndex,
        });
      }
    }

    engineBus.on('agent:statusChanged', onStatusChanged);
    engineBus.on('diff:fileChanged', onFileChanged);
    engineBus.on('orchestrator:delegationStarted', onDelegationStarted);
    engineBus.on('session:created', onSessionCreated);
    engineBus.on('session:finished', onSessionFinished);

    return () => {
      engineBus.off('agent:statusChanged', onStatusChanged);
      engineBus.off('diff:fileChanged', onFileChanged);
      engineBus.off('orchestrator:delegationStarted', onDelegationStarted);
      engineBus.off('session:created', onSessionCreated);
      engineBus.off('session:finished', onSessionFinished);
    };
  }

  return { buildFromHistory, startLiveGraph, buildMultiSessionGraph, startLiveMultiGraph };
}
