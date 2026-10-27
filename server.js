// Покер (техасский холдем) для Telegram Mini App. Node 18+, без зависимостей.
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const PK=require('./poker.js');
const PORT=process.env.PORT||3000,TOKEN=process.env.BOT_TOKEN||'',BASE=(process.env.BASE_URL||'').replace(/\/$/,'');
let BOT=process.env.BOT_USERNAME||'';
const ALLOWED=(process.env.ALLOWED_IDS||'').split(',').map(s=>s.trim()).filter(Boolean); // закрытый доступ: номера Telegram через запятую
const rooms=new Map();
const BUYIN=PK.START_CHIPS,NEWBIE=5000,WFILE=path.join(__dirname,'wallets.json');
let wallets={};try{wallets=JSON.parse(fs.readFileSync(WFILE,'utf8'))}catch{}
let wsT=null;const saveW=()=>{clearTimeout(wsT);wsT=setTimeout(()=>{try{fs.writeFileSync(WFILE,JSON.stringify(wallets))}catch{}},500)};
function wal(id,name,saved){let w=wallets[id];
  if(!w){const sv=saved==null||saved===''?NaN:Number(saved);w=wallets[id]={name:name||'Игрок',bal:Number.isFinite(sv)&&sv>=0?Math.min(Math.floor(sv),1e6):NEWBIE};saveW()}
  else if(name&&w.name!==name){w.name=name;saveW()}
  return w}
const top=()=>Object.values(wallets).sort((a,b)=>b.bal-a.bal).slice(0,10).map(w=>({name:w.name,bal:w.bal}));
function settle(room){if(room.phase!=='end'||room.settled||!room.buyin)return;room.settled=true;room.delta={};
  for(const id of room.order){const w=wal(id,room.players[id].name),c=room.players[id].chips;w.bal+=c;room.delta[id]=c-room.buyin-(room.topup[id]||0)}
  saveW()}
const vw=(room,id)=>{const v=PK.view(room,id);v.wallet=wal(id).bal;v.buyin=room.buyin||BUYIN;v.delta=room.delta||null;v.topup=room.topup||null;v.players.forEach(p=>p.wallet=wal(p.id).bal);return v};
const send=(res,code,obj)=>{res.writeHead(code,{'content-type':'application/json'});res.end(JSON.stringify(obj))};
const body=req=>new Promise(r=>{let s='';req.on('data',c=>{s+=c;if(s.length>3e5)req.destroy()});req.on('end',()=>{try{r(JSON.parse(s||'{}'))}catch{r({})}})});

function auth(init){
  if(!TOKEN){const m=/^dev:([^:]+):(.+)$/.exec(init||'');return m?{id:decodeURIComponent(m[1]),name:decodeURIComponent(m[2])}:null}
  const p=new URLSearchParams(init||'');const hash=p.get('hash');p.delete('hash');
  const dcs=[...p.entries()].map(([k,v])=>k+'='+v).sort().join('\n');
  const sec=crypto.createHmac('sha256','WebAppData').update(TOKEN).digest();
  if(crypto.createHmac('sha256',sec).update(dcs).digest('hex')!==hash)return null;
  let u=null;try{u=JSON.parse(p.get('user'))}catch{}
  if(!u||(ALLOWED.length&&!ALLOWED.includes(String(u.id))))return null;
  return{id:String(u.id),name:u.first_name||u.username||'Игрок'}}

