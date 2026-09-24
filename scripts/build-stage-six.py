"""Original vector examples for independent structure analysis; no private assets.
Use --reviewed only after inspecting the rendered React diagrams.
"""
import json,pathlib,sys,copy,math,re
ROOT=pathlib.Path(__file__).resolve().parents[1]
def line(id,d,x,y,group='shape',fill=None):
 r=dict(id=id,label=id,d=d,start=[x,y],direction=[x,y],group=group)
 if fill:r['fill']=fill
 return r
def oval(id,x,y,rx,ry):
 return line(id,f'M{x-rx} {y} A{rx} {ry} 0 1 0 {x+rx} {y} A{rx} {ry} 0 1 0 {x-rx} {y}',x-rx,y)
def box(id,x,y,w,h,r=12):
 return line(id,f'M{x+r} {y} H{x+w-r} Q{x+w} {y} {x+w} {y+r} V{y+h-r} Q{x+w} {y+h} {x+w-r} {y+h} H{x+r} Q{x} {y+h} {x} {y+h-r} V{y+r} Q{x} {y} {x+r} {y}',x+r,y)
def dot(id,x,y):
 l=oval(id,x,y,4,4);l.update(group='detail',fill='ink');return l
def example(id,name,lines,masses,easy,explanation,hidden=None,choices=None):
 return dict(id=id,name=name,source='연이 자체 제작 도형화 예제. 사유 교재 이미지 사용 없음.',lines=lines,structure=dict(lines=masses,easyLines=easy,hidden=hidden or [],explanation=explanation,choices=choices or []))
def bird(i):
 rx=78+10*i
 outer=line('body',f'M200 80 C{200-rx} 80 150 160 {200-rx} 230 C80 330 320 330 {200+rx} 230 C250 160 {200+rx} 80 200 80',200,80)
 mass=oval('mass',200,205,95,115)
 return example('pear-bird-'+str(i+1),'통통한 배 모양 새' if not i else '넓은 배 모양 새',[outer,dot('eyeL',181,156),dot('eyeR',219,156),line('beak','M194 173 L206 173 L200 185 Z',194,173,'detail')],[mass],['mass'],'머리와 몸을 하나의 세로 타원으로 잡을 수 있어요. 아래가 더 넓다는 차이는 나중에 고쳐요.',choices=[dict(id='oval',label='세로 타원',lines=[mass]),dict(id='round-box',label='둥근 네모',lines=[box('candidate',110,88,180,220,65)])])
def hamster(i):
 rx=92+i*12
 # Ears sit behind the head; visible arcs attach to its boundary.
 earL=line('earL',f'M{200-rx*.8} 169 C{200-rx-30} 103 142 81 166 136',200-rx*.8,169)
 earR=line('earR',f'M234 136 C258 81 {200+rx+30} 103 {200+rx*.8} 169',234,136)
 head=oval('head',200,215,rx,85)
 masses=[head,oval('earL',132,133,35,38),oval('earR',268,133,35,38)]
 return example('hamster-'+str(i+1),'둥근 햄스터 얼굴' if not i else '넓은 햄스터 얼굴',[earL,earR,head,dot('eyeL',169,210),dot('eyeR',231,210),dot('nose',200,237)],masses,['earL'],'큰 얼굴 하나와 작은 귀 둘이에요. 귀는 얼굴의 위 양쪽에 붙어요.')
def bear(i):
 # Shared IDs let D46 restore the matching D45 analysis without changing its source.
 rx=59+7*i
 head=oval('head',200,126,rx,56);body=oval('body',200,247,58,70)
 arms=[oval('armL',129,224,19,38),oval('armR',271,224,19,38)]
 legs=[oval('legL',168,321,22,28),oval('legR',232,321,22,28)]
 a=200-rx*.8;b=200-rx*.45; ya=126-56*math.sqrt(1-.8**2);yb=126-56*math.sqrt(1-.45**2)
 ears=[line('earL',f'M{a} {ya} C{a-35} 50 {b-18} 37 {b} {yb}',a,ya),line('earR',f'M{400-b} {yb} C{418-b} 37 {435-a} 50 {400-a} {ya}',400-b,yb)]
 masses=[head,body,*arms,*legs]
 return example('structure-bear-'+str(i+1),'긴 몸 곰 인형' if not i else '넓은 머리 곰 인형',[*ears,head,body,*arms,*legs],masses,['head','body'],'얼굴 세부 없이 머리·몸과 팔·다리의 붙는 위치를 봐요. 머리보다 몸이 조금 길어요.')
