const leaguePath="/1312126153980391424";
export function pushTarget(kind:string,eventKey:string) {
 if(kind==="settled"||kind==="leg"){
  const ticket=eventKey.split(":")[1];
  if(ticket&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(ticket))
   return leaguePath+"/my-bets?ticket="+encodeURIComponent(ticket);
  return leaguePath+"/my-bets";
 }
 if(kind==="reward")return leaguePath+"/matchups?boosts=1";
 return leaguePath+"/matchups";
}
