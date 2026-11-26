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

/**
 * Resolve a UI locale from a raw locale string (e.g. from a URL param or
 * Accept-Language header). Falls back to DEFAULT_LOCALE when nothing matches.
 */
export function resolveUiLocale(value: string | null | undefined): string {
  const requested = value?.trim()
  if (!requested) return DEFAULT_LOCALE
  try {
    const canonical = Intl.getCanonicalLocales(requested)[0]
    if (!canonical) return DEFAULT_LOCALE
    // Exact match first
    if ((SUPPORTED_LOCALES as readonly string[]).includes(canonical)) return canonical
    // Language-only prefix match (e.g. "zh" → "zh-CN", "en-US" → "en")
    const prefix = canonical.split('-')[0]
    const match = SUPPORTED_LOCALES.find(
      (locale) => locale === prefix || locale.split('-')[0] === prefix,
    )
    return match ?? DEFAULT_LOCALE
  } catch {
    return DEFAULT_LOCALE
  }
}

/**
 * Parse an Accept-Language header and return the best matching supported locale.
 * Returns DEFAULT_LOCALE when nothing matches.
 */
export function resolveAcceptLanguage(acceptLanguage: string | null | undefined): SupportedLocale {
  if (!acceptLanguage) return DEFAULT_LOCALE
  const entries = acceptLanguage
    .split(',')
    .map((entry) => {
      const [lang, q] = entry.trim().split(';q=')
      return { lang: lang?.trim() ?? '', q: q ? Number.parseFloat(q) : 1.0 }
    })
    .filter((e) => e.lang)
    .sort((a, b) => b.q - a.q)

  for (const { lang } of entries) {
    const resolved = resolveUiLocale(lang)
    if (resolved !== DEFAULT_LOCALE || lang.startsWith('zh')) return resolved as SupportedLocale
  }
  return DEFAULT_LOCALE
}
