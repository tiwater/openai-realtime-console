import { RealtimeRelay } from './lib/relay.js';
import dotenv from 'dotenv';
dotenv.config({ override: true });

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_API_KEY) {
  console.error(
    `Environment variable "OPENAI_API_KEY" is required.\n` +
      `Please set it in your .env file.`
  );
  process.exit(1);
}

const PORT = parseInt(process.env.PORT) || 8081;

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);  // Exit with error code to trigger nodemon restart
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);  // Exit with error code to trigger nodemon restart
});

const relay = new RealtimeRelay(OPENAI_API_KEY);

// Add error handling for the relay server
relay.on('error', (err) => {
  console.error('Relay Server Error:', err);
  process.exit(1);  // Exit with error code to trigger nodemon restart
});

relay.listen(PORT);
