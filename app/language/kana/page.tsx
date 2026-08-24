"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { markTodayRoutineCompleted } from "@/utils/dailyRoutineProgress";
import { authenticatedJsonHeaders } from "@/app/lib/authenticatedHeaders";

function getStrokeSvgPaths(char: string, tab: "hiragana" | "katakana") {
  return Array.from(char).map((part) => {
    const folder = part === "ー" ? "katakana" : tab;
    const assetChar = part === "っ" ? "つ" : part === "ッ" ? "ツ" : part;
    return `/kana-stroke/${folder}/${encodeURIComponent(assetChar)}.svg`;
  });
}

let strokeSvgBundlePromise: Promise<Record<string, string>> | undefined;
function loadStrokeSvg(src: string) {
  strokeSvgBundlePromise ??= fetch("/kana-strokes.json").then((response) => {
    if (!response.ok) throw new Error("획순 묶음을 불러오지 못했습니다.");
    return response.json() as Promise<Record<string, string>>;
  });
  return strokeSvgBundlePromise.then((bundle) => bundle[src] ?? "");
}

function StrokeGlyph({ src, label }: { src: string; label: string }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    let cancelled = false;
    let replayTimer: ReturnType<typeof setTimeout> | undefined;
    const animations: Animation[] = [];
    const loadAndPlay = async () => {
      const markup = await loadStrokeSvg(src);
      if (!markup || cancelled) return;
      const documentSvg = new DOMParser().parseFromString(markup, "image/svg+xml").documentElement;
      const target = svgRef.current;
      if (!target || cancelled) return;
      target.replaceChildren(...Array.from(documentSvg.childNodes).map((node) => document.importNode(node, true)));
      target.setAttribute("viewBox", documentSvg.getAttribute("viewBox") ?? "0 0 1024 1024");
      const strokeItems = Array.from(target.querySelectorAll<SVGElement>('g[data-strokesvg="strokes"] > *'));
      const strokes = strokeItems.map((item) =>
        item.matches("path, line, polyline, polygon, circle, ellipse, rect")
          ? [item as SVGGeometryElement]
          : Array.from(item.querySelectorAll<SVGGeometryElement>("path, line, polyline, polygon, circle, ellipse, rect")),
      );
      const play = () => {
        if (cancelled) return;
        animations.splice(0).forEach((animation) => animation.cancel());
        const strokeLengths = strokes.map((parts) => parts.map((part) => Math.max(part.getTotalLength(), 1)));

        // 브라우저가 첫 프레임을 그리기 전에 모든 획을 숨겨, 완성된 글자나 중간 획이 먼저 보이지 않게 한다.
        strokes.forEach((parts, strokeIndex) => {
          parts.forEach((part, partIndex) => {
            const length = strokeLengths[strokeIndex][partIndex];
            part.style.strokeDasharray = `${length}`;
            part.style.strokeDashoffset = `${length}`;
          });
        });

        strokes.forEach((parts, strokeIndex) => {
          parts.forEach((part, partIndex) => {
            const length = strokeLengths[strokeIndex][partIndex];
            animations.push(part.animate(
              [{ strokeDashoffset: `${length}` }, { strokeDashoffset: "0" }],
              { duration: 700, delay: 350 + strokeIndex * 900, fill: "forwards", easing: "ease-out" },
            ));
          });
        });
        replayTimer = setTimeout(play, Math.max(3600, 1300 + strokes.length * 900));
      };
      play();
    };
    void loadAndPlay();
    return () => {
      cancelled = true;
      if (replayTimer) clearTimeout(replayTimer);
      animations.forEach((animation) => animation.cancel());
    };
  }, [src]);

  return <svg ref={svgRef} role="img" aria-label={`${label} 획순 애니메이션`} style={{ width: "100%", height: "100%", maxHeight: 300, display: "block", margin: "0 auto", "--shadow": "#d1d5db", "--stroke": "#111827" } as React.CSSProperties} />;
}

function KanaStrokeAnimation({ char, tab }: { char: string; tab: "hiragana" | "katakana" }) {
  const paths = getStrokeSvgPaths(char, tab);
  return <div style={{ width: "100%", height: "100%", display: "grid", gridTemplateColumns: `repeat(${paths.length}, minmax(0, 1fr))`, alignItems: "center", gap: 4 }}>{paths.map((path, index) => <StrokeGlyph key={path} src={path} label={Array.from(char)[index]} />)}</div>;
}

const hiragana = [
  { char: "あ", roman: "a" }, { char: "い", roman: "i" }, { char: "う", roman: "u" }, { char: "え", roman: "e" }, { char: "お", roman: "o" },
  { char: "か", roman: "ka" }, { char: "き", roman: "ki" }, { char: "く", roman: "ku" }, { char: "け", roman: "ke" }, { char: "こ", roman: "ko" },
  { char: "さ", roman: "sa" }, { char: "し", roman: "shi" }, { char: "す", roman: "su" }, { char: "せ", roman: "se" }, { char: "そ", roman: "so" },
  { char: "た", roman: "ta" }, { char: "ち", roman: "chi" }, { char: "つ", roman: "tsu" }, { char: "て", roman: "te" }, { char: "と", roman: "to" },
  { char: "な", roman: "na" }, { char: "に", roman: "ni" }, { char: "ぬ", roman: "nu" }, { char: "ね", roman: "ne" }, { char: "の", roman: "no" },
  { char: "は", roman: "ha" }, { char: "ひ", roman: "hi" }, { char: "ふ", roman: "fu" }, { char: "へ", roman: "he" }, { char: "ほ", roman: "ho" },
  { char: "ま", roman: "ma" }, { char: "み", roman: "mi" }, { char: "む", roman: "mu" }, { char: "め", roman: "me" }, { char: "も", roman: "mo" },
  { char: "や", roman: "ya" }, { char: "ゆ", roman: "yu" }, { char: "よ", roman: "yo" },
  { char: "ら", roman: "ra" }, { char: "り", roman: "ri" }, { char: "る", roman: "ru" }, { char: "れ", roman: "re" }, { char: "ろ", roman: "ro" },
  { char: "わ", roman: "wa" }, { char: "を", roman: "wo" },
  { char: "ん", roman: "n" },
  { char: "が", roman: "ga" }, { char: "ぎ", roman: "gi" }, { char: "ぐ", roman: "gu" }, { char: "げ", roman: "ge" }, { char: "ご", roman: "go" },
  { char: "ざ", roman: "za" }, { char: "じ", roman: "ji" }, { char: "ず", roman: "zu" }, { char: "ぜ", roman: "ze" }, { char: "ぞ", roman: "zo" },
  { char: "だ", roman: "da" }, { char: "ぢ", roman: "ji" }, { char: "づ", roman: "zu" }, { char: "で", roman: "de" }, { char: "ど", roman: "do" },
  { char: "ば", roman: "ba" }, { char: "び", roman: "bi" }, { char: "ぶ", roman: "bu" }, { char: "べ", roman: "be" }, { char: "ぼ", roman: "bo" },
  { char: "ぱ", roman: "pa" }, { char: "ぴ", roman: "pi" }, { char: "ぷ", roman: "pu" }, { char: "ぺ", roman: "pe" }, { char: "ぽ", roman: "po" },
];

const katakana = [
  { char: "ア", roman: "a" }, { char: "イ", roman: "i" }, { char: "ウ", roman: "u" }, { char: "エ", roman: "e" }, { char: "オ", roman: "o" },
  { char: "カ", roman: "ka" }, { char: "キ", roman: "ki" }, { char: "ク", roman: "ku" }, { char: "ケ", roman: "ke" }, { char: "コ", roman: "ko" },
  { char: "サ", roman: "sa" }, { char: "シ", roman: "shi" }, { char: "ス", roman: "su" }, { char: "セ", roman: "se" }, { char: "ソ", roman: "so" },
  { char: "タ", roman: "ta" }, { char: "チ", roman: "chi" }, { char: "ツ", roman: "tsu" }, { char: "テ", roman: "te" }, { char: "ト", roman: "to" },
  { char: "ナ", roman: "na" }, { char: "ニ", roman: "ni" }, { char: "ヌ", roman: "nu" }, { char: "ネ", roman: "ne" }, { char: "ノ", roman: "no" },
  { char: "ハ", roman: "ha" }, { char: "ヒ", roman: "hi" }, { char: "フ", roman: "fu" }, { char: "ヘ", roman: "he" }, { char: "ホ", roman: "ho" },
  { char: "マ", roman: "ma" }, { char: "ミ", roman: "mi" }, { char: "ム", roman: "mu" }, { char: "メ", roman: "me" }, { char: "モ", roman: "mo" },
  { char: "ヤ", roman: "ya" }, { char: "ユ", roman: "yu" }, { char: "ヨ", roman: "yo" },
  { char: "ラ", roman: "ra" }, { char: "リ", roman: "ri" }, { char: "ル", roman: "ru" }, { char: "レ", roman: "re" }, { char: "ロ", roman: "ro" },
  { char: "ワ", roman: "wa" }, { char: "ヲ", roman: "wo" },
  { char: "ン", roman: "n" },
  { char: "ガ", roman: "ga" }, { char: "ギ", roman: "gi" }, { char: "グ", roman: "gu" }, { char: "ゲ", roman: "ge" }, { char: "ゴ", roman: "go" },
  { char: "ザ", roman: "za" }, { char: "ジ", roman: "ji" }, { char: "ズ", roman: "zu" }, { char: "ゼ", roman: "ze" }, { char: "ゾ", roman: "zo" },
  { char: "ダ", roman: "da" }, { char: "ヂ", roman: "ji" }, { char: "ヅ", roman: "zu" }, { char: "デ", roman: "de" }, { char: "ド", roman: "do" },
  { char: "バ", roman: "ba" }, { char: "ビ", roman: "bi" }, { char: "ブ", roman: "bu" }, { char: "ベ", roman: "be" }, { char: "ボ", roman: "bo" },
  { char: "パ", roman: "pa" }, { char: "ピ", roman: "pi" }, { char: "プ", roman: "pu" }, { char: "ペ", roman: "pe" }, { char: "ポ", roman: "po" },
];


const hiraganaGifMap: Record<string, string> = {
  あ: "/kana-gif/hiragana/a.gif",
  い: "/kana-gif/hiragana/i.gif",
  う: "/kana-gif/hiragana/u.gif",
  え: "/kana-gif/hiragana/e.gif",
  お: "/kana-gif/hiragana/o.gif",
  か: "/kana-gif/hiragana/ka.gif",
  き: "/kana-gif/hiragana/ki.gif",
  く: "/kana-gif/hiragana/ku.gif",
  け: "/kana-gif/hiragana/ke.gif",
  こ: "/kana-gif/hiragana/ko.gif",
  さ: "/kana-gif/hiragana/sa.gif",
  し: "/kana-gif/hiragana/shi.gif",
  す: "/kana-gif/hiragana/su.gif",
  せ: "/kana-gif/hiragana/se.gif",
  そ: "/kana-gif/hiragana/so.gif",
  た: "/kana-gif/hiragana/ta.gif",
  ち: "/kana-gif/hiragana/chi.gif",
  つ: "/kana-gif/hiragana/tsu.gif",
  て: "/kana-gif/hiragana/te.gif",
  と: "/kana-gif/hiragana/to.gif",
  な: "/kana-gif/hiragana/na.gif",
  に: "/kana-gif/hiragana/ni.gif",
  ぬ: "/kana-gif/hiragana/nu.gif",
  ね: "/kana-gif/hiragana/ne.gif",
  の: "/kana-gif/hiragana/no.gif",
  は: "/kana-gif/hiragana/ha.gif",
  ひ: "/kana-gif/hiragana/hi.gif",
  ふ: "/kana-gif/hiragana/fu.gif",
  へ: "/kana-gif/hiragana/he.gif",
  ほ: "/kana-gif/hiragana/ho.gif",
  ま: "/kana-gif/hiragana/ma.gif",
  み: "/kana-gif/hiragana/mi.gif",
  む: "/kana-gif/hiragana/mu.gif",
  め: "/kana-gif/hiragana/me.gif",
  も: "/kana-gif/hiragana/mo.gif",
  や: "/kana-gif/hiragana/ya.gif",
  ゆ: "/kana-gif/hiragana/yu.gif",
  よ: "/kana-gif/hiragana/yo.gif",
  ら: "/kana-gif/hiragana/ra.gif",
  り: "/kana-gif/hiragana/ri.gif",
  る: "/kana-gif/hiragana/ru.gif",
  れ: "/kana-gif/hiragana/re.gif",
  ろ: "/kana-gif/hiragana/ro.gif",
  わ: "/kana-gif/hiragana/wa.gif",
  を: "/kana-gif/hiragana/wo.gif",
  ん: "/kana-gif/hiragana/n.gif",
};

const katakanaGifMap: Record<string, string> = {
  ア: "/kana-gif/katakana/a.gif",
  イ: "/kana-gif/katakana/i.gif",
  ウ: "/kana-gif/katakana/u.gif",
  エ: "/kana-gif/katakana/e.gif",
  オ: "/kana-gif/katakana/o.gif",
  カ: "/kana-gif/katakana/ka.gif",
  キ: "/kana-gif/katakana/ki.gif",
  ク: "/kana-gif/katakana/ku.gif",
  ケ: "/kana-gif/katakana/ke.gif",
  コ: "/kana-gif/katakana/ko.gif",
  サ: "/kana-gif/katakana/sa.gif",
  シ: "/kana-gif/katakana/shi.gif",
  ス: "/kana-gif/katakana/su.gif",
  セ: "/kana-gif/katakana/se.gif",
  ソ: "/kana-gif/katakana/so.gif",
  タ: "/kana-gif/katakana/ta.gif",
  チ: "/kana-gif/katakana/chi.gif",
  ツ: "/kana-gif/katakana/tsu.gif",
  テ: "/kana-gif/katakana/te.gif",
  ト: "/kana-gif/katakana/to.gif",
  ナ: "/kana-gif/katakana/na.gif",
  ニ: "/kana-gif/katakana/ni.gif",
  ヌ: "/kana-gif/katakana/nu.gif",
  ネ: "/kana-gif/katakana/ne.gif",
  ノ: "/kana-gif/katakana/no.gif",
  ハ: "/kana-gif/katakana/ha.gif",
  ヒ: "/kana-gif/katakana/hi.gif",
  フ: "/kana-gif/katakana/fu.gif",
  ヘ: "/kana-gif/katakana/he.gif",
  ホ: "/kana-gif/katakana/ho.gif",
  マ: "/kana-gif/katakana/ma.gif",
  ミ: "/kana-gif/katakana/mi.gif",
  ム: "/kana-gif/katakana/mu.gif",
  メ: "/kana-gif/katakana/me.gif",
  モ: "/kana-gif/katakana/mo.gif",
  ヤ: "/kana-gif/katakana/ya.gif",
  ユ: "/kana-gif/katakana/yu.gif",
  ヨ: "/kana-gif/katakana/yo.gif",
  ラ: "/kana-gif/katakana/ra.gif",
  リ: "/kana-gif/katakana/ri.gif",
  ル: "/kana-gif/katakana/ru.gif",
  レ: "/kana-gif/katakana/re.gif",
  ロ: "/kana-gif/katakana/ro.gif",
  ワ: "/kana-gif/katakana/wa.gif",
  ヲ: "/kana-gif/katakana/wu(o).gif",
  ン: "/kana-gif/katakana/n.gif",
};

const hiraganaGuideMap: Record<string, string> = {
  あ: "/kana-guide/hiragana/a.png", い: "/kana-guide/hiragana/i.png", う: "/kana-guide/hiragana/u.png", え: "/kana-guide/hiragana/e.png", お: "/kana-guide/hiragana/o.png",
  か: "/kana-guide/hiragana/ka.png", き: "/kana-guide/hiragana/ki.png", く: "/kana-guide/hiragana/ku.png", け: "/kana-guide/hiragana/ke.png", こ: "/kana-guide/hiragana/ko.png",
  さ: "/kana-guide/hiragana/sa.png", し: "/kana-guide/hiragana/shi.png", す: "/kana-guide/hiragana/su.png", せ: "/kana-guide/hiragana/se.png", そ: "/kana-guide/hiragana/so.png",
  た: "/kana-guide/hiragana/ta.png", ち: "/kana-guide/hiragana/chi.png", つ: "/kana-guide/hiragana/tsu.png", て: "/kana-guide/hiragana/te.png", と: "/kana-guide/hiragana/to.png",
  な: "/kana-guide/hiragana/na.png", に: "/kana-guide/hiragana/ni.png", ぬ: "/kana-guide/hiragana/nu.png", ね: "/kana-guide/hiragana/ne.png", の: "/kana-guide/hiragana/no.png",
  は: "/kana-guide/hiragana/ha.png", ひ: "/kana-guide/hiragana/hi.png", ふ: "/kana-guide/hiragana/fu.png", へ: "/kana-guide/hiragana/he.png", ほ: "/kana-guide/hiragana/ho.png",
  ま: "/kana-guide/hiragana/ma.png", み: "/kana-guide/hiragana/mi.png", む: "/kana-guide/hiragana/mu.png", め: "/kana-guide/hiragana/me.png", も: "/kana-guide/hiragana/mo.png",
  や: "/kana-guide/hiragana/ya.png", ゆ: "/kana-guide/hiragana/yu.png", よ: "/kana-guide/hiragana/yo.png",
  ら: "/kana-guide/hiragana/ra.png", り: "/kana-guide/hiragana/ri.png", る: "/kana-guide/hiragana/ru.png", れ: "/kana-guide/hiragana/re.png", ろ: "/kana-guide/hiragana/ro.png",
  わ: "/kana-guide/hiragana/wa.png", を: "/kana-guide/hiragana/wo.png", ん: "/kana-guide/hiragana/n.png",
};

