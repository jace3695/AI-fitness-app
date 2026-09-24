"""Original mannequin gesture examples. No private images or anatomical grading.
--reviewed only after actual React diagrams have been inspected.
"""
import json,math,pathlib,sys,re
ROOT=pathlib.Path(__file__).resolve().parents[1]
def line(id,d,p,group='gesture'):
 return dict(id=id,label=id,d=d,start=list(p),direction=list(p),group=group)
def chain(id,pts,group='gesture'):
 return line(id,'M'+' L'.join(' '.join(map(str,p)) for p in pts),pts[0],group)
def circle(id,p,r=26,group='shape'):
 x,y=p;return line(id,f'M{x-r} {y} A{r} {r} 0 1 0 {x+r} {y} A{r} {r} 0 1 0 {x-r} {y}',(x-r,y),group)
def capsule(id,a,b,r,group='shape'):
 x,y=a;X,Y=b;length=math.hypot(X-x,Y-y);nx=-(Y-y)/length*r;ny=(X-x)/length*r
 return line(id,f'M{x+nx} {y+ny} L{X+nx} {Y+ny} A{r} {r} 0 0 0 {X-nx} {Y-ny} L{x-nx} {y-ny} A{r} {r} 0 0 0 {x+nx} {y+ny}',(x+nx,y+ny),group)
def pose(kind,i=0,capstone=False):
 head=(200,75);neck=(200,111);hip=(200,224);shoulders=[(175,132),(225,132)];arms=[[(175,132),(157,174),(145,204)],[(225,132),(243,174),(255,204)]];legs=[[(188,224),(180,273),(173,327)],[(212,224),(222,273),(229,327)]]
 if kind=='lean':
  head=(158,83);neck=(172,119);hip=(212,224);shoulders=[(150,136),(195,123)];arms=[[(150,136),(151,178),(174,209)],[(195,123),(217,160),(245,185)]];legs=[[(200,224),(184,275),(174,327)],[(224,224),(241,276),(250,327)]]
 if kind in ['raise','both']:
  arms[1]=[(225,132),(256,101),(278,62)]
  if kind=='both':
   arms[0]=[(175,132),(144,101),(122,62)]
   if i:arms=[[(175,132),(155,90),(148,45)],[(225,132),(265,110),(300,88)]]
 if kind=='sit':
  head=(145,78);neck=(150,114);hip=(165,226);shoulders=[(152,136)];arms=[[(152,136),(193,176),(244,176)]];legs=[[(165,226),(263,226),(263,327)]]
 if kind=='walk':
  head=(202,75);neck=(207,111);hip=(200,220);shoulders=[(198,133),(212,131)];arms=[[(198,133),(165,173),(142,194)],[(212,131),(247,170),(264,182)]];legs=[[(200,220),(239,264),(278,327)],[(200,220),(168,268),(131,321)]]
 # Second examples face/lean/raise the other way, preserving shared path IDs.
 mirror=lambda p:(400-p[0],p[1]) if i else p
 head,neck,hip=map(mirror,[head,neck,hip]);shoulders=list(map(mirror,shoulders));arms=[list(map(mirror,a)) for a in arms];legs=[list(map(mirror,a)) for a in legs]
 if kind=='stand' and i:
  head=(200,85);neck=(200,121);hip=(200,234);shoulders=[(172,141),(228,141)];arms=[[(172,141),(159,180),(147,211)],[(228,141),(241,180),(253,211)]];legs=[[(188,234),(172,278),(157,327)],[(212,234),(228,278),(243,327)]]
 if capstone:
  scale=lambda p:(200+(p[0]-200)*.86,70+(p[1]-70)*.94)
  head,neck,hip=map(scale,[head,neck,hip]);shoulders=list(map(scale,shoulders));arms=[list(map(scale,a)) for a in arms];legs=[list(map(scale,a)) for a in legs]
 ref=[circle('head',head),capsule('torso',neck,hip,17 if kind in ['walk','sit'] else 25)]
 skeleton=[circle('head',head,26,'gesture'),chain('center',[(head[0],head[1]+26),neck,hip]),chain('shoulders',shoulders)] if len(shoulders)>1 else [circle('head',head,26,'gesture'),chain('center',[(head[0],head[1]+26),neck,hip])]
 for j,a in enumerate(arms):
  skeleton.append(chain(f'arm{j}',a))
  for k in range(2):ref.append(capsule(f'arm{j}-{k}',a[k],a[k+1],9))
 for j,a in enumerate(legs):
  skeleton.append(chain(f'leg{j}',[hip,*a[1:]]));foot=[a[-1],(a[-1][0]+(-16 if i else 16),a[-1][1])];skeleton.append(chain(f'foot{j}',foot))
  for k in range(2):ref.append(capsule(f'leg{j}-{k}',a[k],a[k+1],11))
  ref.append(capsule(f'foot{j}',foot[0],foot[1],6))
 return ref,skeleton,head,neck,hip,arms,legs
