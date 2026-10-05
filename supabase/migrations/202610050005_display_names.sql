begin;
update public.league_memberships m set display_name=n.name
from public.teams t, (values
 (1,'Cooper Gurrie'),(2,'Zach Merkle'),(3,'Rob Isper'),(4,'Hardik Bhardwaj'),
 (5,'RJ McCandless'),(6,'Eyal Arkin'),(7,'Phillip Woodings'),(8,'Nelson Barboza'),
 (9,'Jack Beauchamp'),(10,'Ayush (Yush) Dutta'),(11,'Ben King'),(12,'Michael Schifano (Schif)')
) as n(roster_id,name)
where m.team_id=t.id and t.roster_id=n.roster_id and t.league_id='13121261-5398-4391-8240-000000000003';
commit;
