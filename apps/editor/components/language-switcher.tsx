'use client'

import { Languages } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { LOCALE_LABELS, SUPPORTED_LOCALES, type SupportedLocale } from '@/lib/ui-locale'

function readCurrentLocale(): SupportedLocale {
  if (typeof document === 'undefined') return 'zh-CN'
  const lang = document.documentElement.lang
  if ((SUPPORTED_LOCALES as readonly string[]).includes(lang)) return lang as SupportedLocale
  return 'zh-CN'
}

export function LanguageSwitcher() {
  const router = useRouter()
  const [current, setCurrent] = useState<SupportedLocale>('zh-CN')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setCurrent(readCurrentLocale())
    const obs = new MutationObserver(() => setCurrent(readCurrentLocale()))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
    return () => obs.disconnect()
  }, [])

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  function switchLocale(locale: SupportedLocale) {
    setOpen(false)
    // Reload current page with ?lang= param so the middleware sets the header.
    const url = new URL(window.location.href)
    url.searchParams.set('lang', locale)
    router.push(url.pathname + url.search)
    router.refresh()
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        // i18n-ignore: aria-label with native locale name
        aria-label={LOCALE_LABELS[current]}
        className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
      >
        <Languages className="h-4 w-4 shrink-0" />
        <span className="hidden sm:inline">{LOCALE_LABELS[current]}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 min-w-[8rem] overflow-hidden rounded-lg border border-border bg-popover py-1 shadow-lg">
          {SUPPORTED_LOCALES.map((locale) => (
            <button
              key={locale}
              type="button"
              onClick={() => switchLocale(locale)}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-accent ${
                locale === current ? 'font-semibold text-primary' : 'text-foreground'
              }`}
            >
              {LOCALE_LABELS[locale]}
              {locale === current && (
                <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
