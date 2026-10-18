export type TaskStatus = 'pending'|'running'|'completed'|'failed'|'cancelled'|'interrupted';
export type Mode = 'read_only'|'write';
export interface TaskInput { task: string; workspace: string; acceptance_criteria: string[]; timeout: number; mode: Mode; allow_dependency_install?: boolean; allow_expensive_commands?: boolean; allow_deletion?: boolean; }
export interface TaskRecord { task_id: string; status: TaskStatus; created_at: string; started_at?: string; ended_at?: string; duration_ms?: number; latest_progress?: string; error?: string; input: TaskInput; worktree?: string; worker_pid?: number; agent_pid?: number; result?: TaskResult; }
export interface TaskResult { success: boolean; final_reply: string; modified_files: string[]; diff: string; test_results: string[]; error?: string; logs: {events: string; stderr: string}; duration_ms: number; base_commit?: string; limitations?: string[]; }
