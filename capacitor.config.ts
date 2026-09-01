import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.jieseob.planner',
  appName: 'Goals to Today',
  webDir: 'dist',
  backgroundColor: '#f5f6f8',
  ios: {
    contentInset: 'automatic'
  },
  android: {
    backgroundColor: '#f5f6f8'
  }
};

export default config;