def ballbear(i):
 e=bear(i);r=62+i*5
 # Ball covers the lower body contour. Keep upper body visible and mask its hidden arc in finished paths.
 e['lines']=[l for l in e['lines'] if l['id'] not in ['body','armL','armR']]
 # Solve the exact body/ball boundary intersection; retain only the upper body arc.
 a=1-58**2/70**2;b=-530+2*247*58**2/70**2;c=265**2+58**2-247**2*58**2/70**2-r*r
 y=(-b-math.sqrt(b*b-4*a*c))/(2*a);x=math.sqrt(r*r-(y-265)**2)
 e['lines']=[l for l in e['lines'] if l['id'] not in ['legL','legR']]
 e['lines'].insert(2,line('body',f'M{200-x} {y} A58 70 0 0 1 {200+x} {y}',200-x,y))
 e['lines'] += [line('legL',f'M164 {265+math.sqrt(r*r-36*36)} C138 365 193 370 185 {265+math.sqrt(r*r-15*15)}',164,265+math.sqrt(r*r-36*36)),line('legR',f'M215 {265+math.sqrt(r*r-15*15)} C207 370 262 365 236 {265+math.sqrt(r*r-36*36)}',215,265+math.sqrt(r*r-15*15))]
 ball=oval('ball',200,265,r,r)
 e['lines'] += [ball,oval('handL',200-r,245,13,17),oval('handR',200+r,245,13,17)]
 e['structure']=dict(lines=[oval('body',200,247,58,70),ball],easyLines=['body','ball'],hidden=[line('covered',f'M{200+x} {y} A58 70 0 1 1 {200-x} {y}',200+x,y)],choices=[],explanation='공이 몸의 아래쪽 외곽을 가려요. 밑그림에는 몸 전체가 있지만 완성선에는 공 뒤의 몸 선을 빼요. 작은 손은 공보다 앞이에요.')
 e.update(id='ball-bear-'+str(i+1),name='작은 공을 든 곰' if not i else '큰 공을 든 곰');return e
def rabbit(i):
 shift=10*i
 head=oval('head',200,255,83,76)
 front=line('front',f'M168 185 C145 80 161 40 185 55 C211 80 205 144 207 179',168,185)
 back=line('back',f'M206 109 C{228+shift} 52 {255+shift} 81 {244+shift} 133 L229 184',206,109)
 hidden=line('hidden','M229 184 Q202 190 190 168 L206 109',229,184)
 return example('turned-rabbit-'+str(i+1),'귀가 겹친 토끼' if not i else '뒤 귀가 벌어진 토끼',[back,front,head,dot('eyeL',195,250),dot('eyeR',236,250),dot('nose',219,272)],[head,front,back],['front','back'],'화면 왼쪽 긴 귀가 앞이에요. 뒤 귀의 아래 왼쪽 선은 앞 귀와 머리에 가려지고, 윗부분은 남아요.',[hidden])
