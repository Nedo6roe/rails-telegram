// Сервер без зависимостей (Node 18+): раздаёт Mini App, ведёт комнаты и работает как Telegram-бот.
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const G=require('./public/game.js');
const PORT=process.env.PORT||3000,TOKEN=process.env.BOT_TOKEN||'',BASE=(process.env.BASE_URL||'').replace(/\/$/,'');
let BOT=process.env.BOT_USERNAME||'';
const rooms=new Map();
const FILES={'/':['index.html','text/html; charset=utf-8'],'/game.js':['game.js','text/javascript; charset=utf-8']};
const send=(res,code,obj)=>{res.writeHead(code,{'content-type':'application/json'});res.end(JSON.stringify(obj))};
const body=req=>new Promise(r=>{let s='';req.on('data',c=>{s+=c;if(s.length>3e5)req.destroy()});req.on('end',()=>{try{r(JSON.parse(s||'{}'))}catch{r({})}})});

function auth(init){
  if(!TOKEN){const m=/^dev:([^:]+):(.+)$/.exec(init||'');return m?{id:decodeURIComponent(m[1]),name:decodeURIComponent(m[2])}:null} // режим проверки без Telegram
  const p=new URLSearchParams(init||'');const hash=p.get('hash');p.delete('hash');
  const dcs=[...p.entries()].map(([k,v])=>k+'='+v).sort().join('\n');
  const sec=crypto.createHmac('sha256','WebAppData').update(TOKEN).digest();
  if(crypto.createHmac('sha256',sec).update(dcs).digest('hex')!==hash)return null;
  let u=null;try{u=JSON.parse(p.get('user'))}catch{}
  return u?{id:String(u.id),name:u.first_name||u.username||'Игрок'}:null}

