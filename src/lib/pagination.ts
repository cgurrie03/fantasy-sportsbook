export async function readAllRows(
  query: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown[] | null; error: unknown }>,
) {
  const data: unknown[] = [];
  for (let from = 0; ; from += 1000) {
    const page = await query(from, from + 999);
    if (page.error) throw page.error;
    data.push(...(page.data ?? []));
    if ((page.data?.length ?? 0) < 1000) return { data, error: null };
  }
}
