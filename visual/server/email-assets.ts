// Public, versioned images rendered from the website's icon components.
// This endpoint serves static files and has no database or account access.
import icons from "./email-icons.json" with {type:"json"};
const files:Record<string,string>=icons;
Deno.serve(request=>{
 const name=new URL(request.url).pathname.split("/v1/").pop()??"";
 const asset=Object.hasOwn(files,name)?files[name]:undefined;
 if(!asset||!new URL(request.url).pathname.includes("/v1/"))return new Response("Not found",{status:404});
 if(!["GET","HEAD"].includes(request.method))return new Response("Method not allowed",{status:405,headers:{Allow:"GET, HEAD"}});
 const headers={"Content-Type":"image/png","Cache-Control":"public, max-age=31536000, immutable","X-Content-Type-Options":"nosniff","Access-Control-Allow-Origin":"*",ETag:'"v1-'+name+'"'};
 if(request.headers.get("If-None-Match")===headers.ETag)return new Response(null,{status:304,headers});
 return new Response(request.method==="HEAD"?null:Uint8Array.from(atob(asset),character=>character.charCodeAt(0)),{headers});
});
