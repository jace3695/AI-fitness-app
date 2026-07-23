# AI 운동 — 재민님 맞춤 홈트 플랜

재민님을 위한 AI 맞춤 홈 트레이닝 앱입니다.  
월·화·목·금·토 요일별 운동 플랜 + 슬라이딩보드 + 식단 가이드를 한 번에!

---

## 🚀 로컬 실행 방법

### 1. 의존성 설치
```bash
npm install
```

### 2. Supabase 환경변수

`.env.example`을 `.env.local`로 복사한 뒤 Supabase 프로젝트의 URL과
publishable key를 입력합니다.

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key
```

### 3. 개발 서버 실행
```bash
npm run dev
```

브라우저에서 http://localhost:3000 열기

---

## 📦 GitHub 업로드 방법 (VS Code 사용)

### 방법 1: VS Code에서 직접 (권장)

1. **VS Code 열기**
   - `C:\projects\ai-fitness-app` 폴더를 VS Code로 열기

2. **터미널 열기** (`Ctrl + ~`)

3. **Git 초기화 및 커밋**
   ```bash
   git init
   git add .
   git commit -m "🏋️ AI 운동 앱 초기 설정"
   ```

4. **GitHub에 새 레포지토리 만들기**
   - https://github.com/new 접속
   - Repository name: `ai-fitness-app`
   - Public 선택 → Create repository 클릭

5. **GitHub에 업로드**
   ```bash
   git remote add origin https://github.com/[내 아이디]/ai-fitness-app.git
   git branch -M main
   git push -u origin main
   ```

---

## ⚡ Vercel 배포 방법

### 방법 1: Vercel 웹사이트 (가장 쉬움)

1. https://vercel.com 접속 → 회원가입 (GitHub 계정으로)
2. **"New Project"** 클릭
3. GitHub 레포지토리 `ai-fitness-app` 선택
4. **"Deploy"** 클릭 → 자동 배포 완료!

배포 후 `https://ai-fitness-app-xxx.vercel.app` 형태의 URL 제공됩니다.

### 방법 2: Vercel CLI

```bash
npm i -g vercel
vercel login
vercel --prod
```

---

## 📱 모바일 홈 화면에 추가하기

### iPhone (Safari)
1. Safari에서 앱 URL 접속
2. 공유 버튼 → **"홈 화면에 추가"**
3. "AI 운동" 앱처럼 사용 가능!

### 갤럭시 탭 (Chrome)
1. Chrome에서 앱 URL 접속
2. 메뉴(⋮) → **"홈 화면에 추가"**
3. 또는 주소 표시줄의 설치 아이콘 클릭

---

## 🛠 기술 스택

| 기술 | 용도 |
|------|------|
| Next.js 14 | React 프레임워크 |
| TypeScript | 타입 안전성 |
| Tailwind CSS | 스타일링 |
| Vercel | 배포 |
| PWA | 모바일 앱처럼 사용 |

---

## 📁 폴더 구조

```
ai-fitness-app/
├── app/
│   ├── components/
│   │   ├── DayView.tsx        # 요일별 운동 뷰
│   │   ├── DietView.tsx       # 식단 가이드
│   │   ├── ExerciseCard.tsx   # 운동 카드 (접기/펼치기)
│   │   ├── FlowDiagram.tsx    # 하루 운동 흐름도
│   │   ├── PhaseSection.tsx   # 준비/본/슬보/스트레칭 섹션
│   │   ├── SafetyView.tsx     # 주의사항
│   │   └── WeeklyView.tsx     # 주간 개요
│   ├── data/
│   │   └── workouts.ts        # 모든 운동 데이터
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx               # 메인 페이지
├── public/
│   ├── manifest.json          # PWA 설정
│   ├── icon-192.png
│   └── icon-512.png
├── package.json
├── tailwind.config.ts
└── tsconfig.json
```

---

## ✏️ 운동 데이터 수정하기

`app/data/workouts.ts` 파일에서 모든 운동 내용을 수정할 수 있습니다.

수정 후 GitHub에 Push하면 Vercel이 자동으로 재배포합니다.

```bash
git add .
git commit -m "운동 데이터 업데이트"
git push
```

---

**Made with ❤️ for 재민님**
