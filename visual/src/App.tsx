import refreshedPlayers from "./players.json";
import {isDevelopment} from './environment';
import { sendBrowserNotification } from "./CommunicationsSettings";
import {live,bookRequest,bookSection, mergeBookUpdate,receipt,currentPick,auth} from "./live";
import {createRefreshGate} from "./refreshPolicy";
import { PostseasonPreview } from "./PostseasonPreview";
import { InteractionContext, selectionConflict } from "./InteractionPreview";
import { LiveDevBoard } from "./LiveDevBoard";
import { BalanceHistory, userBalance } from "./BalanceHistory";
import { TicketProgress } from "./TicketProgress";
import { RewardCards, type EarnedReward } from "./RewardOffers";
import { WeeklyOfferDetails, type WeeklyOffer } from "./WeeklyOffers";
import { fantasyRewards } from "../server/fantasy-rewards";
import { routeUrl, navigate, currentRoute, routeQuery, sharedTicketPath, sharedTicketId } from "./routing";
import { useEffect, useRef, useState } from "react";
import { Icon, Mark, Modal, Badge, Empty } from "./ui";
import {BoffScreen,StatusPanel} from "./BrandedState";
import {
  Avatar,
  ParticipantAvatar,
  MarketBoard,
  MatchupDetail,
  FuturesPage,
  LeagueAvatar,
} from "./Markets";
import {
  AccessPage,
  CommissionerPage,
  LeaguePage,
  Onboarding,
  PlatformPage,
  ProfilePage,
  TicketsPage,
} from "./AccountPages";
import {
  league,
  matchups,
  teams,
  profileTeam,
  offers,
  boosted,
  offerPrice,
  price,
  decimal,
  american,
  money,
  exampleTickets,
  ticketReturn,
  ticketOdds,
} from "./model";
import type { Pick, Ticket } from "./model";
import { getSettings } from "./settings";
import { Guide } from "./Guide";
import { GroupedPicks } from "./GroupedPicks";
import { NotificationBell, NotificationsFeed } from "./Notifications";
import { FeedbackForm } from "./Feedback";
import { HomePage } from "./Home";
const nav = [
  ["matchups", "ball", "Weekly Slate"],
  ["futures", "trophy", "Futures"],
  ["my-bets", "ticket", "My Bets"],
  ["all-bets", "list", "All Bets"],
  ["league", "people", "The League"],
];
const labels: Record<string, string> = {
  home: "Your Leagues",
  "league-unavailable": "League Unavailable",
  "not-found": "Page Not Found",
  matchups: "Weekly Slate",
  futures: "Season Futures",
  "my-bets": "My Bets",
  "all-bets": "All Bets",
  league: "The League",
  profile: "Profile",
  commissioner: "Commissioner",
  platform: "Platform Owner",
  setup: "League Setup",
  access: "Welcome",
};
export default function App() {
  const [interactionReview] = useState(() => new URLSearchParams(location.search).get("review") === "interactions");
  const [conflictPreview, setConflictPreview] = useState(true);
  const [postseasonView,setPostseasonView]=useState(() => new URLSearchParams(location.search).get("view") === "postseason");
  const [liveView,setLiveView] = useState(() => new URLSearchParams(location.search).get("view") === "live");
  const [route, setRoute] = useState(() => currentRoute());
  const [dark, setDark] = useState(
    () => localStorage.getItem("boff-visual-theme") === "dark",
  );
  const [selected, setSelected] = useState<Pick[]>([]);
  const [stake, setStake] = useState(String(getSettings().defaultStake));
  const [, setSettingsVersion] = useState(0);
  useEffect(() => {
    const refresh = () => {
      document.documentElement.dataset.density = getSettings().density;
      setSettingsVersion((v) => v + 1);
    };
    refresh();
    window.addEventListener("boff-settings-changed", refresh);
    return () => window.removeEventListener("boff-settings-changed", refresh);
  }, []);
  const [slipOpen, setSlipOpen] = useState(false);
  const [modal, setModal] = useState<string | null>(null);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>(exampleTickets);
  const [archiveError,setArchiveError]=useState(''),[archiveRetry,setArchiveRetry]=useState(0);
  const [summaryReady,setSummaryReady]=useState(''),[summaryError,setSummaryError]=useState(''),[summaryRetry,setSummaryRetry]=useState(0);
  const archiveKey=live()?`${live().board.nfl_season}:${live().board.market_week}`:'';
  useEffect(()=>{
    const context=live();
    if(!context||!(route==='matchups'||route.startsWith('matchup/'))||context.archiveKey===archiveKey)return;
    const controller=new AbortController();setArchiveError('');
    void bookSection({archive:'1'},controller.signal).then(data=>{
      if(controller.signal.aborted||live()?.user.id!==context.user.id)return;
      Object.assign(live(),data,{archiveKey});setSettingsVersion(v=>v+1);
    }).catch(error=>{if(!controller.signal.aborted)setArchiveError(error.message);});
    return()=>controller.abort();
  },[route,archiveKey,archiveRetry]);
  useEffect(()=>{
    if(!live()||!['platform','league'].includes(route))return;
    const context=live(),controller=new AbortController();setSummaryReady('');setSummaryError('');
    void(async()=>{
      try{
        let cursor:unknown=null;const rows=new Map<string,Ticket>();
        do{
          const data=await bookSection({history:'tickets',size:'100',...(cursor?{cursor:JSON.stringify(cursor)}:{})},controller.signal);
          if(controller.signal.aborted||live()?.user.id!==context.user.id)return;
          for(const row of data.tickets){const ticket=receipt(row,context);rows.set(ticket.id,ticket);}
          cursor=data.next;
        }while(cursor);
        setTickets([...rows.values()]);setSummaryReady(route);
      }catch(error){if(!controller.signal.aborted)setSummaryError((error as Error).message);}
    })();
    return()=>controller.abort();
  },[route,summaryRetry]);
  const canReviewPlatform = !live() || live().user.platformOwner === true;
  const canReviewLeague = !live() || live().user.commissioner === true;
  const [placing,setPlacing]=useState(false);
  const requestKey=useState(()=>({current:crypto.randomUUID()}))[0];
  const [toast, setToastText] = useState("");
  const [toastCycle, setToastCycle] = useState(0);
  const [toastFading, setToastFading] = useState(false);
  const setToast = (message: string) => {
    setToastText(message);
    setToastCycle((n) => n + 1);
  };
  const [updates, setUpdates] = useState<{ before: Pick; after: Pick }[]>([]);
  const pendingQuotes = updates.filter((u) =>
    selected.some((p) => p.id === u.before.id),
  );
  const [creditClaim, setCreditClaim] = useState<{
    balance: number;
    openNonFutures: number;
    openFutures: number;
    available: number;
    claimed: number | null;
    eligibleBalance: number;
    lastClaimAt: string | null;
    serverTime: string;
    nextWeeklyRefreshAt?: string;
  } | null>(null);
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimError, setClaimError] = useState("");
  const [claimClock, setClaimClock] = useState(Date.now());
  const [claimClockOffset, setClaimClockOffset] = useState(0);
  const claimRequest = useRef<string | null>(null);
  const claimMenu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    function closeOutside(event: PointerEvent) {
      const menu = claimMenu.current;
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target))
        menu.open = false;
    }
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);
  const balanceVersion = useRef(0);
  const placeInFlight = useRef(false);
  const availableBalance = live() ? Number(live().balance) : userBalance(profileTeam.manager, tickets);
  const weeklyClaimReady = creditClaim?.available === 50 || Boolean(
    creditClaim?.nextWeeklyRefreshAt
    && claimClock + claimClockOffset >= Date.parse(creditClaim.nextWeeklyRefreshAt),
  );
  const claimElapsed = weeklyClaimReady ? Infinity : creditClaim?.lastClaimAt
    ? Math.max(0, claimClock + claimClockOffset - Date.parse(creditClaim.lastClaimAt))
    : creditClaim ? Infinity : 0;
  const remainingSeconds = Math.max(0, Math.ceil((7200000 - claimElapsed) / 1000));
  const claimWait = `${Math.floor(remainingSeconds / 3600)}:${String(Math.floor(remainingSeconds / 60) % 60).padStart(2, "0")}:${String(remainingSeconds % 60).padStart(2, "0")}`;
  const claimAvailable = creditClaim && Number(creditClaim.eligibleBalance) < 100
    ? claimElapsed >= 86400000 ? 50 : claimElapsed >= 7200000 ? 10 : 0
    : 0;
  async function refreshCreditClaim(request?: string) {
    if (!live()) return;
    const balanceRead = balanceVersion.current;
    const { data, error } = await auth.rpc("dev_credit_claim", {
      p_league: live().leagueId,
      ...(request ? { p_request: request } : {}),
    });
    if (error) {
      setClaimError(error.message);
      return;
    }
    if (!request && balanceRead !== balanceVersion.current) return;
    const now = Date.now();
    setClaimError("");
    setClaimClock(now);
    setClaimClockOffset(Date.parse(data.serverTime) - now);
    live().balance = data.balance;
    setCreditClaim(data);
    if (request) {
      balanceVersion.current++;
      claimRequest.current = null;
      setToast(`Claimed ${data.claimed} credits.`);
      try {
        const fresh = await bookRequest();
        if (fresh.user.id === live().user.id) {
          live().ledger = fresh.ledger;
          setSettingsVersion((value) => value + 1);
        }
      } catch {
        // The accepted credit and timer are already confirmed by the claim response.
      }
    }
  }
  useEffect(() => {
    const timer = window.setInterval(() => setClaimClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const lastAccountRefresh=useRef(Date.now());
  const refreshGate=useRef(createRefreshGate());
  const selectionForRefresh=useRef(selected);
  useEffect(()=>{selectionForRefresh.current=selected;},[selected]);
  useEffect(()=>{
    let active=true;
    async function refresh(){
      const now=Date.now();
      if(!refreshGate.current.begin(now,document.hidden,placing))return;
      let succeeded=false;
      try{
      const version = balanceVersion.current;
      const before=live();
      const account=Date.now()-lastAccountRefresh.current>=300000;
      const offersMutation=offerMutation.current;
      const response=await bookRequest(undefined,true,"",account,offersVersion.current);
      succeeded=true;
      if(!active || version !== balanceVersion.current || live()!==before)return;
      const next=mergeBookUpdate(before,response);
      if(next.board.market_week!==before.board.market_week||next.board.nfl_season!==before.board.nfl_season){
        sessionStorage.setItem("boff-new-market-week",`${next.board.nfl_season}:${next.board.market_week}`);
        location.reload();return;
      }
      const oldFeatures=new Set(before.quotes.filter((q:any)=>q.boost_pct>0).map((q:any)=>q.matchup_key+":"+q.featured));
      const newFeature=next.quotes.find((q:any)=>q.boost_pct>0&&!oldFeatures.has(q.matchup_key+":"+q.featured));
      if(newFeature)sendBrowserNotification("featured",`Boff · ${newFeature.featured}`,`feature:${next.board.market_week}:${newFeature.matchup_key}:${newFeature.featured}`);
      if(!account){next.tickets=before.tickets;next.ledger=before.ledger;next.user=before.user;
       next.spreadHistory=before.spreadHistory;next.feedRecap=before.feedRecap;}
      else{lastAccountRefresh.current=Date.now();setTickets(next.tickets.map((t:any)=>receipt(t,next)));window.dispatchEvent(new Event('boff-account-refreshed'));}
      (window as any).__boffLive=next;
      if (offersMutation===offerMutation.current && response.offerUpdate) {
        offersVersion.current=response.offerUpdate.version;
        if (response.offerUpdate.offers) acceptWeeklyOffers(response.offerUpdate.offers);
      }
      if(response.lightweight){
        if(before.book.last_error!==next.book.last_error || before.book.valid_until!==next.book.valid_until ||
           before.futuresBoard?.quote_valid_until!==next.futuresBoard?.quote_valid_until)setSettingsVersion(v=>v+1);
        return;
      }
      const quotesByUiId=new Map(next.quotes.map((quote:any)=>[quote.metadata?.ui_id,quote]));
      for(const m of league.markets){
        const q=quotesByUiId.get((m as any).ui_id) as typeof m|undefined;
        if(q)Object.assign(m,{id:q.id,line:q.line,odds:q.odds,home_projection:q.home_projection,away_projection:q.away_projection});
      }
      refreshedPlayers.splice(0,refreshedPlayers.length,...next.book.payload.players);
      league.finalScores=next.book.payload.teams.map((t:any)=>({roster:t.roster_id,points:t.observed}));
      for(const t of teams){const row=next.book.payload.teams.find((x:any)=>x.id===t.id);if(row)Object.assign(t,row);}
      for(const m of matchups){m.awayProjection=m.markets[0].away_projection;m.homeProjection=m.markets[0].home_projection;m.total=m.markets.find(x=>x.kind==="match_total")!.line!;}
      const changes=selectionForRefresh.current.flatMap(p=>{const after=currentPick(p,next);return after&&(after.id!==p.id||after.odds!==p.odds||after.decimalOdds!==p.decimalOdds||after.line!==p.line)?[{before:p,after}]:[]});setUpdates(changes);setSettingsVersion(v=>v+1);
    }catch{}finally{refreshGate.current.finish(Date.now(),succeeded);}}
    const timer=setInterval(refresh,60000);window.addEventListener("focus",refresh);document.addEventListener('visibilitychange',refresh);
    return()=>{active=false;clearInterval(timer);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh)};
  },[placing]);
  const [used, setUsed] = useState<string[]>(() => {
    try {
      return JSON.parse(
        localStorage.getItem(
          "boff-preview-offers-" + league.leagueId + "-" + league.week,
        ) || "[]",
      );
    } catch {
      return [];
    }
  });
  const [offerId, setOfferId] = useState<string | null>(null);
  const [boost, setBoost] = useState(0);
  const [state, setState] = useState("normal");
  useEffect(() => {
    localStorage.setItem(
      "boff-preview-offers-" + league.leagueId + "-" + league.week,
      JSON.stringify(used),
    );
  }, [used]);
  const previousTicketStates = useRef(new Map<string,Ticket>());
  useEffect(()=>{
    const previous=previousTicketStates.current;
    for(const ticket of tickets){
      const before=previous.get(ticket.id);
      if(!before||!ticket.walletId||ticket.walletId!==live()?.user.walletId||before.status!=="Open")continue;
      if(ticket.status!=="Open")sendBrowserNotification("settled","Boff · Ticket "+ticket.status,`settled:${ticket.id}`);
      else if(ticket.picks.length>1){
        const won=ticket.picks.filter(pick=>pick.result?.status==="Won").length;
        if(won>before.picks.filter(pick=>pick.result?.status==="Won").length)
          sendBrowserNotification("leg",`Boff · ${won} of ${ticket.picks.length} parlay legs won`,`leg:${ticket.id}:${won}`);
      }
    }
    previousTicketStates.current=new Map(tickets.map(ticket=>[ticket.id,ticket]));
  },[tickets]);
  const [rewards, setRewards] = useState<EarnedReward[]>([]);
  const [rewardNotice, setRewardNotice] = useState<EarnedReward[]>([]);
  const [rewardId, setRewardId] = useState("");
  const [weeklyOffers, setWeeklyOffers] = useState<WeeklyOffer[]>(()=>live()?.offerUpdate?.offers??[]);
  const [offersLoaded,setOffersLoaded]=useState(()=>Array.isArray(live()?.offerUpdate?.offers));
  const offersVersion=useRef<string|undefined>(live()?.offerUpdate?.version);
  const offerMutation=useRef(0);
  useEffect(()=>{
    const week=sessionStorage.getItem("boff-new-market-week");
    if(week){
      sessionStorage.removeItem("boff-new-market-week");
      sendBrowserNotification("opening","Boff · New weekly markets are open",`opening:${week}`);
    }
  },[]);
  const notificationOffers=useRef<Set<string>|null>(offersLoaded?weeklyOfferKeys(weeklyOffers):null);
  const priorClaimAmount=useRef<number|null>(null);
  useEffect(()=>{
    const amount=creditClaim ? claimAvailable : null;
    if(amount!=null){
      if(priorClaimAmount.current===0&&amount>0)
        sendBrowserNotification("credit","Boff · Credits ready to claim",`credit:${creditClaim?.lastClaimAt}:${amount}`);
      priorClaimAmount.current=amount;
    }
  },[creditClaim,claimAvailable]);
  const [weeklySlot, setWeeklySlot] = useState("");
  function weeklyOfferKeys(offers:WeeklyOffer[]) {
    return new Set(offers.map(offer=>`${live()?.board.market_week}:${offer.slot}:${offer.title}`));
  }
  function acceptWeeklyOffers(offers:WeeklyOffer[]) {
    const next=weeklyOfferKeys(offers);
    if(notificationOffers.current && [...next].some(key=>!notificationOffers.current?.has(key)))
      sendBrowserNotification("offers","Boff · New weekly offers",`offers:${[...next].sort().join("|")}`);
    notificationOffers.current=next;
    setWeeklyOffers(offers);
    setOffersLoaded(true);
  }
  async function loadWeeklyOffers(claim?: string) {
    const leagueId = live()?.leagueId;
    if (!leagueId) return false;
    offerMutation.current++;
    const {data,error} = claim
      ? await auth.rpc("dev_weekly_offers",{p_league:leagueId,p_claim:claim})
      : await auth.rpc("dev_weekly_offer_changes",{p_league:leagueId});
    offerMutation.current++;
    if (error) {
      if (claim) setToast(error.message);
      return false;
    }
    offersVersion.current=claim?undefined:data.version;
    acceptWeeklyOffers((claim?data:data.offers) as WeeklyOffer[]);
    return true;
  }
  useEffect(() => {
    const leagueId = live()?.leagueId;
    if (!leagueId) return;
    let active = true;
    let notified = false;
    async function refreshRewards() {
      if (document.hidden) return;
      const {data,error} = await auth.rpc("list_dev_fantasy_rewards", {p_league:leagueId});
      if (!active || error) return;
      const available = data as EarnedReward[];
      setRewards(available);
      const unseen = available.filter(reward => !reward.seen);
      if (!notified && unseen.length) {
        notified = true;
        setRewardNotice(unseen);
        sendBrowserNotification("reward","Boff · Fantasy reward earned",`reward:${unseen.map(reward=>reward.id).sort().join("|")}`);
      }
    }
    void refreshRewards();
    const timer = window.setInterval(refreshRewards,60000);
    return () => { active=false; window.clearInterval(timer); };
  }, []);
  function dismissRewardNotice() {
    const ids = rewardNotice.map(reward=>reward.id);
    setRewardNotice([]);
    void auth.rpc("list_dev_fantasy_rewards",{p_league:live().leagueId,p_seen:ids});
  }
  const chosenReward = rewards.find(reward=>reward.id===rewardId && reward.ready);
  const liveWeeklyOffers = weeklyOffers.filter(offer=>Date.parse(offer.deadline)>claimClock);
  useEffect(()=>{
    function openDeepLink(){
      if(currentRoute()!=="matchups")return;
      const query=routeQuery();
      const slot=query.get("offer");
      if(slot||query.get("boosts")==="1"){
        setModal(slot?"weekly-offer:"+slot:"rewards");
        query.delete("offer");
        query.delete("boosts");
        history.replaceState({}, "", location.pathname+(query.size?"?"+query:""));
      }
    }
    openDeepLink();
    window.addEventListener("boff-navigation",openDeepLink);
    return ()=>window.removeEventListener("boff-navigation",openDeepLink);
  },[]);
  const offerInDialog=modal?.startsWith("weekly-offer:")?liveWeeklyOffers.find(offer=>offer.slot===modal.slice("weekly-offer:".length)):null;
  const weeklyOffer = liveWeeklyOffers.find(offer=>offer.slot===weeklySlot && !offer.used);
  const weeklyEligible = weeklyOffer && selected.every(pick=>pick.odds>=-1000) && (weeklyOffer.base
    ? selected.length===weeklyOffer.picks.length && weeklyOffer.picks.every(pick=>selected.some(item=>item.id===pick.id))
    : weeklyOffer.claimed && selected.length>=4 && selected.every(pick=>pick.family==="player_h2h" && pick.originalOdds==null
      && live()?.quotes.some((quote:{id:string;metadata?:{live?:boolean;cutoff?:string}})=>quote.id===pick.id
        && quote.metadata?.live===false&&Date.parse(quote.metadata.cutoff??"")>claimClock))
      && new Set(selected.map(pick=>pick.matchupId)).size===selected.length);
  const rewardEligible = !offerId && !boost && !weeklySlot && selected.every(pick=>pick.originalOdds == null);
  const eligibleClaim =
    used.includes("boost") &&
    !used.includes("boost-used") &&
    selected.length >= 4 &&
    selected.every((p) => p.detail.startsWith("Player Head-To-Head"));
  const appliedBoost = weeklyEligible ? weeklyOffer.percent : rewardEligible && chosenReward ? chosenReward.percent : boost || (eligibleClaim ? 25 : 0);
  const value = Number(stake);
  const activeOffer = offerId
    ? offers.find((o) => o.id === offerId)
    : undefined;
  const base = activeOffer
    ? decimal(activeOffer.base)
    : selected.reduce((d, p) => d * (p.decimalOdds ?? decimal(p.odds)), 1);
  const factor = activeOffer
    ? decimal(offerPrice(activeOffer))
    : 1 + (base - 1) * (1 + appliedBoost / 100);
  const odds = selected.length ? american(factor) : 0;
  const futureSlip = selected[0]?.kind==="future";
  const issue = selected.length && (futureSlip?selected.some(p=>!currentPick(p)):live()?.book.last_error || Date.parse(live()?.book.valid_until||"")<=Date.now()) ? "Prices Are Refreshing. Try Again In A Moment." : !selected.length
    ? "Choose a selection to start."
    : weeklySlot && !weeklyEligible ? "This slip no longer qualifies for the weekly offer."
    : futureSlip && selected[0].family==="future_playoffs" && selected.length<2
      ? "Choose at least two Make / Miss Playoffs picks."
    : selected.length > 10
      ? "A parlay can have up to 10 legs."
      : !Number.isFinite(value) || value < 1 || !/^\d+(?:\.\d{1,2})?$/.test(stake)
        ? "Enter at least 1 credit with up to two decimal places."
        : value > availableBalance
          ? "Your balance is " + money(availableBalance) + " credits."
          : "";
  useEffect(() => {
    const change = () => {
      setRoute(currentRoute());
      setSlipOpen(false);
      setModal(null);
      window.scrollTo({ top: 0, behavior: "instant" });
    };
    window.addEventListener("boff-navigation", change);
    return () => window.removeEventListener("boff-navigation", change);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    localStorage.setItem("boff-visual-theme", dark ? "dark" : "light");
  }, [dark]);
  useEffect(() => {
    if (!toast) return;
    setToastFading(false);
    const fade = setTimeout(() => setToastFading(true), 4000);
    const timer = setTimeout(() => setToastText(""), 5000);
    return () => {
      clearTimeout(fade);
      clearTimeout(timer);
    };
  }, [toast, toastCycle]);
  useEffect(() => {
    document.title = `${labels[route] || "Matchup"} · boff`;
  }, [route]);
  function onPick(p: Pick) {
    if (weeklySlot && weeklySlot!=="duels") setWeeklySlot("");
    if (weeklySlot==="duels" && p.family!=="player_h2h") setWeeklySlot("");
    if(live()){const quote=currentPick(p);if(!quote){setToast("This market is not available on the live dev board yet.");return;}p=quote;}
    const existing=selected.find(s=>s.id===p.id || ((s as any).quoteKey && (s as any).quoteKey===(p as any).quoteKey));
    if (existing) {
      setSelected((s) => s.filter((x) => x.id !== existing.id));
      setBoost(0);
      setOfferId(null);
      return;
    }
    const conflict = selectionConflict(p, selected);
    if(conflict){ setToast(conflict); return; }
    setSelected((s) => [...s, p]);
    setBoost(0);
    setOfferId(null);
  }
  function goToPlayerBets() {
    setModal(null);
    navigate("matchups?tab=" + encodeURIComponent("Player Head-To-Head"));
  }
  async function addOffer(id: string) {
    if(live()){
      const offer=liveWeeklyOffers.find(item=>item.slot===id && !item.used);
      if (!offer) return;
      if (!offer.base) {
        if (!offer.claimed && !await loadWeeklyOffers(offer.slot)) return;
        setWeeklySlot(offer.slot);
        setRewardId("");
        goToPlayerBets();
        return;
      }
      const picks=offer.picks.map(row=>currentPick({id:row.id,label:row.label,detail:offer.title,
        odds:row.odds,group:row.matchup,family:row.kind,kind:"weekly",matchupId:row.matchup,matchupLabel:row.subject}));
      if (picks.some(pick=>!pick)) {
        setToast("Offer prices changed. Try the refreshed offer.");
        void loadWeeklyOffers();
        return;
      }
      setSelected(picks);
      setUpdates([]);
      setWeeklySlot(offer.slot);
      setRewardId("");
      setOfferId(null);
      setBoost(0);
      navigate("matchups");
      setModal(null);
      setSlipOpen(true);
      setToast("Offer added to slip.");
      return;
    }
    const offer = offers.find((o) => o.id === id)!;
    if (offer.type === "boost") {
      if (used.includes("boost-used")) return;
      if (used.includes(id)) {
        goToPlayerBets();
        return;
      }
      setUsed((u) => [...u, id]);
      setModal("boost-claimed");
      return;
    }
    setUpdates([]);
    setSelected(offer.picks);
    setBoost(offer.boost);
    setOfferId(id);
    setModal(null);
    setSlipOpen(true);
    setToast("Offer Added To Slip");
  }
  async function placeTicket() {
    if(weeklySlot&&!weeklyEligible){
      setToast(weeklyOffer?"This slip is no longer eligible for the offer. Use pre-game picks or remove the offer.":"This offer has closed. Remove it to place a regular bet.");
      return;
    }
    if(issue || placeInFlight.current)return;
    if(pendingQuotes.length){setModal(null);setSlipOpen(true);setToast("Review Updated Lines Before Placing.");return;}
    placeInFlight.current = true;
    setPlacing(true);
    try {
      const data=live();
      const board=futureSlip?data.futuresBoard:data.board;
      const accepted=await bookRequest({boardId:board.id,revision:board.revision,futures:futureSlip,picks:selected.map(p=>p.id),stake:value,requestId:requestKey.current,
        rewardId: rewardEligible ? chosenReward?.id : undefined,offerSlot:weeklyEligible ? weeklyOffer.slot : undefined});
      if (weeklyEligible) {
        offerMutation.current++;
        offersVersion.current=undefined;
        setWeeklyOffers(current=>current.map(item=>item.slot===weeklyOffer.slot?{...item,used:true}:item));
        setWeeklySlot("");
      }
      if (rewardEligible && chosenReward) {
        setRewards(current=>current.filter(reward=>reward.id!==chosenReward.id));
        setRewardId("");
      }
      balanceVersion.current++;
      const next=await bookRequest();(window as any).__boffLive=next;
      const rows=next.tickets.map((t:any)=>receipt(t,next));
      setTickets(rows);setTicket(rows.find((t:Ticket)=>t.id===accepted.ticket_id)||null);
      requestKey.current=crypto.randomUUID();setSelected([]);setUpdates([]);setBoost(0);setOfferId(null);setSlipOpen(false);setModal("receipt");
    } catch(e){
      const message=(e as Error).message;setToast(message);setModal(null);setSlipOpen(true);
      try{const next=await bookRequest();(window as any).__boffLive=next;const changes=selected.flatMap(p=>{const after=currentPick(p,next);return after&&(after.odds!==p.odds||after.decimalOdds!==p.decimalOdds||after.line!==p.line)?[{before:p,after}]:[]});setUpdates(changes);if(!changes.length&&/changed/i.test(message))setToast("Prices Refreshed. Review Your Slip And Place Again.");}catch{}
    }finally{placeInFlight.current = false;setPlacing(false);}
  }
  const statusEmoji: Record<string, string> = { Won: "✅", Lost: "❌", Push: "🟠", Open: "⏳", Voided: "⚪" };
  const shareText = ticket
    ? [
        `${ticket.participant || live()?.user.name || profileTeam.manager}'s boff ${ticket.picks.length > 1 ? "Parlay" : "Single Bet"}`,
        `${ticket.picks.length > 1 ? ticket.picks.length + "-Leg Parlay · " : ""}${price(ticket.odds)} · ${ticket.status}`,
        ...ticket.picks.map((pick) => {
          const status = pick.result?.status || "Open";
          return `${statusEmoji[status] ?? "⏳"} ${pick.label.replace(/\b(over|under|moneyline|spread|total)\b/gi, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase())} · ${price(pick.odds)}`;
        }),
        ...(live() && sharedTicketPath(ticket.id) ? [location.origin + sharedTicketPath(ticket.id)] : []),
      ].join("\n")
    : "";
  async function copyTicket() {
    try {
      await navigator.clipboard.writeText(shareText);
      setToast("Ticket copied.");
    } catch {
      setToast("Clipboard unavailable. Try Text or More.");
    }
  }
  async function shareTicket() {
    if (!navigator.share) {
      setToast("Use Copy to share this ticket.");
      return;
    }
    try {
      await navigator.share({ title: "Boff ticket", text: shareText });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError"))
        setToast("Sharing unavailable. Use Copy to share this ticket.");
    }
  }
  function viewTicket(t: Ticket, share = false) {
    if (share) {
      setTicket(t);
      setModal("ticket");
      return;
    }
    navigate("my-bets?ticket=" + encodeURIComponent(t.id));
    setModal(null);
  }
  useEffect(() => {
    if (route !== "my-bets" || routeQuery().get("share") !== "1") return;
    const t = tickets.find((t) => t.id === routeQuery().get("ticket"));
    if (t) {
      setTicket(t);
      setModal("ticket");
    }
  }, [route, location.search]);
  const [sharedError,setSharedError]=useState("");
  useEffect(()=>{
    if(route!=="shared-ticket")return;
    let active=true;
    const id=sharedTicketId();
    if(!id){setSharedError("This ticket link is invalid.");return;}
    void bookRequest(undefined,false,id).then(({ticket:row})=>{
      if(active){setTicket(receipt(row,live()));setModal("ticket");}
    }).catch(()=>{if(active)setSharedError("This ticket is unavailable in your league.");});
    return ()=>{active=false;};
  },[route,location.pathname]);
  function refreshSelectedQuotes() {
    setUpdates(
      selected.map((p) => {
        const numeric = p.label.match(/([+-]?\d+(?:\.\d+)?)(?!.*\d)/),
          isLine =
            p.family === "spread" ||
            p.family === "match_total" ||
            p.detail.startsWith("Team Totals") ||
            p.detail === "Fantasy Points";
        const label =
          isLine && numeric
            ? p.label.slice(0, numeric.index) +
              String(Number(numeric[1]) + 1) +
              p.label.slice(numeric.index! + numeric[1].length)
            : p.label;
        return {
          before: p,
          after: {
            ...p,
            label,
            line: isLine && numeric ? Number(numeric[1]) + 1 : p.line,
            odds: isLine ? p.odds : american(decimal(p.odds) + 0.1),
            originalOdds: undefined,
          },
        };
      }),
    );
  }
  const props = {
    selected,
    onPick,
    onInfo: () => setModal("guide"),
    onMatch: (id: string) => navigate(`matchup/${id}`),
    onOffer: (id:string) => live()?setModal("weekly-offer:"+id):void addOffer(id),
    earnedRewards:rewards.length,
    onRewards:()=>setModal("rewards"),
    weeklyOffers:liveWeeklyOffers,
    used,
  };
  const renderSlip = (instance: "desktop" | "mobile") => (
    <>
      <div className="slip-title">
        <h2>
          Bet Slip <span>{selected.length}</span>
        </h2>
        {appliedBoost > 0 && <Badge tone="gold">Boost Applied</Badge>}
        {selected.length > 0 && (
          <button
            className="text-button muted"
            onClick={() => {
              setSelected([]);
              setBoost(0);
              setOfferId(null);
              setWeeklySlot("");
            }}
          >
            Clear All
          </button>
        )}
      </div>
      {!selected.length ? (
        <div className="slip-empty">
          <Icon name="ticket" size={30} />
          <p>Select Odds To Start A Ticket</p>
        </div>
      ) : (
        <>
          <div className="slip-selections">
            <GroupedPicks picks={selected} onRemove={onPick} compact />
            {pendingQuotes.length > 0 && (
              <div className="quote-changes" role="status">
                <strong>Updated Lines</strong>
                {pendingQuotes.map((u) => (
                  <div key={u.before.id}>
                    <span>{u.before.detail}</span>
                    <del>
                      {u.before.label} · {price(u.before.odds)}
                    </del>
                    <b>
                      {u.after.label} · {price(u.after.odds)}
                    </b>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="slip-stake">
            {rewards.some(reward=>reward.ready) && <label>
              Fantasy Reward
              <select value={rewardId} disabled={!rewardEligible || placing} onChange={event=>setRewardId(event.target.value)}>
                <option value="">No reward</option>
                {rewards.filter(reward=>reward.ready).map(reward=><option value={reward.id} key={reward.id}>
                  {reward.percent}% · {fantasyRewards[reward.achievement].label}
                </option>)}
              </select>
              {!rewardEligible && <small>Choose selections without an existing boost to use a reward.</small>}
            </label>}
            {weeklySlot && <button className="text-button" onClick={()=>setWeeklySlot("")}>Remove Weekly Offer</button>}
            <label htmlFor={`stake-${instance}`}>Stake</label>
            <div className="stake-input">
              <input
                id={`stake-${instance}`}
                value={stake}
                onChange={(e) => setStake(e.target.value)}
                type="number"
                min="1"
                max={availableBalance}
                step="0.01"
                inputMode="decimal"
              />
              <span>credits</span>
            </div>
            <div className="stake-quick">
              {[5, 10, 25, 50].map((n) => (
                <button key={n} onClick={() => setStake(String(n))}>
                  {n}
                </button>
              ))}
            </div>
            <div className="slip-totals">
              <div className="slip-price">
                <span>
                  {selected.length === 1 ? "Ticket Odds" : "Combined Odds"}
                </span>
                <strong>
                  {appliedBoost > 0 && <del>{price(american(base))}</del>}{" "}
                  {price(odds)}
                </strong>
              </div>
              <div className="return-row">
                <span>Potential Return</span>
                <strong>
                  {Number.isFinite(value)
                    ? money(Math.max(0, value) * factor)
                    : "—"}
                </strong>
              </div>
            </div>
            {issue && (
              <p className="field-error" role="status">
                {issue}
              </p>
            )}
            <button
              className="button primary full"
              disabled={!!issue || placing}
              onClick={() => {
                if (pendingQuotes.length) {
                  setSelected((s) =>
                    s.map(
                      (p) =>
                        pendingQuotes.find((u) => u.before.id === p.id)
                          ?.after || p,
                    ),
                  );
                  setUpdates([]);
                  setToast("Updated Lines Reviewed");
                  return;
                }
                void placeTicket();
              }}
            >
              {placing ? "Placing Bet…" : pendingQuotes.length
                ? "Review Updated Lines"
                : "Place Bet"}{" "}
              <Icon name="arrow" size={16} />
            </button>
            <p className="slip-disclaimer">
              Free Virtual Credits · Dev
            </p>
          </div>
        </>
      )}
    </>
  );
  const showSlip =
    !(route === "matchups" && (liveView || postseasonView)) && (["matchups", "futures"].includes(route) || route.startsWith("matchup/"));
  if(route==="home")return <HomePage/>;
  if(route==="league-unavailable"||route==="not-found")
    return <BoffScreen><StatusPanel heading="h1" kind={route==="league-unavailable"?"access":"empty"} title={route==="league-unavailable"?"League Unavailable":"Page Not Found"}
      action={<><a className="button primary" href="/">Your Leagues</a><a className="button secondary" href={routeUrl("matchups")}>Open Weekly Slate</a></>}>
      {route==="league-unavailable"?"This league isn’t available to your account here. Choose a connected league, or ask your commissioner to confirm your invitation.":"The page may have moved, or the link may be incorrect."}
    </StatusPanel></BoffScreen>;
  return (
    <InteractionContext.Provider value={{enabled: interactionReview, conflicts:conflictPreview, selected, explain: setToast}}>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      {isDevelopment&&<div className="preview-bar">
        <span>
          <span className="preview-dot" /> Development{" "}
          <span className="preview-detail">· Real League · Dev Workspace</span>
        </span>
        <span>Dev Test Credits</span>
      </div>}
      {route === "access" ? (
        <AccessPage notify={setToast} />
      ) : (
        <>
          <header className="app-header">
            <a href="/" className="brand" aria-label="boff home">
              <Mark size={34} />
              <span>boff</span>
            </a>
            <div className="header-league">
              <details hidden={!!live()} className="dropdown">
                <summary>
                  <LeagueAvatar small />
                  <span>
                    {league.league}
                    <small>Season {league.season} · Sleeper</small>
                  </span>
                  <Icon name="chevron" size={15} />
                </summary>
                <div className="dropdown-panel league-dropdown">
                  <span className="menu-label">Your Leagues</span>
                  <a
                    href={routeUrl("matchups")}
                    onClick={(e) =>
                      e.currentTarget
                        .closest("details")
                        ?.removeAttribute("open")
                    }
                  >
                    <Icon name="check" size={15} />
                    {league.league}
                  </a>
                  <a
                    href={routeUrl("setup")}
                    onClick={(e) =>
                      e.currentTarget
                        .closest("details")
                        ?.removeAttribute("open")
                    }
                  >
                    <Icon name="plus" size={16} /> Connect A League
                  </a>
                  <a
                    href={"https://sleeper.com/leagues/" + league.leagueId}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Icon name="external" size={15} /> Sleeper League
                  </a>
                </div>
              </details>
            </div>
            <div className="header-account">
              {isDevelopment && (
                <span
                  className="environment-badge"
                  aria-label="Development Environment"
                >
                  dev
                </span>
              )}
              <details ref={claimMenu} className="header-balance credit-claim" onKeyDown={(event) => {
                if (event.key !== "Escape" || !event.currentTarget.open) return;
                event.stopPropagation();
                event.currentTarget.open = false;
                event.currentTarget.querySelector("summary")?.focus();
              }} onToggle={(event) => {
                if (event.currentTarget.open) void refreshCreditClaim();
              }}>
                <summary title={creditClaim && remainingSeconds > 0 ? `Next claim in ${claimWait}` : undefined}>
                  <span aria-hidden="true">◈</span>
                  <strong>{money(availableBalance)}</strong>
                  <span className="claim-progress" aria-hidden="true"><i style={{ width: Math.min(100, claimElapsed / 72000) + "%" }} /></span>
                </summary>
                <div className="credit-claim-panel">
                  <dl>
                    <div><dt>Open non-futures stakes</dt><dd>{creditClaim ? money(Number(creditClaim.openNonFutures)) : "—"}</dd></div>
                    <div><dt>Open futures stakes</dt><dd>{creditClaim ? money(Number(creditClaim.openFutures)) : "—"}</dd></div>
                  </dl>
                  {claimError ? <p role="status">{claimError}</p>
                    : !creditClaim ? <p role="status">Checking next claim…</p>
                    : remainingSeconds > 0 ? <div className="claim-status claim-countdown"><span><Icon name="clock" size={14} /> Next claim in</span><strong>{claimWait}</strong></div>
                    : claimAvailable ? <button className="button primary claim-credit-button" disabled={claimBusy} onClick={async () => {
                      claimRequest.current ??= crypto.randomUUID();
                      setClaimBusy(true);
                      try { await refreshCreditClaim(claimRequest.current); } finally { setClaimBusy(false); }
                    }}>Claim {claimAvailable} Credits</button>
                    : <div className="claim-status claim-status-unavailable"><Icon name="clock" size={14} /><span>Claim unavailable</span></div>}
                </div>
              </details>
              <span className="header-divider" />
              <button
                className="icon-button theme-button"
                aria-label={
                  dark ? "Switch to light mode" : "Switch to dark mode"
                }
                onClick={() => setDark(!dark)}
              >
                <Icon name={dark ? "sun" : "moon"} size={19} />
              </button>
              <button
                className="icon-button header-utility"
                title="Guide & Walkthrough"
                aria-label="Open Guide"
                onClick={() => setModal("guide")}
              >
                <Icon name="help" size={20} />
              </button>
              <button
                className="icon-button header-utility"
                title="Feedback & Support"
                aria-label="Feedback & Support"
                onClick={() => setModal("feedback")}
              >
                <Icon name="message" size={20} />
              </button>
              <NotificationBell tickets={tickets} onTicket={viewTicket} />
              <a
                className="profile-button"
                href={routeUrl("profile")}
                aria-label="Your profile"
              >
                <ParticipantAvatar
                  name={live()?.user.name || profileTeam.manager}
                  team={profileTeam}
                />
              </a>
            </div>
          </header>
          <aside className="sidebar">
            <nav aria-label="Main navigation">
              {nav.map(([path, icon, label]) => (
                <a
                  href={routeUrl(path)}
                  key={path}
                  className={
                    route === path ||
                    (path === "matchups" && route.startsWith("matchup/"))
                      ? "active"
                      : ""
                  }
                  aria-current={route === path ? "page" : undefined}
                >
                  <Icon name={icon} size={21} />
                  <span>{label}</span>

                </a>
              ))}
            </nav>
            <div className="sidebar-bottom">
              <span className="menu-label">Review Workspaces</span>
              {canReviewLeague && <a
                href={routeUrl("commissioner")}
                className={route === "commissioner" ? "active" : ""}
              >
                <Icon name="settings" size={18} />
                <span>Commissioner</span>
              </a>}
              {canReviewPlatform && <a
                href={routeUrl("platform")}
                className={route === "platform" ? "active" : ""}
              >
                <Icon name="shield" size={18} />
                <span>Platform Owner</span>
              </a>}
              <a href={routeUrl("access")} onClick={async(e)=>{e.preventDefault();await auth.auth.signOut();location.assign("/sign-in");}}>
                <Icon name="logout" size={18} />
                <span>Sign Out</span>
              </a>
              <details hidden={!!live()} className="review-states">
                <summary>
                  <Icon name="info" size={16} /> Preview States{" "}
                  <Icon name="chevron" size={14} />
                </summary>
                <label>
                  Weekly board state
                  <select
                    value={state}
                    onChange={(e) => {
                      setState(e.target.value);
                      navigate("matchups");
                    }}
                  >
                    <option value="normal">Ready</option>
                    <option value="loading">Loading</option>
                    <option value="weekly">Weekly preparation</option>
                    <option value="error">Source unavailable</option>
                  </select>
                </label>
                <button
                  className="text-button"
                  onClick={refreshSelectedQuotes}
                  disabled={!selected.length || !!offerId}
                >
                  Refresh Selected Lines
                </button>
              </details>
              <div className="sidebar-end">
                <a href={routeUrl("profile")}>Preferences</a>
              </div>
            </div>
          </aside>
          <div className={`workspace ${showSlip ? "with-slip" : ""}`}>
            <main id="main-content" tabIndex={-1}>
              {route === "matchups" && state === "normal" ? (
                <>
                  <div style={live()?{display:"none"}:undefined} className="dev-view-switch segmented" aria-label="Dev Data View">
                    <button hidden={!!live()} className={!liveView && !postseasonView ? "active" : ""} onClick={()=>{setLiveView(false);setPostseasonView(false)}}>Archived Review</button>
                    <button className={liveView ? "active" : ""} onClick={()=>{setLiveView(true);setPostseasonView(false)}}>Live Dev</button>
                    <button className={postseasonView?"active":""} onClick={()=>{setPostseasonView(true);setLiveView(false)}}>Postseason Review</button>
                  </div>
                  {interactionReview && !liveView && <div className="interaction-review"><strong>Interaction Preview</strong><label><input type="checkbox" checked={conflictPreview} onChange={e=>setConflictPreview(e.target.checked)}/> Grey Out Conflicts</label><span>Tap a muted price for its reason. Star props in Player Points &amp; Milestones.</span></div>}
                  {liveView ? <LiveDevBoard/> : postseasonView ? <PostseasonPreview/> : <MarketBoard {...props} tickets={tickets} />}
                </>
              ) : route === "matchups" && state !== "normal" ? (
                <div className="board-state">
                  <Icon
                    name={
                      state === "weekly"
                        ? "clock"
                        : state === "error"
                          ? "info"
                          : "grid"
                    }
                    size={38}
                  />
                  <h1>
                    {state === "weekly"
                      ? "Weekly Markets Loading"
                      : state === "error"
                        ? "Markets Unavailable"
                        : "Loading Markets"}
                  </h1>
                  <p>
                    {state === "weekly"
                      ? "The next weekly board is being prepared. Futures, tickets and your profile remain available."
                      : state === "error"
                        ? "We couldn’t confirm fresh market information. Your selections are safe; new tickets will wait for the board to recover."
                        : "Loading teams, matchups and the latest available lines."}
                  </p>
                  {state === "loading" ? (
                    <div
                      className="skeleton-list"
                      aria-label="Loading market rows"
                    >
                      <i />
                      <i />
                      <i />
                    </div>
                  ) : (
                    <button
                      className="button primary"
                      onClick={() => setState("normal")}
                    >
                      {state === "weekly"
                        ? "Return To Ready Preview"
                        : "Retry Preview"}
                      <Icon name="arrow" size={16} />
                    </button>
                  )}
                  <button
                    className="text-button"
                    onClick={() => navigate("futures")}
                  >
                    Browse futures <Icon name="arrow" size={15} />
                  </button>
                </div>
              ) : route==="shared-ticket" ? (
                <Empty title="Shared Ticket">{sharedError || "Open the ticket summary to see the selections."}</Empty>
              ) : route.startsWith("matchup/") ? (
                <>{archiveError&&<p role="status">Matchup history could not be loaded. <button className="text-button" onClick={()=>setArchiveRetry(v=>v+1)}>Retry History</button></p>}<MatchupDetail id={route.split("/")[1]} {...props} /></>
              ) : route === "futures" ? (
                <FuturesPage selected={selected} onPick={onPick} />
              ) : route === "my-bets" || route === "all-bets" ? (
                <TicketsPage
                  all={route === "all-bets"}
                  tickets={route==="my-bets"?tickets.filter(t=>live()?.user.walletId?t.walletId===live().user.walletId:t.participant===profileTeam.manager):tickets}
                  onTicket={viewTicket}
                />
              ) : route === "league" ? (
                summaryReady!==route&&live()?<StatusPanel title={summaryError?"League Activity Unavailable":"Loading League Activity"} kind={summaryError?"error":"loading"} action={summaryError?<button className="button primary" onClick={()=>setSummaryRetry(v=>v+1)}>Retry</button>:undefined}>{summaryError?"We couldn’t load league activity. Try again shortly.":"Loading standings and betting history."}</StatusPanel>:<LeaguePage tickets={tickets} />
              ) : route === "profile" ? (
                <ProfilePage
                  tickets={tickets}
                  dark={dark}
                  onTheme={() => setDark(!dark)}
                  notify={setToast}
                />
              ) : route === "commissioner" ? (
                canReviewLeague ? <CommissionerPage notify={setToast} /> : <Empty title="Commissioner Access Required" kind="access" action={<a className="button primary" href={routeUrl("matchups")}>Open Weekly Slate</a>}>These settings are available to your league commissioner. Contact them if you need a league change.</Empty>
              ) : route === "platform" ? (
                canReviewPlatform ? summaryReady!==route&&live()?<StatusPanel title={summaryError?"League Activity Unavailable":"Loading League Activity"} kind={summaryError?"error":"loading"} action={summaryError?<button className="button primary" onClick={()=>setSummaryRetry(v=>v+1)}>Retry</button>:undefined}>{summaryError?"We couldn’t load league activity. Try again shortly.":"Loading league activity for your workspace."}</StatusPanel>:<PlatformPage tickets={tickets} notify={setToast} /> : <Empty title="Platform Owner Access Required" kind="access" action={<a className="button primary" href={routeUrl("matchups")}>Open Weekly Slate</a>}>This workspace is available to the platform owner. Your league pages are still available.</Empty>
              ) : route === "setup" ? (
                <Onboarding notify={setToast} />
              ) : (
                <Empty
                  title={route==="league-unavailable"?"League Unavailable":"Page Not Found"}
                  action={
                    <a className="button primary" href={routeUrl("matchups")}>
                      Open Weekly Slate
                    </a>
                  }
                >
                  {route==="league-unavailable"?"This league isn’t available to your account here. Open your weekly slate or ask your commissioner to confirm your invitation.":"The page may have moved, or the link may be incorrect."}
                </Empty>
              )}
              <footer className="main-footer">
                <span className="wordmark">boff</span>
                <button
                  className="text-button"
                  onClick={() => setModal("about")}
                >
                  About This Preview
                </button>
              </footer>
            </main>
            {showSlip && (
              <aside className="desktop-slip" aria-label="Bet slip">
                <div className="slip-panel">{renderSlip("desktop")}</div>
              </aside>
            )}
          </div>
          <div className="mobile-bottom">
            {showSlip && (
              <button
                className="mobile-slip-handle"
                onClick={() => setSlipOpen(true)}
              >
                <span>
                  <Icon name="ticket" size={18} />
                  Bet Slip <b>{selected.length}</b>
                </span>
                <span>
                  {selected.length
                    ? `${price(odds)} · ${money(Number(stake) || 0)} credits`
                    : "Make your first pick"}
                  <Icon name="chevron" size={16} />
                </span>
              </button>
            )}
            <nav aria-label="Mobile Navigation">
              {nav
                .filter((n) => ["matchups", "my-bets"].includes(n[0]))
                .map(([path, icon, label]) => (
                  <a
                    href={routeUrl(path)}
                    className={route === path ? "active" : ""}
                    key={path}
                  >
                    <Icon name={icon} size={20} />
                    <span>{label}</span>
                  </a>
                ))}
              <button
                className={modal === "menu" ? "active" : ""}
                aria-haspopup="dialog"
                onClick={() => setModal("menu")}
              >
                <Icon name="grid" size={20} />
                <span>More</span>
              </button>
            </nav>
          </div>
        </>
      )}
      {slipOpen && (
        <Modal title="Bet Slip" className="mobile-slip-sheet" animateClose onClose={() => setSlipOpen(false)}>
          <div className="mobile-full-slip">{renderSlip("mobile")}</div>
        </Modal>
      )}
      {modal && (
        <Modal
          title={
            modal==="rewards" ? "Earned Boosts" :
            modal.startsWith("weekly-offer:") ? offerInDialog?.title??"Weekly Offer" :
            modal === "menu"
              ? "Menu"
              : modal === "guide"
                ? "Guide & Walkthrough"
                : modal === "feedback"
                  ? "Feedback & Support"
                  : modal === "boost-claimed"
                    ? "Boost Claimed"
                    : modal.startsWith("offer:")
                      ? offers.find((o) => o.id === modal.split(":")[1])!.name
                      : modal === "receipt"
                          ? "Ticket Summary"
                          : modal === "ticket"
                            ? "Ticket Details"
                            : modal === "updates"
                              ? "Notifications"
                              : "About This Preview"
          }
          wide={modal === "guide"}
          className={
            modal === "ticket" || modal === "receipt" ? "ticket-modal" : modal.startsWith("weekly-offer:") ? "weekly-offer-modal" : ""
          }
          onClose={() => {
            if (routeQuery().get("share") === "1")
              navigate("my-bets?ticket=" + (ticket?.id || ""), true);
            setModal(null);
          }}
        >
          {modal === "menu" ? (
            <div className="mobile-overflow">
              <nav aria-label="More Navigation">
                {nav.map(([path, icon, label]) => (
                  <a
                    href={routeUrl(path)}
                    key={path}
                    onClick={() => setModal(null)}
                  >
                    <Icon name={icon} size={20} />
                    {label}
                  </a>
                ))}
                <a href={routeUrl("profile")} onClick={() => setModal(null)}>
                  <Icon name="user" size={20} />
                  Profile
                </a>
              </nav>
              <div className="overflow-utilities">
                <button onClick={() => setModal("guide")}>
                  <Icon name="help" size={20} />
                  Guide
                </button>
                <button onClick={() => setModal("feedback")}>
                  <Icon name="message" size={20} />
                  Feedback
                </button>
                <button onClick={() => setModal("updates")}>
                  <Icon name="bell" size={20} />
                  Updates
                </button>
              </div>
              <div className="overflow-workspaces">
                {canReviewLeague && <a
                  href={routeUrl("commissioner")}
                  onClick={() => setModal(null)}
                >
                  Commissioner
                </a>}
                {canReviewPlatform && <a href={routeUrl("platform")} onClick={() => setModal(null)}>
                  Platform Owner
                </a>}
                <a href={routeUrl("access")} onClick={() => setModal(null)}>
                  Sign-In & League Setup
                </a>
              </div>
            </div>
          ) : modal === "guide" ? (
            <Guide onComplete={() => setModal(null)} />
          ) : modal === "feedback" ? (
            <FeedbackForm />
          ) : modal==="rewards" ? (
            rewards.length?<RewardCards rewards={rewards} select={id=>{
              setWeeklySlot("");setRewardId(id);setModal(null);navigate("matchups");
              setToast("Reward selected. Add eligible picks to your bet slip.");
            }}/>:<p>No earned boosts available.</p>
          ) : modal.startsWith("weekly-offer:") ? (
            offerInDialog?<WeeklyOfferDetails offer={offerInDialog} onOffer={id=>void addOffer(id)}/>
              :<p>{offersLoaded?"This offer is no longer available.":"Loading offer…"}</p>
          ) : modal === "boost-claimed" ? (
            <div className="claim-confirmation">
              <span>
                <Icon name="check" size={30} />
              </span>
              <h3>Player H2H Boost Claimed</h3>
              <p>
                Available for an eligible 4+ leg player head-to-head parlay.
              </p>
              <button className="button primary full" onClick={goToPlayerBets}>
                Go To Player H2H
                <Icon name="arrow" size={16} />
              </button>
            </div>
          ) : modal.startsWith("offer:") ? (
            (() => {
              const o = offers.find((o) => o.id === modal.split(":")[1])!;
              return (
                <>
                  <p className="lead">{o.description}</p>
                  {o.picks.map((p) => (
                    <div className="offer-leg" key={p.id}>
                      <Icon name="check" size={16} />
                      <span>
                        <strong>{p.label}</strong>
                        <small>{p.detail}</small>
                      </span>
                      <b>{price(p.odds)}</b>
                    </div>
                  ))}
                  {o.type === "parlay" && (
                    <div className="offer-modal-odds">
                      <span>Boosted ticket odds</span>
                      <del>{price(o.base)}</del>
                      <strong>{price(offerPrice(o))}</strong>
                    </div>
                  )}
                  <ul className="terms">
                    <li>Once per participant.</li>
                    <li>{o.deadline}.</li>
                    <li>
                      {o.type === "parlay"
                        ? "Accepted profit boost stays if a leg pushes."
                        : "Eligible 4+ leg player head-to-head parlays only."}
                    </li>
                    <li>
                      Offer eligibility and redemption are previewed locally.
                    </li>
                  </ul>
                  <button
                    className="button primary full"
                    onClick={() => addOffer(o.id)}
                  >
                    {o.type === "boost"
                      ? "Claim in this preview"
                      : selected.length
                        ? "Replace slip with this offer"
                        : "Add offer to slip"}
                    <Icon name="arrow" size={17} />
                  </button>
                </>
              );
            })()
          ) : modal === "ticket" || modal === "receipt" ? (
            ticket && (
              <>
                <div
                  className="share-ticket"
                >
                  <div className="share-brand">
                    <Mark size={28} />
                    <span className="wordmark">boff</span>
                    <div className="ticket-identity">
                      <Badge
                        tone={
                          ticket.status === "Lost"
                            ? "red"
                            : ticket.status === "Won"
                              ? "green"
                              : "neutral"
                        }
                      >
                        {ticket.status}
                      </Badge>
                    </div>
                  </div>
                  {ticket.picks.length > 1 && (
                    <h3 className="ticket-kind">
                      {ticket.picks.length}-Leg Parlay
                    </h3>
                  )}
                  <GroupedPicks picks={ticket.picks} compact />

                  {ticket.picks.length > 1 &&
                    ticket.picks.some((p) => p.result?.status === "Push") && (
                      <p className="push-adjustment">
                        Pushed Legs Removed From Combined Odds
                        {ticket.profitBoost ? " · Accepted Boost Kept" : ""}
                      </p>
                    )}
                  <div className="receipt-totals">
                    <span>
                      Stake<strong>{money(ticket.stake)}</strong>
                    </span>
                    <span>
                      Ticket Odds
                      <strong>
                        {ticketOdds(ticket) !== ticket.odds && (
                          <del className="original-price">
                            {price(ticket.odds)}
                          </del>
                        )}{" "}
                        {price(ticketOdds(ticket))}
                      </strong>
                    </span>
                    {ticket.status !== "Lost" && (
                      <span>
                        {ticket.status === "Open"
                          ? "Potential Return"
                          : ticket.status === "Push"
                            ? "Stake Returned"
                            : "Return"}
                        <strong>
                          {money(
                            ticket.status === "Open"
                              ? ticket.stake * decimal(ticketOdds(ticket))
                              : ticketReturn(ticket),
                          )}
                        </strong>
                      </span>
                    )}
                  </div>
                  <p className="share-disclaimer">
                    Ticket ID {ticket.id}
                  </p>
                </div>
                <div className="form-actions receipt-actions">
                  <a className="button secondary" href={`sms:${/iPhone|iPad|iPod/i.test(navigator.userAgent) ? "&" : "?"}body=${encodeURIComponent(shareText)}`}>Text</a>
                  <button className="button secondary" onClick={copyTicket}>Copy</button>
                  <button className="button secondary" onClick={shareTicket}>More</button>
                  <button className="text-button receipt-view-bets" onClick={() => {
                    setModal(null);
                    navigate("my-bets");
                  }}>View My Bets <Icon name="arrow" size={15} /></button>
                </div>
              </>
            )
          ) : modal === "updates" ? (
            <NotificationsFeed tickets={tickets}
              onTicket={viewTicket}
              onClose={() => setModal(null)}
            />
          ) : (
            <div className="prose">
              <p>
                This dev website is the new boff visual frontend. It uses actual
                league teams, roster associations and archived Week 8 market
                values.
              </p>
              <p>
                Credits, ticket histories, future prices, featured tags and
                offers are design examples. Clicks stay in this browser. No live
                ticket, database record, invitation or email is created.
              </p>
              <p>
                Review workspaces let you inspect commissioner and owner
                layouts. They are not connected access-control implementations.
              </p>
              <p>
                The core features, data connections and weekly automation will
                be added after visual review.
              </p>
            </div>
          )}
        </Modal>
      )}
      {toast && (
        <div
          className={"toast" + (toastFading ? " toast-fading" : "")}
          role="status"
        >
          <Icon name="info" size={19} />
          <span>{toast}</span>
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
      {rewardNotice.length > 0 && !modal && <Modal title="Fantasy Rewards Earned" onClose={dismissRewardNotice}>
        <ul>{rewardNotice.map(reward => <li key={reward.id}>
          {fantasyRewards[reward.achievement].label} · {reward.percent}% profit boost{!reward.ready && " · Available next season"}
        </li>)}</ul>
        <button className="button primary" onClick={() => {
          dismissRewardNotice();
          navigate("matchups");
          setModal("rewards");
        }}>View Earned Boosts</button>
      </Modal>}
    </InteractionContext.Provider>
  );
}
