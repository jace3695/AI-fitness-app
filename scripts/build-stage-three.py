"""Author deterministic teaching diagrams from the existing reviewed vector library.
No private template images or independently generated intermediate frames enter this pack.
Visual review is a separate release gate; --reviewed records that completed review.
"""
import copy, json, pathlib, sys
ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / 'content/drawing/reviewed'
def read(name):
    return json.loads((ROOT / 'content/drawing' / name).read_text())
def path(i, label, d, start, direction=None, group='guide', fill=None):
    line = dict(id=i, label=label, d=d, start=start, direction=direction or start, group=group)
    if fill: line['fill'] = fill
    return line
def dot(i, x, y):
    return path(i, '위치 도움', f'M{x-3} {y} a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0', [x,y], fill='ink')
def step(text, ids=(), action='draw', hide=()):
    s = dict(text=text, lines=list(ids), action=action)
    if hide: s['hideLines']=list(hide)
    return s
def variants(source, lesson, names=None):
    result=[]
    for i, ex in enumerate(read(source)['examples']):
        ex=copy.deepcopy(ex)
        ex.update(id=f'{lesson}-copy-{i+1}-v1', name=names[i] if names else ex['name'], lines=[l for l in ex['lines'] if l['group'] not in ['guide','gesture']])
        ex.pop('parts',None)
        ex['source'] += ' 기존 검수 도해의 좌표를 유지하여 모작용 원본·시범·도움 표시를 구성함.'
        result.append(ex)
    return result
def publish(n, examples, steps, *, base=(), anchors=(), easy=(), easy_anchors=(), large=(), scale=1, demo_base=(), help=0):
    obj=dict(id=f'D{n:02}', examples=examples, steps=steps, help=help,
        practice=dict(mode='copy', baseLines=list(base), anchors=list(anchors), easyLines=list(easy), easyAnchors=list(easy_anchors), largeLines=list(large), scale=scale, demoBaseLines=list(demo_base)),
        readiness=dict(manuscript=True, examples=True, visualMatch='--reviewed' in sys.argv, browser=False))
    (OUT/f'd{n:02}.json').write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n')
chicks={n:variants('d01-reviewed.json',f'D{n}') for n in range(17,21)}
for examples in chicks.values():
    for i,ex in enumerate(examples):
        top=65 if i==0 else 74
        ex['lines'] += [dot('top',200,top),dot('bottom',200,317),dot('left',76 if i==0 else 74,220 if i==0 else 228),dot('right',324 if i==0 else 326,220 if i==0 else 228),path('eyeLevel','눈 높이 도움', 'M132 152 L268 152',[132,152],[154,152])]
