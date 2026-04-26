import { createLogger } from '#shared/utils/logger'
const SMS_COOLDOWN_STORAGE_KEY = 'lexseek-sms-cooldowns'
const logger = createLogger('SmsCooldown')

type SmsCooldownStore = Record<string, number>

function readSmsCooldownStore(): SmsCooldownStore {
  if (!import.meta.client) {
    return {}
  }

  try {
    const raw = window.localStorage.getItem(SMS_COOLDOWN_STORAGE_KEY)
    if (!raw) {
      return {}
    }

    const parsed = JSON.parse(raw) as SmsCooldownStore
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeSmsCooldownStore(store: SmsCooldownStore) {
  if (!import.meta.client) {
    return
  }

  try {
    window.localStorage.setItem(SMS_COOLDOWN_STORAGE_KEY, JSON.stringify(store))
  } catch {
    logger.warn('写入短信冷却时间失败')
  }
}

function cleanupSmsCooldownStore(store: SmsCooldownStore, now: number): SmsCooldownStore {
  const nextStore: SmsCooldownStore = {}

  for (const [key, expiresAt] of Object.entries(store)) {
    if (typeof expiresAt === 'number' && expiresAt > now) {
      nextStore[key] = expiresAt
    }
  }

  return nextStore
}

function getSmsCooldownKey(phone: string, type: string): string {
  return `${type}:${phone.trim()}`
}

export function useSmsCooldown(phoneGetter: () => string, type: string) {
  const countdown = ref(0)
  let timer: ReturnType<typeof setInterval> | null = null

  const stopTimer = () => {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  const syncCooldown = () => {
    if (!import.meta.client) {
      countdown.value = 0
      return
    }

    const phone = phoneGetter().trim()
    if (!phone) {
      countdown.value = 0
      stopTimer()
      return
    }

    const now = Date.now()
    const cleanedStore = cleanupSmsCooldownStore(readSmsCooldownStore(), now)
    writeSmsCooldownStore(cleanedStore)

    const expiresAt = cleanedStore[getSmsCooldownKey(phone, type)]
    if (!expiresAt) {
      countdown.value = 0
      stopTimer()
      return
    }

    const remainingSeconds = Math.max(Math.ceil((expiresAt - now) / 1000), 0)
    countdown.value = remainingSeconds

    if (remainingSeconds <= 0) {
      stopTimer()
      const nextStore = { ...cleanedStore }
      delete nextStore[getSmsCooldownKey(phone, type)]
      writeSmsCooldownStore(nextStore)
      return
    }

    if (!timer) {
      timer = setInterval(() => {
        syncCooldown()
      }, 1000)
    }
  }

  const applyCooldown = (seconds: number) => {
    if (!import.meta.client || seconds <= 0) {
      return
    }

    const phone = phoneGetter().trim()
    if (!phone) {
      return
    }

    const now = Date.now()
    const cleanedStore = cleanupSmsCooldownStore(readSmsCooldownStore(), now)
    cleanedStore[getSmsCooldownKey(phone, type)] = now + seconds * 1000
    writeSmsCooldownStore(cleanedStore)
    syncCooldown()
  }

  const getCooldownMessage = (baseMessage: string = '验证码获取频率过高，请稍后再试') => {
    return countdown.value > 0
      ? `${baseMessage}（${countdown.value}秒后可重新获取）`
      : baseMessage
  }

  watch(
    () => phoneGetter(),
    () => {
      syncCooldown()
    }
  )

  onMounted(() => {
    syncCooldown()
  })

  onBeforeUnmount(() => {
    stopTimer()
  })

  return {
    countdown,
    isCoolingDown: computed(() => countdown.value > 0),
    syncCooldown,
    applyCooldown,
    getCooldownMessage,
  }
}
