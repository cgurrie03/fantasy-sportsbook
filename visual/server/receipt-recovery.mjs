import { snapshotQuery as legacySnapshotQuery } from '../../scripts/financial-recovery.mjs';

// Portable DEV export: restore receipts inline, so dictionary IDs never escape
// their original database. The legacy formats and production exporter stay intact.
export function snapshotQuery(publicKey, options = {}) {
  if (options.projectRef !== 'whlcnlacueweaqpsupqs') throw Error('Dev project required');
  const query = legacySnapshotQuery(publicKey, options);
  const source = 'from "public"."ticket_legs" r ';
  if (query.split(source).length !== 2) throw Error('Recovery query contract changed');
  return query.replace(source, `from (
    select l.*, sportsbook_private.expand_receipt_context(l.settlement_context,l.context_bundle_id) as expanded_context
    from public.ticket_legs l
  ) source_row cross join lateral jsonb_populate_record(null::public.ticket_legs,
    (to_jsonb(source_row)-'expanded_context') || jsonb_build_object(
      'settlement_context',source_row.expanded_context,'context_bundle_id',null)) r `);
}
