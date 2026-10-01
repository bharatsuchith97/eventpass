import 'dotenv/config';
import { startServer } from './server';

const { stop } = await startServer();

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    void stop().finally(() => process.exit(0));
  });
}
