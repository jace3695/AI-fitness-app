"""Authored construction diagrams for character consistency; no private assets."""
import json,pathlib,sys,copy
R=pathlib.Path(__file__).resolve().parents[1]
def line(i,d,p=(100,100),group='shape',fill=None):
 x=dict(id=i,label=i,d=d,start=list(p),direction=list(p),group=group)
 if fill:x['fill']=fill
 return x
def ellipse(i,x,y,rx,ry,group='shape',fill=None):return line(i,f'M{x-rx} {y} A{rx} {ry} 0 1 0 {x+rx} {y} A{rx} {ry} 0 1 0 {x-rx} {y}',(x-rx,y),group,fill)
def mascot(family,pose='stand',emotion='neutral',part='mouth'):
 bunny=family=='rabbit';head=[ellipse('head',200,132,64,54)]
 ears=[line('ears','M150 100 Q126 8 150 14 Q171 20 170 85 M230 85 Q229 20 250 14 Q274 8 250 100',(150,100))] if bunny else [line('ears','M149 99 L143 48 L183 80 M217 80 L257 48 L251 99',(149,99))]
 eyes=[ellipse('eyes-left',179,133,4,5,'detail','ink'),ellipse('eyes-right',221,133,4,5,'detail','ink')]
 mouth=[line('mouth','M190 157 Q200 164 210 157',(190,157),'detail')]
 if part=='eyes' and emotion=='happy':eyes=[line('eyes-left','M171 136 Q179 123 187 136',(171,136),'detail'),line('eyes-right','M213 136 Q221 123 229 136',(213,136),'detail')]
 if part=='eyes' and emotion=='surprised':eyes=[ellipse('eyes-left',179,133,8,10,'detail'),ellipse('eyes-right',221,133,8,10,'detail')]
 if part=='eyes' and emotion=='sad':eyes=[line('eyes-left','M171 129 Q179 140 187 133',(171,129),'detail'),line('eyes-right','M213 133 Q221 140 229 129',(213,133),'detail')]
 if part=='mouth' and emotion=='happy':mouth=[line('mouth','M186 153 Q200 178 214 153',(186,153),'detail')]
 if part=='mouth' and emotion=='surprised':mouth=[ellipse('mouth',200,158,8,10,'detail')]
 if part=='mouth' and emotion=='sad':mouth=[line('mouth','M187 164 Q200 150 213 164',(187,164),'detail')]
 body=[line('body','M171 184 Q151 204 151 247 Q151 280 200 283 Q249 280 249 247 Q249 204 229 184',(171,184))]
 arms=[line('arm-left','M158 207 Q132 231 135 247 Q140 258 152 243',(158,207)),line('arm-right','M242 207 Q268 231 265 247 Q260 258 248 243',(242,207))]
 legs=[ellipse('foot-left',176,288,18,10),ellipse('foot-right',224,288,18,10)]
 if pose=='wave':arms[1]=line('arm-right','M237 204 Q264 189 273 152 Q284 133 292 149 Q296 174 244 224',(237,204))
 if pose=='sit':
  body=[line('body','M171 184 Q152 208 153 245 Q159 264 206 265 Q247 262 247 238 Q245 207 229 184',(171,184))]
  arms=[line('arm-left','M160 206 Q167 225 188 233',(160,206)),line('arm-right','M240 206 Q232 225 211 233',(240,206))]
  legs=[line('foot-left','M164 250 Q136 253 126 275 Q130 290 150 280 L181 266',(164,250)),line('foot-right','M223 257 Q247 263 273 257 Q290 264 278 277 Q256 287 217 273',(223,257))]
 if pose=='walk':
  arms=[line('arm-left','M158 207 Q136 209 119 229',(158,207)),line('arm-right','M242 207 Q266 218 273 240',(242,207))]
  legs=[line('foot-left','M173 280 L151 304 L129 308 Q116 320 139 322 L167 316 L190 283',(173,280)),line('foot-right','M208 283 L240 309 L258 314 Q275 319 267 327 L244 324 L224 282',(208,283))]
 return head+ears+body+arms+legs+eyes+mouth
