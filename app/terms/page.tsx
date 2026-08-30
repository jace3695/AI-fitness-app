import type { Metadata } from "next";
import PublicInfoPage from "../components/PublicInfoPage";

export const metadata: Metadata = {
  title: "서비스 이용약관 | AI 연이",
  description: "개인용 웹 애플리케이션 AI 연이의 서비스 이용약관입니다.",
};

export default function TermsPage() {
  return (
    <PublicInfoPage
      eyebrow="TERMS OF SERVICE"
      title="서비스 이용약관"
      description="본 약관은 개인용 웹 애플리케이션 AI 연이와 Google Calendar 연동 기능의 이용 조건을 안내합니다."
      updatedAt="2026년 8월 30일"
      sections={[
        {
          title: "1. 서비스 목적",
          paragraphs: [
            "AI 연이는 사용자가 자신의 일정과 생활 기록을 한곳에서 관리하도록 돕는 개인용 서비스입니다. 현재 개발자 본인과 사전에 허용된 소수의 사용자에게만 제공됩니다.",
          ],
        },
        {
          title: "2. Google Calendar 기능",
          paragraphs: [
            "사용자가 Google 계정 접근에 동의한 경우 일정 조회·추가·수정·삭제 기능을 제공합니다. 모든 작업은 사용자의 요청으로 실행되며, 사용자는 언제든 연결을 해제할 수 있습니다.",
          ],
        },
        {
          title: "3. 사용자 책임",
          items: [
            "본인 계정과 기기의 로그인 정보를 안전하게 관리해야 합니다.",
            "일정 추가·수정·삭제 전에 입력 내용을 확인해야 합니다.",
            "서비스를 불법적인 목적이나 타인의 권리를 침해하는 방식으로 사용해서는 안 됩니다.",
          ],
        },
        {
          title: "4. 서비스 변경 및 중단",
          paragraphs: [
            "보안 개선, 외부 API 정책 변경, 점검 또는 장애로 기능이 변경되거나 일시 중단될 수 있습니다. 중요한 일정은 Google Calendar에서 함께 확인하는 것을 권장합니다.",
          ],
        },
        {
          title: "5. 데이터와 권한",
          paragraphs: [
            "사용자의 일정과 기록에 대한 권리는 사용자에게 있습니다. AI 연이는 서비스 제공에 필요한 범위에서만 Google Calendar 권한을 사용하며 세부 처리 기준은 개인정보처리방침을 따릅니다.",
          ],
        },
        {
          title: "6. 문의",
          paragraphs: [
            "서비스 이용 문의는 Google OAuth 동의 화면에 표시된 개발자 지원 이메일을 이용해 주세요.",
          ],
        },
      ]}
    />
  );
}
