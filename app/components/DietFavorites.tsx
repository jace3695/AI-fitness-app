'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { DietMealLog, DinnerCarbRecord, LunchProteinRecord } from '../data/dietPlans';
import { confirmFavorite, favoriteDraft, favoriteQuickMeal, favoriteSummary, validFavorite, writeFavorite, type MealFavorite } from '../data/dietFavorites';
import type { QuickMeal } from '../data/freeDietTools';

type Props = { meal: DietMealLog; lunchRice: DinnerCarbRecord; dinnerRice: DinnerCarbRecord; supplement: LunchProteinRecord; onApply: (meal: QuickMeal) => void };
type Review = { row: MealFavorite; operation: 'save' | 'delete' | 'apply'; uncertain?: boolean };
const button = 'min-h-11 rounded-xl bg-violet-50 px-3 py-2 text-xs font-bold text-violet-800 disabled:opacity-50';
export default function DietFavorites({ meal, lunchRice, dinnerRice, supplement, onApply }: Props) {
  const [owner, setOwner] = useState('');
  const [rows, setRows] = useState<MealFavorite[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [name, setName] = useState('');
  const [slot, setSlot] = useState<MealFavorite['slot']>('lunch');
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const working = useRef(false);
  const alive = useRef(false);
  const generation = useRef(0);
  const [more, setMore] = useState(false);

  async function load(user: string) {
    if (!supabase) return;
    const version = ++generation.current;
    setLoading(true); setLoadError('');
    try {
      const { data, error } = await supabase.from('diet_meal_favorites').select('*').eq('user_id', user).order('created_at', { ascending: false }).order('id').limit(101).abortSignal(AbortSignal.timeout(15_000));
      if (!alive.current || version !== generation.current) return;
      if (error || !data || !data.every(validFavorite)) throw Error('load');
      setRows(data.slice(0, 100)); setMore(data.length > 100);
    } catch {
      if (alive.current && version === generation.current) { setRows([]); setLoadError('즐겨찾기를 불러오지 못했어요. 연결을 확인하고 다시 불러와 주세요.'); }
    } finally { if (alive.current && version === generation.current) setLoading(false); }
  }
  useEffect(() => {
    alive.current = true; generation.current++;
    let active = true;
    // AuthGate keys children by user.id, so accounts never share this component state.
    if (!supabase) { setLoading(false); setLoadError('로그인 연결을 확인해 주세요.'); return; }
    void supabase.auth.getUser().then(({ data, error }) => {
      if (!active) return;
      if (error || !data.user) { setLoadError('로그인을 확인한 뒤 다시 열어 주세요.'); setLoading(false); return; }
      setOwner(data.user.id); void load(data.user.id);
    }).catch(() => { if (active) { setLoadError('로그인을 확인한 뒤 다시 열어 주세요.'); setLoading(false); } });
    return () => { active = false; alive.current = false; };
  }, []);

  const startSave = () => {
    if (!owner || working.current) return;
    const row = favoriteDraft(crypto.randomUUID(), owner, name, slot, meal, slot === 'lunch' ? lunchRice : dinnerRice, supplement);
    if (!validFavorite(row)) { setNotice('이름은 1~60자, 단백질은 0~300g, 밥은 0~1,000g으로 입력해 주세요. 밥 종류 이름도 60자까지 저장할 수 있어요.'); return; }
    setNotice(''); setReview({ row, operation: 'save' });
  };
  const run = async (confirmOnly = false) => {
    if (!review || !supabase || working.current) return;
    const current = review;
    if (current.operation === 'apply') {
      onApply(favoriteQuickMeal(current.row, supplement.assessment));
      setReview(null); setNotice('식사 입력칸에 반영했습니다. 아직 오늘 식단에 저장되지 않았습니다.'); return;
    }
    working.current = true; setBusy(true); setNotice('');
    const result = confirmOnly ? await confirmFavorite(supabase, owner, current.row, current.operation) : await writeFavorite(supabase, owner, current.row, current.operation);
    if (!alive.current) return;
    if (result.kind === 'uncertain') {
      setReview({ ...current, uncertain: true }); setNotice('결과를 확인하지 못했어요. 다시 저장하지 않고 서버의 결과만 확인합니다.');
    } else {
      setReview(null);
      if (result.kind === 'confirmed') { setNotice(current.operation === 'save' ? '즐겨찾기에 저장했습니다. 오늘 식단 기록은 바뀌지 않았습니다.' : '즐겨찾기에서 삭제했습니다. 기존 식단 기록은 유지됩니다.'); if (current.operation === 'save') setName(''); }
      else if (result.kind === 'duplicate') setNotice('이 끼니에 같은 이름의 즐겨찾기가 있어요. 다른 이름을 입력해 주세요. 기존 구성은 바뀌지 않았습니다.');
      else setNotice('요청한 결과를 확인할 수 없어요. 목록을 다시 확인한 뒤 진행해 주세요.');
      await load(owner);
    }
    working.current = false; setBusy(false);
  };
  const disabled = busy || loading || !!loadError || !owner || !!review;
  return <section aria-label="식사 즐겨찾기" className="min-w-0 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5">
    <h3 className="text-[15px] font-bold">식사 즐겨찾기</h3>
    <p className="mt-2 text-xs leading-5 text-gray-500">현재 입력한 식품 단백질·밥 종류와 무게·점심 보충 단백질을 이름으로 저장해요. 불러오기는 입력칸만 바꾸며, 하루 기록은 ‘오늘 식단 저장’으로 저장해요.</p>
    <div className="mt-3 grid min-w-0 grid-cols-1 gap-2">
      <label className="text-xs font-bold">저장할 끼니<select aria-label="즐겨찾기 끼니" disabled={disabled} value={slot} onChange={e => setSlot(e.target.value as MealFavorite['slot'])} className="mt-1 min-h-11 w-full min-w-0 rounded-xl border p-2"><option value="lunch">점심</option><option value="dinner">저녁</option></select></label>
      <label className="text-xs font-bold">즐겨찾기 이름<input disabled={disabled} value={name} maxLength={60} onChange={e => setName(e.target.value)} placeholder="예: 회사 점심" className="mt-1 min-h-11 w-full min-w-0 rounded-xl border p-2" /></label>
      <button disabled={disabled} className={button} onClick={startSave}>현재 입력 구성 저장하기</button>
    </div>
    {loading ? <p className="mt-3 text-xs">즐겨찾기를 불러오는 중…</p> : loadError ? <p role="alert" className="mt-3 text-xs text-amber-800">{loadError}</p> : rows.length === 0 ? <p className="mt-3 text-xs text-gray-500">저장한 식사 즐겨찾기가 없습니다.</p> : <ul className="mt-3 space-y-3">{rows.map(row => <li key={row.id} className="min-w-0 rounded-xl bg-gray-50 p-3" aria-label={`${row.slot === 'lunch' ? '점심' : '저녁'} 즐겨찾기 ${row.name}`}>
      <p className="break-words text-sm font-bold">{row.name}</p><p className="mt-1 break-words text-xs leading-5">{favoriteSummary(row)}</p>
      <div className="mt-2 flex flex-wrap gap-2"><button className={button} disabled={disabled} onClick={() => { setNotice(''); setReview({ row, operation: 'apply' }); }}>불러오기</button><button className={button} disabled={disabled} onClick={() => { setNotice(''); setReview({ row, operation: 'delete' }); }}>즐겨찾기 삭제</button></div>
    </li>)}</ul>}
    {more && <p className="mt-2 text-xs">최근 즐겨찾기 100개를 표시하고 있어요. 불필요한 항목을 정리하면 이전 항목을 볼 수 있어요.</p>}
    <button className={`${button} mt-3`} disabled={busy || loading || !!review || !owner} onClick={() => void load(owner)}>즐겨찾기 다시 불러오기</button>
    {review && <div role="region" aria-label="즐겨찾기 내용 확인" className="mt-3 rounded-xl bg-violet-50 p-3 text-xs leading-5">
      <p className="break-words font-bold">{review.row.name} · {review.operation === 'save' ? '즐겨찾기 저장 확인' : review.operation === 'delete' ? '즐겨찾기 삭제 확인' : '입력칸 적용 확인'}</p>
      <p className="mt-2 break-words">{favoriteSummary(review.row)}</p>
      <p className="mt-2">{review.operation === 'apply' ? '이 끼니의 단백질·밥·점심 보충 단백질 입력을 바꿉니다. 물·식사 시각·상태·메모·다른 끼니는 유지합니다.' : '오늘이나 과거의 식단 기록은 바뀌지 않습니다.'}</p>
      <div className="mt-3 flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={() => void run(!!review.uncertain)}>{busy ? '결과 확인 중…' : review.uncertain ? '서버 결과 다시 확인' : review.operation === 'save' ? '확인 후 즐겨찾기 저장' : review.operation === 'delete' ? '확인 후 즐겨찾기 삭제' : '확인 후 입력칸 적용'}</button>{!review.uncertain && <button className={button} disabled={busy} onClick={() => { setReview(null); setNotice(''); }}>취소</button>}</div>
    </div>}
    {notice && <p role="status" className="mt-3 text-xs leading-5 text-violet-800">{notice}</p>}
  </section>;
}
