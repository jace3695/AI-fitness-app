'use client'

type SettingsUtilityCardsProps = {
  autoAnalyzeEnabled: boolean
  autoQuestion: string
  showResetConfirm: boolean
  resetPassword: string
  resetLoading: boolean
  onAutoAnalyzeEnabledChange: (enabled: boolean) => void
  onAutoQuestionChange: (question: string) => void
  onShowResetConfirmChange: (show: boolean) => void
  onResetPasswordChange: (password: string) => void
  onResetAllData: () => void
}

export default function SettingsUtilityCards({ autoAnalyzeEnabled, autoQuestion, showResetConfirm, resetPassword, resetLoading, onAutoAnalyzeEnabledChange, onAutoQuestionChange, onShowResetConfirmChange, onResetPasswordChange, onResetAllData }: SettingsUtilityCardsProps) {
  const setAutoAnalyzeEnabled = onAutoAnalyzeEnabledChange
  const setAutoQuestion = onAutoQuestionChange
  const setShowResetConfirm = onShowResetConfirmChange
  const setResetPassword = onResetPasswordChange
  const handleResetAllData = onResetAllData

  return (
    <>
    <div style={{ background: 'rgba(19,19,28,0.75)', border: '1px solid #1A1A24', borderRadius: 16, padding: 16, marginBottom: 16 }}>
      <p style={{ color: '#9CA3AF', fontSize: 12, margin: '0 0 12px', letterSpacing: 1 }}>자동 분석 설정</p>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <input
          type="checkbox"
          checked={autoAnalyzeEnabled}
          onChange={(e) => setAutoAnalyzeEnabled(e.target.checked)}
        />
        <span style={{ color: '#E0E0EA', fontSize: 13 }}>AI 상담 진입 시 자동 분석 실행</span>
      </label>

      <input
        value={autoQuestion}
        onChange={(e) => setAutoQuestion(e.target.value)}
        placeholder="자동으로 실행할 질문 입력"
        style={{
          width: '100%',
          background: 'rgba(8,8,12,0.38)',
          border: '1px solid rgba(255,255,255,0.22)',
          borderRadius: 8,
          padding: '10px 12px',
          color: '#FFFFFF',
          fontSize: 13,
          outline: 'none',
          boxSizing: 'border-box',
          textShadow: '0 1px 2px rgba(0,0,0,0.45)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05), 0 0 0 1px rgba(0,0,0,0.08)'
        }}
      />
    </div>

    <div style={{ background: 'rgba(19,19,28,0.75)', border: '1px solid #1A1A24', borderRadius: 16, padding: 16, marginBottom: 16 }}>
      <p style={{ color: '#FF9B9B', fontSize: 12, margin: '0 0 12px', letterSpacing: 1 }}>기록 초기화</p>
      <button onClick={() => setShowResetConfirm(!showResetConfirm)} style={{ width: '100%', background: 'rgba(255,107,107,0.12)', border: '1px solid #FF6B6B55', borderRadius: 10, padding: '12px', cursor: 'pointer', color: '#FF6B6B', fontSize: 13, fontWeight: 700 }}>현재까지의 모든 기록 초기화</button>

      {showResetConfirm && (
        <div style={{ marginTop: 12, background: 'rgba(15,15,20,0.75)', border: '1px solid #FF6B6B55', borderRadius: 12, padding: 12 }}>
          <p style={{ color: '#FFD9D9', fontSize: 12, margin: '0 0 8px' }}>비밀번호를 입력해야 초기화가 진행돼요.</p>
          <input
            type="password"
            value={resetPassword}
            onChange={e => setResetPassword(e.target.value)}
            placeholder="비밀번호 입력"
            style={{ width: '100%', background: 'rgba(0,0,0,0.45)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 10, color: '#FFFFFF', fontSize: 14, padding: '10px 12px', outline: 'none', boxSizing: 'border-box', marginBottom: 10 }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => { setShowResetConfirm(false); setResetPassword('') }} style={{ flex: 1, background: 'rgba(26,26,46,0.75)', border: '1px solid #2A2A3E', borderRadius: 10, padding: '10px', cursor: 'pointer', color: '#D0D0E0', fontSize: 13 }}>취소</button>
            <button onClick={handleResetAllData} disabled={resetLoading} style={{ flex: 1, background: '#FF6B6B', border: 'none', borderRadius: 10, padding: '10px', cursor: 'pointer', color: '#FFFFFF', fontSize: 13, fontWeight: 700, opacity: resetLoading ? 0.6 : 1 }}>
              {resetLoading ? '초기화 중…' : '초기화 실행'}
            </button>
          </div>
        </div>
      )}
    </div>

    </>
  )
}