publish(17,chicks[17],[
    step('옆 원본에서 눈의 높이를 봐요. 빈 몸은 준비되어 있어요. 눈이 몸의 위쪽에 있다는 관계부터 찾아요.',(), 'look'),
    step('빈 몸의 위쪽에 왼쪽 눈을 찍고, 비슷한 높이에 오른쪽 눈을 찍어요. 두 눈 사이를 비워요.',['eyeL','eyeR']),
    step('눈 사이보다 조금 아래에 작은 세모 부리를 넣어요. 왼쪽 위 → 오른쪽 → 아래 → 처음 자리예요.',['beak']),
    step('원본과 눈 높이만 비교해요. 날개와 다리는 이번 과제에서 옮기지 않아도 돼요.',(), 'compare')
],base=['bodyL','bodyR'],easy=['eyeLevel'],large=['bodyL','bodyR'],help=1)
publish(18,chicks[18],[
    step('옆 병아리 몸의 꼭대기·바닥·양옆 끝을 봐요. 연습장의 네 점이 몸 크기를 알려줘요.', ['top','bottom','left','right'],'look'),
    step('위 점에서 왼쪽 점을 지나 아래 점까지 둥글게 이어요. 긴 선은 나눠 그려도 돼요.',['bodyL']),
    step('다시 위 점에서 오른쪽 점을 지나 아래 점에서 만나요. 작은 얼굴보다 몸을 먼저 잡아요.',['bodyR']),
    step('몸 위쪽에 눈 두 점, 눈 사이보다 아래에 작은 세모 부리를 옮겨요.',['eyeL','eyeR','beak']),
    step('원본의 몸과 나란히 봐요. 높이와 폭 중 한 곳만 비교해요. 날개와 다리는 생략해도 돼요.',(), 'compare')
],anchors=['top','bottom','left','right'],easy=['bodyL'],large=['bodyL','bodyR'],help=1)
publish(19,chicks[19],[
    step('위·아래 두 점만 남았어요. 원본의 높이에 비해 몸이 얼마나 넓은지 먼저 봐요.',['top','bottom'],'look'),
    step('양옆 끝을 직접 가볍게 찍어봐요. 시범의 두 점은 한 가지 예시예요.',['left','right']),
    step('위에서 왼쪽 끝을 지나 아래로, 다시 위에서 오른쪽 끝을 지나 아래로 둥글게 이어요.',['bodyL','bodyR']),
    step('큰 몸을 만든 뒤 위쪽에 눈 두 점과 작은 부리를 넣어요.',['eyeL','eyeR','beak']),
    step('내가 정한 양옆 위치를 원본과 비교해요. 너무 어렵다면 네 점 도움을 다시 켜도 돼요.',(), 'compare')
],anchors=['top','bottom'],easy_anchors=['left','right'],large=['bodyL','bodyR'],help=1)
publish(20,chicks[20],[
    step('연습장이 비어 있어요. 옆 원본을 보고 몸을 놓을 꼭대기와 바닥을 정해요.',(), 'look'),
    step('정한 꼭대기와 바닥을 가볍게 찍어요. 다음에는 양옆 공간을 살펴봐요.',['top','bottom']),
    step('큰 달걀 몸부터 그려요. 꼭대기 → 왼쪽 → 바닥, 다시 꼭대기 → 오른쪽 → 바닥이에요.',['bodyL','bodyR']),
    step('몸 위쪽에 눈 두 점을 놓고 그 사이 아래에 세모 부리를 넣어요.',['eyeL','eyeR','beak']),
    step('몸 양옆에 짧게 굽은 날개, 아래에 짧은 다리를 더해요. 선을 한 번씩 끊어 그려도 돼요.',['wingL','wingR','legL','legR']),
    step('몸이 원본보다 넓거나 좁아진 곳이 있는지 한 곳만 찾아봐요. 매끈한 선은 오늘 목표가 아니에요.',(), 'compare')
],easy_anchors=['top','bottom','left','right'],large=['bodyL','bodyR'])
bear=variants('reviewed/d03.json','D21')
publish(21,bear,[
    step('귀보다 큰 얼굴부터 살펴요. 귀 한 개가 얼굴 전체보다 훨씬 작다는 점을 봐요.',(), 'look'),
    step('얼굴 꼭대기에서 왼쪽으로 돌아 턱까지, 다시 꼭대기에서 오른쪽으로 돌아 턱에서 만나요.',['faceL','faceR']),
    step('왼쪽 귀가 붙을 얼굴 위쪽을 정해요. 왼쪽 위로 작게 둥글려 얼굴에 붙여요.',['earL']),
    step('오른쪽도 위쪽에 작은 귀를 붙여요. 얼굴보다 귀가 작게 보이도록 먼저 자리를 정해요.',['earR']),
    step('얼굴 가운데쯤에 눈 두 점, 그 사이 아래에 작은 코를 넣어요.',['eyeL','eyeR','nose']),
    step('원본과 귀 크기만 비교해요. 더 쉽게에서는 얼굴이 준비되니 귀만 그려도 돼요.',(), 'compare')
],easy=['faceL','faceR'],large=['faceL','faceR'])
rabbit=variants('reviewed/d04.json','D22')
for i,ex in enumerate(rabbit):
    ear=next(l for l in ex['lines'] if l['id']=='earL')
    ex['lines'] += [dot('earBase',*ear['start']),dot('earTip',133 if i==0 else 135,57 if i==0 else 96)]
publish(22,rabbit,[
    step('옆 원본에서 얼굴 높이와 귀 길이를 번갈아 봐요. 얼굴을 먼저 놓아요.',(), 'look'),
    step('얼굴 위에서 왼쪽으로 돌아 턱까지, 다시 오른쪽으로 돌아 큰 얼굴을 닫아요.',['faceL','faceR']),
    step('왼쪽 귀의 밑과 끝을 정한 뒤 위로 길게 올라가요. 둥글게 돌아 얼굴 위쪽으로 내려와요.',['earL']),
    step('오른쪽 귀도 밑과 끝을 먼저 정해요. 위로 올라갔다가 둥글게 돌아 내려와요.',['earR']),
    step('얼굴 안에 눈과 작은 입을 넣어요. 귀를 그릴 공간과 얼굴 자리를 따로 살펴요.',['eyeL','eyeR','mouth']),
    step('원본과 귀 길이만 비교해요. 정확히 재지 않아도 얼굴과 귀의 길이 관계를 살펴보면 돼요.',(), 'compare')
],easy_anchors=['earBase','earTip'],large=['faceL','faceR'])
snow=variants('reviewed/d12.json','D23')
for ex in snow:
    ex['lines'] = [l for l in ex['lines'] if l['id'] not in ['armL','armR']]
    for l in ex['lines']:
        if l['id']=='head': l['direction']=[l['start'][0]-20,l['start'][1]]
        if l['id']=='body': l['direction']=[l['start'][0]-20,l['start'][1]+10]
    ex['lines'] += [path('mouth','짧은 입','M192 156 Q200 166 208 156',[192,156],[200,161],'detail'),dot('bodyCenter',200,266)]
