// Движок техасского холдема (без зависимостей). Карты: числа 0..51, ранг = (c>>2)+2, масть = c&3.
const crypto=require('crypto');
const START_CHIPS=1000,TURN_MS=30000,SHOW_MS=7000,STEP_MS=1500,HANDS_PER_LEVEL=6;
const CAT=['Старшая карта','Пара','Две пары','Тройка','Стрит','Флеш','Фулл-хаус','Каре','Стрит-флеш'];
const rk=c=>(c>>2)+2,st=c=>c&3;

function shuffle(){const d=[...Array(52).keys()];for(let i=51;i>0;i--){const j=crypto.randomInt(i+1);[d[i],d[j]]=[d[j],d[i]]}return d}

function score5(cs){
  const r=cs.map(rk).sort((a,b)=>b-a),flush=cs.every(c=>st(c)===st(cs[0]));
  const u=[...new Set(r)];let high=0;
  if(u.length===5){if(r[0]-r[4]===4)high=r[0];else if(r[0]===14&&r[1]===5&&r[4]===2)high=5}
  const cnt={};r.forEach(x=>cnt[x]=(cnt[x]||0)+1);
  const g=Object.keys(cnt).map(Number).sort((a,b)=>cnt[b]-cnt[a]||b-a),n=g.map(x=>cnt[x]);
  let cat,tb;
  if(high&&flush){cat=8;tb=[high]}
  else if(n[0]===4){cat=7;tb=g}
  else if(n[0]===3&&n[1]===2){cat=6;tb=g}
  else if(flush){cat=5;tb=r}
  else if(high){cat=4;tb=[high]}
  else if(n[0]===3){cat=3;tb=g}
  else if(n[0]===2&&n[1]===2){cat=2;tb=g}
  else if(n[0]===2){cat=1;tb=g}
  else{cat=0;tb=r}
  let v=cat;for(let i=0;i<5;i++)v=v*15+(tb[i]||0);return v}

function best(cards){ // лучший набор из 5 карт среди 5..7
  let b=-1;const n=cards.length;
  if(n<5)return -1;
  for(let a=0;a<n-4;a++)for(let b2=a+1;b2<n-3;b2++)for(let c=b2+1;c<n-2;c++)for(let d=c+1;d<n-1;d++)for(let e=d+1;e<n;e++){
    const s=score5([cards[a],cards[b2],cards[c],cards[d],cards[e]]);if(s>b)b=s}
  return b}
const RU={14:'тузов',13:'королей',12:'дам',11:'валетов',10:'десяток',9:'девяток',8:'восьмёрок',7:'семёрок',6:'шестёрок',5:'пятёрок',4:'четвёрок',3:'троек',2:'двоек'};
function name(s){ // s — результат best()
  if(s<0)return '';let v=s;const tb=[];for(let i=0;i<5;i++){tb.unshift(v%15);v=Math.floor(v/15)}
  const cat=v;
  if(cat===8)return tb[0]===14?'Роял-флеш':'Стрит-флеш';
  if(cat===1)return 'Пара '+RU[tb[0]];
  if(cat===2)return 'Две пары: '+RU[tb[0]]+' и '+RU[tb[1]];
  if(cat===3)return 'Тройка '+RU[tb[0]];
  if(cat===7)return 'Каре '+RU[tb[0]];
  return CAT[cat]}

// ---------- состояние раздачи ----------
const blinds=room=>{const l=Math.floor(Math.max(0,room.hand-1)/HANDS_PER_LEVEL),bb=20*Math.pow(2,Math.min(l,5));return{sb:bb/2,bb}};
const live=room=>room.order.filter(id=>!room.players[id].out);
const alive=room=>live(room).filter(id=>!room.players[id].folded);
const canAct=room=>alive(room).filter(id=>!room.players[id].allin);
function after(room,id,pred){const l=live(room);let i=l.indexOf(id);for(let k=1;k<=l.length;k++){const x=l[(i+k)%l.length];if(!pred||pred(room.players[x]))return x}return null}

function newRoom(code,host){return{code,host,phase:'lobby',order:[],players:{},hand:0,dealer:null,stage:null,board:[],deck:[],toAct:null,currentBet:0,minRaise:20,
  deadline:null,stepAt:null,nextHandAt:null,showdown:null,results:null,eliminated:[],t:Date.now()}}
function addPlayer(room,id,name){if(!room.players[id]){room.players[id]={name,chips:START_CHIPS,conns:new Set(),hole:[],bet:0,total:0,folded:false,allin:false,acted:false,out:false,last:''};room.order.push(id)}else room.players[id].name=name}

function start(room){room.phase='play';room.hand=0;startHand(room)}

function post(p,amount){const a=Math.min(amount,p.chips);p.chips-=a;p.bet+=a;p.total+=a;if(p.chips===0)p.allin=true;return a}