const katakanaGuideMap: Record<string, string> = {
  ア: "/kana-guide/katakana/a.png", イ: "/kana-guide/katakana/i.png", ウ: "/kana-guide/katakana/u.png", エ: "/kana-guide/katakana/e.png", オ: "/kana-guide/katakana/o.png",
  カ: "/kana-guide/katakana/ka.png", キ: "/kana-guide/katakana/ki.png", ク: "/kana-guide/katakana/ku.png", ケ: "/kana-guide/katakana/ke.png", コ: "/kana-guide/katakana/ko.png",
  サ: "/kana-guide/katakana/sa.png", シ: "/kana-guide/katakana/shi.png", ス: "/kana-guide/katakana/su.png", セ: "/kana-guide/katakana/se.png", ソ: "/kana-guide/katakana/so.png",
  タ: "/kana-guide/katakana/ta.png", チ: "/kana-guide/katakana/chi.png", ツ: "/kana-guide/katakana/tsu.png", テ: "/kana-guide/katakana/te.png", ト: "/kana-guide/katakana/to.png",
  ナ: "/kana-guide/katakana/na.png", ニ: "/kana-guide/katakana/ni.png", ヌ: "/kana-guide/katakana/nu.png", ネ: "/kana-guide/katakana/ne.png", ノ: "/kana-guide/katakana/no.png",
  ハ: "/kana-guide/katakana/ha.png", ヒ: "/kana-guide/katakana/hi.png", フ: "/kana-guide/katakana/fu.png", ヘ: "/kana-guide/katakana/he.png", ホ: "/kana-guide/katakana/ho.png",
  マ: "/kana-guide/katakana/ma.png", ミ: "/kana-guide/katakana/mi.png", ム: "/kana-guide/katakana/mu.png", メ: "/kana-guide/katakana/me.png", モ: "/kana-guide/katakana/mo.png",
  ヤ: "/kana-guide/katakana/ya.png", ユ: "/kana-guide/katakana/yu.png", ヨ: "/kana-guide/katakana/yo.png",
  ラ: "/kana-guide/katakana/ra.png", リ: "/kana-guide/katakana/ri.png", ル: "/kana-guide/katakana/ru.png", レ: "/kana-guide/katakana/re.png", ロ: "/kana-guide/katakana/ro.png",
  ワ: "/kana-guide/katakana/wa.png", ヲ: "/kana-guide/katakana/wu(o).png", ン: "/kana-guide/katakana/n.png",
};

type KanaItem = {
  id?: string;
  char: string;
  roman: string;
  note?: string;
  examples?: { word: string; roman: string }[];
  kind?: "kana" | "youon" | "special";
  specialType?: "sokuon" | "n-sound" | "long-vowel";
};

const hiraganaYouon: KanaItem[] = [
  { char: "きゃ", roman: "kya", note: "き + 小さい ゃ", kind: "youon" }, { char: "きゅ", roman: "kyu", note: "き + 小さい ゅ", kind: "youon" }, { char: "きょ", roman: "kyo", note: "き + 小さい ょ", kind: "youon" },
  { char: "しゃ", roman: "sha", note: "し + 小さい ゃ", kind: "youon" }, { char: "しゅ", roman: "shu", note: "し + 小さい ゅ", kind: "youon" }, { char: "しょ", roman: "sho", note: "し + 小さい ょ", kind: "youon" },
  { char: "ちゃ", roman: "cha", note: "ち + 小さい ゃ", kind: "youon" }, { char: "ちゅ", roman: "chu", note: "ち + 小さい ゅ", kind: "youon" }, { char: "ちょ", roman: "cho", note: "ち + 小さい ょ", kind: "youon" },
  { char: "にゃ", roman: "nya", note: "に + 小さい ゃ", kind: "youon" }, { char: "にゅ", roman: "nyu", note: "に + 小さい ゅ", kind: "youon" }, { char: "にょ", roman: "nyo", note: "に + 小さい ょ", kind: "youon" },
  { char: "ひゃ", roman: "hya", note: "ひ + 小さい ゃ", kind: "youon" }, { char: "ひゅ", roman: "hyu", note: "ひ + 小さい ゅ", kind: "youon" }, { char: "ひょ", roman: "hyo", note: "ひ + 小さい ょ", kind: "youon" },
  { char: "みゃ", roman: "mya", note: "み + 小さい ゃ", kind: "youon" }, { char: "みゅ", roman: "myu", note: "み + 小さい ゅ", kind: "youon" }, { char: "みょ", roman: "myo", note: "み + 小さい ょ", kind: "youon" },
  { char: "りゃ", roman: "rya", note: "り + 小さい ゃ", kind: "youon" }, { char: "りゅ", roman: "ryu", note: "り + 小さい ゅ", kind: "youon" }, { char: "りょ", roman: "ryo", note: "り + 小さい ょ", kind: "youon" },
  { char: "ぎゃ", roman: "gya", note: "ぎ + 小さい ゃ", kind: "youon" }, { char: "ぎゅ", roman: "gyu", note: "ぎ + 小さい ゅ", kind: "youon" }, { char: "ぎょ", roman: "gyo", note: "ぎ + 小さい ょ", kind: "youon" },
  { char: "じゃ", roman: "ja", note: "じ + 小さい ゃ", kind: "youon" }, { char: "じゅ", roman: "ju", note: "じ + 小さい ゅ", kind: "youon" }, { char: "じょ", roman: "jo", note: "じ + 小さい ょ", kind: "youon" },
  { char: "びゃ", roman: "bya", note: "び + 小さい ゃ", kind: "youon" }, { char: "びゅ", roman: "byu", note: "び + 小さい ゅ", kind: "youon" }, { char: "びょ", roman: "byo", note: "び + 小さい ょ", kind: "youon" },
  { char: "ぴゃ", roman: "pya", note: "ぴ + 小さい ゃ", kind: "youon" }, { char: "ぴゅ", roman: "pyu", note: "ぴ + 小さい ゅ", kind: "youon" }, { char: "ぴょ", roman: "pyo", note: "ぴ + 小さい ょ", kind: "youon" },
];
const katakanaYouon: KanaItem[] = hiraganaYouon.map((item, i) => [{char:"キャ",roman:"kya"},{char:"キュ",roman:"kyu"},{char:"キョ",roman:"kyo"},{char:"シャ",roman:"sha"},{char:"シュ",roman:"shu"},{char:"ショ",roman:"sho"},{char:"チャ",roman:"cha"},{char:"チュ",roman:"chu"},{char:"チョ",roman:"cho"},{char:"ニャ",roman:"nya"},{char:"ニュ",roman:"nyu"},{char:"ニョ",roman:"nyo"},{char:"ヒャ",roman:"hya"},{char:"ヒュ",roman:"hyu"},{char:"ヒョ",roman:"hyo"},{char:"ミャ",roman:"mya"},{char:"ミュ",roman:"myu"},{char:"ミョ",roman:"myo"},{char:"リャ",roman:"rya"},{char:"リュ",roman:"ryu"},{char:"リョ",roman:"ryo"},{char:"ギャ",roman:"gya"},{char:"ギュ",roman:"gyu"},{char:"ギョ",roman:"gyo"},{char:"ジャ",roman:"ja"},{char:"ジュ",roman:"ju"},{char:"ジョ",roman:"jo"},{char:"ビャ",roman:"bya"},{char:"ビュ",roman:"byu"},{char:"ビョ",roman:"byo"},{char:"ピャ",roman:"pya"},{char:"ピュ",roman:"pyu"},{char:"ピョ",roman:"pyo"}][i]).map((item)=>({...item,note:`${item.char[0]} + 小さい ${item.char[1]}`,kind:"youon" as const}));
const hiraganaSpecialRules: KanaItem[] = [
  { id: "special-sokuon", char: "っ", roman: "sokuon", kind: "special", specialType: "sokuon", note: "작은 っ: 뒤 자음을 잠깐 막고 강하게 이어요.", examples: [{ word: "きって", roman: "kitte" }, { word: "がっこう", roman: "gakkou" }, { word: "ざっし", roman: "zasshi" }] },
  { id: "special-n-sound", char: "ん", roman: "n", kind: "special", specialType: "n-sound", note: "뒤 소리에 따라 n/m/ng처럼 들릴 수 있어요.", examples: [{ word: "さん", roman: "san" }, { word: "ほん", roman: "hon" }, { word: "しんぶん", roman: "shinbun" }, { word: "こんばんは", roman: "konbanwa" }] },
  { id: "special-long-vowel", char: "ー", roman: "long vowel", kind: "special", specialType: "long-vowel", note: "히라가나는 모음을 이어 길게, 가타카나는 ー로 길게 읽어요.", examples: [{ word: "おかあさん", roman: "okaasan" }, { word: "おとうさん", roman: "otousan" }, { word: "せんせい", roman: "sensei" }, { word: "おにいさん", roman: "oniisan" }] },
];
const katakanaSpecialRules: KanaItem[] = [
  { id: "special-sokuon", char: "ッ", roman: "sokuon", kind: "special", specialType: "sokuon", note: "작은 ッ: 뒤 자음을 잠깐 막고 강하게 이어요.", examples: [{ word: "ベッド", roman: "beddo" }, { word: "カップ", roman: "kappu" }] },
  { id: "special-n-sound", char: "ン", roman: "n", kind: "special", specialType: "n-sound", note: "뒤 소리에 따라 n/m/ng처럼 들릴 수 있어요.", examples: [{ word: "パン", roman: "pan" }] },
  { id: "special-long-vowel", char: "ー", roman: "long vowel", kind: "special", specialType: "long-vowel", note: "가타카나는 장음 기호 ー로 앞 모음을 길게 읽어요.", examples: [{ word: "コーヒー", roman: "koohii" }, { word: "ケーキ", roman: "keeki" }, { word: "タクシー", roman: "takushii" }, { word: "スーパー", roman: "suupaa" }] },
];

type KanaGroup = {
  id: string;
  label: string;
  chars: string[];
  note?: string;
};

const kanaConcepts = [
  { title: "히라가나", summary: "일본어의 기본 글자", detail: "일본어의 기본 글자입니다. 주로 일본어 고유어, 조사, 동사·형용사 어미에 자주 쓰입니다." },
  { title: "가타카나", summary: "외래어·강조 표현에 자주 사용", detail: "외래어, 외국 이름, 의성어·의태어, 강조 표현에 자주 쓰이는 글자입니다." },
  { title: "탁음", summary: "점(゛)이 붙어 소리가 변함", detail: "탁음은 글자 오른쪽 위에 점 두 개(゛)가 붙어 소리가 변한 글자예요. 예: か→が, さ→ざ, た→だ, は→ば" },
  { title: "반탁음", summary: "동그라미(゜)가 붙어 p계열 소리", detail: "반탁음은 は행 글자 오른쪽 위에 동그라미(゜)가 붙어 p 소리로 변한 글자예요. 예: は→ぱ, ひ→ぴ" },
  { title: "탁음 주의", summary: "じ/ぢ, ず/づ 발음 겹침", detail: "じ/ぢ는 둘 다 보통 ji로, ず/づ는 둘 다 보통 zu로 들릴 수 있습니다. 초보 단계에서는 じ, ず를 먼저 자주 사용합니다." },
  { title: "요음", summary: "작은 や/ゆ/よ를 붙여 한 박자", detail: "작은 や/ゆ/よ(ャ/ュ/ョ)를 붙여 한 박자로 읽는 소리입니다. 예: きゃ, しゅ, チョ" },
  { title: "촉음", summary: "작은 っ/ッ로 자음을 끊어 읽기", detail: "작은 っ/ッ로 표시하며 다음 자음을 잠깐 막았다가 터뜨리듯 읽습니다. 예: きって, がっこう, サッカー" },
  { title: "ん 발음", summary: "뒤 글자에 따라 다르게 들림", detail: "ん/ン은 뒤에 오는 소리에 따라 ㄴ/ㅁ/ㅇ처럼 들릴 수 있습니다. 예: ほん, せんせい, パン" },
  { title: "장음", summary: "소리를 한 박자 길게 늘림", detail: "소리를 한 박자 길게 늘여 읽는 발음입니다. 히라가나는 あ/い/う, えい, おう 표기가 많고 가타카나는 주로 ー로 표시합니다." },
] as const;

const hiraganaGroupDefs: KanaGroup[] = [
  { id: "basic-46", label: "기본 46자", chars: ["あ","い","う","え","お","か","き","く","け","こ","さ","し","す","せ","そ","た","ち","つ","て","と","な","に","ぬ","ね","の","は","ひ","ふ","へ","ほ","ま","み","む","め","も","や","ゆ","よ","ら","り","る","れ","ろ","わ","を","ん"] },
  { id: "dakuon-handakuon", label: "탁음/반탁음", chars: ["が","ぎ","ぐ","げ","ご","ざ","じ","ず","ぜ","ぞ","だ","ぢ","づ","で","ど","ば","び","ぶ","べ","ぼ","ぱ","ぴ","ぷ","ぺ","ぽ"] },
  { id: "a", label: "あ행", chars: ["あ", "い", "う", "え", "お"] },
  { id: "ka", label: "か행", chars: ["か", "き", "く", "け", "こ"] },
  { id: "sa", label: "さ행", chars: ["さ", "し", "す", "せ", "そ"] },
  { id: "ta", label: "た행", chars: ["た", "ち", "つ", "て", "と"] },
  { id: "na", label: "な행", chars: ["な", "に", "ぬ", "ね", "の"] },
  { id: "ha", label: "は행", chars: ["は", "ひ", "ふ", "へ", "ほ"] },
  { id: "ma", label: "ま행", chars: ["ま", "み", "む", "め", "も"] },
  { id: "ya", label: "や행", chars: ["や", "ゆ", "よ"] },
  { id: "ra", label: "ら행", chars: ["ら", "り", "る", "れ", "ろ"] },
  { id: "wa", label: "わ행", chars: ["わ", "を", "ん"] },
  { id: "ga", label: "が행", chars: ["が","ぎ","ぐ","げ","ご"] },
  { id: "za", label: "ざ행", chars: ["ざ","じ","ず","ぜ","ぞ"] },
  { id: "da", label: "だ행", chars: ["だ","ぢ","づ","で","ど"] },
  { id: "ba", label: "ば행", chars: ["ば","び","ぶ","べ","ぼ"] },
  { id: "pa", label: "ぱ행", chars: ["ぱ","ぴ","ぷ","ぺ","ぽ"] },
  { id: "youon-basic", label: "요음 기본", chars: ["きゃ","きゅ","きょ","しゃ","しゅ","しょ","ちゃ","ちゅ","ちょ","にゃ","にゅ","にょ","ひゃ","ひゅ","ひょ","みゃ","みゅ","みょ","りゃ","りゅ","りょ"] },
  { id: "youon-dakuon", label: "요음 탁음/반탁음", chars: ["ぎゃ","ぎゅ","ぎょ","じゃ","じゅ","じょ","びゃ","びゅ","びょ","ぴゃ","ぴゅ","ぴょ"] },
  { id: "sokuon", label: "촉음", chars: ["っ"] },
  { id: "n-sound", label: "ん 발음", chars: ["ん"] },
  { id: "long-vowel", label: "장음", chars: [], note: "장음은 소리 규칙으로, 예시 단어 학습은 다음 단계에서 추가" },
];

const katakanaGroupDefs: KanaGroup[] = [
  { id: "basic-46", label: "기본 46자", chars: ["ア","イ","ウ","エ","オ","カ","キ","ク","ケ","コ","サ","シ","ス","セ","ソ","タ","チ","ツ","テ","ト","ナ","ニ","ヌ","ネ","ノ","ハ","ヒ","フ","ヘ","ホ","マ","ミ","ム","メ","モ","ヤ","ユ","ヨ","ラ","リ","ル","レ","ロ","ワ","ヲ","ン"] },
  { id: "dakuon-handakuon", label: "탁음/반탁음", chars: ["ガ","ギ","グ","ゲ","ゴ","ザ","ジ","ズ","ゼ","ゾ","ダ","ヂ","ヅ","デ","ド","バ","ビ","ブ","ベ","ボ","パ","ピ","プ","ペ","ポ"] },
  { id: "a", label: "ア행", chars: ["ア", "イ", "ウ", "エ", "オ"] },
  { id: "ka", label: "カ행", chars: ["カ", "キ", "ク", "ケ", "コ"] },
  { id: "sa", label: "サ행", chars: ["サ", "シ", "ス", "セ", "ソ"] },
  { id: "ta", label: "タ행", chars: ["タ", "チ", "ツ", "テ", "ト"] },
  { id: "na", label: "ナ행", chars: ["ナ", "ニ", "ヌ", "ネ", "ノ"] },
  { id: "ha", label: "ハ행", chars: ["ハ", "ヒ", "フ", "ヘ", "ホ"] },
  { id: "ma", label: "マ행", chars: ["マ", "ミ", "ム", "メ", "モ"] },
  { id: "ya", label: "ヤ행", chars: ["ヤ", "ユ", "ヨ"] },
  { id: "ra", label: "ラ행", chars: ["ラ", "リ", "ル", "レ", "ロ"] },
  { id: "wa", label: "ワ행", chars: ["ワ", "ヲ", "ン"] },
  { id: "ga", label: "ガ행", chars: ["ガ","ギ","グ","ゲ","ゴ"] },
  { id: "za", label: "ザ행", chars: ["ザ","ジ","ズ","ゼ","ゾ"] },
  { id: "da", label: "ダ행", chars: ["ダ","ヂ","ヅ","デ","ド"] },
  { id: "ba", label: "バ행", chars: ["バ","ビ","ブ","ベ","ボ"] },
  { id: "pa", label: "パ행", chars: ["パ","ピ","プ","ペ","ポ"] },
  { id: "youon-basic", label: "요음 기본", chars: ["キャ","キュ","キョ","シャ","シュ","ショ","チャ","チュ","チョ","ニャ","ニュ","ニョ","ヒャ","ヒュ","ヒョ","ミャ","ミュ","ミョ","リャ","リュ","リョ"] },
  { id: "youon-dakuon", label: "요음 탁음/반탁음", chars: ["ギャ","ギュ","ギョ","ジャ","ジュ","ジョ","ビャ","ビュ","ビョ","ピャ","ピュ","ピョ"] },
  { id: "sokuon", label: "촉음", chars: ["ッ"] },
  { id: "n-sound", label: "ン 발음", chars: ["ン"] },
  { id: "long-vowel", label: "장음", chars: ["ー"], note: "장음 예시 단어 학습은 다음 단계에서 추가" },
];


type ConfusingPair = {
  a: { char: string; roman: string };
  b: { char: string; roman: string };
  tip: string;
};

const confusingPairs: ConfusingPair[] = [
  {
    a: { char: "シ", roman: "shi" },
    b: { char: "ツ", roman: "tsu" },
    tip: "シ는 획이 왼쪽 위에서 오른쪽 아래로 뻗고, ツ는 오른쪽 위에서 아래로 내려옵니다. 시옷(シ)은 누워있고, 쯔(ツ)는 세워져 있다고 기억하세요.",
  },
  {
    a: { char: "ソ", roman: "so" },
    b: { char: "ン", roman: "n" },
    tip: "ソ는 획이 왼쪽 아래에서 오른쪽 위로 비스듬히 올라가고, ン은 오른쪽 아래로 내려옵니다. 소(ソ)는 올라가고, 은(ン)은 내려온다고 기억하세요.",
  },
  {
    a: { char: "さ", roman: "sa" },
    b: { char: "き", roman: "ki" },
    tip: "さ는 위에 선이 하나이고 아래에 둥근 고리가 있습니다. き는 위에 선이 두 개이고 오른쪽에 작은 획이 추가됩니다. 선의 개수를 주목하세요.",
  },
  {
    a: { char: "ぬ", roman: "nu" },
    b: { char: "め", roman: "me" },
    tip: "ぬ는 오른쪽에 작은 고리(꼬리)가 있고, め는 오른쪽 고리가 더 크고 닫혀있습니다. 꼬리 크기로 구분하세요.",
  },
  {
    a: { char: "わ", roman: "wa" },
    b: { char: "れ", roman: "re" },
    tip: "わ는 왼쪽 세로선 아래가 둥글게 마무리되고, れ는 아래에 고리 모양이 추가됩니다. れ 아래의 고리를 주목하세요.",
  },
  {
    a: { char: "は", roman: "ha" },
    b: { char: "ほ", roman: "ho" },
    tip: "は는 오른쪽 부분이 두 획으로 나뉘고, ほ는 세 획으로 고리까지 있습니다. ほ에 작은 고리가 있다는 것을 기억하세요.",
  },
];

