/**
 * Minimal request/response JSON-RPC client over the native WebSocket.
 *
 * Deliberately avoids subscriptions: some legacy parachain nodes never push
 * `chain_subscribeFinalizedHeads` notifications, which stalls PAPI's
 * compatibility layer indefinitely. Plain legacy RPC calls work everywhere.
 */
export interface RpcClient {
  endpoint: string;
  request: <T>(method: string, params?: unknown[]) => Promise<T>;
  close: () => void;
}

const CONNECT_TIMEOUT_MS = 8_000;

const connect = (endpoint: string): Promise<RpcClient> =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(endpoint);
    const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
    let nextId = 1;

    const failAll = (error: Error) => {
      for (const handlers of pending.values()) handlers.reject(error);
      pending.clear();
    };

    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`${endpoint}: connection timed out`));
    }, CONNECT_TIMEOUT_MS);

    socket.onopen = () => {
      clearTimeout(timer);
      resolve({
        endpoint,
        request: (method, params = []) =>
          new Promise((resolveRequest, rejectRequest) => {
            const id = nextId++;
            pending.set(id, { resolve: resolveRequest, reject: rejectRequest });
            socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
          }),
        close: () => socket.close(),
      });
    };
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data));
      const handlers = pending.get(message.id);
      if (!handlers) return;
      pending.delete(message.id);
      if (message.error) handlers.reject(new Error(`${message.error.code}: ${message.error.message}`));
      else handlers.resolve(message.result);
    };
    socket.onerror = () => {
      clearTimeout(timer);
      reject(new Error(`${endpoint}: connection failed`));
      failAll(new Error(`${endpoint}: connection error`));
    };
    socket.onclose = () => failAll(new Error(`${endpoint}: connection closed`));
  });

/** Connect to the first endpoint that answers, trying them in order. */
export const connectAny = async (endpoints: string[]): Promise<RpcClient> => {
  const errors: string[] = [];
  for (const endpoint of endpoints) {
    try {
      return await connect(endpoint);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(errors.join('; ') || 'No endpoints');
};
