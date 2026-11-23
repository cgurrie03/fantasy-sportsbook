export const feedOptions = [
  {key:"tradeHistory", category:"This Week in History", label:"Include past trades", defaultValue:true},
  {key:"includeTaxi", category:"Injury Report", label:"Include taxi squad", defaultValue:false},
  {key:"injuriesMyMatchup", category:"Injury Report", label:"Only each member’s matchup", defaultValue:false},
  {key:"injuryBody", category:"Injury Report", label:"Show affected body part", defaultValue:true},
  {key:"featuredOdds", category:"Featured", label:"Show boosted odds", defaultValue:true},
  {key:"bigWinProfit", category:"Big Win", label:"Minimum profit in credits", defaultValue:50, min:0, max:10000},
  {key:"bigWinOdds", category:"Big Win", label:"Minimum positive odds", defaultValue:500, min:100, max:99900},
  {key:"underdogLead", category:"Underdog Watch", label:"Minimum lead in fantasy points", defaultValue:0, min:0, max:200},
  {key:"parlayProgress", category:"Parlay Watch", label:"Minimum winning legs", defaultValue:1, min:1, max:10},
  {key:"ticketStake", category:"Ticket Placed", label:"Minimum stake in credits", defaultValue:25, min:0, max:10000},
  {key:"ticketLegs", category:"Ticket Placed", label:"Minimum legs", defaultValue:3, min:1, max:10},
] as const;
export function feedOption(key: typeof feedOptions[number]["key"], choices: Record<string,boolean|number>|undefined) {
  return choices?.[key] ?? feedOptions.find(option=>option.key===key)!.defaultValue;
}