def face(i,eyes=False):
 head=oval('head',200,210,96,108)
 center=238 if not i else 162
 guide=line('center',f'M200 102 Q{center+(center-200)} 210 200 318',200,102,'guide')
 nose=dot('nose',center,222)
 eyelines=[dot('near-eye',206 if not i else 194,196),dot('far-eye',264 if not i else 136,196)]
 lines=[head,*eyelines,nose,line('mouth',f'M{center-8} 247 Q{center} 255 {center+8} 247',center-8,247,'detail')]
 masses=[head,guide,nose]+(eyelines if eyes else [])
 return example(('eyes-' if eyes else 'direction-')+str(i+1),'오른쪽을 보는 둥근 얼굴' if not i else '왼쪽을 보는 둥근 얼굴',lines,masses,['near-eye','far-eye'] if eyes else ['head','center'],'안내선이 휘어 나간 쪽을 얼굴이 바라봐요. 코는 안내선 가까이, 두 눈은 안내선 양옆에 두되 반대쪽 눈과 외곽 사이 공간이 좁아요.',choices=[] if eyes else [dict(id='front',label='정면 안내선',lines=[head,line('front-center','M200 102 L200 318',200,102,'guide')]),dict(id='turn',label='돌아간 안내선',lines=[head,guide])])
def robot(i):
 w=120+i*24
 masses=[box('head',200-w/2,70,w,90,18),box('body',156,178,88,100,8),box('armL',123,189,25,70,8),box('armR',252,189,25,70,8),box('legL',164,286,27,52,6),box('legR',209,286,27,52,6)]
 return example('robot-'+str(i+1),'둥근 네모 로봇' if not i else '넓은 머리 로봇',[*masses,dot('eyeL',178,112),dot('eyeR',222,112)],[*masses,dot('eyeL',178,112),dot('eyeR',222,112)],['head','body'],'둥근 네모 머리가 몸보다 넓어요. 머리·몸을 먼저 놓고 빈 간격에 짧은 팔다리를 붙여요.')
def animal(i):
 if i==0:
  body=oval('body',205,261,85,63);head=oval('head',174,151,66,63);earL=line('earL','M117 119 L115 53 L155 91',117,119);earR=line('earR','M189 90 L237 60 L232 122',189,90)
  lines=[earL,earR,head,body,dot('eyeL',155,150),dot('eyeR',190,150),line('tail','M284 272 Q347 212 320 174',284,272)]
  masses=[head,body,earL,earR];name='세모 귀 고양이';feature='세모 귀'
 else:
  head=oval('head',200,160,70,63);body=oval('body',200,273,59,62);earL=oval('earL',125,177,23,57);earR=oval('earR',275,177,23,57)
  lines=[earL,earR,head,body,dot('eyeL',175,159),dot('eyeR',225,159),dot('nose',200,183)];masses=[head,body,earL,earR];name='늘어진 귀 강아지';feature='늘어진 귀'
 return example('new-animal-'+str(i+1),name,lines,masses,['head','body'],f'머리·몸·귀를 2~4개 덩어리로 나눠 다시 놓아요. 대표 특징은 {feature} 하나만 더해도 돼요.',choices=[dict(id='oval',label='타원 머리',lines=[head,body]),dict(id='box',label='둥근 네모 머리',lines=[box('candidate',130,98,140,124,38),body])])
