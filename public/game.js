// Игровая логика без интерфейса: работает и в браузере, и на сервере.
(function(){
const N=7,PTS=[0,0,4,8,12,16,20,24,28,32,36,40,45],DR=[[-1,0],[0,1],[1,0],[0,-1]];
const FA=[[1,0,1,0],[1,1,0,0],[1,1,1,0],[2,0,2,0],[2,2,0,0],[2,2,2,0]];
const FB=[[1,2,1,2],[1,0,2,0],[1,2,0,0],[1,2,1,2],[1,0,2,0],[1,2,0,0]];
// Фишки: base = [север, восток, юг, запад], 0 нет, 1 дорога, 2 рельсы; st = станция в центре
const SP=[{base:[1,1,2,1]},{base:[1,2,2,2]},{base:[1,1,1,1]},{base:[2,2,2,2]},{base:[1,1,2,1]},{base:[1,2,1,2],st:1}];
function exitAt(r,c,d){
  if((d===0&&r===0||d===2&&r===N-1)&&c%2===1)return [1,2,1][(c-1)/2];
  if((d===3&&c===0||d===1&&c===N-1)&&r%2===1)return [2,1,2][(r-1)/2];
  return 0}
function cur(d){let e=d.base.slice();if(d.flip)e=[e[0],e[3],e[2],e[1]];for(let i=0;i<d.rot;i++)e=[e[3],e[0],e[1],e[2]];return{e,st:d.st?1:0}}
function isOver(t){const e=t.e;return !t.st&&!!e[0]&&!!e[1]&&e[0]!==e[1]&&e[0]===e[2]&&e[1]===e[3]}
function check(b,r,c,t){let con=0;
  for(let d=0;d<4;d++){const e=t.e[d];if(!e)continue;
    const nr=r+DR[d][0],nc=c+DR[d][1];let o;
    if(nr<0||nc<0||nr>=N||nc>=N)o=exitAt(r,c,d);
    else{const n=b[nr*N+nc];o=n?n.e[(d+2)%4]:0}
    if(o){if(o!==e)return 0;con=1}}
  return con}
function canPlace(b,d){
  for(let i=0;i<N*N;i++)if(!b[i])for(let f=0;f<2;f++)for(let r=0;r<4;r++)
    if(check(b,(i/N)|0,i%N,cur({base:d.base,st:d.st,rot:r,flip:!!f})))return true;
  return false}
function score(b){
  const p=[...Array(N*N*2).keys()],fi=x=>{while(p[x]!==x){p[x]=p[p[x]];x=p[x]}return x},un=(a,c)=>{p[fi(a)]=fi(c)};
  let errors=0,center=0;
  for(let i=0;i<N*N;i++){const t=b[i];if(!t)continue;const r=(i/N)|0,c=i%N;
    if(r>=2&&r<=4&&c>=2&&c<=4)center++;
    if(!isOver(t)){const ty=[...new Set(t.e.filter(x=>x))];for(let k=1;k<ty.length;k++)un(i*2+ty[0]-1,i*2+ty[k]-1)}
    for(let d=0;d<4;d++){const e=t.e[d];if(!e)continue;
      const nr=r+DR[d][0],nc=c+DR[d][1];
      if(nr<0||nc<0||nr>=N||nc>=N)continue;
      const o=b[nr*N+nc];
      if(o&&o.e[(d+2)%4]===e){if(d===1||d===2)un(i*2+e-1,(nr*N+nc)*2+e-1)}else errors++}}
  const cnt={},ex=[];
  for(let c=1;c<N;c+=2)ex.push([0,c,0],[N-1,c,2]);
  for(let r=1;r<N;r+=2)ex.push([r,0,3],[r,N-1,1]);
  for(const[r,c,d]of ex){const t=b[r*N+c],ty=exitAt(r,c,d);if(t&&t.e[d]===ty){const q=fi((r*N+c)*2+ty-1);cnt[q]=(cnt[q]||0)+1}}
  let nets=0;for(const k in cnt)nets+=PTS[Math.min(cnt[k],12)];
  const longest=ty=>{let best=0,steps=0;const seen=new Set();
    const nb=i=>{const t=b[i],r=(i/N)|0,c=i%N,a=[];for(let d=0;d<4;d++)if(t.e[d]===ty){const nr=r+DR[d][0],nc=c+DR[d][1];if(nr<0||nc<0||nr>=N||nc>=N)continue;const o=b[nr*N+nc];if(o&&o.e[(d+2)%4]===ty)a.push(nr*N+nc)}return a};
    const go=(i,l)=>{if(steps++>400000)return;seen.add(i);if(l>best)best=l;for(const j of nb(i))if(!seen.has(j))go(j,l+1);seen.delete(i)};
    for(let i=0;i<N*N;i++)if(b[i]&&b[i].e.includes(ty))go(i,1);return best};
  const road=longest(1),rail=longest(2);
  return{nets,road,rail,center,errors,total:nets+road+rail+center-errors}}
function rollBases(){const r=a=>a[Math.random()*6|0];return[r(FA),r(FA),r(FA),r(FB)].map(base=>({base,st:0}))}
function validBoard(b){return Array.isArray(b)&&b.length===N*N&&b.every(t=>t===null||(t&&Array.isArray(t.e)&&t.e.length===4&&t.e.every(v=>v===0||v===1||v===2)))}
const api={N,PTS,SP,exitAt,cur,isOver,check,canPlace,score,rollBases,validBoard};
if(typeof module!=='undefined')module.exports=api;else window.RI=api;
})();
