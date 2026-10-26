export const API_TIMEOUT_MS = 20_000;

export class RequestTimeoutError extends Error {
  constructor() {
    super('API request deadline exceeded');
    this.name = 'RequestTimeoutError';
  }
}

export function assertRequestActive(signal: AbortSignal) {
  if (signal.aborted)
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException('请求已取消', 'AbortError');
}

// The deadline covers headers AND body decoding. Racing the operation also
// bounds a stalled transport that does not promptly reject when aborted.
export async function withRequestDeadline<T>(
  parent: AbortSignal | null | undefined,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (parent?.aborted) throw new DOMException('请求已取消', 'AbortError');
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel = () => {};
  const interrupted = new Promise<never>((_resolve, reject) => {
    cancel = () => {
      const error = new DOMException('请求已取消', 'AbortError');
      controller.abort(error);
      reject(error);
    };
    parent?.addEventListener('abort', cancel, { once: true });
    timer = setTimeout(() => {
      const error = new RequestTimeoutError();
      controller.abort(error);
      reject(error);
    }, API_TIMEOUT_MS);
  });
  try {
    return await Promise.race([operation(controller.signal), interrupted]);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener('abort', cancel);
  }
}
