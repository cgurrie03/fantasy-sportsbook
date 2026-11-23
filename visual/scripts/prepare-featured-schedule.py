from pathlib import Path
import json,urllib.request,concurrent.futures
f=json.loads(Path('visual/src/data.json').read_text(encoding='utf-8'));hist=json.loads(Path('visual/src/season-context.json').read_text(encoding='utf-8'));weeks=[]
for w in range(1,f['week']+1):
 pairs={tuple(sorted([r['roster'],r['opponent']])) for r in hist['rows'] if r['week']==w};weeks.append({'week':w,'pairs':[list(p) for p in sorted(pairs)]})
def fetch(w):
 with urllib.request.urlopen(f'https://api.sleeper.app/v1/league/{f["leagueId"]}/matchups/{w}',timeout=30) as r: rows=json.load(r)
 groups={}
 for row in rows or []:
  if row.get('matchup_id') is not None:groups.setdefault(row['matchup_id'],[]).append(row['roster_id'])
 return {'week':w,'pairs':[sorted(ids) for ids in groups.values() if len(ids)==2]}
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as e:weeks+=list(e.map(fetch,range(f['week']+1,f['regularSeasonWeeks']+1)))
Path('visual/src/featured-schedule.json').write_text(json.dumps({'leagueId':f['leagueId'],'season':f['season'],'weeks':weeks,'source':'Sleeper weekly matchup pairs only; no future scores, odds, lineups or player history retained.'},separators=(',',':')),encoding='utf-8')
print([(w['week'],len(w['pairs'])) for w in weeks]);print('bytes',Path('visual/src/featured-schedule.json').stat().st_size)
