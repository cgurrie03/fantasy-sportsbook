// Preserve original SQL, splitting only outside quoted literals/comments.
export function sqlStatements(source){
 const statements=[];let start=0;
 for(let i=0;i<source.length;){
  if(source.startsWith('--',i)){const end=source.indexOf('\n',i);i=end<0?source.length:end+1;continue;}
  if(source.startsWith('/*',i)){
   let depth=1;i+=2;
   while(i<source.length&&depth){if(source.startsWith('/*',i)){depth++;i+=2;}else if(source.startsWith('*/',i)){depth--;i+=2;}else i++;}
   if(depth)throw Error('Unterminated SQL comment');continue;
  }
  const dollar=/^\$[\w]*\$/.exec(source.slice(i));
  if(dollar){const end=source.indexOf(dollar[0],i+dollar[0].length);if(end<0)throw Error('Unterminated SQL dollar quote');i=end+dollar[0].length;continue;}
  if(source[i]==="'"||source[i]==='"'){
   const quote=source[i],escaped=quote==="'"&&/[eE]/.test(source[i-1]??'')&&!/[\w]/.test(source[i-2]??'');i++;let closed=false;
   while(i<source.length){if(escaped&&source[i]==='\\'){i+=2;continue;}if(source[i]===quote){if(source[i+1]===quote){i+=2;continue;}i++;closed=true;break;}i++;}
   if(!closed)throw Error('Unterminated SQL quote');continue;
  }
  if(source[i]===';'){const statement=source.slice(start,i+1).trim();if(statement)statements.push(statement);start=i+1;}i++;
 }
 if(source.slice(start).trim())statements.push(source.slice(start).trim());return statements;
}
