const zone = 'America/New_York';
export function easternTime(date: Date) {
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:zone,weekday:'short',hour:'numeric',hourCycle:'h23'}).formatToParts(date);
 return {day:parts.find(p=>p.type==='weekday')!.value,hour:Number(parts.find(p=>p.type==='hour')!.value)};
}
export function weekOpens(firstGameDate: string) {
 const day=new Date(firstGameDate+'T00:00:00Z');
 day.setUTCDate(day.getUTCDate()-(day.getUTCDay()+5)%7);
 day.setUTCHours(5,0,0,0);
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'numeric',day:'numeric',hour:'numeric',hourCycle:'h23'}).formatToParts(day);
 const n=(type:string)=>Number(parts.find(p=>p.type===type)!.value);
 const offset=Date.UTC(n('year'),n('month')-1,n('day'),n('hour'))-day.getTime();
 return day.getTime()-offset;
}
export function marketWeek(schedule: {week:number;date:string}[], providerWeek:number, now:number) {
 const weeks=new Map<number,string>();
 for(const game of schedule) {
  if(!Number.isInteger(game.week)||!/^\d{4}-\d{2}-\d{2}$/.test(game.date))continue;
  if(!weeks.has(game.week)||game.date<weeks.get(game.week)!)weeks.set(game.week,game.date);
 }
 const eligible=[...weeks].filter(([week,date])=>week<=providerWeek+1&&weekOpens(date)<=now).map(([week])=>week);
 if(!eligible.length) return providerWeek;
 return Math.max(...eligible);
}