makers={43:bird,44:hamster,45:bear,46:bear,47:ballbear,48:rabbit,49:face,50:lambda i:face(i,True),51:robot,52:animal}
for n,make in makers.items():
 ex=[make(i) for i in range(2)]
 mode='assemble' if n in [46,52] else 'occlusion' if n in [47,48] else 'direction' if n in [49,50] else 'analyze'
 if n==46:
  for e in ex:e['structure']['easyLines']=['head']
 instructions={43:['원본에서 가장 큰 덩어리를 둘러봐요.','가까운 도형을 마음속으로 골라요.','원본 위에 그 도형을 직접 그려요.','원본과 도형의 다른 곳 한 군데를 봐요.','내가 고른 도형이 어느 부분인지 설명해요.'],44:['얼굴과 귀를 먼저 관찰해요.','큰 얼굴 덩어리를 그려요.','작은 귀 둘을 따로 표시해요.','내 분석선을 숨겼다가 다시 켜 관계를 봐요.','큰 얼굴과 작은 귀가 붙는 곳을 비교해요.'],45:['세부 없는 곰의 큰 부분을 찾아요.','머리와 몸 덩어리를 놓아요.','팔이 붙는 자리와 짧은 팔다리를 표시해요.','눈과 코를 그리지 않고 위치만 봐요.','머리·몸·팔다리를 구별했는지 확인해요.'],46:['D45 분석을 고르거나 원본 위에 직접 나눠요.','큰 머리·몸 덩어리를 확인해요.','빈 공간에 다시 조립을 눌러 머리부터 놓아요.','몸과 짧은 팔다리를 이어 놓아요.','내 분석과 조립 그림의 큰 위치를 비교해요.'],47:['공이 몸의 어느 부분을 가렸는지 봐요.','몸의 큰 덩어리를 표시해요.','몸 앞에 공 덩어리를 놓아요.','가려진 선까지 밑그림과 완성을 번갈아 봐요.','공 뒤에서 생략한 몸 선을 짚어봐요.'],48:['두 귀가 겹치는 부분을 봐요.','큰 머리 덩어리를 놓아요.','앞 귀와 뒤 귀의 보이는 부분을 나눠요.','전체 밑그림과 완성을 번갈아 비교해요.','뒤 귀가 가려진 곳을 짚어봐요.'],49:['얼굴이 향한 쪽을 관찰해요.','둥근 얼굴 덩어리를 놓아요.','방향을 따라 가운데 안내선을 휘어 그려요.','안내선 가까이에 코를 놓아요.','안내선과 코가 알려주는 방향을 확인해요.'],50:['얼굴과 가운데 안내선을 떠올려요.','둥근 얼굴과 휜 안내선을 놓아요.','가까운 눈의 위치부터 표시해요.','반대쪽 눈과 외곽 사이 공간을 봐요.','두 눈과 안내선이 같은 방향인지 비교해요.'],51:['새 로봇의 큰 네모들을 봐요.','넓은 머리와 작은 몸을 놓아요.','짧은 팔·다리를 붙여요.','두 눈만 더해요.','머리와 몸의 크기 관계 하나를 비교해요.'],52:['새 동물을 골라 큰 부분을 찾아요.','원본 위에 2~4개 덩어리를 나눠요.','빈 공간에 다시 조립을 눌러 옮겨요.','귀처럼 대표 특징 하나만 더해요.','붙는 위치와 겹친 앞쪽을 설명해요.']}[n]
 for e in ex:
  keys=[l['id'] for l in e['structure']['lines']]
  frames={43:[[],keys,keys,keys,keys],44:[[],keys[:1],keys,keys,keys],45:[[],keys[:2],keys,keys,keys],46:[[],keys[:2],keys[:1],keys,keys],47:[[],keys[:1],keys,keys,keys],48:[[],keys[:1],keys,keys,keys],49:[[],keys[:1],keys[:2],keys,keys],50:[[],keys[:2],keys[:4],keys,keys],51:[[],keys[:2],keys[:6],keys,keys],52:[[],keys,keys[:2],keys,keys]}[n]
  e['structure']['frames']=frames
 def stable(v):
  if isinstance(v,float):return round(v,3)
  if isinstance(v,list):return [stable(x) for x in v]
  if isinstance(v,dict):return {k:re.sub(r'-?\d+(?:\.\d+)?',lambda m:format(round(float(m[0]),3),'g'),x) if k=='d' else stable(x) for k,x in v.items()}
  return v
 ex=stable(ex)
 lesson=dict(id=f'D{n}',examples=ex,structurePractice=mode,steps=[dict(text=t,lines=[],action='look' if j==0 else 'compare' if j==4 else 'draw') for j,t in enumerate(instructions)],readiness=dict(manuscript=True,examples=True,visualMatch='--reviewed' in sys.argv,browser=False))
 (ROOT/f'content/drawing/reviewed/d{n}.json').write_text(json.dumps(lesson,ensure_ascii=False,indent=2)+'\n')
print('10 structure lessons, 20 examples generated; visual readiness:', '--reviewed' in sys.argv)
