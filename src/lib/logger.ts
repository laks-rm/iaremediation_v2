type LogLevel = "info" | "warn" | "error";
type LogPayload = Record<string, unknown>;

function writeLog(level: LogLevel, obj: LogPayload, msg?: string) {
  const logEntry = {
    level,
    time: new Date().toISOString(),
    ...(msg ? { msg } : {}),
    ...obj,
  };

  const serialized = JSON.stringify(logEntry);

  if (level === "error") {
    console.error(serialized);
    return;
  }

  if (level === "warn") {
    console.warn(serialized);
    return;
  }

  console.log(serialized);
}

export const logger = {
  info(obj: LogPayload, msg?: string) {
    writeLog("info", obj, msg);
  },
  warn(obj: LogPayload, msg?: string) {
    writeLog("warn", obj, msg);
  },
  error(obj: LogPayload, msg?: string) {
    writeLog("error", obj, msg);
  },
};
