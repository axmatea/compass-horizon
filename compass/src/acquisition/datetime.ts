export function localDateTime(iso: string): string {
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 19);
}

// Preserve milliseconds until the user actually changes the local date/time control.
export function occurrenceTime(displayed: string, originalIso: string): string {
  return displayed === localDateTime(originalIso)
    ? originalIso
    : new Date(displayed).toISOString();
}
