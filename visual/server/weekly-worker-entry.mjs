import { POST } from "../../api/weekly-worker.ts";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const request = new Request(new URL(req.url, "https://dev.sportsbook.coopergurrie.com"), {
    method: "POST",
    headers: req.headers,
  });
  const response = await POST(request);
  for (const [name, value] of response.headers) res.setHeader(name, value);
  return res.status(response.status).send(await response.text());
}