type ConfusingQuizItem = {
  question: { char: string; roman: string };
  choices: string[];
  pairIndex: number;
};

type StrokeOrderInfo = {
  totalStrokes: number;
  steps: string[];
  tip: string;
};

type WritingGuideMode = "view" | "faint" | "blank";

type HandwritingFeedback = {
  summary: string;
  goodPoints: string[] | string;
  advice: string[] | string;
  exampleTip: string;
};

type SectionSettings = {
  ttsRate: number;
  repeatCount: number;
  repeatDelayMs: number;
};
type AppSettings = Partial<SectionSettings> & {
  sections?: {
    kana?: Partial<SectionSettings>;
  };
};

const APP_SETTINGS_KEY = "japaneseAppSettings";
const DEFAULT_SETTINGS: SectionSettings = {
  ttsRate: 1,
  repeatCount: 1,
  repeatDelayMs: 500,
};
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const hiraganaDetailedStrokeOrderData: Record<string, StrokeOrderInfo> = {
  あ: {
    totalStrokes: 3,
    steps: [
      "1획: 위쪽 가로획을 왼쪽에서 오른쪽으로 가볍게 긋습니다.",
      "2획: 가운데에서 세로로 내려오며 아래쪽에서 살짝 방향을 틉니다.",
      "3획: 왼쪽 아래에서 시작해 둥글게 감아 오른쪽으로 마무리합니다.",
    ],
    tip: "마지막 곡선이 너무 작아지지 않도록 아래 공간을 넉넉히 써서 균형을 맞추세요.",
  },
  い: {
    totalStrokes: 2,
    steps: [
      "1획: 왼쪽 세로 곡선을 위에서 아래로 내려오며 부드럽게 끝냅니다.",
      "2획: 오른쪽 짧은 곡선을 위에서 아래로 빠르게 써서 마무리합니다.",
    ],
    tip: "두 획 사이 간격을 너무 좁히지 말고, 오른쪽 획을 살짝 안쪽으로 기울이면 안정적입니다.",
  },
  う: {
    totalStrokes: 2,
    steps: [
      "1획: 위쪽의 짧은 점획을 왼쪽에서 오른쪽으로 찍듯이 씁니다.",
      "2획: 중앙에서 시작해 아래로 내려간 뒤 오른쪽으로 크게 휘어 마무리합니다.",
    ],
    tip: "2획의 아래 곡선을 너무 급하게 꺾지 말고, 둥근 호를 크게 그려 주세요.",
  },
  え: {
    totalStrokes: 2,
    steps: [
      "1획: 윗부분의 짧은 가로획을 왼쪽에서 오른쪽으로 긋습니다.",
      "2획: 가운데에서 시작해 아래로 내려온 뒤 왼쪽으로 짧게 내밀고 크게 오른쪽으로 감습니다.",
    ],
    tip: "2획의 좌우 폭을 충분히 벌려야 え 특유의 펼쳐진 형태가 또렷해집니다.",
  },
  お: {
    totalStrokes: 3,
    steps: [
      "1획: 위쪽 가로획을 왼쪽에서 오른쪽으로 반듯하게 긋습니다.",
      "2획: 중앙 세로획을 위에서 아래로 내려 쓰며 아래쪽에서 살짝 왼쪽으로 붙입니다.",
      "3획: 오른쪽 점획을 위에서 아래로 짧게 내린 뒤 둥글게 이어 마무리합니다.",
    ],
    tip: "왼쪽(1·2획)과 오른쪽(3획)의 간격을 벌려야 お 모양이 답답하지 않게 보입니다.",
  },
  か: {
    totalStrokes: 3,
    steps: [
      "1획: 왼쪽 세로획을 위에서 아래로 쓰고 끝을 살짝 꺾습니다.",
      "2획: 오른쪽 위에서 왼쪽 아래로 비스듬히 내려 긋습니다.",
      "3획: 오른쪽 작은 곡선을 위에서 아래로 씁니다.",
    ],
    tip: "왼쪽 세로획과 오른쪽 곡선 사이 공간을 유지하면 글자 균형이 좋아집니다.",
  },
  き: {
    totalStrokes: 4,
    steps: [
      "1획: 위쪽 가로획을 왼쪽에서 오른쪽으로 긋습니다.",
      "2획: 아래쪽 가로획을 왼쪽에서 오른쪽으로 긋습니다.",
      "3획: 가운데를 세로로 내려 씁니다.",
      "4획: 아래쪽 곡선을 부드럽게 씁니다.",
    ],
    tip: "두 가로획이 너무 붙지 않게 간격을 유지하면 き 모양이 또렷해집니다.",
  },
  く: {
    totalStrokes: 1,
    steps: [
      "1획: 위에서 시작해 꺾어 왼쪽 아래로 내려 씁니다.",
    ],
    tip: "각도를 너무 둥글게 만들지 않으면 く 특유의 날렵한 형태가 살아납니다.",
  },
  け: {
    totalStrokes: 3,
    steps: [
      "1획: 왼쪽 세로획을 위에서 아래로 씁니다.",
      "2획: 오른쪽 위에서 아래로 세로획을 씁니다.",
      "3획: 오른쪽 세로획 중간에서 왼쪽 아래로 휘어 씁니다.",
    ],
    tip: "오른쪽 획이 중심이 되도록 배치하면 전체 균형을 잡기 쉽습니다.",
  },
  こ: {
    totalStrokes: 2,
    steps: [
      "1획: 위쪽 짧은 가로획을 왼쪽에서 오른쪽으로 긋습니다.",
      "2획: 아래쪽 긴 가로획을 왼쪽에서 오른쪽으로 긋습니다.",
    ],
    tip: "위아래 획 간격을 충분히 두면 こ가 답답해 보이지 않습니다.",
  },
  さ: {
    totalStrokes: 3,
    steps: [
      "1획: 위쪽 가로획을 왼쪽에서 오른쪽으로 짧게 긋습니다.",
      "2획: 가운데에서 아래로 내려오며 왼쪽으로 살짝 꺾어 중심축을 만듭니다.",
      "3획: 오른쪽에서 시작해 아래로 둥글게 감아 마무리합니다.",
    ],
    tip: "3획의 고리가 너무 닫히지 않게 열어 두면 き와 구분이 더 잘됩니다.",
  },
  し: {
    totalStrokes: 1,
    steps: [
      "1획: 위에서 시작해 왼쪽으로 살짝 휘며 아래로 길게 내려 오른쪽으로 부드럽게 끝냅니다.",
    ],
    tip: "마지막 꼬리를 자연스럽게 올려 주면 し 특유의 유연한 흐름이 살아납니다.",
  },
  す: {
    totalStrokes: 2,
    steps: [
      "1획: 위쪽 짧은 가로획을 가볍게 긋습니다.",
      "2획: 중앙에서 아래로 내린 뒤 왼쪽으로 짧게 돌아 나와 크게 오른쪽으로 감습니다.",
    ],
    tip: "아래쪽 곡선을 충분히 크게 써야 す가 좁아 보이지 않습니다.",
  },
  せ: {
    totalStrokes: 3,
    steps: [
      "1획: 왼쪽 세로획을 위에서 아래로 곧게 내립니다.",
      "2획: 위쪽 가로획을 왼쪽에서 오른쪽으로 긋고 끝을 조금 내립니다.",
      "3획: 가운데에서 아래로 내려오며 오른쪽으로 휘어 마무리합니다.",
    ],
    tip: "세로획(1획)을 너무 길게 쓰지 않으면 전체 비율이 안정적으로 맞습니다.",
  },
  そ: {
    totalStrokes: 1,
    steps: [
      "1획: 위쪽에서 시작해 오른쪽으로 흐른 뒤 크게 아래로 내려와 왼쪽으로 돌려 마무리합니다.",
    ],
    tip: "중간 꺾임을 분명히 주면 ん이나 リ 계열과 헷갈리지 않습니다.",
  },
  た: {
    totalStrokes: 4,
    steps: [
      "1획: 위쪽 짧은 가로획을 반듯하게 긋습니다.",
      "2획: 가운데 세로획을 위에서 아래로 내려 기준선을 만듭니다.",
      "3획: 왼쪽 아래로 짧은 비스듬한 획을 더합니다.",
      "4획: 오른쪽 부분을 위에서 아래로 내려 부드럽게 끝냅니다.",
    ],
    tip: "1·2획 교차점을 너무 위로 올리지 않으면 아래 공간이 살아납니다.",
  },
  ち: {
    totalStrokes: 2,
    steps: [
      "1획: 위에서 아래로 내리며 중간에서 살짝 왼쪽으로 꺾습니다.",
      "2획: 중앙에서 시작해 오른쪽으로 뻗은 뒤 아래로 크게 감아 끝냅니다.",
    ],
    tip: "2획의 끝을 너무 길게 끌지 않으면 단정한 ち 모양이 됩니다.",
  },
  つ: {
    totalStrokes: 1,
    steps: [
      "1획: 오른쪽 위에서 시작해 왼쪽 아래로 내려온 뒤 오른쪽으로 길게 휘어 올립니다.",
    ],
    tip: "시작점을 약간 높게 두고 곡선을 크게 그리면 つ의 탄력이 살아납니다.",
  },
  て: {
    totalStrokes: 1,
    steps: [
      "1획: 위쪽 짧은 선을 긋고 이어서 아래로 내린 뒤 오른쪽으로 크게 뻗어 마무리합니다.",
    ],
    tip: "마지막 가로 곡선을 너무 평평하게 하지 말고 살짝 상승시켜 보세요.",
  },
  と: {
    totalStrokes: 2,
    steps: [
      "1획: 위쪽 점획을 짧고 가볍게 씁니다.",
      "2획: 중앙에서 아래로 내린 뒤 오른쪽으로 둥글게 크게 감아 마무리합니다.",
    ],
    tip: "1획과 2획의 간격을 너무 붙이지 않으면 읽기 쉬운 と가 됩니다.",
  },
  な: {
    totalStrokes: 4,
    steps: [
      "1획: 위쪽 짧은 가로획을 긋습니다.",
      "2획: 세로획을 내려 중심을 세웁니다.",
      "3획: 왼쪽 아래로 짧게 빼는 보조 획을 넣습니다.",
      "4획: 오른쪽에서 시작해 아래로 돌며 둥글게 마무리합니다.",
    ],
    tip: "4획을 너무 작게 쓰면 た처럼 보여서 아래 고리를 충분히 확보하세요.",
  },
  に: {
    totalStrokes: 3,
    steps: [
      "1획: 위쪽 짧은 가로획을 씁니다.",
      "2획: 가운데 가로획을 1획보다 약간 길게 긋습니다.",
      "3획: 아래쪽 긴 가로획을 안정적으로 긋습니다.",
    ],
    tip: "세 가로획 길이를 위에서 아래로 점점 길게 하면 형태가 자연스럽습니다.",
  },
  ぬ: {
    totalStrokes: 2,
    steps: [
      "1획: 왼쪽 위에서 아래로 내려오며 가운데를 지나 오른쪽으로 감아 큰 고리를 만듭니다.",
      "2획: 오른쪽 아래에서 작은 꼬리 고리를 추가해 마무리합니다.",
    ],
    tip: "마지막 작은 고리를 분명히 써야 め와 차이가 또렷해집니다.",
  },
  ね: {
    totalStrokes: 1,
    steps: [
      "1획: 위에서 내려와 왼쪽으로 돌아 나오고 다시 오른쪽 아래로 크게 돌려 연결합니다.",
    ],
    tip: "중간의 안쪽 공간을 막지 않게 쓰면 ね 특유의 열린 형태가 잘 보입니다.",
  },
  の: {
    totalStrokes: 1,
    steps: [
      "1획: 위쪽에서 시작해 시계 방향으로 크게 원을 그리듯 돌아 자연스럽게 끝냅니다.",
    ],
    tip: "완전한 원보다 살짝 타원으로 쓰면 손글씨 느낌이 더 자연스럽습니다.",
  },
  は: {
    totalStrokes: 3,
    steps: [
      "1획: 왼쪽 세로획을 위에서 아래로 내려 씁니다.",
      "2획: 가운데 짧은 세로획을 추가합니다.",
      "3획: 오른쪽에서 아래로 내려와 둥글게 감아 마무리합니다.",
    ],
    tip: "오른쪽 3획을 너무 크게 만들지 않으면 전체가 균형 있게 보입니다.",
  },
  ひ: {
    totalStrokes: 1,
    steps: [
      "1획: 왼쪽 위에서 시작해 아래로 내려왔다가 오른쪽으로 길게 흘려 끝냅니다.",
    ],
    tip: "중간 굴곡을 부드럽게 연결하면 ひ의 리듬감이 깔끔하게 표현됩니다.",
  },
  ふ: {
    totalStrokes: 4,
    steps: [
      "1획: 위쪽 작은 점획을 찍습니다.",
      "2획: 그 아래에 두 번째 점획을 찍어 간격을 맞춥니다.",
      "3획: 왼쪽에서 오른쪽 아래로 짧게 내려오는 획을 씁니다.",
      "4획: 중앙에서 아래로 내린 뒤 왼쪽으로 돌렸다가 오른쪽으로 길게 뻗습니다.",
    ],
    tip: "위 점 두 개는 나란히 두고, 4획을 크게 써서 글자 중심을 잡아 주세요.",
  },
  へ: {
    totalStrokes: 1,
    steps: [
      "1획: 왼쪽 위에서 오른쪽 아래로 한 번에 비스듬히 내려 씁니다.",
    ],
    tip: "직선 느낌을 살리되 끝에서 힘을 빼면 자연스러운 へ가 됩니다.",
  },
  ほ: {
    totalStrokes: 4,
    steps: [
      "1획: 왼쪽 세로획을 내려 씁니다.",
      "2획: 가운데 세로획을 짧게 내립니다.",
      "3획: 오른쪽 위에서 아래로 내려 중심을 잡습니다.",
      "4획: 오른쪽 아래에 작은 고리를 만들며 마무리합니다.",
    ],
    tip: "오른쪽 고리를 지나치게 크게 키우지 않으면 は와 구별이 명확해집니다.",
  },
  ま: {
    totalStrokes: 3,
    steps: [
      "1획: 위쪽 가로획을 짧게 긋습니다.",
      "2획: 중앙에서 아래로 내려온 뒤 왼쪽으로 살짝 돌립니다.",
      "3획: 오른쪽에서 시작해 아래로 감아 균형 있게 마무리합니다.",
    ],
    tip: "2획과 3획의 시작 높이를 비슷하게 맞추면 안정적인 ま가 됩니다.",
  },
  み: {
    totalStrokes: 2,
    steps: [
      "1획: 왼쪽 위에서 오른쪽으로 짧게 흐르는 선을 씁니다.",
      "2획: 중앙에서 아래로 내려와 크게 감고 다시 올라오듯 마무리합니다.",
    ],
    tip: "2획을 너무 각지게 꺾지 말고 유선형으로 연결하면 읽기 쉽습니다.",
  },
  む: {
    totalStrokes: 3,
    steps: [
      "1획: 위쪽 짧은 가로획을 긋습니다.",
      "2획: 왼쪽에서 아래로 곡선을 만들어 기본 형태를 잡습니다.",
      "3획: 오른쪽에서 내려와 안쪽으로 말아 넣는 꼬리를 만듭니다.",
    ],
    tip: "아래 꼬리를 너무 길게 빼지 않으면 む가 깔끔하게 정리됩니다.",
  },
  め: {
    totalStrokes: 2,
    steps: [
      "1획: 왼쪽 위에서 아래로 내려와 오른쪽으로 크게 돌아 고리 형태를 만듭니다.",
      "2획: 오른쪽 아래에서 짧은 연결 획을 더해 마무리합니다.",
    ],
    tip: "1획의 고리를 완전히 닫아 주면 ぬ와의 차이가 분명해집니다.",
  },
  も: {
    totalStrokes: 3,
    steps: [
      "1획: 위쪽 짧은 가로획을 긋습니다.",
      "2획: 가운데 가로획을 조금 더 길게 긋습니다.",
      "3획: 세로획을 위에서 아래로 내려 마지막에 살짝 오른쪽으로 뺍니다.",
    ],
    tip: "가로획 두 개의 간격을 균등하게 두면 단정한 も 형태가 됩니다.",
  },
  や: {
    totalStrokes: 3,
    steps: [
      "1획: 왼쪽의 짧은 세로획을 아래로 씁니다.",
      "2획: 위쪽 가로획을 오른쪽으로 긋습니다.",
      "3획: 중앙에서 크게 아래로 내려왔다가 오른쪽으로 휘어 끝냅니다.",
    ],
    tip: "3획을 충분히 길게 써야 や 특유의 시원한 비율이 살아납니다.",
  },
  ゆ: {
    totalStrokes: 2,
    steps: [
      "1획: 왼쪽 짧은 세로획을 씁니다.",
      "2획: 오른쪽에서 내려오며 크게 고리를 만들고 안쪽을 지나 마무리합니다.",
    ],
    tip: "고리 안 공간을 넓게 남기면 ゆ가 답답하지 않고 또렷합니다.",
  },
  よ: {
    totalStrokes: 2,
    steps: [
      "1획: 왼쪽 짧은 세로획을 내립니다.",
      "2획: 위에서 시작해 아래로 내린 뒤 오른쪽으로 두 번 굽히듯 마무리합니다.",
    ],
    tip: "2획의 두 굴곡을 층처럼 분리하면 よ 형태가 깔끔하게 보입니다.",
  },
  ら: {
    totalStrokes: 2,
    steps: [
      "1획: 위쪽 점획을 짧게 씁니다.",
      "2획: 중앙에서 아래로 내려오다 왼쪽으로 돌리고 다시 오른쪽으로 흘려 끝냅니다.",
    ],
    tip: "2획 시작을 너무 왼쪽에 두지 않으면 균형 잡힌 ら가 됩니다.",
  },
  り: {
    totalStrokes: 2,
    steps: [
      "1획: 왼쪽 짧은 세로획을 아래로 씁니다.",
      "2획: 오른쪽 세로획을 더 길게 내려 살짝 안쪽으로 굽혀 마무리합니다.",
    ],
    tip: "오른쪽 획을 왼쪽보다 길게 쓰면 り의 기본 리듬이 살아납니다.",
  },
  る: {
    totalStrokes: 1,
    steps: [
      "1획: 위에서 시작해 왼쪽으로 돌고 아래에서 작게 고리를 만든 뒤 오른쪽으로 뺍니다.",
    ],
    tip: "아래 작은 고리를 분명히 만들면 ろ와 헷갈림을 줄일 수 있습니다.",
  },
  れ: {
    totalStrokes: 1,
    steps: [
      "1획: 위에서 아래로 내린 뒤 왼쪽으로 돌아 나오고 다시 아래로 연결해 작은 고리를 만듭니다.",
    ],
    tip: "끝부분 고리를 너무 크게 키우지 않으면 わ와의 구분이 쉬워집니다.",
  },
  ろ: {
    totalStrokes: 3,
    steps: [
      "1획: 위쪽 짧은 가로획을 긋습니다.",
      "2획: 왼쪽 세로획을 내려 씁니다.",
      "3획: 오른쪽에서 시작해 아래로 돌며 안쪽을 감아 마무리합니다.",
    ],
    tip: "3획의 내부 공간을 남겨 두면 뭉개지지 않는 ろ가 됩니다.",
  },
  わ: {
    totalStrokes: 2,
    steps: [
      "1획: 왼쪽 세로획을 위에서 아래로 내려 씁니다.",
      "2획: 오른쪽에서 시작해 아래로 돌며 둥글게 감고 끝을 살짝 올립니다.",
    ],
    tip: "2획 끝을 가볍게 들어 올리면 れ와 다른 わ의 인상이 선명해집니다.",
  },
  を: {
    totalStrokes: 3,
    steps: [
      "1획: 위쪽 짧은 가로획을 긋습니다.",
      "2획: 왼쪽 세로획을 아래로 내립니다.",
      "3획: 오른쪽에서 크게 돌아 나오며 아래 곡선을 길게 써 마무리합니다.",
    ],
    tip: "3획의 바깥 곡선을 넓게 써야 を가 또렷하고 읽기 쉽습니다.",
  },
  ん: {
    totalStrokes: 1,
    steps: [
      "1획: 위에서 아래로 내려오다 오른쪽으로 부드럽게 튕기듯 흘려 마무리합니다.",
    ],
    tip: "끝을 너무 길게 끌지 않고 짧게 정리하면 안정적인 ん이 됩니다.",
  },
};