publish(23,snow,[
    step('작은 머리 아래에 큰 몸이 들어갈 공간을 남겨요. 머리만 종이 가운데에 크게 놓지 않아요.',(), 'look'),
    step('위쪽에 작은 머리를 둥글게 그려요. 시범은 위에서 왼쪽으로 돌아온 한 가지 순서예요.',['head']),
    step('머리 아래에 더 큰 몸을 붙여요. 만나는 부분의 선은 겹쳐 그려도 괜찮아요.',['body']),
    step('머리 안에 눈 두 점과 짧은 입을 넣어요. 몸에 세부를 더하지 않아도 돼요.',['eyeL','eyeR','mouth']),
    step('머리와 몸이 만나는 위치만 원본과 비교해요. 더 쉽게를 켜면 몸의 중심점이 보여요.',(), 'compare')
],easy_anchors=['bodyCenter'],large=['head','body'])
penguin=variants('reviewed/d06.json','D24')
publish(24,penguin,[
    step('배 모양 옆에 남은 빈 공간을 봐요. 배를 바깥 몸에 꽉 붙이지 않는 것이 오늘 목표예요.',(), 'look'),
    step('먼저 큰 몸 바깥을 위에서 왼쪽으로, 다시 위에서 오른쪽으로 그려 닫아요.',['bodyL','bodyR']),
    step('안쪽 배의 위·아래 자리를 정해요. 바깥선과 사이를 남기며 둥근 배를 그려요.',['belly']),
    step('배 위쪽에 눈 두 점과 부리를 넣어요. 얼굴보다 양옆 빈 공간을 먼저 살펴요.',['eyeL','eyeR','beak']),
    step('배와 몸 사이 왼쪽·오른쪽 공간을 원본과 비교해요. 완벽한 대칭은 필요 없어요.',(), 'compare')
],easy=['belly'],large=['bodyL','bodyR'])
cat=variants('reviewed/d07.json','D25')
for ex in cat:
    ear=next(l for l in ex['lines'] if l['id']=='earL')
    ex['lines'] += [dot('earStart',*ear['start']),dot('earEnd',153,128)]
publish(25,cat,[
    step('귀 모양보다 귀 밑이 얼굴 어디에 붙었는지 먼저 봐요. 얼굴의 위쪽 양옆이에요.',(), 'look'),
    step('큰 얼굴을 먼저 그려요. 위에서 왼쪽으로 돌아 턱, 다시 오른쪽으로 돌아 턱에서 만나요.',['faceL','faceR']),
    step('양쪽 귀 밑의 시작과 끝을 정해요. 각 시작점에서 꼭짓점으로 올라갔다가 끝점으로 내려와요.',['earL','earR']),
    step('얼굴 안에 눈 두 점과 짧은 입을 넣어요. 수염은 생략해도 돼요.',['eyeL','eyeR','mouth']),
    step('귀가 붙은 위치 한 곳을 원본과 비교해요. 더 쉽게에서는 왼쪽 귀 밑 두 점을 보여줘요.',(), 'compare')
],easy_anchors=['earStart','earEnd'],large=['faceL','faceR'])
small=variants('reviewed/d03.json','D26')
for ex in small: ex['lines'] += [path('frame','작은 자리 틀','M65 80 L335 80 L335 335 L65 335 Z',[65,80],[90,80])]
publish(26,small,[
    step('원본보다 작은 곰을 그려요. 얼굴과 귀가 함께 들어갈 작은 자리를 먼저 정해요.',(), 'look'),
    step('작게 정한 자리 안에 큰 얼굴부터 넣어요. 얼굴 높이와 폭을 함께 줄여요.',['faceL','faceR']),
    step('얼굴이 작아진 만큼 양쪽 귀도 함께 작게 붙여요. 귀만 원래 크기로 남기지 않아요.',['earL','earR']),
    step('눈 간격과 코 크기도 얼굴에 맞게 작게 넣어요.',['eyeL','eyeR','nose']),
    step('얼굴·귀·눈이 함께 작아졌는지 비교해요. 더 쉽게를 켜면 작게 줄인 원본도 옆에 보여요.',(), 'compare')
],easy=['frame'],large=['faceL','faceR'],scale=.65)
correction=variants('reviewed/d03.json','D27')
for ex in correction:
    ex['lines'] += [path('lowEye','낮아진 오른쪽 눈','M237 250 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0',[242,250],fill='ink')]
