import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import ts from "typescript";

// This subprocess tests synthetic, intercepted clients even during a hosted
// build. Never inherit deployment credentials or hosted runtime flags.
for (const key of Object.keys(process.env)) {
  if (/^(BOFF_|VITE_|SUPABASE_|RESEND_|WEEKLY_WORKER_SECRET$|VERCEL(?:_|$))/.test(key))
    delete process.env[key];
}
process.env.BOFF_ENVIRONMENT = "test";
process.env.NODE_ENV = "test";
// Match deployment: TypeScript sources become JavaScript, without preserving .ts files.
const root = await mkdtemp(path.resolve("node_modules/.api-runtime-"));
try {
  await mkdir(path.join(root, "_lib"));
  for (const file of [
    "_lib/league-intake",
    "_lib/notification-window",
    "_lib/wallet-policy",
    "league-intake",
    "_lib/routine-retention",
    "_lib/environment-policy",
    "_lib/server-client",
    "generate-markets",
    "weekly-execution",
    "_lib/line-model",
    "_lib/extra-markets",
    "_lib/event-time",
    "_lib/auth-policy",
    "_lib/reopening",
    "_lib/ticket-progress",
    "_lib/model-assessment",
    "_lib/model-pipeline",
    "_lib/prospective-model",
    "_lib/evaluation-summary",
    "_lib/assessment-reads",
    "_lib/compact-forecast",
    "_lib/count-options",
    "_lib/futures-model",
    "_lib/futures-settlement",
    "_lib/settlement",
    "_lib/worker-auth",
    "_lib/game-status",
    "_lib/active-starters",
    "_lib/starter-cache",
    "_lib/live-model",
    "_lib/live-review",
    "_lib/live-pipeline",
    "active-starters",
    "_lib/email-templates",
    "_lib/reopening-email",
    "_lib/mail",
    "_lib/monday-watch",
    "_lib/league-communications",
    "weekly-worker",
    "reopening-review",
    "place-bet",
    "promo-image",
    "_lib/promo-image",
    "report-results",
    "report-avatar",
  ]) {
    const source = await readFile(`api/${file}.ts`, "utf8");
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2023,
      },
      fileName: `${file}.ts`,
    });
    await writeFile(path.join(root, `${file}.js`), outputText);
  }
  await writeFile(path.join(root, "package.json"), '{"type":"module"}');
  const { POST, sharedRefreshSource } = await import(
    pathToFileURL(path.join(root, "generate-markets.js")).href
  );
  const sourceLeague = "fixture-league";
  const reopening = await import(
    pathToFileURL(path.join(root, "_lib/reopening.js")).href
  );
  const scheduled = {
    id: "later",
    teams: ["BUF", "NE"],
    starts_at: "2026-10-18T17:00:00Z",
    state: "scheduled",
    period: 0,
    clock_seconds: 900,
  };
  const finished = {
    ...scheduled,
    id: "done",
    teams: ["SEA", "LAR"],
    starts_at: "2026-10-16T00:15:00Z",
    state: "final",
  };
  const projections = reopening.canonicalProjections(
    [
      {
        player_id: "p",
        team: "BUF",
        date: "2026-10-18",
        stats: { pass_yd: 100 },
      },
    ],
    [scheduled],
  );
  assert.equal(
    Date.parse(projections[0].date),
    Date.parse(scheduled.starts_at),
  );
  const conditional = reopening.conditionalReopening({
    games: [scheduled, finished],
    rosters: [
      {
        roster_id: 1,
        matchup_id: 1,
        starters: ["p", "q"],
        starters_points: [0, 10],
        points: 10,
      },
    ],
    projections,
    stats: [
      {
        player_id: "q",
        team: "SEA",
        stats: { pass_yd: 250 },
        updated_at: Date.parse("2026-10-16T21:00:00Z"),
      },
    ],
    history: [],
    scoring: { pass_yd: 0.04 },
    teams: [{ id: "team", roster_id: 1, team_name: "Fixture" }],
    fetched_at: "2026-10-16T22:00:00Z",
    slots: 2,
  });
  assert.deepEqual(conditional.teams[0].reasons, []);
  assert.equal(
    conditional.teams[0].mean,
    14,
    "completed points plus remaining prior, without counting completed points twice",
  );
  assert.equal(conditional.teams[0].players.find((p) => p.id === "q").sd, 0);
  const quotes = [
    { kind: "player_points", metadata: { player_id: "q" } },
    { kind: "player_points", metadata: { player_id: "p" } },
  ];
  reopening.tagReopeningQuotes(quotes, conditional, [scheduled, finished]);
  assert.equal(quotes[0].metadata.reopening_locked, true);
  assert.equal(quotes[1].metadata.reopening_locked, false);
  const determined = [{ kind: "weekly_any_200", metadata: {} }];
  reopening.tagReopeningQuotes(
    determined,
    {
      ...conditional,
      teams: [
        { ...conditional.teams[0], sd: 0, observed: 205 },
        { ...conditional.teams[0], team_id: "other" },
      ],
    },
    [scheduled, finished],
  );
  assert.equal(determined[0].metadata.reopening_locked, true);
  const sourceBase = `https://api.sleeper.app/v1/league/${sourceLeague}`;
  for (const source of [
    sourceBase,
    `${sourceBase}/rosters`,
    `${sourceBase}/matchups/1`,
    `${sourceBase}/matchups/6`,
    "https://api.sleeper.com/projections/nfl/2026/6?season_type=regular",
  ])
    assert.equal(sharedRefreshSource(source, sourceLeague, 2026, 6), true);
  for (const source of [
    `${sourceBase}/matchups/7`,
    `${sourceBase}/traded_picks`,
    "https://api.sleeper.com/projections/nfl/2026/7?season_type=regular",
    `${sourceBase}/matchups/NaN`,
  ])
    assert.equal(sharedRefreshSource(source, sourceLeague, 2026, 6), false);
  const starterStatus = await import(
    pathToFileURL(path.join(root, "active-starters.js")).href
  );
  const placement = await import(
    pathToFileURL(path.join(root, "place-bet.js")).href
  );
  const plain = {
    board_id: "b",
    revision: 1,
    picks: ["leg0", "leg1", "leg2"],
    stake: 10,
    request_id: "fixture",
  };
  const teaserGuardFetch = globalThis.fetch;
  let rejectedNetworkCalls = 0;
  globalThis.fetch = async () => {
    rejectedNetworkCalls++;
    throw new Error("Guard must not reach network");
  };
  try {
    for (const terms of [
      { ticket_type: "teaser" },
      { adjustment: 9 },
      { teaser_quote_id: "forged" },
      { teaser: null },
      { odds: 140 },
      { payout: 100 },
    ]) {
      const result = await placement.POST(
        new Request("https://fixture.invalid/api/place-bet", {
          method: "POST",
          body: JSON.stringify({ ...plain, ...terms }),
        }),
      );
      assert.equal(result.status, 400);
      assert.equal((await result.json()).code, "UNSUPPORTED_TICKET_TERMS");
    }
    assert.equal(rejectedNetworkCalls, 0);
  } finally {
    globalThis.fetch = teaserGuardFetch;
  }
  assert.equal(
    (
      await starterStatus.GET(
        new Request("https://example.invalid/api/active-starters"),
      )
    ).status,
    401,
  );
  const response = await POST(
    new Request("https://example.invalid/api/generate-markets", {
      method: "POST",
    }),
  );
  assert.equal(response.status, 401);
  assert.match((await response.json()).error, /not configured/);
  const report = await import(
    pathToFileURL(path.join(root, "report-results.js")).href
  );
  const avatar = await import(
    pathToFileURL(path.join(root, "report-avatar.js")).href
  );
  assert.equal(
    (
      await avatar.GET(
        new Request(
          "https://example.invalid/api/report-avatar?path=https://evil.invalid",
        ),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await avatar.GET(
        new Request(
          "https://example.invalid/api/report-avatar?path=/avatars/../../secret",
        ),
      )
    ).status,
    400,
  );
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(
        url,
        "https://sleepercdn.com/avatars/964be8b3957b1ce3d42b656f4d747c73",
      );
      assert.equal(options.redirect, "error");
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "image/png" },
      });
    };
    const image = await avatar.GET(
      new Request(
        "https://example.invalid/api/report-avatar?path=/avatars/964be8b3957b1ce3d42b656f4d747c73",
      ),
    );
    assert.equal(image.status, 200);
    assert.equal(image.headers.get("content-type"), "image/png");
    assert.equal((await image.arrayBuffer()).byteLength, 3);
    globalThis.fetch = async () =>
      new Response("not an image", {
        headers: { "content-type": "text/html" },
      });
    assert.equal(
      (
        await avatar.GET(
          new Request(
            "https://example.invalid/api/report-avatar?path=/avatars/964be8b3957b1ce3d42b656f4d747c73",
          ),
        )
      ).status,
      404,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(
    (
      await report.POST(
        new Request("https://example.invalid/api/report-results", {
          method: "POST",
        }),
      )
    ).status,
    401,
  );
  const weekly = await import(
    pathToFileURL(path.join(root, "weekly-execution.js")).href
  );
  assert.equal(
    (
      await weekly.POST(
        new Request("https://example.invalid/api/weekly-execution", {
          method: "POST",
        }),
      )
    ).status,
    401,
  );
  const worker = await import(
    pathToFileURL(path.join(root, "weekly-worker.js")).href
  );
  const priorQuote = {
    id: "stable",
    market_key: "count",
    side: "over",
    matchup_key: "match",
    featured: "Tank Bowl",
    active: true,
    projection_targets: { team: 123.5 },
  };
  const refreshQuote = {
    id: "new",
    market_key: "count",
    side: "over",
    matchup_key: "match",
    kind: "match_total",
    metadata: { generated: true },
    boost_pct: 0,
  };
  const preserved = worker.preserveRefreshQuote(
    refreshQuote,
    [priorQuote],
    "Matchups",
  );
  assert.equal(preserved.id, "stable");
  assert.deepEqual(preserved.metadata.projection_targets, { team: 123.5 });
  assert.equal(preserved.boost_pct, 25);
  assert.equal(preserved.featured, "Tank Bowl");
  assert.equal(refreshQuote.boost_pct, 0);
  assert.equal(
    worker.preserveRefreshQuote(
      { ...refreshQuote, side: "under" },
      [priorQuote],
      "Matchups",
    ).boost_pct,
    0,
  );
  assert(!worker.refreshPriorColumns.includes("*"));
  assert.equal(
    (
      await worker.POST(
        new Request("https://example.invalid/api/weekly-worker", {
          method: "POST",
        }),
      )
    ).status,
    401,
  );
  assert.equal(
    worker.easternTime("2026-10-07", "08:00"),
    "2026-10-07T12:00:00.000Z",
  );
  assert.equal(
    worker.easternTime("2026-11-04", "08:00"),
    "2026-11-04T13:00:00.000Z",
  );
  assert.equal(
    worker.retainPublishedBoard("published", "refresh_matchups"),
    false,
  );
  assert.equal(
    worker.retainPublishedBoard("published", "refresh_players"),
    false,
  );
  assert.equal(
    worker.retainPublishedBoard("published", "refresh_specials"),
    false,
  );
  assert.equal(
    worker.retainPublishedBoard("published", "generate_matchups"),
    true,
  );
  const morningRefresh = [
    "refresh_matchups",
    "refresh_players",
    "refresh_specials",
    "refresh_futures",
  ].map((operation) => ({
    operation,
    status: "done",
    created_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
  }));
  assert(worker.publicationRefreshComplete(morningRefresh));
  assert(
    worker.publicationRefreshComplete(
      morningRefresh.map((j) => ({
        ...j,
        created_at: new Date(Date.now() - 6 * 3600000).toISOString(),
      })),
    ),
    "Recent completion recovers a job queued many hours earlier",
  );
  assert.equal(
    worker.publicationRefreshComplete(
      morningRefresh.map((j) => ({
        ...j,
        completed_at: new Date(Date.now() - 3 * 3600000).toISOString(),
      })),
    ),
    false,
    "Old completed prices cannot open the book",
  );
  assert.equal(
    worker.publicationRefreshComplete(morningRefresh.slice(0, 3)),
    false,
    "Opening must wait for futures too",
  );
  const pendingWeek = {
    tickets: [
      { ticket_type: "standard", market_week: 6, pending: true, final: false },
    ],
    balances: [],
  };
  assert(worker.weeklyResultsPending("settlement", 6, pendingWeek));
  assert.equal(
    worker.weeklyResultsPending("settlement", 6, {
      ...pendingWeek,
      tickets: [{ ...pendingWeek.tickets[0], ticket_type: "future" }],
    }),
    false,
    "Season futures never block normal weekly settlement",
  );
  assert(
    worker.weeklyResultsPending("replenishment", 7, {
      tickets: [],
      balances: [{ reason: "Unresolved ticket — admin review required" }],
    }),
  );
  assert.equal(
    worker.weeklyResultsPending("replenishment", 7, {
      tickets: [],
      balances: [{ reason: "Already processed this week" }],
    }),
    false,
  );
  assert.equal(
    worker.weeklyResultsPending("replenishment", 7, {
      tickets: [
        {
          ticket_type: "standard",
          market_week: 7,
          pending: true,
          final: false,
        },
      ],
      balances: [{ reason: "Already processed this week" }],
    }),
    false,
    "New-week open bets cannot keep completed replenishment retrying",
  );
  assert.equal(
    worker.weeklyResultsPending("replenishment", 7, pendingWeek),
    true,
    "Unresolved prior-week tickets still hold replenishment",
  );
  assert.equal(
    worker.publicationRefreshComplete([
      ...morningRefresh.map((job) => ({
        ...job,
        created_at: "2026-10-14T11:30:00Z",
      })),
      {
        operation: "refresh_matchups",
        status: "failed",
        created_at: "2026-10-14T12:00:00Z",
      },
    ]),
    false,
    "A newer failed refresh must not be hidden by an older success",
  );
  assert.equal(
    worker.publicationRefreshComplete(morningRefresh.slice(0, 2)),
    false,
  );
  assert.equal(
    worker.publicationRefreshComplete([
      ...morningRefresh.slice(0, 2),
      { operation: "refresh_specials", status: "failed" },
    ]),
    false,
  );
  console.log(
    "Scheduled worker rejects unauthenticated requests; Eastern times follow daylight saving.",
  );
  const mail = await import(
    pathToFileURL(path.join(root, "_lib/mail.js")).href
  );
  const financialRecipient = {wallet_id:"wallet-2",league_id:"league",team_id:"shared-team",recipient:"coowner@example.invalid",display_name:"Participant",balance:100,accepted_balance:93};
  const financialTables = {
    tickets:[{id:"wallet-ticket",user_wallet_id:"wallet-2",league_id:"league",team_id:"shared-team",ticket_type:"parlay",market_week:5,league_season:1,placed_at:"2026-10-29T12:00:00Z",stake:7,accepted_combined_odds:100,accepted_potential_payout:14}],
    teams:[{id:"shared-team",team_name:"Shared team"}],
    leagues:[{id:"league",name:"Wallet fixture",sportsbook_url:"https://example.invalid",email_sender:"fixture@example.invalid"}],
    ticket_legs:[{selection:"Accepted pick",market_type:"Weekly Special"}],
  };
  const financialMailDb = {
    rpc:async(name)=>{assert.equal(name,"financial_email_recipient");return {data:financialRecipient,error:null};},
    from:table=>{
      assert(!["wallets","wallet_ledger","league_memberships"].includes(table),"user confirmation must not read legacy team finances/contact");
      const query={select:()=>query,eq:()=>query,order:()=>query,
        maybeSingle:async()=>({data:financialTables[table]?.[0],error:null}),
        then:(resolve,reject)=>Promise.resolve({data:financialTables[table]??[],error:null}).then(resolve,reject)};
      return query;
    },
  };
  const financialMailRow={kind:"confirmation",ticket_id:"wallet-ticket",team_id:"shared-team",league_id:"league",recipient:"coowner@example.invalid"};
  const {validateDeliveryScope,participantMailAudience}=await import(pathToFileURL(path.join(root,"_lib/league-communications.js")).href);
  await validateDeliveryScope(financialMailDb,financialMailRow);
  await assert.rejects(validateDeliveryScope(financialMailDb,{...financialMailRow,recipient:"primary@example.invalid"}),/financial account/);
  await assert.rejects(validateDeliveryScope(financialMailDb,{...financialMailRow,payload:{to:["primary@example.invalid"]}}),/payload recipient mismatch/);
  const financialConfirmation=await mail.buildEmail(financialMailDb,financialMailRow);
  assert(financialConfirmation.details.some(([label,value])=>label==="Balance after placement"&&value==="$93.00"));
  await assert.rejects(mail.buildEmail(financialMailDb,{...financialMailRow,recipient:"primary@example.invalid"}),/financial recipient unavailable/);
  const windowFixture=(args,patch={})=>{const until=new Date(Date.now()+3600000).toISOString();return {contract:"weekly-notification-window-v1",league_id:args.p_league,nfl_season:args.p_season,market_week:args.p_week,kind:args.p_kind,eligible:true,reason:null,board_id:"weekly",deadline:until,send_before:until,window_key:"a".repeat(32),minimum_stake:1,policy_revision:0,reopening_id:null,window_type:"pregame",...patch};};
  financialTables.leagues[0].nfl_season=2026;
  let genericContext={...financialRecipient,rank:2,participants:3};
  const genericTables={...financialTables,
    sportsbook_boards:[{id:"generic-board",status:"published",closes_at:"2026-11-05T23:00:00Z"}],
    tickets:[
      {id:"own-won",user_wallet_id:"wallet-2",team_id:"shared-team",status:"WON",stake:7,actual_payout:14},
      {id:"peer-won",user_wallet_id:"wallet-1",team_id:"shared-team",status:"WON",stake:500,actual_payout:1500},
      {id:"peer-open",user_wallet_id:"wallet-1",team_id:"shared-team",status:"OPEN",stake:100},
    ],user_wallet_entries:[{wallet_id:"wallet-2",amount:25},{wallet_id:"wallet-1",amount:900}],ticket_legs:[]};
  const genericDb={rpc:(name,args)=>{
    if(name==="notification_window")return {abortSignal:()=>Promise.resolve({data:windowFixture(args,{board_id:"generic-board"}),error:null})};
    assert.equal(name,"financial_email_context");assert.equal(args.p_team,"shared-team");
    return args.p_recipient===genericContext.recipient?{data:genericContext,error:null}:{data:null,error:{message:"pending approval"}};
  },from:table=>{
    assert(!["wallets","wallet_ledger","league_memberships"].includes(table),"user generic mail must not fall back to primary finances/contact");
    const filters=[];const query={select:()=>query,eq:(k,v)=>{filters.push([k,v]);return query;},neq:()=>query,gte:()=>query,in:()=>query,
      then:(resolve,reject)=>Promise.resolve({data:(genericTables[table]??[]).filter(r=>filters.every(([k,v])=>!(k in r)||r[k]===v)),error:null}).then(resolve,reject)};
    return query;
  }};
  const genericRow={wallet_model:"user",kind:"reminder",league_id:"league",team_id:"shared-team",recipient:genericContext.recipient,market_week:5};
  await validateDeliveryScope(genericDb,genericRow);
  const reminder=await mail.buildEmail(genericDb,genericRow);
  assert(reminder.details.some(([k,v])=>k==="Your available balance"&&v==="$100.00"));
  const monday=windowFixture({p_league:"league",p_season:2026,p_week:5,p_kind:"reminder"},{board_id:"generic-board",deadline:"2026-11-10T02:00:00Z",send_before:"2026-11-10T02:00:00Z"});
  const mondayReminder=await mail.buildEmail(genericDb,genericRow,monday);
  assert(mondayReminder.details.some(([k,v])=>k==="Available weekly opportunity until"&&v.includes("Mon")));
  assert(!/tonight|last call/i.test(mondayReminder.subject+" "+mondayReminder.heading));
  genericContext={...genericContext,balance:null};
  const pendingReminder=await mail.buildEmail(genericDb,genericRow);
  assert(pendingReminder.details.some(([,v])=>v==="Funding pending"));
  genericContext={...genericContext,balance:100};
  const roundup=await mail.buildEmail(genericDb,{...genericRow,kind:"recap"});
  assert(roundup.details.some(([k,v])=>k==="Net betting profit"&&v==="$7.00"));
  assert(roundup.details.some(([k,v])=>k==="Weekly replenishment"&&v==="$25.00"));
  assert(roundup.details.some(([k,v])=>k==="Account standing (all seasons)"&&v==="2 of 3"));
  assert(!roundup.paragraphs.some(p=>p.includes("under review")),"peer open ticket is not personal pending result");
  await assert.rejects(validateDeliveryScope(genericDb,{...genericRow,recipient:"primary@example.invalid"}),/financial account/);
  await assert.rejects(mail.buildEmail(genericDb,{...genericRow,recipient:"primary@example.invalid"}),/approval/);
  const audience=[{id:"wallet-1",league_id:"league",team_id:"shared-team",invited_email:"primary@example.invalid"},
    {id:"wallet-2",league_id:"league",team_id:"shared-team",invited_email:"coowner@example.invalid"}];
  const audienceDb={rpc:async(name,args)=>{assert.equal(name,"financial_email_audience");assert.equal(args.p_league,"league");return {data:audience,error:null};}};
  assert.deepEqual(await participantMailAudience(audienceDb,"league",[]),audience);
  assert.deepEqual(await participantMailAudience({rpc:async()=>({data:null,error:null})},"league",["legacy"]),["legacy"]);
  await assert.rejects(participantMailAudience(audienceDb,"other-league",[]),/strictly equal/);
  await assert.rejects(participantMailAudience({rpc:async()=>({data:[{...audience[0],league_id:"other"}],error:null})},"league",[]),/scope/);
  await assert.rejects(participantMailAudience({rpc:async()=>({data:null,error:{message:"unavailable"}})},"league",[]),/unavailable/);
  const {POST:intakePost}=await import(pathToFileURL(path.join(root,'league-intake.js')).href);
  const intakeFetch=globalThis.fetch,intakeEnv=Object.fromEntries(['SUPABASE_URL','SUPABASE_ANON_KEY','BOFF_ENVIRONMENT','NODE_ENV'].map(k=>[k,process.env[k]]));
  try{
    Object.assign(process.env,{SUPABASE_URL:'https://intake.invalid',SUPABASE_ANON_KEY:'synthetic-key',BOFF_ENVIRONMENT:'test',NODE_ENV:'test'});
    let owner=false,providerCalls=0,saved=null;
    const sourceId='1234567890123456789',requestKey='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const rawLeague={league_id:sourceId,name:'API intake fixture',sport:'nfl',season_type:'regular',season:'2026',status:'in_season',total_rosters:8,scoring_settings:{rec:1},roster_positions:['QB','BN'],settings:{playoff_week_start:15,playoff_teams:4}};
    const rawRosters=Array.from({length:8},(_,i)=>({roster_id:i+1,league_id:sourceId,owner_id:null,settings:{wins:0,losses:0,ties:0}}));
    globalThis.fetch=async(input,options={})=>{const url=String(input);if(url.includes('/auth/v1/user'))return Response.json({id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',email_confirmed_at:'2026-11-01T00:00:00Z'});
      if(url.includes('/rpc/league_intake_owner'))return Response.json(owner);
      if(url.includes('/rpc/save_league_intake_draft')){const body=JSON.parse(options.body);assert.equal(body.p_capabilities.admission,'review_required');saved={id:'draft-api',revision:1,state:'draft',source:body.p_source,capabilities:body.p_capabilities,source_league_id:sourceId,expires_at:'2099-01-01T00:00:00Z'};return Response.json({id:'draft-api',revision:1,state:'draft'});}
      if(url.includes('/rest/v1/league_intake_drafts'))return Response.json(saved?[saved]:[]);
      assert(url.startsWith('https://api.sleeper.app/v1/league/'));providerCalls++;return Response.json(url.endsWith('/rosters')?rawRosters:url.endsWith('/users')?[]:rawLeague);
    };
    const req=(body,auth=true)=>new Request('https://example.invalid/api/league-intake',{method:'POST',headers:auth?{authorization:'Bearer synthetic-owner','Content-Type':'application/json'}:{},body:typeof body==='string'?body:JSON.stringify(body)});
    assert.equal((await intakePost(req({},false))).status,401);
    assert.equal((await intakePost(req({sleeper_league_id:sourceId,request_key:requestKey}))).status,403);assert.equal(providerCalls,0);
    owner=true;assert.equal((await intakePost(req({sleeper_league_id:'https://bad.invalid',request_key:requestKey}))).status,400);
    assert.equal((await intakePost(req('x'.repeat(3000)))).status,413);assert.equal(providerCalls,0);
    const accepted=await intakePost(req({sleeper_league_id:sourceId,request_key:requestKey}));assert.equal(accepted.status,200);assert.equal(providerCalls,3);assert.equal((await accepted.json()).source.total_rosters,8);
    assert.equal((await intakePost(req({sleeper_league_id:sourceId,request_key:requestKey}))).status,200);assert.equal(providerCalls,3,'retries reuse the saved normalized draft before any provider read');
    assert.equal((await intakePost(req({sleeper_league_id:'999',request_key:requestKey}))).status,409);assert.equal(providerCalls,3);
  }finally{globalThis.fetch=intakeFetch;for(const[k,v]of Object.entries(intakeEnv)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
  const oldMailFetch = globalThis.fetch,
    oldMailKey = process.env.RESEND_API_KEY;
  // Opening content must be built from the final published board, not preview fixtures.
  const openingTeams = Array.from({ length: 4 }, (_, i) => ({
    id: `team${i}`,
    team_name: `Final Team ${i}`,
    wins: 4 - i,
    losses: i,
    ties: 0,
    avatar_url: `https://example.invalid/team${i}.png`,
  }));
  const openingQuotes = [
    {
      kind: "spread",
      matchup_key: "match",
      home_team_id: "team0",
      away_team_id: "team1",
      team_id: "team0",
      line: 7.5,
      home_projection: 140,
      away_projection: 147,
      featured: "Game of the Week",
    },
    { kind: "spread", matchup_key: "match", team_id: "team1", line: -7.5 },
    {
      kind: "moneyline",
      matchup_key: "match",
      team_id: "team0",
      odds: 150,
      boost_pct: 25,
    },
    {
      kind: "moneyline",
      matchup_key: "match",
      team_id: "team1",
      odds: -170,
      boost_pct: 25,
    },
    {
      kind: "match_total",
      matchup_key: "match",
      side: "over",
      line: 287.5,
      odds: -110,
      boost_pct: 0,
    },
  ];
  let openingStatus = "published";
  const openingDb = {
    rpc:(name,args)=>{assert.equal(name,"notification_window");return {abortSignal:()=>Promise.resolve({data:windowFixture(args),error:null})};},
    from(table) {
      const filters = {};
      const query = {
        select() {
          return query;
        },
        eq(k, v) {
          filters[k] = v;
          return query;
        },
        lte() {
          return query;
        },
        gt() {
          return query;
        },
        then(resolve) {
          const records =
            table === "teams"
              ? openingTeams
              : table === "league_memberships"
                ? openingTeams.map((t, i) => ({
                    team_id: t.id,
                    display_name: `Final Owner ${i}`,
                  }))
                : table === "wallets"
                  ? [{ balance: 173.25 }]
                  : table === "leagues"
                    ? [
                        {
                          name: "Test League",
                          sportsbook_url: "https://test.example.invalid/",
                          email_sender: "test@example.invalid",
                          nfl_season: 2026,
                          league_season: 3,
                        },
                      ]
                    : table === "sportsbook_boards"
                      ? [
                          filters.board_type === "future"
                            ? { id: "future" }
                            : {
                                id: "weekly",
                                status: openingStatus,
                                opens_at: "2026-10-07T12:00:00Z",
                                closes_at: "2026-10-09T00:00:00Z",
                              },
                        ]
                      : filters.board_id === "future"
                        ? openingTeams.map((t, i) => ({
                            team_id: t.id,
                            odds: 300 + i * 50,
                            metadata: { simulated_probability: 0.4 - i * 0.05 },
                          }))
                        : openingQuotes;
          return Promise.resolve({ data: records }).then(resolve);
        },
      };
      return query;
    },
  };
  const openingRow = {
    kind: "opening",
    league_id: "test",
    team_id: "team0",
    market_week: 5,
  };
  const finalOpening = await mail.buildEmail(openingDb, openingRow);
  assert.equal(finalOpening.featured[0].teams[0].record, "4–0");
  assert.equal(
    finalOpening.featured[0].teams[0].avatarUrl,
    openingTeams[0].avatar_url,
  );
  assert.equal(finalOpening.featured[0].teams[0].boostedOdds, "+188");
  assert.equal(finalOpening.featured[0].total, "287.5");
  assert.match(finalOpening.stories[0].title, /Championship Outlook/);
  assert.match(finalOpening.stories[0].text,/current availability/);
  assert.match(finalOpening.stories[0].text, /Final Owner 3.*\+450/);
  openingQuotes[4].line = 299.5;
  assert.equal(
    (await mail.buildEmail(openingDb, openingRow)).featured[0].total,
    "299.5",
  );
  openingStatus = "draft";
  await assert.rejects(
    () => mail.buildEmail(openingDb, openingRow),
    /waits for final publication/,
  );
  console.log(
    "Opening email uses final published lines, boosted odds, current records, avatars, owner favorites and balance; drafts cannot send.",
  );
  const changes = [];
  let providerFails = false;
  const acceptedPayload = {
    from: "Goldy Fantasy Sportsbook <sportsbook@coopergurrie.com>",
    to: ["test@example.invalid"],
    subject: "Accepted Ticket",
    html: "<p>Saved picks</p>",
    text: "Saved picks",
  };
  const emailDb = {
    rpc: async () => ({
      data: [
        {
          id: "mail",
          league_id: "test",
          team_id: "team0",
          recipient: "test@example.invalid",
          event_key: "confirmation:test",
          kind: "confirmation",
          ticket_id: "ticket",
          attempts: 1,
          payload: acceptedPayload,
        },
      ],
    }),
    from: (table) => ({
      select: () => {
        const query = {
          eq: () => query,
          maybeSingle: async () => ({
            data: { id: "fixture", role: "member" },
            error: null,
          }),
        };
        return query;
      },
      update: (patch) => ({
        eq: async () => {
          changes.push({ table, patch });
          return {};
        },
      }),
    }),
  };
  process.env.RESEND_API_KEY = "test-provider-key";
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://api.resend.com/emails");
    assert.equal(init.headers["Idempotency-Key"], "confirmation:test");
    assert.deepEqual(JSON.parse(init.body), acceptedPayload);
    return new Response(
      JSON.stringify(
        providerFails
          ? { message: "Temporary provider failure" }
          : { id: "provider-id" },
      ),
      {
        status: providerFails ? 503 : 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  };
  try {
    assert.equal((await mail.deliverEmails(emailDb)).sent, 1);
    assert(
      changes.some(
        (c) => c.table === "outbound_emails" && c.patch.status === "sent",
      ),
    );
    providerFails = true;
    changes.length = 0;
    assert.equal((await mail.deliverEmails(emailDb)).sent, 0);
    assert(
      changes.some((c) => c.patch.status === "failed" && c.patch.lease_until),
    );
    console.log(
      "Email delivery preserves the saved payload/idempotency key and records transient failures for retry.",
    );
    const captureEnvironment = { ...process.env };
    try {
      Object.assign(process.env, {
        BOFF_ENVIRONMENT: "development", BOFF_EXPECTED_PROJECT_REF: "whlcnlacueweaqpsupqs",
        SUPABASE_URL: "https://whlcnlacueweaqpsupqs.supabase.co",
        BOFF_APP_ORIGIN: "https://dev.sportsbook.coopergurrie.com",
        BOFF_MAIL_MODE: "capture", BOFF_AUTOMATION_MODE: "manual",
      });
      delete process.env.RESEND_API_KEY;
      let capturedCalls = 0;
      globalThis.fetch = async () => { throw new Error("Capture must never call a mail provider"); };
      const result = await mail.deliverEmails({ ...emailDb, rpc: async (name, args) => {
        if (name === "claim_scoped_outbound_emails") return emailDb.rpc();
        assert.equal(name, "capture_development_email");
        assert.equal(args.p_email, "mail");
        assert.deepEqual(args.p_payload, acceptedPayload);
        capturedCalls++;
        return { data: null, error: null };
      } });
      assert.deepEqual(result, { sent: 0, captured: 1 });
      assert.equal(capturedCalls, 1);
      // Frozen editorial payloads must pass current scope/window/minimum checks.
      // Receipts above deliberately have no window dependency or editorial cap.
      const promotionScope={p_league:"test",p_season:2026,p_week:5,p_kind:"reminder"};
      const frozenPromotion={...acceptedPayload,subject:"Weekly betting window",text:"Original frozen body"};
      async function promotionCase({kind="reminder",boundPatch={},currentPatch={},attempts=1,balance=100,unbound=false,changeAtDispatch=false,rpcFailure=false,fresh=false}={}){
        const scope={...promotionScope,p_kind:kind},bound=windowFixture(scope,{...boundPatch,...(kind==="reopening"?{reopening_id:"review",window_type:"reopening"}:{})});
        const row={id:"promotion",league_id:"test",team_id:"team0",recipient:"test@example.invalid",event_key:"promotion:test",kind,market_week:5,attempts,payload:fresh?null:frozenPromotion,notification_context:unbound?null:bound,...(kind==="reopening"?{reopening_id:"review"}:{})};
        let windowReads=0,captures=0;const updates=[],capturedPayloads=[];
        const fixture={rpc(name,args){
          if(name==="claim_scoped_outbound_emails")return Promise.resolve({data:[row],error:null});
          if(name==="notification_window")return {abortSignal:()=>{windowReads++;return Promise.resolve({data:windowFixture(scope,{...currentPatch,...(kind==="reopening"?{reopening_id:"review",window_type:"reopening"}:{}),...(changeAtDispatch&&windowReads>1?{eligible:false,reason:"closed"}:{})}),error:rpcFailure?{message:"Synthetic window outage"}:null});}};
          assert.equal(name,"capture_development_email");if(!fresh)assert.deepEqual(args.p_payload,frozenPromotion);capturedPayloads.push(args.p_payload);captures++;return Promise.resolve({data:null,error:null});
        },from(table){
          return {
            select(){const data=table==="leagues"?[{id:"test",name:"Fixture league",nfl_season:2026,sportsbook_url:"https://example.invalid",email_sender:"fixture@example.invalid"}]:table==="teams"?[{id:"team0",team_name:"Fixture team"}]:table==="league_memberships"?[{id:"member",team_id:"team0",display_name:"Member",role:"member"}]:table==="sportsbook_boards"?[{id:"weekly",status:"published",closes_at:bound.deadline}]:[{balance}];const query={eq:()=>query,maybeSingle:async()=>({data:{id:"member",role:"member"},error:null}),then:(resolve,reject)=>Promise.resolve({data,error:null}).then(resolve,reject)};return query;},
            update(patch){return {eq:async()=>{updates.push(patch);return {error:null};}};}
          };
        }};

        const result=await mail.deliverEmails(fixture);return {result,updates,captures,windowReads,capturedPayloads};
      }
      const rendered=await promotionCase({fresh:true});assert.equal(rendered.captures,1);assert(rendered.updates.some(u=>u.payload));assert(!/tonight|last call/i.test(rendered.capturedPayloads[0].subject));
      const closedDuringBuild=await promotionCase({fresh:true,changeAtDispatch:true});assert.equal(closedDuringBuild.captures,0);assert(closedDuringBuild.updates.some(u=>u.payload));assert(closedDuringBuild.updates.some(u=>u.status==="skipped"));
      const valid=await promotionCase();assert.equal(valid.captures,1);assert.equal(valid.windowReads,2);assert.deepEqual(valid.result,{sent:0,captured:1});
      for(const options of [
        {currentPatch:{eligible:false,reason:"closed"}},
        {currentPatch:{eligible:false,reason:"paused"}},
        {currentPatch:{eligible:false,reason:"stale_or_suspended"}},
        {currentPatch:{window_key:"b".repeat(32)}},
        {boundPatch:{send_before:new Date(Date.now()-1000).toISOString()}},
        {unbound:true},
        {balance:null},
        {balance:2,currentPatch:{minimum_stake:5}},
        {changeAtDispatch:true},
        {kind:"opening",currentPatch:{window_key:"b".repeat(32)}},
        {kind:"reopening",currentPatch:{eligible:false,reason:"reopening_unavailable"}},
      ]){const x=await promotionCase(options);assert.equal(x.captures,0);assert(x.updates.some(u=>u.status==="skipped"));assert(x.updates.every(u=>!("payload" in u)),"frozen content must never be rewritten");}
      for(const options of [{attempts:2,unbound:true},{attempts:2,balance:0},{attempts:2,currentPatch:{eligible:false,reason:"closed"}}]){const x=await promotionCase(options);assert.equal(x.captures,0);assert(x.updates.some(u=>u.status==="needs_review"),"ambiguous prior attempts retain review status");}
      const outage=await promotionCase({rpcFailure:true});assert.equal(outage.captures,0);assert(outage.updates.some(u=>u.status==="failed"));
      console.log("Promotional delivery revalidates frozen/new window scope, expiry, pause/staleness, minimum wager and dispatch-time closure; legacy/ambiguous attempts are preserved for review and receipts stay independent.");
      process.env.RESEND_API_KEY = "forbidden-development-provider-key";
      await assert.rejects(mail.deliverEmails(emailDb), /captured mail/);
      console.log("Development central mail boundary captures without provider access and refuses a live key.");
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in captureEnvironment)) delete process.env[key];
      Object.assign(process.env, captureEnvironment);
    }
  } finally {
    globalThis.fetch = oldMailFetch;
    if (oldMailKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = oldMailKey;
  }
  const savedFetch = globalThis.fetch;
  const savedUrl = process.env.SUPABASE_URL;
  const savedKey = process.env.SUPABASE_ANON_KEY;
  let membership = { role: "admin", invited_email: "admin@example.invalid" };
  let lookupFails = false;
  let claimFails = false;
  process.env.SUPABASE_URL = "https://supabase.example.invalid";
  process.env.SUPABASE_ANON_KEY = "public-test-key";
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      "Bearer test-session",
    );
    const json = (value, status = 200) =>
      new Response(JSON.stringify(value), {
        status,
        headers: { "content-type": "application/json" },
      });
    if (url.includes("/auth/v1/user"))
      return json({ id: "approved-user", email: "admin@example.invalid" });
    if (url.includes("/rpc/claim_memberships"))
      return claimFails ? json({ message: "claim unavailable" }, 400) : json(0);
    if (url.includes("/rpc/league_capabilities"))
      return lookupFails
        ? json({ message: "lookup unavailable" }, 400)
        : json(membership?{admin:membership.role==="admin",view:true,configure:false,team_id:null,bet:false}:null);
    if (url.includes("/teams")) return json([]);
    throw new Error(`Unexpected test request: ${url}`);
  };
  const request = () =>
    new Request("https://example.invalid/api/generate-markets", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-session",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        league_id: "approved-league",
        week: 5,
        nfl_season: 2026,
        category: "Weekly Specials",
      }),
    });
  try {
    const adminResponse = await POST(request());
    assert.equal(adminResponse.status, 400);
    assert.match(
      (await adminResponse.json()).error,
      /teams could not be loaded/,
    );
    membership = { ...membership, role: "member" };
    assert.equal((await POST(request())).status, 403);
    membership = null;
    assert.equal((await POST(request())).status, 403);
    lookupFails = true;
    assert.equal((await POST(request())).status, 503);
    lookupFails = false;
    claimFails = true;
    assert.equal((await POST(request())).status, 503);
    console.log(
      "Approved admin passes; members and unmapped users are denied; lookup failures are distinct.",
    );
  } finally {
    globalThis.fetch = savedFetch;
    if (savedUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = savedUrl;
    if (savedKey === undefined) delete process.env.SUPABASE_ANON_KEY;
    else process.env.SUPABASE_ANON_KEY = savedKey;
  }
  // Exercise the full generator with a missing kicker, a rostered kicker that
  // must never enter the free-agent pool, and separate team/player markets.
  {
    const envKeys = [
      "SUPABASE_URL",
      "SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "WEEKLY_WORKER_SECRET",
    ];
    const savedEnv = Object.fromEntries(
      envKeys.map((key) => [key, process.env[key]]),
    );
    const originalFetch = globalThis.fetch;
    Object.assign(process.env, {
      SUPABASE_URL: "https://replacement.invalid",
      SUPABASE_ANON_KEY: "fixture",
      SUPABASE_SERVICE_ROLE_KEY: "fixture",
      WEEKLY_WORKER_SECRET: "fixture-replacement",
    });
    const archives = [];
    let emptyRoster = false;
    const row = (id, position, value, injury_status = "") => ({
      player_id: id,
      date: "2030-10-13T17:00:00Z",
      stats: { gp: 1, rec: value },
      player: { position, injury_status, first_name: id },
      team: "BUF",
    });
    const projections = [
      row("qb1", "QB", 20),
      row("qb2", "QB", 18),
      row("owned-k", "K", 50),
      row("injured", "K", 90, "Out"),
      ...[12, 9, 6, 3].map((value, i) => row("free-k" + i, "K", value)),
    ];
    globalThis.fetch = async (input, init) => {
      const url = String(input),
        endpoint = new URL(url).pathname.split("/").at(-1);
      const json = (value) =>
        new Response(JSON.stringify(value), {
          headers: { "Content-Type": "application/json" },
        });
      if (url.startsWith("https://replacement.invalid")) {
        if (endpoint === "teams")
          return json(
            [1, 2].map((roster_id) => ({
              id: "team" + roster_id,
              roster_id,
              team_name: "Team " + roster_id,
              wins: 1,
              losses: 1,
              ties: 0,
            })),
          );
        if (endpoint === "leagues")
          return json({ sleeper_league_id: "fixture", nfl_season: 2030 });
        if (endpoint === "line_refresh_runtime") return json(null);
        if (endpoint === "model_controls")
          return json({ active_id: "baseline", baseline_id: "baseline" });
        if (endpoint === "model_config_versions")
          return json({
            id: "baseline",
            config: { score_scale: 1, variance_scale: 1 },
          });
        if (endpoint === "save_model_forecast") {
          archives.push(JSON.parse(init.body));
          return json(null);
        }
      }
      if (url.includes("/projections/")) return json(projections);
      if (url.endsWith("/rosters"))
        return json([
          {
            roster_id: 1,
            players: emptyRoster ? null : ["qb1", "injured"],
            reserve: ["injured"],
            starters: emptyRoster ? ["0", "0"] : ["qb1", "0"],
            settings: { wins: 1, losses: 1, ties: 0 },
          },
          {
            roster_id: 2,
            players: ["qb2", "owned-k"],
            starters: ["qb2", "owned-k"],
            settings: { wins: 1, losses: 1, ties: 0 },
          },
        ]);
      if (url.endsWith("/matchups/1"))
        return json([
          { roster_id: 1, matchup_id: 1 },
          { roster_id: 2, matchup_id: 1 },
        ]);
      if (url.endsWith("/league/fixture"))
        return json({
          season: "2030",
          roster_positions: ["QB", "K"],
          scoring_settings: { rec: 1 },
          settings: {},
        });
      throw new Error("Unexpected replacement fixture request: " + url);
    };
    try {
      for (const category of ["Matchups", "Player Points"]) {
        const result = await POST(
          new Request("https://fixture.invalid/api/generate-markets", {
            method: "POST",
            headers: { "x-worker-secret": "fixture-replacement" },
            body: JSON.stringify({
              league_id: "test",
              week: 1,
              nfl_season: 2030,
              category,
            }),
          }),
        );
        const body = await result.json();
        assert.equal(result.status, 200, JSON.stringify(body));
        assert(
          body.quotes
            .filter((q) => q.kind !== "player_h2h")
            .every((q) => !q.metadata.lineup_locked),
          category,
        );
        if (category === "Matchups") {
          assert.equal(body.quotes[0].home_projection, 29);
          assert.deepEqual(
            body.quotes[0].metadata.home_replacements[0].sources.map(
              (p) => p.id,
            ),
            ["free-k0", "free-k1", "free-k2"],
          );
        }
        if (category === "Player Points")
          assert(
            body.quotes
              .filter((q) => q.kind === "player_points")
              .every((q) => ["qb1", "qb2"].includes(q.metadata.player_id)),
          );
      }
      emptyRoster = true;
      const emptyResponse = await POST(
        new Request("https://fixture.invalid/api/generate-markets", {
          method: "POST",
          headers: { "x-worker-secret": "fixture-replacement" },
          body: JSON.stringify({
            league_id: "test",
            week: 1,
            nfl_season: 2030,
            category: "Matchups",
          }),
        }),
      );
      const emptyBody = await emptyResponse.json();
      assert.equal(emptyResponse.status, 200, JSON.stringify(emptyBody));
      assert.equal(emptyBody.quotes[0].home_projection, 29);
      assert(emptyBody.quotes.every((q) => !q.metadata.lineup_locked));
      const source = archives[0].p_payload.pool;
      assert(
        source.some((p) => p.id === "free-k0" && Number.isFinite(p.expected)),
        "Retain numeric replacement-contributor predictions",
      );
      assert(
        !source.some((p) => p.id === "free-k3"),
        "Omit unused unrostered projections",
      );
      assert.equal(archives[0].p_payload.retention_format,"compact-forecast-v1");
      assert.deepEqual(Object.keys(archives[0].p_sources).sort(),["roster_positions","scoring_settings"]);
      assert(!JSON.stringify(archives[0].p_payload).includes('"stats"'));
      assert.deepEqual(archives[1].p_payload.pool,[]);
      assert.deepEqual(archives[1].p_payload.models,[]);
      console.log(
        "Replacement integration preserves prices/eligibility and retains numeric contributor predictions without provider bodies.",
      );
    } finally {
      globalThis.fetch = originalFetch;
      for (const key of envKeys)
        if (savedEnv[key] === undefined) delete process.env[key];
        else process.env[key] = savedEnv[key];
    }
  }
  if (process.argv.includes("--live-futures")) {
    const liveFetch = globalThis.fetch;
    const sleeper = async (path) => {
      const r = await liveFetch(
        `https://api.sleeper.com/v1/league/1312126153980391424/${path}`,
      );
      assert(r.ok);
      return r.json();
    };
    const [rosters, users] = await Promise.all([
      sleeper("rosters"),
      sleeper("users"),
    ]);
    const teams = rosters.map((r) => ({
      id: `00000000-0000-4000-8000-${String(r.roster_id).padStart(12, "0")}`,
      roster_id: r.roster_id,
      team_name:
        users.find((u) => u.user_id === r.owner_id)?.metadata?.team_name ??
        users.find((u) => u.user_id === r.owner_id)?.display_name ??
        `Team ${r.roster_id}`,
      wins: r.settings.wins,
      losses: r.settings.losses,
      ties: r.settings.ties,
    }));
    process.env.SUPABASE_URL = "https://futures-test.invalid";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
    process.env.SUPABASE_ANON_KEY = "test-key";
    process.env.WEEKLY_WORKER_SECRET = "local-read-only-check";
    globalThis.fetch = async (input, init) =>
      String(input).startsWith("https://futures-test.invalid/rest/v1/teams")
        ? new Response(JSON.stringify(teams), {
            headers: { "Content-Type": "application/json" },
          })
        : liveFetch(input, init);
    try {
      const response = await POST(
        new Request("https://example.invalid/api/generate-markets", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-worker-secret": "local-read-only-check",
          },
          body: JSON.stringify({
            league_id: "test",
            week: 5,
            nfl_season: 2026,
            category: "Season Futures",
          }),
        }),
      );
      const result = await response.json();
      assert.equal(response.status, 200, JSON.stringify(result));
      assert.equal(result.quotes.length, 48);
      assert(result.quotes.every((q) => q.odds % 50 === 0));
      assert(result.quotes.every((q) => Math.abs(q.odds) <= 10000));
      console.log(
        JSON.stringify(
          result.quotes
            .filter((q) => q.kind === "future_champion")
            .map((q) => ({
              team: q.label,
              champion: q.metadata.simulated_probability,
              mean: q.metadata.season_mean,
              sd: q.metadata.weekly_score_sd,
              uncertainty: q.metadata.strength_uncertainty,
              missing: q.metadata.missing_projection_weeks,
            })),
        ),
      );
      console.log(
        `Live Sleeper futures check: ${result.quotes.length} quotes, ${teams.length} teams, all odds rounded to 50; no live database changes.`,
      );
    } finally {
      globalThis.fetch = liveFetch;
    }
  }
  console.log(
    "Compiled generation API loads and returns JSON without TypeScript source files.",
  );
} finally {
  const parent = path.resolve("node_modules") + path.sep;
  if (!path.resolve(root).startsWith(parent))
    throw new Error("Runtime test cleanup escaped node_modules.");
  await rm(root, { recursive: true, force: true });
}
