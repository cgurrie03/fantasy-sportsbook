from pathlib import Path
import json,urllib.request,concurrent.futures,datetime
root=Path('visual');data=json.loads((root/'src/data.json').read_text(encoding='utf-8'));players=json.loads((root/'src/players.json').read_text(encoding='utf-8'))
def get(url):
 with urllib.request.urlopen(url,timeout=30) as r:return json.load(r)
L=data['leagueId']; week=data['week'];urls=[f'https://api.sleeper.app/v1/league/{L}/matchups/{w}' for w in range(1,week+1)]
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as e: weeks=list(e.map(get,urls))
scoreboard=get(f'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week={week}&year={data["season"]}&seasontype=2')
active={c['team']['abbreviation'] for event in scoreboard.get('events',[]) for c in event['competitions'][0]['competitors']};aliases={'JAC':'JAX','WSH':'WAS'};active|={aliases.get(x,x) for x in active}
assert active,'No schedule returned'
# Retain only bounded team scores, never full weekly roster/player payloads.
rows=[]
for w,items in enumerate(weeks,1):
 for r in items:
  if r.get('matchup_id') is None:continue
  opp=next((o for o in items if o.get('matchup_id')==r['matchup_id'] and o['roster_id']!=r['roster_id']),None)
  if opp is None:continue
  rows.append({'week':w,'roster':r['roster_id'],'opponent':opp['roster_id'],'points':r.get('custom_points') if r.get('custom_points') is not None else r['points'],'against':opp.get('custom_points') if opp.get('custom_points') is not None else opp['points']})
for r in data['finalScores']:
 actual=next(x for x in rows if x['week']==week and x['roster']==r['roster']);assert abs(actual['points']-r['points'])<.011,'Archive changed'
bye=[{'id':p['id'],'roster':p['roster'],'name':p['name'],'position':p['position'],'nflTeam':p['nflTeam']} for p in players if p.get('nflTeam') and p['nflTeam'] not in active]
out={'throughWeek':week,'season':data['season'],'rows':rows,'byePlayers':bye,'injuryReportAvailable':False,'historicalLinesAvailable':False,'sources':{'matchups':'https://docs.sleeper.com/#getting-matchups-in-a-league','schedule':f'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week={week}&year={data["season"]}&seasontype=2'},'note':'Bounded archived visual fixture. No current injury status mixed into historical Week 8.'}
(root/'src/season-context.json').write_text(json.dumps(out,ensure_ascii=True,separators=(',',':')),encoding='utf-8');print('rows',len(rows),'bye players',len(bye),'bytes',(root/'src/season-context.json').stat().st_size)
