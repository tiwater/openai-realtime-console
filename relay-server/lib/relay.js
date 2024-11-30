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

    // Set up basic error handling
    const handleClientError = (error) => {
      console.error('OpenAI client error:', error);
      this.log(`OpenAI client error: ${error.message}`);
      if (error.message.includes('connection') || error.message.includes('authentication')) {
        ws.close();
      }
    };

    // Relay: OpenAI Realtime API Event -> Browser Event
    client.realtime.on('server.*', (event) => {
      this.log(`Relaying "${event.type}" to Client`);
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(event));
      }
    });
    client.realtime.on('close', () => ws.close());
    client.realtime.on('error', handleClientError);

    // Relay: Browser Event -> OpenAI Realtime API Event
    // We need to queue data waiting for the OpenAI connection
    const messageQueue = [];
    const messageHandler = async (data) => {
      let event;
      try {
        // First try to parse the data - if this fails, it's not valid JSON
        event = JSON.parse(data);
      } catch (e) {
        console.error('Invalid JSON received:', e.message);
        this.log(`Error parsing event from client: ${data}`);
        return;
      }

      try {
        this.log(`Relaying "${event.type}" to OpenAI`);
        await client.realtime.send(event.type, event);
      } catch (e) {
        console.error('Error sending event to OpenAI:', e.message);
        handleClientError(e);
      }
    };

    ws.on('message', (data) => {
      if (!client.isConnected()) {
        messageQueue.push(data);
      } else {
        messageHandler(data);
      }
    });
    ws.on('close', () => client.disconnect());

    // Connect to OpenAI Realtime API
    try {
      this.log(`Connecting to OpenAI...`);
      await client.connect();
      this.log(`Connected to OpenAI successfully!`);

      // Process any queued messages
      while (messageQueue.length) {
        await messageHandler(messageQueue.shift());
      }
    } catch (e) {
      this.log(`Error connecting to OpenAI: ${e.message}`);
      ws.close();
      return;
    }
  }

  log(...args) {
    console.log(`[RealtimeRelay]`, ...args);
  }
}
