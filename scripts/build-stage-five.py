"""Author baseline/one-change pairs. No private template assets are copied.
--reviewed is used only after all rendered sheets have been visually checked.
"""
import copy,json,pathlib,sys,math,re
ROOT=pathlib.Path(__file__).resolve().parents[1]
def line(id,d,start,direction=None,group='shape',fill=None):
    r=dict(id=id,label=id,d=d,start=start,direction=direction or start,group=group)
    if fill:r['fill']=fill
    return r
def dot(id,x,y):return line(id,f'M{x-4} {y} a4 4 0 1 0 8 0 a4 4 0 1 0 -8 0',[x,y],group='detail',fill='ink')
def ellipse(id,x,y,rx,ry):return line(id,f'M{x} {y-ry} C{x-rx*1.33} {y-ry} {x-rx*1.33} {y+ry} {x} {y+ry} C{x+rx*1.33} {y+ry} {x+rx*1.33} {y-ry} {x} {y-ry}',[x,y-ry],[x-20,y-ry])
def bean(i):
    e=copy.deepcopy(json.loads((ROOT/'content/drawing/reviewed/d08.json').read_text())['examples'][i])
    e['lines']=[l for l in e['lines'] if l['group'] not in ['guide','gesture']]
    e['lines']=[line('mouth','M188 218 L212 218',[188,218],[202,218],'detail') if l['id']=='mouth' else l for l in e['lines']]
    return e

def rabbit(i):
    e=copy.deepcopy(json.loads((ROOT/'content/drawing/reviewed/d04.json').read_text())['examples'][i]);e.pop('parts',None)
    e['lines']=[l for l in e['lines'] if l['group'] not in ['guide','gesture']]
    return e

def bear(i):
    # All head and ear boundaries meet; the body starts beneath the chin.
    rx=64 if i==0 else 72
    lines=[ellipse('body',200,277,57,65),
      line('armL','M149 244 C112 246 109 279 129 286 C143 290 157 265 149 244',[149,244],[130,248]),
      line('armR','M251 244 C288 246 291 279 271 286 C257 290 243 265 251 244',[251,244],[270,248]),
      line('legL','M166 325 C143 350 163 365 183 347',[166,325],[154,340]),
      line('legR','M234 325 C257 350 237 365 217 347',[234,325],[246,340]),
      line('earL',f'M{200-rx*.9} {155-62*math.sqrt(1-.9**2)} C{200-rx-40} 92 {200-rx-2} 58 {200-rx*.5} {155-62*math.sqrt(1-.5**2)}',[200-rx*.9,155-62*math.sqrt(1-.9**2)],[200-rx-13,106]),
      line('earR',f'M{200+rx*.9} {155-62*math.sqrt(1-.9**2)} C{200+rx+40} 92 {200+rx+2} 58 {200+rx*.5} {155-62*math.sqrt(1-.5**2)}',[200+rx*.9,155-62*math.sqrt(1-.9**2)],[200+rx+13,106]),
      ellipse('head',200,155,rx,62),dot('eyeL',177,150),dot('eyeR',223,150),
      line('mouth','M188 177 Q200 185 212 177',[188,177],[199,181],'detail')]
    return dict(id='bear',name='둥근 곰 인형' if i==0 else '넓은 얼굴 곰 인형',source='D21의 둥근 얼굴·작은 귀 관계에서 확장한 연이 자체 제작 곰 인형 시범.',lines=lines)

def option(id,label,changed,kept,lines,instruction,anchors=(),easy='kept'):
    return dict(id=id,label=label,changed=changed,kept=kept,remove=[l['id'] for l in lines],lines=lines,instruction=instruction,anchors=list(anchors),easy=easy)
