import { ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { getDatabase } from './sessions'
import type { GlobalSummary, CostByDay, ModelUsage, SessionsByMode, EpicThroughput, ComplexityStats, ProjectCostSummary, EpicAnalyticsDetail } from '@/engine/AnalyticsTypes'

export const useAnalyticsStore = defineStore('analytics', () => {
  const loading = ref(false)
  const initialLoaded = ref(false)
  const timeRange = ref<'7d' | '30d' | '90d' | 'all'>('30d')
  const selectedProjectId = ref<string | null>(null)

  const globalSummary = ref<GlobalSummary | null>(null)
  const costByDay = ref<CostByDay[]>([])
  const modelUsage = ref<ModelUsage[]>([])
  const sessionsByMode = ref<SessionsByMode[]>([])
  const epicThroughput = ref<EpicThroughput[]>([])
  const complexityStats = ref<ComplexityStats[]>([])
  const projectSummaries = ref<ProjectCostSummary[]>([])
  const epicsDetail = ref<EpicAnalyticsDetail[]>([])

  async function loadAll() {
    loading.value = true
    try {
      const db = getDatabase()
      const days = timeRange.value === '7d' ? 7 : timeRange.value === '30d' ? 30 : timeRange.value === '90d' ? 90 : 3650
      const pid = selectedProjectId.value
      const weeks = Math.max(1, Math.ceil(days / 7))
      const log = (label: string) => (err: unknown) => {
        console.warn(`[Analytics] ${label} failed:`, err)
      }
      await Promise.all([
        db.getAnalyticsGlobalSummary(days, pid).then(r => { globalSummary.value = r }).catch(log('globalSummary')),
        db.getAnalyticsCostByDay(days, pid).then(r => { costByDay.value = r }).catch(log('costByDay')),
        db.getAnalyticsModelUsage(days, pid).then(r => { modelUsage.value = r }).catch(log('modelUsage')),
        db.getAnalyticsSessionsByMode(days).then(r => { sessionsByMode.value = r }).catch(log('sessionsByMode')),
        db.getAnalyticsEpicThroughput(weeks, pid).then(r => { epicThroughput.value = r }).catch(log('epicThroughput')),
        db.getAnalyticsComplexityStats(days, pid).then(r => { complexityStats.value = r }).catch(log('complexityStats')),
        db.getAnalyticsProjectSummaries(days).then(r => { projectSummaries.value = r }).catch(log('projectSummaries')),
        db.getAnalyticsEpicsDetail(pid, 50, 0, days).then(r => { epicsDetail.value = r }).catch(log('epicsDetail')),
      ])
    } finally {
      loading.value = false
      initialLoaded.value = true
    }
  }

  watch([timeRange, selectedProjectId], () => loadAll())

  return {
    loading, initialLoaded, timeRange, selectedProjectId,
    globalSummary, costByDay, modelUsage, sessionsByMode,
    epicThroughput, complexityStats, projectSummaries, epicsDetail,
    loadAll,
  }
})
