import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { resolveBuildMetadata } from './scripts/buildMetadata.js'

const buildMetadata = resolveBuildMetadata({ repositoryRoot: fileURLToPath(new URL('.', import.meta.url)) })

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_GIT_COMMIT__: JSON.stringify(buildMetadata.gitCommit),
    __APP_GIT_COMMIT_SHORT__: JSON.stringify(buildMetadata.gitCommitShort),
    __APP_BUILD_TIME__: JSON.stringify(buildMetadata.buildTime)
  }
})