names={'stand':'편하게 서기','lean':'옆으로 기울기','raise':'한 팔 들기','sit':'앉기','both':'두 팔 들기','walk':'한 발 내딛기'}
focus={53:'머리에서 몸과 발까지 이어지는 가운데 길',54:'머리가 발보다 어느 쪽으로 기울었는지',55:'올라간 팔의 시작점과 끝',56:'앞으로 나온 허벅지와 아래로 꺾인 다리',57:'양쪽 어깨에서 위로 향하는 두 팔',58:'앞쪽과 뒤쪽 발로 갈라지는 다리',59:'몸 덩어리를 더해도 유지되는 팔 방향',60:'이 자세에서 가장 중요한 팔 또는 다리 방향'}
steps={53:['원본의 머리·몸·발을 봐요.','머리 자리를 동그라미로 놓아요.','몸 가운데의 긴 길을 이어요.','발 자리와 몸 아래 방향을 짧게 표시해요.','원본과 머리·몸·발의 방향을 비교해요.'],54:['곧게 선 길과 기운 자세를 비교해요.','기운 쪽의 머리 자리를 놓아요.','몸이 기운 방향을 길게 이어요.','발 자리를 놓고 얼굴은 생략해요.','원본과 같은 쪽으로 기울었는지 봐요.'],55:['어느 팔이 올라갔는지 먼저 봐요.','머리와 몸 가운데 길을 놓아요.','양쪽 팔이 붙는 어깨 자리를 표시해요.','올라간 팔 끝으로 짧은 선을 이어요.','올라간 팔과 내려간 팔을 비교해요.'],56:['앉은 몸과 꺾인 다리를 봐요.','머리와 몸 방향을 놓아요.','앞으로 나온 허벅지 방향을 이어요.','무릎에서 아래 다리와 발까지 이어요.','서 있을 때와 다른 다리의 꺾임을 봐요.'],57:['두 팔이 향하는 쪽을 봐요.','머리와 몸 가운데 길을 놓아요.','양쪽 팔 시작 자리를 표시해요.','두 팔 끝까지 각각 이어요.','두 팔이 위를 향하는지 원본과 비교해요.'],58:['옆모습에서 두 발이 갈라진 방향을 봐요.','머리와 몸 가운데 길을 놓아요.','앞발과 뒷발 자리를 따로 표시해요.','몸 아래에서 두 발로 각각 이어요.','양다리의 서로 다른 방향만 비교해요.'],59:['D55 또는 D57에서 본 막대 자세를 봐요.','몸 방향선 주위에 작은 덩어리를 얹어요.','팔 선 주위에 짧은 덩어리를 얹어요.','머리 원을 확인하고 손·발 세부는 생략해요.','처음의 팔 방향이 그대로 보이는지 비교해요.'],60:['새 자세 하나를 골라 큰 방향을 봐요.','머리와 몸 방향을 먼저 놓아요.','중요한 팔 또는 다리 방향을 골라요.','빈 공간에 짧은 선으로 자세를 옮겨요.','원본과 중요한 방향 한두 곳만 비교해요.']}
lessons={53:['stand'],54:['lean'],55:['raise'],56:['sit'],57:['both'],58:['walk'],59:['raise','both'],60:['stand','lean','raise','sit']}
for n,kinds in lessons.items():
 examples=[]
 specs=[(k,i) for k in kinds for i in ([0,1] if n<59 else [0])]
 for kind,i in specs:
  ref,sk,head,neck,hip,arms,legs=pose(kind,i)
  if n==60:
   ref,sk,head,neck,hip,arms,legs=pose(kind,1,True)
  keys=[l['id'] for l in sk];core=[k for k in keys if k in ['head','center'] or k.startswith(('leg','foot'))];shoulder=[k for k in keys if k=='shoulders']
  frames=[[],['head'],['head','center'],keys,keys];base=[];easy=['center'];anchors=[];choices=[]
  if n==54:
   choices=[dict(id='left',label='왼쪽으로 기울기',lines=[chain('choice',[(172,119),(212,224)])]),dict(id='right',label='오른쪽으로 기울기',lines=[chain('choice',[(228,119),(188,224)])])]
  if n in [55,57]:frames=[[],core,core+shoulder,keys,keys];easy=core+shoulder+(['arm0'] if n==57 else ['arm0']);anchors=[arms[1][-1]]
  if n==56:
   sk=[l for l in sk if l['id'] not in ['leg0']]+[chain('thigh',legs[0][:2]),chain('shin',legs[0][1:])];keys=[l['id'] for l in sk];frames=[[],['head','center'],['head','center','thigh'],keys,keys];easy=['head','center','thigh','shin']
  if n==58:frames=[[],['head','center'],['head','center','foot0','foot1'],keys,keys];easy=[];anchors=[a[-1] for a in legs]
  if n==59:
   base=keys[:];masses=[l for l in ref if l['id']=='torso' or l['id'].startswith('arm')];sk += [dict(l,id='mass-'+l['id']) for l in masses];allkeys=[l['id'] for l in sk];frames=[base,base+['mass-torso'],allkeys,allkeys,allkeys];easy=['head','center','mass-torso']
  if n==60:frames=[[],['head','center'],['head','center']+[k for k in keys if k.startswith('arm' if kind=='raise' else 'leg')],keys,keys];easy=keys
  examples.append(dict(id=f'd{n}-{kind}-{i+1}',name=names[kind]+(' · 반대 방향' if i or n==60 else ' · 첫 방향'),source='연이 자체 제작 단순 마네킹. 방향 연습용이며 인체 비례나 자연스러운 보행을 채점하지 않음.',lines=ref,gesture=dict(lines=sk,frames=frames,baseLines=base,easyLines=easy,anchors=[list(p) for p in anchors],focus=focus[n],choices=choices)))
 def stable(v):
  if isinstance(v,float):return round(v,3)
  if isinstance(v,list):return [stable(x) for x in v]
  if isinstance(v,tuple):return [stable(x) for x in v]
  if isinstance(v,dict):return {k:re.sub(r'-?\d+(?:\.\d+)?',lambda m:f'{float(m[0]):.3f}'.rstrip('0').rstrip('.'),x) if k=='d' else stable(x) for k,x in v.items()}
  return v
 lesson=dict(id=f'D{n}',gesturePractice=True,examples=stable(examples),steps=[dict(text=t,lines=[],action='look' if i==0 else 'compare' if i==4 else 'draw') for i,t in enumerate(steps[n])],readiness=dict(manuscript=True,examples=True,visualMatch='--reviewed' in sys.argv,browser=False))
 (ROOT/f'content/drawing/reviewed/d{n}.json').write_text(json.dumps(lesson,ensure_ascii=False,indent=2)+'\n')
print('8 gesture lessons, 18 examples generated')
