self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil((async () => {
    const destination=safeNotificationUrl(event.notification.data?.url);
    const windows = await self.clients.matchAll({type:"window",includeUncontrolled:true});
    const tab = windows.find(window => new URL(window.url).origin === self.location.origin);
    if(tab) {await tab.navigate(destination);await tab.focus();}
    else await self.clients.openWindow(destination);
  })());
});
self.addEventListener("push", event => {
  try {
    const data=event.data?.json();
    if(data?.title) event.waitUntil(self.registration.showNotification(data.title,{body:data.body,tag:data.tag,data:{url:safeNotificationUrl(data.url)}}));
  } catch {}
});
function safeNotificationUrl(value){
 const fallback=new URL("/1312126153980391424/matchups",self.location.origin).href;
 try{
  const url=new URL(value,self.location.origin);
  return url.origin===self.location.origin&&url.pathname.startsWith("/1312126153980391424/")&&!url.username&&!url.password?url.href:fallback;
 }catch{return fallback;}
}