function newCode(){let c;do{c=Array.from({length:4},()=>'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.random()*24|0]).join('')}while(rooms.has(c));return c}
function pub(room,uid){const me=room.players[uid];return{code:room.code,phase:room.phase,round:room.round,bases:room.bases,host:room.host,me:uid,
  players:room.order.map(id=>({id,name:room.players[id].name,done:room.players[id].done})),
  mine:{board:me.board,spUsed:me.spUsed},results:room.results}}
function push(room){for(const id of room.order){const s='data: '+JSON.stringify(pub(room,id))+'\n\n';for(const r of room.players[id].conns)r.write(s)}}
function advance(room){
  if(room.order.every(id=>room.players[id].done)){
    if(room.round<7){room.round++;room.bases=G.rollBases();room.order.forEach(id=>room.players[id].done=false)}
    else{room.phase='end';room.results=room.order.map(id=>{const p=room.players[id];return{id,name:p.name,sc:G.score(p.board||Array(49).fill(null))}})
      .sort((a,b)=>b.sc.total-a.sc.total||a.sc.errors-b.sc.errors)}}
  push(room)}

function api(P,me,b,res){
  const code=String(b.code||'').toUpperCase();const room=rooms.get(code);
  const add=r=>{if(!r.players[me.id]){r.players[me.id]={name:me.name,conns:new Set(),board:null,spUsed:null,done:false};r.order.push(me.id)}else r.players[me.id].name=me.name};
  if(P==='/api/room'){const c=newCode();const r={code:c,host:me.id,phase:'lobby',round:0,bases:[],order:[],players:{},results:null,t:Date.now()};rooms.set(c,r);add(r);return send(res,200,{code:c})}
  if(!room)return send(res,404,{error:'Комната не найдена'});
  room.t=Date.now();
  if(P==='/api/join'){
    if(!room.players[me.id]){if(room.phase!=='lobby')return send(res,400,{error:'Игра уже идёт'});if(room.order.length>=5)return send(res,400,{error:'В комнате уже 5 игроков'})}
    add(room);push(room);return send(res,200,{code})}
  const p=room.players[me.id];if(!p)return send(res,403,{error:'Вы не в этой комнате'});
  if(P==='/api/start'){if(room.host!==me.id||room.phase!=='lobby')return send(res,400,{error:'Начать может только создатель'});
    room.phase='play';room.round=1;room.bases=G.rollBases();push(room);return send(res,200,{})}
  if(P==='/api/confirm'){if(room.phase!=='play'||p.done)return send(res,400,{error:'Раунд уже подтверждён'});
    if(!G.validBoard(b.board)||!Array.isArray(b.spUsed)||b.spUsed.length!==6||b.spUsed.filter(Boolean).length>3)return send(res,400,{error:'Некорректное поле'});
    p.board=b.board;p.spUsed=b.spUsed.map(Boolean);p.done=true;advance(room);return send(res,200,{})}
  if(P==='/api/skip'){if(room.host!==me.id||room.phase!=='play')return send(res,400,{error:'Недоступно'});
    room.order.forEach(id=>room.players[id].done=true);advance(room);return send(res,200,{})}
  if(P==='/api/end'){if(room.host!==me.id||room.phase!=='play')return send(res,400,{error:'Недоступно'});
    room.phase='end';room.results=room.order.map(id=>{const q=room.players[id];return{id,name:q.name,sc:G.score(q.board||Array(49).fill(null))}})
      .sort((a,b)=>b.sc.total-a.sc.total||a.sc.errors-b.sc.errors);push(room);return send(res,200,{})}
  send(res,404,{error:'not found'})}

http.createServer(async(req,res)=>{
  const u=new URL(req.url,'http://x'),P=u.pathname;
  try{
    if(P==='/api/config')return send(res,200,{bot:BOT});
    if(P==='/api/events'){
      const me=auth(u.searchParams.get('init')),room=rooms.get((u.searchParams.get('code')||'').toUpperCase());
      if(!me||!room||!room.players[me.id]){res.writeHead(403);return res.end()}
      res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache',connection:'keep-alive'});
      const p=room.players[me.id];p.conns.add(res);res.write('data: '+JSON.stringify(pub(room,me.id))+'\n\n');
      const ka=setInterval(()=>res.write(':\n\n'),20000);req.on('close',()=>{clearInterval(ka);p.conns.delete(res)});return}
    if(req.method==='POST'&&P.startsWith('/api/')){
      const me=auth(req.headers['x-init']);if(!me)return send(res,401,{error:'Не удалось войти через Telegram'});
      return api(P,me,await body(req),res)}
    const f=FILES[P];if(!f){res.writeHead(404);return res.end()}
    res.writeHead(200,{'content-type':f[1]});res.end(fs.readFileSync(path.join(__dirname,'public',f[0])))
  }catch(e){send(res,500,{error:String(e)})}
}).listen(PORT,()=>console.log('Сервер на порту '+PORT+(TOKEN?'':' (режим без Telegram: откройте /?dev=Имя)')));
setInterval(()=>{for(const[c,r]of rooms)if(Date.now()-r.t>6*3600e3)rooms.delete(c)},600000);

// Бот: /start открывает игру, /start КОД ведёт в комнату друга
async function tgcall(m,b){const r=await fetch(`https://api.telegram.org/bot${TOKEN}/${m}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b||{})});return r.json()}
async function bot(){
  const me=await tgcall('getMe');if(!me.ok){console.log('Неверный BOT_TOKEN');return}
  BOT=me.result.username;console.log('Бот @'+BOT);
  if(BASE)await tgcall('setChatMenuButton',{menu_button:{type:'web_app',text:'Играть',web_app:{url:BASE}}});
  let off=0;
  for(;;){try{const r=await tgcall('getUpdates',{offset:off,timeout:30});
    for(const up of r.result||[]){off=up.update_id+1;const m=up.message;if(!m||!m.text||!BASE)continue;
      const room=(m.text.split(' ')[1]||'').toUpperCase().replace(/[^A-Z]/g,'');
      await tgcall('sendMessage',{chat_id:m.chat.id,text:room?'Вас зовут в игру '+room+'.':'Рельсы и дороги: соедините выходы дорогами и рельсами за 7 раундов.',
        reply_markup:{inline_keyboard:[[{text:'Играть',web_app:{url:BASE+(room?'/?room='+room:'')}}]]}})}
  }catch(e){await new Promise(r=>setTimeout(r,3000))}}}
if(TOKEN)bot();
