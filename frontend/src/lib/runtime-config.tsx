import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { getRuntimeConfig } from './api';
import type { AppRuntimeConfig } from './types';

const defaultRuntimeConfig: AppRuntimeConfig = {
  site_name: 'Praxis',
  upload_image_max_size_bytes: 5 * 1024 * 1024,
  timezone: 'UTC+8',
  password_min_length: 8,
  password_max_length: 32
};

const RuntimeConfigContext = createContext(defaultRuntimeConfig);

export function RuntimeConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState(defaultRuntimeConfig);

  useEffect(() => {
    let active = true;

    getRuntimeConfig()
      .then((nextConfig) => {
        if (active) setConfig(nextConfig);
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
