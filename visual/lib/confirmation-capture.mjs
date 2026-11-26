export async function prepareConfirmations(db,contexts,renderers,origin){
 for(const context of contexts){
  const board=renderers.createEmailBoard(context.payload,[],origin,context.path,context.teamId,context.leagueName);
  board.edition=context.edition;
  const ticket=board.edition?.tickets?.[0];
  if(!ticket||ticket.id!==context.ticketId)throw Error('confirmation_ticket_unavailable');
  const message=renderers.renderAccountEmail('confirmation',board,{Week:context.week},ticket);
  await db('rpc/dev_capture_notification',{p_league:context.leagueId,p_user:context.userId,p_key:'confirmation:'+context.ticketId,
   p_kind:'confirmation',p_subject:message.subject,p_html:message.html,p_text:message.text});
 }
}
