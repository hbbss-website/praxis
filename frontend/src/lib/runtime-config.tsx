import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { getRuntimeConfig } from './api';
import type { AppRuntimeConfig } from './types';

const defaultRuntimeConfig: AppRuntimeConfig = {
  site_name: 'Praxis',
  icp_beian: '',
  upload_image_max_size_bytes: 5 * 1024 * 1024,
  is_production: false,
  server_timestamp: Date.now(),
  client_time_offset_ms: 0
};

const RuntimeConfigContext = createContext(defaultRuntimeConfig);

export function RuntimeConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState(defaultRuntimeConfig);

  useEffect(() => {
    let active = true;

    getRuntimeConfig()
      .then((nextConfig) => {
        if (active) {
          setConfig({
            ...nextConfig,
            client_time_offset_ms: Date.now() - nextConfig.server_timestamp
          });
        }
      })
      .catch(() => {
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    document.title = config.site_name;
  }, [config.site_name]);

  return <RuntimeConfigContext.Provider value={config}>{children}</RuntimeConfigContext.Provider>;
}

export function useRuntimeConfig() {
  return useContext(RuntimeConfigContext);
}

export function useSiteName() {
  return useRuntimeConfig().site_name;
}