def get(e,id):return next(l for l in e['lines'] if l['id']==id)
def mouth(e):
    b=get(e,'mouth');x,y=b['start'];end=float(re.findall(r'-?\d+(?:\.\d+)?',b['d'])[-2])
    return option('mouth','입 모양','입의 휘는 모양','얼굴 외곽과 두 눈', [line('mouth',f'M{x} {y} Q{(x+end)/2} {y+22} {end} {y}',[x,y],[x+8,y+12],'detail')], '입의 양 끝 높이는 두고 가운데를 아래로 내려 웃는 입을 그려요. 얼굴과 눈은 그대로예요.')
def eyes(e):
    ls=[];pts=[]
    for id in ['eyeL','eyeR']:
        x,y=get(e,id)['start'];pts.append([x,y]);ls.append(line(id,f'M{x-9} {y} Q{x} {y+10} {x+9} {y}',[x-9,y],[x,y+5],'detail'))
    return option('eyes','눈 모양','점 눈을 감은 곡선 눈으로','얼굴과 눈의 중심 높이',ls,'원래 눈 중심의 높이를 짚고 그 자리에 짧은 곡선 두 개를 넣어요. 두 눈의 간격은 유지해요.',pts,'anchors')
def ear(e,fold=False):
    b=get(e,'earL'); x,y=b['start']; end=[float(v) for v in b['d'].split()[-2:]]
    # Existing rabbit contour ends at the same baseline on the head.
    ex,ey=end
    if fold:
        d=f'M{x} {y} C{x-7} {y-29} {x-9} {y-55} {x+3} {y-68} Q{x+18} {y-74} {x+37} {y-52} Q{x+49} {y-36} {x+33} {y-31} L{x+16} {y-48} Q{x+12} {y-23} {ex} {ey}'
        label='귀 접기'; changed='왼쪽 귀 하나의 접힌 모양';ins='왼쪽 귀 밑에서 중간까지 올려요. 끝부분을 오른쪽 아래로 접고 안쪽 선을 귀 밑까지 이어요. 얼굴과 오른쪽 귀는 그대로예요.'
    else:
        top=max(20,min(float(v) for v in b['d'].replace('M',' ').replace('C',' ').replace('Q',' ').split())-24)
        d=f'M{x} {y} C{x-28} {top+14} {x-10} {top-5} {x+8} {top} C{x+32} {top+4} {ex+5} {y-35} {ex} {ey}'
        label='귀 길이';changed='왼쪽 귀 하나의 길이';ins='왼쪽 귀의 붙는 두 자리는 그대로 두어요. 귀 끝을 위로 올려 길게 이어요. 반대 귀는 바꾸지 않아요.'
    return option('fold' if fold else 'ears',label,changed,'얼굴·오른쪽 귀·왼쪽 귀가 붙는 자리',[line('earL',d,[x,y],[x-4,y-22])],ins,[[x,y],[ex,ey]],'trace' if fold else 'kept')
def body(e,width=False):
    ids=['outer','inner'] if any(l['id']=='outer' for l in e['lines']) else ['body']
    # Transform coordinates with SVG path parser: these paths contain absolute cubic commands only.
    import re
    ls=[]
    for id in ids:
        b=copy.deepcopy(get(e,id)); tokens=re.findall(r'[A-Za-z]|-?\d+(?:\.\d+)?',b['d']);axis=0;out=[]
        for t in tokens:
            if t.isalpha():out.append(t);continue
            v=float(t);v=200+(v-200)*1.15 if width and axis%2==0 else 200+(v-200)*.72 if not width and axis%2 else v
            out.append(f'{v:g}');axis+=1
        b['d']=' '.join(out)
        for k in ['start','direction']:
            x,y=b[k];b[k]=[200+(x-200)*1.15,y] if width else [x,200+(y-200)*.72]
        ls.append(b)
    return option('width' if width else 'height','몸 폭' if width else '몸 높이','몸의 폭만 넓히기' if width else '몸의 위아래 높이만 줄이기','몸 높이와 얼굴' if width else '몸의 좌우 폭과 눈·입',ls,'좌우 끝만 조금 바깥으로 옮겨요. 위아래 높이와 얼굴은 그대로 두어요.' if width else '양옆 폭은 두고 꼭대기와 바닥을 가운데 쪽으로 당겨요. 눈과 입의 자리는 유지해요.',easy='trace')