const katakanaDetailedStrokeOrderData: Record<string, StrokeOrderInfo> = {
  ア: {
    totalStrokes: 2,
    steps: [
      "1획: 왼쪽 위에서 오른쪽 아래로 짧게 내려 첫 기준점을 만듭니다.",
      "2획: 위에서 아래로 길게 내린 뒤 오른쪽으로 가볍게 꺾어 마무리합니다.",
    ],
    tip: "2획 세로선을 중심보다 약간 왼쪽에 두면 ア의 비율이 안정적으로 보입니다.",
  },
  イ: {
    totalStrokes: 2,
    steps: [
      "1획: 왼쪽 점획을 위에서 아래로 짧게 내립니다.",
      "2획: 오른쪽 세로획을 길게 내려 끝을 살짝 안쪽으로 모읍니다.",
    ],
    tip: "왼쪽 1획을 너무 길게 쓰지 않으면 イ 특유의 날씬한 인상이 살아납니다.",
  },
  ウ: {
    totalStrokes: 3,
    steps: [
      "1획: 지붕 모양의 위 가로획을 왼쪽에서 오른쪽으로 긋습니다.",
      "2획: 중앙의 짧은 세로획을 아래로 내립니다.",
      "3획: 아래쪽 곡선을 왼쪽에서 시작해 오른쪽으로 크게 감아 마무리합니다.",
    ],
    tip: "ワ와 구분하려면 ウ는 위쪽 지붕(1획+2획)을 분명히 만들고, 아래 곡선을 중심에 맞춰 쓰세요.",
  },
  エ: {
    totalStrokes: 3,
    steps: [
      "1획: 위 가로획을 반듯하게 긋습니다.",
      "2획: 중앙 세로획을 위에서 아래로 곧게 내립니다.",
      "3획: 아래 가로획을 길게 그어 받침을 만듭니다.",
    ],
    tip: "1획보다 3획을 길게 써야 エ가 단단하고 또렷하게 보입니다.",
  },
  オ: {
    totalStrokes: 3,
    steps: [
      "1획: 위 가로획을 왼쪽에서 오른쪽으로 씁니다.",
      "2획: 세로획을 아래로 내리며 중심축을 잡습니다.",
      "3획: 오른쪽 점획을 위에서 아래로 짧게 써 균형을 맞춥니다.",
    ],
    tip: "3획 점획을 너무 바깥으로 빼지 않으면 オ의 중심이 흔들리지 않습니다.",
  },
  カ: {
    totalStrokes: 2,
    steps: [
      "1획: 왼쪽 짧은 가로획을 긋습니다.",
      "2획: 오른쪽에서 세로로 내려 끝을 살짝 꺾어 마무리합니다.",
    ],
    tip: "2획 끝을 강하게 꺾지 말고 짧게 정리하면 카타카나 카의 표준 형태에 가깝습니다.",
  },
  キ: {
    totalStrokes: 3,
    steps: [
      "1획: 위 가로획을 짧게 긋습니다.",
      "2획: 가운데 가로획을 1획보다 길게 씁니다.",
      "3획: 세로획을 아래로 내리며 끝을 살짝 오른쪽으로 뺍니다.",
    ],
    tip: "위아래 가로획 간격을 일정하게 유지하면 キ가 깔끔하게 읽힙니다.",
  },
  ク: {
    totalStrokes: 2,
    steps: [
      "1획: 위쪽 짧은 점획을 오른쪽 아래로 내립니다.",
      "2획: 왼쪽 위에서 시작해 아래로 내려오며 오른쪽으로 크게 꺾습니다.",
    ],
    tip: "ケ와 구분하려면 ク는 세로줄 없이 한 번에 꺾이는 2획 형태라는 점을 기억하세요.",
  },
  ケ: {
    totalStrokes: 3,
    steps: [
      "1획: 왼쪽 짧은 세로획을 아래로 씁니다.",
      "2획: 오른쪽 위에서 아래로 긴 세로획을 내립니다.",
      "3획: 2획 중간에서 왼쪽 아래로 짧은 보조획을 더합니다.",
    ],
    tip: "ク와 다르게 ケ는 중심이 되는 긴 세로획(2획)이 있으니, 이 축을 먼저 살려 쓰세요.",
  },
  コ: {
    totalStrokes: 2,
    steps: [
      "1획: 위 가로획을 짧게 긋습니다.",
      "2획: 아래 가로획을 더 길게 써 안정감을 줍니다.",
    ],
    tip: "두 가로획이 서로 평행하도록 맞추면 コ가 반듯하게 완성됩니다.",
  },
  サ: {
    totalStrokes: 3,
    steps: [
      "1획: 위 가로획을 긋습니다.",
      "2획: 왼쪽 세로획을 아래로 내립니다.",
      "3획: 오른쪽 세로획을 길게 내려 균형을 맞춥니다.",
    ],
    tip: "오른쪽 3획을 약간 길게 두면 サ의 비대칭 균형이 자연스럽습니다.",
  },
  シ: {
    totalStrokes: 3,
    steps: [
      "1획: 위쪽 짧은 점획을 왼쪽에서 오른쪽 아래로 내립니다.",
      "2획: 가운데 점획을 1획과 비슷한 방향으로 씁니다.",
      "3획: 오른쪽에서 왼쪽 아래로 길게 휘어 내리며 마무리합니다.",
    ],
    tip: "ツ와 구분 핵심: シ의 점 두 개는 가로로 누운 배치, 마지막 긴 획은 왼쪽 아래 방향입니다.",
  },
  ス: {
    totalStrokes: 2,
    steps: [
      "1획: 위 점획을 짧게 찍듯 씁니다.",
      "2획: 왼쪽 위에서 오른쪽 아래로 크게 내려 곡선을 살려 끝냅니다.",
    ],
    tip: "2획 끝을 너무 직선으로 내리지 말고 약간의 곡선을 주면 ス가 부드럽게 보입니다.",
  },
  セ: {
    totalStrokes: 2,
    steps: [
      "1획: 위 가로획을 길게 긋습니다.",
      "2획: 중앙에서 세로로 내려오며 오른쪽으로 짧게 뻗습니다.",
    ],
    tip: "2획의 세로 시작점을 정확히 중앙에 두면 セ의 중심이 맞아 떨어집니다.",
  },
  ソ: {
    totalStrokes: 2,
    steps: [
      "1획: 왼쪽 아래에서 오른쪽 위로 짧게 올려 씁니다.",
      "2획: 오른쪽 위에서 왼쪽 아래로 길게 내리며 끝을 가볍게 정리합니다.",
    ],
    tip: "ン과 구분하려면 ソ는 첫 획이 '올라가고' 마지막 획이 왼쪽 아래로 떨어진다는 흐름을 기억하세요.",
  },
  タ: {
    totalStrokes: 3,
    steps: [
      "1획: 위 점획을 짧게 씁니다.",
      "2획: 중앙 세로획을 아래로 내립니다.",
      "3획: 아래 가로획을 오른쪽으로 길게 빼 마무리합니다.",
    ],
    tip: "3획을 충분히 길게 써야 タ가 チ와 다르게 시원하게 펼쳐집니다.",
  },
  チ: {
    totalStrokes: 3,
    steps: [
      "1획: 위 가로획을 짧게 긋습니다.",
      "2획: 중앙 세로획을 아래로 내립니다.",
      "3획: 아래 가로획을 약간 위로 올리듯 그어 끝냅니다.",
    ],
    tip: "3획의 길이를 タ보다 짧게 두면 チ 형태가 또렷하게 구분됩니다.",
  },
  ツ: {
    totalStrokes: 3,
    steps: [
      "1획: 왼쪽 위에서 오른쪽 아래로 짧게 내립니다.",
      "2획: 오른쪽 위 점획을 1획보다 아래에 배치해 씁니다.",
      "3획: 위에서 아래로 길게 내린 뒤 살짝 왼쪽으로 휘어 마무리합니다.",
    ],
    tip: "シ와 구분 핵심: ツ의 점 두 개는 세로로 서 있고, 마지막 긴 획은 아래로 곧게 내려옵니다.",
  },
  テ: {
    totalStrokes: 3,
    steps: [
      "1획: 위 가로획을 길게 긋습니다.",
      "2획: 중앙 짧은 가로획을 평행하게 씁니다.",
      "3획: 세로획을 아래로 내려 중심을 고정합니다.",
    ],
    tip: "두 가로획 길이 차이를 크게 두지 않으면 テ가 단정하게 정렬됩니다.",
  },
  ト: {
    totalStrokes: 2,
    steps: [
      "1획: 세로획을 위에서 아래로 곧게 내립니다.",
      "2획: 오른쪽 점획을 중앙 높이에서 짧게 찍어 마무리합니다.",
    ],
    tip: "2획 점획을 너무 아래로 내리지 않으면 ト의 표준 비율이 유지됩니다.",
  },
  ナ: {
    totalStrokes: 2,
    steps: [
      "1획: 가로획을 왼쪽에서 오른쪽으로 긋습니다.",
      "2획: 중앙에서 세로로 내리며 끝을 살짝 왼쪽으로 보냅니다.",
    ],
    tip: "2획 시작점을 1획 중앙에 맞추면 ナ가 흔들림 없이 서게 됩니다.",
  },
  ニ: {
    totalStrokes: 2,
    steps: [
      "1획: 위 가로획을 짧게 긋습니다.",
      "2획: 아래 가로획을 더 길게 써 받침을 만듭니다.",
    ],
    tip: "위아래 획의 길이 대비를 명확히 주면 ニ가 히라가나 に와 헷갈리지 않습니다.",
  },
  ヌ: {
    totalStrokes: 2,
    steps: [
      "1획: 왼쪽 위에서 오른쪽 아래로 긴 대각선을 씁니다.",
      "2획: 위쪽에서 시작해 아래로 내려 교차한 뒤 오른쪽으로 짧게 뺍니다.",
    ],
    tip: "교차 지점을 글자 중앙보다 약간 위에 두면 ヌ의 형태가 안정적입니다.",
  },
  ネ: {
    totalStrokes: 4,
    steps: [
      "1획: 위 가로획을 긋습니다.",
      "2획: 중앙 세로획을 아래로 내립니다.",
      "3획: 왼쪽에서 오른쪽 아래로 짧은 대각선을 씁니다.",
      "4획: 오른쪽 점획을 가볍게 더해 마무리합니다.",
    ],
    tip: "마지막 4획을 너무 길게 쓰지 않으면 ネ의 날렵함이 유지됩니다.",
  },
  ノ: {
    totalStrokes: 1,
    steps: [
      "1획: 오른쪽 위에서 왼쪽 아래로 길고 부드럽게 내리며 끝을 가볍게 뺍니다.",
    ],
    tip: "직선으로만 내리기보다 중간에 미세한 곡선을 주면 자연스러운 ノ가 됩니다.",
  },
  ハ: {
    totalStrokes: 2,
    steps: [
      "1획: 왼쪽 획을 위에서 아래로 짧게 내립니다.",
      "2획: 오른쪽 획을 더 길게 내려 벌어진 형태를 만듭니다.",
    ],
    tip: "두 획 사이를 너무 붙이지 말고 아래로 갈수록 넓어지게 쓰면 ハ가 시원해집니다.",
  },
  ヒ: {
    totalStrokes: 2,
    steps: [
      "1획: 위 가로획을 오른쪽으로 긋습니다.",
      "2획: 왼쪽에서 아래로 내려 오른쪽으로 꺾어 감아 마무리합니다.",
    ],
    tip: "2획 곡선을 크게 잡으면 ヒ의 부드러운 곡선미가 잘 살아납니다.",
  },
  フ: {
    totalStrokes: 1,
    steps: [
      "1획: 위에서 아래로 내리며 왼쪽으로 돌린 뒤 다시 오른쪽으로 크게 휘어 끝냅니다.",
    ],
    tip: "중간 꺾임을 분명하게 주면 フ가 ホ나 ヌ와 헷갈리지 않습니다.",
  },
  ヘ: {
    totalStrokes: 1,
    steps: [
      "1획: 왼쪽 위에서 오른쪽 아래로 비스듬히 한 번에 내려 씁니다.",
    ],
    tip: "획 끝에서 힘을 살짝 빼면 각지지 않은 자연스러운 ヘ가 됩니다.",
  },
  ホ: {
    totalStrokes: 4,
    steps: [
      "1획: 위 가로획을 길게 긋습니다.",
      "2획: 중앙 세로획을 아래로 내립니다.",
      "3획: 왼쪽 아래로 짧은 점획을 씁니다.",
      "4획: 오른쪽 아래로 짧은 점획을 더해 마무리합니다.",
    ],
    tip: "3·4획 점의 높이를 비슷하게 맞추면 ホ가 균형 있게 정리됩니다.",
  },
  マ: {
    totalStrokes: 2,
    steps: [
      "1획: 위 가로획을 왼쪽에서 오른쪽으로 씁니다.",
      "2획: 왼쪽에서 내려와 오른쪽으로 꺾는 큰 획을 그립니다.",
    ],
    tip: "2획 끝을 너무 위로 들지 않으면 マ가 안정된 삼각 구도로 보입니다.",
  },
  ミ: {
    totalStrokes: 3,
    steps: [
      "1획: 위쪽 짧은 가로획을 긋습니다.",
      "2획: 가운데 가로획을 1획보다 길게 씁니다.",
      "3획: 아래 가로획을 가장 길게 그어 마무리합니다.",
    ],
    tip: "세 가로획 길이를 위에서 아래로 점점 길게 하면 ミ의 리듬이 또렷합니다.",
  },
  ム: {
    totalStrokes: 2,
    steps: [
      "1획: 왼쪽 위에서 오른쪽 아래로 길게 내려 기준선을 만듭니다.",
      "2획: 중앙에서 아래로 내려 오른쪽으로 꺾어 마무리합니다.",
    ],
    tip: "2획 시작점을 너무 위로 두지 않으면 ム의 내부 공간이 자연스럽게 확보됩니다.",
  },
  メ: {
    totalStrokes: 2,
    steps: [
      "1획: 왼쪽 위에서 오른쪽 아래로 대각선을 긋습니다.",
      "2획: 오른쪽 위에서 시작해 1획을 가로질러 왼쪽 아래로 내립니다.",
    ],
    tip: "교차 각도를 크게 주면 メ가 × 형태로 또렷하게 읽힙니다.",
  },
  モ: {
    totalStrokes: 3,
    steps: [
      "1획: 위 가로획을 짧게 긋습니다.",
      "2획: 가운데 가로획을 더 길게 씁니다.",
      "3획: 세로획을 아래로 내리며 오른쪽으로 짧게 정리합니다.",
    ],
    tip: "2획을 충분히 길게 써야 モ가 ユ와 확실히 구분됩니다.",
  },
  ヤ: {
    totalStrokes: 2,
    steps: [
      "1획: 왼쪽 짧은 점획을 아래로 내립니다.",
      "2획: 중앙에서 아래로 내려 오른쪽으로 크게 꺾어 흐름을 만듭니다.",
    ],
    tip: "2획의 시작 높이를 높게 잡으면 ヤ 특유의 활짝 열린 형태가 살아납니다.",
  },
  ユ: {
    totalStrokes: 2,
    steps: [
      "1획: 위 가로획을 길게 긋습니다.",
      "2획: 왼쪽 세로를 내린 뒤 아래 가로로 이어 ㄷ 형태를 만듭니다.",
    ],
    tip: "모서리를 너무 둥글리지 말고 각을 살리면 ユ가 또렷하게 보입니다.",
  },
  ヨ: {
    totalStrokes: 3,
    steps: [
      "1획: 왼쪽 세로획을 위에서 아래로 내립니다.",
      "2획: 위 가로획을 오른쪽으로 그어 연결합니다.",
      "3획: 가운데와 아래 가로를 이어 쓰듯 내려 마무리합니다.",
    ],
    tip: "가운데 칸을 너무 좁히지 않으면 ヨ의 층 구조가 선명해집니다.",
  },
  ラ: {
    totalStrokes: 2,
    steps: [
      "1획: 위 점획을 짧고 가볍게 씁니다.",
      "2획: 중앙에서 아래로 길게 내리며 오른쪽으로 살짝 흘립니다.",
    ],
    tip: "2획 끝을 너무 굽히지 않으면 ラ가 リ와 구분되는 직선감을 유지합니다.",
  },
  リ: {
    totalStrokes: 2,
    steps: [
      "1획: 왼쪽 세로획을 짧게 내립니다.",
      "2획: 오른쪽 세로획을 더 길게 내려 끝을 살짝 안쪽으로 모읍니다.",
    ],
    tip: "두 획 높이 차이를 분명히 두면 リ의 기본 리듬이 정확해집니다.",
  },
  ル: {
    totalStrokes: 2,
    steps: [
      "1획: 왼쪽 짧은 점획을 아래로 씁니다.",
      "2획: 오른쪽에서 길게 내려와 아래에서 왼쪽으로 살짝 꺾습니다.",
    ],
    tip: "2획 끝을 가볍게 안쪽으로 접어주면 ル가 レ와 헷갈리지 않습니다.",
  },
  レ: {
    totalStrokes: 1,
    steps: [
      "1획: 위쪽에서 시작해 아래로 내려오다 오른쪽으로 꺾어 길게 뻗습니다.",
    ],
    tip: "단일 획의 방향 전환을 크게 주면 レ의 힘 있는 형태가 잘 드러납니다.",
  },
  ロ: {
    totalStrokes: 3,
    steps: [
      "1획: 위 가로획을 긋습니다.",
      "2획: 왼쪽 세로를 아래로 내립니다.",
      "3획: 오른쪽 세로와 아래 가로를 이어 네모 틀을 완성합니다.",
    ],
    tip: "마지막 3획에서 아래 가로를 수평으로 맞추면 ロ가 반듯해집니다.",
  },
  ワ: {
    totalStrokes: 2,
    steps: [
      "1획: 위 가로획을 짧게 긋습니다.",
      "2획: 왼쪽에서 아래로 내려오다 오른쪽으로 둥글게 감아 마무리합니다.",
    ],
    tip: "ウ와 구분하려면 ワ는 중앙 세로획 없이 2획으로 끝나며, 아래 곡선이 더 크게 열립니다.",
  },
  ヲ: {
    totalStrokes: 3,
    steps: [
      "1획: 위 가로획을 짧게 긋습니다.",
      "2획: 중앙 세로획을 아래로 내려 틀을 잡습니다.",
      "3획: 오른쪽에서 시작해 아래를 크게 돌아 나와 마무리합니다.",
    ],
    tip: "3획을 바깥으로 넓게 써야 ヲ가 オ와 다른 닫힌 느낌으로 보입니다.",
  },
  ン: {
    totalStrokes: 2,
    steps: [
      "1획: 위에서 오른쪽 아래로 짧은 점획을 씁니다.",
      "2획: 왼쪽 위에서 오른쪽 아래로 길게 내려 끝을 가볍게 뺍니다.",
    ],
    tip: "ソ와 구분하려면 ン은 두 획 모두 아래로 향하는 흐름이고, 특히 2획이 오른쪽 아래로 떨어집니다.",
  },
};

