// Inline white defaults survive clients that strip style blocks. Supporting
// inboxes opt into the same forest dark palette through the media query.
const surfaces:Record<string,string>={"#102b24":"#ffffff","#17392f":"#ffffff","#0d251e":"#ffffff","#214438":"#f4f5f4"};
const inks:Record<string,string>={"#f1f4ee":"#173d32","#e2e9df":"#273e34","#b2c4b7":"#637469","#e5c78d":"#8a5a13","#f4a295":"#a23e34","#add7db":"#315b67","#aed0b8":"#376047","#d2c6eb":"#66527e"};
const className=(property:string,color:string)=>'boff-'+property+'-'+color.slice(1);
const rule=(property:string,color:string)=>'.'+className(property,color)+'{'+property+':'+color+'!important}';
export function emailTheme(html:string,includeHead=true){
 const themed=html.replace(/<([a-z][\w:-]*)([^<>]*)>/gi,(_whole,tag:string,attributes:string)=>{
  const classes:string[]=[];
  let attrs=attributes.replace(/\bbgcolor="(#[a-f\d]{6})"/gi,(value:string,color:string)=>{
   const key=color.toLowerCase();if(!surfaces[key])return value;
   classes.push(className('background-color',key));return 'bgcolor="'+surfaces[key]+'"';
  }).replace(/\bstyle="([^"]*)"/gi,(_value:string,style:string)=>'style="'+style.split(';').map(part=>{
   const split=part.indexOf(':');if(split<0)return part;
   const property=part.slice(0,split).trim().toLowerCase(),value=part.slice(split+1).trim(),color=value.toLowerCase();
   if(property==='color'&&inks[color]){classes.push(className('color',color));return property+':'+inks[color];}
   if(['background','background-color'].includes(property)&&surfaces[color]){classes.push(className('background-color',color));return property+':'+surfaces[color];}
   if(property.startsWith('border')&&color.includes('#345046')){classes.push(className('border-color','#345046'));return property+':'+value.replace(/#345046/gi,'#e0e6df');}
   return part;
  }).join(';')+'"');
  if(classes.length){const extra=[...new Set(classes)].join(' ');attrs=/\bclass="/.test(attrs)?attrs.replace(/\bclass="([^"]*)"/,(_v:string,c:string)=>'class="'+c+' '+extra+'"'):attrs+' class="'+extra+'"';}
  return '<'+tag+attrs+'>';
 });
 if(!includeHead)return themed;
 const rules=[...Object.keys(surfaces).map(color=>rule('background-color',color)),...Object.keys(inks).map(color=>rule('color',color)),rule('border-color','#345046')].join('');
 return themed.replace('</head>','<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><style>:root{color-scheme:light dark;supported-color-schemes:light dark}@media(prefers-color-scheme:dark){'+rules+'}</style></head>');
}
