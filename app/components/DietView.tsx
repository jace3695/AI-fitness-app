import { DIET } from '../data/workouts';

export default function DietView() {
  return (
    <div>
      <p className="text-[16px] font-medium text-gray-800 mb-3">식단 가이드</p>
      <div className="bg-[#EAF3DE] text-[#27500A] border-l-[3px] border-[#639922] rounded-xl px-3.5 py-2.5 text-[13px] mb-4">
        ✅ 가정식 기반 · 단백질 반찬 포함 · 양 조절이 핵심.
      </div>
      <div className="flex flex-col gap-2">
        {DIET.meals.map((meal, i) => (
          <div
            key={i}
            className="bg-white border border-gray-100 rounded-xl px-4 py-3"
          >
            <span
              className="inline-block text-[10px] font-medium px-2 py-0.5 rounded-full mb-2"
              style={{ background: meal.bg, color: meal.color }}
            >
              {meal.label}
            </span>
            <div className="text-[13px] text-gray-500">
              {meal.items.map((item, j) => (
                <div key={j} className="flex gap-2 mt-1">
                  <span>{item.icon}</span>
                  <span dangerouslySetInnerHTML={{
                    __html: item.text.replace(/닭가슴살 150~200g|밥 반~2\/3공기/g,
                      (m) => `<strong class="text-gray-800">${m}</strong>`)
                  }} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
