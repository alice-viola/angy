export const accentColors = ['#f59e0b', '#10b981', '#22d3ee', '#cba6f7', '#89b4fa', '#FF6B8A']

export const gridColor = 'rgba(255,255,255,0.04)'
export const tickColor = '#64748b'
export const axisLabelColor = '#94a3b8'

export const tooltipDefaults = {
  backgroundColor: '#1c1f2a',
  titleColor: '#e2e8f0',
  bodyColor: '#94a3b8',
  borderColor: 'rgba(255,255,255,0.08)',
  borderWidth: 1,
  cornerRadius: 8,
  padding: 10,
  titleFont: { family: 'Inter', weight: 'bold' as const, size: 12 },
  bodyFont: { family: 'Inter', size: 11 },
  displayColors: true,
  boxPadding: 4,
}

export const legendDefaults = {
  labels: {
    color: '#94a3b8',
    font: { family: 'Inter', size: 10 },
    boxWidth: 10,
    boxHeight: 10,
    borderRadius: 2,
    padding: 12,
    usePointStyle: true,
    pointStyle: 'rectRounded' as const,
  },
  position: 'bottom' as const,
}
