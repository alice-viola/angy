export interface SearchResult { id: string; score: number; highlight: string; }
export interface SearchOptions { page: number; limit: number; sortBy?: string; }
