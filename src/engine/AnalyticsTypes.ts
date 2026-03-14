export interface GlobalSummary {
  total_cost_usd: number
  total_input_tokens: number
  total_output_tokens: number
  total_sessions: number
  total_epics: number
  total_projects: number
  completed_epics: number
  active_epics: number
}

export interface CostByDay {
  day: string          // 'YYYY-MM-DD'
  cost_usd: number
  input_tokens: number
  output_tokens: number
}

export interface ModelUsage {
  model: string
  epic_count: number
  cost_usd: number
  total_tokens: number
}

export interface SessionsByMode {
  mode: string
  session_count: number
  total_cost_usd: number
}

export interface EpicThroughput {
  week: string         // 'YYYY-WW' via strftime('%Y-%W')
  started: number
  completed: number
}

export interface ComplexityStats {
  complexity: string
  epic_count: number
  avg_cost_usd: number
  avg_duration_hours: number
  completion_rate: number
}

export interface ProjectCostSummary {
  project_id: string
  project_name: string
  project_color: string
  total_cost_usd: number
  epic_count: number
  completed_epics: number
}

export interface EpicAnalyticsDetail {
  id: string
  title: string
  project_id: string
  project_name: string
  status: string
  complexity: string
  total_cost_usd: number
  input_tokens: number
  output_tokens: number
  created_at: string
  completed_at: string | null
  duration_hours: number | null
}
