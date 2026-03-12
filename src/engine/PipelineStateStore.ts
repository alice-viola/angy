/**
 * PipelineStateStore — persistence layer for HybridPipelineRunner crash recovery.
 *
 * Checkpoints the full pipeline state to SQLite after every meaningful transition:
 *   - Phase changes (planning → implementing → finalizing)
 *   - Todo status changes (pending → in_progress → done/failed)
 *   - Plan extraction / fix-todo generation
 *   - Finalization cycle progression
 *
 * On recovery, the Scheduler loads the snapshot and the runner resumes from
 * the last checkpoint instead of restarting from scratch.
 */

import type { Database } from './Database';
import type { PipelineSnapshot, PipelinePhase, PersistedTodoState } from './types';
import { engineBus } from './EventBus';

export class PipelineStateStore {
  constructor(private db: Database) {}

  async checkpoint(state: PipelineSnapshot): Promise<void> {
    state.updatedAt = new Date().toISOString();
    await this.db.savePipelineState(state);

    const todosDone = state.todoQueue.filter(t => t.status === 'done').length;
    engineBus.emit('pipeline:stateCheckpointed', {
      epicId: state.epicId,
      phase: state.phase,
      todosDone,
      todosTotal: state.todoQueue.length,
    });
  }

  async load(epicId: string): Promise<PipelineSnapshot | null> {
    return this.db.loadPipelineState(epicId);
  }

  async remove(epicId: string): Promise<void> {
    await this.db.deletePipelineState(epicId);
  }

  async listRecoverable(): Promise<PipelineSnapshot[]> {
    return this.db.listRecoverablePipelines();
  }

  /**
   * Determine if a snapshot is resumable.
   * A snapshot is resumable if:
   *   1. It's in a non-terminal phase
   *   2. It has meaningful progress (plan extracted OR at least one todo done)
   */
  isResumable(snapshot: PipelineSnapshot): boolean {
    const terminalPhases: PipelinePhase[] = ['completed', 'failed', 'cancelled'];
    if (terminalPhases.includes(snapshot.phase)) return false;

    const hasPlan = snapshot.architectContext.length > 0;
    const hasTodoDone = snapshot.todoQueue.some(t => t.status === 'done');
    return hasPlan || hasTodoDone;
  }

  /**
   * Compute the resume point from a snapshot.
   * Returns which phase to resume from and what work to skip.
   */
  computeResumePoint(snapshot: PipelineSnapshot): {
    resumePhase: 'implementing' | 'finalizing';
    completedTodoIds: string[];
    pendingTodos: PersistedTodoState[];
  } {
    const completedTodoIds = snapshot.todoQueue
      .filter(t => t.status === 'done')
      .map(t => t.todo.id);

    // Reset any in_progress todos back to pending (they were interrupted)
    const pendingTodos = snapshot.todoQueue.map(t => ({
      ...t,
      status: t.status === 'in_progress' ? 'pending' as const : t.status,
    }));

    const allTodosDone = pendingTodos.every(t => t.status === 'done' || t.status === 'failed');

    return {
      resumePhase: allTodosDone ? 'finalizing' : 'implementing',
      completedTodoIds,
      pendingTodos,
    };
  }
}
