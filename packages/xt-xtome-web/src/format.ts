export function formatDuration(durationMs: number | null): string {
  if (durationMs === null) {
    return "—";
  }
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function formatWhen(value: string): string {
  return new Date(value).toLocaleString();
}
