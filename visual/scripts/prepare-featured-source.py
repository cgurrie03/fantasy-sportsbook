from pathlib import Path
import json,urllib.request,concurrent.futures
p=Path('visual/src/data.json');d=json.loads(p.read_text(encoding='utf-8'));L=d['leagueId']
def get(u):
 with urllib.request.urlopen(u,timeout=30) as r:return json.load(r)
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as e: lg,rs,us=list(e.map(get,[f'https://api.sleeper.app/v1/league/{L}',f'https://api.sleeper.app/v1/league/{L}/rosters',f'https://api.sleeper.app/v1/league/{L}/users']))
participants=[]
for t in d['teams']:
 roster=next(r for r in rs if r['roster_id']==t['roster_id']);div=roster.get('settings',{}).get('division');
 for n in t['managers']:
  u=next((u for u in us if n.lower() in [str(u.get('username','')).lower(),str(u.get('display_name','')).lower()]),None)
  if not u:raise Exception('Participant mapping missing: '+n)
  participants.append({'id':u['user_id'],'name':n,'roster':t['roster_id'],'division':div,'avatar':u.get('avatar')})
championship=None
finalists=[];prev=lg.get('previous_league_id')
if prev:
 with concurrent.futures.ThreadPoolExecutor(max_workers=4) as e:br,old,oldusers,previous_info=list(e.map(get,[f'https://api.sleeper.app/v1/league/{prev}/winners_bracket',f'https://api.sleeper.app/v1/league/{prev}/rosters',f'https://api.sleeper.app/v1/league/{prev}/users',f'https://api.sleeper.app/v1/league/{prev}']))
 if br:
  final=next((r for r in br if r.get('r')==max(r.get('r',0) for r in br) and r.get('p',1)==1),None)
  if final:
   for rid in [final.get('t1'),final.get('t2')]:
    oldr=next((r for r in old if r['roster_id']==rid),None)
    match=next((r for r in rs if oldr and r.get('owner_id') and r.get('owner_id')==oldr.get('owner_id')),None)
    if match:finalists.append(match['roster_id'])
 if br and final and final.get('w') and final.get('l'):
  def identity(rid):
   oldr=next((r for r in old if r['roster_id']==rid),None)
   user=next((u for u in oldusers if oldr and u['user_id']==oldr.get('owner_id')),None)
   current=next((r for r in rs if oldr and r.get('owner_id')==oldr.get('owner_id')),None)
   return {'roster':current['roster_id'] if current else None,'name':(user.get('metadata') or {}).get('team_name') or user.get('display_name') or user.get('username')} if user else None
  winner,runner=identity(final['w']),identity(final['l'])
  if winner and runner:championship={'season':int(previous_info['season']),'champion':winner,'runnerUp':runner}
 if len(set(finalists))!=2:finalists=[]
out={'participants':participants,'divisions':{k:v for k,v in (lg.get('metadata') or {}).items() if k.startswith('division_')},'playoffTeams':lg.get('settings',{}).get('playoff_teams'),'previousFinalists':finalists,'sourceLeague':L,'previousLeague':prev,'previousChampionship':championship,'note':'Read-only Sleeper participants/divisions and owner-mapped prior championship finalists. No injury, score or roster history added.'}
Path('visual/src/featured-source.json').write_text(json.dumps(out,indent=2),encoding='utf-8');print('participants',len(participants),'division ids',sorted(set(str(p['division']) for p in participants)),'finalists',finalists,'playoffs',out['playoffTeams'])
