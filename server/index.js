/**
 * Standalone Local Server Runner
 * Sithumini Cinnamon Hub
 */

import app from './app.js';

const PORT = process.env.SERVER_PORT || 4000;

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[Sithumini Cinnamon Hub] API Server listening on http://localhost:${PORT}`);
});
