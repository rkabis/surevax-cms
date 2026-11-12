/**
 * Deterministic HSL color for an initials avatar.
 * Same input always returns the same color; HSL gives uniform apparent brightness
 * (dio.la "Colorful avatars" + XEP-0392 Consistent Color Generation).
 *
 * Use: const bg = avatarColor(patient.id) // → 'hsl(217 65% 55%)'
 */
export function avatarColor(seed: string): string {
  // djb2-style hash → hue 0-359
  let hash = 5381
  for (let i = 0; i < seed.length; i++) hash = ((hash << 5) + hash + seed.charCodeAt(i)) | 0
  const hue = ((hash % 360) + 360) % 360
  return `hsl(${hue} 65% 55%)`
}
