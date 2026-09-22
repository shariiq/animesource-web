import { z } from 'zod'
import type { Versioned } from './schema'

const DB_NAME = 'anisource-web'
const DB_VERSION = 1
const STORE = 'kv'

let dbPromise: Promise<IDBDatabase> | null = null
let dbConnection: IDBDatabase | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbConnection) return Promise.resolve(dbConnection)
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable on the server.'))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    request.onsuccess = () => {
      dbConnection = request.result
      resolve(request.result)
    }
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB.'))
  })
  return dbPromise
}

export async function closeDb(): Promise<void> {
  const promise = dbPromise
  dbPromise = null
  dbConnection = null
  if (promise) (await promise).close()
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'))
  })
}

function transactionToPromise(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed.'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted.'))
  })
}

function writeTransaction<T>(db: IDBDatabase, key: string, value: Versioned<T>): Promise<void> {
  const tx = db.transaction(STORE, 'readwrite')
  const completion = transactionToPromise(tx)
  tx.objectStore(STORE).put(value, key)
  tx.commit()
  return completion
}

export interface KeyValueStore {
  read<T>(key: string, schema: z.ZodType<Versioned<T>>): Promise<T | null>
  write<T>(
    key: string,
    version: number,
    value: T,
    schema: z.ZodType<Versioned<T>>,
  ): Promise<void>
  update<T>(
    key: string,
    version: number,
    schema: z.ZodType<Versioned<T>>,
    updateValue: (value: T | null) => T,
  ): Promise<T>
  remove(key: string): Promise<void>
  keys(prefix?: string): Promise<string[]>
}

export const indexedDbStore: KeyValueStore = {
  async read<T>(key: string, schema: z.ZodType<Versioned<T>>) {
    const db = await openDb()
    const tx = db.transaction(STORE, 'readonly')
    const raw = await requestToPromise(tx.objectStore(STORE).get(key) as IDBRequest<unknown>)
    if (raw === undefined) return null
    const parsed = schema.safeParse(raw)
    return parsed.success ? parsed.data.data : null
  },
  write<T>(
    key: string,
    version: number,
    value: T,
    schema: z.ZodType<Versioned<T>>,
  ) {
    const parsed = schema.safeParse({ v: version, data: value })
    if (!parsed.success) return Promise.reject(new Error('Cannot persist an invalid viewer record.'))
    if (dbConnection) return writeTransaction(dbConnection, key, parsed.data)
    return openDb().then((db) => writeTransaction(db, key, parsed.data))
  },
  async update<T>(
    key: string,
    version: number,
    schema: z.ZodType<Versioned<T>>,
    updateValue: (value: T | null) => T,
  ) {
    const db = await openDb()
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const raw = await requestToPromise(store.get(key) as IDBRequest<unknown>)
    const existing = raw !== undefined ? schema.safeParse(raw) : null
    const current = existing && existing.success ? existing.data.data : null
    const updated = updateValue(current)
    const validated = schema.safeParse({ v: version, data: updated })
    if (!validated.success) throw new Error('Cannot persist an invalid viewer record.')
    store.put(validated.data, key)
    await transactionToPromise(tx)
    return updated
  },
  async remove(key) {
    const db = await openDb()
    const tx = db.transaction(STORE, 'readwrite')
    const completion = transactionToPromise(tx)
    tx.objectStore(STORE).delete(key)
    await completion
  },
  async keys(prefix = '') {
    const db = await openDb()
    const tx = db.transaction(STORE, 'readonly')
    const raw = await requestToPromise(tx.objectStore(STORE).getAllKeys())
    return raw
      .filter((key): key is string => typeof key === 'string' && key.startsWith(prefix))
  },
}
