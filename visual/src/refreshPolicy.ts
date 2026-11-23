// Keep successful refreshes at one minute; failed requests back off without
// overlapping. The clock is supplied so outage/recovery behavior is testable.
export function createRefreshGate() {
 let busy=false,failures=0,nextAttempt=0,lastAttempt=-Infinity;
 return {
  begin(now:number,hidden=false,placing=false) {
   if(hidden||placing||busy||now<nextAttempt||now-lastAttempt<5000)return false;
   busy=true;lastAttempt=now;return true;
  },
  finish(now:number,succeeded:boolean) {
   busy=false;
   if(succeeded){failures=0;nextAttempt=0;}
   else{failures=Math.min(failures+1,4);nextAttempt=now+Math.min(300000,60000*2**(failures-1));}
  },
 };
}