const strokeCountByRoman: Record<string, number> = {
  a: 3, i: 2, u: 2, e: 2, o: 3,
  ka: 3, ki: 4, ku: 1, ke: 3, ko: 2,
  sa: 3, shi: 1, su: 2, se: 3, so: 1,
  ta: 4, chi: 2, tsu: 1, te: 1, to: 2,
  na: 4, ni: 3, nu: 2, ne: 1, no: 1,
  ha: 3, hi: 1, fu: 4, he: 1, ho: 4,
  ma: 3, mi: 2, mu: 3, me: 2, mo: 3,
  ya: 3, yu: 2, yo: 2,
  ra: 2, ri: 2, ru: 1, re: 1, ro: 3,
  wa: 2, wo: 3, n: 1,
};

const buildStrokeOrderInfo = (char: string, roman: string): StrokeOrderInfo | undefined => {
  const totalStrokes = strokeCountByRoman[roman];
  if (!totalStrokes) return undefined;

  const steps = Array.from({ length: totalStrokes }, (_, idx) => {
    const strokeNo = idx + 1;
    if (strokeNo === 1) return `${strokeNo}획: 글자의 기준이 되는 첫 선을 위에서 아래로 안정적으로 시작해요.`;
    if (strokeNo === totalStrokes) return `${strokeNo}획: 마지막 마무리 획은 길이를 짧게 조절해 균형을 맞춰요.`;
    return `${strokeNo}획: 이전 획과 간격을 맞추며 자연스럽게 이어서 써요.`;
  });

  return {
    totalStrokes,
    steps,
    tip: `${char}(${roman})는 중심선을 기준으로 비율을 먼저 잡고, 천천히 획 순서를 지키며 반복 연습하세요.`,
  };
};

const hiraganaStrokeOrderData: Record<string, StrokeOrderInfo> = Object.fromEntries(
  hiragana
    .map((item) => {
      const detailedInfo = hiraganaDetailedStrokeOrderData[item.char];
      if (detailedInfo) return [item.char, detailedInfo] as [string, StrokeOrderInfo];
      const info = buildStrokeOrderInfo(item.char, item.roman);
      return info ? [item.char, info] : null;
    })
    .filter((entry): entry is [string, StrokeOrderInfo] => entry !== null)
);

const katakanaStrokeOrderData: Record<string, StrokeOrderInfo> = Object.fromEntries(
  katakana
    .map((item) => {
      const detailedInfo = katakanaDetailedStrokeOrderData[item.char];
      if (detailedInfo) return [item.char, detailedInfo] as [string, StrokeOrderInfo];
      const info = buildStrokeOrderInfo(item.char, item.roman);
      return info ? [item.char, info] : null;
    })
    .filter((entry): entry is [string, StrokeOrderInfo] => entry !== null)
);

async function speakKanaFallback(
  char: string,
  settings: SectionSettings,
  onStart?: () => void,
  onEnd?: () => void
) {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();

  const makeUtter = (text: string) => {
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "ja-JP";
    utter.rate = settings.ttsRate;
    utter.pitch = 1;
    utter.volume = 1;
    const voices = window.speechSynthesis.getVoices();
    const jaVoice = voices.find((v) => v.lang === "ja-JP" || v.lang.startsWith("ja"));
    if (jaVoice) utter.voice = jaVoice;
    return utter;
  };

  for (let i = 0; i < settings.repeatCount; i += 1) {
    const utter = makeUtter(char);
    if (i === 0) {
      utter.onstart = () => { if (onStart) onStart(); };
    }
    await new Promise<void>((resolve) => {
      utter.onend = () => resolve();
      utter.onerror = () => resolve();
      setTimeout(() => {
        window.speechSynthesis.speak(utter);
      }, 80);
    });
    if (i < settings.repeatCount - 1 && settings.repeatDelayMs > 0) {
      await wait(settings.repeatDelayMs);
    }
  }

  if (onEnd) onEnd();
}

async function speakKana(
  char: string,
  settings: SectionSettings,
  onStart?: () => void,
  onEnd?: () => void
) {
  try {
    if (onStart) onStart();
    const res = await fetch("/api/language/tts", {
      method: "POST",
      headers: await authenticatedJsonHeaders(),
      body: JSON.stringify({ text: char }),
    });
    if (!res.ok) throw new Error("TTS API error");
    const { audioContent } = await res.json();
    if (!audioContent) throw new Error("No audioContent");

    for (let i = 0; i < settings.repeatCount; i += 1) {
      const audio = new Audio(`data:audio/mp3;base64,${audioContent}`);
      audio.playbackRate = settings.ttsRate;
      await new Promise<void>((resolve, reject) => {
        audio.onended = () => resolve();
        audio.onerror = () => reject(new Error("Audio playback failed"));
        audio.play().catch(reject);
      });
      if (i < settings.repeatCount - 1 && settings.repeatDelayMs > 0) {
        await wait(settings.repeatDelayMs);
      }
    }
    if (onEnd) onEnd();
  } catch {
    await speakKanaFallback(char, settings, onStart, onEnd);
  }
}

function getKanaType(char: string): "hiragana" | "katakana" {
  const code = char.codePointAt(0) ?? 0;
  // Hiragana: U+3041–U+309F, Katakana: U+30A0–U+30FF
  return code >= 0x30a0 && code <= 0x30ff ? "katakana" : "hiragana";
}

function saveWrongKana(
  char: string,
  romaji: string,
  type: "hiragana" | "katakana",
  mode: "quiz" | "confusing"
) {
  try {
    const raw = localStorage.getItem("wrongKana");
    const existing: Array<{
      char: string;
      romaji: string;
      type: "hiragana" | "katakana";
      mode: "quiz" | "confusing";
      createdAt: string;
    }> = raw ? JSON.parse(raw) : [];

    const isDuplicate = existing.some(
      (item) => item.char === char && item.mode === mode
    );
    if (isDuplicate) return;

    existing.push({ char, romaji, type, mode, createdAt: new Date().toISOString() });
    localStorage.setItem("wrongKana", JSON.stringify(existing));
  } catch {
    // JSON 파싱 실패 또는 localStorage 접근 불가 시 무시
  }
}

function getConfusingQuizQuestion(pairIdx?: number): ConfusingQuizItem {
  const idx = pairIdx !== undefined ? pairIdx : Math.floor(Math.random() * confusingPairs.length);
  const pair = confusingPairs[idx];
  const pickA = Math.random() < 0.5;
  const question = pickA ? pair.a : pair.b;
  const wrong = pickA ? pair.b.roman : pair.a.roman;
  const choices = Math.random() < 0.5
    ? [question.roman, wrong]
    : [wrong, question.roman];
  return { question, choices, pairIndex: idx };
}

function getQuizQuestion(data: KanaItem[]): { question: KanaItem; choices: string[] } {
  const questionIndex = Math.floor(Math.random() * data.length);
  const question = data[questionIndex];

  const uniqueByRoman = Array.from(
    new Map(
      data
        .filter((item) => item.roman && (item.char || item.id))
        .map((item) => [item.roman, item])
    ).values()
  );
  const wrongPool = uniqueByRoman.filter((item) => item.roman !== question.roman);
  const shuffled = [...wrongPool].sort(() => Math.random() - 0.5);
  const wrongs = shuffled.slice(0, 3).map((item) => item.roman);

  const uniqueChoices = Array.from(new Set([...wrongs, question.roman]));
  const choices = uniqueChoices.sort(() => Math.random() - 0.5);
  return { question, choices };
}

function getQuizEligibleItems(items: KanaItem[]): KanaItem[] {
  return items.filter((item) => Boolean(item.roman) && Boolean(item.char || item.id));
}

function getWritingQuizQuestion(data: KanaItem[]): KanaItem {
  const questionIndex = Math.floor(Math.random() * data.length);
  return data[questionIndex];
}

