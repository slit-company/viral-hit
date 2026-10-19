/** datetime-local represents the browser's local zone; persisted schedules keep an explicit UTC instant. */
export function localPublicationDate(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
