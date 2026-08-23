'use client'
import { useEffect, useState, useRef } from 'react'
import { Capacitor } from '@capacitor/core'
import { SpeechRecognition } from '@capacitor-community/speech-recognition'
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics'
import { authenticatedFetch, createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { ArrowRight, ChevronDown, ChevronUp, CircleDollarSign, PiggyBank, ReceiptText, Sparkles } from 'lucide-react'
import FixedSpaceBackground from './components/fixed-space-background'
import PreferencesSettingsCards from './components/preferences-settings-cards'
import HistoryScreen from './components/history-screen'
import SettingsUtilityCards from './components/settings-utility-cards'
import UserGuide from './components/user-guide'
import { PARSE_SYSTEM, FIXED_EXPENSE_PRIORITY_CATEGORIES, detectLocalExpenseCategory, getFixedExpenseSignature, getRecurringPatternText, hasLocalExpenseMetaSignal, inferExpenseMeta, parseInputLocally } from './lib/transaction-parser'
import AuthGate from '../components/AuthGate'

const CATEGORY_MAP: Record<string, { icon: string; color: string }> = {
  식비: { icon: '🍔', color: '#FF6B6B' },
  카페: { icon: '☕', color: '#C8956C' },
  교통: { icon: '🚗', color: '#4ECDC4' },
  쇼핑: { icon: '🛍️', color: '#A78BFA' },
  생활용품: { icon: '🧴', color: '#22C55E' },
  배달: { icon: '🛵', color: '#FB923C' },
  문화: { icon: '🎬', color: '#34D399' },
  의료: { icon: '💊', color: '#F472B6' },
  구독: { icon: '📱', color: '#60A5FA' },
  통신비: { icon: '📞', color: '#38BDF8' },
  공과금: { icon: '💡', color: '#FBBF24' },
  보험: { icon: '🛡️', color: '#818CF8' },
  월세: { icon: '🏠', color: '#F97316' },
  대출: { icon: '🏦', color: '#F87171' },
  관리비: { icon: '🏢', color: '#FBBF24' },
  취미: { icon: '🎯', color: '#A3E635' },
  기타: { icon: '📦', color: '#9CA3AF' },
}

const BUDGET_CATEGORIES = Object.keys(CATEGORY_MAP)

const QUICK_INPUT_EXAMPLES = [
  '오늘 점심 9천원 체크카드',
  '월급 250만원 들어왔어',
  '적금 5만원 넣었어',
]

function formatDisplayCurrency(n: number, currency: string) {
  if (currency === 'USD') {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0
    }).format(n)
  }

  if (currency === 'JPY') {
    return new Intl.NumberFormat('ja-JP', {
      style: 'currency',
      currency: 'JPY',
      maximumFractionDigits: 0
    }).format(n)
  }

  return new Intl.NumberFormat('ko-KR', {
    style: 'currency',
    currency: 'KRW',
    maximumFractionDigits: 0
  }).format(n)
}

function getCategoryIcon(category?: string) {
  const map: Record<string, string> = {
    식비: '🍔',
    카페: '☕',
    교통: '🚗',
    쇼핑: '🛍️',
    생활용품: '🧴',
    배달: '🛵',
    문화: '🎬',
    의료: '💊',
    구독: '📱',
    통신비: '📞',
    공과금: '💡',
    취미: '🎯',
    기타: '📦',

    // 수입
    월급: '💼',
    용돈: '💸',
    부업: '🧑‍💻',
    보너스: '🎁',
    이자: '💰',
    기타수입: '💵'
  }

  return map[category || ''] || '📌'
}

function getCardStyle(borderColor = '#1A1A24') {
  return {
    background: 'linear-gradient(180deg, rgba(24,24,36,0.88) 0%, rgba(19,19,28,0.82) 100%)',
    border: `1px solid ${borderColor}`,
    borderRadius: 18,
    padding: 16,
    boxShadow: '0 10px 30px rgba(0,0,0,0.22)',
    backdropFilter: 'blur(8px)'
  } as const
}

function getPaymentBadgeStyle(payment?: string) {
  const colorMap: Record<string, string> = {
    체크카드: '#60A5FA',
    현금: '#34D399',
    계좌이체: '#F59E0B',
    '휴대폰 소액결제': '#F472B6',
    충전카드: '#A78BFA'
  }

  const color = colorMap[payment || ''] || '#9CA3AF'

  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '3px 8px',
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 700,
    color,
    background: `${color}22`,
    border: `1px solid ${color}55`
  } as const
}

