"""Index the supplied ZIP without putting private images in the public repository.
Usage: python scripts/index-drawing-templates.py /path/to/templates.zip
"""
import sys,zipfile,json,hashlib,pathlib
root=pathlib.Path(__file__).resolve().parents[1]
# Individual selections verified against the actual supplied pictures, not filenames alone.
uses={
 '이목구비/눈/이목구비_눈01.png':(['D01','D17','D20'],'작은 점 눈 두 개의 모양을 봐요. 위치는 현재 캐릭터의 원본을 따라요.'),
 '이목구비/눈/이목구비_눈06.png':(['D36','D62'],'눈 점을 짧은 곡선으로 바꿀 때 참고해요. 얼굴과 눈 높이는 유지해요.'),
 '동물가이드/동물가이드_곰.png':(['D03','D10','D13','D21','D26','D30','D39','D45','D61','D71','D72','D73','D74'],'초반에는 큰 얼굴과 작은 귀만 봐요. 몸과 팔다리, 얼굴의 십자 도움선까지 한 번에 따라 그릴 필요는 없어요.'),
 '동물가이드/동물가이드_토끼.png':(['D04','D11','D22','D31','D37','D41','D48','D73'],'귀 밑이 얼굴 위쪽 어디에 붙는지 봐요. 접힌 귀나 돌아간 얼굴의 완성 시범은 별도로 필요해요.'),
 '동물가이드/동물가이드_고양이.png':(['D07','D25','D52','D71','D73'],'큰 얼굴에 붙는 세모 귀를 먼저 봐요. 초반에는 수염·몸·꼬리를 생략해도 돼요.'),
 '동물가이드/동물가이드_강아지.png':(['D16','D43','D52','D71','D72'],'새 동물을 큰 얼굴·몸·귀로 나눠 보는 참고 자료예요. 원래 수업의 지정 캐릭터를 자동으로 바꾸지는 않아요.'),
 '표정/표정01.png':(['D35','D61','D62','D63','D64','D65'],'기본 표정이에요. 다른 표정과 비교할 때 얼굴 모양과 눈 위치를 기준으로 삼아요.'),
 '표정/표정02.png':(['D35','D62','D65','D77','D78'],'기본 점 눈을 유지하고 입만 웃는 모양으로 바뀐 것을 봐요.'),
 '표정/표정18.png':(['D63','D65','D77','D78'],'놀란 표정이에요. 처음에는 얼굴·눈을 그대로 두고 둥근 입 하나만 참고해요.'),
 '표정/표정12.png':(['D64','D65','D78'],'풀이 죽은 표정이에요. 처음에는 눈썹·눈·입을 모두 바꾸지 말고 입 하나만 살펴봐요.'),
 '포즈가이드/상반신/상반신04.png':(['D40','D55','D66'],'위로 든 팔의 방향 참고예요. 현재 캐릭터의 팔 시작점은 그대로 두고 팔 끝만 위로 바꿔요.'),
 '포즈가이드/상반신/상반신07.png':(['D57'],'양팔이 위로 향하는 참고예요. 손가락이나 주먹 세부는 그리지 않아도 돼요.'),
 '포즈가이드/전신/전신07.png':(['D68','D70'],'서로 다른 방향의 두 다리를 봐요. 옆모습 걷기 시범과는 시점이 달라 보조 참고로만 사용해요.'),
 '포즈가이드/전신/전신10.png':(['D67','D69','D70'],'앉은 몸과 접힌 다리를 관찰하는 참고예요. 옆에서 앉은 자세의 단계 시범을 대신하지 않아요.'),
}
with zipfile.ZipFile(sys.argv[1]) as z:
 assets=[]
 for p in z.namelist():
  if not p.endswith('.png'):continue
  b=z.read(p);lessonIds,note=uses.get(p,([], '지금 배운 목표에 필요한 부분만 골라 참고해요. 전체를 한 번에 완성할 필요는 없어요.'))
  assets.append(dict(id='tpl-'+hashlib.sha256(p.encode()).hexdigest()[:12],path=p,label=pathlib.PurePosixPath(p).stem,group=p.split('/')[0],sha256=hashlib.sha256(b).hexdigest(),size=len(b),lessonIds=lessonIds,note=note))
assert len(assets)==150
(root/'content/drawing/template-catalog.json').write_text(json.dumps(dict(id='universal-150-v1',assets=assets),ensure_ascii=False,indent=2)+'\n')
print(f'{len(assets)} originals indexed; {len(uses)} individually selected; images remain outside repository')
