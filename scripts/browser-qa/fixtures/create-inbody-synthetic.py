# Optional deterministic fixture authoring; Pillow + system DejaVuSans. Not run in CI.
# All numbers are invented; no person or official sample measurement is copied.
from PIL import Image,ImageDraw,ImageFont
from pathlib import Path
p=Path(__file__).parent
font='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
im=Image.new('RGB',(1800,2550),'white');d=ImageDraw.Draw(im)
def t(x,y,text,size=27):d.text((x,y),text,font=ImageFont.truetype(font,size),fill='black')
t(50,50,'SYNTHETIC REPORT - NOT A PERSON',36);t(620,115,'InBody 270S',40)
t(60,165,'Measurement date: 2025-04-07',24)
t(60,230,'Body Composition Analysis',34)
t(60,305,'For storing excess energy');t(485,305,'Body Fat Mass');t(735,305,'(kg)');t(830,305,'17.4');t(940,305,'(10.0 ~ 20.0)')
t(60,365,'Sum of the above');t(485,365,'Weight');t(735,365,'(kg)');t(830,365,'79.6');t(940,365,'(60.0 ~ 90.0)')
t(60,470,'Muscle-Fat Analysis',34)
t(65,550,'SMM',30);t(65,590,'Skeletal Muscle Mass',18);t(270,550,'(kg)');t(420,520,'70 80 90 100 110 120 130',20);t(600,550,'32.8',30)
t(60,710,'Obesity Analysis',34);t(65,800,'BMI');t(65,840,'Body Mass Index',18);t(275,800,'(kg/m2)');t(420,770,'10.0 15.0 18.5 21.5 25.0 30.0',18);t(600,800,'25.7',30)
t(65,930,'PBF');t(65,970,'Percent Body Fat',18);t(275,930,'(%)');t(420,900,'8.0 13.0 18.0 23.0 28.0 33.0',18);t(600,930,'21.9',30)
t(1150,1140,'Research Parameters',30)
t(1150,1210,'Fat Free Mass 62.2 kg (50.0 ~ 75.0)',22)
t(1150,1265,'Basal Metabolic Rate 1623 kcal (1400 ~ 1800)',22)
t(60,1640,'Body Composition History',34);t(60,1710,'Weight (kg) 95.5',27)
t(60,1770,'Skeletal Muscle Mass (kg) 40.1',27)
t(60,1900,'Weight Control',34);t(60,1970,'Target Weight 60.0 kg',27)
im.save(p/'inbody-270s-synthetic.png')
Image.new('RGB',(64,16),'white').save(p/'inbody-wrong-ratio.png')
