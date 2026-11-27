import { z } from 'zod'
import {
  type AgentMessage,
  AgentMessageSchema,
  HousePlanProgressSchema,
  HousePlanSchema,
} from './house-agent-protocol'

const MAX_CHAT_MESSAGES = 240

export function recentAgentMessages(messages: AgentMessage[]): AgentMessage[] {
  if (messages.length <= MAX_CHAT_MESSAGES) return messages
  let start = messages.length - MAX_CHAT_MESSAGES
  while (messages[start]?.role === 'tool') start += 1
  return messages.slice(start)
}

export const ChatRecordSchema = z.object({
  id: z.string(),
  sceneId: z.string(),
  title: z.string().max(100),
  updatedAt: z.number(),
  messages: z.array(AgentMessageSchema).max(MAX_CHAT_MESSAGES),
  plan: HousePlanSchema.nullable(),
  planProgress: HousePlanProgressSchema.optional(),
  planPending: z.boolean().optional(),
  resumeWroteScene: z.boolean().optional(),
})
export type ChatRecord = z.infer<typeof ChatRecordSchema>
function openHistory(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('pascal-house-agent-chats', 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('chats', { keyPath: 'id' }).createIndex('sceneId', 'sceneId')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
export async function saveAgentChat(record: ChatRecord): Promise<void> {
  const parsed = ChatRecordSchema.parse(record)
  if (JSON.stringify(parsed).length > 32 * 1024 * 1024)
    throw new Error('Conversation exceeds the local history size limit.')
  const db = await openHistory()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('chats', 'readwrite')
      tx.objectStore('chats').put(parsed)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}
export async function listAgentChats(sceneId: string): Promise<ChatRecord[]> {
  const db = await openHistory()
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('chats').objectStore('chats').index('sceneId').getAll(sceneId)
      request.onsuccess = () =>
        resolve(
          request.result
            .flatMap((value) => {
              const parsed = ChatRecordSchema.safeParse(value)
              return parsed.success ? [parsed.data] : []
            })
            .sort((a, b) => b.updatedAt - a.updatedAt),
        )
      request.onerror = () => reject(request.error)
    })
  } finally {
    db.close()
  }
}
