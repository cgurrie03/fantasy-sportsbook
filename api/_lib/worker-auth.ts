import { timingSafeEqual } from "node:crypto";
export function isWorker(request: Request) {
  if (process.env.BOFF_ENVIRONMENT === "development" &&
      (process.env.BOFF_AUTOMATION_MODE !== "manual" ||
       request.headers.get("x-boff-manual-run") !== "true")) return false;
  const expected = process.env.WEEKLY_WORKER_SECRET;
  const supplied = request.headers.get("x-worker-secret");
  return Boolean(
    expected &&
    supplied &&
    Buffer.byteLength(expected) === Buffer.byteLength(supplied) &&
    timingSafeEqual(Buffer.from(expected), Buffer.from(supplied)),
  );
}
