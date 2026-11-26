// Local Lobe Icons assets from lobehub/lobe-icons@05260484d9f4de68f90cc87a634ae68fa4043efd.
const brands = [
  { name: /^(openai|chatgpt|gpt\d*|o[134])$/, icon: 'openai', invert: true },
  { name: /^(anthropic|claude)$/, icon: 'claude-color' },
  { name: /^gemini$/, icon: 'gemini-color' },
  { name: /^deepseek$/, icon: 'deepseek-color' },
  { name: /^(qwen|qwq|qvq|dashscope|tongyi)\d*$/, icon: 'qwen-color' },
  { name: /^(grok|xai)$/, icon: 'grok', invert: true },
  { name: /^(kimi|moonshot)$/, icon: 'kimi-color' },
  { name: /^(glm|zhipu|zai)\d*$/, icon: 'zhipu-color' },
  { name: /^(mistral|mixtral|codestral|devstral|pixtral)$/, icon: 'mistral-color' },
  { name: /^(meta|llama)\d*$/, icon: 'meta-color' },
]

export function houseAgentModelBrand(modelId: string, owner?: string) {
  for (const label of [...modelId.split('/').reverse(), owner]) {
    for (const token of label?.toLowerCase().split(/[^a-z0-9]+/) ?? []) {
      const brand = brands.find(({ name }) => name.test(token))
      if (brand) return brand
    }
  }
  return undefined
}
