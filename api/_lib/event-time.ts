export function exactEventTime(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !/T\d{2}:\d{2}.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)
  )
    return null;
  return Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : null;
}
export function formatEventTime(value: unknown) {
  if (typeof value !== "string") return "Game time unavailable";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)))
    return (
      new Intl.DateTimeFormat("en-US", {
        timeZone: "UTC",
        weekday: "short",
        month: "short",
        day: "numeric",
      }).format(new Date(value)) + " · Time TBD"
    );
  const exact = exactEventTime(value);
  return exact
    ? new Date(exact).toLocaleString("en-US", {
        timeZone: "America/New_York",
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }) + " ET"
    : "Game time unavailable";
}
export function formatGameInfo(value: unknown, kickoff?: unknown) {
  const text = typeof value === "string" ? value : "";
  const parts = text.match(/^(\d{4}-\d{2}-\d{2}(?:T\S+)?)(.*)$/);
  return parts
    ? `${parts[2].trim()} · ${formatEventTime(kickoff ?? parts[1])}`
    : `${text}${text ? " · " : ""}${formatEventTime(kickoff)}`;
}
export function displayProjection(value: unknown) {
  return value !== null &&
    value !== undefined &&
    value !== "" &&
    Number.isFinite(Number(value))
    ? Number(value).toFixed(1)
    : "Unavailable";
}
export function easternInstant(date: string, time: string) {
  let value = new Date(`${date}T${time}Z`);
  for (let i = 0; i < 3; i++) {
    const local = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .format(value)
      .replace(" ", "T");
    value = new Date(
      value.getTime() +
        (Date.parse(`${date}T${time}Z`) - Date.parse(local + "Z")),
    );
  }
  return value.toISOString();
}
export function upcomingSundayNoon(now = Date.now()) {
  const date = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const day = new Date(date + "T12:00:00Z");
  day.setUTCDate(day.getUTCDate() + ((7 - day.getUTCDay()) % 7));
  let value = easternInstant(day.toISOString().slice(0, 10), "12:00:00");
  if (Date.parse(value) <= now) {
    day.setUTCDate(day.getUTCDate() + 7);
    value = easternInstant(day.toISOString().slice(0, 10), "12:00:00");
  }
  return value;
}