def head(e):
    import re
    ls=[]
    for id in ['head','earL','earR','eyeL','eyeR','mouth']:
        b=copy.deepcopy(get(e,id)); tokens=re.findall(r'[A-Za-z]|-?\d+(?:\.\d+)?',b['d'])
        if id.startswith('eye'):
            x,y=b['start'];b=dot(id,200+(x-200)*1.18,155+(y-155)*1.18)
        else:
            out=[];axis=0
            for t in tokens:
                if t.isalpha():out.append(t);continue
                v=float(t);c=200 if axis%2==0 else 155;out.append(f'{c+(v-c)*1.18:g}');axis+=1
            b['d']=' '.join(out)
            for k in ['start','direction']:x,y=b[k];b[k]=[200+(x-200)*1.18,155+(y-155)*1.18]
        ls.append(b)
    return option('head','머리 크기','귀·눈·입을 포함한 머리 크기','몸·팔·다리 위치',ls,'몸은 그대로 두고 머리 전체를 조금 키워요. 귀·눈·입도 머리와 함께 조금 벌려 놓아요.',easy='trace')
def arm(e):
    return option('arm','팔 방향','오른쪽 팔 끝의 방향','팔이 붙는 점과 머리·몸·반대 팔',[line('armR','M251 244 C250 218 269 189 283 201 C303 216 274 245 251 244',[251,244],[255,225])],'몸 오른쪽의 같은 점에서 위로 올려요. 위쪽 팔 끝을 둥글려 다시 붙는 점으로 돌아와요. 반대 팔은 그대로예요.',[[251,244]],'kept')
configs=[(35,bean,mouth),(36,bean,eyes),(37,rabbit,ear),(38,bean,body),(39,bear,head),(40,bear,arm),(41,rabbit,lambda e:ear(e,True))]
for n,fn,change in configs+[(42,None,None)]:
    examples=[]
    for i in range(3 if n==42 else 2):
        e=fn(i) if fn else (bean(0) if i==0 else rabbit(0) if i==1 else bear(0))
        e['id']=f'D{n}-variation-{i+1}-v1';e['source']+=' 원본과 한 요소만 바꾼 비교 시범을 별도로 구성.'
        e['variations']=[change(e)] if change else ([mouth(e),eyes(e),body(e,True)] if i==0 else [mouth(e),eyes(e),ear(e)] if i==1 else [mouth(e),eyes(e),arm(e)])
        examples.append(e)
    steps=[dict(text=t,lines=[],action=a) for t,a in [
        ('기본 그림과 바꾼 예제를 나란히 봐요. 오늘 바꿀 한 가지와 그대로 둘 특징을 확인해요.','look'),
        ('그대로 둘 부분의 자리를 먼저 잡아요. 바꿀 부분은 빈자리로 남겨요. 큰 외곽을 바꾼다면 얼굴 위치는 참고만 해요.','draw'),
        ('바꿀 부분이 시작하는 주황 점을 짚어요. 아래의 한 가지 변형 설명을 따라 방향을 정해요.','look'),
        ('빈자리에 바꿀 부분을 넣어요. 보라색 시범은 이번에 바꾸는 선이에요. 나머지는 그대로 두어요.','draw'),
        ('기본 그림과 내 그림을 비교해요. 바꾼 것 하나와 유지한 것 하나를 직접 확인하고 저장해요.','compare')]]
    obj=dict(id=f'D{n}',examples=examples,steps=steps,help=0,variationPractice=True,readiness=dict(manuscript=True,examples=True,visualMatch='--reviewed' in sys.argv,browser=False))
    (ROOT/f'content/drawing/reviewed/d{n}.json').write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n')
print('8 lessons, 17 baseline examples, 23 one-change choices. Visual review:', '--reviewed' in sys.argv)
