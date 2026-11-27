'use client'

import { usePascalI18n } from '@pascal-app/core'

export function ModelApiSetupHint() {
  const i18n = usePascalI18n()
  return (
    <p className="text-xs leading-5 text-amber-200">
      {i18n._({ id: 'app.sceneLoader.settings', message: 'Settings' })}
      {' → '}
      {i18n._({ id: 'app.houseAgent.modelPicker.settings', message: 'API settings' })}
    </p>
  )
}
