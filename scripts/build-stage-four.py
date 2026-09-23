"""Memory practice: the recall frames deliberately contain no answer outline.
Author from previously reviewed geometry; visual approval is a separate gate.
"""
import copy,json,pathlib,sys
ROOT=pathlib.Path(__file__).resolve().parents[1]
def examples(source,n):
    data=json.loads((ROOT/'content/drawing'/source).read_text())['examples']
    out=copy.deepcopy(data)
    for i,e in enumerate(out):
        e['id']=f'D{n}-memory-{i+1}-v1'
        e['lines']=[l for l in e['lines'] if l['group'] not in ['guide','gesture']]
        e.pop('parts',None)
        e['source']+=' 기존 검수 도해를 기억·비교 연습에 재사용. 기억 단계에는 도해를 숨김.'
    return out
def feat(id,label,lines):return dict(id=id,label=label,lines=lines)
def step(text,phase,action='look'):return dict(text=text,lines=[],action=action,memoryPhase=phase)
chick=[feat('body','달걀 모양 몸',['bodyL','bodyR']),feat('eyes','점 눈 두 개',['eyeL','eyeR']),feat('legs','아래쪽 짧은 다리',['legL','legR'])]
bear=[feat('face','큰 둥근 얼굴',['faceL','faceR']),feat('ears','위쪽 작은 귀',['earL','earR']),feat('eyes','얼굴 안 점 눈',['eyeL','eyeR'])]
rabbit=[feat('ears','위로 긴 귀',['earL','earR']),feat('face','아래쪽 둥근 얼굴',['faceL','faceR']),feat('eyes','얼굴 안 점 눈',['eyeL','eyeR'])]
bean=[feat('body','콩처럼 휜 몸',['bodyL','bodyR']),feat('eyes','점 눈 두 개',['eyeL','eyeR']),feat('mouth','짧은 입',['mouth'])]
common=[step('원본에서 큰 모양과 작은 특징을 살펴요. 기억할 특징 두 개를 눌러 골라요.','observe'),step('원본을 가렸어요. 기억나는 특징을 말하거나 아래에 적어요. 정확한 말이 아니어도 괜찮아요.','recall'),step('빈 연습장에 큰 모양부터 그리고 고른 특징을 넣어요. 막히면 다시 확인해도 돼요.','recall','draw'),step('원본을 다시 열었어요. 내가 기억한 부분과 다시 본 부분을 구별해 한 곳만 비교해요.','compare','compare'),step('고치고 싶은 한 곳만 보완해요. 다르게 그린 부분을 모두 지우지 않아도 돼요.','compare','draw')]
configs=[
(29,'d01-reviewed.json',chick,'words',[],common),
(30,'reviewed/d03.json',bear,'outline',['faceL','faceR'],[
step('큰 얼굴 위쪽 양옆에 작은 귀가 붙어 있어요. 얼굴과 귀의 관계를 먼저 보고 특징 두 개를 골라요.','observe'),
step('원본을 가렸어요. 큰 얼굴과 위쪽 귀를 떠올려 말하거나 적어요.','recall'),
step('큰 얼굴을 그린 뒤 위쪽 양옆에 작은 귀를 붙여요. 눈은 마지막에 넣어요.','recall','draw'),
step('원본을 열어 귀가 붙은 위치 한 곳만 비교해요. 귀 모양이 조금 달라도 괜찮아요.','compare','compare'),
step('필요하면 귀가 붙는 자리 한 곳만 보완해요. 이미 기억한 부분은 그대로 두어요.','compare','draw')]),
(31,'reviewed/d04.json',rabbit,'choices',[],[
step('귀 길이·얼굴 모양·눈 중 기억할 두 가지를 골라요. 긴 귀가 얼굴 위 어디에 붙는지도 봐요.','observe'),
step('원본을 가렸어요. 내가 고른 두 가지를 떠올려 말하거나 적어요.','recall'),
step('고른 특징을 중심으로 토끼를 그려요. 귀 길이와 얼굴 모양을 골랐다면 귀와 얼굴만 그려도 돼요.','recall','draw'),
step('원본을 열고 내가 고른 두 특징만 비교해요. 고르지 않은 세부는 확인하지 않아도 돼요.','compare','compare'),
step('고른 특징 중 한 곳만 보완해요. 오늘 기억하려던 부분을 연습했는지 돌아봐요.','compare','draw')]),
(32,'reviewed/d08.json',bean,'copy',[],[
step('콩 캐릭터의 휜 몸과 점 눈·짧은 입을 봐요. 기억할 특징 두 개를 골라요.','observe'),
step('원본을 가렸어요. 떠오르는 특징부터 말하거나 적어요.','recall'),
step('기억나는 데까지 그려요. 막힌 부분을 정한 뒤 ‘잠깐 원본 확인’을 눌러 보고 다시 가려 이어 그려요.','recall','draw'),
step('원본을 다시 열고 무엇을 다시 봤는지 적어요. 다시 확인한 것은 실패가 아니에요.','compare','compare'),
step('다시 본 부분 하나만 보완해요. 어렵다면 원본을 옆에 두고 모작으로 마쳐도 돼요.','compare','draw')]),
(33,'reviewed/d03.json',bear,'preview',[],[
step('이전에 저장한 D29~D32 그림을 이름으로 골라요. 아직 없다면 표시된 곰으로 맛볼 수 있어요. 원본은 아직 열지 않아요.','recall'),
step('지난번 기억한 큰 모양과 특징 두 개를 떠올려 골라요. 말하거나 적어도 돼요.','recall'),
step('원본 없이 큰 모양과 특징 두 개를 그려요. 막히면 잠깐 확인해도 괜찮아요.','recall','draw'),
step('원본을 열고 기억한 부분과 다시 본 부분을 구별해 적어요. 지난 그림 원본은 바꾸지 않아요.','compare','compare'),
step('다시 확인한 부분 중 한 곳만 보완해요. 다음 연습에서 기억할 특징을 하나 정해요.','compare','draw')]),
(34,'d01-reviewed.json',chick,'masses',['bodyL','bodyR'],[
step('익숙한 캐릭터를 골라 주요 특징 두 개를 말하거나 선택해요. 이전 D29~D32 그림을 골라도 돼요.','observe'),
step('원본을 가렸어요. 큰 모양과 고른 특징을 떠올려 말하거나 적어요.','recall'),
step('큰 모양부터 그린 뒤 고른 특징을 넣어요. 어려우면 ‘더 쉽게’로 큰 덩어리만 참고해요.','recall','draw'),
step('원본을 열어 내가 기억한 특징과 다시 볼 부분을 구별해요. 보완할 한 곳을 골라 적어요.','compare','compare'),
step('한 곳만 보완하고 오늘 시도를 저장해요. 반복 횟수가 아니라 내가 확인한 내용을 남겨요.','compare','draw')])]
for n,src,features,hint,hints,steps in configs:
    ex=examples(src,n)
    # Bean source uses face halves rather than body halves.
    if n==32:
        ids={l['id'] for l in ex[0]['lines']}
        if 'bodyL' not in ids:
            features[0]['lines']=['faceL','faceR'] if 'faceL' in ids else [l['id'] for l in ex[0]['lines'] if l['group']=='shape']
    obj=dict(id=f'D{n}',examples=ex,steps=steps,help=0,memoryPractice=dict(features=features,hint=hint,hintLines=hints),readiness=dict(manuscript=True,examples=True,visualMatch='--reviewed' in sys.argv,browser=False))
    (ROOT/f'content/drawing/reviewed/d{n}.json').write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n')
print('6 memory lessons, 12 examples, 60 phase panels. Visual review required.')
