import { WebSocketServer } from 'ws';
import { RealtimeClient } from '@openai/realtime-api-beta';

export class RealtimeRelay {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.sockets = new WeakMap();
    this.wss = null;
  }

  listen(port) {
    this.wss = new WebSocketServer({ port });
    this.wss.on('connection', this.connectionHandler.bind(this));
    this.log(`Listening on ws://localhost:${port}`);
  }

  async connectionHandler(ws, req) {
    if (!req.url) {
      this.log('No URL provided, closing connection.');
      ws.close();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    if (pathname !== '/') {
      this.log(`Invalid pathname: "${pathname}"`);
      ws.close();
      return;
    }

    // Instantiate new client
    this.log(`Connecting with key "${this.apiKey.slice(0, 3)}..."`);
    const client = new RealtimeClient({ apiKey: this.apiKey });

    // Set up error handling for all client events
    const handleClientError = (error) => {
      console.error('OpenAI client error:', error);
      this.log(`OpenAI client error: ${error.message}`);
      // Don't close the connection for data processing errors
      // Only close for critical errors like connection failures
      if (error.message.includes('connection') || error.message.includes('authentication')) {
        ws.close();
      }
    };

    // Relay: OpenAI Realtime API Event -> Browser Event
    client.realtime.on('server.*', (event) => {
      try {
        this.log(`Relaying "${event.type}" to Client`);
        ws.send(JSON.stringify(event));
      } catch (e) {
        console.error('Error sending event to client:', e.message);
        this.log(`Error sending event to client: ${e.message}`);
      }
    });
    client.realtime.on('close', () => ws.close());
    client.realtime.on('error', handleClientError);

    // Wrap the client in a proxy to catch any synchronous errors
    const clientProxy = new Proxy(client, {
      get: (target, prop) => {
        const value = target[prop];
        if (typeof value === 'function') {
          return (...args) => {
            try {
              const result = value.apply(target, args);
              if (result instanceof Promise) {
                return result.catch(handleClientError);
              }
              return result;
            } catch (e) {
              handleClientError(e);
              return null;
            }
          };
        }
        return value;
      }
    });

    // Relay: Browser Event -> OpenAI Realtime API Event
    // We need to queue data waiting for the OpenAI connection
    const messageQueue = [];
    const messageHandler = (data) => {
      try {
        const event = JSON.parse(data);
        this.log(`Relaying "${event.type}" to OpenAI`);
        clientProxy.realtime.send(event.type, event).catch(e => {
          console.error('Error sending event to OpenAI:', e.message);
          this.log(`Error sending event to OpenAI: ${e.message}`);
        });
      } catch (e) {
        console.error(e.message);
        this.log(`Error parsing event from client: ${data}`);
      }
    };
    ws.on('message', (data) => {
      if (!clientProxy.isConnected()) {
        messageQueue.push(data);
      } else {
        messageHandler(data);
      }
    });
    ws.on('close', () => clientProxy.disconnect());

    // Connect to OpenAI Realtime API
    try {
      this.log(`Connecting to OpenAI...`);
      await clientProxy.connect();
    } catch (e) {
      this.log(`Error connecting to OpenAI: ${e.message}`);
      ws.close();
      return;
    }
    this.log(`Connected to OpenAI successfully!`);
    while (messageQueue.length) {
      messageHandler(messageQueue.shift());
    }
  }

  log(...args) {
    console.log(`[RealtimeRelay]`, ...args);
  }
}