function newCode(){let c;do{c=Array.from({length:4},()=>'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.random()*24|0]).join('')}while(rooms.has(c));return c}
function push(room){settle(room);for(const id of room.order){const s='data: '+JSON.stringify(vw(room,id))+'\n\n';for(const r of room.players[id].conns)r.write(s)}}
function schedule(room){clearTimeout(room.timer);if(room.phase!=='play')return;
  const w=PK.nextWake(room);if(w===Infinity)return;
  room.timer=setTimeout(()=>{try{PK.tick(room);push(room)}catch(e){console.log('tick',e)}schedule(room)},Math.max(50,w-Date.now()+30))}
const done=room=>{push(room);schedule(room)};

function api(P,me,b,res){
  const code=String(b.code||'').toUpperCase();const room=rooms.get(code);
  if(P==='/api/me'){const w=wal(me.id,me.name,b.saved);return send(res,200,{wallet:w.bal,top:top()})}
  if(P==='/api/room'){const c=newCode();const r=PK.newRoom(c,me.id);rooms.set(c,r);PK.addPlayer(r,me.id,me.name);return send(res,200,{code:c})}
  if(!room)return send(res,404,{error:'Комната не найдена'});
  room.t=Date.now();
  if(P==='/api/join'){
    if(!room.players[me.id]){if(room.phase!=='lobby')return send(res,400,{error:'Игра уже идёт'});if(room.order.length>=5)return send(res,400,{error:'За столом уже 5 игроков'})}
    PK.addPlayer(room,me.id,me.name);push(room);return send(res,200,{code})}
  const p=room.players[me.id];if(!p)return send(res,403,{error:'Вы не за этим столом'});
  if(P==='/api/start'){if(room.host!==me.id||room.phase!=='lobby')return send(res,400,{error:'Начать может только создатель'});
    if(room.order.length<2)return send(res,400,{error:'Нужно минимум 2 игрока'});
    room.buyin=BUYIN;room.topup={};room.settled=false;room.delta=null;
    for(const id of room.order){const w=wal(id,room.players[id].name);if(w.bal<BUYIN){room.topup[id]=BUYIN-w.bal;w.bal=BUYIN}w.bal-=BUYIN}saveW();
    PK.start(room);done(room);return send(res,200,{})}
  if(P==='/api/act'){const e=PK.act(room,me.id,String(b.action||''),b.amount);if(e)return send(res,400,{error:e});done(room);return send(res,200,{})}
  if(P==='/api/end'){if(room.host!==me.id||room.phase!=='play')return send(res,400,{error:'Недоступно'});
    PK.endMatch(room);done(room);return send(res,200,{})}
  send(res,404,{error:'not found'})}

const FILES={'/':['index.html','text/html; charset=utf-8']};
http.createServer(async(req,res)=>{
  const u=new URL(req.url,'http://x'),P=u.pathname;
  try{
    if(P==='/api/config')return send(res,200,{bot:BOT});
    if(P==='/api/events'){
      const me=auth(u.searchParams.get('init')),room=rooms.get((u.searchParams.get('code')||'').toUpperCase());
      if(!me||!room||!room.players[me.id]){res.writeHead(403);return res.end()}
      res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache',connection:'keep-alive'});
      const p=room.players[me.id];p.conns.add(res);res.write('data: '+JSON.stringify(vw(room,me.id))+'\n\n');
      const ka=setInterval(()=>res.write(':\n\n'),20000);req.on('close',()=>{clearInterval(ka);p.conns.delete(res)});return}
    if(req.method==='POST'&&P.startsWith('/api/')){
      const me=auth(req.headers['x-init']);if(!me)return send(res,401,{error:'Не удалось войти через Telegram'});
      return api(P,me,await body(req),res)}
    const f=FILES[P];if(!f){res.writeHead(404);return res.end()}
    res.writeHead(200,{'content-type':f[1]});res.end(fs.readFileSync(path.join(__dirname,'public',f[0])))
  }catch(e){send(res,500,{error:String(e)})}
}).listen(PORT,()=>console.log('Сервер на порту '+PORT+(TOKEN?'':' (режим без Telegram: откройте /?dev=Имя)')));
setInterval(()=>{for(const[c,r]of rooms)if(Date.now()-r.t>6*3600e3){clearTimeout(r.timer);if(r.phase==='play'){PK.endMatch(r);settle(r)}rooms.delete(c)}},600000);

async function tgcall(m,b){const r=await fetch(`https://api.telegram.org/bot${TOKEN}/${m}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b||{})});return r.json()}
async function bot(){
  const me=await tgcall('getMe');if(!me.ok){console.log('Неверный BOT_TOKEN');return}
  BOT=me.result.username;console.log('Бот @'+BOT);
  if(BASE)await tgcall('setChatMenuButton',{menu_button:{type:'web_app',text:'Играть',web_app:{url:BASE}}});
  let off=0;
  for(;;){try{const r=await tgcall('getUpdates',{offset:off,timeout:30});
    for(const up of r.result||[]){off=up.update_id+1;const m=up.message;if(!m||!m.text||!BASE)continue;
      const uid=String(m.from&&m.from.id||''),closed=ALLOWED.length>0&&!ALLOWED.includes(uid);
      if(/^\/id\b/.test(m.text)||closed){await tgcall('sendMessage',{chat_id:m.chat.id,text:(closed?'Это закрытая игра. ':'')+'Ваш номер: '+uid+(closed?'. Отправьте его владельцу игры, чтобы вас добавили.':'')});continue}
      const room=(m.text.split(' ')[1]||'').toUpperCase().replace(/[^A-Z]/g,'');
      await tgcall('sendMessage',{chat_id:m.chat.id,text:room?'Вас зовут за стол '+room+'.':'Техасский холдем на игровые фишки, без денег. Нажмите «Играть».',
        reply_markup:{inline_keyboard:[[{text:'Играть',web_app:{url:BASE+(room?'/?room='+room:'')}}]]}})}
  }catch(e){await new Promise(r=>setTimeout(r,3000))}}}
if(TOKEN)bot();
