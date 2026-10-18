// Source inventory of the supported OA long report. No personal measurements.
export const OA_REPORT_INVENTORY = [
  ['weight', '체중', 'kg'], ['bodyScore', '점수', '포인트'],
  ['bodyFatPercent', '체지방률', '%'], ['musclePercent', '근육률', '%'],
  ['bmi', 'BMI', ''], ['boneMass', '골량', 'kg'], ['proteinPercent', '단백질 비율', '%'],
  ['basalMetabolicRate', '기초대사', 'kcal'], ['visceralFatLevel', '내장 지방 지수', ''],
  ['reportedBodyAge', '신체연령', '연령 단위'], ['fatFreeMass', '무지방 체중', 'kg'],
  ['subcutaneousFatPercent', '피하지방률', '%'], ['bodyWaterPercent', '수분', '%'],
  ['subcutaneousFatMass', '피하지방량', 'kg'], ['muscleMass', '근육량', 'kg'],
  ['fatMass', '지방량', 'kg'], ['standardWeight', '표준 체중', 'kg'],
  ['leftArmFatMass', '왼손 지방량', 'kg'], ['rightArmFatMass', '오른손 지방량', 'kg'],
  ['trunkFatMass', '체지방량', 'kg'], ['leftLegFatMass', '왼쪽 다리 지방량', 'kg'],
  ['rightLegFatMass', '오른쪽 다리 지방량', 'kg'], ['leftArmMuscleMass', '왼손 근육량', 'kg'],
  ['rightArmMuscleMass', '오른손 근육량', 'kg'], ['trunkMuscleMass', '신체 근육량', 'kg'],
  ['leftLegMuscleMass', '왼쪽 다리 근육량', 'kg'], ['rightLegMuscleMass', '오른쪽 다리 근육량', 'kg'],
  ['bodyShape', '체형', ''], ['measurementDate', '측정 날짜', ''], ['measurementTime', '측정 시간', ''],
] as const;
export type OaInventoryKey = typeof OA_REPORT_INVENTORY[number][0];
