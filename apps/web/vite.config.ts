import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { loadEnv, type PluginOption } from 'vite';
import mkcert from 'vite-plugin-mkcert';
import tsconfigPaths from 'vite-tsconfig-paths';

const webRoot = fileURLToPath(new URL('.', import.meta.url));
const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url));
const packagesRoot = fileURLToPath(new URL('../../packages', import.meta.url));

function resolveFromWebRoot(path: string): string {
  return fileURLToPath(new URL(path, import.meta.url));
}

function isEnabled(value: string | undefined): boolean {
  return value === '1' || value === 'true' || value === 'yes';
}

function toPort(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toOptionalPort(value: string | undefined): number | undefined {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeBasePath(value: string | undefined): string {
  if (!value) return '/';

  if (value.startsWith('http://') || value.startsWith('https://')) {
    return value.endsWith('/') ? value : `${value}/`;
  }

  const withLeadingSlash = value.startsWith('/') ? value : `/${value}`;
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`;
}

function createHmrOptions(options: {
  useHttps: boolean;
  host: string | undefined;
  clientPort: number | undefined;
}) {
  return {
    protocol: options.useHttps ? 'wss' : 'ws',
    ...(options.host ? { host: options.host } : {}),
    ...(options.clientPort !== undefined ? { clientPort: options.clientPort } : {})
  };
}

function createManualChunk(id: string): string | undefined {
  const normalizedId = id.replaceAll('\\', '/');

  if (!normalizedId.includes('/node_modules/')) {
    return undefined;
  }

  if (
    normalizedId.includes('/react/') ||
    normalizedId.includes('/react-dom/') ||
    normalizedId.includes('/scheduler/') ||
    normalizedId.includes('/react-router') ||
    normalizedId.includes('/react-router-dom/')
  ) {
    return 'react';
  }

  if (
    normalizedId.includes('/@tma.js/') ||
    normalizedId.includes('/@telegram-apps/')
  ) {
    return 'telegram';
  }

  if (normalizedId.includes('/@tonconnect/')) {
    return 'ton';
  }

  if (normalizedId.includes('/@tanstack/')) {
    return 'query';
  }

  if (
    normalizedId.includes('/motion/') ||
    normalizedId.includes('/lucide-react/') ||
    normalizedId.includes('/clsx/') ||
    normalizedId.includes('/tailwind-merge/') ||
    normalizedId.includes('/class-variance-authority/')
  ) {
    return 'ui';
  }

  if (
    normalizedId.includes('/zod/') ||
    normalizedId.includes('/zustand/') ||
    normalizedId.includes('/date-fns/') ||
    normalizedId.includes('/uuid/')
  ) {
    return 'utils';
  }

  return 'vendor';
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, webRoot, 'VITE_');

  const isProduction = mode === 'production';
  const useHttps = isEnabled(env.VITE_USE_HTTPS);
  const enableApiProxy = isEnabled(env.VITE_ENABLE_API_PROXY);

  const devPort = toPort(env.VITE_DEV_PORT, 5173);
  const previewPort = toPort(env.VITE_PREVIEW_PORT, 4173);

  const apiProxyTarget = env.VITE_API_PROXY_TARGET || 'http://localhost:3000';
  const basePath = normalizeBasePath(env.VITE_PUBLIC_BASE_PATH);
  const enableSourceMap = isEnabled(env.VITE_BUILD_SOURCEMAP);

  const plugins: PluginOption[] = [
    react({
      jsxRuntime: 'automatic'
    }),
    tailwindcss(),
    tsconfigPaths({
      loose: true
    }),
    useHttps ? mkcert() : null
  ].filter(Boolean) as PluginOption[];

  return {
    root: webRoot,
    appType: 'spa',
    base: basePath,
    publicDir: resolveFromWebRoot('./public'),
    cacheDir: resolveFromWebRoot('../../node_modules/.vite/apps-web'),
    envDir: webRoot,
    envPrefix: ['VITE_'],

    plugins,

    resolve: {
      alias: {
        '@': resolveFromWebRoot('./src'),
        '@app': resolveFromWebRoot('./src/app'),
        '@shared': resolveFromWebRoot('./src/shared'),
        '@features': resolveFromWebRoot('./src/features'),
        '@api': resolveFromWebRoot('./src/api'),
        '@styles': resolveFromWebRoot('./src/shared/styles'),
        '@assets': resolveFromWebRoot('./src/assets'),
        '@app-types': resolveFromWebRoot('./src/types')
      }
    },

    define: {
      __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.1.0'),
      __BUILD_MODE__: JSON.stringify(mode),
      __BUILD_TIME__: JSON.stringify(new Date().toISOString())
    },

    server: {
      host: '0.0.0.0',
      port: devPort,
      strictPort: true,
      open: false,
      fs: {
        allow: [webRoot, workspaceRoot, packagesRoot]
      },
      hmr: createHmrOptions({
        useHttps,
        host: env.VITE_HMR_HOST || undefined,
        clientPort: toOptionalPort(env.VITE_HMR_CLIENT_PORT)
      }),
      ...(enableApiProxy
        ? {
            proxy: {
              '/api': {
                target: apiProxyTarget,
                changeOrigin: true,
                secure: false,
                ws: true
              }
            }
          }
        : {})
    },

    preview: {
      host: '0.0.0.0',
      port: previewPort,
      strictPort: true,
      open: false
    },

    build: {
      target: 'es2022',
      outDir: 'dist',
      assetsDir: 'assets',
      emptyOutDir: true,
      sourcemap: enableSourceMap,
      manifest: true,
      cssCodeSplit: true,
      minify: isProduction ? 'esbuild' : false,
      reportCompressedSize: true,
      chunkSizeWarningLimit: 700,
      modulePreload: {
        polyfill: false
      },
      rollupOptions: {
        input: resolveFromWebRoot('./index.html'),
        output: {
          manualChunks: createManualChunk,
          entryFileNames: 'assets/js/[name]-[hash].js',
          chunkFileNames: 'assets/js/[name]-[hash].js',
          assetFileNames: assetInfo => {
            const fileName = assetInfo.names?.[0] ?? assetInfo.name ?? '';

            if (/\.(css)$/i.test(fileName)) {
              return 'assets/css/[name]-[hash][extname]';
            }

            if (/\.(png|jpe?g|webp|avif|gif|svg)$/i.test(fileName)) {
              return 'assets/images/[name]-[hash][extname]';
            }

            if (/\.(mp4|webm|ogg|mp3|wav)$/i.test(fileName)) {
              return 'assets/media/[name]-[hash][extname]';
            }

            if (/\.(woff2?|ttf|otf|eot)$/i.test(fileName)) {
              return 'assets/fonts/[name]-[hash][extname]';
            }

            return 'assets/[name]-[hash][extname]';
          }
        }
      }
    },

    optimizeDeps: {
      include: [
        'react',
        'react-dom',
        'react-router-dom',
        '@tanstack/react-query',
        'zustand',
        'zod',
        '@tma.js/sdk',
        '@tma.js/sdk-react',
        '@tonconnect/ui-react'
      ]
    },

    esbuild: {
      target: 'es2022',
      legalComments: 'none',
      drop: isProduction ? ['debugger'] : []
    },

    css: {
      devSourcemap: !isProduction,
      modules: {
        localsConvention: 'camelCaseOnly'
      }
    },

    assetsInclude: [
      '**/*.webp',
      '**/*.avif',
      '**/*.lottie',
      '**/*.riv',
      '**/*.glb',
      '**/*.gltf'
    ],

    test: {
      globals: true,
      environment: 'jsdom',
      css: true,
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
      exclude: ['node_modules', 'dist', 'coverage', '.vite', 'e2e'],
      clearMocks: true,
      mockReset: true,
      restoreMocks: true
    }
  };
});
