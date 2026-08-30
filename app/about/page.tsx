import type { Metadata } from "next";
import PublicInfoPage from "../components/PublicInfoPage";

export const metadata: Metadata = {
  title: "앱 소개 | AI 연이",
  description: "일정과 생활 기록을 한곳에서 관리하는 개인 AI 플랫폼 AI 연이의 공식 소개 페이지입니다.",
};

export default function AboutPage() {
  return (
    <PublicInfoPage
      eyebrow="APPLICATION HOME"
      title="생활 기록과 일정을 잇는 개인 AI 비서"
      description="AI 연이는 일정·할 일·운동·식단·가계·언어 학습 기록을 한곳에서 확인하고 관리할 수 있도록 만든 개인용 웹 애플리케이션입니다."
      sections={[
        {
          title: "Google Calendar 연동",
          paragraphs: [
            "사용자가 직접 Google 계정을 연결하면 통합 달력에서 기본 캘린더 일정을 확인하고, 새 일정을 추가하거나 기존 일정을 수정·삭제할 수 있습니다.",
            "Google Calendar 권한은 이 기능을 제공하는 데만 사용하며 광고, 판매 또는 범용 AI 모델 학습에 사용하지 않습니다.",
          ],
        },
        {
          title: "주요 기능",
          items: [
            "Google Calendar 일정 조회·추가·수정·삭제",
            "할 일·운동·식단·가계·언어 학습 기록 통합",
            "사용자 계정에 연결된 개인 데이터 보호",
            "언제든 가능한 Google Calendar 연결 해제",
          ],
        },
        {
          title: "운영 범위",
          paragraphs: [
            "현재 AI 연이는 개발자 본인과 사전에 허용된 소수의 사용자만 사용하는 개인용 서비스입니다.",
          ],
        },
      ]}
    />
  );
}
