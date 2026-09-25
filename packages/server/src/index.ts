import { createApp } from './app';
const server = await createApp();
const port = Number(process.env.PORT ?? 3001);
server.http.listen(port, '0.0.0.0', () =>
  console.log(`Chrono Card is listening on http://localhost:${port}`),
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, async () => {
    await server.close();
    process.exit(0);
  });
