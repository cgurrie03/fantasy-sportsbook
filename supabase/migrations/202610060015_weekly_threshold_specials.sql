begin;
alter table public.sportsbook_markets drop constraint sportsbook_markets_kind_check;
alter table public.sportsbook_markets add constraint sportsbook_markets_kind_check
 check(kind in ('spread','moneyline','match_total','team_total','player_points','weekly_high','weekly_low','weekly_count_150','weekly_any_below_100','weekly_any_200'));

-- Persist rounded prices, so displayed odds and accepted payout math agree.
create function sportsbook_private.round_special_odds() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.kind like 'weekly_%' then
  new.odds:=sign(new.odds)*greatest(100,round(abs(new.odds)/10.0)*10);
 end if;
 return new;
end $$;
revoke all on function sportsbook_private.round_special_odds() from public,anon,authenticated;
create trigger round_special_odds before insert or update of odds,kind on public.sportsbook_markets
 for each row execute function sportsbook_private.round_special_odds();

-- Preserve descriptive ticket types without replacing the placement transaction.
create function sportsbook_private.label_weekly_special() returns trigger
language plpgsql set search_path='' as $$
begin
 case new.settlement_context->>'kind'
  when 'weekly_count_150' then new.market_type:='Teams Scoring 150+';
  when 'weekly_any_below_100' then new.market_type:='Any Team Below 100';
  when 'weekly_any_200' then new.market_type:='Any Team Scoring 200+';
  else null;
 end case;
 return new;
end $$;
revoke all on function sportsbook_private.label_weekly_special() from public,anon,authenticated;
create trigger label_weekly_special before insert on public.ticket_legs
 for each row execute function sportsbook_private.label_weekly_special();
commit;