publish(27,correction,[
    step('내 이전 그림을 불러오거나 곰 얼굴을 한 번 그려요. 시범은 오른쪽 눈이 낮은 예예요. 수정 전 그림을 먼저 봐요.',(), 'look'),
    step('전체 폭·귀 위치·눈 높이 중 한 곳만 골라요. 시범에서는 낮은 오른쪽 눈을 골랐어요. 내 그림은 내가 선택해요.',['lowEye'],'compare'),
    step('고른 부분의 새 위치를 연하게 정하고 한 번만 고쳐요. 시범은 오른쪽 눈을 지우고 왼쪽 눈 높이에 맞춰 찍어요.',['eyeR'],'draw',['lowEye']),
    step('수정 전과 후를 나란히 비교해요. 어디를 왜 골랐는지 한 문장으로 남겨요. 나머지는 그대로 두어도 돼요.',(), 'compare')
],large=['faceL','faceR'],demo_base=['faceL','faceR','earL','earR','eyeL','nose','lowEye'])
hamsters=[]
for i,rx in enumerate([115,125]):
    ex=dict(id=f'D28-hamster-{i+1}-v1',name=['둥근 볼 햄스터','넓은 볼 햄스터'][i],source='D28의 새 쉬운 캐릭터 목표에 맞춘 자체 제작 좌표 도해. 점 눈·작은 귀·짧은 입과 큰 얼굴만 사용함.',lines=[
        path('faceL','얼굴 왼쪽',f'M200 140 C{200-rx*.6} 140 {200-rx} 172 {200-rx} 225 C{200-rx} 285 145 320 200 320',[200,140],[178,140],'shape'),
        path('faceR','얼굴 오른쪽',f'M200 140 C{200+rx*.6} 140 {200+rx} 172 {200+rx} 225 C{200+rx} 285 255 320 200 320',[200,140],[222,140],'shape'),
        path('earL','왼쪽 작은 귀','M111 171 C86 130 115 101 145 145',[111,171],[101,154],'shape'),
        path('earR','오른쪽 작은 귀','M255 145 C285 101 314 130 289 171',[255,145],[269,128],'shape'),
        path('eyeL','왼쪽 눈','M157 219 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0',[162,219],group='detail',fill='ink'),
        path('eyeR','오른쪽 눈','M233 219 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0',[238,219],group='detail',fill='ink'),
        path('mouth','짧은 입','M190 246 Q200 258 210 246',[190,246],[198,252],'detail'),
        dot('top',200,140),dot('bottom',200,320),dot('left',200-rx,225),dot('right',200+rx,225)])
    def face_point(t):
        u=1-t
        return [round(200*u**3+3*(200-rx*.6)*u*u*t+3*(200-rx)*u*t*t+(200-rx)*t**3,3),round(140*u**3+3*140*u*u*t+3*172*u*t*t+225*t**3,3)]
    a,b=face_point(.5),face_point(.24)
    for l in ex['lines']:
        if l['id']=='earL':
            l.update(d=f'M{a[0]} {a[1]} C{a[0]-24} {a[1]-45} {b[0]-30} {b[1]-47} {b[0]} {b[1]}',start=a,direction=[a[0]-12,a[1]-22])
        if l['id']=='earR':
            l.update(d=f'M{400-b[0]} {b[1]} C{400-b[0]+30} {b[1]-47} {400-a[0]+24} {a[1]-45} {400-a[0]} {a[1]}',start=[400-b[0],b[1]],direction=[400-b[0]+15,b[1]-22])
    hamsters.append(ex)
publish(28,hamsters,[
    step('처음 보는 햄스터예요. 가장 큰 얼굴의 높이와 폭부터 보고, 작은 귀는 나중에 놓아요.',(), 'look'),
    step('얼굴 꼭대기에서 왼쪽으로 둥글게 내려가 턱에서 멈춰요.',['faceL']),
    step('다시 꼭대기에서 오른쪽으로 내려가 턱에서 만나요.',['faceR']),
    step('얼굴 위쪽 양옆에 작은 둥근 귀를 붙여요. 얼굴보다 훨씬 작게 자리를 정해요.',['earL','earR']),
    step('얼굴 안에 눈 두 점을 놓고 그 사이 아래에 짧은 입을 넣어요.',['eyeL','eyeR','mouth']),
    step('큰 모양부터 그렸는지 돌아봐요. 원본과 크기 또는 위치 차이를 한 곳만 찾아요.',(), 'compare')
],easy_anchors=['top','bottom','left','right'],large=['faceL','faceR'])
print('D17–D28 authored; inspect every panel before passing --reviewed.')
