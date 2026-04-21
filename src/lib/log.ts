type Level = 'debug' | 'info' | 'warn' | 'error'

function emit(level: Level, msg: string, ctx?: Record<string, unknown>) {
  const payload = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...(ctx ?? {}),
  })
  if (level === 'error') console.error(payload)
  else console.log(payload)
}

export const log = {
  debug: (msg: string, ctx?: Record<string, unknown>) => emit('debug', msg, ctx),
  info: (msg: string, ctx?: Record<string, unknown>) => emit('info', msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => emit('warn', msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => emit('error', msg, ctx),
}
