export type ExportPage={rows?:unknown[];tickets?:unknown[];total?:number;next?:Record<string,unknown>|null;revision?:string};
export async function collectReportRows(read:(cursor:Record<string,unknown>|null)=>Promise<ExportPage>,signal:AbortSignal,isCurrent=()=>true){
 const rows:unknown[]=[];let cursor:Record<string,unknown>|null=null,total:number|undefined,revision:string|undefined,bytes=0;
 const cursors=new Set<string>();
 for(let page=0;page<1000;page++){
  signal.throwIfAborted();if(!isCurrent())throw new Error('Report filters changed. Export canceled.');
  const response=await read(cursor);signal.throwIfAborted();
  if(!isCurrent())throw new Error('Report filters changed. Export canceled.');
  if(!Number.isSafeInteger(response.total)||Number(response.total)<0)throw new Error('Export total is unavailable.');
  if(total===undefined){total=response.total;revision=response.revision;}
  if(response.total!==total||response.revision!==revision)throw new Error('Report records changed. Refresh and export again.');
  const items=response.rows??response.tickets;
  if(!Array.isArray(items)||items.length>50)throw new Error('Export page is incomplete.');
  bytes+=new TextEncoder().encode(JSON.stringify(items)).length;rows.push(...items);
  if(bytes>10*1024*1024||rows.length>20000)throw new Error('Export exceeds its size budget. Choose a narrower member or period filter.');
  if(!response.next){if(rows.length!==total)throw new Error('Export is incomplete. No partial file was downloaded.');return rows;}
  const next=JSON.stringify(response.next);
  if(!items.length||cursors.has(next))throw new Error('Export cursor did not advance. Refresh the report.');
  cursors.add(next);cursor=response.next;
 }
 throw new Error('Export page budget exceeded. Choose narrower filters.');
}