features=[dict(id='ears',label='耳',lines=['ears']),dict(id='spacing',label='눈 사이 간격',lines=['eyes-left','eyes-right']),dict(id='ratio',label='머리가 몸보다 넓은 비율',lines=['head','body'])]
features[0]['label']='귀의 모양과 붙는 자리'
steps={61:['기준 그림에서 유지할 특징 두 개를 골라요.','머리와 귀를 먼저 놓아요.','머리보다 좁은 몸과 짧은 팔다리를 이어요.','두 눈의 간격과 입을 확인해요.','고른 두 특징을 내 그림에서도 짚어요.'],62:['기준 그림과 반가운 얼굴을 비교해요.','머리와 귀의 크기를 유지해요.','몸과 팔다리는 기준 그대로 옮겨요.','웃는 눈 또는 웃는 입 하나만 바꿔요.','바꾼 표정과 유지한 특징 두 개를 확인해요.'],63:['놀란 눈 또는 둥근 입 중 하나를 골라요.','기준 머리와 귀를 놓아요.','몸과 팔다리의 관계를 유지해요.','고른 눈 또는 입을 바꿔 넣어요.','무엇을 바꿨는지 한 곳을 짚어요.'],64:['반가운 선과 풀이 죽은 선의 방향을 봐요.','기준 머리와 귀를 놓아요.','몸과 팔다리는 그대로 두어요.','처진 눈 또는 아래로 향한 입을 넣어요.','반가운 표정과 다른 방향을 비교해요.'],65:['저장한 D62~D64의 같은 캐릭터 그림을 골라요.','두 특징이 어떻게 남았는지 나란히 봐요.','고칠 그림 하나를 복사해요.','복사본에서 한 부분만 보완해요.','표정 모음과 보완한 복사본을 저장해요.'],66:['머리와 위로 든 팔 방향을 봐요.','기준 머리와 귀를 먼저 놓아요.','머리보다 좁은 몸에 인사하는 팔을 이어요.','기준 눈 간격과 입을 넣어요.','인사 방향과 같은 캐릭터의 특징을 확인해요.'],67:['짧아진 몸과 앞으로 나온 발을 봐요.','기준 머리와 귀를 놓아요.','몸을 짧게 놓고 앉은 팔·발 방향을 이어요.','기준 눈 간격과 입을 넣어요.','서 있는 모습과 다른 발 방향을 비교해요.'],68:['서로 갈라진 앞발과 뒷발 자리를 봐요.','기준 머리와 귀를 놓아요.','몸 아래에서 앞뒤로 짧은 다리를 이어요.','눈 간격과 귀 모양을 다시 봐요.','두 발의 방향과 유지한 특징을 확인해요.'],69:['반갑게 인사 또는 앉아서 쉬기를 골라요.','기준 머리와 귀를 놓아요.','고른 상황의 몸과 팔·발을 이어요.','배운 표정 하나를 더해요.','어떤 상황인지 한 문장으로 적어요.'],70:['D61 기준 그림과 저장한 자세 두 개를 골라요.','유지한 특징 두 개를 나란히 비교해요.','고칠 자세 하나를 복사해요.','복사본에서 달라진 부분 하나를 보완해요.','작은 자세 모음과 복사본을 저장해요.']}
for n in range(61,71):
 examples=[]
 for family,name in [('cat','세모귀 고양이'),('rabbit','긴귀 토끼')]:
  base=mascot(family);pose={66:'wave',67:'sit',68:'walk',69:'wave',70:'wave'}.get(n,'stand');emotion={62:'happy',63:'surprised',64:'sad',65:'happy',69:'happy'}.get(n,'neutral')
  specs=[('eyes','눈만 바꾸기',pose,emotion,'eyes'),('mouth','입만 바꾸기',pose,emotion,'mouth')] if n in [62,63,64] else [('wave','반갑게 인사','wave','happy','mouth'),('rest','앉아서 쉬기','sit','happy','eyes')] if n==69 else [('main','기준 연습',pose,emotion,'mouth')]
  options=[]
  for oid,label,p,e,part in specs:
   lines=mascot(family,p,e,part);keys=[x['id'] for x in lines]
   frames=[[],['head','ears'],[x for x in keys if not x.startswith('eyes') and x!='mouth'],keys,keys]
   options.append(dict(id=oid,label=label,lines=lines,frames=frames))
  examples.append(dict(id=f'd{n}-{family}',name=f'{name} · '+{61:'기준',62:'반가움',63:'놀람',64:'풀이 죽음',65:'표정 모음',66:'인사',67:'앉기',68:'한 발 걷기',69:'감정 있는 자세',70:'자세 모음'}[n],source='연이 자체 제작 캐릭터 구성 도해. 귀·눈 간격·덩어리 관계를 비교하는 연습.',lines=options[0]['lines'],identity=dict(family=family,baseline=base,features=features,options=options)))
 for ex in examples:
  if n==64:ex['identity']['comparison']=mascot(ex['identity']['family'],'stand','happy','mouth')
  if n==67:ex['identity']['easyReference']=[x for x in ex['lines'] if not x['id'].startswith('foot')]
  if n==68:ex['identity']['anchors']=[[129,318],[259,321]]
 lesson=dict(id=f'D{n}',identityPractice='expressions' if n==65 else 'poses' if n==70 else 'draw',examples=examples,steps=[dict(text=t,lines=[],action='look' if i==0 else 'compare' if i==4 else 'draw') for i,t in enumerate(steps[n])],readiness=dict(manuscript=True,examples=True,visualMatch='--reviewed' in sys.argv,browser=False))
 (R/f'content/drawing/reviewed/d{n}.json').write_text(json.dumps(lesson,ensure_ascii=False,indent=2)+'\n')
print('D61-D70: 10 lessons,20 examples,28 target variants. Readiness requires visual review.')