function BudgetDashboard() {
  const [user, setUser] = useState<any>(null)
  const [nickname, setNickname] = useState('')
  const [autoAnalyzeEnabled, setAutoAnalyzeEnabled] = useState(true)
  const [autoQuestion, setAutoQuestion] = useState('이번 달 소비 분석해줘')
  const [newNickname, setNewNickname] = useState('')
  const [showNicknameInput, setShowNicknameInput] = useState(false)
  const [transactions, setTransactions] = useState<any[]>([])
  const [recurringTransactions, setRecurringTransactions] = useState<any[]>([])
  const [recurringExpensePreferences, setRecurringExpensePreferences] = useState<any[]>([])
  const [recurringDecisionSavingKey, setRecurringDecisionSavingKey] = useState('')
  const [incomeList, setIncomeList] = useState<any[]>([])
  const [incomeInput, setIncomeInput] = useState('')
  const [incomeListening, setIncomeListening] = useState(false)
  const [loading, setLoading] = useState(true)
  const [appReady, setAppReady] = useState(false)
  const [showSplash, setShowSplash] = useState(true)
  const [showSessionCheckingHint, setShowSessionCheckingHint] = useState(false)
  const [tab, setTab] = useState('home')
  const [analysisView, setAnalysisView] = useState<'stats' | 'ai'>('stats')
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const today = new Date()
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
  })
  const [input, setInput] = useState('')
  const [feedback, setFeedback] = useState('')
  const [parsedItems, setParsedItems] = useState<any[]>([])
  const [showConfirm, setShowConfirm] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [isSavingRecords, setIsSavingRecords] = useState(false)
  const [question, setQuestion] = useState('')
  const suggestedQuestions = [
    '이번 달 가장 많이 쓴 항목은?',
    '지난달보다 늘어난 항목은?',
    '배달비만 따로 보여줘',
    '카페에 이번 달 얼마 썼어?',
    '현금만 얼마 썼어?',
    '이번 주 지출 얼마야?',
    '지난달보다 이번 달 식비 얼마나 늘었어?',
    '다음 달 예산 얼마나 잡는 게 좋을까?',
    '반복되는 지출 뭐야?'
  ]
  const [aiAnswer, setAiAnswer] = useState('')
  const [aiFollowUpQuestions, setAiFollowUpQuestions] = useState<string[]>([])
  const [analyzing, setAnalyzing] = useState(false)
  const [listening, setListening] = useState(false)
  const [ttsEnabled, setTtsEnabled] = useState(false)
  const [savings, setSavings] = useState<any[]>([])
  const [showAllRecent, setShowAllRecent] = useState(false)
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [showUserGuide, setShowUserGuide] = useState(false)
  const [resetPassword, setResetPassword] = useState('')
  const [resetLoading, setResetLoading] = useState(false)
  const [autoAnalyzeRan, setAutoAnalyzeRan] = useState(false)
  const [currency, setCurrency] = useState('KRW')
  const [notificationsEnabled, setNotificationsEnabled] = useState(true)
  const [budgetAlertEnabled, setBudgetAlertEnabled] = useState(true)
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>('unsupported')
  const [monthlyBudget, setMonthlyBudget] = useState<number | null>(null)
  const [budgetInput, setBudgetInput] = useState('')
  const [categoryBudgets, setCategoryBudgets] = useState<Record<string, number>>({})
  const [categoryBudgetInputs, setCategoryBudgetInputs] = useState<Record<string, string>>({})
  const [showBudgetEditor, setShowBudgetEditor] = useState(false)
  const [budgetLoading, setBudgetLoading] = useState(false)
  const [budgetSaving, setBudgetSaving] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [simplePinEnabled, setSimplePinEnabled] = useState(false)
  const [currentSimplePin, setCurrentSimplePin] = useState('')
  const [simplePin, setSimplePin] = useState('')
  const [simplePinConfirm, setSimplePinConfirm] = useState('')
  const [isUnlocked, setIsUnlocked] = useState(false)
  const [isLockReady, setIsLockReady] = useState(false)
  const [unlockPinInput, setUnlockPinInput] = useState('')
  const [hasSimplePin, setHasSimplePin] = useState(false)
  const [unlockError, setUnlockError] = useState('')
  const [lockShake, setLockShake] = useState(false)
  const [unlockSuccess, setUnlockSuccess] = useState(false)
  const [unlockRequiresPassword, setUnlockRequiresPassword] = useState(false)
  const [unlockAccountPassword, setUnlockAccountPassword] = useState('')
  const [passkeySupported, setPasskeySupported] = useState(false)
  const [passkeys, setPasskeys] = useState<Array<{ id: string; friendly_name?: string; created_at: string; last_used_at?: string }>>([])
  const [passkeyBusy, setPasskeyBusy] = useState(false)

  const [isOffline, setIsOffline] = useState(false)
  const [pageNotice, setPageNotice] = useState('')
  const [actionError, setActionError] = useState('')
  const [processingRecordKey, setProcessingRecordKey] = useState('')
  const [settingsSavingAction, setSettingsSavingAction] = useState('')
  const [dataLoadError, setDataLoadError] = useState('')
  const [lastActiveAt, setLastActiveAt] = useState(Date.now())
  const LOCK_TIMEOUT = 1000 * 60 * 3

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setNotificationPermission('unsupported')
      return
    }

    setNotificationPermission(Notification.permission)
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch((error) => {
        console.warn('알림 서비스워커 등록 실패:', error)
      })
    }
  }, [])

  const ensureNotificationPermission = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setNotificationPermission('unsupported')
      return false
    }

    if (Notification.permission === 'granted') {
      setNotificationPermission('granted')
      return true
    }

    const permission = await Notification.requestPermission()
    setNotificationPermission(permission)
    return permission === 'granted'
  }

  const showBrowserNotification = async (title: string, body: string, tag: string) => {
    if (typeof window === 'undefined' || Notification.permission !== 'granted') return

    try {
      const registration = 'serviceWorker' in navigator
        ? await navigator.serviceWorker.ready
        : null

      if (registration) {
        await registration.showNotification(title, {
          body,
          tag,
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          data: { url: '/budget' }
        })
        return
      }

      new Notification(title, { body, tag, icon: '/icon-192.png' })
    } catch (error) {
      console.warn('브라우저 알림 표시 실패:', error)
    }
  }
  const formatKRW = (n: number) => formatDisplayCurrency(n, currency)
  const cardStyle = {
    background: 'rgba(0,0,0,0.55)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16
  }
  const audioContextRef = useRef<AudioContext | null>(null)
  const unlockPinInputRef = useRef<HTMLInputElement | null>(null)
  const supabase = createClient()
  const router = useRouter()
  const API_BASE_URL =
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    (typeof window !== 'undefined' ? window.location.origin : '')

  const callPinApi = async (payload: Record<string, string>) => {
    const response = await authenticatedFetch(`${API_BASE_URL}/api/pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      const error = new Error(data.error || '공통 PIN 요청을 처리하지 못했습니다.') as Error & { status?: number }
      error.status = response.status
      throw error
    }

    return data
  }

  const triggerLockErrorFeedback = async () => {
    setLockShake(false)
    requestAnimationFrame(() => {
      setLockShake(true)
    })
    window.setTimeout(() => {
      setLockShake(false)
    }, 420)

    if (Capacitor.isNativePlatform()) {
      try {
        await Haptics.notification({ type: NotificationType.Error })
      } catch {}
    }
  }

  const triggerLockSuccessFeedback = async () => {
    if (Capacitor.isNativePlatform()) {
      try {
        await Haptics.notification({ type: NotificationType.Success })
      } catch {
        try {
          await Haptics.impact({ style: ImpactStyle.Light })
        } catch {}
      }
    }
  }

  const lockScreen = () => {
    setIsUnlocked(false)
    setUnlockPinInput('')
    setUnlockError('')
    setUnlockSuccess(false)
    setLockShake(false)
  }

  useEffect(() => {
    const checkPasskeySupport = async () => {
      if (!window.isSecureContext || !window.PublicKeyCredential) return

      try {
        const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
        setPasskeySupported(available)
      } catch {
        setPasskeySupported(false)
      }
    }

    checkPasskeySupport()
  }, [])

  useEffect(() => {
    const initAudio = () => {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)()
      }
      document.removeEventListener('touchstart', initAudio)
    }
    document.addEventListener('touchstart', initAudio)
    return () => document.removeEventListener('touchstart', initAudio)
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setShowSplash(false)
    }, 550)

    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (!loading) {
      setShowSessionCheckingHint(false)
      return
    }

    const timer = window.setTimeout(() => {
      setShowSessionCheckingHint(true)
    }, 3000)

    return () => window.clearTimeout(timer)
  }, [loading])

  useEffect(() => {
    const syncOnlineState = () => {
      const offline = !navigator.onLine
      setIsOffline(offline)

      if (offline) {
        setPageNotice('네트워크 연결이 끊어졌어요. 일부 기능이 잠시 동작하지 않을 수 있어요.')
      } else {
        setPageNotice('')
      }
    }

    syncOnlineState()
    window.addEventListener('online', syncOnlineState)
    window.addEventListener('offline', syncOnlineState)

    return () => {
      window.removeEventListener('online', syncOnlineState)
      window.removeEventListener('offline', syncOnlineState)
    }
  }, [])

  useEffect(() => {
    const checkUser = async () => {
      try {
        setPageNotice('')

        const { data: { user }, error } = await supabase.auth.getUser()

        if (error) {
          if (error.name !== 'AuthSessionMissingError') {
            console.error('세션 확인 오류:', error)
          }
          router.replace('/')
          return
        }

        if (!user) {
          router.replace('/')
          return
        }

        setUser(user)

        const settings = await loadUserSettings(user.id)

        // AuthGate already verifies the shared Jace AI Hub PIN before this
        // dashboard mounts. Do not ask for the same PIN again inside budget.
        setIsUnlocked(true)

        setIsLockReady(true)

        const { data: profile } = await supabase
          .from('budget_profiles')
          .select('nickname')
          .eq('user_id', user.id)
          .single()

        if (profile?.nickname) {
          setNickname(profile.nickname)
          setNewNickname(profile.nickname)
        } else {
          setShowNicknameInput(true)
        }

        const autoAnalyzeKey = `ai-budget:${user.id}:autoAnalyzeEnabled`
        const autoQuestionKey = `ai-budget:${user.id}:autoQuestion`
        const savedAuto = localStorage.getItem(autoAnalyzeKey) ?? localStorage.getItem('autoAnalyzeEnabled')

        if (savedAuto === 'true' || savedAuto === 'false') {
          setAutoAnalyzeEnabled(savedAuto === 'true')
        }

        const savedQuestion = localStorage.getItem(autoQuestionKey) ?? localStorage.getItem('autoQuestion')
        if (savedQuestion?.trim()) setAutoQuestion(savedQuestion)

        Promise.allSettled([
          fetchTransactions(),
          fetchSavings(),
          fetchIncome(),
          fetchRecurringExpensePreferences()
        ])
      } catch (error) {
        console.error('초기 로딩 오류:', error)
        setPageNotice('앱 데이터를 불러오는 중 문제가 발생했어요. 잠시 후 다시 시도해주세요.')
        router.replace('/')
      } finally {
        setLoading(false)
        setAppReady(true)
      }
    }

    checkUser()
  }, [])

  useEffect(() => {
    if (!user?.id) return

    localStorage.setItem(`ai-budget:${user.id}:autoAnalyzeEnabled`, JSON.stringify(autoAnalyzeEnabled))
    localStorage.setItem(`ai-budget:${user.id}:autoQuestion`, autoQuestion)
  }, [user?.id, autoAnalyzeEnabled, autoQuestion])

  useEffect(() => {
    if (!user?.id) return

    let cancelled = false

    const loadBudget = async () => {
      setBudgetLoading(true)
      const budgetMonth = `${selectedMonth}-01`

      const [monthlyResult, categoryResult] = await Promise.all([
        supabase
          .from('budget_monthly_budgets')
          .select('total_amount')
          .eq('user_id', user.id)
          .eq('budget_month', budgetMonth)
          .maybeSingle(),
        supabase
          .from('budget_category_budgets')
          .select('category, amount')
          .eq('user_id', user.id)
          .eq('budget_month', budgetMonth)
      ])

      if (cancelled) return

      if (monthlyResult.error || categoryResult.error) {
        console.error('예산 조회 오류:', monthlyResult.error || categoryResult.error)
        setMonthlyBudget(null)
        setBudgetInput('')
        setCategoryBudgets({})
        setCategoryBudgetInputs({})
        setActionError('선택한 달의 예산을 불러오지 못했어요.')
        setBudgetLoading(false)
        return
      }

      const loadedBudget = monthlyResult.data ? Number(monthlyResult.data.total_amount) : null
      const loadedCategories = (categoryResult.data || []).reduce((acc: Record<string, number>, item: any) => {
        acc[item.category] = Number(item.amount)
        return acc
      }, {})

      setMonthlyBudget(loadedBudget)
      setBudgetInput(loadedBudget && loadedBudget > 0 ? String(loadedBudget) : '')
      setCategoryBudgets(loadedCategories)
      setCategoryBudgetInputs(BUDGET_CATEGORIES.reduce((acc, category) => {
        acc[category] = loadedCategories[category] > 0 ? String(loadedCategories[category]) : ''
        return acc
      }, {} as Record<string, string>))
      setShowBudgetEditor(!loadedBudget)
      setBudgetLoading(false)
    }

    loadBudget()

    return () => {
      cancelled = true
    }
  }, [user?.id, selectedMonth])

  useEffect(() => {
    if (!user?.id || !passkeySupported) {
      setPasskeys([])
      return
    }

    refreshPasskeys()
  }, [user?.id, passkeySupported])

  useEffect(() => {
    if (!actionError) return

    const timer = window.setTimeout(() => {
      setActionError('')
    }, 2500)

    return () => window.clearTimeout(timer)
  }, [actionError])

  useEffect(() => {
    if (!isLockReady) return
    if (!user) return
    if (!simplePinEnabled) return
    if (!hasSimplePin) return

    const updateActivity = () => {
      if (isUnlocked) {
        setLastActiveAt(Date.now())
      }
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        if (isUnlocked) {
          lockScreen()
        }
        return
      }

      if (document.visibilityState === 'visible') {
        if (!(user && simplePinEnabled && hasSimplePin)) return
        if (!isUnlocked) return

        const now = Date.now()
        const diff = now - lastActiveAt

        if (diff >= LOCK_TIMEOUT) {
          lockScreen()
        } else {
          setLastActiveAt(now)
        }
      }
    }

    window.addEventListener('mousemove', updateActivity)
    window.addEventListener('mousedown', updateActivity)
    window.addEventListener('keydown', updateActivity)
    window.addEventListener('touchstart', updateActivity)
    window.addEventListener('click', updateActivity)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('mousemove', updateActivity)
      window.removeEventListener('mousedown', updateActivity)
      window.removeEventListener('keydown', updateActivity)
      window.removeEventListener('touchstart', updateActivity)
      window.removeEventListener('click', updateActivity)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [isLockReady, user, simplePinEnabled, hasSimplePin, isUnlocked, lastActiveAt, LOCK_TIMEOUT])

  const fetchTransactions = async () => {
    const { data: authData } = await supabase.auth.getUser()
    const currentUser = authData.user

    if (!currentUser) {
      setTransactions([])
      setRecurringTransactions([])
      return
    }

    const startOfMonth = new Date()
    startOfMonth.setDate(1)
    startOfMonth.setHours(0, 0, 0, 0)

    const recurringStartDate = new Date(startOfMonth)
    recurringStartDate.setMonth(recurringStartDate.getMonth() - 2)

    const normalizeTransaction = (item: any) => ({
      ...item,
      payment: item.payment || '체크카드',
      transaction_type: item.transaction_type || '일반 지출'
    })

    const { data, error } = await supabase
      .from('budget_transactions')
      .select('*')
      .eq('user_id', currentUser.id)
      .gte('date', startOfMonth.toISOString().split('T')[0])
      .order('date', { ascending: false })

    const { data: recurringData, error: recurringError } = await supabase
      .from('budget_transactions')
      .select('*')
      .eq('user_id', currentUser.id)
      .gte('date', recurringStartDate.toISOString().split('T')[0])
      .order('date', { ascending: false })

    if (error || recurringError) {
      console.error('transactions 조회 오류:', error || recurringError)
      setDataLoadError('일부 데이터를 불러오지 못했어요. 네트워크 상태를 확인한 뒤 다시 시도해주세요.')
      return
    }

    setDataLoadError('')
    setTransactions((data || []).map(normalizeTransaction))
    setRecurringTransactions((recurringData || []).map(normalizeTransaction))
  }

  const fetchRecurringExpensePreferences = async () => {
    const { data: authData } = await supabase.auth.getUser()
    const currentUser = authData.user

    if (!currentUser) {
      setRecurringExpensePreferences([])
      return
    }

    const { data, error } = await supabase
      .from('budget_recurring_expense_preferences')
      .select('signature, name, category, status, average_amount, last_detected_on')
      .eq('user_id', currentUser.id)
      .order('updated_at', { ascending: false })

    if (error) {
      console.error('반복지출 설정 조회 오류:', error)
      setActionError('반복지출 관리 정보를 불러오지 못했어요.')
      return
    }

    setRecurringExpensePreferences(data || [])
  }

  const saveRecurringExpenseDecision = async (item: any, status: 'confirmed' | 'excluded') => {
    if (!user?.id || recurringDecisionSavingKey) return

    const signature = item.key || item.signature
    if (!signature) return

    setRecurringDecisionSavingKey(signature)
    setActionError('')

    const preference = {
      user_id: user.id,
      signature,
      name: item.place || item.name || '미분류',
      category: item.category || '기타',
      status,
      average_amount: Math.max(0, Math.round(Number(item.avgAmount ?? item.average_amount) || 0)),
      last_detected_on: item.lastDate || item.last_detected_on || null,
      updated_at: new Date().toISOString()
    }

    const { data, error } = await supabase
      .from('budget_recurring_expense_preferences')
      .upsert(preference, { onConflict: 'user_id,signature' })
      .select('signature, name, category, status, average_amount, last_detected_on')
      .single()

    if (error || !data) {
      console.error('반복지출 설정 저장 오류:', error)
      setActionError('반복지출 설정을 저장하지 못했어요.')
      setRecurringDecisionSavingKey('')
      return
    }

    setRecurringExpensePreferences((current) => [
      data,
      ...current.filter((saved) => saved.signature !== signature)
    ])
    setPageNotice(status === 'confirmed' ? '반복지출로 확정했어요.' : '이 후보를 분석에서 제외했어요.')
    setRecurringDecisionSavingKey('')
  }

  const restoreRecurringExpenseCandidate = async (signature: string) => {
    if (!user?.id || recurringDecisionSavingKey) return

    setRecurringDecisionSavingKey(signature)
    setActionError('')

    const { error } = await supabase
      .from('budget_recurring_expense_preferences')
      .delete()
      .eq('user_id', user.id)
      .eq('signature', signature)

    if (error) {
      console.error('반복지출 설정 복원 오류:', error)
      setActionError('반복지출 설정을 되돌리지 못했어요.')
      setRecurringDecisionSavingKey('')
      return
    }

    setRecurringExpensePreferences((current) =>
      current.filter((saved) => saved.signature !== signature)
    )
    setPageNotice('자동 감지 후보로 되돌렸어요.')
    setRecurringDecisionSavingKey('')
  }

  const fetchSavings = async () => {
    const { data: authData } = await supabase.auth.getUser()
    const currentUser = authData.user

    if (!currentUser) {
      setSavings([])
      return
    }

    const { data, error } = await supabase
      .from('budget_savings')
      .select('*')
      .eq('user_id', currentUser.id)
      .order('date', { ascending: false })

    if (error) {
      console.error('savings 조회 오류:', error)
      setDataLoadError('일부 데이터를 불러오지 못했어요. 네트워크 상태를 확인한 뒤 다시 시도해주세요.')
      return
    }

    setDataLoadError('')
    setSavings(data || [])
  }

  const fetchIncome = async () => {
    const { data: authData } = await supabase.auth.getUser()
    const currentUser = authData.user

    if (!currentUser) {
      setIncomeList([])
      return
    }

    const { data, error } = await supabase
      .from('budget_income')
      .select('*')
      .eq('user_id', currentUser.id)
      .order('date', { ascending: false })

    if (error) {
      console.error('income 조회 오류:', error)
      setDataLoadError('일부 데이터를 불러오지 못했어요. 네트워크 상태를 확인한 뒤 다시 시도해주세요.')
      return
    }

    setDataLoadError('')
    setIncomeList(data || [])
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  const handleChangePassword = async () => {
    setActionError('')
    setPageNotice('')
    if (settingsSavingAction) return

    if (!user?.email) {
      setActionError('로그인 정보를 확인할 수 없어요.')
      return
    }

    if (!currentPassword.trim()) {
      setActionError('기존 암호를 입력해주세요.')
      return
    }

    if (!newPassword.trim()) {
      setActionError('새 암호를 입력해주세요.')
      return
    }

    if (newPassword.length < 6) {
      setActionError('암호는 6자 이상으로 입력해주세요.')
      return
    }

    if (currentPassword === newPassword) {
      setActionError('기존 암호와 다른 새 암호를 입력해주세요.')
      return
    }

    setSettingsSavingAction('password')
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword
      })

      if (signInError) {
        setActionError('기존 암호가 올바르지 않아요.')
        return
      }

      const { error } = await supabase.auth.updateUser({
        password: newPassword
      })

      if (error) throw error

      setCurrentPassword('')
      setNewPassword('')
      setPageNotice('암호가 변경되었어요.')
    } catch (error: any) {
      setActionError(`암호 변경 오류: ${error.message || '잠시 후 다시 시도해주세요.'}`)
    } finally {
      setSettingsSavingAction('')
    }
  }

  const handleSetSimplePin = async () => {
    setActionError('')
    setPageNotice('')

    if (!user?.id) {
      setActionError('로그인 정보를 확인할 수 없어요.')
      return
    }

    if (!simplePinEnabled) {
      setActionError('먼저 공통 PIN 사용을 켜주세요.')
      return
    }

    if (settingsSavingAction) return

    const isChangingPin = hasSimplePin

    if (isChangingPin && !currentSimplePin.trim()) {
      setActionError('기존 공통 PIN를 입력해주세요.')
      return
    }

    if (!/^\d{6}$/.test(simplePin)) {
      setActionError('공통 PIN은 6자리 숫자로 입력해주세요.')
      return
    }

    if (simplePin !== simplePinConfirm) {
      setActionError('새 공통 PIN와 확인 입력이 서로 일치하지 않아요.')
      setSimplePinConfirm('')
      return
    }

    setSettingsSavingAction('pin')

    try {
      await callPinApi({
        action: 'set',
        currentPin: currentSimplePin,
        newPin: simplePin
      })

      setHasSimplePin(true)
      setSimplePinEnabled(true)
      setIsUnlocked(true)
      setIsLockReady(true)
      setLastActiveAt(Date.now())
      setUnlockError('')
      setUnlockPinInput('')
      setCurrentSimplePin('')
      setSimplePin('')
      setSimplePinConfirm('')
      setPageNotice(isChangingPin ? '공통 PIN가 변경되었어요.' : '공통 PIN가 안전하게 저장되었어요.')
    } catch (error) {
      const pinError = error as Error & { status?: number }
      setActionError(pinError.message)

      if (pinError.status === 423) {
        lockScreen()
        setUnlockRequiresPassword(true)
      }
    } finally {
      setSettingsSavingAction('')
    }
  }

  const saveMonthlyBudget = async () => {
    setActionError('')
    setPageNotice('')

    if (!user?.id) {
      setActionError('로그인 정보를 확인할 수 없어요.')
      return
    }

    const totalAmount = Number(budgetInput.replace(/[^0-9]/g, ''))
    if (!Number.isSafeInteger(totalAmount) || totalAmount <= 0) {
      setActionError('월 예산을 1원 이상 입력해주세요.')
      return
    }

    const normalizedCategories = BUDGET_CATEGORIES.reduce((acc, category) => {
      const amount = Number((categoryBudgetInputs[category] || '').replace(/[^0-9]/g, ''))
      acc[category] = Number.isSafeInteger(amount) && amount > 0 ? amount : 0
      return acc
    }, {} as Record<string, number>)

    const categoryBudgetTotal = Object.values(normalizedCategories).reduce((sum, amount) => sum + amount, 0)
    if (categoryBudgetTotal > totalAmount) {
      setActionError(`카테고리 예산 합계가 월 예산보다 ${formatKRW(categoryBudgetTotal - totalAmount)} 많아요.`)
      return
    }

    setBudgetSaving(true)
    const budgetMonth = `${selectedMonth}-01`
    const updatedAt = new Date().toISOString()

    try {
      const { error: monthlyError } = await supabase
        .from('budget_monthly_budgets')
        .upsert({
          user_id: user.id,
          budget_month: budgetMonth,
          total_amount: totalAmount,
          updated_at: updatedAt
        }, {
          onConflict: 'user_id,budget_month'
        })

      if (monthlyError) throw monthlyError

      const positiveRows = Object.entries(normalizedCategories)
        .filter(([, amount]) => amount > 0)
        .map(([category, amount]) => ({
          user_id: user.id,
          budget_month: budgetMonth,
          category,
          amount,
          updated_at: updatedAt
        }))

      if (positiveRows.length > 0) {
        const { error: upsertError } = await supabase
          .from('budget_category_budgets')
          .upsert(positiveRows, {
            onConflict: 'user_id,budget_month,category'
          })

        if (upsertError) throw upsertError
      }

      const emptyCategories = Object.entries(normalizedCategories)
        .filter(([, amount]) => amount === 0)
        .map(([category]) => category)

      if (emptyCategories.length > 0) {
        const { error: deleteError } = await supabase
          .from('budget_category_budgets')
          .delete()
          .eq('user_id', user.id)
          .eq('budget_month', budgetMonth)
          .in('category', emptyCategories)

        if (deleteError) throw deleteError
      }

      setMonthlyBudget(totalAmount)
      setCategoryBudgets(normalizedCategories)
      setShowBudgetEditor(false)
      setPageNotice(`${selectedMonth.replace('-', '년 ')}월 예산이 저장되었어요.`)
    } catch (error: any) {
      console.error('예산 저장 오류:', error)
      setActionError(`예산 저장 오류: ${error.message || '잠시 후 다시 시도해주세요.'}`)
    } finally {
      setBudgetSaving(false)
    }
  }

  const saveCurrencySetting = async (value: string) => {
    setActionError('')
    setPageNotice('')

    if (!user?.id) {
      setActionError('로그인 정보를 확인할 수 없어요.')
      return
    }

    const { error } = await supabase
      .from('budget_user_settings')
      .upsert({
        user_id: user.id,
        currency: value
      }, {
        onConflict: 'user_id'
      })

    if (error) {
      setActionError(`통화 저장 오류: ${error.message}`)
      return
    }

    setCurrency(value)
    setPageNotice('통화 설정이 저장되었어요.')
  }

  const saveNotificationSettings = async (
    nextNotificationsEnabled: boolean,
    nextBudgetAlertEnabled: boolean
  ) => {
    setActionError('')
    setPageNotice('')

    if (!user?.id) {
      setActionError('로그인 정보를 확인할 수 없어요.')
      return
    }

    if (nextNotificationsEnabled) {
      const permissionGranted = await ensureNotificationPermission()
      if (!permissionGranted) {
        setActionError(
          notificationPermission === 'unsupported'
            ? '이 브라우저는 알림을 지원하지 않아요. 아이폰에서는 홈 화면에 추가한 뒤 다시 시도해주세요.'
            : '브라우저 알림 권한이 필요해요. 기기 설정에서 AI 가계부 알림을 허용해주세요.'
        )
        return
      }
    }

    const { error } = await supabase
      .from('budget_user_settings')
      .upsert({
        user_id: user.id,
        notifications_enabled: nextNotificationsEnabled,
        budget_alert_enabled: nextBudgetAlertEnabled
      }, {
        onConflict: 'user_id'
      })
  
    if (error) {
      setActionError(`알림 설정 저장 오류: ${error.message}`)
      return
    }
  
    setNotificationsEnabled(nextNotificationsEnabled)
    setBudgetAlertEnabled(nextBudgetAlertEnabled)
    setPageNotice('알림 설정이 저장되었어요.')
  }

  const loadUserSettings = async (userId: string) => {
    const { data, error } = await supabase
      .from('budget_user_settings')
      .select('currency, notifications_enabled, budget_alert_enabled, simple_pin_enabled')
      .eq('user_id', userId)
      .single()

    if (error || !data) {
      return null
    }

    setCurrency(data.currency || 'KRW')
    setNotificationsEnabled(data.notifications_enabled ?? true)
    setBudgetAlertEnabled(data.budget_alert_enabled ?? true)
    setSimplePinEnabled(data.simple_pin_enabled ?? false)
    setHasSimplePin(Boolean(data.simple_pin_enabled))

    return data
  }

  const handleUnlock = async () => {
    setUnlockError('')

    if (unlockRequiresPassword ? !unlockAccountPassword.trim() : !unlockPinInput.trim()) {
      setUnlockError(unlockRequiresPassword ? '계정 암호를 입력해주세요.' : '공통 PIN를 입력해주세요.')
      setUnlockPinInput('')
      await triggerLockErrorFeedback()
      window.setTimeout(() => {
        unlockPinInputRef.current?.focus()
      }, 40)
      return
    }

    try {
      await callPinApi(unlockRequiresPassword
        ? { action: 'reauthenticate', accountPassword: unlockAccountPassword }
        : { action: 'verify', pin: unlockPinInput })

      setUnlockSuccess(true)
      setUnlockError('')
      await triggerLockSuccessFeedback()

      window.setTimeout(() => {
        setIsUnlocked(true)
        setUnlockSuccess(false)
        setUnlockPinInput('')
        setUnlockAccountPassword('')
        setUnlockRequiresPassword(false)
        setLastActiveAt(Date.now())
      }, 320)
    } catch (error) {
      const pinError = error as Error & { status?: number }
      setUnlockError(pinError.message)
      setUnlockPinInput('')
      setUnlockAccountPassword('')

      if (pinError.status === 423) {
        setUnlockRequiresPassword(true)
      }

      await triggerLockErrorFeedback()
      window.setTimeout(() => {
        unlockPinInputRef.current?.focus()
      }, 40)
    }
  }

  const refreshPasskeys = async () => {
    if (!user?.id) return

    const { data, error } = await supabase.auth.passkey.list()
    if (error) {
      setPasskeys([])
      return
    }

    setPasskeys(data || [])
  }

  const handleRegisterPasskey = async () => {
    if (!user?.id || passkeyBusy || !passkeySupported) return

    setActionError('')
    setPageNotice('')
    setPasskeyBusy(true)

    try {
      const { data, error } = await supabase.auth.registerPasskey()
      if (error) throw error

      if (data?.id) {
        await supabase.auth.passkey.update({
          passkeyId: data.id,
          friendlyName: 'AI 가계부 생체인증'
        })
      }

      await refreshPasskeys()
      setPageNotice('이 기기의 얼굴·지문 인증이 등록되었어요.')
    } catch (error: any) {
      if (error?.code !== 'webauthn_ceremony_cancelled') {
        setActionError('생체인증을 등록하지 못했어요. 기기 잠금과 브라우저 설정을 확인해주세요.')
      }
    } finally {
      setPasskeyBusy(false)
    }
  }

  const handleDeletePasskey = async (passkeyId: string) => {
    if (passkeyBusy) return

    setActionError('')
    setPageNotice('')
    setPasskeyBusy(true)

    try {
      const { error } = await supabase.auth.passkey.delete({ passkeyId })
      if (error) throw error

      await refreshPasskeys()
      setPageNotice('등록된 생체인증을 삭제했어요.')
    } catch {
      setActionError('생체인증 정보를 삭제하지 못했어요.')
    } finally {
      setPasskeyBusy(false)
    }
  }

  const handlePasskeyUnlock = async () => {
    if (!user?.id || passkeyBusy) return

    const lockedUserId = user.id
    setUnlockError('')
    setPasskeyBusy(true)

    try {
      const { data, error } = await supabase.auth.signInWithPasskey()
      if (error) throw error

      if (!data.user || data.user.id !== lockedUserId) {
        await supabase.auth.signOut()
        router.replace('/')
        router.refresh()
        return
      }

      setUnlockSuccess(true)
      await triggerLockSuccessFeedback()
      window.setTimeout(() => {
        setIsUnlocked(true)
        setUnlockSuccess(false)
        setLastActiveAt(Date.now())
      }, 250)
    } catch (error: any) {
      if (error?.code !== 'webauthn_ceremony_cancelled') {
        setUnlockError('생체인증에 실패했어요. 공통 PIN로 다시 시도해주세요.')
        await triggerLockErrorFeedback()
      }
    } finally {
      setPasskeyBusy(false)
    }
  }

  const handleToggleSimplePinEnabled = async (checked: boolean) => {
    setActionError('')
    setPageNotice('')

    if (!user?.id) {
      setActionError('로그인 정보를 확인할 수 없어요.')
      return
    }

    if (checked) {
      setSimplePinEnabled(true)
      setUnlockError('')
      setPageNotice('공통 PIN 사용이 켜졌어요. 아래에서 비밀번호를 설정해주세요.')
      return
    }

    if (!hasSimplePin) {
      setSimplePinEnabled(false)
      return
    }

    if (!currentSimplePin.trim()) {
      setActionError('기존 공통 PIN를 입력해주세요.')
      return
    }

    if (settingsSavingAction) return
    setSettingsSavingAction('pin')

    try {
      await callPinApi({
        action: 'disable',
        currentPin: currentSimplePin
      })

      setSimplePinEnabled(false)
      setHasSimplePin(false)
      setCurrentSimplePin('')
      setSimplePin('')
      setSimplePinConfirm('')
      setUnlockPinInput('')
      setUnlockError('')
      setIsUnlocked(true)
      setPageNotice('공통 PIN가 해제되었어요.')
    } catch (error) {
      const pinError = error as Error & { status?: number }
      setActionError(pinError.message)

      if (pinError.status === 423) {
        lockScreen()
        setUnlockRequiresPassword(true)
      }
    } finally {
      setSettingsSavingAction('')
    }
  }

  const saveNickname = async () => {
    setActionError('')
    setPageNotice('')

    if (!newNickname.trim()) {
      setActionError('닉네임을 입력해주세요.')
      return
    }

    if (settingsSavingAction) return
    setSettingsSavingAction('nickname')

    try {
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) {
        setActionError('로그인이 필요합니다.')
        return
      }

      const { data: existingProfile, error: selectError } = await supabase
        .from('budget_profiles')
        .select('user_id')
        .eq('user_id', user.id)
        .maybeSingle()

      if (selectError) throw selectError

      const { error } = existingProfile
        ? await supabase.from('budget_profiles').update({ nickname: newNickname.trim() }).eq('user_id', user.id)
        : await supabase.from('budget_profiles').insert({ user_id: user.id, nickname: newNickname.trim() })

      if (error) throw error

      setNickname(newNickname.trim())
      setShowNicknameInput(false)
      setPageNotice('닉네임이 저장되었어요.')
    } catch (error: any) {
      console.error('닉네임 저장 오류:', error)
      setActionError(`닉네임 저장 오류: ${error.message || '잠시 후 다시 시도해주세요.'}`)
    } finally {
      setSettingsSavingAction('')
    }
  }

  const parseInput = async (text: string) => {
    const normalizeItems = (rawItems: any[]) => {
      const items = rawItems
        .filter((item: any) => item && item.amount)
        .map((item: any) => {
          const type = item.type === 'income' ? 'income' : item.type === 'saving' ? 'saving' : 'expense'
          const itemRuleText = `${item.place || ''} ${item.memo || ''} ${item.category || ''}`.trim()
          const categoryRuleText = rawItems.length === 1 ? `${itemRuleText} ${text}`.trim() : (itemRuleText || text)
          const expenseRuleText = hasLocalExpenseMetaSignal(itemRuleText) ? itemRuleText : text
          const localExpenseCategory = type === 'expense' ? detectLocalExpenseCategory(categoryRuleText) : ''
          const expenseMeta = type === 'expense' ? inferExpenseMeta(expenseRuleText, item.payment, item.transaction_type) : { payment: '', transaction_type: '' }

          return {
            type,
            date: item.date || new Date().toISOString().split('T')[0],
            amount: Number(item.amount) || 0,
            place: item.place || (type === 'income' ? '수입' : type === 'saving' ? '일반저축' : '미분류'),
            category: type === 'income'
              ? (item.category || '기타수입')
              : type === 'saving'
                ? '저축'
                : (localExpenseCategory !== '기타' ? localExpenseCategory : (item.category || '기타')),
            payment: type === 'income' || type === 'saving' ? '' : expenseMeta.payment,
            transaction_type: type === 'expense' ? expenseMeta.transaction_type : '',
            memo: item.memo || '',
            feedback: item.feedback || ''
          }
        })
        .filter((item: any) => item.amount > 0)

      if (!items.length) throw new Error('거래를 찾지 못했어요.')

      return items
    }

    try {
      const system = PARSE_SYSTEM.replace('DATE_PLACEHOLDER', new Date().toISOString().split('T')[0])

      const res = await authenticatedFetch(`${API_BASE_URL}/api/claude`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: text }],
          system
        })
      })

      const data = await res.json()
      const raw = data.content?.[0]?.text || ''
      const clean = raw.replace(/```json|```/g, '').trim()
      const jsonMatch = clean.match(/\{[\s\S]*\}/)

      if (!jsonMatch) throw new Error('JSON 파싱 실패')

      const parsed = JSON.parse(jsonMatch[0])

      let items = Array.isArray(parsed?.items) ? parsed.items : []

      if (!items.length && parsed?.type) {
        items = [parsed]
      }

      return normalizeItems(items)
    } catch {
      const fallbackItems = parseInputLocally(text)
      return normalizeItems(fallbackItems)
    }
  }

  const handleAddTransaction = async () => {
    if (!input.trim()) return
    setAiLoading(true)
    setFeedback('')

    try {
      const parsed = await parseInput(input)
      setParsedItems(parsed)
      setShowConfirm(true)
    } catch {
      setFeedback('입력 내용을 완전히 해석하지 못했어요. 내용을 조금만 다듬어서 다시 해석해보세요.')
    }

    setAiLoading(false)
  }

  const updateParsedItem = (index: number, patch: Record<string, unknown>) => {
    setParsedItems((current) => current.map((item, itemIndex) => (
      itemIndex === index ? { ...item, ...patch } : item
    )))
  }

  const handleConfirmSave = async () => {
    if (!parsedItems.length || isSavingRecords) return

    if (!user?.id) {
      setFeedback('로그인 정보를 확인할 수 없어요.')
      return
    }

    const hasInvalidItem = parsedItems.some((item) => (
      !item.place?.trim()
      || !Number.isFinite(Number(item.amount))
      || Number(item.amount) <= 0
      || !/^\d{4}-\d{2}-\d{2}$/.test(item.date || '')
    ))

    if (hasInvalidItem) {
      setFeedback('날짜, 이름, 금액을 다시 확인해주세요. 금액은 0원보다 커야 해요.')
      return
    }

    setIsSavingRecords(true)
    setFeedback('')

    try {
      for (const item of parsedItems) {
        if (item.type === 'income') {
          const { error } = await supabase
            .from('budget_income')
            .insert([{
              user_id: user.id,
              date: item.date,
              amount: Number(item.amount),
              name: item.place.trim(),
              memo: item.memo?.trim() || ''
            }])

          if (error) throw error
        } else if (item.type === 'saving') {
          const { error } = await supabase
            .from('budget_savings')
            .insert([{
              user_id: user.id,
              date: item.date,
              amount: Number(item.amount),
              goal_name: item.place.trim() || '일반저축',
              memo: item.memo?.trim() || ''
            }])

          if (error) throw error
        } else {
          const { error } = await supabase
            .from('budget_transactions')
            .insert([{
              user_id: user.id,
              date: item.date,
              amount: Number(item.amount),
              place: item.place.trim(),
              category: item.category || '기타',
              payment: item.payment || '체크카드',
              transaction_type: item.transaction_type || '일반 지출',
              memo: item.memo?.trim() || ''
            }])

          if (error) throw error
        }
      }

      await Promise.all([
        fetchIncome(),
        fetchTransactions(),
        fetchSavings(),
      ])

      setFeedback(parsedItems.length + '건을 저장했어요.')
      setShowConfirm(false)
      setParsedItems([])
      setInput('')
    } catch (e) {
      console.error('저장 중 오류:', e)
      setFeedback('저장 중 오류가 발생했어요. 저장된 내역이 있는지 상세 내역에서 확인해주세요.')
    } finally {
      setIsSavingRecords(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!user?.id || processingRecordKey) return

    setProcessingRecordKey(`expense:${id}`)
    setActionError('')

    try {
      const { error } = await supabase
        .from('budget_transactions')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id)

      if (error) throw error

      await fetchTransactions()
      setPageNotice('지출 내역을 삭제했어요.')
    } catch (error) {
      console.error('transactions 삭제 오류:', error)
      setActionError('지출 내역 삭제에 실패했어요. 다시 시도해주세요.')
    } finally {
      setProcessingRecordKey('')
    }
  }

  const handleDeleteIncome = async (id: string) => {
    if (!user?.id || processingRecordKey) return

    setProcessingRecordKey(`income:${id}`)
    setActionError('')

    try {
      const { error } = await supabase
        .from('budget_income')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id)

      if (error) throw error

      await fetchIncome()
      setPageNotice('수입 내역을 삭제했어요.')
    } catch (error) {
      console.error('income 삭제 오류:', error)
      setActionError('수입 내역 삭제에 실패했어요. 다시 시도해주세요.')
    } finally {
      setProcessingRecordKey('')
    }
  }

  const handleDeleteSaving = async (id: string) => {
    if (!user?.id || processingRecordKey) return

    setProcessingRecordKey(`saving:${id}`)
    setActionError('')

    try {
      const { error } = await supabase
        .from('budget_savings')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id)

      if (error) throw error

      await fetchSavings()
      setPageNotice('저축 내역을 삭제했어요.')
    } catch (error) {
      console.error('savings 삭제 오류:', error)
      setActionError('저축 내역 삭제에 실패했어요. 다시 시도해주세요.')
    } finally {
      setProcessingRecordKey('')
    }
  }

  const handleResetAllData = async () => {
    if (!user?.email) {
      alert('로그인 정보를 확인할 수 없어요.')
      return
    }

    if (!resetPassword.trim()) {
      alert('비밀번호를 입력해주세요.')
      return
    }

    const ok = window.confirm('정말 모든 기록을 초기화할까요? 이 작업은 되돌릴 수 없어요.')
    if (!ok) return

    setResetLoading(true)

    const { error } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: resetPassword
    })

    if (error) {
      setResetLoading(false)
      alert('비밀번호가 올바르지 않아요.')
      return
    }

    try {
      for (const item of transactions) {
        const { error } = await supabase
          .from('budget_transactions')
          .delete()
          .eq('id', item.id)
          .eq('user_id', user.id)

        if (error) throw error
      }

      for (const item of incomeList) {
        const { error } = await supabase
          .from('budget_income')
          .delete()
          .eq('id', item.id)
          .eq('user_id', user.id)

        if (error) throw error
      }

      for (const item of savings) {
        const { error } = await supabase
          .from('budget_savings')
          .delete()
          .eq('id', item.id)
          .eq('user_id', user.id)

        if (error) throw error
      }


      await fetchTransactions()
      await fetchIncome()
      await fetchSavings()

      setShowResetConfirm(false)
      setResetPassword('')
      setParsedItems([])
      setShowConfirm(false)
      setFeedback('')
      setAiAnswer('')
      setInput('')
      setQuestion('')

      alert('모든 기록이 초기화되었어요.')
    } catch (e) {
      console.error(e)
      alert('초기화 중 오류가 발생했어요.')
    } finally {
      setResetLoading(false)
    }
  }

  const playGoogleTTS = async (text: string) => {
    try {
      const cleanText = text
        .replace(/\*\*/g, '')
        .replace(/\*/g, '')
        .replace(/^\* /gm, '')
        .replace(/#{1,6}\s/g, '')
        .replace(/😊|😄|😅|🎉|✓|✗|⚠️|💰|📊|🔒|🎯/g, '')
        .replace(/(\d{4})-(\d{2})-(\d{2})/g, '$1년 $2월 $3일')
        .replace(/[_~`]/g, '')
        .trim()

      const res = await authenticatedFetch(`${API_BASE_URL}/api/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: cleanText })
      })

      const data = await res.json()
      if (data.audioContent) {
        const audio = new Audio(`data:audio/mp3;base64,${data.audioContent}`)
        audio.play()
      }
    } catch (e) {
      console.error('TTS 오류', e)
    }
  }

  const handleAnalyze = async () => {
    if (!question.trim()) return
    setAnalyzing(true)

    try {
      await buildExpenseAnswer(question)
    } catch (error) {
      console.error('AI 질문 처리 오류:', error)
      setAiAnswer('AI 답변을 불러오지 못했어요. 잠시 후 다시 질문해주세요.')
      setAiFollowUpQuestions([])
    } finally {
      setAnalyzing(false)
    }
  }

  const handleSuggestedQuestion = async (q: string) => {
    setQuestion(q)
    setAnalyzing(true)

    try {
      await buildExpenseAnswer(q)
    } catch (error) {
      console.error('AI 추천 질문 처리 오류:', error)
      setAiAnswer('AI 답변을 불러오지 못했어요. 잠시 후 다시 질문해주세요.')
      setAiFollowUpQuestions([])
    } finally {
      setAnalyzing(false)
    }
  }

  useEffect(() => {
    if (tab !== 'analysis' || analysisView !== 'ai') return
    if (!autoAnalyzeEnabled) return
    if (!autoQuestion.trim()) return
    if (autoAnalyzeRan) return
    if (transactions.length === 0 && incomeList.length === 0 && savings.length === 0) return

    handleSuggestedQuestion(autoQuestion)
    setAutoAnalyzeRan(true)
  }, [tab, analysisView, autoAnalyzeEnabled, autoQuestion, autoAnalyzeRan, transactions.length, incomeList.length, savings.length])

  const runWebSpeechRecognition = (onText: (text: string) => Promise<void> | void) => {
    const WebSpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition

    if (!WebSpeechRecognition) {
      alert('이 브라우저는 음성 인식을 지원하지 않아요.')
      return
    }

    const recognition = new WebSpeechRecognition()
    recognition.lang = 'ko-KR'
    recognition.interimResults = false
    recognition.onstart = () => setListening(true)
    recognition.onend = () => setListening(false)
    recognition.onerror = () => {
      setListening(false)
      alert('음성 인식 중 오류가 발생했어요.')
    }
    recognition.onresult = async (e: any) => {
      const text = e.results?.[0]?.[0]?.transcript?.trim() || ''
      if (!text) return
      await onText(text)
    }

    recognition.start()
  }

  const runNativeSpeechRecognition = async (onText: (text: string) => Promise<void> | void) => {
    try {
      const { available } = await SpeechRecognition.available()

      if (!available) {
        alert('이 기기에서는 음성 인식을 사용할 수 없어요.')
        return
      }

      const permission = await SpeechRecognition.checkPermissions()

      if (permission.speechRecognition !== 'granted') {
        const requested = await SpeechRecognition.requestPermissions()

        if (requested.speechRecognition !== 'granted') {
          alert('마이크 권한이 허용되지 않았어요.')
          return
        }
      }

      setListening(true)

      const result = await SpeechRecognition.start({
        language: 'ko-KR',
        maxResults: 1,
        partialResults: false,
        popup: true
      })

      setListening(false)

      const text = result.matches?.[0]?.trim() || ''

      if (!text) {
        alert('음성을 인식하지 못했어요. 다시 시도해주세요.')
        return
      }

      await onText(text)
    } catch (error) {
      setListening(false)
      console.error('네이티브 음성 인식 오류:', error)
      alert('앱 음성 입력 실행 중 오류가 발생했어요.')
    }
  }

  const handleVoiceInput = async () => {
    const onText = async (text: string) => {
      setInput(text)
      setAiLoading(true)
      setFeedback('')

      try {
        const parsed = await parseInput(text)
        setParsedItems(parsed)
        setShowConfirm(true)
      } catch {
        setFeedback('음성 입력은 들어왔지만 해석이 완전하지 않았어요. 문장을 조금 정리해서 다시 해석해보세요.')
      }

      setAiLoading(false)
    }

    if (Capacitor.isNativePlatform()) {
      await runNativeSpeechRecognition(onText)
      return
    }

    runWebSpeechRecognition(onText)
  }

  const handleQuestionVoiceInput = async () => {
    const onText = async (text: string) => {
      setQuestion(text)
      setAnalyzing(true)

      try {
        await buildExpenseAnswer(text)
      } finally {
        setAnalyzing(false)
      }
    }

    if (Capacitor.isNativePlatform()) {
      await runNativeSpeechRecognition(onText)
      return
    }

    runWebSpeechRecognition(onText)
  }

    const [selectedYear, selectedMonthNumber] = selectedMonth.split('-').map(Number)
    const currentYear = selectedYear
    const currentMonth = selectedMonthNumber - 1
    const selectedMonthDate = new Date(currentYear, currentMonth, 1)
    const selectedMonthLabel = `${currentYear}년 ${currentMonth + 1}월`
    const today = new Date()
    const now = today
    const isCurrentMonthSelected =
      today.getFullYear() === currentYear && today.getMonth() === currentMonth

    const isInMonth = (dateValue: string, year: number, month: number) => {
      const [dateYear, dateMonth] = String(dateValue || '').split('-').map(Number)
      return dateYear === year && dateMonth === month + 1
    }

    const selectedTransactions = transactions.filter((item: any) =>
      isInMonth(item.date, currentYear, currentMonth)
    )
    const selectedIncomeList = incomeList.filter((item: any) =>
      isInMonth(item.date, currentYear, currentMonth)
    )
    const selectedSavings = savings.filter((item: any) =>
      isInMonth(item.date, currentYear, currentMonth)
    )

    const allExpenseTotal = transactions.reduce((sum: number, item: any) => sum + item.amount, 0)
    const allIncomeTotal = incomeList.reduce((sum: number, item: any) => sum + item.amount, 0)
    const allSavingsTotal = savings.reduce((sum: number, item: any) => sum + item.amount, 0)

    const total = selectedTransactions.reduce((sum: number, item: any) => sum + item.amount, 0)
    const incomeTotal = selectedIncomeList.reduce((sum: number, item: any) => sum + item.amount, 0)
    const savingsRecordedTotal = selectedSavings.reduce((sum: number, item: any) => sum + item.amount, 0)

    const mobileMicroTotal = selectedTransactions
      .filter((item: any) => item.payment === '휴대폰 소액결제')
      .reduce((sum: number, item: any) => sum + item.amount, 0)
    const prepaidTopupTotal = selectedTransactions
      .filter((item: any) => item.transaction_type === '충전카드 충전')
      .reduce((sum: number, item: any) => sum + item.amount, 0)
    const prepaidSpendTotal = selectedTransactions
      .filter((item: any) => item.transaction_type === '충전카드 사용')
      .reduce((sum: number, item: any) => sum + item.amount, 0)
    const estimatedPrepaidBalance = prepaidTopupTotal - prepaidSpendTotal
    const actualExpenseTotal = selectedTransactions
      .filter((item: any) => item.transaction_type !== '충전카드 충전')
      .reduce((sum: number, item: any) => sum + item.amount, 0)
    const telecomTotal = selectedTransactions
      .filter((item: any) => String(item.category || '').includes('통신') || String(item.place || '').includes('통신요금'))
      .reduce((sum: number, item: any) => sum + item.amount, 0)
    const actualTelecomExpense = Math.max(telecomTotal - mobileMicroTotal, 0)

    const paymentStats = selectedTransactions.reduce((acc: Record<string, number>, item: any) => {
      const key = item.payment || '체크카드'
      acc[key] = (acc[key] || 0) + item.amount
      return acc
    }, {})

    const previousMonthDate = new Date(selectedMonthDate.getFullYear(), selectedMonthDate.getMonth() - 1, 1)
    const previousYear = previousMonthDate.getFullYear()
    const previousMonth = previousMonthDate.getMonth()

    const currentMonthExpenses = total
    const currentMonthIncome = incomeTotal
    const currentMonthSavings = savingsRecordedTotal

    useEffect(() => {
      if (
        !isCurrentMonthSelected
        || !notificationsEnabled
        || notificationPermission !== 'granted'
      ) return

      const monthKey = selectedMonth
      const budget = monthlyBudget || 0
      if (budgetAlertEnabled && budget > 0) {
        const usageRate = currentMonthExpenses / budget
        const threshold = usageRate >= 1 ? 100 : usageRate >= 0.9 ? 90 : 0

        if (threshold > 0) {
          const storageKey = `ai-budget:notification:budget:${monthKey}:${threshold}`
          if (!localStorage.getItem(storageKey)) {
            localStorage.setItem(storageKey, new Date().toISOString())
            void showBrowserNotification(
              threshold >= 100 ? '월 예산을 초과했어요' : '월 예산의 90%를 사용했어요',
              `${selectedMonthLabel} 지출은 ${formatKRW(currentMonthExpenses)} / 예산 ${formatKRW(budget)}예요.`,
              `budget-${monthKey}-${threshold}`
            )
          }
        }
      }

      const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()
      if (today.getDate() === lastDay) {
        const storageKey = `ai-budget:notification:month-end:${monthKey}`
        if (!localStorage.getItem(storageKey)) {
          localStorage.setItem(storageKey, new Date().toISOString())
          void showBrowserNotification(
            '이번 달 가계부를 확인해보세요',
            `${selectedMonthLabel} 월말 리포트가 준비됐어요.`,
            `month-end-${monthKey}`
          )
        }
      }
    }, [
      budgetAlertEnabled,
      currentMonthExpenses,
      isCurrentMonthSelected,
      monthlyBudget,
      notificationPermission,
      notificationsEnabled,
      selectedMonth,
      selectedMonthLabel
    ])

    const previousMonthExpenses = transactions
      .filter((item: any) => isInMonth(item.date, previousYear, previousMonth))
      .reduce((sum: number, item: any) => sum + item.amount, 0)
    const previousMonthIncome = incomeList
      .filter((item: any) => isInMonth(item.date, previousYear, previousMonth))
      .reduce((sum: number, item: any) => sum + item.amount, 0)
    const previousMonthSavings = savings
      .filter((item: any) => isInMonth(item.date, previousYear, previousMonth))
      .reduce((sum: number, item: any) => sum + item.amount, 0)

    const monthlyCompareMax = Math.max(
      currentMonthExpenses,
      previousMonthExpenses,
      currentMonthIncome,
      previousMonthIncome,
      currentMonthSavings,
      previousMonthSavings,
      1
    )

    const recurringSourceTransactions = recurringTransactions.length > 0 ? recurringTransactions : transactions

    const groupedByRecurringKey = recurringSourceTransactions.reduce((acc: Record<string, any[]>, item: any) => {
      const signature = getFixedExpenseSignature(item)
      const key = `${signature.category}:${signature.normalizedName}`
      if (!acc[key]) acc[key] = []
      acc[key].push({ ...item, fixedCategory: signature.category, fixedLabel: signature.label, fixedPriority: signature.priority })
      return acc
    }, {})

    const recurringExpenseCandidates = Object.entries(groupedByRecurringKey)
      .map(([groupKey, items]) => {
        const sorted = [...(items as any[])].sort(
          (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
        )

        if (sorted.length < 2) return null

        const amounts = sorted.map((x) => x.amount)
        const avgAmount = amounts.reduce((s, v) => s + v, 0) / amounts.length
        const minAmount = Math.min(...amounts)
        const maxAmount = Math.max(...amounts)
        const amountStable =
          avgAmount > 0 && ((maxAmount - minAmount) / avgAmount <= 0.12 || maxAmount - minAmount <= 5000)

        const uniqueMonths = Array.from(new Set(
          sorted.map((x) => {
            const d = new Date(x.date)
            return `${d.getFullYear()}-${d.getMonth()}`
          })
        ))

        const dayNumbers = sorted.map((x) => new Date(x.date).getDate())
        const avgDay = dayNumbers.reduce((s, v) => s + v, 0) / dayNumbers.length
        const dayStable = dayNumbers.every((d) => Math.abs(d - avgDay) <= 4)

        const firstItem = sorted[0]
        const priorityCategory = FIXED_EXPENSE_PRIORITY_CATEGORIES.includes(firstItem.fixedCategory || firstItem.category || '')
        const priorityScore = firstItem.fixedPriority || priorityCategory ? 20 : 0
        const score =
          (uniqueMonths.length >= 2 ? 40 : 0) +
          (uniqueMonths.length >= 3 ? 15 : 0) +
          (amountStable ? 30 : 0) +
          (dayStable ? 15 : 0) +
          priorityScore

        if (!amountStable || score < 70 || uniqueMonths.length < 2) return null

        const patternText = getRecurringPatternText(uniqueMonths.length, sorted.length, dayStable, amountStable)

        return {
          key: groupKey,
          place: firstItem.fixedLabel || firstItem.place || '미분류',
          category: firstItem.fixedCategory || firstItem.category || '기타',
          priority: firstItem.fixedPriority || priorityCategory,
          count: sorted.length,
          avgAmount: Math.round(avgAmount),
          score,
          monthCount: uniqueMonths.length,
          dayStable,
          amountStable,
          patternText,
          lastDate: sorted[sorted.length - 1]?.date || '',
        }
      })
      .filter(Boolean)
      .sort((a: any, b: any) => Number(b.priority) - Number(a.priority) || b.score - a.score)

    const recurringPreferenceMap = new Map(
      recurringExpensePreferences.map((item: any) => [item.signature, item])
    )

    const pendingRecurringCandidates = recurringExpenseCandidates.filter(
      (item: any) => !recurringPreferenceMap.has(item.key)
    )

    const confirmedRecurringExpenses = recurringExpensePreferences
      .filter((item: any) => item.status === 'confirmed')
      .map((saved: any) => {
        const detected = recurringExpenseCandidates.find((item: any) => item.key === saved.signature)
        return detected || {
          key: saved.signature,
          place: saved.name,
          category: saved.category,
          avgAmount: Number(saved.average_amount) || 0,
          patternText: '사용자가 반복지출로 확정한 항목',
          lastDate: saved.last_detected_on || ''
        }
      })

    const excludedRecurringExpenses = recurringExpensePreferences
      .filter((item: any) => item.status === 'excluded')
      .map((saved: any) => {
        const detected = recurringExpenseCandidates.find((item: any) => item.key === saved.signature)
        return detected || {
          key: saved.signature,
          place: saved.name,
          category: saved.category,
          avgAmount: Number(saved.average_amount) || 0,
          patternText: '사용자가 자동 감지에서 제외한 항목',
          lastDate: saved.last_detected_on || ''
        }
      })

    const fixedExpenseCandidates = pendingRecurringCandidates.map((item: any) => ({
      key: item.key,
      place: item.place,
      category: item.category,
      count: item.count,
      avgAmount: item.avgAmount,
      score: item.score,
      priority: item.priority,
      patternText: item.patternText,
      monthCount: item.monthCount
    }))

    const estimatedFixedTotal = confirmedRecurringExpenses.reduce(
      (sum: number, item: any) => sum + item.avgAmount,
      0
    )
  
    const budget = monthlyBudget || 0
    const budgetConfigured = monthlyBudget !== null && monthlyBudget > 0
    const disposableBudget = budgetConfigured ? budget - estimatedFixedTotal : 0
    const remainingMoney = budgetConfigured ? budget - total : 0
  
    const rawPct = budgetConfigured ? (total / budget) * 100 : 0
    const pct = budget > 0 ? Math.min(rawPct, 100) : 0
  
    const savingsRate = incomeTotal > 0 ? (savingsRecordedTotal / incomeTotal) * 100 : 0
    const currentMonthSavingsRate = currentMonthIncome > 0 ? (currentMonthSavings / currentMonthIncome) * 100 : 0
    const previousMonthSavingsRate = previousMonthIncome > 0 ? (previousMonthSavings / previousMonthIncome) * 100 : 0
  
    const topCategoryEntry = Object.entries(
      selectedTransactions.reduce((acc, t) => {
        acc[t.category] = (acc[t.category] || 0) + t.amount
        return acc
      }, {} as Record<string, number>)
    ).sort((a, b) => (b[1] as number) - (a[1] as number))[0]

    const topCategoryName = topCategoryEntry?.[0] || '-'
    const topCategoryAmount = topCategoryEntry ? Number(topCategoryEntry[1]) : 0
  
    const budgetWarning =
      !budgetConfigured
        ? '이 달의 월 예산을 먼저 설정해주세요.'
        : disposableBudget <= 0
          ? '월 예산보다 예상 고정지출이 많아요. 예산을 다시 확인해주세요.'
        : rawPct >= 100
          ? '예산을 초과했어요'
          : rawPct >= 80
            ? '예산이 80% 이상 사용되었어요'
            : '예산이 안정적이에요'
  
    const budgetWarningColor =
      !budgetConfigured
        ? '#D49A3A'
        : disposableBudget <= 0
          ? '#E8A87C'
        : rawPct >= 100
          ? '#FF6B6B'
          : rawPct >= 80
            ? '#FFD166'
            : '#4ECDC4'

    const budgetRiskLabel =
      !budgetConfigured
        ? '미설정'
        : disposableBudget <= 0
          ? '확인 필요'
        : rawPct >= 100
          ? '위험'
          : rawPct >= 80
            ? '주의'
            : '안정'

    const budgetRiskText =
      !budgetConfigured
        ? '월 예산을 설정하면 현재 사용률과 남은 금액을 정확히 안내할 수 있어요.'
        : disposableBudget <= 0
          ? '설정한 월 예산보다 예상 고정지출이 많아서 예산 기준을 다시 확인하는 것이 좋아요.'
        : rawPct >= 100
          ? '현재 흐름이면 이미 예산 초과 상태예요. 큰 지출부터 바로 점검하는 것이 좋아요.'
          : rawPct >= 80
            ? '현재 흐름이면 예산이 빠르게 소진될 수 있어요. 남은 기간 지출을 조금 조절해보세요.'
            : '현재까지는 예산 흐름이 안정적이에요. 지금 패턴을 유지하면 무리가 적어요.'
    
      const foodTotal = selectedTransactions
          .filter((t: any) => ['식비', '카페', '배달'].includes(t.category))
          .reduce((sum: number, t: any) => sum + t.amount, 0)

        const deliveryTotal = selectedTransactions
          .filter((t: any) => t.category === '배달')
          .reduce((sum: number, t: any) => sum + t.amount, 0)

        const cafeTotal = selectedTransactions
          .filter((t: any) => t.category === '카페')
          .reduce((sum: number, t: any) => sum + t.amount, 0)

        const livingSuppliesTotal = selectedTransactions
          .filter((t: any) => t.category === '생활용품')
          .reduce((sum: number, t: any) => sum + t.amount, 0)

        const foodRatio = total > 0 ? (foodTotal / total) * 100 : 0
        const deliveryRatio = total > 0 ? (deliveryTotal / total) * 100 : 0
        const cafeRatio = total > 0 ? (cafeTotal / total) * 100 : 0
        const livingSuppliesRatio = total > 0 ? (livingSuppliesTotal / total) * 100 : 0
        const expenseChangeRate = previousMonthExpenses > 0 ? (((currentMonthExpenses - previousMonthExpenses) / previousMonthExpenses) * 100) : 0
        const incomeChangeRate = previousMonthIncome > 0 ? (((currentMonthIncome - previousMonthIncome) / previousMonthIncome) * 100) : 0
      
        let aiMain = '아직 충분한 데이터가 없어요. 기록을 더 쌓아보세요.'
        let aiSub = '수입, 지출, 저축 데이터를 조금 더 쌓으면 더 정확하게 분석할 수 있어요.'
        let aiStyle = '분석 대기'
        let aiStyleDetail = '기록이 조금 더 쌓이면 소비 성향을 더 정확하게 보여줄 수 있어요.'
        let aiKeyIssue = '아직 핵심 문제를 판단할 데이터가 부족해요.'
        let aiActionTip = '조금 더 기록이 쌓이면 바로 실천할 행동도 함께 알려드릴게요.'
        
        if (total > 0 || incomeTotal > 0 || savingsRecordedTotal > 0) {
          if (savingsRate >= 20 && rawPct < 80) {
            aiStyle = '절약형'
            aiStyleDetail = '저축 비중이 높고 예산 사용도 비교적 안정적인 편이에요.'
          } else if (estimatedFixedTotal > 0 && incomeTotal > 0 && (estimatedFixedTotal / incomeTotal) * 100 >= 40) {
            aiStyle = '고정지출 부담형'
            aiStyleDetail = '반복되는 고정성 지출 비중이 높아서 자유롭게 쓸 수 있는 돈이 적은 편이에요.'
          } else if (foodRatio >= 45 || deliveryRatio >= 20 || cafeRatio >= 15 || livingSuppliesRatio >= 15) {
            aiStyle = '생활소비 주의형'
            aiStyleDetail = '식비·카페·배달·생활용품처럼 자주 반복되는 생활 소비 비중이 높은 편이에요.'
          } else if (rawPct >= 100) {
            aiStyle = '지출 과열형'
            aiStyleDetail = '현재 소비 흐름이 예산을 넘어서고 있어서 조정이 필요한 상태예요.'
          } else {
            aiStyle = '균형형'
            aiStyleDetail = '수입, 지출, 저축 흐름이 한쪽으로 크게 치우치지 않은 편이에요.'
          }
          if (rawPct >= 100) {
            aiMain = `${currentMonth + 1}월은 예산을 초과했어요. 큰 지출 항목부터 점검해보세요.`
            aiKeyIssue = '핵심 문제: 현재 지출이 이미 예산 범위를 넘어선 상태예요.'
            aiActionTip = '추천 행동: 오늘부터 가장 큰 지출 카테고리 1개만 먼저 줄여보세요.'
          } else if (rawPct >= 80) {
            aiMain = `${currentMonth + 1}월 예산 사용률이 높아요. 남은 기간 지출을 조금만 조절해보세요.`
            aiKeyIssue = '핵심 문제: 예산 소진 속도가 빨라서 후반부에 부담이 커질 수 있어요.'
            aiActionTip = '추천 행동: 남은 기간에는 필수 지출 외 소비를 한 번 더 체크해보세요.'
          } else if (savingsRate >= 20) {
            aiMain = '저축률이 아주 좋아요. 지금 흐름을 유지하면 안정적으로 모을 수 있어요.'
            aiKeyIssue = '핵심 문제: 큰 문제는 없지만 현재의 좋은 흐름을 유지하는 것이 중요해요.'
            aiActionTip = '추천 행동: 지금 저축 패턴을 유지하면서 갑작스러운 소비만 조심해보세요.'
          } else if (savingsRate >= 10) {
            aiMain = '저축 흐름이 괜찮아요. 소소한 소비만 줄이면 더 좋아질 수 있어요.'
            aiKeyIssue = '핵심 문제: 저축은 하고 있지만 자잘한 소비가 누적될 가능성이 있어요.'
            aiActionTip = `추천 행동: 반복되는 소액 소비 1개만 정해서 ${currentMonth + 1}월에 줄여보세요.`
          } else if (foodRatio >= 45) {
            aiMain = '식비 관련 지출 비중이 높아요. 외식이나 배달 빈도를 점검해보세요.'
            aiKeyIssue = '핵심 문제: 식비·카페·배달 비중이 전체 지출에서 너무 큰 편이에요.'
            aiActionTip = '추천 행동: 배달이나 외식 횟수를 이번 주에 1~2번만 줄여도 체감이 클 수 있어요.'
          } else if (deliveryRatio >= 20) {
            aiMain = `배달 지출 비중이 높은 편이에요. ${currentMonth + 1}월 절약 포인트가 될 수 있어요.`
            aiKeyIssue = '핵심 문제: 배달처럼 반복되는 편의성 소비가 누적되고 있어요.'
            aiActionTip = '추천 행동: 이번 주는 배달 대신 대체 식사 1~2회를 먼저 시도해보세요.'
          } else if (cafeRatio >= 15) {
            aiMain = '카페 지출이 조금 높아요. 작은 습관 조정만으로도 절약 효과가 있어요.'
            aiKeyIssue = '핵심 문제: 카페 소비가 자주 반복되면서 고정 습관처럼 쌓이고 있어요.'
            aiActionTip = '추천 행동: 카페 이용 횟수를 하루나 이틀만 줄여도 누적 절약에 도움이 돼요.'
          } else if (livingSuppliesRatio >= 15) {
            aiMain = '생활용품 지출 비중이 높은 편이에요. 꼭 필요한 소모품인지 한 번 점검해보세요.'
            aiKeyIssue = '핵심 문제: 생활용품 구매가 반복되면서 전체 지출에서 차지하는 비중이 커지고 있어요.'
            aiActionTip = '추천 행동: 다이소, 올리브영, 휴지, 샴푸 같은 소모품은 구매 전 재고를 먼저 확인해보세요.'
          } else if (estimatedFixedTotal > 0 && incomeTotal > 0 && (estimatedFixedTotal / incomeTotal) * 100 >= 40) {
            aiMain = '고정지출 비중이 높은 편이에요. 매달 반복되는 지출을 먼저 관리해보세요.'
            aiKeyIssue = '핵심 문제: 고정성 지출이 커서 자유롭게 쓸 수 있는 돈이 적은 편이에요.'
            aiActionTip = '추천 행동: 구독, 통신, 정기결제처럼 반복되는 항목부터 점검해보세요.'
          } else {
            aiMain = '전체적으로 안정적인 흐름이에요. 지금처럼 기록을 유지해보세요.'
            aiKeyIssue = '핵심 문제: 현재는 큰 위험 신호 없이 비교적 안정적인 소비 흐름이에요.'
            aiActionTip = '추천 행동: 지금 패턴을 유지하면서 한 달 단위로만 계속 점검해보세요.'
          }
        
          if (topCategoryName !== '-') {
            aiSub = `가장 많이 쓴 항목은 ${topCategoryName}이고, 누적 ${formatKRW(topCategoryAmount)} 사용 중이에요.`
          }
        
          if (previousMonthExpenses > 0) {
            aiSub = `${currentMonth + 1}월 지출은 지난달보다 ${expenseChangeRate >= 0 ? `${expenseChangeRate.toFixed(1)}% 증가` : `${Math.abs(expenseChangeRate).toFixed(1)}% 감소`}했어요.`
          }
        
          if (savingsRate > 0 && incomeTotal > 0) {
            aiSub = `현재 저축률은 ${savingsRate.toFixed(1)}%이고, 수입 대비 저축 흐름을 계속 확인해보면 좋아요.`
          }
        
          if (estimatedFixedTotal > 0 && incomeTotal > 0 && (estimatedFixedTotal / incomeTotal) * 100 >= 40) {
            aiSub = `예상 고정지출은 ${formatKRW(estimatedFixedTotal)}으로, 수입 대비 비중이 높은 편이에요.`
          }
        
          if (foodRatio >= 45) {
            aiSub = `식비·카페·배달 합계가 전체 지출의 ${foodRatio.toFixed(1)}%예요. 생활 소비보다 먹는 지출 비중이 큰 편이에요.`
          } else if (deliveryRatio >= 20) {
            aiSub = `배달 지출 비중이 ${deliveryRatio.toFixed(1)}%로 높아요. 줄이면 가장 빨리 체감될 가능성이 커요.`
          } else if (cafeRatio >= 15) {
            aiSub = `카페 지출 비중이 ${cafeRatio.toFixed(1)}%예요. 자주 반복되는 소액 소비일 가능성이 있어요.`
          } else if (livingSuppliesRatio >= 15) {
            aiSub = `생활용품 지출 비중이 ${livingSuppliesRatio.toFixed(1)}%예요. 소모품 구매 주기와 재고를 함께 확인해보면 좋아요.`
          }
        }

        const currentMonthExpenseItems = selectedTransactions

        const previousMonthExpenseItems = transactions.filter((t: any) => {
          const d = new Date(t.date)
          return d.getFullYear() === previousYear && d.getMonth() === previousMonth
        })

        const currentMonthCategoryTotals = currentMonthExpenseItems.reduce((acc: Record<string, number>, item: any) => {
          acc[item.category || '기타'] = (acc[item.category || '기타'] || 0) + item.amount
          return acc
        }, {})

        const previousMonthCategoryTotals = previousMonthExpenseItems.reduce((acc: Record<string, number>, item: any) => {
          acc[item.category || '기타'] = (acc[item.category || '기타'] || 0) + item.amount
          return acc
        }, {})

        const monthlyTopCategories = Object.entries(currentMonthCategoryTotals)
          .sort((a, b) => (b[1] as number) - (a[1] as number))
          .slice(0, 3)

        const monthlyCategoryChanges = Object.entries(currentMonthCategoryTotals)
          .map(([category, amount]) => {
            const prevAmount = previousMonthCategoryTotals[category] || 0
            return {
              category,
              currentAmount: amount as number,
              prevAmount,
              diff: (amount as number) - prevAmount
            }
          })
          .filter((item) => item.currentAmount > 0 || item.prevAmount > 0)
          .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
          .slice(0, 2)

        const hasPreviousMonthData = previousMonthIncome > 0 || previousMonthExpenses > 0 || previousMonthSavings > 0
        const monthEndBalance = currentMonthIncome - currentMonthExpenses - currentMonthSavings
        const expenseDiff = currentMonthExpenses - previousMonthExpenses

        let monthEndHeadline = `${selectedMonthLabel} 소비 흐름을 한눈에 볼 수 있게 정리했어요.`
        if (hasPreviousMonthData && monthlyTopCategories.length > 0 && expenseDiff > 0) {
          monthEndHeadline = `${currentMonth + 1}월은 ${monthlyTopCategories[0][0]} 비중이 높았고, 지난달보다 지출이 늘었어요.`
        } else if (hasPreviousMonthData && monthlyTopCategories.length > 0 && expenseDiff < 0) {
          monthEndHeadline = `${currentMonth + 1}월은 ${monthlyTopCategories[0][0]} 비중이 높았지만, 지난달보다 지출은 줄었어요.`
        } else if (monthlyTopCategories.length > 0) {
          monthEndHeadline = `${currentMonth + 1}월은 ${monthlyTopCategories[0][0]} 비중이 높게 나타났어요.`
        }

        if (foodRatio >= 45) {
          monthEndHeadline = `${currentMonth + 1}월은 식비·카페·배달 비중이 높게 나타났어요.`
        } else if (deliveryRatio >= 20) {
          monthEndHeadline = `${currentMonth + 1}월은 배달 지출 비중이 높게 나타났어요.`
        } else if (cafeRatio >= 15) {
          monthEndHeadline = `${currentMonth + 1}월은 카페 지출 비중이 높게 나타났어요.`
        }

        let monthEndAdvice = selectedTransactions.length === 0 && selectedIncomeList.length === 0 && selectedSavings.length === 0
          ? '수입·지출·저축을 기록하면 다음 달 행동을 구체적으로 제안할 수 있어요.'
          : '다음 달에는 가장 큰 지출 카테고리부터 먼저 관리해보세요.'
        if (!budgetConfigured) {
          monthEndAdvice = '다음 달 계획을 위해 월 예산을 먼저 설정해보세요.'
        } else if (rawPct >= 100) {
          monthEndAdvice = '다음 달에는 가장 큰 지출 1개를 먼저 줄여서 예산 초과를 막아보세요.'
        } else if (rawPct >= 80) {
          monthEndAdvice = '다음 달에는 남은 예산을 주 단위로 나눠서 관리하면 더 안정적이에요.'
        } else if (savingsRate >= 20) {
          monthEndAdvice = '지금 흐름이 좋아요. 다음 달에도 현재 저축 패턴을 유지해보세요.'
        } else if (pendingRecurringCandidates.length > 0) {
          monthEndAdvice = '다음 달에는 반복지출 후보부터 점검하면 고정비 절약 효과를 보기 쉬워요.'
        }

  const getDateOnly = (value: string) => {
    const d = new Date(value)
    return new Date(d.getFullYear(), d.getMonth(), d.getDate())
  }

  const getWeekRange = (baseDate = new Date(), offsetWeeks = 0) => {
    const base = new Date(baseDate)
    const day = base.getDay()
    const diffToMonday = day === 0 ? -6 : 1 - day
    const start = new Date(base.getFullYear(), base.getMonth(), base.getDate() + diffToMonday + offsetWeeks * 7)
    const end = new Date(start)
    end.setDate(start.getDate() + 6)
    return { start, end }
  }

  const formatRangeLabel = (start: Date, end: Date) => {
    return `${start.getMonth() + 1}월 ${start.getDate()}일 ~ ${end.getMonth() + 1}월 ${end.getDate()}일`
  }

  const getQuestionCategory = (text: string) => {
    if (text.includes('식비')) return '식비'
    if (text.includes('교통비') || text.includes('교통')) return '교통'
    if (text.includes('카페')) return '카페'
    if (text.includes('배달')) return '배달'
    if (text.includes('쇼핑')) return '쇼핑'
    if (text.includes('문화')) return '문화'
    if (text.includes('의료')) return '의료'
    if (text.includes('구독')) return '구독'
    if (text.includes('기타')) return '기타'
    return ''
  }

  const getQuestionPayment = (text: string) => {
    if (text.includes('현금만') || text.includes('현금으로') || text.includes('현금')) return '현금'
    if (text.includes('휴대폰 소액결제')) return '휴대폰 소액결제'
    if (text.includes('충전카드')) return '충전카드'
    if (text.includes('체크카드') || text.includes('카드만') || text.includes('카드로') || text.includes('카드')) return '체크카드'
    if (text.includes('계좌이체만') || text.includes('계좌이체로') || text.includes('계좌이체')) return '계좌이체'
    return ''
  }

  const getQuestionPlaceKeyword = (text: string) => {
    if (text.includes('배달만')) return '배달'
    if (text.includes('카페만')) return '카페'
    if (text.includes('스타벅스')) return '스타벅스'
    return ''
  }

  const getPeriodFilter = (text: string) => {
    const selectedBaseDate = new Date(currentYear, currentMonth, 1)
    const nowDate = new Date()

    if (text.includes('이번 달') || text.includes('이번달')) {
      const start = new Date(selectedBaseDate.getFullYear(), selectedBaseDate.getMonth(), 1)
      const end = new Date(selectedBaseDate.getFullYear(), selectedBaseDate.getMonth() + 1, 0)
      return { key: 'thisMonth', label: selectedMonthLabel, start, end }
    }

    if (text.includes('지난달') || text.includes('저번 달')) {
      const start = new Date(selectedBaseDate.getFullYear(), selectedBaseDate.getMonth() - 1, 1)
      const end = new Date(selectedBaseDate.getFullYear(), selectedBaseDate.getMonth(), 0)
      return { key: 'lastMonth', label: `${start.getFullYear()}년 ${start.getMonth() + 1}월`, start, end }
    }

    if (text.includes('이번 주') || text.includes('이번주')) {
      const range = getWeekRange(nowDate, 0)
      return { key: 'thisWeek', label: '이번 주', start: range.start, end: range.end }
    }

    if (text.includes('지난주') || text.includes('저번 주')) {
      const range = getWeekRange(nowDate, -1)
      return { key: 'lastWeek', label: '지난주', start: range.start, end: range.end }
    }

    return null
  }

  const getContextualFollowUps = (text: string) => {
    if (/예산|남은 돈|초과/.test(text)) {
      return ['카테고리별로 어디부터 줄일까?', '지난달과 예산 사용률을 비교해줘', '반복지출 중 줄일 항목은?']
    }

    if (/반복|고정지출|정기/.test(text)) {
      return ['고정지출이 수입의 몇 %야?', '구독 지출만 따로 알려줘', '다음 달 예산에 고정지출을 반영해줘']
    }

    if (/지난달|저번 달|비교|늘었|줄었/.test(text)) {
      return ['가장 많이 늘어난 카테고리는?', '줄어든 항목도 알려줘', '다음 달에 먼저 줄일 항목은?']
    }

    if (/식비|카페|배달|쇼핑|교통|구독/.test(text)) {
      return ['지난달보다 얼마나 달라졌어?', '전체 지출에서 몇 %를 차지해?', '이 항목 예산은 얼마가 적당해?']
    }

    return ['가장 많이 쓴 항목은?', '지난달보다 늘어난 항목은?', '다음 달 예산은 얼마가 적당해?']
  }

  const filterTransactionsByQuestion = (
    items: any[],
    options?: {
      period?: { start: Date, end: Date } | null
      category?: string
      payment?: string
      placeKeyword?: string
    }
  ) => {
    return items.filter((item: any) => {
      const itemDate = getDateOnly(item.date)
      const inPeriod = options?.period
        ? itemDate >= options.period.start && itemDate <= options.period.end
        : true
      const inCategory = options?.category ? item.category === options.category : true
      const inPayment = options?.payment ? item.payment === options.payment : true
      const inPlace = options?.placeKeyword
        ? `${item.place || ''} ${item.category || ''}`.includes(options.placeKeyword)
        : true

      return inPeriod && inCategory && inPayment && inPlace
    })
  }

  const buildExpenseAnswer = async (rawQuestion?: string) => {
    const q = (rawQuestion || question).trim()
    if (!q) return

    const finishAiAnswer = (answer: string, followUps = getContextualFollowUps(q)) => {
      setAiAnswer(answer)
      setAiFollowUpQuestions(followUps.slice(0, 3))
    }

    const period = getPeriodFilter(q)
    const category = getQuestionCategory(q)
    const payment = getQuestionPayment(q)
    const placeKeyword = getQuestionPlaceKeyword(q)

    const currentFiltered = filterTransactionsByQuestion(transactions, {
      period,
      category,
      payment,
      placeKeyword
    })

    const currentTotal = currentFiltered.reduce((sum: number, item: any) => sum + item.amount, 0)

    const wantsMax = /제일 많이|가장 많이|최댓값|최고|많이 쓴 항목|많이 쓴 곳/.test(q)
    const wantsCompare = /지난달보다|저번 달보다|지난주보다|저번 주보다|비교/.test(q)
    const wantsBudgetGuide = /다음 달 예산|다음달 예산|예산 얼마나|예산 추천/.test(q)
    const wantsRecurring = /정기적으로 나가는|반복되는 지출|반복지출|고정지출|고정 지출|고정성 지출 후보|정기 지출|반복 후보/.test(q)
    const wantsMonthEndReport = /월말 리포트|월간 리포트|이번 달 정리|이번달 정리|월 마감|한 달 요약/.test(q)

    if (wantsMonthEndReport) {
      const budgetResult = budgetConfigured
        ? `설정 예산 ${formatKRW(budget)} 중 ${formatKRW(currentMonthExpenses)}을 사용해 ${remainingMoney >= 0 ? `${formatKRW(remainingMoney)} 남았어요` : `${formatKRW(Math.abs(remainingMoney))} 초과했어요`}.`
        : '월 예산이 설정되지 않아 예산 사용 결과는 계산하지 않았어요.'
      const previousResult = hasPreviousMonthData
        ? `이전 달보다 지출이 ${expenseDiff === 0 ? '같아요' : expenseDiff > 0 ? `${formatKRW(expenseDiff)} 늘었어요` : `${formatKRW(Math.abs(expenseDiff))} 줄었어요`}.`
        : '이전 달 기록이 없어 전월 비교는 생략했어요.'
      const recurringResult = confirmedRecurringExpenses.length > 0
        ? `확정 반복지출은 ${confirmedRecurringExpenses.length}건, 월평균 ${formatKRW(estimatedFixedTotal)}이에요.`
        : '확정한 반복지출은 아직 없어요.'
      const answer =
        `${monthEndHeadline}\n` +
        `${budgetResult}\n` +
        `${previousResult}\n` +
        `${recurringResult}\n` +
        `수입−지출−저축으로 계산한 여유 자금은 ${formatKRW(monthEndBalance)}이에요.\n` +
        monthEndAdvice

      finishAiAnswer(answer, ['가장 많이 쓴 항목은?', '반복지출 중 줄일 항목은?', '다음 달 예산은 얼마가 적당해?'])
      if (ttsEnabled) playGoogleTTS(answer)
      return
    }

    if (wantsRecurring) {
      if (fixedExpenseCandidates.length === 0 && confirmedRecurringExpenses.length === 0) {
        const emptyAnswer =
          '아직 확정한 반복지출이나 새 후보가 없어요.\n' +
          '최소 2개월 이상 같은 카테고리에서 비슷한 이름과 금액이 반복되어야 후보로 잡아요.\n' +
          '통신비, 공과금, 구독, 보험, 월세, 대출, 관리비는 우선 감지해서 더 빠르게 확인해드릴게요.'

        finishAiAnswer(emptyAnswer)
        if (ttsEnabled) playGoogleTTS(emptyAnswer)
        return
      }

      const topItems = fixedExpenseCandidates.slice(0, 3)
      const candidateLines = topItems.map((item: any) =>
        `- ${item.place} · 약 ${formatKRW(item.avgAmount)} · ${item.patternText}`
      )
      const confirmedLines = confirmedRecurringExpenses.slice(0, 3).map((item: any) =>
        `- ${item.place} · 월 평균 ${formatKRW(item.avgAmount)}`
      )

      const answer =
        `확정한 반복지출은 ${confirmedRecurringExpenses.length}건, 월 평균 합계는 ${formatKRW(estimatedFixedTotal)}예요.\n` +
        `${confirmedLines.join('\n')}${confirmedLines.length > 0 && candidateLines.length > 0 ? '\n' : ''}` +
        `${fixedExpenseCandidates.length > 0 ? `새로 확인할 후보는 ${fixedExpenseCandidates.length}건이에요.\n${candidateLines.join('\n')}\n후보는 확정하기 전까지 예산의 고정지출 합계에 포함하지 않아요.` : '새로 확인할 후보는 없어요.'}`

      finishAiAnswer(answer)
      if (ttsEnabled) playGoogleTTS(answer)
      return
    }

    if (wantsBudgetGuide) {
      if (currentMonthExpenses <= 0 && previousMonthExpenses <= 0) {
        const emptyBudgetAnswer = budgetConfigured
          ? `현재 설정한 월 예산은 ${formatKRW(budget)}예요.\n최근 두 달의 지출 기록이 없어 다음 달 권장 예산을 새로 계산하기는 어려워요.\n먼저 지출을 기록한 뒤 다시 물어보면 실제 소비 흐름과 설정 예산을 함께 비교해드릴게요.`
          : '최근 두 달의 지출 기록과 설정된 월 예산이 없어 다음 달 권장 예산을 계산하기 어려워요.\n지출 기록을 쌓거나 월 예산을 먼저 설정해주세요.\n데이터가 생기면 실제 소비 흐름을 기준으로 무리 없는 예산을 제안해드릴게요.'

        finishAiAnswer(emptyBudgetAnswer, ['월 예산을 설정하는 방법은?', '예산 없이 지출 흐름만 요약해줘', '반복지출 후보가 있는지 알려줘'])
        if (ttsEnabled) playGoogleTTS(emptyBudgetAnswer)
        return
      }

      const baseExpense = currentMonthExpenses > 0 && previousMonthExpenses > 0
        ? Math.round((currentMonthExpenses + previousMonthExpenses) / 2)
        : currentMonthExpenses > 0
          ? currentMonthExpenses
          : previousMonthExpenses
      const recommended = Math.round(baseExpense * 0.95 / 1000) * 1000
      const delta = recommended - currentMonthExpenses

      const answer =
        `다음 달 권장 예산은 ${formatKRW(recommended)} 정도예요.\n` +
        `기준 지출은 ${formatKRW(baseExpense)}이고, 선택 월 지출과 비교하면 ${delta >= 0 ? `${formatKRW(delta)} 여유` : `${formatKRW(Math.abs(delta))} 절감 필요`}예요.\n` +
        `최근 두 달 중 기록이 있는 달을 기준으로 5% 정도 조정한 보수적인 예산이에요.`

      finishAiAnswer(answer)
      if (ttsEnabled) playGoogleTTS(answer)
      return
    }

    if (wantsMax) {
      const grouped = currentFiltered.reduce((acc: Record<string, number>, item: any) => {
        const key = item.category || '기타'
        acc[key] = (acc[key] || 0) + item.amount
        return acc
      }, {})

      const topEntry = Object.entries(grouped).sort((a, b) => (b[1] as number) - (a[1] as number))[0]

      if (!topEntry) {
        const emptyAnswer = '조건에 맞는 지출 데이터가 아직 없어요.\n핵심 수치를 계산할 거래가 없어요.\n기간이나 조건을 조금 바꿔서 다시 물어보면 더 정확히 보여드릴게요.'
        finishAiAnswer(emptyAnswer)
        if (ttsEnabled) playGoogleTTS(emptyAnswer)
        return
      }

      const [topName, topAmount] = topEntry
      const ratio = currentTotal > 0 ? (((topAmount as number) / currentTotal) * 100).toFixed(1) : '0.0'
      const label = period?.label || '전체 기간'

      const answer =
        `${label} 가장 많이 쓴 항목은 ${topName}예요.\n` +
        `총 ${formatKRW(topAmount as number)}으로, 해당 조건 지출의 ${ratio}%예요.\n` +
        `${topName} 비중이 가장 커서 먼저 점검하면 절약 효과를 가장 빨리 체감할 가능성이 커요.`

      finishAiAnswer(answer)
      if (ttsEnabled) playGoogleTTS(answer)
      return
    }

    if (wantsCompare) {
      let compareCurrentPeriod = null as { label: string, start: Date, end: Date } | null
      let comparePrevPeriod = null as { label: string, start: Date, end: Date } | null

      if (period?.key === 'thisMonth' || q.includes('지난달보다')) {
        compareCurrentPeriod = {
          label: selectedMonthLabel,
          start: new Date(currentYear, currentMonth, 1),
          end: new Date(currentYear, currentMonth + 1, 0)
        }
        comparePrevPeriod = {
          label: `${previousYear}년 ${previousMonth + 1}월`,
          start: new Date(previousYear, previousMonth, 1),
          end: new Date(previousYear, previousMonth + 1, 0)
        }
      } else if (period?.key === 'thisWeek' || q.includes('지난주보다') || q.includes('저번 주보다')) {
        const thisWeek = getWeekRange(now, 0)
        const lastWeek = getWeekRange(now, -1)
        compareCurrentPeriod = { label: '이번 주', start: thisWeek.start, end: thisWeek.end }
        comparePrevPeriod = { label: '지난주', start: lastWeek.start, end: lastWeek.end }
      }

      if (compareCurrentPeriod && comparePrevPeriod) {
        const currentItems = filterTransactionsByQuestion(transactions, {
          period: compareCurrentPeriod,
          category,
          payment,
          placeKeyword
        })
        const prevItems = filterTransactionsByQuestion(transactions, {
          period: comparePrevPeriod,
          category,
          payment,
          placeKeyword
        })

        const currentSum = currentItems.reduce((sum: number, item: any) => sum + item.amount, 0)
        const prevSum = prevItems.reduce((sum: number, item: any) => sum + item.amount, 0)
        const diff = currentSum - prevSum
        const diffText = diff === 0
          ? '변동이 없어요'
          : diff > 0
            ? `${formatKRW(diff)} 증가`
            : `${formatKRW(Math.abs(diff))} 감소`

        const subject = category || payment || placeKeyword || '전체 지출'

        const answer =
          `${subject === '전체 지출' ? `${compareCurrentPeriod.label} 지출은` : `${compareCurrentPeriod.label} ${subject} 지출은`} ${comparePrevPeriod.label}과 비교해 ${diffText}예요.\n` +
          `${compareCurrentPeriod.label} ${formatKRW(currentSum)}, ${comparePrevPeriod.label} ${formatKRW(prevSum)}예요.\n` +
          `${diff > 0 ? '해당 조건의 소비가 늘어난 흐름이라 원인 항목을 같이 점검해보는 게 좋아요.' : diff < 0 ? '이전보다 줄어든 흐름이라 현재 패턴을 유지하면 좋아요.' : '큰 변화는 없어서 현재 소비 패턴이 비슷하게 유지되고 있어요.'}`

        finishAiAnswer(answer)
        if (ttsEnabled) playGoogleTTS(answer)
        return
      }
    }

    if (period || category || payment || placeKeyword) {
      const detailCount = currentFiltered.length
      const labelParts = [period?.label, category, payment, placeKeyword].filter(Boolean)
      const label = labelParts.length > 0 ? labelParts.join(' · ') : '조건 지출'

      const answer =
        `${label} 기준 지출은 ${formatKRW(currentTotal)}예요.\n` +
        `총 ${detailCount}건이고, 평균은 ${detailCount > 0 ? formatKRW(Math.round(currentTotal / detailCount)) : formatKRW(0)}예요.\n` +
        `${detailCount > 0 ? '조건에 맞는 지출만 따로 본 값이라 해당 소비 습관을 점검하기 좋아요.' : '아직 해당 조건에 맞는 거래가 없어요.'}`

      finishAiAnswer(answer)
      if (ttsEnabled) playGoogleTTS(answer)
      return
    }

    const res = await authenticatedFetch(`${API_BASE_URL}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: q,
        period: selectedMonth,
        categorySummary: selectedTransactions.reduce((acc: Record<string, number>, item: any) => {
          const key = item.category || '기타'
          acc[key] = (acc[key] || 0) + Number(item.amount || 0)
          return acc
        }, {}),
        paymentSummary: selectedTransactions.reduce((acc: Record<string, number>, item: any) => {
          const key = item.payment || '미분류'
          acc[key] = (acc[key] || 0) + Number(item.amount || 0)
          return acc
        }, {}),
        transactionTypeSummary: selectedTransactions.reduce((acc: Record<string, number>, item: any) => {
          const key = item.transaction_type || '일반 지출'
          acc[key] = (acc[key] || 0) + Number(item.amount || 0)
          return acc
        }, {}),
        previousCategorySummary: transactions
          .filter((item: any) => isInMonth(item.date, previousYear, previousMonth))
          .reduce((acc: Record<string, number>, item: any) => {
            const key = item.category || '기타'
            acc[key] = (acc[key] || 0) + Number(item.amount || 0)
            return acc
          }, {}),
        summary: {
          totalExpense: total,
          totalIncome: incomeTotal,
          totalSavings: savingsRecordedTotal,
          savingsRate,
          topCategoryName,
          topCategoryAmount,
          estimatedFixedTotal,
          confirmedFixedExpenses: confirmedRecurringExpenses.slice(0, 5).map((item: any) => ({
            name: item.place,
            category: item.category,
            avgAmount: item.avgAmount
          })),
          fixedExpenseCandidates: fixedExpenseCandidates.slice(0, 5).map((item: any) => ({
            category: item.category,
            count: item.count,
            avgAmount: item.avgAmount,
            score: item.score,
            priority: item.priority,
            patternText: item.patternText,
            monthCount: item.monthCount
          })),
          mobileMicroTotal,
          prepaidTopupTotal,
          prepaidSpendTotal,
          estimatedPrepaidBalance,
          telecomTotal,
          actualTelecomExpense,
          currentMonthExpenses,
          currentMonthIncome,
          currentMonthSavings,
          previousMonthExpenses,
          previousMonthIncome,
          previousMonthSavings,
          monthlyBudget,
          remainingBudget: budgetConfigured ? remainingMoney : null,
          budgetUsageRate: budgetConfigured ? rawPct : null,
          budgetRiskLabel,
          budgetRiskText,
          aiStyle,
          aiStyleDetail
        }
      })
    })

    const data = await res.json().catch(() => null)
    if (!res.ok || !data?.answer) {
      const errorAnswer = data?.error || 'AI 답변을 불러오지 못했어요. 잠시 후 다시 질문해주세요.'
      finishAiAnswer(errorAnswer, ['선택 월 지출을 요약해줘', '가장 많이 쓴 항목은?', '예산 사용률을 알려줘'])
      return
    }

    const followUps = Array.isArray(data.followUpQuestions)
      ? data.followUpQuestions.filter((item: unknown): item is string => typeof item === 'string')
      : getContextualFollowUps(q)

    finishAiAnswer(data.answer, followUps)
    if (ttsEnabled) playGoogleTTS(data.answer)
  }

  const recentThreshold = 5
  const allRecent = [
    ...incomeList.map((i: any) => ({ ...i, _type: 'income' })),
    ...transactions.map((t: any) => ({ ...t, _type: 'expense' })),
    ...savings.map((s: any) => ({ ...s, _type: 'saving' })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  const visibleRecent = showAllRecent ? allRecent : allRecent.slice(0, recentThreshold)


  const shouldShowAppSplash = loading || !appReady || showSplash
  // The shared AuthGate is the single lock screen for every Hub module.
  // Keep the legacy budget lock implementation unreachable while its PIN
  // settings controls continue to manage the shared credential.
  const shouldShowLockScreen = false
  
  useEffect(() => {
    if (!shouldShowLockScreen) return

    const timer = window.setTimeout(() => {
      unlockPinInputRef.current?.focus()
    }, 120)

    return () => window.clearTimeout(timer)
  }, [shouldShowLockScreen])

    if (shouldShowAppSplash) {
      return (
        <div style={{
          minHeight: '100vh',
          background: '#0F0F14',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20
        }}>
          <div style={{
            width: '100%',
            maxWidth: 360,
            textAlign: 'center',
            background: 'linear-gradient(180deg, rgba(24,24,36,0.96) 0%, rgba(19,19,28,0.92) 100%)',
            border: '1px solid #1E1E2A',
            borderRadius: 24,
            padding: '32px 24px',
            boxShadow: '0 18px 50px rgba(0,0,0,0.32)'
          }}>
            <div style={{
              width: 64,
              height: 64,
              margin: '0 auto 16px',
              borderRadius: '50%',
              border: '3px solid rgba(232,168,124,0.18)',
              borderTop: '3px solid #E8A87C',
              animation: 'appSpin 0.9s linear infinite'
            }} />

            <h2 style={{
              color: '#F0EDE8',
              fontSize: 22,
              fontWeight: 700,
              margin: '0 0 8px'
            }}>
              AI 가계부
            </h2>

            <p style={{
              color: '#9CA3AF',
              fontSize: 13,
              margin: 0
            }}>
              {showSessionCheckingHint ? '로그인 상태를 확인하고 있어요…' : '앱을 준비하고 있어요'}
            </p>

            <style>{`
              @keyframes appSpin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
              }
            `}</style>
          </div>
        </div>
      )
    }
    
    if (shouldShowLockScreen) {
      return (
        <div style={{
          minHeight: '100vh',
          background: '#0F0F14',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20
        }}>
          <div style={{
            background: '#13131C',
            border: unlockError ? '1px solid rgba(255,107,107,0.55)' : unlockSuccess ? '1px solid rgba(16,185,129,0.55)' : '1px solid #1E1E2A',
            borderRadius: 20,
            padding: 32,
            width: 360,
            maxWidth: '100%',
            transform: lockShake ? 'translateX(0)' : unlockSuccess ? 'scale(0.985)' : 'scale(1)',
            opacity: unlockSuccess ? 0.82 : 1,
            boxShadow: unlockError
              ? '0 0 0 1px rgba(255,107,107,0.12), 0 12px 32px rgba(255,107,107,0.10)'
              : unlockSuccess
                ? '0 0 0 1px rgba(16,185,129,0.10), 0 16px 36px rgba(16,185,129,0.14)'
                : '0 18px 50px rgba(0,0,0,0.28)',
            animation: lockShake ? 'lockShake 0.36s ease-in-out' : 'none',
            transition: 'transform 0.22s ease, opacity 0.22s ease, box-shadow 0.22s ease, border-color 0.22s ease'
          }}>
            <h2 style={{
              color: '#F0EDE8',
              fontSize: 22,
              fontWeight: 700,
              margin: '0 0 8px',
              textAlign: 'center',
            }}>
              🔒 간편잠금
            </h2>
    
            <p style={{
              color: '#9CA3AF',
              fontSize: 13,
              textAlign: 'center',
              margin: '0 0 20px'
            }}>
              {unlockRequiresPassword ? '공통 PIN 입력이 잠겼어요. 계정 암호로 확인해주세요' : '계속 사용하려면 공통 PIN를 입력해주세요'}
            </p>
    
            {passkeySupported && passkeys.length > 0 && (
              <>
                <button
                  type="button"
                  disabled={passkeyBusy || unlockSuccess}
                  onClick={handlePasskeyUnlock}
                  style={{
                    width: '100%',
                    padding: 12,
                    marginBottom: 12,
                    background: 'rgba(78,205,196,0.12)',
                    border: '1px solid rgba(78,205,196,0.5)',
                    borderRadius: 12,
                    cursor: passkeyBusy || unlockSuccess ? 'default' : 'pointer',
                    color: '#7DE2DB',
                    fontSize: 14,
                    fontWeight: 700,
                    opacity: passkeyBusy || unlockSuccess ? 0.6 : 1
                  }}
                >
                  {passkeyBusy ? '생체인증 확인 중…' : '얼굴·지문으로 잠금 해제'}
                </button>
                <p style={{ color: '#6B7280', fontSize: 11, textAlign: 'center', margin: '-4px 0 12px' }}>
                  사용할 수 없으면 아래 공통 PIN를 입력하세요
                </p>
              </>
            )}

            <input
              ref={unlockPinInputRef}
              type="password"
              inputMode={unlockRequiresPassword ? undefined : "numeric"}
              value={unlockRequiresPassword ? unlockAccountPassword : unlockPinInput}
              disabled={unlockSuccess}
              onChange={(e) => {
                if (unlockRequiresPassword) {
                  setUnlockAccountPassword(e.target.value)
                } else {
                  setUnlockPinInput(e.target.value.replace(/\D/g, '').slice(0, 6))
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleUnlock()
                }
              }}
              placeholder={unlockRequiresPassword ? "계정 암호 입력" : "공통 PIN 6자리"}
              style={{
                width: '100%',
                padding: '12px 14px',
                marginBottom: 12,
                background: unlockError ? 'rgba(255,107,107,0.08)' : unlockSuccess ? 'rgba(16,185,129,0.08)' : 'rgba(8,8,12,0.38)',
                border: unlockError ? '1px solid rgba(255,107,107,0.55)' : unlockSuccess ? '1px solid rgba(16,185,129,0.55)' : '1px solid rgba(255,255,255,0.22)',
                borderRadius: 12,
                color: '#FFFFFF',
                fontSize: 14,
                boxSizing: 'border-box',
                outline: 'none',
                textShadow: '0 1px 2px rgba(0,0,0,0.45)',
                opacity: unlockSuccess ? 0.7 : 1,
                boxShadow: unlockError
                  ? '0 0 0 3px rgba(255,107,107,0.10), inset 0 1px 0 rgba(255,255,255,0.05)'
                  : unlockSuccess
                    ? '0 0 0 3px rgba(16,185,129,0.10), inset 0 1px 0 rgba(255,255,255,0.05)'
                    : 'inset 0 1px 0 rgba(255,255,255,0.05), 0 0 0 1px rgba(0,0,0,0.08)',
                transition: 'background 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease, opacity 0.18s ease'
              }}
            />

            <button
              type="button"
              disabled={unlockSuccess}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                handleUnlock()
              }}
              style={{
                width: '100%',
                padding: 12,
                background: unlockSuccess ? '#059669' : '#10B981',
                border: 'none',
                borderRadius: 12,
                cursor: unlockSuccess ? 'default' : 'pointer',
                color: '#FFFFFF',
                fontSize: 14,
                fontWeight: 700,
                opacity: unlockSuccess ? 0.9 : 1,
                transform: unlockSuccess ? 'scale(0.98)' : 'scale(1)',
                boxShadow: unlockSuccess ? '0 8px 20px rgba(16,185,129,0.22)' : 'none',
                transition: 'transform 0.18s ease, background 0.18s ease, box-shadow 0.18s ease, opacity 0.18s ease'
              }}
            >
              {unlockSuccess ? '확인 중...' : unlockRequiresPassword ? '계정 암호로 확인' : '잠금 해제'}
            </button>

            {unlockError && (
              <p style={{
                color: '#FF6B6B',
                fontSize: 13,
                textAlign: 'center',
                marginTop: 12,
                marginBottom: 0
              }}>
                {unlockError}
              </p>
            )}

            <style>{`
              @keyframes lockShake {
                0% { transform: translateX(0); }
                20% { transform: translateX(-7px); }
                40% { transform: translateX(6px); }
                60% { transform: translateX(-4px); }
                80% { transform: translateX(3px); }
                100% { transform: translateX(0); }
              }
            `}</style>
          </div>
        </div>
      )
    }

    const TABS = [
      { id: 'home', label: '홈', icon: '◉' },
      { id: 'input', label: '기록', icon: '✦' },
      { id: 'list', label: '상세 내역', icon: '≡' },
      { id: 'analysis', label: '분석', icon: '◇' },
      { id: 'settings', label: '설정', icon: '⚙️' },
    ]

    const PieChart = ({ data, size = 120 }: { data: { value: number, color: string, label: string }[], size?: number }) => {
      const validData = data.filter(d => d.value > 0)
      const totalVal = validData.reduce((s, d) => s + d.value, 0)

      if (totalVal === 0) {
        return (
          <div style={{ width: size, height: size, borderRadius: '50%', background: '#2A2A3E', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ color: '#5A5A6A', fontSize: 10 }}>없음</span>
          </div>
        )
      }

      if (validData.length === 1) {
        return (
          <svg width={size} height={size}>
            <circle cx={size / 2} cy={size / 2} r={size / 2 - 4} fill={validData[0].color} />
            <circle cx={size / 2} cy={size / 2} r={size / 2 * 0.45} fill='rgba(15,15,20,0.9)' />
          </svg>
        )
      }

      let cumulative = 0
      const slices = validData.map(d => {
        const start = cumulative
        cumulative += d.value / totalVal
        return { ...d, start, end: cumulative }
      })
  
    const r = size / 2
    const getPath = (start: number, end: number) => {
      const sa = start * 2 * Math.PI - Math.PI / 2
      const ea = end * 2 * Math.PI - Math.PI / 2
      const x1 = r + (r - 4) * Math.cos(sa)
      const y1 = r + (r - 4) * Math.sin(sa)
      const x2 = r + (r - 4) * Math.cos(ea)
      const y2 = r + (r - 4) * Math.sin(ea)
      return `M ${r} ${r} L ${x1} ${y1} A ${r - 4} ${r - 4} 0 ${end - start > 0.5 ? 1 : 0} 1 ${x2} ${y2} Z`
    }

    return (
      <svg width={size} height={size}>
        {slices.map((s, i) => (
          <path key={i} d={getPath(s.start, s.end)} fill={s.color} stroke='rgba(15,15,20,0.75)' strokeWidth={2} />
        ))}
        <circle cx={r} cy={r} r={r * 0.45} fill='rgba(15,15,20,0.9)' />
      </svg>
    )
  }

