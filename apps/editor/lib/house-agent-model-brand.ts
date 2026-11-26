// Local Lobe Icons assets from lobehub/lobe-icons@05260484d9f4de68f90cc87a634ae68fa4043efd.
const brands = [
  { name: /^(openai|chatgpt|gpt\d*|o[134]|dalle|dall)$/, icon: 'openai', invert: true },
  { name: /^(anthropic|claude)$/, icon: 'claude-color' },
  { name: /^(gemini\d*|imagen\d*|nanobanana)$/, icon: 'gemini-color' },
  { name: /^(deepseek|深度求索)$/, icon: 'deepseek-color' },
  { name: /^(qwen|qwq|qvq|dashscope|tongyi|千问|通义千问)\d*$/, icon: 'qwen-color' },
  { name: /^(grok|xai)$/, icon: 'grok', invert: true },
  { name: /^(kimi|moonshot|moonshotai|月之暗面)$/, icon: 'kimi-color' },
  { name: /^(glm|chatglm|zhipu|zai|智谱|智谱清言)\d*$/, icon: 'zhipu-color' },
  { name: /^(mistral|mixtral|codestral|devstral|pixtral)$/, icon: 'mistral-color' },
  { name: /^(meta|llama)\d*$/, icon: 'meta-color' },
]

export function houseAgentModelBrand(modelId: string, owner?: string) {
  for (const label of [...modelId.split('/').reverse(), owner]) {
    for (const token of label
      ?.toLowerCase()
      .replace(/nano[-_ ]banana/g, 'nanobanana')
      .split(/[^a-z0-9\p{Script=Han}]+/u) ?? []) {
      const brand = brands.find(({ name }) => name.test(token))
      if (brand) return brand
    }
  }
  return undefined
}
