import { createApp } from './app'
import { loadConfig } from './config'

// The turnkey standalone entrypoint: reads config from the environment,
// assembles the app, and listens. Adopters embedding pieces of this BFF into
// their own Express app should use createApp (or the individual route
// factories) from index.ts directly instead of running this file.

const config = loadConfig()
const app = createApp(config)

app.listen(config.port, () => {
  console.log(`reference-bff listening on port ${config.port}`)
})
