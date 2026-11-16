import type { DuplexMode } from '@/types/printer'

export const DUPLEX_LABELS: Record<DuplexMode, string> = {
  Simplex: 'Single-sided',
  DuplexLongEdge: 'Flip on long edge',
  DuplexShortEdge: 'Flip on short edge',
}
