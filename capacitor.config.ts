import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.bamboozle.app',
  appName: 'Bamboozle',
  webDir: 'dist',
  server: {
    url: 'http://192.168.1.6:3000',
    cleartext: true
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: '#0f0f23',
      showSpinner: false,
    },
  },
};

export default config;