function uniqueKanaItems(items: KanaItem[]): KanaItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.id ?? (item.kind === "special" ? `special-${item.specialType ?? item.char}` : `kana-${item.char}`);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default function KanaPage() {
  const [tab, setTab] = useState<"hiragana" | "katakana">("hiragana");
  const [mode, setMode] = useState<"learn" | "quiz" | "confusing" | "writing" | "audit">("learn");

  const allData: KanaItem[] = useMemo(() => uniqueKanaItems(tab === "hiragana"
    ? [...hiragana, ...hiraganaYouon, ...hiraganaSpecialRules]
    : [...katakana, ...katakanaYouon, ...katakanaSpecialRules]), [tab]);
  const groupDefs = useMemo(() => (tab === "hiragana" ? hiraganaGroupDefs : katakanaGroupDefs), [tab]);
  const [selectedKanaGroupIds, setSelectedKanaGroupIds] = useState<string[]>(["all"]);
  const [auditScope, setAuditScope] = useState<"base" | "dakuon" | "youon" | "special" | "all">("base");
  const [openConcept, setOpenConcept] = useState<string | null>(null);
  const [wrongKanaChars, setWrongKanaChars] = useState<Set<string>>(new Set());

  const availableGroups = useMemo(() => groupDefs.map((group) => ({
    ...group,
    matchedChars: group.chars.filter((char) => allData.some((item) => item.char === char)),
  })), [allData, groupDefs]);
  const selectedGroupKey = useMemo(
    () => selectedKanaGroupIds.slice().sort().join("|"),
    [selectedKanaGroupIds]
  );
  const selectedGroupSet = useMemo(() => new Set(selectedKanaGroupIds), [selectedGroupKey]);
  const baseKanaGroups = availableGroups.filter((group) =>
    ["a", "ka", "sa", "ta", "na", "ha", "ma", "ya", "ra", "wa"].includes(group.id)
  );
  const baseKanaItems = allData.filter((item) =>
    item.kind !== "special" &&
    baseKanaGroups.some((group) => group.matchedChars.includes(item.char))
  );
  const dakuonKanaGroups = availableGroups.filter((group) => ["ga", "za", "da", "ba", "pa"].includes(group.id));
  const dakuonKanaItems = allData.filter((item) =>
    item.kind !== "special" &&
    dakuonKanaGroups.some((group) => group.matchedChars.includes(item.char))
  );
  const allKanaGroupByChar = availableGroups.reduce<Record<string, KanaGroup>>((acc, group) => {
    group.matchedChars.forEach((char) => {
      acc[char] = group;
    });
    return acc;
  }, {});
  const youonKanaItems = allData.filter((item) => item.kind === "youon");
  const specialKanaItems = allData.filter((item) => item.kind === "special");
  const auditItems = auditScope === "base" ? baseKanaItems : auditScope === "dakuon" ? dakuonKanaItems : auditScope === "youon" ? youonKanaItems : auditScope === "special" ? specialKanaItems : allData;
  const selectedGroupChars = useMemo(
    () => selectedKanaGroupIds
      .filter((groupId) => groupId !== "all")
      .flatMap((groupId) => availableGroups.find((group) => group.id === groupId)?.matchedChars ?? []),
    [availableGroups, selectedGroupKey]
  );
  const selectedGroups = useMemo(
    () => availableGroups.filter((group) => selectedGroupSet.has(group.id)),
    [availableGroups, selectedGroupKey]
  );
  const selectedSpecialTypes = useMemo(() => new Set(
    selectedGroups
      .filter((group) => ["sokuon", "n-sound", "long-vowel"].includes(group.id))
      .map((group) => group.id as KanaItem["specialType"])
  ), [selectedGroups]);
  const includesNSoundSpecial = selectedSpecialTypes.has("n-sound");
  const data = useMemo(() => {
    if (selectedGroupSet.has("all")) return allData;

    const regularSelectedData = allData.filter((item) =>
      item.kind !== "special" &&
      selectedGroupChars.includes(item.char) &&
      !(includesNSoundSpecial && (item.char === "ん" || item.char === "ン"))
    );
    const specialSelectedData = allData.filter((item) =>
      item.kind === "special" && selectedSpecialTypes.has(item.specialType)
    );

    return uniqueKanaItems([...regularSelectedData, ...specialSelectedData]);
  }, [allData, includesNSoundSpecial, selectedGroupChars, selectedGroupKey, selectedSpecialTypes]);
  const dataKey = useMemo(() => data.map((item) => item.id ?? `${item.kind ?? "kana"}-${item.char}-${item.roman}`).join("|"), [data]);
  const dataRef = useRef<KanaItem[]>([]);
  const selectedGroupLabels = selectedGroupSet.has("all")
    ? ["전체"]
    : availableGroups.filter((group) => selectedGroupSet.has(group.id)).map((group) => group.label);

  const [quiz, setQuiz] = useState<{ question: KanaItem; choices: string[] }>(() =>
    getQuizQuestion(hiragana)
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [score, setScore] = useState({ correct: 0, total: 0 });

  // 헷갈리는 글자 모드 상태
  const [confusingView, setConfusingView] = useState<"cards" | "quiz">("cards");
  const [confusingQuiz, setConfusingQuiz] = useState<ConfusingQuizItem>(() => getConfusingQuizQuestion());
  const [confusingSelected, setConfusingSelected] = useState<string | null>(null);
  const [confusingScore, setConfusingScore] = useState({ correct: 0, total: 0 });

  // 발음 재생 중 표시
  const [playingChar, setPlayingChar] = useState<string | null>(null);
  const [settings, setSettings] = useState<SectionSettings>(DEFAULT_SETTINGS);
  const playingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(APP_SETTINGS_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw) as AppSettings;
      const sectionSettings = {
        ...DEFAULT_SETTINGS,
        ...parsed,
        ...(parsed.sections?.kana ?? {}),
      };
      setSettings({
        ttsRate: sectionSettings.ttsRate,
        repeatCount: sectionSettings.repeatCount,
        repeatDelayMs: sectionSettings.repeatDelayMs,
      });
    } catch {
      setSettings(DEFAULT_SETTINGS);
    }
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("wrongKana");
      if (!raw) return;
      const parsed = JSON.parse(raw) as Array<{ char: string }>;
      setWrongKanaChars(new Set(parsed.map((item) => item.char)));
    } catch {}
  }, []);

  // 쓰기 연습 모드 상태
  const [writingSubMode, setWritingSubMode] = useState<"trace" | "quiz">("trace");
  const [writingGuideMode, setWritingGuideMode] = useState<WritingGuideMode>("view");
  const [writingIndex, setWritingIndex] = useState(0);
  const [writingOrderMode, setWritingOrderMode] = useState<"sequence" | "random">("sequence");
  const [writingQuizQuestion, setWritingQuizQuestion] = useState<KanaItem>(() =>
    getWritingQuizQuestion(hiragana)
  );
  const [writingQuizShowAnswer, setWritingQuizShowAnswer] = useState(false);
  const [writingQuizAnswered, setWritingQuizAnswered] = useState(false);
  const [writingQuizScore, setWritingQuizScore] = useState({ correct: 0, wrong: 0, total: 0 });
  const [writingFeedback, setWritingFeedback] = useState<HandwritingFeedback | null>(null);
  const [writingFeedbackLoading, setWritingFeedbackLoading] = useState(false);
  const [writingFeedbackError, setWritingFeedbackError] = useState<string | null>(null);
  const writingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const writingAreaRef = useRef<HTMLDivElement | null>(null);
  const writingIsDrawingRef = useRef(false);
  const writingLastPointRef = useRef<{ x: number; y: number } | null>(null);
  const lastQuizResetKeyRef = useRef<string>("");
  const prevModeRef = useRef(mode);

  const handleSpeak = useCallback((char: string) => {
    if (playingTimerRef.current) clearTimeout(playingTimerRef.current);
    setPlayingChar(char);
    speakKana(
      char,
      settings,
      () => { setPlayingChar(char); },
      () => {
        playingTimerRef.current = setTimeout(() => setPlayingChar(null), 300);
      }
    );
    // 최대 6초 후 강제 초기화 (onEnd 미발동 대비)
    playingTimerRef.current = setTimeout(() => setPlayingChar(null), 6000);
  }, [settings]);

  const loadNextQuestion = useCallback(
    (currentData: KanaItem[]) => {
      const source = getQuizEligibleItems(currentData);
      setQuiz(getQuizQuestion(source.length > 0 ? source : getQuizEligibleItems(allData)));
      setSelected(null);
    },
    [allData]
  );
  const toggleKanaGroup = (groupId: string) => {
    setSelectedKanaGroupIds((prev) => {
      if (groupId === "all") return ["all"];
      const withoutAll = prev.filter((id) => id !== "all");
      const exists = withoutAll.includes(groupId);
      if (exists) {
        const next = withoutAll.filter((id) => id !== groupId);
        return next.length > 0 ? next : ["basic-46"];
      }
      return [...withoutAll, groupId];
    });
  };

  const handleTabChange = (newTab: "hiragana" | "katakana") => {
    setTab(newTab);
    setSelectedKanaGroupIds(["all"]);
    const newData = newTab === "hiragana" ? hiragana : katakana;
    setWritingIndex(0);
    setWritingOrderMode("sequence");
    setWritingSubMode("trace");
    setWritingGuideMode("view");
    setWritingQuizQuestion(getWritingQuizQuestion(newData));
    setWritingQuizShowAnswer(false);
    setWritingQuizAnswered(false);
    setWritingQuizScore({ correct: 0, wrong: 0, total: 0 });
    setSelected(null);
    setScore({ correct: 0, total: 0 });
    setQuiz(getQuizQuestion(getQuizEligibleItems(newData)));
  };

  const handleModeChange = (newMode: "learn" | "quiz" | "confusing" | "writing" | "audit") => {
    setMode(newMode);
    if (newMode === "quiz") {
      setSelected(null);
      setScore({ correct: 0, total: 0 });
    }
    if (newMode === "confusing") {
      setConfusingView("cards");
      setConfusingSelected(null);
      setConfusingScore({ correct: 0, total: 0 });
      setConfusingQuiz(getConfusingQuizQuestion());
    }
  };

  const setupWritingCanvas = useCallback((canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);

    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 6;

    return ctx;
  }, []);

  const clearWritingCanvas = useCallback(() => {
    const canvas = writingCanvasRef.current;
    if (!canvas) return;
    const ctx = setupWritingCanvas(canvas);
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
  }, [setupWritingCanvas]);

  const resizeWritingCanvas = useCallback(() => {
    const canvas = writingCanvasRef.current;
    if (!canvas) return;
    setupWritingCanvas(canvas);
  }, [setupWritingCanvas]);

  useEffect(() => {
    if (mode !== "writing") return;
    const runResize = () => {
      writingIsDrawingRef.current = false;
      writingLastPointRef.current = null;
      resizeWritingCanvas();
      clearWritingCanvas();
    };

    const frameId = requestAnimationFrame(runResize);
    const onResize = () => {
      requestAnimationFrame(runResize);
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("resize", onResize);
    };
  }, [mode, writingSubMode, writingGuideMode, writingIndex, tab, selectedKanaGroupIds, resizeWritingCanvas, clearWritingCanvas]);

  const getCanvasPoint = useCallback((event: React.PointerEvent<HTMLCanvasElement>, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }, []);

  const drawFromLastPoint = useCallback((point: { x: number; y: number }) => {
    const canvas = writingCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    writingLastPointRef.current = point;
  }, []);

  const startDrawing = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    writingIsDrawingRef.current = true;

    const point = getCanvasPoint(event, canvas);
    writingLastPointRef.current = point;
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
  }, [getCanvasPoint]);

  const drawMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!writingIsDrawingRef.current) return;
    const point = getCanvasPoint(event, event.currentTarget);
    event.preventDefault();
    drawFromLastPoint(point);
  }, [drawFromLastPoint, getCanvasPoint]);

  const endDrawing = useCallback((event?: React.PointerEvent<HTMLCanvasElement>) => {
    if (event) {
      event.preventDefault();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }
    writingIsDrawingRef.current = false;
    writingLastPointRef.current = null;
    const canvas = writingCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    ctx?.beginPath();
  }, []);

  const currentWritingItem = data[writingIndex];
  const currentStrokeOrderInfo = currentWritingItem
    ? (tab === "hiragana" ? hiraganaStrokeOrderData[currentWritingItem.char] : katakanaStrokeOrderData[currentWritingItem.char])
    : undefined;
  const currentWritingTip = currentStrokeOrderInfo?.tip?.trim() || "글자 모양을 보고 천천히 따라 써 보세요.";
  const currentChar = currentWritingItem?.char ?? "";
  const currentGuideMap = tab === "hiragana" ? hiraganaGuideMap : katakanaGuideMap;
  const currentGuideSrc = currentGuideMap[currentChar] ?? "";
  const hasPngGuide = Boolean(currentGuideSrc);
  const currentGifMap = tab === "hiragana" ? hiraganaGifMap : katakanaGifMap;
  const hasWritingAnimation = (item: KanaItem) => Boolean(currentGifMap[item.char]) || getStrokeSvgPaths(item.char, tab).length > 0;
  const baseGifCount = baseKanaItems.filter(hasWritingAnimation).length;
  const basePngCount = baseKanaItems.filter((item) => Boolean(currentGuideMap[item.char])).length;
  const dakuonGifCount = dakuonKanaItems.filter(hasWritingAnimation).length;
  const dakuonPngCount = dakuonKanaItems.filter((item) => Boolean(currentGuideMap[item.char])).length;
  const auditGifCount = auditItems.filter(hasWritingAnimation).length;
  const auditPngCount = auditItems.filter((item) => Boolean(currentGuideMap[item.char])).length;
  const canDrawOnCanvas = writingSubMode === "quiz" || writingGuideMode === "faint" || writingGuideMode === "blank" || writingGuideMode === "view";
  const kanaGuideTextStyle = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "13rem",
    fontWeight: 700,
    fontFamily: "inherit",
    lineHeight: 1,
    userSelect: "none" as const,
    WebkitUserSelect: "none" as const,
    pointerEvents: "none" as const,
  };
  const writingGuideMessage = writingGuideMode === "view"
    ? "글자가 써지는 모습을 보고, 옆 칸에 따라 써보세요."
    : writingGuideMode === "faint"
      ? "GIF 기준 글자 모양을 떠올리며 흐린 가이드 위에 써보세요."
      : "이제 기억해서 빈칸에 다시 써보세요.";


  const loadNextWritingQuizQuestion = useCallback(() => {
    setWritingQuizQuestion(getWritingQuizQuestion(data));
    setWritingQuizShowAnswer(false);
    setWritingQuizAnswered(false);
    setWritingFeedback(null);
    setWritingFeedbackError(null);
    setWritingFeedbackLoading(false);
    clearWritingCanvas();
  }, [clearWritingCanvas, data]);

  const resetWritingFeedback = useCallback(() => {
    setWritingFeedback(null);
    setWritingFeedbackError(null);
    setWritingFeedbackLoading(false);
  }, []);

  useEffect(() => {
    dataRef.current = data;
  }, [dataKey, data]);

  useEffect(() => {
    if (writingIndex >= data.length) {
      setWritingIndex(0);
    }
    if (data.length > 0) {
      setWritingQuizQuestion(getWritingQuizQuestion(data));
    }
    setSelected(null);
    setWritingQuizShowAnswer(false);
    setWritingQuizAnswered(false);
    resetWritingFeedback();
    clearWritingCanvas();
  }, [clearWritingCanvas, data, dataKey, resetWritingFeedback, writingIndex]);

  const quizResetKey = useMemo(
    () => `${tab}|${selectedGroupKey}`,
    [selectedGroupKey, tab]
  );

  useEffect(() => {
    const enteringQuiz = prevModeRef.current !== "quiz" && mode === "quiz";
    const changedWhileQuiz = mode === "quiz" && lastQuizResetKeyRef.current !== quizResetKey;
    if (!enteringQuiz && !changedWhileQuiz) {
      prevModeRef.current = mode;
      return;
    }

    const source = getQuizEligibleItems(dataRef.current);
    const fallback = getQuizEligibleItems(allData);
    if (source.length > 0 || fallback.length > 0) {
      setSelected(null);
      setQuiz(getQuizQuestion(source.length > 0 ? source : fallback));
    }
    lastQuizResetKeyRef.current = quizResetKey;
    prevModeRef.current = mode;
  }, [allData, mode, quizResetKey]);

  const getRandomWritingIndex = useCallback((currentIndex: number) => {
    if (data.length <= 1) return 0;
    let nextIndex = currentIndex;
    while (nextIndex === currentIndex) {
      nextIndex = Math.floor(Math.random() * data.length);
    }
    return nextIndex;
  }, [data.length]);

  const goToPrevWritingItem = useCallback(() => {
    if (data.length === 0) return;
    setWritingIndex((prev) => {
      if (writingOrderMode === "random") return getRandomWritingIndex(prev);
      return Math.max(0, prev - 1);
    });
    resetWritingFeedback();
    clearWritingCanvas();
  }, [clearWritingCanvas, data.length, getRandomWritingIndex, resetWritingFeedback, writingOrderMode]);

  const goToNextWritingItem = useCallback(() => {
    if (data.length === 0) return;
    setWritingIndex((prev) => {
      if (writingOrderMode === "random") return getRandomWritingIndex(prev);
      return Math.min(data.length - 1, prev + 1);
    });
    resetWritingFeedback();
    clearWritingCanvas();
  }, [clearWritingCanvas, data.length, getRandomWritingIndex, resetWritingFeedback, writingOrderMode]);

  const getFeedbackLines = (value: string[] | string | undefined) => {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
  };

  const requestHandwritingFeedback = useCallback(async () => {
    const canvas = writingCanvasRef.current;
    if (!canvas) {
      setWritingFeedbackError("피드백을 불러오지 못했어요");
      return;
    }

    setWritingFeedbackLoading(true);
    setWritingFeedbackError(null);
    setWritingFeedback(null);

    try {
      const imageDataUrl = canvas.toDataURL("image/png");
      const response = await fetch("/api/language/handwriting-feedback", {
        method: "POST",
        headers: await authenticatedJsonHeaders(),
        body: JSON.stringify({
          targetChar: writingQuizQuestion.char,
          romaji: writingQuizQuestion.roman,
          imageDataUrl,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to fetch handwriting feedback");
      }

      const result = (await response.json()) as HandwritingFeedback;
      setWritingFeedback(result);
    } catch (error) {
      console.error(error);
      setWritingFeedbackError("피드백을 불러오지 못했어요");
    } finally {
      setWritingFeedbackLoading(false);
    }
  }, [writingQuizQuestion]);

  const markWritingQuizResult = (result: "correct" | "wrong") => {
    if (writingQuizAnswered) return;
    setWritingQuizAnswered(true);
    setWritingQuizScore((prev) => ({
      correct: prev.correct + (result === "correct" ? 1 : 0),
      wrong: prev.wrong + (result === "wrong" ? 1 : 0),
      total: prev.total + 1,
    }));
  };

  const handleChoice = (choice: string) => {
    if (selected !== null) return;
    setSelected(choice);
    const isCorrect = choice === quiz.question.roman;
    setScore((prev) => {
      const nextTotal = prev.total + 1;
      if (nextTotal >= 5) {
        markTodayRoutineCompleted("kana");
      }
      return {
        correct: prev.correct + (isCorrect ? 1 : 0),
        total: nextTotal,
      };
    });
    if (!isCorrect) {
      saveWrongKana(quiz.question.char, quiz.question.roman, tab, "quiz");
      setWrongKanaChars((prev) => new Set(prev).add(quiz.question.char));
    }
  };

  const handleConfusingChoice = (choice: string) => {
    if (confusingSelected !== null) return;
    setConfusingSelected(choice);
    const isCorrect = choice === confusingQuiz.question.roman;
    setConfusingScore((prev) => ({
      correct: prev.correct + (isCorrect ? 1 : 0),
      total: prev.total + 1,
    }));
    if (!isCorrect) {
      const type = getKanaType(confusingQuiz.question.char);
      saveWrongKana(confusingQuiz.question.char, confusingQuiz.question.roman, type, "confusing");
    }
  };

  const loadNextConfusingQuestion = () => {
    setConfusingQuiz(getConfusingQuizQuestion());
    setConfusingSelected(null);
  };

  const handleAuditPractice = (item: KanaItem) => {
    const group = allKanaGroupByChar[item.char];
    if (group) setSelectedKanaGroupIds([group.id]);
    setMode("writing");
    setWritingSubMode("trace");
    setWritingGuideMode("view");
    const targetData = group ? allData.filter((kana) => group.chars.includes(kana.char)) : allData;
    const targetIndex = targetData.findIndex((kana) => kana.char === item.char);
    setWritingIndex(targetIndex >= 0 ? targetIndex : 0);
    resetWritingFeedback();
    clearWritingCanvas();
  };

  const getChoiceStyle = (choice: string): React.CSSProperties => {
    const base: React.CSSProperties = {
      padding: "0.75rem 1rem",
      borderRadius: "14px",
      border: "2px solid",
      cursor: selected !== null ? "not-allowed" : "pointer",
      fontSize: "1rem",
      fontWeight: "600",
      width: "100%",
      textAlign: "center",
      transition: "background 0.15s",
    };

    if (selected === null) {
      return { ...base, borderColor: "#d1d5db", background: "#f9fafb", color: "#374151" };
    }
    if (choice === quiz.question.roman) {
      return { ...base, borderColor: "#16a34a", background: "#dcfce7", color: "#15803d" };
    }
    if (choice === selected) {
      return { ...base, borderColor: "#dc2626", background: "#fee2e2", color: "#b91c1c" };
    }
    return { ...base, borderColor: "#d1d5db", background: "#f9fafb", color: "#9ca3af" };
  };

  const getConfusingChoiceStyle = (choice: string): React.CSSProperties => {
    const base: React.CSSProperties = {
      padding: "0.75rem 1.5rem",
      borderRadius: "14px",
      border: "2px solid",
      cursor: confusingSelected !== null ? "default" : "pointer",
      fontSize: "1.1rem",
      fontWeight: "600",
      flex: 1,
      textAlign: "center",
      transition: "background 0.15s",
    };

    if (confusingSelected === null) {
      return { ...base, borderColor: "#d1d5db", background: "#f9fafb", color: "#374151" };
    }
    if (choice === confusingQuiz.question.roman) {
      return { ...base, borderColor: "#16a34a", background: "#dcfce7", color: "#15803d" };
    }
    if (choice === confusingSelected) {
      return { ...base, borderColor: "#dc2626", background: "#fee2e2", color: "#b91c1c" };
    }
    return { ...base, borderColor: "#d1d5db", background: "#f9fafb", color: "#9ca3af" };
  };


  const modeBtnStyle = (m: string): React.CSSProperties => ({
    padding: "0.6rem 1rem",
    borderRadius: "999px",
    border: `1px solid ${mode === m ? "#60a5fa" : "#dbeafe"}`,
    cursor: "pointer",
    fontWeight: mode === m ? 700 : 600,
    background: mode === m ? "#eff6ff" : "#ffffff",
    color: mode === m ? "#1d4ed8" : "#475569",
    boxShadow: mode === m ? "0 4px 12px rgba(59,130,246,0.18)" : "0 1px 3px rgba(15,23,42,0.06)",
    fontSize: "0.86rem",
    whiteSpace: "nowrap",
  });

  return (
    <>
    <div style={{ padding: "1.25rem 0 2.25rem", maxWidth: "72rem", margin: "0 auto" }}>
      <div style={{ marginBottom: "1rem", border: "1px solid #dbeafe", background: "linear-gradient(180deg, #f8fbff 0%, #ffffff 100%)", borderRadius: "16px", padding: "1rem 1.1rem", boxShadow: "0 8px 24px rgba(59,130,246,0.08)" }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: "bold", marginBottom: "0.35rem", color: "#1e3a8a" }}>
          히라가나 / 가타카나 훈련
        </h1>
        <p style={{ fontSize: "0.95rem", color: "#475569", lineHeight: 1.5 }}>
          히라가나와 가타카나를 단계별로 익혀보세요. 모드와 그룹을 골라 학습, 퀴즈, 쓰기 연습까지 이어서 진행할 수 있어요.
        </p>
      </div>

      {/* 탭 */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", padding: "0.35rem", border: "1px solid #dbeafe", borderRadius: "999px", background: "#f8fbff", width: "fit-content" }}>
        <button
          onClick={() => handleTabChange("hiragana")}
          style={{
            padding: "0.5rem 1.25rem",
            borderRadius: "999px",
            border: `1px solid ${tab === "hiragana" ? "#60a5fa" : "transparent"}`,
            cursor: "pointer",
            fontWeight: tab === "hiragana" ? "bold" : "normal",
            background: tab === "hiragana" ? "#3b82f6" : "transparent",
            color: tab === "hiragana" ? "#fff" : "#475569",
          }}
        >
          히라가나
        </button>
        <button
          onClick={() => handleTabChange("katakana")}
          style={{
            padding: "0.5rem 1.25rem",
            borderRadius: "999px",
            border: `1px solid ${tab === "katakana" ? "#60a5fa" : "transparent"}`,
            cursor: "pointer",
            fontWeight: tab === "katakana" ? "bold" : "normal",
            background: tab === "katakana" ? "#3b82f6" : "transparent",
            color: tab === "katakana" ? "#fff" : "#475569",
          }}
        >
          가타카나
        </button>
      </div>


      <div style={{ marginBottom: "1rem", border: "1px solid #e5e7eb", borderRadius: "10px", padding: "0.9rem", background: "#f8fafc" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "0.75rem" }}>가나 기초 설명</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "0.5rem" }}>
          {kanaConcepts.map((concept) => {
            const opened = openConcept === concept.title;
            return (
              <button key={concept.title} onClick={() => setOpenConcept(opened ? null : concept.title)} style={{ textAlign: "left", border: "1px solid #d1d5db", borderRadius: "14px", padding: "0.6rem", background: "#fff", cursor: "pointer" }}>
                <div style={{ fontWeight: 700, color: "#1f2937" }}>{concept.title}</div>
                <div style={{ fontSize: "0.85rem", color: "#6b7280", marginTop: "0.2rem" }}>{concept.summary}</div>
                {opened && <div style={{ marginTop: "0.45rem", fontSize: "0.85rem", color: "#374151", lineHeight: 1.5 }}>{concept.detail}</div>}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ marginBottom: "1.25rem", border: "1px solid #dbeafe", borderRadius: "14px", background: "#ffffff", padding: "0.95rem", boxShadow: "0 4px 14px rgba(15,23,42,0.05)" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "0.6rem" }}>단계별 그룹 선택</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.55rem" }}>
          <button onClick={() => toggleKanaGroup("all")} style={{ textAlign: "left", border: selectedGroupSet.has("all") ? "1px solid #60a5fa" : "1px solid #dbeafe", borderRadius: "12px", padding: "0.75rem", background: selectedGroupSet.has("all") ? "#eff6ff" : "#fff", boxShadow: selectedGroupSet.has("all") ? "0 6px 14px rgba(59,130,246,0.12)" : "0 1px 3px rgba(15,23,42,0.05)", cursor: "pointer" }}>
            <div style={{ fontWeight: 700 }}>전체</div><div style={{ fontSize: "0.8rem", color: "#6b7280" }}>{allData.length}글자</div>
          </button>
          {availableGroups.map((group) => {
            const active = selectedGroupSet.has(group.id) && !selectedGroupSet.has("all");
            const hasWrong = group.matchedChars.some((char) => wrongKanaChars.has(char));
            const preview = group.matchedChars.slice(0, 6).join(" ");
            return <button key={group.id} onClick={() => toggleKanaGroup(group.id)} style={{ textAlign: "left", border: active ? "1px solid #60a5fa" : "1px solid #dbeafe", borderRadius: "12px", padding: "0.75rem", background: active ? "#eff6ff" : "#fff", boxShadow: active ? "0 6px 14px rgba(59,130,246,0.12)" : "0 1px 3px rgba(15,23,42,0.05)", cursor: "pointer" }}>
              <div style={{ fontWeight: 700 }}>{group.label}</div>
              <div style={{ fontSize: "0.82rem", color: "#374151", marginTop: "0.15rem", minHeight: "1rem" }}>{preview || "준비 중"}</div>
              <div style={{ fontSize: "0.78rem", color: "#6b7280", marginTop: "0.2rem" }}>{group.matchedChars.length}글자 · {hasWrong ? "헷갈림 있음" : "헷갈림 없음"}</div>
              {group.note && group.matchedChars.length === 0 && <div style={{ fontSize: "0.75rem", color: "#9a3412", marginTop: "0.2rem" }}>{group.note}</div>}
            </button>
          })}
        </div>
        <div style={{ marginTop: "0.65rem", fontSize: "0.88rem", color: "#4b5563" }}>
          선택됨: {selectedGroupLabels.join(", ")}<br />
          학습 대상: {data.length}글자
        </div>
      </div>

      {/* 모드 전환 */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.25rem", flexWrap: "wrap", padding: "0.55rem", border: "1px solid #dbeafe", borderRadius: "14px", background: "#f8fbff" }}>
        <button onClick={() => handleModeChange("learn")} style={modeBtnStyle("learn")}>
          학습 모드
        </button>
        <button onClick={() => handleModeChange("quiz")} style={modeBtnStyle("quiz")}>
          퀴즈 모드
        </button>
        <button onClick={() => handleModeChange("confusing")} style={modeBtnStyle("confusing")}>
          헷갈리는 글자
        </button>
        <button onClick={() => handleModeChange("writing")} style={modeBtnStyle("writing")}>
          쓰기 연습
        </button>
        <button onClick={() => handleModeChange("audit")} style={modeBtnStyle("audit")}>
          검수표
        </button>
      </div>

      {/* 학습 모드 */}
      {mode === "learn" && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
            gap: "0.75rem",
          }}
        >
          {data.map((item) => {
            const isPlaying = playingChar === item.char;
            return (
              <div
                key={`${item.kind ?? "kana"}-${item.char}-${item.roman}`}
                onClick={() => handleSpeak(item.char)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "1rem 0.5rem",
                  borderRadius: "14px",
                  border: `1px solid ${isPlaying ? "#60a5fa" : "#dbeafe"}`,
                  background: isPlaying ? "#eff6ff" : "#ffffff",
                  cursor: "pointer",
                  userSelect: "none",
                  WebkitUserSelect: "none",
                  transition: "background 0.15s, border-color 0.15s",
                  position: "relative",
                }}
              >
                <span style={{ fontSize: "2rem", lineHeight: 1 }}>{item.char}</span>
                  <span style={{ fontSize: "0.75rem", color: isPlaying ? "#6366f1" : "#6b7280", marginTop: "0.4rem", fontWeight: isPlaying ? "700" : "400" }}>
                  {isPlaying ? "재생 중..." : item.roman}
                </span>
                {item.note && <span style={{ fontSize: "0.65rem", color: "#4b5563", marginTop: "0.2rem", textAlign: "center" }}>{item.note}</span>}
                {item.examples?.[0] && <span style={{ fontSize: "0.63rem", color: "#6b7280", marginTop: "0.15rem" }}>예: {item.examples[0].word} ({item.examples[0].roman})</span>}
                <span style={{ fontSize: "0.68rem", color: "#9ca3af", marginTop: "0.2rem" }}>
                  {allKanaGroupByChar[item.char]?.label ?? "-"}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* 퀴즈 모드 */}
      {mode === "quiz" && (
        <div style={{ maxWidth: "400px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "1.5rem",
              padding: "0.75rem 1rem",
              borderRadius: "14px",
              background: "#f3f4f6",
            }}
          >
            <span style={{ fontSize: "0.875rem", color: "#6b7280" }}>점수</span>
            <span style={{ fontWeight: "bold", color: "#1f2937" }}>
              {score.correct} / {score.total}
              {score.total > 0 && (
                <span style={{ marginLeft: "0.5rem", color: "#6b7280", fontWeight: "normal", fontSize: "0.875rem" }}>
                  ({Math.round((score.correct / score.total) * 100)}%)
                </span>
              )}
            </span>
          </div>


          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "100%",
              height: "140px",
              borderRadius: "12px",
              border: "2px solid #e5e7eb",
              background: "#fff",
              marginBottom: "1.5rem",
            }}
          >
            <span style={{ fontSize: "5rem", lineHeight: 1 }}>{quiz.question.char}</span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "1.25rem" }}>
            {quiz.choices.map((choice) => (
              <button
                key={choice}
                onClick={() => handleChoice(choice)}
                disabled={selected !== null}
                style={getChoiceStyle(choice)}
              >
                {choice}
              </button>
            ))}
          </div>

                    {selected !== null && (
            <div
              style={{
                padding: "0.75rem 1rem",
                borderRadius: "14px",
                marginBottom: "1rem",
                textAlign: "center",
                fontWeight: "600",
                fontSize: "0.95rem",
                border: `1px solid ${selected === quiz.question.roman ? "#86efac" : "#fca5a5"}`,
                background: selected === quiz.question.roman ? "#dcfce7" : "#fee2e2",
                color: selected === quiz.question.roman ? "#15803d" : "#b91c1c",
                wordBreak: "keep-all",
                overflowWrap: "anywhere",
              }}
            >
              {selected === quiz.question.roman
                ? `정답이에요! ${quiz.question.char} = ${quiz.question.roman}`
                : `아쉬워요. ${quiz.question.char}의 정답은 ${quiz.question.roman} 입니다.`}
            </div>
          )}

          {selected !== null && (
            <button
              onClick={() => loadNextQuestion(data)}
              style={{
                width: "100%",
                padding: "0.75rem",
                borderRadius: "14px",
                border: "none",
                cursor: "pointer",
                background: "#3b82f6",
                color: "#fff",
                fontWeight: "bold",
                fontSize: "1rem",
              }}
            >
              다음 문제 →
            </button>
          )}
        </div>
      )}

      {mode === "audit" && (
        <div>
          <div style={{ marginBottom: "1rem", border: "1px solid #e5e7eb", borderRadius: "10px", padding: "0.9rem", background: "#f8fafc" }}>
            <h3 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "0.55rem" }}>{tab === "hiragana" ? "히라가나" : "가타카나"} 검수표</h3>
            <div style={{ display: "flex", gap: "0.45rem", flexWrap: "wrap", marginBottom: "0.6rem" }}>
              <button onClick={() => setAuditScope("base")} style={{ padding: "0.35rem 0.7rem", borderRadius: "999px", border: auditScope === "base" ? "2px solid #6366f1" : "1px solid #d1d5db", background: auditScope === "base" ? "#eef2ff" : "#fff", color: auditScope === "base" ? "#4338ca" : "#374151", fontWeight: 700, cursor: "pointer" }}>기본 46자</button>
              <button onClick={() => setAuditScope("dakuon")} style={{ padding: "0.35rem 0.7rem", borderRadius: "999px", border: auditScope === "dakuon" ? "2px solid #6366f1" : "1px solid #d1d5db", background: auditScope === "dakuon" ? "#eef2ff" : "#fff", color: auditScope === "dakuon" ? "#4338ca" : "#374151", fontWeight: 700, cursor: "pointer" }}>탁음/반탁음</button>
              <button onClick={() => setAuditScope("youon")} style={{ padding: "0.35rem 0.7rem", borderRadius: "999px", border: auditScope === "youon" ? "2px solid #6366f1" : "1px solid #d1d5db", background: auditScope === "youon" ? "#eef2ff" : "#fff", color: auditScope === "youon" ? "#4338ca" : "#374151", fontWeight: 700, cursor: "pointer" }}>요음</button>
              <button onClick={() => setAuditScope("special")} style={{ padding: "0.35rem 0.7rem", borderRadius: "999px", border: auditScope === "special" ? "2px solid #6366f1" : "1px solid #d1d5db", background: auditScope === "special" ? "#eef2ff" : "#fff", color: auditScope === "special" ? "#4338ca" : "#374151", fontWeight: 700, cursor: "pointer" }}>특수 발음</button>
              <button onClick={() => setAuditScope("all")} style={{ padding: "0.35rem 0.7rem", borderRadius: "999px", border: auditScope === "all" ? "2px solid #6366f1" : "1px solid #d1d5db", background: auditScope === "all" ? "#eef2ff" : "#fff", color: auditScope === "all" ? "#4338ca" : "#374151", fontWeight: 700, cursor: "pointer" }}>전체</button>
            </div>
            <div style={{ fontSize: "0.86rem", color: "#374151" }}>기본 46자 획순 애니메이션/PNG: {baseGifCount}/{baseKanaItems.length} · {basePngCount}/{baseKanaItems.length}</div>
            <div style={{ fontSize: "0.86rem", color: "#374151" }}>탁음/반탁음 획순 애니메이션/PNG: {dakuonGifCount}/{dakuonKanaItems.length} · {dakuonPngCount}/{dakuonKanaItems.length}</div>
            <div style={{ fontSize: "0.86rem", color: "#374151" }}>현재 범위 획순 애니메이션/PNG: {auditGifCount}/{auditItems.length} · {auditPngCount}/{auditItems.length}</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.75rem" }}>
            {auditItems.map((item) => {
              const group = allKanaGroupByChar[item.char];
              const hasGif = hasWritingAnimation(item);
              const hasGuide = Boolean(currentGuideMap[item.char]);
              return (
                <div key={`${item.kind ?? "kana"}-${item.char}-${item.roman}`} style={{ border: "1px solid #e5e7eb", borderRadius: "10px", background: "#fff", padding: "0.75rem", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                  <div style={{ fontSize: "2.1rem", fontWeight: 700, lineHeight: 1, color: "#111827" }}>{item.char}</div>
                  <div style={{ fontSize: "0.85rem", color: "#374151" }}>발음: <strong>{item.roman}</strong></div>
                  <div style={{ fontSize: "0.8rem", color: "#6b7280" }}>그룹: {group?.label ?? "준비 중"}</div>
                  <div style={{ fontSize: "0.8rem", color: hasGif ? "#166534" : "#b91c1c" }}>획순 영상: {hasGif ? "있음" : "없음"}</div>
                  <div style={{ fontSize: "0.8rem", color: hasGuide ? "#166534" : "#b91c1c" }}>PNG: {hasGuide ? "있음" : "없음"}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", marginTop: "0.35rem" }}>
                    <button onClick={() => handleSpeak(item.char)} style={{ padding: "0.4rem 0.5rem", borderRadius: "7px", border: "1px solid #d1d5db", background: "#fff", cursor: "pointer", fontSize: "0.8rem", fontWeight: 600 }}>
                      🔊 발음 듣기
                    </button>
                    <button onClick={() => handleAuditPractice(item)} style={{ padding: "0.45rem 0.5rem", borderRadius: "7px", border: "none", background: "#7c3aed", color: "#fff", cursor: "pointer", fontSize: "0.8rem", fontWeight: 700 }}>
                      이 글자 연습
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 쓰기 연습 모드 */}
      {mode === "writing" && currentWritingItem && (
        <div
          style={{
            maxWidth: "720px",
            borderRadius: "14px",
            border: "1px solid #e5e7eb",
            background: "#fff",
            padding: "1rem",
            boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
          }}
        >
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.9rem" }}>
            <button
              onClick={() => {
                setWritingSubMode("trace");
                setWritingQuizShowAnswer(false);
                resetWritingFeedback();
                clearWritingCanvas();
              }}
              style={{
                padding: "0.4rem 1rem",
                borderRadius: "6px",
                border: "2px solid",
                cursor: "pointer",
                fontWeight: writingSubMode === "trace" ? "bold" : "normal",
                borderColor: writingSubMode === "trace" ? "#8b5cf6" : "#d1d5db",
                background: writingSubMode === "trace" ? "#ede9fe" : "#fff",
                color: writingSubMode === "trace" ? "#7c3aed" : "#6b7280",
                fontSize: "0.875rem",
              }}
            >
              쓰기 보기
            </button>
            <button
              onClick={() => {
                setWritingSubMode("quiz");
                setWritingQuizQuestion(getWritingQuizQuestion(data));
                setWritingQuizShowAnswer(false);
                setWritingQuizAnswered(false);
                resetWritingFeedback();
                clearWritingCanvas();
              }}
              style={{
                padding: "0.4rem 1rem",
                borderRadius: "6px",
                border: "2px solid",
                cursor: "pointer",
                fontWeight: writingSubMode === "quiz" ? "bold" : "normal",
                borderColor: writingSubMode === "quiz" ? "#8b5cf6" : "#d1d5db",
                background: writingSubMode === "quiz" ? "#ede9fe" : "#fff",
                color: writingSubMode === "quiz" ? "#7c3aed" : "#6b7280",
                fontSize: "0.875rem",
              }}
            >
              쓰기 퀴즈
            </button>
            <div style={{ marginLeft: "auto", display: "flex", gap: "0.4rem" }}>
              <button
                onClick={() => {
                  setWritingOrderMode("sequence");
                  resetWritingFeedback();
                  clearWritingCanvas();
                }}
                style={{
                  padding: "0.4rem 0.9rem",
                  borderRadius: "6px",
                  border: "2px solid",
                  cursor: "pointer",
                  fontWeight: writingOrderMode === "sequence" ? "bold" : "normal",
                  borderColor: writingOrderMode === "sequence" ? "#8b5cf6" : "#d1d5db",
                  background: writingOrderMode === "sequence" ? "#ede9fe" : "#fff",
                  color: writingOrderMode === "sequence" ? "#7c3aed" : "#6b7280",
                  fontSize: "0.875rem",
                }}
              >
                순서
              </button>
              <button
                onClick={() => {
                  setWritingOrderMode("random");
                  resetWritingFeedback();
                  clearWritingCanvas();
                }}
                style={{
                  padding: "0.4rem 0.9rem",
                  borderRadius: "6px",
                  border: "2px solid",
                  cursor: "pointer",
                  fontWeight: writingOrderMode === "random" ? "bold" : "normal",
                  borderColor: writingOrderMode === "random" ? "#8b5cf6" : "#d1d5db",
                  background: writingOrderMode === "random" ? "#ede9fe" : "#fff",
                  color: writingOrderMode === "random" ? "#7c3aed" : "#6b7280",
                  fontSize: "0.875rem",
                }}
              >
                랜덤
              </button>
            </div>
          </div>


          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "0.75rem",
              marginBottom: "0.8rem",
            }}
          >
            {writingSubMode === "trace" ? (
              <strong style={{ fontSize: "1.1rem", color: "#111827" }}>
                {writingIndex + 1} / {data.length} · {currentWritingItem.char}
              </strong>
            ) : (
              <strong style={{ fontSize: "1.1rem", color: "#111827" }}>
                쓰기 퀴즈 · 문제: <span style={{ color: "#7c3aed" }}>{writingQuizQuestion.roman}</span>
              </strong>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: "0.55rem" }}>
              <span style={{ fontSize: "0.98rem", color: "#4b5563" }}>
                발음: <strong>{writingSubMode === "trace" ? currentWritingItem.roman : writingQuizQuestion.roman}</strong>
              </span>
              <button
                onClick={() => handleSpeak(writingSubMode === "trace" ? currentWritingItem.char : writingQuizQuestion.char)}
                style={{
                  padding: "0.45rem 0.7rem",
                  borderRadius: "14px",
                  border: "1px solid #d1d5db",
                  background: "#fff",
                  cursor: "pointer",
                  color: "#374151",
                  fontWeight: 600,
                }}
              >
                🔊 발음 듣기
              </button>
            </div>
          </div>

          {writingSubMode === "trace" && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.45rem", marginBottom: "0.75rem" }}>
                {([
                { id: "view", label: "쓰기 보기" },
                                { id: "faint", label: "흐린 글자" },
                { id: "blank", label: "빈칸 쓰기" },
              ] as const).map((modeBtn) => {
                const active = writingGuideMode === modeBtn.id;
                return (
                  <button
                    key={modeBtn.id}
                    onClick={() => {
                      setWritingGuideMode(modeBtn.id);
                    }}
                    style={{
                      padding: "0.4rem 0.85rem",
                      borderRadius: "999px",
                      border: active ? "2px solid #7c3aed" : "1px solid #d1d5db",
                      background: active ? "#ede9fe" : "#fff",
                      color: active ? "#6d28d9" : "#4b5563",
                      fontWeight: active ? 700 : 500,
                      cursor: "pointer",
                      fontSize: "0.84rem",
                    }}
                  >
                    {modeBtn.label}
                  </button>
                );
              })}
            </div>
          )}

          {writingSubMode === "trace" && (
            <div style={{ marginBottom: "0.75rem", fontSize: "0.88rem", color: "#4b5563" }}>{writingGuideMessage}</div>
          )}
          {writingSubMode === "trace" && writingGuideMode === "view" ? (
            <div className="kana-writing-grid" style={{ marginBottom: "0.95rem", width: "100%" }}>
              <section style={{ borderRadius: "12px", border: "1px solid #d1d5db", background: "#fff", padding: "0.75rem" }}>
                <h3 style={{ marginBottom: "0.5rem", fontSize: "0.9rem", color: "#374151", fontWeight: 700 }}>쓰기 순서 보기</h3>
                <div style={{ height: "340px", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "10px", background: "#f8fafc", padding: "0.5rem" }}>
                  <KanaStrokeAnimation key={`${tab}-${currentChar}`} char={currentChar} tab={tab} />
                </div>
              </section>
              <section style={{ borderRadius: "12px", border: "1px solid #d1d5db", background: "#fff", padding: "0.75rem" }}>
                <h3 style={{ marginBottom: "0.35rem", fontSize: "0.9rem", color: "#374151", fontWeight: 700 }}>따라 써보기</h3>
                <div style={{ marginBottom: "0.5rem", fontSize: "0.82rem", color: "#4b5563" }}>획순 애니메이션의 글자 모양을 보며 직접 써보세요.</div>
                <div ref={writingAreaRef} style={{ width: "100%", height: "340px", borderRadius: "10px", border: "1px solid #e5e7eb", background: "#fff", position: "relative", overflow: "hidden" }}>
                  {hasPngGuide ? (
                    <img src={currentGuideSrc} alt={`${currentChar} 따라쓰기 PNG 가이드`} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", opacity: 0.2, pointerEvents: "none", zIndex: 1 }} />
                  ) : (
                    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none", zIndex: 1 }}>
                      <span style={{ fontSize: "140px", fontWeight: 700, color: "#d1d5db", opacity: 0.28, lineHeight: 1 }}>{currentChar}</span>
                    </div>
                  )}
                  <canvas ref={writingCanvasRef} onPointerDown={startDrawing} onPointerMove={drawMove} onPointerUp={endDrawing} onPointerCancel={endDrawing} onPointerLeave={endDrawing} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", touchAction: "none", zIndex: 4, cursor: "crosshair" }} />
                </div>
              </section>
            </div>
          ) : (
          <div
            ref={writingAreaRef}
            style={{
              width: "100%",
              height: "420px",
              borderRadius: "12px",
              border: "1px solid #d1d5db",
              background: "#fff",
              position: "relative",
              overflow: "hidden",
              marginBottom: "0.95rem",
            }}
          >
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: "50%",
                borderTop: "2px solid #eef1f5",
                transform: "translateY(-1px)",
                pointerEvents: "none",
              }}
            />
            <div
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: "50%",
                borderLeft: "2px solid #eef1f5",
                transform: "translateX(-1px)",
                pointerEvents: "none",
              }}
            />
            {writingSubMode === "trace" && writingGuideMode === "faint" && (
              (hasPngGuide ? <img src={currentGuideSrc} alt={`${currentChar} 흐린 PNG 가이드`} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", opacity: 0.2, pointerEvents: "none", zIndex: 1 }} /> : <div
                style={{
                  position: "absolute",
                  inset: 0,
                  zIndex: 1,
                  color: "rgba(107, 114, 128, 0.22)",
                  ...kanaGuideTextStyle,
                }}
              >
                {currentWritingItem.char}
              </div>)
            )}
            
            {canDrawOnCanvas && (
            <canvas
              ref={writingCanvasRef}
              onPointerDown={(e) => {
                e.preventDefault();
                startDrawing(e);
              }}
              onPointerMove={(e) => {
                drawMove(e);
              }}
              onPointerUp={endDrawing}
              onPointerCancel={endDrawing}
              onPointerLeave={endDrawing}
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                touchAction: "none",
                zIndex: 4,
                cursor: "crosshair",
              }}
            />
            )}
          </div>
          )}
          {writingSubMode === "trace" ? (
            <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
              <button
                onClick={goToPrevWritingItem}
                disabled={writingOrderMode === "sequence" && writingIndex === 0}
                style={{
                  padding: "0.65rem 0.9rem",
                  borderRadius: "14px",
                  border: "1px solid #d1d5db",
                  cursor: writingOrderMode === "sequence" && writingIndex === 0 ? "not-allowed" : "pointer",
                  background: writingOrderMode === "sequence" && writingIndex === 0 ? "#f3f4f6" : "#fff",
                  color: writingOrderMode === "sequence" && writingIndex === 0 ? "#9ca3af" : "#374151",
                  fontWeight: 600,
                }}
              >
                이전 글자
              </button>
              <button
                onClick={goToNextWritingItem}
                disabled={writingOrderMode === "sequence" && writingIndex === data.length - 1}
                style={{
                  padding: "0.65rem 0.9rem",
                  borderRadius: "14px",
                  border: "1px solid #d1d5db",
                  cursor: writingOrderMode === "sequence" && writingIndex === data.length - 1 ? "not-allowed" : "pointer",
                  background: writingOrderMode === "sequence" && writingIndex === data.length - 1 ? "#f3f4f6" : "#fff",
                  color: writingOrderMode === "sequence" && writingIndex === data.length - 1 ? "#9ca3af" : "#374151",
                  fontWeight: 600,
                }}
              >
                다음 글자
              </button>
              {canDrawOnCanvas && (
                <button
                  onClick={clearWritingCanvas}
                  style={{
                    padding: "0.65rem 0.9rem",
                    borderRadius: "14px",
                    border: "1px solid #d1d5db",
                    cursor: "pointer",
                    background: "#fff",
                    color: "#374151",
                    fontWeight: 600,
                  }}
                >
                  지우기
                </button>
              )}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.8rem" }}>
              <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
                <button
                  onClick={() => {
                    clearWritingCanvas();
                    resetWritingFeedback();
                  }}
                  style={{
                    padding: "0.65rem 0.9rem",
                    borderRadius: "14px",
                    border: "1px solid #d1d5db",
                    cursor: "pointer",
                    background: "#fff",
                    color: "#374151",
                    fontWeight: 600,
                  }}
                >
                  지우기
                </button>
                <button
                  onClick={requestHandwritingFeedback}
                  disabled={writingFeedbackLoading}
                  style={{
                    padding: "0.65rem 0.9rem",
                    borderRadius: "14px",
                    border: "1px solid #8b5cf6",
                    cursor: writingFeedbackLoading ? "not-allowed" : "pointer",
                    background: writingFeedbackLoading ? "#f3f4f6" : "#ede9fe",
                    color: writingFeedbackLoading ? "#9ca3af" : "#6d28d9",
                    fontWeight: 700,
                  }}
                >
                  AI 피드백 받기
                </button>
                <button
                  onClick={() => setWritingQuizShowAnswer(true)}
                  style={{
                    padding: "0.65rem 0.9rem",
                    borderRadius: "14px",
                    border: "1px solid #d1d5db",
                    cursor: "pointer",
                    background: "#fff",
                    color: "#374151",
                    fontWeight: 600,
                  }}
                >
                  정답 보기
                </button>
                <button
                  onClick={() => markWritingQuizResult("correct")}
                  disabled={writingQuizAnswered}
                  style={{
                    padding: "0.65rem 0.9rem",
                    borderRadius: "14px",
                    border: "1px solid #16a34a",
                    cursor: writingQuizAnswered ? "not-allowed" : "pointer",
                    background: writingQuizAnswered ? "#f3f4f6" : "#dcfce7",
                    color: writingQuizAnswered ? "#9ca3af" : "#166534",
                    fontWeight: 700,
                  }}
                >
                  맞았음
                </button>
                <button
                  onClick={() => markWritingQuizResult("wrong")}
                  disabled={writingQuizAnswered}
                  style={{
                    padding: "0.65rem 0.9rem",
                    borderRadius: "14px",
                    border: "1px solid #dc2626",
                    cursor: writingQuizAnswered ? "not-allowed" : "pointer",
                    background: writingQuizAnswered ? "#f3f4f6" : "#fee2e2",
                    color: writingQuizAnswered ? "#9ca3af" : "#991b1b",
                    fontWeight: 700,
                  }}
                >
                  틀렸음
                </button>
                <button
                  onClick={loadNextWritingQuizQuestion}
                  style={{
                    padding: "0.65rem 0.9rem",
                    borderRadius: "14px",
                    border: "none",
                    cursor: "pointer",
                    background: "#3b82f6",
                    color: "#fff",
                    fontWeight: 700,
                  }}
                >
                  다음 문제 →
                </button>
              </div>
              {writingFeedbackLoading && (
                <div
                  style={{
                    borderRadius: "10px",
                    border: "1px solid #ddd6fe",
                    background: "#f5f3ff",
                    padding: "0.8rem",
                    color: "#6d28d9",
                    fontWeight: 600,
                  }}
                >
                  AI가 글씨를 확인하는 중...
                </div>
              )}
              {writingFeedbackError && (
                <div
                  style={{
                    borderRadius: "10px",
                    border: "1px solid #fecaca",
                    background: "#fef2f2",
                    padding: "0.8rem",
                    color: "#b91c1c",
                    fontWeight: 600,
                  }}
                >
                  {writingFeedbackError}
                </div>
              )}
              {writingFeedback && (
                <div
                  style={{
                    borderRadius: "10px",
                    border: "1px solid #ddd6fe",
                    background: "#faf5ff",
                    padding: "0.85rem",
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.5rem",
                  }}
                >
                  <div style={{ fontWeight: 800, color: "#5b21b6" }}>AI 필기 피드백 (보조 설명)</div>
                  <div style={{ color: "#1f2937", fontSize: "0.93rem", lineHeight: 1.5 }}>
                    <strong>요약:</strong> {writingFeedback.summary}
                  </div>
                  <div style={{ color: "#1f2937", fontSize: "0.93rem", lineHeight: 1.5 }}>
                    <strong>잘한 점:</strong>
                    <ul style={{ margin: "0.25rem 0 0 1.1rem", padding: 0 }}>
                      {getFeedbackLines(writingFeedback.goodPoints).map((line, idx) => (
                        <li key={`good-${idx}`}>{line}</li>
                      ))}
                    </ul>
                  </div>
                  <div style={{ color: "#1f2937", fontSize: "0.93rem", lineHeight: 1.5 }}>
                    <strong>조언:</strong>
                    <ul style={{ margin: "0.25rem 0 0 1.1rem", padding: 0 }}>
                      {getFeedbackLines(writingFeedback.advice).map((line, idx) => (
                        <li key={`advice-${idx}`}>{line}</li>
                      ))}
                    </ul>
                  </div>
                  <div style={{ color: "#1f2937", fontSize: "0.93rem", lineHeight: 1.5 }}>
                    <strong>예시 팁:</strong> {writingFeedback.exampleTip}
                  </div>
                </div>
              )}
              {writingQuizShowAnswer && (
                <div
                  style={{
                    borderRadius: "10px",
                    border: "1px solid #ddd6fe",
                    background: "#f5f3ff",
                    padding: "0.8rem",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "1rem",
                  }}
                >
                  <span style={{ color: "#5b21b6", fontWeight: 700 }}>정답</span>
                  <span style={{ fontSize: "3.5rem", lineHeight: 1, color: "#111827", fontWeight: 700 }}>
                    {writingQuizQuestion.char}
                  </span>
                  <span style={{ color: "#6b7280", fontSize: "0.95rem" }}>{writingQuizQuestion.roman}</span>
                </div>
              )}
              <div
                style={{
                  borderRadius: "10px",
                  border: "1px solid #e5e7eb",
                  background: "#f9fafb",
                  padding: "0.65rem 0.8rem",
                  color: "#1f2937",
                  fontSize: "0.95rem",
                  display: "flex",
                  gap: "0.8rem",
                  flexWrap: "wrap",
                }}
              >
                <span><strong>맞음:</strong> {writingQuizScore.correct}</span>
                <span><strong>틀림:</strong> {writingQuizScore.wrong}</span>
                <span><strong>총 시도:</strong> {writingQuizScore.total}</span>
              </div>
            </div>
          )}

          {writingSubMode === "trace" && (
            <div
              style={{
                marginTop: "0.9rem",
                borderRadius: "10px",
                border: "1px solid #e5e7eb",
                background: "#f9fafb",
                padding: "0.8rem 0.85rem",
              }}
            >
              <div style={{ fontWeight: 700, color: "#1f2937", fontSize: "0.95rem", marginBottom: "0.45rem" }}>
                쓰기 팁
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem" }}>
                <div style={{ fontSize: "0.76rem", color: "#374151", lineHeight: 1.45 }}>
                  {currentWritingTip}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 헷갈리는 글자 모드 */}
      {mode === "confusing" && (
        <div>
          {/* 서브 탭: 카드 보기 / 비교 퀴즈 */}
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.25rem", flexWrap: "wrap", padding: "0.55rem", border: "1px solid #dbeafe", borderRadius: "14px", background: "#f8fbff" }}>
            <button
              onClick={() => { setConfusingView("cards"); }}
              style={{
                padding: "0.4rem 1rem",
                borderRadius: "6px",
                border: "2px solid",
                cursor: "pointer",
                fontWeight: confusingView === "cards" ? "bold" : "normal",
                borderColor: confusingView === "cards" ? "#f59e0b" : "#d1d5db",
                background: confusingView === "cards" ? "#fef3c7" : "#fff",
                color: confusingView === "cards" ? "#b45309" : "#6b7280",
                fontSize: "0.875rem",
              }}
            >
              글자 비교
            </button>
            <button
              onClick={() => {
                setConfusingView("quiz");
                setConfusingSelected(null);
                setConfusingScore({ correct: 0, total: 0 });
                setConfusingQuiz(getConfusingQuizQuestion());
              }}
              style={{
                padding: "0.4rem 1rem",
                borderRadius: "6px",
                border: "2px solid",
                cursor: "pointer",
                fontWeight: confusingView === "quiz" ? "bold" : "normal",
                borderColor: confusingView === "quiz" ? "#f59e0b" : "#d1d5db",
                background: confusingView === "quiz" ? "#fef3c7" : "#fff",
                color: confusingView === "quiz" ? "#b45309" : "#6b7280",
                fontSize: "0.875rem",
              }}
            >
              비교 퀴즈
            </button>
          </div>

          {/* 글자 비교 카드 */}
          {confusingView === "cards" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
              {confusingPairs.map((pair, i) => (
                <div
                  key={i}
                  style={{
                    borderRadius: "12px",
                    border: "1px solid #e5e7eb",
                    background: "#fff",
                    overflow: "hidden",
                    boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
                  }}
                >
                  {/* 글자 쌍 */}
                  <div style={{ display: "flex", borderBottom: "1px solid #f3f4f6" }}>
                    {[pair.a, pair.b].map((item, j) => {
                      const isPlaying = playingChar === item.char;
                      return (
                        <div
                          key={j}
                          onClick={() => handleSpeak(item.char)}
                          style={{
                            flex: 1,
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            justifyContent: "center",
                            padding: "1.5rem 1rem",
                            background: isPlaying
                              ? (j === 0 ? "#ede9fe" : "#fef3c7")
                              : (j === 0 ? "#faf5ff" : "#fff7ed"),
                            borderRight: j === 0 ? "1px solid #f3f4f6" : undefined,
                            cursor: "pointer",
                            userSelect: "none",
                            WebkitUserSelect: "none",
                            transition: "background 0.15s",
                          }}
                        >
                          <span style={{ fontSize: "3.5rem", lineHeight: 1 }}>{item.char}</span>
                          <span
                            style={{
                              marginTop: "0.5rem",
                              fontSize: "0.85rem",
                              fontWeight: "700",
                              color: isPlaying
                                ? (j === 0 ? "#6366f1" : "#b45309")
                                : (j === 0 ? "#7c3aed" : "#d97706"),
                              letterSpacing: "0.05em",
                            }}
                          >
                            {isPlaying ? "재생 중..." : item.roman}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  {/* 구분 팁 */}
                  <div style={{ padding: "0.875rem 1.25rem", background: "#f9fafb" }}>
                    <span style={{ fontSize: "0.8rem", fontWeight: "600", color: "#6b7280", marginRight: "0.4rem" }}>
                      💡 팁
                    </span>
                    <span style={{ fontSize: "0.85rem", color: "#374151", lineHeight: "1.6" }}>
                      {pair.tip}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 비교 퀴즈 */}
          {confusingView === "quiz" && (
            <div style={{ maxWidth: "420px" }}>
              {/* 점수 */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "1.5rem",
                  padding: "0.75rem 1rem",
                  borderRadius: "14px",
                  background: "#f3f4f6",
                }}
              >
                <span style={{ fontSize: "0.875rem", color: "#6b7280" }}>점수</span>
                <span style={{ fontWeight: "bold", color: "#1f2937" }}>
                  {confusingScore.correct} / {confusingScore.total}
                  {confusingScore.total > 0 && (
                    <span style={{ marginLeft: "0.5rem", color: "#6b7280", fontWeight: "normal", fontSize: "0.875rem" }}>
                      ({Math.round((confusingScore.correct / confusingScore.total) * 100)}%)
                    </span>
                  )}
                </span>
              </div>

              {/* 쌍 힌트 */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  marginBottom: "1rem",
                  padding: "0.5rem 0.875rem",
                  borderRadius: "14px",
                  background: "#fef3c7",
                  fontSize: "0.8rem",
                  color: "#92400e",
                }}
              >
                <span>이 쌍:</span>
                <span style={{ fontSize: "1.2rem", fontWeight: "bold" }}>
                  {confusingPairs[confusingQuiz.pairIndex].a.char}
                </span>
                <span style={{ color: "#b45309" }}>vs</span>
                <span style={{ fontSize: "1.2rem", fontWeight: "bold" }}>
                  {confusingPairs[confusingQuiz.pairIndex].b.char}
                </span>
              </div>

              {/* 문제 */}
              <div
                onClick={() => handleSpeak(confusingQuiz.question.char)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "100%",
                  height: "150px",
                  borderRadius: "12px",
                  border: `2px solid ${playingChar === confusingQuiz.question.char ? "#6366f1" : "#e5e7eb"}`,
                  background: playingChar === confusingQuiz.question.char ? "#eef2ff" : "#fff",
                  marginBottom: "1.5rem",
                  cursor: "pointer",
                  userSelect: "none",
                  WebkitUserSelect: "none",
                  transition: "background 0.15s, border-color 0.15s",
                }}
              >
                <span style={{ fontSize: "6rem", lineHeight: 1 }}>{confusingQuiz.question.char}</span>
                {playingChar === confusingQuiz.question.char && (
                  <span style={{ fontSize: "0.75rem", color: "#6366f1", fontWeight: "600", marginTop: "0.25rem" }}>
                    재생 중...
                  </span>
                )}
              </div>

              {/* 보기 2개 */}
              <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.25rem" }}>
                {confusingQuiz.choices.map((choice) => (
                  <button
                    key={choice}
                    onClick={() => handleConfusingChoice(choice)}
                    style={getConfusingChoiceStyle(choice)}
                  >
                    {choice}
                  </button>
                ))}
              </div>

              {/* 피드백 */}
              {confusingSelected !== null && (
                <>
                  <div
                    style={{
                      padding: "0.75rem 1rem",
                      borderRadius: "14px",
                      marginBottom: "0.75rem",
                      textAlign: "center",
                      fontWeight: "600",
                      fontSize: "0.95rem",
                      background: confusingSelected === confusingQuiz.question.roman ? "#dcfce7" : "#fee2e2",
                      color: confusingSelected === confusingQuiz.question.roman ? "#15803d" : "#b91c1c",
                    }}
                  >
                    {confusingSelected === confusingQuiz.question.roman
                      ? "정답입니다!"
                      : `오답! 정답은 "${confusingQuiz.question.roman}" 입니다.`}
                  </div>
                  {/* 팁 */}
                  <div
                    style={{
                      padding: "0.75rem 1rem",
                      borderRadius: "14px",
                      marginBottom: "1rem",
                      background: "#f9fafb",
                      border: "1px solid #e5e7eb",
                      fontSize: "0.83rem",
                      color: "#374151",
                      lineHeight: "1.6",
                    }}
                  >
                    <span style={{ fontWeight: "600", color: "#6b7280", marginRight: "0.35rem" }}>💡</span>
                    {confusingPairs[confusingQuiz.pairIndex].tip}
                  </div>
                  <button
                    onClick={loadNextConfusingQuestion}
                    style={{
                      width: "100%",
                      padding: "0.75rem",
                      borderRadius: "14px",
                      border: "none",
                      cursor: "pointer",
                      background: "#f59e0b",
                      color: "#fff",
                      fontWeight: "bold",
                      fontSize: "1rem",
                    }}
                  >
                    다음 문제 →
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
    </>
  );
}
