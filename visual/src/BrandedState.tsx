import {useId,type ReactNode} from "react";
import {Icon,Mark} from "./ui";
import {isDevelopment} from './environment';
export function BoffScreen({children}:{children:ReactNode}){
 return <main className="boff-screen">
  <header className="boff-screen-header"><a href="/" className="boff-screen-brand" aria-label="Boff Home"><Mark size={36}/><span>boff</span></a>{isDevelopment&&<span className="dev-badge">dev</span>}</header>
  <div className="boff-screen-card">{children}</div>
  <footer className="boff-screen-footer">Fantasy Sportsbook · Virtual Credits</footer>
 </main>;
}
export function StatusPanel({title,children,kind="empty",action,heading="h2"}:{
 title:string;children?:ReactNode;kind?:"empty"|"loading"|"error"|"access";action?:ReactNode;heading?:"h1"|"h2"|"h3";
}){
 const id=useId(),Heading=heading;
 return <section className={"boff-state boff-state-"+kind} role={kind==="error"?"alert":kind==="loading"?"status":undefined} aria-labelledby={id}>
  <span className="boff-state-icon"><Icon name={kind==="loading"?"clock":kind==="empty"?"ticket":"info"} size={24}/></span>
  <Heading id={id}>{title}</Heading>
  {children&&<div className="boff-state-copy">{children}</div>}
  {kind==="loading"&&<span className="boff-state-progress" aria-hidden="true"><span/></span>}
  {action&&<div className="boff-state-actions">{action}</div>}
 </section>;
}
