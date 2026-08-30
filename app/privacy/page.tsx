import type { Metadata } from "next";
import PublicInfoPage from "../components/PublicInfoPage";

export const metadata: Metadata = {
  title: "개인정보처리방침 | AI 연이",
  description: "AI 연이 Google Calendar 연동 개인정보처리방침입니다.",
};

export default function PrivacyPage() {
  return (
    <PublicInfoPage
      eyebrow="PRIVACY POLICY"
      title="개인정보처리방침"
      description="AI 연이는 Google Calendar 연동 과정에서 필요한 최소한의 정보만 처리하며 사용자가 연결을 해제할 수 있도록 합니다."
      updatedAt="2026년 8월 30일"
      sections={[
        {
          title: "1. 처리하는 정보",
          items: [
            "서비스 로그인 계정 식별 정보",
            "연결된 Google 계정의 이메일 주소",
            "Google OAuth 접근 토큰과 갱신 토큰",
            "사용자가 요청한 기간의 캘린더 일정 제목·날짜·시간·설명·일정 링크",
          ],
        },
        {
          title: "2. 이용 목적",
          paragraphs: [
            "Google 계정 연결 상태를 유지하고, 통합 달력에서 사용자의 Google Calendar 일정을 조회·추가·수정·삭제하는 용도로만 처리합니다.",
          ],
        },
        {
          title: "3. 저장 및 보유 기간",
          paragraphs: [
            "Google 일정 내용은 AI 연이 데이터베이스에 별도로 저장하지 않으며 요청 시 Google Calendar에서 불러옵니다. 연결 계정 이메일과 암호화된 OAuth 토큰은 사용자가 Google Calendar 연결을 해제할 때까지 보관합니다.",
            "연결 해제 시 저장된 연결 정보와 토큰을 삭제하고 Google 토큰 취소를 요청합니다. Google Calendar에 생성된 일정은 사용자가 직접 삭제하기 전까지 Google 계정에 남아 있을 수 있습니다.",
          ],
        },
        {
          title: "4. 제3자 서비스와 데이터 공유",
          paragraphs: [
            "기능 제공을 위해 Google Calendar API, Supabase의 인증·데이터베이스, Vercel의 웹 호스팅을 사용합니다. Google 사용자 데이터는 광고, 판매, 신용 평가 또는 범용 AI 모델 학습에 제공하지 않습니다.",
          ],
        },
        {
          title: "5. 보호 조치",
          items: [
            "HTTPS 암호화 통신",
            "OAuth 토큰의 서버 측 암호화 저장",
            "로그인 사용자별 데이터 접근 제어",
            "최소 권한과 사용자 소유 데이터 정책 적용",
          ],
        },
        {
          title: "6. 사용자의 선택과 삭제",
          paragraphs: [
            "통합 달력의 ‘해제’ 버튼으로 언제든 Google Calendar 연결을 취소할 수 있습니다. Google 계정의 ‘서드 파티 앱 및 서비스 연결’ 화면에서도 AI 연이의 접근 권한을 삭제할 수 있습니다.",
          ],
        },
        {
          title: "7. 문의",
          paragraphs: [
            "개인정보 또는 Google Calendar 연동에 관한 문의는 Google OAuth 동의 화면에 표시된 개발자 지원 이메일을 이용해 주세요.",
          ],
        },
      ]}
    />
  );
}
