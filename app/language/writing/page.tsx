"use client";

import { useEffect, useRef, useState } from "react";

type WritingProblem = {
  id: number;
  prompt: string;
  answer: string;
  category: "일상" | "여행" | "업무" | "친구";
};

const PROBLEMS: WritingProblem[] = [
  {
    id: 1,
    prompt: "이거 얼마예요?",
    answer: "これはいくらですか？",
    category: "여행",
  },
  {
    id: 2,
    prompt: "다시 한 번 부탁드립니다",
    answer: "もう一度お願いします",
    category: "일상",
  },
  {
    id: 3,
    prompt: "확인 부탁드립니다",
    answer: "ご確認お願いします",
    category: "업무",
  },
  {
    id: 4,
    prompt: "지금 뭐 하고 있어?",
    answer: "今何してる？",
    category: "친구",
  },
];

type InputMode = "text" | "handwriting";

type Grade = "correct" | "almost" | "wrong";

type Result = {
  problem: WritingProblem;
  userInput: string;
  grade: Grade;
};

function normalize(s: string): string {
  return s.replace(/\s/g, "").replace(/[?？]+$/, "");
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function getGrade(input: string, answer: string): Grade {
  const normInput = normalize(input);
  const normAnswer = normalize(answer);
  if (normInput === normAnswer) return "correct";
  const dist = levenshtein(normInput, normAnswer);
  const threshold = Math.max(1, Math.floor(normAnswer.length * 0.2));
  if (dist <= threshold) return "almost";
  return "wrong";
}

const CANVAS_WIDTH = 560;
const CANVAS_HEIGHT = 200;

export default function WritingPage() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [inputMode, setInputMode] = useState<InputMode>("text");
  const [userInput, setUserInput] = useState("");
  const [result, setResult] = useState<Result | null>(null);

  const currentProblem = PROBLEMS[currentIndex];

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef(false);
  const hasDrawnRef = useRef(false);

  const initCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    ctx.strokeStyle = "#222222";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    hasDrawnRef.current = false;
  };

  useEffect(() => {
    setUserInput("");
    setResult(null);
  }, [currentIndex]);

  useEffect(() => {
    setUserInput("");
    setResult(null);
    if (inputMode === "handwriting") {
      setTimeout(() => initCanvas(), 0);
    }
  }, [inputMode]);

  useEffect(() => {
    if (inputMode === "handwriting") {
      initCanvas();
    }
  }, [currentIndex, inputMode]);

  const getCanvasPos = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_WIDTH / rect.width;
    const scaleY = CANVAS_HEIGHT / rect.height;
    if ("touches" in e) {
      const t = e.touches[0];
      return {
        x: (t.clientX - rect.left) * scaleX,
        y: (t.clientY - rect.top) * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const startDraw = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.strokeStyle = "#222222";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const { x, y } = getCanvasPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    isDrawingRef.current = true;
    hasDrawnRef.current = true;
  };

  const draw = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) => {
    e.preventDefault();
    if (!isDrawingRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { x, y } = getCanvasPos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const endDraw = (e?: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e?.preventDefault();
    isDrawingRef.current = false;
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    ctx.strokeStyle = "#222222";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    hasDrawnRef.current = false;
  };

  const resetAll = () => {
    setUserInput("");
    setResult(null);
    if (inputMode === "handwriting") {
      clearCanvas();
    }
  };

  const handleSubmit = () => {
    if (inputMode === "text") {
      const trimmed = userInput.trim();
      if (!trimmed) return;
      const grade = getGrade(trimmed, currentProblem.answer);
      setResult({ problem: currentProblem, userInput: trimmed, grade });
    } else {
      setResult({
        problem: currentProblem,
        userInput: "(필기 입력)",
        grade: "wrong",
      });
    }
  };

  const handleNext = () => {
    setCurrentIndex((i) => (i + 1) % PROBLEMS.length);
  };

  const handlePrev = () => {
    setCurrentIndex((i) => (i - 1 + PROBLEMS.length) % PROBLEMS.length);
  };

  const modeButtonStyle = (mode: InputMode) => ({
    padding: "8px 18px",
    borderRadius: "8px",
    border: inputMode === mode ? "2px solid #0070f3" : "2px solid #d0d0d0",
    background: inputMode === mode ? "#0070f3" : "#f5f5f5",
    color: inputMode === mode ? "#ffffff" : "#444",
    fontWeight: inputMode === mode ? 700 : 400,
    cursor: "pointer",
    fontSize: "14px",
    outline: inputMode === mode ? "3px solid #99c4fb" : "none",
    outlineOffset: "2px",
    transition: "all 0.15s",
  });

  return (
    <section>
      <div className="page-header">
        <h1>쓰기 학습</h1>
        <p className="muted" style={{ margin: 0 }}>
          한국어 문장을 일본어로 직접 써 보세요.
        </p>
      </div>

      {/* 문제 카드 */}
      <div className="card">
        <div className="card-top">
          <div className="label">문제 {currentIndex + 1} / {PROBLEMS.length}</div>
          <span className="badge">{currentProblem.category}</span>
        </div>
        <div style={{ marginTop: "8px" }}>
          <div className="label">한국어</div>
          <div style={{ fontSize: "18px", fontWeight: "bold" }}>
            {currentProblem.prompt}
          </div>
        </div>
        <div style={{ marginTop: "14px", display: "flex", gap: "8px", justifyContent: "space-between" }}>
          <button onClick={handlePrev} className="btn" style={{ background: "#888" }}>
            이전
          </button>
          <button onClick={handleNext} className="btn" style={{ background: "#888" }}>
            다음
          </button>
        </div>
      </div>

      {/* 입력 방식 선택 */}
      <div className="card">
        <div className="label" style={{ marginBottom: "8px" }}>입력 방식</div>
        <div style={{ display: "flex", gap: "10px" }}>
          <button style={modeButtonStyle("text")} onClick={() => setInputMode("text")}>
            ⌨️ 텍스트로 쓰기
          </button>
          <button style={modeButtonStyle("handwriting")} onClick={() => setInputMode("handwriting")}>
            ✏️ 필기로 쓰기
          </button>
        </div>
      </div>

      {/* 답안 입력 영역 */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
          <div className="label" style={{ margin: 0 }}>답안</div>
          <button
            onClick={resetAll}
            style={{
              padding: "4px 12px",
              borderRadius: "6px",
              border: "1px solid #d0d0d0",
              background: "#f5f5f5",
              color: "#555",
              fontSize: "12px",
              cursor: "pointer",
            }}
          >
            전체 초기화
          </button>
        </div>

        {inputMode === "text" ? (
          <textarea
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            placeholder="일본어로 답을 입력해 주세요"
            rows={3}
            style={{
              width: "100%",
              padding: "10px",
              border: "1px solid #d0d0d0",
              borderRadius: "8px",
              fontSize: "16px",
              fontFamily: "inherit",
              background: "#ffffff",
              resize: "none",
              boxSizing: "border-box",
            }}
          />
        ) : (
          <div>
            <div
              style={{
                width: "100%",
                height: `${CANVAS_HEIGHT}px`,
                position: "relative",
                border: "1px dashed #b8b8b8",
                borderRadius: "8px",
                overflow: "hidden",
                background: "#ffffff",
                boxSizing: "border-box",
              }}
            >
              <canvas
                ref={canvasRef}
                width={CANVAS_WIDTH}
                height={CANVAS_HEIGHT}
                onMouseDown={startDraw}
                onMouseMove={draw}
                onMouseUp={endDraw}
                onMouseLeave={endDraw}
                onTouchStart={startDraw}
                onTouchMove={draw}
                onTouchEnd={endDraw}
                style={{
                  width: "100%",
                  height: "100%",
                  display: "block",
                  touchAction: "none",
                  cursor: "crosshair",
                }}
              />
            </div>
            <div style={{ marginTop: "8px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span className="muted" style={{ fontSize: "12px" }}>
                * 필기 인식은 아직 지원하지 않습니다.
              </span>
              <button
                onClick={clearCanvas}
                style={{
                  padding: "6px 14px",
                  borderRadius: "6px",
                  border: "1px solid #f2c0bd",
                  background: "#fdecea",
                  color: "#a12a25",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                🗑 지우기
              </button>
            </div>
          </div>
        )}

        <div style={{ marginTop: "14px", display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={handleSubmit}
            className="btn"
            disabled={inputMode === "text" && userInput.trim().length === 0}
          >
            제출
          </button>
        </div>
      </div>

      {/* 결과 표시 영역 */}
      {result && (
        <div className="card">
          <div className="label">결과</div>

          <div style={{ marginTop: "6px" }}>
            <div className="label">문제</div>
            <div>{result.problem.prompt}</div>
          </div>

          <div style={{ marginTop: "10px" }}>
            <div className="label">내가 입력한 답</div>
            <div className="jp-text" style={{ fontSize: "18px" }}>
              {result.userInput || "(입력 없음)"}
            </div>
          </div>

          <div style={{ marginTop: "10px" }}>
            <div className="label">정답</div>
            <div className="jp-text" style={{ fontSize: "18px" }}>
              {result.problem.answer}
            </div>
          </div>

          <div style={{ marginTop: "12px" }}>
            {inputMode === "text" ? (
              result.grade === "correct" ? (
                <div style={{ background: "#e6f7ea", color: "#1e7a36", border: "1px solid #b8e2c4", padding: "8px 12px", borderRadius: "8px", fontSize: "14px" }}>
                  ✅ 정답이에요! 잘 쓰셨습니다.
                </div>
              ) : result.grade === "almost" ? (
                <div style={{ background: "#fff8e1", color: "#8a6200", border: "1px solid #ffe082", padding: "8px 12px", borderRadius: "8px", fontSize: "14px" }}>
                  🟡 거의 맞았어요! 정답과 조금 달라요. 다시 확인해 보세요.
                </div>
              ) : (
                <div style={{ background: "#fdecea", color: "#a12a25", border: "1px solid #f2c0bd", padding: "8px 12px", borderRadius: "8px", fontSize: "14px" }}>
                  ❌ 틀렸습니다. 정답을 보고 다시 써 보세요.
                </div>
              )
            ) : (
              <div style={{ background: "#f1f3f8", color: "#555", border: "1px solid #e5e5e5", padding: "8px 12px", borderRadius: "8px", fontSize: "14px" }}>
                필기 모드에서는 아직 자동 채점이 지원되지 않습니다. 정답과 비교해 직접 확인해 보세요.
              </div>
            )}
          </div>

          <div style={{ marginTop: "14px", display: "flex", justifyContent: "flex-end" }}>
            <button
              onClick={handleNext}
              className="btn"
              style={{ background: "#0070f3", minWidth: "120px" }}
            >
              {currentIndex === PROBLEMS.length - 1 ? "처음으로 돌아가기" : `다음 문제 →`}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