return (
  <>
    {showNicknameInput && (
      <div role="dialog" aria-modal="true" aria-labelledby="nickname-dialog-title" style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        background: 'rgba(0,0,0,0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999
      }}>
        <div style={{
          background: '#13131C',
          border: '1px solid #1E1E2A',
          borderRadius: 16,
          padding: 24,
          width: 320
        }}>
          <h3 id="nickname-dialog-title" style={{ color: '#F0EDE8', margin: '0 0 10px', fontSize: 20 }}>
            닉네임을 입력해주세요
          </h3>

          <p style={{ color: '#8A8A9A', fontSize: 13, margin: '0 0 16px' }}>
            처음 한 번만 설정하면 돼요.
          </p>

          <input
            value={newNickname}
            onChange={(e) => setNewNickname(e.target.value)}
            placeholder="닉네임"
            style={{
              width: '100%',
              padding: '12px 14px',
              marginBottom: 12,
              background: 'rgba(8,8,12,0.38)',
              border: '1px solid rgba(255,255,255,0.22)',
              borderRadius: 12,
              color: '#FFFFFF',
              fontSize: 14,
              boxSizing: 'border-box',
              outline: 'none',
              textShadow: '0 1px 2px rgba(0,0,0,0.45)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05), 0 0 0 1px rgba(0,0,0,0.08)'
            }}
          />

          <button
            type="button"
            onClick={saveNickname}
            disabled={settingsSavingAction === 'nickname'}
            style={{
              width: '100%',
              padding: 12,
              background: 'linear-gradient(135deg, #E8A87C, #D4916A)',
              border: 'none',
              borderRadius: 12,
              cursor: 'pointer',
              color: '#0F0F14',
              fontWeight: 700,
              fontSize: 14,
            }}
          >
            {settingsSavingAction === 'nickname' ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>
    )}

    <div className="living-finance-app" style={{ minHeight: '100vh', position: 'relative', zIndex: 1 }}>
      <div className="living-finance-background" aria-hidden="true" />

      {(pageNotice || dataLoadError || actionError || isOffline) && (
        <div
          role={isOffline || actionError || dataLoadError ? 'alert' : 'status'}
          aria-live={isOffline || actionError || dataLoadError ? 'assertive' : 'polite'}
          style={{
          position: 'sticky',
          top: 0,
          zIndex: 300,
          padding: '10px 14px',
          background: isOffline ? 'rgba(255,107,107,0.92)' : 'rgba(232,168,124,0.94)',
          color: isOffline ? '#FFFFFF' : '#0F0F14',
          fontSize: 13,
          fontWeight: 700,
          textAlign: 'center',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)'
        }}>
          <span>
            {isOffline
              ? '오프라인 상태예요. 연결이 복구되면 다시 동기화할 수 있어요.'
              : actionError || dataLoadError || pageNotice}
          </span>
          {dataLoadError && !isOffline && (
            <button type="button" onClick={() => window.location.reload()} style={{ minHeight: 36, marginLeft: 10, border: '1px solid rgba(15,15,20,.22)', borderRadius: 9, padding: '5px 10px', color: '#0F0F14', background: 'rgba(255,255,255,.55)', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
              다시 불러오기
            </button>
          )}
        </div>
      )}

      <style>{`
        button {
          transition: transform 0.15s ease, filter 0.15s ease, opacity 0.15s ease, background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
          transform: scale(1);
          filter: brightness(1);
        }
        button:hover:not(:disabled) {
          filter: brightness(1.08);
        }
        button:active:not(:disabled) {
          transform: scale(0.96);
        }
        button:focus-visible {
          outline: none;
          box-shadow: 0 0 0 2px rgba(232, 168, 124, 0.35);
        }
        button:disabled {
          cursor: not-allowed;
          opacity: 0.58;
        }
        input,
        select,
        textarea,
        button {
          max-width: 100%;
        }
        @media (max-width: 767px) {
          button {
            min-height: 44px;
          }
          .history-screen > div,
          .record-screen > section,
          .ai-screen > section,
          .stats-screen > section,
          .settings-screen > div {
            overflow-wrap: anywhere;
          }
          .living-finance-nav {
            padding-bottom: env(safe-area-inset-bottom);
          }
        }
        input::placeholder,
        textarea::placeholder {
          color: rgba(255,255,255,0.78);
          text-shadow: 0 1px 2px rgba(0,0,0,0.35);
        }
      `}</style>


      {tab === 'home' && (
        <main className="living-finance-view living-finance-home app-safe-top" style={{ padding: '24px 20px 96px' }}>
          <header className="home-header">
            <div className="home-title-copy">
              <div className="home-title-row">
                <p className="home-eyebrow">AI 가계부</p>
                <label className="home-month-picker">
                  <span>조회 월</span>
                  <input
                    type="month"
                    value={selectedMonth}
                    onChange={(event) => {
                      if (!event.target.value) return
                      setSelectedMonth(event.target.value)
                      setAutoAnalyzeRan(false)
                      setAiAnswer('')
                      setAiFollowUpQuestions([])
                    }}
                    aria-label="조회할 월 선택"
                  />
                </label>
              </div>
              <h1>{nickname ? `${nickname}님의 생활 금융` : '나의 생활 금융'}</h1>
              <p className="home-greeting">{selectedMonthLabel} 돈의 흐름을 편안하게 살펴보세요.</p>
            </div>
            <div className="home-header-actions">
              <span className="home-ai-status">{currentMonth + 1}월 소비 흐름을 살펴보고 있어요.</span>
              <button className="home-logout" onClick={handleLogout}>로그아웃</button>
            </div>
          </header>

          <section className="home-ai-card home-ai-card-primary">
            <div className="home-ai-icon" aria-hidden="true"><Sparkles size={22} strokeWidth={1.8} /></div>
            <div className="home-ai-content">
              <p className="home-section-label">AI 소비 진단</p>
              <h2>{aiMain}</h2>
              <p className="home-ai-summary">{aiSub}</p>
              <div className="home-ai-action-line">
                <span>이번 달 한 가지</span>
                <strong>{aiActionTip}</strong>
              </div>
              <button type="button" className="home-text-action" onClick={() => { setAnalysisView('ai'); setTab('analysis') }}>
                자세한 분석 보기 <ArrowRight size={15} aria-hidden="true" />
              </button>
            </div>
          </section>

          {(() => {
            const lastDay = new Date(currentYear, currentMonth + 1, 0).getDate()
            const remainDays = isCurrentMonthSelected ? lastDay - today.getDate() : null
            const safePct = Math.min(Math.max(pct, 0), 100)
            return (
              <section className="home-overview-card">
                <div className="home-overview-top">
                  <div>
                    <p className="home-section-label">{selectedMonthLabel} 예산</p>
                    <p className="home-overview-caption">{budgetConfigured ? '지금부터 쓸 수 있는 금액' : '예산을 설정하면 남은 금액을 알려드려요'}</p>
                    <p className={`home-main-amount ${remainingMoney < 0 ? 'is-negative' : ''}`}>{budgetConfigured ? formatKRW(remainingMoney) : '예산 미설정'}</p>
                  </div>
                  <span className="home-day-badge">{remainDays === null ? '선택 월' : `월말까지 D-${remainDays}`}</span>
                </div>

                <div className="home-progress-label">
                  <span>예산 사용률</span>
                  <strong className={rawPct >= 80 ? 'is-warning' : ''}>{budget > 0 ? `${rawPct.toFixed(0)}%` : '-'}</strong>
                </div>
                <div className="home-progress" role="progressbar" aria-label="예산 사용률" aria-valuemin={0} aria-valuemax={100} aria-valuenow={budget > 0 ? Math.round(safePct) : 0}>
                  <span className={rawPct >= 80 ? 'is-warning' : ''} style={{ width: `${budget > 0 ? safePct : 0}%` }} />
                </div>

                <div className="home-budget-summary">
                  <div>
                    <span>월 예산</span>
                    <strong>{budgetConfigured ? formatKRW(budget) : '-'}</strong>
                  </div>
                  <div>
                    <span>현재 지출</span>
                    <strong>{formatKRW(total)}</strong>
                  </div>
                </div>

                <div className="home-card-footer">
                  <span className={rawPct >= 100 ? 'danger' : rawPct >= 80 ? 'warning' : 'safe'}>
                    {!budgetConfigured ? '예산을 먼저 정해주세요' : rawPct >= 100 ? '예산을 초과했어요' : rawPct >= 80 ? '지출 속도를 확인해보세요' : '안정적으로 관리하고 있어요'}
                  </span>
                  <button
                    type="button"
                    className="home-secondary-action"
                    onClick={() => setShowBudgetEditor(value => !value)}
                    disabled={budgetLoading || budgetSaving}
                  >
                    {showBudgetEditor ? '닫기' : budgetConfigured ? '예산 수정' : '예산 설정'}
                  </button>
                </div>
              </section>
            )
          })()}

          {showBudgetEditor && (
            <section className="home-budget-editor">
              <div className="home-section-heading">
                <div>
                  <p className="home-section-label">월 예산 설정</p>
                  <h2>{selectedMonthLabel} 지출 한도를 정해주세요</h2>
                </div>
              </div>
              <label className="home-budget-label">
                월 전체 예산
                <input
                  inputMode="numeric"
                  value={budgetInput}
                  onChange={event => setBudgetInput(event.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="예: 2000000"
                  aria-label="월 전체 예산"
                />
              </label>
              <p className="home-budget-help">카테고리별 예산은 필요한 항목만 입력하세요.</p>
              <div className="home-category-budget-grid">
                {BUDGET_CATEGORIES.map(category => (
                  <label key={category} className="home-budget-label is-category">
                    {category}
                    <input
                      inputMode="numeric"
                      value={categoryBudgetInputs[category] || ''}
                      onChange={event => setCategoryBudgetInputs(current => ({ ...current, [category]: event.target.value.replace(/[^0-9]/g, '') }))}
                      placeholder="미설정"
                      aria-label={`${category} 예산`}
                    />
                  </label>
                ))}
              </div>
              <button type="button" className="home-budget-save" onClick={saveMonthlyBudget} disabled={budgetSaving}>
                {budgetSaving ? '저장 중...' : '월 예산 저장'}
              </button>
            </section>
          )}

          <section className="home-flow-card">
            <div className="home-section-heading">
              <div>
                <p className="home-section-label">돈의 흐름</p>
                <h2>들어온 돈이 어디로 갔는지 보여드려요</h2>
              </div>
              <span>{selectedMonthLabel}</span>
            </div>
            <div className="home-flow-grid">
              {[
                { label: '수입', value: incomeTotal, tone: 'income' },
                { label: '지출', value: total, tone: 'expense' },
                { label: '저축', value: savingsRecordedTotal, tone: 'saving' },
                { label: '여유 자금', value: incomeTotal - total - savingsRecordedTotal, tone: 'available' }
              ].map(item => (
                <div className={`home-flow-item ${item.tone}`} key={item.label}>
                  <span>{item.label}</span>
                  <strong>{formatKRW(item.value)}</strong>
                </div>
              ))}
            </div>
            <p className="home-flow-equation">
              수입 {formatKRW(incomeTotal)} − 지출 {formatKRW(total)} − 저축 {formatKRW(savingsRecordedTotal)}
              <strong>= {formatKRW(incomeTotal - total - savingsRecordedTotal)}</strong>
            </p>
            {estimatedFixedTotal > 0 && <p className="home-flow-note">앞으로 예상되는 고정지출은 {formatKRW(estimatedFixedTotal)}이에요.</p>}
          </section>

          {(() => {
            const catTotals = selectedTransactions.reduce((acc, item) => {
              acc[item.category] = (acc[item.category] || 0) + item.amount
              return acc
            }, {} as Record<string, number>)
            const sorted = (Object.entries(catTotals) as [string, number][])
              .sort((a, b) => b[1] - a[1])
              .slice(0, 3)
            const maxAmount = sorted[0]?.[1] || 1

            return (
              <section className="home-expense-card">
                <div className="home-section-heading">
                  <div>
                    <p className="home-section-label">지출 흐름</p>
                    <h2>{sorted.length > 0 ? '가장 많이 쓴 항목 3개' : '아직 지출 기록이 없어요'}</h2>
                  </div>
                  <span>{formatKRW(total)}</span>
                </div>
                {sorted.length > 0 ? (
                  <div className="home-expense-list">
                    {sorted.map(([category, amount], index) => {
                      const categoryBudget = categoryBudgets[category] || 0
                      const categoryUsage = categoryBudget > 0 ? (amount / categoryBudget) * 100 : null
                      return (
                        <div className="home-expense-row" key={category}>
                          <span className="home-expense-rank">{index + 1}</span>
                          <div className="home-expense-main">
                            <div className="home-expense-meta">
                              <strong>{category}</strong>
                              <span>
                                {categoryUsage === null
                                  ? `전체 지출의 ${total > 0 ? ((amount / total) * 100).toFixed(0) : 0}%`
                                  : `카테고리 예산의 ${categoryUsage.toFixed(0)}%`}
                              </span>
                            </div>
                            <div className="home-expense-bar">
                              <span
                                className={categoryUsage !== null && categoryUsage >= 100 ? 'danger' : categoryUsage !== null && categoryUsage >= 80 ? 'warning' : ''}
                                style={{ width: `${categoryUsage === null ? (amount / maxAmount) * 100 : Math.min(categoryUsage, 100)}%` }}
                              />
                            </div>
                          </div>
                          <strong className="home-expense-amount">{formatKRW(amount)}</strong>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <p className="home-empty-copy">기록을 추가하면 자주 쓰는 항목을 한눈에 정리해드려요.</p>
                )}
                <button type="button" className="home-text-action" onClick={() => { setAnalysisView('stats'); setTab('analysis') }}>
                  지출 분석 자세히 보기 <ArrowRight size={15} aria-hidden="true" />
                </button>
              </section>
            )
          })()}

          <section className="home-recent-card">
            <div className="home-section-heading">
              <div>
                <p className="home-section-label">최근 기록</p>
                <h2>가장 최근에 기록한 내역</h2>
              </div>
              <button type="button" className="home-text-action is-inline" onClick={() => setTab('list')}>
                전체 보기 <ArrowRight size={15} aria-hidden="true" />
              </button>
            </div>

            <div className="home-recent-list">
              {visibleRecent.map((item: any) => {
                const isIncome = item._type === 'income'
                const isSaving = item._type === 'saving'
                const title = isIncome ? item.name : isSaving ? item.goal_name || '일반저축' : item.place
                const meta = isIncome ? `수입 · ${item.date}` : isSaving ? `저축 · ${item.date}` : `${item.category} · ${item.date}`
                return (
                  <div className="home-recent-row" key={`${item._type}-${item.id}`}>
                    <span className={`home-recent-icon ${isIncome ? 'income' : isSaving ? 'saving' : 'expense'}`} aria-hidden="true">
                      {isIncome ? <CircleDollarSign size={19} /> : isSaving ? <PiggyBank size={19} /> : <ReceiptText size={19} />}
                    </span>
                    <div className="home-recent-copy">
                      <strong>{title}</strong>
                      <span>{meta}</span>
                    </div>
                    <strong className={`home-recent-amount ${isIncome ? 'income' : isSaving ? 'saving' : 'expense'}`}>
                      {isIncome || isSaving ? '+' : '-'}{formatKRW(item.amount)}
                    </strong>
                  </div>
                )
              })}
              {visibleRecent.length === 0 && <p className="home-empty-copy">아직 기록이 없어요. 첫 수입이나 지출을 남겨보세요.</p>}
            </div>

            {allRecent.length > recentThreshold && (
              <button type="button" className="home-more-button" onClick={() => setShowAllRecent(!showAllRecent)}>
                {showAllRecent ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
                {showAllRecent ? '최근 5건만 보기' : `기록 ${allRecent.length - recentThreshold}건 더 보기`}
              </button>
            )}
          </section>
        </main>
      )}

      {tab === 'input' && (
        <main className="record-screen app-safe-top" style={{ padding: '24px 20px 88px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 18 }}>
            <div>
              <p style={{ color: '#E8A87C', fontSize: 12, fontWeight: 700, margin: '0 0 6px', letterSpacing: 1 }}>AI 기록</p>
              <h2 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 6px' }}>말하듯 입력하세요</h2>
              <p style={{ color: '#B8B8C8', fontSize: 13, lineHeight: 1.6, margin: 0 }}>
                여러 건도 한 번에 해석하고, 저장 전 모든 내용을 직접 고칠 수 있어요.
              </p>
            </div>
            <span style={{ flexShrink: 0, color: showConfirm ? '#4ECDC4' : '#F6C9AA', fontSize: 11, fontWeight: 700, background: showConfirm ? 'rgba(78,205,196,0.12)' : 'rgba(232,168,124,0.12)', border: '1px solid ' + (showConfirm ? 'rgba(78,205,196,0.32)' : 'rgba(232,168,124,0.32)'), borderRadius: 999, padding: '6px 9px' }}>
              {showConfirm ? '2 · 확인' : '1 · 입력'}
            </span>
          </div>

          {!showConfirm ? (
            <>
              <section style={{ background: 'rgba(19,19,28,0.72)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 18, padding: 14, marginBottom: 12, backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}>
                <label htmlFor="ai-record-input" style={{ display: 'block', color: '#F8FAFC', fontSize: 13, fontWeight: 700, marginBottom: 9 }}>
                  기록할 내용
                </label>
                <textarea
                  id="ai-record-input"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => {
                    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && input.trim() && !aiLoading) {
                      e.preventDefault()
                      handleAddTransaction()
                    }
                  }}
                  placeholder="예: 오늘 점심 9000원 카드, 스타벅스 5900원 카드, 적금 5만원"
                  rows={4}
                  maxLength={1000}
                  style={{ width: '100%', background: 'rgba(8,8,12,0.52)', border: '1px solid rgba(255,255,255,0.28)', borderRadius: 14, color: '#FFFFFF', fontSize: 16, lineHeight: 1.6, padding: '14px 16px', resize: 'vertical', outline: 'none', boxSizing: 'border-box', caretColor: '#E8A87C', textShadow: '0 1px 2px rgba(0,0,0,0.45)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)' }}
                />

                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 8 }}>
                  <span style={{ color: '#7C8596', fontSize: 11 }}>Ctrl/⌘ + Enter로 해석</span>
                  <span style={{ color: input.length > 900 ? '#FF9B9B' : '#7C8596', fontSize: 11 }}>{input.length}/1000</span>
                </div>

                <p style={{ color: '#AEB7C6', fontSize: 11, fontWeight: 700, margin: '16px 0 8px' }}>빠른 예시</p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
                  {QUICK_INPUT_EXAMPLES.map((example) => (
                    <button
                      key={example}
                      type="button"
                      onClick={() => {
                        setInput(example)
                        setFeedback('')
                      }}
                      style={{ background: 'rgba(26,26,46,0.75)', border: '1px solid #2A2A3E', borderRadius: 999, color: '#D0D0E0', fontSize: 12, padding: '8px 11px', cursor: 'pointer' }}
                    >
                      {example}
                    </button>
                  ))}
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    aria-label={listening ? '음성 입력 중지' : '음성으로 기록 입력'}
                    aria-pressed={listening}
                    onClick={handleVoiceInput}
                    disabled={aiLoading}
                    style={{ minWidth: 54, minHeight: 46, background: listening ? '#FF6B6B22' : '#1A1A2E', border: '1px solid ' + (listening ? '#FF6B6B' : '#2A2A3E'), borderRadius: 12, padding: '10px 14px', cursor: aiLoading ? 'wait' : 'pointer', color: listening ? '#FF6B6B' : '#D0D0E0', fontSize: 18, fontWeight: 700, opacity: aiLoading ? 0.6 : 1 }}
                  >
                    {listening ? '■' : '🎤'}
                  </button>
                  <button
                    type="button"
                    onClick={handleAddTransaction}
                    disabled={aiLoading || !input.trim()}
                    style={{ flex: 1, minHeight: 46, background: aiLoading || !input.trim() ? '#715943' : 'linear-gradient(135deg,#E8A87C,#D4916A)', border: 'none', borderRadius: 12, padding: '10px 20px', cursor: aiLoading ? 'wait' : !input.trim() ? 'not-allowed' : 'pointer', color: '#0F0F14', fontWeight: 700, fontSize: 14, opacity: aiLoading || !input.trim() ? 0.65 : 1 }}
                  >
                    {aiLoading ? '내용을 해석하는 중…' : 'AI로 내용 채우기'}
                  </button>
                </div>
              </section>

              <p style={{ color: '#7C8596', fontSize: 11, lineHeight: 1.6, margin: '0 2px' }}>
                AI가 제안한 결과는 자동 저장되지 않아요. 다음 화면에서 날짜·금액·분류를 확인한 뒤 저장됩니다.
              </p>
            </>
          ) : parsedItems.length > 0 ? (
            <section style={{ background: 'rgba(19,19,28,0.78)', border: '1px solid rgba(232,168,124,0.52)', borderRadius: 18, padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
                <div>
                  <p style={{ color: '#E8A87C', fontSize: 12, fontWeight: 700, margin: '0 0 5px' }}>해석 결과 {parsedItems.length}건</p>
                  <p style={{ color: '#B8B8C8', fontSize: 12, lineHeight: 1.5, margin: 0 }}>잘못 채워진 항목만 바로 수정하세요.</p>
                </div>
                <strong style={{ color: '#FFFFFF', fontSize: 14, whiteSpace: 'nowrap' }}>
                  합계 {formatKRW(parsedItems.reduce((sum, item) => sum + (Number(item.amount) || 0), 0))}
                </strong>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
                {parsedItems.map((item, idx) => (
                  <article key={idx} style={{ position: 'relative', background: 'rgba(8,8,12,0.38)', border: '1px solid #2A2A3A', borderRadius: 14, padding: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                      <strong style={{ color: '#F8FAFC', fontSize: 13 }}>기록 {idx + 1}</strong>
                      <button
                        type="button"
                        aria-label={'기록 ' + (idx + 1) + ' 삭제'}
                        onClick={() => {
                          const updated = parsedItems.filter((_, itemIndex) => itemIndex !== idx)
                          setParsedItems(updated)
                          if (updated.length === 0) setShowConfirm(false)
                        }}
                        style={{ background: '#FF6B6B18', border: '1px solid #FF6B6B66', borderRadius: 8, color: '#FF9B9B', fontSize: 11, padding: '5px 8px', cursor: 'pointer' }}
                      >
                        삭제
                      </button>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 10, marginBottom: 10 }}>
                      <label style={{ color: '#AEB7C6', fontSize: 11 }}>
                        구분
                        <select
                          value={item.type}
                          onChange={(e) => {
                            const type = e.target.value
                            updateParsedItem(idx, {
                              type,
                              category: type === 'income' ? '기타수입' : type === 'saving' ? '저축' : '기타',
                              payment: type === 'expense' ? (item.payment || '체크카드') : '',
                              transaction_type: type === 'expense' ? (item.transaction_type || '일반 지출') : ''
                            })
                          }}
                          style={{ width: '100%', minHeight: 40, marginTop: 5, background: '#101018', border: '1px solid #343443', borderRadius: 8, color: '#FFFFFF', padding: '8px 9px', boxSizing: 'border-box' }}
                        >
                          <option value="expense">지출</option>
                          <option value="income">수입</option>
                          <option value="saving">저축</option>
                        </select>
                      </label>
                      <label style={{ color: '#AEB7C6', fontSize: 11 }}>
                        날짜
                        <input
                          type="date"
                          value={item.date || ''}
                          onChange={(e) => updateParsedItem(idx, { date: e.target.value })}
                          style={{ width: '100%', minHeight: 40, marginTop: 5, background: '#101018', border: '1px solid #343443', borderRadius: 8, color: '#FFFFFF', padding: '8px 9px', boxSizing: 'border-box', colorScheme: 'dark' }}
                        />
                      </label>
                    </div>

                    <label style={{ display: 'block', color: '#AEB7C6', fontSize: 11, marginBottom: 10 }}>
                      {item.type === 'income' ? '수입명' : item.type === 'saving' ? '저축명' : '사용처'}
                      <input
                        value={item.place}
                        onChange={(e) => updateParsedItem(idx, { place: e.target.value })}
                        style={{ width: '100%', minHeight: 40, marginTop: 5, background: '#101018', border: '1px solid #343443', borderRadius: 8, color: '#FFFFFF', padding: '8px 10px', boxSizing: 'border-box' }}
                      />
                    </label>

                    <label style={{ display: 'block', color: '#AEB7C6', fontSize: 11, marginBottom: 10 }}>
                      금액
                      <input
                        type="number"
                        min="1"
                        inputMode="numeric"
                        value={item.amount}
                        onChange={(e) => updateParsedItem(idx, { amount: Number(e.target.value) })}
                        style={{ width: '100%', minHeight: 40, marginTop: 5, background: '#101018', border: '1px solid #343443', borderRadius: 8, color: item.type === 'income' ? '#4ECDC4' : item.type === 'saving' ? '#7EA6D9' : '#FF8A8A', fontSize: 15, fontWeight: 700, padding: '8px 10px', boxSizing: 'border-box' }}
                      />
                    </label>

                    {item.type !== 'saving' && (
                      <label style={{ display: 'block', color: '#AEB7C6', fontSize: 11, marginBottom: 10 }}>
                        카테고리
                        <select
                          value={item.category || (item.type === 'income' ? '기타수입' : '기타')}
                          onChange={(e) => updateParsedItem(idx, { category: e.target.value })}
                          style={{ width: '100%', minHeight: 40, marginTop: 5, background: '#101018', border: '1px solid #343443', borderRadius: 8, color: '#FFFFFF', padding: '8px 9px', boxSizing: 'border-box' }}
                        >
                          {item.type === 'income' ? (
                            <>
                              {['월급', '용돈', '부업', '보너스', '이자', '기타수입'].map(category => <option key={category} value={category}>{category}</option>)}
                            </>
                          ) : (
                            <>
                              {BUDGET_CATEGORIES.map(category => <option key={category} value={category}>{category}</option>)}
                            </>
                          )}
                        </select>
                      </label>
                    )}

                    {item.type === 'expense' && (
                      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 10, marginBottom: 10 }}>
                        <label style={{ color: '#AEB7C6', fontSize: 11 }}>
                          결제수단
                          <select
                            value={item.payment || '체크카드'}
                            onChange={(e) => updateParsedItem(idx, { payment: e.target.value })}
                            style={{ width: '100%', minHeight: 40, marginTop: 5, background: '#101018', border: '1px solid #343443', borderRadius: 8, color: '#FFFFFF', padding: '8px 7px', boxSizing: 'border-box' }}
                          >
                            {['현금', '계좌이체', '체크카드', '휴대폰 소액결제', '충전카드'].map(payment => <option key={payment} value={payment}>{payment}</option>)}
                          </select>
                        </label>
                        <label style={{ color: '#AEB7C6', fontSize: 11 }}>
                          거래 유형
                          <select
                            value={item.transaction_type || '일반 지출'}
                            onChange={(e) => updateParsedItem(idx, { transaction_type: e.target.value })}
                            style={{ width: '100%', minHeight: 40, marginTop: 5, background: '#101018', border: '1px solid #343443', borderRadius: 8, color: '#FFFFFF', padding: '8px 7px', boxSizing: 'border-box' }}
                          >
                            {['일반 지출', '휴대폰 소액결제', '충전카드 충전', '충전카드 사용'].map(type => <option key={type} value={type}>{type}</option>)}
                          </select>
                        </label>
                      </div>
                    )}

                    <label style={{ display: 'block', color: '#AEB7C6', fontSize: 11 }}>
                      메모 · 선택
                      <input
                        value={item.memo || ''}
                        onChange={(e) => updateParsedItem(idx, { memo: e.target.value })}
                        placeholder="필요할 때만 입력"
                        style={{ width: '100%', minHeight: 40, marginTop: 5, background: '#101018', border: '1px solid #343443', borderRadius: 8, color: '#FFFFFF', padding: '8px 10px', boxSizing: 'border-box' }}
                      />
                    </label>
                  </article>
                ))}
              </div>

              <div aria-live="polite">
                {feedback && <p style={{ color: feedback.includes('오류') || feedback.includes('확인') ? '#FF9B9B' : '#4ECDC4', fontSize: 12, lineHeight: 1.5, margin: '0 0 10px' }}>{feedback}</p>}
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  disabled={isSavingRecords}
                  onClick={() => {
                    setShowConfirm(false)
                    setParsedItems([])
                    setFeedback('')
                  }}
                  style={{ flex: 1, minHeight: 46, background: 'rgba(15,15,20,0.75)', border: '1px solid #2A2A3A', borderRadius: 12, padding: '12px', cursor: isSavingRecords ? 'wait' : 'pointer', color: '#D0D0E0', fontSize: 14, opacity: isSavingRecords ? 0.6 : 1 }}
                >
                  입력 수정
                </button>
                <button
                  type="button"
                  onClick={handleConfirmSave}
                  disabled={isSavingRecords}
                  style={{ flex: 2, minHeight: 46, background: isSavingRecords ? '#715943' : 'linear-gradient(135deg,#E8A87C,#D4916A)', border: 'none', borderRadius: 12, padding: '12px', cursor: isSavingRecords ? 'wait' : 'pointer', color: '#0F0F14', fontWeight: 700, fontSize: 14, opacity: isSavingRecords ? 0.7 : 1 }}
                >
                  {isSavingRecords ? '저장하는 중…' : parsedItems.length + '건 확인 후 저장'}
                </button>
              </div>
            </section>
          ) : null}

          {!showConfirm && feedback && (
            <p aria-live="polite" style={{ color: feedback.includes('오류') || feedback.includes('못했') ? '#FF9B9B' : '#4ECDC4', fontSize: 13, lineHeight: 1.6, margin: '12px 2px 0' }}>
              {feedback}
            </p>
          )}
        </main>
      )}

      {tab === 'list' && (
        <HistoryScreen
          incomeList={incomeList}
          transactions={transactions}
          savings={savings}
          currency={currency}
          processingRecordKey={processingRecordKey}
          onDeleteIncome={handleDeleteIncome}
          onDeleteExpense={handleDelete}
          onDeleteSaving={handleDeleteSaving}
          onNavigateInput={() => setTab('input')}
          onNotice={setPageNotice}
        />
      )}

      {tab === 'analysis' && (
        <header className="app-safe-top" style={{ padding: '24px 20px 0' }}>
          <h2 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 6px' }}>분석</h2>
          <p style={{ color: '#9CA3AF', fontSize: 13, lineHeight: 1.6, margin: '0 0 14px' }}>
            숫자로 흐름을 확인하고, 궁금한 내용은 AI에게 바로 물어보세요.
          </p>
          <div
            role="tablist"
            aria-label="분석 화면 선택"
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 6,
              padding: 5,
              borderRadius: 14,
              background: 'rgba(19,19,28,0.78)',
              border: '1px solid #2A2A3E'
            }}
          >
            {([
              { id: 'stats', label: '소비 분석' },
              { id: 'ai', label: 'AI 상담' }
            ] as const).map(item => {
              const isActive = analysisView === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => {
                    setAnalysisView(item.id)
                    if (item.id !== 'ai') setAutoAnalyzeRan(false)
                  }}
                  style={{
                    minHeight: 44,
                    border: isActive ? '1px solid rgba(232,168,124,0.48)' : '1px solid transparent',
                    borderRadius: 10,
                    background: isActive ? 'rgba(232,168,124,0.14)' : 'transparent',
                    color: isActive ? '#F6C9AA' : '#B8B8C8',
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  {item.label}
                </button>
              )
            })}
          </div>
        </header>
      )}

      {tab === 'analysis' && analysisView === 'ai' && (
        <main className="living-finance-view ai-screen" style={{ padding: '20px 20px 96px' }}>
          <section style={{ background: 'rgba(19,19,28,0.75)', border: '1px solid #1A1A24', borderRadius: 16, padding: 16, marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
              <div>
                <p style={{ color: '#E8A87C', fontSize: 12, fontWeight: 700, margin: '0 0 6px', letterSpacing: 1 }}>AI 상담</p>
                <h3 style={{ color: '#FFFFFF', fontSize: 18, fontWeight: 700, margin: '0 0 6px' }}>가계부에 궁금한 점을 물어보세요</h3>
                <p style={{ color: '#9CA3AF', fontSize: 12, lineHeight: 1.6, margin: 0 }}>
                  통계 보고서는 소비 분석에 모으고, 이곳에서는 질문과 답변에만 집중해요.
                </p>
              </div>
              <span style={{ flexShrink: 0, color: '#F6C9AA', fontSize: 11, fontWeight: 700, background: 'rgba(232,168,124,0.12)', border: '1px solid rgba(232,168,124,0.28)', borderRadius: 999, padding: '6px 9px' }}>
                {selectedMonthLabel}
              </span>
            </div>

            <p style={{ color: '#C7C7D3', fontSize: 11, fontWeight: 700, margin: '0 0 8px', letterSpacing: 0.5 }}>추천 질문</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {suggestedQuestions.slice(0, 4).map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => handleSuggestedQuestion(q)}
                  disabled={analyzing}
                  style={{
                    background: 'rgba(26,26,46,0.75)',
                    border: '1px solid #2A2A3E',
                    borderRadius: 999,
                    padding: '8px 12px',
                    cursor: analyzing ? 'wait' : 'pointer',
                    color: '#D0D0E0',
                    fontSize: 12,
                    opacity: analyzing ? 0.65 : 1
                  }}
                >
                  {q}
                </button>
              ))}
            </div>
          </section>

          <section style={{ background: 'rgba(19,19,28,0.75)', border: '1px solid #1A1A24', borderRadius: 16, padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <p style={{ color: '#4ECDC4', fontSize: 12, fontWeight: 700, margin: 0, letterSpacing: 1 }}>직접 질문</p>
              <button
                type="button"
                aria-pressed={ttsEnabled}
                onClick={() => setTtsEnabled(!ttsEnabled)}
                style={{ background: ttsEnabled ? '#4ECDC422' : '#1A1A2E', border: `1px solid ${ttsEnabled ? '#4ECDC4' : '#2A2A3E'}`, borderRadius: 8, padding: '5px 10px', cursor: 'pointer', color: ttsEnabled ? '#4ECDC4' : '#D0D0E0', fontSize: 11 }}
              >
                {ttsEnabled ? '🔊 자동 읽기 켜짐' : '🔇 자동 읽기 꺼짐'}
              </button>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input
                value={question}
                onChange={e => setQuestion(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !analyzing && handleAnalyze()}
                placeholder="예: 이번 달 식비는 얼마나 썼어?"
                aria-label="AI에게 질문할 내용"
                style={{ flex: '1 1 220px', minHeight: 46, background: 'rgba(8,8,12,0.46)', border: '1px solid rgba(255,255,255,0.24)', borderRadius: 10, padding: '12px 14px', color: '#FFFFFF', fontSize: 14, outline: 'none', textShadow: '0 1px 2px rgba(0,0,0,0.45)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05), 0 0 0 1px rgba(0,0,0,0.08)' }}
              />
              <button type="button" aria-label="음성으로 질문 입력" onClick={handleQuestionVoiceInput} disabled={analyzing} style={{ minWidth: 52, minHeight: 46, background: 'rgba(26,26,46,0.75)', border: '1px solid #2A2A3E', borderRadius: 10, color: '#D0D0E0', padding: '10px 14px', cursor: analyzing ? 'wait' : 'pointer', fontSize: 18, fontWeight: 700 }}>🎤</button>
              <button type="button" onClick={handleAnalyze} disabled={analyzing || !question.trim()} style={{ minWidth: 88, minHeight: 46, background: analyzing || !question.trim() ? '#5A3440' : '#FF6B6B', border: 'none', borderRadius: 10, color: '#fff', padding: '10px 16px', cursor: analyzing ? 'wait' : !question.trim() ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: 14 }}>
                {analyzing ? '답변 중…' : '질문하기'}
              </button>
            </div>

            <div aria-live="polite">
              {aiAnswer ? (
                <div style={{ marginTop: 16, background: 'rgba(15,15,20,0.75)', border: '1px solid #2A2A3E', borderRadius: 12, padding: 14 }}>
                  <p style={{ color: '#E8A87C', fontSize: 11, fontWeight: 700, margin: '0 0 8px', letterSpacing: 0.5 }}>AI 답변</p>
                  <div style={{ color: '#FFFFFF', fontSize: 14, lineHeight: 1.7 }}>
                    {aiAnswer.split('\n').map((line, i) => <span key={i}>{line}<br /></span>)}
                  </div>
                  <button type="button" onClick={() => playGoogleTTS(aiAnswer)} style={{ marginTop: 10, background: 'rgba(26,26,46,0.75)', border: '1px solid #2A2A3E', borderRadius: 8, padding: '8px 12px', cursor: 'pointer', color: '#4ECDC4', fontSize: 12, fontWeight: 700 }}>🔊 답변 읽기</button>
                  {aiFollowUpQuestions.length > 0 && (
                    <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #2A2A3E' }}>
                      <p style={{ color: '#9CA3AF', fontSize: 11, fontWeight: 700, margin: '0 0 8px' }}>이어서 물어보기</p>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {aiFollowUpQuestions.map((followUp) => (
                          <button
                            key={followUp}
                            type="button"
                            onClick={() => handleSuggestedQuestion(followUp)}
                            disabled={analyzing}
                            style={{ background: 'rgba(78,205,196,0.08)', border: '1px solid rgba(78,205,196,0.35)', borderRadius: 999, padding: '8px 11px', cursor: analyzing ? 'wait' : 'pointer', color: '#BCEDE9', fontSize: 11, opacity: analyzing ? 0.65 : 1 }}
                          >
                            {followUp}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ marginTop: 16, background: 'rgba(15,15,20,0.62)', border: '1px dashed #2A2A3E', borderRadius: 12, padding: '18px 14px', textAlign: 'center' }}>
                  <p style={{ color: '#FFFFFF', fontSize: 14, fontWeight: 700, margin: '0 0 6px' }}>아직 대화가 없어요</p>
                  <p style={{ color: '#9CA3AF', fontSize: 12, lineHeight: 1.6, margin: 0 }}>추천 질문을 누르거나 직접 입력해 시작해보세요.</p>
                </div>
              )}
            </div>

            <p style={{ color: '#7C8596', fontSize: 10, lineHeight: 1.6, margin: '12px 0 0' }}>
              AI에는 거래처·메모·개별 날짜가 아닌 합계 중심 정보만 전달돼요.
            </p>
          </section>
        </main>
      )}

      {tab === 'analysis' && analysisView === 'stats' && (
        <div className="stats-screen" style={{ padding: '24px 20px 96px' }}>
          <div style={{ marginBottom: 16 }}>
            <p style={{ color: '#E8A87C', fontSize: 12, fontWeight: 700, margin: '0 0 6px', letterSpacing: 1 }}>소비 분석</p>
            <h3 style={{ color: '#FFFFFF', fontSize: 18, fontWeight: 700, margin: '0 0 6px' }}>{selectedMonthLabel} 돈의 흐름</h3>
            <p style={{ color: '#9CA3AF', fontSize: 12, lineHeight: 1.6, margin: 0 }}>핵심 수치부터 지출 구성과 반복 흐름 순서로 확인하세요.</p>
          </div>
          <section aria-labelledby="month-end-report-title" style={{ background: 'linear-gradient(145deg, rgba(32,31,48,0.92), rgba(20,27,40,0.88))', border: '1px solid rgba(78,205,196,0.28)', borderRadius: 20, padding: 18, marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
              <div>
                <p style={{ color: '#4ECDC4', fontSize: 11, fontWeight: 700, margin: '0 0 6px', letterSpacing: 1 }}>월말 리포트</p>
                <h4 id="month-end-report-title" style={{ color: '#FFFFFF', fontSize: 17, margin: '0 0 6px' }}>{selectedMonthLabel} 마감 요약</h4>
                <p style={{ color: '#C7C7D3', fontSize: 12, lineHeight: 1.6, margin: 0 }}>{monthEndHeadline}</p>
              </div>
              <span style={{ flexShrink: 0, color: isCurrentMonthSelected ? '#FFD166' : '#BCEDE9', fontSize: 10, fontWeight: 700, background: isCurrentMonthSelected ? 'rgba(255,209,102,0.1)' : 'rgba(78,205,196,0.1)', border: `1px solid ${isCurrentMonthSelected ? 'rgba(255,209,102,0.35)' : 'rgba(78,205,196,0.35)'}`, borderRadius: 999, padding: '6px 9px' }}>
                {isCurrentMonthSelected ? '진행 중' : '마감 완료'}
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, marginBottom: 12 }}>
              {[
                { label: '수입', value: currentMonthIncome, color: '#4ECDC4' },
                { label: '지출', value: currentMonthExpenses, color: '#FF7D75' },
                { label: '저축', value: currentMonthSavings, color: '#7EA6D9' }
              ].map((item) => (
                <div key={item.label} style={{ minWidth: 0, background: 'rgba(8,8,12,0.3)', borderRadius: 12, padding: 10 }}>
                  <p style={{ color: '#9CA3AF', fontSize: 10, margin: '0 0 5px' }}>{item.label}</p>
                  <strong style={{ display: 'block', color: item.color, fontSize: 13, overflowWrap: 'anywhere' }}>{formatKRW(item.value)}</strong>
                </div>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
              <div style={{ minWidth: 0, background: 'rgba(15,15,20,0.72)', borderRadius: 12, padding: 11 }}>
                <p style={{ color: '#9CA3AF', fontSize: 10, margin: '0 0 5px' }}>예산 결과</p>
                <strong style={{ color: !budgetConfigured ? '#D49A3A' : remainingMoney >= 0 ? '#4ECDC4' : '#FF7D75', fontSize: 13, overflowWrap: 'anywhere' }}>
                  {!budgetConfigured ? '예산 미설정' : remainingMoney >= 0 ? `${formatKRW(remainingMoney)} 남음` : `${formatKRW(Math.abs(remainingMoney))} 초과`}
                </strong>
                <p style={{ color: '#777F8E', fontSize: 10, lineHeight: 1.5, margin: '5px 0 0' }}>{budgetConfigured ? `사용률 ${rawPct.toFixed(1)}%` : '설정 후 자동 계산'}</p>
              </div>
              <div style={{ minWidth: 0, background: 'rgba(15,15,20,0.72)', borderRadius: 12, padding: 11 }}>
                <p style={{ color: '#9CA3AF', fontSize: 10, margin: '0 0 5px' }}>전월 대비 지출</p>
                <strong style={{ color: !hasPreviousMonthData || expenseDiff === 0 ? '#D0D0E0' : expenseDiff > 0 ? '#FF7D75' : '#4ECDC4', fontSize: 13, overflowWrap: 'anywhere' }}>
                  {!hasPreviousMonthData ? '비교 자료 없음' : expenseDiff === 0 ? '변동 없음' : expenseDiff > 0 ? `${formatKRW(expenseDiff)} 증가` : `${formatKRW(Math.abs(expenseDiff))} 감소`}
                </strong>
                <p style={{ color: '#777F8E', fontSize: 10, lineHeight: 1.5, margin: '5px 0 0' }}>{hasPreviousMonthData ? `이전 달 ${formatKRW(previousMonthExpenses)}` : '이전 달 기록 필요'}</p>
              </div>
              <div style={{ minWidth: 0, background: 'rgba(15,15,20,0.72)', borderRadius: 12, padding: 11 }}>
                <p style={{ color: '#9CA3AF', fontSize: 10, margin: '0 0 5px' }}>확정 반복지출</p>
                <strong style={{ color: '#F6C9AA', fontSize: 13, overflowWrap: 'anywhere' }}>{confirmedRecurringExpenses.length > 0 ? formatKRW(estimatedFixedTotal) : '확정 항목 없음'}</strong>
                <p style={{ color: '#777F8E', fontSize: 10, lineHeight: 1.5, margin: '5px 0 0' }}>{confirmedRecurringExpenses.length > 0 ? `${confirmedRecurringExpenses.length}건의 월평균 합계` : '후보 확인 후 반영'}</p>
              </div>
              <div style={{ minWidth: 0, background: 'rgba(15,15,20,0.72)', borderRadius: 12, padding: 11 }}>
                <p style={{ color: '#9CA3AF', fontSize: 10, margin: '0 0 5px' }}>여유 자금</p>
                <strong style={{ color: monthEndBalance >= 0 ? '#4ECDC4' : '#FF7D75', fontSize: 13, overflowWrap: 'anywhere' }}>{formatKRW(monthEndBalance)}</strong>
                <p style={{ color: '#777F8E', fontSize: 10, lineHeight: 1.5, margin: '5px 0 0' }}>수입−지출−저축</p>
              </div>
            </div>

            <div style={{ marginTop: 12, background: 'rgba(232,168,124,0.1)', border: '1px solid rgba(232,168,124,0.24)', borderRadius: 12, padding: 12 }}>
              <p style={{ color: '#F6C9AA', fontSize: 10, fontWeight: 700, margin: '0 0 5px', letterSpacing: 0.5 }}>다음 달 한 가지 행동</p>
              <p style={{ color: '#FFFFFF', fontSize: 12, lineHeight: 1.6, margin: 0 }}>{monthEndAdvice}</p>
            </div>

            {pendingRecurringCandidates.length > 0 && (
              <p style={{ color: '#8E96A5', fontSize: 10, lineHeight: 1.5, margin: '10px 0 0' }}>
                미확정 반복지출 후보 {pendingRecurringCandidates.length}건은 합계에서 제외했어요.
              </p>
            )}
          </section>

          <details style={{ background: 'rgba(19,19,28,0.68)', border: '1px solid #2A2A3E', borderRadius: 14, padding: '12px 14px', marginBottom: 16 }}>
            <summary style={{ color: '#B8B8C8', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>전체 누적값 보기 · 참고용</summary>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 12 }}>
              <div><p style={{ color: '#777F8E', fontSize: 10, margin: '0 0 4px' }}>수입</p><strong style={{ color: '#4ECDC4', fontSize: 13 }}>{formatKRW(allIncomeTotal)}</strong></div>
              <div><p style={{ color: '#777F8E', fontSize: 10, margin: '0 0 4px' }}>지출</p><strong style={{ color: '#FF7D75', fontSize: 13 }}>{formatKRW(allExpenseTotal)}</strong></div>
              <div><p style={{ color: '#777F8E', fontSize: 10, margin: '0 0 4px' }}>저축</p><strong style={{ color: '#7EA6D9', fontSize: 13 }}>{formatKRW(allSavingsTotal)}</strong></div>
            </div>
            <p style={{ color: '#777F8E', fontSize: 10, margin: '10px 0 0' }}>선택 월 예산과 AI 진단에는 포함하지 않아요.</p>
          </details>

          <div style={{ background: 'rgba(19,19,28,0.75)', border: '1px solid #1A1A24', borderRadius: 16, padding: 16, marginBottom: 16 }}>
            <p style={{ color: '#C7C7D3', fontSize: 12, margin: '0 0 16px', letterSpacing: 1 }}>카테고리별 상세</p>
            {(() => {
              const catTotals = selectedTransactions.reduce((acc, t) => { acc[t.category] = (acc[t.category] || 0) + t.amount; return acc }, {} as Record<string, number>)
              const sorted = Object.entries(catTotals).sort((a, b) => (b[1] as number) - (a[1] as number)) as [string, number][]
              const max = sorted[0]?.[1] || 1
              return sorted.length > 0 ? sorted.map(([cat, amt]) => {
                const meta = CATEGORY_MAP[cat] || CATEGORY_MAP['기타']
                const p = total > 0 ? ((amt / total) * 100).toFixed(1) : '0.0'
                return (
                  <div key={cat} style={{ marginBottom: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                      <span style={{ color: '#FFFFFF', fontSize: 13 }}>{meta.icon} {cat}</span>
                      <div style={{ textAlign: 'right' }}><span style={{ color: '#FFFFFF', fontSize: 13, fontFamily: 'monospace' }}>{formatKRW(amt)}</span><span style={{ color: '#E0E0EA', fontSize: 11, marginLeft: 6 }}>{p}%</span></div>
                    </div>
                    <div style={{ background: '#2A2A3E', borderRadius: 4, height: 8 }}><div style={{ width: `${(amt / max) * 100}%`, height: '100%', borderRadius: 4, background: meta.color, transition: 'width .6s ease' }} /></div>
                  </div>
                )
              }) : <p style={{ color: '#D0D0E0', fontSize: 14, textAlign: 'center' }}>데이터가 없어요</p>
            })()}
          </div>

          <div style={{ background: 'rgba(19,19,28,0.75)', border: '1px solid #1A1A24', borderRadius: 16, padding: 16 }}>
            <p style={{ color: '#9CA3AF', fontSize: 12, margin: '0 0 12px', letterSpacing: 1 }}>거래 현황</p>
            <div style={{ display: 'flex', justifyContent: 'space-around' }}>
              <div style={{ textAlign: 'center' }}><p style={{ color: '#FFFFFF', fontSize: 24, fontWeight: 700, margin: '0 0 4px' }}>{selectedTransactions.length}</p><p style={{ color: '#E0E0EA', fontSize: 11, margin: 0 }}>총 거래</p></div>
              <div style={{ textAlign: 'center' }}><p style={{ color: '#FFFFFF', fontSize: 24, fontWeight: 700, margin: '0 0 4px' }}>{Object.keys(selectedTransactions.reduce((acc, t) => ({ ...acc, [t.category]: 1 }), {})).length}</p><p style={{ color: '#E0E0EA', fontSize: 11, margin: 0 }}>카테고리</p></div>
              <div style={{ textAlign: 'center' }}><p style={{ color: '#FFFFFF', fontSize: 24, fontWeight: 700, margin: '0 0 4px' }}>{formatKRW(selectedTransactions.length > 0 ? Math.round(total / selectedTransactions.length) : 0)}</p><p style={{ color: '#E0E0EA', fontSize: 11, margin: 0 }}>평균 지출</p></div>
            </div>
          </div>

          <div style={{ background: 'rgba(19,19,28,0.75)', border: '1px solid #1A1A24', borderRadius: 16, padding: 16, marginTop: 16 }}>
            <p style={{ color: '#9CA3AF', fontSize: 12, margin: '0 0 12px', letterSpacing: 1 }}>결제수단별 지출</p>

            {Object.keys(paymentStats).length === 0 ? (
              <p style={{ color: '#D0D0E0', fontSize: 14, textAlign: 'center' }}>데이터가 없어요</p>
            ) : (
              Object.entries(paymentStats).map(([method, amount]) => (
                <div key={method} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ color: '#FFFFFF', fontSize: 13 }}>{method}</span>
                    <span style={{ color: '#FFFFFF', fontSize: 13, fontFamily: 'monospace' }}>{formatKRW(amount as number)}</span>
                  </div>
                  <div style={{ background: '#2A2A3E', borderRadius: 4, height: 6 }}>
                    <div
                      style={{
                        width: `${total > 0 ? ((amount as number) / total) * 100 : 0}%`,
                        height: '100%',
                        borderRadius: 4,
                        background: '#E8A87C',
                        transition: 'width .6s ease'
                      }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>

          <details style={{ background: 'rgba(19,19,28,0.75)', border: '1px solid #1A1A24', borderRadius: 16, padding: 16, marginTop: 16 }}>
            <summary style={{ color: '#B8B8C8', fontSize: 12, fontWeight: 700, cursor: 'pointer', marginBottom: 12 }}>휴대폰·충전카드 상세 분석</summary>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div style={{ background: 'rgba(15,15,20,0.75)', borderRadius: 10, padding: 10 }}><p style={{ color:'#E0E0EA',fontSize:11,margin:'0 0 4px' }}>휴대폰 소액결제 합계</p><p style={{ color:'#F472B6',fontSize:13,fontWeight:700,margin:0,fontFamily:'monospace' }}>{formatKRW(mobileMicroTotal)}</p></div>
              <div style={{ background: 'rgba(15,15,20,0.75)', borderRadius: 10, padding: 10 }}><p style={{ color:'#E0E0EA',fontSize:11,margin:'0 0 4px' }}>충전카드 충전 합계</p><p style={{ color:'#A78BFA',fontSize:13,fontWeight:700,margin:0,fontFamily:'monospace' }}>{formatKRW(prepaidTopupTotal)}</p></div>
              <div style={{ background: 'rgba(15,15,20,0.75)', borderRadius: 10, padding: 10 }}><p style={{ color:'#E0E0EA',fontSize:11,margin:'0 0 4px' }}>충전카드 사용 합계</p><p style={{ color:'#60A5FA',fontSize:13,fontWeight:700,margin:0,fontFamily:'monospace' }}>{formatKRW(prepaidSpendTotal)}</p></div>
              <div style={{ background: 'rgba(15,15,20,0.75)', borderRadius: 10, padding: 10 }}><p style={{ color:'#E0E0EA',fontSize:11,margin:'0 0 4px' }}>충전카드 잔액 추정</p><p style={{ color:estimatedPrepaidBalance >= 0 ? '#34D399' : '#FF6B6B',fontSize:13,fontWeight:700,margin:0,fontFamily:'monospace' }}>{formatKRW(estimatedPrepaidBalance)}</p></div>
            </div>
            <p style={{ color:'#D0D0E0', fontSize: 11, margin: '10px 0 0' }}>충전카드 충전 금액은 제외하고, 실제 사용한 금액 기준으로 계산했어요.</p>
            <p style={{ color:'#E0E0EA', fontSize: 11, margin: '8px 0 0' }}>실제 소비 합계: {formatKRW(actualExpenseTotal)}</p>
            <p style={{ color:'#E0E0EA', fontSize: 11, margin: '6px 0 0' }}>통신요금: {formatKRW(telecomTotal)}</p>
            <p style={{ color:'#E0E0EA', fontSize: 11, margin: '6px 0 0' }}>휴대폰 소액결제: {formatKRW(mobileMicroTotal)}</p>
            <p style={{ color:'#E0E0EA', fontSize: 11, margin: '6px 0 0' }}>실제 통신비: {formatKRW(actualTelecomExpense)}</p>
          </details>

          <div style={{ background: 'rgba(19,19,28,0.75)', border: '1px solid #1A1A24', borderRadius: 16, padding: 16, marginTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
              <div>
                <p style={{ color: '#9CA3AF', fontSize: 12, margin: '0 0 4px', letterSpacing: 1 }}>📌 반복지출 관리</p>
                <p style={{ color: '#CBD5E1', fontSize: 11, lineHeight: 1.5, margin: 0 }}>자동 감지 결과를 확인한 뒤 확정하거나 제외하세요.</p>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <p style={{ color: '#34D399', fontSize: 11, margin: '0 0 4px' }}>확정 합계</p>
                <p style={{ color: '#FFFFFF', fontSize: 13, fontWeight: 700, fontFamily: 'monospace', margin: 0 }}>{formatKRW(estimatedFixedTotal)}</p>
              </div>
            </div>

            {confirmedRecurringExpenses.length > 0 && (
              <div style={{ background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.28)', borderRadius: 12, padding: 12, marginBottom: 12 }}>
                <p style={{ color: '#6EE7B7', fontSize: 11, fontWeight: 700, margin: '0 0 10px' }}>확정한 반복지출 {confirmedRecurringExpenses.length}개</p>
                {confirmedRecurringExpenses.map((item: any) => (
                  <div key={item.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <p style={{ color: '#FFFFFF', fontSize: 13, margin: '0 0 3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.place}</p>
                      <p style={{ color: '#CBD5E1', fontSize: 11, margin: 0 }}>{item.category} · 월 평균 {formatKRW(item.avgAmount)}</p>
                    </div>
                    <button
                      type="button"
                      disabled={Boolean(recurringDecisionSavingKey)}
                      onClick={() => restoreRecurringExpenseCandidate(item.key)}
                      style={{ flexShrink: 0, background: 'transparent', border: '1px solid #475569', borderRadius: 8, padding: '7px 9px', color: '#CBD5E1', fontSize: 11, cursor: recurringDecisionSavingKey ? 'default' : 'pointer', opacity: recurringDecisionSavingKey ? 0.55 : 1 }}
                    >
                      확정 해제
                    </button>
                  </div>
                ))}
              </div>
            )}

            {fixedExpenseCandidates.length === 0 ? (
              <p style={{ color: '#D0D0E0', fontSize: 13, textAlign: 'center', lineHeight: 1.6, margin: '16px 0' }}>
                새로 확인할 반복지출 후보가 없어요.
              </p>
            ) : (
              <>
                <p style={{ color: '#FCD34D', fontSize: 11, fontWeight: 700, margin: '0 0 10px' }}>확인이 필요한 후보 {fixedExpenseCandidates.length}개</p>
                {fixedExpenseCandidates.slice(0, 5).map((item: any, idx: number) => (
                  <div key={item.key} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: idx < Math.min(fixedExpenseCandidates.length, 5) - 1 ? '1px solid #2A2A3E' : 'none' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 4 }}>
                      <span style={{ color: '#FFFFFF', fontSize: 13, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.place}</span>
                      <span style={{ color: '#E8A87C', fontSize: 13, fontFamily: 'monospace', flexShrink: 0 }}>{formatKRW(item.avgAmount)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 4 }}>
                      <span style={{ color: '#E0E0EA', fontSize: 11 }}>{item.category}</span>
                      <span style={{ color: '#E0E0EA', fontSize: 11 }}>반복 {item.count}회 · {item.monthCount}개월</span>
                    </div>
                    <p style={{ color: '#CBD5E1', fontSize: 11, lineHeight: 1.5, margin: '0 0 9px' }}>{item.patternText}</p>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <button
                        type="button"
                        disabled={Boolean(recurringDecisionSavingKey)}
                        onClick={() => saveRecurringExpenseDecision(item, 'confirmed')}
                        style={{ background: 'rgba(52,211,153,0.14)', border: '1px solid rgba(52,211,153,0.45)', borderRadius: 8, padding: '8px 10px', color: '#6EE7B7', fontSize: 11, fontWeight: 700, cursor: recurringDecisionSavingKey ? 'default' : 'pointer', opacity: recurringDecisionSavingKey ? 0.55 : 1 }}
                      >
                        반복지출 확정
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(recurringDecisionSavingKey)}
                        onClick={() => saveRecurringExpenseDecision(item, 'excluded')}
                        style={{ background: 'rgba(148,163,184,0.08)', border: '1px solid #475569', borderRadius: 8, padding: '8px 10px', color: '#CBD5E1', fontSize: 11, fontWeight: 700, cursor: recurringDecisionSavingKey ? 'default' : 'pointer', opacity: recurringDecisionSavingKey ? 0.55 : 1 }}
                      >
                        후보에서 제외
                      </button>
                    </div>
                  </div>
                ))}
              </>
            )}

            {excludedRecurringExpenses.length > 0 && (
              <details style={{ borderTop: '1px solid #2A2A3E', paddingTop: 12, marginTop: 4 }}>
                <summary style={{ color: '#9CA3AF', fontSize: 11, cursor: 'pointer' }}>제외한 항목 {excludedRecurringExpenses.length}개 관리</summary>
                {excludedRecurringExpenses.map((item: any) => (
                  <div key={item.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <p style={{ color: '#E2E8F0', fontSize: 12, margin: '0 0 3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.place}</p>
                      <p style={{ color: '#94A3B8', fontSize: 10, margin: 0 }}>{item.category} · {formatKRW(item.avgAmount)}</p>
                    </div>
                    <button
                      type="button"
                      disabled={Boolean(recurringDecisionSavingKey)}
                      onClick={() => restoreRecurringExpenseCandidate(item.key)}
                      style={{ flexShrink: 0, background: 'transparent', border: '1px solid #475569', borderRadius: 8, padding: '7px 9px', color: '#CBD5E1', fontSize: 11, cursor: recurringDecisionSavingKey ? 'default' : 'pointer', opacity: recurringDecisionSavingKey ? 0.55 : 1 }}
                    >
                      다시 후보로
                    </button>
                  </div>
                ))}
              </details>
            )}
          </div>


        </div>
      )}

      {tab === 'settings' && (
        <div className="settings-screen app-safe-top" style={{ padding: '24px 20px 96px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 20 }}>
            <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>⚙️ 설정</h2>
            <button
              type="button"
              onClick={() => setShowUserGuide(true)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 12px', borderRadius: 10, border: '1px solid rgba(232,168,124,0.45)', background: 'rgba(232,168,124,0.10)', color: '#F4C7A8', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}
            >
              📖 사용 가이드
            </button>
          </div>
          <div style={{ background: 'rgba(19,19,28,0.75)', border: '1px solid #1A1A24', borderRadius: 16, padding: 16, marginBottom: 16 }}>
            <p style={{ color: '#5A5A6A', fontSize: 12, margin: '0 0 12px', letterSpacing: 1 }}>닉네임 설정</p>

            <div style={{ marginBottom: 10 }}>
              <p style={{ color: '#F0EDE8', fontSize: 13, margin: '0 0 6px' }}>
                현재 닉네임: {nickname || '없음'}
              </p>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={newNickname}
                onChange={e => setNewNickname(e.target.value)}
                placeholder="새 닉네임 입력"
                style={{
                  flex: 1,
                  background: 'rgba(8,8,12,0.38)',
                  border: '1px solid rgba(255,255,255,0.22)',
                  borderRadius: 8,
                  padding: '10px 12px',
                  color: '#FFFFFF',
                  fontSize: 13,
                  outline: 'none',
                  textShadow: '0 1px 2px rgba(0,0,0,0.45)',
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05), 0 0 0 1px rgba(0,0,0,0.08)'
                }}
              />
              <button
                type="button"
                onClick={saveNickname}
                disabled={settingsSavingAction === 'nickname'}
                style={{
                  background: 'linear-gradient(135deg,#E8A87C,#D4916A)',
                  border: 'none',
                  borderRadius: 8,
                  padding: '10px 14px',
                  cursor: 'pointer',
                  color: '#0F0F14',
                  fontWeight: 700,
                  fontSize: 13
                }}
              >
                {settingsSavingAction === 'nickname' ? '저장 중…' : '저장'}
              </button>
            </div>
          </div>

          <PreferencesSettingsCards
            currency={currency}
            notificationsEnabled={notificationsEnabled}
            budgetAlertEnabled={budgetAlertEnabled}
            notificationPermission={notificationPermission}
            onCurrencyChange={saveCurrencySetting}
            onNotificationChange={saveNotificationSettings}
          />

          <div style={{ background: 'rgba(19,19,28,0.75)', border: '1px solid #1A1A24', borderRadius: 16, padding: 16, marginBottom: 16 }}>
            <p style={{ color: '#9CA3AF', fontSize: 12, margin: '0 0 12px', letterSpacing: 1 }}>암호 변경</p>

            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="기존 암호 입력"
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
                marginBottom: 10,
                textShadow: '0 1px 2px rgba(0,0,0,0.45)',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05), 0 0 0 1px rgba(0,0,0,0.08)'
              }}
            />

            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="새 암호 입력 (6자 이상)"
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
                marginBottom: 12,
                textShadow: '0 1px 2px rgba(0,0,0,0.45)',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05), 0 0 0 1px rgba(0,0,0,0.08)'
              }}
            />

            <button
              type="button"
              onClick={handleChangePassword}
              disabled={settingsSavingAction === 'password'}
              style={{
                width: '100%',
                background: '#2563EB',
                border: 'none',
                borderRadius: 8,
                padding: '10px',
                color: '#FFFFFF',
                fontSize: 13,
                cursor: 'pointer'
              }}
            >
              {settingsSavingAction === 'password' ? '변경 중…' : '암호 변경'}
            </button>
          </div>

          <div style={{ background: 'rgba(19,19,28,0.75)', border: '1px solid #1A1A24', borderRadius: 16, padding: 16, marginBottom: 16 }}>
            <p style={{ color: '#9CA3AF', fontSize: 12, margin: '0 0 8px', letterSpacing: 1 }}>얼굴·지문 인증</p>
            <p style={{ color: '#9CA3AF', fontSize: 12, lineHeight: 1.6, margin: '0 0 12px' }}>
              기기의 Face ID, 지문 또는 Windows Hello를 사용합니다. 얼굴 사진과 지문 정보는 AI 가계부에 저장되지 않아요.
            </p>

            {!passkeySupported ? (
              <p style={{ color: '#6B7280', fontSize: 12, margin: 0 }}>
                현재 기기나 브라우저에서는 생체인증을 사용할 수 없어요.
              </p>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleRegisterPasskey}
                  disabled={passkeyBusy}
                  style={{
                    width: '100%',
                    background: '#0F766E',
                    border: 'none',
                    borderRadius: 8,
                    padding: '11px',
                    color: '#FFFFFF',
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: passkeyBusy ? 'default' : 'pointer',
                    opacity: passkeyBusy ? 0.6 : 1
                  }}
                >
                  {passkeyBusy ? '처리 중…' : '이 기기에 생체인증 등록'}
                </button>

                {passkeys.length > 0 && (
                  <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
                    {passkeys.map((passkey) => (
                      <div key={passkey.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: 10, borderRadius: 10, background: 'rgba(8,8,12,0.38)', border: '1px solid rgba(255,255,255,0.10)' }}>
                        <div style={{ minWidth: 0 }}>
                          <p style={{ color: '#E5E7EB', fontSize: 12, fontWeight: 700, margin: '0 0 3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {passkey.friendly_name || '등록된 생체인증'}
                          </p>
                          <p style={{ color: '#6B7280', fontSize: 10, margin: 0 }}>
                            {new Date(passkey.created_at).toLocaleDateString('ko-KR')} 등록
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeletePasskey(passkey.id)}
                          disabled={passkeyBusy}
                          style={{ flexShrink: 0, background: 'rgba(255,107,107,0.10)', border: '1px solid rgba(255,107,107,0.35)', borderRadius: 8, padding: '7px 10px', color: '#FF9B9B', fontSize: 11, cursor: passkeyBusy ? 'default' : 'pointer' }}
                        >
                          삭제
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <div style={{ background: 'rgba(19,19,28,0.75)', border: '1px solid #1A1A24', borderRadius: 16, padding: 16, marginBottom: 16 }}>
            <p style={{ color: '#9CA3AF', fontSize: 12, margin: '0 0 12px', letterSpacing: 1 }}>공통 PIN</p>

            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ color: '#E0E0EA', fontSize: 13 }}>공통 PIN 사용</span>
              <input
                type="checkbox"
                checked={simplePinEnabled}
                disabled={settingsSavingAction === 'pin'}
                onChange={(e) => handleToggleSimplePinEnabled(e.target.checked)}
              />
            </label>

            {simplePinEnabled && (
              <>
                {hasSimplePin && (
                  <input
                    type="password"
                    inputMode="numeric"
                    value={currentSimplePin}
                    onChange={(e) => setCurrentSimplePin(e.target.value.replace(/\D/g, ''))}
                    placeholder="기존 공통 PIN 입력"
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
                      marginBottom: 10,
                      textShadow: '0 1px 2px rgba(0,0,0,0.45)',
                      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05), 0 0 0 1px rgba(0,0,0,0.08)'
                    }}
                  />
                )}

                <input
                  type="password"
                  inputMode="numeric"
                  value={simplePin}
                  onChange={(e) => setSimplePin(e.target.value.replace(/\D/g, ''))}
                  placeholder={hasSimplePin ? "새 공통 PIN 6자리" : "공통 PIN 6자리"}
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
                    marginBottom: 10,
                    textShadow: '0 1px 2px rgba(0,0,0,0.45)',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05), 0 0 0 1px rgba(0,0,0,0.08)'
                  }}
                />
          
                <input
                  type="password"
                  inputMode="numeric"
                  value={simplePinConfirm}
                  onChange={(e) => setSimplePinConfirm(e.target.value.replace(/\D/g, ''))}
                  placeholder={hasSimplePin ? "새 공통 PIN 다시 입력" : "공통 PIN 다시 입력"}
                  style={{
                    width: '100%',
                    background: 'rgba(15,15,20,0.75)',
                    border: '1px solid #2A2A3A',
                    borderRadius: 8,
                    padding: '10px 12px',
                    color: '#FFFFFF',
                    fontSize: 13,
                    outline: 'none',
                    boxSizing: 'border-box',
                    marginBottom: 12
                  }}
                />
          
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={handleSetSimplePin}
                    disabled={settingsSavingAction === 'pin'}
                    style={{
                      flex: 1,
                      background: '#10B981',
                      border: 'none',
                      borderRadius: 8,
                      padding: '10px',
                      color: '#FFFFFF',
                      fontSize: 13,
                      cursor: settingsSavingAction === 'pin' ? 'default' : 'pointer',
                      opacity: settingsSavingAction === 'pin' ? 0.6 : 1
                    }}
                  >
                    {settingsSavingAction === 'pin' ? '처리 중…' : hasSimplePin ? '공통 PIN 변경' : '공통 PIN 설정'}
                  </button>

                  {hasSimplePin && (
                    <button
                      onClick={() => handleToggleSimplePinEnabled(false)}
                      disabled={settingsSavingAction === 'pin'}
                      style={{
                        flex: 1,
                        background: '#FF6B6B',
                        border: 'none',
                        borderRadius: 8,
                        padding: '10px',
                        color: '#FFFFFF',
                        fontSize: 13,
                        cursor: settingsSavingAction === 'pin' ? 'default' : 'pointer',
                        opacity: settingsSavingAction === 'pin' ? 0.6 : 1
                      }}
                    >
                      {settingsSavingAction === 'pin' ? '처리 중…' : '공통 PIN 해제'}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>

          <SettingsUtilityCards
            autoAnalyzeEnabled={autoAnalyzeEnabled}
            autoQuestion={autoQuestion}
            showResetConfirm={showResetConfirm}
            resetPassword={resetPassword}
            resetLoading={resetLoading}
            onAutoAnalyzeEnabledChange={setAutoAnalyzeEnabled}
            onAutoQuestionChange={setAutoQuestion}
            onShowResetConfirmChange={setShowResetConfirm}
            onResetPasswordChange={setResetPassword}
            onResetAllData={handleResetAllData}
          />
        </div>
      )}

      <UserGuide open={showUserGuide} onClose={() => setShowUserGuide(false)} />

      <nav className="living-finance-nav" aria-label="주요 메뉴" style={{ display: 'flex', position: 'fixed', bottom: 0, left: 0, width: '100%', zIndex: 100 }}>
        {TABS.map(t => (
          <button
            key={t.id}
            className={`living-finance-nav-item ${tab === t.id ? 'is-active' : ''}`}
            aria-current={tab === t.id ? 'page' : undefined}
            onClick={() => {
              setTab(t.id)
              if (t.id !== 'analysis') setAutoAnalyzeRan(false)
            }}
          >
            <span className="living-finance-nav-icon" aria-hidden="true">{t.icon}</span>
            <span className="living-finance-nav-label">{t.label}</span>
            {tab === t.id && <span className="living-finance-nav-indicator" aria-hidden="true" />}
          </button>
        ))}
      </nav>
    </div>
    </>
  )
}

export default function BudgetPage() {
  return <AuthGate><BudgetDashboard /></AuthGate>
}
