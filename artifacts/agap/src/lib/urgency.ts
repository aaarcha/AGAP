export function computeUrgencyScore(
  severity: number,
  vulnerability: number,
  locationRisk: number,
  timeSensitivity: number
): number {
  return (
    0.5 * severity +
    0.29 * vulnerability +
    0.11 * locationRisk +
    0.1 * timeSensitivity
  );
}

export type UrgencyBand = 'CRITICAL' | 'HIGH' | 'MODERATE' | 'RESOLVED';

export function getUrgencyBand(score: number, status: string): UrgencyBand {
  if (status === 'resolved') return 'RESOLVED';
  if (score >= 4.0) return 'CRITICAL';
  if (score >= 3.0) return 'HIGH';
  return 'MODERATE';
}

export function getRecommendedAgency(category: string): string {
  switch (category) {
    case 'fire':
      return 'Bureau of Fire Protection (BFP)';
    case 'medical':
      return 'Nearest Hospital/EMS';
    case 'flooding':
      return 'CDRRMO';
    case 'security':
      return 'Philippine National Police (PNP)';
    default:
      return 'CDRRMO / Barangay DRRM Desk';
  }
}

export function calculateTimeSensitivity(elapsedMinutes: number): number {
  if (elapsedMinutes < 2) return 5;
  if (elapsedMinutes <= 5) return 4;
  if (elapsedMinutes <= 15) return 3;
  return 2;
}

export function calculateLocationRisk(location: string): number {
  const loc = location.toLowerCase();
  if (loc.includes('library') || loc.includes('lab')) return 4;
  if (loc.includes('classroom') || loc.includes('rm ') || loc.includes('quadrangle')) return 3;
  if (loc.includes('canteen') || loc.includes('court') || loc.includes('hallway') || loc.includes('comfort room') || loc.includes('cr')) return 2;
  return 3;
}
