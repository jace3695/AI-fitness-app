"""Compile the authoritative manuscript and only reviewed authored diagrams.
Run after editorial changes. No downloaded/private template assets enter the pack.
Readiness is deliberately per-lesson; manuscripts are never counted as playable.
"""
import re,json,pathlib
ROOT=pathlib.Path(__file__).resolve().parents[1]
source=(ROOT/'docs/drawing/curriculum-source.md').read_text()
counts=[8,8,12,6,8,10,8,10,10]
stages=[dict(id=int(n),title=title,criterion=criterion) for n,title,criterion in re.findall(r'^\| ([1-9])\. (.*?) \| D.*?\|.*?\|.*?\| (.*?) \|$',source,re.M)]
refs={27:list(range(20,27)),33:[29,30,31,32],34:[29,30,31,32],42:[35,36,37,38,39,40,41],46:[45],50:[49],59:[55,57],65:[62,63,64],66:[61],67:[61],68:[58,59,61],69:[66,67],70:[61,66,67,68,69],73:[72],74:[71,72,73],75:[74],76:[74],77:[74],78:[74,77],79:[74],80:[74,77,78,79]}
lessons=[]
for m in re.finditer(r'\*\*(D\d{2})\. (.*?)\*\*\n(.*?)(?=\n\*\*D|\n### |\n## )',source,re.S):
 lid,title,body=m.groups();n=int(lid[1:]);f=dict(re.findall(r'^- ([^:]+): (.*)$',body,re.M));stage=next(i+1 for i in range(9) if n<=sum(counts[:i+1]))
 lessons.append(dict(id=lid,stage=stage,title=title,goal=f['핵심'],instructions=f['순서'].split(' → '),check=f['확인'],easier=f['더 쉽게'],help=3 if stage<=2 else 1 if stage==3 else 0,minutes=15,examples=[],steps=[],references=[f'D{x:02}' for x in refs.get(n,[])],readiness=dict(manuscript=True,examples=False,visualMatch=False,browser=False)))
reviewed=json.loads((ROOT/'content/drawing/d01-reviewed.json').read_text())
lessons[0].update(reviewed)
lessons[0]['readiness'].update(examples=True,visualMatch=True)
projects=[dict(id=m[1],title=m[2],sessions=list(m.group(3,4,5,6)),check=m[7]) for m in re.finditer(r'^\| (C0[1-4])\. (.*?) \| (.*?) \| (.*?) \| (.*?) \| (.*?) \| (.*?) \|$',source,re.M)]
assert len(lessons)==80 and len(stages)==9 and len(projects)==4
pack=dict(schemaVersion=1,id='yeoni-character-practice',version='1.0.0-draft.2',title='캐릭터와 함께 시작하는 그림 연습',stages=stages,lessons=lessons,projects=projects)
(ROOT/'content/drawing/foundations-v1.json').write_text(json.dumps(pack,ensure_ascii=False,indent=2)+'\n')
print('80 manuscripts, 4 project manuscripts. D01: 2 visually checked examples / 6 steps. Authenticated browser verification pending.')
