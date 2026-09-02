import AssistantPage from "./assistant/page";
import AuthGate from "./components/AuthGate";

export default function Page() {
  return (
    <AuthGate>
      <AssistantPage />
    </AuthGate>
  );
}
