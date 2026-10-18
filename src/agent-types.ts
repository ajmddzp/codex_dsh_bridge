export type AgentMode = 'read_only' | 'write';
export type AgentStatus = 'idle' | 'running' | 'closed';

export interface AgentRecord {
  agent_id: string;
  workspace: string;
  role: string;
  initial_context?: string;
  mode: AgentMode;
  status: AgentStatus;
  created_at: string;
  updated_at: string;
  session_id?: string;
  turns: number;
  current_turn?: number;
  worker_pid?: number;
  harness_pid?: number;
  latest_progress?: string;
  latest_reply?: string;
  latest_error?: string;
}

export interface AgentTurn {
  turn: number;
  message: string;
  timeout_seconds: number;
  allow_dependency_install?: boolean;
  allow_expensive_commands?: boolean;
  allow_deletion?: boolean;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  started_at: string;
  ended_at?: string;
  session_id?: string;
  reply?: string;
  error?: string;
  events_path?: string;
  stderr_path?: string;
}
