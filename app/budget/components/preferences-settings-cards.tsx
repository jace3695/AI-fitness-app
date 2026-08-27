'use client'

type NotificationPermissionState = NotificationPermission | 'unsupported' | 'default'

type PreferencesSettingsCardsProps = {
  currency: string
  notificationsEnabled: boolean
  budgetAlertEnabled: boolean
  notificationPermission: NotificationPermissionState
  onCurrencyChange: (currency: string) => void
  onNotificationChange: (notificationsEnabled: boolean, budgetAlertEnabled: boolean) => void
}

const cardStyle = {
  background: '#fffdf9',
  border: '1px solid #e4ded3',
  borderRadius: 16,
  padding: 16,
  marginBottom: 16,
}

const headingStyle = {
  color: '#4f705c',
  fontSize: 12,
  margin: '0 0 12px',
  letterSpacing: 1,
}

export default function PreferencesSettingsCards({
  currency,
  notificationsEnabled,
  budgetAlertEnabled,
  notificationPermission,
  onCurrencyChange,
  onNotificationChange,
}: PreferencesSettingsCardsProps) {
  const permissionMessage =
    notificationPermission === 'granted'
      ? '브라우저 알림 허용됨 · 예산 90%/초과 및 월말 리포트를 알려드려요.'
      : notificationPermission === 'denied'
        ? '알림이 차단되어 있어요. 기기 설정에서 AI 가계부 알림을 허용해주세요.'
        : notificationPermission === 'unsupported'
          ? '아이폰은 Safari에서 홈 화면에 추가한 웹앱으로 열어야 알림을 사용할 수 있어요.'
          : '알림 사용을 켜면 브라우저 권한 요청이 표시돼요.'

  return (
    <>
      <section style={cardStyle} aria-labelledby="currency-settings-heading">
        <p id="currency-settings-heading" style={headingStyle}>통화 설정</p>
        <select
          aria-label="표시 통화"
          value={currency}
          onChange={(event) => onCurrencyChange(event.target.value)}
          style={{
            width: '100%',
            background: '#fffdf9',
            border: '1px solid #d8d2c7',
            borderRadius: 8,
            padding: '10px 12px',
            color: '#302e2a',
            fontSize: 13,
            outline: 'none',
            boxSizing: 'border-box',
          }}
        >
          <option value="KRW">KRW (원)</option>
          <option value="USD">USD (달러)</option>
          <option value="JPY">JPY (엔)</option>
        </select>
      </section>

      <section style={cardStyle} aria-labelledby="notification-settings-heading">
        <p id="notification-settings-heading" style={headingStyle}>알림 설정</p>
        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ color: '#302e2a', fontSize: 13 }}>알림 사용</span>
          <input
            type="checkbox"
            checked={notificationsEnabled}
            onChange={(event) => onNotificationChange(event.target.checked, budgetAlertEnabled)}
          />
        </label>

        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ color: '#302e2a', fontSize: 13 }}>예산 초과 알림</span>
          <input
            type="checkbox"
            checked={budgetAlertEnabled}
            onChange={(event) => onNotificationChange(notificationsEnabled, event.target.checked)}
          />
        </label>

        <p aria-live="polite" style={{ color: '#77736c', fontSize: 11, lineHeight: 1.6, margin: '12px 0 0' }}>
          {permissionMessage}
        </p>
      </section>
    </>
  )
}