function startHand(room){
  const l=live(room);
  if(l.length<2)return finish(room);
  room.hand++;room.showdown=null;room.nextHandAt=null;room.board=[];room.deck=shuffle();room.stage='preflop';
  for(const id of l){Object.assign(room.players[id],{hole:[],bet:0,total:0,folded:false,allin:false,acted:false,last:''})}
  room.dealer=room.dealer===null?l[0]:after(room,room.dealer);
  const {sb,bb}=blinds(room),heads=l.length===2;
  const sbId=heads?room.dealer:after(room,room.dealer),bbId=after(room,sbId);
  const ps=room.players[sbId],pb=room.players[bbId];
  post(ps,sb);ps.last='Малый блайнд';post(pb,bb);pb.last='Большой блайнд';
  room.currentBet=Math.max(ps.bet,pb.bet);room.minRaise=bb;
  for(let k=0;k<2;k++)for(const id of l)room.players[id].hole.push(room.deck.pop());
  const first=after(room,bbId,p=>!p.folded&&!p.allin);
  room.toAct=first;room.deadline=null;room.stepAt=null;
  settle(room,heads?sbId:bbId,true)}

// Проверяет, закончен ли круг ставок, и двигает игру. last — кто только что ходил.
function settle(room,last,fresh){
  const al=alive(room);
  if(al.length===1)return uncontested(room,al[0]);
  const ca=canAct(room);
  const need=ca.filter(id=>{const p=room.players[id];return!(p.acted&&p.bet===room.currentBet)});
  const done=need.length===0||(ca.length<=1&&ca.every(id=>room.players[id].bet>=room.currentBet));
  if(done)return nextStage(room);
  room.toAct=fresh?room.toAct:after(room,last,p=>!p.folded&&!p.allin);
  room.deadline=Date.now()+TURN_MS;room.stepAt=null}

function nextStage(room){
  for(const id of live(room)){const p=room.players[id];p.bet=0;p.acted=false;if(!p.folded&&!p.allin)p.last=''}
  room.currentBet=0;room.minRaise=blinds(room).bb;
  if(room.stage==='preflop'){room.stage='flop';room.board.push(room.deck.pop(),room.deck.pop(),room.deck.pop())}
  else if(room.stage==='flop'){room.stage='turn';room.board.push(room.deck.pop())}
  else if(room.stage==='turn'){room.stage='river';room.board.push(room.deck.pop())}
  else return showdown(room);
  const ca=canAct(room);
  if(ca.length<=1){room.toAct=null;room.deadline=null;room.stepAt=Date.now()+STEP_MS;return}
  room.toAct=after(room,room.dealer,p=>!p.folded&&!p.allin);room.deadline=Date.now()+TURN_MS;room.stepAt=null}

function uncontested(room,id){
  const total=live(room).reduce((s,x)=>s+room.players[x].total,0);
  room.players[id].chips+=total;
  room.stage='showdown';room.toAct=null;room.deadline=null;room.stepAt=null;
  room.showdown={uncontested:true,pots:[{amount:total,winners:[id],hand:''}],reveals:{}};
  endHand(room)}

function showdown(room){
  const l=live(room),al=alive(room),sc={};
  for(const id of al)sc[id]=best(room.players[id].hole.concat(room.board));
  const levels=[...new Set(l.map(id=>room.players[id].total).filter(x=>x>0))].sort((a,b)=>a-b);
  const pots=[];let prev=0,carry=0;
  for(const L of levels){
    const con=l.filter(id=>room.players[id].total>=L),amt=(L-prev)*con.length+carry,el=con.filter(id=>!room.players[id].folded);prev=L;
    if(!el.length){carry=amt;continue}carry=0;
    pots.push({amount:amt,el})}
  if(carry&&pots.length)pots[pots.length-1].amount+=carry;
  const out=[];
  for(const pot of pots){
    const top=Math.max(...pot.el.map(id=>sc[id])),w=pot.el.filter(id=>sc[id]===top);
    const ord=[];let x=room.dealer;for(let k=0;k<l.length;k++){x=after(room,x);if(w.includes(x))ord.push(x)}
    const share=Math.floor(pot.amount/ord.length);let rem=pot.amount-share*ord.length;
    for(const id of ord){room.players[id].chips+=share+(rem>0?1:0);if(rem>0)rem--}
    out.push({amount:pot.amount,winners:ord,hand:name(top)})}
  const reveals={};for(const id of al)reveals[id]={hole:room.players[id].hole,hand:name(sc[id])};
  room.stage='showdown';room.toAct=null;room.deadline=null;room.stepAt=null;
  room.showdown={uncontested:false,pots:out,reveals};
  endHand(room)}

function endHand(room){
  for(const id of live(room)){const p=room.players[id];if(p.chips===0){p.out=true;room.eliminated.push(id)}}
  if(live(room).length<2){room.nextHandAt=Date.now()+SHOW_MS;room.ending=true}
  else room.nextHandAt=Date.now()+SHOW_MS}

