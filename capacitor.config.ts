import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.virus.appreader',
  appName: 'AppReader',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  }
};

export default config;
