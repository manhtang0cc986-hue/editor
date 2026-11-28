export const PASCAL_LOCALE_HEADER = 'x-pascal-locale'

export const SUPPORTED_LOCALES = ['zh-CN', 'en', 'es', 'fr', 'ja'] as const
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

export const LOCALE_LABELS: Record<SupportedLocale, string> = {
  'zh-CN': '中文',
  en: 'English',
  es: 'Español',
  fr: 'Français',
  ja: '日本語',
}

/** Default locale for the application. */
export const DEFAULT_LOCALE: SupportedLocale = 'zh-CN'

function matchUiLocale(value: string | null | undefined): SupportedLocale | undefined {
  const requested = value?.trim()
  if (!requested) return undefined
  try {
    const canonical = Intl.getCanonicalLocales(requested)[0]
    if (!canonical) return undefined
    const exact = SUPPORTED_LOCALES.find((locale) => locale === canonical)
    return (
      exact ?? SUPPORTED_LOCALES.find((locale) => locale.split('-')[0] === canonical.split('-')[0])
    )
  } catch {
    return undefined
  }
}

export function resolveUiLocale(value: string | null | undefined): SupportedLocale {
  return matchUiLocale(value) ?? DEFAULT_LOCALE
}

export function resolveAcceptLanguage(acceptLanguage: string | null | undefined): SupportedLocale {
  const entries = (acceptLanguage ?? '')
    .split(',')
    .map((entry) => {
      const [lang, weight] = entry.split(';').map((part) => part.trim())
      return { lang, q: weight === undefined ? 1 : Number(/^q\s*=\s*(.*)$/i.exec(weight)?.[1]) }
    })
    .filter(({ lang, q }) => lang && q > 0 && q <= 1)
    .sort((a, b) => b.q - a.q)

  for (const { lang } of entries) {
    const match = matchUiLocale(lang)
    if (match) return match
  }
  return DEFAULT_LOCALE
}