function finish(room){
  const l=live(room);
  room.phase='end';room.toAct=null;room.deadline=null;room.stepAt=null;room.nextHandAt=null;
  const byChips=l.slice().sort((a,b)=>room.players[b].chips-room.players[a].chips);
  const rest=room.eliminated.slice().reverse().filter(id=>!l.includes(id));
  room.results=byChips.concat(rest).map(id=>({id,name:room.players[id].name,chips:room.players[id].chips}))}

function act(room,id,action,amount){
  if(room.phase!=='play'||!['preflop','flop','turn','river'].includes(room.stage))return 'Сейчас ходить нельзя';
  if(room.toAct!==id)return 'Сейчас не ваш ход';
  const p=room.players[id],toCall=room.currentBet-p.bet;
  if(action==='fold'){p.folded=true;p.last='Сброс'}
  else if(action==='call'||action==='check'){
    if(toCall<=0){p.last='Чек'}
    else{const a=post(p,toCall);p.last=p.allin?'Олл-ин '+p.bet:'Колл '+a}}
  else if(action==='raise'||action==='allin'){
    const maxTo=p.bet+p.chips;let to=action==='allin'?maxTo:Math.floor(Number(amount));
    if(!Number.isFinite(to))return 'Неверная сумма';
    if(to>maxTo)to=maxTo;
    if(to<=room.currentBet){ // это просто колл
      const a=post(p,toCall);p.last=p.allin?'Олл-ин '+p.bet:'Колл '+a}
    else{
      const minTo=room.currentBet+room.minRaise;
      if(to<minTo&&to<maxTo)return 'Минимальное повышение до '+minTo;
      const size=to-room.currentBet;if(size>=room.minRaise)room.minRaise=size;
      post(p,to-p.bet);room.currentBet=p.bet;
      for(const o of alive(room))if(o!==id)room.players[o].acted=false;
      p.last=p.allin?'Олл-ин '+p.bet:(toCall>0&&room.currentBet>0&&size>0?'Рейз '+p.bet:'Ставка '+p.bet)}}
  else return 'Неизвестное действие';
  p.acted=true;
  settle(room,id,false);return null}

// Вызывается сервером по таймеру. Возвращает true, если что-то изменилось.
function tick(room){
  const now=Date.now();
  if(room.phase!=='play')return false;
  if(room.nextHandAt&&now>=room.nextHandAt){room.nextHandAt=null;if(live(room).length<2)finish(room);else startHand(room);return true}
  if(room.stepAt&&now>=room.stepAt){room.stepAt=null;nextStage(room);return true}
  if(room.toAct&&room.deadline&&now>=room.deadline){const id=room.toAct,p=room.players[id];act(room,id,room.currentBet-p.bet<=0?'check':'fold');return true}
  return false}
function nextWake(room){return Math.min(...[room.nextHandAt,room.stepAt,room.deadline].filter(Boolean),Infinity)}

function endMatch(room){
  const l=live(room);
  if(['preflop','flop','turn','river'].includes(room.stage))for(const id of l){const q=room.players[id];q.chips+=q.total;q.total=0;q.bet=0}
  room.phase='end';room.toAct=null;room.deadline=null;room.stepAt=null;room.nextHandAt=null;
  const byChips=l.slice().sort((a,b)=>room.players[b].chips-room.players[a].chips);
  const rest=room.eliminated.slice().reverse().filter(id=>!l.includes(id));
  room.results=byChips.concat(rest).map(id=>({id,name:room.players[id].name,chips:room.players[id].chips}))}

// Что видит конкретный игрок: чужие карты скрыты до вскрытия.
function view(room,uid){
  const me=room.players[uid],sd=room.showdown,ca=room.toAct===uid;
  const toCall=me?Math.max(0,room.currentBet-me.bet):0;
  const pot=live(room).reduce((s,x)=>s+room.players[x].total,0);
  const myBest=me&&me.hole.length&&!me.folded?name(best(me.hole.concat(room.board))):'';
  return{code:room.code,phase:room.phase,host:room.host,me:uid,hand:room.hand,stage:room.stage,board:room.board,pot,
    blinds:blinds(room),dealer:room.dealer,toAct:room.toAct,deadline:room.deadline,turnMs:TURN_MS,nextHandAt:room.nextHandAt,serverNow:Date.now(),
    currentBet:room.currentBet,minRaiseTo:room.currentBet+room.minRaise,toCall,
    myHole:me?me.hole:[],myHand:myBest,
    players:room.order.map(id=>{const p=room.players[id];
      const reveal=sd&&sd.reveals[id]?sd.reveals[id]:null;
      return{id,name:p.name,chips:p.chips,bet:p.bet,folded:p.folded,allin:p.allin,out:p.out,last:p.last,
        hasCards:p.hole.length>0&&!p.folded&&!p.out,hole:reveal?reveal.hole:null,hand:reveal?reveal.hand:''}}),
    showdown:sd?{uncontested:sd.uncontested,pots:sd.pots}:null,results:room.results}}

module.exports={START_CHIPS,TURN_MS,newRoom,addPlayer,start,act,tick,nextWake,endMatch,view,best,name,score5,shuffle,live,blinds};
