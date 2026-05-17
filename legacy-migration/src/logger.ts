type Level = 'info' | 'warn' | 'error'

function emit(level: Level, msg: string): void {
  const ts = new Date().toISOString()
  const line = `[${ts}] [${level.toUpperCase()}] ${msg}`
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export const log = (msg: string) => emit('info', msg)
export const warn = (msg: string) => emit('warn', msg)
export const logError = (msg: string) => emit('error', msg)
