// Fixed-source image proxy lets exports embed public Sleeper avatars without CORS failures.
export async function GET(request: Request) {
  const path = new URL(request.url).searchParams.get("path") ?? "";
  if (
    !/^\/(avatars\/[a-zA-Z0-9]{16,64}|uploads\/[a-zA-Z0-9]{16,64}\.(jpg|jpeg|png|webp))$/.test(
      path,
    )
  )
    return new Response("Invalid avatar path.", { status: 400 });
  try {
    const source = await fetch(`https://sleepercdn.com${path}`, {
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
    const type = source.headers.get("content-type") ?? "";
    if (!source.ok || !/^image\/(jpeg|png|webp)/.test(type))
      return new Response("Avatar unavailable.", { status: 404 });
    const bytes = await source.arrayBuffer();
    if (bytes.byteLength > 2_000_000)
      return new Response("Avatar too large.", { status: 413 });
    return new Response(bytes, {
      headers: {
        "content-type": type,
        "cache-control": "public, max-age=86400",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return new Response("Avatar unavailable.", { status: 502 });
  }
}
